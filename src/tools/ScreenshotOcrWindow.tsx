import { useState, useEffect } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

interface ScreenshotOcrWindowProps {
  onCapture: (
    x: number,
    y: number,
    width: number,
    height: number,
    fullScreenshotBase64: string
  ) => void;
  onCancel: () => void;
  readyEventName?: string;
  backgroundEventName?: string;
}

export default function ScreenshotOcrWindow({
  onCapture,
  onCancel,
  readyEventName = 'screenshot-window-ready',
  backgroundEventName = 'screenshot-bg-data',
}: ScreenshotOcrWindowProps) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });
  const [screenshot, setScreenshot] = useState<string>('');
  const [screenshotBase64, setScreenshotBase64] = useState<string>('');
  const [loading, setLoading] = useState(true);

  console.log('ScreenshotOcrWindow rendered, loading:', loading, 'screenshot:', !!screenshot);

  useEffect(() => {
    console.log('=== ScreenshotOcrWindow mounted ===');
    setLoading(true);
    setScreenshot('');
    setScreenshotBase64('');

    const unlistenPromise = listen<string>(backgroundEventName, (event) => {
      const base64 = event.payload;
      console.log('Received screenshot background data, base64 length:', base64?.length || 0);
      if (base64) {
        setScreenshotBase64(base64);
        setScreenshot(`data:image/png;base64,${base64}`);
      }
      setLoading(false);
    });

    void appWindow.emit(readyEventName);

    // 监听 ESC 键取消
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      void unlistenPromise.then((fn) => fn());
    };
  }, [backgroundEventName, onCancel, readyEventName]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsSelecting(true);
    setStartPos({ x: e.clientX, y: e.clientY });
    setCurrentPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isSelecting) {
      setCurrentPos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    if (isSelecting) {
      const x = Math.min(startPos.x, currentPos.x);
      const y = Math.min(startPos.y, currentPos.y);
      const width = Math.abs(currentPos.x - startPos.x);
      const height = Math.abs(currentPos.y - startPos.y);

      if (width > 10 && height > 10) {
        // 直接触发识别，默认文字识别
        onCapture(x, y, width, height, screenshotBase64);
      } else {
        onCancel();
      }
      setIsSelecting(false);
    }
  };

  const selectionRect = {
    left: Math.min(startPos.x, currentPos.x),
    top: Math.min(startPos.y, currentPos.y),
    width: Math.abs(currentPos.x - startPos.x),
    height: Math.abs(currentPos.y - startPos.y),
  };

  return (
    <div className="fixed inset-0 cursor-crosshair bg-black">
      {/* 加载中显示黑色背景 */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white text-sm">加载中...</div>
        </div>
      )}

      {/* 背景截图 */}
      {screenshot && !loading && (
        <>
          <img
            src={screenshot}
            alt="Screenshot"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ pointerEvents: 'none' }}
          />

          {/* 半透明遮罩 */}
          <div
            className="absolute inset-0 bg-black/30"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            {/* 选择框 */}
            {isSelecting && (
              <div
                className="absolute border-2 border-blue-500 bg-blue-500/10"
                style={{
                  left: selectionRect.left,
                  top: selectionRect.top,
                  width: selectionRect.width,
                  height: selectionRect.height,
                }}
              >
                {/* 尺寸提示 */}
                <div className="absolute -top-6 left-0 bg-blue-500 text-white text-xs px-2 py-1 rounded">
                  {selectionRect.width} × {selectionRect.height}
                </div>
              </div>
            )}

            {/* 提示文字 */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-lg text-sm">
              拖动鼠标框选识别区域，按 ESC 取消
            </div>
          </div>
        </>
      )}
    </div>
  );
}
