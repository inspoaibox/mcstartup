import { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Upload, Download, X, CheckCircle, Loader, AlertCircle } from 'lucide-react';
import { fileToBase64, useClipboardPaste } from './useImageInput';

type Format = 'jpeg' | 'webp' | 'png' | 'bmp' | 'tiff' | 'ico';

const FORMATS: { id: Format; label: string; hasQuality: boolean; desc: string }[] = [
  { id: 'jpeg', label: 'JPEG', hasQuality: true, desc: '有损压缩，体积小，适合照片' },
  { id: 'webp', label: 'WebP', hasQuality: true, desc: '现代格式，压缩率高，支持透明' },
  { id: 'png', label: 'PNG', hasQuality: false, desc: '无损压缩，支持透明，适合图标' },
  { id: 'bmp', label: 'BMP', hasQuality: false, desc: '无压缩，体积大，兼容性好' },
  { id: 'tiff', label: 'TIFF', hasQuality: false, desc: '专业格式，适合印刷' },
  { id: 'ico', label: 'ICO', hasQuality: false, desc: '图标格式，Windows 使用' },
];

interface ConvertItem {
  id: string;
  file: File;
  origB64: string;
  origSize: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  result?: { data: string; size: number; orig_size: number; width: number; height: number };
  error?: string;
}

function fmtSize(n: number) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  return (n / 1024).toFixed(1) + ' KB';
}

export default function ImageConvertTool() {
  useToolTheme();
  const [items, setItems] = useState<ConvertItem[]>([]);
  const [format, setFormat] = useState<Format>('webp');
  const [quality, setQuality] = useState(85);
  const [running, setRunning] = useState(false);

  const currentFormat = FORMATS.find((f) => f.id === format)!;

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const newItems: ConvertItem[] = await Promise.all(
      arr.map(async (f) => ({
        id: Math.random().toString(36).slice(2),
        file: f,
        origB64: await fileToBase64(f),
        origSize: f.size,
        status: 'pending' as const,
      }))
    );
    setItems((prev) => [...prev, ...newItems]);
  }

  // 支持粘贴图片
  useClipboardPaste(async (b64, file) => {
    if (!file) return;
    const item: ConvertItem = {
      id: Math.random().toString(36).slice(2),
      file,
      origB64: b64,
      origSize: file.size,
      status: 'pending',
    };
    setItems((prev) => [...prev, item]);
  });

  async function runConvert() {
    if (running) return;
    setRunning(true);
    const pending = items.filter((i) => i.status === 'pending');
    for (const item of pending) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'processing' } : i)));
      try {
        const result = await invoke<ConvertItem['result']>('image_convert', {
          data: item.origB64,
          format,
          quality,
        });
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'done', result } : i))
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'error', error: String(e) } : i))
        );
      }
    }
    setRunning(false);
  }

  function downloadItem(item: ConvertItem) {
    if (!item.result) return;
    const a = document.createElement('a');
    a.href = item.result.data;
    const ext = format === 'jpeg' ? 'jpg' : format;
    a.download = `${item.file.name.replace(/\.[^.]+$/, '')}.${ext}`;
    a.click();
  }

  function downloadAll() {
    items
      .filter((i) => i.status === 'done')
      .forEach((item, idx) => {
        setTimeout(() => downloadItem(item), idx * 100);
      });
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function resetAll() {
    setItems((prev) =>
      prev.map((i) => ({ ...i, status: 'pending', result: undefined, error: undefined }))
    );
  }

  const doneCount = items.filter((i) => i.status === 'done').length;
  const totalSaved = items
    .filter((i) => i.result)
    .reduce((s, i) => s + (i.origSize - (i.result?.size ?? 0)), 0);

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="图片格式转换" icon="🔁" />
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* 参数栏 */}
        <div className="px-4 pt-3 pb-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 space-y-3">
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <div className="text-[10px] text-gray-400 mb-1.5">目标格式</div>
              <div className="flex gap-1.5 flex-wrap">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${format === f.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-gray-400 mt-1">{currentFormat.desc}</div>
            </div>
            {currentFormat.hasQuality && (
              <div className="flex-1 min-w-40">
                <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                  <span>质量</span>
                  <span className="font-medium text-gray-700 dark:text-gray-200">{quality}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* 上传区 */}
          <label
            className="flex flex-col items-center justify-center gap-2 py-5 rounded-xl border-2 border-dashed cursor-pointer transition-colors border-gray-300 dark:border-gray-600 hover:border-blue-400 bg-white dark:bg-gray-800"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
          >
            <Upload size={20} className="text-gray-400" />
            <div className="text-sm text-gray-400">
              点击或拖拽添加图片（支持多选 / Ctrl+V 粘贴）
            </div>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
              }}
            />
          </label>

          {items.length > 0 && (
            <>
              {/* 操作栏 */}
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">
                  {items.length} 张图片
                  {doneCount > 0 && ` · 已完成 ${doneCount}/${items.length}`}
                  {totalSaved > 0 && ` · 节省 ${fmtSize(totalSaved)}`}
                  {totalSaved < 0 && ` · 增加 ${fmtSize(-totalSaved)}`}
                </div>
                <div className="flex gap-2">
                  {doneCount > 0 && (
                    <button
                      onClick={downloadAll}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg"
                    >
                      <Download size={12} /> 全部下载
                    </button>
                  )}
                  <button
                    onClick={runConvert}
                    disabled={running || items.every((i) => i.status !== 'pending')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs rounded-lg"
                  >
                    {running ? (
                      <>
                        <Loader size={12} className="animate-spin" /> 转换中...
                      </>
                    ) : (
                      '开始转换'
                    )}
                  </button>
                  <button
                    onClick={resetAll}
                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-blue-500 bg-gray-100 dark:bg-gray-700 rounded-lg"
                  >
                    重置
                  </button>
                  <button
                    onClick={() => setItems([])}
                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-red-500 bg-gray-100 dark:bg-gray-700 rounded-lg"
                  >
                    清空
                  </button>
                </div>
              </div>

              {/* 文件列表 */}
              <div className="space-y-1.5">
                {items.map((item) => {
                  const ratio = item.result ? (1 - item.result.size / item.origSize) * 100 : 0;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                    >
                      {/* 状态 */}
                      <div className="flex-shrink-0">
                        {item.status === 'pending' && (
                          <div className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                        )}
                        {item.status === 'processing' && (
                          <Loader size={16} className="animate-spin text-blue-500" />
                        )}
                        {item.status === 'done' && (
                          <CheckCircle size={16} className="text-green-500" />
                        )}
                        {item.status === 'error' && (
                          <AlertCircle size={16} className="text-red-500" />
                        )}
                      </div>

                      {/* 文件信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{item.file.name}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {fmtSize(item.origSize)}
                          {item.result && (
                            <>
                              <span className="mx-1">→</span>
                              <span
                                className={
                                  ratio > 0
                                    ? 'text-green-500'
                                    : ratio < -5
                                      ? 'text-amber-500'
                                      : 'text-gray-400'
                                }
                              >
                                {fmtSize(item.result.size)}
                                {ratio !== 0 &&
                                  ` (${ratio > 0 ? '-' : '+'}${Math.abs(ratio).toFixed(1)}%)`}
                              </span>
                              <span className="mx-1 text-gray-300">·</span>
                              <span>
                                {item.result.width}×{item.result.height}
                              </span>
                            </>
                          )}
                          {item.error && <span className="text-red-500"> 失败</span>}
                        </div>
                      </div>

                      {/* 操作 */}
                      <div className="flex gap-1.5 flex-shrink-0">
                        {item.result && (
                          <button
                            onClick={() => downloadItem(item)}
                            className="p-1.5 text-gray-400 hover:text-green-500 transition-colors"
                            title="下载"
                          >
                            <Download size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => removeItem(item.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
