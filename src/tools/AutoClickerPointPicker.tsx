import { useEffect, useMemo, useRef, useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';

interface ScreenInfo {
  index: number;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
}

export default function AutoClickerPointPicker() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [screens, setScreens] = useState<ScreenInfo[]>([]);
  const [screenIndex, setScreenIndex] = useState(0);
  const [screenshot, setScreenshot] = useState('');
  const [loading, setLoading] = useState(true);
  const [pointer, setPointer] = useState({
    x: 0,
    y: 0,
    viewX: 0,
    viewY: 0,
    active: false,
    dragging: false,
  });
  const requestId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('requestId') || '';
  }, []);

  const activeScreen = screens[screenIndex];

  useEffect(() => {
    const prepare = async () => {
      try {
        const items = await invoke<ScreenInfo[]>('screenshot_get_screens_info');
        const primaryIndex = Math.max(0, items.findIndex((item) => item.is_primary));
        setScreens(items);
        setScreenIndex(primaryIndex);
      } catch (err) {
        await emit('auto-clicker-point-cancelled', {
          requestId,
          error: `读取屏幕信息失败: ${String(err)}`,
        });
        await appWindow.close();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void emit('auto-clicker-point-cancelled', { requestId });
        void appWindow.close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    void prepare();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requestId]);

  useEffect(() => {
    if (!activeScreen) return;
    let disposed = false;

    const loadScreenshot = async () => {
      setLoading(true);
      try {
        const base64 = await invoke<string>('screenshot_capture_screen', { screenIndex });
        if (!disposed) setScreenshot(base64);
      } catch (err) {
        await emit('auto-clicker-point-cancelled', {
          requestId,
          error: `截取屏幕失败: ${String(err)}`,
        });
        await appWindow.close();
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void loadScreenshot();
    return () => {
      disposed = true;
    };
  }, [activeScreen, requestId, screenIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !screenshot) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const image = new Image();
    image.onload = () => {
      canvas.width = image.width;
      canvas.height = image.height;
      context.clearRect(0, 0, image.width, image.height);
      context.drawImage(image, 0, 0);
      context.fillStyle = 'rgba(15, 23, 42, 0.18)';
      context.fillRect(0, 0, image.width, image.height);
      void appWindow.show();
      void appWindow.setFocus();
    };
    image.src = `data:image/png;base64,${screenshot}`;
  }, [screenshot]);

  const getScreenPoint = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeScreen) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = event.currentTarget.width / rect.width;
    const scaleY = event.currentTarget.height / rect.height;
    return {
      x: Math.round(activeScreen.x + (event.clientX - rect.left) * scaleX),
      y: Math.round(activeScreen.y + (event.clientY - rect.top) * scaleY),
      viewX: event.clientX - rect.left,
      viewY: event.clientY - rect.top,
    };
  };

  const updatePointer = (event: React.MouseEvent<HTMLCanvasElement>, dragging = pointer.dragging) => {
    const point = getScreenPoint(event);
    if (!point) return;
    setPointer({ ...point, active: true, dragging });
  };

  const selectPoint = async (event: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getScreenPoint(event);
    if (!point) return;
    const { x, y } = point;
    await emit('auto-clicker-point-selected', { requestId, x, y });
    await appWindow.close();
  };

  return (
    <div className="fixed inset-0 select-none bg-black">
      {screenshot && (
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-crosshair"
          onMouseEnter={(event) => updatePointer(event)}
          onMouseMove={(event) => updatePointer(event)}
          onMouseDown={(event) => updatePointer(event, true)}
          onMouseUp={selectPoint}
        />
      )}

      {pointer.active && activeScreen && (
        <div
          className="pointer-events-none fixed z-20"
          style={{ left: pointer.viewX, top: pointer.viewY }}
        >
          <div className="absolute -left-5 top-0 h-px w-10 bg-red-500 shadow-[0_0_4px_rgba(255,255,255,0.9)]" />
          <div className="absolute -top-5 left-0 h-10 w-px bg-red-500 shadow-[0_0_4px_rgba(255,255,255,0.9)]" />
          <div className="absolute -left-2 -top-2 h-4 w-4 rounded-full border-2 border-red-500 bg-white/20 shadow-[0_0_0_2px_rgba(255,255,255,0.7)]" />
          <div className="absolute left-3 top-3 whitespace-nowrap rounded bg-black/75 px-2 py-1 text-xs text-white">
            X {pointer.x} / Y {pointer.y}
          </div>
        </div>
      )}

      <div className="fixed left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-black/75 px-3 py-2 text-xs text-white shadow-lg">
        <span>拖动准星到目标位置，松开取点；也可单击取点，按 ESC 取消</span>
        {screens.length > 1 && (
          <select
            value={screenIndex}
            onChange={(event) => setScreenIndex(Number(event.target.value))}
            className="h-7 rounded border border-white/20 bg-black/60 px-2 text-xs text-white outline-none"
          >
            {screens.map((screen) => (
              <option key={screen.index} value={screen.index}>
                屏幕 {screen.index + 1}
                {screen.is_primary ? ' 主屏' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {activeScreen && !loading && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-3 py-1.5 text-xs text-white">
          当前屏幕原点：X {activeScreen.x} / Y {activeScreen.y}
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 flex items-center justify-center bg-black text-sm text-white">
          正在准备取点...
        </div>
      )}
    </div>
  );
}
