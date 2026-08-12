# Design Document

## Overview

为 McStartUP（Tauri 1.5 + React 18）添加 MCP（Model Context Protocol）集成。由于应用无 Node.js 后端，MCP Client 逻辑在 Rust 后端实现，前端通过 Tauri invoke 与后端通信，并在 ChatModelAdapter.run() 中集成工具调用循环。

---

## Architecture

### 整体架构

前端层：
- Settings.tsx (McpSettingsPanel 嵌入)
  - 服务器列表 / 添加编辑删除 / 启用禁用开关
  - 禁用开关保存时同步调用 mcp_disconnect_server
  - 启用开关保存时同步调用 mcp_connect_server
  - 导出(脱敏)/导入(合并) JSON
- ChatInterface.tsx -> ChatModelAdapter.run()
  - invoke mcp_list_tools -> Vec<McpToolDef>
  - 按 provider 转换工具格式附加到 AI 请求
  - 流式解析工具调用意图
  - yield tool-call content part
  - invoke mcp_call_tool
  - yield tool-result content part
  - 继续下一轮 (最多 10 轮)
- ToolCard.tsx (新增)
- McpSettingsPanel.tsx (新增)

Rust 后端层：
- mcp_manager.rs (新增)
  - McpManager (tokio::sync::Mutex 包裹)
    - servers: HashMap<String, McpServerState>
    - tool_registry: HashMap<String, McpToolDef>
  - McpClient trait
  - StdioTransport  -- 子进程 stdin/stdout JSON-RPC
  - HttpSseTransport -- HTTP/SSE 连接
- mcp_commands.rs (新增)
  - mcp_list_tools
  - mcp_call_tool
  - mcp_connect_server  (同时重置 retry_count=0)
  - mcp_disconnect_server
  - mcp_get_servers_status
- settings.rs (修改)
  - AppSettings.mcp_servers: Vec<McpServerConfig>

通信方式：Tauri invoke (前端->后端) / Tauri emit (后端->前端)

### 数据流：工具调用循环

用户发送消息 -> ChatModelAdapter.run()
1. invoke mcp_list_tools -> Vec<McpToolDef>
2. 将工具定义转换为 provider 格式，附加到 AI 请求
3. 发起 AI 流式请求（fetch）
4. 检测响应中的工具调用意图
   - OpenAI:    choices[0].delta.tool_calls (跨 chunk 累积 arguments)
   - Anthropic: content_block_start(type=tool_use) + content_block_delta 累积 input
   - Gemini:    candidates[0].content.parts[].functionCall (单 chunk 完整)
5. yield { content: [{ type: 'tool-call', toolCallId, toolName, args }] }
   (同时通过 history adapter append 持久化到 SQLite)
6. invoke mcp_call_tool -> ToolResult
7. yield { content: [{ type: 'tool-result', toolCallId, result }] }
   (同时通过 history adapter append 持久化到 SQLite)
8. 将 tool-call + tool-result 追加到内存临时消息列表 localMessages
9. 继续下一轮 AI 请求（最多 10 轮，超出则终止返回最终文本）

---

## Components and Interfaces

### 1. Rust 数据结构

#### McpServerConfig（持久化配置，存入 AppSettings）

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,        // UUID
    pub name: String,
    pub transport: McpTransport,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum McpTransport {
    Stdio {
        command: String,               // e.g. "npx -y @modelcontextprotocol/server-filesystem"
        env: HashMap<String, String>,  // 可选环境变量键值对
    },
    HttpSse {
        url: String,                   // e.g. "http://localhost:3000/sse"
    },
}
```

#### McpServerState（运行时状态，不持久化）

```rust
pub struct McpServerState {
    pub config: McpServerConfig,
    pub status: McpServerStatus,
    pub tools: Vec<McpToolDef>,
    pub client: Option<Box<dyn McpClient + Send>>,
    pub retry_count: u32,   // 当前重连次数，手动重连时重置为 0
}

// 修复：tag+content 格式确保与 TypeScript 侧对称
// Disconnected -> { "type": "disconnected" }
// Error("msg") -> { "type": "error", "message": "msg" }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "message", rename_all = "camelCase")]
pub enum McpServerStatus {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}
```

#### McpToolDef（工具定义，合并到 Tool_Registry）

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDef {
    pub name: String,                    // 命名空间化后的名称，如 "filesystem/read_file"
    pub description: String,
    pub input_schema: serde_json::Value, // JSON Schema
    pub server_id: String,
    pub server_name: String,
    pub original_name: String,           // 原始工具名（用于调用时路由）
}
```

#### McpServerStatusInfo（Tauri command 返回类型，Rust 侧定义）

```rust
// 修复：补充 Rust 侧 struct，与 TypeScript 侧对称
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatusInfo {
    pub config: McpServerConfig,
    pub status: McpServerStatus,
    pub tools: Vec<McpToolDef>,
}
```

#### McpClient trait（抽象两种传输方式）

```rust
// 修复：补充 trait 方法签名，作为 StdioTransport / HttpSseTransport 的统一契约
#[async_trait::async_trait]
pub trait McpClient: Send + Sync {
    /// 执行 MCP initialize 握手，返回服务器能力声明
    async fn initialize(&mut self) -> Result<serde_json::Value>;
    /// 获取工具列表
    async fn list_tools(&mut self) -> Result<Vec<McpToolDef>>;
    /// 调用工具，返回工具执行结果
    async fn call_tool(&mut self, tool_name: &str, args: serde_json::Value) -> Result<serde_json::Value>;
    /// 检查连接是否存活
    fn is_connected(&self) -> bool;
    /// 关闭连接并清理资源（stdio 需终止子进程）
    async fn shutdown(&mut self) -> Result<()>;
}
```

#### McpManager（全局单例，注册为 Tauri State）

```rust
// 修复：改用 tokio::sync::Mutex 避免 async 上下文中持有同步锁跨 await 点导致死锁
pub struct McpManager {
    servers: HashMap<String, McpServerState>,
    app_handle: tauri::AppHandle,
}

impl McpManager {
    pub async fn connect_server(&mut self, config: &McpServerConfig) -> Result<()>;
    pub async fn disconnect_server(&mut self, server_id: &str) -> Result<()>;
    /// 调用工具，内部使用 tokio::time::timeout 限制 30s
    pub async fn call_tool(&self, tool_name: &str, args: serde_json::Value) -> Result<serde_json::Value>;
    pub fn list_tools(&self) -> Vec<McpToolDef>;
    pub fn get_servers_status(&self) -> Vec<McpServerStatusInfo>;
    fn emit_tools_updated(&self);
    fn emit_server_status_changed(&self, server_id: &str, status: &McpServerStatus);
    /// 应用启动时连接所有 enabled=true 的服务器（初始失败不重连）
    pub async fn connect_all_enabled(&mut self, configs: &[McpServerConfig]);
    /// 应用退出时终止所有 stdio 子进程
    pub async fn shutdown_all(&mut self);
}

// 修复：使用 tokio::sync::Mutex 而非 std::sync::Mutex
pub struct McpManagerState(pub Arc<tokio::sync::Mutex<McpManager>>);
```

---

### 2. Tauri Commands（mcp_commands.rs）

```rust
/// 获取所有可用工具（前端在每次 AI 请求前调用）
#[tauri::command]
pub async fn mcp_list_tools(state: State<'_, McpManagerState>) -> Result<Vec<McpToolDef>, String>

/// 调用工具（30s 超时由 McpManager 内部处理）
/// 修复：注明 Tauri 1.5 自动将前端 camelCase 参数映射到 Rust snake_case
/// 前端传 { toolName, args } -> Rust 接收 tool_name, args
#[tauri::command]
pub async fn mcp_call_tool(
    state: State<'_, McpManagerState>,
    tool_name: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String>

/// 连接/重连指定服务器，同时重置 retry_count = 0
/// 用于：手动重连按钮、启用开关打开时
#[tauri::command]
pub async fn mcp_connect_server(state: State<'_, McpManagerState>, server_id: String) -> Result<(), String>

/// 断开指定服务器连接（终止子进程）
/// 用于：手动断开、禁用开关关闭时
#[tauri::command]
pub async fn mcp_disconnect_server(state: State<'_, McpManagerState>, server_id: String) -> Result<(), String>

/// 获取所有服务器状态（含工具列表，用于 Settings UI 展示）
#[tauri::command]
pub async fn mcp_get_servers_status(state: State<'_, McpManagerState>) -> Result<Vec<McpServerStatusInfo>, String>
```

---

### 3. Tauri Events（后端 -> 前端）

| 事件名                | Payload                                          | 触发时机             |
|-----------------------|--------------------------------------------------|----------------------|
| mcp://tools-updated   | Vec<McpToolDef>                                  | Tool_Registry 变化时 |
| mcp://server-status   | { serverId: string, status: McpServerStatus }    | 服务器状态变化时     |

---

### 4. 前端 TypeScript 类型（src/types/mcp.ts，新增）

```typescript
export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
}

export type McpTransport =
  | { type: 'stdio'; command: string; env: Record<string, string> }
  | { type: 'httpSse'; url: string };  // 与 Rust serde rename_all camelCase 对齐

// 修复：与 Rust McpServerStatus serde tag+content 序列化格式对齐
export type McpServerStatus =
  | { type: 'disconnected' }
  | { type: 'connecting' }
  | { type: 'connected' }
  | { type: 'error'; message: string };

export interface McpToolDef {
  name: string;           // 命名空间化，如 "filesystem/read_file"
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
  originalName: string;
}

export interface McpServerStatusInfo {
  config: McpServerConfig;
  status: McpServerStatus;
  tools: McpToolDef[];
}
```

---

### 5. 前端 API 层（src/api/mcpApi.ts，新增）

```typescript
import { invoke } from '@tauri-apps/api/tauri';
import type { McpToolDef, McpServerStatusInfo } from '../types/mcp';

export const mcpApi = {
  listTools: () => invoke<McpToolDef[]>('mcp_list_tools'),

  // 修复：Tauri 1.5 invoke 参数 key 使用 camelCase，Rust 侧自动映射 snake_case
  callTool: (toolName: string, args: unknown) =>
    invoke<unknown>('mcp_call_tool', { toolName, args }),

  // 手动重连（内部重置 retry_count=0）
  connectServer: (serverId: string) =>
    invoke<void>('mcp_connect_server', { serverId }),

  disconnectServer: (serverId: string) =>
    invoke<void>('mcp_disconnect_server', { serverId }),

  getServersStatus: () =>
    invoke<McpServerStatusInfo[]>('mcp_get_servers_status'),
};
```

---

### 6. 前端 Store（src/stores/mcpStore.ts，新增）

```typescript
import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { mcpApi } from '../api/mcpApi';
import type { McpToolDef, McpServerStatusInfo } from '../types/mcp';

interface McpState {
  tools: McpToolDef[];
  serversStatus: McpServerStatusInfo[];
  refreshTools: () => Promise<void>;
  refreshServersStatus: () => Promise<void>;
  subscribeToEvents: () => Promise<() => void>; // 返回 unlisten 函数
}

export const useMcpStore = create<McpState>((set) => ({
  tools: [],
  serversStatus: [],
  refreshTools: async () => {
    const tools = await mcpApi.listTools();
    set({ tools });
  },
  refreshServersStatus: async () => {
    const serversStatus = await mcpApi.getServersStatus();
    set({ serversStatus });
  },
  subscribeToEvents: async () => {
    const unlistenTools = await listen('mcp://tools-updated', (e) => {
      set({ tools: e.payload as McpToolDef[] });
    });
    const unlistenStatus = await listen('mcp://server-status', () => {
      mcpApi.getServersStatus().then((serversStatus) => set({ serversStatus }));
    });
    return () => { unlistenTools(); unlistenStatus(); };
  },
}));
```

---
## Data Models

### AppSettings 扩展

Rust（settings.rs）：
```rust
// 在 AppSettings struct 中新增
#[serde(default)]
pub mcp_servers: Vec<McpServerConfig>,
```

TypeScript（src/types/index.ts）：
```typescript
// 在 AppSettings interface 中新增
mcpServers?: McpServerConfig[];
```

---

### SQLite 扩展（ai_chat_db.rs）

chat_messages 表的 role 和 content 字段无需改动（均为 TEXT）。工具调用消息以 JSON 字符串存入 content：

role = "tool_call"，content 示例：
```json
{
  "tool_call_id": "call_abc123",
  "tool_name": "filesystem/read_file",
  "args": { "path": "/tmp/test.txt" }
}
```

role = "tool_result"，content 示例：
```json
{
  "tool_call_id": "call_abc123",
  "tool_name": "filesystem/read_file",
  "result": { "content": "file contents..." },
  "is_error": false
}
```

history adapter 扩展：
- append({ message })：识别 content part 类型
  - type === 'tool-call'  -> role=tool_call，content=JSON 序列化
  - type === 'tool-result' -> role=tool_result，content=JSON 序列化
  - type === 'text' -> 保持原有逻辑
- load()：role 为 tool_call/tool_result 时，将 content JSON 解析为对应 content part 类型

---

### Cargo.toml 依赖变更（修复：补充新增依赖）

```toml
# reqwest 需增加 stream feature（用于 HTTP/SSE 流式读取）
reqwest = { version = "0.11", features = ["json", "blocking", "gzip", "deflate", "stream"] }

# 新增：async-trait（用于 McpClient trait 的 async 方法）
async-trait = "0.1"

# tokio 已有 full feature，包含 process，无需修改
```

---

## Error Handling

### Rust 端

| 场景 | 处理方式 |
|------|---------|
| stdio 命令不存在 | 捕获 std::io::Error，设置状态为 Error("命令不存在: ...")，不触发重连 |
| npx 依赖 Node.js 未安装 | 检测 stderr 中的 "npx: command not found" 或 "'npx' is not recognized"，错误信息追加"请先安装 Node.js: https://nodejs.org" |
| stdio 子进程退出码非零 | 捕获退出码，设置状态为 Error("进程异常退出，退出码: {code}")，不触发重连 |
| 工具调用超时（30s） | tokio::time::timeout(Duration::from_secs(30), ...) 包裹调用，超时返回 Err("工具调用超时（30s）") |
| 工具调用过程中服务器断开 | 返回 Err("连接已断开")，同时启动自动重连流程（最多 3 次，间隔 5s） |
| 运行中意外断开（非工具调用期间） | 设置状态为 Error，启动自动重连（最多 3 次，间隔 5s） |
| 3 次重连均失败 | 标记状态为 Error("重连失败，已达最大重试次数")，停止重连，emit mcp://server-status |
| 初始连接失败（应用启动时） | 记录错误，设置状态为 Error，不触发自动重连（区别于运行中断开） |

### 前端端

| 场景 | 处理方式 |
|------|---------|
| 工具调用失败（超时/服务器错误） | 将错误信息作为 tool-result（is_error=true）返回给 AI，由 AI 决定如何处理（Req 4.8） |
| 超过 10 轮工具调用循环 | 终止循环，yield 最终 AI 文本响应后结束 run()（Req 4.6/4.7） |
| Provider 不支持工具格式 | 跳过工具附加，正常发起纯文本请求 |
| 导入 JSON 格式错误 | 前端校验 Schema，显示具体字段错误，拒绝导入（Req 7.5） |

---

## Key Design Decisions

### 1. MCP Client 在 Rust 而非前端

Tauri 1.5 的前端运行在 WebView 沙箱中，无法直接启动本地子进程或建立任意 TCP 连接。Rust 后端通过 tokio::process::Command 完整控制子进程生命周期，并在应用退出时确保清理所有 stdio 子进程。

### 2. 使用 tokio::sync::Mutex 而非 std::sync::Mutex

McpManager 的方法（connect_server、call_tool 等）均为 async，在 async 上下文中持有标准库同步 Mutex 跨 await 点会导致 tokio 检测到死锁或 panic。改用 tokio::sync::Mutex 确保 async 安全。

### 3. 工具命名空间策略

当两个服务器提供同名工具时，使用 {serverName}/{toolName} 格式（如 filesystem/read_file）。mcp_call_tool 根据 server_id 字段路由到正确服务器，再用 original_name 调用实际工具，不依赖 / 分隔符解析（避免工具名本身含 / 的歧义）。

### 4. 工具调用循环中的消息历史维护

工具调用循环期间，使用内存临时消息列表 localMessages 维护多轮上下文，而非每轮从 @assistant-ui/react runtime 读取。原因：runtime 的消息列表在 yield 后才异步更新，无法在同一个 run() 调用中同步读取最新状态。

```
localMessages = [...原始 messages 参数]
loop (最多 10 轮):
    response = callAIStream(localMessages + tools)
    if response 包含 tool_calls:
        localMessages.push({ role: 'assistant', tool_calls: [...] })
        for each tool_call:
            result = invoke mcp_call_tool
            localMessages.push({ role: 'tool', tool_call_id, content: result })
    else:
        yield 最终文本响应
        break
```

### 5. 工具调用消息持久化

扩展 history adapter 的 append() 方法，识别 tool-call 和 tool-result content part，序列化为 JSON 存入 chat_messages 表。load() 方法同步扩展，将这些记录反序列化为对应 content part 类型，确保历史对话中的工具调用记录可以正确恢复展示。

### 6. 初始连接失败 vs 运行中断开的重连策略

| 场景 | 重连行为 | 原因 |
|------|---------|------|
| 应用启动时连接失败 | 不自动重连 | 通常是配置错误，重连无意义，用户需修复配置 |
| 运行中意外断开 | 自动重连最多 3 次，间隔 5s | 通常是网络抖动或进程崩溃，重连有意义 |
| 手动点击"重新连接" | 重置 retry_count=0，立即重连 | 用户主动操作，应给予完整重试机会 |

### 7. 禁用开关与连接状态的联动（修复：补充联动逻辑）

Settings UI 保存配置时需同步操作连接状态，避免配置与运行状态不一致：

```
用户切换启用开关 -> 保存配置
    if enabled=false:
        invoke mcp_disconnect_server(serverId)  // 终止连接和子进程（Req 2.6）
    if enabled=true:
        invoke mcp_connect_server(serverId)     // 建立连接（重置 retry_count=0）
    updateSettings({ mcpServers: [...] })       // 持久化配置
```

操作顺序：先操作连接，再持久化配置，确保配置保存时连接状态已确定。

### 8. 导出脱敏策略（修复：补充脱敏逻辑，满足 Req 7.3）

导出 MCP 配置时，stdio 类型服务器的环境变量 value 替换为空字符串（保留 key 以提示用户需要填写哪些变量）：

```typescript
function exportConfig(servers: McpServerConfig[]): McpServerConfig[] {
  return servers.map(s => ({
    ...s,
    transport: s.transport.type === 'stdio'
      ? { ...s.transport, env: Object.fromEntries(Object.keys(s.transport.env).map(k => [k, ''])) }
      : s.transport,
  }));
}
```

### 9. 导入合并策略（修复：明确合并规则，满足 Req 7.4）

导入时按 id 去重合并（而非全量替换），避免覆盖用户已有配置：

```typescript
function mergeImport(existing: McpServerConfig[], imported: McpServerConfig[]): McpServerConfig[] {
  const existingIds = new Set(existing.map(s => s.id));
  const newServers = imported.filter(s => !existingIds.has(s.id));
  return [...existing, ...newServers];
  // id 已存在则跳过，id 不存在则追加
}
```

导入前校验 JSON Schema（每个条目必须有 id、name、transport、enabled 字段），格式错误时显示具体字段路径并拒绝导入。导入后提示"成功导入 N 条，跳过 M 条（已存在）"。

---

## Testing Strategy

### 单元测试（Rust）

- McpManager::list_tools() 命名空间隔离逻辑（同名工具来自不同服务器）
- McpManager::call_tool() 路由逻辑（按 server_id 找到正确 client）
- 工具调用 30s 超时处理（mock client 延迟 > 30s）
- 重连计数逻辑（运行中断开触发重连，初始失败不触发，手动重连重置）
- McpServerStatus 序列化格式验证（确保与 TypeScript 侧对称）

### 集成测试（手动）

- 使用 npx -y @modelcontextprotocol/server-filesystem 验证 stdio 连接和工具发现
- 验证工具列表和工具名称列表出现在 Settings UI 对应服务器条目下（Req 3.6）
- 验证 AI 能调用工具并展示 ToolCard（含加载动画 -> 成功/失败状态）
- 验证 10 轮循环限制
- 验证导出 JSON 中 env value 已脱敏为空字符串（Req 7.3）
- 验证导入 JSON 按 id 合并，不覆盖已有配置（Req 7.4）

---

## Implementation Plan

### Phase 1：Rust 后端基础设施

1. 修改 src-tauri/Cargo.toml
   - reqwest 新增 stream feature
   - 新增 async-trait = "0.1"

2. 新增 src-tauri/src/mcp_manager.rs
   - 定义所有数据结构（McpServerConfig、McpTransport、McpToolDef、McpServerState、McpServerStatusInfo、McpServerStatus 含正确 serde 标注）
   - 定义 McpClient trait（含 5 个方法签名）
   - 实现 StdioTransport：tokio::process::Command 启动子进程，stdin/stdout 行分隔 JSON-RPC
   - 实现 HttpSseTransport：reqwest stream feature 建立 SSE 连接
   - 实现 McpManager（tokio::sync::Mutex）：所有方法
   - 实现 MCP 握手（initialize）和工具发现（tools/list）
   - 实现工具调用（tools/call）含 tokio::time::timeout 30s 限制
   - 实现重连逻辑：运行中断开才重连（最多 3 次，间隔 5s），初始失败不重连
   - 实现 connect_all_enabled()（应用启动）和 shutdown_all()（应用退出）
   - 实现 Tauri event 发送（mcp://tools-updated、mcp://server-status）

3. 新增 src-tauri/src/mcp_commands.rs
   - 实现 5 个 Tauri command
   - mcp_connect_server 内部重置 retry_count = 0

4. 修改 src-tauri/src/settings.rs
   - AppSettings 新增 #[serde(default)] pub mcp_servers: Vec<McpServerConfig>

5. 修改 src-tauri/src/main.rs
   - mod mcp_manager; mod mcp_commands;
   - 注册 McpManagerState（tokio::sync::Mutex 包裹）
   - 应用启动时从 settings 读取配置，调用 connect_all_enabled()
   - 应用退出时调用 shutdown_all()
   - 注册 5 个新 Tauri commands

---

### Phase 2：前端类型与 API

6. 新增 src/types/mcp.ts
   - 定义所有 MCP 相关 TypeScript 类型（与 Rust serde 格式对齐）

7. 新增 src/api/mcpApi.ts
   - 封装 5 个 Tauri invoke 调用，注明 camelCase 参数映射

8. 新增 src/stores/mcpStore.ts
   - Zustand store，管理工具列表和服务器状态
   - 订阅 mcp://tools-updated 和 mcp://server-status 事件自动更新

9. 修改 src/types/index.ts
   - AppSettings 新增 mcpServers?: McpServerConfig[]

---

### Phase 3：ChatModelAdapter 工具调用集成

10. 修改 src/components/ChatInterface.tsx

    callAIStream() 扩展：
    - 接收 tools: McpToolDef[] 参数
    - 按 provider 类型转换工具格式：
      - OpenAI/custom：tools: [{ type: 'function', function: { name, description, parameters: inputSchema } }]
      - Anthropic：tools: [{ name, description, input_schema: inputSchema }]
      - Gemini：tools: [{ functionDeclarations: [{ name, description, parameters: inputSchema }] }]
    - 流式解析工具调用意图，返回 AsyncGenerator<StreamChunk>
      - StreamChunk = { type: 'text'; text: string } | { type: 'tool_call'; id: string; name: string; args: unknown }
      - OpenAI：跨 chunk 累积 tool_calls[].function.arguments 字符串后 JSON.parse
      - Anthropic：content_block_start(type=tool_use) 后跟 content_block_delta 累积 input
      - Gemini：单 chunk 直接提取 functionCall.name 和 functionCall.args

    run() 方法扩展（工具调用循环）：
    1. invoke mcp_list_tools 获取工具列表
    2. 构建内存临时消息列表 localMessages（从 messages 参数复制）
    3. 循环（最多 10 轮）：
       a. 调用 callAIStream(provider, thread, localMessages, tools, ...)
       b. 收集所有 StreamChunk
       c. 如果只有 text chunk -> yield 文本，结束循环
       d. 如果有 tool_call chunk：
          - yield { content: [{ type: 'tool-call', toolCallId, toolName, args }] }
          - invoke mcp_call_tool(toolName, args)
          - yield { content: [{ type: 'tool-result', toolCallId, result }] }
          - 将 tool-call 和 tool-result 追加到 localMessages
          - 继续下一轮
    4. 超过 10 轮 -> 终止，yield 最终文本

    history adapter append() 扩展：
    - 识别 content part type 为 tool-call 和 tool-result
    - 序列化为 JSON 字符串存入 chat_messages（role 分别为 tool_call/tool_result）

    history adapter load() 扩展：
    - 将 role=tool_call/tool_result 的记录反序列化为对应 content part

---

### Phase 4：Settings UI

11. 新增 src/components/McpSettingsPanel.tsx
    - 服务器列表：名称、状态指示灯（颜色）、工具数量、工具名称列表（可折叠展示，满足 Req 3.6）、启用/禁用开关
    - 启用开关打开时：调用 mcpApi.connectServer() + updateSettings（满足 Req 2.1/2.6 联动）
    - 禁用开关关闭时：调用 mcpApi.disconnectServer() + updateSettings（满足 Req 2.6）
    - 添加/编辑服务器表单：名称、传输类型（stdio/http_sse）、命令或 URL、环境变量键值对编辑器
    - 编辑时预填充当前配置值（满足 Req 1.6）
    - 删除确认对话框（满足 Req 1.7）：确认后调用 mcpApi.disconnectServer() + 从配置列表移除 + updateSettings
    - 手动重连按钮：调用 mcpApi.connectServer()（内部重置 retry_count=0，满足 Req 6.6）
    - 字段验证：必填字段缺失时显示具体错误信息（满足 Req 1.9）
    - 导出 MCP 配置：env value 脱敏后导出 JSON 文件（满足 Req 7.3）
    - 导入 MCP 配置：读取 JSON 文件，校验 Schema，按 id 合并（满足 Req 7.4/7.5）

12. 修改 src/components/Settings.tsx
    - 在 AI 设置 tab 中嵌入 McpSettingsPanel（满足 Req 1.1）

---

### Phase 5：Tool Card UI

13. 新增 src/components/ToolCard.tsx
    - 展示：工具名称、所属 MCP Server 名称、执行状态（加载动画/成功/失败）
    - 参数区域：默认折叠，点击展开显示完整 JSON（满足 Req 5.6）
    - 结果区域：默认折叠，点击展开显示完整返回内容（满足 Req 5.7）
    - 结果摘要：截取前 100 字符展示（满足 Req 5.2）
    - 支持深色/浅色主题（满足 Req 5.8）

14. 修改 src/components/ChatInterface.tsx
    - 在消息渲染中识别 tool-call content part，渲染 ToolCard
    - ToolCard 状态：tool-call 出现时显示"执行中"，对应 tool-result 到达后更新为成功/失败
