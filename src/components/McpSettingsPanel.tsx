import { useState, useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useMcpStore } from '../stores/mcpStore';
import { mcpApi } from '../api/mcpApi';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import type { McpServerConfig, McpServerStatus, McpTransport } from '../types/mcp';
import {
  Plus,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Upload,
  Download,
  X,
  Copy,
  Check,
} from 'lucide-react';

// ── 运行时安装指南 ────────────────────────────────────────────────────────────
interface RuntimeGuide {
  name: string;
  description: string;
  steps: Array<{
    title: string;
    commands: string[];
    note?: string;
  }>;
  verifyCommand: string;
}

const RUNTIME_GUIDES: Record<string, RuntimeGuide> = {
  uvx: {
    name: 'uv / uvx',
    description: 'Python 包管理器，用于运行 Python 编写的 MCP 服务器',
    steps: [
      {
        title: '安装 uv（包含 uvx）',
        commands: ['powershell -c "irm https://astral.sh/uv/install.ps1 | iex"'],
        note: '或使用 winget：winget install --id astral-sh.uv -e',
      },
      {
        title: '重启应用后验证安装',
        commands: ['uv --version', 'uvx --version'],
      },
    ],
    verifyCommand: 'uvx --version',
  },
  uv: {
    name: 'uv',
    description: 'Python 包管理器',
    steps: [
      {
        title: '安装 uv',
        commands: ['powershell -c "irm https://astral.sh/uv/install.ps1 | iex"'],
        note: '或使用 winget：winget install --id astral-sh.uv -e',
      },
      {
        title: '重启应用后验证',
        commands: ['uv --version'],
      },
    ],
    verifyCommand: 'uv --version',
  },
  npx: {
    name: 'Node.js / npx',
    description: '用于运行 JavaScript/TypeScript 编写的 MCP 服务器',
    steps: [
      {
        title: '下载并安装 Node.js',
        commands: ['winget install --id OpenJS.NodeJS -e'],
        note: '或访问 https://nodejs.org 下载安装包',
      },
      {
        title: '重启应用后验证',
        commands: ['node --version', 'npx --version'],
      },
    ],
    verifyCommand: 'node --version',
  },
  node: {
    name: 'Node.js',
    description: 'JavaScript 运行时',
    steps: [
      {
        title: '安装 Node.js',
        commands: ['winget install --id OpenJS.NodeJS -e'],
        note: '或访问 https://nodejs.org 下载',
      },
      {
        title: '重启应用后验证',
        commands: ['node --version'],
      },
    ],
    verifyCommand: 'node --version',
  },
  python: {
    name: 'Python',
    description: 'Python 运行时',
    steps: [
      {
        title: '安装 Python',
        commands: ['winget install --id Python.Python.3 -e'],
        note: '或访问 https://python.org 下载',
      },
      {
        title: '重启应用后验证',
        commands: ['python --version'],
      },
    ],
    verifyCommand: 'python --version',
  },
};

/** 从错误信息中识别缺少的运行时 */
function detectMissingRuntime(errorMsg: string): RuntimeGuide | null {
  const lower = errorMsg.toLowerCase();
  if (lower.includes('uvx')) return RUNTIME_GUIDES.uvx;
  if (lower.includes('uv ') || lower.includes(': uv')) return RUNTIME_GUIDES.uv;
  if (lower.includes('npx') || lower.includes('npm')) return RUNTIME_GUIDES.npx;
  if (lower.includes('node')) return RUNTIME_GUIDES.node;
  if (lower.includes('python') || lower.includes('py ')) return RUNTIME_GUIDES.python;
  return null;
}

// ── 安装指南弹窗 ──────────────────────────────────────────────────────────────
function RuntimeInstallGuide({ guide, onClose }: { guide: RuntimeGuide; onClose: () => void }) {
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);

  function copyCmd(cmd: string, key: string) {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopiedIdx(key);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              安装 {guide.name}
            </h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{guide.description}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={18} />
          </button>
        </div>

        {/* 步骤 */}
        <div className="px-6 py-4 space-y-5 max-h-96 overflow-y-auto">
          {guide.steps.map((step, si) => (
            <div key={si}>
              <div className="flex items-center gap-2 mb-2">
                <span className="size-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {si + 1}
                </span>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {step.title}
                </span>
              </div>
              <div className="space-y-2 ml-7">
                {step.commands.map((cmd, ci) => {
                  const key = `${si}-${ci}`;
                  return (
                    <div
                      key={ci}
                      className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2"
                    >
                      <code className="flex-1 text-xs text-gray-800 dark:text-gray-200 font-mono break-all">
                        {cmd}
                      </code>
                      <button
                        onClick={() => copyCmd(cmd, key)}
                        className="flex-shrink-0 text-gray-400 hover:text-blue-500 transition-colors"
                        title="复制"
                      >
                        {copiedIdx === key ? (
                          <Check size={14} className="text-green-500" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                  );
                })}
                {step.note && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">{step.note}</p>
                )}
              </div>
            </div>
          ))}

          {/* 重要提示 */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <span className="font-semibold">安装完成后</span>
              ：需要重启本应用，使新安装的命令生效，然后点击服务器旁的重连按钮。
            </p>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 导出脱敏：env value 替换为空字符串，bearerToken 清空 ────────────────────
function exportConfig(servers: McpServerConfig[]): McpServerConfig[] {
  return servers.map((s) => ({
    ...s,
    transport:
      s.transport.type === 'stdio'
        ? {
            ...s.transport,
            env: Object.fromEntries(Object.keys(s.transport.env).map((k) => [k, ''])),
          }
        : s.transport.type === 'streamableHttp'
          ? { ...s.transport, bearerToken: undefined }
          : s.transport,
  }));
}

// ── 导入合并：按 id 去重，已存在则跳过 ──────────────────────────────────────
function mergeImport(
  existing: McpServerConfig[],
  imported: McpServerConfig[]
): { merged: McpServerConfig[]; added: number; skipped: number } {
  const existingIds = new Set(existing.map((s) => s.id));
  const newServers = imported.filter((s) => !existingIds.has(s.id));
  return {
    merged: [...existing, ...newServers],
    added: newServers.length,
    skipped: imported.length - newServers.length,
  };
}

// ── 校验导入 JSON Schema ─────────────────────────────────────────────────────
function validateImportSchema(data: unknown): data is McpServerConfig[] {
  if (!Array.isArray(data)) return false;
  return data.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as McpServerConfig).id === 'string' &&
      typeof (item as McpServerConfig).name === 'string' &&
      typeof (item as McpServerConfig).enabled === 'boolean' &&
      typeof (item as McpServerConfig).transport === 'object'
  );
}

// ── 状态颜色映射 ─────────────────────────────────────────────────────────────
function statusColor(status: McpServerStatus): string {
  switch (status.type) {
    case 'connected':
      return 'bg-green-500';
    case 'connecting':
      return 'bg-yellow-400 animate-pulse';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
}

function statusLabel(status: McpServerStatus): string {
  switch (status.type) {
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中';
    case 'error':
      return `错误: ${status.message}`;
    default:
      return '未连接';
  }
}

// ── 生成简单 UUID ────────────────────────────────────────────────────────────
function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

// ── 环境变量行类型 ───────────────────────────────────────────────────────────
interface EnvRow {
  key: string;
  value: string;
}

// ── 表单状态 ─────────────────────────────────────────────────────────────────
interface FormState {
  id: string;
  name: string;
  transportType: 'stdio' | 'httpSse' | 'streamableHttp';
  // stdio
  command: string;
  args: string; // 空格分隔的参数字符串，显示用；内部转为 string[]
  envRows: EnvRow[];
  // http
  url: string;
  bearerToken: string;
  enabled: boolean;
}

function emptyForm(): FormState {
  return {
    id: generateId(),
    name: '',
    transportType: 'stdio',
    command: '',
    args: '',
    envRows: [],
    url: '',
    bearerToken: '',
    enabled: true,
  };
}

function configToForm(config: McpServerConfig): FormState {
  if (config.transport.type === 'stdio') {
    return {
      id: config.id,
      name: config.name,
      transportType: 'stdio',
      command: config.transport.command,
      args: config.transport.args.join(' '),
      envRows: Object.entries(config.transport.env).map(([key, value]) => ({ key, value })),
      url: '',
      bearerToken: '',
      enabled: config.enabled,
    };
  }
  if (config.transport.type === 'streamableHttp') {
    return {
      id: config.id,
      name: config.name,
      transportType: 'streamableHttp',
      command: '',
      args: '',
      envRows: [],
      url: config.transport.url,
      bearerToken: config.transport.bearerToken ?? '',
      enabled: config.enabled,
    };
  }
  // httpSse
  return {
    id: config.id,
    name: config.name,
    transportType: 'httpSse',
    command: '',
    args: '',
    envRows: [],
    url: config.transport.url,
    bearerToken: '',
    enabled: config.enabled,
  };
}

function formToConfig(form: FormState): McpServerConfig {
  let transport: McpTransport;
  if (form.transportType === 'stdio') {
    // 将 args 字符串解析为数组（支持引号包裹的参数）
    const argsArr = parseArgsString(form.args);
    transport = {
      type: 'stdio',
      command: form.command.trim(),
      args: argsArr,
      env: Object.fromEntries(
        form.envRows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value])
      ),
    };
  } else if (form.transportType === 'streamableHttp') {
    transport = {
      type: 'streamableHttp',
      url: form.url.trim(),
      ...(form.bearerToken.trim() && { bearerToken: form.bearerToken.trim() }),
    };
  } else {
    transport = { type: 'httpSse', url: form.url.trim() };
  }

  return {
    id: form.id,
    name: form.name.trim(),
    transport,
    enabled: form.enabled,
  };
}

/** 简单的命令行参数解析：支持引号包裹的参数 */
function parseArgsString(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (const ch of input.trim()) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

/**
 * 解析各编辑器的 MCP JSON 配置格式，统一转换为 McpServerConfig[]
 *
 * 支持：
 * - Claude Desktop / Cursor / Windsurf：{ mcpServers: { name: { command, args, env } } }
 * - VS Code：{ servers: { name: { type: "stdio"|"sse", command, args, env, url } } }
 * - Zed：{ context_servers: { name: { command: { path, args }, env } } }
 */
function parseAnyMcpFormat(data: unknown): McpServerConfig[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  // ── Claude Desktop / Cursor / Windsurf ──────────────────────────────────
  // { mcpServers: { name: { command, args, env } } }
  if ('mcpServers' in obj && typeof obj.mcpServers === 'object' && obj.mcpServers !== null) {
    return parseMcpServerMap(obj.mcpServers as Record<string, unknown>, 'claude');
  }

  // ── VS Code ──────────────────────────────────────────────────────────────
  // { servers: { name: { type: "stdio"|"sse", command, args, env, url } } }
  if ('servers' in obj && typeof obj.servers === 'object' && obj.servers !== null) {
    return parseMcpServerMap(obj.servers as Record<string, unknown>, 'vscode');
  }

  // ── Zed ──────────────────────────────────────────────────────────────────
  // { context_servers: { name: { command: { path, args }, env } } }
  if (
    'context_servers' in obj &&
    typeof obj.context_servers === 'object' &&
    obj.context_servers !== null
  ) {
    return parseMcpServerMap(obj.context_servers as Record<string, unknown>, 'zed');
  }

  return null;
}

function parseMcpServerMap(
  map: Record<string, unknown>,
  format: 'claude' | 'vscode' | 'zed'
): McpServerConfig[] | null {
  const servers: McpServerConfig[] = [];

  for (const [name, cfg] of Object.entries(map)) {
    if (typeof cfg !== 'object' || cfg === null) continue;
    const c = cfg as Record<string, unknown>;

    if (format === 'zed') {
      // Zed: { command: { path: "npx", args: [...] }, env: {} }
      const cmd = c.command as Record<string, unknown> | undefined;
      if (cmd && typeof cmd.path === 'string') {
        servers.push({
          id: generateId(),
          name,
          enabled: true,
          transport: {
            type: 'stdio',
            command: cmd.path,
            args: Array.isArray(cmd.args) ? cmd.args.map(String) : [],
            env: parseEnv(c.env),
          },
        });
      }
      continue;
    }

    if (format === 'vscode') {
      // VS Code: { type: "stdio"|"sse", command, args, env, url }
      const serverType = typeof c.type === 'string' ? c.type : 'stdio';
      if (serverType === 'sse' && typeof c.url === 'string') {
        servers.push({
          id: generateId(),
          name,
          enabled: true,
          transport: { type: 'httpSse', url: c.url },
        });
      } else if (typeof c.command === 'string') {
        servers.push({
          id: generateId(),
          name,
          enabled: true,
          transport: {
            type: 'stdio',
            command: c.command,
            args: Array.isArray(c.args) ? c.args.map(String) : [],
            env: parseEnv(c.env),
          },
        });
      }
      continue;
    }

    // Claude Desktop / Cursor / Windsurf
    if (typeof c.command === 'string') {
      servers.push({
        id: generateId(),
        name,
        enabled: true,
        transport: {
          type: 'stdio',
          command: c.command,
          args: Array.isArray(c.args) ? c.args.map(String) : [],
          env: parseEnv(c.env),
        },
      });
    } else if (typeof c.url === 'string') {
      servers.push({
        id: generateId(),
        name,
        enabled: true,
        transport: { type: 'httpSse', url: c.url },
      });
    }
  }

  return servers.length > 0 ? servers : null;
}

function parseEnv(env: unknown): Record<string, string> {
  if (typeof env !== 'object' || env === null) return {};
  return Object.fromEntries(
    Object.entries(env as Record<string, unknown>).map(([k, v]) => [k, String(v)])
  );
}

/** @deprecated 使用 parseAnyMcpFormat 替代 */
function parseClaudeDesktopFormat(data: unknown): McpServerConfig[] | null {
  return parseAnyMcpFormat(data);
}

// ── 主组件 ───────────────────────────────────────────────────────────────────
export default function McpSettingsPanel() {
  const { mcpServers = [], updateSettings } = useSettingsStore();
  const { serversStatus, refreshServersStatus, subscribeToEvents } = useMcpStore();

  // 展开的服务器 id 集合（工具列表折叠）
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // 表单状态：null = 隐藏，否则为编辑中的表单
  const [form, setForm] = useState<FormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // 删除确认
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // 导入结果提示
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // 安装指南弹窗
  const [installGuide, setInstallGuide] = useState<RuntimeGuide | null>(null);

  // mount 时刷新状态并订阅事件
  useEffect(() => {
    refreshServersStatus();
    let unlisten: (() => void) | null = null;
    subscribeToEvents().then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
    // zustand store 方法引用稳定，不需要加入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 辅助：根据 serverId 查找运行时状态 ──────────────────────────────────
  function getStatus(serverId: string): McpServerStatus {
    const info = serversStatus.find((s) => s.config.id === serverId);
    return info?.status ?? { type: 'disconnected' };
  }

  function getTools(serverId: string): string[] {
    const info = serversStatus.find((s) => s.config.id === serverId);
    return info?.tools.map((t) => t.name) ?? [];
  }

  // ── 启用/禁用开关 ────────────────────────────────────────────────────────
  async function handleToggleEnabled(server: McpServerConfig) {
    const newEnabled = !server.enabled;
    try {
      if (newEnabled) {
        // 传入完整 config，确保新服务器也能被 Rust 后端注册并连接
        await mcpApi.connectServer(server.id, server);
      } else {
        await mcpApi.disconnectServer(server.id);
      }
    } catch (e) {
      console.error('[MCP] toggle error:', e);
    }
    const updated = mcpServers.map((s) => (s.id === server.id ? { ...s, enabled: newEnabled } : s));
    await updateSettings({ mcpServers: updated });
    refreshServersStatus();
  }

  // ── 手动重连 ─────────────────────────────────────────────────────────────
  async function handleReconnect(serverId: string) {
    try {
      // 找到对应的完整配置传给后端（确保新服务器也能注册）
      const serverConfig = mcpServers.find((s) => s.id === serverId);
      await mcpApi.connectServer(serverId, serverConfig);
      refreshServersStatus();
    } catch (e) {
      console.error('[MCP] reconnect error:', e);
    }
  }

  // ── 展开/收起工具列表 ────────────────────────────────────────────────────
  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── 表单验证 ─────────────────────────────────────────────────────────────
  function validateForm(f: FormState): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!f.name.trim()) errors.name = '名称不能为空';
    if (f.transportType === 'stdio' && !f.command.trim()) errors.command = '命令不能为空';
    if ((f.transportType === 'httpSse' || f.transportType === 'streamableHttp') && !f.url.trim())
      errors.url = 'URL 不能为空';
    return errors;
  }

  // ── 打开添加表单 ─────────────────────────────────────────────────────────
  function handleAdd() {
    setForm(emptyForm());
    setFormErrors({});
  }

  // ── 打开编辑表单 ─────────────────────────────────────────────────────────
  function handleEdit(config: McpServerConfig) {
    setForm(configToForm(config));
    setFormErrors({});
  }

  // ── 保存表单 ─────────────────────────────────────────────────────────────
  async function handleSaveForm() {
    if (!form) return;
    const errors = validateForm(form);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    const config = formToConfig(form);
    const isEdit = mcpServers.some((s) => s.id === config.id);
    const updated = isEdit
      ? mcpServers.map((s) => (s.id === config.id ? config : s))
      : [...mcpServers, config];
    await updateSettings({ mcpServers: updated });

    // 新添加且启用的服务器：自动连接（传入完整 config 注册到 Rust 后端）
    if (!isEdit && config.enabled) {
      try {
        await mcpApi.connectServer(config.id, config);
      } catch (e) {
        console.error('[MCP] auto-connect after save failed:', e);
      }
    }

    setForm(null);
    setFormErrors({});
    refreshServersStatus();
  }

  // ── 删除服务器 ───────────────────────────────────────────────────────────
  async function handleDelete(serverId: string) {
    try {
      await mcpApi.disconnectServer(serverId);
    } catch (_) {
      // ignore
    }
    const updated = mcpServers.filter((s) => s.id !== serverId);
    await updateSettings({ mcpServers: updated });
    setDeleteConfirmId(null);
    refreshServersStatus();
  }

  // ── 导出 ─────────────────────────────────────────────────────────────────
  async function handleExport() {
    const data = JSON.stringify(exportConfig(mcpServers), null, 2);
    try {
      const path = await save({
        defaultPath: 'mcp-servers.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (path) {
        await writeTextFile(path, data);
      }
    } catch (_) {
      // 降级：浏览器下载
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mcp-servers.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  // ── 环境变量行操作 ───────────────────────────────────────────────────────
  function addEnvRow() {
    setForm((f) => f && { ...f, envRows: [...f.envRows, { key: '', value: '' }] });
  }

  function updateEnvRow(index: number, field: 'key' | 'value', val: string) {
    setForm(
      (f) =>
        f && {
          ...f,
          envRows: f.envRows.map((r, i) => (i === index ? { ...r, [field]: val } : r)),
        }
    );
  }

  function removeEnvRow(index: number) {
    setForm((f) => f && { ...f, envRows: f.envRows.filter((_, i) => i !== index) });
  }

  const inputCls =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
  const errorCls = 'text-xs text-red-500 mt-1';

  // ── JSON 粘贴区 ──────────────────────────────────────────────────────────
  const [jsonPasteText, setJsonPasteText] = useState('');
  const [jsonPasteError, setJsonPasteError] = useState('');
  const [showJsonPaste, setShowJsonPaste] = useState(false);

  async function handleJsonPasteApply() {
    setJsonPasteError('');
    const text = jsonPasteText.trim();
    if (!text) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      // 自动尝试补全常见的不完整格式
      // 情况1: "mcpServers": {...} → 补全外层 {}
      // 情况2: "name": {...command...} → 补全为 {"mcpServers": {"name": {...}}}
      const wrapped1 = `{${text}}`;
      const wrapped2 = `{"mcpServers":{${text}}}`;
      try {
        parsed = JSON.parse(wrapped1);
      } catch (_) {
        try {
          parsed = JSON.parse(wrapped2);
        } catch (_) {
          setJsonPasteError('JSON 格式错误，请检查括号和引号是否完整');
          return;
        }
      }
    }

    // 优先尝试 Claude Desktop / Cursor / VS Code / Zed 格式
    const newServers = parseClaudeDesktopFormat(parsed);
    if (newServers && newServers.length > 0) {
      const { merged, added, skipped } = mergeImport(mcpServers, newServers);
      await updateSettings({ mcpServers: merged });
      // 自动连接新添加且启用的服务器
      const addedServers = newServers.filter(
        (s) => s.enabled && !mcpServers.some((existing) => existing.id === s.id)
      );
      for (const s of addedServers) {
        try {
          await mcpApi.connectServer(s.id, s);
        } catch (e) {
          console.error('[MCP] auto-connect failed:', e);
        }
      }
      setImportMsg(
        `已添加 ${added} 个服务器${skipped > 0 ? `，跳过 ${skipped} 个（已存在）` : ''}`
      );
      setJsonPasteText('');
      setShowJsonPaste(false);
      refreshServersStatus();
      return;
    }

    // 尝试标准 McpServerConfig[] 格式
    if (validateImportSchema(parsed)) {
      const { merged, added, skipped } = mergeImport(mcpServers, parsed);
      await updateSettings({ mcpServers: merged });
      const addedServers = (parsed as McpServerConfig[]).filter(
        (s) => s.enabled && !mcpServers.some((existing) => existing.id === s.id)
      );
      for (const s of addedServers) {
        try {
          await mcpApi.connectServer(s.id, s);
        } catch (e) {
          console.error('[MCP] auto-connect failed:', e);
        }
      }
      setImportMsg(
        `已添加 ${added} 个服务器${skipped > 0 ? `，跳过 ${skipped} 个（已存在）` : ''}`
      );
      setJsonPasteText('');
      setShowJsonPaste(false);
      refreshServersStatus();
      return;
    }

    setJsonPasteError(
      '无法识别格式。支持 Claude Desktop / Cursor / VS Code / Zed 的 JSON 配置格式'
    );
  }

  return (
    <div className="space-y-4">
      {/* 标题行 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">MCP 服务器</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowJsonPaste((v) => !v);
              setJsonPasteError('');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg transition-colors ${
              showJsonPaste
                ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <Upload size={14} />
            粘贴 JSON
          </button>
          <button
            onClick={handleExport}
            disabled={mcpServers.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={14} />
            导出
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus size={14} />
            添加服务器
          </button>
        </div>
      </div>

      {/* JSON 粘贴区 */}
      {showJsonPaste && (
        <div className="border border-blue-200 dark:border-blue-700 rounded-lg p-4 bg-blue-50/50 dark:bg-blue-900/10 space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              粘贴 JSON 配置
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
              支持 Claude Desktop / Cursor / VS Code / Zed 格式，直接粘贴对应编辑器的配置即可
            </p>
            <textarea
              className="w-full h-36 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder={`{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]\n    }\n  }\n}`}
              value={jsonPasteText}
              onChange={(e) => {
                setJsonPasteText(e.target.value);
                setJsonPasteError('');
              }}
              spellCheck={false}
            />
            {jsonPasteError && <p className="text-xs text-red-500 mt-1">{jsonPasteError}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowJsonPaste(false);
                setJsonPasteText('');
                setJsonPasteError('');
              }}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleJsonPasteApply}
              disabled={!jsonPasteText.trim()}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              添加
            </button>
          </div>
        </div>
      )}

      {/* 导入结果提示 */}
      {importMsg && (
        <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg text-sm text-blue-700 dark:text-blue-300">
          <span>{importMsg}</span>
          <button
            onClick={() => setImportMsg(null)}
            className="ml-2 text-blue-400 hover:text-blue-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* 服务器列表 */}
      {mcpServers.length === 0 && !form && (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
          暂无 MCP 服务器，点击「添加服务器」开始配置
        </div>
      )}

      <div className="space-y-2">
        {mcpServers.map((server) => {
          const status = getStatus(server.id);
          const tools = getTools(server.id);
          const expanded = expandedIds.has(server.id);

          return (
            <div
              key={server.id}
              className={`border rounded-lg overflow-hidden ${
                status.type === 'error'
                  ? 'border-red-300 dark:border-red-700'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              {/* 服务器行 */}
              <div
                className={`flex items-center gap-3 px-4 py-3 ${
                  status.type === 'error'
                    ? 'bg-red-50 dark:bg-red-900/10'
                    : 'bg-gray-50 dark:bg-gray-800'
                }`}
              >
                {/* 展开/收起按钮 */}
                <button
                  onClick={() => toggleExpand(server.id)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
                >
                  {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>

                {/* 状态指示灯 */}
                <span
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor(status)}`}
                  title={statusLabel(status)}
                />

                {/* 名称 + 错误信息（直接显示，不需要展开） */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate block">
                    {server.name}
                  </span>
                  {status.type === 'error' && (
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="text-xs text-red-500 dark:text-red-400 truncate"
                        title={status.message}
                      >
                        ⚠ {status.message.split('|')[0].trim()}
                      </span>
                      {detectMissingRuntime(status.message) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInstallGuide(detectMissingRuntime(status.message));
                          }}
                          className="flex-shrink-0 text-xs text-blue-500 hover:text-blue-700 underline whitespace-nowrap"
                        >
                          如何安装
                        </button>
                      )}
                    </span>
                  )}
                  {status.type === 'connected' && tools.length > 0 && (
                    <span className="text-xs text-green-600 dark:text-green-400">
                      {tools.length} 个工具可用
                    </span>
                  )}
                  {status.type === 'connecting' && (
                    <span className="text-xs text-yellow-600 dark:text-yellow-400">
                      正在连接...
                    </span>
                  )}
                </div>

                {/* 启用/禁用开关 */}
                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={server.enabled}
                    onChange={() => handleToggleEnabled(server)}
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600" />
                </label>

                {/* 手动重连按钮 — 错误时高亮提示 */}
                <button
                  onClick={() => handleReconnect(server.id)}
                  title="重新连接"
                  className={`transition-colors flex-shrink-0 ${
                    status.type === 'error'
                      ? 'text-red-400 hover:text-red-600'
                      : 'text-gray-400 hover:text-blue-500'
                  }`}
                >
                  <RefreshCw size={14} />
                </button>

                {/* 编辑按钮 */}
                <button
                  onClick={() => handleEdit(server)}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex-shrink-0"
                >
                  编辑
                </button>

                {/* 删除按钮 */}
                <button
                  onClick={() => setDeleteConfirmId(server.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* 展开区：工具列表 + 完整错误信息 */}
              {expanded && (
                <div className="px-4 py-2 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700">
                  {status.type === 'error' && (
                    <div className="mb-2 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                      <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-0.5">
                        连接失败原因：
                      </p>
                      <p className="text-xs text-red-500 dark:text-red-400 break-all">
                        {status.message}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5">
                        {detectMissingRuntime(status.message) && (
                          <button
                            type="button"
                            onClick={() => setInstallGuide(detectMissingRuntime(status.message))}
                            className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium underline"
                          >
                            📦 查看安装指南
                          </button>
                        )}
                        <a
                          href={`https://www.google.com/search?q=${encodeURIComponent(`MCP ${server.name} ${status.message.split('|')[0].trim()}`)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-gray-400 hover:text-gray-600 underline"
                        >
                          搜索解决方案 →
                        </a>
                      </div>
                    </div>
                  )}
                  {tools.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 py-1">
                      {status.type === 'connected' ? '该服务器未提供工具' : '未连接'}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 py-1">
                      {tools.map((t) => (
                        <span
                          key={t}
                          className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 删除确认对话框 */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-2">确认删除</h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              删除后将断开该服务器连接，此操作不可撤销。
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 安装指南弹窗 */}
      {installGuide && (
        <RuntimeInstallGuide guide={installGuide} onClose={() => setInstallGuide(null)} />
      )}

      {/* 添加/编辑表单 */}
      {form && (
        <div className="border border-blue-200 dark:border-blue-700 rounded-lg p-4 bg-blue-50 dark:bg-blue-900/10 space-y-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
            {mcpServers.some((s) => s.id === form.id) ? '编辑服务器' : '添加服务器'}
          </h4>

          {/* 名称 */}
          <div>
            <label className={labelCls}>名称 *</label>
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：Filesystem"
            />
            {formErrors.name && <p className={errorCls}>{formErrors.name}</p>}
          </div>

          {/* 传输类型 */}
          <div>
            <label className={labelCls}>传输类型</label>
            <div className="flex flex-wrap gap-3">
              {(
                [
                  { value: 'stdio', label: 'stdio（本地进程）', desc: '通过命令启动本地子进程' },
                  {
                    value: 'streamableHttp',
                    label: 'Streamable HTTP（推荐远程）',
                    desc: 'MCP 2025-03-26 新规范',
                  },
                  { value: 'httpSse', label: 'HTTP/SSE（旧版远程）', desc: '兼容旧版服务器' },
                ] as const
              ).map((t) => (
                <label key={t.value} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="transportType"
                    value={t.value}
                    checked={form.transportType === t.value}
                    onChange={() => setForm({ ...form, transportType: t.value })}
                    className="text-blue-600 mt-0.5"
                  />
                  <span>
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                      {t.label}
                    </span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500">{t.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* stdio 字段 */}
          {form.transportType === 'stdio' && (
            <>
              <div>
                <label className={labelCls}>命令 *</label>
                <input
                  className={inputCls}
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  placeholder="可执行文件，如：npx 或 python 或 node"
                />
                {formErrors.command && <p className={errorCls}>{formErrors.command}</p>}
              </div>

              <div>
                <label className={labelCls}>参数</label>
                <input
                  className={inputCls}
                  value={form.args}
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
                  placeholder="参数列表，如：-y @modelcontextprotocol/server-filesystem /path"
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  空格分隔，含空格的参数用引号包裹。等同于 Claude Desktop 的 args 数组。
                </p>
              </div>

              {/* 环境变量 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={labelCls + ' mb-0'}>环境变量</label>
                  <button
                    type="button"
                    onClick={addEnvRow}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                  >
                    <Plus size={12} />
                    添加
                  </button>
                </div>
                {form.envRows.length === 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">暂无环境变量</p>
                )}
                <div className="space-y-2">
                  {form.envRows.map((row, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        className={inputCls + ' flex-1'}
                        placeholder="KEY"
                        value={row.key}
                        onChange={(e) => updateEnvRow(i, 'key', e.target.value)}
                      />
                      <input
                        className={inputCls + ' flex-1'}
                        placeholder="VALUE"
                        value={row.value}
                        onChange={(e) => updateEnvRow(i, 'value', e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => removeEnvRow(i)}
                        className="text-gray-400 hover:text-red-500 flex-shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Streamable HTTP 字段 */}
          {form.transportType === 'streamableHttp' && (
            <>
              <div>
                <label className={labelCls}>端点 URL *</label>
                <input
                  className={inputCls}
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="例如：http://localhost:3000/mcp"
                />
                {formErrors.url && <p className={errorCls}>{formErrors.url}</p>}
              </div>
              <div>
                <label className={labelCls}>Bearer Token（可选）</label>
                <input
                  className={inputCls}
                  type="password"
                  value={form.bearerToken}
                  onChange={(e) => setForm({ ...form, bearerToken: e.target.value })}
                  placeholder="留空则不使用认证"
                />
              </div>
            </>
          )}

          {/* HTTP/SSE 旧版字段 */}
          {form.transportType === 'httpSse' && (
            <div>
              <label className={labelCls}>SSE 端点 URL *</label>
              <input
                className={inputCls}
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="例如：http://localhost:3000/sse"
              />
              {formErrors.url && <p className={errorCls}>{formErrors.url}</p>}
            </div>
          )}

          {/* 表单操作按钮 */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => {
                setForm(null);
                setFormErrors({});
              }}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSaveForm}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
