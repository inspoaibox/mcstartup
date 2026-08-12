use crate::mcp_manager::{McpManagerState, McpServerConfig, McpServerStatusInfo, McpToolDef};
use tauri::State;

#[tauri::command]
pub async fn mcp_list_tools(state: State<'_, McpManagerState>) -> Result<Vec<McpToolDef>, String> {
    let manager = state.0.lock().await;
    Ok(manager.list_tools())
}

#[tauri::command]
pub async fn mcp_call_tool(
    state: State<'_, McpManagerState>,
    tool_name: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = state.0.lock().await;
    manager
        .call_tool(&tool_name, args)
        .await
        .map_err(|e| e.to_string())
}

/// 连接/重连服务器。
/// - 如果服务器已在 servers map 中：重置 retry_count 并重连
/// - 如果服务器不在 map 中（新添加）：需要传入 config 参数来注册并连接
#[tauri::command]
pub async fn mcp_connect_server(
    state: State<'_, McpManagerState>,
    server_id: String,
    config: Option<McpServerConfig>,
) -> Result<(), String> {
    let mut manager = state.0.lock().await;

    // Reset retry_count before reconnecting
    if let Some(server) = manager.servers.get_mut(&server_id) {
        server.retry_count = 0;
    }

    // 优先从 map 获取配置，其次使用传入的 config
    let cfg = manager
        .servers
        .get(&server_id)
        .map(|s| s.config.clone())
        .or(config)
        .ok_or_else(|| format!("服务器 {} 未找到，请传入配置参数", server_id))?;

    manager
        .connect_server(&cfg)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_disconnect_server(
    state: State<'_, McpManagerState>,
    server_id: String,
) -> Result<(), String> {
    let mut manager = state.0.lock().await;
    manager
        .disconnect_server(&server_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_get_servers_status(
    state: State<'_, McpManagerState>,
) -> Result<Vec<McpServerStatusInfo>, String> {
    let manager = state.0.lock().await;
    Ok(manager.get_servers_status())
}
