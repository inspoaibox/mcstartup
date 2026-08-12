# OCR 识别工具实现指南

## 已完成

### 前端部分 ✅

1. **OcrTool.tsx** - OCR 工具主界面
   - 图片选择和预览
   - 识别按钮（文字识别、二维码识别）
   - 结果显示和复制
   - 设置面板

2. **ocrSettingsStore.ts** - 配置状态管理
   - 支持三个 OCR 服务商配置
   - 本地持久化存储

## 需要完成的后端部分

### 1. 添加 Rust 依赖

在 `src-tauri/Cargo.toml` 中添加：

```toml
[dependencies]
reqwest = { version = "0.11", features = ["json", "blocking"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
base64 = "0.21"
image = "0.24"
rqrr = "0.6"  # 二维码识别
```

### 2. 创建 OCR 模块

创建 `src-tauri/src/ocr.rs`：

```rust
use serde::{Deserialize, Serialize};
use reqwest::blocking::Client;
use base64::{Engine as _, engine::general_purpose};

#[derive(Debug, Serialize, Deserialize)]
pub struct OcrConfig {
    pub baidu_api_key: String,
    pub baidu_secret_key: String,
    pub baidu_high_accuracy: bool,
    pub google_api_key: String,
    pub tencent_secret_id: String,
    pub tencent_secret_key: String,
    pub tencent_region: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OcrResult {
    pub text: String,
    pub confidence: Option<f64>,
    pub words: Option<Vec<WordResult>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WordResult {
    pub text: String,
    pub confidence: f64,
}

// 百度 OCR
pub fn baidu_ocr(image_base64: &str, config: &OcrConfig) -> Result<OcrResult, String> {
    // 1. 获取 access_token
    let token_url = format!(
        "https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id={}&client_secret={}",
        config.baidu_api_key, config.baidu_secret_key
    );

    let client = Client::new();
    let token_response: serde_json::Value = client
        .get(&token_url)
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    let access_token = token_response["access_token"]
        .as_str()
        .ok_or("Failed to get access token")?;

    // 2. 调用 OCR API
    let ocr_url = if config.baidu_high_accuracy {
        format!("https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token={}", access_token)
    } else {
        format!("https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token={}", access_token)
    };

    let mut params = std::collections::HashMap::new();
    params.insert("image", image_base64);

    let response: serde_json::Value = client
        .post(&ocr_url)
        .form(&params)
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    // 3. 解析结果
    let words_result = response["words_result"]
        .as_array()
        .ok_or("Invalid response format")?;

    let text = words_result
        .iter()
        .filter_map(|w| w["words"].as_str())
        .collect::<Vec<_>>()
        .join("\n");

    Ok(OcrResult {
        text,
        confidence: None,
        words: None,
    })
}

// Google OCR
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

    let client = Client::new();
    let response: serde_json::Value = client
        .post(&url)
        .json(&request_body)
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    let text = response["responses"][0]["fullTextAnnotation"]["text"]
        .as_str()
        .unwrap_or("")
        .to_string();

    Ok(OcrResult {
        text,
        confidence: None,
        words: None,
    })
}

// 腾讯 OCR
pub fn tencent_ocr(image_base64: &str, config: &OcrConfig) -> Result<OcrResult, String> {
    // 腾讯云需要签名，实现较复杂
    // 建议使用腾讯云 SDK
    Err("Tencent OCR not implemented yet".to_string())
}

// 二维码识别
pub fn recognize_qrcode(image_base64: &str) -> Result<String, String> {
    use image::DynamicImage;
    use rqrr::PreparedImage;

    // 解码 base64
    let image_data = general_purpose::STANDARD
        .decode(image_base64)
        .map_err(|e| e.to_string())?;

    // 加载图片
    let img = image::load_from_memory(&image_data)
        .map_err(|e| e.to_string())?;

    // 转换为灰度图
    let gray_img = img.to_luma8();

    // 准备图片
    let mut prepared = PreparedImage::prepare(gray_img);

    // 识别二维码
    let grids = prepared.detect_grids();

    if let Some(grid) = grids.first() {
        let (_, content) = grid.decode().map_err(|e| format!("{:?}", e))?;
        Ok(content)
    } else {
        Err("No QR code found".to_string())
    }
}
```

### 3. 注册 Tauri 命令

在 `src-tauri/src/main.rs` 中：

```rust
mod ocr;

#[tauri::command]
fn ocr_recognize(
    image_base64: String,
    provider: String,
    config: ocr::OcrConfig,
) -> Result<ocr::OcrResult, String> {
    match provider.as_str() {
        "baidu" => ocr::baidu_ocr(&image_base64, &config),
        "google" => ocr::google_ocr(&image_base64, &config),
        "tencent" => ocr::tencent_ocr(&image_base64, &config),
        _ => Err("Unknown provider".to_string()),
    }
}

#[tauri::command]
fn recognize_qrcode(image_base64: String) -> Result<String, String> {
    ocr::recognize_qrcode(&image_base64)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // ... 其他命令
            ocr_recognize,
            recognize_qrcode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## 快捷键支持

### 全局快捷键

在 `src-tauri/tauri.conf.json` 中添加：

```json
{
  "tauri": {
    "globalShortcut": {
      "shortcuts": [
        {
          "shortcut": "Ctrl+Shift+O",
          "handler": "show_ocr_tool"
        }
      ]
    }
  }
}
```

在 Rust 中处理：

```rust
use tauri::GlobalShortcutManager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            app.global_shortcut_manager()
                .register("Ctrl+Shift+O", move || {
                    // 显示 OCR 工具窗口
                    if let Some(window) = handle.get_window("tool-ocr") {
                        window.show().unwrap();
                        window.set_focus().unwrap();
                    }
                })
                .unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## 注册工具

### 1. 在 registry.ts 中注册

```typescript
{
  id: 'ocr',
  name: 'OCR 识别',
  description: '支持百度、Google、腾讯 OCR，文字识别和二维码识别',
  keywords: ['ocr', '识别', '文字识别', '二维码', 'qrcode', '百度', 'google', '腾讯'],
  categoryId: 'dev',
  icon: '🔍',
  type: 'window',
  windowLabel: 'tool-ocr',
  windowWidth: 900,
  windowHeight: 650,
}
```

### 2. 在 App.tsx 中添加路由

```typescript
import OcrTool from './tools/OcrTool';

// ...

if (windowLabel === 'tool-ocr') {
  return <OcrTool />;
}
```

### 3. 在 commands.rs 中添加窗口配置

```rust
"tool-ocr" => (900.0f64, 650.0f64, true, false),

// title
"tool-ocr" => "OCR 识别",
```

## 使用说明

### 1. 配置 API 密钥

1. 点击设置按钮
2. 选择 OCR 服务商
3. 输入对应的 API 密钥

### 2. 识别文字

1. 点击"选择图片"或"截图"
2. 选择要识别的图片
3. 点击"识别文字"
4. 查看识别结果

### 3. 识别二维码

1. 选择包含二维码的图片
2. 点击"识别二维码"
3. 查看识别结果

### 4. 快捷键

- `Ctrl+Shift+O` - 打开 OCR 工具

## API 密钥获取

### 百度 OCR

1. 访问 https://ai.baidu.com/
2. 创建应用
3. 获取 API Key 和 Secret Key

### Google Cloud Vision

1. 访问 https://cloud.google.com/vision
2. 创建项目
3. 启用 Vision API
4. 创建 API 密钥

### 腾讯云 OCR

1. 访问 https://cloud.tencent.com/product/ocr
2. 开通服务
3. 获取 Secret ID 和 Secret Key

## 注意事项

1. **API 配额**：各服务商都有免费配额限制
2. **网络请求**：需要网络连接
3. **图片大小**：建议不超过 4MB
4. **隐私安全**：API 密钥本地存储，不要泄露

## 后续优化

1. 添加截图功能（使用系统截图工具或 Tauri 插件）
2. 支持批量识别
3. 添加识别历史记录
4. 支持更多 OCR 服务商
5. 离线 OCR（使用 Tesseract）
6. 图片预处理（旋转、裁剪、增强）
