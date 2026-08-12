import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { open as openExternal } from '@tauri-apps/api/shell';
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Clock,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FolderOpen,
  Gauge,
  Link,
  Loader,
  Pause,
  Play,
  RotateCcw,
  Search,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { formatBytes, StatusMessage, ToolbarButton } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';
import { useToolDataStore, type DownloadManagerTaskRecord, type DownloadManagerToolData } from '../stores/toolDataStore';

type DownloadStatus = 'waiting' | 'downloading' | 'paused' | 'done' | 'error' | 'cancelled';
type CookieMode = DownloadManagerToolData['cookieMode'];
type CookieBrowser = DownloadManagerToolData['cookieBrowser'];
type DownloadType = 'auto' | 'http' | 'hls' | 'aria2';

interface DownloadHeaderInput {
  name: string;
  value: string;
}

interface DownloadProbeInfo {
  url: string;
  finalUrl: string;
  fileName: string;
  contentType?: string;
  totalSize?: number;
  supportsRanges: boolean;
  suggestedThreads: number;
}

interface DownloadProgress {
  taskId: string;
  status: DownloadStatus;
  downloaded: number;
  total?: number;
  percent?: number;
  speed?: string;
  eta?: string;
  fileName?: string;
  outputPath?: string;
  message?: string;
}

interface DownloadCookieProbeResult {
  browser: string;
  found: boolean;
  count: number;
  hosts: string[];
  message: string;
}

interface DownloadRuntimeStatus {
  ffmpegInstalled: boolean;
  ffmpegPath?: string;
  aria2Installed: boolean;
  aria2Path?: string;
  message: string;
}

interface DownloadTask extends DownloadManagerTaskRecord {
  status: DownloadStatus;
  downloaded: number;
  total?: number;
  percent?: number;
  speed?: string;
  eta?: string;
  message?: string;
  downloadType?: DownloadType | string;
}

const DEFAULT_SETTINGS: Omit<DownloadManagerToolData, 'lastModified'> = {
  version: 'mcheng-download-manager-v1',
  outputDir: '',
  threadCount: 8,
  overwrite: false,
  userAgentPreset: 'chrome-windows',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  referer: '',
  cookieMode: 'none',
  cookieBrowser: 'chrome',
  cookie: '',
  headers: [],
  history: [],
};

const COOKIE_MODES: Array<{ value: CookieMode; label: string }> = [
  { value: 'none', label: '不读取 Cookie' },
  { value: 'chrome', label: 'Chrome 自动读取' },
  { value: 'edge', label: 'Edge 自动读取' },
  { value: 'brave', label: 'Brave 自动读取' },
  { value: 'vivaldi', label: 'Vivaldi 自动读取' },
  { value: 'opera', label: 'Opera 自动读取' },
  { value: 'manual', label: '自定义填写' },
];

const USER_AGENT_PRESETS = [
  {
    id: 'chrome-windows',
    label: 'Chrome / Windows',
    value:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  },
  {
    id: 'edge-windows',
    label: 'Edge / Windows',
    value:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  },
  {
    id: 'firefox-windows',
    label: 'Firefox / Windows',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
  },
  {
    id: 'safari-ios',
    label: 'Safari / iPhone',
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'android-chrome',
    label: 'Chrome / Android',
    value:
      'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  },
  {
    id: 'curl',
    label: 'curl',
    value: 'curl/8.0.0',
  },
  {
    id: 'custom',
    label: '自定义',
    value: '',
  },
];

const ARIA2_RELEASES_URL = 'https://github.com/aria2/aria2/releases';
const ARIA2_INSTALL_METHODS = [
  {
    id: 'winget',
    label: 'WinGet',
    command: 'winget install -e --id aria2.aria2',
    note: 'Windows 10/11 推荐方式，安装后点击重新检测。',
  },
  {
    id: 'scoop',
    label: 'Scoop',
    command: 'scoop install aria2',
    note: '适合已使用 Scoop 的用户，通常不需要管理员权限。',
  },
  {
    id: 'choco',
    label: 'Chocolatey',
    command: 'choco install aria2 -y',
    note: '适合已使用 Chocolatey 的用户，通常需要管理员 PowerShell。',
  },
];

async function downloadManagerCommand<T>(action: string, payload: Record<string, unknown> = {}) {
  const response = await invoke<string>('download_manager_command', {
    action,
    payload: JSON.stringify(payload),
  });
  return JSON.parse(response) as T;
}

function createTaskId() {
  return `download-manager-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function compactHeaders(headers: DownloadHeaderInput[]) {
  return headers
    .map((item) => ({ name: item.name.trim(), value: item.value.trim() }))
    .filter((item) => item.name && item.value);
}

function extractDownloadUrls(input: string) {
  const matches = input.match(/(?:https?|ftp):\/\/[^\s"'<>]+|magnet:\?[^\s"'<>]+/gi) || [];
  const seen = new Set<string>();
  return matches
    .map((item) => item.replace(/[),.;，。；）]+$/g, '').trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function guessFileNameFromUrl(value: string) {
  if (value.trim().toLowerCase().startsWith('magnet:')) {
    return 'magnet-task';
  }
  try {
    const parsed = new URL(value);
    const last = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    return last || 'download.bin';
  } catch {
    return 'download.bin';
  }
}

function taskSubtitle(task: DownloadTask) {
  if (task.status === 'done') return task.outputPath || '下载完成';
  if (task.status === 'paused') return '已暂停，可继续下载';
  if (task.status === 'error') return task.message || '下载失败';
  if (task.status === 'cancelled') return '已取消';
  return task.message || task.url;
}

function detectDownloadType(value: string, selected: DownloadType): DownloadType {
  if (selected !== 'auto') return selected;
  const lower = value.trim().toLowerCase();
  if (
    lower.startsWith('magnet:') ||
    lower.startsWith('ftp://') ||
    lower.includes('.torrent') ||
    lower.includes('.metalink') ||
    lower.includes('.meta4')
  ) {
    return 'aria2';
  }
  if (lower.includes('.m3u8') || lower.endsWith('.m3u8')) return 'hls';
  return 'http';
}

function canPauseTask(task: DownloadTask) {
  return !task.downloadType || task.downloadType === 'http';
}

function typeLabel(value?: string) {
  if (value === 'hls') return 'HLS / m3u8';
  if (value === 'aria2') return 'Aria2 协议';
  if (value === 'http') return 'HTTP 多线程';
  return '自动判断';
}

export default function DownloadManagerTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateDownloadManagerData } = useToolDataStore();
  const [settings, setSettings] = useState<Omit<DownloadManagerToolData, 'lastModified'>>(DEFAULT_SETTINGS);
  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [probeInfo, setProbeInfo] = useState<DownloadProbeInfo | null>(null);
  const [downloadType, setDownloadType] = useState<DownloadType>('auto');
  const [runtime, setRuntime] = useState<DownloadRuntimeStatus | null>(null);
  const [probing, setProbing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [checkingRuntime, setCheckingRuntime] = useState(false);
  const [checkingCookie, setCheckingCookie] = useState(false);
  const [showAria2Guide, setShowAria2Guide] = useState(false);
  const [showCookie, setShowCookie] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const restoredRef = useRef(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    if (!loaded) {
      void loadData();
    }
  }, [loaded, loadData]);

  const refreshRuntime = async () => {
    setCheckingRuntime(true);
    try {
      const result = await downloadManagerCommand<DownloadRuntimeStatus>('runtime');
      setRuntime(result);
      if (!result.aria2Installed) {
        setShowAria2Guide(true);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setCheckingRuntime(false);
    }
  };

  useEffect(() => {
    void refreshRuntime();
  }, []);

  useEffect(() => {
    if (!loaded || restoredRef.current) return;
    restoredRef.current = true;
    const next = {
      ...DEFAULT_SETTINGS,
      ...(data.downloadManager || {}),
    };
    if (!next.userAgentPreset) {
      const matched = USER_AGENT_PRESETS.find((item) => item.value && item.value === next.userAgent);
      next.userAgentPreset = matched?.id || 'custom';
    }
    setSettings(next);
    setTasks((next.history || []).map((item) => ({ ...item, status: item.status as DownloadStatus })));
    if (!next.outputDir) {
      downloadManagerCommand<string>('defaultDir')
        .then((dir) => setSettings((current) => ({ ...current, outputDir: dir })))
        .catch(() => undefined);
    }
  }, [data.downloadManager, loaded]);

  useEffect(() => {
    if (!loaded || !restoredRef.current) return;
    const timer = window.setTimeout(() => {
      updateDownloadManagerData({
        ...settings,
        history: tasks.slice(0, 80).map((item) => ({
          id: item.id,
          url: item.url,
          fileName: item.fileName,
          outputPath: item.outputPath,
          status: item.status,
          total: item.total,
          downloaded: item.downloaded,
          downloadType: item.downloadType,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loaded, settings, tasks, updateDownloadManagerData]);

  useEffect(() => {
    let mounted = true;
    listen<DownloadProgress>('download-manager-progress', (event) => {
      if (!mounted) return;
      const progress = event.payload;
      setTasks((current) =>
        current.map((task) =>
          task.id === progress.taskId
            ? {
                ...task,
                status: progress.status,
                downloaded: progress.downloaded ?? task.downloaded,
                total: progress.total ?? task.total,
                percent: progress.percent ?? task.percent,
                speed: progress.speed,
                eta: progress.eta,
                fileName: progress.fileName || task.fileName,
                outputPath: progress.outputPath || task.outputPath,
                message: progress.message || task.message,
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
      );
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });
    return () => {
      mounted = false;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const activeTasks = useMemo(
    () => tasks.filter((task) => ['downloading', 'paused', 'waiting'].includes(task.status)).length,
    [tasks],
  );
  const inputUrls = useMemo(() => extractDownloadUrls(url), [url]);
  const isBatch = inputUrls.length > 1;

  const updateSetting = <K extends keyof Omit<DownloadManagerToolData, 'lastModified'>>(
    key: K,
    value: Omit<DownloadManagerToolData, 'lastModified'>[K],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const chooseOutputDir = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === 'string') {
      updateSetting('outputDir', selected);
    }
  };

  const copyInstallCommand = async (command: string) => {
    await navigator.clipboard.writeText(command);
    setMessage('安装命令已复制。安装完成后点击“重新检测”。');
  };

  const cookiePayload = () => ({
    cookieMode: settings.cookieMode,
    cookieBrowser: settings.cookieBrowser,
    cookie: settings.cookieMode === 'manual' ? settings.cookie : undefined,
  });

  const changeUserAgentPreset = (presetId: string) => {
    const preset = USER_AGENT_PRESETS.find((item) => item.id === presetId) || USER_AGENT_PRESETS[0];
    setSettings((current) => ({
      ...current,
      userAgentPreset: preset.id,
      userAgent: preset.id === 'custom' ? current.userAgent : preset.value,
    }));
  };

  const checkCookie = async () => {
    if (settings.cookieMode === 'manual') {
      setMessage(settings.cookie.trim() ? '自定义 Cookie 已填写。' : '自定义 Cookie 为空。');
      return;
    }
    if (settings.cookieMode === 'none') {
      setMessage('当前设置为不读取 Cookie。');
      return;
    }
    if (inputUrls.length === 0) {
      setError('请先粘贴下载链接，用于匹配浏览器 Cookie 域名。');
      return;
    }
    setCheckingCookie(true);
    setError('');
    setMessage('');
    try {
      const result = await downloadManagerCommand<DownloadCookieProbeResult>('probeCookie', {
        url: inputUrls[0],
        cookieMode: settings.cookieMode,
        cookieBrowser: settings.cookieMode,
      });
      setMessage(`${result.message} 匹配域名：${result.hosts.join(', ')}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setCheckingCookie(false);
    }
  };

  const probe = async () => {
    if (inputUrls.length === 0) {
      setError('请先粘贴下载链接');
      return;
    }
    setProbing(true);
    setError('');
    setMessage('');
    try {
      const result = await downloadManagerCommand<DownloadProbeInfo>('probe', {
        url: inputUrls[0],
        fileName: isBatch ? undefined : fileName || undefined,
        downloadType,
        userAgent: settings.userAgent,
        referer: settings.referer,
        ...cookiePayload(),
        headers: compactHeaders(settings.headers),
      });
      setProbeInfo(result);
      if (!fileName.trim()) setFileName(result.fileName);
      if (result.suggestedThreads && result.suggestedThreads !== settings.threadCount) {
        updateSetting('threadCount', result.suggestedThreads);
      }
      const prefix = isBatch ? `已检测第 1 个链接，当前共识别 ${inputUrls.length} 个链接。` : '';
      const currentType = detectDownloadType(inputUrls[0], downloadType);
      const detail =
        currentType === 'http'
          ? result.supportsRanges
            ? '链接支持断点续传和多线程下载'
            : '链接可下载，但服务器未声明支持多线程分片'
          : `${typeLabel(currentType)} 任务已识别，下载时会调用对应协议运行时`;
      setMessage(`${prefix}${detail}`);
    } catch (err) {
      setProbeInfo(null);
      setError(String(err));
    } finally {
      setProbing(false);
    }
  };

  const start = async () => {
    if (inputUrls.length === 0) {
      setError('请先粘贴下载链接');
      return;
    }
    const now = new Date().toISOString();
    const nextTasks: DownloadTask[] = inputUrls.map((item, index) => {
      const taskId = createTaskId();
      const singleFileName = !isBatch && fileName.trim() ? fileName.trim() : '';
      const taskType = detectDownloadType(item, downloadType);
      return {
        id: taskId,
        url: item,
        fileName: singleFileName || (!isBatch && probeInfo?.fileName) || guessFileNameFromUrl(item),
        outputPath: undefined,
        status: 'waiting',
        downloaded: 0,
        total: !isBatch && index === 0 ? probeInfo?.totalSize : undefined,
        percent: 0,
        downloadType: taskType,
        message: isBatch ? '批量任务等待启动' : '等待启动',
        createdAt: now,
        updatedAt: now,
      };
    });
    setTasks((current) => [...nextTasks, ...current].slice(0, 80));
    setStarting(true);
    setError('');
    setMessage('');
    let failed = 0;
    try {
      for (const task of nextTasks) {
        try {
          await downloadManagerCommand<{ taskId: string }>('start', {
            taskId: task.id,
            url: task.url,
            outputDir: settings.outputDir,
            fileName: isBatch ? undefined : fileName || probeInfo?.fileName || undefined,
            downloadType: task.downloadType,
            threadCount: settings.threadCount,
            overwrite: settings.overwrite,
            userAgent: settings.userAgent,
            referer: settings.referer,
            ...cookiePayload(),
            headers: compactHeaders(settings.headers),
          });
          setTasks((current) =>
            current.map((item) =>
              item.id === task.id
                ? { ...item, status: 'downloading', message: '下载已启动', updatedAt: new Date().toISOString() }
                : item,
            ),
          );
        } catch (err) {
          failed += 1;
          const text = String(err);
          setTasks((current) =>
            current.map((item) =>
              item.id === task.id
                ? { ...item, status: 'error', message: text, updatedAt: new Date().toISOString() }
                : item,
            ),
          );
        }
      }
      setMessage(
        failed > 0
          ? `已启动 ${nextTasks.length - failed} 个任务，${failed} 个启动失败`
          : isBatch
            ? `已批量启动 ${nextTasks.length} 个下载任务`
            : '下载已启动',
      );
      if (failed > 0) {
        setError('部分任务启动失败，请查看右侧任务列表。');
      }
    } finally {
      setStarting(false);
    }
  };

  const controlTask = async (action: 'pause' | 'resume' | 'cancel', taskId: string) => {
    try {
      await downloadManagerCommand(action, { taskId });
      if (action === 'pause') {
        setTasks((current) =>
          current.map((item) =>
            item.id === taskId ? { ...item, status: 'paused', message: '已暂停', updatedAt: new Date().toISOString() } : item,
          ),
        );
      }
      if (action === 'resume') {
        setTasks((current) =>
          current.map((item) =>
            item.id === taskId ? { ...item, status: 'downloading', message: '继续下载中', updatedAt: new Date().toISOString() } : item,
          ),
        );
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const clearFinished = () => {
    setTasks((current) => current.filter((task) => !['done', 'error', 'cancelled'].includes(task.status)));
  };

  const removeTask = (taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
  };

  const addHeader = () => {
    updateSetting('headers', [...settings.headers, { name: '', value: '' }]);
  };

  const updateHeader = (index: number, patch: Partial<DownloadHeaderInput>) => {
    updateSetting(
      'headers',
      settings.headers.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  };

  const removeHeader = (index: number) => {
    updateSetting(
      'headers',
      settings.headers.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="📥"
        title="多线程下载器"
        subtitle="独立下载管理，支持 HTTP/HLS/FTP/磁力/BT/Metalink"
        actions={
          <>
            <ToolbarButton onClick={() => void refreshRuntime()} disabled={checkingRuntime}>
              {checkingRuntime ? <Loader size={14} className="animate-spin" /> : <Gauge size={14} />}
              检测协议运行时
            </ToolbarButton>
            <ToolbarButton onClick={clearFinished} disabled={!tasks.some((task) => ['done', 'error', 'cancelled'].includes(task.status))}>
              <Trash2 size={14} />
              清理完成项
            </ToolbarButton>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[410px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <StatusMessage message={message} error={error} />

          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200">
            <div className="flex items-center gap-2 font-semibold">
              <Gauge size={15} />
              独立下载引擎
            </div>
            <p className="mt-1">
              HTTP/HTTPS 走内置多线程和断点续传；HLS/m3u8 走 FFmpeg；FTP、磁力/BT、Metalink 走 aria2c。
            </p>
            {runtime && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <span className={runtime.ffmpegInstalled ? 'text-green-700 dark:text-green-200' : 'text-amber-700 dark:text-amber-200'}>
                  FFmpeg：{runtime.ffmpegInstalled ? '已就绪' : '未检测到'}
                </span>
                <span className={runtime.aria2Installed ? 'text-green-700 dark:text-green-200' : 'text-amber-700 dark:text-amber-200'}>
                  aria2c：{runtime.aria2Installed ? '已就绪' : '未检测到'}
                </span>
              </div>
            )}
            {runtime?.message && <p className="mt-1 text-[11px] opacity-80">{runtime.message}</p>}
            {runtime && !runtime.aria2Installed && (
              <button
                onClick={() => setShowAria2Guide(true)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-900/50 dark:bg-gray-950 dark:text-amber-200 dark:hover:bg-amber-900/20"
              >
                <Terminal size={13} />
                查看 aria2c 安装方法
              </button>
            )}
          </div>

          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">下载链接</span>
              <textarea
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setProbeInfo(null);
                }}
                placeholder="粘贴一个或多个链接；支持 http/https、m3u8、ftp、magnet、torrent、metalink/meta4"
                className="mt-2 h-28 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              />
              <span className="mt-1 block text-xs text-gray-400">
                已识别 {inputUrls.length} 个链接；HTTP 文件类型不限，协议型任务会自动转交对应运行时。
              </span>
            </label>

            <label className="block">
              <span className="text-sm font-semibold">下载类型</span>
              <select
                value={downloadType}
                onChange={(event) => setDownloadType(event.target.value as DownloadType)}
                className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              >
                <option value="auto">自动判断</option>
                <option value="http">HTTP/HTTPS 多线程</option>
                <option value="hls">HLS / m3u8</option>
                <option value="aria2">Aria2 协议任务（FTP / 磁力 / BT / Metalink）</option>
              </select>
            </label>

            <div>
              <span className="text-sm font-semibold">保存目录</span>
              <div className="mt-2 flex gap-2">
                <input
                  value={settings.outputDir}
                  onChange={(event) => updateSetting('outputDir', event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                />
                <button
                  onClick={() => void chooseOutputDir()}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  <FolderOpen size={16} />
                  选择
                </button>
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-semibold">文件名</span>
              <input
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                disabled={isBatch}
                placeholder={isBatch ? '批量模式下逐个自动识别文件名' : '留空则自动从响应头或链接识别'}
                className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-semibold">线程数</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={settings.threadCount}
                  onChange={(event) => updateSetting('threadCount', Math.max(1, Math.min(16, Number(event.target.value) || 1)))}
                  className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>
              <label className="mt-7 flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm dark:border-gray-700">
                <input
                  type="checkbox"
                  checked={settings.overwrite}
                  onChange={(event) => updateSetting('overwrite', event.target.checked)}
                />
                同名文件直接覆盖
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => void probe()}
                disabled={probing || inputUrls.length === 0}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200"
              >
                {probing ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
                {isBatch ? '检测首个链接' : '检测链接'}
              </button>
              <button
                onClick={() => void start()}
                disabled={starting || inputUrls.length === 0}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {starting ? <Loader size={16} className="animate-spin" /> : <Download size={16} />}
                {isBatch ? `批量下载 ${inputUrls.length} 个` : '开始下载'}
              </button>
            </div>

            {probeInfo && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-5 dark:border-gray-700 dark:bg-gray-950">
                <div className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100">
                  {probeInfo.supportsRanges ? <CheckCircle size={15} className="text-green-600" /> : <AlertCircle size={15} className="text-amber-500" />}
                  {probeInfo.fileName}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-gray-500 dark:text-gray-400">
                  <span>大小：{probeInfo.totalSize ? formatBytes(probeInfo.totalSize) : '未知'}</span>
                  <span>多线程：{probeInfo.supportsRanges ? '支持' : '不支持'}</span>
                  <span>建议线程：{probeInfo.suggestedThreads}</span>
                  <span>类型：{probeInfo.contentType || '-'}</span>
                </div>
                <p className="mt-2 truncate text-gray-400">{probeInfo.finalUrl}</p>
              </div>
            )}

            <button
              onClick={() => setShowAdvanced((value) => !value)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline dark:text-blue-300"
            >
              <RotateCcw size={14} />
              {showAdvanced ? '收起高级请求设置' : '展开高级请求设置'}
            </button>

            {showAdvanced && (
              <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500">User-Agent</span>
                  <select
                    value={settings.userAgentPreset || 'custom'}
                    onChange={(event) => changeUserAgentPreset(event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
                  >
                    {USER_AGENT_PRESETS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={settings.userAgent}
                    onChange={(event) => {
                      updateSetting('userAgentPreset', 'custom');
                      updateSetting('userAgent', event.target.value);
                    }}
                    readOnly={settings.userAgentPreset !== 'custom'}
                    className="mt-1 h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500">Referer</span>
                  <input
                    value={settings.referer}
                    onChange={(event) => updateSetting('referer', event.target.value)}
                    placeholder="部分站点需要来源页"
                    className="mt-1 h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500">Cookie</span>
                    <button
                      onClick={() => void checkCookie()}
                      disabled={checkingCookie}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-300"
                    >
                      {checkingCookie ? <Loader size={12} className="animate-spin" /> : <Search size={12} />}
                      检测 Cookie
                    </button>
                  </div>
                  <select
                    value={settings.cookieMode}
                    onChange={(event) => {
                      const value = event.target.value as CookieMode;
                      updateSetting('cookieMode', value);
                      if (value !== 'none' && value !== 'manual') {
                        updateSetting('cookieBrowser', value as CookieBrowser);
                      }
                    }}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
                  >
                    {COOKIE_MODES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  {settings.cookieMode === 'manual' && (
                    <div className="mt-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs text-gray-400">自定义 Cookie</span>
                        <button
                          onClick={() => setShowCookie((value) => !value)}
                          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 dark:hover:text-blue-300"
                        >
                          {showCookie ? <EyeOff size={12} /> : <Eye size={12} />}
                          {showCookie ? '隐藏' : '显示'}
                        </button>
                      </div>
                      <textarea
                        value={settings.cookie}
                        onChange={(event) => updateSetting('cookie', event.target.value)}
                        placeholder="支持 Cookie: a=b; c=d 或直接 a=b; c=d"
                        className={`h-20 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-950 ${
                          showCookie ? 'font-mono' : 'text-transparent caret-gray-900 dark:caret-gray-100'
                        }`}
                      />
                    </div>
                  )}
                  <p className="mt-1 text-[11px] leading-5 text-gray-400">
                    自动读取会按当前下载链接域名匹配浏览器 Cookie；遇到 403、登录态下载或防盗链时可优先尝试。
                  </p>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500">自定义 Header</span>
                    <button onClick={addHeader} className="text-xs text-blue-600 hover:underline dark:text-blue-300">
                      添加
                    </button>
                  </div>
                  <div className="space-y-2">
                    {settings.headers.map((item, index) => (
                      <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <input
                          value={item.name}
                          onChange={(event) => updateHeader(index, { name: event.target.value })}
                          placeholder="Header 名称"
                          className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
                        />
                        <input
                          value={item.value}
                          onChange={(event) => updateHeader(index, { value: event.target.value })}
                          placeholder="Header 值"
                          className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
                        />
                        <button
                          onClick={() => removeHeader(index)}
                          className="h-9 rounded-lg border border-gray-200 px-2 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <div>
              <h2 className="text-sm font-semibold">下载任务</h2>
              <p className="text-xs text-gray-400">当前活动 {activeTasks} 个，历史最多保留 80 条</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock size={14} />
              断点续传会保留临时分片
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            {tasks.length === 0 ? (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 text-gray-400 dark:border-gray-700">
                <Download size={42} />
                <p className="mt-3 text-sm">暂无下载任务</p>
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              task.status === 'done'
                                ? 'bg-green-500'
                                : task.status === 'error'
                                  ? 'bg-red-500'
                                  : task.status === 'paused'
                                    ? 'bg-amber-500'
                                    : task.status === 'cancelled'
                                      ? 'bg-gray-400'
                                      : 'bg-blue-500'
                            }`}
                          />
                          <h3 className="truncate text-sm font-semibold">{task.fileName}</h3>
                        </div>
                        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{taskSubtitle(task)}</p>
                        <span className="mt-1 inline-flex rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          {typeLabel(task.downloadType)}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {task.status === 'downloading' && canPauseTask(task) && (
                          <button
                            onClick={() => void controlTask('pause', task.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                            title="暂停"
                          >
                            <Pause size={14} />
                          </button>
                        )}
                        {task.status === 'paused' && (
                          <button
                            onClick={() => void controlTask('resume', task.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                            title="继续"
                          >
                            <Play size={14} />
                          </button>
                        )}
                        {['downloading', 'paused', 'waiting'].includes(task.status) && (
                          <button
                            onClick={() => void controlTask('cancel', task.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20"
                            title="取消"
                          >
                            <Square size={14} />
                          </button>
                        )}
                        {task.outputPath && (
                          <button
                            onClick={() => invoke('open_path', { targetPath: task.outputPath })}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                            title="打开文件"
                          >
                            <FolderOpen size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => removeTask(task.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                          title="移除记录"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                      <div
                        className={`h-full rounded-full ${
                          task.status === 'error'
                            ? 'bg-red-500'
                            : task.status === 'done'
                              ? 'bg-green-500'
                              : task.status === 'paused'
                                ? 'bg-amber-500'
                                : 'bg-blue-600'
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, task.percent ?? 0))}%` }}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-gray-500 dark:text-gray-400 max-md:grid-cols-2">
                      <span>{(task.percent ?? 0).toFixed(1)}%</span>
                      <span>{formatBytes(task.downloaded || 0)} / {task.total ? formatBytes(task.total) : '未知'}</span>
                      <span>{task.speed || '-'}</span>
                      <span>剩余 {task.eta || '-'}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                      <Link size={12} />
                      <span className="truncate">{task.url}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {showAria2Guide && runtime && !runtime.aria2Installed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <div>
                <div className="flex items-center gap-2 text-base font-semibold">
                  <Terminal size={18} />
                  安装 aria2c
                </div>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  FTP、磁力/BT、torrent、Metalink/meta4 需要 aria2c。HTTP/HTTPS 和 HLS/m3u8 不受影响。
                </p>
              </div>
              <button
                onClick={() => setShowAria2Guide(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-100">
                安装后需要让 `aria2c.exe` 进入系统 PATH，或者使用 WinGet/Scoop/Chocolatey 这类包管理器自动配置。
              </div>

              <div className="grid gap-3">
                {ARIA2_INSTALL_METHODS.map((method) => (
                  <div key={method.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{method.label}</div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{method.note}</p>
                      </div>
                      <button
                        onClick={() => void copyInstallCommand(method.command)}
                        className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                      >
                        <Copy size={13} />
                        复制
                      </button>
                    </div>
                    <code className="mt-2 block overflow-x-auto rounded-md bg-gray-950 px-3 py-2 text-xs text-gray-100">
                      {method.command}
                    </code>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                <div className="font-semibold">手动安装</div>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  从 GitHub Releases 下载 Windows 版本，解压后把 `aria2c.exe` 所在目录加入 PATH，然后重新打开应用或点击重新检测。
                </p>
                <button
                  onClick={() => void openExternal(ARIA2_RELEASES_URL)}
                  className="mt-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  <ExternalLink size={13} />
                  打开下载页面
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
              <button
                onClick={() => void refreshRuntime()}
                disabled={checkingRuntime}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {checkingRuntime ? <Loader size={15} className="animate-spin" /> : <Gauge size={15} />}
                重新检测
              </button>
              <button
                onClick={() => setShowAria2Guide(false)}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                稍后处理
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
