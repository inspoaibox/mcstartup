import { useCallback, useMemo, useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import { AlertTriangle, FolderOpen, RefreshCw, Search, ShieldAlert, Trash2 } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

interface FileLockProcess {
  pid: number;
  name: string;
  appName: string;
  serviceShortName: string;
  status: string;
  restartable: boolean;
}

function selectedPath(value: string | string[] | null): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export default function FileUnlockTool() {
  const ready = useToolTheme();
  const [path, setPath] = useState('');
  const [items, setItems] = useState<FileLockProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const hasResult = useMemo(() => Boolean(message || error || items.length), [error, items.length, message]);

  const chooseFile = async () => {
    const result = await open({ multiple: false, directory: false });
    const next = selectedPath(result);
    if (next) setPath(next);
  };

  const chooseFolder = async () => {
    const result = await open({ multiple: false, directory: true });
    const next = selectedPath(result);
    if (next) setPath(next);
  };

  const scan = useCallback(async () => {
    if (!path.trim()) {
      setError('请先选择文件或文件夹');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const rows = await invoke<FileLockProcess[]>('system_locks_query', { path });
      setItems(rows);
      setMessage(rows.length ? `找到 ${rows.length} 个可能占用该路径的进程` : '当前没有发现占用进程');
    } catch (err) {
      setItems([]);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [path]);

  const killProcess = async (item: FileLockProcess) => {
    if (!window.confirm(`确定结束 ${item.name} (PID ${item.pid}) 吗？未保存的数据可能丢失。`)) return;
    setError('');
    setMessage('');
    try {
      await invoke('system_locks_kill', { pid: item.pid });
      setMessage(`已结束 ${item.name}，正在重新扫描`);
      await scan();
    } catch (err) {
      setError(String(err));
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader icon="🔓" title="解除占用" subtitle="查看文件或文件夹被哪些进程占用，并可按需结束进程" />

      <main className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-semibold">检查路径</div>
          <textarea
            value={path}
            onChange={(event) => setPath(event.target.value)}
            spellCheck={false}
            className="mt-3 h-28 w-full resize-none rounded-lg border border-gray-200 bg-white p-3 font-mono text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
            placeholder="选择或粘贴文件/文件夹路径"
          />

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => void chooseFile()}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <FolderOpen size={16} />
              选择文件
            </button>
            <button
              onClick={() => void chooseFolder()}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <FolderOpen size={16} />
              选择文件夹
            </button>
          </div>

          <button
            onClick={() => void scan()}
            disabled={loading}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
            扫描占用
          </button>

          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle size={14} />
              结束进程前请确认文件已保存
            </div>
            <p className="mt-1">结束进程会直接关闭对应程序，适合处理文件无法删除、无法覆盖、无法移动的情况。</p>
          </div>
        </section>

        <section className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <div>
              <h2 className="text-sm font-semibold">占用进程</h2>
              <p className="mt-0.5 text-xs text-gray-500">基于 Windows Restart Manager 检测</p>
            </div>
            <button
              onClick={() => void scan()}
              disabled={loading || !path.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>
          </div>

          {(message || error) && (
            <div
              className={`m-4 rounded-lg px-3 py-2 text-sm ${
                error
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                  : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
              }`}
            >
              {error || message}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
            {items.length > 0 && (
              <div className="grid min-w-[720px] grid-cols-[90px_minmax(180px,1fr)_140px_120px_100px] border-b border-gray-200 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
                <span>PID</span>
                <span>进程</span>
                <span>服务</span>
                <span>状态</span>
                <span>操作</span>
              </div>
            )}
            {items.map((item) => (
              <div
                key={`${item.pid}-${item.name}`}
                className="grid min-w-[720px] grid-cols-[90px_minmax(180px,1fr)_140px_120px_100px] items-center border-b border-gray-100 py-3 text-sm dark:border-gray-800"
              >
                <span className="font-mono text-xs text-gray-500">{item.pid}</span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{item.name}</div>
                  <div className="truncate text-xs text-gray-500">{item.restartable ? '可由系统重启' : '不可自动重启'}</div>
                </div>
                <span className="truncate text-xs text-gray-500">{item.serviceShortName || '-'}</span>
                <span className="text-xs text-gray-600 dark:text-gray-300">{item.status}</span>
                <button
                  onClick={() => void killProcess(item)}
                  className="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700"
                >
                  <Trash2 size={14} />
                  结束
                </button>
              </div>
            ))}
            {!hasResult && (
              <div className="flex h-72 flex-col items-center justify-center text-gray-400">
                <ShieldAlert size={36} />
                <p className="mt-2 text-sm">选择路径后扫描占用进程</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
