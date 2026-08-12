# 截图翻译覆盖模式功能 - 原文位置显示

## 功能概述

新增了第二种翻译显示模式：**覆盖模式**（Overlay Mode），**在原文的位置上直接覆盖显示翻译文本**，保持原文的布局和格式，类似 Glance 项目的实现方式。

## 两种翻译模式

### 1. 窗口模式（Window Mode）- 默认

- 在独立窗口中显示原文和译文
- 支持编辑译文
- 显示图片预览
- 可切换翻译服务商
- 可调整语言对

### 2. 覆盖模式（Overlay Mode）- 新增 ⭐

- **在原图上，每个文本块的原位置显示对应的翻译**
- 保持原文的布局和格式
- 半透明白色背景覆盖每个文本块
- 可实时调整透明度和字体大小
- 按 Tab 键切换显示原文/译文
- 点击背景或按 ESC 关闭
- 适合快速查看翻译结果

## 核心特性

### 文本位置识别

- 使用百度 OCR 的 `general` 或 `accurate` 接口（返回位置信息）
- 获取每个文本块的坐标（left, top, width, height）
- 在对应位置精确覆盖显示翻译

### 逐块翻译

- 覆盖模式下，逐个翻译每个文本块
- 保持文本块与翻译的一一对应关系
- 翻译失败时保留原文

### 实时调整

- `+/-`: 调整透明度
- `↑/↓`: 调整字体大小
- `Tab`: 切换原文/译文显示
- `ESC`: 关闭

## 实现细节

### 后端修改

#### 1. OCR 结果结构 (`src-tauri/src/ocr.rs`)

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct OcrResult {
    pub text: String,
    pub confidence: Option<f64>,
    pub words: Option<Vec<WordResult>>,
    pub text_blocks: Option<Vec<TextBlock>>, // 新增：文本块位置信息
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
```

#### 2. 百度 OCR API 调用修改

- 从 `general_basic` 改为 `general`（返回位置信息）
- 从 `accurate_basic` 改为 `accurate`（高精度 + 位置信息）
- 添加参数 `recognize_granularity: "big"` 返回文本块位置
- 解析 `location` 字段获取坐标

### 前端修改

#### 1. 类型定义

```typescript
interface TextBlock {
  text: string;
  location: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

interface OcrResult {
  text: string;
  confidence?: number;
  textBlocks?: TextBlock[];
}
```

#### 2. TranslateOverlay 组件 (`src/tools/TranslateOverlay.tsx`)

- 接收 `textBlocks` 和 `translations` 数组
- 遍历文本块，在对应位置渲染翻译
- 使用绝对定位 + 坐标精确放置
- 支持 Tab 键切换原文/译文
- 如果没有位置信息，回退到居中显示

#### 3. ScreenshotTranslateCapture 组件

- 添加 `textBlocks` 和 `translations` 状态
- 新增 `performTranslateBlocks()` 函数逐块翻译
- 覆盖模式下：
  - 如果有位置信息，逐块翻译
  - 如果没有位置信息，整段翻译并居中显示
- 窗口模式下：整段翻译

## 使用方法

### 1. 配置翻译模式

1. 打开设置 → 翻译设置
2. 在"截图翻译"部分找到"显示模式"
3. 选择"覆盖模式（在原图上显示译文）"
4. 可选：调整透明度和字体大小

### 2. 使用覆盖模式翻译

1. 按下翻译快捷键（默认 `Alt+Shift+T`）
2. 框选需要翻译的区域
3. 等待 OCR 识别（获取文本和位置）
4. 等待逐块翻译
5. 全屏显示，每个文本块在原位置显示翻译
6. 使用快捷键：
   - `Tab`: 切换显示原文/译文
   - `+` 或 `=`: 增加透明度
   - `-` 或 `_`: 减少透明度
   - `↑`: 增大字体
   - `↓`: 减小字体
   - `ESC`: 关闭

## 技术特点

1. **精确定位**：使用 OCR 返回的坐标信息，在原文位置显示翻译
2. **保持布局**：每个文本块独立翻译和显示，保持原文布局
3. **原文/译文切换**：Tab 键快速切换，方便对照
4. **实时调整**：透明度和字体大小可实时调整
5. **降级处理**：如果 OCR 不返回位置信息，自动回退到居中显示
6. **异步翻译**：逐块翻译，避免单次请求过长

## 与 Glance 的对比

### 相似之处

- 在原文位置显示翻译
- 全屏覆盖显示
- 半透明背景
- 可调整透明度

### 差异之处

- **Glance**: 使用有道图片翻译 API（一次性 OCR + 翻译，返回渲染好的图片）
- **我们的实现**:
  - 分离 OCR 和翻译，支持多种服务商
  - 使用 HTML/CSS 渲染文本覆盖层
  - 支持实时切换原文/译文
  - 支持两种显示模式（窗口/覆盖）

## API 要求

### 百度 OCR

- ✅ 支持位置信息
- 接口：`general` 或 `accurate`（非 `_basic` 版本）
- 参数：`recognize_granularity=big`

### Google OCR

- ⚠️ 需要额外解析 `textAnnotations` 获取位置
- 当前实现：仅返回纯文本（待扩展）

### 腾讯 OCR

- ⚠️ 需要解析 `ItemPolygon` 获取位置
- 当前实现：仅返回纯文本（待扩展）

## 未来改进方向

1. **支持更多 OCR 服务商的位置信息**
   - Google Vision API
   - 腾讯 OCR
2. **智能文本合并**
   - 识别同一行/段落的文本块
   - 合并翻译以提高准确性

3. **批量翻译优化**
   - 一次请求翻译多个文本块
   - 减少 API 调用次数

4. **样式自定义**
   - 背景颜色选择
   - 字体选择
   - 边框样式

5. **动画效果**
   - 文本块淡入效果
   - 切换原文/译文的过渡动画

## 文件清单

### 修改文件

- `src-tauri/src/ocr.rs` - 添加位置信息结构，修改百度 OCR 调用
- `src/tools/TranslateOverlay.tsx` - 在原文位置显示翻译
- `src/tools/ScreenshotTranslateCapture.tsx` - 支持逐块翻译
- `src/types/index.ts` - 添加类型定义
- `src/components/Settings.tsx` - 添加模式设置
- `src/stores/settingsStore.ts` - 添加默认值
- `src-tauri/src/settings.rs` - 添加 Rust 字段

## 测试建议

1. **位置信息测试**：
   - 测试不同布局的文本（单行、多行、多列）
   - 验证翻译位置是否准确对应原文

2. **覆盖模式功能测试**：
   - 测试 Tab 键切换原文/译文
   - 测试透明度调整
   - 测试字体大小调整

3. **降级测试**：
   - 测试 OCR 不返回位置信息时的表现
   - 验证是否正确回退到居中显示

4. **性能测试**：
   - 测试大量文本块的翻译速度
   - 测试渲染性能

5. **边界情况**：
   - 文本块重叠
   - 超长文本
   - 特殊字符

## 两种翻译模式

### 1. 窗口模式（Window Mode）- 默认

- 在独立窗口中显示原文和译文
- 支持编辑译文
- 显示图片预览
- 可切换翻译服务商
- 可调整语言对

### 2. 覆盖模式（Overlay Mode）- 新增

- 全屏显示，在原图上覆盖显示译文
- 半透明白色背景
- 可实时调整透明度和字体大小
- 点击背景或按 ESC 关闭
- 适合快速查看翻译结果

## 实现细节

### 前端修改

#### 1. 类型定义 (`src/types/index.ts`)

```typescript
export interface AppSettings {
  // ... 其他字段
  translateMode?: 'window' | 'overlay'; // 翻译显示模式
  translateOverlayOpacity?: number; // 覆盖模式的透明度 (0-1)
  translateOverlayFontSize?: number; // 覆盖模式的字体大小
}
```

#### 2. 新组件 (`src/tools/TranslateOverlay.tsx`)

- 全屏覆盖层组件
- 显示原图（低透明度）+ 译文（高透明度白色背景）
- 支持键盘快捷键：
  - `ESC`: 关闭
  - `+/-`: 调整透明度
  - `↑/↓`: 调整字体大小
- 点击背景关闭

#### 3. 修改截图翻译组件 (`src/tools/ScreenshotTranslateCapture.tsx`)

- 添加 `overlay` 模式状态
- 根据设置选择显示模式
- 新增 `showOverlayWindow()` 函数用于全屏显示
- 修改 `handleCapture()` 和 `performTranslate()` 支持两种模式

#### 4. 设置页面 (`src/components/Settings.tsx`)

- 添加"显示模式"选择器
- 覆盖模式专属设置：
  - 透明度滑块 (0.1 - 1.0)
  - 字体大小滑块 (12px - 32px)
- 提示用户快捷键操作

#### 5. 状态管理 (`src/stores/settingsStore.ts`)

- 添加默认值：
  - `translateMode: 'window'`
  - `translateOverlayOpacity: 0.9`
  - `translateOverlayFontSize: 16`

### 后端修改

#### Rust 设置结构 (`src-tauri/src/settings.rs`)

```rust
pub struct AppSettings {
    // ... 其他字段
    pub translate_mode: String,
    pub translate_overlay_opacity: f32,
    pub translate_overlay_font_size: u32,
}
```

添加默认值函数：

- `default_translate_mode()` -> "window"
- `default_translate_overlay_opacity()` -> 0.9
- `default_translate_overlay_font_size()` -> 16

## 使用方法

### 1. 配置翻译模式

1. 打开设置 → 翻译设置
2. 在"截图翻译"部分找到"显示模式"
3. 选择"覆盖模式（在原图上显示译文）"
4. 可选：调整透明度和字体大小

### 2. 使用覆盖模式翻译

1. 按下翻译快捷键（默认 `Alt+Shift+T`）
2. 框选需要翻译的区域
3. 等待 OCR 识别和翻译
4. 全屏显示翻译结果，覆盖在原图上
5. 使用快捷键调整显示效果：
   - `+` 或 `=`: 增加透明度
   - `-` 或 `_`: 减少透明度
   - `↑`: 增大字体
   - `↓`: 减小字体
6. 按 `ESC` 或点击背景关闭

## 技术特点

1. **模式切换灵活**：用户可随时在设置中切换模式，无需重启
2. **实时调整**：覆盖模式下可实时调整显示效果
3. **保持原有功能**：窗口模式保留所有原有功能（编辑、切换服务商等）
4. **统一的翻译流程**：两种模式共享相同的 OCR 和翻译逻辑
5. **响应式设计**：覆盖层自适应截图区域大小

## 与 Glance 的对比

### 相似之处

- 全屏覆盖显示
- 半透明背景
- 可调整透明度
- ESC 关闭

### 差异之处

- Glance 使用有道图片翻译 API（一次性 OCR + 翻译）
- 我们的实现分离 OCR 和翻译，支持多种服务商
- 我们提供两种模式供用户选择
- 我们的覆盖模式更简洁，专注于显示译文

## 未来改进方向

1. **智能文本定位**：如果翻译 API 返回文本位置信息，可以在原图对应位置显示译文
2. **多区域翻译**：支持识别和翻译多个文本区域
3. **样式自定义**：允许用户自定义背景颜色、字体等
4. **动画效果**：添加淡入淡出等过渡动画
5. **历史记录**：保存翻译历史，支持快速查看

## 文件清单

### 新增文件

- `src/tools/TranslateOverlay.tsx` - 覆盖层组件

### 修改文件

- `src/types/index.ts` - 添加类型定义
- `src/tools/ScreenshotTranslateCapture.tsx` - 支持两种模式
- `src/components/Settings.tsx` - 添加模式设置
- `src/stores/settingsStore.ts` - 添加默认值
- `src-tauri/src/settings.rs` - 添加 Rust 字段

## 测试建议

1. **模式切换测试**：
   - 在窗口模式和覆盖模式之间切换
   - 验证设置正确保存和加载

2. **覆盖模式功能测试**：
   - 测试透明度调整（+/-键）
   - 测试字体大小调整（↑↓键）
   - 测试 ESC 关闭
   - 测试点击背景关闭

3. **翻译功能测试**：
   - 测试各种翻译服务商
   - 测试不同语言对
   - 测试错误处理

4. **边界情况测试**：
   - 极小/极大的截图区域
   - 超长文本
   - 无文本区域
   - 网络错误情况
