import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { open, save } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  AlertCircle,
  Bot,
  CheckCircle,
  Eraser,
  Eye,
  Film,
  FolderOpen,
  Info,
  Loader,
  MousePointer2,
  Pause,
  Play,
  Save,
  Settings,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';

type Mode = 'quick' | 'ai';
type AudioMode = 'aac' | 'copy' | 'none';
type Preset = 'veryfast' | 'fast' | 'medium' | 'slow';

interface FfmpegStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

interface Region {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VideoSize {
  width: number;
  height: number;
}

interface ProgressPayload {
  file: string;
  percent: number;
  status: 'processing' | 'done' | 'error';
  stage?: string;
  error?: string;
  output_path?: string;
  output_size?: number;
}

interface RemoveResult {
  outputPath: string;
  outputSize: number;
  width: number;
  height: number;
  duration: number;
  mode: string;
}

interface ProPainterRuntimeStatus {
  ready: boolean;
  pythonPath?: string | null;
  pythonVersion?: string | null;
  propainterDir?: string | null;
  scriptPath?: string | null;
  missing: string[];
  warnings: string[];
}

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'm4v', 'ts'];
const AI_VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi'];
const PRESETS: Preset[] = ['veryfast', 'fast', 'medium', 'slow'];

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function formatBytes(bytes?: number) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getFileExt(path: string) {
  return (path.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
}

function makeDefaultOutputName(inputPath: string, mode: Mode) {
  const filename = inputPath.split(/[\\/]/).pop() || 'video.mp4';
  const stem = filename.replace(/\.[^.]+$/, '') || 'video';
  return `${stem}_${mode === 'ai' ? 'ai_watermark_removed' : 'watermark_removed'}.mp4`;
}

function parentDir(path: string) {
  const normalized = path.replace(/[\\/]+$/, '');
  const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function getDisplayBox(container: HTMLDivElement, size: VideoSize) {
  const rect = container.getBoundingClientRect();
  const containerRatio = rect.width / rect.height;
  const videoRatio = size.width / size.height;
  let width = rect.width;
  let height = rect.height;
  let left = 0;
  let top = 0;

  if (containerRatio > videoRatio) {
    height = rect.height;
    width = height * videoRatio;
    left = (rect.width - width) / 2;
  } else {
    width = rect.width;
    height = width / videoRatio;
    top = (rect.height - height) / 2;
  }

  return { left, top, width, height, containerLeft: rect.left, containerTop: rect.top };
}

export default function VideoWatermarkRemoveTool() {
  const ready = useToolTheme();
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [checkingFfmpeg, setCheckingFfmpeg] = useState(false);
  const [mode, setMode] = useState<Mode>('quick');
  const [inputPath, setInputPath] = useState('');
  const [inputName, setInputName] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [resultPath, setResultPath] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [videoSize, setVideoSize] = useState<VideoSize | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [regions, setRegions] = useState<Region[]>([]);
  const [activeRegionId, setActiveRegionId] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [taskError, setTaskError] = useState('');
  const [outputSize, setOutputSize] = useState<number | undefined>();

  const [maskPadding, setMaskPadding] = useState(6);
  const [crf, setCrf] = useState(18);
  const [preset, setPreset] = useState<Preset>('medium');
  const [audioMode, setAudioMode] = useState<AudioMode>('aac');
  const [timeRangeEnabled, setTimeRangeEnabled] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);

  const [runtime, setRuntime] = useState<ProPainterRuntimeStatus | null>(null);
  const [checkingRuntime, setCheckingRuntime] = useState(false);
  const [pythonPath, setPythonPath] = useState('');
  const [propainterDir, setPropainterDir] = useState('');
  const [copyHint, setCopyHint] = useState('');
  const [maskDilation, setMaskDilation] = useState(6);
  const [resizeRatio, setResizeRatio] = useState(1);
  const [useFp16, setUseFp16] = useState(true);
  const [subvideoLength, setSubvideoLength] = useState(80);
  const [keepAudio, setKeepAudio] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const cleanRegions = useMemo(
    () =>
      regions
        .filter((region) => region.width >= 4 && region.height >= 4)
        .map((region) => ({
          x: Math.round(region.x),
          y: Math.round(region.y),
          width: Math.round(region.width),
          height: Math.round(region.height),
        })),
    [regions]
  );

  const selectedRegion = regions.find((region) => region.id === activeRegionId) || regions[0];
  const canUseAi = inputPath ? AI_VIDEO_EXTENSIONS.includes(getFileExt(inputPath)) : true;
  const propainterRoot = propainterDir || runtime?.propainterDir || '';
  const normalizedPropainterRoot = propainterRoot.replace(/\//g, '\\');
  const weightsRoot = normalizedPropainterRoot
    ? `${normalizedPropainterRoot.replace(/[\\]+$/, '')}\\weights`
    : '';
  const propainterParentDir = normalizedPropainterRoot ? parentDir(normalizedPropainterRoot) : '';
  const setupGuide = useMemo(
    () =>
      [
        'AI 去除视频水印 - ProPainter 提前准备说明',
        '',
        '官方仓库：https://github.com/sczhou/ProPainter',
        '建议 Python：3.8（推荐 Conda 独立环境；Python 3.14 不推荐）',
        '',
        `推荐安装目录：${normalizedPropainterRoot || '先在工具中选择 ProPainter 目录'}`,
        `权重目录：${weightsRoot || 'ProPainter\\weights'}`,
        '',
        '方式一：命令行准备（推荐在“推荐安装目录”的上一级目录执行）',
        propainterParentDir ? `cd /d "${propainterParentDir}"` : 'cd /d "<ProPainter 上一级目录>"',
        'git clone https://github.com/sczhou/ProPainter.git',
        'cd ProPainter',
        'conda create -n propainter python=3.8 -y',
        'conda activate propainter',
        'pip install -r requirements.txt',
        '',
        '工具里的 Python 输入框建议填写 conda 环境里的 python.exe，或在启动应用前先 conda activate propainter。',
        '',
        '方式二：提前下载权重',
        '进入官方仓库 README 的 pretrained models 下载入口，下载并放到 weights 目录：',
        '1. weights\\ProPainter.pth',
        '2. weights\\recurrent_flow_completion.pth',
        '3. weights\\raft-things.pth',
        '',
        '下载完成后回到工具窗口，选择 ProPainter 目录并点击“检测”。',
      ].join('\n'),
    [normalizedPropainterRoot, propainterParentDir, weightsRoot]
  );

  const copySetupGuide = async () => {
    try {
      await navigator.clipboard.writeText(setupGuide);
      setCopyHint('已复制准备说明');
      window.setTimeout(() => setCopyHint(''), 1800);
    } catch {
      setCopyHint('复制失败，请手动复制');
      window.setTimeout(() => setCopyHint(''), 1800);
    }
  };

  const checkFfmpeg = useCallback(async () => {
    setCheckingFfmpeg(true);
    try {
      setFfmpeg(await invoke<FfmpegStatus>('check_ffmpeg'));
    } catch {
      setFfmpeg({ installed: false });
    } finally {
      setCheckingFfmpeg(false);
    }
  }, []);

  const checkRuntime = useCallback(async () => {
    setCheckingRuntime(true);
    try {
      const status = await invoke<ProPainterRuntimeStatus>('check_propainter_runtime', {
        pythonPath: pythonPath.trim() || null,
        propainterDir: propainterDir.trim() || null,
      });
      setRuntime(status);
      if (!pythonPath && status.pythonPath) setPythonPath(status.pythonPath);
      if (!propainterDir && status.propainterDir) setPropainterDir(status.propainterDir);
    } catch (error) {
      setRuntime({
        ready: false,
        missing: [getErrorMessage(error, 'ProPainter 环境检测失败')],
        warnings: [],
      });
    } finally {
      setCheckingRuntime(false);
    }
  }, [propainterDir, pythonPath]);

  useEffect(() => {
    checkFfmpeg();
  }, [checkFfmpeg]);

  useEffect(() => {
    let mounted = true;
    const initRuntime = async () => {
      setCheckingRuntime(true);
      try {
        const status = await invoke<ProPainterRuntimeStatus>('check_propainter_runtime', {
          pythonPath: null,
          propainterDir: null,
        });
        if (!mounted) return;
        setRuntime(status);
        if (status.pythonPath) setPythonPath(status.pythonPath);
        if (status.propainterDir) setPropainterDir(status.propainterDir);
      } catch (error) {
        if (!mounted) return;
        setRuntime({
          ready: false,
          missing: [getErrorMessage(error, 'ProPainter 环境检测失败')],
          warnings: [],
        });
      } finally {
        if (mounted) setCheckingRuntime(false);
      }
    };
    initRuntime();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (unlistenRef.current) unlistenRef.current();
    };
  }, []);

  const pointFromEvent = (clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage || !videoSize) return null;
    const box = getDisplayBox(stage, videoSize);
    const x = clamp(clientX - box.containerLeft - box.left, 0, box.width);
    const y = clamp(clientY - box.containerTop - box.top, 0, box.height);
    return {
      x: (x / box.width) * videoSize.width,
      y: (y / box.height) * videoSize.height,
    };
  };

  const regionStyle = (region: Region) => {
    const stage = stageRef.current;
    if (!stage || !videoSize) return { display: 'none' };
    const box = getDisplayBox(stage, videoSize);
    return {
      left: `${box.left + (region.x / videoSize.width) * box.width}px`,
      top: `${box.top + (region.y / videoSize.height) * box.height}px`,
      width: `${(region.width / videoSize.width) * box.width}px`,
      height: `${(region.height / videoSize.height) * box.height}px`,
    };
  };

  const handleSelectVideo = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: '视频文件', extensions: VIDEO_EXTENSIONS }],
    });
    if (!selected || typeof selected !== 'string') return;

    setInputPath(selected);
    setInputName(selected.split(/[\\/]/).pop() || selected);
    setVideoUrl(convertFileSrc(selected));
    setResultUrl('');
    setResultPath('');
    setOutputPath('');
    setRegions([]);
    setActiveRegionId('');
    setTaskError('');
    setProgress(0);
    setStage('');
    setOutputSize(undefined);
    setVideoSize(null);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const handleSelectOutput = async () => {
    const path = await save({
      defaultPath: inputPath ? makeDefaultOutputName(inputPath, mode) : 'watermark_removed.mp4',
      filters: [
        { name: 'MP4 视频', extensions: ['mp4'] },
        { name: 'MKV 视频', extensions: ['mkv'] },
        { name: 'MOV 视频', extensions: ['mov'] },
      ],
    });
    if (path) setOutputPath(path);
  };

  const handleSelectPropainterDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === 'string') {
      setPropainterDir(selected);
      setRuntime(null);
    }
  };

  const handleOpenPropainterDir = async () => {
    try {
      const dir = await invoke<string>('ensure_propainter_dirs', {
        propainterDir: propainterRoot || null,
      });
      if (!propainterDir) setPropainterDir(dir);
      await invoke('open_file', { path: dir });
    } catch (error) {
      setTaskError(getErrorMessage(error, '打开 ProPainter 目录失败'));
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setVideoSize({ width: video.videoWidth, height: video.videoHeight });
    setDuration(video.duration || 0);
    setEndTime(video.duration || 0);
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  };

  const seekVideo = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = clamp(value, 0, duration || 0);
    video.currentTime = next;
    setCurrentTime(next);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!videoSize || processing) return;
    const point = pointFromEvent(event.clientX, event.clientY);
    if (!point) return;
    const id = Math.random().toString(36).slice(2);
    dragRef.current = { id, startX: point.x, startY: point.y };
    setActiveRegionId(id);
    setRegions((current) => [...current, { id, x: point.x, y: point.y, width: 1, height: 1 }]);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !videoSize) return;
    const point = pointFromEvent(event.clientX, event.clientY);
    if (!point) return;
    const x = Math.min(drag.startX, point.x);
    const y = Math.min(drag.startY, point.y);
    const width = Math.abs(point.x - drag.startX);
    const height = Math.abs(point.y - drag.startY);
    setRegions((current) =>
      current.map((region) => (region.id === drag.id ? { ...region, x, y, width, height } : region))
    );
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag) return;
    setRegions((current) => current.filter((region) => region.id !== drag.id || (region.width >= 4 && region.height >= 4)));
  };

  const updateSelectedRegion = (patch: Partial<Omit<Region, 'id'>>) => {
    if (!selectedRegion || !videoSize) return;
    setRegions((current) =>
      current.map((region) => {
        if (region.id !== selectedRegion.id) return region;
        const next = { ...region, ...patch };
        return {
          ...next,
          x: clamp(next.x, 0, videoSize.width - 1),
          y: clamp(next.y, 0, videoSize.height - 1),
          width: clamp(next.width, 1, videoSize.width - next.x),
          height: clamp(next.height, 1, videoSize.height - next.y),
        };
      })
    );
  };

  const removeRegion = (id: string) => {
    setRegions((current) => current.filter((region) => region.id !== id));
    if (activeRegionId === id) setActiveRegionId('');
  };

  const startProcessing = async () => {
    if (!inputPath || processing) return;
    if (!cleanRegions.length) {
      setTaskError('请先在视频预览中框选水印区域');
      return;
    }
    if (mode === 'ai' && !canUseAi) {
      setTaskError('ProPainter AI 模式当前建议使用 MP4 / MOV / AVI，其他格式可先用视频格式转换工具转为 MP4');
      return;
    }

    setProcessing(true);
    setTaskError('');
    setResultUrl('');
    setResultPath('');
    setOutputSize(undefined);
    setProgress(0);
    setStage('准备处理');

    if (unlistenRef.current) unlistenRef.current();
    unlistenRef.current = await listen<ProgressPayload>('video-watermark-progress', (event) => {
      const payload = event.payload;
      if (payload.file !== inputPath) return;
      setProgress(payload.percent || 0);
      setStage(payload.stage || '');
      if (payload.status === 'error' && payload.error) setTaskError(payload.error);
      if (payload.output_path) {
        setResultPath(payload.output_path);
        setResultUrl(convertFileSrc(payload.output_path));
      }
      if (payload.output_size) setOutputSize(payload.output_size);
    });

    try {
      const result =
        mode === 'quick'
          ? await invoke<RemoveResult>('video_watermark_remove_fixed', {
              inputPath,
              options: {
                regions: cleanRegions,
                outputPath: outputPath || null,
                outputFormat: 'mp4',
                maskPadding,
                startTime: timeRangeEnabled ? startTime : null,
                endTime: timeRangeEnabled ? endTime : null,
                videoCodec: 'libx264',
                crf,
                preset,
                audioMode,
                showMask: false,
              },
            })
          : await invoke<RemoveResult>('video_watermark_remove_propainter', {
              inputPath,
              options: {
                regions: cleanRegions,
                outputPath: outputPath || null,
                pythonPath: pythonPath.trim() || null,
                propainterDir: propainterDir.trim(),
                maskPadding,
                maskDilation,
                resizeRatio,
                useFp16,
                subvideoLength,
                keepAudio,
              },
            });
      setResultPath(result.outputPath);
      setResultUrl(convertFileSrc(result.outputPath));
      setOutputSize(result.outputSize);
      setProgress(100);
      setStage('完成');
    } catch (error) {
      setTaskError(getErrorMessage(error, '视频去水印失败'));
    } finally {
      setProcessing(false);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="🎞️"
        title="AI 去除视频水印"
        subtitle={ffmpeg?.installed ? `FFmpeg ${ffmpeg.version ?? ''}` : undefined}
      />

      {ffmpeg === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
          <Loader size={18} className="mr-2 animate-spin" />
          检测 FFmpeg...
        </div>
      ) : !ffmpeg.installed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <Film size={42} className="text-orange-500" />
          <h2 className="text-lg font-semibold">需要安装 FFmpeg</h2>
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 text-left dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-2 text-xs text-gray-500">Windows</p>
            <code className="block rounded bg-gray-950 p-2.5 text-xs text-green-400">winget install Gyan.FFmpeg</code>
            <p className="mb-2 mt-3 text-xs text-gray-500">macOS</p>
            <code className="block rounded bg-gray-950 p-2.5 text-xs text-green-400">brew install ffmpeg</code>
          </div>
          <button
            onClick={checkFfmpeg}
            disabled={checkingFfmpeg}
            className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
          >
            {checkingFfmpeg && <Loader size={14} className="animate-spin" />}
            重新检测
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="flex min-w-0 flex-1 flex-col p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg bg-gray-200 p-1 dark:bg-gray-800">
                <button
                  onClick={() => setMode('quick')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === 'quick'
                      ? 'bg-white text-orange-600 shadow-sm dark:bg-gray-700 dark:text-orange-300'
                      : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                >
                  <Eraser size={13} />
                  快速区域
                </button>
                <button
                  onClick={() => setMode('ai')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === 'ai'
                      ? 'bg-white text-emerald-600 shadow-sm dark:bg-gray-700 dark:text-emerald-300'
                      : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                >
                  <Sparkles size={13} />
                  ProPainter AI
                </button>
              </div>
              {inputName && (
                <span className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400">
                  {inputName} · {videoSize ? `${videoSize.width}×${videoSize.height}` : '读取中'} ·{' '}
                  {formatTime(duration)}
                </span>
              )}
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200 bg-gray-950 dark:border-gray-700">
              {!videoUrl ? (
                <button
                  onClick={handleSelectVideo}
                  className="flex h-full w-full flex-col items-center justify-center gap-3 text-gray-400 transition-colors hover:bg-gray-900"
                >
                  <Upload size={32} />
                  <span className="text-sm">选择视频文件</span>
                  <span className="text-xs text-gray-500">MP4 / MOV / MKV / AVI / WebM</span>
                </button>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="h-full w-full object-contain"
                    onLoadedMetadata={handleLoadedMetadata}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                  />
                  <div
                    ref={stageRef}
                    className="absolute inset-0 cursor-crosshair touch-none"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  >
                    {regions.map((region, index) => (
                      <button
                        key={region.id}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          setActiveRegionId(region.id);
                        }}
                        className={`absolute border-2 ${
                          region.id === activeRegionId
                            ? 'border-emerald-300 bg-emerald-400/25'
                            : 'border-orange-300 bg-orange-400/20'
                        }`}
                        style={regionStyle(region)}
                        title={`区域 ${index + 1}`}
                      >
                        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">
                          {index + 1}
                        </span>
                      </button>
                    ))}
                  </div>
                  {!regions.length && videoSize && (
                    <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded bg-black/60 px-2.5 py-1.5 text-xs text-white">
                      <MousePointer2 size={13} />
                      框选水印区域
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
              <button
                onClick={togglePlayback}
                disabled={!videoUrl}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                title={isPlaying ? '暂停' : '播放'}
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <span className="w-12 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                onChange={(event) => seekVideo(Number(event.target.value))}
                disabled={!videoUrl || !duration}
                className="min-w-32 flex-1 accent-orange-500 disabled:opacity-40"
              />
              <span className="w-12 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400">
                {formatTime(duration)}
              </span>
              <button
                onClick={handleSelectVideo}
                disabled={processing}
                className="flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                <Upload size={13} />
                选择视频
              </button>
              <button
                onClick={() => setRegions([])}
                disabled={!regions.length || processing}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40 dark:hover:bg-red-900/20"
              >
                <X size={13} />
                清空区域
              </button>
              <div className="flex-1" />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                当前 {formatTime(currentTime)} · {cleanRegions.length} 个区域
              </span>
            </div>
          </main>

          <aside className="flex w-[380px] flex-shrink-0 flex-col overflow-y-auto border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <section className="border-b border-gray-200 p-4 dark:border-gray-700">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Settings size={15} />
                  处理参数
                </h3>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${mode === 'ai' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'}`}>
                  {mode === 'ai' ? 'AI' : 'FFmpeg'}
                </span>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>遮罩边距</span>
                    <span>{maskPadding}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={maskPadding}
                    onChange={(event) => setMaskPadding(Number(event.target.value))}
                    className="w-full accent-orange-500"
                  />
                </label>

                {mode === 'quick' && (
                  <>
                    <label className="block">
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span>输出质量 CRF</span>
                        <span>{crf}</span>
                      </div>
                      <input
                        type="range"
                        min={14}
                        max={32}
                        value={crf}
                        onChange={(event) => setCrf(Number(event.target.value))}
                        className="w-full accent-orange-500"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">编码速度</span>
                        <select
                          value={preset}
                          onChange={(event) => setPreset(event.target.value as Preset)}
                          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                        >
                          {PRESETS.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">音频</span>
                        <select
                          value={audioMode}
                          onChange={(event) => setAudioMode(event.target.value as AudioMode)}
                          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                        >
                          <option value="aac">AAC 重编码</option>
                          <option value="copy">复制原音频</option>
                          <option value="none">无音频</option>
                        </select>
                      </label>
                    </div>
                  </>
                )}

                {mode === 'ai' && (
                  <>
                    <label className="block">
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span>AI 遮罩扩张</span>
                        <span>{maskDilation}px</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={24}
                        value={maskDilation}
                        onChange={(event) => setMaskDilation(Number(event.target.value))}
                        className="w-full accent-emerald-500"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">缩放比例</span>
                        <select
                          value={resizeRatio}
                          onChange={(event) => setResizeRatio(Number(event.target.value))}
                          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                        >
                          <option value={1}>1.0 原尺寸</option>
                          <option value={0.75}>0.75 更快</option>
                          <option value={0.5}>0.5 省显存</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">分段长度</span>
                        <input
                          type="number"
                          min={20}
                          max={200}
                          value={subvideoLength}
                          onChange={(event) => setSubvideoLength(Number(event.target.value) || 80)}
                          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                        />
                      </label>
                    </div>
                    <div className="flex gap-3 text-xs text-gray-600 dark:text-gray-300">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={useFp16}
                          onChange={(event) => setUseFp16(event.target.checked)}
                          className="accent-emerald-500"
                        />
                        FP16
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={keepAudio}
                          onChange={(event) => setKeepAudio(event.target.checked)}
                          className="accent-emerald-500"
                        />
                        保留音频
                      </label>
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="border-b border-gray-200 p-4 dark:border-gray-700">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Eye size={15} />
                  水印区域
                </h3>
                <span className="text-xs text-gray-400">{cleanRegions.length}</span>
              </div>

              {regions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-3 py-5 text-center text-xs text-gray-400 dark:border-gray-600">
                  在左侧视频上拖拽框选
                </div>
              ) : (
                <div className="space-y-2">
                  {regions.map((region, index) => (
                    <div
                      key={region.id}
                      onClick={() => setActiveRegionId(region.id)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                        region.id === activeRegionId
                          ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                          : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-gray-900 text-[10px] text-white">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        X {Math.round(region.x)} · Y {Math.round(region.y)} · {Math.round(region.width)}×
                        {Math.round(region.height)}
                      </span>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          removeRegion(region.id);
                        }}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {selectedRegion && videoSize && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {([
                    ['x', 'X'],
                    ['y', 'Y'],
                    ['width', '宽'],
                    ['height', '高'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="block">
                      <span className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">{label}</span>
                      <input
                        type="number"
                        min={0}
                        value={Math.round(selectedRegion[key])}
                        onChange={(event) => updateSelectedRegion({ [key]: Number(event.target.value) || 0 })}
                        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                      />
                    </label>
                  ))}
                </div>
              )}
            </section>

            <section className="border-b border-gray-200 p-4 dark:border-gray-700">
              <label className="mb-3 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={timeRangeEnabled}
                  onChange={(event) => setTimeRangeEnabled(event.target.checked)}
                  className="accent-orange-500"
                />
                仅处理指定时间段
              </label>
              {timeRangeEnabled && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">开始秒</span>
                    <input
                      type="number"
                      min={0}
                      max={duration}
                      value={startTime}
                      onChange={(event) => setStartTime(clamp(Number(event.target.value) || 0, 0, duration))}
                      className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">结束秒</span>
                    <input
                      type="number"
                      min={0}
                      max={duration}
                      value={endTime}
                      onChange={(event) => setEndTime(clamp(Number(event.target.value) || 0, 0, duration))}
                      className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                    />
                  </label>
                </div>
              )}

              <button
                onClick={handleSelectOutput}
                className="mt-3 flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
              >
                <span className="flex items-center gap-1.5">
                  <Save size={13} />
                  输出文件
                </span>
                <span className="min-w-0 max-w-[220px] truncate text-gray-500 dark:text-gray-400">
                  {outputPath ? outputPath.split(/[\\/]/).pop() : '默认同源目录'}
                </span>
              </button>
            </section>

            {mode === 'ai' && (
              <section className="border-b border-gray-200 p-4 dark:border-gray-700">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Bot size={15} />
                    ProPainter
                  </h3>
                  <button
                    onClick={checkRuntime}
                    disabled={checkingRuntime}
                    className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-[11px] transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600"
                  >
                    {checkingRuntime && <Loader size={11} className="animate-spin" />}
                    检测
                  </button>
                </div>
                <div className="space-y-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Python</span>
                    <input
                      value={pythonPath}
                      onChange={(event) => setPythonPath(event.target.value)}
                      placeholder="python"
                      className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">ProPainter 目录</span>
                    <div className="flex gap-2">
                      <input
                        value={propainterDir}
                        onChange={(event) => setPropainterDir(event.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                      />
                      <button
                        onClick={handleSelectPropainterDir}
                        className="rounded-md bg-gray-100 px-2 text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                      >
                        <FolderOpen size={14} />
                      </button>
                    </div>
                  </label>
                </div>
                {runtime && (
                  <div
                    className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                      runtime.ready
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300'
                        : 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-900/20 dark:text-orange-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      {runtime.ready ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                      {runtime.ready ? '环境可用' : '环境未就绪'}
                    </div>
                    {runtime.pythonVersion && <p className="mt-1 opacity-80">{runtime.pythonVersion}</p>}
                    {runtime.missing?.length > 0 && <p className="mt-1">缺少：{runtime.missing.join('、')}</p>}
                    {runtime.warnings?.length > 0 && <p className="mt-1 opacity-80">{runtime.warnings[0]}</p>}
                    </div>
                  )}
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-200">
                  <div className="mb-2 flex items-start gap-2">
                    <Info size={14} className="mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">可以提前准备 ProPainter</p>
                      <p className="mt-0.5 text-blue-700/80 dark:text-blue-200/80">
                        AI 模式依赖官方 ProPainter 仓库、Python 3.8 环境和 weights 权重目录；准备好后点“检测”即可。
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5 rounded-md bg-white/70 p-2 font-mono text-[11px] text-blue-900 dark:bg-gray-900/40 dark:text-blue-100">
                    <p>{propainterParentDir ? `cd /d "${propainterParentDir}"` : 'cd /d "ProPainter 上一级目录"'}</p>
                    <p>git clone https://github.com/sczhou/ProPainter.git</p>
                    <p>cd ProPainter</p>
                    <p>conda create -n propainter python=3.8 -y</p>
                    <p>conda activate propainter</p>
                    <p>pip install -r requirements.txt</p>
                  </div>
                  <div className="mt-2 space-y-1 text-blue-700/85 dark:text-blue-200/85">
                    <p>
                      命令执行位置：先进入 ProPainter 的上一级目录，再 clone；`pip install` 要在
                      ProPainter 仓库目录内执行。
                    </p>
                    <p>权重放置目录：{weightsRoot || 'ProPainter\\weights'}</p>
                    <p>需要文件：ProPainter.pth / recurrent_flow_completion.pth / raft-things.pth</p>
                    <p>Python 输入框建议填 Conda 环境里的 python.exe，当前系统 Python 3.14 不推荐。</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={copySetupGuide}
                      className="rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-blue-700"
                    >
                      复制准备说明
                    </button>
                    <button
                      onClick={handleOpenPropainterDir}
                      className="rounded-md bg-white px-2.5 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 dark:bg-gray-800 dark:text-blue-200 dark:hover:bg-gray-700"
                    >
                      打开目录
                    </button>
                    <a
                      href="https://github.com/sczhou/ProPainter"
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md bg-white px-2.5 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:bg-gray-800 dark:text-blue-200 dark:hover:bg-gray-700"
                    >
                      官方仓库
                    </a>
                    {copyHint && <span className="self-center text-[11px]">{copyHint}</span>}
                  </div>
                </div>
                {!canUseAi && (
                  <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700 dark:border-orange-900 dark:bg-orange-900/20 dark:text-orange-300">
                    ProPainter AI 模式当前建议使用 MP4 / MOV / AVI。
                  </div>
                )}
              </section>
            )}

            <section className="mt-auto p-4">
              {processing && (
                <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                    <span>{stage || '处理中'}</span>
                    <span>{progress.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className={`h-full rounded-full transition-all ${mode === 'ai' ? 'bg-emerald-500' : 'bg-orange-500'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {taskError && (
                <div className="mb-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span className="line-clamp-3">{taskError}</span>
                </div>
              )}

              {resultPath && (
                <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300">
                  <div className="flex items-center gap-1.5 font-medium">
                    <CheckCircle size={13} />
                    已生成 {formatBytes(outputSize)}
                  </div>
                  {resultUrl && (
                    <video
                      src={resultUrl}
                      controls
                      className="mt-2 max-h-44 w-full rounded-md bg-black"
                      preload="metadata"
                    />
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => invoke('open_file', { path: resultPath })}
                      className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-700"
                    >
                      <Play size={12} />
                      打开
                    </button>
                    <button
                      onClick={() => invoke('show_in_folder', { path: resultPath })}
                      className="flex items-center gap-1 rounded bg-white px-2 py-1 text-emerald-700 hover:bg-emerald-100 dark:bg-gray-800 dark:text-emerald-300 dark:hover:bg-gray-700"
                    >
                      <FolderOpen size={12} />
                      文件夹
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={startProcessing}
                disabled={!inputPath || !cleanRegions.length || processing || (mode === 'ai' && !propainterDir.trim())}
                className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-600 ${
                  mode === 'ai' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-orange-500 hover:bg-orange-600'
                }`}
              >
                {processing ? <Loader size={15} className="animate-spin" /> : mode === 'ai' ? <Sparkles size={15} /> : <Eraser size={15} />}
                {processing ? '处理中...' : mode === 'ai' ? '开始 AI 去水印' : '开始快速去水印'}
              </button>

              <div className="mt-3 flex items-start gap-2 text-[11px] text-gray-400">
                <Info size={12} className="mt-0.5 flex-shrink-0" />
                <span>仅处理你拥有或已获授权的视频素材。</span>
              </div>
            </section>
          </aside>
        </div>
      )}

      {resultUrl && (
        <div className="hidden">
          <video src={resultUrl} preload="metadata" />
        </div>
      )}
    </div>
  );
}
