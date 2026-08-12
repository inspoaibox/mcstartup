import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open as openDialog } from '@tauri-apps/api/dialog';
import {
  AlertCircle,
  CheckCircle,
  Download,
  FileVideo,
  FolderOpen,
  Image as ImageIcon,
  Loader,
  Music,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { StatusMessage, ToolbarButton } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';
import { useToolDataStore } from '../stores/toolDataStore';

interface WxChannelsStatus {
  ready: boolean;
  version: string;
  capturesAvailable: boolean;
  captureBridgeRunning: boolean;
  running: boolean;
  defaultOutputDir: string;
  message: string;
}

interface WxSettings {
  outputDir: string;
}

interface WxMediaSpec {
  fileFormat?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  bitRate?: number;
  videoBitrate?: number;
  audioBitrate?: number;
  codingFormat?: string;
  codec?: string;
  levelOrder?: number;
  [key: string]: unknown;
}

interface WxCapturedVideo {
  id: string;
  nonceId: string;
  encryptedId: string;
  sourceUrl: string;
  directUrl: string;
  decryptKey: number;
  title: string;
  author: string;
  coverUrl: string;
  duration: number;
  fileSize: number;
  mediaType: number;
  specs: WxMediaSpec[];
  raw: Record<string, unknown>;
  capturedAt: string;
}

interface WxDownloadOption {
  key: string;
  label: string;
  description: string;
  spec?: string;
  mp3?: boolean;
  cover?: boolean;
  icon: 'video' | 'music' | 'image';
}

interface WxTaskView {
  id: string;
  name: string;
  status: string;
  path?: string;
  subtitle?: string;
  percent: number;
  sizeText: string;
  raw: Record<string, unknown>;
}

interface WxCaptureListResponse {
  list: Record<string, unknown>[];
}

const DEFAULT_SETTINGS: WxSettings = {
  outputDir: '',
};

async function wxCommand<T>(action: string, payload: Record<string, unknown> = {}) {
  const response = await invoke<string>('wx_channels_download_command', {
    action,
    payload: JSON.stringify(payload),
  });
  return JSON.parse(response) as T;
}

function taskText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function taskNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function getPathValue(source: unknown, path: string[]) {
  let current = source as any;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function parseTask(task: any, index = 0): WxTaskView {
  const id =
    taskText(task?.id) ||
    taskText(task?.gid) ||
    taskText(getPathValue(task, ['meta', 'id'])) ||
    `task-${index}`;
  const name =
    taskText(getPathValue(task, ['meta', 'opts', 'name'])) ||
    taskText(getPathValue(task, ['meta', 'req', 'labels', 'title'])) ||
    taskText(task?.name) ||
    id;
  const path = taskText(getPathValue(task, ['meta', 'opts', 'path']));
  const status = taskText(task?.status) || taskText(task?.state) || 'unknown';
  const subtitle =
    taskText(getPathValue(task, ['meta', 'req', 'labels', 'spec'])) ||
    taskText(getPathValue(task, ['meta', 'req', 'labels', 'suffix'])) ||
    taskText(getPathValue(task, ['meta', 'req', 'url'])) ||
    path;
  const total =
    taskNumber(getPathValue(task, ['meta', 'res', 'size'])) ||
    taskNumber(getPathValue(task, ['progress', 'total'])) ||
    0;
  const downloaded =
    taskNumber(getPathValue(task, ['progress', 'downloaded'])) ||
    taskNumber(getPathValue(task, ['progress', 'used'])) ||
    0;
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((downloaded / total) * 100))) : 0;
  return {
    id,
    name,
    status,
    path,
    subtitle,
    percent,
    sizeText: total > 0 ? `${formatBytes(downloaded)} / ${formatBytes(total)}` : '',
    raw: task,
  };
}

function parseTasks(value: any): WxTaskView[] {
  const list = Array.isArray(value?.data?.list)
    ? value.data.list
    : Array.isArray(value?.list)
      ? value.list
      : [];
  return list.map(parseTask);
}

function statusDot(active: boolean) {
  return active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600';
}

function formatBytes(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatDuration(value?: number) {
  if (!value || !Number.isFinite(value) || value <= 0) return '-';
  const seconds = value > 10000 ? Math.round(value / 1000) : Math.round(value);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatMbpsFromKbps(value?: unknown) {
  const kbps = Number(value);
  if (!Number.isFinite(kbps) || kbps <= 0) return '';
  return `${(kbps / 1000).toFixed(2)} Mbps`;
}

function formatMbpsFromKbPerSecond(value?: unknown) {
  const kb = Number(value);
  if (!Number.isFinite(kb) || kb <= 0) return '';
  return `${((kb * 8) / 1000).toFixed(2)} Mbps`;
}

function formatCodec(value?: unknown) {
  if (typeof value !== 'string' || !value) return '';
  if (value === 'h264') return 'H.264';
  if (value === 'h265') return 'H.265';
  return value.toUpperCase();
}

function formatQuality(value?: unknown) {
  const level = Number(value);
  if (!Number.isFinite(level)) return '';
  if (level <= 100) return '高';
  if (level <= 200) return '中';
  if (level <= 300) return '低';
  return '';
}

function specValue(spec: WxMediaSpec, camelKey: string, snakeKey: string) {
  return (spec as any)[camelKey] ?? (spec as any)[snakeKey];
}

function formatSpecLabel(spec: WxMediaSpec, short = false) {
  const parts: string[] = [];
  const width = Number(spec.width);
  const height = Number(spec.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    parts.push(`${Math.round(width)}x${Math.round(height)}`);
  }
  if (!short) {
    const codec = formatCodec(specValue(spec, 'codingFormat', 'coding_format') || spec.codec);
    if (codec) parts.push(codec);
    const videoKbps = Number(specValue(spec, 'videoBitrate', 'video_bitrate'));
    const audioKbps = Number(specValue(spec, 'audioBitrate', 'audio_bitrate'));
    const rate =
      Number.isFinite(videoKbps) && videoKbps > 0
        ? formatMbpsFromKbps(videoKbps + (Number.isFinite(audioKbps) ? audioKbps : 0))
        : formatMbpsFromKbPerSecond(specValue(spec, 'bitRate', 'bit_rate'));
    if (rate) parts.push(rate);
    const quality = formatQuality(specValue(spec, 'levelOrder', 'level_order'));
    if (quality) parts.push(quality);
  }
  const rawFileFormat = specValue(spec, 'fileFormat', 'file_format');
  const fileFormat = typeof rawFileFormat === 'string' ? rawFileFormat : '';
  if (parts.length === 0) return fileFormat || '规格';
  return fileFormat ? `${parts.join(short ? ' ' : ' · ')} (${fileFormat})` : parts.join(short ? ' ' : ' · ');
}

function extractFirstUrl(text: string) {
  const match = text.match(/https?:\/\/[^\s"'<>，。；、]+/i);
  return match ? match[0] : text.trim();
}

function capturedMediaToVideo(media: Record<string, unknown>): WxCapturedVideo | null {
  const id = taskText(media.id) || '';
  const nonceId = taskText((media as any).nonce_id) || taskText((media as any).nonceId) || '';
  const sourceUrl = taskText((media as any).source_url) || taskText((media as any).sourceUrl) || '';
  const directUrl = taskText((media as any).url) || '';
  const decryptKey = taskNumber((media as any).key) || taskNumber((media as any).decodeKey) || 0;
  const title = taskText(media.title) || id || '未命名视频';
  const contact = (media as any).contact || {};
  const author = taskText(contact.nickname) || '';
  const coverUrl = taskText((media as any).cover_url) || taskText((media as any).coverUrl) || '';
  const specs = Array.isArray((media as any).spec) ? ((media as any).spec as WxMediaSpec[]) : [];
  const duration = taskNumber((media as any).duration) || taskNumber(specs[0]?.durationMs) || 0;
  const fileSize = taskNumber((media as any).size) || taskNumber((media as any).file_size) || 0;
  const capturedAt =
    taskText((media as any).captured_at) ||
    taskText((media as any).received_at) ||
    new Date().toISOString();

  if (!id && !sourceUrl) {
    return null;
  }

  return {
    id,
    nonceId,
    encryptedId: '',
    sourceUrl,
    directUrl,
    decryptKey,
    title,
    author,
    coverUrl,
    duration,
    fileSize,
    mediaType: 0,
    specs,
    raw: media,
    capturedAt,
  };
}

function buildDownloadOptions(video: WxCapturedVideo): WxDownloadOption[] {
  const options: WxDownloadOption[] = [
    {
      key: 'original',
      label: '原始视频',
      description: '不传清晰度参数，按原始视频地址下载',
      spec: '',
      icon: 'video',
    },
  ];
  const used = new Set<string>();
  video.specs.forEach((spec, index) => {
    const rawFileFormat = specValue(spec, 'fileFormat', 'file_format');
    const fileFormat = typeof rawFileFormat === 'string' ? rawFileFormat.trim() : '';
    if (!fileFormat || used.has(fileFormat)) return;
    used.add(fileFormat);
    options.push({
      key: `spec-${fileFormat}-${index}`,
      label: formatSpecLabel(spec, true),
      description: formatSpecLabel(spec),
      spec: fileFormat,
      icon: 'video',
    });
  });
  options.push(
    {
      key: 'mp3',
      label: '音频 MP3',
      description: '提取音频，需要本机 FFmpeg',
      mp3: true,
      icon: 'music',
    },
    {
      key: 'cover',
      label: '封面图片',
      description: '下载当前作品封面图',
      cover: true,
      icon: 'image',
    },
  );
  return options;
}

function normalizeCaptureKey(value: string) {
  const text = value.trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    const keep = new Set(['exportkey', 'idx', 'mid', 'sn', 'vid', 'objectid', 'object_id', 'feedid', 'feed_id']);
    const pairs = Array.from(url.searchParams.entries())
      .filter(([key]) => keep.has(key))
      .sort(([a], [b]) => a.localeCompare(b));
    url.search = '';
    pairs.forEach(([key, item]) => url.searchParams.append(key, item));
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return text.replace(/\/$/, '').toLowerCase();
  }
}

function videoMatchesInput(video: WxCapturedVideo, input: string) {
  const query = input.trim();
  if (!query) return false;
  const normalizedQuery = normalizeCaptureKey(query);
  const candidates = [video.sourceUrl, video.directUrl, video.id, video.nonceId, video.encryptedId].filter(Boolean);
  return candidates.some((candidate) => {
    const text = String(candidate);
    return text === query || normalizeCaptureKey(text) === normalizedQuery || text.includes(query) || query.includes(text);
  });
}

function optionIcon(type: WxDownloadOption['icon']) {
  if (type === 'music') return <Music size={16} />;
  if (type === 'image') return <ImageIcon size={16} />;
  return <FileVideo size={16} />;
}

export default function WxChannelsDownloaderTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateWxChannelsDownloaderData } = useToolDataStore();
  const [settings, setSettings] = useState<WxSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<WxChannelsStatus | null>(null);
  const [tasks, setTasks] = useState<WxTaskView[]>([]);
  const [capturedVideos, setCapturedVideos] = useState<WxCapturedVideo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<WxCapturedVideo | null>(null);
  const [captureInput, setCaptureInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const restoredRef = useRef(false);
  const autoPreparedRef = useRef(false);

  useEffect(() => {
    if (!loaded) {
      void loadData();
    }
  }, [loaded, loadData]);

  useEffect(() => {
    if (!loaded || restoredRef.current) return;
    restoredRef.current = true;
    const stored = data.wxChannelsDownloader;
    setSettings({
      outputDir: stored?.outputDir ?? DEFAULT_SETTINGS.outputDir,
    });
  }, [data.wxChannelsDownloader, loaded]);

  useEffect(() => {
    if (!loaded || !restoredRef.current) return;
    const timer = window.setTimeout(() => {
      updateWxChannelsDownloaderData({
        version: 'mcheng-wx-channels-downloader-v2',
        ...DEFAULT_SETTINGS,
        ...settings,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loaded, settings, updateWxChannelsDownloaderData]);

  const payload = useMemo(
    () => ({
      outputDir: settings.outputDir,
    }),
    [settings.outputDir],
  );

  const refreshTasks = useCallback(async () => {
    try {
      const value = await wxCommand<any>('tasks');
      setTasks(parseTasks(value));
    } catch {
      setTasks([]);
    }
  }, []);

  const loadCapturedVideos = useCallback(async () => {
    const value = await wxCommand<WxCaptureListResponse>('captures');
    return (Array.isArray(value.list) ? value.list : [])
      .map(capturedMediaToVideo)
      .filter((item): item is WxCapturedVideo => Boolean(item));
  }, []);

  const refreshCaptures = useCallback(async () => {
    try {
      const videos = await loadCapturedVideos();
      setCapturedVideos((current) => mergeCapturedVideos(videos, current));
    } catch {
      // 页面捕获模块启动前会暂时失败，保留已有结果即可。
    }
  }, [loadCapturedVideos]);

  const refreshStatus = useCallback(async () => {
    try {
      const result = await wxCommand<WxChannelsStatus>('check', payload);
      setStatus(result);
      if (!settings.outputDir && result.defaultOutputDir) {
        setSettings((current) => ({ ...current, outputDir: result.defaultOutputDir }));
      }
      void refreshTasks();
      void refreshCaptures();
    } catch (err) {
      setError(String(err));
    }
  }, [payload, refreshCaptures, refreshTasks, settings.outputDir]);

  const applyStatusResult = useCallback(
    (result: WxChannelsStatus) => {
      setStatus(result);
      if (!settings.outputDir && result.defaultOutputDir) {
        setSettings((current) => ({ ...current, outputDir: result.defaultOutputDir }));
      }
      void refreshTasks();
      void refreshCaptures();
    },
    [refreshCaptures, refreshTasks, settings.outputDir],
  );

  const prepareService = useCallback(
    async (silent = false) => {
      setBusy('ensure');
      setError('');
      if (!silent) setMessage('');
      try {
        const result = await wxCommand<WxChannelsStatus>('ensure', payload);
        applyStatusResult(result);
        if (!silent) {
          setMessage('捕获模块已准备好。粘贴视频号链接后打开页面，作品加载时会自动捕获。');
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy('');
      }
    },
    [applyStatusResult, payload],
  );

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    if (!loaded || !restoredRef.current || autoPreparedRef.current) return;
    autoPreparedRef.current = true;
    void prepareService(true);
  }, [loaded, prepareService]);

  useEffect(() => {
    void refreshCaptures();
    const timer = window.setInterval(() => {
      void refreshCaptures();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refreshCaptures]);

  useEffect(() => {
    return () => {
      void wxCommand('shutdown').catch(() => undefined);
    };
  }, []);

  const runAction = async (action: string, label: string, success: string) => {
    setBusy(action);
    setError('');
    setMessage('');
    try {
      await wxCommand(action, payload);
      setMessage(success);
      await refreshStatus();
      if (action === 'ensure') {
        window.setTimeout(() => void refreshStatus(), 2500);
      }
    } catch (err) {
      setError(`${label}失败：${String(err)}`);
    } finally {
      setBusy('');
    }
  };

  const chooseOutputDir = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === 'string') {
      setSettings((current) => ({ ...current, outputDir: selected }));
    }
  };

  const openDownloadDir = async () => {
    await runAction('openDownloadDir', '打开下载目录', '已请求打开下载目录。');
  };

  const openCaptureWindow = async () => {
    const input = extractFirstUrl(captureInput || 'https://channels.weixin.qq.com/');
    setBusy('capture-window');
    setError('');
    setMessage('');
    try {
      await wxCommand('openCaptureWindow', { url: input });
      setMessage('已打开视频号页面。请等待作品加载，或在窗口里刷新一次；捕获到媒体信息后会出现在右侧。');
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy('');
    }
  };

  const controlTask = async (taskAction: string, taskId?: string) => {
    setBusy(`task-${taskAction}-${taskId || 'all'}`);
    setError('');
    try {
      await wxCommand('taskAction', { taskAction, taskId });
      await refreshTasks();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy('');
    }
  };

  const captureFromPage = async () => {
    const input = extractFirstUrl(captureInput);
    if (!input) {
      setError('请先粘贴微信视频号页面链接，或包含链接的分享文本。');
      return;
    }
    setBusy('capture-page');
    setError('');
    setMessage('');
    try {
      const freshVideos = await loadCapturedVideos();
      const merged = mergeCapturedVideos(freshVideos, capturedVideos);
      setCapturedVideos(merged);
      const captured = merged.find((video) => videoMatchesInput(video, input));
      if (captured) {
        setSelectedVideo(captured);
        setMessage('已匹配到捕获结果，可以选择格式和清晰度下载。');
        await refreshStatus();
        return;
      }
      await wxCommand('openCaptureWindow', { url: input });
      setMessage('已打开对应页面。视频号分享链接不是下载直链，需要等页面加载后捕获真实媒体信息。');
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy('');
    }
  };

  const createDownloadTask = async (video: WxCapturedVideo, option: WxDownloadOption) => {
    setBusy(`create-${option.key}`);
    setError('');
    setMessage('');
    try {
      await wxCommand('createDownloadTask', {
        outputDir: settings.outputDir,
        media: {
          ...video.raw,
          id: video.id || (video.raw as any).id,
          nonce_id: video.nonceId || (video.raw as any).nonce_id,
          source_url: video.sourceUrl || (video.raw as any).source_url,
          url: video.directUrl || (video.raw as any).url,
          key: video.decryptKey || (video.raw as any).key,
          title: video.title || (video.raw as any).title,
          cover_url: video.coverUrl || (video.raw as any).cover_url,
          contact: (video.raw as any).contact || { nickname: video.author },
          spec: video.specs,
        },
        url: video.sourceUrl,
        spec: option.spec || '',
        mp3: Boolean(option.mp3),
        cover: Boolean(option.cover),
      });
      setSelectedVideo(null);
      setMessage(`已创建下载任务：${option.label}`);
      await refreshStatus();
      await refreshTasks();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy('');
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="💬"
        title="微信视频任务管理"
        subtitle="打开视频号页面捕获媒体信息，并在工具内创建下载任务"
        actions={
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={() => void refreshStatus()} disabled={busy !== ''}>
              <RefreshCw size={14} />
              刷新
            </ToolbarButton>
            <ToolbarButton onClick={() => setShowSettings((value) => !value)}>
              <Settings size={14} />
              设置
            </ToolbarButton>
          </div>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[380px_1fr] gap-4 overflow-hidden p-4 max-lg:grid-cols-1">
        <aside className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-3">
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm leading-6 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
              视频号分享链接不是下载直链。工具会打开对应页面，在页面加载时捕获真实媒体信息，再由内置下载器保存。
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void prepareService(false)}
                disabled={busy !== ''}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy === 'ensure' ? <Loader size={16} className="animate-spin" /> : <Play size={16} />}
                准备捕获
              </button>
              <button
                onClick={() => void refreshCaptures()}
                disabled={busy !== ''}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-green-600 px-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                <RefreshCw size={16} />
                刷新捕获
              </button>
            </div>

            {message && <StatusMessage message={message} />}
            {error && <StatusMessage error={error} />}

            <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">运行状态</h2>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    status?.running
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  {status?.running ? '运行中' : '未运行'}
                </span>
              </div>
              <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
                <div className="flex items-center justify-between">
                  <span>捕获模块</span>
                  <span className={status?.ready ? 'text-green-600' : 'text-gray-400'}>
                    {status?.ready ? status.version || '已就绪' : '待准备'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusDot(Boolean(status?.captureBridgeRunning))}`} />
                    页面捕获
                  </span>
                  <span>{status?.capturesAvailable ? '已有结果' : '等待加载'}</span>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {status?.message || '正在检测捕获模块...'}
              </p>
            </section>

            <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <h2 className="mb-2 text-sm font-semibold">打开页面捕获</h2>
              <textarea
                value={captureInput}
                onChange={(event) => setCaptureInput(event.target.value)}
                placeholder="粘贴微信视频号页面链接，或包含链接的分享文本"
                className="h-28 w-full resize-none rounded-lg border border-gray-200 bg-white p-3 text-sm leading-5 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              />
              <button
                onClick={() => void captureFromPage()}
                disabled={busy !== ''}
                className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy === 'capture-page' ? <Loader size={16} className="animate-spin" /> : <FileVideo size={16} />}
                打开并捕获
              </button>
              <button
                onClick={() => void openCaptureWindow()}
                disabled={busy !== ''}
                className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                {busy === 'capture-window' ? <Loader size={16} className="animate-spin" /> : <FileVideo size={16} />}
                打开视频号首页
              </button>
              <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                粘贴链接只用于定位页面；真实下载地址会在页面请求返回时捕获。
              </p>
            </section>

            {showSettings && (
              <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <h2 className="mb-3 text-sm font-semibold">设置</h2>
                <div className="space-y-3">
                  <div>
                    <span className="text-xs text-gray-500">下载目录</span>
                    <div className="mt-1 grid grid-cols-[1fr_auto] gap-2">
                      <input
                        value={settings.outputDir}
                        onChange={(event) => setSettings((current) => ({ ...current, outputDir: event.target.value }))}
                        className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm outline-none dark:border-gray-700 dark:bg-gray-950"
                      />
                      <button
                        onClick={() => void chooseOutputDir()}
                        className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-gray-200 px-3 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                      >
                        <FolderOpen size={14} />
                        选择
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </aside>

        <section className="grid min-h-0 grid-rows-[minmax(260px,0.48fr)_minmax(280px,0.52fr)] gap-4 overflow-hidden">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div>
                <h2 className="text-sm font-semibold">捕获结果</h2>
                <p className="text-xs text-gray-400">页面加载到的作品会显示在这里，点击下载后选择格式和清晰度。</p>
              </div>
              <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                {capturedVideos.length} 个作品
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {capturedVideos.length === 0 ? (
                <EmptyState
                  icon={<FileVideo size={40} />}
                  title="暂无捕获作品"
                  description="粘贴视频号链接并打开页面，作品加载后可在这里选择清晰度下载。"
                />
              ) : (
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-4">
                  {capturedVideos.map((video) => (
                    <article key={`${video.id}-${video.capturedAt}`} className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
                      <div className="aspect-video bg-gray-100 dark:bg-gray-800">
                        {video.coverUrl ? (
                          <img src={video.coverUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-gray-400">
                            <FileVideo size={36} />
                          </div>
                        )}
                      </div>
                      <div className="space-y-2 p-3">
                        <h3 className="line-clamp-2 text-sm font-semibold leading-5">{video.title}</h3>
                        <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                          {video.author && <span>{video.author}</span>}
                          <span>{formatDuration(video.duration)}</span>
                          <span>{formatBytes(video.fileSize)}</span>
                          <span>{video.specs.length} 个清晰度</span>
                        </div>
                        <button
                          onClick={() => setSelectedVideo(video)}
                          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          <Download size={14} />
                          选择格式下载
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div>
                <h2 className="text-sm font-semibold">下载任务</h2>
                <p className="text-xs text-gray-400">任务由工具内置下载器创建并刷新。</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void openDownloadDir()}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  <FolderOpen size={14} />
                  打开目录
                </button>
                <button
                  onClick={() => void refreshTasks()}
                  disabled={busy !== ''}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  <RefreshCw size={14} />
                  刷新任务
                </button>
                <button
                  onClick={() => void controlTask('clear')}
                  disabled={busy !== '' || tasks.length === 0}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/20"
                >
                  <Trash2 size={14} />
                  清空
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {!status?.captureBridgeRunning ? (
                <EmptyState
                  icon={<AlertCircle size={40} />}
                  title="捕获模块准备中"
                  description="工具会自动准备页面捕获能力。"
                />
              ) : tasks.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle size={40} />}
                  title="暂无下载任务"
                  description="捕获作品后选择格式下载，任务会显示在这里。"
                />
              ) : (
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div key={task.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${task.status === 'done' ? 'bg-green-500' : task.status === 'error' ? 'bg-red-500' : 'bg-blue-500'}`} />
                            <h3 className="truncate text-sm font-semibold">{task.name}</h3>
                            <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                              {task.status}
                            </span>
                          </div>
                          {task.subtitle && <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{task.subtitle}</p>}
                          {task.path && <p className="mt-1 truncate text-xs text-gray-400">{task.path}</p>}
                          {(task.percent > 0 || task.sizeText) && (
                            <div className="mt-2">
                              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                                <div className="h-full bg-blue-600" style={{ width: `${task.percent}%` }} />
                              </div>
                              <p className="mt-1 text-[11px] text-gray-400">{task.percent}% {task.sizeText}</p>
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <IconButton title="开始" onClick={() => void controlTask('start', task.id)}>
                            <Play size={14} />
                          </IconButton>
                          <IconButton title="暂停" onClick={() => void controlTask('pause', task.id)}>
                            <Pause size={14} />
                          </IconButton>
                          <IconButton title="继续" onClick={() => void controlTask('resume', task.id)}>
                            <RotateCcw size={14} />
                          </IconButton>
                          <IconButton danger title="删除" onClick={() => void controlTask('delete', task.id)}>
                            <Trash2 size={14} />
                          </IconButton>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </section>
      </main>

      {selectedVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-800">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">选择下载格式</h2>
                <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">{selectedVideo.title}</p>
              </div>
              <button
                onClick={() => setSelectedVideo(null)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-4">
              <div className="mb-4 grid grid-cols-[140px_1fr] gap-4 max-sm:grid-cols-1">
                <div className="aspect-video overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                  {selectedVideo.coverUrl ? (
                    <img src={selectedVideo.coverUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-gray-400">
                      <FileVideo size={32} />
                    </div>
                  )}
                </div>
                <div className="grid content-center gap-1 text-sm text-gray-600 dark:text-gray-300">
                  <div>作者：{selectedVideo.author || '-'}</div>
                  <div>时长：{formatDuration(selectedVideo.duration)}</div>
                  <div>大小：{formatBytes(selectedVideo.fileSize)}</div>
                  <div>作品 ID：{selectedVideo.id || selectedVideo.encryptedId || '-'}</div>
                </div>
              </div>
              <div className="grid gap-2">
                {buildDownloadOptions(selectedVideo).map((option) => (
                  <button
                    key={option.key}
                    onClick={() => void createDownloadTask(selectedVideo, option)}
                    disabled={busy !== ''}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50 dark:border-gray-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/30"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
                        {optionIcon(option.icon)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{option.label}</span>
                        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{option.description}</span>
                      </span>
                    </span>
                    {busy === `create-${option.key}` ? <Loader size={16} className="shrink-0 animate-spin" /> : <Download size={16} className="shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function mergeCapturedVideos(primary: WxCapturedVideo[], secondary: WxCapturedVideo[]) {
  const map = new Map<string, WxCapturedVideo>();
  [...secondary, ...primary].forEach((video) => {
    const key = video.id || video.encryptedId || video.sourceUrl || video.capturedAt;
    map.set(key, video);
  });
  return Array.from(map.values()).slice(0, 100);
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 text-center text-gray-400 dark:border-gray-700">
      {icon}
      <p className="mt-3 text-sm">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-5">{description}</p>
    </div>
  );
}

function IconButton({
  children,
  danger,
  title,
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  title: string;
  onClick: () => void;
}) {
  const className = danger
    ? 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/20'
    : 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800';
  return (
    <button onClick={onClick} className={className} title={title}>
      {children}
    </button>
  );
}
