// MCP 集成相关 TypeScript 类型定义
// 与 Rust 后端 mcp_manager.rs 的 serde 序列化格式对齐

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
}

// 与 Rust McpTransport serde tag+rename_all camelCase 对齐
export type McpTransport =
  | {
      type: 'stdio';
      /** 可执行文件，如 "npx"、"python"、"node" */
      command: string;
      /** 参数列表，如 ["-y", "@modelcontextprotocol/server-filesystem", "/path"] */
      args: string[];
      env: Record<string, string>;
    }
  | {
      type: 'httpSse';
      /** 旧版 SSE 端点，如 "http://localhost:3000/sse" */
      url: string;
    }
  | {
      type: 'streamableHttp';
      /** Streamable HTTP 端点，如 "http://localhost:3000/mcp" */
      url: string;
      /** 可选 Bearer token */
      bearerToken?: string;
    };

// 与 Rust McpServerStatus serde tag+content+rename_all camelCase 对齐
// Disconnected -> { "type": "disconnected" }
// Error("msg") -> { "type": "error", "message": "msg" }
export type McpServerStatus =
  | { type: 'disconnected' }
  | { type: 'connecting' }
  | { type: 'connected' }
  | { type: 'error'; message: string };

export interface McpToolDef {
  name: string; // 命名空间化，如 "filesystem/read_file"
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
