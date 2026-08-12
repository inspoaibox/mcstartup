/**
 * 截图结果窗口
 * 窗口 label: "screenshot-result"
 * 挂载后主动 emit "screenshot-result-ready"，后端收到后发送数据
 */
import { useState, useEffect } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { listen, emit } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import { X, Copy, Save, Check } from 'lucide-react';
import { useToolTheme } from './useToolTheme';

export default function ScreenshotResultWindow() {
  const ready = useToolTheme();
  const [screenshot, setScreenshot] = useState('');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // 监听截图数据
    const unlisten = listen<string>('screenshot-data', (e) => {
      if (e.payload) {
        setScreenshot(e.payload);
        appWindow.show();
      }
    });

    // 通知发送方"前端已就绪，可以发数据了"
    emit('screenshot-result-ready', null);

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const copy = async () => {
    try {
      const res = await fetch(`data:image/png;base64,${screenshot}`);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      await navigator.clipboard.writeText(screenshot);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const saveFile = async () => {
    try {
      const dir = await invoke<string>('screenshot_get_default_dir');
      const name = await invoke<string>('screenshot_generate_filename');
      const path = await save({
        defaultPath: `${dir}/${name}`,
        filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (path) {
        await invoke('screenshot_save_file', { base64Data: screenshot, filePath: path });
        setSaved(true);
        setTimeout(() => {
          setSaved(false);
          appWindow.close();
        }, 1000);
      }
    } catch (e) {
      alert(`保存失败: ${e}`);
    }
  };

  if (!ready) return null;

  if (!screenshot) {
    return (
      <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800"
          data-tauri-drag-region
        >
          <span
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
            data-tauri-drag-region
          >
            📸 截图完成
          </span>
          <button
            onClick={() => appWindow.close()}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-gray-400 text-sm">加载截图中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800"
        data-tauri-drag-region
      >
        <span
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
          data-tauri-drag-region
        >
          📸 截图完成
        </span>
        <button
          onClick={() => appWindow.close()}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden p-4">
        <img
          src={`data:image/png;base64,${screenshot}`}
          alt="Screenshot"
          className="w-full h-full object-contain rounded-lg shadow-lg"
        />
      </div>

      <div className="flex gap-3 p-4 border-t border-gray-200 dark:border-gray-800">
        <button
          onClick={copy}
          className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${copied ? 'bg-green-500 text-white' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
          {copied ? '已复制' : '复制到剪贴板'}
        </button>
        <button
          onClick={saveFile}
          className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${saved ? 'bg-green-500 text-white' : 'bg-purple-500 text-white hover:bg-purple-600'}`}
        >
          {saved ? <Check size={18} /> : <Save size={18} />}
          {saved ? '已保存' : '保存到文件'}
        </button>
      </div>
    </div>
  );
}
