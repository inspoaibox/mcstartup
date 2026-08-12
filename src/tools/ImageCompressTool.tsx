import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Upload, Download, Copy, X, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { fileToBase64, useClipboardPaste, copyImageToClipboard } from './useImageInput';

type Format = 'jpeg' | 'webp' | 'png' | 'bmp' | 'tiff';
type Mode = 'single' | 'batch';

interface CompressResult {
  data: string;
  size: number;
  width: number;
  height: number;
  enlarged: boolean; // Rust 后端判断：压缩后比原图大，已自动用原图
  mime: string;
}

interface BatchItem {
  id: string;
  file: File;
  origSize: number;
  origB64: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  result?: CompressResult;
  error?: string;
  enlarged?: boolean; // 压缩后反而变大
}

const FORMATS: { id: Format; label: string; hasQuality: boolean }[] = [
  { id: 'jpeg', label: 'JPEG', hasQuality: true },
  { id: 'webp', label: 'WebP', hasQuality: true },
  { id: 'png', label: 'PNG', hasQuality: false },
  { id: 'bmp', label: 'BMP', hasQuality: false },
  { id: 'tiff', label: 'TIFF', hasQuality: false },
];

const PRESETS = [
  { label: '网页优化', format: 'webp' as Format, quality: 80, maxW: 1920, maxH: 1080 },
  { label: '微信发送', format: 'jpeg' as Format, quality: 70, maxW: 1280, maxH: 1280 },
  { label: '极致压缩', format: 'webp' as Format, quality: 30, maxW: 1200, maxH: 1200 },
  { label: '高质量', format: 'jpeg' as Format, quality: 95, maxW: undefined, maxH: undefined },
];

function fmtSize(n: number) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  return (n / 1024).toFixed(1) + ' KB';
}

function base64Size(b64: string): number {
  const raw = b64.includes(',') ? b64.split(',')[1] : b64;
  return Math.round((raw.length * 3) / 4);
}

export default function ImageCompressTool() {
  useToolTheme();
  const [mode, setMode] = useState<Mode>('single');

  // 单张模式
  const [origB64, setOrigB64] = useState('');
  const [origSize, setOrigSize] = useState(0);
  const [origW, setOrigW] = useState(0);
  const [origH, setOrigH] = useState(0);
  const [compResult, setCompResult] = useState<CompressResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [copiedFlag, setCopiedFlag] = useState(false);
  const [enlarged, setEnlarged] = useState(false);

  // 批量模式
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);

  // 压缩参数
  const [format, setFormat] = useState<Format>('jpeg');
  const [quality, setQuality] = useState(80);
  const [maxW, setMaxW] = useState<number | ''>('');
  const [maxH, setMaxH] = useState<number | ''>('');

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentFormat = FORMATS.find((f) => f.id === format)!;

  // ── 单张模式 ──────────────────────────────────────────────────────────────

  async function loadSingle(b64: string, file?: File) {
    setOrigB64(b64);
    setOrigSize(file ? file.size : base64Size(b64));
    setCompResult(null);
    setEnlarged(false);
    const img = new Image();
    img.onload = () => {
      setOrigW(img.width);
      setOrigH(img.height);
    };
    img.src = b64;
    if (file?.type === 'image/png') setFormat('png');
    else if (file?.type === 'image/webp') setFormat('webp');
    else setFormat('jpeg');
  }

  async function handleSingleFile(f: File) {
    if (!f.type.startsWith('image/')) return;
    loadSingle(await fileToBase64(f), f);
  }

  useClipboardPaste((b64, file) => {
    if (mode === 'single') loadSingle(b64, file);
  });

  const doCompress = useCallback(async () => {
    if (!origB64) return;
    setPreviewing(true);
    try {
      const result = await invoke<CompressResult>('image_compress_advanced', {
        data: origB64,
        format,
        quality,
        maxWidth: maxW || null,
        maxHeight: maxH || null,
      });
      // Rust 后端已处理：压缩后比原图大时自动返回原图
      // enlarged=true 说明当前参数无法有效压缩，提示用户换格式或降质量
      setEnlarged(result.enlarged);
      setCompResult(result);
    } catch (e) {
      console.error('压缩失败:', e);
    } finally {
      setPreviewing(false);
    }
  }, [origB64, format, quality, maxW, maxH]);

  useEffect(() => {
    if (!origB64) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(doCompress, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [doCompress, origB64]);

  function downloadSingle() {
    if (!compResult) return;
    const a = document.createElement('a');
    a.href = compResult.data;
    a.download = `compressed.${format === 'jpeg' ? 'jpg' : format}`;
    a.click();
  }

  // ── 批量模式 ──────────────────────────────────────────────────────────────

  async function addBatchFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const newItems: BatchItem[] = await Promise.all(
      arr.map(async (f) => ({
        id: Math.random().toString(36).slice(2),
        file: f,
        origSize: f.size,
        origB64: await fileToBase64(f),
        status: 'pending' as const,
      }))
    );
    setBatchItems((prev) => [...prev, ...newItems]);
  }

  async function runBatch() {
    if (batchRunning) return;
    setBatchRunning(true);
    const pending = batchItems.filter((i) => i.status === 'pending');
    for (const item of pending) {
      setBatchItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: 'processing' } : i))
      );
      try {
        const result = await invoke<CompressResult>('image_compress_advanced', {
          data: item.origB64,
          format,
          quality,
          maxWidth: maxW || null,
          maxHeight: maxH || null,
        });
        const enlarged = result.enlarged;
        setBatchItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'done', result, enlarged } : i))
        );
      } catch (e) {
        setBatchItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'error', error: String(e) } : i))
        );
      }
    }
    setBatchRunning(false);
  }

  function downloadBatchItem(item: BatchItem) {
    if (!item.result) return;
    const a = document.createElement('a');
    a.href = item.result.data;
    a.download = `${item.file.name.replace(/\.[^.]+$/, '')}_compressed.${format === 'jpeg' ? 'jpg' : format}`;
    a.click();
  }

  function downloadAllBatch() {
    batchItems
      .filter((i) => i.status === 'done' && i.result)
      .forEach((item) => {
        setTimeout(() => downloadBatchItem(item), 100);
      });
  }

  function removeBatchItem(id: string) {
    setBatchItems((prev) => prev.filter((i) => i.id !== id));
  }

  function clearBatch() {
    setBatchItems([]);
  }

  const batchDone = batchItems.filter((i) => i.status === 'done').length;
  const batchTotal = batchItems.length;
  const batchOrigTotal = batchItems.reduce((s, i) => s + i.origSize, 0);
  const batchCompTotal = batchItems
    .filter((i) => i.result)
    .reduce((s, i) => s + (i.result?.size ?? 0), 0);

  // ── 参数面板（共用） ──────────────────────────────────────────────────────

  function applyPreset(p: (typeof PRESETS)[0]) {
    setFormat(p.format);
    setQuality(p.quality);
    setMaxW(p.maxW ?? '');
    setMaxH(p.maxH ?? '');
  }

  const saved = origSize > 0 && compResult ? origSize - compResult.size : 0;
  const ratio = origSize > 0 && compResult ? (1 - compResult.size / origSize) * 100 : 0;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="图片压缩" icon="📦" />
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* 顶部：模式切换 + 参数 */}
        <div className="px-4 pt-3 pb-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 space-y-3">
          {/* 模式 */}
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {(['single', 'batch'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${mode === m ? 'bg-pink-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                >
                  {m === 'single' ? '单张' : '批量'}
                </button>
              ))}
            </div>
            <div className="h-4 w-px bg-gray-200 dark:bg-gray-600" />
            {/* 预设 */}
            <div className="flex gap-1.5 flex-wrap">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className="px-2.5 py-1 text-[11px] rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-pink-50 dark:hover:bg-pink-900/20 hover:text-pink-600 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 参数行 */}
          <div className="flex gap-3 items-end flex-wrap">
            {/* 格式 */}
            <div>
              <div className="text-[10px] text-gray-400 mb-1">格式</div>
              <div className="flex gap-1">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${format === f.id ? 'bg-pink-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 质量 */}
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
                  className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                />
                <div className="flex justify-between text-[9px] text-gray-300 dark:text-gray-600 mt-0.5">
                  <span>最小体积</span>
                  <span>最高质量</span>
                </div>
              </div>
            )}

            {/* 尺寸限制 */}
            <div className="flex gap-1.5 items-end">
              <div>
                <div className="text-[10px] text-gray-400 mb-1">最大宽</div>
                <input
                  type="number"
                  min="1"
                  placeholder="不限"
                  value={maxW}
                  onChange={(e) => setMaxW(e.target.value ? Number(e.target.value) : '')}
                  className="w-20 px-2 py-1 rounded-lg border text-xs outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-300"
                />
              </div>
              <div>
                <div className="text-[10px] text-gray-400 mb-1">最大高</div>
                <input
                  type="number"
                  min="1"
                  placeholder="不限"
                  value={maxH}
                  onChange={(e) => setMaxH(e.target.value ? Number(e.target.value) : '')}
                  className="w-20 px-2 py-1 rounded-lg border text-xs outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-300"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {mode === 'single' ? (
            <>
              {/* 上传 */}
              <label
                className="flex flex-col items-center justify-center gap-2 py-5 rounded-xl border-2 border-dashed cursor-pointer transition-colors border-gray-300 dark:border-gray-600 hover:border-pink-400 bg-white dark:bg-gray-800"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleSingleFile(f);
                }}
              >
                <Upload size={20} className="text-gray-400" />
                <div className="text-sm text-gray-400">
                  {origB64
                    ? `${origW} × ${origH} · ${fmtSize(origSize)}`
                    : '点击上传 / 拖拽 / Ctrl+V 粘贴图片'}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSingleFile(f);
                  }}
                />
              </label>
              {origB64 && (
                <button
                  onClick={() => {
                    setOrigB64('');
                    setCompResult(null);
                    setEnlarged(false);
                    setOrigSize(0);
                    setOrigW(0);
                    setOrigH(0);
                  }}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors self-end"
                >
                  重置
                </button>
              )}

              {/* 统计 */}
              {compResult && (
                <>
                  {enlarged && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
                      <AlertCircle size={13} />
                      当前参数无法压缩此图片（已返回原图）。原因：原图编码效率已很高，重新编码反而更大。建议：换用
                      WebP 格式，或降低质量到 80% 以下。
                    </div>
                  )}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: '原始', value: fmtSize(origSize), sub: `${origW}×${origH}` },
                      {
                        label: '压缩后',
                        value: fmtSize(compResult.size),
                        sub: `${compResult.width}×${compResult.height}`,
                        loading: previewing,
                      },
                      {
                        label: '压缩率',
                        value: `${ratio > 0 ? '-' : '+'}${Math.abs(ratio).toFixed(1)}%`,
                        color: ratio > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500',
                      },
                      {
                        label: '节省',
                        value: `${saved > 0 ? '-' : '+'}${fmtSize(Math.abs(saved))}`,
                        color: saved > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500',
                      },
                    ].map(({ label, value, sub, color, loading }) => (
                      <div
                        key={label}
                        className="rounded-xl border p-2.5 text-center bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                      >
                        <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
                        <div
                          className={`text-sm font-semibold ${color ?? ''} ${loading ? 'opacity-40' : ''}`}
                        >
                          {value}
                        </div>
                        {sub && <div className="text-[9px] text-gray-400 mt-0.5">{sub}</div>}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* 对比预览 */}
              {origB64 && compResult && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-700 flex justify-between">
                      <span className="text-xs font-medium text-gray-500">原图</span>
                      <span className="text-xs text-gray-400">{fmtSize(origSize)}</span>
                    </div>
                    <div className="p-2 flex items-center justify-center min-h-32 bg-gray-50 dark:bg-gray-900">
                      <img
                        src={origB64}
                        alt="original"
                        className="max-w-full max-h-48 object-contain"
                      />
                    </div>
                  </div>
                  <div
                    className={`rounded-xl border bg-white dark:bg-gray-800 overflow-hidden transition-opacity ${previewing ? 'opacity-50' : ''} ${enlarged ? 'border-amber-300 dark:border-amber-700' : ratio > 0 ? 'border-green-300 dark:border-green-700' : 'border-red-300 dark:border-red-700'}`}
                  >
                    <div
                      className={`px-3 py-1.5 border-b flex justify-between ${enlarged ? 'border-amber-100 dark:border-amber-800' : ratio > 0 ? 'border-green-100 dark:border-green-800' : 'border-red-100 dark:border-red-800'}`}
                    >
                      <span
                        className={`text-xs font-medium ${previewing ? 'text-gray-400' : enlarged ? 'text-amber-600 dark:text-amber-400' : ratio > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}
                      >
                        {previewing ? '处理中...' : enlarged ? '⚠ 体积增大' : '压缩后'}
                      </span>
                      <span className="text-xs text-gray-400">{fmtSize(compResult.size)}</span>
                    </div>
                    <div className="p-2 flex items-center justify-center min-h-32 bg-gray-50 dark:bg-gray-900">
                      <img
                        src={compResult.data}
                        alt="compressed"
                        className="max-w-full max-h-48 object-contain"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              {compResult && !previewing && (
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (await copyImageToClipboard(compResult.data)) setCopiedFlag(true);
                      setTimeout(() => setCopiedFlag(false), 1500);
                    }}
                    className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    <Copy size={14} /> {copiedFlag ? '已复制 ✓' : '复制'}
                  </button>
                  <button
                    onClick={downloadSingle}
                    className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    <Download size={14} /> 下载 · {fmtSize(compResult.size)}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {/* 批量上传区 */}
              <label
                className="flex flex-col items-center justify-center gap-2 py-5 rounded-xl border-2 border-dashed cursor-pointer transition-colors border-gray-300 dark:border-gray-600 hover:border-pink-400 bg-white dark:bg-gray-800"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  addBatchFiles(e.dataTransfer.files);
                }}
              >
                <Upload size={20} className="text-gray-400" />
                <div className="text-sm text-gray-400">点击或拖拽添加多张图片</div>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addBatchFiles(e.target.files);
                  }}
                />
              </label>

              {/* 批量统计 */}
              {batchItems.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-500">
                      {batchTotal} 张图片
                      {batchDone > 0 && ` · 已完成 ${batchDone}/${batchTotal}`}
                      {batchDone > 0 &&
                        batchCompTotal > 0 &&
                        ` · 节省 ${fmtSize(batchOrigTotal - batchCompTotal)}`}
                    </div>
                    <div className="flex gap-2">
                      {batchDone > 0 && (
                        <button
                          onClick={downloadAllBatch}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg"
                        >
                          <Download size={12} /> 全部下载
                        </button>
                      )}
                      <button
                        onClick={runBatch}
                        disabled={batchRunning || batchItems.every((i) => i.status !== 'pending')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-pink-600 hover:bg-pink-700 disabled:opacity-40 text-white text-xs rounded-lg"
                      >
                        {batchRunning ? (
                          <>
                            <Loader size={12} className="animate-spin" /> 处理中...
                          </>
                        ) : (
                          '开始压缩'
                        )}
                      </button>
                      <button
                        onClick={clearBatch}
                        className="px-3 py-1.5 text-xs text-gray-400 hover:text-red-500 bg-gray-100 dark:bg-gray-700 rounded-lg"
                      >
                        清空
                      </button>
                    </div>
                  </div>

                  {/* 批量列表 */}
                  <div className="space-y-1.5">
                    {batchItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                      >
                        {/* 状态图标 */}
                        <div className="flex-shrink-0">
                          {item.status === 'pending' && (
                            <div className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                          )}
                          {item.status === 'processing' && (
                            <Loader size={16} className="animate-spin text-pink-500" />
                          )}
                          {item.status === 'done' && !item.enlarged && (
                            <CheckCircle size={16} className="text-green-500" />
                          )}
                          {item.status === 'done' && item.enlarged && (
                            <AlertCircle size={16} className="text-amber-500" />
                          )}
                          {item.status === 'error' && (
                            <AlertCircle size={16} className="text-red-500" />
                          )}
                        </div>

                        {/* 文件名 */}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{item.file.name}</div>
                          <div className="text-[10px] text-gray-400">
                            {fmtSize(item.origSize)}
                            {item.result && (
                              <span className={item.enlarged ? 'text-amber-500' : 'text-green-500'}>
                                {' → '}
                                {fmtSize(item.result.size)} ({item.enlarged ? '+' : '-'}
                                {Math.abs((1 - item.result.size / item.origSize) * 100).toFixed(1)}
                                %)
                              </span>
                            )}
                            {item.error && (
                              <span className="text-red-500"> 失败: {item.error}</span>
                            )}
                          </div>
                        </div>

                        {/* 操作 */}
                        <div className="flex gap-1.5 flex-shrink-0">
                          {item.result && (
                            <button
                              onClick={() => downloadBatchItem(item)}
                              className="p-1.5 text-gray-400 hover:text-green-500 transition-colors"
                            >
                              <Download size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => removeBatchItem(item.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
