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
  Zap,
  TrendingDown,
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
  inputSize?: number; // 原始文件大小
  outputSize?: number; // 压缩后大小
}

// ─── 压缩预设 ────────────────────────────────────────────────────────────────

interface AudioPreset {
  id: string;
  label: string;
  desc: string;
  color: string;
  options: {
    audio_codec: string;
    audio_bitrate: string;
    audio_sample_rate?: number;
    no_video: boolean;
  };
}

const AUDIO_PRESETS: AudioPreset[] = [
  {
    id: 'lossless',
    label: '无损',
    desc: 'FLAC · 完整保留',
    color: 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
    options: { audio_codec: 'flac', audio_bitrate: '0', no_video: true },
  },
  {
    id: 'high',
    label: '高质量',
    desc: 'AAC 256k',
    color: 'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300',
    options: { audio_codec: 'aac', audio_bitrate: '256k', no_video: true },
  },
  {
    id: 'standard',
    label: '标准',
    desc: 'AAC 128k · 推荐',
    color: 'border-teal-400 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300',
    options: { audio_codec: 'aac', audio_bitrate: '128k', no_video: true },
  },
  {
    id: 'small',
    label: '小文件',
    desc: 'AAC 96k',
    color:
      'border-orange-400 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300',
    options: { audio_codec: 'aac', audio_bitrate: '96k', no_video: true },
  },
  {
    id: 'voice',
    label: '语音',
    desc: 'Opus 32k · 极小',
    color:
      'border-purple-400 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300',
    options: {
      audio_codec: 'libopus',
      audio_bitrate: '32k',
      audio_sample_rate: 16000,
      no_video: true,
    },
  },
];

const AUDIO_CODECS = [
  { value: 'aac', label: 'AAC（推荐）' },
  { value: 'libmp3lame', label: 'MP3' },
  { value: 'libopus', label: 'Opus' },
  { value: 'flac', label: 'FLAC（无损）' },
  { value: 'pcm_s16le', label: 'PCM WAV（无损）' },
];
const BITRATES = ['320k', '256k', '192k', '128k', '96k', '64k', '48k', '32k'];
const SAMPLE_RATES = [
  { label: '保持原始', value: 0 },
  { label: '48000 Hz', value: 48000 },
  { label: '44100 Hz', value: 44100 },
  { label: '22050 Hz', value: 22050 },
  { label: '16000 Hz', value: 16000 },
  { label: '8000 Hz', value: 8000 },
];
const CODEC_TO_FORMAT: Record<string, string> = {
  aac: 'm4a',
  libmp3lame: 'mp3',
  libopus: 'opus',
  flac: 'flac',
  pcm_s16le: 'wav',
};
const OUTPUT_FORMATS = ['mp3', 'm4a', 'aac', 'ogg', 'flac', 'wav', 'opus'];

// ─── FFmpeg 安装指引（简版） ──────────────────────────────────────────────────

function FfmpegGuide({ onRecheck, checking }: { onRecheck: () => void; checking: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4">
      <div className="text-5xl">🎵</div>
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">需要安装 FFmpeg</h2>
      <div className="w-full max-w-md bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left space-y-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">Windows（推荐）</p>
        <code className="block bg-gray-900 text-green-400 text-xs p-2.5 rounded-lg font-mono select-all">
          winget install Gyan.FFmpeg
        </code>
        <p className="text-xs text-gray-500 dark:text-gray-400">macOS</p>
        <code className="block bg-gray-900 text-green-400 text-xs p-2.5 rounded-lg font-mono select-all">
          brew install ffmpeg
        </code>
        <p className="text-xs text-gray-500 dark:text-gray-400">Linux</p>
        <code className="block bg-gray-900 text-green-400 text-xs p-2.5 rounded-lg font-mono select-all">
          sudo apt install ffmpeg
        </code>
      </div>
      <button
        onClick={onRecheck}
        disabled={checking}
        className="flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg transition-colors"
      >
        {checking ? <Loader size={13} className="animate-spin" /> : null}
        安装完成？重新检测
      </button>
    </div>
  );
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

export default function AudioCompressTool() {
  const ready = useToolTheme();

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('standard');
  const [isCustom, setIsCustom] = useState(false);
  const [outputFormat, setOutputFormat] = useState('mp3');
  const [outputDir, setOutputDir] = useState('');
  const [converting, setConverting] = useState(false);

  // 自定义参数
  const [customCodec, setCustomCodec] = useState('aac');
  const [customBitrate, setCustomBitrate] = useState('128k');
  const [customSampleRate, setCustomSampleRate] = useState(0);

  const unlistenRef = useRef<(() => void) | null>(null);

  const checkFfmpeg = useCallback(async () => {
    setChecking(true);
    try {
      setFfmpeg(await invoke<FfmpegStatus>('check_ffmpeg'));
    } catch {
      setFfmpeg({ installed: false });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkFfmpeg();
  }, [checkFfmpeg]);

  // 选择编码时自动同步输出格式
  const handleCodecChange = (codec: string) => {
    setCustomCodec(codec);
    const fmt = CODEC_TO_FORMAT[codec];
    if (fmt) setOutputFormat(fmt);
  };

  const handleSelectFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: '音频/视频文件',
          extensions: [
            'mp3',
            'wav',
            'flac',
            'aac',
            'ogg',
            'm4a',
            'wma',
            'opus',
            'mp4',
            'mkv',
            'mov',
            'avi',
          ],
        },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const newItems = await Promise.all(
      paths.map(async (p) => {
        let inputSize: number | undefined;
        try {
          inputSize = await invoke<number>('get_file_size', { path: p });
        } catch {
          /* 忽略 */
        }
        return {
          id: Math.random().toString(36).slice(2),
          path: p,
          name: p.split(/[\\/]/).pop() || p,
          status: 'pending' as const,
          percent: 0,
          inputSize,
        };
      })
    );
    setFiles((prev) => [...prev, ...newItems]);
  };

  const handleSelectOutputDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir && typeof dir === 'string') setOutputDir(dir);
  };

  const buildOptions = () => {
    if (isCustom) {
      return {
        audio_codec: customCodec,
        audio_bitrate: customBitrate,
        audio_sample_rate: customSampleRate || undefined,
        no_video: true,
      };
    }
    const preset = AUDIO_PRESETS.find((p) => p.id === selectedPreset)!;
    return preset.options;
  };

  const handleCompress = async () => {
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
      await invoke('batch_convert_media', {
        inputPaths: files.map((f) => f.path),
        outputFormat,
        outputDir: outputDir || null,
        options: buildOptions(),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setConverting(false);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  };

  const formatBytes = (b?: number) => {
    if (!b) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getSavingPercent = (input?: number, output?: number) => {
    if (!input || !output) return null;
    return ((input - output) / input) * 100;
  };

  const doneCount = files.filter((f) => f.status === 'done').length;
  const errorCount = files.filter((f) => f.status === 'error').length;

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="🎙️"
        title="音频压缩"
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
          {/* 预设选择区 */}
          <div className="flex-shrink-0 px-4 pt-3 pb-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            {/* 模式切换 */}
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => setIsCustom(false)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${!isCustom ? 'bg-purple-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              >
                <Zap size={11} className="inline mr-1" />
                预设方案
              </button>
              <button
                onClick={() => setIsCustom(true)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${isCustom ? 'bg-purple-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              >
                自定义参数
              </button>
            </div>

            {/* 预设卡片 */}
            {!isCustom && (
              <div className="flex gap-2 flex-wrap">
                {AUDIO_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPreset(p.id)}
                    className={`flex flex-col items-start px-3 py-2 rounded-lg border-2 text-left transition-all ${
                      selectedPreset === p.id
                        ? p.color
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <span className="text-xs font-semibold">{p.label}</span>
                    <span className="text-[10px] opacity-70 mt-0.5">{p.desc}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 自定义参数 */}
            {isCustom && (
              <div className="grid grid-cols-3 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">音频编码</span>
                  <select
                    value={customCodec}
                    onChange={(e) => handleCodecChange(e.target.value)}
                    className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5"
                  >
                    {AUDIO_CODECS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">码率</span>
                  <select
                    value={customBitrate}
                    onChange={(e) => setCustomBitrate(e.target.value)}
                    className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5"
                    disabled={customCodec === 'flac' || customCodec === 'pcm_s16le'}
                  >
                    {BITRATES.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">采样率</span>
                  <select
                    value={customSampleRate}
                    onChange={(e) => setCustomSampleRate(Number(e.target.value))}
                    className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5"
                  >
                    {SAMPLE_RATES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {/* 输出设置行 */}
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              <span className="text-xs text-gray-500 dark:text-gray-400">输出格式</span>
              <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                {OUTPUT_FORMATS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setOutputFormat(f)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${outputFormat === f ? 'bg-purple-500 text-white shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
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
            </div>
          </div>

          {/* 文件列表 */}
          <div className="flex-1 overflow-auto p-4">
            {files.length === 0 ? (
              <div
                onClick={handleSelectFiles}
                className="h-full min-h-40 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-colors"
              >
                <Upload size={28} className="text-gray-400 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">点击选择音频或视频文件</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  MP3 / WAV / FLAC / AAC / M4A / 视频文件（提取音频）
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
                        <Loader size={16} className="animate-spin text-purple-500" />
                      )}
                      {file.status === 'done' && (
                        <CheckCircle size={16} className="text-green-500" />
                      )}
                      {file.status === 'error' && (
                        <AlertCircle size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm truncate flex-1">{file.name}</p>
                        {file.inputSize && file.status === 'pending' && (
                          <span className="text-[11px] text-gray-400 flex-shrink-0">
                            {formatBytes(file.inputSize)}
                          </span>
                        )}
                      </div>
                      {file.status === 'processing' && (
                        <>
                          <div className="mt-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-purple-500 rounded-full transition-all duration-300"
                              style={{ width: `${file.percent}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            {file.inputSize && (
                              <span className="text-[11px] text-gray-400">
                                原始 {formatBytes(file.inputSize)}
                              </span>
                            )}
                            <span className="text-[11px] text-purple-500 ml-auto">
                              {file.percent.toFixed(0)}%
                            </span>
                          </div>
                        </>
                      )}
                      {file.status === 'done' &&
                        file.outputPath &&
                        (() => {
                          const saving = getSavingPercent(file.inputSize, file.outputSize);
                          const bigger = saving !== null && saving < 0;
                          return (
                            <div className="mt-1 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                {file.inputSize && (
                                  <span className="text-[11px] text-gray-400">
                                    原始{' '}
                                    <span className="font-medium text-gray-600 dark:text-gray-300">
                                      {formatBytes(file.inputSize)}
                                    </span>
                                  </span>
                                )}
                                {file.inputSize && file.outputSize && (
                                  <span className="text-[11px] text-gray-300 dark:text-gray-600">
                                    →
                                  </span>
                                )}
                                {file.outputSize && (
                                  <span className="text-[11px] text-gray-400">
                                    压缩后{' '}
                                    <span className="font-medium text-green-600 dark:text-green-400">
                                      {formatBytes(file.outputSize)}
                                    </span>
                                  </span>
                                )}
                                {saving !== null && (
                                  <span
                                    className={`flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${bigger ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'}`}
                                  >
                                    {bigger ? (
                                      `↑ +${Math.abs(saving).toFixed(1)}%`
                                    ) : (
                                      <>
                                        <TrendingDown size={10} /> 节省 {saving.toFixed(1)}%
                                      </>
                                    )}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-gray-400 truncate">
                                → {file.outputPath.split(/[\\/]/).pop()}
                              </p>
                            </div>
                          );
                        })()}
                      {file.status === 'error' && (
                        <p className="text-xs text-red-500 truncate mt-0.5">{file.error}</p>
                      )}
                    </div>
                    {file.status === 'done' && file.outputPath && (
                      <>
                        <button
                          onClick={() => invoke('open_file', { path: file.outputPath })}
                          className="flex-shrink-0 px-2 py-1 text-[11px] bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/50 rounded transition-colors"
                          title="打开文件"
                        >
                          打开
                        </button>
                        <button
                          onClick={() => invoke('show_in_folder', { path: file.outputPath })}
                          className="flex-shrink-0 p-1 text-gray-400 hover:text-purple-500 transition-colors"
                          title="在文件夹中显示"
                        >
                          <FolderOpen size={14} />
                        </button>
                      </>
                    )}
                    {!converting && (
                      <button
                        onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
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
                onClick={() => setFiles([])}
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
              onClick={handleCompress}
              disabled={!files.length || converting}
              className="flex items-center gap-2 px-5 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
            >
              {converting ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  压缩中...
                </>
              ) : (
                <>开始压缩</>
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
