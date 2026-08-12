use crate::commands::AppState;
use hmac::{Hmac, Mac};
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone)]
struct TencentOcrCredentials {
    secret_id: String,
    secret_key: String,
    region: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TencentTableAccurateOcrResult {
    pub excel_base64: Option<String>,
    pub tables: Vec<TencentTablePreview>,
    pub request_id: Option<String>,
    pub pdf_page_size: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TencentTablePreview {
    pub row_count: usize,
    pub col_count: usize,
    pub cell_count: usize,
    pub rows: Vec<Vec<String>>,
    pub cells: Vec<TencentTableCellPreview>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TencentTableCellPreview {
    pub text: String,
    pub row_tl: usize,
    pub col_tl: usize,
    pub row_br: usize,
    pub col_br: usize,
    pub confidence: Option<f64>,
    pub cell_type: Option<String>,
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn sha256_hex(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

fn normalize_image_base64(input: &str) -> String {
    input
        .split_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(input)
        .trim()
        .to_string()
}

fn validate_tencent_credentials(credentials: &TencentOcrCredentials) -> Result<(), String> {
    if credentials.secret_id.is_empty() || credentials.secret_key.is_empty() {
        return Err("请先在全局设置的 OCR 配置中填写腾讯云 Secret ID 和 Secret Key".to_string());
    }

    if credentials.secret_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(
            "腾讯 OCR 配置错误：Secret ID 当前看起来像腾讯云 AppID（纯数字），不是 API SecretId。请在腾讯云「访问管理 > API 密钥管理」复制 SecretId。"
                .to_string(),
        );
    }

    if credentials.secret_key.starts_with("AKID") && !credentials.secret_id.starts_with("AKID") {
        return Err(
            "腾讯 OCR 配置错误：Secret ID 和 Secret Key 可能填反了。SecretId 通常以 AKID 开头，SecretKey 是另一串密钥。"
                .to_string(),
        );
    }

    Ok(())
}

fn tencent_ocr_request(
    action: &str,
    payload: String,
    credentials: &TencentOcrCredentials,
) -> Result<Value, String> {
    let service = "ocr";
    let host = "ocr.tencentcloudapi.com";
    let version = "2018-11-19";
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("获取系统时间失败: {}", error))?
        .as_secs();
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let http_request_method = "POST";
    let canonical_uri = "/";
    let canonical_querystring = "";
    let canonical_headers = format!("content-type:application/json\nhost:{}\n", host);
    let signed_headers = "content-type;host";
    let hashed_request_payload = sha256_hex(&payload);
    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        http_request_method,
        canonical_uri,
        canonical_querystring,
        canonical_headers,
        signed_headers,
        hashed_request_payload
    );

    let algorithm = "TC3-HMAC-SHA256";
    let credential_scope = format!("{}/{}/tc3_request", date, service);
    let hashed_canonical_request = sha256_hex(&canonical_request);
    let string_to_sign = format!(
        "{}\n{}\n{}\n{}",
        algorithm, timestamp, credential_scope, hashed_canonical_request
    );

    let secret_date = hmac_sha256(
        format!("TC3{}", credentials.secret_key).as_bytes(),
        date.as_bytes(),
    );
    let secret_service = hmac_sha256(&secret_date, service.as_bytes());
    let secret_signing = hmac_sha256(&secret_service, b"tc3_request");
    let signature = hex::encode(hmac_sha256(&secret_signing, string_to_sign.as_bytes()));
    let authorization = format!(
        "{} Credential={}/{}, SignedHeaders={}, Signature={}",
        algorithm, credentials.secret_id, credential_scope, signed_headers, signature
    );

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败: {}", error))?;

    let response = client
        .post(format!("https://{}", host))
        .header("Authorization", authorization)
        .header("Content-Type", "application/json")
        .header("Host", host)
        .header("X-TC-Action", action)
        .header("X-TC-Timestamp", timestamp.to_string())
        .header("X-TC-Version", version)
        .header("X-TC-Region", &credentials.region)
        .body(payload)
        .send()
        .map_err(|error| format!("腾讯云表格识别请求失败: {}", error))?;

    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("读取腾讯云表格识别响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "腾讯云表格识别失败: HTTP {} - {}",
            status, response_text
        ));
    }

    serde_json::from_str(&response_text).map_err(|error| {
        format!(
            "解析腾讯云表格识别响应失败: {} (响应: {})",
            error, response_text
        )
    })
}

fn parse_cell(cell: &Value) -> TencentTableCellPreview {
    let row_tl = cell.get("RowTl").and_then(Value::as_u64).unwrap_or(0) as usize;
    let col_tl = cell.get("ColTl").and_then(Value::as_u64).unwrap_or(0) as usize;
    let row_br = cell
        .get("RowBr")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .filter(|value| *value > row_tl)
        .unwrap_or(row_tl + 1);
    let col_br = cell
        .get("ColBr")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .filter(|value| *value > col_tl)
        .unwrap_or(col_tl + 1);

    TencentTableCellPreview {
        text: cell
            .get("Text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        row_tl,
        col_tl,
        row_br,
        col_br,
        confidence: cell.get("Confidence").and_then(Value::as_f64),
        cell_type: cell
            .get("Type")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    }
}

fn parse_tables(table_detections: Option<&Value>) -> Vec<TencentTablePreview> {
    let Some(tables) = table_detections.and_then(Value::as_array) else {
        return Vec::new();
    };

    tables
        .iter()
        .filter_map(|table| {
            let cells_value = table.get("Cells")?.as_array()?;
            let cells: Vec<TencentTableCellPreview> = cells_value.iter().map(parse_cell).collect();
            let row_count = cells.iter().map(|cell| cell.row_br).max().unwrap_or(0);
            let col_count = cells.iter().map(|cell| cell.col_br).max().unwrap_or(0);
            let mut rows = vec![vec![String::new(); col_count]; row_count];

            for cell in &cells {
                if cell.row_tl < row_count && cell.col_tl < col_count {
                    rows[cell.row_tl][cell.col_tl] = cell.text.clone();
                }
            }

            Some(TencentTablePreview {
                row_count,
                col_count,
                cell_count: cells.len(),
                rows,
                cells,
            })
        })
        .collect()
}

fn recognize_table_accurate(
    image_base64: &str,
    pdf_page_number: Option<u64>,
    credentials: TencentOcrCredentials,
) -> Result<TencentTableAccurateOcrResult, String> {
    validate_tencent_credentials(&credentials)?;

    let mut payload_value = serde_json::json!({
        "ImageBase64": normalize_image_base64(image_base64)
    });
    if let Some(pdf_page_number) = pdf_page_number {
        payload_value["PdfPageNumber"] = serde_json::json!(pdf_page_number);
    }
    let payload = payload_value.to_string();

    let response_json = tencent_ocr_request("RecognizeTableAccurateOCR", payload, &credentials)?;
    let response = response_json
        .get("Response")
        .ok_or_else(|| "腾讯云表格识别响应缺少 Response 字段".to_string())?;
    let request_id = response
        .get("RequestId")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    if let Some(error) = response.get("Error") {
        let code = error.get("Code").and_then(Value::as_str).unwrap_or("");
        let message = error
            .get("Message")
            .and_then(Value::as_str)
            .unwrap_or("未知错误");
        let mut output = if code.is_empty() {
            format!("腾讯云表格识别错误: {}", message)
        } else {
            format!("腾讯云表格识别错误 [{}]: {}", code, message)
        };
        if let Some(request_id) = request_id {
            output.push_str(&format!(" (RequestId: {})", request_id));
        }
        return Err(output);
    }

    let excel_base64 = response
        .get("Data")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string);
    let tables = parse_tables(response.get("TableDetections"));
    let pdf_page_size = response.get("PdfPageSize").and_then(Value::as_u64);

    Ok(TencentTableAccurateOcrResult {
        excel_base64,
        tables,
        request_id,
        pdf_page_size,
    })
}

#[tauri::command]
pub fn recognize_tencent_table_accurate_ocr(
    image_base64: String,
    pdf_page_number: Option<u64>,
    state: State<AppState>,
) -> Result<TencentTableAccurateOcrResult, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "读取全局设置失败：设置锁已损坏".to_string())?
        .load()
        .map_err(|error| format!("读取全局设置失败: {}", error))?;

    let credentials = TencentOcrCredentials {
        secret_id: settings.ocr_tencent_secret_id.trim().to_string(),
        secret_key: settings.ocr_tencent_secret_key.trim().to_string(),
        region: {
            let region = settings.ocr_tencent_region.trim();
            if region.is_empty() {
                "ap-guangzhou".to_string()
            } else {
                region.to_string()
            }
        },
    };

    recognize_table_accurate(&image_base64, pdf_page_number, credentials)
}
