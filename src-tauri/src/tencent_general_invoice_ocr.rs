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
pub struct TencentGeneralInvoiceOcrResult {
    pub mixed_invoice_items: Vec<TencentGeneralInvoiceItem>,
    pub total_pdf_count: Option<u64>,
    pub request_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TencentGeneralInvoiceItem {
    pub code: String,
    pub invoice_type: Option<i64>,
    pub sub_type: String,
    pub type_description: String,
    pub sub_type_description: String,
    pub page: Option<u64>,
    pub angle: Option<f64>,
    pub cut_image: Option<String>,
    pub single_invoice_infos: Value,
    pub raw: Value,
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
        .timeout(std::time::Duration::from_secs(60))
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
        .map_err(|error| format!("腾讯云通用票据识别请求失败: {}", error))?;

    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("读取腾讯云通用票据识别响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "腾讯云通用票据识别失败: HTTP {} - {}",
            status, response_text
        ));
    }

    serde_json::from_str(&response_text).map_err(|error| {
        format!(
            "解析腾讯云通用票据识别响应失败: {} (响应: {})",
            error, response_text
        )
    })
}

fn optional_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn parse_items(items_value: Option<&Value>) -> Vec<TencentGeneralInvoiceItem> {
    let Some(items) = items_value.and_then(Value::as_array) else {
        return Vec::new();
    };

    items
        .iter()
        .map(|item| TencentGeneralInvoiceItem {
            code: optional_string(item, "Code"),
            invoice_type: item.get("Type").and_then(Value::as_i64),
            sub_type: optional_string(item, "SubType"),
            type_description: optional_string(item, "TypeDescription"),
            sub_type_description: optional_string(item, "SubTypeDescription"),
            page: item.get("Page").and_then(Value::as_u64),
            angle: item.get("Angle").and_then(Value::as_f64),
            cut_image: item
                .get("CutImage")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(ToString::to_string),
            single_invoice_infos: item
                .get("SingleInvoiceInfos")
                .cloned()
                .unwrap_or(Value::Null),
            raw: item.clone(),
        })
        .collect()
}

fn recognize_general_invoice(
    image_base64: &str,
    types: Vec<i64>,
    enable_other: bool,
    enable_pdf: bool,
    pdf_page_number: Option<u64>,
    enable_multiple_page: bool,
    enable_cut_image: bool,
    enable_item_polygon: bool,
    enable_qr_code: bool,
    enable_seal: bool,
    credentials: TencentOcrCredentials,
) -> Result<TencentGeneralInvoiceOcrResult, String> {
    validate_tencent_credentials(&credentials)?;

    let mut payload = serde_json::json!({
        "ImageBase64": normalize_image_base64(image_base64),
        "EnableOther": enable_other,
        "EnablePdf": enable_pdf,
        "EnableMultiplePage": enable_multiple_page,
        "EnableCutImage": enable_cut_image,
        "EnableItemPolygon": enable_item_polygon,
        "EnableQRCode": enable_qr_code,
        "EnableSeal": enable_seal
    });

    if !types.is_empty() {
        payload["Types"] = serde_json::json!(types);
    }
    if let Some(pdf_page_number) = pdf_page_number {
        payload["PdfPageNumber"] = serde_json::json!(pdf_page_number);
    }

    let response_json =
        tencent_ocr_request("RecognizeGeneralInvoice", payload.to_string(), &credentials)?;
    let response = response_json
        .get("Response")
        .ok_or_else(|| "腾讯云通用票据识别响应缺少 Response 字段".to_string())?;
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
            format!("腾讯云通用票据识别错误: {}", message)
        } else {
            format!("腾讯云通用票据识别错误 [{}]: {}", code, message)
        };
        if let Some(request_id) = request_id {
            output.push_str(&format!(" (RequestId: {})", request_id));
        }
        return Err(output);
    }

    Ok(TencentGeneralInvoiceOcrResult {
        mixed_invoice_items: parse_items(response.get("MixedInvoiceItems")),
        total_pdf_count: response.get("TotalPDFCount").and_then(Value::as_u64),
        request_id,
    })
}

#[tauri::command]
pub fn recognize_tencent_general_invoice_ocr(
    image_base64: String,
    types: Vec<i64>,
    enable_other: bool,
    enable_pdf: bool,
    pdf_page_number: Option<u64>,
    enable_multiple_page: bool,
    enable_cut_image: bool,
    enable_item_polygon: bool,
    enable_qr_code: bool,
    enable_seal: bool,
    state: State<AppState>,
) -> Result<TencentGeneralInvoiceOcrResult, String> {
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

    recognize_general_invoice(
        &image_base64,
        types,
        enable_other,
        enable_pdf,
        pdf_page_number,
        enable_multiple_page,
        enable_cut_image,
        enable_item_polygon,
        enable_qr_code,
        enable_seal,
        credentials,
    )
}
