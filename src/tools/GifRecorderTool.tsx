import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { save } from '@tauri-apps/api/dialog';
import { appWindow, LogicalSize } from '@tauri-apps/api/window';
import {
  CheckCircle2,
  FolderOpen,
  Loader2,
  MousePointer2,
  Play,
  RefreshCw,
  Save,
  StopCircle,
  X,
} from 'lucide-react';
import { useToolTheme } from './useToolTheme';

interface FfmpegStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RecordingStatus {
  active: boolean;
  paused: boolean;
  outputPath?: string;
  elapsedMs: number;
}

interface StopResult {
  outputPath: string;
  fileSize?: number;
  elapsedMs: number;
}

const FPS_OPTIONS = [8, 10, 12, 15, 20, 24];
const TOOLBAR_HEIGHT = 54;
const FRAME_BORDER = 3;

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function setCaptureExcluded(enable: boolean) {
  await invoke('screen_recording_set_window_capture_excluded', {
    label: appWindow.label,
    enable,
  }).catch(() => undefined);
}

function FfmpegGuide({ onRecheck, checking }: { onRecheck: () => void; checking: boolean }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-lg border border-amber-200 bg-white text-gray-900 shadow-2xl dark:border-amber-900/50 dark:bg-gray-900 dark:text-gray-100">
      <div className="flex h-12 items-center justify-between border-b border-gray-200 px-3 dark:border-gray-800" data-tauri-drag-region>
        <div className="text-sm font-semibold" data-tauri-drag-region>GIF 小工具</div>
        <button onClick={() => void appWindow.close()} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-800" title="关闭">
          <X size={16} />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-sm font-semibold text-amber-600 dark:bg-amber-950/30 dark:text-amber-300">
          GIF
        </div>
        <div>
          <h2 className="text-sm font-semibold">需要安装 FFmpeg</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">GIF 录制需要 FFmpeg 采集屏幕区域并生成动图。</p>
        </div>
        <code className="block max-w-full select-all overflow-auto rounded bg-gray-950 p-2 text-[11px] text-green-400">winget install Gyan.FFmpeg</code>
        <button
          onClick={onRecheck}
          disabled={checking}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs text-white disabled:opacity-50"
        >
          {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          重新检测
        </button>
      </div>
    </div>
  );
}

export default function GifRecorderTool() {
  const ready = useToolTheme();
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [captureRegion, setCaptureRegion] = useState<CaptureRegion | null>(null);
  const [fps, setFps] = useState(12);
  const [drawMouse, setDrawMouse] = useState(true);
  const [starting, setStarting] = useState(false);
  const [outputPath, setOutputPath] = useState('');
  const [status, setStatus] = useState<RecordingStatus>({ active: false, paused: false, elapsedMs: 0 });
  const [lastResult, setLastResult] = useState<StopResult | null>(null);
  const [error, setError] = useState('');

  const checkFfmpeg = async () => {
    setChecking(true);
    try {
      setFfmpeg(await invoke<FfmpegStatus>('check_ffmpeg'));
    } catch {
      setFfmpeg({ installed: false });
    } finally {
      setChecking(false);
    }
  };

  const refreshStatus = async () => {
    try {
      const next = await invoke<RecordingStatus>('screen_recording_get_status');
      setStatus(next);
    } catch {
      setStatus({ active: false, paused: false, elapsedMs: 0 });
    }
  };

  const loadDefaultPath = async () => {
    try {
      setOutputPath(await invoke<string>('screen_recording_default_output_path', { format: 'gif' }));
    } catch {
      setOutputPath('');
    }
  };

  const getCaptureRegion = async (): Promise<CaptureRegion> => {
    const [position, size, scaleFactor] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
      appWindow.scaleFactor().catch(() => 1),
    ]);
    const border = Math.round(FRAME_BORDER * scaleFactor);
    const toolbar = Math.round(TOOLBAR_HEIGHT * scaleFactor);
    return {
      x: Math.round(position.x + border),
      y: Math.round(position.y + toolbar + border),
      width: Math.max(16, Math.round(size.width - border * 2)),
      height: Math.max(16, Math.round(size.height - toolbar - border * 2)),
    };
  };

  const refreshCaptureRegion = async () => {
    const next = await getCaptureRegion();
    setCaptureRegion(next);
    return next;
  };

  useEffect(() => {
    const previousHtmlBg = document.documentElement.style.background;
    const previousBodyBg = document.body.style.background;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';

    void appWindow.setMinSize(new LogicalSize(340, 240)).catch(() => undefined);
    void appWindow.setAlwaysOnTop(true).catch(() => undefined);
    void setCaptureExcluded(false);
    void checkFfmpeg();
    void loadDefaultPath();
    void refreshStatus();
    void refreshCaptureRegion().catch(() => undefined);

    return () => {
      document.documentElement.style.background = previousHtmlBg;
      document.body.style.background = previousBodyBg;
      void setCaptureExcluded(false);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const setup = async () => {
      const moved = await appWindow.onMoved(() => {
        void refreshCaptureRegion().catch(() => undefined);
      });
      const resized = await appWindow.onResized(() => {
        void refreshCaptureRegion().catch(() => undefined);
      });
      if (disposed) {
        moved();
        resized();
        return;
      }
      unlisteners.push(moved, resized);
    };
    void setup();
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!status.active) return;
    const timer = window.setInterval(() => void refreshStatus(), 1000);
    return () => window.clearInterval(timer);
  }, [status.active]);

  const chooseOutput = async () => {
    const selected = await save({
      defaultPath: outputPath,
      filters: [{ name: 'GIF 动图', extensions: ['gif'] }],
    });
    if (selected) setOutputPath(selected.endsWith('.gif') ? selected : `${selected}.gif`);
  };

  const startRecording = async () => {
    setError('');
    setLastResult(null);
    if (!outputPath.trim()) {
      setError('请选择 GIF 保存位置');
      return;
    }
    const path = outputPath.endsWith('.gif') ? outputPath : `${outputPath}.gif`;
    try {
      await setCaptureExcluded(false);
      const region = await refreshCaptureRegion();
      if (region.width < 32 || region.height < 32) {
        setError('录制窗口太小，请先放大窗口');
        return;
      }
      setStarting(true);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const next = await invoke<RecordingStatus>('screen_recording_start', {
        options: {
          sourceMode: 'region',
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          outputPath: path,
          fps,
          quality: 'quality',
          drawMouse,
          audioMode: 'none',
        },
      });
      setOutputPath(path);
      setStatus(next);
      setStarting(false);
    } catch (err) {
      setStarting(false);
      await invoke('screen_recording_stop').catch(() => undefined);
      await refreshStatus();
      setError(`启动 GIF 录制失败: ${err}`);
    }
  };

  const stopRecording = async () => {
    setError('');
    try {
      const result = await invoke<StopResult>('screen_recording_stop');
      setLastResult(result);
      await refreshStatus();
    } catch (err) {
      setError(`停止录制失败: ${err}`);
    }
  };

  const openResultFolder = async () => {
    const path = lastResult?.outputPath || outputPath;
    if (!path) return;
    await invoke('show_in_folder', { path });
  };

  if (!ready) return null;

  const captureActive = status.active || starting;

  if (ffmpeg === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-transparent">
        <Loader2 size={22} className="animate-spin text-blue-500" />
      </div>
    );
  }

  if (!ffmpeg.installed) {
    return <FfmpegGuide onRecheck={checkFfmpeg} checking={checking} />;
  }

  return (
    <div className="h-screen w-screen select-none overflow-hidden bg-transparent text-gray-900 dark:text-gray-100">
      <div className="relative flex h-full flex-col overflow-hidden rounded-lg border-[3px] border-blue-500 bg-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.75),0_12px_30px_rgba(37,99,235,0.25)]">
        <div
          className="flex h-[54px] flex-shrink-0 items-center gap-2 border-b border-gray-200 bg-white/95 px-2 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95"
          data-tauri-drag-region
        >
          <div className="min-w-0 flex-1" data-tauri-drag-region>
            <div className="flex items-center gap-2" data-tauri-drag-region>
              <span className={`h-2 w-2 rounded-full ${status.active ? 'animate-pulse bg-red-500' : 'bg-blue-500'}`} />
              <span className="truncate text-sm font-semibold" data-tauri-drag-region>GIF 小工具</span>
              <span className="font-mono text-xs text-gray-500 dark:text-gray-400" data-tauri-drag-region>
                {formatDuration(status.elapsedMs)}
              </span>
            </div>
            <div className="truncate text-[10px] text-gray-500 dark:text-gray-400" data-tauri-drag-region>
              {captureRegion ? `${captureRegion.width} x ${captureRegion.height}` : '移动或缩放窗口确定录制区域'}
              {lastResult ? ` · 已保存 ${formatSize(lastResult.fileSize)}` : ''}
            </div>
          </div>

          <select
            value={fps}
            onChange={(event) => setFps(Number(event.target.value))}
            disabled={captureActive}
            className="h-8 w-[72px] rounded-md border border-gray-200 bg-white px-1 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
            title="GIF 帧率"
          >
            {FPS_OPTIONS.map((item) => (
              <option key={item} value={item}>{item} FPS</option>
            ))}
          </select>

          <label className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-[11px] dark:border-gray-700 dark:bg-gray-950" title="录制鼠标指针">
            <input type="checkbox" checked={drawMouse} disabled={captureActive} onChange={(event) => setDrawMouse(event.target.checked)} />
            鼠标
          </label>

          <button
            onClick={() => void chooseOutput()}
            disabled={captureActive}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-800"
            title="选择保存位置"
          >
            <Save size={15} />
          </button>

          {!captureActive ? (
            <button
              onClick={() => void startRecording()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
              title="开始录制"
            >
              <Play size={14} />
              录制
            </button>
          ) : (
            <button
              onClick={() => void stopRecording()}
              disabled={starting}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700"
              title="停止并保存 GIF"
            >
              {starting ? <Loader2 size={14} className="animate-spin" /> : <StopCircle size={14} />}
              {starting ? '启动中' : '停止'}
            </button>
          )}

          <button
            onClick={() => void appWindow.close()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative min-h-0 flex-1 bg-transparent">
          {!captureActive && (
            <>
              <div className="pointer-events-none absolute inset-3 rounded border border-dashed border-blue-400/70" />
              <div className="pointer-events-none absolute left-3 top-3 h-5 w-5 border-l-2 border-t-2 border-blue-500" />
              <div className="pointer-events-none absolute right-3 top-3 h-5 w-5 border-r-2 border-t-2 border-blue-500" />
              <div className="pointer-events-none absolute bottom-3 left-3 h-5 w-5 border-b-2 border-l-2 border-blue-500" />
              <div className="pointer-events-none absolute bottom-3 right-3 h-5 w-5 border-b-2 border-r-2 border-blue-500" />
            </>
          )}
          {!captureActive && !lastResult && (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-md bg-white/90 px-3 py-2 text-center text-xs text-gray-600 shadow-sm backdrop-blur dark:bg-gray-900/90 dark:text-gray-300">
              把这个窗口移动到要录制的位置，拖动边缘调整大小后点击录制
            </div>
          )}
          {lastResult && !captureActive && (
            <button
              onClick={() => void openResultFolder()}
              className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-md bg-white/95 px-3 py-2 text-xs font-medium text-green-700 shadow hover:bg-green-50 dark:bg-gray-900/95 dark:text-green-300 dark:hover:bg-gray-800"
            >
              <CheckCircle2 size={14} />
              GIF 已保存
              <FolderOpen size={14} />
            </button>
          )}
          {error && (
            <div className="absolute inset-x-4 bottom-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow dark:border-red-900/50 dark:bg-red-950/90 dark:text-red-200">
              {error}
            </div>
          )}
          {!captureActive && <MousePointer2 className="pointer-events-none absolute right-4 top-4 text-blue-500/50" size={18} />}
        </div>
      </div>
    </div>
  );
}
