import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { mcpApi } from '../api/mcpApi';
import type { McpToolDef, McpServerStatusInfo } from '../types/mcp';

interface McpState {
  tools: McpToolDef[];
  serversStatus: McpServerStatusInfo[];
  refreshTools: () => Promise<void>;
  refreshServersStatus: () => Promise<void>;
  // 订阅 Tauri events，返回 unlisten 函数（在组件 unmount 时调用）
  subscribeToEvents: () => Promise<() => void>;
}

export const useMcpStore = create<McpState>((set) => ({
  tools: [],
  serversStatus: [],

  refreshTools: async () => {
    try {
      const tools = await mcpApi.listTools();
      set({ tools });
    } catch (e) {
      console.error('[MCP] Failed to refresh tools:', e);
    }
  },

  refreshServersStatus: async () => {
    try {
      const serversStatus = await mcpApi.getServersStatus();
      set({ serversStatus });
    } catch (e) {
      console.error('[MCP] Failed to refresh servers status:', e);
    }
  },

  subscribeToEvents: async () => {
    const unlistenTools = await listen<McpToolDef[]>('mcp://tools-updated', (event) => {
      set({ tools: event.payload });
    });

    const unlistenStatus = await listen('mcp://server-status', async () => {
      // Re-fetch full status on any server status change
      try {
        const serversStatus = await mcpApi.getServersStatus();
        set({ serversStatus });
      } catch (e) {
        console.error('[MCP] Failed to update servers status:', e);
      }
    });

    return () => {
      unlistenTools();
      unlistenStatus();
    };
  },
}));
