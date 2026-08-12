import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  History,
  KeyRound,
  Loader,
  PlayCircle,
  Search,
  Settings,
  Square,
  Trash2,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { formatBytes, StatusMessage, ToolbarButton } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';
import {
  useToolDataStore,
  type TikHubDownloadHistoryItem,
  type TikHubDownloaderToolData,
} from '../stores/toolDataStore';

type TikHubPlatform =
  | 'auto'
  | 'douyin'
  | 'tiktok'
  | 'xiaohongshu'
  | 'kuaishou'
  | 'bilibili'
  | 'youtube'
  | 'toutiao'
  | 'weibo';
type TikHubTaskStatus = 'processing' | 'done' | 'error' | 'cancelled';

interface TikHubAccountStatus {
  ok: boolean;
  message: string;
  email?: string;
  balance?: number;
  freeCredit?: number;
  apiKeyName?: string;
  apiKeyStatus?: number;
}

interface TikHubVideoInfo {
  platform: string;
  videoId?: string;
  title: string;
  author?: string;
  cover?: string;
  downloadUrl: string;
  duration?: number;
  size?: number;
  sourceEndpoint: string;
  message?: string;
}

interface TikHubDownloadResult {
  taskId: string;
  outputPath: string;
}

interface TikHubDownloadProgress {
  taskId: string;
  status: TikHubTaskStatus;
  percent?: number;
  downloaded: number;
  total?: number;
  filename?: string;
  outputPath?: string;
  message?: string;
}

interface TikHubDownloadTask extends TikHubDownloadProgress {
  input: string;
  title: string;
  author?: string;
  platform: string;
  createdAt: number;
}

const DEFAULT_TIKHUB_DATA: Omit<TikHubDownloaderToolData, 'lastModified'> = {
  version: 'mcheng-tikhub-downloader-v1',
  apiKey: '',
  apiBase: 'https://api.tikhub.io',
  defaultPlatform: 'auto',
  defaultRegion: 'CN',
  outputDir: '',
  history: [],
};

const PLATFORM_OPTIONS: Array<{ value: TikHubPlatform; label: string }> = [
  { value: 'auto', label: '自动判断' },
  { value: 'douyin', label: '抖音' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'kuaishou', label: '快手' },
  { value: 'bilibili', label: 'B站' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'toutiao', label: '头条' },
  { value: 'weibo', label: '微博' },
];

async function tikhubCommand<T>(action: string, payload: Record<string, unknown> = {}) {
  const response = await invoke<string>('tikhub_download_command', {
    action,
    payload: JSON.stringify(payload),
  });
  return JSON.parse(response) as T;
}

function createTaskId() {
  return `tikhub-download-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return '-';
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function platformLabel(platform?: string) {
  if (platform === 'douyin') return '抖音';
  if (platform === 'tiktok') return 'TikTok';
  if (platform === 'xiaohongshu') return '小红书';
  if (platform === 'kuaishou') return '快手';
  if (platform === 'bilibili') return 'B站';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'toutiao') return '头条';
  if (platform === 'weibo') return '微博';
  return '自动';
}

function getErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function mergeSettings(saved?: TikHubDownloaderToolData): Omit<TikHubDownloaderToolData, 'lastModified'> {
  return {
    ...DEFAULT_TIKHUB_DATA,
    ...(saved || {}),
    history: saved?.history || [],
  };
}

export default function TikHubDownloaderTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateTikHubDownloaderData } = useToolDataStore();
  const [settings, setSettings] = useState<Omit<TikHubDownloaderToolData, 'lastModified'>>(DEFAULT_TIKHUB_DATA);
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [checkingAccount, setCheckingAccount] = useState(false);
  const [account, setAccount] = useState<TikHubAccountStatus | null>(null);
  const [probing, setProbing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [video, setVideo] = useState<TikHubVideoInfo | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [tasks, setTasks] = useState<TikHubDownloadTask[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const settingsRef = useRef(settings);
  const restoredPersistedDataRef = useRef(false);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!loaded) {
      void loadData();
    }
  }, [loaded, loadData]);

  useEffect(() => {
    if (!loaded) return;
    if (restoredPersistedDataRef.current) return;
    restoredPersistedDataRef.current = true;
    const next = mergeSettings(data.tikhubDownloader);
    setSettings(next);
    if (!next.outputDir) {
      tikhubCommand<string>('defaultDir')
        .then((dir) => {
          setSettings((current) => ({ ...current, outputDir: dir }));
        })
        .catch(() => undefined);
    }
  }, [data.tikhubDownloader, loaded]);

  useEffect(() => {
    if (!loaded || !restoredPersistedDataRef.current) return;
    const timer = window.setTimeout(() => {
      updateTikHubDownloaderData(settings);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loaded, settings, updateTikHubDownloaderData]);

  const saveHistoryItem = useCallback(
    (item: TikHubDownloadHistoryItem) => {
      setSettings((current) => {
        const history = [item, ...current.history.filter((record) => record.id !== item.id)].slice(0, 30);
        return { ...current, history };
      });
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    listen<TikHubDownloadProgress>('tikhub-download-progress', (event) => {
      if (!mounted) return;
      const progress = event.payload;
      setTasks((current) => {
        const next = current.map((task) => {
          if (task.taskId !== progress.taskId) return task;
          const updated: TikHubDownloadTask = {
            ...task,
            ...progress,
            percent: progress.percent ?? task.percent,
            filename: progress.filename ?? task.filename,
            outputPath: progress.outputPath ?? task.outputPath,
            total: progress.total ?? task.total,
          };
          return updated;
        });
        const completedTask = next.find(
          (task) => task.taskId === progress.taskId && task.status === 'done',
        );
        if (completedTask) {
          saveHistoryItem({
            id: completedTask.taskId,
            platform: completedTask.platform,
            title: completedTask.title,
            author: completedTask.author,
            input: completedTask.input,
            outputPath: completedTask.outputPath,
            createdAt: new Date().toISOString(),
          });
        }
        return next;
      });
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    return () => {
      mounted = false;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [saveHistoryItem]);

  const requestPayload = useMemo(
    () => ({
      apiKey: settings.apiKey.trim(),
      apiBase: settings.apiBase.trim(),
      platform: settings.defaultPlatform,
      region: settings.defaultRegion.trim() || 'CN',
      outputDir: settings.outputDir,
    }),
    [settings],
  );

  const hasApiKey = !!settings.apiKey.trim();
  const canProbe = !!input.trim() && hasApiKey && !probing;
  const canDownload = !!input.trim() && hasApiKey && !downloading;

  const updateSetting = <K extends keyof Omit<TikHubDownloaderToolData, 'lastModified'>>(
    key: K,
    value: Omit<TikHubDownloaderToolData, 'lastModified'>[K],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const chooseOutputDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') {
      updateSetting('outputDir', selected);
    }
  };

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setMessage('已复制到剪贴板');
  };

  const checkAccount = async () => {
    if (!hasApiKey) {
      setError('请先在设置中填写 TikHub API Key');
      setShowSettings(true);
      return;
    }
    setCheckingAccount(true);
    setError('');
    setMessage('');
    try {
      const result = await tikhubCommand<TikHubAccountStatus>('account', requestPayload);
      setAccount(result);
      setMessage(result.message || 'TikHub API Key 可用');
    } catch (err) {
      setAccount(null);
      setError(getErrorText(err));
    } finally {
      setCheckingAccount(false);
    }
  };

  const probe = async () => {
    if (!input.trim()) {
      setError('请先粘贴抖音或 TikTok 链接 / 作品 ID');
      return;
    }
    if (!hasApiKey) {
      setError('请先在设置中填写 TikHub API Key');
      setShowSettings(true);
      return;
    }
    setProbing(true);
    setError('');
    setMessage('');
    try {
      const result = await tikhubCommand<TikHubVideoInfo>('probe', {
        ...requestPayload,
        input: input.trim(),
      });
      setVideo(result);
      setPreviewError('');
      setMessage(result.message || '已解析视频信息');
    } catch (err) {
      setError(getErrorText(err));
    } finally {
      setProbing(false);
    }
  };

  const startDownload = async () => {
    if (!input.trim()) {
      setError('请先粘贴抖音或 TikTok 链接 / 作品 ID');
      return;
    }
    if (!hasApiKey) {
      setError('请先在设置中填写 TikHub API Key');
      setShowSettings(true);
      return;
    }
    const taskId = createTaskId();
    const task: TikHubDownloadTask = {
      taskId,
      input: input.trim(),
      title: video?.title || input.trim(),
      author: video?.author,
      platform: video?.platform || settings.defaultPlatform,
      createdAt: Date.now(),
      status: 'processing',
      percent: 0,
      downloaded: 0,
      total: video?.size,
      outputPath: undefined,
      message: '等待启动',
    };
    setTasks((current) => [task, ...current].slice(0, 20));
    setDownloading(true);
    setError('');
    setMessage('');
    try {
      const result = await tikhubCommand<TikHubDownloadResult>('start', {
        ...requestPayload,
        taskId,
        input: input.trim(),
        resolvedUrl: video?.downloadUrl,
        title: video?.title,
        author: video?.author,
        videoId: video?.videoId,
        platform: video?.platform || settings.defaultPlatform,
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
      setMessage('下载已启动，可在右侧查看进度');
    } catch (err) {
      const text = getErrorText(err);
      setError(text);
      setTasks((current) =>
        current.map((item) =>
          item.taskId === taskId
            ? {
                ...item,
                status: 'error',
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
    await tikhubCommand('cancel', { taskId }).catch((err) => setError(getErrorText(err)));
  };

  const clearHistory = () => {
    updateSetting('history', []);
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="⚡"
        title="TikHub 下载"
        subtitle="TikHub 多平台原生接口解析下载"
        actions={
          <>
            <ToolbarButton onClick={() => setShowSettings((value) => !value)}>
              <Settings size={14} />
              设置
            </ToolbarButton>
            <ToolbarButton onClick={() => void checkAccount()} disabled={checkingAccount}>
              {checkingAccount ? <Loader size={14} className="animate-spin" /> : <KeyRound size={14} />}
              检测密钥
            </ToolbarButton>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[400px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <StatusMessage message={message} error={error} />

          {!hasApiKey && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle size={16} />
                需要配置 TikHub API Key
              </div>
              <p className="mt-1 text-xs leading-5">点击右上角设置，填写 TikHub 的 API Key 后再解析和下载。</p>
            </div>
          )}

          {account && (
            <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle size={16} />
                {account.message || 'TikHub API Key 可用'}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <span className="truncate">账户：{account.email || '-'}</span>
                <span>余额：{account.balance ?? '-'}</span>
                <span>赠送额度：{account.freeCredit ?? '-'}</span>
                <span>Key：{account.apiKeyName || '-'}</span>
              </div>
            </div>
          )}

          {showSettings && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">TikHub 设置</h2>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  收起
                </button>
              </div>
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">API Key</span>
                  <div className="mt-1 flex gap-2">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={settings.apiKey}
                      onChange={(event) => updateSetting('apiKey', event.target.value)}
                      placeholder="填写 TikHub API Key"
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                    />
                    <button
                      onClick={() => setShowApiKey((value) => !value)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                      title={showApiKey ? '隐藏密钥' : '显示密钥'}
                    >
                      {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">接口地址</span>
                  <input
                    value={settings.apiBase}
                    onChange={(event) => updateSetting('apiBase', event.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">链接 / 作品 ID</span>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="粘贴抖音 / TikTok / 小红书 / 快手 / B站 / YouTube / 头条 / 微博链接，或输入作品 ID"
                className="mt-2 h-28 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-semibold">平台</span>
                <select
                  value={settings.defaultPlatform}
                  onChange={(event) => updateSetting('defaultPlatform', event.target.value as TikHubPlatform)}
                  className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                >
                  {PLATFORM_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-semibold">地区</span>
                <input
                  value={settings.defaultRegion}
                  onChange={(event) => updateSetting('defaultRegion', event.target.value.toUpperCase())}
                  className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>
            </div>

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

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => void probe()}
                disabled={!canProbe}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200"
              >
                {probing ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
                解析信息
              </button>
              <button
                onClick={() => void startDownload()}
                disabled={!canDownload}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Download size={16} />
                开始下载
              </button>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-5 text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              TikHub 下载是独立工具，只调用 TikHub 官方接口；通用网页视频下载仍在“视频下载”工具里使用 yt-dlp。
            </div>
          </div>
        </section>

        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          {video ? (
            <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
                <div className="relative bg-black">
                  <video
                    key={video.downloadUrl}
                    src={video.downloadUrl}
                    poster={video.cover}
                    controls
                    preload="metadata"
                    playsInline
                    className="aspect-video w-full bg-black object-contain"
                    onError={() => {
                      setPreviewError('当前直链无法在内置窗口直接预览，可下载后播放或复制直链到浏览器打开。');
                    }}
                    onCanPlay={() => setPreviewError('')}
                  />
                  {previewError && (
                    <div className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-xs leading-5 text-white">
                      {previewError}
                    </div>
                  )}
                </div>
                <div className="space-y-2 p-3">
                  <h2 className="line-clamp-3 text-base font-semibold">{video.title}</h2>
                  <p className="text-sm text-gray-500">{video.author || platformLabel(video.platform)}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                    <div>平台：{platformLabel(video.platform)}</div>
                    <div>时长：{formatDuration(video.duration)}</div>
                    <div>大小：{video.size ? formatBytes(video.size) : '-'}</div>
                    <div className="truncate">ID：{video.videoId || '-'}</div>
                  </div>
                </div>
              </div>

              <div className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">解析结果</h3>
                  <button
                    onClick={() => void copyText(video.downloadUrl)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2 text-xs hover:bg-white dark:border-gray-700 dark:hover:bg-gray-900"
                  >
                    <Copy size={13} />
                    复制直链
                  </button>
                </div>
                <div className="mt-3 space-y-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">接口</div>
                    <div className="mt-1 break-all font-mono text-xs">{video.sourceEndpoint}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">下载地址</div>
                    <div className="mt-1 max-h-28 overflow-auto break-all rounded border border-gray-200 bg-white p-2 font-mono text-xs dark:border-gray-800 dark:bg-gray-900">
                      {video.downloadUrl}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 text-gray-400 dark:border-gray-800">
              <PlayCircle size={42} />
              <p className="mt-2 text-sm">粘贴链接后点击解析，视频信息会显示在这里</p>
            </div>
          )}

          <div className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">下载任务</h3>
              {tasks.length > 0 && (
                <button onClick={() => setTasks([])} className="text-xs text-gray-500 hover:text-red-500">
                  清空任务
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
                          <span>{platformLabel(task.platform)}</span>
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
                      <span className="min-w-0 truncate">
                        {task.message || task.filename || task.outputPath || task.status}
                      </span>
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

          <div className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
                <History size={15} />
                下载历史
              </h3>
              {settings.history.length > 0 && (
                <button onClick={clearHistory} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-500">
                  <Trash2 size={12} />
                  清空历史
                </button>
              )}
            </div>
            <div className="mt-2 space-y-2">
              {settings.history.length ? (
                settings.history.map((record) => (
                  <div key={record.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{record.title}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                          <span>{platformLabel(record.platform)}</span>
                          {record.author && <span>{record.author}</span>}
                          <span>{new Date(record.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                      {record.outputPath && (
                        <button
                          onClick={() => invoke('show_in_folder', { path: record.outputPath })}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                        >
                          <FolderOpen size={12} />
                          位置
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400 dark:border-gray-800">
                  下载完成后会记录到这里
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
