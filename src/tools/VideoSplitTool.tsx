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
  Film,
  Music,
} from 'lucide-react';

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
  // 每个文件有两个任务：视频轨 + 音频轨
  videoStatus: 'pending' | 'processing' | 'done' | 'error' | 'skip';
  audioStatus: 'pending' | 'processing' | 'done' | 'error' | 'skip';
  videoPercent: number;
  audioPercent: number;
  videoOutput?: string;
  videoSize?: number;
  audioOutput?: string;
  audioSize?: number;
  videoError?: string;
  audioError?: string;
}

// 分离模式
type SplitMode = 'both' | 'video_only' | 'audio_only';

const AUDIO_FORMATS = ['aac', 'mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'wma'];
const VIDEO_FORMATS = ['mp4', 'mkv', 'mov', 'avi', 'webm'];

function FfmpegGuide({ onRecheck, checking }: { onRecheck: () => void; checking: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4">
      <div className="text-5xl">✂️</div>
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
        className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg transition-colors"
      >
        {checking ? <Loader size={13} className="animate-spin" /> : null}
        安装完成？重新检测
      </button>
    </div>
  );
}

export default function VideoSplitTool() {
  const ready = useToolTheme();

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [mode, setMode] = useState<SplitMode>('both');
  const [audioFormat, setAudioFormat] = useState('aac');
  const [videoFormat, setVideoFormat] = useState('mp4');
  const [outputDir, setOutputDir] = useState('');
  const [processing, setProcessing] = useState(false);
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

  const handleSelectFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: '视频文件',
          extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'ts', 'm4v', 'rmvb'],
        },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setFiles((prev) => [
      ...prev,
      ...paths.map((p) => ({
        id: Math.random().toString(36).slice(2),
        path: p,
        name: p.split(/[\\/]/).pop() || p,
        videoStatus: 'pending' as const,
        audioStatus: 'pending' as const,
        videoPercent: 0,
        audioPercent: 0,
      })),
    ]);
  };

  const handleSelectOutputDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir && typeof dir === 'string') setOutputDir(dir);
  };

  const handleProcess = async () => {
    if (!files.length || processing) return;
    setProcessing(true);

    // 重置状态
    setFiles((prev) =>
      prev.map((f) => ({
        ...f,
        videoStatus: mode === 'audio_only' ? ('skip' as const) : ('pending' as const),
        audioStatus: mode === 'video_only' ? ('skip' as const) : ('pending' as const),
        videoPercent: 0,
        audioPercent: 0,
        videoOutput: undefined,
        audioOutput: undefined,
        videoError: undefined,
        audioError: undefined,
      }))
    );

    if (unlistenRef.current) unlistenRef.current();

    // 用 currentTrack ref 追踪当前处理的轨道，比后缀判断更可靠
    let currentTrack: 'video' | 'audio' = 'video';

    unlistenRef.current = await listen<ConvertProgress>('convert-progress', (event) => {
      const p = event.payload;

      setFiles((prev) =>
        prev.map((f) => {
          if (f.path !== p.file) return f;
          if (currentTrack === 'audio') {
            return {
              ...f,
              audioStatus:
                p.status === 'done'
                  ? ('done' as const)
                  : p.status === 'error'
                    ? ('error' as const)
                    : ('processing' as const),
              audioPercent: p.percent,
              audioOutput: p.output_path,
              audioSize: p.output_size,
              audioError: p.error,
            };
          } else {
            return {
              ...f,
              videoStatus:
                p.status === 'done'
                  ? ('done' as const)
                  : p.status === 'error'
                    ? ('error' as const)
                    : ('processing' as const),
              videoPercent: p.percent,
              videoOutput: p.output_path,
              videoSize: p.output_size,
              videoError: p.error,
            };
          }
        })
      );
    });

    const inputPaths = files.map((f) => f.path);
    const outDir = outputDir || null;

    try {
      // 提取视频轨（去掉音频）—— 独立 try/catch，失败不影响音频轨
      if (mode === 'both' || mode === 'video_only') {
        try {
          await invoke('batch_convert_media', {
            inputPaths,
            outputFormat: videoFormat,
            outputDir: outDir,
            options: { no_audio: true, video_codec: 'copy' },
          });
        } catch (e) {
          console.error('视频轨提取失败:', e);
          // 标记所有文件视频轨为错误
          setFiles((prev) =>
            prev.map((f) => ({
              ...f,
              videoStatus: f.videoStatus === 'pending' ? ('error' as const) : f.videoStatus,
              videoError: String(e),
            }))
          );
        }
      }

      // 提取音频轨（去掉视频）—— 独立 try/catch
      if (mode === 'both' || mode === 'audio_only') {
        currentTrack = 'audio';
        try {
          // 流复制只对 m4a/aac 安全（源通常是 AAC）
          // 其他格式需要重新编码，否则容器不兼容
          const actualAudioFormat = audioFormat === 'aac' ? 'm4a' : audioFormat;
          const audioOptions =
            actualAudioFormat === 'm4a'
              ? { no_video: true, audio_codec: 'copy' }
              : { no_video: true }; // 其他格式让 build_ffmpeg_args 自动选编码器
          await invoke('batch_convert_media', {
            inputPaths,
            outputFormat: actualAudioFormat,
            outputDir: outDir,
            options: audioOptions,
          });
        } catch (e) {
          console.error('音频轨提取失败:', e);
          setFiles((prev) =>
            prev.map((f) => ({
              ...f,
              audioStatus: f.audioStatus === 'pending' ? ('error' as const) : f.audioStatus,
              audioError: String(e),
            }))
          );
        }
      }
    } finally {
      setProcessing(false);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  };

  const formatBytes = (b?: number) => {
    if (!b) return '';
    return b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  const doneCount = files.filter((f) => {
    if (mode === 'both') return f.videoStatus === 'done' && f.audioStatus === 'done';
    if (mode === 'video_only') return f.videoStatus === 'done';
    return f.audioStatus === 'done';
  }).length;

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="✂️"
        title="视频音频分离"
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
          {/* 设置栏 */}
          <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 space-y-3">
            {/* 分离模式 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 w-16 flex-shrink-0">
                分离模式
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setMode('both')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    mode === 'both'
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-300'
                  }`}
                >
                  <Film size={12} />
                  <Music size={12} />
                  视频 + 音频
                </button>
                <button
                  onClick={() => setMode('video_only')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    mode === 'video_only'
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-300'
                  }`}
                >
                  <Film size={12} />
                  仅提取视频轨
                </button>
                <button
                  onClick={() => setMode('audio_only')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    mode === 'audio_only'
                      ? 'bg-purple-500 border-purple-500 text-white'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-purple-300'
                  }`}
                >
                  <Music size={12} />
                  仅提取音频轨
                </button>
              </div>
            </div>

            {/* 格式 + 输出目录 */}
            <div className="flex items-center gap-4 flex-wrap">
              {(mode === 'both' || mode === 'video_only') && (
                <div className="flex items-center gap-2">
                  <Film size={13} className="text-blue-500 flex-shrink-0" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">视频格式</span>
                  <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                    {VIDEO_FORMATS.map((f) => (
                      <button
                        key={f}
                        onClick={() => setVideoFormat(f)}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                          videoFormat === f
                            ? 'bg-blue-500 text-white shadow-sm'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(mode === 'both' || mode === 'audio_only') && (
                <div className="flex items-center gap-2">
                  <Music size={13} className="text-purple-500 flex-shrink-0" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">音频格式</span>
                  <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                    {AUDIO_FORMATS.map((f) => (
                      <button
                        key={f}
                        onClick={() => setAudioFormat(f)}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                          audioFormat === f
                            ? 'bg-purple-500 text-white shadow-sm'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex-1" />
              <button
                onClick={handleSelectOutputDir}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                <FolderOpen size={13} />
                {outputDir ? outputDir.split(/[\\/]/).pop() : '输出目录（默认同源）'}
              </button>
            </div>

            {/* 提示 */}
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              💡 提取音频：选 <span className="text-purple-500 font-medium">AAC/M4A</span>{' '}
              使用流复制（零损失极速）；选其他格式会重新编码
            </p>
          </div>

          {/* 文件列表 */}
          <div className="flex-1 overflow-auto p-4">
            {files.length === 0 ? (
              <div
                onClick={handleSelectFiles}
                className="h-full min-h-40 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
              >
                <Upload size={28} className="text-gray-400 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">点击选择视频文件</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  MP4 / MKV / AVI / MOV / WebM 等
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="bg-white dark:bg-gray-800 rounded-lg px-3 py-2.5 border border-gray-200 dark:border-gray-700"
                  >
                    {/* 文件名行 */}
                    <div className="flex items-center gap-2 mb-2">
                      <p className="flex-1 text-sm truncate font-medium">{file.name}</p>
                      {!processing && (
                        <button
                          onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {/* 视频轨状态 */}
                    {(mode === 'both' || mode === 'video_only') && file.videoStatus !== 'skip' && (
                      <div className="flex items-center gap-2 mb-1.5">
                        <Film size={12} className="text-blue-400 flex-shrink-0" />
                        <span className="text-[11px] text-gray-500 dark:text-gray-400 w-12 flex-shrink-0">
                          视频轨
                        </span>
                        <div className="flex-1">
                          {file.videoStatus === 'pending' && (
                            <span className="text-[11px] text-gray-400">等待中</span>
                          )}
                          {file.videoStatus === 'processing' && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                  style={{ width: `${file.videoPercent}%` }}
                                />
                              </div>
                              <span className="text-[11px] text-blue-500 flex-shrink-0">
                                {file.videoPercent.toFixed(0)}%
                              </span>
                            </div>
                          )}
                          {file.videoStatus === 'done' && file.videoOutput && (
                            <div className="flex items-center gap-1.5">
                              <CheckCircle size={12} className="text-green-500 flex-shrink-0" />
                              <span className="text-[11px] text-green-600 dark:text-green-400 truncate">
                                {file.videoOutput.split(/[\\/]/).pop()}
                                {file.videoSize ? ` · ${formatBytes(file.videoSize)}` : ''}
                              </span>
                              <button
                                onClick={() => invoke('open_file', { path: file.videoOutput })}
                                className="px-1.5 py-0.5 text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 rounded transition-colors flex-shrink-0"
                                title="打开文件"
                              >
                                打开
                              </button>
                              <button
                                onClick={() => invoke('show_in_folder', { path: file.videoOutput })}
                                className="p-0.5 text-gray-400 hover:text-blue-500 transition-colors flex-shrink-0"
                                title="在文件夹中显示"
                              >
                                <FolderOpen size={12} />
                              </button>
                            </div>
                          )}
                          {file.videoStatus === 'error' && (
                            <div className="flex items-center gap-1">
                              <AlertCircle size={12} className="text-red-500 flex-shrink-0" />
                              <span className="text-[11px] text-red-500 truncate">
                                {file.videoError}
                              </span>
                            </div>
                          )}
                        </div>
                        {file.videoStatus === 'processing' && (
                          <Loader size={12} className="animate-spin text-blue-500 flex-shrink-0" />
                        )}
                        {file.videoStatus === 'done' && (
                          <CheckCircle size={12} className="text-green-500 flex-shrink-0" />
                        )}
                        {file.videoStatus === 'error' && (
                          <AlertCircle size={12} className="text-red-500 flex-shrink-0" />
                        )}
                      </div>
                    )}

                    {/* 音频轨状态 */}
                    {(mode === 'both' || mode === 'audio_only') && file.audioStatus !== 'skip' && (
                      <div className="flex items-center gap-2">
                        <Music size={12} className="text-purple-400 flex-shrink-0" />
                        <span className="text-[11px] text-gray-500 dark:text-gray-400 w-12 flex-shrink-0">
                          音频轨
                        </span>
                        <div className="flex-1">
                          {file.audioStatus === 'pending' && (
                            <span className="text-[11px] text-gray-400">等待中</span>
                          )}
                          {file.audioStatus === 'processing' && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-purple-500 rounded-full transition-all duration-300"
                                  style={{ width: `${file.audioPercent}%` }}
                                />
                              </div>
                              <span className="text-[11px] text-purple-500 flex-shrink-0">
                                {file.audioPercent.toFixed(0)}%
                              </span>
                            </div>
                          )}
                          {file.audioStatus === 'done' && file.audioOutput && (
                            <div className="flex items-center gap-1.5">
                              <CheckCircle size={12} className="text-green-500 flex-shrink-0" />
                              <span className="text-[11px] text-green-600 dark:text-green-400 truncate">
                                {file.audioOutput.split(/[\\/]/).pop()}
                                {file.audioSize ? ` · ${formatBytes(file.audioSize)}` : ''}
                              </span>
                              <button
                                onClick={() => invoke('open_file', { path: file.audioOutput })}
                                className="px-1.5 py-0.5 text-[10px] bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-100 rounded transition-colors flex-shrink-0"
                                title="打开文件"
                              >
                                打开
                              </button>
                              <button
                                onClick={() => invoke('show_in_folder', { path: file.audioOutput })}
                                className="p-0.5 text-gray-400 hover:text-purple-500 transition-colors flex-shrink-0"
                                title="在文件夹中显示"
                              >
                                <FolderOpen size={12} />
                              </button>
                            </div>
                          )}
                          {file.audioStatus === 'error' && (
                            <div className="flex items-center gap-1">
                              <AlertCircle size={12} className="text-red-500 flex-shrink-0" />
                              <span className="text-[11px] text-red-500 truncate">
                                {file.audioError}
                              </span>
                            </div>
                          )}
                        </div>
                        {file.audioStatus === 'processing' && (
                          <Loader
                            size={12}
                            className="animate-spin text-purple-500 flex-shrink-0"
                          />
                        )}
                        {file.audioStatus === 'done' && (
                          <CheckCircle size={12} className="text-green-500 flex-shrink-0" />
                        )}
                        {file.audioStatus === 'error' && (
                          <AlertCircle size={12} className="text-red-500 flex-shrink-0" />
                        )}
                      </div>
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
              disabled={processing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
            >
              <Upload size={14} />
              添加文件
            </button>
            {files.length > 0 && !processing && (
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
              </div>
            )}
            <button
              onClick={handleProcess}
              disabled={!files.length || processing}
              className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  处理中...
                </>
              ) : (
                <>开始分离</>
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
