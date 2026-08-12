import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { appWindow, WebviewWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/api/dialog';
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Maximize,
  Monitor,
  MousePointer2,
  Pause,
  Image as ImageIcon,
  Play,
  RefreshCw,
  Square,
  StopCircle,
  Video,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

interface FfmpegStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

interface ScreenInfo {
  index: number;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
}

interface RecordableWindow {
  hwnd: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
}

interface RecordingStatus {
  active: boolean;
  paused: boolean;
  sourceMode?: SourceMode;
  audioMode?: AudioMode;
  outputPath?: string;
  elapsedMs: number;
  pausedMs: number;
}

interface AudioDevice {
  name: string;
  kind: 'microphone' | 'system' | string;
}

interface StopResult {
  outputPath: string;
  fileSize?: number;
  elapsedMs: number;
}

type SourceMode = 'fullscreen' | 'region' | 'window';
type Quality = 'lossless' | 'quality' | 'balanced' | 'small';
type AudioMode = 'none' | 'microphone' | 'system' | 'mixed';
type WatermarkKind = 'text' | 'image';
type WatermarkMode = 'static' | 'dynamic';
type WatermarkLayout = 'single' | 'tile';
type WatermarkPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';
type WatermarkMotion = 'horizontal' | 'vertical' | 'diagonal' | 'blink';

interface WatermarkConfig {
  enabled: boolean;
  kind: WatermarkKind;
  text: string;
  imagePath: string;
  mode: WatermarkMode;
  motion: WatermarkMotion;
  layout: WatermarkLayout;
  position: WatermarkPosition;
  fontSize: number;
  color: string;
  opacity: number;
  angle: number;
  margin: number;
  spacingX: number;
  spacingY: number;
  imageWidth: number;
}

const SOURCE_OPTIONS: Array<{
  id: SourceMode;
  label: string;
  desc: string;
  icon: React.ReactNode;
}> = [
  { id: 'fullscreen', label: '全屏', desc: '录制显示器完整画面', icon: <Monitor size={18} /> },
  { id: 'region', label: '区域', desc: '拖拽框选一块区域', icon: <Square size={18} /> },
  { id: 'window', label: '窗口', desc: '按软件窗口录制', icon: <Maximize size={18} /> },
];

const FPS_OPTIONS = [15, 24, 30, 45, 60];

const AUDIO_OPTIONS: Array<{
  id: AudioMode;
  label: string;
  desc: string;
}> = [
  { id: 'none', label: '无音频', desc: '只录制画面' },
  { id: 'microphone', label: '麦克风', desc: '录制一个输入设备' },
  { id: 'system', label: '系统声音', desc: '选择立体声混音或虚拟声卡' },
  { id: 'mixed', label: '混音', desc: '同时录制两个音频设备' },
];

const WATERMARK_POSITIONS: Array<{ id: WatermarkPosition; label: string }> = [
  { id: 'top-left', label: '左上' },
  { id: 'top', label: '上中' },
  { id: 'top-right', label: '右上' },
  { id: 'left', label: '左中' },
  { id: 'center', label: '居中' },
  { id: 'right', label: '右中' },
  { id: 'bottom-left', label: '左下' },
  { id: 'bottom', label: '下中' },
  { id: 'bottom-right', label: '右下' },
];

const DEFAULT_WATERMARK: WatermarkConfig = {
  enabled: false,
  kind: 'text',
  text: 'McStartUP',
  imagePath: '',
  mode: 'static',
  motion: 'horizontal',
  layout: 'single',
  position: 'bottom-right',
  fontSize: 28,
  color: '#ffffff',
  opacity: 0.45,
  angle: 0,
  margin: 24,
  spacingX: 220,
  spacingY: 140,
  imageWidth: 180,
};

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((part) => part.toString().padStart(2, '0')).join(':');
}

function formatSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function toWatermarkPayload(watermark: WatermarkConfig) {
  if (!watermark.enabled) return undefined;
  return {
    enabled: true,
    kind: watermark.kind,
    text: watermark.text,
    imagePath: watermark.imagePath,
    mode: watermark.mode,
    motion: watermark.motion,
    layout: watermark.layout,
    position: watermark.position,
    fontSize: watermark.fontSize,
    color: watermark.color,
    opacity: watermark.opacity,
    angle: watermark.angle,
    margin: watermark.margin,
    spacingX: watermark.spacingX,
    spacingY: watermark.spacingY,
    imageWidth: watermark.imageWidth,
  };
}

function boundsText(target: { x: number; y: number; width: number; height: number }) {
  return `${target.width} x ${target.height} · X ${target.x} · Y ${target.y}`;
}

function SourcePreview({
  sourceMode,
  screen,
  region,
  windowTarget,
}: {
  sourceMode: SourceMode;
  screen?: ScreenInfo;
  region: { x: number; y: number; width: number; height: number } | null;
  windowTarget?: RecordableWindow;
}) {
  const target =
    sourceMode === 'fullscreen'
      ? screen
        ? {
            title: `屏幕 ${screen.index + 1}${screen.is_primary ? ' · 主屏' : ''}`,
            subtitle: boundsText(screen),
            x: screen.x,
            y: screen.y,
            width: screen.width,
            height: screen.height,
            emptyText: '',
            warning: '',
          }
        : null
      : sourceMode === 'region'
        ? region
          ? {
              title: '自定义录制区域',
              subtitle: boundsText(region),
              x: region.x,
              y: region.y,
              width: region.width,
              height: region.height,
              emptyText: '',
              warning: '',
            }
          : null
        : windowTarget
          ? {
              title: windowTarget.title,
              subtitle: boundsText(windowTarget),
              x: windowTarget.x,
              y: windowTarget.y,
              width: windowTarget.width,
              height: windowTarget.height,
              emptyText: '',
              warning: windowTarget.minimized ? '窗口已最小化，录制前请确认窗口可见。' : '',
            }
          : null;

  const emptyText =
    sourceMode === 'fullscreen'
      ? '未读取到显示器信息'
      : sourceMode === 'region'
        ? '选择区域后将在这里显示录制范围'
        : '选择窗口后将在这里显示录制范围';
  const aspectRatio = target
    ? `${Math.max(1, Math.abs(target.width))} / ${Math.max(1, Math.abs(target.height))}`
    : '16 / 9';
  const toneClass =
    sourceMode === 'window'
      ? 'border-emerald-400 bg-emerald-500/10 text-emerald-100'
      : sourceMode === 'region'
        ? 'border-amber-400 bg-amber-500/10 text-amber-100'
        : 'border-blue-400 bg-blue-500/10 text-blue-100';

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-300">录制范围预览</div>
        <div className="text-[11px] text-gray-400">范围示意，非实时画面</div>
      </div>
      <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
        {target ? (
          <>
            <div className="flex min-h-[150px] items-center justify-center">
              <div
                className={`relative h-40 max-w-full rounded-md border-2 ${toneClass}`}
                style={{ aspectRatio }}
              >
                <div className="absolute inset-0 rounded-[5px] border border-white/10" />
                <div className="absolute left-3 top-3 max-w-[calc(100%-24px)] truncate text-xs font-medium">
                  {sourceMode === 'fullscreen' ? '全屏' : sourceMode === 'region' ? '自定义区域' : '窗口'}
                </div>
                <div className="absolute bottom-3 left-3 right-3 truncate text-[11px] opacity-80">
                  {target.width} x {target.height}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="min-w-0 rounded bg-white px-2 py-1.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                <div className="text-[10px] text-gray-400">目标</div>
                <div className="truncate">{target.title}</div>
              </div>
              <div className="rounded bg-white px-2 py-1.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                <div className="text-[10px] text-gray-400">范围</div>
                <div className="truncate">{target.subtitle}</div>
              </div>
            </div>
            {target.warning && (
              <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {target.warning}
              </div>
            )}
          </>
        ) : (
          <div className="flex min-h-[150px] items-center justify-center rounded-md border border-dashed border-gray-700 text-sm text-gray-400">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}

function FfmpegGuide({ onRecheck, checking }: { onRecheck: () => void; checking: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300">
        <Video size={28} />
      </div>
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          需要安装 FFmpeg
        </h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          屏幕录制使用本机 FFmpeg 进行采集和编码。
        </p>
      </div>
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-gray-50 p-4 text-left dark:border-gray-700 dark:bg-gray-800">
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">Windows 推荐安装方式</p>
        <code className="block select-all rounded bg-gray-950 p-2.5 text-xs text-green-400">
          winget install Gyan.FFmpeg
        </code>
      </div>
      <button
        onClick={onRecheck}
        disabled={checking}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
      >
        {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        重新检测
      </button>
    </div>
  );
}

export default function ScreenRecordingTool() {
  const ready = useToolTheme();
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [screens, setScreens] = useState<ScreenInfo[]>([]);
  const [windows, setWindows] = useState<RecordableWindow[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>('fullscreen');
  const [selectedScreen, setSelectedScreen] = useState(0);
  const [selectedWindow, setSelectedWindow] = useState('');
  const [region, setRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null
  );
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState<Quality>('quality');
  const [drawMouse, setDrawMouse] = useState(true);
  const [audioMode, setAudioMode] = useState<AudioMode>('none');
  const [audioDevice, setAudioDevice] = useState('');
  const [audioDevice2, setAudioDevice2] = useState('');
  const [watermark, setWatermark] = useState<WatermarkConfig>(DEFAULT_WATERMARK);
  const [outputPath, setOutputPath] = useState('');
  const [status, setStatus] = useState<RecordingStatus>({
    active: false,
    paused: false,
    elapsedMs: 0,
    pausedMs: 0,
  });
  const [lastResult, setLastResult] = useState<StopResult | null>(null);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);

  const activeWindow = windows.find((item) => item.hwnd === selectedWindow);
  const activeScreen = screens.find((item) => item.index === selectedScreen);
  const busy = status.active || countdown !== null;
  const systemAudioDevices = audioDevices.filter((device) => device.kind === 'system');

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

  const loadScreens = async () => {
    try {
      const items = await invoke<ScreenInfo[]>('screenshot_get_screens_info');
      setScreens(items);
      const primary = items.find((item) => item.is_primary) ?? items[0];
      if (primary) setSelectedScreen(primary.index);
    } catch (err) {
      console.error('load screens failed', err);
    }
  };

  const loadWindows = async () => {
    setLoadingWindows(true);
    try {
      const items = await invoke<RecordableWindow[]>('screen_recording_list_windows');
      setWindows(items);
      if (!items.some((item) => item.hwnd === selectedWindow)) {
        setSelectedWindow(items[0]?.hwnd ?? '');
      }
    } catch (err) {
      setError(`窗口列表读取失败: ${err}`);
    } finally {
      setLoadingWindows(false);
    }
  };

  const loadAudioDevices = async () => {
    setLoadingAudio(true);
    try {
      const items = await invoke<AudioDevice[]>('screen_recording_list_audio_devices');
      setAudioDevices(items);
      if (!items.some((item) => item.name === audioDevice)) {
        const preferred = items.find((item) => item.kind !== 'system') ?? items[0];
        setAudioDevice(preferred?.name ?? '');
      }
      if (!items.some((item) => item.name === audioDevice2)) {
        const preferredSystem = items.find((item) => item.kind === 'system');
        setAudioDevice2(preferredSystem?.name ?? '');
      }
    } catch (err) {
      setError(`音频设备读取失败: ${err}`);
    } finally {
      setLoadingAudio(false);
    }
  };

  const loadDefaultPath = async () => {
    try {
      setOutputPath(await invoke<string>('screen_recording_default_output_path', { format: 'mp4' }));
    } catch (err) {
      console.error('default output path failed', err);
    }
  };

  const refreshStatus = async () => {
    try {
      setStatus(await invoke<RecordingStatus>('screen_recording_get_status'));
    } catch {
      setStatus({ active: false, paused: false, elapsedMs: 0, pausedMs: 0 });
    }
  };

  const closeControllerWindow = async () => {
    const controller = WebviewWindow.getByLabel('screen-recording-controller');
    if (controller) {
      await controller.close().catch(() => undefined);
    }
  };

  const openControllerWindow = async () => {
    const existing = WebviewWindow.getByLabel('screen-recording-controller');
    if (existing) {
      await existing.show().catch(() => undefined);
      await existing.setFocus().catch(() => undefined);
      return;
    }

    const controller = new WebviewWindow('screen-recording-controller', {
      url: '/screen-recording-controller',
      title: '屏幕录制控制',
      width: 360,
      height: 74,
      decorations: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      center: true,
      visible: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('控制条窗口创建超时')), 2500);
      controller.once('tauri://created', () => {
        window.clearTimeout(timeout);
        resolve();
      });
      controller.once('tauri://error', (event) => {
        window.clearTimeout(timeout);
        reject(new Error(`控制条窗口创建失败: ${String(event.payload ?? '')}`));
      });
    });
  };

  useEffect(() => {
    void checkFfmpeg();
    void loadScreens();
    void loadWindows();
    void loadAudioDevices();
    void loadDefaultPath();
    void refreshStatus();
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const setupListeners = async () => {
      const stopped = await listen<StopResult>('screen-recording-stopped', async (event) => {
        setLastResult(event.payload);
        setCountdown(null);
        await refreshStatus();
        await appWindow.show();
        await appWindow.setFocus();
      });
      const stopError = await listen<string>('screen-recording-stop-error', async (event) => {
        setError(`停止录制失败: ${event.payload}`);
        await appWindow.show();
        await appWindow.setFocus();
      });
      const mainRequested = await listen('screen-recording-main-requested', async () => {
        await appWindow.show();
        await appWindow.setFocus();
      });

      if (disposed) {
        stopped();
        stopError();
        mainRequested();
        return;
      }
      unlisteners.push(stopped, stopError, mainRequested);
    };

    void setupListeners();
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!status.active) return;
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status.active]);

  const chooseRegion = async () => {
    setError('');
    await appWindow.hide();
    await new Promise((resolve) => setTimeout(resolve, 120));

    const picker = new WebviewWindow('screen-recording-region-picker', {
      url: '/screen-recording-region-picker',
      title: '选择录制区域',
      fullscreen: true,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      visible: false,
    });

    const unlistenSelected = await listen<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>('screen-recording-region-selected', async (event) => {
      setRegion(event.payload);
      setSourceMode('region');
      await appWindow.show();
      await appWindow.setFocus();
      unlistenSelected();
      unlistenCancelled();
    });

    const unlistenCancelled = await listen('screen-recording-region-cancelled', async () => {
      await appWindow.show();
      await appWindow.setFocus();
      unlistenSelected();
      unlistenCancelled();
    });

    picker.once('tauri://error', async () => {
      await appWindow.show();
      await appWindow.setFocus();
      setError('区域选择窗口创建失败');
      unlistenSelected();
      unlistenCancelled();
    });
  };

  const chooseOutput = async () => {
    const selected = await save({
      defaultPath: outputPath,
      filters: [
        { name: 'MP4 视频', extensions: ['mp4'] },
        { name: 'WebM 视频', extensions: ['webm'] },
        { name: 'MKV 视频', extensions: ['mkv'] },
        { name: 'MOV 视频', extensions: ['mov'] },
      ],
    });
    if (selected) setOutputPath(selected);
  };

  const chooseWatermarkImage = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
      ],
    });
    if (typeof selected === 'string') {
      setWatermark((prev) => ({ ...prev, imagePath: selected, kind: 'image', enabled: true }));
    }
  };

  const startRecording = async () => {
    setError('');
    setLastResult(null);

    if (!outputPath.trim()) {
      setError('请选择输出文件');
      return;
    }
    if (sourceMode === 'region' && !region) {
      setError('请先选择录制区域');
      return;
    }
    if (sourceMode === 'window' && !selectedWindow) {
      setError('请选择要录制的软件窗口');
      return;
    }
    if ((audioMode === 'microphone' || audioMode === 'system') && !audioDevice) {
      setError('请选择音频设备，或切换为无音频');
      return;
    }
    if (audioMode === 'mixed' && (!audioDevice || !audioDevice2)) {
      setError('混音录制需要选择两个音频设备');
      return;
    }
    if (audioMode === 'mixed' && audioDevice === audioDevice2) {
      setError('混音录制的两个音频设备不能相同');
      return;
    }
    if (watermark.enabled && watermark.kind === 'text' && !watermark.text.trim()) {
      setError('请输入水印文字，或关闭水印');
      return;
    }
    if (watermark.enabled && watermark.kind === 'image' && !watermark.imagePath.trim()) {
      setError('请选择水印图片，或关闭水印');
      return;
    }

    const payload = {
      sourceMode,
      screenIndex: sourceMode === 'fullscreen' ? selectedScreen : undefined,
      x: sourceMode === 'region' ? region?.x : undefined,
      y: sourceMode === 'region' ? region?.y : undefined,
      width: sourceMode === 'region' ? region?.width : undefined,
      height: sourceMode === 'region' ? region?.height : undefined,
      hwnd: sourceMode === 'window' ? selectedWindow : undefined,
      outputPath,
      fps,
      quality,
      drawMouse,
      audioMode,
      audioDevice: audioMode === 'none' ? undefined : audioDevice,
      audioDevice2: audioMode === 'mixed' ? audioDevice2 : undefined,
      watermark: toWatermarkPayload(watermark),
    };

    try {
      for (let value = 3; value > 0; value -= 1) {
        setCountdown(value);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      setCountdown(null);
      await appWindow.hide();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const nextStatus = await invoke<RecordingStatus>('screen_recording_start', { options: payload });
      setStatus(nextStatus);
      await openControllerWindow();
    } catch (err) {
      setCountdown(null);
      await closeControllerWindow();
      await appWindow.show();
      await appWindow.setFocus();
      setError(`启动录制失败: ${err}`);
    }
  };

  const stopRecording = async () => {
    setError('');
    try {
      const result = await invoke<StopResult>('screen_recording_stop');
      setLastResult(result);
      await closeControllerWindow();
      await refreshStatus();
    } catch (err) {
      setError(`停止录制失败: ${err}`);
    }
  };

  const togglePause = async () => {
    setError('');
    try {
      const next = await invoke<RecordingStatus>(
        status.paused ? 'screen_recording_resume' : 'screen_recording_pause'
      );
      setStatus(next);
    } catch (err) {
      setError(`${status.paused ? '继续' : '暂停'}录制失败: ${err}`);
    }
  };

  const openResultFolder = async () => {
    const path = lastResult?.outputPath || outputPath;
    if (!path) return;
    await invoke('show_in_folder', { path });
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="⏺"
        title="屏幕录制"
        subtitle={ffmpeg?.installed ? `FFmpeg ${ffmpeg.version ?? ''}` : undefined}
      />

      {ffmpeg === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={24} className="animate-spin text-blue-500" />
        </div>
      ) : !ffmpeg.installed ? (
        <FfmpegGuide onRecheck={checkFfmpeg} checking={checking} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-0">
          <div className="min-h-0 overflow-y-auto p-5">
            <div className="mb-5 grid grid-cols-3 gap-3">
              {SOURCE_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSourceMode(item.id)}
                  disabled={busy}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    sourceMode === item.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-200'
                      : 'border-gray-200 bg-white hover:border-blue-300 dark:border-gray-700 dark:bg-gray-800'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    {item.icon}
                    {item.label}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{item.desc}</p>
                </button>
              ))}
            </div>

            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              {sourceMode === 'fullscreen' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">选择显示器</h2>
                    <button
                      onClick={() => void loadScreens()}
                      disabled={busy}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-500 dark:hover:bg-gray-700"
                      title="刷新显示器"
                    >
                      <RefreshCw size={15} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {screens.map((screen) => (
                      <button
                        key={screen.index}
                        onClick={() => setSelectedScreen(screen.index)}
                        disabled={busy}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          selectedScreen === screen.index
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                            : 'border-gray-200 hover:border-blue-300 dark:border-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Monitor size={16} />
                          屏幕 {screen.index + 1}
                          {screen.is_primary && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
                              主屏
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {screen.width} x {screen.height} · {screen.x}, {screen.y}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sourceMode === 'region' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">录制区域</h2>
                    <button
                      onClick={chooseRegion}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
                    >
                      <MousePointer2 size={14} />
                      选择区域
                    </button>
                  </div>
                  {region ? (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
                      {region.width} x {region.height} · X {region.x} · Y {region.y}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700">
                      尚未选择录制区域
                    </div>
                  )}
                </div>
              )}

              {sourceMode === 'window' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">选择软件窗口</h2>
                    <button
                      onClick={() => void loadWindows()}
                      disabled={loadingWindows || busy}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-500 disabled:opacity-50 dark:hover:bg-gray-700"
                      title="刷新窗口"
                    >
                      <RefreshCw size={15} className={loadingWindows ? 'animate-spin' : ''} />
                    </button>
                  </div>
                  <div className="max-h-[390px] space-y-2 overflow-y-auto pr-1">
                    {windows.map((item) => (
                      <button
                        key={item.hwnd}
                        onClick={() => setSelectedWindow(item.hwnd)}
                        disabled={busy}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          selectedWindow === item.hwnd
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                            : 'border-gray-200 bg-white hover:border-blue-300 dark:border-gray-700 dark:bg-gray-800'
                        }`}
                      >
                        <div className="truncate text-sm font-medium">{item.title}</div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                          <span>{item.width} x {item.height}</span>
                          {item.minimized && <span className="text-amber-600">已最小化</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                  {windows.length === 0 && (
                    <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700">
                      未发现可录制窗口
                    </div>
                  )}
                </div>
              )}

              <SourcePreview
                sourceMode={sourceMode}
                screen={activeScreen}
                region={region}
                windowTarget={activeWindow}
              />
            </section>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <aside className="flex min-h-0 flex-col border-l border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">输出文件</label>
                <button
                  onClick={chooseOutput}
                  disabled={busy}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-xs hover:border-blue-300 disabled:opacity-60 dark:border-gray-700"
                >
                  <span className="truncate">{outputPath || '选择保存路径'}</span>
                  <FolderOpen size={15} className="flex-shrink-0 text-gray-400" />
                </button>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">帧率</label>
                <div className="grid grid-cols-5 gap-1">
                  {FPS_OPTIONS.map((item) => (
                    <button
                      key={item}
                      onClick={() => setFps(item)}
                      disabled={busy}
                      className={`rounded px-2 py-1.5 text-xs ${
                        fps === item
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">质量</label>
                <select
                  value={quality}
                  onChange={(event) => setQuality(event.target.value as Quality)}
                  disabled={busy}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="lossless">近无损</option>
                  <option value="quality">高清</option>
                  <option value="balanced">均衡</option>
                  <option value="small">小文件</option>
                </select>
              </div>

              <label className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                <span>录制鼠标指针</span>
                <input
                  type="checkbox"
                  checked={drawMouse}
                  onChange={(event) => setDrawMouse(event.target.checked)}
                  disabled={busy}
                  className="h-4 w-4"
                />
              </label>

              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-medium text-gray-500">音频</label>
                  <button
                    onClick={() => void loadAudioDevices()}
                    disabled={loadingAudio || busy}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-500 disabled:opacity-50 dark:hover:bg-gray-700"
                    title="刷新音频设备"
                  >
                    <RefreshCw size={14} className={loadingAudio ? 'animate-spin' : ''} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {AUDIO_OPTIONS.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setAudioMode(item.id)}
                      disabled={busy}
                      className={`rounded px-2 py-1.5 text-left text-xs ${
                        audioMode === item.id
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                      } disabled:opacity-60`}
                      title={item.desc}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {audioMode !== 'none' && (
                  <div className="mt-3 space-y-2">
                    <select
                      value={audioDevice}
                      onChange={(event) => setAudioDevice(event.target.value)}
                      disabled={busy}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                    >
                      <option value="">选择音频设备</option>
                      {(audioMode === 'system' && systemAudioDevices.length > 0
                        ? systemAudioDevices
                        : audioDevices
                      ).map((device) => (
                        <option key={device.name} value={device.name}>
                          {device.name}
                        </option>
                      ))}
                    </select>
                    {audioMode === 'mixed' && (
                      <select
                        value={audioDevice2}
                        onChange={(event) => setAudioDevice2(event.target.value)}
                        disabled={busy}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                      >
                        <option value="">选择第二个音频设备</option>
                        {audioDevices.map((device) => (
                          <option key={device.name} value={device.name}>
                            {device.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {audioMode === 'system' && systemAudioDevices.length === 0 && (
                      <p className="text-[11px] leading-4 text-amber-600 dark:text-amber-300">
                        未发现立体声混音/虚拟声卡；如需录系统声音，请在系统中启用 Stereo Mix 或安装虚拟音频设备。
                      </p>
                    )}
                    {audioDevices.length === 0 && (
                      <p className="text-[11px] leading-4 text-amber-600 dark:text-amber-300">
                        未读取到音频设备，可刷新或先使用无音频录制。
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-medium text-gray-500">水印</label>
                  <input
                    type="checkbox"
                    checked={watermark.enabled}
                    onChange={(event) =>
                      setWatermark((prev) => ({ ...prev, enabled: event.target.checked }))
                    }
                    disabled={busy}
                    className="h-4 w-4"
                  />
                </div>

                {watermark.enabled && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-1">
                      {(['text', 'image'] as WatermarkKind[]).map((item) => (
                        <button
                          key={item}
                          onClick={() => setWatermark((prev) => ({ ...prev, kind: item }))}
                          disabled={busy}
                          className={`rounded px-2 py-1.5 text-xs ${
                            watermark.kind === item
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                          } disabled:opacity-60`}
                        >
                          {item === 'text' ? '文字' : '图片'}
                        </button>
                      ))}
                    </div>

                    {watermark.kind === 'text' ? (
                      <input
                        value={watermark.text}
                        onChange={(event) =>
                          setWatermark((prev) => ({ ...prev, text: event.target.value }))
                        }
                        disabled={busy}
                        placeholder="水印文字"
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                      />
                    ) : (
                      <button
                        onClick={chooseWatermarkImage}
                        disabled={busy}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-xs hover:border-blue-300 disabled:opacity-60 dark:border-gray-700"
                      >
                        <span className="truncate">{watermark.imagePath || '选择水印图片'}</span>
                        <ImageIcon size={15} className="flex-shrink-0 text-gray-400" />
                      </button>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={watermark.mode}
                        onChange={(event) =>
                          setWatermark((prev) => ({
                            ...prev,
                            mode: event.target.value as WatermarkMode,
                          }))
                        }
                        disabled={busy}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                      >
                        <option value="static">静态</option>
                        <option value="dynamic">动态</option>
                      </select>
                      <select
                        value={watermark.layout}
                        onChange={(event) =>
                          setWatermark((prev) => ({
                            ...prev,
                            layout: event.target.value as WatermarkLayout,
                          }))
                        }
                        disabled={busy}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                      >
                        <option value="single">单个</option>
                        <option value="tile">平铺</option>
                      </select>
                    </div>

                    {watermark.mode === 'dynamic' && (
                      <select
                        value={watermark.motion}
                        onChange={(event) =>
                          setWatermark((prev) => ({
                            ...prev,
                            motion: event.target.value as WatermarkMotion,
                          }))
                        }
                        disabled={busy}
                        className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                      >
                        <option value="horizontal">横向移动</option>
                        <option value="vertical">纵向移动</option>
                        <option value="diagonal">斜向移动</option>
                        <option value="blink">闪烁</option>
                      </select>
                    )}

                    {watermark.layout === 'single' && (
                      <div className="grid grid-cols-3 gap-1">
                        {WATERMARK_POSITIONS.map((item) => (
                          <button
                            key={item.id}
                            onClick={() =>
                              setWatermark((prev) => ({ ...prev, position: item.id }))
                            }
                            disabled={busy}
                            className={`rounded px-1 py-1.5 text-[11px] ${
                              watermark.position === item.id
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                            } disabled:opacity-60`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-gray-500">
                        透明度 {Math.round(watermark.opacity * 100)}%
                        <input
                          type="range"
                          min={5}
                          max={100}
                          value={Math.round(watermark.opacity * 100)}
                          onChange={(event) =>
                            setWatermark((prev) => ({
                              ...prev,
                              opacity: Number(event.target.value) / 100,
                            }))
                          }
                          disabled={busy}
                          className="mt-1 w-full"
                        />
                      </label>
                      <label className="text-[11px] text-gray-500">
                        角度 {watermark.angle}°
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          value={watermark.angle}
                          onChange={(event) =>
                            setWatermark((prev) => ({
                              ...prev,
                              angle: Number(event.target.value),
                            }))
                          }
                          disabled={busy}
                          className="mt-1 w-full"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-gray-500">
                        {watermark.kind === 'text' ? '字号' : '宽度'}
                        <input
                          type="number"
                          min={watermark.kind === 'text' ? 10 : 24}
                          max={watermark.kind === 'text' ? 120 : 1200}
                          value={watermark.kind === 'text' ? watermark.fontSize : watermark.imageWidth}
                          onChange={(event) =>
                            setWatermark((prev) =>
                              prev.kind === 'text'
                                ? { ...prev, fontSize: Number(event.target.value) }
                                : { ...prev, imageWidth: Number(event.target.value) }
                            )
                          }
                          disabled={busy}
                          className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
                        />
                      </label>
                      <label className="text-[11px] text-gray-500">
                        边距
                        <input
                          type="number"
                          min={0}
                          max={300}
                          value={watermark.margin}
                          onChange={(event) =>
                            setWatermark((prev) => ({
                              ...prev,
                              margin: Number(event.target.value),
                            }))
                          }
                          disabled={busy}
                          className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
                        />
                      </label>
                    </div>

                    {watermark.layout === 'tile' && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] text-gray-500">
                          横向间距
                          <input
                            type="number"
                            min={40}
                            max={1000}
                            value={watermark.spacingX}
                            onChange={(event) =>
                              setWatermark((prev) => ({
                                ...prev,
                                spacingX: Number(event.target.value),
                              }))
                            }
                            disabled={busy}
                            className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
                          />
                        </label>
                        <label className="text-[11px] text-gray-500">
                          纵向间距
                          <input
                            type="number"
                            min={40}
                            max={1000}
                            value={watermark.spacingY}
                            onChange={(event) =>
                              setWatermark((prev) => ({
                                ...prev,
                                spacingY: Number(event.target.value),
                              }))
                            }
                            disabled={busy}
                            className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
                          />
                        </label>
                      </div>
                    )}

                    {watermark.kind === 'text' && (
                      <label className="text-[11px] text-gray-500">
                        颜色
                        <input
                          type="color"
                          value={watermark.color}
                          onChange={(event) =>
                            setWatermark((prev) => ({ ...prev, color: event.target.value }))
                          }
                          disabled={busy}
                          className="mt-1 h-8 w-full rounded border border-gray-200 bg-white px-1 dark:border-gray-700 dark:bg-gray-900"
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-auto space-y-3 pt-4">
              <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                <div className="mb-1 flex items-center justify-between">
                  <span>当前来源</span>
                  <span className="font-medium">
                    {sourceMode === 'fullscreen' ? '全屏' : sourceMode === 'region' ? '区域' : '窗口'}
                  </span>
                </div>
                {sourceMode === 'window' && activeWindow && (
                  <p className="truncate text-gray-500">{activeWindow.title}</p>
                )}
                {status.active && (
                  <div className="mt-3 flex items-center gap-2 text-red-600 dark:text-red-300">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        status.paused ? 'bg-amber-500' : 'animate-pulse bg-red-500'
                      }`}
                    />
                    {status.paused ? '已暂停' : '正在录制'} {formatDuration(status.elapsedMs)}
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between text-gray-500">
                  <span>音频</span>
                  <span>
                    {audioMode === 'none'
                      ? '无音频'
                      : audioMode === 'microphone'
                        ? '麦克风'
                        : audioMode === 'system'
                          ? '系统声音'
                          : '混音'}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-gray-500">
                  <span>水印</span>
                  <span>
                    {!watermark.enabled
                      ? '关闭'
                      : watermark.kind === 'text'
                        ? watermark.layout === 'tile'
                          ? '文字平铺'
                          : '文字'
                        : watermark.layout === 'tile'
                          ? '图片平铺'
                          : '图片'}
                  </span>
                </div>
              </div>

              {status.active ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={togglePause}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-600"
                  >
                    {status.paused ? <Play size={17} /> : <Pause size={17} />}
                    {status.paused ? '继续' : '暂停'}
                  </button>
                  <button
                    onClick={stopRecording}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600"
                  >
                    <StopCircle size={17} />
                    停止
                  </button>
                </div>
              ) : (
                <button
                  onClick={startRecording}
                  disabled={countdown !== null}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-60"
                >
                  <Play size={17} />
                  {countdown === null ? '开始录制' : '准备中...'}
                </button>
              )}

              {lastResult && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200">
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <CheckCircle2 size={16} />
                    录制完成
                  </div>
                  <p className="truncate text-xs">{lastResult.outputPath}</p>
                  <p className="mt-1 text-xs opacity-80">
                    {formatDuration(lastResult.elapsedMs)} {formatSize(lastResult.fileSize)}
                  </p>
                  <button
                    onClick={openResultFolder}
                    className="mt-3 w-full rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700"
                  >
                    打开所在位置
                  </button>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {countdown !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-white">
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-white/30 bg-white/10 text-5xl font-semibold">
              {countdown}
            </div>
            <div className="text-sm text-white/80">即将开始录制</div>
          </div>
        </div>
      )}
    </div>
  );
}
