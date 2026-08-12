# Message Primitive 适配分析

## 文档要求 vs 当前实现

### ✅ 已实现的功能

#### 1. **基础结构**

- ✅ `MessagePrimitive.Root` - 消息容器
- ✅ `MessagePrimitive.Content` - 内容渲染（已使用）
- ✅ `ActionBarPrimitive` - 操作栏（复制、点赞、重新生成等）
- ✅ `AuiIf` - 条件渲染（用户/助手消息分支）
- ✅ Hover 状态 - 自动跟踪鼠标悬停

#### 2. **ActionBar 功能**

- ✅ `ActionBarPrimitive.Copy` - 复制消息
- ✅ `ActionBarPrimitive.FeedbackPositive` - 点赞
- ✅ `ActionBarPrimitive.FeedbackNegative` - 点踩
- ✅ `ActionBarPrimitive.Reload` - 重新生成
- ✅ 自动隐藏/显示（hover 时显示）

#### 3. **样式和布局**

- ✅ Gemini 风格设计
- ✅ 用户消息右对齐气泡
- ✅ 助手消息左对齐带图标
- ✅ 深色模式支持
- ✅ 响应式布局

### ⚠️ 部分实现的功能

#### 1. **MessagePrimitive.Parts** (推荐使用)

**文档推荐**: 使用 `MessagePrimitive.Parts` 替代 `MessagePrimitive.Content`

```typescript
// 推荐的新 API
<MessagePrimitive.Parts>
  {({ part }) => {
    if (part.type === "text") return <MyTextRenderer />;
    if (part.type === "image") return <MyImageRenderer />;
    if (part.type === "tool-call") return part.toolUI ?? <GenericToolUI />;
    return null;
  }}
</MessagePrimitive.Parts>
```

**当前实现**: 使用的是 `MessagePrimitive.Content`（旧 API，但仍然有效）

```typescript
<MessagePrimitive.Content />
```

**影响**:

- ✅ 功能正常工作
- ⚠️ 使用的是旧 API
- ⚠️ 无法自定义不同类型内容的渲染

#### 2. **MessagePartPrimitive** (文本渲染细节)

**文档提供**: 更细粒度的内容控制

```typescript
<MessagePartPrimitive.Text />
<MessagePartPrimitive.Image />
<MessagePartPrimitive.InProgress>
  <span className="animate-pulse">▊</span>
</MessagePartPrimitive.InProgress>
```

**当前实现**: 使用 `MessagePrimitive.Content` 自动处理

**影响**:

- ✅ 基础文本显示正常
- ❌ 没有自定义流式输入指示器
- ❌ 没有图片部分的自定义渲染

### ❌ 未实现的功能

#### 1. **MessagePrimitive.Attachments** (消息中的附件显示)

**文档要求**: 在消息中显示已发送的附件

```typescript
<MessagePrimitive.Attachments>
  {({ attachment }) => {
    if (attachment.type === "image") {
      const imageSrc = attachment.content?.find((part) => part.type === "image")?.image;
      return <img src={imageSrc} alt={attachment.name} />;
    }
    if (attachment.type === "document") {
      return <div>📄 {attachment.name}</div>;
    }
    return null;
  }}
</MessagePrimitive.Attachments>
```

**当前实现**: ❌ 未实现

**影响**:

- ❌ 用户发送的图片不会在消息中显示
- ❌ 用户发送的文件不会在消息中显示
- ❌ 只能在 Composer 中看到待发送的附件

#### 2. **MessagePrimitive.Error** (错误显示)

**文档要求**: 显示消息错误

```typescript
<MessagePrimitive.Error>
  <ErrorPrimitive.Root className="mt-2 rounded-md bg-destructive/10 p-2">
    <ErrorPrimitive.Message />
  </ErrorPrimitive.Root>
</MessagePrimitive.Error>
```

**当前实现**: ❌ 未实现

**影响**:

- ❌ AI 调用失败时没有错误提示
- ❌ 用户不知道消息发送失败

#### 3. **MessagePrimitive.Quote** (引用消息)

**文档要求**: 显示引用的消息

```typescript
<MessagePrimitive.Quote>
  {({ text, messageId }) => (
    <blockquote className="mb-2 border-l pl-3 italic">
      {text}
    </blockquote>
  )}
</MessagePrimitive.Quote>
```

**当前实现**: ❌ 未实现

**影响**:

- ❌ 无法引用之前的消息
- ❌ 无法实现"回复"功能

#### 4. **Tool UI** (工具调用显示)

**文档要求**: 显示 AI 工具调用（如函数调用、搜索等）

```typescript
<MessagePrimitive.Parts
  components={{
    tools: {
      by_name: {
        get_weather: ({ result }) => <div>Weather: {result.temp}°F</div>,
      },
      Fallback: ({ toolName }) => <div>Tool: {toolName}</div>,
    },
  }}
/>
```

**当前实现**: ❌ 未实现

**影响**:

- ❌ 无法显示 AI 使用的工具
- ❌ 无法显示函数调用结果
- ❌ 无法实现 Agent 工作流可视化

#### 5. **Streaming Indicator** (流式输入指示器)

**文档要求**: 显示 AI 正在输入的指示器

```typescript
<MessagePartPrimitive.InProgress>
  <span className="animate-pulse">▊</span>
</MessagePartPrimitive.InProgress>
```

**当前实现**: ❌ 未实现

**影响**:

- ❌ 用户不知道 AI 是否正在生成回复
- ❌ 没有"正在输入..."的视觉反馈

#### 6. **BranchPicker** (分支选择器)

**文档提到**: 用于在多个 AI 回复之间切换

**当前实现**: ❌ 未实现

**影响**:

- ❌ 无法查看 AI 的多个回复版本
- ❌ 无法在不同回复之间切换

#### 7. **Edit Message** (编辑消息)

**文档提到**: 编辑已发送的消息

**当前实现**: ❌ 未实现

**影响**:

- ❌ 无法编辑已发送的消息
- ❌ 无法修正输入错误

## 优先级建议

### 🔴 高优先级（影响核心功能）

1. **MessagePrimitive.Attachments** - 显示已发送的附件
   - 用户发送图片后应该能在消息中看到
   - 这是附件功能的完整闭环

2. **MessagePrimitive.Error** - 错误显示
   - AI 调用失败时必须有提示
   - 提升用户体验和调试能力

3. **Streaming Indicator** - 流式输入指示器
   - 让用户知道 AI 正在工作
   - 避免用户以为系统卡住

### 🟡 中优先级（增强功能）

4. **MessagePrimitive.Parts** - 升级到新 API
   - 更好的类型支持
   - 更灵活的内容渲染

5. **Tool UI** - 工具调用显示
   - 如果使用支持函数调用的模型
   - 可视化 AI 的工作过程

### 🟢 低优先级（高级功能）

6. **MessagePrimitive.Quote** - 引用消息
   - 实现"回复"功能
   - 提升对话体验

7. **BranchPicker** - 分支选择器
   - 查看多个 AI 回复
   - 高级用户功能

8. **Edit Message** - 编辑消息
   - 修正输入错误
   - 便利功能

## 当前实现评分

| 功能类别       | 完成度    | 评分                          |
| -------------- | --------- | ----------------------------- |
| 基础消息显示   | 100%      | ✅ 优秀                       |
| ActionBar 操作 | 100%      | ✅ 优秀                       |
| 样式和布局     | 100%      | ✅ 优秀                       |
| 附件显示       | 0%        | ❌ 缺失                       |
| 错误处理       | 0%        | ❌ 缺失                       |
| 流式指示器     | 0%        | ❌ 缺失                       |
| 工具调用       | 0%        | ❌ 缺失                       |
| 引用/编辑      | 0%        | ❌ 缺失                       |
| **总体评分**   | **37.5%** | ⚠️ 基础功能完整，高级功能缺失 |

## 建议的实现顺序

### 第一阶段：完善核心功能

1. ✅ 添加 MessagePrimitive.Attachments（显示已发送的图片和文件）
2. ✅ 添加 MessagePrimitive.Error（错误提示）
3. ✅ 添加流式输入指示器

### 第二阶段：升级 API

4. 升级到 MessagePrimitive.Parts（新 API）
5. 使用 MessagePartPrimitive 细化渲染

### 第三阶段：高级功能

6. 添加 Tool UI 支持（如果需要）
7. 添加 Quote 功能
8. 添加 BranchPicker
9. 添加 Edit 功能

## 代码示例：完整适配

### 推荐的 GeminiMessage 实现

```typescript
const GeminiMessage = () => {
  return (
    <MessagePrimitive.Root className="group/message relative mx-auto mb-4 flex w-full max-w-3xl flex-col px-4">
      {/* 用户消息 */}
      <AuiIf condition={(s) => s.message.role === 'user'}>
        <div className="flex flex-col items-end gap-2">
          {/* 附件显示 */}
          <MessagePrimitive.Attachments>
            {({ attachment }) => {
              if (attachment.type === 'image' && attachment.file) {
                return (
                  <img
                    src={URL.createObjectURL(attachment.file)}
                    alt={attachment.name}
                    className="max-w-xs rounded-lg"
                  />
                );
              }
              if (attachment.type === 'document') {
                return (
                  <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <FileText size={16} />
                    <span className="text-sm">{attachment.name}</span>
                  </div>
                );
              }
              return null;
            }}
          </MessagePrimitive.Attachments>

          {/* 消息内容 */}
          <div className="flex items-center gap-1">
            <ActionBarPrimitive.Root className="flex items-center gap-0.5 pt-1 opacity-0 transition-opacity group-hover/message:opacity-100">
              <ActionBarPrimitive.Copy className="flex size-8 items-center justify-center rounded-full text-[#444746] hover:bg-[#444746]/8">
                <Copy size={14} />
              </ActionBarPrimitive.Copy>
            </ActionBarPrimitive.Root>
            <div className="max-w-[85%] rounded-3xl bg-[#e9eef6] px-4 py-3">
              <MessagePrimitive.Parts>
                {({ part }) => {
                  if (part.type === 'text') {
                    return (
                      <div className="whitespace-pre-wrap text-[#1f1f1f]">
                        <MessagePartPrimitive.Text />
                      </div>
                    );
                  }
                  return null;
                }}
              </MessagePrimitive.Parts>
            </div>
          </div>
        </div>
      </AuiIf>

      {/* 助手消息 */}
      <AuiIf condition={(s) => s.message.role === 'assistant'}>
        <div className="flex items-start gap-3">
          <Sparkles className="mt-1 size-5 shrink-0 text-[#0066ff]" />
          <div className="min-w-0 flex-1">
            {/* 消息内容 */}
            <div className="prose prose-sm dark:prose-invert">
              <MessagePrimitive.Parts>
                {({ part }) => {
                  if (part.type === 'text') {
                    return (
                      <div>
                        <MessagePartPrimitive.Text />
                        <MessagePartPrimitive.InProgress>
                          <span className="ml-1 inline-block animate-pulse">▊</span>
                        </MessagePartPrimitive.InProgress>
                      </div>
                    );
                  }
                  if (part.type === 'tool-call') {
                    return part.toolUI ?? (
                      <div className="my-2 rounded-lg border p-2 text-sm">
                        🔧 {part.toolName}
                      </div>
                    );
                  }
                  return null;
                }}
              </MessagePrimitive.Parts>
            </div>

            {/* 错误显示 */}
            <MessagePrimitive.Error>
              <div className="mt-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-2 text-sm text-red-600 dark:text-red-400">
                <ErrorPrimitive.Message />
              </div>
            </MessagePrimitive.Error>

            {/* 操作栏 */}
            <ActionBarPrimitive.Root className="mt-2 -ml-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100">
              <ActionBarPrimitive.FeedbackPositive className="flex size-8 items-center justify-center rounded-full hover:bg-[#444746]/8">
                <ThumbsUp size={14} />
              </ActionBarPrimitive.FeedbackPositive>
              <ActionBarPrimitive.FeedbackNegative className="flex size-8 items-center justify-center rounded-full hover:bg-[#444746]/8">
                <ThumbsDown size={14} />
              </ActionBarPrimitive.FeedbackNegative>
              <ActionBarPrimitive.Reload className="flex size-8 items-center justify-center rounded-full hover:bg-[#444746]/8">
                <RotateCw size={14} />
              </ActionBarPrimitive.Reload>
              <ActionBarPrimitive.Copy className="flex size-8 items-center justify-center rounded-full hover:bg-[#444746]/8">
                <Copy size={14} />
              </ActionBarPrimitive.Copy>
            </ActionBarPrimitive.Root>
          </div>
        </div>
      </AuiIf>
    </MessagePrimitive.Root>
  );
};
```

## 总结

### 当前状态

- ✅ **基础功能完整**: 消息显示、操作栏、样式都很好
- ⚠️ **附件功能不完整**: 可以添加附件，但发送后看不到
- ❌ **缺少错误处理**: 失败时没有提示
- ❌ **缺少流式指示器**: 不知道 AI 是否在工作

### 建议

1. **立即实现**: MessagePrimitive.Attachments（显示已发送的附件）
2. **立即实现**: MessagePrimitive.Error（错误提示）
3. **立即实现**: 流式输入指示器
4. **后续优化**: 升级到 MessagePrimitive.Parts 新 API
5. **可选功能**: Tool UI、Quote、BranchPicker、Edit

### 评价

当前实现是一个**功能基础但不完整**的版本。基础的消息显示和操作功能都很好，但缺少一些关键的用户体验功能（附件显示、错误提示、流式指示器）。建议优先完善这些核心功能，然后再考虑高级功能。
