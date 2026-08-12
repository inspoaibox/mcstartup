import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { RefreshCw, Search, ShieldAlert } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

interface StartupEntry {
  id: string;
  kind: string;
  kindLabel: string;
  name: string;
  command: string;
  location: string;
  sourceLabel: string;
  enabled: boolean;
  scope: string;
  canToggle: boolean;
  note?: string | null;
}

const TYPE_ORDER = ['registry', 'folder', 'task', 'service'] as const;
const TYPE_LABELS: Record<string, string> = {
  all: '全部',
  registry: '注册表 Run',
  folder: '启动文件夹',
  task: '计划任务',
  service: '系统服务',
};

export default function StartupManagerTool() {
  const ready = useToolTheme();
  const [itemsByType, setItemsByType] = useState<Record<string, StartupEntry[]>>({});
  const [activeType, setActiveType] = useState('registry');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('点击刷新读取开机启动项。');
  const [error, setError] = useState('');

  const items = useMemo(() => Object.values(itemsByType).flat(), [itemsByType]);
  const visibleItems = activeType === 'all' ? items : itemsByType[activeType] || [];

  const loadItems = useCallback(async (kind = activeType) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      if (kind === 'all') {
        const rows = await invoke<StartupEntry[]>('system_startup_list');
        const grouped = rows.reduce<Record<string, StartupEntry[]>>((acc, item) => {
          acc[item.kind] = [...(acc[item.kind] || []), item];
          return acc;
        }, {});
        setItemsByType(grouped);
        setMessage(`已读取 ${rows.length} 个启动项`);
      } else {
        const rows = await invoke<StartupEntry[]>('system_startup_list_by_kind', { kind });
        setItemsByType((current) => ({ ...current, [kind]: rows }));
        setMessage(`已读取 ${TYPE_LABELS[kind] || kind} ${rows.length} 项`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [activeType]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return visibleItems.filter((item) => {
      if (activeType !== 'all' && item.kind !== activeType) return false;
      if (!keyword) return true;
      return [item.name, item.command, item.location, item.scope, item.kindLabel, item.sourceLabel]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [activeType, search, visibleItems]);

  const typeTabs = useMemo(() => {
    const counts = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.kind] = (acc[item.kind] || 0) + 1;
      acc.all = (acc.all || 0) + 1;
      return acc;
    }, {});
    return ['all', ...TYPE_ORDER].map((type) => ({
      type,
      label: TYPE_LABELS[type] || type,
      count: counts[type] || 0,
    }));
  }, [items]);

  const setEnabled = async (item: StartupEntry, enabled: boolean) => {
    setError('');
    setMessage('');
    try {
      const rows = await invoke<StartupEntry[]>('system_startup_set_enabled', {
        entry: { ...item, enabled },
      });
      const grouped = rows.reduce<Record<string, StartupEntry[]>>((acc, row) => {
        acc[row.kind] = [...(acc[row.kind] || []), row];
        return acc;
      }, {});
      setItemsByType(grouped);
      setMessage(`${item.name} 已${enabled ? '启用' : '禁用'}`);
    } catch (err) {
      setError(String(err));
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🚀"
        title="开机启动管理"
        subtitle="按注册表、启动文件夹、计划任务和系统服务分类型管理"
        actions={
          <button
            onClick={() => void loadItems(activeType)}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        }
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="grid grid-cols-5 gap-2 max-lg:grid-cols-3 max-sm:grid-cols-2">
          {typeTabs.map((tab) => (
            <button
              key={tab.type}
              onClick={() => setActiveType(tab.type)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                activeType === tab.type
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              <div className="text-sm font-semibold">{tab.label}</div>
              <div className="mt-0.5 text-xs opacity-70">{tab.count} 项</div>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
          <Search size={16} className="text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索名称、命令或位置..."
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        {(message || error) && (
          <div
            className={`rounded-lg px-3 py-2 text-sm ${
              error
                ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
            }`}
          >
            {error || message}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="grid min-w-[1040px] grid-cols-[80px_120px_minmax(180px,1fr)_160px_minmax(320px,2fr)_180px] border-b border-gray-200 px-4 py-2 text-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <span>状态</span>
            <span>类型</span>
            <span>名称</span>
            <span>来源</span>
            <span>命令</span>
            <span>位置</span>
          </div>
          {filtered.map((item) => (
            <div
              key={item.id}
              className="grid min-w-[1040px] grid-cols-[80px_120px_minmax(180px,1fr)_160px_minmax(320px,2fr)_180px] items-center gap-0 border-b border-gray-100 px-4 py-3 text-sm dark:border-gray-800"
            >
              <button
                onClick={() => void setEnabled(item, !item.enabled)}
                disabled={!item.canToggle}
                className={`h-7 w-14 rounded-full p-0.5 transition-colors ${
                  item.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700'
                } disabled:cursor-not-allowed disabled:opacity-50`}
                title={item.canToggle ? (item.enabled ? '点击禁用' : '点击启用') : '该类型暂不支持启停'}
              >
                <span
                  className={`block h-6 w-6 rounded-full bg-white transition-transform ${
                    item.enabled ? 'translate-x-7' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-xs text-gray-500">{item.kindLabel}</span>
              <span className="min-w-0 truncate font-medium">{item.name}</span>
              <span className="min-w-0 truncate text-xs text-gray-500" title={item.note || item.sourceLabel}>
                {item.sourceLabel}
              </span>
              <span className="min-w-0 truncate font-mono text-xs text-gray-600 dark:text-gray-300" title={item.command}>
                {item.command}
              </span>
              <span className="min-w-0 truncate text-xs text-gray-500" title={item.location}>
                {item.location}
              </span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="flex h-48 flex-col items-center justify-center text-gray-400">
              <ShieldAlert size={32} />
              <p className="mt-2 text-sm">
                {visibleItems.length === 0 ? `点击刷新读取${TYPE_LABELS[activeType] || '开机启动项'}` : '没有找到启动项'}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
