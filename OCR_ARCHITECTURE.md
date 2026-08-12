# OCR 架构设计

## 设计原则

采用**统一接口 + 多实现**的架构模式，便于扩展和维护。

## 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (TypeScript)                 │
│                                                          │
│  invoke('ocr_recognize', {                              │
│    imageBase64,                                          │
│    provider: 'baidu' | 'google' | 'tencent',           │
│    config                                                │
│  })                                                      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Backend (Rust) - main.rs                    │
│                                                          │
│  #[tauri::command]                                       │
│  fn ocr_recognize(...) -> Result<OcrResult> {           │
│      ocr::recognize(&image_base64, &provider, &config)  │
│  }                                                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              OCR Module (ocr.rs)                         │
│                                                          │
│  pub fn recognize(                                       │
│      image_base64: &str,                                 │
│      provider: &str,                                     │
│      config: &OcrConfig                                  │
│  ) -> Result<OcrResult> {                                │
│      match provider {                                    │
│          "baidu" => baidu_ocr(...),                      │
│          "google" => google_ocr(...),                    │
│          "tencent" => tencent_ocr(...),                  │
│          _ => Err(...)                                   │
│      }                                                   │
│  }                                                       │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
    ┌────────┐  ┌────────┐  ┌────────┐
    │ Baidu  │  │ Google │  │Tencent │
    │  OCR   │  │  OCR   │  │  OCR   │
    └────────┘  └────────┘  └────────┘
```

## 核心组件

### 1. 统一接口 (`ocr::recognize`)

```rust
pub fn recognize(
    image_base64: &str,
    provider: &str,
    config: &OcrConfig,
) -> Result<OcrResult, String>
```

**职责**：

- 根据 `provider` 参数路由到对应的 OCR 实现
- 统一错误处理
- 统一返回格式

**优势**：

- ✅ 新增 OCR 服务商只需添加一个 case
- ✅ 调用方无需关心具体实现
- ✅ 便于测试和维护

### 2. 统一数据结构

```rust
pub struct OcrResult {
    pub text: String,                          // 识别的完整文本
    pub confidence: Option<f64>,               // 置信度（可选）
    pub words: Option<Vec<WordResult>>,        // 单词级别结果（可选）
    pub text_blocks: Option<Vec<TextBlock>>,   // 文本块 + 位置信息（可选）
}

pub struct TextBlock {
    pub text: String,                          // 文本内容
    pub location: BoundingBox,                 // 位置信息
}

pub struct BoundingBox {
    pub left: i32,                             // 左上角 X 坐标
    pub top: i32,                              // 左上角 Y 坐标
    pub width: i32,                            // 宽度
    pub height: i32,                           // 高度
}
```

**设计考虑**：

- 所有可选字段使用 `Option<T>`
- 不同 OCR 服务商返回不同级别的信息
- 统一的坐标系统（左上角为原点）

### 3. 各 OCR 实现

每个 OCR 服务商实现独立的函数：

```rust
pub fn baidu_ocr(image_base64: &str, config: &OcrConfig) -> Result<OcrResult, String>
pub fn google_ocr(image_base64: &str, config: &OcrConfig) -> Result<OcrResult, String>
pub fn tencent_ocr(image_base64: &str, config: &OcrConfig) -> Result<OcrResult, String>
```

**职责**：

- 调用对应的 API
- 解析 API 返回结果
- 转换为统一的 `OcrResult` 格式
- 提取位置信息（如果 API 支持）

## 新增 OCR 服务商流程

### 步骤 1：实现 OCR 函数

在 `src-tauri/src/ocr.rs` 中添加：

```rust
pub fn new_provider_ocr(
    image_base64: &str,
    config: &OcrConfig,
) -> Result<OcrResult, String> {
    // 1. 调用 API
    let response = call_api(image_base64, config)?;

    // 2. 解析文本
    let text = parse_text(&response);

    // 3. 提取位置信息（如果支持）
    let text_blocks = parse_locations(&response);

    // 4. 返回统一格式
    Ok(OcrResult {
        text,
        confidence: None,
        words: None,
        text_blocks,
    })
}
```

### 步骤 2：注册到统一接口

在 `ocr::recognize` 函数中添加：

```rust
pub fn recognize(
    image_base64: &str,
    provider: &str,
    config: &OcrConfig,
) -> Result<OcrResult, String> {
    match provider {
        "baidu" => baidu_ocr(image_base64, config),
        "google" => google_ocr(image_base64, config),
        "tencent" => tencent_ocr(image_base64, config),
        "new_provider" => new_provider_ocr(image_base64, config), // 新增这一行
        _ => Err(format!("不支持的OCR服务商: {}", provider)),
    }
}
```

### 步骤 3：更新配置结构（如需要）

如果新服务商需要额外配置，在 `OcrConfig` 中添加：

```rust
pub struct OcrConfig {
    // ... 现有字段

    #[serde(rename = "newProviderApiKey")]
    pub new_provider_api_key: String,
}
```

### 步骤 4：更新前端类型

在 `src/types/index.ts` 中：

```typescript
export interface AppSettings {
  // ...
  ocrProvider?: 'baidu' | 'google' | 'tencent' | 'new_provider';
  ocrNewProviderApiKey?: string;
}
```

### 步骤 5：更新设置界面

在 `src/components/Settings.tsx` 中添加配置选项。

## 位置信息处理

### 不同 API 的坐标系统

| OCR 服务商 | 坐标格式                     | 转换方式                |
| ---------- | ---------------------------- | ----------------------- |
| 百度       | `{left, top, width, height}` | 直接使用 ✅             |
| Google     | `vertices: [{x, y}, ...]`    | 计算 min/max 得到边界框 |
| 腾讯       | `{X, Y, Width, Height}`      | 重命名字段              |

### 统一坐标系统

所有位置信息统一为：

- **原点**：图片左上角 (0, 0)
- **X 轴**：向右为正
- **Y 轴**：向下为正
- **单位**：像素

```
(0,0) ────────────► X
  │
  │   ┌─────────┐
  │   │  Text   │ ← BoundingBox
  │   └─────────┘   {left, top, width, height}
  │
  ▼
  Y
```

## 错误处理

### 统一错误格式

所有 OCR 函数返回 `Result<OcrResult, String>`：

- **成功**：`Ok(OcrResult { ... })`
- **失败**：`Err("错误描述")`

### 错误类型

1. **网络错误**：`"OCR请求失败: {error}"`
2. **API 错误**：`"OCR识别失败: HTTP {status}"`
3. **解析错误**：`"解析OCR结果失败: {error}"`
4. **配置错误**：`"不支持的OCR服务商: {provider}"`

## 性能优化

### 1. 超时设置

```rust
let client = Client::builder()
    .timeout(std::time::Duration::from_secs(30))
    .build()?;
```

### 2. 异步处理（未来）

当前使用同步 HTTP 客户端，未来可改为异步：

```rust
pub async fn recognize_async(
    image_base64: &str,
    provider: &str,
    config: &OcrConfig,
) -> Result<OcrResult, String>
```

### 3. 缓存（未来）

对相同图片的 OCR 结果进行缓存。

## 测试策略

### 单元测试

每个 OCR 实现独立测试：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_baidu_ocr() {
        let config = OcrConfig { /* ... */ };
        let result = baidu_ocr("base64_image", &config);
        assert!(result.is_ok());
    }
}
```

### 集成测试

测试统一接口：

```rust
#[test]
fn test_recognize_with_different_providers() {
    let providers = vec!["baidu", "google", "tencent"];
    for provider in providers {
        let result = recognize("base64_image", provider, &config);
        assert!(result.is_ok());
    }
}
```

## 扩展性

### 支持的扩展方向

1. **新增 OCR 服务商**
   - Azure Computer Vision
   - AWS Textract
   - 阿里云 OCR
   - 讯飞 OCR

2. **新增功能**
   - 表格识别
   - 公式识别
   - 手写识别
   - 多语言识别

3. **性能优化**
   - 批量识别
   - 并行处理
   - 结果缓存

4. **高级特性**
   - 文本方向检测
   - 文本行合并
   - 段落识别

## 总结

通过统一接口设计：

- ✅ **易扩展**：新增服务商只需实现一个函数
- ✅ **易维护**：修改不影响其他部分
- ✅ **易测试**：每个组件独立测试
- ✅ **易使用**：调用方无需关心实现细节
- ✅ **类型安全**：Rust 类型系统保证正确性
