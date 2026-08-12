import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow, WebviewWindow } from '@tauri-apps/api/window';
import {
  Activity,
  Crosshair,
  GripVertical,
  Keyboard,
  LocateFixed,
  MousePointerClick,
  Plus,
  Play,
  RotateCcw,
  Trash2,
  Square,
  Timer,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { useToolDataStore } from '../stores/toolDataStore';

type MouseButtonValue = 'left' | 'right' | 'middle';
type ClickMode = 'single' | 'double';
type TargetMode = 'current' | 'fixed' | 'sequence';

interface ClickPoint {
  x: number;
  y: number;
  delayMs: number;
  label: string;
}

interface AutoClickerConfig {
  intervalMs: number;
  button: MouseButtonValue;
  clickMode: ClickMode;
  maxClicks?: number | null;
  startDelayMs: number;
  pressDurationMs: number;
  targetMode: TargetMode;
  points: ClickPoint[];
  returnToOriginal: boolean;
}

interface AutoClickerStatus {
  running: boolean;
  clicksDone: number;
  shortcut?: string | null;
  config: AutoClickerConfig;
}

interface CursorPosition {
  x: number;
  y: number;
}

const DEFAULT_CONFIG: AutoClickerConfig = {
  intervalMs: 100,
  button: 'left',
  clickMode: 'single',
  maxClicks: null,
  startDelayMs: 0,
  pressDurationMs: 10,
  targetMode: 'current',
  points: [],
  returnToOriginal: true,
};

const BUTTON_OPTIONS: Array<{ value: MouseButtonValue; label: string }> = [
  { value: 'left', label: '左键' },
  { value: 'right', label: '右键' },
  { value: 'middle', label: '中键' },
];

const CLICK_MODE_OPTIONS: Array<{ value: ClickMode; label: string }> = [
  { value: 'single', label: '单击' },
  { value: 'double', label: '双击' },
];

const TARGET_MODE_OPTIONS: Array<{ value: TargetMode; label: string }> = [
  { value: 'current', label: '当前位置' },
  { value: 'fixed', label: '固定坐标' },
  { value: 'sequence', label: '多点连击' },
];

const POINT_PICKER_LABEL = 'auto-clicker-point-picker';

function numberOrZero(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeConfig(config: AutoClickerConfig): AutoClickerConfig {
  const targetMode = TARGET_MODE_OPTIONS.some((item) => item.value === config.targetMode)
    ? config.targetMode
    : 'current';
  const points = Array.isArray(config.points)
    ? config.points.slice(0, 50).map((point, index) => ({
        x: Math.round(Number.isFinite(point.x) ? point.x : 0),
        y: Math.round(Number.isFinite(point.y) ? point.y : 0),
        delayMs: clamp(Math.round(point.delayMs || 0), 0, 600000),
        label: point.label?.trim() || `点击点 ${index + 1}`,
      }))
    : [];

  return {
    intervalMs: clamp(config.intervalMs || DEFAULT_CONFIG.intervalMs, 10, 600000),
    button: BUTTON_OPTIONS.some((item) => item.value === config.button) ? config.button : 'left',
    clickMode: config.clickMode === 'double' ? 'double' : 'single',
    maxClicks:
      config.maxClicks && config.maxClicks > 0 ? clamp(Math.round(config.maxClicks), 1, 10000000) : null,
    startDelayMs: clamp(config.startDelayMs || 0, 0, 60000),
    pressDurationMs: clamp(config.pressDurationMs ?? DEFAULT_CONFIG.pressDurationMs, 0, 1000),
    targetMode: points.length === 0 && targetMode !== 'current' ? targetMode : targetMode,
    points,
    returnToOriginal: config.returnToOriginal !== false,
  };
}

function sameConfig(a: AutoClickerConfig, b: AutoClickerConfig) {
  const left = normalizeConfig(a);
  const right = normalizeConfig(b);
  return (
    left.intervalMs === right.intervalMs &&
    left.button === right.button &&
    left.clickMode === right.clickMode &&
    (left.maxClicks || null) === (right.maxClicks || null) &&
    left.startDelayMs === right.startDelayMs &&
    left.pressDurationMs === right.pressDurationMs
    && left.targetMode === right.targetMode
    && left.returnToOriginal === right.returnToOriginal
    && JSON.stringify(left.points) === JSON.stringify(right.points)
  );
}

function isStoredConfig(value: unknown): value is Partial<AutoClickerConfig> {
  return Boolean(value && typeof value === 'object');
}

export default function AutoClickerTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateAutoClickerData } = useToolDataStore();
  const attemptedDefaultShortcutRef = useRef(false);
  const restoredPersistedDataRef = useRef(false);
  const [config, setConfig] = useState<AutoClickerConfig>(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  const [clicksDone, setClicksDone] = useState(0);
  const [shortcut, setShortcut] = useState('F8');
  const [registeredShortcut, setRegisteredShortcut] = useState<string | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const normalizedConfig = useMemo(() => normalizeConfig(config), [config]);
  const hasClickLimit = Boolean(config.maxClicks && config.maxClicks > 0);

  const applyStatus = useCallback((status: AutoClickerStatus) => {
    setRunning(status.running);
    setClicksDone(status.clicksDone);
    if (status.config) {
      const nextConfig = normalizeConfig(status.config);
      setConfig((current) => (sameConfig(current, nextConfig) ? current : nextConfig));
    }
    if (status.shortcut) {
      setRegisteredShortcut(status.shortcut);
      setShortcut(status.shortcut);
    } else {
      setRegisteredShortcut(null);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await invoke<AutoClickerStatus>('auto_clicker_status');
      applyStatus(status);
      setStatusLoaded(true);
    } catch (err) {
      setError(String(err));
      setStatusLoaded(true);
    }
  }, [applyStatus]);

  useEffect(() => {
    if (!ready) return;
    void loadData();
  }, [loadData, ready]);

  useEffect(() => {
    if (!ready || !loaded || restoredPersistedDataRef.current) return;
    restoredPersistedDataRef.current = true;

    const saved = data.autoClicker;
    if (!saved) return;

    let nextConfig = DEFAULT_CONFIG;
    if (isStoredConfig(saved.config)) {
      nextConfig = normalizeConfig({ ...DEFAULT_CONFIG, ...saved.config });
      setConfig(nextConfig);
    }
    setShortcut(saved.shortcut || 'F8');
    invoke<AutoClickerStatus>('auto_clicker_set_config', { config: nextConfig })
      .then((status) => {
        applyStatus(status);
        setStatusLoaded(true);
      })
      .catch((err) => {
        setError(String(err));
        setStatusLoaded(true);
      });
  }, [applyStatus, data.autoClicker, loaded, ready]);

  useEffect(() => {
    if (!ready || !loaded || !restoredPersistedDataRef.current) return;
    const timer = window.setTimeout(() => {
      updateAutoClickerData({
        version: 'mcheng-auto-clicker-v1',
        config: normalizedConfig,
        shortcut,
        shortcutEnabled: Boolean(registeredShortcut),
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [loaded, normalizedConfig, ready, registeredShortcut, shortcut, updateAutoClickerData]);

  useEffect(() => {
    if (!ready || !loaded || !restoredPersistedDataRef.current) return;

    let unlisten: (() => void) | undefined;
    listen<AutoClickerStatus>('auto-clicker-status', (event) => {
      applyStatus(event.payload);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [applyStatus, loaded, ready]);

  useEffect(() => {
    if (!ready || !loaded || !restoredPersistedDataRef.current) return;
    const timer = window.setTimeout(() => {
      invoke<AutoClickerStatus>('auto_clicker_set_config', { config: normalizedConfig })
        .then(applyStatus)
        .catch((err) => setError(String(err)));
    }, 180);

    return () => window.clearTimeout(timer);
  }, [applyStatus, loaded, normalizedConfig, ready]);

  useEffect(() => {
    if (!ready || !loaded || !statusLoaded || registeredShortcut || attemptedDefaultShortcutRef.current) {
      return;
    }
    if (data.autoClicker?.shortcutEnabled === false) {
      attemptedDefaultShortcutRef.current = true;
      return;
    }
    attemptedDefaultShortcutRef.current = true;
    invoke<AutoClickerStatus>('auto_clicker_register_shortcut', { shortcut: shortcut.trim() || 'F8' })
      .then((status) => {
        applyStatus(status);
        setMessage(`${status.shortcut || shortcut || 'F8'} 已启用`);
      })
      .catch((err) => setError(String(err)));
  }, [applyStatus, data.autoClicker?.shortcutEnabled, loaded, ready, registeredShortcut, shortcut, statusLoaded]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 300);
    return () => window.clearInterval(timer);
  }, [refreshStatus, running]);

  const start = async () => {
    setError('');
    setMessage('');
    try {
      const status = await invoke<AutoClickerStatus>('auto_clicker_start', {
        config: normalizedConfig,
      });
      applyStatus(status);
    } catch (err) {
      setError(String(err));
    }
  };

  const stop = async () => {
    setError('');
    setMessage('');
    try {
      const status = await invoke<AutoClickerStatus>('auto_clicker_stop');
      applyStatus(status);
    } catch (err) {
      setError(String(err));
    }
  };

  const toggleShortcut = async () => {
    setError('');
    setMessage('');
    try {
      if (registeredShortcut) {
        const status = await invoke<AutoClickerStatus>('auto_clicker_unregister_shortcut');
        applyStatus(status);
        setMessage('快捷键已关闭');
        return;
      }

      const nextShortcut = shortcut.trim() || 'F8';
      const status = await invoke<AutoClickerStatus>('auto_clicker_register_shortcut', {
        shortcut: nextShortcut,
      });
      applyStatus(status);
      setMessage(`${nextShortcut} 已启用`);
    } catch (err) {
      setError(String(err));
    }
  };

  const reset = async () => {
    setConfig(DEFAULT_CONFIG);
    setClicksDone(0);
    setError('');
    setMessage('参数已重置');
    await invoke<AutoClickerStatus>('auto_clicker_set_config', { config: DEFAULT_CONFIG })
      .then(applyStatus)
      .catch((err) => setError(String(err)));
  };

  const updateConfig = <K extends keyof AutoClickerConfig>(key: K, value: AutoClickerConfig[K]) => {
    setConfig((current) => normalizeConfig({ ...current, [key]: value }));
  };

  const setTargetMode = (targetMode: TargetMode) => {
    setConfig((current) => {
      const points =
        targetMode === 'current'
          ? current.points
          : current.points.length > 0
            ? current.points
            : [{ x: 0, y: 0, delayMs: 0, label: '点击点 1' }];
      return normalizeConfig({ ...current, targetMode, points });
    });
  };

  const updatePoint = (index: number, patch: Partial<ClickPoint>) => {
    setConfig((current) =>
      normalizeConfig({
        ...current,
        points: current.points.map((point, pointIndex) =>
          pointIndex === index ? { ...point, ...patch } : point
        ),
      })
    );
  };

  const addPoint = (point?: Partial<ClickPoint>) => {
    setConfig((current) =>
      normalizeConfig({
        ...current,
        targetMode: current.targetMode === 'current' ? 'sequence' : current.targetMode,
        points: [
          ...current.points,
          {
            x: point?.x ?? 0,
            y: point?.y ?? 0,
            delayMs: point?.delayMs ?? 0,
            label: point?.label || `点击点 ${current.points.length + 1}`,
          },
        ],
      })
    );
  };

  const removePoint = (index: number) => {
    setConfig((current) =>
      normalizeConfig({
        ...current,
        points: current.points.filter((_, pointIndex) => pointIndex !== index),
      })
    );
  };

  const movePoint = (index: number, direction: -1 | 1) => {
    setConfig((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.points.length) return current;
      const points = [...current.points];
      [points[index], points[nextIndex]] = [points[nextIndex], points[index]];
      return normalizeConfig({ ...current, points });
    });
  };

  const applyPickedPosition = useCallback((index: number | undefined, position: CursorPosition) => {
    setConfig((current) => {
      if (typeof index === 'number') {
        const points = [...current.points];
        while (points.length <= index) {
          points.push({ x: 0, y: 0, delayMs: 0, label: `点击点 ${points.length + 1}` });
        }
        points[index] = { ...points[index], x: position.x, y: position.y };
        return normalizeConfig({ ...current, points });
      }

      return normalizeConfig({
        ...current,
        targetMode: current.targetMode === 'current' ? 'sequence' : current.targetMode,
        points: [
          ...current.points,
          {
            x: position.x,
            y: position.y,
            delayMs: 0,
            label: `点击点 ${current.points.length + 1}`,
          },
        ],
      });
    });
  }, []);

  const startPointPicker = async (index?: number) => {
    setError('');
    setMessage('');
    try {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const existing = WebviewWindow.getByLabel(POINT_PICKER_LABEL);
      if (existing) {
        await existing.close().catch(() => undefined);
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }

      const unlistenSelected = await listen<CursorPosition & { requestId: string }>(
        'auto-clicker-point-selected',
        async (event) => {
          if (event.payload.requestId !== requestId) return;
          applyPickedPosition(index, event.payload);
          await appWindow.show();
          await appWindow.setFocus();
          setMessage(`已选择坐标 X:${event.payload.x} Y:${event.payload.y}`);
          unlistenSelected();
          unlistenCancelled();
        }
      );
      const unlistenCancelled = await listen<{ requestId: string; error?: string }>(
        'auto-clicker-point-cancelled',
        async (event) => {
          if (event.payload.requestId !== requestId) return;
          await appWindow.show();
          await appWindow.setFocus();
          if (event.payload.error) {
            setError(event.payload.error);
          } else {
            setMessage('已取消点选坐标');
          }
          unlistenSelected();
          unlistenCancelled();
        }
      );

      await appWindow.hide();
      await new Promise((resolve) => window.setTimeout(resolve, 120));

      const picker = new WebviewWindow(POINT_PICKER_LABEL, {
        url: `/auto-clicker-point-picker?requestId=${encodeURIComponent(requestId)}`,
        title: '点选点击坐标',
        fullscreen: true,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        visible: false,
      });

      picker.once('tauri://error', async () => {
        await appWindow.show();
        await appWindow.setFocus();
        setError('点选坐标窗口创建失败');
        unlistenSelected();
        unlistenCancelled();
      });

      setMessage('请拖动准星到目标位置，松开取点');
    } catch (err) {
      await appWindow.show().catch(() => undefined);
      await appWindow.setFocus().catch(() => undefined);
      setError(String(err));
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        title="超级连点器"
        icon="🖱️"
        actions={
          <button
            onClick={() => void stop()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Square size={14} />
            停止
          </button>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)] gap-4 overflow-hidden p-4 max-md:grid-cols-1 max-md:overflow-y-auto">
        <section className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">当前状态</p>
                <p className={`mt-1 text-lg font-semibold ${running ? 'text-green-600' : 'text-gray-900 dark:text-gray-100'}`}>
                  {running ? '运行中' : '已停止'}
                </p>
              </div>
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full ${
                  running ? 'bg-green-100 text-green-600 dark:bg-green-900/30' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
                }`}
              >
                <Activity size={22} />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
                <p className="text-xs text-gray-500 dark:text-gray-400">已点击</p>
                <p className="mt-1 text-xl font-semibold">{clicksDone}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
                <p className="text-xs text-gray-500 dark:text-gray-400">频率</p>
                <p className="mt-1 text-xl font-semibold">
                  {(1000 / normalizedConfig.intervalMs).toFixed(1)}
                  <span className="ml-1 text-xs font-normal text-gray-500">次/秒</span>
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-col gap-3">
              <button
                onClick={() => void (running ? stop() : start())}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white shadow-sm transition-colors ${
                  running ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {running ? <Square size={17} /> : <Play size={17} />}
                {running ? '停止连点' : '开始连点'}
              </button>
              <button
                onClick={() => void reset()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <RotateCcw size={16} />
                重置参数
              </button>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {hasClickLimit ? `达到 ${config.maxClicks} 次会自动停止` : '未设置点击上限'}
              </div>
            </div>

            {(message || error) && (
              <div
                className={`mt-3 rounded-md px-3 py-2 text-sm ${
                  error
                    ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                    : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                }`}
              >
                {error || message}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="grid gap-4">
            <label className="space-y-2">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                <Timer size={16} />
                点击间隔
              </span>
              <div className="flex rounded-lg border border-gray-200 bg-white focus-within:border-blue-500 dark:border-gray-700 dark:bg-gray-950">
                <input
                  type="number"
                  min={10}
                  max={600000}
                  value={config.intervalMs}
                  onChange={(event) => updateConfig('intervalMs', numberOrZero(event.target.value))}
                  className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm outline-none"
                />
                <span className="border-l border-gray-200 px-3 py-2 text-sm text-gray-500 dark:border-gray-700">
                  ms
                </span>
              </div>
            </label>

            <label className="space-y-2">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                <MousePointerClick size={16} />
                鼠标按键
              </span>
              <select
                value={config.button}
                onChange={(event) => updateConfig('button', event.target.value as MouseButtonValue)}
                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              >
                {BUTTON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-2">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">点击模式</span>
              <div className="grid grid-cols-2 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
                {CLICK_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => updateConfig('clickMode', option.value)}
                    className={`h-8 rounded-md text-sm font-medium transition-colors ${
                      config.clickMode === option.value
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="space-y-2">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">按下时长</span>
              <div className="flex rounded-lg border border-gray-200 bg-white focus-within:border-blue-500 dark:border-gray-700 dark:bg-gray-950">
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={config.pressDurationMs}
                  onChange={(event) =>
                    updateConfig('pressDurationMs', numberOrZero(event.target.value))
                  }
                  className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm outline-none"
                />
                <span className="border-l border-gray-200 px-3 py-2 text-sm text-gray-500 dark:border-gray-700">
                  ms
                </span>
              </div>
            </label>

            <label className="space-y-2">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">启动延迟</span>
              <div className="flex rounded-lg border border-gray-200 bg-white focus-within:border-blue-500 dark:border-gray-700 dark:bg-gray-950">
                <input
                  type="number"
                  min={0}
                  max={60000}
                  value={config.startDelayMs}
                  onChange={(event) => updateConfig('startDelayMs', numberOrZero(event.target.value))}
                  className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm outline-none"
                />
                <span className="border-l border-gray-200 px-3 py-2 text-sm text-gray-500 dark:border-gray-700">
                  ms
                </span>
              </div>
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">点击上限</span>
                <label className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={hasClickLimit}
                    onChange={(event) =>
                      updateConfig('maxClicks', event.target.checked ? 100 : null)
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  限制
                </label>
              </div>
              <input
                type="number"
                min={1}
                max={10000000}
                disabled={!hasClickLimit}
                value={hasClickLimit ? config.maxClicks || 100 : ''}
                onChange={(event) => updateConfig('maxClicks', numberOrZero(event.target.value))}
                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-950 dark:disabled:bg-gray-800"
              />
            </div>
          </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
              <Keyboard size={16} />
              快捷键
            </div>
            <input
              value={shortcut}
              disabled={Boolean(registeredShortcut)}
              onChange={(event) => setShortcut(event.target.value)}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:disabled:bg-gray-800"
              placeholder="F8"
            />
            <button
              onClick={() => void toggleShortcut()}
              className={`mt-3 h-10 w-full rounded-lg text-sm font-medium text-white transition-colors ${
                registeredShortcut ? 'bg-gray-700 hover:bg-gray-800' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {registeredShortcut ? `关闭 ${registeredShortcut}` : '启用快捷键'}
            </button>
          </div>
        </section>

        <section className="min-h-0 min-w-0 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
              <LocateFixed size={16} />
              点击目标
            </span>
            <div className="grid grid-cols-3 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
              {TARGET_MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setTargetMode(option.value)}
                  className={`h-8 rounded-md text-sm font-medium transition-colors ${
                    config.targetMode === option.value
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {config.targetMode === 'current' ? (
            <div className="mt-4 flex min-h-96 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
              当前模式会在鼠标所在位置执行点击
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                  <Crosshair size={16} />
                  {config.targetMode === 'fixed' ? '固定点击坐标' : '多点连击序列'}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void startPointPicker(config.targetMode === 'fixed' ? 0 : undefined)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    <Crosshair size={14} />
                    拖拽取点
                  </button>
                  {config.targetMode === 'sequence' && (
                    <button
                      onClick={() => addPoint()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      <Plus size={14} />
                      添加点
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2 overflow-x-auto pb-1">
                <div className="grid min-w-[760px] grid-cols-[28px_minmax(160px,1fr)_112px_112px_150px_142px] items-center gap-2 px-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  <span />
                  <span>名称</span>
                  <span>X 坐标</span>
                  <span>Y 坐标</span>
                  <span>到下一点间隔</span>
                  <span className="text-right">操作</span>
                </div>
                {(config.targetMode === 'fixed' ? config.points.slice(0, 1) : config.points).map((point, index) => (
                  <div
                    key={`${index}-${point.label}`}
                    className="grid min-w-[760px] grid-cols-[28px_minmax(160px,1fr)_112px_112px_150px_142px] items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900"
                  >
                    <GripVertical size={15} className="text-gray-400" />
                    <input
                      value={point.label}
                      onChange={(event) => updatePoint(index, { label: event.target.value })}
                      className="h-9 min-w-0 rounded-md border border-gray-200 bg-white px-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                    />
                    <input
                      type="number"
                      value={point.x}
                      onChange={(event) => updatePoint(index, { x: numberOrZero(event.target.value) })}
                      className="h-9 min-w-0 rounded-md border border-gray-200 bg-white px-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                      title="X 坐标"
                    />
                    <input
                      type="number"
                      value={point.y}
                      onChange={(event) => updatePoint(index, { y: numberOrZero(event.target.value) })}
                      className="h-9 min-w-0 rounded-md border border-gray-200 bg-white px-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                      title="Y 坐标"
                    />
                    <div
                      className="flex h-9 min-w-0 rounded-md border border-gray-200 bg-white focus-within:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                      title="当前点点击完成后，等待多久再执行下一个点"
                    >
                      <input
                        type="number"
                        min={0}
                        value={point.delayMs}
                        onChange={(event) => updatePoint(index, { delayMs: numberOrZero(event.target.value) })}
                        className="min-w-0 flex-1 rounded-l-md bg-transparent px-2 text-sm outline-none"
                        aria-label="到下一点间隔"
                      />
                      <span className="border-l border-gray-200 px-2 py-2 text-xs text-gray-500 dark:border-gray-700">
                        ms
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => void startPointPicker(index)}
                        className="rounded-md p-2 text-gray-500 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
                        title="拖拽取点"
                      >
                        <Crosshair size={14} />
                      </button>
                      {config.targetMode === 'sequence' && (
                        <>
                          <button
                            onClick={() => movePoint(index, -1)}
                            className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                            disabled={index === 0}
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => movePoint(index, 1)}
                            className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                            disabled={index === config.points.length - 1}
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => removePoint(index)}
                            className="rounded-md p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <label className="mt-3 inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={config.returnToOriginal}
                  onChange={(event) => updateConfig('returnToOriginal', event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                结束后回到启动前鼠标位置
              </label>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
