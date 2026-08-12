// 截图区域选择窗口
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { appWindow, WebviewWindow } from '@tauri-apps/api/window';

export default function ScreenshotSelection() {
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [endPos, setEndPos] = useState({ x: 0, y: 0 });
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotBase64, setScreenshotBase64] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    console.log('=== ScreenshotSelection mounted ===');

    // 监听复用时的重启事件
    const unlistenRestart = listen('restart-screenshot', () => {
      setIsSelecting(false);
      setStartPos({ x: 0, y: 0 });
      setEndPos({ x: 0, y: 0 });
      setScreenshot(null);
      setScreenshotBase64('');
      setLoading(true);
      captureScreen();
    });

    // 检查是否从 URL 参数获取截图数据
    const params = new URLSearchParams(window.location.search);
    const screenshotData = params.get('screenshot');

    const captureScreen = async () => {
      try {
        console.log('Capturing screenshot...');
        const base64 = await invoke<string>('screenshot_capture_fullscreen');
        console.log('Screenshot captured, base64 length:', base64.length);
        setScreenshotBase64(base64);
        setScreenshot(base64);
        setLoading(false);
      } catch (err) {
        console.error('截图失败:', err);
        setLoading(false);
        cancelSelection();
      }
    };

    if (screenshotData) {
      const base64 = decodeURIComponent(screenshotData);
      setScreenshotBase64(base64);
      setScreenshot(base64);
      setLoading(false);
    } else {
      captureScreen();
    }

    // ESC 键取消
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      unlistenRestart.then((fn: () => void) => fn());
    };
  }, []);

  useEffect(() => {
    if (screenshot && canvasRef.current) {
      drawCanvas();
    }
  }, [screenshot, startPos, endPos, isSelecting]);

  const drawCanvas = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !screenshot) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = async () => {
      canvas.width = img.width;
      canvas.height = img.height;

      // 绘制背景图片
      ctx.drawImage(img, 0, 0);

      // 绘制半透明遮罩
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (isSelecting || (startPos.x !== endPos.x && startPos.y !== endPos.y)) {
        const x = Math.min(startPos.x, endPos.x);
        const y = Math.min(startPos.y, endPos.y);
        const width = Math.abs(endPos.x - startPos.x);
        const height = Math.abs(endPos.y - startPos.y);

        // 清除选中区域的遮罩
        ctx.clearRect(x, y, width, height);
        ctx.drawImage(img, x, y, width, height, x, y, width, height);

        // 绘制选框边框
        ctx.strokeStyle = '#00BFFF';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);

        // 绘制尺寸信息
        if (width > 0 && height > 0) {
          const text = `${width} × ${height}`;
          ctx.font = '14px Arial';
          ctx.fillStyle = '#00BFFF';
          ctx.fillRect(x, y - 24, ctx.measureText(text).width + 10, 20);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(text, x + 5, y - 8);
        }
      }

      // 图片加载完成后显示窗口
      if (loading) {
        console.log('Screenshot loaded, showing window...');
        await appWindow.show();
        await appWindow.setFocus();
        console.log('Window shown and focused');
      }
    };
    img.src = `data:image/png;base64,${screenshot}`;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setStartPos({ x, y });
    setEndPos({ x, y });
    setIsSelecting(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setEndPos({ x, y });
  };

  const handleMouseUp = async () => {
    if (!isSelecting) return;
    setIsSelecting(false);

    const x = Math.min(startPos.x, endPos.x);
    const y = Math.min(startPos.y, endPos.y);
    const width = Math.abs(endPos.x - startPos.x);
    const height = Math.abs(endPos.y - startPos.y);

    if (width > 5 && height > 5) {
      try {
        // 裁剪区域
        const croppedBase64 = await invoke<string>('crop_image_region', {
          imageBase64: screenshotBase64,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        });

        // 隐藏选择窗口（不关闭，下次复用）
        await appWindow.hide();

        // 创建结果窗口，通过 URL 参数传递数据
        // 先关闭可能存在的旧结果窗口
        try {
          const existing = WebviewWindow.getByLabel('screenshot-result');
          if (existing) {
            await existing.close();
            await new Promise((r) => setTimeout(r, 100));
          }
        } catch (_) {}

        const resultWindow = new WebviewWindow('screenshot-result', {
          url: `index.html?screenshot=${encodeURIComponent(croppedBase64)}`,
          title: '截图完成',
          width: 800,
          height: 600,
          center: true,
          resizable: true,
          alwaysOnTop: true,
          decorations: false,
          visible: true,
        });

        resultWindow.once('tauri://error', (e) => {
          console.error('截图结果窗口创建失败:', e);
        });
      } catch (error) {
        console.error('截图失败:', error);
        cancelSelection();
      }
    } else {
      cancelSelection();
    }
  };

  const cancelSelection = async () => {
    await appWindow.hide();
  };

  return (
    <div className="fixed inset-0 bg-black cursor-crosshair">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white text-sm">加载中...</div>
        </div>
      )}

      {screenshot && !loading && (
        <>
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />
          <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-75 text-white px-4 py-2 rounded-lg text-sm">
            拖动鼠标选择截图区域，按 ESC 取消
          </div>
        </>
      )}
    </div>
  );
}
