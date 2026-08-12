import { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Upload, Download, Lock, Unlock, Copy } from 'lucide-react';
import { fileToBase64, useClipboardPaste, copyImageToClipboard } from './useImageInput';

function base64Size(b64: string) {
  const raw = b64.includes(',') ? b64.split(',')[1] : b64;
  return Math.round((raw.length * 3) / 4);
}
function fmtSize(n: number) {
  return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB';
}

export default function ImageResizeTool() {
  useToolTheme();
  const [origB64, setOrigB64] = useState('');
  const [origW, setOrigW] = useState(0);
  const [origH, setOrigH] = useState(0);
  const [newW, setNewW] = useState(0);
  const [newH, setNewH] = useState(0);
  const [lockRatio, setLockRatio] = useState(true);
  const [resultB64, setResultB64] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedFlag, setCopiedFlag] = useState(false);

  async function loadImage(b64: string) {
    setOrigB64(b64);
    setResultB64('');
    const img = new Image();
    img.onload = () => {
      setOrigW(img.width);
      setOrigH(img.height);
      setNewW(img.width);
      setNewH(img.height);
    };
    img.src = b64;
  }

  async function handleFile(f: File) {
    if (!f.type.startsWith('image/')) return;
    loadImage(await fileToBase64(f));
  }

  useClipboardPaste((b64) => loadImage(b64));

  function handleW(v: number) {
    setNewW(v);
    if (lockRatio && origW > 0) setNewH(Math.round((v * origH) / origW));
  }
  function handleH(v: number) {
    setNewH(v);
    if (lockRatio && origH > 0) setNewW(Math.round((v * origW) / origH));
  }
  function handlePercent(p: number) {
    setNewW(Math.round((origW * p) / 100));
    setNewH(Math.round((origH * p) / 100));
  }

  async function doResize() {
    if (!origB64 || newW < 1 || newH < 1) return;
    setLoading(true);
    try {
      const result = await invoke<string>('image_resize', {
        data: origB64,
        width: newW,
        height: newH,
      });
      setResultB64(result);
    } catch (e) {
      console.error('调整失败:', e);
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!resultB64) return;
    const a = document.createElement('a');
    a.href = resultB64;
    a.download = `resized_${newW}x${newH}.png`;
    a.click();
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="图片尺寸调整" icon="📐" />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <label
          className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed cursor-pointer border-gray-300 dark:border-gray-600 hover:border-pink-400 bg-white dark:bg-gray-800"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
        >
          <Upload size={22} className="text-gray-400" />
          <div className="text-sm text-gray-400">
            {origB64 ? `原始: ${origW} × ${origH}` : '点击上传 / 拖拽 / Ctrl+V 粘贴图片'}
          </div>
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

        {/* 原图预览 */}
        {origB64 && (
          <div className="rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
              <span className="text-xs font-medium text-gray-500">原图预览</span>
              <span className="text-xs text-gray-400">
                {origW} × {origH}
              </span>
            </div>
            <div className="p-2 flex items-center justify-center min-h-32 bg-gray-50 dark:bg-gray-900">
              <img
                src={origB64}
                alt="original"
                className="max-w-full max-h-48 object-contain rounded"
              />
            </div>
          </div>
        )}

        {origB64 && (
          <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 space-y-4">
            <div className="flex gap-2 flex-wrap">
              {[25, 50, 75, 100, 150, 200].map((p) => (
                <button
                  key={p}
                  onClick={() => handlePercent(p)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${newW === Math.round((origW * p) / 100) ? 'bg-pink-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                >
                  {p}%
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-xs text-gray-400 mb-1">宽度 (px)</div>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={newW}
                  onChange={(e) => handleW(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                />
              </div>
              <button
                onClick={() => setLockRatio(!lockRatio)}
                className="mt-5 text-gray-400 hover:text-pink-500"
              >
                {lockRatio ? <Lock size={16} /> : <Unlock size={16} />}
              </button>
              <div className="flex-1">
                <div className="text-xs text-gray-400 mb-1">高度 (px)</div>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={newH}
                  onChange={(e) => handleH(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <button
              onClick={doResize}
              disabled={loading}
              className="w-full py-2.5 bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {loading ? '处理中...' : '调整尺寸（Lanczos3 高质量）'}
            </button>
            <button
              onClick={() => {
                setOrigB64('');
                setResultB64('');
                setNewW(0);
                setNewH(0);
                setOrigW(0);
                setOrigH(0);
              }}
              className="w-full py-2 text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              重置
            </button>
          </div>
        )}

        {resultB64 && (
          <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">
                {newW} × {newH} · {fmtSize(base64Size(resultB64))}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (await copyImageToClipboard(resultB64)) setCopiedFlag(true);
                    setTimeout(() => setCopiedFlag(false), 1500);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg"
                >
                  <Copy size={13} /> {copiedFlag ? '已复制 ✓' : '复制'}
                </button>
                <button
                  onClick={download}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-pink-600 hover:bg-pink-700 text-white text-xs rounded-lg"
                >
                  <Download size={13} /> 下载
                </button>
              </div>
            </div>
            <img src={resultB64} alt="resized" className="max-h-60 mx-auto rounded-lg" />
          </div>
        )}
      </div>
    </div>
  );
}
