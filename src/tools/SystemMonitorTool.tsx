import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  Activity,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Layers,
  MemoryStick,
  Network,
  RefreshCw,
  Search,
  ServerCog,
  Shield,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { EmptyState, StatusMessage, ToolbarButton, formatBytes } from './systemToolUtils';

interface MonitorOverview {
  timestamp: string;
  computerName: string;
  osName: string;
  uptimeSeconds: number;
  cpuUsagePercent: number;
  totalMemory: number;
  freeMemory: number;
  usedMemory: number;
  memoryUsagePercent: number;
  processCount: number;
  threadCount: number;
  handleCount: number;
  networkConnectionCount: number;
  diskReadBytesPerSec: number;
  diskWriteBytesPerSec: number;
  networkBytesPerSec: number;
}

interface MonitorProcess {
  pid: number;
  parentPid: number;
  name: string;
  executablePath: string;
  commandLine: string;
  windowTitle: string;
  sessionId: number;
  category: string;
  categoryLabel: string;
  creationTime: string;
  cpuPercent: number;
  privateBytes: number;
  workingSet: number;
  threadCount: number;
  handleCount: number;
  ioReadBytesPerSec: number;
  ioWriteBytesPerSec: number;
}

interface MonitorService {
  name: string;
  displayName: string;
  state: string;
  startMode: string;
  processId: number;
  startName: string;
  pathName: string;
}

interface MonitorConnection {
  protocol: string;
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  owningProcess: number;
  processName: string;
  creationTime: string;
}

interface MonitorDisk {
  name: string;
  readBytesPerSec: number;
  writeBytesPerSec: number;
  diskTimePercent: number;
  queueLength: number;
}

interface MonitorNetworkInterface {
  name: string;
  bytesReceivedPerSec: number;
  bytesSentPerSec: number;
  bytesTotalPerSec: number;
  currentBandwidth: number;
}

interface MonitorSnapshot {
  overview: MonitorOverview;
  processes: MonitorProcess[];
  services: MonitorService[];
  connections: MonitorConnection[];
  disks: MonitorDisk[];
  networkInterfaces: MonitorNetworkInterface[];
  message: string;
}

const EMPTY_OVERVIEW: MonitorOverview = {
  timestamp: '',
  computerName: '',
  osName: '',
  uptimeSeconds: 0,
  cpuUsagePercent: 0,
  totalMemory: 0,
  freeMemory: 0,
  usedMemory: 0,
  memoryUsagePercent: 0,
  processCount: 0,
  threadCount: 0,
  handleCount: 0,
  networkConnectionCount: 0,
  diskReadBytesPerSec: 0,
  diskWriteBytesPerSec: 0,
  networkBytesPerSec: 0,
};

const EMPTY_SNAPSHOT: MonitorSnapshot = {
  overview: EMPTY_OVERVIEW,
  processes: [],
  services: [],
  connections: [],
  disks: [],
  networkInterfaces: [],
  message: '正在读取系统监控快照。',
};

type TabKey = 'processes' | 'services' | 'connections' | 'disks' | 'network';
type ProcessSort = 'cpu' | 'memory' | 'io' | 'name' | 'pid';

const PROCESS_CATEGORY_META = [
  { key: 'apps', label: '应用' },
  { key: 'background', label: '后台进程' },
  { key: 'windows', label: 'Windows/系统进程' },
] as const;

const TAB_META: Array<{ key: TabKey; label: string; icon: typeof Activity }> = [
  { key: 'processes', label: '进程', icon: Activity },
  { key: 'services', label: '服务', icon: ServerCog },
  { key: 'connections', label: 'TCP 连接', icon: Network },
  { key: 'disks', label: '磁盘', icon: HardDrive },
  { key: 'network', label: '网卡', icon: Gauge },
];

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatRate(value: number) {
  return `${formatBytes(value)}/s`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function stateClass(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes('running') || lower.includes('established'))
    return 'text-green-600 dark:text-green-300';
  if (lower.includes('listen')) return 'text-blue-600 dark:text-blue-300';
  if (lower.includes('stopped') || lower.includes('closed')) return 'text-gray-500';
  return 'text-amber-600 dark:text-amber-300';
}

function isLoopback(address: string) {
  return address === '127.0.0.1' || address === '::1' || address.toLowerCase() === 'localhost';
}

function isSystemProcess(item: MonitorProcess) {
  if (item.category) return item.category === 'windows';
  const path = item.executablePath.toLowerCase();
  return !path || path.includes('\\windows\\') || item.name.toLowerCase().includes('system');
}

function processCategory(item: MonitorProcess) {
  if (item.category) return item.category;
  return isSystemProcess(item) ? 'windows' : 'background';
}

function processCategoryLabel(item: MonitorProcess) {
  if (item.categoryLabel) return item.categoryLabel;
  return (
    PROCESS_CATEGORY_META.find((meta) => meta.key === processCategory(item))?.label || '其他进程'
  );
}

export default function SystemMonitorTool() {
  const ready = useToolTheme();
  const [snapshot, setSnapshot] = useState<MonitorSnapshot>(EMPTY_SNAPSHOT);
  const [tab, setTab] = useState<TabKey>('processes');
  const [subFilter, setSubFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [processSort, setProcessSort] = useState<ProcessSort>('cpu');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(EMPTY_SNAPSHOT.message);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await invoke<MonitorSnapshot>('system_monitor_snapshot');
      setSnapshot(next);
      setMessage(`${next.message} · ${next.overview.timestamp || '刚刚'}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  const keyword = search.trim().toLowerCase();
  const overview = snapshot.overview;

  const tabCounts = {
    processes: snapshot.processes.length,
    services: snapshot.services.length,
    connections: snapshot.connections.length,
    disks: snapshot.disks.length,
    network: snapshot.networkInterfaces.length,
  };

  const groups = useMemo(() => buildGroups(tab, snapshot), [snapshot, tab]);

  useEffect(() => {
    setSubFilter('all');
    setSearch('');
  }, [tab]);

  const processes = useMemo(() => {
    const rows = snapshot.processes.filter((item) => {
      if (subFilter === 'highCpu' && item.cpuPercent < 5) return false;
      if (subFilter === 'highMemory' && item.workingSet < 500 * 1024 * 1024) return false;
      if (
        PROCESS_CATEGORY_META.some((meta) => meta.key === subFilter) &&
        processCategory(item) !== subFilter
      )
        return false;
      if (!keyword) return true;
      return [
        item.name,
        item.pid,
        item.parentPid,
        item.windowTitle,
        item.categoryLabel,
        item.sessionId,
        item.executablePath,
        item.commandLine,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
    rows.sort((a, b) => {
      if (processSort === 'memory') return b.workingSet - a.workingSet;
      if (processSort === 'io')
        return (
          b.ioReadBytesPerSec + b.ioWriteBytesPerSec - (a.ioReadBytesPerSec + a.ioWriteBytesPerSec)
        );
      if (processSort === 'name') return a.name.localeCompare(b.name);
      if (processSort === 'pid') return a.pid - b.pid;
      return b.cpuPercent - a.cpuPercent;
    });
    return rows;
  }, [keyword, processSort, snapshot.processes, subFilter]);

  const services = useMemo(
    () =>
      snapshot.services.filter((item) => {
        const state = item.state.toLowerCase();
        const start = item.startMode.toLowerCase();
        if (subFilter === 'running' && !state.includes('running')) return false;
        if (subFilter === 'stopped' && !state.includes('stopped')) return false;
        if (subFilter === 'auto' && !start.includes('auto')) return false;
        if (subFilter === 'manual' && !start.includes('manual')) return false;
        if (subFilter === 'disabled' && !start.includes('disabled')) return false;
        if (!keyword) return true;
        return [
          item.name,
          item.displayName,
          item.state,
          item.startMode,
          item.processId,
          item.startName,
          item.pathName,
        ]
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      }),
    [keyword, snapshot.services, subFilter]
  );

  const connections = useMemo(
    () =>
      snapshot.connections.filter((item) => {
        const state = item.state.toLowerCase();
        if (subFilter === 'established' && !state.includes('established')) return false;
        if (subFilter === 'listen' && !state.includes('listen')) return false;
        if (
          subFilter === 'loopback' &&
          !isLoopback(item.localAddress) &&
          !isLoopback(item.remoteAddress)
        )
          return false;
        if (
          subFilter === 'external' &&
          (isLoopback(item.localAddress) || isLoopback(item.remoteAddress))
        )
          return false;
        if (!keyword) return true;
        return [
          item.protocol,
          item.localAddress,
          item.localPort,
          item.remoteAddress,
          item.remotePort,
          item.state,
          item.owningProcess,
          item.processName,
        ]
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      }),
    [keyword, snapshot.connections, subFilter]
  );

  const disks = useMemo(
    () =>
      snapshot.disks.filter((item) => {
        if (subFilter === 'busy' && item.readBytesPerSec + item.writeBytesPerSec <= 0) return false;
        return true;
      }),
    [snapshot.disks, subFilter]
  );

  const networkInterfaces = useMemo(
    () =>
      snapshot.networkInterfaces.filter((item) => {
        if (subFilter === 'active' && item.bytesTotalPerSec <= 0) return false;
        return true;
      }),
    [snapshot.networkInterfaces, subFilter]
  );

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="📈"
        title="系统监控信息"
        subtitle="系统资源、进程、服务、TCP、磁盘和网卡活动快照"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              5 秒刷新
            </label>
            <ToolbarButton onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </ToolbarButton>
          </div>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-3 p-4 max-lg:grid-cols-1">
        <aside className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <StatusMessage message={message} error={error} />
          <section className="grid grid-cols-2 gap-2">
            <Metric
              icon={<Cpu size={15} />}
              label="CPU"
              value={formatPercent(overview.cpuUsagePercent)}
            />
            <Metric
              icon={<MemoryStick size={15} />}
              label="内存"
              value={formatPercent(overview.memoryUsagePercent)}
            />
            <Metric
              icon={<HardDrive size={15} />}
              label="磁盘"
              value={formatRate(overview.diskReadBytesPerSec + overview.diskWriteBytesPerSec)}
            />
            <Metric
              icon={<Network size={15} />}
              label="网络"
              value={formatRate(overview.networkBytesPerSec)}
            />
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-semibold">监控分类</div>
            <div className="mt-3 space-y-1.5">
              {TAB_META.map((item) => {
                const Icon = item.icon;
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setTab(item.key)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                        : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Icon size={15} />
                      {item.label}
                    </span>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {tabCounts[item.key]}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Layers size={15} />
              当前明细
            </div>
            <div className="mt-3 space-y-1.5">
              {groups.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setSubFilter(item.key)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                    subFilter === item.key
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  <span className="font-mono text-xs">{item.count}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <section className="grid gap-3 md:grid-cols-4">
            <InfoCard
              icon={<Activity size={15} />}
              label="进程/线程"
              value={`${overview.processCount} / ${overview.threadCount}`}
              sub={`${overview.handleCount} 调用/s`}
            />
            <InfoCard
              icon={<ServerCog size={15} />}
              label="运行时间"
              value={formatUptime(overview.uptimeSeconds)}
              sub={overview.computerName || '-'}
            />
            <InfoCard
              icon={<Database size={15} />}
              label="系统"
              value={overview.osName || '-'}
              sub={overview.timestamp || '-'}
            />
            <InfoCard
              icon={<Shield size={15} />}
              label="TCP"
              value={`${overview.networkConnectionCount} 条`}
              sub="连接快照"
            />
          </section>

          <section className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
            <div className="font-semibold">{TAB_META.find((item) => item.key === tab)?.label}</div>
            <div className="text-xs text-gray-500">
              当前筛选：{groups.find((item) => item.key === subFilter)?.label || '全部'}
            </div>
            {tab === 'processes' && (
              <select
                value={processSort}
                onChange={(event) => setProcessSort(event.target.value as ProcessSort)}
                className="ml-auto rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900"
              >
                <option value="cpu">CPU 优先</option>
                <option value="memory">内存优先</option>
                <option value="io">I/O 优先</option>
                <option value="name">名称</option>
                <option value="pid">PID</option>
              </select>
            )}
            <div
              className={
                tab === 'processes'
                  ? 'flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700'
                  : 'ml-auto flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700'
              }
            >
              <Search size={16} className="text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索名称、PID、路径、地址..."
                className="w-72 min-w-0 bg-transparent text-sm outline-none"
              />
            </div>
          </section>

          <section className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {tab === 'processes' && <ProcessesPanel rows={processes} />}
            {tab === 'services' && <ServicesPanel rows={services} />}
            {tab === 'connections' && <ConnectionsPanel rows={connections} />}
            {tab === 'disks' && <DisksPanel rows={disks} />}
            {tab === 'network' && <NetworkPanel rows={networkInterfaces} />}
          </section>
        </section>
      </main>
    </div>
  );
}

function buildGroups(tab: TabKey, snapshot: MonitorSnapshot) {
  if (tab === 'processes') {
    return [
      { key: 'all', label: '全部进程', count: snapshot.processes.length },
      {
        key: 'apps',
        label: '应用',
        count: snapshot.processes.filter((item) => processCategory(item) === 'apps').length,
      },
      {
        key: 'background',
        label: '后台进程',
        count: snapshot.processes.filter((item) => processCategory(item) === 'background').length,
      },
      {
        key: 'windows',
        label: 'Windows/系统进程',
        count: snapshot.processes.filter((item) => processCategory(item) === 'windows').length,
      },
      {
        key: 'highCpu',
        label: 'CPU 较高',
        count: snapshot.processes.filter((item) => item.cpuPercent >= 5).length,
      },
      {
        key: 'highMemory',
        label: '内存较高',
        count: snapshot.processes.filter((item) => item.workingSet >= 500 * 1024 * 1024).length,
      },
    ];
  }
  if (tab === 'services') {
    return [
      { key: 'all', label: '全部服务', count: snapshot.services.length },
      {
        key: 'running',
        label: '运行中',
        count: snapshot.services.filter((item) => item.state.toLowerCase().includes('running'))
          .length,
      },
      {
        key: 'stopped',
        label: '已停止',
        count: snapshot.services.filter((item) => item.state.toLowerCase().includes('stopped'))
          .length,
      },
      {
        key: 'auto',
        label: '自动启动',
        count: snapshot.services.filter((item) => item.startMode.toLowerCase().includes('auto'))
          .length,
      },
      {
        key: 'manual',
        label: '手动启动',
        count: snapshot.services.filter((item) => item.startMode.toLowerCase().includes('manual'))
          .length,
      },
      {
        key: 'disabled',
        label: '已禁用',
        count: snapshot.services.filter((item) => item.startMode.toLowerCase().includes('disabled'))
          .length,
      },
    ];
  }
  if (tab === 'connections') {
    return [
      { key: 'all', label: '全部连接', count: snapshot.connections.length },
      {
        key: 'established',
        label: '已建立',
        count: snapshot.connections.filter((item) =>
          item.state.toLowerCase().includes('established')
        ).length,
      },
      {
        key: 'listen',
        label: '监听中',
        count: snapshot.connections.filter((item) => item.state.toLowerCase().includes('listen'))
          .length,
      },
      {
        key: 'external',
        label: '外部连接',
        count: snapshot.connections.filter(
          (item) => !isLoopback(item.localAddress) && !isLoopback(item.remoteAddress)
        ).length,
      },
      {
        key: 'loopback',
        label: '本机回环',
        count: snapshot.connections.filter(
          (item) => isLoopback(item.localAddress) || isLoopback(item.remoteAddress)
        ).length,
      },
    ];
  }
  if (tab === 'disks') {
    return [
      { key: 'all', label: '全部磁盘', count: snapshot.disks.length },
      {
        key: 'busy',
        label: '活动磁盘',
        count: snapshot.disks.filter((item) => item.readBytesPerSec + item.writeBytesPerSec > 0)
          .length,
      },
    ];
  }
  return [
    { key: 'all', label: '全部网卡', count: snapshot.networkInterfaces.length },
    {
      key: 'active',
      label: '活动网卡',
      count: snapshot.networkInterfaces.filter((item) => item.bytesTotalPerSec > 0).length,
    },
  ];
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-semibold">{value}</div>
    </div>
  );
}

function InfoCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-base font-semibold" title={value}>
        {value}
      </div>
      <div className="mt-1 truncate text-xs text-gray-500" title={sub}>
        {sub}
      </div>
    </div>
  );
}

function ProcessesPanel({ rows }: { rows: MonitorProcess[] }) {
  if (!rows.length) return <EmptyState icon={<Activity size={32} />} text="没有匹配的进程" />;
  const groups = groupProcessRows(rows);
  return (
    <div>
      {groups.map((group) => (
        <section
          key={group.key}
          className="border-b border-gray-100 last:border-b-0 dark:border-gray-800"
        >
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs dark:border-gray-800 dark:bg-gray-900">
            <div className="font-semibold text-gray-700 dark:text-gray-200">
              {group.label} <span className="font-mono text-gray-400">{group.rows.length}</span>
            </div>
            <div className="flex gap-3 text-gray-500">
              <span>
                CPU {formatPercent(group.rows.reduce((sum, item) => sum + item.cpuPercent, 0))}
              </span>
              <span>
                内存 {formatBytes(group.rows.reduce((sum, item) => sum + item.workingSet, 0))}
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {group.rows.map((item) => (
              <article key={`${item.pid}-${item.name}`} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{item.name || '-'}</span>
                      <ProcessBadge>{processCategoryLabel(item)}</ProcessBadge>
                      <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        PID {item.pid}
                      </span>
                      <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        PPID {item.parentPid || '-'}
                      </span>
                      <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        会话 {item.sessionId || 0}
                      </span>
                    </div>
                    {item.windowTitle && (
                      <div className="mt-1 truncate text-xs text-gray-500" title={item.windowTitle}>
                        {item.windowTitle}
                      </div>
                    )}
                    <div
                      className="mt-1 truncate font-mono text-xs text-gray-500"
                      title={item.commandLine || item.executablePath}
                    >
                      {item.executablePath || item.commandLine || '-'}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-right text-xs max-lg:grid-cols-2">
                    <Mini label="CPU" value={formatPercent(item.cpuPercent)} />
                    <Mini label="内存" value={formatBytes(item.workingSet)} />
                    <Mini label="线程" value={String(item.threadCount)} />
                    <Mini
                      label="I/O"
                      value={formatRate(item.ioReadBytesPerSec + item.ioWriteBytesPerSec)}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function groupProcessRows(rows: MonitorProcess[]) {
  const known = new Set<string>(PROCESS_CATEGORY_META.map((item) => item.key));
  const groups: Array<{ key: string; label: string; rows: MonitorProcess[] }> =
    PROCESS_CATEGORY_META.map((meta) => ({
      key: meta.key,
      label: meta.label,
      rows: rows.filter((item) => processCategory(item) === meta.key),
    })).filter((group) => group.rows.length > 0);
  const otherRows = rows.filter((item) => !known.has(processCategory(item)));
  if (otherRows.length) {
    groups.push({ key: 'other', label: '其他进程', rows: otherRows });
  }
  return groups;
}

function ProcessBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
      {children}
    </span>
  );
}

function ServicesPanel({ rows }: { rows: MonitorService[] }) {
  if (!rows.length) return <EmptyState icon={<ServerCog size={32} />} text="没有匹配的服务" />;
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {rows.map((item) => (
        <article key={item.name} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{item.displayName || item.name}</span>
                <span className={`text-sm ${stateClass(item.state)}`}>{item.state || '-'}</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {item.startMode || '-'}
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-gray-500">{item.name}</div>
              <div className="mt-1 truncate font-mono text-xs text-gray-500" title={item.pathName}>
                {item.pathName || '-'}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-right text-xs">
              <Mini label="PID" value={item.processId ? String(item.processId) : '-'} />
              <Mini label="账户" value={item.startName || '-'} />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function ConnectionsPanel({ rows }: { rows: MonitorConnection[] }) {
  if (!rows.length) return <EmptyState icon={<Network size={32} />} text="没有匹配的 TCP 连接" />;
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {rows.map((item, index) => (
        <article
          key={`${item.localAddress}-${item.localPort}-${item.remoteAddress}-${item.remotePort}-${item.owningProcess}-${index}`}
          className="p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{item.protocol || 'TCP'}</span>
                <span className={stateClass(item.state)}>{item.state || '-'}</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {item.processName || '-'}
                </span>
              </div>
              <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                <Address label="本地" value={`${item.localAddress}:${item.localPort}`} />
                <Address label="远程" value={`${item.remoteAddress}:${item.remotePort}`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-right text-xs">
              <Mini label="PID" value={item.owningProcess ? String(item.owningProcess) : '-'} />
              <Mini label="创建" value={item.creationTime || '-'} />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function DisksPanel({ rows }: { rows: MonitorDisk[] }) {
  if (!rows.length) return <EmptyState icon={<HardDrive size={32} />} text="没有磁盘性能数据" />;
  return (
    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((item) => (
        <PanelCard
          key={item.name}
          title={item.name}
          rows={[
            ['读取', formatRate(item.readBytesPerSec)],
            ['写入', formatRate(item.writeBytesPerSec)],
            ['占用', formatPercent(item.diskTimePercent)],
            ['队列', String(item.queueLength)],
          ]}
        />
      ))}
    </div>
  );
}

function NetworkPanel({ rows }: { rows: MonitorNetworkInterface[] }) {
  if (!rows.length) return <EmptyState icon={<Network size={32} />} text="没有网卡性能数据" />;
  return (
    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((item) => (
        <PanelCard
          key={item.name}
          title={item.name}
          rows={[
            ['接收', formatRate(item.bytesReceivedPerSec)],
            ['发送', formatRate(item.bytesSentPerSec)],
            ['总计', formatRate(item.bytesTotalPerSec)],
            ['带宽', formatBytes(item.currentBandwidth)],
          ]}
        />
      ))}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[74px] rounded-md bg-gray-50 px-2 py-1.5 dark:bg-gray-950">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="truncate font-mono" title={value}>
        {value}
      </div>
    </div>
  );
}

function Address({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-gray-50 px-2 py-1.5 dark:bg-gray-950">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="truncate font-mono" title={value}>
        {value}
      </div>
    </div>
  );
}

function PanelCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <div className="truncate font-semibold" title={title}>
        {title}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {rows.map(([label, value]) => (
          <Mini key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  );
}
