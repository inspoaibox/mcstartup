import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { AlertTriangle, ExternalLink, Pause, Play, RefreshCw, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { formatBytes, StatusMessage, ToolbarButton } from './systemToolUtils';

interface WindowsUpdateService {
  name: string;
  displayName: string;
  status: string;
  startType: string;
}

interface WindowsHotfixEntry {
  hotfixId: string;
  description: string;
  installedOn: string;
  installedBy: string;
}

interface WindowsUpdateStatus {
  services: WindowsUpdateService[];
  hotfixes: WindowsHotfixEntry[];
  pendingUpdates: WindowsPendingUpdate[];
  cacheSize: number;
  paused: boolean;
  pauseUntil: string;
  updateDisabled: boolean;
}

interface WindowsPendingUpdate {
  title: string;
  downloaded: boolean;
  rebootRequired: boolean;
  severity: string;
}

export default function WindowsUpdateTool() {
  const ready = useToolTheme();
  const [status, setStatus] = useState<WindowsUpdateStatus>({
    services: [],
    hotfixes: [],
    pendingUpdates: [],
    cacheSize: 0,
    paused: false,
    pauseUntil: '',
    updateDisabled: false,
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('点击刷新读取 Windows 更新状态。');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await invoke<WindowsUpdateStatus>('system_windows_update_status');
      setStatus(result);
      setMessage('Windows 更新状态已刷新');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const action = async (name: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await invoke<WindowsUpdateStatus>('system_windows_update_action', { action: name });
      setStatus(result);
      setMessage('操作已执行，状态已刷新');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🪟"
        title="Windows 更新辅助"
        subtitle="查看更新服务、待安装更新和缓存占用，支持暂停/恢复、重置组件和高级禁用"
        actions={
          <>
            <ToolbarButton onClick={() => void action('open')}>
              <ExternalLink size={14} />
              打开更新设置
            </ToolbarButton>
            <ToolbarButton onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </ToolbarButton>
          </>
        }
      />
      <main className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <aside className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <StatusMessage message={message} error={error} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
              <div className="text-xs text-gray-500">待安装更新</div>
              <div className="mt-1 text-xl font-semibold">{status.pendingUpdates?.length || 0}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
              <div className="text-xs text-gray-500">下载缓存</div>
              <div className="mt-1 text-xl font-semibold">{formatBytes(status.cacheSize || 0)}</div>
            </div>
          </div>

          <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
            状态：{status.updateDisabled ? '自动更新已被策略/服务禁用' : status.paused ? `已暂停到 ${status.pauseUntil}` : '未暂停'}
          </div>

          <div className="mt-4 text-sm font-semibold">服务状态</div>
          <div className="mt-3 space-y-2">
            {status.services.map((service) => (
              <div key={service.name} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{service.displayName}</span>
                  <span className={service.status === 'Running' ? 'text-xs text-green-600' : 'text-xs text-gray-500'}>{service.status}</span>
                </div>
                <div className="mt-1 font-mono text-xs text-gray-500">{service.name} · {service.startType}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2">
            <button onClick={() => void action('restart-services')} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">
              <RefreshCw size={16} />
              重启更新服务
            </button>
            <button onClick={() => void action('pause-7', '确定暂停 Windows 更新 7 天吗？')} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/20">
              <Pause size={16} />
              暂停 7 天
            </button>
            <button onClick={() => void action('resume', '确定恢复 Windows 更新吗？这会移除暂停/禁用策略并尝试启动更新服务。')} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-green-200 text-sm font-semibold text-green-700 hover:bg-green-50 dark:border-green-900/50 dark:text-green-300 dark:hover:bg-green-900/20">
              <Play size={16} />
              恢复更新
            </button>
            <button onClick={() => void action('reset-components', '确定重置 Windows Update 组件吗？会停止服务并重命名 SoftwareDistribution / catroot2 缓存目录。')} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-200 text-sm font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-900/20">
              <RotateCcw size={16} />
              重置更新组件
            </button>
            <button onClick={() => void action('clean-cache', '确定清理 Windows Update 下载缓存吗？这不会删除已安装更新。')} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-200 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20">
              <Trash2 size={16} />
              清理下载缓存 {status.cacheSize ? `(${formatBytes(status.cacheSize)})` : ''}
            </button>
            <button onClick={() => void action('disable-updates', '高级操作：确定禁止自动更新吗？这会写入 NoAutoUpdate 策略并禁用 wuauserv。后续可点击“恢复更新”还原。')} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 text-sm font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200">
              <ShieldAlert size={16} />
              禁止自动更新
            </button>
          </div>
        </aside>
        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle size={16} />
              待安装更新
            </div>
            <div className="mt-3 space-y-2">
              {(status.pendingUpdates || []).map((item) => (
                <div key={item.title} className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-950">
                  <div className="font-medium">{item.title}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {item.downloaded ? '已下载' : '未下载'}
                    {item.rebootRequired ? ' · 需要重启' : ''}
                    {item.severity ? ` · ${item.severity}` : ''}
                  </div>
                </div>
              ))}
              {(status.pendingUpdates || []).length === 0 && <div className="text-sm text-gray-400">未检测到待安装更新，或当前系统 COM 查询不可用。</div>}
            </div>
          </div>

          <div className="text-sm font-semibold">近期已安装更新</div>
          <div className="mt-3 overflow-auto">
            <div className="grid min-w-[780px] grid-cols-[140px_minmax(220px,1fr)_180px_180px] border-b border-gray-200 px-3 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
              <span>编号</span>
              <span>描述</span>
              <span>安装时间</span>
              <span>安装用户</span>
            </div>
            {status.hotfixes.map((item) => (
              <div key={`${item.hotfixId}-${item.installedOn}`} className="grid min-w-[780px] grid-cols-[140px_minmax(220px,1fr)_180px_180px] border-b border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                <span className="font-mono text-xs">{item.hotfixId}</span>
                <span className="truncate text-gray-600 dark:text-gray-300">{item.description}</span>
                <span className="truncate text-xs text-gray-500">{item.installedOn || '-'}</span>
                <span className="truncate text-xs text-gray-500">{item.installedBy || '-'}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
