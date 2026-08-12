import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  Upload,
  X,
  CheckCircle,
  Loader,
  AlertCircle,
  Info,
  FolderOpen,
  Settings,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

// ─── 类型 ────────────────────────────────────────────────────────────────────

interface FfmpegStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

interface ConvertProgress {
  file: string;
  percent: number;
  status: 'processing' | 'done' | 'error';
  error?: string;
  output_path?: string;
  output_size?: number;
}

interface FileItem {
  id: string;
  path: string;
  name: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  percent: number;
  error?: string;
  outputPath?: string;
  outputSize?: number;
}

interface ConvertOptions {
  video_bitrate?: string;
  audio_bitrate?: string;
  resolution?: string;
  fps?: number;
  audio_sample_rate?: number;
  start_time?: string;
  end_time?: string; // UI 用，发送前转为 duration
}

export type MediaMode = 'video' | 'audio';

// ─── 格式分组 ────────────────────────────────────────────────────────────────

export const VIDEO_FORMATS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts', 'gif'];
export const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'];

const RESOLUTIONS = ['3840x2160', '2560x1440', '1920x1080', '1280x720', '854x480', '640x360'];
const VIDEO_BITRATES = ['8000k', '4000k', '2000k', '1500k', '1000k', '800k', '500k'];
const AUDIO_BITRATES = ['320k', '256k', '192k', '128k', '96k', '64k'];
const SAMPLE_RATES = [48000, 44100, 22050, 16000, 8000];
const FPS_OPTIONS = [60, 30, 25, 24, 15];

// ─── FFmpeg 安装指引 ──────────────────────────────────────────────────────────

function FfmpegGuide({ onRecheck, checking }: { onRecheck: () => void; checking: boolean }) {
  const [tab, setTab] = useState<'windows' | 'mac' | 'linux'>('windows');
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="text-5xl mb-4">🎬</div>
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">
        需要安装 FFmpeg
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md">
        本工具调用系统 FFmpeg 进行音视频处理，性能最佳，支持硬件加速。请按以下步骤安装：
      </p>
      <div className="w-full max-w-lg bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(['windows', 'mac', 'linux'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                tab === t
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t === 'windows' ? 'Windows' : t === 'mac' ? 'macOS' : 'Linux'}
            </button>
          ))}
        </div>
        <div className="p-4 text-left space-y-3">
          {tab === 'windows' && (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                方式一：使用 winget（推荐，Windows 10/11 内置）
              </p>
              <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded-lg font-mono select-all">
                winget install Gyan.FFmpeg
              </code>
              <p className="text-xs text-gray-500 dark:text-gray-400">方式二：使用 Scoop</p>
              <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded-lg font-mono select-all">
                scoop install ffmpeg
              </code>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                方式三：手动下载 →{' '}
                <a
                  href="https://ffmpeg.org/download.html"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-500 underline"
                >
                  ffmpeg.org/download.html
                </a>
                ，解压后将 bin 目录加入 PATH
              </p>
            </>
          )}
          {tab === 'mac' && (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">使用 Homebrew（推荐）</p>
              <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded-lg font-mono select-all">
                brew install ffmpeg
              </code>
              <p className="text-xs text-gray-500 dark:text-gray-400">或使用 MacPorts</p>
              <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded-lg font-mono select-all">
                sudo port install ffmpeg
              </code>
            </>
          )}
          {tab === 'linux' && (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">Ubuntu / Debian</p>
              <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded-lg font-mono select-all">
                sudo apt update &amp;&amp; sudo apt install ffmpeg
              </code>
              <p className="text-xs text-gray-500 dark:text-gray-400">Fedora / RHEL</p>
              <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded-lg font-mono select-all">
                sudo dnf install ffmpeg
              </code>
              <p className="text-xs text-gray-500 dark:text-gray-400">Arch Linux</p>
              <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded-lg font-mono select-all">
                sudo pacman -S ffmpeg
              </code>
            </>
          )}
        </div>
      </div>
      <button
        onClick={onRecheck}
        disabled={checking}
        className="mt-6 flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg transition-colors"
      >
        {checking ? <Loader size={13} className="animate-spin" /> : null}
        安装完成？重新检测
      </button>
    </div>
  );
}

// ─── 核心转换组件（可复用） ───────────────────────────────────────────────────

export interface MediaConvertProps {
  mode: MediaMode;
}

export default function MediaConvertTool({ mode }: MediaConvertProps) {
  const ready = useToolTheme();

  const formats = mode === 'video' ? VIDEO_FORMATS : AUDIO_FORMATS;
  const fileExtensions =
    mode === 'video' ? VIDEO_FORMATS.filter((f) => f !== 'gif') : AUDIO_FORMATS;

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [outputFormat, setOutputFormat] = useState(formats[0]);
  const [outputDir, setOutputDir] = useState('');
  const [converting, setConverting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [options, setOptions] = useState<ConvertOptions>({});
  const unlistenRef = useRef<(() => void) | null>(null);

  const checkFfmpeg = useCallback(async () => {
    setChecking(true);
    try {
      const status = await invoke<FfmpegStatus>('check_ffmpeg');
      setFfmpeg(status);
    } catch {
      setFfmpeg({ installed: false });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkFfmpeg();
  }, [checkFfmpeg]);

  const handleSelectFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: mode === 'video' ? '视频文件' : '音频文件', extensions: fileExtensions }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setFiles((prev) => [
      ...prev,
      ...paths.map((p) => ({
        id: Math.random().toString(36).slice(2),
        path: p,
        name: p.split(/[\\/]/).pop() || p,
        status: 'pending' as const,
        percent: 0,
      })),
    ]);
  };

  const handleSelectOutputDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir && typeof dir === 'string') setOutputDir(dir);
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));
  const clearAll = () => setFiles([]);

  const handleConvert = async () => {
    if (!files.length || converting) return;
    setConverting(true);
    setFiles((prev) =>
      prev.map((f) => ({
        ...f,
        status: 'pending' as const,
        percent: 0,
        error: undefined,
        outputPath: undefined,
      }))
    );

    if (unlistenRef.current) unlistenRef.current();
    unlistenRef.current = await listen<ConvertProgress>('convert-progress', (event) => {
      const p = event.payload;
      setFiles((prev) =>
        prev.map((f) =>
          f.path === p.file
            ? {
                ...f,
                status:
                  p.status === 'done'
                    ? ('done' as const)
                    : p.status === 'error'
                      ? ('error' as const)
                      : ('processing' as const),
                percent: p.percent,
                error: p.error,
                outputPath: p.output_path,
                outputSize: p.output_size,
              }
            : f
        )
      );
    });

    try {
      // 将 end_time 转换为 duration（Rust 端用 duration 字段）
      const rustOptions = (() => {
        const { end_time, start_time, ...rest } = options;
        const result: Record<string, unknown> = { ...rest };
        if (start_time) result.start_time = start_time;
        if (end_time) result.duration = end_time;
        return result;
      })();

      await invoke('batch_convert_media', {
        inputPaths: files.map((f) => f.path),
        outputFormat,
        outputDir: outputDir || null,
        options: rustOptions,
      });
    } catch (e) {
      console.error('batch_convert_media error:', e);
    } finally {
      setConverting(false);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const doneCount = files.filter((f) => f.status === 'done').length;
  const errorCount = files.filter((f) => f.status === 'error').length;

  const headerIcon = mode === 'video' ? '🎬' : '🎵';
  const headerTitle = mode === 'video' ? '视频格式转换' : '音频格式转换';
  const accentColor = mode === 'video' ? 'bg-blue-500' : 'bg-purple-500';
  const accentHover = mode === 'video' ? 'hover:bg-blue-600' : 'hover:bg-purple-600';
  const progressColor = mode === 'video' ? 'bg-blue-500' : 'bg-purple-500';
  const percentColor = mode === 'video' ? 'text-blue-500' : 'text-purple-500';

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon={headerIcon}
        title={headerTitle}
        subtitle={ffmpeg?.installed ? `FFmpeg ${ffmpeg.version ?? ''}` : undefined}
      />

      {ffmpeg === null ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-gray-400">
            <Loader size={18} className="animate-spin" />
            <span className="text-sm">检测 FFmpeg...</span>
          </div>
        </div>
      ) : !ffmpeg.installed ? (
        <div className="flex-1 overflow-auto">
          <FfmpegGuide onRecheck={checkFfmpeg} checking={checking} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 工具栏 */}
          <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              输出格式
            </span>
            <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
              {formats.map((f) => (
                <button
                  key={f}
                  onClick={() => setOutputFormat(f)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    outputFormat === f
                      ? `${accentColor} text-white shadow-sm`
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <button
              onClick={handleSelectOutputDir}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              <FolderOpen size={13} />
              {outputDir ? outputDir.split(/[\\/]/).pop() : '输出目录（默认同源）'}
            </button>
            <button
              onClick={() => setShowOptions((v) => !v)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              <Settings size={13} />
              高级选项
              {showOptions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>

          {/* 高级选项面板 */}
          {showOptions && (
            <div className="flex-shrink-0 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800 grid grid-cols-2 md:grid-cols-4 gap-3">
              {mode === 'video' && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500 dark:text-gray-400">视频码率</span>
                    <select
                      value={options.video_bitrate ?? ''}
                      onChange={(e) =>
                        setOptions((o) => ({ ...o, video_bitrate: e.target.value || undefined }))
                      }
                      className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1"
                    >
                      <option value="">自动</option>
                      {VIDEO_BITRATES.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500 dark:text-gray-400">分辨率</span>
                    <select
                      value={options.resolution ?? ''}
                      onChange={(e) =>
                        setOptions((o) => ({ ...o, resolution: e.target.value || undefined }))
                      }
                      className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1"
                    >
                      <option value="">保持原始</option>
                      {RESOLUTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-500 dark:text-gray-400">帧率 (FPS)</span>
                    <select
                      value={options.fps ?? 0}
                      onChange={(e) =>
                        setOptions((o) => ({ ...o, fps: Number(e.target.value) || undefined }))
                      }
                      className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1"
                    >
                      <option value={0}>保持原始</option>
                      {FPS_OPTIONS.map((f) => (
                        <option key={f} value={f}>
                          {f} fps
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">音频码率</span>
                <select
                  value={options.audio_bitrate ?? ''}
                  onChange={(e) =>
                    setOptions((o) => ({ ...o, audio_bitrate: e.target.value || undefined }))
                  }
                  className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1"
                >
                  <option value="">自动</option>
                  {AUDIO_BITRATES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">采样率</span>
                <select
                  value={options.audio_sample_rate ?? 0}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      audio_sample_rate: Number(e.target.value) || undefined,
                    }))
                  }
                  className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1"
                >
                  <option value={0}>保持原始</option>
                  {SAMPLE_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r} Hz
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">开始时间</span>
                <input
                  type="text"
                  placeholder="00:00:00"
                  value={options.start_time ?? ''}
                  onChange={(e) =>
                    setOptions((o) => ({ ...o, start_time: e.target.value || undefined }))
                  }
                  className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">结束时间</span>
                <input
                  type="text"
                  placeholder="00:00:00"
                  value={options.end_time ?? ''}
                  onChange={(e) =>
                    setOptions((o) => ({ ...o, end_time: e.target.value || undefined }))
                  }
                  className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1"
                />
              </label>
            </div>
          )}

          {/* 文件列表 */}
          <div className="flex-1 overflow-auto p-4">
            {files.length === 0 ? (
              <div
                onClick={handleSelectFiles}
                className="h-full min-h-48 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
              >
                <Upload size={32} className="text-gray-400 mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  点击选择{mode === 'video' ? '视频' : '音频'}文件
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  支持 {formats.join(' / ').toUpperCase()}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg px-3 py-2.5 border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex-shrink-0 w-5">
                      {file.status === 'pending' && (
                        <div className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 mx-auto" />
                      )}
                      {file.status === 'processing' && (
                        <Loader size={16} className={`animate-spin ${percentColor}`} />
                      )}
                      {file.status === 'done' && (
                        <CheckCircle size={16} className="text-green-500" />
                      )}
                      {file.status === 'error' && (
                        <AlertCircle size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate text-gray-800 dark:text-gray-100">
                        {file.name}
                      </p>
                      {file.status === 'processing' && (
                        <div className="mt-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${progressColor} rounded-full transition-all duration-300`}
                            style={{ width: `${file.percent}%` }}
                          />
                        </div>
                      )}
                      {file.status === 'done' && file.outputPath && (
                        <p className="text-xs text-green-600 dark:text-green-400 truncate mt-0.5">
                          ✓ {file.outputPath.split(/[\\/]/).pop()}{' '}
                          {formatBytes(file.outputSize) ? `(${formatBytes(file.outputSize)})` : ''}
                        </p>
                      )}
                      {file.status === 'error' && (
                        <p className="text-xs text-red-500 truncate mt-0.5">{file.error}</p>
                      )}
                    </div>
                    {file.status === 'processing' && (
                      <span className={`text-xs ${percentColor} flex-shrink-0`}>
                        {file.percent.toFixed(0)}%
                      </span>
                    )}
                    {file.status === 'done' && file.outputPath && (
                      <>
                        <button
                          onClick={() => invoke('open_file', { path: file.outputPath })}
                          className="flex-shrink-0 px-2 py-1 text-[11px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded transition-colors"
                          title="打开文件"
                        >
                          打开
                        </button>
                        <button
                          onClick={() => invoke('show_in_folder', { path: file.outputPath })}
                          className="flex-shrink-0 p-1 text-gray-400 hover:text-blue-500 transition-colors"
                          title="在文件夹中显示"
                        >
                          <FolderOpen size={14} />
                        </button>
                      </>
                    )}
                    {!converting && (
                      <button
                        onClick={() => removeFile(file.id)}
                        className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 底部操作栏 */}
          <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
            <button
              onClick={handleSelectFiles}
              disabled={converting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
            >
              <Upload size={14} />
              添加文件
            </button>
            {files.length > 0 && !converting && (
              <button
                onClick={clearAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <X size={14} />
                清空
              </button>
            )}
            <div className="flex-1" />
            {files.length > 0 && (
              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span>{files.length} 个文件</span>
                {doneCount > 0 && <span className="text-green-500">✓ {doneCount} 完成</span>}
                {errorCount > 0 && <span className="text-red-500">✗ {errorCount} 失败</span>}
              </div>
            )}
            <button
              onClick={handleConvert}
              disabled={!files.length || converting}
              className={`flex items-center gap-2 px-5 py-2 ${accentColor} ${accentHover} disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed`}
            >
              {converting ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  转换中...
                </>
              ) : (
                <>开始转换 → {outputFormat.toUpperCase()}</>
              )}
            </button>
          </div>

          {/* FFmpeg 信息栏 */}
          <div className="flex-shrink-0 px-4 py-1.5 bg-gray-100 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Info size={11} className="text-gray-400 flex-shrink-0" />
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              FFmpeg {ffmpeg.version} · {ffmpeg.path}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
