# Implementation Tasks

## Phase 1：Rust 后端基础设施

- [x] 1. 更新 Cargo.toml 依赖
  - [x] 1.1 为 reqwest 新增 `stream` feature
  - [x] 1.2 新增 `async-trait = "0.1"` 依赖

- [x] 2. 新增 src-tauri/src/mcp_manager.rs — 数据结构与 trait
  - [x] 2.1 定义 `McpServerConfig`、`McpTransport` 结构体（含正确 serde 标注）
  - [x] 2.2 定义 `McpToolDef`、`McpServerState`、`McpServerStatusInfo` 结构体
  - [x] 2.3 定义 `McpServerStatus` 枚举（tag+content serde 格式，与 TypeScript 侧对称）
  - [x] 2.4 定义 `McpClient` async trait（initialize、list_tools、call_tool、is_connected、shutdown）

- [x] 3. 实现 StdioTransport
  - [x] 3.1 使用 `tokio::process::Command` 启动子进程
  - [x] 3.2 通过 stdin/stdout 行分隔 JSON-RPC 通信
  - [x] 3.3 实现 MCP `initialize` 握手
  - [x] 3.4 实现 `tools/list` 工具发现
  - [x] 3.5 实现 `tools/call` 工具调用
  - [x] 3.6 处理 npx 依赖 Node.js 未安装的错误提示

- [x] 4. 实现 HttpSseTransport
  - [x] 4.1 使用 reqwest stream feature 建立 SSE 连接
  - [x] 4.2 实现 MCP `initialize` 握手
  - [x] 4.3 实现 `tools/list` 和 `tools/call`

- [x] 5. 实现 McpManager
  - [x] 5.1 定义 `McpManager` 结构体（使用 `tokio::sync::Mutex` 包裹）
  - [x] 5.2 实现 `connect_server()`：连接并执行握手，发现工具，更新 Tool_Registry
  - [x] 5.3 实现 `disconnect_server()`：终止连接和子进程
  - [x] 5.4 实现 `call_tool()`：路由到对应 server，含 `tokio::time::timeout` 30s 限制
  - [x] 5.5 实现 `list_tools()`：返回合并后的 Tool_Registry
  - [x] 5.6 实现 `get_servers_status()`：返回所有服务器状态信息
  - [x] 5.7 实现工具命名空间隔离逻辑（同名工具使用 `serverName/toolName` 格式）
  - [x] 5.8 实现重连逻辑：运行中断开自动重连最多 3 次（间隔 5s），初始失败不重连
  - [x] 5.9 实现 `connect_all_enabled()`（应用启动时调用）
  - [x] 5.10 实现 `shutdown_all()`（应用退出时调用，终止所有 stdio 子进程）
  - [x] 5.11 实现 Tauri event 发送（`mcp://tools-updated`、`mcp://server-status`）

- [x] 6. 新增 src-tauri/src/mcp_commands.rs
  - [x] 6.1 实现 `mcp_list_tools` Tauri command
  - [x] 6.2 实现 `mcp_call_tool` Tauri command（前端 camelCase 参数自动映射 snake_case）
  - [x] 6.3 实现 `mcp_connect_server` Tauri command（内部重置 retry_count = 0）
  - [x] 6.4 实现 `mcp_disconnect_server` Tauri command
  - [x] 6.5 实现 `mcp_get_servers_status` Tauri command

- [x] 7. 修改 src-tauri/src/settings.rs
  - [x] 7.1 在 `AppSettings` struct 中新增 `#[serde(default)] pub mcp_servers: Vec<McpServerConfig>`

- [x] 8. 修改 src-tauri/src/main.rs
  - [x] 8.1 添加 `mod mcp_manager; mod mcp_commands;`
  - [x] 8.2 注册 `McpManagerState`（`Arc<tokio::sync::Mutex<McpManager>>`）为 Tauri State
  - [x] 8.3 应用启动时从 settings 读取配置，调用 `connect_all_enabled()`
  - [x] 8.4 应用退出时调用 `shutdown_all()`
  - [x] 8.5 注册 5 个新 Tauri commands 到 invoke_handler

- [x] 9. Rust 后端单元测试
  - [x] 9.1 测试 `list_tools()` 命名空间隔离逻辑（同名工具来自不同服务器）
  - [x] 9.2 测试 `call_tool()` 路由逻辑（按 server_id 找到正确 client）
  - [x] 9.3 测试工具调用 30s 超时处理（mock client 延迟 > 30s）
  - [x] 9.4 测试重连计数逻辑（运行中断开触发重连，初始失败不触发，手动重连重置）
  - [x] 9.5 Property-Based Test：`McpServerStatus` 序列化/反序列化往返一致性（确保与 TypeScript 侧对称）
  - [x] 9.6 Property-Based Test：工具命名空间隔离——任意两个服务器提供同名工具时，合并后的 Tool_Registry 中工具名称唯一

---

## Phase 2：前端类型与 API

- [x] 10. 新增 src/types/mcp.ts
  - [x] 10.1 定义 `McpServerConfig`、`McpTransport` 类型（与 Rust serde camelCase 格式对齐）
  - [x] 10.2 定义 `McpServerStatus` 联合类型（tag+content 格式，与 Rust 侧对称）
  - [x] 10.3 定义 `McpToolDef`、`McpServerStatusInfo` 类型

- [x] 11. 新增 src/api/mcpApi.ts
  - [x] 11.1 封装 `listTools`（invoke `mcp_list_tools`）
  - [x] 11.2 封装 `callTool`（invoke `mcp_call_tool`，参数使用 camelCase）
  - [x] 11.3 封装 `connectServer`、`disconnectServer`、`getServersStatus`

- [x] 12. 新增 src/stores/mcpStore.ts
  - [x] 12.1 创建 Zustand store，包含 `tools` 和 `serversStatus` 状态
  - [x] 12.2 实现 `refreshTools()` 和 `refreshServersStatus()` 方法
  - [x] 12.3 实现 `subscribeToEvents()`：监听 `mcp://tools-updated` 和 `mcp://server-status` 事件自动更新状态

- [x] 13. 修改 src/types/index.ts
  - [x] 13.1 在 `AppSettings` interface 中新增 `mcpServers?: McpServerConfig[]`

---

## Phase 3：ChatModelAdapter 工具调用集成

- [x] 14. 扩展 src/components/ChatInterface.tsx — callAIStream() 工具格式转换
  - [x] 14.1 接收 `tools: McpToolDef[]` 参数
  - [x] 14.2 OpenAI/custom provider：转换为 `tools: [{ type: 'function', function: { name, description, parameters } }]` 格式
  - [x] 14.3 Anthropic provider：转换为 `tools: [{ name, description, input_schema }]` 格式
  - [x] 14.4 Gemini provider：转换为 `tools: [{ functionDeclarations: [...] }]` 格式

- [x] 15. 扩展 callAIStream() — 流式工具调用意图解析
  - [x] 15.1 OpenAI：跨 chunk 累积 `tool_calls[].function.arguments` 字符串后 JSON.parse
  - [x] 15.2 Anthropic：`content_block_start(type=tool_use)` 后跟 `content_block_delta` 累积 input
  - [x] 15.3 Gemini：单 chunk 直接提取 `functionCall.name` 和 `functionCall.args`
  - [x] 15.4 返回 `AsyncGenerator<StreamChunk>`（text chunk 或 tool_call chunk）

- [x] 16. 扩展 run() 方法 — 工具调用循环
  - [x] 16.1 调用 `mcp_list_tools` 获取工具列表
  - [x] 16.2 构建内存临时消息列表 `localMessages`（从 messages 参数复制）
  - [x] 16.3 实现最多 10 轮工具调用循环
  - [x] 16.4 yield `tool-call` content part，invoke `mcp_call_tool`，yield `tool-result` content part
  - [x] 16.5 将 tool-call 和 tool-result 追加到 `localMessages` 维护多轮上下文
  - [x] 16.6 超过 10 轮时终止循环，yield 最终文本响应

- [x] 17. 扩展 history adapter — 工具调用消息持久化
  - [x] 17.1 扩展 `append()`：识别 `tool-call` content part，序列化为 JSON 存入 `chat_messages`（role=tool_call）
  - [x] 17.2 扩展 `append()`：识别 `tool-result` content part，序列化为 JSON 存入 `chat_messages`（role=tool_result）
  - [x] 17.3 扩展 `load()`：将 role=tool_call/tool_result 记录反序列化为对应 content part 类型

---

## Phase 4：Settings UI

- [x] 18. 新增 src/components/McpSettingsPanel.tsx — 服务器列表
  - [x] 18.1 展示服务器列表：名称、状态指示灯（颜色）、工具数量
  - [x] 18.2 可折叠展示该服务器提供的工具名称列表（满足 Req 3.6）
  - [x] 18.3 启用/禁用开关：打开时调用 `connectServer()` + 持久化，关闭时调用 `disconnectServer()` + 持久化
  - [x] 18.4 手动重连按钮：调用 `connectServer()`（内部重置 retry_count=0，满足 Req 6.6）

- [x] 19. 新增 src/components/McpSettingsPanel.tsx — 添加/编辑表单
  - [x] 19.1 表单字段：名称、传输类型（stdio/http_sse）
  - [x] 19.2 stdio 类型：命令输入框、环境变量键值对编辑器
  - [x] 19.3 http_sse 类型：URL 输入框
  - [x] 19.4 编辑时预填充当前配置值（满足 Req 1.6）
  - [x] 19.5 必填字段验证：缺失时显示具体字段错误信息（满足 Req 1.9）

- [x] 20. 新增 src/components/McpSettingsPanel.tsx — 删除与导入导出
  - [x] 20.1 删除确认对话框：确认后调用 `disconnectServer()` + 从配置列表移除 + 持久化（满足 Req 1.7）
  - [x] 20.2 导出 MCP 配置：env value 脱敏（替换为空字符串）后导出 JSON 文件（满足 Req 7.3）
  - [x] 20.3 导入 MCP 配置：读取 JSON 文件，校验 Schema，按 id 合并（满足 Req 7.4/7.5）
  - [x] 20.4 导入结果提示："成功导入 N 条，跳过 M 条（已存在）"

- [x] 21. 修改 src/components/Settings.tsx
  - [x] 21.1 在 AI 设置 tab 中嵌入 `McpSettingsPanel`（满足 Req 1.1）
  - [x] 21.2 在 `App.tsx` 或顶层组件中初始化 mcpStore 事件订阅

---

## Phase 5：Tool Card UI

- [x] 22. 新增 src/components/ToolCard.tsx
  - [x] 22.1 展示工具名称、所属 MCP Server 名称、执行状态
  - [x] 22.2 执行中状态：显示加载动画（满足 Req 5.3）
  - [x] 22.3 成功/失败状态：对应图标和颜色（满足 Req 5.4/5.5）
  - [x] 22.4 参数区域：默认折叠，点击展开显示完整 JSON（满足 Req 5.6）
  - [x] 22.5 结果区域：默认折叠，截取前 100 字符作摘要，点击展开完整内容（满足 Req 5.2/5.7）
  - [x] 22.6 支持深色/浅色主题切换（满足 Req 5.8）

- [x] 23. 修改 src/components/ChatInterface.tsx — 渲染 ToolCard
  - [x] 23.1 在消息渲染中识别 `tool-call` content part，渲染 ToolCard（初始状态"执行中"）
  - [x] 23.2 对应 `tool-result` 到达后，更新 ToolCard 状态为成功或失败
  - [x] 23.3 确保 ToolCard 与现有消息视觉风格一致（满足 Req 5.1/5.8）
