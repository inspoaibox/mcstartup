use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager as _;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::time::{timeout, Duration};

// ============ Data Structures ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub transport: McpTransport,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum McpTransport {
    /// 本地子进程，stdin/stdout JSON-RPC
    /// command: 可执行文件路径，如 "npx" 或 "python"
    /// args: 参数列表，如 ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    Stdio {
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
    },
    /// 旧版 HTTP/SSE 传输（MCP spec 2024-11-05，仍广泛使用）
    HttpSse { url: String },
    /// 新版 Streamable HTTP 传输（MCP spec 2025-03-26，推荐用于远程服务器）
    /// 单端点 POST /mcp，支持双向流式通信
    StreamableHttp {
        url: String,
        /// 可选的 Bearer token
        #[serde(skip_serializing_if = "Option::is_none")]
        bearer_token: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "message", rename_all = "camelCase")]
pub enum McpServerStatus {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub server_id: String,
    pub server_name: String,
    pub original_name: String,
}

pub struct McpServerState {
    pub config: McpServerConfig,
    pub status: McpServerStatus,
    pub tools: Vec<McpToolDef>,
    pub client: Option<Box<dyn McpClient + Send>>,
    pub retry_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatusInfo {
    pub config: McpServerConfig,
    pub status: McpServerStatus,
    pub tools: Vec<McpToolDef>,
}

// ============ McpClient Trait ============

#[async_trait]
pub trait McpClient: Send + Sync {
    async fn initialize(&mut self) -> Result<serde_json::Value>;
    async fn list_tools(&mut self) -> Result<Vec<McpToolDef>>;
    async fn call_tool(
        &mut self,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value>;
    #[allow(dead_code)]
    fn is_connected(&self) -> bool;
    async fn shutdown(&mut self) -> Result<()>;
}

// ============ StdioTransport ============

pub struct StdioTransport {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
    request_id: u64,
    connected: bool,
}

impl StdioTransport {
    pub async fn new(
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> Result<Self> {
        if command.is_empty() {
            return Err(anyhow!("命令不能为空"));
        }

        let mut cmd = tokio::process::Command::new(command);
        cmd.args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        // Windows 上隐藏控制台窗口，避免启动 MCP server 时弹出 cmd 黑窗口
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        // 继承当前进程的 PATH，确保 npx/node/python 等命令可以被找到
        // Tauri 子进程在 Windows 上默认不继承完整的用户 PATH
        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", path);
        }

        for (k, v) in env {
            cmd.env(k, v);
        }

        let mut child = cmd.spawn().map_err(|e| {
            let msg = e.to_string();
            if msg.contains("No such file or directory")
                || msg.contains("program not found")
                || msg.contains("cannot find the file")
            {
                anyhow!("命令不存在: {} — {}", command, msg)
            } else {
                anyhow!("启动子进程失败: {}", msg)
            }
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("无法获取 stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("无法获取 stdout"))?;

        // Spawn stderr reader to detect Node.js missing
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                eprintln!("[MCP stderr] {}", trimmed);
                            }
                        }
                    }
                }
            });
        }

        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            request_id: 0,
            connected: true,
        })
    }

    fn next_id(&mut self) -> u64 {
        self.request_id += 1;
        self.request_id
    }

    async fn send_request(&mut self, request: serde_json::Value) -> Result<serde_json::Value> {
        let mut line = serde_json::to_string(&request)?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| anyhow!("写入 stdin 失败: {}", e))?;
        self.stdin.flush().await?;

        let mut response_line = String::new();
        self.stdout
            .read_line(&mut response_line)
            .await
            .map_err(|e| anyhow!("读取 stdout 失败: {}", e))?;

        if response_line.is_empty() {
            self.connected = false;
            return Err(anyhow!("连接已断开"));
        }

        let response: serde_json::Value = serde_json::from_str(response_line.trim())
            .map_err(|e| anyhow!("解析响应 JSON 失败: {} — raw: {}", e, response_line.trim()))?;

        if let Some(err) = response.get("error") {
            return Err(anyhow!("MCP 错误: {}", err));
        }

        Ok(response)
    }
}

#[async_trait]
impl McpClient for StdioTransport {
    async fn initialize(&mut self) -> Result<serde_json::Value> {
        let id = self.next_id();
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "mcstartup",
                    "version": "0.1.0"
                }
            }
        });
        let resp = self.send_request(req).await?;
        Ok(resp
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    }

    async fn list_tools(&mut self) -> Result<Vec<McpToolDef>> {
        let id = self.next_id();
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/list",
            "params": {}
        });
        let resp = self.send_request(req).await?;
        let tools_arr = resp
            .get("result")
            .and_then(|r| r.get("tools"))
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default();

        let mut tools = Vec::new();
        for t in tools_arr {
            let name = t
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let description = t
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let input_schema = t
                .get("inputSchema")
                .cloned()
                .unwrap_or(serde_json::json!({}));
            tools.push(McpToolDef {
                name: name.clone(),
                description,
                input_schema,
                server_id: String::new(),   // filled by McpManager
                server_name: String::new(), // filled by McpManager
                original_name: name,
            });
        }
        Ok(tools)
    }

    async fn call_tool(
        &mut self,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let id = self.next_id();
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": args
            }
        });
        let resp = self.send_request(req).await?;
        Ok(resp
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    async fn shutdown(&mut self) -> Result<()> {
        self.connected = false;
        let _ = self.child.kill().await;
        Ok(())
    }
}

// ============ HttpSseTransport ============

pub struct HttpSseTransport {
    url: String,
    client: reqwest::Client,
    request_id: u64,
    connected: bool,
}

impl HttpSseTransport {
    pub fn new(url: &str) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow!("创建 HTTP 客户端失败: {}", e))?;
        Ok(Self {
            url: url.to_string(),
            client,
            request_id: 0,
            connected: false,
        })
    }

    fn next_id(&mut self) -> u64 {
        self.request_id += 1;
        self.request_id
    }

    async fn post_request(&mut self, request: serde_json::Value) -> Result<serde_json::Value> {
        let resp = self
            .client
            .post(&self.url)
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                self.connected = false;
                anyhow!("HTTP 请求失败: {}", e)
            })?;

        if !resp.status().is_success() {
            self.connected = false;
            return Err(anyhow!("HTTP 错误状态码: {}", resp.status()));
        }

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| anyhow!("解析响应 JSON 失败: {}", e))?;

        if let Some(err) = body.get("error") {
            return Err(anyhow!("MCP 错误: {}", err));
        }

        Ok(body)
    }
}

#[async_trait]
impl McpClient for HttpSseTransport {
    async fn initialize(&mut self) -> Result<serde_json::Value> {
        let id = self.next_id();
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "mcstartup",
                    "version": "0.1.0"
                }
            }
        });
        let resp = self.post_request(req).await?;
        self.connected = true;
        Ok(resp
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    }

    async fn list_tools(&mut self) -> Result<Vec<McpToolDef>> {
        let id = self.next_id();
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/list",
            "params": {}
        });
        let resp = self.post_request(req).await?;
        let tools_arr = resp
            .get("result")
            .and_then(|r| r.get("tools"))
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default();

        let mut tools = Vec::new();
        for t in tools_arr {
            let name = t
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let description = t
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let input_schema = t
                .get("inputSchema")
                .cloned()
                .unwrap_or(serde_json::json!({}));
            tools.push(McpToolDef {
                name: name.clone(),
                description,
                input_schema,
                server_id: String::new(),
                server_name: String::new(),
                original_name: name,
            });
        }
        Ok(tools)
    }

    async fn call_tool(
        &mut self,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let id = self.next_id();
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": args
            }
        });
        let resp = self.post_request(req).await?;
        Ok(resp
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    async fn shutdown(&mut self) -> Result<()> {
        self.connected = false;
        Ok(())
    }
}

// ============ StreamableHttpTransport (MCP spec 2025-03-26) ============
// 单端点 POST /mcp，支持 JSON-RPC 请求/响应及服务器推送流

pub struct StreamableHttpTransport {
    url: String,
    client: reqwest::Client,
    request_id: u64,
    connected: bool,
}

impl StreamableHttpTransport {
    pub fn new(url: &str, bearer_token: Option<&str>) -> Result<Self> {
        let mut headers = reqwest::header::HeaderMap::new();
        // Streamable HTTP 要求 Accept: application/json, text/event-stream
        headers.insert(
            reqwest::header::ACCEPT,
            "application/json, text/event-stream"
                .parse()
                .map_err(|e| anyhow!("无效 Accept header: {}", e))?,
        );
        if let Some(token) = bearer_token {
            let auth_value = format!("Bearer {}", token);
            headers.insert(
                reqwest::header::AUTHORIZATION,
                auth_value
                    .parse()
                    .map_err(|e| anyhow!("无效 Authorization header: {}", e))?,
            );
        }

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .default_headers(headers)
            .build()
            .map_err(|e| anyhow!("创建 HTTP 客户端失败: {}", e))?;

        Ok(Self {
            url: url.to_string(),
            client,
            request_id: 0,
            connected: false,
        })
    }

    fn next_id(&mut self) -> u64 {
        self.request_id += 1;
        self.request_id
    }

    async fn post_request(&mut self, request: serde_json::Value) -> Result<serde_json::Value> {
        let resp = self
            .client
            .post(&self.url)
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                self.connected = false;
                anyhow!("Streamable HTTP 请求失败: {}", e)
            })?;

        if !resp.status().is_success() {
            self.connected = false;
            return Err(anyhow!("HTTP 错误状态码: {}", resp.status()));
        }

        // 处理响应：可能是 application/json 或 text/event-stream
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if content_type.contains("text/event-stream") {
            // SSE 流式响应：读取第一个 data: 行
            let text = resp
                .text()
                .await
                .map_err(|e| anyhow!("读取 SSE 响应失败: {}", e))?;
            for line in text.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    let body: serde_json::Value = serde_json::from_str(data)
                        .map_err(|e| anyhow!("解析 SSE JSON 失败: {}", e))?;
                    if let Some(err) = body.get("error") {
                        return Err(anyhow!("MCP 错误: {}", err));
                    }
                    return Ok(body);
                }
            }
            Err(anyhow!("SSE 响应中未找到 data 行"))
        } else {
            // 普通 JSON 响应
            let body: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| anyhow!("解析响应 JSON 失败: {}", e))?;
            if let Some(err) = body.get("error") {
                return Err(anyhow!("MCP 错误: {}", err));
            }
            Ok(body)
        }
    }
}

#[async_trait]
impl McpClient for StreamableHttpTransport {
    async fn initialize(&mut self) -> Result<serde_json::Value> {
        let id = self.next_id();
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {
                    "name": "mcstartup",
                    "version": "0.1.0"
                }
            }
        });
        let resp = self.post_request(req).await?;
        self.connected = true;
        Ok(resp
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    }

    async fn list_tools(&mut self) -> Result<Vec<McpToolDef>> {
        let id = self.next_id();
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/list",
            "params": {}
        });
        let resp = self.post_request(req).await?;
        let tools_arr = resp
            .get("result")
            .and_then(|r| r.get("tools"))
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default();

        let mut tools = Vec::new();
        for t in tools_arr {
            let name = t
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let description = t
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let input_schema = t
                .get("inputSchema")
                .cloned()
                .unwrap_or(serde_json::json!({}));
            tools.push(McpToolDef {
                name: name.clone(),
                description,
                input_schema,
                server_id: String::new(),
                server_name: String::new(),
                original_name: name,
            });
        }
        Ok(tools)
    }

    async fn call_tool(
        &mut self,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let id = self.next_id();
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": args
            }
        });
        let resp = self.post_request(req).await?;
        Ok(resp
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    }

    #[allow(dead_code)]
    fn is_connected(&self) -> bool {
        self.connected
    }

    async fn shutdown(&mut self) -> Result<()> {
        self.connected = false;
        Ok(())
    }
}

// ============ McpManager ============

pub struct McpManager {
    pub(crate) servers: HashMap<String, McpServerState>,
    tool_registry: HashMap<String, McpToolDef>,
    app_handle: tauri::AppHandle,
}

impl McpManager {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            servers: HashMap::new(),
            tool_registry: HashMap::new(),
            app_handle,
        }
    }

    /// Connect a server. On success, runs initialize + list_tools and updates registry.
    /// This is the "initial connect" path — failures do NOT trigger auto-reconnect.
    pub async fn connect_server(&mut self, config: &McpServerConfig) -> Result<()> {
        let id = config.id.clone();

        // Update status to Connecting
        self.update_server_status(&id, McpServerStatus::Connecting, config);
        self.emit_server_status_changed(&id, &McpServerStatus::Connecting);

        let client_result = Self::build_client(config).await;

        match client_result {
            Err(e) => {
                let err_msg = Self::enrich_error_message(e.to_string());
                let status = McpServerStatus::Error(err_msg.clone());
                self.update_server_status(&id, status.clone(), config);
                self.emit_server_status_changed(&id, &status);
                return Err(anyhow!(err_msg));
            }
            Ok(mut client) => {
                // Run initialize handshake
                if let Err(e) = client.initialize().await {
                    let err_msg = format!("初始化握手失败: {}", e);
                    let status = McpServerStatus::Error(err_msg.clone());
                    self.update_server_status(&id, status.clone(), config);
                    self.emit_server_status_changed(&id, &status);
                    return Err(anyhow!(err_msg));
                }

                // Discover tools
                let raw_tools = match client.list_tools().await {
                    Ok(t) => t,
                    Err(e) => {
                        let err_msg = format!("工具发现失败: {}", e);
                        let status = McpServerStatus::Error(err_msg.clone());
                        self.update_server_status(&id, status.clone(), config);
                        self.emit_server_status_changed(&id, &status);
                        return Err(anyhow!(err_msg));
                    }
                };

                // Namespace tools
                let tools = self.namespace_tools(raw_tools, &id, &config.name);

                // Update registry: remove old tools for this server, add new ones
                self.tool_registry.retain(|_, v| v.server_id != id);
                for tool in &tools {
                    self.tool_registry.insert(tool.name.clone(), tool.clone());
                }

                // Store state
                let state = McpServerState {
                    config: config.clone(),
                    status: McpServerStatus::Connected,
                    tools,
                    client: Some(client),
                    retry_count: 0,
                };
                self.servers.insert(id.clone(), state);

                self.emit_server_status_changed(&id, &McpServerStatus::Connected);
                self.emit_tools_updated();
                Ok(())
            }
        }
    }

    /// Disconnect a server and clean up its tools from the registry.
    pub async fn disconnect_server(&mut self, server_id: &str) -> Result<()> {
        if let Some(state) = self.servers.get_mut(server_id) {
            if let Some(mut client) = state.client.take() {
                let _ = client.shutdown().await;
            }
            state.status = McpServerStatus::Disconnected;
            state.tools.clear();
        }
        self.tool_registry.retain(|_, v| v.server_id != server_id);
        self.emit_server_status_changed(server_id, &McpServerStatus::Disconnected);
        self.emit_tools_updated();
        Ok(())
    }

    /// Call a tool by its namespaced name. Routes to the correct server via server_id.
    /// Applies a 30-second timeout.
    pub async fn call_tool(
        &mut self,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let tool_def = self
            .tool_registry
            .get(tool_name)
            .cloned()
            .ok_or_else(|| anyhow!("工具未找到: {}", tool_name))?;

        let server_id = tool_def.server_id.clone();
        let original_name = tool_def.original_name.clone();

        let state = self
            .servers
            .get_mut(&server_id)
            .ok_or_else(|| anyhow!("服务器未找到: {}", server_id))?;

        let client = state.client.as_mut().ok_or_else(|| anyhow!("连接已断开"))?;

        let call_future = client.call_tool(&original_name, args);
        match timeout(Duration::from_secs(30), call_future).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(e)) => {
                // Connection dropped during call — trigger reconnect
                let config = state.config.clone();
                let err_msg = e.to_string();
                state.status = McpServerStatus::Error(err_msg.clone());
                state.client = None;
                self.emit_server_status_changed(
                    &server_id,
                    &McpServerStatus::Error(err_msg.clone()),
                );
                self.schedule_reconnect(server_id.clone(), config);
                Err(anyhow!("连接已断开: {}", err_msg))
            }
            Err(_) => Err(anyhow!("工具调用超时（30s）")),
        }
    }

    pub fn list_tools(&self) -> Vec<McpToolDef> {
        self.tool_registry.values().cloned().collect()
    }

    pub fn get_servers_status(&self) -> Vec<McpServerStatusInfo> {
        self.servers
            .values()
            .map(|s| McpServerStatusInfo {
                config: s.config.clone(),
                status: s.status.clone(),
                tools: s.tools.clone(),
            })
            .collect()
    }

    /// Connect all enabled servers on app startup. Initial failures do NOT trigger reconnect.
    pub async fn connect_all_enabled(&mut self, configs: &[McpServerConfig]) {
        for config in configs {
            if config.enabled {
                if let Err(e) = self.connect_server(config).await {
                    eprintln!("[MCP] 启动时连接服务器 '{}' 失败: {}", config.name, e);
                }
            } else {
                // Register disabled server with Disconnected status
                self.servers.insert(
                    config.id.clone(),
                    McpServerState {
                        config: config.clone(),
                        status: McpServerStatus::Disconnected,
                        tools: vec![],
                        client: None,
                        retry_count: 0,
                    },
                );
            }
        }
    }

    /// Shutdown all stdio child processes on app exit.
    pub async fn shutdown_all(&mut self) {
        let ids: Vec<String> = self.servers.keys().cloned().collect();
        for id in ids {
            if let Some(state) = self.servers.get_mut(&id) {
                if let Some(mut client) = state.client.take() {
                    let _ = client.shutdown().await;
                }
            }
        }
    }

    // ---- Private helpers ----

    fn update_server_status(
        &mut self,
        server_id: &str,
        status: McpServerStatus,
        config: &McpServerConfig,
    ) {
        let entry = self
            .servers
            .entry(server_id.to_string())
            .or_insert_with(|| McpServerState {
                config: config.clone(),
                status: McpServerStatus::Disconnected,
                tools: vec![],
                client: None,
                retry_count: 0,
            });
        entry.status = status;
    }

    /// Windows: use where.exe to resolve the real path of a command
    /// so we can execute it directly without cmd /c (which breaks stdin/stdout pipes)
    #[cfg(target_os = "windows")]
    async fn resolve_command_path(command: &str) -> String {
        // Try where.exe to find the full path
        let output = tokio::process::Command::new("where.exe")
            .arg(command)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .await;
        if let Ok(out) = output {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                // where.exe returns one path per line
                // Prioritize Windows executables (.cmd, .bat, .exe) over Unix shell scripts
                let lines: Vec<&str> = stdout
                    .lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty())
                    .collect();

                // First pass: look for .cmd, .bat, or .exe files
                for line in &lines {
                    let lower = line.to_lowercase();
                    if lower.ends_with(".cmd") || lower.ends_with(".bat") || lower.ends_with(".exe")
                    {
                        return line.to_string();
                    }
                }

                // Second pass: if no Windows executable found, return the first result
                // (but this might be a Unix shell script, which will fail on Windows)
                if let Some(first) = lines.first() {
                    return first.to_string();
                }
            }
        }
        // Fallback: return as-is
        command.to_string()
    }

    async fn build_client(config: &McpServerConfig) -> Result<Box<dyn McpClient + Send>> {
        match &config.transport {
            McpTransport::Stdio { command, args, env } => {
                // Windows 上用 where.exe 解析命令的真实路径，然后直接执行
                // 避免 cmd /c 干扰 stdin/stdout 管道通信
                #[cfg(target_os = "windows")]
                let (actual_command, actual_args) = {
                    let resolved = Self::resolve_command_path(command).await;
                    (resolved, args.to_vec())
                };
                #[cfg(not(target_os = "windows"))]
                let (actual_command, actual_args) = (command.clone(), args.to_vec());

                let transport = StdioTransport::new(&actual_command, &actual_args, env).await?;
                Ok(Box::new(transport))
            }
            McpTransport::HttpSse { url } => {
                let transport = HttpSseTransport::new(url)?;
                Ok(Box::new(transport))
            }
            McpTransport::StreamableHttp { url, bearer_token } => {
                let transport = StreamableHttpTransport::new(url, bearer_token.as_deref())?;
                Ok(Box::new(transport))
            }
        }
    }

    fn enrich_error_message(msg: String) -> String {
        // 不猜路径，直接给出清晰的错误原因供用户排查
        if msg.contains("program not found")
            || msg.contains("No such file or directory")
            || msg.contains("cannot find the file")
            || msg.contains("command not found")
            || msg.contains("is not recognized")
        {
            format!(
                "{} | 排查：① 确认已安装对应运行时（Node.js/Python等）② 命令需在系统 PATH 中 ③ Windows 下安装后需重启应用",
                msg
            )
        } else {
            msg
        }
    }

    /// Apply namespace isolation: if a tool name already exists in the registry
    /// (from a different server), prefix all tools from this server with `{server_name}/`.
    fn namespace_tools(
        &self,
        raw_tools: Vec<McpToolDef>,
        server_id: &str,
        server_name: &str,
    ) -> Vec<McpToolDef> {
        // Collect names of tools already registered by OTHER servers
        let existing_names: std::collections::HashSet<String> = self
            .tool_registry
            .values()
            .filter(|t| t.server_id != server_id)
            .map(|t| t.original_name.clone())
            .collect();

        raw_tools
            .into_iter()
            .map(|mut t| {
                t.server_id = server_id.to_string();
                t.server_name = server_name.to_string();
                // Use namespaced name if there's a collision
                if existing_names.contains(&t.original_name) {
                    t.name = format!("{}/{}", server_name, t.original_name);
                } else {
                    t.name = t.original_name.clone();
                }
                t
            })
            .collect()
    }

    fn emit_tools_updated(&self) {
        let tools: Vec<McpToolDef> = self.tool_registry.values().cloned().collect();
        let _ = self.app_handle.emit_all("mcp://tools-updated", &tools);
    }

    fn emit_server_status_changed(&self, server_id: &str, status: &McpServerStatus) {
        let payload = serde_json::json!({
            "serverId": server_id,
            "status": status
        });
        let _ = self.app_handle.emit_all("mcp://server-status", &payload);
    }

    /// Schedule background reconnect for a server that disconnected at runtime.
    /// Max 3 attempts, 5s interval. Initial connection failures must NOT call this.
    fn schedule_reconnect(&self, server_id: String, config: McpServerConfig) {
        let app_handle = self.app_handle.clone();
        tokio::spawn(async move {
            // We need access to McpManagerState — retrieve it from app state
            use tauri::Manager;
            let state = match app_handle.try_state::<McpManagerState>() {
                Some(s) => s,
                None => return,
            };

            for attempt in 1..=3u32 {
                tokio::time::sleep(Duration::from_secs(5)).await;

                let mut manager = state.0.lock().await;

                // Check current retry_count
                let retry_count = manager
                    .servers
                    .get(&server_id)
                    .map(|s| s.retry_count)
                    .unwrap_or(0);

                if retry_count >= 3 {
                    // Already hit max retries (e.g. from a previous reconnect cycle)
                    break;
                }

                eprintln!(
                    "[MCP] 尝试重连服务器 '{}' (第 {}/3 次)...",
                    config.name, attempt
                );

                // Increment retry count
                if let Some(s) = manager.servers.get_mut(&server_id) {
                    s.retry_count += 1;
                }

                match manager.connect_server(&config).await {
                    Ok(_) => {
                        eprintln!("[MCP] 服务器 '{}' 重连成功", config.name);
                        // Reset retry count on success
                        if let Some(s) = manager.servers.get_mut(&server_id) {
                            s.retry_count = 0;
                        }
                        return;
                    }
                    Err(e) => {
                        eprintln!("[MCP] 重连失败 (第 {}/3 次): {}", attempt, e);
                        if attempt == 3 {
                            let status =
                                McpServerStatus::Error("重连失败，已达最大重试次数".to_string());
                            if let Some(s) = manager.servers.get_mut(&server_id) {
                                s.status = status.clone();
                            }
                            manager.emit_server_status_changed(&server_id, &status);
                        }
                    }
                }
            }
        });
    }
}

// ============ McpManagerState ============

pub struct McpManagerState(pub Arc<tokio::sync::Mutex<McpManager>>);

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: build a minimal McpToolDef
    fn make_tool(
        name: &str,
        original_name: &str,
        server_id: &str,
        server_name: &str,
    ) -> McpToolDef {
        McpToolDef {
            name: name.to_string(),
            description: String::new(),
            input_schema: serde_json::json!({}),
            server_id: server_id.to_string(),
            server_name: server_name.to_string(),
            original_name: original_name.to_string(),
        }
    }

    // ---- Test: namespace isolation logic ----
    // Simulates the namespace_tools logic without needing a real AppHandle.

    fn namespace_tools_pure(
        existing: &[McpToolDef],
        raw_tools: Vec<McpToolDef>,
        server_id: &str,
        server_name: &str,
    ) -> Vec<McpToolDef> {
        let existing_names: std::collections::HashSet<String> = existing
            .iter()
            .filter(|t| t.server_id != server_id)
            .map(|t| t.original_name.clone())
            .collect();

        raw_tools
            .into_iter()
            .map(|mut t| {
                t.server_id = server_id.to_string();
                t.server_name = server_name.to_string();
                if existing_names.contains(&t.original_name) {
                    t.name = format!("{}/{}", server_name, t.original_name);
                } else {
                    t.name = t.original_name.clone();
                }
                t
            })
            .collect()
    }

    #[test]
    fn test_namespace_no_collision() {
        // Two servers with different tool names — no namespace prefix needed
        let existing = vec![make_tool("read_file", "read_file", "server-a", "fs")];
        let raw = vec![make_tool("write_file", "write_file", "", "")];
        let result = namespace_tools_pure(&existing, raw, "server-b", "db");
        assert_eq!(result[0].name, "write_file");
    }

    #[test]
    fn test_namespace_collision_adds_prefix() {
        // Both servers expose "read_file" — second server's tool gets prefixed
        let existing = vec![make_tool("read_file", "read_file", "server-a", "fs")];
        let raw = vec![make_tool("read_file", "read_file", "", "")];
        let result = namespace_tools_pure(&existing, raw, "server-b", "db");
        assert_eq!(result[0].name, "db/read_file");
        assert_eq!(result[0].original_name, "read_file");
    }

    #[test]
    fn test_namespace_uniqueness_after_merge() {
        // After merging, all tool names in the combined registry must be unique
        let existing = vec![make_tool("read_file", "read_file", "server-a", "fs")];
        let raw = vec![
            make_tool("read_file", "read_file", "", ""),
            make_tool("write_file", "write_file", "", ""),
        ];
        let result = namespace_tools_pure(&existing, raw, "server-b", "db");

        let mut all_names: Vec<String> = existing.iter().map(|t| t.name.clone()).collect();
        all_names.extend(result.iter().map(|t| t.name.clone()));

        let unique: std::collections::HashSet<_> = all_names.iter().collect();
        assert_eq!(
            unique.len(),
            all_names.len(),
            "Tool names must be unique after merge"
        );
    }

    // ---- Test: McpServerStatus serialization round-trip ----

    #[test]
    fn test_status_disconnected_roundtrip() {
        let status = McpServerStatus::Disconnected;
        let json = serde_json::to_string(&status).unwrap();
        let back: McpServerStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(status, back);
        // Verify the JSON shape matches TypeScript expectation: { "type": "disconnected" }
        assert!(
            json.contains("\"type\":\"disconnected\"")
                || json.contains("\"type\": \"disconnected\"")
        );
    }

    #[test]
    fn test_status_connected_roundtrip() {
        let status = McpServerStatus::Connected;
        let json = serde_json::to_string(&status).unwrap();
        let back: McpServerStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(status, back);
    }

    #[test]
    fn test_status_error_roundtrip() {
        let status = McpServerStatus::Error("连接超时".to_string());
        let json = serde_json::to_string(&status).unwrap();
        let back: McpServerStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(status, back);
        // Verify content field is present
        assert!(json.contains("\"type\":\"error\"") || json.contains("\"type\": \"error\""));
        assert!(json.contains("连接超时"));
    }

    #[test]
    fn test_status_connecting_roundtrip() {
        let status = McpServerStatus::Connecting;
        let json = serde_json::to_string(&status).unwrap();
        let back: McpServerStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(status, back);
    }

    #[test]
    fn test_status_json_shape() {
        // Ensure the serde tag+content format matches TypeScript side exactly
        let error_status = McpServerStatus::Error("test error".to_string());
        let v: serde_json::Value = serde_json::to_value(&error_status).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["message"], "test error");

        let disconnected = McpServerStatus::Disconnected;
        let v2: serde_json::Value = serde_json::to_value(&disconnected).unwrap();
        assert_eq!(v2["type"], "disconnected");
        // No "message" field for unit variants
        assert!(v2.get("message").is_none());
    }
}
