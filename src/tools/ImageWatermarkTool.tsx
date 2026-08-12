import { useState, useRef, useEffect, useCallback } from 'react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Upload, Download, Copy, RotateCcw } from 'lucide-react';
import { fileToBase64, useClipboardPaste, copyImageToClipboard } from './useImageInput';

interface WatermarkConfig {
  mode: 'text' | 'image';
  // 文字水印
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  opacity: number; // 0-100
  angle: number; // -180 ~ 180
  // 布局
  layout: 'single' | 'tile';
  position: 'tl' | 'tr' | 'bl' | 'br' | 'center';
  gapX: number; // 平铺水平间距
  gapY: number; // 平铺垂直间距
  offsetX: number; // 单个水印偏移
  offsetY: number;
  // 图片水印
  stampB64: string;
  stampScale: number; // 0.05 ~ 1.0
}

const DEFAULT_CONFIG: WatermarkConfig = {
  mode: 'text',
  text: '水印文字',
  fontSize: 48,
  fontFamily: 'sans-serif',
  color: '#ffffff',
  opacity: 30,
  angle: -30,
  layout: 'tile',
  position: 'center',
  gapX: 200,
  gapY: 150,
  offsetX: 0,
  offsetY: 0,
  stampB64: '',
  stampScale: 0.2,
};

const POSITIONS = [
  { id: 'tl', label: '左上' },
  { id: 'tr', label: '右上' },
  { id: 'bl', label: '左下' },
  { id: 'br', label: '右下' },
  { id: 'center', label: '居中' },
] as const;

const FONTS = ['sans-serif', 'serif', 'monospace', 'cursive'];

export default function ImageWatermarkTool() {
  useToolTheme();
  const [origB64, setOrigB64] = useState('');
  const [origW, setOrigW] = useState(0);
  const [origH, setOrigH] = useState(0);
  const [config, setConfig] = useState<WatermarkConfig>({ ...DEFAULT_CONFIG });
  const [copiedFlag, setCopiedFlag] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const origImgRef = useRef<HTMLImageElement | null>(null);
  const stampImgRef = useRef<HTMLImageElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadImage(b64: string) {
    setOrigB64(b64);
    const img = new Image();
    img.onload = () => {
      setOrigW(img.width);
      setOrigH(img.height);
      origImgRef.current = img;
    };
    img.src = b64;
  }

  async function handleFile(f: File) {
    if (!f.type.startsWith('image/')) return;
    loadImage(await fileToBase64(f));
  }

  useClipboardPaste((b64) => loadImage(b64));

  async function loadStamp(f: File) {
    if (!f.type.startsWith('image/')) return;
    const b64 = await fileToBase64(f);
    const img = new Image();
    img.onload = () => {
      stampImgRef.current = img;
      setConfig((c) => ({ ...c, stampB64: b64 }));
    };
    img.src = b64;
  }

  function update(patch: Partial<WatermarkConfig>) {
    setConfig((c) => ({ ...c, ...patch }));
  }

  // 渲染水印到 canvas
  const renderWatermark = useCallback(
    (canvas: HTMLCanvasElement, fullRes: boolean) => {
      const img = origImgRef.current;
      if (!img || !canvas) return;

      const scale = fullRes ? 1 : Math.min(600 / img.width, 400 / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);

      ctx.globalAlpha = config.opacity / 100;

      if (config.mode === 'text' && config.text.trim()) {
        const fs = Math.round(config.fontSize * scale);
        ctx.font = `${fs}px ${config.fontFamily}`;
        ctx.fillStyle = config.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (config.layout === 'tile') {
          const gx = Math.max(50, config.gapX * scale);
          const gy = Math.max(50, config.gapY * scale);
          const diag = Math.sqrt(w * w + h * h);
          ctx.save();
          ctx.translate(w / 2, h / 2);
          ctx.rotate((config.angle * Math.PI) / 180);
          for (let y = -diag; y < diag; y += gy) {
            for (let x = -diag; x < diag; x += gx) {
              ctx.fillText(config.text, x, y);
            }
          }
          ctx.restore();
        } else {
          const { px, py } = getSinglePos(
            w,
            h,
            fs,
            config.position,
            config.offsetX * scale,
            config.offsetY * scale
          );
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate((config.angle * Math.PI) / 180);
          ctx.fillText(config.text, 0, 0);
          ctx.restore();
        }
      } else if (config.mode === 'image' && stampImgRef.current) {
        const stamp = stampImgRef.current;
        const sw = Math.round(stamp.width * config.stampScale * scale);
        const sh = Math.round(stamp.height * config.stampScale * scale);

        if (config.layout === 'tile') {
          const gx = Math.max(sw + 20, config.gapX * scale);
          const gy = Math.max(sh + 20, config.gapY * scale);
          const diag = Math.sqrt(w * w + h * h);
          ctx.save();
          ctx.translate(w / 2, h / 2);
          ctx.rotate((config.angle * Math.PI) / 180);
          for (let y = -diag; y < diag; y += gy) {
            for (let x = -diag; x < diag; x += gx) {
              ctx.drawImage(stamp, x - sw / 2, y - sh / 2, sw, sh);
            }
          }
          ctx.restore();
        } else {
          const { px, py } = getSinglePos(
            w,
            h,
            sw,
            config.position,
            config.offsetX * scale,
            config.offsetY * scale
          );
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate((config.angle * Math.PI) / 180);
          ctx.drawImage(stamp, -sw / 2, -sh / 2, sw, sh);
          ctx.restore();
        }
      }

      ctx.globalAlpha = 1;
    },
    [config]
  );

  // 防抖预览
  useEffect(() => {
    if (!origB64 || !previewRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      renderWatermark(previewRef.current!, false);
    }, 100);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [origB64, config, renderWatermark]);

  function getResultDataUrl(): string {
    const canvas = canvasRef.current!;
    renderWatermark(canvas, true);
    return canvas.toDataURL('image/png');
  }

  function download() {
    const url = getResultDataUrl();
    const a = document.createElement('a');
    a.href = url;
    a.download = 'watermarked.png';
    a.click();
  }

  async function copyResult() {
    const url = getResultDataUrl();
    if (await copyImageToClipboard(url)) setCopiedFlag(true);
    setTimeout(() => setCopiedFlag(false), 1500);
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="图片水印" icon="🔏" />
      <canvas ref={canvasRef} className="hidden" />
      <div className="flex-1 overflow-hidden flex">
        {/* 左侧预览 */}
        <div className="flex-1 flex flex-col p-4 min-w-0">
          {!origB64 ? (
            <label
              className="flex-1 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer border-gray-300 dark:border-gray-600 hover:border-pink-400 bg-white dark:bg-gray-800"
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
              <div className="flex-1 rounded-xl border bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden">
                <canvas ref={previewRef} className="max-w-full max-h-full object-contain" />
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-pink-500 cursor-pointer">
                    <Upload size={12} /> 重选图片
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
                  <span className="text-xs text-gray-300 dark:text-gray-600">
                    {origW} × {origH}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={copyResult}
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg"
                  >
                    <Copy size={13} /> {copiedFlag ? '已复制 ✓' : '复制'}
                  </button>
                  <button
                    onClick={download}
                    className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg"
                  >
                    <Download size={13} /> 下载
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 右侧控制面板 */}
        {origB64 && (
          <div className="w-72 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-y-auto p-4 space-y-4 flex-shrink-0">
            {/* 水印类型 */}
            <div>
              <div className="text-xs font-medium text-gray-400 mb-2">水印类型</div>
              <div className="flex gap-1.5">
                {(['text', 'image'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => update({ mode: m })}
                    className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${config.mode === m ? 'bg-pink-600 text-white' : 'bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                  >
                    {m === 'text' ? '文字水印' : '图片水印'}
                  </button>
                ))}
              </div>
            </div>

            {/* 文字水印参数 */}
            {config.mode === 'text' && (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-400 mb-1">水印文字</div>
                  <input
                    className="w-full px-2 py-1.5 rounded-lg border text-sm outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white"
                    value={config.text}
                    onChange={(e) => update({ text: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <div className="text-xs text-gray-400 mb-1">字号</div>
                    <input
                      type="number"
                      min="12"
                      max="200"
                      value={config.fontSize}
                      onChange={(e) => update({ fontSize: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 rounded-lg border text-xs outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-gray-400 mb-1">颜色</div>
                    <input
                      type="color"
                      value={config.color}
                      onChange={(e) => update({ color: e.target.value })}
                      className="w-full h-8 rounded-lg border border-gray-200 dark:border-gray-600 cursor-pointer"
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">字体</div>
                  <select
                    value={config.fontFamily}
                    onChange={(e) => update({ fontFamily: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg border text-xs outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white"
                  >
                    {FONTS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* 图片水印参数 */}
            {config.mode === 'image' && (
              <div className="space-y-3">
                <label className="flex flex-col items-center gap-2 py-4 rounded-lg border-2 border-dashed cursor-pointer border-gray-300 dark:border-gray-600 hover:border-pink-400">
                  <Upload size={16} className="text-gray-400" />
                  <div className="text-xs text-gray-400">
                    {config.stampB64 ? '已选择水印图片' : '选择水印图片'}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) loadStamp(f);
                    }}
                  />
                </label>
                {config.stampB64 && (
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>缩放</span>
                      <span>{Math.round(config.stampScale * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={config.stampScale}
                      onChange={(e) => update({ stampScale: Number(e.target.value) })}
                      className="w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-pink-500"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 通用参数 */}
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>透明度</span>
                  <span>{config.opacity}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  value={config.opacity}
                  onChange={(e) => update({ opacity: Number(e.target.value) })}
                  className="w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-pink-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>角度</span>
                  <span>{config.angle}°</span>
                </div>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  value={config.angle}
                  onChange={(e) => update({ angle: Number(e.target.value) })}
                  className="w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-pink-500"
                />
              </div>
            </div>

            {/* 布局 */}
            <div>
              <div className="text-xs font-medium text-gray-400 mb-2">布局方式</div>
              <div className="flex gap-1.5">
                {(['tile', 'single'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => update({ layout: l })}
                    className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${config.layout === l ? 'bg-pink-600 text-white' : 'bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                  >
                    {l === 'tile' ? '平铺' : '单个'}
                  </button>
                ))}
              </div>
            </div>

            {config.layout === 'tile' ? (
              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="text-xs text-gray-400 mb-1">水平间距</div>
                  <input
                    type="number"
                    min="50"
                    max="800"
                    value={config.gapX}
                    onChange={(e) => update({ gapX: Number(e.target.value) })}
                    className="w-full px-2 py-1.5 rounded-lg border text-xs outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white"
                  />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-gray-400 mb-1">垂直间距</div>
                  <input
                    type="number"
                    min="50"
                    max="800"
                    value={config.gapY}
                    onChange={(e) => update({ gapY: Number(e.target.value) })}
                    className="w-full px-2 py-1.5 rounded-lg border text-xs outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
            ) : (
              <>
                <div>
                  <div className="text-xs text-gray-400 mb-1.5">位置</div>
                  <div className="grid grid-cols-3 gap-1">
                    {POSITIONS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => update({ position: p.id })}
                        className={`py-1.5 text-xs rounded-lg transition-colors ${config.position === p.id ? 'bg-pink-600 text-white' : 'bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <div className="text-xs text-gray-400 mb-1">X 偏移</div>
                    <input
                      type="number"
                      value={config.offsetX}
                      onChange={(e) => update({ offsetX: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 rounded-lg border text-xs outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-gray-400 mb-1">Y 偏移</div>
                    <input
                      type="number"
                      value={config.offsetY}
                      onChange={(e) => update({ offsetY: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 rounded-lg border text-xs outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white"
                    />
                  </div>
                </div>
              </>
            )}

            {/* 重置 */}
            <button
              onClick={() => setConfig({ ...DEFAULT_CONFIG })}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              <RotateCcw size={12} /> 重置参数
            </button>
            <button
              onClick={() => {
                setOrigB64('');
                setOrigW(0);
                setOrigH(0);
                setConfig({ ...DEFAULT_CONFIG });
              }}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors border-t border-gray-100 dark:border-gray-700"
            >
              <RotateCcw size={12} /> 重置图片
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function getSinglePos(w: number, h: number, size: number, pos: string, ox: number, oy: number) {
  const margin = size * 0.5;
  switch (pos) {
    case 'tl':
      return { px: margin + ox, py: margin + oy };
    case 'tr':
      return { px: w - margin + ox, py: margin + oy };
    case 'bl':
      return { px: margin + ox, py: h - margin + oy };
    case 'br':
      return { px: w - margin + ox, py: h - margin + oy };
    default:
      return { px: w / 2 + ox, py: h / 2 + oy };
  }
}
