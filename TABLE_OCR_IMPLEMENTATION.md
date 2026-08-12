# 表格识别功能实现文档

## 概述

本文档记录了表格识别功能的完整实现，包括三个主要 OCR 服务商的表格识别 API 集成。

## 实现状态

✅ **已完成** - 所有功能已实现并通过编译测试

## 功能特性

### 1. 识别类型选择器

用户在截图选择区域后，会看到一个识别类型选择器：

```
┌─────────────────┐
│ 请选择识别类型：  │
│ ○ 文字识别       │
│ ○ 表格识别       │
│ ○ 二维码识别     │
└─────────────────┘
```

- **默认选项**: 文字识别
- **位置**: 选择区域下方居中显示
- **交互**: 点击任意选项立即开始识别

### 2. 支持的服务商

#### 百度 OCR (Baidu)

- **API**: `form_ocr` (表格识别)
- **特点**: 异步识别，需要轮询获取结果
- **实现**: `baidu_table_ocr()`
- **输出**: Markdown 格式表格

#### 腾讯云 OCR (Tencent)

- **API**: `TableOCR`
- **特点**: 同步识别，直接返回结果
- **实现**: `tencent_table_ocr()`
- **输出**: Markdown 格式表格

#### 阿里云 OCR (Aliyun)

- **API**: `RecognizeTableOcr`
- **特点**: 同步识别
- **实现**: `aliyun_table_ocr()`
- **输出**: Markdown 格式表格

### 3. 数据结构

#### TableResult

```rust
pub struct TableResult {
    pub html: String,        // HTML 格式（预留）
    pub markdown: String,    // Markdown 格式
    pub rows: Option<Vec<Vec<String>>>, // 原始行数据（可选）
}
```

## 技术实现

### 后端 (Rust)

#### 文件: `src-tauri/src/ocr.rs`

1. **统一接口**

```rust
pub fn recognize_table(
    image_base64: &str,
    provider: &str,
    config: &OcrConfig,
) -> Result<TableResult, String>
```

2. **百度表格识别流程**
   - 获取 access_token
   - 提交表格识别请求，获取 request_id
   - 轮询获取识别结果（最多 30 次，每次间隔 1 秒）
   - 解析表格数据并转换为 Markdown

3. **腾讯表格识别流程**
   - 使用 TC3-HMAC-SHA256 签名算法
   - 发送 POST 请求到 TableOCR API
   - 解析返回的表格单元格数据
   - 构建 Markdown 表格

4. **阿里云表格识别流程**
   - 使用 HMAC-SHA1 签名算法
   - 发送 POST 请求到 RecognizeTableOcr API
   - 解析返回的表格数据
   - 构建 Markdown 表格

5. **Markdown 转换**
   - 自动构建表格结构（行列对齐）
   - 生成标准 Markdown 表格格式
   - 支持多表格输出

#### 文件: `src-tauri/src/main.rs`

```rust
#[tauri::command]
fn recognize_table(
    image_base64: String,
    provider: String,
    config: ocr::OcrConfig,
) -> Result<ocr::TableResult, String> {
    ocr::recognize_table(&image_base64, &provider, &config)
}
```

### 前端 (TypeScript/React)

#### 文件: `src/tools/ScreenshotOcrWindow.tsx`

**功能**: 截图选择和识别类型选择

- 全屏截图作为背景
- 鼠标拖拽选择识别区域
- 显示识别类型选择器（文字/表格/二维码）
- 传递选择的区域和识别类型

**关键状态**:

```typescript
type RecognitionType = 'text' | 'table' | 'qrcode';
const [selectedType, setSelectedType] = useState<RecognitionType>('text');
const [showTypeSelector, setShowTypeSelector] = useState(false);
```

#### 文件: `src/tools/ScreenshotOcrCapture.tsx`

**功能**: 识别流程控制

- 接收截图区域和识别类型
- 调用对应的识别函数
- 显示识别结果

**关键函数**:

```typescript
const performTableRecognize = async (base64Image: string) => {
  const tableResult = await invoke<TableResult>('recognize_table', {
    imageBase64: base64Image,
    provider: settings.ocrProvider || 'baidu',
    config: {
      /* OCR 配置 */
    },
  });
  setResult(tableResult.markdown);
};
```

### 配置管理

#### 文件: `src/types/index.ts`

```typescript
export interface Settings {
  // ... 其他配置
  ocrAliyunAccessKeyId?: string;
  ocrAliyunAccessKeySecret?: string;
}
```

#### 文件: `src/stores/settingsStore.ts`

```typescript
const defaultSettings: Settings = {
  // ... 其他配置
  ocrAliyunAccessKeyId: '',
  ocrAliyunAccessKeySecret: '',
};
```

#### 文件: `src/components/Settings.tsx`

阿里云 OCR 配置界面已添加：

- Access Key ID 输入框
- Access Key Secret 输入框

## 使用流程

1. **用户触发截图识别**
   - 点击 OCR 工具或使用快捷键

2. **选择识别区域**
   - 全屏显示当前屏幕截图
   - 鼠标拖拽框选需要识别的区域

3. **选择识别类型**
   - 显示识别类型选择器
   - 默认选中"文字识别"
   - 点击"表格识别"进行表格识别

4. **执行识别**
   - 裁剪选中区域
   - 调用对应服务商的表格识别 API
   - 等待识别结果

5. **显示结果**
   - 以 Markdown 格式显示表格
   - 自动复制到剪贴板（如果启用）
   - 可切换服务商重新识别

## API 配置要求

### 百度 OCR

- API Key
- Secret Key
- 需要开通表格识别服务

### 腾讯云 OCR

- Secret ID
- Secret Key
- Region (默认: ap-guangzhou)
- 需要开通表格识别服务

### 阿里云 OCR

- Access Key ID
- Access Key Secret
- 需要开通表格识别服务

## 错误处理

1. **API 配置检查**
   - 识别前检查必要的 API 密钥是否配置
   - 显示友好的错误提示

2. **网络错误**
   - 超时处理（30 秒）
   - 显示详细错误信息

3. **识别失败**
   - 显示服务商返回的错误信息
   - 提供排查建议

4. **未检测到表格**
   - 提示用户选择包含表格的区域
   - 建议切换其他服务商

## 编译测试

### Rust 后端

```bash
cargo check --manifest-path src-tauri/Cargo.toml
# ✓ 编译成功，无错误
```

### TypeScript 前端

```bash
npm run build
# ✓ 构建成功，无错误
```

## 依赖项

### Rust 依赖 (已添加到 Cargo.toml)

- `sha1 = "0.10"` - SHA1 哈希（阿里云签名）
- `urlencoding = "2.1"` - URL 编码（阿里云 API）
- `uuid = "1.7"` - UUID 生成（阿里云 nonce）
- `chrono = "0.4"` - 时间处理
- `hmac = "0.12"` - HMAC 签名
- `sha2 = "0.10"` - SHA256 哈希（腾讯云签名）

### 前端依赖

- `@tauri-apps/api` - Tauri API 调用
- React 状态管理

## 下一步优化建议

1. **性能优化**
   - 考虑添加识别结果缓存
   - 优化大图片的处理

2. **用户体验**
   - 添加识别进度提示
   - 支持表格编辑功能
   - 支持导出为 Excel/CSV

3. **功能扩展**
   - 支持批量表格识别
   - 支持表格合并
   - 添加表格预览功能

4. **错误处理**
   - 添加重试机制
   - 更详细的错误日志

## 总结

表格识别功能已完整实现，包括：

- ✅ 三个主要服务商的表格识别 API 集成
- ✅ 识别类型选择器 UI
- ✅ Markdown 格式输出
- ✅ 完整的错误处理
- ✅ 配置管理界面
- ✅ 编译测试通过

所有代码已经过编译验证，可以直接使用。
