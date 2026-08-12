# Requirements Document

## Introduction

为 McStartUP（Tauri 1.5 + React 18 桌面应用）添加完整的 MCP（Model Context Protocol）集成功能。该功能允许用户配置并连接 MCP Server（本地 stdio 进程或远程 HTTP/SSE），AI 在对话中可自动发现并调用 MCP 工具，工具调用结果以卡片形式展示在对话界面中。

由于应用没有 Node.js 后端，MCP Client 逻辑在 Rust 后端（Tauri command）实现，前端通过 Tauri invoke 与后端通信，并在 `ChatModelAdapter` 的 `run()` 方法中集成工具调用循环。

## Glossary

- **MCP_Manager**: Rust 后端模块，负责管理 MCP Server 的生命周期、工具发现和工具调用
- **MCP_Server**: 用户配置的 MCP 服务端，可以是本地 stdio 进程或远程 HTTP/SSE 端点
- **MCP_Client**: 在 Rust 后端实现的 MCP 协议客户端，与 MCP_Server 通信
- **Tool_Registry**: 运行时维护的已连接 MCP Server 所暴露工具的集合
- **Tool_Card**: 前端对话界面中展示工具调用过程和结果的 UI 组件
- **ChatModelAdapter**: 前端 `@assistant-ui/react` 的 AI 调用适配器，负责 AI 请求和工具调用循环
- **Settings_UI**: 应用设置界面中的 MCP 配置面板
- **Stdio_Server**: 通过本地子进程（如 `npx` 命令）启动的 MCP Server
- **HTTP_SSE_Server**: 通过 HTTP/SSE 协议连接的远程 MCP Server

---

## Requirements

### Requirement 1: MCP Server 配置管理

**User Story:** 作为用户，我希望在设置界面中添加、编辑和删除 MCP Server 配置，以便管理我需要使用的 MCP 工具来源。

#### Acceptance Criteria

1. THE Settings_UI SHALL 在 AI 设置面板中提供独立的"MCP 服务器"配置区域
2. WHEN 用户添加新的 MCP Server 配置时，THE Settings_UI SHALL 要求用户填写：服务器名称、传输类型（stdio 或 http/sse）、以及对应的连接参数
3. WHERE 传输类型为 stdio 时，THE Settings_UI SHALL 要求用户填写启动命令（如 `npx -y @modelcontextprotocol/server-filesystem`）和可选的环境变量键值对
4. WHERE 传输类型为 http/sse 时，THE Settings_UI SHALL 要求用户填写服务器 URL（如 `http://localhost:3000/sse`）
5. THE Settings_UI SHALL 为每个 MCP Server 配置提供启用/禁用开关
6. WHEN 用户编辑已有 MCP Server 配置时，THE Settings_UI SHALL 预填充当前配置值，并在保存后更新持久化存储
7. WHEN 用户删除 MCP Server 配置时，THE Settings_UI SHALL 弹出确认对话框，确认后终止该服务器连接并从配置列表中移除
8. WHEN 用户保存 MCP Server 配置时，THE MCP_Manager SHALL 将配置持久化到应用设置存储中
9. IF 用户提交的配置缺少必填字段，THEN THE Settings_UI SHALL 显示具体的字段验证错误信息
10. THE Settings_UI SHALL 为每个已配置的 MCP Server 显示当前连接状态（未连接 / 连接中 / 已连接 / 错误）

---

### Requirement 2: MCP Server 生命周期管理

**User Story:** 作为用户，我希望应用能自动启动和管理已启用的 MCP Server 连接，以便在对话中随时使用工具。

#### Acceptance Criteria

1. WHEN 应用启动时，THE MCP_Manager SHALL 尝试连接所有标记为启用的 MCP Server
2. WHERE 传输类型为 stdio 时，THE MCP_Manager SHALL 通过 Tauri 的 `Command` API 启动子进程，并通过 stdin/stdout 进行 JSON-RPC 通信
3. WHERE 传输类型为 http/sse 时，THE MCP_Manager SHALL 通过 HTTP 请求建立 SSE 连接
4. WHEN MCP_Server 连接成功时，THE MCP_Manager SHALL 执行 MCP `initialize` 握手并获取服务器能力声明
5. WHEN MCP_Server 在运行中意外断开时，THE MCP_Manager SHALL 将该服务器状态更新为"错误"并触发自动重连流程（见 Requirement 6）
6. WHEN 用户在设置中禁用某个 MCP Server 时，THE MCP_Manager SHALL 终止该服务器的连接和子进程（如适用）
7. WHEN 应用退出时，THE MCP_Manager SHALL 终止所有 stdio 类型的 MCP Server 子进程
8. IF stdio 子进程启动失败（命令不存在或退出码非零），THEN THE MCP_Manager SHALL 将该服务器状态设置为"错误"并记录具体的错误信息
9. IF stdio 启动命令依赖 npx 但系统未安装 Node.js，THEN THE MCP_Manager SHALL 在错误信息中提示用户安装 Node.js

---

### Requirement 3: MCP 工具发现

**User Story:** 作为用户，我希望应用能自动发现已连接 MCP Server 提供的所有工具，以便 AI 可以在对话中使用这些工具。

#### Acceptance Criteria

1. WHEN MCP_Server 连接并完成握手后，THE MCP_Manager SHALL 调用 `tools/list` 方法获取该服务器的工具列表
2. THE MCP_Manager SHALL 将所有已连接服务器的工具合并到 Tool_Registry 中，每个工具记录包含：工具名称、描述、输入参数 JSON Schema、所属服务器 ID
3. WHEN Tool_Registry 发生变化时，THE MCP_Manager SHALL 通过 Tauri event 通知前端更新可用工具列表
4. THE ChatModelAdapter SHALL 在每次 AI 请求前，通过 Tauri invoke 获取当前 Tool_Registry 中的所有工具定义
5. IF 两个不同 MCP Server 提供同名工具，THEN THE MCP_Manager SHALL 以"服务器名称/工具名称"格式对工具进行命名空间隔离
6. THE Settings_UI SHALL 在每个已连接 MCP Server 的配置条目下展示该服务器提供的工具数量和工具名称列表

---

### Requirement 4: AI 工具调用集成

**User Story:** 作为用户，我希望 AI 在对话中能够自动识别何时需要调用 MCP 工具，并执行工具调用后将结果融入回复，以便获得更强大的 AI 辅助能力。

#### Acceptance Criteria

1. WHEN ChatModelAdapter 发起 AI 请求时，THE ChatModelAdapter SHALL 将 Tool_Registry 中的工具定义转换为当前 AI provider 所需的格式后附加到请求中（OpenAI/custom 使用 `tools` 字段，Anthropic 使用 `tools` 字段，Google Gemini 使用 `tools.functionDeclarations` 字段）
2. WHEN AI 响应包含工具调用意图时（OpenAI 的 `tool_calls`、Anthropic 的 `tool_use`、Gemini 的 `functionCall`），THE ChatModelAdapter SHALL 提取工具调用请求并以 `tool-call` 类型的 content part yield 给 @assistant-ui/react
3. WHEN 提取到工具调用请求后，THE ChatModelAdapter SHALL 通过 Tauri invoke 调用 `mcp_call_tool` 命令，传入工具名称和参数
4. THE MCP_Manager SHALL 将工具调用路由到对应的 MCP_Server，并通过 MCP 协议的 `tools/call` 方法执行
5. WHEN 工具调用完成后，THE ChatModelAdapter SHALL 将工具调用结果以 `tool-result` 类型追加到消息历史，并继续发起下一轮 AI 请求
6. THE ChatModelAdapter SHALL 支持在单次用户消息中执行最多 10 轮工具调用循环（防止无限循环）
7. IF 工具调用超过 10 轮，THEN THE ChatModelAdapter SHALL 终止工具调用循环并将最终 AI 文本响应返回给用户
8. IF 工具调用执行失败（超时或 MCP_Server 返回错误），THEN THE ChatModelAdapter SHALL 将错误信息作为工具结果返回给 AI，由 AI 决定如何处理
9. WHEN 工具调用消息（tool-call 和 tool-result）产生时，THE ChatModelAdapter SHALL 将其持久化到对话数据库，与普通消息一同保存

---

### Requirement 5: 工具调用 UI 展示

**User Story:** 作为用户，我希望在对话界面中清晰地看到 AI 调用了哪些工具以及调用结果，以便了解 AI 的推理过程。

#### Acceptance Criteria

1. WHEN AI 发起工具调用时，THE Tool_Card SHALL 在对话消息流中以内联卡片形式展示，位于触发该工具调用的 AI 消息内部
2. THE Tool_Card SHALL 展示以下信息：工具名称、所属 MCP Server 名称、调用参数（折叠显示）、执行状态（执行中 / 成功 / 失败）、执行结果摘要
3. WHILE 工具正在执行时，THE Tool_Card SHALL 显示加载动画
4. WHEN 工具执行成功时，THE Tool_Card SHALL 将状态更新为成功并展示结果内容
5. WHEN 工具执行失败时，THE Tool_Card SHALL 将状态更新为失败并展示错误信息
6. WHEN 用户点击 Tool_Card 的参数区域时，THE Tool_Card SHALL 展开显示完整的 JSON 格式调用参数
7. WHEN 用户点击 Tool_Card 的结果区域时，THE Tool_Card SHALL 展开显示完整的工具返回内容
8. THE Tool_Card SHALL 与现有对话消息的视觉风格保持一致，支持深色/浅色主题切换

---

### Requirement 6: 工具调用超时与错误处理

**User Story:** 作为用户，我希望工具调用在出现问题时能够优雅地处理，不影响整体对话体验。

#### Acceptance Criteria

1. THE MCP_Manager SHALL 对每次工具调用设置 30 秒超时限制
2. IF 工具调用在 30 秒内未返回结果，THEN THE MCP_Manager SHALL 取消该调用并返回超时错误信息
3. IF MCP_Server 在工具调用过程中断开连接，THEN THE MCP_Manager SHALL 返回连接断开错误，并启动自动重连流程
4. THE MCP_Manager SHALL 对运行中意外断开的 MCP_Server 进行最多 3 次自动重连，每次重连间隔为 5 秒
5. IF 3 次重连均失败，THEN THE MCP_Manager SHALL 将该服务器标记为不可用，并停止重连尝试
6. WHEN 用户在 Settings_UI 中手动点击"重新连接"按钮时，THE MCP_Manager SHALL 重置重连计数并重新尝试连接
7. IF MCP_Server 初始连接（应用启动时）失败，THEN THE MCP_Manager SHALL 记录错误并将状态设为"错误"，不进行自动重连（区别于运行中断开的场景）

---

### Requirement 7: MCP 配置的持久化与导入导出

**User Story:** 作为用户，我希望 MCP Server 配置能够随应用设置一起保存，并支持导出和导入，以便在不同设备间迁移配置。

#### Acceptance Criteria

1. THE MCP_Manager SHALL 将 MCP Server 配置列表作为 `mcpServers` 字段存储在应用的 AppSettings 中
2. WHEN 应用加载设置时，THE MCP_Manager SHALL 从 AppSettings 中读取 MCP Server 配置列表
3. THE Settings_UI SHALL 提供"导出 MCP 配置"功能，将当前所有 MCP Server 配置导出为 JSON 文件（不包含敏感的环境变量值）
4. THE Settings_UI SHALL 提供"导入 MCP 配置"功能，从 JSON 文件中读取并合并 MCP Server 配置
5. IF 导入的 JSON 文件格式不符合 MCP 配置 Schema，THEN THE Settings_UI SHALL 显示具体的格式错误信息并拒绝导入
