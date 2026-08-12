import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/dialog';
import {
  AlertCircle,
  CheckCircle,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileAudio,
  FileText,
  FolderOpen,
  Info,
  Loader,
  PlayCircle,
  RefreshCw,
  Search,
  Square,
  Video,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { formatBytes, StatusMessage, ToolbarButton } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';

interface YtDlpStatus {
  installed: boolean;
  version?: string;
  path?: string;
  ffmpegInstalled: boolean;
  ffmpegPath?: string;
  installDir: string;
  downloadUrl: string;
  message: string;
}

interface YtDlpUpdateStatus {
  currentVersion?: string;
  latestVersion?: string;
  hasUpdate: boolean;
  updateCommands: string[];
  message: string;
}

interface VideoDownloadFormat {
  formatId: string;
  ext: string;
  resolution: string;
  formatNote: string;
  filesize?: number;
  fps?: number;
  vcodec: string;
  acodec: string;
}

interface VideoDownloadInfo {
  title: string;
  webpageUrl: string;
  originalUrl: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  extractor?: string;
  isPlaylist: boolean;
  entryCount: number;
  formats: VideoDownloadFormat[];
}

interface VideoDownloadProgress {
  taskId: string;
  status: 'processing' | 'done' | 'error' | 'cancelled';
  percent?: number;
  speed?: string;
  eta?: string;
  filename?: string;
  outputPath?: string;
  message?: string;
}

interface DownloadTask extends VideoDownloadProgress {
  url: string;
  title: string;
  mode: DownloadMode;
  createdAt: number;
  error?: string;
  fileSize?: number;
}

type DownloadMode = 'video' | 'audio' | 'subtitles';

const COOKIE_BROWSERS = [
  { value: 'none', label: '不读取 Cookie' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'edge', label: 'Edge' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'brave', label: 'Brave' },
  { value: 'opera', label: 'Opera' },
  { value: 'vivaldi', label: 'Vivaldi' },
  { value: 'custom', label: '自定义 Cookie' },
];

const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'wav', 'flac'];

async function videoDownloadCommand<T>(action: string, payload: Record<string, unknown> = {}) {
  const response = await invoke<string>('video_download_command', {
    action,
    payload: JSON.stringify(payload),
  });
  return JSON.parse(response) as T;
}

function createTaskId() {
  return `video-download-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function formatFormat(item: VideoDownloadFormat) {
  const parts = [item.formatId, item.ext, item.resolution, item.formatNote]
    .map((value) => value?.trim())
    .filter(Boolean);
  return parts.join(' · ');
}

function isUsefulVideoFormat(item: VideoDownloadFormat) {
  return item.vcodec && item.vcodec !== 'none';
}

function isYtDlpWarning(value?: string) {
  return value?.trimStart().startsWith('WARNING:') ?? false;
}

function taskDisplayMessage(task: DownloadTask) {
  for (const value of [task.message, task.filename, task.outputPath, task.error, task.status]) {
    if (typeof value === 'string' && value.trim() && !isYtDlpWarning(value)) {
      return value;
    }
  }
  return task.status;
}

export default function VideoDownloaderTool() {
  const ready = useToolTheme();
  const [runtime, setRuntime] = useState<YtDlpStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<YtDlpUpdateStatus | null>(null);
  const [url, setUrl] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [mode, setMode] = useState<DownloadMode>('video');
  const [cookieBrowser, setCookieBrowser] = useState('none');
  const [customCookie, setCustomCookie] = useState('');
  const [showCookie, setShowCookie] = useState(false);
  const [includePlaylist, setIncludePlaylist] = useState(false);
  const [mergeMp4, setMergeMp4] = useState(true);
  const [audioFormat, setAudioFormat] = useState('mp3');
  const [subtitleLangs, setSubtitleLangs] = useState('zh.*,en.*');
  const [selectedFormat, setSelectedFormat] = useState('');
  const [probing, setProbing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [info, setInfo] = useState<VideoDownloadInfo | null>(null);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const refreshRuntime = useCallback(async () => {
    setChecking(true);
    try {
      const status = await videoDownloadCommand<YtDlpStatus>('check');
      setRuntime(status);
    } catch (err) {
      setError(String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  const checkRuntimeUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    setError('');
    setMessage('正在检测 yt-dlp 是否有新版本...');
    try {
      const result = await videoDownloadCommand<YtDlpUpdateStatus>('checkUpdate');
      setUpdateStatus(result);
      setMessage(result.message);
    } catch (err) {
      setError(String(err));
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  useEffect(() => {
    void refreshRuntime();
    videoDownloadCommand<string>('defaultDir')
      .then(setOutputDir)
      .catch(() => undefined);
  }, [refreshRuntime]);

  useEffect(() => {
    let mounted = true;
    listen<VideoDownloadProgress>('video-download-progress', (event) => {
      if (!mounted) return;
      const progress = event.payload;
      setTasks((current) =>
        current.map((task) =>
          task.taskId === progress.taskId
              ? {
                ...task,
                ...progress,
                percent: progress.percent ?? task.percent,
                outputPath: progress.outputPath ?? task.outputPath,
                filename: progress.filename ?? task.filename,
                message: isYtDlpWarning(progress.message) ? task.message : progress.message ?? task.message,
                error: progress.status === 'error' && !isYtDlpWarning(progress.message) ? progress.message || task.error : task.error,
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

  const videoFormats = useMemo(() => {
    if (!info) return [];
    return info.formats.filter(isUsefulVideoFormat);
  }, [info]);

  const probe = async () => {
    if (!url.trim()) {
      setError('请先粘贴视频链接');
      return;
    }
    if (!runtime?.installed) {
      setError('请先准备 yt-dlp 运行时');
      return;
    }
    if (cookieBrowser === 'custom' && !customCookie.trim()) {
      setError('请填写自定义 Cookie，或把 Cookie 改为 Chrome / Edge / 不读取 Cookie。');
      return;
    }
    setProbing(true);
    setError('');
    setMessage('');
    try {
      const result = await videoDownloadCommand<VideoDownloadInfo>('probe', {
          url,
          playlist: includePlaylist,
          cookiesBrowser: cookieBrowser === 'none' || cookieBrowser === 'custom' ? undefined : cookieBrowser,
          cookiesText: cookieBrowser === 'custom' ? customCookie : undefined,
      });
      setInfo(result);
      setSelectedFormat('');
      setMessage(result.isPlaylist ? `已解析播放列表，共 ${result.entryCount} 项` : '已解析视频信息');
    } catch (err) {
      setError(String(err));
      setInfo(null);
    } finally {
      setProbing(false);
    }
  };

  const chooseOutputDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') {
      setOutputDir(selected);
    }
  };

  const startDownload = async () => {
    if (!url.trim()) {
      setError('请先粘贴视频链接');
      return;
    }
    if (!runtime?.installed) {
      setError('请先准备 yt-dlp 运行时');
      return;
    }
    if (cookieBrowser === 'custom' && !customCookie.trim()) {
      setError('请填写自定义 Cookie，或把 Cookie 改为 Chrome / Edge / 不读取 Cookie。');
      return;
    }
    const taskId = createTaskId();
    const title = info?.title || url.trim();
    const task: DownloadTask = {
      taskId,
      url: url.trim(),
      title,
      mode,
      createdAt: Date.now(),
      status: 'processing',
      percent: 0,
      message: '等待启动',
    };
    setTasks((current) => [task, ...current].slice(0, 20));
    setDownloading(true);
    setError('');
    setMessage('');
    try {
      const result = await videoDownloadCommand<{ taskId: string; outputPath?: string; fileSize?: number }>('start', {
          taskId,
          url,
          outputDir,
          mode,
          formatId: selectedFormat || undefined,
          audioFormat,
          subtitleLangs,
          cookiesBrowser: cookieBrowser === 'none' || cookieBrowser === 'custom' ? undefined : cookieBrowser,
          cookiesText: cookieBrowser === 'custom' ? customCookie : undefined,
          playlist: includePlaylist,
          mergeMp4,
      });
      setTasks((current) =>
        current.map((item) =>
          item.taskId === taskId
            ? {
                ...item,
                taskId: result.taskId || item.taskId,
                message: '下载已启动',
              }
            : item,
        ),
      );
      setMessage('下载已启动，可在右侧查看进度');
    } catch (err) {
      const text = String(err);
      if (text.includes('下载已取消')) {
        setMessage('下载已取消');
      } else {
        setError(text);
      }
      setTasks((current) =>
        current.map((item) =>
          item.taskId === taskId
            ? {
                ...item,
                status: text.includes('下载已取消') ? 'cancelled' : 'error',
                error: text,
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
    await videoDownloadCommand('cancel', { taskId }).catch((err) => setError(String(err)));
  };

  if (!ready) return null;

  const canDownload = !!url.trim() && !!runtime?.installed && !downloading;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="⬇️"
        title="视频下载"
        subtitle="基于 yt-dlp 下载网页视频、音频和字幕"
        actions={
          <>
            <ToolbarButton onClick={() => void refreshRuntime()} disabled={checking}>
              <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
              检测运行时
            </ToolbarButton>
            <ToolbarButton onClick={() => void checkRuntimeUpdate()} disabled={checkingUpdate}>
              {checkingUpdate ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              检测更新
            </ToolbarButton>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[390px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <StatusMessage message={message} error={error} />

          <div
            className={`mt-3 rounded-lg border p-3 text-sm ${
              runtime?.installed
                ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200'
                : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {runtime?.installed ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              {runtime?.installed ? `yt-dlp ${runtime.version || ''}` : '需要准备 yt-dlp'}
            </div>
            <p className="mt-1 text-xs leading-5">{runtime?.message || '正在检测 yt-dlp...'}</p>
            {runtime?.path && <p className="mt-1 truncate font-mono text-xs opacity-75">{runtime.path}</p>}
            {runtime && !runtime.installed && (
              <div className="mt-2 space-y-2 text-xs">
                <code className="block rounded bg-gray-950 p-2 text-green-300">winget install yt-dlp.yt-dlp</code>
                <code className="block rounded bg-gray-950 p-2 text-green-300">scoop install yt-dlp</code>
                <p className="leading-5">
                  也可以下载 yt-dlp.exe 后放入：
                  <span className="font-mono">{runtime.installDir}</span>
                </p>
                <button
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-300"
                  onClick={() => invoke('open_path', { targetPath: runtime.downloadUrl })}
                >
                  打开官方下载页 <ExternalLink size={12} />
                </button>
              </div>
            )}
            {runtime?.installed && !runtime.ffmpegInstalled && (
              <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-200">
                未检测到 FFmpeg。普通单文件下载可能可用，但高清音视频合并、转音频和字幕封装建议先安装 FFmpeg。
              </p>
            )}
            {runtime?.installed && (
              <div className="mt-2 space-y-2 text-xs">
                <button
                  onClick={() => void checkRuntimeUpdate()}
                  disabled={checkingUpdate}
                  className="inline-flex items-center gap-1 rounded border border-blue-200 px-2 py-1 text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-900/50 dark:text-blue-200 dark:hover:bg-blue-900/20"
                >
                  {checkingUpdate ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  检测更新
                </button>
                <span className="ml-2 leading-6 opacity-75">只检测版本，不会自动更新。</span>
              </div>
            )}
            {updateStatus && (
              <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2 text-xs leading-5 text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200">
                <div>{updateStatus.message}</div>
                {updateStatus.updateCommands.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {updateStatus.updateCommands.map((command) => (
                      <code key={command} className="block rounded bg-gray-950 p-2 text-green-300">
                        {command}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">视频链接</span>
              <textarea
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="粘贴 YouTube / B站 / 抖音 / 小红书 / Twitter 等链接"
                className="mt-2 h-28 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              />
            </label>

            <div>
              <span className="text-sm font-semibold">保存目录</span>
              <div className="mt-2 flex gap-2">
                <input
                  value={outputDir}
                  onChange={(event) => setOutputDir(event.target.value)}
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

            <div>
              <span className="text-sm font-semibold">下载模式</span>
              <div className="mt-2 grid grid-cols-3 rounded-lg border border-gray-200 p-1 dark:border-gray-700">
                {[
                  { id: 'video', label: '视频', icon: Video },
                  { id: 'audio', label: '音频', icon: FileAudio },
                  { id: 'subtitles', label: '字幕', icon: FileText },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setMode(item.id as DownloadMode)}
                      className={`flex h-10 items-center justify-center gap-1.5 rounded-md text-sm font-medium ${
                        mode === item.id
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                    >
                      <Icon size={15} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {mode === 'video' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={mergeMp4} onChange={(event) => setMergeMp4(event.target.checked)} />
                优先合并为 MP4
              </label>
            )}
            {mode === 'audio' && (
              <label className="block">
                <span className="text-sm font-semibold">音频格式</span>
                <select
                  value={audioFormat}
                  onChange={(event) => setAudioFormat(event.target.value)}
                  className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none dark:border-gray-700 dark:bg-gray-950"
                >
                  {AUDIO_FORMATS.map((item) => (
                    <option key={item} value={item}>
                      {item.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mode === 'subtitles' && (
              <label className="block">
                <span className="text-sm font-semibold">字幕语言</span>
                <input
                  value={subtitleLangs}
                  onChange={(event) => setSubtitleLangs(event.target.value)}
                  className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none dark:border-gray-700 dark:bg-gray-950"
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-semibold">Cookie</span>
                <select
                  value={cookieBrowser}
                  onChange={(event) => setCookieBrowser(event.target.value)}
                  className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none dark:border-gray-700 dark:bg-gray-950"
                >
                  {COOKIE_BROWSERS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-8 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includePlaylist}
                  onChange={(event) => setIncludePlaylist(event.target.checked)}
                />
                下载播放列表
              </label>
            </div>

            {cookieBrowser === 'custom' && (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">自定义 Cookie</span>
                  <button
                    type="button"
                    onClick={() => setShowCookie((value) => !value)}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 dark:hover:text-blue-300"
                  >
                    {showCookie ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showCookie ? '隐藏' : '显示'}
                  </button>
                </div>
                <textarea
                  value={customCookie}
                  onChange={(event) => setCustomCookie(event.target.value)}
                  placeholder="粘贴 Cookie 请求头，例如：Cookie: name=value; name2=value2，或直接粘贴 name=value; name2=value2"
                  className={`mt-2 h-24 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 ${
                    showCookie ? 'font-mono' : 'text-transparent caret-gray-900 dark:caret-gray-100'
                  }`}
                />
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  支持带 `Cookie:` 前缀或直接粘贴 `name=value; name2=value2`。不支持 Netscape cookies.txt 内容。
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => void probe()}
                disabled={probing || !runtime?.installed}
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
              <div className="flex items-center gap-1.5 font-semibold">
                <Info size={14} />
                使用提醒
              </div>
              <p className="mt-1">
                仅用于下载你有权访问和保存的内容。部分平台需要登录 Cookie，且网站接口变化可能导致某些链接临时不可用。
              </p>
              <p className="mt-1">
                YouTube 如果提示登录/机器人验证，先选择已登录 YouTube 的 Chrome/Edge Cookie；只有“检测更新”提示有新版本时再按命令更新 yt-dlp。
                如果提示无法复制 Chrome cookie 数据库，先完全关闭 Chrome 后重试，或改选 Edge / 自定义 Cookie。
              </p>
            </div>
          </div>
        </section>

        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          {info ? (
            <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
                {info.thumbnail ? (
                  <img src={info.thumbnail} alt="" className="aspect-video w-full object-cover" />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-gray-400">
                    <PlayCircle size={42} />
                  </div>
                )}
                <div className="space-y-2 p-3">
                  <h2 className="line-clamp-3 text-base font-semibold">{info.title}</h2>
                  <p className="text-sm text-gray-500">{info.uploader || info.extractor || '未知来源'}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                    <div>时长：{formatDuration(info.duration)}</div>
                    <div>格式：{info.formats.length}</div>
                    <div>来源：{info.extractor || '-'}</div>
                    <div>{info.isPlaylist ? `列表 ${info.entryCount} 项` : '单视频'}</div>
                  </div>
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">视频格式</h3>
                  <button
                    onClick={() => setSelectedFormat('')}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-300"
                  >
                    使用推荐格式
                  </button>
                </div>
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800">
                  {videoFormats.length ? (
                    videoFormats.slice(0, 80).map((item) => (
                      <button
                        key={`${item.formatId}-${item.ext}-${item.resolution}`}
                        onClick={() => setSelectedFormat(item.formatId)}
                        className={`flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left text-sm last:border-0 dark:border-gray-800 ${
                          selectedFormat === item.formatId ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{formatFormat(item)}</span>
                          <span className="block truncate text-xs text-gray-500">
                            V: {item.vcodec || '-'} · A: {item.acodec || '-'}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-gray-500">
                          {item.filesize ? formatBytes(item.filesize) : item.fps ? `${item.fps}fps` : '-'}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="p-6 text-center text-sm text-gray-400">没有读取到可选视频格式</div>
                  )}
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
                          <span>{task.mode === 'video' ? '视频' : task.mode === 'audio' ? '音频' : '字幕'}</span>
                          {task.speed && <span>{task.speed}</span>}
                          {task.eta && <span>剩余 {task.eta}</span>}
                          {task.fileSize && <span>{formatBytes(task.fileSize)}</span>}
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
                        {taskDisplayMessage(task)}
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
        </section>
      </main>
    </div>
  );
}
