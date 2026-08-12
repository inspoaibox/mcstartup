import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Copy,
  DownloadCloud,
  Edit2,
  FileJson,
  Gauge,
  Globe,
  History,
  Layers,
  Library,
  ListChecks,
  Package,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Terminal,
  Trash2,
  UploadCloud,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { writeText } from '@tauri-apps/api/clipboard';
import { open as openDialog, save as saveDialog } from '@tauri-apps/api/dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/api/fs';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';
import {
  MCP_MANAGER_VERSION,
  useToolDataStore,
  type McpClientProfile,
  type McpClientType,
  type McpEnvVar,
  type McpGroup,
  type McpManagerData,
  type McpMarketService,
  type McpPackageManager,
  type McpRequestLog,
  type McpService,
  type McpServiceStatus,
  type McpToolDefinition,
  type McpTransport,
} from '../stores/toolDataStore';

type ViewKey = 'dashboard' | 'services' | 'groups' | 'market' | 'clients' | 'logs' | 'settings';

const DEFAULT_MARKET_SERVICES: McpMarketService[] = [
  {
    id: 'market_filesystem',
    name: 'filesystem',
    displayName: 'Filesystem',
    description: '本地文件读写、目录遍历和文件检索',
    packageManager: 'npm',
    packageName: '@modelcontextprotocol/server-filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\workspace'],
    env: [],
    tags: ['local', 'files'],
    sourceUrl: 'https://github.com/modelcontextprotocol/servers',
    stars: 52000,
  },
  {
    id: 'market_github',
    name: 'github',
    displayName: 'GitHub',
    description: '仓库、Issue、PR 和代码检索',
    packageManager: 'npm',
    packageName: '@modelcontextprotocol/server-github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: '', required: true, secret: true }],
    tags: ['code', 'repo'],
    sourceUrl: 'https://github.com/modelcontextprotocol/servers',
    stars: 52000,
  },
  {
    id: 'market_playwright',
    name: 'playwright',
    displayName: 'Playwright',
    description: '浏览器自动化、页面截图和交互测试',
    packageManager: 'npm',
    packageName: '@playwright/mcp',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    env: [],
    tags: ['browser', 'automation'],
    sourceUrl: 'https://github.com/microsoft/playwright-mcp',
    stars: 19000,
  },
  {
    id: 'market_postgres',
    name: 'postgres',
    displayName: 'PostgreSQL',
    description: 'PostgreSQL 查询、表结构和只读分析',
    packageManager: 'npm',
    packageName: '@modelcontextprotocol/server-postgres',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://user:pass@localhost:5432/db'],
    env: [],
    tags: ['database', 'sql'],
    sourceUrl: 'https://github.com/modelcontextprotocol/servers',
    stars: 52000,
  },
  {
    id: 'market_fetch',
    name: 'fetch',
    displayName: 'Fetch',
    description: '网页抓取、HTTP 请求和内容提取',
    packageManager: 'pypi',
    packageName: 'mcp-server-fetch',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    env: [],
    tags: ['web', 'http'],
    sourceUrl: 'https://github.com/modelcontextprotocol/servers',
    stars: 52000,
  },
  {
    id: 'market_sequential_thinking',
    name: 'sequential-thinking',
    displayName: 'Sequential Thinking',
    description: '分步推理、计划拆解和复杂任务复盘',
    packageManager: 'npm',
    packageName: '@modelcontextprotocol/server-sequential-thinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    env: [],
    tags: ['reasoning', 'planning'],
    sourceUrl: 'https://github.com/modelcontextprotocol/servers',
    stars: 52000,
  },
];

const TRANSPORT_LABELS: Record<McpTransport, string> = {
  stdio: 'stdio',
  sse: 'SSE',
  'streamable-http': 'HTTP',
};

const CLIENT_LABELS: Record<McpClientType, string> = {
  codex: 'Codex',
  claude: 'Claude',
  cursor: 'Cursor',
  kiro: 'Kiro',
  gemini: 'Gemini CLI',
  windsurf: 'Windsurf',
  vscode: 'VS Code',
  cline: 'Cline',
  custom: 'Custom',
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function nowIso() {
  return new Date().toISOString();
}

function idOf(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `mcp-${Date.now()}`
  );
}

function splitTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，#\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function parseLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseKeyValueLines(value: string) {
  const result: Record<string, string> = {};
  for (const line of parseLines(value)) {
    const [key, ...rest] = line.split('=');
    if (key?.trim()) result[key.trim()] = rest.join('=').trim();
  }
  return result;
}

function parseEnvLines(value: string): McpEnvVar[] {
  return parseLines(value).map((line) => {
    const [key, ...rest] = line.split('=');
    const normalizedKey = key.trim();
    const upper = normalizedKey.toUpperCase();
    return {
      key: normalizedKey,
      value: rest.join('=').trim(),
      required: !rest.length || rest.join('=').trim().length === 0,
      secret: /TOKEN|SECRET|KEY|PASSWORD|PASS/.test(upper),
    };
  });
}

function envToText(env: McpEnvVar[]) {
  return env.map((item) => `${item.key}=${item.value}`).join('\n');
}

function headersToText(headers: Record<string, string>) {
  return Object.entries(headers)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function parseTools(value: string): McpToolDefinition[] {
  return parseLines(value).map((line) => {
    const [name, ...rest] = line.split(':');
    return {
      name: name.trim(),
      description: rest.join(':').trim() || '无描述',
    };
  });
}

function toolsToText(tools: McpToolDefinition[]) {
  return tools.map((tool) => `${tool.name}: ${tool.description}`).join('\n');
}

function serviceStatus(service: McpService): McpServiceStatus {
  if (!service.enabled) return 'disabled';
  if (service.transport === 'stdio' && !service.command?.trim()) return 'unhealthy';
  if (service.transport !== 'stdio' && !service.url?.trim()) return 'unhealthy';
  if (service.env.some((item) => item.required && !item.value.trim())) return 'unhealthy';
  return 'healthy';
}

function statusLabel(status: McpServiceStatus) {
  if (status === 'healthy') return '健康';
  if (status === 'unhealthy') return '异常';
  if (status === 'disabled') return '停用';
  return '未知';
}

function statusClass(status: McpServiceStatus) {
  if (status === 'healthy') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300';
  if (status === 'unhealthy') return 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300';
  if (status === 'disabled') return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300';
  return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300';
}

function formatMs(value: number) {
  return `${Math.round(value)}ms`;
}

async function copyText(value: string) {
  try {
    await writeText(value);
  } catch {
    await navigator.clipboard.writeText(value);
  }
}

function serviceToConfig(service: McpService): Record<string, unknown> {
  if (service.transport === 'stdio') {
    const env = Object.fromEntries(service.env.filter((item) => item.value).map((item) => [item.key, item.value]));
    return {
      command: service.command || '',
      args: service.args,
      ...(Object.keys(env).length ? { env } : {}),
    };
  }
  return {
    url: service.url || '',
    ...(Object.keys(service.headers).length ? { headers: service.headers } : {}),
  };
}

function groupToConfig(group: McpGroup, proxyBaseUrl: string, userToken: string): Record<string, unknown> {
  const token = userToken ? `?key=${encodeURIComponent(userToken)}` : '';
  return {
    url: `${proxyBaseUrl.replace(/\/$/, '')}/proxy/${group.name}/mcp${token}`,
  };
}

function tomlKey(value: string) {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

function buildClientConfig(
  clientType: McpClientType,
  services: McpService[],
  groups: McpGroup[],
  serviceIds: string[],
  groupIds: string[],
  proxyBaseUrl: string,
  userToken: string
) {
  const mcpServers: Record<string, unknown> = {};
  for (const service of services) {
    if (serviceIds.includes(service.id) && service.enabled) {
      mcpServers[service.name] = serviceToConfig(service);
    }
  }
  for (const group of groups) {
    if (groupIds.includes(group.id) && group.enabled) {
      mcpServers[group.name] = groupToConfig(group, proxyBaseUrl, userToken);
    }
  }
  if (clientType === 'codex') {
    return Object.entries(mcpServers)
      .map(([name, config]) => {
        const item = config as { command?: string; args?: string[]; env?: Record<string, string>; url?: string };
        const key = tomlKey(name);
        if (item.command) {
          const lines = [`[mcp_servers.${key}]`, `command = ${JSON.stringify(item.command)}`];
          if (item.args?.length) lines.push(`args = ${JSON.stringify(item.args)}`);
          if (item.env && Object.keys(item.env).length) {
            lines.push('', `[mcp_servers.${key}.env]`);
            Object.entries(item.env).forEach(([key, value]) => lines.push(`${key} = ${JSON.stringify(value)}`));
          }
          return lines.join('\n');
        }
        return [`[mcp_servers.${key}]`, `url = ${JSON.stringify(item.url || '')}`].join('\n');
      })
      .join('\n\n');
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

function marketToService(item: McpMarketService): McpService {
  const time = nowIso();
  return {
    id: idOf('mcp'),
    name: item.name,
    displayName: item.displayName,
    description: item.description,
    transport: item.url ? 'sse' : 'stdio',
    enabled: true,
    status: 'unknown',
    command: item.command,
    args: item.args,
    url: item.url,
    headers: {},
    env: item.env,
    packageManager: item.packageManager,
    packageName: item.packageName,
    sourceUrl: item.sourceUrl,
    tags: item.tags,
    tools: [],
    stats: {
      totalRequests: 0,
      todayRequests: 0,
      avgLatencyMs: 0,
      errorCount: 0,
    },
    createdAt: time,
    updatedAt: time,
  };
}

function parseMcpJsonConfig(value: string): McpService[] {
  const parsed = JSON.parse(value) as { mcpServers?: Record<string, Record<string, unknown>> };
  const servers = parsed.mcpServers || {};
  const time = nowIso();
  return Object.entries(servers).map(([name, config]) => {
    const envObject = (config.env || {}) as Record<string, string>;
    const command = typeof config.command === 'string' ? config.command : undefined;
    const url = typeof config.url === 'string' ? config.url : undefined;
    const args = Array.isArray(config.args) ? config.args.map(String) : [];
    const headers = typeof config.headers === 'object' && config.headers ? (config.headers as Record<string, string>) : {};
    return {
      id: idOf('mcp'),
      name: slugify(name),
      displayName: name,
      description: '从 MCP JSON 导入',
      transport: command ? 'stdio' : 'sse',
      enabled: true,
      status: 'unknown',
      command,
      args,
      url,
      headers,
      env: Object.entries(envObject).map(([key, value]) => ({
        key,
        value: String(value),
        required: false,
        secret: /TOKEN|SECRET|KEY|PASSWORD|PASS/.test(key.toUpperCase()),
      })),
      packageManager: 'custom',
      tags: ['imported'],
      tools: [],
      stats: {
        totalRequests: 0,
        todayRequests: 0,
        avgLatencyMs: 0,
        errorCount: 0,
      },
      createdAt: time,
      updatedAt: time,
    } satisfies McpService;
  });
}

export default function McpLibraryTool() {
  const ready = useToolTheme();
  const { data, loaded, loading, loadData, updateMcpLibraryData } = useToolDataStore();
  const [view, setView] = useState<ViewKey>('dashboard');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingService, setEditingService] = useState<McpService | null>(null);
  const [serviceEditorOpen, setServiceEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<McpGroup | null>(null);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<McpClientProfile | null>(null);
  const [clientEditorOpen, setClientEditorOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const manager = data.mcpLibrary;
  const services = manager?.version === MCP_MANAGER_VERSION ? manager.services : [];
  const groups = manager?.version === MCP_MANAGER_VERSION ? manager.groups : [];
  const clients = manager?.version === MCP_MANAGER_VERSION ? manager.clients : [];
  const market = manager?.version === MCP_MANAGER_VERSION && manager.market.length ? manager.market : DEFAULT_MARKET_SERVICES;
  const logs = manager?.version === MCP_MANAGER_VERSION ? manager.logs : [];
  const proxyBaseUrl = manager?.version === MCP_MANAGER_VERSION ? manager.proxyBaseUrl : 'http://127.0.0.1:3000';
  const userToken = manager?.version === MCP_MANAGER_VERSION ? manager.userToken : '';

  useEffect(() => {
    if (!loaded && !loading) {
      loadData();
    }
  }, [loadData, loaded, loading]);

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2200);
  };

  const patch = (value: Partial<McpManagerData>, log?: Omit<McpRequestLog, 'id' | 'createdAt'>) => {
    const nextPatch = { ...value };
    if (log) {
      const nextLogs = value.logs || logs;
      nextPatch.logs = [
        {
          id: idOf('log'),
          createdAt: nowIso(),
          ...log,
        },
        ...nextLogs,
      ].slice(0, 240);
    }
    updateMcpLibraryData(nextPatch);
  };

  const filteredServices = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return services;
    return services.filter((service) => {
      return (
        service.name.toLowerCase().includes(keyword) ||
        service.displayName.toLowerCase().includes(keyword) ||
        service.description.toLowerCase().includes(keyword) ||
        service.tags.some((tag) => tag.toLowerCase().includes(keyword)) ||
        service.tools.some((tool) => tool.name.toLowerCase().includes(keyword))
      );
    });
  }, [search, services]);

  const enabledServices = services.filter((service) => service.enabled);
  const healthyServices = services.filter((service) => serviceStatus(service) === 'healthy');
  const totalRequests = services.reduce((total, service) => total + service.stats.todayRequests, 0);
  const avgLatency =
    enabledServices.length > 0
      ? enabledServices.reduce((total, service) => total + service.stats.avgLatencyMs, 0) / enabledServices.length
      : 0;

  const upsertService = (service: McpService) => {
    const exists = services.some((item) => item.id === service.id);
    patch(
      {
        services: exists
          ? services.map((item) => (item.id === service.id ? service : item))
          : [service, ...services],
      },
      {
        level: 'success',
        serviceId: service.id,
        message: `${exists ? '更新' : '安装'}服务 ${service.displayName}`,
      }
    );
    setServiceEditorOpen(false);
    setEditingService(null);
    notify('服务已保存');
  };

  const deleteServices = (ids: string[]) => {
    if (!ids.length) return;
    if (!confirm(`确定删除 ${ids.length} 个 MCP 服务吗？`)) return;
    const idSet = new Set(ids);
    patch(
      {
        services: services.filter((service) => !idSet.has(service.id)),
        groups: groups.map((group) => ({
          ...group,
          serviceIds: group.serviceIds.filter((id) => !idSet.has(id)),
          updatedAt: nowIso(),
        })),
        clients: clients.map((client) => ({
          ...client,
          serviceIds: client.serviceIds.filter((id) => !idSet.has(id)),
          updatedAt: nowIso(),
        })),
      },
      {
        level: 'warn',
        message: `删除 ${ids.length} 个 MCP 服务`,
      }
    );
    setSelectedIds([]);
  };

  const toggleService = (id: string) => {
    patch({
      services: services.map((service) =>
        service.id === id
          ? {
              ...service,
              enabled: !service.enabled,
              status: !service.enabled ? 'unknown' : 'disabled',
              updatedAt: nowIso(),
            }
          : service
      ),
    });
  };

  const checkHealth = (ids: string[]) => {
    const idSet = new Set(ids);
    const time = nowIso();
    patch(
      {
        services: services.map((service) => {
          if (!idSet.has(service.id)) return service;
          const status = serviceStatus(service);
          const latency = status === 'healthy' ? Math.max(25, service.stats.avgLatencyMs || 80) : service.stats.avgLatencyMs;
          return {
            ...service,
            status,
            lastHealthCheck: time,
            healthMessage: status === 'healthy' ? '本地配置检查通过' : '缺少启动命令、URL 或必填环境变量',
            stats: {
              ...service.stats,
              avgLatencyMs: latency,
              todayRequests: service.stats.todayRequests + (status === 'healthy' ? 1 : 0),
              totalRequests: service.stats.totalRequests + (status === 'healthy' ? 1 : 0),
              errorCount: service.stats.errorCount + (status === 'healthy' ? 0 : 1),
            },
            updatedAt: time,
          };
        }),
      },
      {
        level: 'info',
        message: `检查 ${ids.length} 个服务健康状态`,
      }
    );
    notify('健康检查完成');
  };

  const installMarketService = (item: McpMarketService) => {
    if (services.some((service) => service.name === item.name)) {
      notify('服务已存在');
      return;
    }
    upsertService(marketToService(item));
  };

  const importConfigText = (value: string) => {
    try {
      const imported = parseMcpJsonConfig(value);
      patch(
        { services: [...imported, ...services] },
        { level: 'success', message: `导入 ${imported.length} 个 MCP 服务` }
      );
      notify('导入完成');
    } catch {
      notify('JSON 格式错误');
    }
  };

  const importConfigFile = async () => {
    const selected = await openDialog({
      title: '选择 MCP JSON',
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected || Array.isArray(selected)) return;
    importConfigText(await readTextFile(selected));
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon={<Zap size={18} />}
        title="One MCP Manager"
        subtitle={`${services.length} Services · ${groups.length} Groups · ${clients.length} Clients`}
        closeMode="hide"
        actions={
          <>
          <button
            onClick={importConfigFile}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            <DownloadCloud size={15} />
            导入
          </button>
          <button
            onClick={() => {
              setEditingService(null);
              setServiceEditorOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900"
          >
            <Plus size={15} />
            新服务
          </button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 border-r border-gray-200 bg-gray-50/80 p-3 dark:border-gray-800 dark:bg-gray-900/60">
          <nav className="space-y-1">
            <NavButton icon={Gauge} label="仪表盘" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
            <NavButton icon={Server} label="服务管理" active={view === 'services'} onClick={() => setView('services')} />
            <NavButton icon={Layers} label="服务组合" active={view === 'groups'} onClick={() => setView('groups')} />
            <NavButton icon={Library} label="服务市场" active={view === 'market'} onClick={() => setView('market')} />
            <NavButton icon={Users} label="客户端配置" active={view === 'clients'} onClick={() => setView('clients')} />
            <NavButton icon={History} label="日志分析" active={view === 'logs'} onClick={() => setView('logs')} />
            <NavButton icon={Settings} label="设置" active={view === 'settings'} onClick={() => setView('settings')} />
          </nav>

          <div className="mt-5 space-y-3">
            <SideMetric label="健康服务" value={healthyServices.length} />
            <SideMetric label="今日请求" value={totalRequests} />
            <SideMetric label="平均延迟" value={formatMs(avgLatency)} />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {view === 'dashboard' && (
            <DashboardView
              services={services}
              groups={groups}
              clients={clients}
              logs={logs}
              proxyBaseUrl={proxyBaseUrl}
              healthyServices={healthyServices.length}
              totalRequests={totalRequests}
              avgLatency={avgLatency}
              onOpenServices={() => setView('services')}
              onOpenMarket={() => setView('market')}
              onCopy={(text) => {
                copyText(text);
                notify('已复制');
              }}
            />
          )}

          {view === 'services' && (
            <ServicesView
              services={filteredServices}
              allServices={services}
              search={search}
              selectedIds={selectedIds}
              onSearch={setSearch}
              onSelectedIds={setSelectedIds}
              onEdit={(service) => {
                setEditingService(service);
                setServiceEditorOpen(true);
              }}
              onDelete={(ids) => deleteServices(ids)}
              onToggle={toggleService}
              onHealthCheck={(ids) => checkHealth(ids)}
              onCopy={(service) => {
                copyText(JSON.stringify({ mcpServers: { [service.name]: serviceToConfig(service) } }, null, 2));
                notify('已复制配置');
              }}
            />
          )}

          {view === 'groups' && (
            <GroupsView
              services={services}
              groups={groups}
              proxyBaseUrl={proxyBaseUrl}
              userToken={userToken}
              onPatch={patch}
              onEdit={(group) => {
                setEditingGroup(group);
                setGroupEditorOpen(true);
              }}
              onCreate={() => {
                setEditingGroup(null);
                setGroupEditorOpen(true);
              }}
              onCopy={(value) => {
                copyText(value);
                notify('已复制');
              }}
            />
          )}

          {view === 'market' && (
            <MarketView
              market={market}
              services={services}
              onInstall={installMarketService}
              onImportText={importConfigText}
            />
          )}

          {view === 'clients' && (
            <ClientsView
              clients={clients}
              services={services}
              groups={groups}
              proxyBaseUrl={proxyBaseUrl}
              userToken={userToken}
              onPatch={patch}
              onEdit={(client) => {
                setEditingClient(client);
                setClientEditorOpen(true);
              }}
              onCreate={() => {
                setEditingClient(null);
                setClientEditorOpen(true);
              }}
              onCopy={(value) => {
                copyText(value);
                notify('已复制');
              }}
            />
          )}

          {view === 'logs' && <LogsView logs={logs} services={services} onPatch={patch} />}

          {view === 'settings' && (
            <SettingsView
              manager={{
                version: MCP_MANAGER_VERSION,
                proxyBaseUrl,
                userToken,
                services,
                groups,
                clients,
                market,
                logs,
                lastModified: nowIso(),
              }}
              onPatch={patch}
              onNotice={notify}
            />
          )}
        </main>
      </div>

      {serviceEditorOpen && (
        <ServiceEditorDialog
          service={editingService}
          onClose={() => {
            setServiceEditorOpen(false);
            setEditingService(null);
          }}
          onSave={upsertService}
        />
      )}

      {groupEditorOpen && (
        <GroupEditorDialog
          group={editingGroup}
          services={services}
          onClose={() => {
            setGroupEditorOpen(false);
            setEditingGroup(null);
          }}
          onSave={(group) => {
            const exists = groups.some((item) => item.id === group.id);
            patch(
              { groups: exists ? groups.map((item) => (item.id === group.id ? group : item)) : [group, ...groups] },
              { level: 'success', groupId: group.id, message: `${exists ? '更新' : '创建'}服务组合 ${group.displayName}` }
            );
            setGroupEditorOpen(false);
            setEditingGroup(null);
          }}
        />
      )}

      {clientEditorOpen && (
        <ClientEditorDialog
          client={editingClient}
          services={services}
          groups={groups}
          onClose={() => {
            setClientEditorOpen(false);
            setEditingClient(null);
          }}
          onSave={(client) => {
            const exists = clients.some((item) => item.id === client.id);
            patch(
              { clients: exists ? clients.map((item) => (item.id === client.id ? client : item)) : [client, ...clients] },
              { level: 'success', message: `${exists ? '更新' : '新增'}客户端 ${client.name}` }
            );
            setClientEditorOpen(false);
            setEditingClient(null);
          }}
        />
      )}

      {notice && (
        <div className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-gray-900">
          {notice}
        </div>
      )}
    </div>
  );
}

function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
        active
          ? 'bg-white font-medium text-gray-950 shadow-sm dark:bg-gray-800 dark:text-white'
          : 'text-gray-600 hover:bg-white hover:text-gray-950 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
      )}
    >
      <Icon size={16} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function SideMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-white p-3 dark:bg-gray-800">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function DashboardView({
  services,
  groups,
  clients,
  logs,
  proxyBaseUrl,
  healthyServices,
  totalRequests,
  avgLatency,
  onOpenServices,
  onOpenMarket,
  onCopy,
}: {
  services: McpService[];
  groups: McpGroup[];
  clients: McpClientProfile[];
  logs: McpRequestLog[];
  proxyBaseUrl: string;
  healthyServices: number;
  totalRequests: number;
  avgLatency: number;
  onOpenServices: () => void;
  onOpenMarket: () => void;
  onCopy: (value: string) => void;
}) {
  const errorCount = services.reduce((total, service) => total + service.stats.errorCount, 0);

  return (
    <div className="min-h-0 h-full overflow-y-auto p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric icon={Server} label="服务总数" value={services.length} />
        <Metric icon={CheckCircle2} label="健康服务" value={healthyServices} />
        <Metric icon={Activity} label="今日请求" value={totalRequests} />
        <Metric icon={BarChart3} label="平均延迟" value={formatMs(avgLatency)} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">代理端点</h2>
            <button
              onClick={() => onCopy(proxyBaseUrl)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs dark:border-gray-700"
            >
              <Copy size={13} />
              复制
            </button>
          </div>
          <div className="rounded-md bg-gray-950 p-3 font-mono text-xs text-gray-100">
            {proxyBaseUrl.replace(/\/$/, '')}/proxy/&lt;service-or-group&gt;/mcp
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <SmallInfo icon={Layers} label="服务组合" value={`${groups.length}`} />
            <SmallInfo icon={Users} label="客户端" value={`${clients.length}`} />
            <SmallInfo icon={AlertCircle} label="错误数" value={`${errorCount}`} />
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold">快速操作</h2>
          <div className="grid gap-2">
            <ActionButton icon={Server} label="管理服务" onClick={onOpenServices} />
            <ActionButton icon={Package} label="打开市场" onClick={onOpenMarket} />
            <ActionButton
              icon={FileJson}
              label="复制全部配置"
              onClick={() =>
                onCopy(
                  buildClientConfig(
                    'claude',
                    services,
                    groups,
                    services.map((service) => service.id),
                    groups.map((group) => group.id),
                    proxyBaseUrl,
                    ''
                  )
                )
              }
            />
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold">服务健康</h2>
          <div className="space-y-2">
            {services.slice(0, 8).map((service) => (
              <div key={service.id} className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-950">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{service.displayName}</div>
                  <div className="truncate text-xs text-gray-500">{service.healthMessage || TRANSPORT_LABELS[service.transport]}</div>
                </div>
                <span className={cn('rounded-full px-2 py-1 text-xs', statusClass(serviceStatus(service)))}>
                  {statusLabel(serviceStatus(service))}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold">最近日志</h2>
          <div className="space-y-2">
            {logs.slice(0, 8).map((log) => (
              <LogRow key={log.id} log={log} services={services} />
            ))}
            {logs.length === 0 && <div className="text-sm text-gray-500">暂无日志</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between text-gray-500">
        <span className="text-xs">{label}</span>
        <Icon size={16} />
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

function ServicesView({
  services,
  allServices,
  search,
  selectedIds,
  onSearch,
  onSelectedIds,
  onEdit,
  onDelete,
  onToggle,
  onHealthCheck,
  onCopy,
}: {
  services: McpService[];
  allServices: McpService[];
  search: string;
  selectedIds: string[];
  onSearch: (value: string) => void;
  onSelectedIds: (ids: string[]) => void;
  onEdit: (service: McpService) => void;
  onDelete: (ids: string[]) => void;
  onToggle: (id: string) => void;
  onHealthCheck: (ids: string[]) => void;
  onCopy: (service: McpService) => void;
}) {
  const visibleIds = services.map((service) => service.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const toggleSelected = (id: string) => {
    onSelectedIds(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-gray-200 p-3 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
            <Search size={16} className="text-gray-400" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="搜索服务、工具、标签"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <button
            onClick={() => onSelectedIds(allSelected ? [] : visibleIds)}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
          >
            <ListChecks size={15} />
            {allSelected ? '取消' : '全选'}
          </button>
        </div>

        {selectedIds.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm dark:bg-gray-900">
            <span className="font-medium">{selectedIds.length} 已选</span>
            <button onClick={() => onHealthCheck(selectedIds)} className="rounded px-2 py-1 hover:bg-white dark:hover:bg-gray-800">
              健康检查
            </button>
            <button onClick={() => onDelete(selectedIds)} className="rounded px-2 py-1 text-rose-600 hover:bg-white dark:hover:bg-gray-800">
              删除
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-px border-b border-gray-200 bg-gray-200 text-xs dark:border-gray-800 dark:bg-gray-800">
        <StatCell label="全部" value={allServices.length} />
        <StatCell label="启用" value={allServices.filter((service) => service.enabled).length} />
        <StatCell label="异常" value={allServices.filter((service) => serviceStatus(service) === 'unhealthy').length} />
        <StatCell label="工具" value={allServices.reduce((total, service) => total + service.tools.length, 0)} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {services.length === 0 ? (
          <EmptyState icon={Server} title="暂无 MCP 服务" action="从市场安装或导入 JSON" />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                selected={selectedIds.includes(service.id)}
                onSelect={() => toggleSelected(service.id)}
                onEdit={() => onEdit(service)}
                onDelete={() => onDelete([service.id])}
                onToggle={() => onToggle(service.id)}
                onHealthCheck={() => onHealthCheck([service.id])}
                onCopy={() => onCopy(service)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white px-4 py-3 dark:bg-gray-950">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-gray-500">{label}</div>
    </div>
  );
}

function ServiceCard({
  service,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onToggle,
  onHealthCheck,
  onCopy,
}: {
  service: McpService;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onHealthCheck: () => void;
  onCopy: () => void;
}) {
  const status = serviceStatus(service);
  const TransportIcon = service.transport === 'stdio' ? Terminal : Globe;

  return (
    <article
      className={cn(
        'rounded-lg border bg-white p-3 transition-colors dark:bg-gray-900',
        selected ? 'border-gray-900 dark:border-white' : 'border-gray-200 hover:border-gray-400 dark:border-gray-800'
      )}
    >
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onSelect} className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <TransportIcon size={15} className="text-gray-500" />
            <h3 className="truncate text-sm font-semibold">{service.displayName}</h3>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px]', statusClass(status))}>{statusLabel(status)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-600 dark:text-gray-400">{service.description}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          {TRANSPORT_LABELS[service.transport]}
        </span>
        {service.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            #{tag}
          </span>
        ))}
      </div>

      <div className="mt-3 rounded-md bg-gray-50 p-2 font-mono text-[11px] text-gray-600 dark:bg-gray-950 dark:text-gray-300">
        {service.transport === 'stdio'
          ? [service.command, ...service.args].filter(Boolean).join(' ')
          : service.url || '未配置 URL'}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-gray-500">{service.tools.length} tools · {formatMs(service.stats.avgLatencyMs)}</div>
        <div className="flex items-center gap-1">
          <IconButton icon={Play} title={service.enabled ? '停用' : '启用'} onClick={onToggle} />
          <IconButton icon={RefreshCw} title="健康检查" onClick={onHealthCheck} />
          <IconButton icon={Copy} title="复制配置" onClick={onCopy} />
          <IconButton icon={Edit2} title="编辑" onClick={onEdit} />
          <IconButton icon={Trash2} title="删除" onClick={onDelete} danger />
        </div>
      </div>
    </article>
  );
}

function IconButton({
  icon: Icon,
  title,
  onClick,
  danger = false,
}: {
  icon: LucideIcon;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200',
        danger && 'hover:text-rose-600'
      )}
    >
      <Icon size={15} />
    </button>
  );
}

function GroupsView({
  services,
  groups,
  proxyBaseUrl,
  userToken,
  onPatch,
  onEdit,
  onCreate,
  onCopy,
}: {
  services: McpService[];
  groups: McpGroup[];
  proxyBaseUrl: string;
  userToken: string;
  onPatch: (patch: Partial<McpManagerData>, log?: Omit<McpRequestLog, 'id' | 'createdAt'>) => void;
  onEdit: (group: McpGroup) => void;
  onCreate: () => void;
  onCopy: (value: string) => void;
}) {
  const removeGroup = (id: string) => {
    onPatch(
      { groups: groups.filter((group) => group.id !== id) },
      { level: 'warn', message: '删除服务组合' }
    );
  };

  return (
    <div className="min-h-0 h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">服务组合</h2>
        <button onClick={onCreate} className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-gray-900">
          <Plus size={15} />
          新组合
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {groups.map((group) => {
          const groupServices = services.filter((service) => group.serviceIds.includes(service.id));
          const config = JSON.stringify({ mcpServers: { [group.name]: groupToConfig(group, proxyBaseUrl, userToken) } }, null, 2);
          return (
            <article key={group.id} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{group.displayName}</h3>
                  <div className="mt-1 text-xs text-gray-500">{groupServices.length} services · /proxy/{group.name}/mcp</div>
                </div>
                <span className={cn('rounded-full px-2 py-1 text-xs', group.enabled ? statusClass('healthy') : statusClass('disabled'))}>
                  {group.enabled ? '启用' : '停用'}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{group.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {groupServices.map((service) => (
                  <span key={service.id} className="rounded bg-gray-100 px-2 py-0.5 text-[11px] dark:bg-gray-800">
                    {service.displayName}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex justify-end gap-1">
                <IconButton icon={Copy} title="复制端点配置" onClick={() => onCopy(config)} />
                <IconButton icon={Edit2} title="编辑" onClick={() => onEdit(group)} />
                <IconButton icon={Trash2} title="删除" onClick={() => removeGroup(group.id)} danger />
              </div>
            </article>
          );
        })}
        {groups.length === 0 && <EmptyState icon={Layers} title="暂无服务组合" action="把多个 MCP 合并成一个端点" />}
      </div>
    </div>
  );
}

function MarketView({
  market,
  services,
  onInstall,
  onImportText,
}: {
  market: McpMarketService[];
  services: McpService[];
  onInstall: (item: McpMarketService) => void;
  onImportText: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const filtered = market.filter((item) => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return (
      item.name.toLowerCase().includes(keyword) ||
      item.displayName.toLowerCase().includes(keyword) ||
      item.description.toLowerCase().includes(keyword) ||
      item.tags.some((tag) => tag.toLowerCase().includes(keyword))
    );
  });

  return (
    <div className="min-h-0 h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
          <Search size={16} className="text-gray-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索市场服务" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <section className="grid gap-3 lg:grid-cols-2">
          {filtered.map((item) => {
            const installed = services.some((service) => service.name === item.name);
            return (
              <article key={item.id} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{item.displayName}</h3>
                    <div className="mt-1 text-xs text-gray-500">{item.packageManager} · {item.packageName || item.url}</div>
                  </div>
                  <span className="rounded bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800">{item.stars ? `${item.stars}` : 'custom'}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">{item.description}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {item.tags.map((tag) => (
                    <span key={tag} className="rounded bg-gray-100 px-2 py-0.5 text-[11px] dark:bg-gray-800">
                      #{tag}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => onInstall(item)}
                  disabled={installed}
                  className={cn(
                    'mt-4 w-full rounded-md px-3 py-2 text-sm',
                    installed ? 'bg-gray-100 text-gray-400 dark:bg-gray-800' : 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  )}
                >
                  {installed ? '已安装' : '安装'}
                </button>
              </article>
            );
          })}
        </section>

        <aside className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold">导入 MCP JSON</h2>
          <textarea
            value={jsonInput}
            onChange={(event) => setJsonInput(event.target.value)}
            rows={18}
            placeholder={`{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:/workspace"]\n    }\n  }\n}`}
            className="w-full rounded-md border border-gray-200 bg-white p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-700 dark:bg-gray-950"
          />
          <button onClick={() => onImportText(jsonInput)} className="mt-3 w-full rounded-md bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900">
            导入
          </button>
        </aside>
      </div>
    </div>
  );
}

function ClientsView({
  clients,
  services,
  groups,
  proxyBaseUrl,
  userToken,
  onPatch,
  onEdit,
  onCreate,
  onCopy,
}: {
  clients: McpClientProfile[];
  services: McpService[];
  groups: McpGroup[];
  proxyBaseUrl: string;
  userToken: string;
  onPatch: (patch: Partial<McpManagerData>, log?: Omit<McpRequestLog, 'id' | 'createdAt'>) => void;
  onEdit: (client: McpClientProfile) => void;
  onCreate: () => void;
  onCopy: (value: string) => void;
}) {
  const exportClient = async (client: McpClientProfile) => {
    const isCodex = client.type === 'codex';
    const slug = client.name.replace(/\s+/g, '-').toLowerCase();
    const target = await saveDialog({
      title: '导出客户端配置',
      defaultPath: `${slug}-mcp.${isCodex ? 'toml' : 'json'}`,
      filters: [isCodex ? { name: 'TOML', extensions: ['toml'] } : { name: 'JSON', extensions: ['json'] }],
    });
    if (!target) return;
    await writeTextFile(target, buildClientConfig(client.type, services, groups, client.serviceIds, client.groupIds, proxyBaseUrl, userToken));
  };

  return (
    <div className="min-h-0 h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">客户端配置</h2>
        <button onClick={onCreate} className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-gray-900">
          <Plus size={15} />
          新客户端
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {clients.map((client) => {
          const config = buildClientConfig(client.type, services, groups, client.serviceIds, client.groupIds, proxyBaseUrl, userToken);
          return (
            <article key={client.id} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{client.name}</h3>
                  <div className="mt-1 text-xs text-gray-500">{CLIENT_LABELS[client.type]} · {client.serviceIds.length} services · {client.groupIds.length} groups</div>
                  <div className="mt-1 truncate text-xs text-gray-500">{client.configPath || '未设置配置路径'}</div>
                </div>
                <button
                  onClick={() =>
                    onPatch({
                      clients: clients.map((item) => (item.id === client.id ? { ...item, enabled: !item.enabled, updatedAt: nowIso() } : item)),
                    })
                  }
                  className={cn('rounded-full px-2 py-1 text-xs', client.enabled ? statusClass('healthy') : statusClass('disabled'))}
                >
                  {client.enabled ? '启用' : '停用'}
                </button>
              </div>
              <pre className="mt-3 max-h-44 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-gray-100">{config}</pre>
              <div className="mt-3 flex justify-end gap-1">
                <IconButton icon={Copy} title="复制" onClick={() => onCopy(config)} />
                <IconButton icon={UploadCloud} title="导出" onClick={() => exportClient(client)} />
                <IconButton icon={Edit2} title="编辑" onClick={() => onEdit(client)} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function LogsView({
  logs,
  services,
  onPatch,
}: {
  logs: McpRequestLog[];
  services: McpService[];
  onPatch: (patch: Partial<McpManagerData>, log?: Omit<McpRequestLog, 'id' | 'createdAt'>) => void;
}) {
  return (
    <div className="min-h-0 h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">请求与操作日志</h2>
        <button onClick={() => onPatch({ logs: [] })} className="rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
          清空
        </button>
      </div>
      <div className="space-y-2">
        {logs.map((log) => (
          <LogRow key={log.id} log={log} services={services} />
        ))}
        {logs.length === 0 && <EmptyState icon={History} title="暂无日志" action="健康检查、安装和导出会生成记录" />}
      </div>
    </div>
  );
}

function LogRow({ log, services }: { log: McpRequestLog; services: McpService[] }) {
  const service = services.find((item) => item.id === log.serviceId);
  const color =
    log.level === 'success'
      ? 'text-emerald-500'
      : log.level === 'error'
        ? 'text-rose-500'
        : log.level === 'warn'
          ? 'text-amber-500'
          : 'text-gray-400';
  return (
    <div className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900">
      <Activity size={15} className={color} />
      <div className="min-w-0 flex-1">
        <div className="truncate">{log.message}</div>
        <div className="text-xs text-gray-500">
          {new Date(log.createdAt).toLocaleString('zh-CN')} {service ? `· ${service.displayName}` : ''} {log.latencyMs ? `· ${formatMs(log.latencyMs)}` : ''}
        </div>
      </div>
    </div>
  );
}

function SettingsView({
  manager,
  onPatch,
  onNotice,
}: {
  manager: McpManagerData;
  onPatch: (patch: Partial<McpManagerData>, log?: Omit<McpRequestLog, 'id' | 'createdAt'>) => void;
  onNotice: (message: string) => void;
}) {
  const [proxyBaseUrl, setProxyBaseUrl] = useState(manager.proxyBaseUrl);
  const [userToken, setUserToken] = useState(manager.userToken);

  const exportData = async () => {
    const target = await saveDialog({
      title: '导出 One MCP 数据',
      defaultPath: 'one-mcp-manager.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!target) return;
    await writeTextFile(target, JSON.stringify({ ...manager, lastModified: nowIso() }, null, 2));
    onNotice('已导出');
  };

  return (
    <div className="min-h-0 h-full overflow-y-auto p-4">
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold">代理设置</h2>
          <div className="space-y-3">
            <Input label="Proxy Base URL" value={proxyBaseUrl} onChange={setProxyBaseUrl} />
            <Input label="User Token" value={userToken} onChange={setUserToken} />
            <button
              onClick={() =>
                onPatch(
                  { proxyBaseUrl: proxyBaseUrl.trim() || 'http://127.0.0.1:3000', userToken },
                  { level: 'success', message: '更新 One MCP 设置' }
                )
              }
              className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900"
            >
              保存
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold">数据管理</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportData} className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
              <UploadCloud size={15} />
              导出 JSON
            </button>
            <button
              onClick={() =>
                onPatch(
                  {
                    services: [],
                    groups: [],
                    logs: [],
                    market: DEFAULT_MARKET_SERVICES,
                  },
                  { level: 'warn', message: '重置 One MCP Manager' }
                )
              }
              className="inline-flex items-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-600 dark:border-rose-800"
            >
              <Trash2 size={15} />
              重置
            </button>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <SmallInfo icon={Server} label="服务" value={`${manager.services.length}`} />
            <SmallInfo icon={Layers} label="组合" value={`${manager.groups.length}`} />
            <SmallInfo icon={History} label="日志" value={`${manager.logs.length}`} />
          </div>
        </section>
      </div>
    </div>
  );
}

function ServiceEditorDialog({
  service,
  onClose,
  onSave,
}: {
  service: McpService | null;
  onClose: () => void;
  onSave: (service: McpService) => void;
}) {
  const [name, setName] = useState(service?.name || '');
  const [displayName, setDisplayName] = useState(service?.displayName || '');
  const [description, setDescription] = useState(service?.description || '');
  const [transport, setTransport] = useState<McpTransport>(service?.transport || 'stdio');
  const [command, setCommand] = useState(service?.command || 'npx');
  const [args, setArgs] = useState(service?.args.join('\n') || '');
  const [url, setUrl] = useState(service?.url || '');
  const [headers, setHeaders] = useState(headersToText(service?.headers || {}));
  const [env, setEnv] = useState(envToText(service?.env || []));
  const [packageManager, setPackageManager] = useState<McpPackageManager>(service?.packageManager || 'custom');
  const [packageName, setPackageName] = useState(service?.packageName || '');
  const [tags, setTags] = useState(service?.tags.join(', ') || '');
  const [tools, setTools] = useState(toolsToText(service?.tools || []));

  const save = () => {
    const normalizedName = slugify(name || displayName);
    if (!normalizedName || !displayName.trim()) return;
    const time = nowIso();
    onSave({
      id: service?.id || idOf('mcp'),
      name: normalizedName,
      displayName: displayName.trim(),
      description: description.trim() || '无描述',
      transport,
      enabled: service?.enabled ?? true,
      status: service?.status || 'unknown',
      command: transport === 'stdio' ? command.trim() : undefined,
      args: transport === 'stdio' ? parseLines(args) : [],
      url: transport !== 'stdio' ? url.trim() : undefined,
      headers: parseKeyValueLines(headers),
      env: parseEnvLines(env),
      packageManager,
      packageName: packageName.trim() || undefined,
      sourceUrl: service?.sourceUrl,
      tags: splitTags(tags),
      tools: parseTools(tools),
      stats: service?.stats || {
        totalRequests: 0,
        todayRequests: 0,
        avgLatencyMs: 0,
        errorCount: 0,
      },
      lastHealthCheck: service?.lastHealthCheck,
      healthMessage: service?.healthMessage,
      createdAt: service?.createdAt || time,
      updatedAt: time,
    });
  };

  return (
    <Dialog title={service ? '编辑 MCP 服务' : '新建 MCP 服务'} onClose={onClose}>
      <div className="grid min-h-0 gap-4 overflow-y-auto p-4 lg:grid-cols-[360px_1fr]">
        <section className="space-y-3">
          <Input label="服务 ID" value={name} onChange={setName} placeholder="filesystem" />
          <Input label="显示名称" value={displayName} onChange={setDisplayName} placeholder="Filesystem" />
          <Input label="描述" value={description} onChange={setDescription} />
          <label className="block text-xs font-medium text-gray-500">传输类型</label>
          <select value={transport} onChange={(event) => setTransport(event.target.value as McpTransport)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950">
            <option value="stdio">stdio</option>
            <option value="sse">SSE</option>
            <option value="streamable-http">Streamable HTTP</option>
          </select>
          <label className="block text-xs font-medium text-gray-500">包管理器</label>
          <select value={packageManager} onChange={(event) => setPackageManager(event.target.value as McpPackageManager)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950">
            <option value="npm">npm</option>
            <option value="pypi">PyPI</option>
            <option value="docker">Docker</option>
            <option value="custom">Custom</option>
          </select>
          <Input label="包名" value={packageName} onChange={setPackageName} />
          <Input label="标签" value={tags} onChange={setTags} placeholder="files, local" />
        </section>

        <section className="space-y-3">
          {transport === 'stdio' ? (
            <>
              <Input label="Command" value={command} onChange={setCommand} placeholder="npx" />
              <Textarea label="Args" value={args} onChange={setArgs} rows={6} placeholder="-y\n@modelcontextprotocol/server-filesystem\nD:\\workspace" />
            </>
          ) : (
            <>
              <Input label="URL" value={url} onChange={setUrl} placeholder="http://127.0.0.1:3001/mcp" />
              <Textarea label="Headers" value={headers} onChange={setHeaders} rows={5} placeholder="Authorization=Bearer token" />
            </>
          )}
          <Textarea label="Env" value={env} onChange={setEnv} rows={5} placeholder="GITHUB_TOKEN=" />
          <Textarea label="Tools" value={tools} onChange={setTools} rows={6} placeholder="read_file: 读取文件\nlist_directory: 列目录" />
        </section>
      </div>
      <DialogFooter onCancel={onClose} onSave={save} />
    </Dialog>
  );
}

function GroupEditorDialog({
  group,
  services,
  onClose,
  onSave,
}: {
  group: McpGroup | null;
  services: McpService[];
  onClose: () => void;
  onSave: (group: McpGroup) => void;
}) {
  const [name, setName] = useState(group?.name || '');
  const [displayName, setDisplayName] = useState(group?.displayName || '');
  const [description, setDescription] = useState(group?.description || '');
  const [enabled, setEnabled] = useState(group?.enabled ?? true);
  const [serviceIds, setServiceIds] = useState<string[]>(group?.serviceIds || []);

  const save = () => {
    const time = nowIso();
    const groupName = slugify(name || displayName);
    onSave({
      id: group?.id || idOf('group'),
      name: groupName,
      displayName: displayName.trim() || groupName,
      description: description.trim() || `组合 ${serviceIds.length} 个 MCP 服务`,
      serviceIds,
      enabled,
      endpointPath: `/proxy/${groupName}/mcp`,
      createdAt: group?.createdAt || time,
      updatedAt: time,
    });
  };

  return (
    <Dialog title={group ? '编辑服务组合' : '新建服务组合'} onClose={onClose}>
      <div className="grid gap-4 overflow-y-auto p-4">
        <Input label="名称" value={name} onChange={setName} placeholder="dev-tools" />
        <Input label="显示名称" value={displayName} onChange={setDisplayName} />
        <Input label="描述" value={description} onChange={setDescription} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          启用
        </label>
        <div>
          <div className="mb-2 text-xs font-medium text-gray-500">服务</div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2 dark:border-gray-700">
            {services.map((service) => (
              <label key={service.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                <input
                  type="checkbox"
                  checked={serviceIds.includes(service.id)}
                  onChange={() =>
                    setServiceIds(
                      serviceIds.includes(service.id)
                        ? serviceIds.filter((id) => id !== service.id)
                        : [...serviceIds, service.id]
                    )
                  }
                />
                {service.displayName}
              </label>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter onCancel={onClose} onSave={save} />
    </Dialog>
  );
}

function ClientEditorDialog({
  client,
  services,
  groups,
  onClose,
  onSave,
}: {
  client: McpClientProfile | null;
  services: McpService[];
  groups: McpGroup[];
  onClose: () => void;
  onSave: (client: McpClientProfile) => void;
}) {
  const [name, setName] = useState(client?.name || '');
  const [type, setType] = useState<McpClientType>(client?.type || 'custom');
  const [configPath, setConfigPath] = useState(client?.configPath || '');
  const [enabled, setEnabled] = useState(client?.enabled ?? true);
  const [serviceIds, setServiceIds] = useState<string[]>(client?.serviceIds || []);
  const [groupIds, setGroupIds] = useState<string[]>(client?.groupIds || []);

  const save = () => {
    const time = nowIso();
    onSave({
      id: client?.id || idOf('client'),
      name: name.trim() || CLIENT_LABELS[type],
      type,
      enabled,
      configPath: configPath.trim() || undefined,
      serviceIds,
      groupIds,
      createdAt: client?.createdAt || time,
      updatedAt: time,
    });
  };

  return (
    <Dialog title={client ? '编辑客户端' : '新建客户端'} onClose={onClose}>
      <div className="grid gap-4 overflow-y-auto p-4">
        <Input label="名称" value={name} onChange={setName} />
        <label className="block text-xs font-medium text-gray-500">类型</label>
        <select value={type} onChange={(event) => setType(event.target.value as McpClientType)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950">
          {Object.entries(CLIENT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <Input label="配置路径" value={configPath} onChange={setConfigPath} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          启用
        </label>
        <PickList title="服务" items={services.map((service) => ({ id: service.id, name: service.displayName }))} selectedIds={serviceIds} onChange={setServiceIds} />
        <PickList title="组合" items={groups.map((group) => ({ id: group.id, name: group.displayName }))} selectedIds={groupIds} onChange={setGroupIds} />
      </div>
      <DialogFooter onCancel={onClose} onSave={save} />
    </Dialog>
  );
}

function PickList({
  title,
  items,
  selectedIds,
  onChange,
}: {
  title: string;
  items: Array<{ id: string; name: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-gray-500">{title}</div>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2 dark:border-gray-700">
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
            <input
              type="checkbox"
              checked={selectedIds.includes(item.id)}
              onChange={() => onChange(selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id])}
            />
            {item.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DialogFooter({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  return (
    <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
      <button onClick={onCancel} className="rounded-md px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">
        取消
      </button>
      <button onClick={onSave} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900">
        保存
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-700 dark:bg-gray-950"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-700 dark:bg-gray-950"
      />
    </label>
  );
}

function SmallInfo({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
        <Icon size={13} />
        {label}
      </div>
      <div className="truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, action }: { icon: LucideIcon; title: string; action: string }) {
  return (
    <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-500 dark:border-gray-700">
      <Icon size={32} className="mb-3 text-gray-400" />
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-sm">{action}</div>
    </div>
  );
}
