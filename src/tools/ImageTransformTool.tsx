import { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Upload, Download, RotateCw, FlipHorizontal, FlipVertical, Copy } from 'lucide-react';
import { fileToBase64, useClipboardPaste, copyImageToClipboard } from './useImageInput';

const OPS = [
  { id: 'rotate90', label: '旋转 90°', icon: <RotateCw size={15} /> },
  { id: 'rotate180', label: '旋转 180°', icon: <RotateCw size={15} className="rotate-90" /> },
  { id: 'rotate270', label: '旋转 270°', icon: <RotateCw size={15} className="rotate-180" /> },
  { id: 'flipH', label: '左右镜像', icon: <FlipHorizontal size={15} /> },
  { id: 'flipV', label: '上下翻转', icon: <FlipVertical size={15} /> },
];

export default function ImageTransformTool() {
  useToolTheme();
  const [origB64, setOrigB64] = useState('');
  const [current, setCurrent] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedFlag, setCopiedFlag] = useState(false);

  async function loadImage(b64: string) {
    setOrigB64(b64);
    setCurrent(b64);
    setHistory([]);
  }

  async function handleFile(f: File) {
    if (!f.type.startsWith('image/')) return;
    loadImage(await fileToBase64(f));
  }

  useClipboardPaste((b64) => loadImage(b64));

  async function doOp(op: string) {
    if (!current) return;
    setLoading(true);
    try {
      const result = await invoke<string>('image_transform', { data: current, op });
      setHistory((prev) => [...prev, current]);
      setCurrent(result);
    } catch (e) {
      console.error('操作失败:', e);
    } finally {
      setLoading(false);
    }
  }

  function undo() {
    if (!history.length) return;
    setCurrent(history[history.length - 1]);
    setHistory((prev) => prev.slice(0, -1));
  }

  function reset() {
    setCurrent(origB64);
    setHistory([]);
  }

  function download() {
    if (!current) return;
    const a = document.createElement('a');
    a.href = current;
    a.download = 'transformed.png';
    a.click();
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="图片旋转翻转" icon="🔄" />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!origB64 ? (
          <label
            className="flex flex-col items-center justify-center gap-3 py-16 rounded-xl border-2 border-dashed cursor-pointer border-gray-300 dark:border-gray-600 hover:border-pink-400 bg-white dark:bg-gray-800"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            <Upload size={28} className="text-gray-400" />
            <div className="text-sm text-gray-400">点击上传 / 拖拽 / Ctrl+V 粘贴图片</div>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap items-center">
              {OPS.map((op) => (
                <button
                  key={op.id}
                  onClick={() => doOp(op.id)}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-pink-400 disabled:opacity-50 transition-colors"
                >
                  {op.icon} {op.label}
                </button>
              ))}
              <div className="flex-1" />
              <button
                onClick={undo}
                disabled={!history.length}
                className="px-3 py-2 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 disabled:opacity-30"
              >
                撤销
              </button>
              <button
                onClick={reset}
                className="px-3 py-2 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-red-500"
              >
                重置
              </button>
              <button
                onClick={async () => {
                  if (await copyImageToClipboard(current)) setCopiedFlag(true);
                  setTimeout(() => setCopiedFlag(false), 1500);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Copy size={13} /> {copiedFlag ? '已复制 ✓' : '复制'}
              </button>
              <button
                onClick={download}
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-pink-600 hover:bg-pink-700 text-white"
              >
                <Download size={13} /> 下载
              </button>
            </div>

            <div
              className={`rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 flex items-center justify-center p-4 transition-opacity ${loading ? 'opacity-50' : ''}`}
              style={{ minHeight: 400 }}
            >
              <img src={current} alt="" className="max-w-full max-h-96 rounded-lg shadow" />
            </div>

            <label className="flex items-center justify-center gap-2 py-2 text-xs text-gray-400 hover:text-pink-500 cursor-pointer">
              <Upload size={12} /> 重新选择图片
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
