import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { save } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import {
  Archive,
  CheckCircle2,
  Database,
  FolderOpen,
  HardDrive,
  Layers,
  PauseCircle,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Star,
  Terminal,
  Trash2,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { EmptyState, StatusMessage, ToolbarButton, formatBytes } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';

interface WslDistribution {
  name: string;
  state: string;
  version: string;
  default: boolean;
  running: boolean;
  basePath: string;
  vhdPath: string;
  size: number;
  lastWriteTime: string;
}

interface WslStatus {
  installed: boolean;
  defaultDistribution: string;
  kernelVersion: string;
  distributions: WslDistribution[];
  message: string;
}

function formatTimestamp(value: string) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '-';
  return new Date(seconds * 1000).toLocaleString();
}

function statusStyle(item: WslDistribution) {
  return item.running
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
}

export default function WslDashboardTool() {
  const ready = useToolTheme();
  const [status, setStatus] = useState<WslStatus>({
    installed: false,
    defaultDistribution: '',
    kernelVersion: '',
    distributions: [],
    message: '点击刷新读取 WSL 发行版。',
  });
  const [selectedName, setSelectedName] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('点击刷新读取 WSL 发行版。');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await invoke<WslStatus>('system_wsl_status');
      setStatus(next);
      setMessage(next.message || 'WSL 状态已刷新');
      setSelectedName((current) => {
        if (current && next.distributions.some((item) => item.name === current)) return current;
        return next.defaultDistribution || next.distributions[0]?.name || '';
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const selected = useMemo(
    () =>
      status.distributions.find((item) => item.name === selectedName) || status.distributions[0],
    [selectedName, status.distributions]
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return status.distributions.filter((item) => {
      if (filter === 'running' && !item.running) return false;
      if (filter === 'stopped' && item.running) return false;
      if (!keyword) return true;
      return [item.name, item.state, item.version, item.basePath, item.vhdPath]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [filter, search, status.distributions]);

  const action = async (actionName: string, item?: WslDistribution, outputPath?: string) => {
    const target = item || selected;
    if (!target && actionName !== 'shutdown') return;
    if (
      actionName === 'terminate' &&
      target?.running &&
      !window.confirm(`确定停止 ${target.name} 吗？`)
    )
      return;
    if (
      actionName === 'pause' &&
      target?.running &&
      !window.confirm(`确定暂停/停止 ${target.name} 吗？`)
    )
      return;
    if (actionName === 'restart' && target && !window.confirm(`确定重启 ${target.name} 吗？`))
      return;
    if (actionName === 'shutdown' && !window.confirm('确定关闭全部 WSL 实例吗？')) return;
    if (actionName === 'unregister' && target) {
      const typed = window.prompt(
        `删除会永久移除 ${target.name} 的文件系统。请输入发行版名称确认删除：`
      );
      if (typed !== target.name) return;
    }
    if ((actionName === 'set-version-1' || actionName === 'set-version-2') && target) {
      const version = actionName.endsWith('1') ? '1' : '2';
      if (
        !window.confirm(
          `确定将 ${target.name} 转换为 WSL ${version} 吗？转换过程可能需要较长时间。`
        )
      )
        return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const next = await invoke<WslStatus>('system_wsl_action', {
        request: { name: target?.name || '', action: actionName, outputPath },
      });
      setStatus(next);
      setMessage('操作已执行，WSL 状态已刷新');
      setSelectedName(
        (current) => current || next.defaultDistribution || next.distributions[0]?.name || ''
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const exportDistribution = async (item?: WslDistribution) => {
    const target = item || selected;
    if (!target) return;
    const selectedPath = await save({
      defaultPath: `${target.name}.tar`,
      filters: [{ name: 'WSL tar backup', extensions: ['tar'] }],
    });
    if (!selectedPath) return;
    await action('export', target, selectedPath);
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🐧"
        title="WSL 管理面板"
        subtitle="查看和管理 Windows Subsystem for Linux 发行版"
        actions={
          <>
            <ToolbarButton
              onClick={() => void action('shutdown')}
              disabled={loading || status.distributions.length === 0}
              danger
            >
              <Power size={14} />
              关闭全部
            </ToolbarButton>
            <ToolbarButton onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </ToolbarButton>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <aside className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <StatusMessage message={message} error={error} />

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
              <div className="text-xs text-gray-500">发行版</div>
              <div className="mt-1 text-2xl font-semibold">{status.distributions.length}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
              <div className="text-xs text-gray-500">运行中</div>
              <div className="mt-1 text-2xl font-semibold">
                {status.distributions.filter((item) => item.running).length}
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
            <div>默认：{status.defaultDistribution || '-'}</div>
            <div className="truncate" title={status.kernelVersion}>
              版本：{status.kernelVersion || '-'}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950">
            <Search size={16} className="text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索发行版、路径..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ['all', '全部'],
              ['running', '运行中'],
              ['stopped', '已停止'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-lg border px-3 py-1.5 text-xs ${
                  filter === key
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {filtered.map((item) => (
              <button
                key={item.name}
                onClick={() => setSelectedName(item.name)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selected?.name === item.name
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 font-semibold">
                    <span className="truncate">{item.name}</span>
                    {item.default && <Star size={13} className="ml-1 inline text-amber-500" />}
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[11px] ${statusStyle(item)}`}>
                    {item.state}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-gray-500">
                  WSL {item.version} · {item.size ? formatBytes(item.size) : '大小未知'}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <EmptyState
                icon={<Server size={34} />}
                text={
                  status.distributions.length === 0 ? '点击刷新读取 WSL 发行版' : '没有匹配的发行版'
                }
              />
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {!selected ? (
            <EmptyState icon={<Terminal size={42} />} text="未选择 WSL 发行版" />
          ) : (
            <div className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4 dark:border-gray-800">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-xl font-semibold">{selected.name}</h2>
                    {selected.default && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                        默认
                      </span>
                    )}
                    <span className={`rounded px-2 py-0.5 text-xs ${statusStyle(selected)}`}>
                      {selected.state}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    WSL {selected.version} ·{' '}
                    {selected.size ? formatBytes(selected.size) : '大小未知'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ToolbarButton onClick={() => void action('open', selected)} disabled={loading}>
                    <Terminal size={14} />
                    启动/终端
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => void action('restart', selected)}
                    disabled={loading}
                  >
                    <RotateCcw size={14} />
                    重启
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => void action('open-files', selected)}
                    disabled={loading}
                  >
                    <FolderOpen size={14} />
                    文件
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => void action('set-default', selected)}
                    disabled={loading || selected.default}
                  >
                    <Star size={14} />
                    设为默认
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => void action('pause', selected)}
                    disabled={loading || !selected.running}
                    danger
                  >
                    <PauseCircle size={14} />
                    暂停/停止
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => void exportDistribution(selected)}
                    disabled={loading}
                  >
                    <Archive size={14} />
                    导出
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => void action('unregister', selected)}
                    disabled={loading}
                    danger
                  >
                    <Trash2 size={14} />
                    删除
                  </ToolbarButton>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 max-xl:grid-cols-2 max-md:grid-cols-1">
                <InfoCard
                  icon={<Database size={18} />}
                  label="VHD / 数据文件"
                  value={selected.vhdPath || '-'}
                />
                <InfoCard
                  icon={<FolderOpen size={18} />}
                  label="基础路径"
                  value={selected.basePath || '-'}
                />
                <InfoCard
                  icon={<HardDrive size={18} />}
                  label="最后修改"
                  value={formatTimestamp(selected.lastWriteTime)}
                />
              </div>

              <div className="mt-5 rounded-lg bg-gray-50 p-4 dark:bg-gray-950">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <CheckCircle2 size={16} />
                  可执行操作
                </div>
                <div className="mt-3 grid gap-3 text-sm text-gray-600 dark:text-gray-300 md:grid-cols-2">
                  <ActionTile
                    icon={<Terminal size={16} />}
                    title="启动/进入"
                    text={`打开 wsl.exe -d ${selected.name} 终端。`}
                  />
                  <ActionTile
                    icon={<PauseCircle size={16} />}
                    title="暂停/停止"
                    text="终止当前发行版实例，等同释放运行内存。"
                  />
                  <ActionTile
                    icon={<RotateCcw size={16} />}
                    title="重启"
                    text="先停止发行版，再重新打开终端。"
                  />
                  <ActionTile
                    icon={<Archive size={16} />}
                    title="备份导出"
                    text="生成 .tar 备份文件，适合迁移或清理前留档。"
                  />
                  <ActionTile
                    icon={<Layers size={16} />}
                    title="WSL 版本"
                    text="可在 WSL 1 / WSL 2 之间转换，过程由 wsl.exe 执行。"
                  />
                  <ActionTile
                    icon={<Trash2 size={16} />}
                    title="删除发行版"
                    text="执行 unregister，会永久删除该 Linux 文件系统。"
                    danger
                  />
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Layers size={16} />
                  WSL 版本管理
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ToolbarButton
                    onClick={() => void action('set-version-1', selected)}
                    disabled={loading || selected.version === '1'}
                  >
                    转为 WSL 1
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => void action('set-version-2', selected)}
                    disabled={loading || selected.version === '2'}
                  >
                    转为 WSL 2
                  </ToolbarButton>
                  <ToolbarButton onClick={() => void action('shutdown')} disabled={loading} danger>
                    <Power size={14} />
                    关闭全部实例
                  </ToolbarButton>
                </div>
              </div>

              <div className="mt-5 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
                <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-950">
                  全部发行版
                </div>
                <div className="grid min-w-[860px] grid-cols-[220px_110px_90px_minmax(220px,1fr)_140px] border-b border-gray-200 px-4 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
                  <span>名称</span>
                  <span>状态</span>
                  <span>版本</span>
                  <span>路径</span>
                  <span>大小</span>
                </div>
                {status.distributions.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => setSelectedName(item.name)}
                    className="grid min-w-[860px] grid-cols-[220px_110px_90px_minmax(220px,1fr)_140px] items-center border-b border-gray-100 px-4 py-3 text-left text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-950"
                  >
                    <span className="truncate font-medium">
                      {item.name}
                      {item.default ? ' *' : ''}
                    </span>
                    <span>
                      <span className={`rounded px-2 py-0.5 text-xs ${statusStyle(item)}`}>
                        {item.state}
                      </span>
                    </span>
                    <span>WSL {item.version}</span>
                    <span
                      className="truncate font-mono text-xs text-gray-500"
                      title={item.basePath || item.vhdPath}
                    >
                      {item.basePath || item.vhdPath || '-'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {item.size ? formatBytes(item.size) : '-'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
        {icon}
        {label}
      </div>
      <div
        className="mt-2 break-all font-mono text-xs text-gray-700 dark:text-gray-300"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function ActionTile({
  icon,
  title,
  text,
  danger,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${danger ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-200' : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'}`}
    >
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <div className="mt-1 text-xs opacity-80">{text}</div>
    </div>
  );
}
