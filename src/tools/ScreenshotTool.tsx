// 截图工具
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow, WebviewWindow } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/api/clipboard';
import { save } from '@tauri-apps/api/dialog';
import {
  X,
  Monitor,
  Maximize,
  Square,
  Copy,
  Save,
  Download,
  Trash2,
  Clock,
  Check,
} from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import { useToolDataStore } from '../stores/toolDataStore';

interface ScreenInfo {
  index: number;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
}

interface ScreenshotHistoryItem {
  id: string;
  timestamp: number;
  base64: string;
  width: number;
  height: number;
}

export default function ScreenshotTool() {
  const ready = useToolTheme();
  const { data, saveData } = useToolDataStore();
  const [screens, setScreens] = useState<ScreenInfo[]>([]);
  const [currentScreenshot, setCurrentScreenshot] = useState<string | null>(null);
  const [history, setHistory] = useState<ScreenshotHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState<'capture' | 'history'>('capture');

  useEffect(() => {
    loadScreensInfo();
    loadHistory();
  }, []);

  const loadScreensInfo = async () => {
    try {
      const screensInfo = await invoke<ScreenInfo[]>('screenshot_get_screens_info');
      setScreens(screensInfo);
    } catch (error) {
      console.error('获取屏幕信息失败:', error);
    }
  };

  const loadHistory = () => {
    const historyData = (data.screenshotTool?.history || []) as ScreenshotHistoryItem[];
    setHistory(historyData);
  };

  const saveHistory = (newHistory: ScreenshotHistoryItem[]) => {
    saveData({
      ...data,
      screenshotTool: {
        ...data.screenshotTool,
        history: newHistory,
      },
    });
    setHistory(newHistory);
  };

  const captureFullscreen = async () => {
    setLoading(true);
    try {
      const base64 = await invoke<string>('screenshot_capture_fullscreen');
      setCurrentScreenshot(base64);
      addToHistory(base64);
    } catch (error) {
      alert(`截图失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const captureScreen = async (screenIndex: number) => {
    setLoading(true);
    try {
      const base64 = await invoke<string>('screenshot_capture_screen', { screenIndex });
      setCurrentScreenshot(base64);
      addToHistory(base64);
    } catch (error) {
      alert(`截图失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const captureRegion = async () => {
    try {
      // 隐藏当前窗口
      await appWindow.hide();

      // 等待窗口完全隐藏
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 创建区域选择窗口（不传截图数据，让它自己截图）
      const selectionWindow = new WebviewWindow('screenshot-selection', {
        url: '/screenshot-selection',
        title: '选择截图区域',
        fullscreen: true,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        visible: false, // 初始不可见，等截图加载完成后再显示
      });

      // 监听选择完成事件
      const unlisten = await selectionWindow.listen<{
        x: number;
        y: number;
        width: number;
        height: number;
        screenshot: string;
      }>('screenshot-region-selected', async (event) => {
        const { x, y, width, height, screenshot } = event.payload;

        // 关闭选择窗口
        await selectionWindow.close();

        // 显示主窗口
        await appWindow.show();

        // 从已有的截图中裁剪区域
        setLoading(true);
        try {
          const croppedBase64 = await invoke<string>('crop_image_region', {
            imageBase64: screenshot,
            x,
            y,
            width,
            height,
          });
          setCurrentScreenshot(croppedBase64);
          addToHistory(croppedBase64);
        } catch (error) {
          alert(`截图失败: ${error}`);
        } finally {
          setLoading(false);
        }

        unlisten();
      });

      // 监听取消事件
      const unlistenCancel = await selectionWindow.listen(
        'screenshot-selection-cancelled',
        async () => {
          await selectionWindow.close();
          await appWindow.show();
          unlistenCancel();
        }
      );
    } catch (error) {
      console.error('区域截图失败:', error);
      await appWindow.show();
    }
  };

  const addToHistory = (base64: string) => {
    const img = new Image();
    img.onload = () => {
      const newItem: ScreenshotHistoryItem = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        base64,
        width: img.width,
        height: img.height,
      };
      const newHistory = [newItem, ...history].slice(0, 20); // 保留最近20张
      saveHistory(newHistory);
    };
    img.src = `data:image/png;base64,${base64}`;
  };

  const copyToClipboard = async (base64: string) => {
    try {
      // 将 base64 转换为 blob 并复制
      const response = await fetch(`data:image/png;base64,${base64}`);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob,
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // 降级方案：复制 base64 文本
      try {
        await writeText(base64);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        alert(`复制失败: ${error}`);
      }
    }
  };

  const saveToFile = async (base64: string) => {
    try {
      const defaultDir = await invoke<string>('screenshot_get_default_dir');
      const defaultFilename = await invoke<string>('screenshot_generate_filename');

      const filePath = await save({
        defaultPath: `${defaultDir}/${defaultFilename}`,
        filters: [
          {
            name: 'PNG Image',
            extensions: ['png'],
          },
        ],
      });

      if (filePath) {
        await invoke('screenshot_save_file', {
          base64Data: base64,
          filePath,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (error) {
      alert(`保存失败: ${error}`);
    }
  };

  const deleteFromHistory = (id: string) => {
    const newHistory = history.filter((item) => item.id !== id);
    saveHistory(newHistory);
    if (currentScreenshot && history.find((item) => item.id === id)?.base64 === currentScreenshot) {
      setCurrentScreenshot(null);
    }
  };

  const clearHistory = () => {
    if (confirm('确定要清空所有历史记录吗？')) {
      saveHistory([]);
      setCurrentScreenshot(null);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <span className="text-lg">📸</span>
          <span
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
            data-tauri-drag-region
          >
            截图工具
          </span>
        </div>
        <button
          onClick={() => appWindow.hide()}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* 模式切换 */}
      <div className="flex gap-2 p-3 border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setMode('capture')}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === 'capture'
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          <Monitor size={16} className="inline mr-2" />
          截图
        </button>
        <button
          onClick={() => setMode('history')}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === 'history'
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          <Clock size={16} className="inline mr-2" />
          历史记录 ({history.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {mode === 'capture' ? (
          <div className="p-6 space-y-6">
            {/* 截图按钮 */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">选择截图方式</h3>
              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={captureFullscreen}
                  disabled={loading}
                  className="flex items-center gap-3 p-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                >
                  <Maximize size={20} />
                  <div className="flex-1 text-left">
                    <div className="font-medium">全屏截图</div>
                    <div className="text-xs opacity-90">截取整个主屏幕</div>
                  </div>
                </button>

                <button
                  onClick={captureRegion}
                  disabled={loading}
                  className="flex items-center gap-3 p-4 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                >
                  <Square size={20} />
                  <div className="flex-1 text-left">
                    <div className="font-medium">区域截图</div>
                    <div className="text-xs opacity-90">框选任意区域截图</div>
                  </div>
                </button>
              </div>
            </div>

            {/* 多屏幕截图 */}
            {screens.length > 1 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">选择屏幕</h3>
                <div className="grid grid-cols-2 gap-3">
                  {screens.map((screen) => (
                    <button
                      key={screen.index}
                      onClick={() => captureScreen(screen.index)}
                      disabled={loading}
                      className="flex flex-col items-center gap-2 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Monitor size={24} className="text-gray-600 dark:text-gray-400" />
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        屏幕 {screen.index + 1}
                        {screen.is_primary && ' (主)'}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">
                        {screen.width} × {screen.height}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 当前截图预览 */}
            {currentScreenshot && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">当前截图</h3>
                <div className="relative bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
                  <img
                    src={`data:image/png;base64,${currentScreenshot}`}
                    alt="Screenshot"
                    className="w-full rounded-lg shadow-lg"
                  />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => copyToClipboard(currentScreenshot)}
                      className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                        copied
                          ? 'bg-green-500 text-white'
                          : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      {copied ? '已复制' : '复制'}
                    </button>
                    <button
                      onClick={() => saveToFile(currentScreenshot)}
                      className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                        saved
                          ? 'bg-green-500 text-white'
                          : 'bg-purple-500 text-white hover:bg-purple-600'
                      }`}
                    >
                      {saved ? <Check size={16} /> : <Save size={16} />}
                      {saved ? '已保存' : '保存'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                历史记录 ({history.length}/20)
              </h3>
              {history.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="px-3 py-1 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  清空
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <Clock size={48} className="mx-auto mb-4 opacity-50" />
                <p>还没有截图历史</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="relative bg-gray-100 dark:bg-gray-800 rounded-lg p-2 group"
                  >
                    <img
                      src={`data:image/png;base64,${item.base64}`}
                      alt="Screenshot"
                      className="w-full rounded cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => setCurrentScreenshot(item.base64)}
                    />
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      {new Date(item.timestamp).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={() => copyToClipboard(item.base64)}
                        className="flex-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                      >
                        <Copy size={12} className="inline mr-1" />
                        复制
                      </button>
                      <button
                        onClick={() => saveToFile(item.base64)}
                        className="flex-1 px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors"
                      >
                        <Download size={12} className="inline mr-1" />
                        保存
                      </button>
                      <button
                        onClick={() => deleteFromHistory(item.id)}
                        className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
