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
pub struct TencentBankCardOcrResult {
    pub card_no: String,
    pub bank_info: String,
    pub valid_date: String,
    pub card_type: String,
    pub card_name: String,
    pub card_category: String,
    pub border_cut_image: Option<String>,
    pub card_no_image: Option<String>,
    pub warning_code: Option<Vec<i64>>,
    pub quality_value: Option<i64>,
    pub request_id: Option<String>,
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
        .map_err(|error| format!("腾讯云银行卡识别请求失败: {}", error))?;

    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("读取腾讯云银行卡识别响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "腾讯云银行卡识别失败: HTTP {} - {}",
            status, response_text
        ));
    }

    serde_json::from_str(&response_text).map_err(|error| {
        format!(
            "解析腾讯云银行卡识别响应失败: {} (响应: {})",
            error, response_text
        )
    })
}

fn optional_string(response: &Value, key: &str) -> String {
    response
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn optional_base64(response: &Value, key: &str) -> Option<String> {
    response
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
}

fn warning_codes(response: &Value) -> Option<Vec<i64>> {
    let codes: Vec<i64> = response
        .get("WarningCode")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(Value::as_i64)
        .collect();
    Some(codes)
}

fn recognize_bank_card(
    image_base64: &str,
    ret_border_cut_image: bool,
    ret_card_no_image: bool,
    enable_copy_check: bool,
    enable_reshoot_check: bool,
    enable_border_check: bool,
    enable_quality_value: bool,
    credentials: TencentOcrCredentials,
) -> Result<TencentBankCardOcrResult, String> {
    validate_tencent_credentials(&credentials)?;

    let payload = serde_json::json!({
        "ImageBase64": normalize_image_base64(image_base64),
        "RetBorderCutImage": ret_border_cut_image,
        "RetCardNoImage": ret_card_no_image,
        "EnableCopyCheck": enable_copy_check,
        "EnableReshootCheck": enable_reshoot_check,
        "EnableBorderCheck": enable_border_check,
        "EnableQualityValue": enable_quality_value
    })
    .to_string();

    let response_json = tencent_ocr_request("BankCardOCR", payload, &credentials)?;
    let response = response_json
        .get("Response")
        .ok_or_else(|| "腾讯云银行卡识别响应缺少 Response 字段".to_string())?;
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
            format!("腾讯云银行卡识别错误: {}", message)
        } else {
            format!("腾讯云银行卡识别错误 [{}]: {}", code, message)
        };
        if let Some(request_id) = request_id {
            output.push_str(&format!(" (RequestId: {})", request_id));
        }
        return Err(output);
    }

    Ok(TencentBankCardOcrResult {
        card_no: optional_string(response, "CardNo"),
        bank_info: optional_string(response, "BankInfo"),
        valid_date: optional_string(response, "ValidDate"),
        card_type: optional_string(response, "CardType"),
        card_name: optional_string(response, "CardName"),
        card_category: optional_string(response, "CardCategory"),
        border_cut_image: optional_base64(response, "BorderCutImage"),
        card_no_image: optional_base64(response, "CardNoImage"),
        warning_code: warning_codes(response),
        quality_value: response.get("QualityValue").and_then(Value::as_i64),
        request_id,
    })
}

#[tauri::command]
pub fn recognize_tencent_bank_card_ocr(
    image_base64: String,
    ret_border_cut_image: bool,
    ret_card_no_image: bool,
    enable_copy_check: bool,
    enable_reshoot_check: bool,
    enable_border_check: bool,
    enable_quality_value: bool,
    state: State<AppState>,
) -> Result<TencentBankCardOcrResult, String> {
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

    recognize_bank_card(
        &image_base64,
        ret_border_cut_image,
        ret_card_no_image,
        enable_copy_check,
        enable_reshoot_check,
        enable_border_check,
        enable_quality_value,
        credentials,
    )
}
