import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';

export default function ScreenRecordingRegionPicker() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [screenshot, setScreenshot] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [start, setStart] = useState({ x: 0, y: 0 });
  const [end, setEnd] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const load = async () => {
      try {
        const base64 = await invoke<string>('screenshot_capture_fullscreen');
        setScreenshot(base64);
      } catch {
        await emit('screen-recording-region-cancelled');
        await appWindow.close();
      } finally {
        setLoading(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void emit('screen-recording-region-cancelled');
        void appWindow.close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    void load();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !screenshot) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const image = new Image();
    image.onload = async () => {
      canvas.width = image.width;
      canvas.height = image.height;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      context.fillStyle = 'rgba(0, 0, 0, 0.52)';
      context.fillRect(0, 0, canvas.width, canvas.height);

      const rect = getSelectionRect();
      if (rect.width > 0 && rect.height > 0) {
        context.clearRect(rect.x, rect.y, rect.width, rect.height);
        context.drawImage(
          image,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          rect.x,
          rect.y,
          rect.width,
          rect.height
        );
        context.strokeStyle = '#38bdf8';
        context.lineWidth = 2;
        context.strokeRect(rect.x, rect.y, rect.width, rect.height);
        const label = `${Math.round(rect.width)} x ${Math.round(rect.height)}`;
        context.font = '13px sans-serif';
        const labelWidth = context.measureText(label).width + 16;
        const labelY = rect.y > 28 ? rect.y - 26 : rect.y + 8;
        context.fillStyle = '#0284c7';
        context.fillRect(rect.x, labelY, labelWidth, 22);
        context.fillStyle = '#ffffff';
        context.fillText(label, rect.x + 8, labelY + 15);
      }

      await appWindow.show();
      await appWindow.setFocus();
    };
    image.src = `data:image/png;base64,${screenshot}`;
  }, [screenshot, start, end]);

  const getSelectionRect = () => {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    return { x, y, width, height };
  };

  const getPoint = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = event.currentTarget.width / rect.width;
    const scaleY = event.currentTarget.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getPoint(event);
    setStart(point);
    setEnd(point);
    setDragging(true);
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    setEnd(getPoint(event));
  };

  const handleMouseUp = async () => {
    if (!dragging) return;
    setDragging(false);
    const rect = getSelectionRect();
    if (rect.width < 16 || rect.height < 16) {
      await emit('screen-recording-region-cancelled');
      await appWindow.close();
      return;
    }

    await emit('screen-recording-region-selected', {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    await appWindow.close();
  };

  return (
    <div className="fixed inset-0 bg-black cursor-crosshair select-none">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white">
          正在准备录制区域...
        </div>
      )}
      {screenshot && (
        <>
          <canvas
            ref={canvasRef}
            className="h-full w-full"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />
          <div className="fixed left-1/2 top-4 -translate-x-1/2 rounded-lg bg-black/75 px-4 py-2 text-xs text-white">
            拖动选择录制区域，按 ESC 取消
          </div>
        </>
      )}
    </div>
  );
}
