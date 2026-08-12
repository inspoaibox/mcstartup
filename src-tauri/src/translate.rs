use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranslateConfig {
    // 百度翻译
    #[serde(rename = "baiduAppId")]
    pub baidu_app_id: String,
    #[serde(rename = "baiduSecretKey")]
    pub baidu_secret_key: String,

    // 谷歌翻译
    #[serde(rename = "googleApiKey")]
    pub google_api_key: String,

    // 必应翻译
    #[serde(rename = "bingApiKey")]
    pub bing_api_key: String,

    // 腾讯翻译
    #[serde(rename = "tencentSecretId")]
    pub tencent_secret_id: String,
    #[serde(rename = "tencentSecretKey")]
    pub tencent_secret_key: String,
    #[serde(rename = "tencentRegion")]
    pub tencent_region: String,

    // ChatGPT
    #[serde(rename = "openaiApiKey")]
    pub openai_api_key: String,
    #[serde(rename = "openaiModel")]
    pub openai_model: String,
    #[serde(rename = "openaiBaseUrl")]
    pub openai_base_url: String,
    #[serde(rename = "openaiCompatibleName", default)]
    pub openai_compatible_name: String,
    #[serde(rename = "openaiCompatibleApiKey", default)]
    pub openai_compatible_api_key: String,
    #[serde(rename = "openaiCompatibleModel", default)]
    pub openai_compatible_model: String,
    #[serde(rename = "openaiCompatibleBaseUrl", default)]
    pub openai_compatible_base_url: String,
    #[serde(rename = "deepseekApiKey", default)]
    pub deepseek_api_key: String,
    #[serde(rename = "deepseekModel", default = "default_deepseek_model")]
    pub deepseek_model: String,
    #[serde(rename = "deepseekBaseUrl", default = "default_deepseek_base_url")]
    pub deepseek_base_url: String,

    // Gemini
    #[serde(rename = "geminiApiKey")]
    pub gemini_api_key: String,
    #[serde(rename = "geminiModel")]
    pub gemini_model: String,
}

fn default_deepseek_model() -> String {
    "deepseek-v4-flash".to_string()
}

fn default_deepseek_base_url() -> String {
    "https://api.deepseek.com".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranslateResult {
    pub translated_text: String,
    pub from_lang: String,
    pub to_lang: String,
}

fn detect_text_language(text: &str) -> Option<&'static str> {
    let mut cjk_count = 0usize;
    let mut latin_count = 0usize;

    for ch in text.chars() {
        if ch.is_ascii_alphabetic() {
            latin_count += 1;
            continue;
        }

        let code = ch as u32;
        let is_cjk = (0x4E00..=0x9FFF).contains(&code)
            || (0x3400..=0x4DBF).contains(&code)
            || (0xF900..=0xFAFF).contains(&code)
            || (0x3040..=0x30FF).contains(&code)
            || (0xAC00..=0xD7AF).contains(&code);

        if is_cjk {
            cjk_count += 1;
        }
    }

    if cjk_count == 0 && latin_count == 0 {
        return None;
    }

    if cjk_count >= latin_count {
        Some("zh")
    } else {
        Some("en")
    }
}

fn resolve_translation_direction(
    text: &str,
    from: &str,
    to: &str,
    auto_detect_language: bool,
) -> (String, String) {
    let mut actual_from = from.to_string();
    let mut actual_to = to.to_string();

    if auto_detect_language && from == "auto" {
        if let Some(detected_lang) = detect_text_language(text) {
            actual_from = detected_lang.to_string();

            if actual_to == detected_lang {
                actual_to = match detected_lang {
                    "zh" => "en".to_string(),
                    "en" => "zh".to_string(),
                    _ => actual_to,
                };
            }
        }
    }

    (actual_from, actual_to)
}

// ============ 百度翻译 ============

#[derive(Debug, Deserialize)]
struct BaiduTranslateResponse {
    trans_result: Vec<BaiduTransItem>,
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
struct BaiduTransItem {
    #[allow(dead_code)]
    src: String,
    dst: String,
}

#[derive(Debug, Deserialize)]
struct BaiduErrorResponse {
    error_code: Option<String>,
    error_msg: Option<String>,
}

// 将标准语言代码转换为百度翻译的语言代码
fn map_to_baidu_lang(lang: &str) -> &str {
    match lang {
        "auto" => "auto",
        "zh" => "zh",
        "en" => "en",
        "ja" => "jp",  // 日语
        "ko" => "kor", // 韩语
        "fr" => "fra", // 法语
        "de" => "de",  // 德语
        "es" => "spa", // 西班牙语
        "ru" => "ru",  // 俄语
        "ar" => "ara", // 阿拉伯语
        "pt" => "pt",  // 葡萄牙语
        "it" => "it",  // 意大利语
        "th" => "th",  // 泰语
        "vi" => "vie", // 越南语
        "id" => "id",  // 印尼语
        "ms" => "may", // 马来语
        "hi" => "hi",  // 印地语
        "tr" => "tr",  // 土耳其语
        "nl" => "nl",  // 荷兰语
        "pl" => "pl",  // 波兰语
        "sv" => "swe", // 瑞典语
        "da" => "dan", // 丹麦语
        "fi" => "fin", // 芬兰语
        "no" => "nor", // 挪威语
        "cs" => "cs",  // 捷克语
        "ro" => "rom", // 罗马尼亚语
        "el" => "el",  // 希腊语
        "hu" => "hu",  // 匈牙利语
        "bg" => "bul", // 保加利亚语
        "uk" => "ukr", // 乌克兰语
        "he" => "heb", // 希伯来语
        "fa" => "per", // 波斯语
        _ => lang,     // 未知语言代码保持原样
    }
}

// 将百度翻译的语言代码转换回标准代码
fn map_from_baidu_lang(lang: &str) -> &str {
    match lang {
        "auto" => "auto",
        "zh" => "zh",
        "en" => "en",
        "jp" => "ja",
        "kor" => "ko",
        "fra" => "fr",
        "de" => "de",
        "spa" => "es",
        "ru" => "ru",
        "ara" => "ar",
        "pt" => "pt",
        "it" => "it",
        "th" => "th",
        "vie" => "vi",
        "id" => "id",
        "may" => "ms",
        "hi" => "hi",
        "tr" => "tr",
        "nl" => "nl",
        "pl" => "pl",
        "swe" => "sv",
        "dan" => "da",
        "fin" => "fi",
        "nor" => "no",
        "cs" => "cs",
        "rom" => "ro",
        "el" => "el",
        "hu" => "hu",
        "bul" => "bg",
        "ukr" => "uk",
        "heb" => "he",
        "per" => "fa",
        _ => lang,
    }
}

pub fn baidu_translate(
    text: &str,
    from: &str,
    to: &str,
    config: &TranslateConfig,
) -> Result<TranslateResult, String> {
    use rand::Rng;

    // 转换语言代码为百度格式
    let baidu_from = map_to_baidu_lang(from);
    let baidu_to = map_to_baidu_lang(to);

    let salt = rand::thread_rng().gen::<u32>().to_string();
    let sign_str = format!(
        "{}{}{}{}",
        config.baidu_app_id, text, salt, config.baidu_secret_key
    );
    let sign = format!("{:x}", md5::compute(sign_str));

    let url = "https://fanyi-api.baidu.com/api/trans/vip/translate";

    let mut params = HashMap::new();
    params.insert("q", text);
    params.insert("from", baidu_from);
    params.insert("to", baidu_to);
    params.insert("appid", &config.baidu_app_id);
    params.insert("salt", &salt);
    params.insert("sign", &sign);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let response = client
        .post(url)
        .form(&params)
        .send()
        .map_err(|e| format!("百度翻译请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("百度翻译失败: HTTP {}", response.status()));
    }

    // 先获取响应文本
    let response_text = response
        .text()
        .map_err(|e| format!("读取百度翻译响应失败: {}", e))?;

    // 尝试解析为错误响应
    if let Ok(error_response) = serde_json::from_str::<BaiduErrorResponse>(&response_text) {
        if let Some(error_code) = error_response.error_code {
            let error_msg = error_response
                .error_msg
                .unwrap_or_else(|| "未知错误".to_string());
            return Err(format!("百度翻译错误 [{}]: {}", error_code, error_msg));
        }
    }

    // 尝试解析为成功响应
    let result: BaiduTranslateResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("解析百度翻译结果失败: {} (响应: {})", e, response_text))?;

    let translated_text = result
        .trans_result
        .iter()
        .map(|item| item.dst.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    // 将百度的语言代码转换回标准代码
    let from_lang = map_from_baidu_lang(&result.from).to_string();
    let to_lang = map_from_baidu_lang(&result.to).to_string();

    Ok(TranslateResult {
        translated_text,
        from_lang,
        to_lang,
    })
}

// ============ 谷歌翻译 ============

#[derive(Debug, Deserialize)]
struct GoogleTranslateResponse {
    data: GoogleTranslateData,
}

#[derive(Debug, Deserialize)]
struct GoogleTranslateData {
    translations: Vec<GoogleTranslation>,
}

#[derive(Debug, Deserialize)]
struct GoogleTranslation {
    #[serde(rename = "translatedText")]
    translated_text: String,
    #[serde(rename = "detectedSourceLanguage")]
    detected_source_language: Option<String>,
}

pub fn google_translate(
    text: &str,
    from: &str,
    to: &str,
    config: &TranslateConfig,
) -> Result<TranslateResult, String> {
    let url = format!(
        "https://translation.googleapis.com/language/translate/v2?key={}",
        config.google_api_key
    );

    let mut body = serde_json::json!({
        "q": text,
        "target": to,
        "format": "text"
    });

    if from != "auto" {
        body["source"] = serde_json::json!(from);
    }

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| format!("谷歌翻译请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("谷歌翻译失败: HTTP {}", response.status()));
    }

    let result: GoogleTranslateResponse = response
        .json()
        .map_err(|e| format!("解析谷歌翻译结果失败: {}", e))?;

    let translation = result
        .data
        .translations
        .first()
        .ok_or("谷歌翻译返回空结果")?;

    let detected_lang = translation
        .detected_source_language
        .clone()
        .unwrap_or_else(|| from.to_string());

    Ok(TranslateResult {
        translated_text: translation.translated_text.clone(),
        from_lang: detected_lang,
        to_lang: to.to_string(),
    })
}

// ============ 腾讯翻译 ============

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

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

fn validate_tencent_credentials(secret_id: &str, secret_key: &str) -> Result<(), String> {
    if secret_id.is_empty() || secret_key.is_empty() {
        return Err("腾讯翻译配置错误：请先配置 Secret ID 和 Secret Key".to_string());
    }

    if secret_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(
            "腾讯翻译配置错误：Secret ID 当前看起来像腾讯云 AppID（纯数字），不是 API SecretId。请在腾讯云「访问管理 > API 密钥管理」复制 SecretId。"
                .to_string(),
        );
    }

    if secret_key.starts_with("AKID") && !secret_id.starts_with("AKID") {
        return Err(
            "腾讯翻译配置错误：Secret ID 和 Secret Key 可能填反了。SecretId 通常以 AKID 开头，SecretKey 是另一串密钥。"
                .to_string(),
        );
    }

    Ok(())
}

pub fn tencent_translate(
    text: &str,
    from: &str,
    to: &str,
    config: &TranslateConfig,
) -> Result<TranslateResult, String> {
    let service = "tmt";
    let host = "tmt.tencentcloudapi.com";
    let action = "TextTranslate";
    let version = "2018-03-21";
    let region = config.tencent_region.trim();
    let region = if region.is_empty() {
        "ap-guangzhou"
    } else {
        region
    };
    let secret_id = config.tencent_secret_id.trim();
    let secret_key = config.tencent_secret_key.trim();

    validate_tencent_credentials(secret_id, secret_key)?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();

    // 构建请求体
    let payload = serde_json::json!({
        "SourceText": text,
        "Source": from,
        "Target": to,
        "ProjectId": 0
    })
    .to_string();

    // 1. 拼接规范请求串
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

    // 2. 拼接待签名字符串
    let algorithm = "TC3-HMAC-SHA256";
    let credential_scope = format!("{}/{}/tc3_request", date, service);
    let hashed_canonical_request = sha256_hex(&canonical_request);

    let string_to_sign = format!(
        "{}\n{}\n{}\n{}",
        algorithm, timestamp, credential_scope, hashed_canonical_request
    );

    // 3. 计算签名
    let secret_date = hmac_sha256(format!("TC3{}", secret_key).as_bytes(), date.as_bytes());
    let secret_service = hmac_sha256(&secret_date, service.as_bytes());
    let secret_signing = hmac_sha256(&secret_service, b"tc3_request");
    let signature = hex::encode(hmac_sha256(&secret_signing, string_to_sign.as_bytes()));

    // 4. 拼接 Authorization
    let authorization = format!(
        "{} Credential={}/{}, SignedHeaders={}, Signature={}",
        algorithm, secret_id, credential_scope, signed_headers, signature
    );

    // 5. 发送请求
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let url = format!("https://{}", host);

    let response = client
        .post(&url)
        .header("Authorization", authorization)
        .header("Content-Type", "application/json")
        .header("Host", host)
        .header("X-TC-Action", action)
        .header("X-TC-Timestamp", timestamp.to_string())
        .header("X-TC-Version", version)
        .header("X-TC-Region", region)
        .body(payload)
        .send()
        .map_err(|e| format!("腾讯翻译请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().unwrap_or_default();
        return Err(format!("腾讯翻译失败: HTTP {} - {}", status, error_text));
    }

    let response_json: serde_json::Value = response
        .json()
        .map_err(|e| format!("解析腾讯翻译结果失败: {}", e))?;

    // 检查是否有错误
    let response_body = response_json
        .get("Response")
        .ok_or("腾讯翻译返回缺少 Response 字段")?;

    if let Some(error) = response_body.get("Error") {
        let error_code = error.get("Code").and_then(|c| c.as_str()).unwrap_or("");
        let error_msg = error
            .get("Message")
            .and_then(|m| m.as_str())
            .unwrap_or("未知错误");
        let request_id = response_body.get("RequestId").and_then(|id| id.as_str());
        let mut message = if error_code.is_empty() {
            format!("腾讯翻译错误: {}", error_msg)
        } else {
            format!("腾讯翻译错误 [{}]: {}", error_code, error_msg)
        };
        if let Some(request_id) = request_id {
            message.push_str(&format!(" (RequestId: {})", request_id));
        }
        return Err(message);
    }

    // 解析翻译结果
    let translated_text = response_body
        .get("TargetText")
        .and_then(|t| t.as_str())
        .ok_or("无法解析翻译结果")?
        .to_string();

    let source_lang = response_body
        .get("Source")
        .and_then(|s| s.as_str())
        .unwrap_or(from)
        .to_string();

    let target_lang = response_body
        .get("Target")
        .and_then(|s| s.as_str())
        .unwrap_or(to)
        .to_string();

    Ok(TranslateResult {
        translated_text,
        from_lang: source_lang,
        to_lang: target_lang,
    })
}

// ============ ChatGPT 翻译 ============

#[derive(Debug, Deserialize)]
struct ChatGPTResponse {
    choices: Vec<ChatGPTChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatGPTChoice {
    message: ChatGPTMessage,
}

#[derive(Debug, Deserialize)]
struct ChatGPTMessage {
    content: String,
}

fn lang_name(code: &str) -> &str {
    match code {
        "zh" | "zh-CN" => "Chinese",
        "en" => "English",
        "ja" => "Japanese",
        "ko" => "Korean",
        "fr" => "French",
        "de" => "German",
        "es" => "Spanish",
        "ru" => "Russian",
        "ar" => "Arabic",
        "pt" => "Portuguese",
        "it" => "Italian",
        _ => "English",
    }
}

fn openai_chat_completions_url(base_url: &str) -> String {
    let normalized = if base_url.trim().is_empty() {
        "https://api.openai.com".to_string()
    } else {
        base_url.trim().trim_end_matches('/').to_string()
    };

    if normalized.ends_with("/chat/completions") {
        return normalized;
    }

    let path = normalized
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(normalized.as_str())
        .split_once('/')
        .map(|(_, path)| path)
        .unwrap_or("");
    let has_v1_segment = path.split('/').any(|segment| segment == "v1");

    if has_v1_segment {
        format!("{}/chat/completions", normalized)
    } else {
        format!("{}/v1/chat/completions", normalized)
    }
}

pub fn chatgpt_translate(
    text: &str,
    from: &str,
    to: &str,
    config: &TranslateConfig,
) -> Result<TranslateResult, String> {
    openai_compatible_translate(
        text,
        from,
        to,
        &config.openai_api_key,
        &config.openai_model,
        &config.openai_base_url,
        "ChatGPT",
    )
}

fn openai_compatible_translate(
    text: &str,
    from: &str,
    to: &str,
    api_key: &str,
    model: &str,
    base_url: &str,
    service_name: &str,
) -> Result<TranslateResult, String> {
    if api_key.trim().is_empty() {
        return Err(format!("{} API Key 不能为空", service_name));
    }
    if model.trim().is_empty() {
        return Err(format!("{} 模型不能为空", service_name));
    }

    let url = openai_chat_completions_url(base_url);

    let from_lang_name = if from == "auto" {
        "the source language"
    } else {
        lang_name(from)
    };
    let to_lang_name = lang_name(to);

    let system_prompt = format!(
        "You are a professional translator. Translate the following text from {} to {}. Only return the translated text, no explanations or additional content.",
        from_lang_name, to_lang_name
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text}
        ],
        "temperature": 0.3
    });

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("{} 翻译请求失败: {}", service_name, e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().unwrap_or_default();
        return Err(format!(
            "{} 翻译失败: HTTP {} - {}",
            service_name, status, error_text
        ));
    }

    let result: ChatGPTResponse = response
        .json()
        .map_err(|e| format!("解析 {} 翻译结果失败: {}", service_name, e))?;

    let translated_text = result
        .choices
        .first()
        .ok_or_else(|| format!("{} 返回空结果", service_name))?
        .message
        .content
        .trim()
        .to_string();

    Ok(TranslateResult {
        translated_text,
        from_lang: from.to_string(),
        to_lang: to.to_string(),
    })
}

// ============ Gemini 翻译 ============

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiContent,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: String,
}

pub fn gemini_translate(
    text: &str,
    from: &str,
    to: &str,
    config: &TranslateConfig,
) -> Result<TranslateResult, String> {
    let model = if config.gemini_model.is_empty() {
        "gemini-pro"
    } else {
        &config.gemini_model
    };

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, config.gemini_api_key
    );

    let from_lang_name = if from == "auto" {
        "the source language"
    } else {
        lang_name(from)
    };
    let to_lang_name = lang_name(to);

    let prompt = format!(
        "You are a professional translator. Translate the following text from {} to {}.\nRules:\n- Output ONLY the translated text\n- Do NOT include the original text\n- Do NOT add explanations or notes\n- Preserve formatting\n\nText to translate:\n{}",
        from_lang_name, to_lang_name, text
    );

    let body = serde_json::json!({
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "temperature": 0.3
        }
    });

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Gemini翻译请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().unwrap_or_default();
        return Err(format!("Gemini翻译失败: HTTP {} - {}", status, error_text));
    }

    let result: GeminiResponse = response
        .json()
        .map_err(|e| format!("解析Gemini翻译结果失败: {}", e))?;

    let translated_text = result
        .candidates
        .first()
        .and_then(|c| c.content.parts.first())
        .ok_or("Gemini返回空结果")?
        .text
        .trim()
        // 去掉可能的 markdown 代码块包裹
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    // 如果翻译结果和原文完全相同（忽略空白），说明翻译可能失败
    // 但只在目标语言和源语言明确不同时才报错
    if from != "auto" && from != to && translated_text.trim() == text.trim() {
        return Err(format!(
            "Gemini翻译失败：返回内容与原文相同，请检查API配置或语言设置"
        ));
    }

    Ok(TranslateResult {
        translated_text,
        from_lang: from.to_string(),
        to_lang: to.to_string(),
    })
}

// ============ 必应翻译 ============

#[derive(Debug, Deserialize)]
struct BingTranslateItem {
    translations: Vec<BingTranslation>,
}

#[derive(Debug, Deserialize)]
struct BingTranslation {
    text: String,
    to: String,
}

pub fn bing_translate(
    text: &str,
    from: &str,
    to: &str,
    config: &TranslateConfig,
) -> Result<TranslateResult, String> {
    let from_param = if from == "auto" { "" } else { from };
    let url = format!(
        "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from={}&to={}",
        from_param, to
    );

    let body = serde_json::json!([{"text": text}]);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let response = client
        .post(&url)
        .header("Ocp-Apim-Subscription-Key", &config.bing_api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("必应翻译请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().unwrap_or_default();
        return Err(format!("必应翻译失败: HTTP {} - {}", status, error_text));
    }

    let result: Vec<BingTranslateItem> = response
        .json()
        .map_err(|e| format!("解析必应翻译结果失败: {}", e))?;

    let item = result.first().ok_or("必应翻译返回空结果")?;
    let translation = item.translations.first().ok_or("必应翻译返回空翻译")?;

    Ok(TranslateResult {
        translated_text: translation.text.clone(),
        from_lang: from.to_string(),
        to_lang: translation.to.clone(),
    })
}

// ============ 统一翻译接口 ============

pub fn translate(
    text: &str,
    from: &str,
    to: &str,
    provider: &str,
    auto_detect_language: bool,
    config: &TranslateConfig,
) -> Result<TranslateResult, String> {
    let (actual_from, actual_to) =
        resolve_translation_direction(text, from, to, auto_detect_language);

    match provider {
        "baidu" => baidu_translate(text, &actual_from, &actual_to, config),
        "google" => google_translate(text, &actual_from, &actual_to, config),
        "bing" => bing_translate(text, &actual_from, &actual_to, config),
        "tencent" => tencent_translate(text, &actual_from, &actual_to, config),
        "chatgpt" => chatgpt_translate(text, &actual_from, &actual_to, config),
        "openai-compatible" => {
            let service_name = if config.openai_compatible_name.trim().is_empty() {
                "OpenAI 兼容 API"
            } else {
                config.openai_compatible_name.trim()
            };
            openai_compatible_translate(
                text,
                &actual_from,
                &actual_to,
                &config.openai_compatible_api_key,
                &config.openai_compatible_model,
                &config.openai_compatible_base_url,
                service_name,
            )
        }
        "deepseek" => openai_compatible_translate(
            text,
            &actual_from,
            &actual_to,
            &config.deepseek_api_key,
            &config.deepseek_model,
            &config.deepseek_base_url,
            "DeepSeek",
        ),
        "gemini" => gemini_translate(text, &actual_from, &actual_to, config),
        _ => Err(format!("不支持的翻译服务: {}", provider)),
    }
}
