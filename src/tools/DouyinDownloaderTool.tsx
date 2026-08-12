import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/dialog';
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Info,
  Loader,
  PlayCircle,
  Search,
  Square,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { formatBytes, StatusMessage, ToolbarButton } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';
import { useToolDataStore, type DouyinDownloaderToolData } from '../stores/toolDataStore';

type DownloadStatus = 'processing' | 'done' | 'error' | 'cancelled';
type CookieMode = DouyinDownloaderToolData['cookieMode'];
type CookieBrowser = DouyinDownloaderToolData['cookieBrowser'];

interface DouyinDownloadSource {
  id: string;
  label: string;
  url: string;
  previewUrl?: string;
  size?: number;
  width?: number;
  height?: number;
  quality?: string;
  codec?: string;
  bitrate?: number;
  sourceType: string;
  note: string;
}

interface DouyinVideoInfo {
  videoId: string;
  title: string;
  author?: string;
  cover?: string;
  duration?: number;
  width?: number;
  height?: number;
  shareUrl: string;
  sources: DouyinDownloadSource[];
  message?: string;
}

interface DouyinDownloadResult {
  taskId: string;
  outputPath: string;
}

interface DouyinDownloadProgress {
  taskId: string;
  status: DownloadStatus;
  percent?: number;
  downloaded: number;
  total?: number;
  filename?: string;
  outputPath?: string;
  message?: string;
}

interface DownloadTask extends DouyinDownloadProgress {
  title: string;
  sourceLabel: string;
  createdAt: number;
}

interface DouyinCookieProbeResult {
  browser: string;
  found: boolean;
  count: number;
  message: string;
}

const DEFAULT_DOUYIN_SETTINGS: Omit<DouyinDownloaderToolData, 'lastModified'> = {
  version: 'mcheng-douyin-downloader-v1',
  cookieMode: 'none',
  cookieBrowser: 'chrome',
  manualCookie: '',
  outputDir: '',
};

const COOKIE_MODES: Array<{ value: CookieMode; label: string }> = [
  { value: 'none', label: '不读取 Cookie' },
  { value: 'chrome', label: 'Chrome 自动读取' },
  { value: 'edge', label: 'Edge 自动读取' },
  { value: 'brave', label: 'Brave 自动读取' },
  { value: 'vivaldi', label: 'Vivaldi 自动读取' },
  { value: 'opera', label: 'Opera 自动读取' },
  { value: 'manual', label: '手动 Cookie' },
];

async function douyinCommand<T>(action: string, payload: Record<string, unknown> = {}) {
  const response = await invoke<string>('douyin_download_command', {
    action,
    payload: JSON.stringify(payload),
  });
  return JSON.parse(response) as T;
}

function createTaskId() {
  return `douyin-download-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return '-';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function taskMessage(task: DownloadTask) {
  return task.message || task.filename || task.outputPath || task.status;
}

function formatBitrate(value?: number) {
  if (!value) return '';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} Mbps`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} Kbps`;
  return `${value} bps`;
}

function sourceBadge(source: DouyinDownloadSource) {
  return source.sourceType === 'quality' ? '清晰度' : '播放源';
}

export default function DouyinDownloaderTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateDouyinDownloaderData } = useToolDataStore();
  const [input, setInput] = useState('');
  const [settings, setSettings] =
    useState<Omit<DouyinDownloaderToolData, 'lastModified'>>(DEFAULT_DOUYIN_SETTINGS);
  const [info, setInfo] = useState<DouyinVideoInfo | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [probing, setProbing] = useState(false);
  const [checkingCookie, setCheckingCookie] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showCookie, setShowCookie] = useState(false);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const restoredPersistedDataRef = useRef(false);

  useEffect(() => {
    if (!loaded) {
      void loadData();
    }
  }, [loaded, loadData]);

  useEffect(() => {
    if (!loaded || restoredPersistedDataRef.current) return;
    restoredPersistedDataRef.current = true;
    const next = {
      ...DEFAULT_DOUYIN_SETTINGS,
      ...(data.douyinDownloader || {}),
    };
    setSettings(next);
    if (!next.outputDir) {
      douyinCommand<string>('defaultDir')
        .then((dir) => {
          setSettings((current) => ({ ...current, outputDir: dir }));
        })
        .catch(() => undefined);
    }
  }, [data.douyinDownloader, loaded]);

  useEffect(() => {
    if (!loaded || !restoredPersistedDataRef.current) return;
    const timer = window.setTimeout(() => {
      updateDouyinDownloaderData(settings);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loaded, settings, updateDouyinDownloaderData]);

  useEffect(() => {
    let mounted = true;
    listen<DouyinDownloadProgress>('douyin-download-progress', (event) => {
      if (!mounted) return;
      const progress = event.payload;
      setTasks((current) =>
        current.map((task) =>
          task.taskId === progress.taskId
            ? {
                ...task,
                ...progress,
                percent: progress.percent ?? task.percent,
                filename: progress.filename ?? task.filename,
                outputPath: progress.outputPath ?? task.outputPath,
                message: progress.message ?? task.message,
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

  const selectedSource = useMemo(() => {
    if (!info) return null;
    return info.sources.find((item) => item.id === selectedSourceId) || info.sources[0] || null;
  }, [info, selectedSourceId]);

  const updateSetting = <K extends keyof Omit<DouyinDownloaderToolData, 'lastModified'>>(
    key: K,
    value: Omit<DouyinDownloaderToolData, 'lastModified'>[K],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const cookiePayload = () => ({
    cookieMode: settings.cookieMode,
    cookieBrowser: settings.cookieBrowser,
    manualCookie: settings.cookieMode === 'manual' ? settings.manualCookie : undefined,
  });

  const probe = async () => {
    if (!input.trim()) {
      setError('请先粘贴抖音分享链接或分享文案');
      return;
    }
    setProbing(true);
    setError('');
    setMessage('');
    try {
      const result = await douyinCommand<DouyinVideoInfo>('probe', {
        input,
        ...cookiePayload(),
      });
      setInfo(result);
      setSelectedSourceId(result.sources[0]?.id || '');
      setMessage(result.message || '已解析抖音视频');
    } catch (err) {
      setInfo(null);
      setError(String(err));
    } finally {
      setProbing(false);
    }
  };

  const chooseOutputDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') {
      updateSetting('outputDir', selected);
    }
  };

  const checkCookie = async () => {
    if (settings.cookieMode === 'manual') {
      setMessage(settings.manualCookie.trim() ? '手动 Cookie 已填写。' : '手动 Cookie 为空。');
      return;
    }
    if (settings.cookieMode === 'none') {
      setMessage('当前设置为不读取 Cookie。');
      return;
    }
    setCheckingCookie(true);
    setError('');
    setMessage('');
    try {
      const result = await douyinCommand<DouyinCookieProbeResult>('probeCookie', {
        cookieBrowser: settings.cookieMode,
      });
      setMessage(result.message);
    } catch (err) {
      setError(String(err));
    } finally {
      setCheckingCookie(false);
    }
  };

  const startDownload = async () => {
    if (!input.trim()) {
      setError('请先粘贴抖音分享链接或分享文案');
      return;
    }
    if (!selectedSource) {
      setError('请先解析并选择下载版本');
      return;
    }
    const taskId = createTaskId();
    const task: DownloadTask = {
      taskId,
      title: info?.title || '抖音视频',
      sourceLabel: selectedSource.label,
      createdAt: Date.now(),
      status: 'processing',
      percent: 0,
      downloaded: 0,
      total: selectedSource.size,
      message: '等待启动',
    };
    setTasks((current) => [task, ...current].slice(0, 20));
    setDownloading(true);
    setError('');
    setMessage('');
    try {
      const result = await douyinCommand<DouyinDownloadResult>('start', {
        input,
        outputDir: settings.outputDir,
        selectedSourceId: selectedSource.id,
        selectedSourceLabel: selectedSource.label,
        resolvedUrl: selectedSource.url,
        title: info?.title,
        author: info?.author,
        videoId: info?.videoId,
        shareUrl: info?.shareUrl,
        ...cookiePayload(),
      });
      setTasks((current) =>
        current.map((item) =>
          item.taskId === taskId
            ? {
                ...item,
                taskId: result.taskId || item.taskId,
                outputPath: result.outputPath || item.outputPath,
                message: '下载已启动',
              }
            : item,
        ),
      );
      setMessage('下载已启动，可在任务列表查看进度');
    } catch (err) {
      const text = String(err);
      setError(text);
      setTasks((current) =>
        current.map((item) =>
          item.taskId === taskId
            ? {
                ...item,
                status: text.includes('下载已取消') ? 'cancelled' : 'error',
                message: text,
              }
            : item,
        ),
      );
    } finally {
      setDownloading(false);
    }
  };

  const cancelTask = async (taskId: string) => {
    await douyinCommand('cancel', { taskId }).catch((err) => setError(String(err)));
  };

  const copySource = async () => {
    if (!selectedSource) return;
    await navigator.clipboard.writeText(selectedSource.previewUrl || selectedSource.url);
    setMessage('已复制当前下载地址');
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🎵"
        title="抖音下载"
        subtitle="自研解析抖音公开分享页，支持两种播放版本下载"
        actions={
          <ToolbarButton onClick={() => void probe()} disabled={probing}>
            {probing ? <Loader size={14} className="animate-spin" /> : <Search size={14} />}
            解析
          </ToolbarButton>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[390px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <StatusMessage message={message} error={error} />

          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">抖音分享链接 / 文案</span>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="粘贴整段分享文案，例如：2.30 oda:/ ... https://v.douyin.com/xxx/ 复制此链接..."
                className="mt-2 h-36 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              />
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

            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Cookie</span>
                <button
                  onClick={() => void checkCookie()}
                  disabled={checkingCookie}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-2 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  {checkingCookie ? <Loader size={13} className="animate-spin" /> : <Search size={13} />}
                  检测
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
                className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              >
                {COOKIE_MODES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              {settings.cookieMode === 'manual' && (
                <label className="mt-3 block">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">手动 Cookie</span>
                    <button
                      type="button"
                      onClick={() => setShowCookie((value) => !value)}
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600"
                    >
                      {showCookie ? <EyeOff size={12} /> : <Eye size={12} />}
                      {showCookie ? '隐藏' : '显示'}
                    </button>
                  </div>
                  <textarea
                    value={settings.manualCookie}
                    onChange={(event) => updateSetting('manualCookie', event.target.value)}
                    placeholder="从浏览器开发者工具复制 Cookie 请求头，例如：sessionid=...; passport_csrf_token=..."
                    className={`h-24 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 ${
                      showCookie ? 'font-mono' : 'text-transparent caret-gray-900 dark:caret-gray-100'
                    }`}
                  />
                </label>
              )}
              <p className="mt-2 text-xs leading-5 text-gray-500">
                普通公开视频不一定需要 Cookie；遇到 403、卡顿或无法读取时，优先选择已登录抖音的浏览器自动读取，失败再粘贴手动 Cookie。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => void probe()}
                disabled={probing}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200"
              >
                {probing ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
                解析信息
              </button>
              <button
                onClick={() => void startDownload()}
                disabled={!selectedSource || downloading}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Download size={16} />
                开始下载
              </button>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-5 text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              <div className="flex items-center gap-1.5 font-semibold">
                <Info size={14} />
                说明
              </div>
              <p className="mt-1">
                这个工具只解析抖音公开分享页，不使用 TikHub 或 yt-dlp。抖音页面结构和播放地址可能变化，失败时会显示具体阶段。
              </p>
            </div>
          </div>
        </section>

        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          {info ? (
            <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
                {selectedSource ? (
                  <div className="flex justify-center bg-black p-3">
                    <video
                      src={selectedSource.previewUrl || selectedSource.url}
                      poster={info.cover}
                      controls
                      playsInline
                      preload="metadata"
                      className="aspect-[9/16] max-h-[560px] w-full max-w-[340px] rounded bg-black object-contain"
                    />
                  </div>
                ) : info.cover ? (
                  <div className="flex justify-center bg-black p-3">
                    <img
                      src={info.cover}
                      alt=""
                      className="aspect-[9/16] max-h-[560px] w-full max-w-[340px] rounded object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex justify-center bg-black p-3">
                    <div className="flex aspect-[9/16] max-h-[560px] w-full max-w-[340px] items-center justify-center rounded bg-gray-950 text-gray-400">
                    <PlayCircle size={42} />
                    </div>
                  </div>
                )}
                <div className="space-y-2 p-3">
                  <h2 className="line-clamp-3 text-base font-semibold">{info.title}</h2>
                  <p className="text-sm text-gray-500">{info.author || '未知作者'}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                    <div>ID：{info.videoId}</div>
                    <div>时长：{formatDuration(info.duration)}</div>
                    <div>
                      尺寸：{info.width && info.height ? `${info.width}x${info.height}` : '-'}
                    </div>
                    <div>版本：{info.sources.length}</div>
                  </div>
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">下载版本</h3>
                  {selectedSource && (
                    <button
                      onClick={() => void copySource()}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-300"
                    >
                      <Copy size={12} />
                      复制地址
                    </button>
                  )}
                </div>
                <div className="mt-2 grid gap-2">
                  {info.sources.map((source) => (
                    <button
                      key={source.id}
                      onClick={() => setSelectedSourceId(source.id)}
                      className={`rounded-lg border p-3 text-left text-sm ${
                        selectedSource?.id === source.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold">{source.label}</span>
                        <span className="shrink-0 text-xs text-gray-500">{source.size ? formatBytes(source.size) : '-'}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                          {sourceBadge(source)}
                        </span>
                        {source.quality && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                            {source.quality}
                          </span>
                        )}
                        {source.codec && (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                            {source.codec}
                          </span>
                        )}
                        {formatBitrate(source.bitrate) && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                            {formatBitrate(source.bitrate)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-gray-500">{source.note}</div>
                    </button>
                  ))}
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">下载任务</h3>
                    {tasks.length > 0 && (
                      <button onClick={() => setTasks([])} className="text-xs text-gray-500 hover:text-red-500">
                        清空记录
                      </button>
                    )}
                  </div>
                  <div className="mt-2 space-y-2">
                    {tasks.length ? (
                      tasks.map((task) => (
                        <div key={task.taskId} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{task.title}</div>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                                <span>{task.sourceLabel}</span>
                                <span>{formatBytes(task.downloaded)}</span>
                                {task.total ? <span>/ {formatBytes(task.total)}</span> : null}
                              </div>
                            </div>
                            {task.status === 'processing' ? (
                              <button
                                onClick={() => void cancelTask(task.taskId)}
                                className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-red-200 px-2 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-900/20"
                              >
                                <Square size={12} />
                                取消
                              </button>
                            ) : task.status === 'done' ? (
                              <CheckCircle size={18} className="text-green-500" />
                            ) : (
                              <AlertCircle size={18} className="text-red-500" />
                            )}
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                            <div
                              className={`h-full rounded-full ${
                                task.status === 'error'
                                  ? 'bg-red-500'
                                  : task.status === 'cancelled'
                                    ? 'bg-gray-400'
                                    : 'bg-blue-600'
                              }`}
                              style={{ width: `${Math.max(0, Math.min(task.percent ?? 0, 100))}%` }}
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                            <span className="min-w-0 truncate">{taskMessage(task)}</span>
                            {task.outputPath && (
                              <button
                                onClick={() => invoke('show_in_folder', { path: task.outputPath })}
                                className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-300"
                              >
                                <FolderOpen size={12} />
                                打开位置
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400 dark:border-gray-800">
                        暂无下载任务
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 text-gray-400 dark:border-gray-800">
              <PlayCircle size={42} />
              <p className="mt-2 text-sm">粘贴抖音分享内容后点击解析，视频信息会显示在这里</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
