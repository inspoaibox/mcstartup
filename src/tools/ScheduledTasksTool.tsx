import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Pause, Play, RefreshCw, Search, Square } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { EmptyState, StatusMessage, ToolbarButton } from './systemToolUtils';

interface ScheduledTaskEntry {
  taskName: string;
  taskPath: string;
  state: string;
  author: string;
  description: string;
  triggers: string;
  actions: string;
  lastRunTime: string;
  nextRunTime: string;
  lastTaskResult: string;
}

export default function ScheduledTasksTool() {
  const ready = useToolTheme();
  const [items, setItems] = useState<ScheduledTaskEntry[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<ScheduledTaskEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('点击刷新读取计划任务。');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await invoke<ScheduledTaskEntry[]>('system_tasks_summary_list');
      setItems(rows);
      setMessage(`已读取 ${rows.length} 个计划任务`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'enabled' && item.state.toLowerCase() === 'disabled') return false;
      if (filter === 'disabled' && item.state.toLowerCase() !== 'disabled') return false;
      if (filter === 'startup' && !/(logon|boot|startup)/i.test(item.triggers)) return false;
      if (!keyword) return true;
      return [item.taskName, item.taskPath, item.author, item.description, item.triggers, item.actions]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [filter, items, search]);

  const action = async (item: ScheduledTaskEntry, actionName: string) => {
    if (actionName === 'disable' && item.taskPath.startsWith('\\Microsoft\\Windows\\')) {
      if (!window.confirm(`"${item.taskPath}${item.taskName}" 是 Windows 任务，确定禁用吗？`)) return;
    }
    setError('');
    setMessage('');
    try {
      const rows = await invoke<ScheduledTaskEntry[]>('system_task_action', {
        request: { taskName: item.taskName, taskPath: item.taskPath, action: actionName },
      });
      setItems(rows);
      setMessage(`${item.taskName} 操作已执行`);
    } catch (err) {
      setError(String(err));
    }
  };

  const loadDetail = async (item: ScheduledTaskEntry) => {
    setSelected(item);
    setDetailLoading(true);
    setError('');
    try {
      const detail = await invoke<ScheduledTaskEntry>('system_task_detail', {
        request: { taskName: item.taskName, taskPath: item.taskPath },
      });
      setSelected(detail);
      setItems((current) =>
        current.map((row) => (row.taskName === detail.taskName && row.taskPath === detail.taskPath ? detail : row)),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setDetailLoading(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="📅"
        title="计划任务管理"
        subtitle="查看 Windows 计划任务触发器、动作、运行状态，支持启停和手动运行"
        actions={
          <ToolbarButton onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </ToolbarButton>
        }
      />
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-4 p-4 max-lg:grid-cols-1">
        <section className="flex min-h-0 flex-col gap-3 overflow-hidden">
        <StatusMessage message={message} error={error} />
        <div className="flex flex-wrap gap-2">
          {[
            ['all', '全部'],
            ['enabled', '已启用'],
            ['disabled', '已禁用'],
            ['startup', '开机/登录触发'],
          ].map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)} className={`rounded-lg border px-3 py-2 text-sm ${filter === key ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
          <Search size={16} className="text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索任务名称、路径、触发器、动作..." className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </div>
        <section className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="grid min-w-[1280px] grid-cols-[260px_90px_180px_260px_260px_160px_140px] border-b border-gray-200 px-4 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
            <span>任务</span>
            <span>状态</span>
            <span>触发器</span>
            <span>动作</span>
            <span>描述</span>
            <span>下次运行</span>
            <span>操作</span>
          </div>
          {filtered.map((item) => (
            <div key={`${item.taskPath}${item.taskName}`} onClick={() => void loadDetail(item)} className={`grid min-w-[1280px] cursor-pointer grid-cols-[260px_90px_180px_260px_260px_160px_140px] items-center border-b border-gray-100 px-4 py-3 text-sm dark:border-gray-800 ${selected?.taskName === item.taskName && selected?.taskPath === item.taskPath ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
              <div className="min-w-0">
                <div className="truncate font-semibold">{item.taskName}</div>
                <div className="truncate text-xs text-gray-400">{item.taskPath}</div>
              </div>
              <span className={item.state.toLowerCase() === 'ready' ? 'text-green-600' : item.state.toLowerCase() === 'disabled' ? 'text-gray-400' : 'text-blue-600'}>{item.state}</span>
              <span className="truncate text-xs text-gray-500" title={item.triggers}>{item.triggers || '-'}</span>
              <span className="truncate font-mono text-xs text-gray-500" title={item.actions}>{item.actions || '-'}</span>
              <span className="truncate text-xs text-gray-500" title={item.description}>{item.description || item.author || '-'}</span>
              <span className="truncate text-xs text-gray-500">{item.nextRunTime || '-'}</span>
              <div className="flex gap-1">
                <button onClick={(event) => { event.stopPropagation(); void action(item, 'run'); }} className="rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" title="运行">
                  <Play size={15} />
                </button>
                <button onClick={(event) => { event.stopPropagation(); void action(item, 'stop'); }} className="rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" title="停止">
                  <Square size={15} />
                </button>
                <button onClick={(event) => { event.stopPropagation(); void action(item, item.state.toLowerCase() === 'disabled' ? 'enable' : 'disable'); }} className="rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" title={item.state.toLowerCase() === 'disabled' ? '启用' : '禁用'}>
                  <Pause size={15} />
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <EmptyState icon={<Search size={32} />} text={items.length === 0 ? '点击刷新读取计划任务' : '没有找到计划任务'} />}
        </section>
        </section>
        <aside className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-semibold">任务详情</div>
          {selected ? (
            <div className="mt-3 space-y-3 text-sm">
              {detailLoading && <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">正在读取详情...</div>}
              {[
                ['名称', selected.taskName],
                ['路径', selected.taskPath],
                ['状态', selected.state],
                ['作者', selected.author],
                ['触发器', selected.triggers],
                ['动作', selected.actions],
                ['描述', selected.description],
                ['上次运行', selected.lastRunTime],
                ['下次运行', selected.nextRunTime],
                ['上次结果', selected.lastTaskResult],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-xs text-gray-500">{label}</div>
                  <div className="mt-1 break-all font-mono text-xs leading-5">{value || '-'}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Search size={28} />} text="点击左侧任务查看详情" />
          )}
        </aside>
      </main>
    </div>
  );
}
