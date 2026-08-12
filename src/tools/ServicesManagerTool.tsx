import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Play, RefreshCw, RotateCcw, RotateCw, Search, Square } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { EmptyState, StatusMessage, ToolbarButton } from './systemToolUtils';

interface ServiceEntry {
  name: string;
  displayName: string;
  description: string;
  state: string;
  startMode: string;
  pathName: string;
  startName: string;
  canStop: boolean;
}

const STARTUP_OPTIONS = ['Automatic', 'Manual', 'Disabled'];

export default function ServicesManagerTool() {
  const ready = useToolTheme();
  const [items, setItems] = useState<ServiceEntry[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('点击刷新读取系统服务。');
  const [error, setError] = useState('');
  const [restoreMap, setRestoreMap] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await invoke<ServiceEntry[]>('system_services_list');
      setItems(rows);
      setMessage(`已读取 ${rows.length} 个服务`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'running' && item.state.toLowerCase() !== 'running') return false;
      if (filter === 'third-party' && item.pathName.toLowerCase().includes('\\windows\\')) return false;
      if (!keyword) return true;
      return [item.name, item.displayName, item.description, item.pathName, item.startName]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [filter, items, search]);

  const action = async (item: ServiceEntry, actionName: string, startupType?: string) => {
    if (actionName === 'startup' && startupType && startupType !== (item.startMode === 'Auto' ? 'Automatic' : item.startMode)) {
      setRestoreMap((current) => current[item.name] ? current : { ...current, [item.name]: item.startMode === 'Auto' ? 'Automatic' : item.startMode });
    }
    if (actionName === 'startup' && startupType === 'Disabled' && item.pathName.toLowerCase().includes('\\windows\\')) {
      if (!window.confirm(`"${item.displayName}" 看起来像系统服务，确定要禁用启动吗？`)) return;
    }
    if (actionName !== 'startup' && item.pathName.toLowerCase().includes('\\windows\\')) {
      if (!window.confirm(`"${item.displayName || item.name}" 看起来像系统服务，确定执行该操作吗？`)) return;
    }
    setError('');
    setMessage('');
    try {
      const rows = await invoke<ServiceEntry[]>('system_service_action', {
        request: { name: item.name, action: actionName, startupType },
      });
      setItems(rows);
      setMessage(`${item.displayName || item.name} 操作已执行`);
    } catch (err) {
      setError(String(err));
    }
  };

  const restoreStartup = async (item: ServiceEntry) => {
    const original = restoreMap[item.name];
    if (!original) return;
    await action(item, 'startup', original);
    setRestoreMap((current) => {
      const next = { ...current };
      delete next[item.name];
      return next;
    });
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🛠️"
        title="系统服务管理"
        subtitle="查看服务状态、启动类型和路径，支持启动、停止与启动类型调整"
        actions={
          <ToolbarButton onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </ToolbarButton>
        }
      />
      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <StatusMessage message={message} error={error} />
        <div className="flex flex-wrap gap-2">
          {[
            ['all', '全部'],
            ['running', '运行中'],
            ['third-party', '第三方优先'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                filter === key
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                  : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
          <Search size={16} className="text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索服务名称、描述、路径..." className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </div>
        <section className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="grid min-w-[1260px] grid-cols-[220px_90px_120px_minmax(240px,1fr)_220px_300px] border-b border-gray-200 px-4 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
            <span>服务</span>
            <span>状态</span>
            <span>启动类型</span>
            <span>描述</span>
            <span>路径</span>
            <span>操作</span>
          </div>
          {filtered.map((item) => (
            <div key={item.name} className="grid min-w-[1260px] grid-cols-[220px_90px_120px_minmax(240px,1fr)_220px_300px] items-center gap-0 border-b border-gray-100 px-4 py-3 text-sm dark:border-gray-800">
              <div className="min-w-0">
                <div className="truncate font-semibold">{item.displayName || item.name}</div>
                <div className="truncate font-mono text-xs text-gray-400">{item.name}</div>
              </div>
              <span className={item.state.toLowerCase() === 'running' ? 'text-green-600' : 'text-gray-500'}>{item.state}</span>
              <select value={item.startMode === 'Auto' ? 'Automatic' : item.startMode} onChange={(event) => void action(item, 'startup', event.target.value)} className="w-28 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950">
                {STARTUP_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <span className="min-w-0 truncate text-gray-500" title={item.description}>{item.description || '-'}</span>
              <span className="min-w-0 truncate font-mono text-xs text-gray-500" title={item.pathName}>{item.pathName || '-'}</span>
              <div className="flex gap-1">
                <button onClick={() => void action(item, 'start')} className="rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" title="启动">
                  <Play size={15} />
                </button>
                <button onClick={() => void action(item, 'stop')} className="rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" title="停止">
                  <Square size={15} />
                </button>
                <button onClick={() => void action(item, 'restart')} className="rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" title="重启">
                  <RotateCw size={15} />
                </button>
                <button
                  onClick={() => void restoreStartup(item)}
                  disabled={!restoreMap[item.name]}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-900/20"
                  title={restoreMap[item.name] ? `恢复启动类型为 ${restoreMap[item.name]}` : '暂无可恢复的启动类型'}
                >
                  <RotateCcw size={14} />
                  恢复
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <EmptyState icon={<Search size={32} />} text={items.length === 0 ? '点击刷新读取系统服务' : '没有找到服务'} />}
        </section>
      </main>
    </div>
  );
}
