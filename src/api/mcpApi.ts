import { invoke } from '@tauri-apps/api/tauri';
import type { McpServerConfig, McpToolDef, McpServerStatusInfo } from '../types/mcp';

export const mcpApi = {
  // 获取所有可用工具（每次 AI 请求前调用）
  listTools: (): Promise<McpToolDef[]> => invoke<McpToolDef[]>('mcp_list_tools'),

  // 调用工具
  // 注意：Tauri 1.5 invoke 参数 key 使用 camelCase，Rust 侧自动映射 snake_case
  // 前端传 { toolName, args } -> Rust 接收 tool_name, args
  callTool: (toolName: string, args: unknown): Promise<unknown> =>
    invoke<unknown>('mcp_call_tool', { toolName, args }),

  // 连接/重连指定服务器（内部重置 retry_count=0）
  // config 参数：新添加的服务器（尚未在 Rust servers map 中）需要传入完整配置
  connectServer: (serverId: string, config?: McpServerConfig): Promise<void> =>
    invoke<void>('mcp_connect_server', { serverId, config: config ?? null }),

  // 断开指定服务器连接
  disconnectServer: (serverId: string): Promise<void> =>
    invoke<void>('mcp_disconnect_server', { serverId }),

  // 获取所有服务器状态（含工具列表）
  getServersStatus: (): Promise<McpServerStatusInfo[]> =>
    invoke<McpServerStatusInfo[]>('mcp_get_servers_status'),
};
