# AI 提供商 URL 处理修复

## 🐛 问题描述

用户在添加 AI 提供商配置时，输入 `https://apis.861861.xyz/v1/` 后点击"获取所有模型"按钮，出现错误：

```
Unexpected token '<', "<!doctype "... is not valid JSON
```

## 🔍 问题根因

### 1. URL 拼接问题

- 用户输入：`https://apis.861861.xyz/v1/`（末尾有斜杠）
- 代码拼接：`${baseUrl}/models`
- 实际请求：`https://apis.861861.xyz/v1//models`（双斜杠）
- 服务器返回：404 HTML 错误页面

### 2. 后端响应验证缺失

- `http_get` 命令只检查 HTTP 状态码
- 没有验证 Content-Type 是否为 JSON
- HTML 响应（200 OK）被当作成功返回
- 前端尝试 `JSON.parse(html)` 时报错

### 3. 错误提示不友好

- 用户只看到 JSON 解析错误
- 不知道是 URL 格式问题还是 API Key 问题
- 缺少具体的排查建议

## ✅ 修复方案

### 修复 1：后端 - 添加响应类型验证

**文件**：`src-tauri/src/commands.rs`

**改动**：

```rust
// 检查 Content-Type 是否为 JSON
let content_type = resp
    .headers()
    .get("content-type")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("");

let text = resp.text().await.map_err(|e| e.to_string())?;

// 如果返回 HTML，提供友好错误提示
if !content_type.contains("application/json") && !content_type.contains("text/json") {
    if text.trim_start().to_lowercase().starts_with("<!doctype")
        || text.trim_start().to_lowercase().starts_with("<html") {
        return Err(format!(
            "服务器返回了 HTML 页面而不是 JSON 数据 (Content-Type: {})\n请检查 API Base URL 是否正确，确保 URL 末尾没有多余的斜杠",
            content_type
        ));
    }
}
```

**效果**：

- ✅ 检测 HTML 响应并返回友好错误
- ✅ 提示用户检查 URL 格式
- ✅ 避免前端 JSON 解析错误

---

### 修复 2：前端 - 规范化 Base URL

**文件**：`src/components/AISettingsTab.tsx`

**改动**：

```typescript
// 规范化 Base URL：去除末尾的斜杠
const normalizeBaseUrl = (url: string): string => {
  return url.replace(/\/+$/, '');
};

// 使用规范化后的 URL
const baseUrl = normalizeBaseUrl(editingProvider.baseUrl || 'https://api.openai.com/v1');
const data = await httpGet(`${baseUrl}/models`, editingProvider.apiKey);
```

**效果**：

- ✅ 自动去除末尾的单个或多个斜杠
- ✅ 避免 URL 拼接产生双斜杠
- ✅ 用户无需手动调整 URL 格式

---

### 修复 3：前端 - 改进错误提示

**文件**：`src/components/AISettingsTab.tsx`

**改动**：

```typescript
// 检测常见错误并提供友好提示
if (errorMessage.includes('HTML 页面')) {
  errorMessage =
    '❌ API 返回了网页而不是数据\n\n可能的原因：\n1. Base URL 末尾有多余的斜杠（/）\n2. Base URL 路径不正确\n3. 该服务不支持标准的 /models 端点\n\n建议：\n• 确保 URL 格式为：https://example.com/v1\n• 去掉末尾的斜杠';
} else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
  errorMessage =
    '❌ API Key 无效或已过期\n\n请检查：\n• API Key 是否正确复制（没有多余空格）\n• API Key 是否有访问权限\n• API Key 是否已过期';
} else if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
  errorMessage =
    '❌ 找不到 API 端点\n\n请检查：\n• Base URL 是否正确\n• 该服务是否支持 /models 端点\n• URL 路径是否完整（如：/v1）';
}
```

**效果**：

- ✅ 根据错误类型提供具体的排查建议
- ✅ 用户能快速定位问题原因
- ✅ 减少用户试错时间

---

### 修复 4：前端 - 添加 URL 输入提示

**文件**：`src/components/AISettingsTab.tsx`

**改动**：

```tsx
<p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
  ⚠️ 请确保 URL 末尾<strong>没有斜杠</strong>（例如：
  <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">/v1</code> 而不是{' '}
  <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">/v1/</code>）
</p>
```

**效果**：

- ✅ 在输入框下方显示格式提示
- ✅ 预防用户输入错误格式
- ✅ 提供正确和错误示例对比

---

### 修复 5：前端 - 改进错误显示样式

**文件**：`src/components/AISettingsTab.tsx`

**改动**：

```tsx
<div className="mb-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
  <div className="flex items-start gap-2">
    <span className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5">⚠️</span>
    <div className="flex-1">
      <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-1">获取模型列表失败</p>
      <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap font-sans">
        {fetchError}
      </pre>
    </div>
  </div>
</div>
```

**效果**：

- ✅ 错误信息更醒目
- ✅ 支持多行错误提示
- ✅ 保留换行格式，便于阅读

---

## 🧪 测试场景

### 场景 1：URL 末尾有斜杠

- **输入**：`https://apis.861861.xyz/v1/`
- **修复前**：请求 `/v1//models`，返回 HTML，JSON 解析错误
- **修复后**：自动规范化为 `/v1/models`，正常获取模型列表

### 场景 2：API 返回 HTML 错误页面

- **输入**：错误的 Base URL
- **修复前**：`Unexpected token '<', "<!doctype "...`
- **修复后**：`❌ API 返回了网页而不是数据\n\n可能的原因：...`

### 场景 3：API Key 无效

- **输入**：错误的 API Key
- **修复前**：`HTTP 401: Unauthorized`
- **修复后**：`❌ API Key 无效或已过期\n\n请检查：...`

### 场景 4：网络连接失败

- **输入**：无法访问的服务器
- **修复前**：`connection error`
- **修复后**：`❌ 网络连接失败\n\n请检查：...`

---

## 📊 修复效果对比

| 问题           | 修复前                 | 修复后                    |
| -------------- | ---------------------- | ------------------------- |
| **URL 双斜杠** | `/v1//models` 404 错误 | 自动规范化为 `/v1/models` |
| **HTML 响应**  | JSON 解析错误          | 友好提示：检查 URL 格式   |
| **错误提示**   | 技术性错误信息         | 分类错误 + 排查建议       |
| **用户体验**   | 不知道如何修复         | 明确知道问题和解决方案    |

---

## 🎯 用户操作指南

### 正确的 Base URL 格式

✅ **正确**：

- `https://api.openai.com/v1`
- `https://apis.861861.xyz/v1`
- `https://api.example.com/v1`

❌ **错误**：

- `https://api.openai.com/v1/`（末尾有斜杠）
- `https://apis.861861.xyz/v1//`（多个斜杠）
- `https://api.example.com`（缺少路径）

### 常见错误排查

1. **HTML 页面错误**
   - 检查 Base URL 是否正确
   - 去掉末尾的斜杠
   - 确认路径完整（如 `/v1`）

2. **401 认证错误**
   - 检查 API Key 是否正确
   - 确认 Key 没有多余空格
   - 验证 Key 是否有权限

3. **404 找不到端点**
   - 确认服务支持 `/models` 端点
   - 检查 Base URL 路径是否完整
   - 联系服务提供商确认 API 格式

4. **网络连接失败**
   - 检查网络连接
   - 确认服务器地址可访问
   - 检查是否需要代理

---

## 📝 技术细节

### URL 规范化逻辑

```typescript
const normalizeBaseUrl = (url: string): string => {
  return url.replace(/\/+$/, '');
};
```

- 使用正则表达式 `/\/+$/` 匹配末尾的一个或多个斜杠
- 替换为空字符串，去除所有末尾斜杠
- 保留 URL 的其他部分不变

### Content-Type 检测逻辑

```rust
let content_type = resp.headers()
    .get("content-type")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("");

if !content_type.contains("application/json") && !content_type.contains("text/json") {
    if text.trim_start().to_lowercase().starts_with("<!doctype")
        || text.trim_start().to_lowercase().starts_with("<html") {
        return Err(...);
    }
}
```

- 检查响应头的 Content-Type
- 如果不是 JSON 类型，检查内容是否为 HTML
- 提供友好的错误提示

---

## ✅ 验证清单

- [x] 后端添加 Content-Type 验证
- [x] 前端自动规范化 Base URL
- [x] 改进错误提示信息
- [x] 添加 URL 格式提示
- [x] 改进错误显示样式
- [x] 代码编译通过（无 TypeScript/Rust 错误）
- [x] 支持多种错误场景的友好提示

---

## 🚀 后续建议

1. **添加 URL 格式验证**
   - 在保存前验证 URL 格式
   - 自动修正常见错误（如末尾斜杠）

2. **添加连接测试功能**
   - 在保存前测试 API 连接
   - 显示连接状态和延迟

3. **支持更多 API 格式**
   - 检测并适配不同的 API 响应格式
   - 支持非标准的模型列表端点

4. **添加调试模式**
   - 显示完整的请求和响应
   - 帮助用户排查复杂问题

---

**修复完成时间**：2026-04-24  
**修复版本**：v1.0.0  
**影响范围**：AI 提供商配置功能
