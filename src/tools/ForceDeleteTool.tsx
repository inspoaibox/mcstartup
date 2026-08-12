import { useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import { AlertTriangle, FileX2, FolderOpen, Trash2 } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

interface ForceDeleteResult {
  path: string;
  success: boolean;
  message: string;
}

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

export default function ForceDeleteTool() {
  const ready = useToolTheme();
  const [path, setPath] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [scanningLocks, setScanningLocks] = useState(false);
  const [locks, setLocks] = useState<FileLockProcess[]>([]);
  const [result, setResult] = useState<ForceDeleteResult | null>(null);
  const [error, setError] = useState('');

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

  const forceDelete = async () => {
    const target = path.trim();
    if (!target) {
      setError('请先选择要删除的文件或文件夹');
      return;
    }
    if (
      !window.confirm(
        `确定强制删除这个路径吗？\n\n${target}\n\n此操作不会进入回收站；普通删除失败时会弹出 UAC 管理员授权，并尝试接管所有权与重置权限。`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError('');
    setResult(null);
    try {
      const response = await invoke<ForceDeleteResult>('system_force_delete', { path: target });
      setResult(response);
      setPath('');
    } catch (err) {
      setError(String(err));
    } finally {
      setDeleting(false);
    }
  };

  const scanLocks = async () => {
    const target = path.trim();
    if (!target) {
      setError('请先选择要检查的文件或文件夹');
      return;
    }
    setScanningLocks(true);
    setError('');
    setResult(null);
    try {
      const rows = await invoke<FileLockProcess[]>('system_locks_query', { path: target });
      setLocks(rows);
      if (!rows.length) setError('');
    } catch (err) {
      setLocks([]);
      setError(String(err));
    } finally {
      setScanningLocks(false);
    }
  };

  const killLock = async (item: FileLockProcess) => {
    if (!window.confirm(`确定结束 ${item.name} (PID ${item.pid}) 吗？未保存的数据可能丢失。`)) return;
    setError('');
    try {
      await invoke('system_locks_kill', { pid: item.pid });
      await scanLocks();
    } catch (err) {
      setError(String(err));
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader icon="🗑️" title="强制删除" subtitle="删除顽固文件/文件夹，普通删除失败后自动请求管理员权限处理" />

      <main className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-semibold">删除目标</div>
          <textarea
            value={path}
            onChange={(event) => setPath(event.target.value)}
            spellCheck={false}
            className="mt-3 h-32 w-full resize-none rounded-lg border border-gray-200 bg-white p-3 font-mono text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
            placeholder="选择或粘贴要强制删除的路径"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => void chooseFile()}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <FileX2 size={16} />
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
            onClick={() => void forceDelete()}
            disabled={deleting || !path.trim()}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            <Trash2 size={16} />
            {deleting ? '正在强制删除...' : '强制删除'}
          </button>
          <button
            onClick={() => void scanLocks()}
            disabled={scanningLocks || !path.trim()}
            className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-blue-200 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/20"
          >
            {scanningLocks ? '正在检测占用...' : '先检测占用'}
          </button>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle size={16} className="text-amber-500" />
            强制删除策略
          </div>
          <div className="mt-3 space-y-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
            <p>会先移除只读、隐藏、系统属性并尝试直接删除。</p>
            <p>直接删除失败后会请求管理员权限，自动执行 takeown 获取所有权、icacls 授权，再递归强制删除。</p>
            <p>如果文件正在被进程或系统内核占用，请先用“解除占用”结束占用后再删除。</p>
            <p>为避免误删系统，禁止直接删除磁盘根目录、Windows 系统目录和用户根目录。</p>
          </div>

          {locks.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/20">
              <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">检测到占用进程</div>
              <div className="mt-2 space-y-2">
                {locks.map((item) => (
                  <div key={`${item.pid}-${item.name}`} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm dark:bg-gray-950">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.name}</div>
                      <div className="font-mono text-xs text-gray-500">PID {item.pid} · {item.status}</div>
                    </div>
                    <button onClick={() => void killLock(item)} className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                      结束
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(result || error) && (
            <div
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${
                error
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                  : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
              }`}
            >
              {error || `${result?.message}: ${result?.path}`}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
