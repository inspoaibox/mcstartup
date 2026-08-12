# 模型切换功能实现

## 功能概述

添加了"@模型"按钮，允许用户在对话过程中切换 AI 提供商和模型。这个功能配合记忆系统，让用户可以在保留对话历史和记忆的同时使用不同的模型。

## 实现内容

### 1. 后端更新

#### 数据库函数 (`src-tauri/src/ai_chat_db.rs`)

```rust
pub fn update_thread_model(&self, thread_id: &str, provider_id: &str, model: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    self.conn.execute(
        "UPDATE chat_threads SET provider_id = ?, model = ?, updated_at = ? WHERE id = ?",
        params![provider_id, model, now, thread_id],
    )?;
    Ok(())
}
```

#### Tauri 命令 (`src-tauri/src/ai_chat_commands.rs`)

```rust
#[derive(Debug, Deserialize)]
pub struct UpdateThreadModelRequest {
    pub thread_id: String,
    pub provider_id: String,
    pub model: String,
}

#[tauri::command]
pub fn ai_chat_update_thread_model(
    state: State<AiChatState>,
    request: UpdateThreadModelRequest,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.update_thread_model(&request.thread_id, &request.provider_id, &request.model)
        .map_err(|e| e.to_string())
}
```

#### 命令注册 (`src-tauri/src/main.rs`)

- 添加 `ai_chat_commands::ai_chat_update_thread_model` 到命令列表

### 2. 前端 API (`src/api/aiChatApi.ts`)

```typescript
export async function updateThreadModel(request: {
  thread_id: string;
  provider_id: string;
  model: string;
}): Promise<void> {
  return await invoke('ai_chat_update_thread_model', { request });
}
```

### 3. 切换模型对话框 (`src/components/SwitchModelDialog.tsx`)

新建组件，提供模型切换界面：

**功能特性：**

- 显示当前使用的提供商和模型
- 选择新的 AI 提供商
- 选择新的模型（支持下拉列表或手动输入）
- 显示可用模型数量
- 只有在选择不同模型时才能切换
- 提示信息：切换后新对话使用新模型，历史消息保持不变

**UI 设计：**

- 使用 Gemini 风格的颜色和圆角
- 蓝色渐变图标（Sparkles）
- 当前模型显示在蓝色卡片中
- 提供商和模型选择器
- 黄色提示卡片

### 4. ChatInterface 更新 (`src/components/ChatInterface.tsx`)

#### 添加的功能：

1. **@模型按钮**
   - 位置：工具栏左侧，在"参数"和"记忆"按钮旁边
   - 图标：AtSign (@)
   - 点击打开切换模型对话框

2. **切换模型处理函数**

```typescript
const handleSwitchModel = async (providerId: string, model: string) => {
  try {
    await aiChatApi.updateThreadModel({
      thread_id: threadId,
      provider_id: providerId,
      model: model,
    });

    // 重新加载线程数据
    const threadData = await aiChatApi.getThread(threadId);
    setThread(threadData);
    setShowSwitchModel(false);

    // 通知父组件线程已更新
    if (onThreadUpdated) {
      onThreadUpdated();
    }

    alert(`已切换到 ${model}`);
  } catch (error) {
    console.error('Failed to switch model:', error);
    alert('切换模型失败：' + error);
  }
};
```

3. **布局优化**
   - 移除了底部的提示信息："AI 可能会显示不准确的信息，请仔细核对其回复。"
   - 固定顶部标题栏（在 AIChatPanel 中）
   - 固定底部输入框，添加 `pb-4` 间距
   - 中间聊天内容区域可滚动
   - 欢迎界面也采用相同的布局结构

### 5. AIChatPanel 更新 (`src/components/AIChatPanel.tsx`)

添加 `onThreadUpdated` 回调，传递给 ChatInterface：

```typescript
<ChatInterface
  threadId={activeThreadId}
  userId="default-user"
  enableMemory={true}
  onShowMemoryPanel={() => setShowMemoryPanel(true)}
  onThreadUpdated={loadThreads}
  onTitleGenerated={(title) => {
    // ...
  }}
/>
```

## 使用流程

1. 用户在对话界面点击"@模型"按钮
2. 打开切换模型对话框
3. 选择新的 AI 提供商
4. 选择新的模型
5. 点击"切换模型"按钮
6. 系统更新线程的提供商和模型
7. 显示切换成功提示
8. 后续对话使用新模型
9. 历史消息和记忆保持不变

## 布局结构

### 整体布局（固定结构）

```
┌─────────────────────────────────────┐
│  顶部标题栏（固定）                    │
│  - 模型名称                           │
│  - 提供商名称                         │
├─────────────────────────────────────┤
│                                     │
│  聊天内容区域（可滚动）                │
│  - 用户消息                           │
│  - AI 回复                            │
│  - ...                               │
│                                     │
├─────────────────────────────────────┤
│  输入框区域（固定，有底部间距）         │
│  - 相关记忆显示                       │
│  - 参数面板                           │
│  - 输入框                             │
│  - 工具按钮：+ 参数 记忆 @模型         │
│  - 发送按钮                           │
│  [底部间距 pb-4]                      │
└─────────────────────────────────────┘
```

## 技术细节

### Flexbox 布局

```tsx
<div className="flex h-full flex-col">
  {/* 可滚动区域 */}
  <div className="flex-1 overflow-y-auto">{/* 内容 */}</div>

  {/* 固定底部 */}
  <div className="flex-shrink-0 px-4 pb-4">{/* 输入框 */}</div>
</div>
```

### 样式说明

- `flex-1`：占据剩余空间
- `overflow-y-auto`：垂直滚动
- `flex-shrink-0`：不收缩，保持固定
- `pb-4`：底部间距 16px

## 与记忆系统的配合

切换模型后：

- ✅ 对话历史保留
- ✅ 用户记忆保留
- ✅ 新对话使用新模型
- ✅ 记忆会注入到新模型的上下文中
- ✅ 提供商配置独立管理

## 测试建议

1. 测试切换到不同提供商
2. 测试切换到相同提供商的不同模型
3. 验证切换后对话使用新模型
4. 确认历史消息正确显示
5. 验证记忆系统继续工作
6. 测试布局：顶部固定、中间滚动、底部固定
7. 检查底部间距是否合适
8. 测试深色模式

## 相关文件

- `src-tauri/src/ai_chat_db.rs` - 数据库更新函数
- `src-tauri/src/ai_chat_commands.rs` - Tauri 命令
- `src-tauri/src/main.rs` - 命令注册
- `src/api/aiChatApi.ts` - 前端 API
- `src/components/SwitchModelDialog.tsx` - 切换模型对话框（新建）
- `src/components/ChatInterface.tsx` - 主要更新
- `src/components/AIChatPanel.tsx` - 回调传递

## 未来改进

1. 添加模型切换历史记录
2. 支持批量切换多个对话的模型
3. 添加模型性能对比功能
4. 支持模型切换时的参数迁移
5. 添加模型推荐功能
