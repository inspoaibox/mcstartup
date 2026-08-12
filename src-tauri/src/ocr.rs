use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::{c_char, CString};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OcrConfig {
    #[serde(rename = "baiduApiKey")]
    pub baidu_api_key: String,
    #[serde(rename = "baiduSecretKey")]
    pub baidu_secret_key: String,
    #[serde(rename = "baiduHighAccuracy")]
    pub baidu_high_accuracy: bool,
    #[serde(rename = "googleApiKey")]
    pub google_api_key: String,
    #[serde(rename = "tencentSecretId")]
    pub tencent_secret_id: String,
    #[serde(rename = "tencentSecretKey")]
    pub tencent_secret_key: String,
    #[serde(rename = "tencentRegion")]
    pub tencent_region: String,
    #[serde(rename = "aliyunAccessKeyId", default)]
    pub aliyun_access_key_id: String,
    #[serde(rename = "aliyunAccessKeySecret", default)]
    pub aliyun_access_key_secret: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OcrResult {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<WordResult>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_blocks: Option<Vec<TextBlock>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TextBlock {
    pub text: String,
    pub location: BoundingBox,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BoundingBox {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WordResult {
    pub text: String,
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WechatOcrEnvironment {
    pub available: bool,
    pub message: String,
    pub install_dir: String,
    pub runtime_dir: String,
    pub ocr_archive: String,
    pub cached_dir: String,
    pub wxocr_path: String,
    pub bridge_path: String,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone)]
struct WechatOcrResolvedEnvironment {
    install_dir: PathBuf,
    runtime_dir: PathBuf,
    wxocr_path: PathBuf,
    bridge_path: Option<PathBuf>,
    missing: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct WechatOcrBridgeResponse {
    #[serde(default)]
    errcode: i32,
    #[serde(default)]
    ocr_response: Vec<WechatOcrBridgeBlock>,
}

#[derive(Debug, Deserialize)]
struct WechatOcrBridgeBlock {
    #[serde(default)]
    text: String,
    #[serde(default)]
    left: f64,
    #[serde(default)]
    top: f64,
    #[serde(default)]
    right: f64,
    #[serde(default)]
    bottom: f64,
    #[serde(default)]
    rate: f64,
}

struct WechatOcrBridge {
    _library: libloading::Library,
    wechat_ocr:
        unsafe extern "C" fn(*const u16, *const u16, *const c_char, WechatOcrCallback) -> bool,
    stop_ocr: unsafe extern "C" fn(),
}

type WechatOcrCallback = extern "C" fn(*const c_char);

fn wechat_ocr_bridge_state() -> &'static Mutex<Option<WechatOcrBridge>> {
    static STATE: OnceLock<Mutex<Option<WechatOcrBridge>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(None))
}

fn wechat_ocr_callback_result() -> &'static Mutex<String> {
    static RESULT: OnceLock<Mutex<String>> = OnceLock::new();
    RESULT.get_or_init(|| Mutex::new(String::new()))
}

// 表格识别结果
#[derive(Debug, Serialize, Deserialize)]
pub struct TableResult {
    pub html: String,
    pub markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Vec<String>>>,
}

// ============ 百度 OCR ============

#[derive(Debug, Deserialize)]
struct BaiduTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct BaiduOcrResponse {
    words_result: Vec<BaiduWord>,
}

#[derive(Debug, Deserialize)]
struct BaiduWord {
    words: String,
    #[serde(default)]
    location: Option<BaiduLocation>,
}

#[derive(Debug, Deserialize)]
struct BaiduLocation {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

pub fn baidu_ocr(image_base64: &str, config: &OcrConfig) -> Result<OcrResult, String> {
    // 1. 获取 access_token
    let token_url = format!(
        "https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id={}&client_secret={}",
        config.baidu_api_key, config.baidu_secret_key
    );

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let token_response = client
        .get(&token_url)
        .send()
        .map_err(|e| format!("获取access_token失败: {}", e))?;

    if !token_response.status().is_success() {
        return Err(format!(
            "获取access_token失败: HTTP {}",
            token_response.status()
        ));
    }

    let token_data: BaiduTokenResponse = token_response
        .json()
        .map_err(|e| format!("解析access_token失败: {}", e))?;

    // 2. 调用 OCR API（使用返回位置信息的接口）
    let ocr_url = if config.baidu_high_accuracy {
        format!(
            "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate?access_token={}",
            token_data.access_token
        )
    } else {
        format!(
            "https://aip.baidubce.com/rest/2.0/ocr/v1/general?access_token={}",
            token_data.access_token
        )
    };

    let mut params = HashMap::new();
    params.insert("image", image_base64);
    params.insert("recognize_granularity", "big"); // 返回文本块位置

    let ocr_response = client
        .post(&ocr_url)
        .form(&params)
        .send()
        .map_err(|e| format!("OCR识别请求失败: {}", e))?;

    if !ocr_response.status().is_success() {
        return Err(format!("OCR识别失败: HTTP {}", ocr_response.status()));
    }

    let ocr_data: BaiduOcrResponse = ocr_response
        .json()
        .map_err(|e| format!("解析OCR结果失败: {}", e))?;

    // 3. 解析结果
    let text = ocr_data
        .words_result
        .iter()
        .map(|w| w.words.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    // 4. 提取文本块位置信息
    let text_blocks: Vec<TextBlock> = ocr_data
        .words_result
        .iter()
        .filter_map(|w| {
            w.location.as_ref().map(|loc| TextBlock {
                text: w.words.clone(),
                location: BoundingBox {
                    left: loc.left,
                    top: loc.top,
                    width: loc.width,
                    height: loc.height,
                },
            })
        })
        .collect();

    Ok(OcrResult {
        text,
        confidence: None,
        words: None,
        text_blocks: if text_blocks.is_empty() {
            None
        } else {
            Some(text_blocks)
        },
    })
}

// ============ Google OCR ============

#[derive(Debug, Deserialize)]
struct GoogleVisionResponse {
    responses: Vec<GoogleAnnotation>,
}

#[derive(Debug, Deserialize)]
struct GoogleAnnotation {
    #[serde(rename = "textAnnotations")]
    text_annotations: Option<Vec<GoogleTextAnnotation>>,
    #[serde(rename = "fullTextAnnotation")]
    full_text_annotation: Option<GoogleFullText>,
}

#[derive(Debug, Deserialize)]
struct GoogleTextAnnotation {
    description: String,
    #[serde(rename = "boundingPoly")]
    bounding_poly: Option<GoogleBoundingPoly>,
}

#[derive(Debug, Deserialize)]
struct GoogleBoundingPoly {
    vertices: Vec<GoogleVertex>,
}

#[derive(Debug, Deserialize)]
struct GoogleVertex {
    x: Option<i32>,
    y: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct GoogleFullText {
    text: String,
}

pub fn google_ocr(image_base64: &str, config: &OcrConfig) -> Result<OcrResult, String> {
    let url = format!(
        "https://vision.googleapis.com/v1/images:annotate?key={}",
        config.google_api_key
    );

    let request_body = serde_json::json!({
        "requests": [{
            "image": {
                "content": image_base64
            },
            "features": [{
                "type": "TEXT_DETECTION"
            }]
        }]
    });

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .map_err(|e| format!("Google OCR请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Google OCR失败: HTTP {}", response.status()));
    }

    let vision_response: GoogleVisionResponse = response
        .json()
        .map_err(|e| format!("解析Google OCR结果失败: {}", e))?;

    let first_response = vision_response
        .responses
        .first()
        .ok_or("Google OCR返回空结果")?;

    // 获取完整文本
    let text = first_response
        .full_text_annotation
        .as_ref()
        .map(|f| f.text.clone())
        .unwrap_or_default();

    // 提取文本块位置信息（跳过第一个，因为第一个是整体文本）
    let text_blocks: Vec<TextBlock> = first_response
        .text_annotations
        .as_ref()
        .map(|annotations| {
            annotations
                .iter()
                .skip(1) // 跳过第一个整体文本
                .filter_map(|annotation| {
                    annotation.bounding_poly.as_ref().and_then(|poly| {
                        if poly.vertices.len() >= 2 {
                            // 计算边界框
                            let xs: Vec<i32> = poly.vertices.iter().filter_map(|v| v.x).collect();
                            let ys: Vec<i32> = poly.vertices.iter().filter_map(|v| v.y).collect();

                            if !xs.is_empty() && !ys.is_empty() {
                                let left = *xs.iter().min().unwrap();
                                let top = *ys.iter().min().unwrap();
                                let right = *xs.iter().max().unwrap();
                                let bottom = *ys.iter().max().unwrap();

                                return Some(TextBlock {
                                    text: annotation.description.clone(),
                                    location: BoundingBox {
                                        left,
                                        top,
                                        width: right - left,
                                        height: bottom - top,
                                    },
                                });
                            }
                        }
                        None
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(OcrResult {
        text,
        confidence: None,
        words: None,
        text_blocks: if text_blocks.is_empty() {
            None
        } else {
            Some(text_blocks)
        },
    })
}

// ============ 腾讯 OCR ============

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

#[derive(Debug, Deserialize)]
struct TencentOcrResponse {
    #[serde(rename = "Response")]
    response: TencentOcrResponseData,
}

#[derive(Debug, Deserialize)]
struct TencentOcrResponseData {
    #[serde(rename = "TextDetections")]
    text_detections: Option<Vec<TencentTextDetection>>,
    #[serde(rename = "Error")]
    error: Option<TencentError>,
}

#[derive(Debug, Deserialize)]
struct TencentTextDetection {
    #[serde(rename = "DetectedText")]
    detected_text: String,
    #[serde(rename = "ItemPolygon")]
    item_polygon: Option<TencentPolygon>,
}

#[derive(Debug, Deserialize)]
struct TencentPolygon {
    #[serde(rename = "X")]
    x: i32,
    #[serde(rename = "Y")]
    y: i32,
    #[serde(rename = "Width")]
    width: i32,
    #[serde(rename = "Height")]
    height: i32,
}

#[derive(Debug, Deserialize)]
struct TencentError {
    #[serde(rename = "Message")]
    message: String,
}

pub fn tencent_ocr(image_base64: &str, config: &OcrConfig) -> Result<OcrResult, String> {
    let service = "ocr";
    let host = "ocr.tencentcloudapi.com";
    let action = "GeneralBasicOCR";
    let version = "2018-11-19";
    let region = &config.tencent_region;

    // 获取当前时间戳
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();

    // 构建请求体
    let payload = serde_json::json!({
        "ImageBase64": image_base64
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
    let secret_date = hmac_sha256(
        format!("TC3{}", config.tencent_secret_key).as_bytes(),
        date.as_bytes(),
    );
    let secret_service = hmac_sha256(&secret_date, service.as_bytes());
    let secret_signing = hmac_sha256(&secret_service, b"tc3_request");
    let signature = hex::encode(hmac_sha256(&secret_signing, string_to_sign.as_bytes()));

    // 4. 拼接 Authorization
    let authorization = format!(
        "{} Credential={}/{}, SignedHeaders={}, Signature={}",
        algorithm, config.tencent_secret_id, credential_scope, signed_headers, signature
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
        .map_err(|e| format!("腾讯OCR请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().unwrap_or_default();
        return Err(format!("腾讯OCR失败: HTTP {} - {}", status, error_text));
    }

    let response_data: TencentOcrResponse = response
        .json()
        .map_err(|e| format!("解析腾讯OCR结果失败: {}", e))?;

    // 检查是否有错误
    if let Some(error) = response_data.response.error {
        return Err(format!("腾讯OCR错误: {}", error.message));
    }

    // 解析文本结果
    let text_detections = response_data
        .response
        .text_detections
        .ok_or("无法解析OCR结果")?;

    let text = text_detections
        .iter()
        .map(|item| item.detected_text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    // 提取文本块位置信息
    let text_blocks: Vec<TextBlock> = text_detections
        .iter()
        .filter_map(|item| {
            item.item_polygon.as_ref().map(|polygon| TextBlock {
                text: item.detected_text.clone(),
                location: BoundingBox {
                    left: polygon.x,
                    top: polygon.y,
                    width: polygon.width,
                    height: polygon.height,
                },
            })
        })
        .collect();

    Ok(OcrResult {
        text,
        confidence: None,
        words: None,
        text_blocks: if text_blocks.is_empty() {
            None
        } else {
            Some(text_blocks)
        },
    })
}

// ============ 二维码识别 ============

// 快速检测图片是否包含二维码（不做完整识别，只检测特征）
pub fn has_qrcode(image_base64: &str) -> bool {
    use base64::engine::general_purpose;
    use base64::Engine;

    // 解码 base64
    let image_data = match general_purpose::STANDARD.decode(image_base64) {
        Ok(data) => data,
        Err(_) => return false,
    };

    // 加载图片
    let img = match image::load_from_memory(&image_data) {
        Ok(img) => img,
        Err(_) => return false,
    };

    // 转换为灰度图
    let gray_img = img.to_luma8();

    // 使用 rqrr 快速检测二维码网格（不解码内容）
    use rqrr::PreparedImage;
    let mut prepared = PreparedImage::prepare(gray_img);
    let grids = prepared.detect_grids();

    // 如果检测到至少一个二维码网格，返回 true
    !grids.is_empty()
}

pub fn recognize_qrcode(image_base64: &str) -> Result<String, String> {
    use base64::engine::general_purpose;
    use base64::Engine;
    use image::imageops;

    // 解码 base64
    let image_data = general_purpose::STANDARD
        .decode(image_base64)
        .map_err(|e| format!("Base64解码失败: {}", e))?;

    // 加载图片
    let img = image::load_from_memory(&image_data).map_err(|e| format!("加载图片失败: {}", e))?;

    // 转换为灰度图
    let mut gray_img = img.to_luma8();

    // 尝试多种策略识别二维码

    // 策略1: 直接识别原图
    if let Ok(content) = try_recognize_qrcode(&gray_img) {
        return Ok(content);
    }

    // 策略2: 放大图片（对小二维码有效）
    let enlarged = imageops::resize(
        &gray_img,
        gray_img.width() * 2,
        gray_img.height() * 2,
        imageops::FilterType::Lanczos3,
    );
    if let Ok(content) = try_recognize_qrcode(&enlarged) {
        return Ok(content);
    }

    // 策略3: 增强对比度
    enhance_contrast(&mut gray_img);
    if let Ok(content) = try_recognize_qrcode(&gray_img) {
        return Ok(content);
    }

    // 策略4: 放大 + 增强对比度
    let mut enlarged_enhanced = imageops::resize(
        &gray_img,
        gray_img.width() * 2,
        gray_img.height() * 2,
        imageops::FilterType::Lanczos3,
    );
    enhance_contrast(&mut enlarged_enhanced);
    if let Ok(content) = try_recognize_qrcode(&enlarged_enhanced) {
        return Ok(content);
    }

    // 策略5: 更大倍数放大（针对特别小的二维码）
    let super_enlarged = imageops::resize(
        &gray_img,
        gray_img.width() * 3,
        gray_img.height() * 3,
        imageops::FilterType::Lanczos3,
    );
    if let Ok(content) = try_recognize_qrcode(&super_enlarged) {
        return Ok(content);
    }

    Err("未检测到二维码，请尝试使用更清晰或更大的图片".to_string())
}

// 尝试识别二维码
fn try_recognize_qrcode(gray_img: &image::GrayImage) -> Result<String, String> {
    use rqrr::PreparedImage;

    let mut prepared = PreparedImage::prepare(gray_img.clone());
    let grids = prepared.detect_grids();

    if let Some(grid) = grids.first() {
        let (_meta, content): (rqrr::MetaData, String) = grid
            .decode()
            .map_err(|e| format!("解码二维码失败: {:?}", e))?;
        Ok(content)
    } else {
        Err("未检测到二维码".to_string())
    }
}

// 增强对比度
fn enhance_contrast(img: &mut image::GrayImage) {
    // 计算直方图
    let mut histogram = [0u32; 256];
    for pixel in img.pixels() {
        histogram[pixel[0] as usize] += 1;
    }

    // 找到最小和最大亮度值（忽略极端值）
    let total_pixels = (img.width() * img.height()) as u32;
    let threshold = total_pixels / 100; // 忽略1%的极端值

    let mut min_val = 0u8;
    let mut max_val = 255u8;
    let mut count = 0u32;

    for (i, &h) in histogram.iter().enumerate() {
        count += h;
        if count > threshold && min_val == 0 {
            min_val = i as u8;
        }
        if count > total_pixels - threshold {
            max_val = i as u8;
            break;
        }
    }

    // 拉伸对比度
    if max_val > min_val {
        let range = (max_val - min_val) as f32;
        for pixel in img.pixels_mut() {
            let val = pixel[0];
            let normalized = if val <= min_val {
                0
            } else if val >= max_val {
                255
            } else {
                (((val - min_val) as f32 / range) * 255.0) as u8
            };
            pixel[0] = normalized;
        }
    }
}

// ============ 截图功能 ============

pub fn capture_screenshot() -> Result<String, String> {
    use base64::engine::general_purpose;
    use base64::Engine;
    use std::io::Read;
    use std::process::Command;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Windows: 使用 PowerShell 截图
        let temp_path = std::env::temp_dir().join("screenshot_temp.png");
        let temp_path_str = temp_path.to_string_lossy().to_string();

        // PowerShell 脚本：截取全屏
        let ps_script = format!(
            r#"
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            
            $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
            $bitmap.Save('{}', [System.Drawing.Imaging.ImageFormat]::Png)
            $graphics.Dispose()
            $bitmap.Dispose()
            "#,
            temp_path_str.replace("\\", "\\\\")
        );

        // 执行 PowerShell 命令（隐藏窗口）
        let output = Command::new("powershell")
            .creation_flags(CREATE_NO_WINDOW)
            .args(&[
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &ps_script,
            ])
            .output()
            .map_err(|e| format!("执行截图命令失败: {}", e))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(format!("截图失败: {}", error));
        }

        // 读取截图文件
        let mut file =
            std::fs::File::open(&temp_path).map_err(|e| format!("打开截图文件失败: {}", e))?;

        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)
            .map_err(|e| format!("读取截图文件失败: {}", e))?;

        // 删除临时文件
        let _ = std::fs::remove_file(&temp_path);

        // 转换为 base64
        let base64_str = general_purpose::STANDARD.encode(&buffer);
        Ok(base64_str)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前系统不支持截图功能".to_string())
    }
}

// 区域截图 - 先截全屏再裁剪
pub fn capture_screenshot_region(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<String, String> {
    use base64::engine::general_purpose;
    use base64::Engine;

    println!(
        "Capturing region: x={}, y={}, width={}, height={}",
        x, y, width, height
    );

    // 1. 先截取全屏
    let full_screenshot_base64 = capture_screenshot()?;

    // 2. 解码 base64
    let image_data = general_purpose::STANDARD
        .decode(&full_screenshot_base64)
        .map_err(|e| format!("Base64解码失败: {}", e))?;

    // 3. 加载图片
    let img = image::load_from_memory(&image_data).map_err(|e| format!("加载图片失败: {}", e))?;

    println!("Full screenshot size: {}x{}", img.width(), img.height());

    // 4. 裁剪指定区域
    let cropped = img.crop_imm(x as u32, y as u32, width as u32, height as u32);

    println!(
        "Cropped image size: {}x{}",
        cropped.width(),
        cropped.height()
    );

    // 5. 转换为 PNG 字节
    let mut png_bytes: Vec<u8> = Vec::new();
    cropped
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| format!("转换PNG失败: {}", e))?;

    // 6. 转换为 base64
    let base64_str = general_purpose::STANDARD.encode(&png_bytes);

    println!("Region screenshot base64 length: {}", base64_str.len());

    Ok(base64_str)
}

// ============ 统一 OCR 识别接口 ============

/// 统一的 OCR 识别函数，根据 provider 调用对应的 OCR 服务
pub fn recognize(
    image_base64: &str,
    provider: &str,
    config: &OcrConfig,
) -> Result<OcrResult, String> {
    match provider {
        "baidu" => baidu_ocr(image_base64, config),
        "google" => google_ocr(image_base64, config),
        "tencent" => tencent_ocr(image_base64, config),
        "aliyun" => aliyun_ocr(image_base64, config),
        "wechat" => wechat_ocr(image_base64, config),
        "paddle" => crate::paddle_ocr::recognize(image_base64),
        "wps" => crate::wps_ocr::recognize(image_base64),
        _ => Err(format!("不支持的OCR服务商: {}", provider)),
    }
}

// ============ 阿里云 OCR ============

use sha1::Sha1;
type HmacSha1 = Hmac<Sha1>;

fn aliyun_signature(access_key_secret: &str, string_to_sign: &str) -> String {
    use base64::engine::general_purpose;
    use base64::Engine;

    let mut mac = HmacSha1::new_from_slice(access_key_secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(string_to_sign.as_bytes());
    let result = mac.finalize();
    general_purpose::STANDARD.encode(result.into_bytes())
}

fn percent_encode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

pub fn aliyun_ocr(image_base64: &str, config: &OcrConfig) -> Result<OcrResult, String> {
    use chrono::Utc;

    let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let nonce = uuid::Uuid::new_v4().to_string();

    // 构建请求参数（用于签名）
    let mut params = std::collections::BTreeMap::new();
    params.insert(
        "AccessKeyId".to_string(),
        config.aliyun_access_key_id.clone(),
    );
    params.insert("Action".to_string(), "RecognizeAllText".to_string());
    params.insert("Format".to_string(), "JSON".to_string());
    params.insert("SignatureMethod".to_string(), "HMAC-SHA1".to_string());
    params.insert("SignatureNonce".to_string(), nonce.clone());
    params.insert("SignatureVersion".to_string(), "1.0".to_string());
    params.insert("Timestamp".to_string(), timestamp.clone());
    params.insert("Version".to_string(), "2021-07-07".to_string());

    // 构建规范化查询字符串（不包含 body）
    let canonical_query_string: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    // 构建待签名字符串
    let string_to_sign = format!(
        "POST&{}&{}",
        percent_encode("/"),
        percent_encode(&canonical_query_string)
    );

    // 计算签名
    let signature = aliyun_signature(
        &format!("{}&", config.aliyun_access_key_secret),
        &string_to_sign,
    );

    // 构建最终 URL
    let url = format!(
        "https://ocr-api.cn-hangzhou.aliyuncs.com/?{}&Signature={}",
        canonical_query_string,
        percent_encode(&signature)
    );

    // 构建 POST body
    let body_json = serde_json::json!({
        "url": format!("data:image/png;base64,{}", image_base64),
        "type": "General"
    });

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body_json)
        .send()
        .map_err(|e| format!("阿里云OCR请求失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().unwrap_or_default();
        return Err(format!("阿里云OCR失败: {}", error_text));
    }

    let response_json: serde_json::Value = response
        .json()
        .map_err(|e| format!("解析阿里云OCR结果失败: {}", e))?;

    // 提取文本内容
    let text = response_json
        .get("Data")
        .and_then(|d| d.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    Ok(OcrResult {
        text,
        confidence: None,
        words: None,
        text_blocks: None,
    })
}

// 从 base64 图片中裁剪指定区域
pub fn crop_image_region(
    image_base64: &str,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<String, String> {
    use base64::engine::general_purpose;
    use base64::Engine;

    println!(
        "Cropping region from base64 image: x={}, y={}, width={}, height={}",
        x, y, width, height
    );

    // 解码 base64 图片
    let image_data = general_purpose::STANDARD
        .decode(image_base64)
        .map_err(|e| format!("解码 base64 失败: {}", e))?;

    // 加载图片
    let img = image::load_from_memory(&image_data).map_err(|e| format!("加载图片失败: {}", e))?;

    println!("Original image size: {}x{}", img.width(), img.height());

    // 裁剪指定区域
    let cropped = img.crop_imm(x as u32, y as u32, width as u32, height as u32);

    println!(
        "Cropped image size: {}x{}",
        cropped.width(),
        cropped.height()
    );

    // 转换为 PNG 字节
    let mut png_bytes: Vec<u8> = Vec::new();
    cropped
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| format!("转换PNG失败: {}", e))?;

    // 转换为 base64
    let base64_str = general_purpose::STANDARD.encode(&png_bytes);

    println!("Cropped image base64 length: {}", base64_str.len());

    Ok(base64_str)
}

// ============ 表格识别 ============

/// 统一的表格识别函数
pub fn recognize_table(
    image_base64: &str,
    provider: &str,
    config: &OcrConfig,
) -> Result<TableResult, String> {
    match provider {
        "baidu" => baidu_table_ocr(image_base64, config),
        "tencent" => tencent_table_ocr(image_base64, config),
        _ => Err(format!("该服务商不支持表格识别: {}", provider)),
    }
}

// 百度表格识别
pub fn baidu_table_ocr(image_base64: &str, config: &OcrConfig) -> Result<TableResult, String> {
    // 1. 获取 access_token
    let token_url = format!(
        "https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id={}&client_secret={}",
        config.baidu_api_key, config.baidu_secret_key
    );

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let token_response = client
        .get(&token_url)
        .send()
        .map_err(|e| format!("获取access_token失败: {}", e))?;

    if !token_response.status().is_success() {
        return Err(format!(
            "获取access_token失败: HTTP {}",
            token_response.status()
        ));
    }

    let token_data: BaiduTokenResponse = token_response
        .json()
        .map_err(|e| format!("解析access_token失败: {}", e))?;

    // 2. 调用表格识别 API
    let ocr_url = format!(
        "https://aip.baidubce.com/rest/2.0/ocr/v1/table?access_token={}",
        token_data.access_token
    );

    let mut params = HashMap::new();
    params.insert("image", image_base64);

    let ocr_response = client
        .post(&ocr_url)
        .form(&params)
        .send()
        .map_err(|e| format!("表格识别请求失败: {}", e))?;

    if !ocr_response.status().is_success() {
        return Err(format!("表格识别失败: HTTP {}", ocr_response.status()));
    }

    let response_json: serde_json::Value = ocr_response
        .json()
        .map_err(|e| format!("解析表格识别结果失败: {}", e))?;

    // 检查是否有错误
    if let Some(error_code) = response_json.get("error_code") {
        let error_msg = response_json
            .get("error_msg")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        return Err(format!("百度表格识别错误 {}: {}", error_code, error_msg));
    }

    // 解析表格数据
    let tables_result = response_json
        .get("tables_result")
        .and_then(|t| t.as_array())
        .ok_or("无法解析表格数据")?;

    if tables_result.is_empty() {
        return Err("未检测到表格".to_string());
    }

    let mut markdown = String::new();

    for (table_idx, table) in tables_result.iter().enumerate() {
        if table_idx > 0 {
            markdown.push_str("\n\n");
        }

        let body = table
            .get("body")
            .and_then(|b| b.as_array())
            .ok_or("无法解析表格内容")?;

        if body.is_empty() {
            continue;
        }

        // 构建表格结构
        let mut rows: Vec<Vec<String>> = Vec::new();
        let mut max_row = 0;
        let mut max_col = 0;

        for cell in body {
            let row_start = cell.get("row_start").and_then(|r| r.as_i64()).unwrap_or(0) as usize;
            let col_start = cell.get("col_start").and_then(|c| c.as_i64()).unwrap_or(0) as usize;
            let words = cell
                .get("words")
                .and_then(|w| w.as_str())
                .unwrap_or("")
                .to_string();

            max_row = max_row.max(row_start + 1);
            max_col = max_col.max(col_start + 1);

            while rows.len() <= row_start {
                rows.push(Vec::new());
            }

            while rows[row_start].len() <= col_start {
                rows[row_start].push(String::new());
            }

            rows[row_start][col_start] = words;
        }

        // 确保所有行都有相同的列数
        for row in &mut rows {
            while row.len() < max_col {
                row.push(String::new());
            }
        }

        // 生成 Markdown 表格
        if !rows.is_empty() {
            // 表头
            markdown.push_str("| ");
            markdown.push_str(&rows[0].join(" | "));
            markdown.push_str(" |\n");

            // 分隔线
            markdown.push_str("|");
            for _ in 0..max_col {
                markdown.push_str(" --- |");
            }
            markdown.push('\n');

            // 数据行
            for row in rows.iter().skip(1) {
                markdown.push_str("| ");
                markdown.push_str(&row.join(" | "));
                markdown.push_str(" |\n");
            }
        }
    }

    Ok(TableResult {
        html: String::new(),
        markdown,
        rows: None,
    })
}

pub fn detect_wechat_ocr_environment() -> Result<WechatOcrEnvironment, String> {
    let resolved = resolve_wechat_ocr_environment()?;
    Ok(wechat_ocr_environment_status(resolved))
}

pub fn prepare_wechat_ocr_environment() -> Result<WechatOcrEnvironment, String> {
    let resolved = resolve_wechat_ocr_environment()?;
    Ok(wechat_ocr_environment_status(resolved))
}

pub fn wechat_ocr(image_base64: &str, _config: &OcrConfig) -> Result<OcrResult, String> {
    use base64::engine::general_purpose;
    use base64::Engine;

    let env = wechat_ocr_environment_status(resolve_wechat_ocr_environment()?);
    if !env.available {
        return Err(format!("微信本机 OCR 未就绪: {}", env.missing.join("；")));
    }

    let image_data = general_purpose::STANDARD
        .decode(image_base64)
        .map_err(|error| format!("Base64解码失败: {}", error))?;
    let temp_dir =
        std::env::temp_dir().join(format!("mcstartup-wechat-ocr-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).map_err(|error| format!("创建临时 OCR 目录失败: {}", error))?;
    let image_path = temp_dir.join("input.png");
    fs::write(&image_path, image_data)
        .map_err(|error| format!("写入临时 OCR 图片失败: {}", error))?;

    let result = call_wechat_ocr_bridge(
        Path::new(&env.bridge_path),
        Path::new(&env.wxocr_path),
        Path::new(&env.runtime_dir),
        &image_path,
    );
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

fn resolve_wechat_ocr_environment() -> Result<WechatOcrResolvedEnvironment, String> {
    let bridge_path = resolve_wechat_bridge_path();
    if let Some((install_dir, runtime_dir)) = find_bundled_wechat_ocr_runtime() {
        return Ok(build_wechat_ocr_environment(
            install_dir,
            runtime_dir,
            bridge_path,
        ));
    }

    Err("未找到内置微信 OCR 运行时，请确认应用资源目录包含 resources/wechat-ocr。".to_string())
}

fn wechat_ocr_environment_status(resolved: WechatOcrResolvedEnvironment) -> WechatOcrEnvironment {
    let available = resolved.missing.is_empty();
    WechatOcrEnvironment {
        available,
        message: if available {
            "微信本机 OCR 已就绪".to_string()
        } else {
            "内置微信 OCR 尚未就绪，请检查打包资源".to_string()
        },
        install_dir: resolved.install_dir.to_string_lossy().to_string(),
        runtime_dir: resolved.runtime_dir.to_string_lossy().to_string(),
        ocr_archive: String::new(),
        cached_dir: String::new(),
        wxocr_path: resolved.wxocr_path.to_string_lossy().to_string(),
        bridge_path: resolved
            .bridge_path
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        missing: resolved.missing,
    }
}

fn build_wechat_ocr_environment(
    install_dir: PathBuf,
    runtime_dir: PathBuf,
    bridge_path: Option<PathBuf>,
) -> WechatOcrResolvedEnvironment {
    let wxocr_path = runtime_dir.join("wxocr.dll");
    let mut missing = Vec::new();
    if bridge_path
        .as_ref()
        .map(|path| !path.is_file())
        .unwrap_or(true)
    {
        missing.push("内置微信 OCR 运行时缺少 wcocr.dll".to_string());
    }
    for file_name in [
        "wxocr.dll",
        "mmmojo_64.dll",
        "shared_andromeda.dll",
        "XNet.dll",
        "plugin_info.ini",
        "text_det_fp16_v2.xnet",
        "text_rec_zh13562_fp16_v2.xnet",
    ] {
        if !runtime_dir.join(file_name).is_file() {
            missing.push(format!("内置微信 OCR 运行时缺少 {}", file_name));
        }
    }
    if !install_dir.join("weixin.exe").is_file() {
        missing.push("内置微信 OCR 运行时缺少父级 weixin.exe".to_string());
    }
    WechatOcrResolvedEnvironment {
        install_dir,
        runtime_dir,
        wxocr_path,
        bridge_path,
        missing,
    }
}

fn find_bundled_wechat_ocr_runtime() -> Option<(PathBuf, PathBuf)> {
    for root in wechat_ocr_resource_roots() {
        if let Some(runtime) = bundled_wechat_ocr_runtime_for_path(&root) {
            return Some(runtime);
        }
    }
    None
}

fn bundled_wechat_ocr_runtime_for_path(path: &Path) -> Option<(PathBuf, PathBuf)> {
    let root_runtime = path.join("runtime");
    if root_runtime.join("wxocr.dll").is_file() && path.join("weixin.exe").is_file() {
        return Some((path.to_path_buf(), root_runtime));
    }
    if path.join("wxocr.dll").is_file()
        && path
            .parent()
            .map(|parent| parent.join("weixin.exe").is_file())
            .unwrap_or(false)
    {
        return path
            .parent()
            .map(|parent| (parent.to_path_buf(), path.to_path_buf()));
    }
    None
}

fn wechat_ocr_resource_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("resources").join("wechat-ocr"));
        }
    }
    roots.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("wechat-ocr"),
    );
    roots
}

fn resolve_wechat_bridge_path() -> Option<PathBuf> {
    for root in wechat_ocr_resource_roots() {
        let candidate = root.join("wcocr.dll");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn call_wechat_ocr_bridge(
    bridge_path: &Path,
    wxocr_path: &Path,
    runtime_dir: &Path,
    image_path: &Path,
) -> Result<OcrResult, String> {
    if !bridge_path.is_file() {
        return Err(format!("未找到微信 OCR 桥接库: {}", bridge_path.display()));
    }
    let mut guard = wechat_ocr_bridge_state()
        .lock()
        .map_err(|_| "微信 OCR 桥接状态锁定失败".to_string())?;
    if guard.is_none() {
        unsafe {
            let library = libloading::Library::new(bridge_path)
                .map_err(|error| format!("加载微信 OCR 桥接库失败: {}", error))?;
            let wechat_ocr = {
                let symbol: libloading::Symbol<
                    unsafe extern "C" fn(
                        *const u16,
                        *const u16,
                        *const c_char,
                        WechatOcrCallback,
                    ) -> bool,
                > = library
                    .get(b"wechat_ocr\0")
                    .map_err(|error| format!("读取 wechat_ocr 入口失败: {}", error))?;
                *symbol
            };
            let stop_ocr = {
                let symbol: libloading::Symbol<unsafe extern "C" fn()> = library
                    .get(b"stop_ocr\0")
                    .map_err(|error| format!("读取 stop_ocr 入口失败: {}", error))?;
                *symbol
            };
            *guard = Some(WechatOcrBridge {
                _library: library,
                wechat_ocr,
                stop_ocr,
            });
        }
    }

    let bridge = guard
        .as_ref()
        .ok_or_else(|| "微信 OCR 桥接未初始化".to_string())?;
    let wxocr_wide = path_to_wide(wxocr_path);
    let runtime_wide = path_to_wide(runtime_dir);
    let image_string = image_path.to_string_lossy().to_string();
    let image_c = CString::new(image_string).map_err(|_| "OCR 图片路径包含非法字符".to_string())?;
    if let Ok(mut result) = wechat_ocr_callback_result().lock() {
        result.clear();
    }
    let success = unsafe {
        (bridge.wechat_ocr)(
            wxocr_wide.as_ptr(),
            runtime_wide.as_ptr(),
            image_c.as_ptr(),
            receive_wechat_ocr_result,
        )
    };
    if !success {
        return Err("微信 OCR 桥接调用失败".to_string());
    }
    let raw = wechat_ocr_callback_result()
        .lock()
        .map_err(|_| "读取微信 OCR 结果失败".to_string())?
        .clone();
    parse_wechat_ocr_result(&raw)
}

extern "C" fn receive_wechat_ocr_result(data: *const c_char) {
    if data.is_null() {
        return;
    }
    let text = unsafe { std::ffi::CStr::from_ptr(data) }
        .to_string_lossy()
        .to_string();
    if let Ok(mut result) = wechat_ocr_callback_result().lock() {
        *result = text;
    }
}

fn parse_wechat_ocr_result(raw: &str) -> Result<OcrResult, String> {
    if raw.trim().is_empty() {
        return Err("微信 OCR 返回空结果".to_string());
    }
    let response: WechatOcrBridgeResponse =
        serde_json::from_str(raw).map_err(|error| format!("解析微信 OCR 结果失败: {}", error))?;
    if response.errcode != 0 {
        return Err(format!("微信 OCR 识别失败: {}", response.errcode));
    }
    let mut confidence_values = Vec::new();
    let text_blocks = response
        .ocr_response
        .into_iter()
        .filter(|block| !block.text.trim().is_empty())
        .map(|block| {
            if block.rate > 0.0 {
                let normalized_rate = if block.rate > 1.0 {
                    (block.rate / 100.0).min(1.0)
                } else {
                    block.rate.min(1.0)
                };
                confidence_values.push(normalized_rate);
            }
            let left = block.left.round() as i32;
            let top = block.top.round() as i32;
            let right = block.right.round() as i32;
            let bottom = block.bottom.round() as i32;
            let width = (right - left).max(0);
            let height = (bottom - top).max(0);
            TextBlock {
                text: block.text,
                location: BoundingBox {
                    left,
                    top,
                    width,
                    height,
                },
            }
        })
        .collect::<Vec<_>>();
    let text = text_blocks
        .iter()
        .map(|block| block.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let confidence = if confidence_values.is_empty() {
        None
    } else {
        Some(confidence_values.iter().sum::<f64>() / confidence_values.len() as f64)
    };
    Ok(OcrResult {
        text,
        confidence,
        words: None,
        text_blocks: Some(text_blocks),
    })
}

fn path_to_wide(path: &Path) -> Vec<u16> {
    path.to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect()
}

pub fn stop_wechat_ocr() {
    if let Ok(mut guard) = wechat_ocr_bridge_state().lock() {
        if let Some(bridge) = guard.take() {
            unsafe {
                (bridge.stop_ocr)();
            }
        }
    }
}

// 腾讯表格识别
pub fn tencent_table_ocr(image_base64: &str, config: &OcrConfig) -> Result<TableResult, String> {
    let service = "ocr";
    let host = "ocr.tencentcloudapi.com";
    let action = "TableOCR";
    let version = "2018-11-19";
    let region = &config.tencent_region;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let payload = serde_json::json!({
        "ImageBase64": image_base64
    })
    .to_string();

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
        format!("TC3{}", config.tencent_secret_key).as_bytes(),
        date.as_bytes(),
    );
    let secret_service = hmac_sha256(&secret_date, service.as_bytes());
    let secret_signing = hmac_sha256(&secret_service, b"tc3_request");
    let signature = hex::encode(hmac_sha256(&secret_signing, string_to_sign.as_bytes()));

    let authorization = format!(
        "{} Credential={}/{}, SignedHeaders={}, Signature={}",
        algorithm, config.tencent_secret_id, credential_scope, signed_headers, signature
    );

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
        .map_err(|e| format!("腾讯表格识别请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().unwrap_or_default();
        return Err(format!(
            "腾讯表格识别失败: HTTP {} - {}",
            status, error_text
        ));
    }

    let response_json: serde_json::Value = response
        .json()
        .map_err(|e| format!("解析腾讯表格识别结果失败: {}", e))?;

    if let Some(error) = response_json.get("Response").and_then(|r| r.get("Error")) {
        let error_msg = error
            .get("Message")
            .and_then(|m| m.as_str())
            .unwrap_or("未知错误");
        return Err(format!("腾讯表格识别错误: {}", error_msg));
    }

    let table_detections = response_json
        .get("Response")
        .and_then(|r| r.get("TableDetections"))
        .and_then(|t| t.as_array())
        .ok_or("无法解析表格数据")?;

    if table_detections.is_empty() {
        return Err("未检测到表格".to_string());
    }

    let mut markdown = String::new();

    for (idx, table) in table_detections.iter().enumerate() {
        if idx > 0 {
            markdown.push_str("\n\n");
        }

        let cells = table
            .get("Cells")
            .and_then(|c| c.as_array())
            .ok_or("无法解析表格单元格")?;

        let mut rows: Vec<Vec<String>> = Vec::new();
        let mut max_col = 0;

        for cell in cells {
            let row_tl = cell.get("RowTl").and_then(|r| r.as_i64()).unwrap_or(0) as usize;
            let col_tl = cell.get("ColTl").and_then(|c| c.as_i64()).unwrap_or(0) as usize;
            let text = cell
                .get("Text")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();

            while rows.len() <= row_tl {
                rows.push(Vec::new());
            }

            while rows[row_tl].len() <= col_tl {
                rows[row_tl].push(String::new());
            }

            rows[row_tl][col_tl] = text;
            max_col = max_col.max(col_tl + 1);
        }

        for row in &mut rows {
            while row.len() < max_col {
                row.push(String::new());
            }
        }

        if !rows.is_empty() {
            markdown.push_str("| ");
            markdown.push_str(&rows[0].join(" | "));
            markdown.push_str(" |\n");

            markdown.push_str("|");
            for _ in 0..max_col {
                markdown.push_str(" --- |");
            }
            markdown.push('\n');

            for row in rows.iter().skip(1) {
                markdown.push_str("| ");
                markdown.push_str(&row.join(" | "));
                markdown.push_str(" |\n");
            }
        }
    }

    Ok(TableResult {
        html: String::new(),
        markdown,
        rows: None,
    })
}
