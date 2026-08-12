# AI 聊天功能实现文档

## 已完成功能 ✅

### 1. 后端实现（Rust + SQLite）

#### 数据库层 (`src-tauri/src/ai_chat_db.rs`)

- ✅ SQLite 数据库初始化
- ✅ `chat_threads` 表：存储对话线程
- ✅ `chat_messages` 表：存储消息历史
- ✅ 外键约束和索引优化
- ✅ 完整的 CRUD 操作

**线程管理功能：**

- 列出所有线程
- 获取单个线程
- 创建新线程
- 更新线程标题
- 归档/取消归档线程
- 删除线程（级联删除消息）
- 更新线程时间戳

**消息管理功能：**

- 列出线程的所有消息
- 添加新消息
- 删除单条消息
- 清空线程所有消息

**统计功能：**

- 获取线程消息数量
- 获取总线程数

#### 命令层 (`src-tauri/src/ai_chat_commands.rs`)

- ✅ 13 个 Tauri 命令
- ✅ 完整的错误处理
- ✅ 状态管理（AiChatState）

**已注册命令：**

```rust
ai_chat_list_threads
ai_chat_get_thread
ai_chat_create_thread
ai_chat_update_thread_title
ai_chat_archive_thread
ai_chat_unarchive_thread
ai_chat_delete_thread
ai_chat_list_messages
ai_chat_add_message
ai_chat_delete_message
ai_chat_clear_thread_messages
ai_chat_get_thread_message_count
ai_chat_get_total_threads
```

#### 集成 (`src-tauri/src/main.rs`)

- ✅ 模块注册
- ✅ 数据库初始化（`ai_chat.db`）
- ✅ 状态管理注册
- ✅ 所有命令注册到 Tauri

### 2. 前端实现（React + TypeScript）

#### 类型定义 (`src/types/aiChat.ts`)

- ✅ `ChatThread` 接口
- ✅ `ChatMessage` 接口
- ✅ 请求/响应类型
- ✅ Mem0 记忆类型（预留）

#### API 封装 (`src/api/aiChatApi.ts`)

- ✅ 完整的 API 函数封装
- ✅ TypeScript 类型安全
- ✅ 错误处理

#### Hooks (`src/hooks/useAiChatAdapter.tsx`)

- ✅ `useAiChatThreadListAdapter` - assistant-ui 适配器
- ✅ `useAiChatHistoryAdapter` - 消息历史适配器
- ✅ `loadThreadMessages` - 加载历史消息
- ✅ 完整的 ThreadListAdapter 实现

#### UI 组件 (`src/components/AIChatPanel.tsx`)

- ✅ 线程列表侧边栏
- ✅ 新建对话功能
- ✅ 线程切换
- ✅ 归档功能
- ✅ 删除功能
- ✅ 提供商切换
- ✅ 响应式布局
- ✅ 空状态提示

### 3. 多提供商支持

#### 设置管理 (`src/components/AISettingsTab.tsx`)

- ✅ 添加多个 AI 提供商配置
- ✅ 支持 OpenAI、Claude、Gemini、Azure、自定义服务
- ✅ 一键获取模型列表
- ✅ 模型管理（删除不需要的模型）
- ✅ 提供商切换
- ✅ 配置持久化

## 数据结构

### 数据库表结构

```sql
-- 线程表
CREATE TABLE chat_threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    provider_id TEXT NOT NULL,  -- 关联到 AI 提供商
    status TEXT NOT NULL DEFAULT 'regular',  -- 'regular' | 'archived'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 消息表
CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,  -- 'user' | 'assistant' | 'system'
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);
```

### 索引

- `idx_messages_thread_id` - 消息按线程查询优化
- `idx_threads_updated_at` - 线程按更新时间排序优化

## 下一步集成（待完成）

### 1. 完善聊天界面 🔄

当前已实现基础聊天界面，包括：

- ✅ 消息显示（用户和 AI）
- ✅ 历史消息加载
- ✅ 基础输入框
- ✅ 多提供商 API 集成（OpenAI、Claude、Gemini、Azure、自定义）
- ✅ 消息持久化到 SQLite
- ✅ 自动标题生成

待优化功能：

- 🔄 流式响应显示
- 🔄 Markdown 渲染
- 🔄 代码高亮
- 🔄 消息编辑和重新生成
- 🔄 复制消息内容
- 🔄 消息时间戳显示

### 2. 实现 AI 模型适配器 🔄

根据不同提供商创建适配器：

```typescript
// OpenAI 适配器
const openaiAdapter = {
  async run({ messages, abortSignal }) {
    const response = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages,
        provider: activeProvider,
      }),
      signal: abortSignal,
    });
    // 处理流式响应
  },
};
```

### 3. 集成 Mem0 记忆功能（可选）🔄

添加用户记忆表：

```sql
CREATE TABLE user_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    memory TEXT NOT NULL,
    category TEXT NOT NULL,  -- 'preference' | 'fact' | 'context' | 'history'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

实现记忆提取和注入：

```typescript
// 在发送消息前注入相关记忆
const memories = await searchMemories(userId, query);
const systemPrompt = `你是一个有用的助手。

你记得关于用户的以下信息：
${memories.join('\n')}

使用这些信息来个性化你的回复。`;
```

### 4. 添加附件支持 🔄

扩展消息表支持附件：

```sql
ALTER TABLE chat_messages ADD COLUMN attachments TEXT;  -- JSON 格式
```

### 5. 实现自动标题生成 🔄

使用 AI 根据对话内容生成标题：

```typescript
async generateTitle(threadId: string) {
  const messages = await loadThreadMessages(threadId);
  const response = await callAI({
    prompt: `根据以下对话生成一个简短的标题（不超过50字）：\n${messages}`,
  });
  await updateThreadTitle(threadId, response);
}
```

## 功能特性

### ✅ 已实现

1. **多线程管理** - 创建、切换、归档、删除对话
2. **SQLite 持久化** - 所有数据本地存储
3. **多提供商支持** - OpenAI、Claude、Gemini、Azure、自定义服务
4. **线程列表侧边栏** - 清晰的对话历史
5. **消息历史** - 完整的消息持久化
6. **提供商切换** - 在不同 AI 服务间切换
7. **模型管理** - 获取和管理可用模型
8. **基础聊天界面** - 消息显示和输入
9. **AI API 集成** - 支持 5 种提供商的 API 调用
10. **自动标题生成** - 根据首条消息生成对话标题

### 🔄 开发中

1. **流式响应** - 实时显示 AI 回复（需要实现 async generator）
2. **Markdown 渲染** - 格式化显示 AI 回复
3. **代码高亮** - 代码块语法高亮
4. **消息操作** - 编辑、重新生成、复制消息

### 📋 计划中

1. **Mem0 记忆** - 个性化 AI 体验
2. **附件支持** - 图片、文件上传
3. **语音输入** - 语音转文字
4. **导出对话** - 导出为 Markdown/PDF
5. **搜索功能** - 搜索历史对话
6. **标签系统** - 为对话添加标签

## 使用示例

### 创建新对话

```typescript
const thread = await aiChatApi.createThread({
  title: '新对话',
  provider_id: activeProvider.id,
});
```

### 发送消息

```typescript
const message = await aiChatApi.addMessage({
  thread_id: threadId,
  role: 'user',
  content: '你好，AI！',
});
```

### 加载历史消息

```typescript
const messages = await aiChatApi.listMessages(threadId);
```

### 切换提供商

```typescript
await updateSettings({ activeAiProviderId: newProviderId });
```

## 数据流

```
用户输入
  ↓
前端组件 (AIChatPanel)
  ↓
API 封装 (aiChatApi)
  ↓
Tauri 命令 (ai_chat_commands)
  ↓
数据库层 (ai_chat_db)
  ↓
SQLite (ai_chat.db)
```

## 性能优化

1. **索引优化** - 为常用查询添加索引
2. **批量操作** - 支持批量插入消息
3. **懒加载** - 按需加载历史消息
4. **缓存** - 前端缓存线程列表
5. **虚拟滚动** - 大量消息时使用虚拟滚动

## 安全性

1. **API Key 加密** - 敏感信息本地加密存储
2. **SQL 注入防护** - 使用参数化查询
3. **输入验证** - 前后端双重验证
4. **错误处理** - 完善的错误处理机制

## 测试建议

1. **单元测试** - 测试数据库操作
2. **集成测试** - 测试 Tauri 命令
3. **E2E 测试** - 测试完整用户流程
4. **性能测试** - 测试大量数据场景

## 总结

当前已完成：

- ✅ 完整的后端持久化系统（SQLite）
- ✅ 前端 API 和适配器
- ✅ 线程管理 UI（创建、切换、归档、删除）
- ✅ 多提供商支持（5 种 AI 服务）
- ✅ 基础聊天界面（消息显示、输入、历史加载）
- ✅ AI API 集成（OpenAI、Claude、Gemini、Azure、自定义）
- ✅ 消息持久化和自动标题生成

下一步重点：

- 🔄 实现流式响应（async generator）
- 🔄 添加 Markdown 和代码高亮
- 🔄 优化用户体验（消息操作、时间戳等）
- 🔄 可选：集成 Mem0 记忆功能

整个系统架构清晰，核心功能已完成，可以进行基本的 AI 对话！
