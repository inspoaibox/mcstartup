# HTTP 403 Forbidden 错误处理指南

## 🐛 问题描述

用户在添加 AI 提供商配置后，点击"获取所有模型"按钮时出现错误：

```
Failed to fetch models: HTTP 403: Forbidden
```

## 🔍 错误分析

### **HTTP 403 Forbidden 含义**

- **403** 是 HTTP 状态码，表示"禁止访问"
- 服务器理解请求，但**拒绝执行**
- 与 401（未认证）不同，403 表示**已认证但无权限**

### **常见原因**

| 原因                 | 说明                              | 可能性 |
| -------------------- | --------------------------------- | ------ |
| **API Key 权限不足** | Key 没有访问 `/models` 端点的权限 | 🔴 高  |
| **配额已用完**       | API Key 的使用配额已耗尽          | 🔴 高  |
| **访问范围限制**     | Key 被限制只能访问特定端点        | 🟡 中  |
| **IP 地址限制**      | 服务器限制了访问 IP 白名单        | 🟡 中  |
| **地区限制**         | 服务器限制了访问地区              | 🟢 低  |
| **速率限制**         | 请求频率超过限制                  | 🟢 低  |

---

## ✅ 解决方案

### **方案 1：检查 API Key 权限**

**步骤**：

1. 登录服务提供商的控制台
2. 检查 API Key 的权限设置
3. 确认 Key 是否有访问 `/models` 端点的权限
4. 如果没有，重新生成一个具有完整权限的 Key

**示例（OpenAI）**：

- 访问：https://platform.openai.com/api-keys
- 检查 Key 的权限范围
- 确保 Key 有 "Read" 权限

---

### **方案 2：检查配额使用情况**

**步骤**：

1. 登录服务提供商的控制台
2. 查看账户余额或配额使用情况
3. 确认是否还有可用配额
4. 如果配额已用完，充值或等待配额重置

**常见配额类型**：

- **免费配额**：每月固定额度
- **付费配额**：按使用量计费
- **请求次数限制**：每分钟/每小时请求次数

---

### **方案 3：跳过模型获取，手动输入**

如果服务不支持获取模型列表，可以：

**步骤**：

1. 不点击"获取所有模型"按钮
2. 直接在"可用模型"字段手动输入模型名称
3. 保存配置

**常见模型名称**：

- OpenAI：`gpt-4o`, `gpt-4o-mini`, `gpt-3.5-turbo`
- Claude：`claude-3-5-sonnet-20241022`, `claude-3-opus-20240229`
- Gemini：`gemini-2.0-flash-exp`, `gemini-1.5-pro`

---

### **方案 4：联系服务提供商**

如果以上方案都无效：

**需要确认的信息**：

- API Key 是否有效
- 是否有访问限制
- 是否支持 `/models` 端点
- 是否有 IP 白名单限制

---

## 🔧 代码修复

### **改进的错误提示**

**文件**：`src/components/AISettingsTab.tsx`

**改动**：

```typescript
} else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
  errorMessage =
    '❌ 访问被拒绝（403 Forbidden）\n\n可能的原因：\n1. API Key 没有访问权限\n2. API Key 配额已用完\n3. 该服务限制了访问范围\n4. IP 地址被限制\n\n建议：\n• 检查 API Key 是否有效\n• 确认 Key 的权限范围\n• 查看服务商的配额使用情况\n• 联系服务提供商确认访问限制\n\n提示：\n• 某些中转服务可能不支持获取模型列表\n• 可以跳过此步骤，手动输入模型名称';
}
```

**效果**：

- ✅ 明确说明 403 错误的含义
- ✅ 列出可能的原因
- ✅ 提供具体的排查步骤
- ✅ 提示可以跳过自动获取，手动输入

---

## 📊 错误码对比

| 状态码  | 含义                  | 原因                 | 解决方案            |
| ------- | --------------------- | -------------------- | ------------------- |
| **401** | Unauthorized          | API Key 无效或未提供 | 检查 Key 是否正确   |
| **403** | Forbidden             | 已认证但无权限       | 检查 Key 权限和配额 |
| **404** | Not Found             | 端点不存在           | 检查 URL 是否正确   |
| **429** | Too Many Requests     | 请求频率过高         | 降低请求频率或等待  |
| **500** | Internal Server Error | 服务器内部错误       | 联系服务提供商      |

---

## 🎯 针对 `apis.861861.xyz` 的建议

### **可能的原因**

1. **中转服务限制**
   - 该服务可能不支持 `/models` 端点
   - 可能需要特殊的认证方式
   - 可能有 IP 白名单限制

2. **API Key 权限**
   - 检查 Key 是否有完整权限
   - 确认 Key 是否已激活
   - 查看 Key 的配额使用情况

### **推荐操作**

1. **跳过自动获取**

   ```
   不点击"获取所有模型"按钮
   直接保存配置
   在新建对话时手动选择模型
   ```

2. **手动配置模型列表**

   ```
   在"可用模型"字段输入：
   gpt-4o
   gpt-4o-mini
   gpt-3.5-turbo
   claude-3-5-sonnet-20241022
   ```

3. **联系服务商**
   ```
   询问：
   - 是否支持 /models 端点
   - API Key 需要什么权限
   - 是否有访问限制
   ```

---

## 🧪 测试方法

### **方法 1：使用 curl 测试**

```bash
# 测试 API Key 是否有效
curl https://apis.861861.xyz/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"

# 预期响应：
# - 200 OK + JSON 数据 → API Key 有效且有权限
# - 401 Unauthorized → API Key 无效
# - 403 Forbidden → API Key 有效但无权限
# - 404 Not Found → 端点不存在
```

### **方法 2：使用浏览器测试**

```
1. 打开浏览器开发者工具（F12）
2. 访问：https://apis.861861.xyz/v1/models
3. 查看响应状态码和内容
```

### **方法 3：使用 Postman 测试**

```
1. 创建新请求：GET https://apis.861861.xyz/v1/models
2. 添加 Header：Authorization: Bearer YOUR_API_KEY
3. 发送请求
4. 查看响应
```

---

## 📝 用户操作指南

### **遇到 403 错误时的操作步骤**

1. **不要惊慌**
   - 403 错误很常见
   - 通常是权限配置问题
   - 可以通过调整配置解决

2. **检查 API Key**

   ```
   ✓ Key 是否正确复制
   ✓ Key 是否有多余空格
   ✓ Key 是否已过期
   ✓ Key 是否有足够权限
   ```

3. **查看配额**

   ```
   ✓ 登录服务商控制台
   ✓ 查看账户余额
   ✓ 查看使用情况
   ✓ 确认是否还有配额
   ```

4. **尝试手动配置**

   ```
   ✓ 跳过"获取所有模型"
   ✓ 手动输入模型名称
   ✓ 保存配置
   ✓ 在对话中测试
   ```

5. **联系支持**
   ```
   如果以上都无效：
   ✓ 联系服务提供商
   ✓ 说明遇到的问题
   ✓ 提供错误信息
   ✓ 询问解决方案
   ```

---

## 🚀 后续改进建议

### **1. 添加"跳过获取"选项**

在界面上添加一个选项，允许用户跳过自动获取模型列表：

```typescript
<div className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={skipModelFetch}
    onChange={(e) => setSkipModelFetch(e.target.checked)}
  />
  <label>跳过自动获取，手动输入模型名称</label>
</div>
```

### **2. 添加模型名称输入框**

允许用户直接输入模型名称列表：

```typescript
<textarea
  placeholder="每行一个模型名称，例如：&#10;gpt-4o&#10;gpt-4o-mini&#10;claude-3-5-sonnet-20241022"
  value={manualModels}
  onChange={(e) => setManualModels(e.target.value)}
  rows={5}
/>
```

### **3. 添加连接测试功能**

在保存前测试 API 连接：

```typescript
const testConnection = async () => {
  try {
    // 发送简单的测试请求
    await httpGet(`${baseUrl}/models`, apiKey);
    alert('✓ 连接成功！');
  } catch (error) {
    alert(`✗ 连接失败：${error.message}`);
  }
};
```

### **4. 添加常见服务预设**

为常见的中转服务提供预设配置：

```typescript
const presets = {
  'apis.861861.xyz': {
    baseUrl: 'https://apis.861861.xyz/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet-20241022'],
    skipModelFetch: true,
  },
  // 其他预设...
};
```

---

## ✅ 验证清单

- [x] 添加 403 错误的友好提示
- [x] 说明可能的原因
- [x] 提供具体的排查步骤
- [x] 提示可以跳过自动获取
- [x] 建议手动输入模型名称
- [ ] 添加"跳过获取"选项（后续改进）
- [ ] 添加手动输入模型列表功能（后续改进）
- [ ] 添加连接测试功能（后续改进）

---

**文档创建时间**：2026-04-24  
**适用版本**：v1.0.0  
**相关错误**：HTTP 403 Forbidden
