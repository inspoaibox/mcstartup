import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Upload, Download, RotateCcw, Copy } from 'lucide-react';
import { fileToBase64, useClipboardPaste, copyImageToClipboard } from './useImageInput';

const PRESETS = [
  { label: '自由', ratio: 0 },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '2:3', ratio: 2 / 3 },
];

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function ImageCropTool() {
  useToolTheme();
  const [origB64, setOrigB64] = useState('');
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);
  const [preset, setPreset] = useState(0);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resultB64, setResultB64] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedFlag, setCopiedFlag] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  async function loadImage(b64: string) {
    setOrigB64(b64);
    setResultB64('');
    setCrop({ x: 0, y: 0, w: 0, h: 0 });
    const img = new Image();
    img.onload = () => {
      setImgW(img.width);
      setImgH(img.height);
    };
    img.src = b64;
  }

  async function handleFile(f: File) {
    if (!f.type.startsWith('image/')) return;
    loadImage(await fileToBase64(f));
  }

  useClipboardPaste((b64) => loadImage(b64));

  // 获取图片在 DOM 中的实际渲染尺寸和偏移
  function getImgRect() {
    const el = imgRef.current;
    if (!el) return null;
    return el.getBoundingClientRect();
  }

  // 鼠标坐标 → 图片像素坐标
  function toImgCoords(clientX: number, clientY: number) {
    const rect = getImgRect();
    if (!rect || !imgW || !imgH) return { x: 0, y: 0 };
    const scaleX = imgW / rect.width;
    const scaleY = imgH / rect.height;
    const x = Math.max(0, Math.min(imgW, (clientX - rect.left) * scaleX));
    const y = Math.max(0, Math.min(imgH, (clientY - rect.top) * scaleY));
    return { x, y };
  }

  type DragMode = 'create' | 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br';
  const [dragMode, setDragMode] = useState<DragMode>('create');
  const [moveOffset, setMoveOffset] = useState({ x: 0, y: 0 });

  function getEdgeHit(px: number, py: number): DragMode | null {
    if (crop.w < 5 || crop.h < 5) return null;
    // 用图片像素坐标的百分比来判定，手柄区域为裁剪框尺寸的 8%
    const margin = Math.max(crop.w, crop.h) * 0.08;
    const { x, y, w, h } = crop;
    const nearL = px - x < margin && px >= x - margin;
    const nearR = x + w - px < margin && px <= x + w + margin;
    const nearT = py - y < margin && py >= y - margin;
    const nearB = y + h - py < margin && py <= y + h + margin;
    if (nearT && nearL) return 'resize-tl';
    if (nearT && nearR) return 'resize-tr';
    if (nearB && nearL) return 'resize-bl';
    if (nearB && nearR) return 'resize-br';
    return null;
  }

  function isInsideCrop(px: number, py: number): boolean {
    return (
      crop.w > 5 &&
      crop.h > 5 &&
      px >= crop.x &&
      px <= crop.x + crop.w &&
      py >= crop.y &&
      py <= crop.y + crop.h
    );
  }

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const { x, y } = toImgCoords(e.clientX, e.clientY);
    setDragging(true);

    const edge = getEdgeHit(x, y);
    if (edge) {
      setDragMode(edge);
    } else if (isInsideCrop(x, y)) {
      setDragMode('move');
      setMoveOffset({ x: x - crop.x, y: y - crop.y });
    } else {
      setDragMode('create');
      setDragStart({ x, y });
      setCrop({ x, y, w: 0, h: 0 });
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging) return;
    const { x: mx, y: my } = toImgCoords(e.clientX, e.clientY);
    const p = PRESETS[preset];

    if (dragMode === 'move') {
      let nx = mx - moveOffset.x;
      let ny = my - moveOffset.y;
      nx = Math.max(0, Math.min(imgW - crop.w, nx));
      ny = Math.max(0, Math.min(imgH - crop.h, ny));
      setCrop((prev) => ({ ...prev, x: nx, y: ny }));
    } else if (dragMode === 'create') {
      const w = mx - dragStart.x;
      let h = my - dragStart.y;
      if (p.ratio > 0) {
        h = (Math.abs(w) / p.ratio) * Math.sign(h || 1);
      }
      const cx = w < 0 ? dragStart.x + w : dragStart.x;
      const cy = h < 0 ? dragStart.y + h : dragStart.y;
      setCrop({
        x: Math.max(0, Math.min(imgW, cx)),
        y: Math.max(0, Math.min(imgH, cy)),
        w: Math.min(Math.abs(w), imgW - Math.max(0, cx)),
        h: Math.min(Math.abs(h), imgH - Math.max(0, cy)),
      });
    } else {
      // resize 模式
      const { x: ox, y: oy, w: ow, h: oh } = crop;
      let nx = ox,
        ny = oy,
        nw = ow,
        nh = oh;

      if (dragMode === 'resize-br') {
        nw = Math.max(10, Math.min(imgW - ox, mx - ox));
        nh = p.ratio > 0 ? nw / p.ratio : Math.max(10, Math.min(imgH - oy, my - oy));
      } else if (dragMode === 'resize-bl') {
        nw = Math.max(10, ox + ow - Math.max(0, mx));
        nx = ox + ow - nw;
        nh = p.ratio > 0 ? nw / p.ratio : Math.max(10, Math.min(imgH - oy, my - oy));
      } else if (dragMode === 'resize-tr') {
        nw = Math.max(10, Math.min(imgW - ox, mx - ox));
        nh = p.ratio > 0 ? nw / p.ratio : Math.max(10, oy + oh - Math.max(0, my));
        ny = oy + oh - nh;
      } else if (dragMode === 'resize-tl') {
        nw = Math.max(10, ox + ow - Math.max(0, mx));
        nx = ox + ow - nw;
        nh = p.ratio > 0 ? nw / p.ratio : Math.max(10, oy + oh - Math.max(0, my));
        ny = oy + oh - nh;
      }

      setCrop({ x: Math.max(0, nx), y: Math.max(0, ny), w: nw, h: nh });
    }
  }

  function handleMouseUp() {
    setDragging(false);
  }

  async function doCrop() {
    if (!origB64 || crop.w < 1 || crop.h < 1) return;
    setLoading(true);
    try {
      const result = await invoke<string>('image_crop', {
        data: origB64,
        x: Math.round(crop.x),
        y: Math.round(crop.y),
        w: Math.round(crop.w),
        h: Math.round(crop.h),
      });
      setResultB64(result);
    } catch (e) {
      console.error('裁剪失败:', e);
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!resultB64) return;
    const a = document.createElement('a');
    a.href = resultB64;
    a.download = 'cropped.png';
    a.click();
  }

  // 选框在 DOM 上的位置（基于图片实际渲染尺寸）
  function getCropStyle() {
    const rect = getImgRect();
    if (!rect || !imgW || !imgH) return {};
    const scaleX = rect.width / imgW;
    const scaleY = rect.height / imgH;
    return {
      left: crop.x * scaleX,
      top: crop.y * scaleY,
      width: crop.w * scaleX,
      height: crop.h * scaleY,
    };
  }

  const [, forceUpdate] = useState(0);
  // 图片加载后重新计算选框位置
  useEffect(() => {
    forceUpdate((n) => n + 1);
  }, [origB64]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="图片裁剪" icon="✂️" />
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
            {/* 比例预设 + 重选 */}
            <div className="flex gap-2 flex-wrap items-center">
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setPreset(i);
                    // 选中比例后自动生成居中裁剪框
                    const p = PRESETS[i];
                    if (p.ratio > 0 && imgW > 0 && imgH > 0) {
                      let cw: number, ch: number;
                      if (imgW / imgH > p.ratio) {
                        ch = imgH;
                        cw = ch * p.ratio;
                      } else {
                        cw = imgW;
                        ch = cw / p.ratio;
                      }
                      setCrop({
                        x: (imgW - cw) / 2,
                        y: (imgH - ch) / 2,
                        w: cw,
                        h: ch,
                      });
                    } else if (p.ratio === 0 && imgW > 0 && imgH > 0) {
                      // 自由模式：选中整张图
                      setCrop({ x: 0, y: 0, w: imgW, h: imgH });
                    }
                  }}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${preset === i ? 'bg-pink-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => {
                  setOrigB64('');
                  setResultB64('');
                  setCrop({ x: 0, y: 0, w: 0, h: 0 });
                  setPreset(0);
                }}
                className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-red-500"
              >
                <RotateCcw size={12} /> 重置
              </button>
            </div>

            {/* 裁剪区域 - 使用 relative 包裹图片，选框绝对定位在图片上 */}
            <div
              className="rounded-xl border bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 overflow-hidden flex items-center justify-center"
              style={{ minHeight: 360 }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <div className="relative inline-block select-none">
                <img
                  ref={imgRef}
                  src={origB64}
                  alt=""
                  className="block max-w-full max-h-80 pointer-events-none"
                  draggable={false}
                />
                {crop.w > 1 && crop.h > 1 && (
                  <div
                    className="absolute border-2 border-pink-500 cursor-move"
                    style={{ ...getCropStyle(), boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)' }}
                  >
                    {/* 四角拖拽手柄 */}
                    <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-pink-500 cursor-nw-resize" />
                    <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-pink-500 cursor-ne-resize" />
                    <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-pink-500 cursor-sw-resize" />
                    <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-pink-500 cursor-se-resize" />
                  </div>
                )}
              </div>
            </div>

            {/* 信息 + 操作 */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-400">
                {crop.w > 1
                  ? `选区: ${Math.round(crop.x)}, ${Math.round(crop.y)} · ${Math.round(crop.w)} × ${Math.round(crop.h)} px`
                  : '拖拽选择裁剪区域'}
              </div>
              <button
                onClick={doCrop}
                disabled={crop.w < 1 || loading}
                className="px-4 py-2 bg-pink-600 hover:bg-pink-700 disabled:opacity-40 text-white text-sm rounded-lg"
              >
                {loading ? '裁剪中...' : '裁剪'}
              </button>
            </div>

            {/* 结果 */}
            {resultB64 && (
              <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">裁剪结果</span>
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
                <img src={resultB64} alt="cropped" className="max-h-60 mx-auto rounded-lg" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
