import { useState, useEffect, useRef } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { readBinaryFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjsLib from 'pdfjs-dist';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Upload, X, CheckCircle, Loader, AlertCircle, Save } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// Canvas 渲染水印预览（仅用于预览，不写入 PDF）
function makePreviewWatermark(
  text: string,
  fontSize: number,
  opacity: number,
  angle: number,
  color: string,
  tiled: boolean,
  w: number,
  h: number
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Arial,sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rad = (angle * Math.PI) / 180;
  if (tiled) {
    const tw = ctx.measureText(text).width;
    const sx = tw + fontSize * 2,
      sy = fontSize * 3;
    for (let y = -sy; y < h + sy * 2; y += sy)
      for (let x = -sx; x < w + sx * 2; x += sx) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rad);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
  } else {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rad);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  return c;
}

function hexToRgb01(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

export default function PdfWatermarkTool() {
  const ready = useToolTheme();
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [hqPageUrl, setHqPageUrl] = useState<string | null>(null);
  const [hqSize, setHqSize] = useState({ w: 0, h: 0 });
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [text, setText] = useState('机密文件');
  const [fontSize, setFontSize] = useState(48);
  const [opacity, setOpacity] = useState(0.3);
  const [angle, setAngle] = useState(45);
  const [color, setColor] = useState('#ff0000');
  const [tiled, setTiled] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 缓存字体数据
  const fontBytesRef = useRef<Uint8Array | null>(null);

  const selectFile = async () => {
    const sel = await open({ filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!sel || Array.isArray(sel)) return;
    setFilePath(sel);
    setFileName(sel.split(/[\\/]/).pop() || sel);
    setHqPageUrl(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    setLoadingPreview(true);
    try {
      const bytes = await readBinaryFile(sel);
      const pdfDoc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
      setPageCount(pdfDoc.getPageCount());
      // 渲染高清第一页（800px）
      const data = new Uint8Array(bytes);
      const doc = await pdfjsLib.getDocument({ data }).promise;
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const scale = 800 / vp.width;
      const svp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = svp.width;
      canvas.height = svp.height;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: svp, canvas }).promise;
      page.cleanup();
      await doc.destroy();
      setHqPageUrl(canvas.toDataURL('image/jpeg', 0.96));
      setHqSize({ w: svp.width, h: svp.height });
    } catch (e: any) {
      setError('无法读取 PDF: ' + e.message);
    } finally {
      setLoadingPreview(false);
    }
  };

  // 实时预览（Canvas 叠加，仅用于预览）
  useEffect(() => {
    if (!hqPageUrl || !text.trim()) {
      setPreviewUrl(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = hqSize.w;
      canvas.height = hqSize.h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const scaledFontSize = (fontSize / 595) * hqSize.w;
      const wm = makePreviewWatermark(
        text,
        scaledFontSize,
        opacity,
        angle,
        color,
        tiled,
        hqSize.w,
        hqSize.h
      );
      ctx.drawImage(wm, 0, 0);
      setPreviewUrl(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.src = hqPageUrl;
  }, [hqPageUrl, hqSize, text, fontSize, opacity, angle, color, tiled]);

  // 保存：用矢量文字写入 PDF（无限清晰）
  const handleSave = async () => {
    if (!filePath || !text.trim()) return;
    setProcessing(true);
    setError(null);
    setResult(null);
    try {
      // 加载中文字体（缓存）
      if (!fontBytesRef.current) {
        try {
          const fontData = await invoke<number[]>('get_chinese_font');
          fontBytesRef.current = new Uint8Array(fontData);
        } catch {
          // 字体加载失败，降级到 Canvas 位图方式
          fontBytesRef.current = null;
        }
      }

      const bytes = await readBinaryFile(filePath);
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

      let embeddedFont: Awaited<ReturnType<typeof doc.embedFont>> | null = null;
      if (fontBytesRef.current) {
        doc.registerFontkit(fontkit);
        try {
          embeddedFont = await doc.embedFont(fontBytesRef.current);
        } catch {
          embeddedFont = null;
        }
      }

      const { r, g, b } = hexToRgb01(color);

      for (const page of doc.getPages()) {
        const { width, height } = page.getSize();

        if (embeddedFont) {
          // ✅ 矢量文字：无限清晰，支持中文
          const textWidth = embeddedFont.widthOfTextAtSize(text, fontSize);
          const textHeight = embeddedFont.heightAtSize(fontSize);

          if (tiled) {
            const stepX = textWidth + fontSize * 2;
            const stepY = textHeight + fontSize * 2;
            for (let y = -stepY; y < height + stepY * 2; y += stepY) {
              for (let x = -stepX; x < width + stepX * 2; x += stepX) {
                page.drawText(text, {
                  x,
                  y,
                  size: fontSize,
                  font: embeddedFont,
                  color: rgb(r, g, b),
                  opacity,
                  rotate: degrees(angle),
                });
              }
            }
          } else {
            page.drawText(text, {
              x: (width - textWidth) / 2,
              y: (height - textHeight) / 2,
              size: fontSize,
              font: embeddedFont,
              color: rgb(r, g, b),
              opacity,
              rotate: degrees(angle),
            });
          }
        } else {
          // 降级：Canvas 位图方式（字体加载失败时）
          const wm = makePreviewWatermark(
            text,
            fontSize,
            opacity,
            angle,
            color,
            tiled,
            width,
            height
          );
          const dataUrl = wm.toDataURL('image/png');
          const b64 = dataUrl.split(',')[1];
          const bin = atob(b64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          const img = await doc.embedPng(arr);
          page.drawImage(img, { x: 0, y: 0, width, height });
        }
      }

      const outBytes = await doc.save();
      const stem = fileName.replace(/\.pdf$/i, '');
      const outPath = await save({
        defaultPath: `${stem}_watermarked.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!outPath) {
        setProcessing(false);
        return;
      }
      await writeBinaryFile(outPath, outBytes);
      setResult(outPath);
    } catch (e: any) {
      setError(e.message || '添加水印失败');
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="💧"
        title="PDF 水印"
        subtitle={pageCount > 0 ? `共 ${pageCount} 页` : undefined}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧设置 */}
        <div className="w-72 flex-shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex-1 overflow-auto p-3 space-y-3">
            {!filePath ? (
              <div
                onClick={selectFile}
                className="h-28 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
              >
                <Upload size={22} className="text-gray-400 mb-1.5" />
                <p className="text-xs text-gray-500 dark:text-gray-400">点击选择 PDF 文件</p>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg px-2.5 py-2 border border-gray-200 dark:border-gray-700">
                <span className="text-lg">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{fileName}</p>
                  <p className="text-[10px] text-gray-400">{pageCount} 页</p>
                </div>
                <button
                  onClick={() => {
                    setFilePath('');
                    setFileName('');
                    setPageCount(0);
                    setHqPageUrl(null);
                    setPreviewUrl(null);
                    setResult(null);
                    setError(null);
                  }}
                  className="p-0.5 text-gray-400 hover:text-red-500"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">水印文字（支持中文）</span>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="输入水印文字"
                className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                字体大小 <span className="text-red-500 font-medium">{fontSize}</span>
              </span>
              <input
                type="range"
                min={12}
                max={120}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="accent-red-500"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                透明度{' '}
                <span className="text-red-500 font-medium">{Math.round(opacity * 100)}%</span>
              </span>
              <input
                type="range"
                min={5}
                max={100}
                value={Math.round(opacity * 100)}
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                className="accent-red-500"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                旋转角度 <span className="text-red-500 font-medium">{angle}°</span>
              </span>
              <input
                type="range"
                min={-90}
                max={90}
                value={angle}
                onChange={(e) => setAngle(Number(e.target.value))}
                className="accent-red-500"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">颜色</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-9 h-7 rounded cursor-pointer border border-gray-200 dark:border-gray-600"
                />
                <span className="text-xs text-gray-500">{color.toUpperCase()}</span>
              </div>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={tiled}
                onChange={(e) => setTiled(e.target.checked)}
                className="accent-red-500 w-3.5 h-3.5"
              />
              <span className="text-xs text-gray-700 dark:text-gray-300">平铺水印</span>
            </label>

            <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg">
              <p className="text-[10px] text-blue-600 dark:text-blue-400">
                💡 保存时使用矢量文字（调用系统中文字体），放大不模糊。预览为近似效果。
              </p>
            </div>

            {result && (
              <div className="p-2.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-1.5">
                <CheckCircle size={13} className="text-green-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-green-700 dark:text-green-300">水印添加成功（矢量）</p>
                  <p className="text-[10px] text-green-600 dark:text-green-400 truncate">
                    {result.split(/[\\/]/).pop()}
                  </p>
                </div>
              </div>
            )}
            {error && (
              <div className="p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-1.5">
                <AlertCircle size={13} className="text-red-500 flex-shrink-0" />
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 px-3 py-2.5 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <button
              onClick={selectFile}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              <Upload size={12} />
              {filePath ? '重选' : '选择'}
            </button>
            <div className="flex-1" />
            <button
              onClick={handleSave}
              disabled={!filePath || !text.trim() || processing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-xs font-medium transition-colors disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <Loader size={12} className="animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <Save size={12} />
                  添加水印
                </>
              )}
            </button>
          </div>
        </div>

        {/* 右侧实时预览 */}
        <div className="flex-1 overflow-auto p-4 bg-gray-100 dark:bg-gray-900/50 flex flex-col items-center">
          {!filePath ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              选择文件后显示实时预览
            </div>
          ) : loadingPreview ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm mt-8">
              <Loader size={16} className="animate-spin" />
              渲染高清预览中...
            </div>
          ) : previewUrl ? (
            <div className="w-full max-w-lg">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 text-center font-medium">
                第 1 页预览效果（实时）
              </p>
              <div className="rounded-lg overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700 bg-white">
                <img src={previewUrl} alt="水印预览" className="w-full h-auto" />
              </div>
              <p className="text-[10px] text-gray-400 text-center mt-2">
                预览为近似效果 · 实际保存使用矢量文字，放大不模糊
              </p>
            </div>
          ) : hqPageUrl ? (
            <div className="w-full max-w-lg">
              <div className="rounded-lg overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700 bg-white">
                <img src={hqPageUrl} alt="PDF 第 1 页" className="w-full h-auto" />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
