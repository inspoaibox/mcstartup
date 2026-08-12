import { useState, useRef, useCallback, useEffect } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { readBinaryFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  Upload,
  X,
  CheckCircle,
  Loader,
  AlertCircle,
  Save,
  Plus,
  GripVertical,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface MergePage {
  id: string;
  srcPath: string;
  srcName: string;
  srcIndex: number;
  pageNum: number;
  dataUrl: string;
}

async function loadPdfPages(path: string, thumbWidth = 130): Promise<MergePage[]> {
  const bytes = await readBinaryFile(path);
  const data = new Uint8Array(bytes);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const name = path.split(/[\\/]/).pop() || path;
  const pages: MergePage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const scale = (thumbWidth * 2) / vp.width;
    const svp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = svp.width;
    canvas.height = svp.height;
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: svp, canvas }).promise;
    page.cleanup();
    pages.push({
      id: `${path}::${i}::${Math.random().toString(36).slice(2)}`,
      srcPath: path,
      srcName: name,
      srcIndex: i - 1,
      pageNum: i,
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
    });
  }
  await doc.destroy();
  return pages;
}

export default function PdfMergeTool() {
  const ready = useToolTheme();
  const [pages, setPages] = useState<MergePage[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ path: string; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 拖拽排序状态（鼠标事件实现，绕过 Tauri 文件拖拽拦截）
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragStartIndex = useRef<number | null>(null);
  const isDragging = useRef(false);
  const mouseStartPos = useRef({ x: 0, y: 0 });

  const addFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const newPages: MergePage[] = [];
      for (const p of paths) newPages.push(...(await loadPdfPages(p)));
      setPages((prev) => [...prev, ...newPages]);
    } catch (e: any) {
      setError('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const deletePage = (id: string) => setPages((prev) => prev.filter((p) => p.id !== id));
  const clearAll = () => {
    setPages([]);
    setResult(null);
    setError(null);
  };

  // 用 ref 追踪 overIndex 避免闭包问题
  const overIndexRef = useRef<number | null>(null);
  useEffect(() => {
    overIndexRef.current = overIndex;
  }, [overIndex]);

  // 鼠标拖拽排序（用 ref 避免闭包问题）
  const handleMouseDownFinal = useCallback((e: React.MouseEvent, id: string, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    mouseStartPos.current = { x: e.clientX, y: e.clientY };
    dragStartIndex.current = index;
    isDragging.current = false;

    const onMouseMove = (me: MouseEvent) => {
      const dx = me.clientX - mouseStartPos.current.x;
      const dy = me.clientY - mouseStartPos.current.y;
      if (!isDragging.current && Math.sqrt(dx * dx + dy * dy) > 5) {
        isDragging.current = true;
        setDraggingId(id);
      }
      if (!isDragging.current) return;

      const els = document.querySelectorAll('[data-page-index]');
      let found: number | null = null;
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (
          me.clientX >= rect.left &&
          me.clientX <= rect.right &&
          me.clientY >= rect.top &&
          me.clientY <= rect.bottom
        ) {
          found = Number((el as HTMLElement).dataset.pageIndex);
          break;
        }
      }
      overIndexRef.current = found;
      setOverIndex(found);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (isDragging.current) {
        const from = dragStartIndex.current;
        const to = overIndexRef.current;
        if (from !== null && to !== null && from !== to) {
          setPages((prev) => {
            const arr = [...prev];
            const [item] = arr.splice(from, 1);
            const clampedTo = Math.min(Math.max(0, to), arr.length);
            arr.splice(clampedTo, 0, item);
            return arr;
          });
        }
      }

      isDragging.current = false;
      dragStartIndex.current = null;
      setDraggingId(null);
      setOverIndex(null);
      overIndexRef.current = null;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleSave = async () => {
    if (pages.length === 0) return;
    setProcessing(true);
    setError(null);
    setResult(null);
    try {
      const merged = await PDFDocument.create();
      const srcCache = new Map<string, PDFDocument>();
      for (const page of pages) {
        if (!srcCache.has(page.srcPath)) {
          const bytes = await readBinaryFile(page.srcPath);
          srcCache.set(page.srcPath, await PDFDocument.load(bytes, { ignoreEncryption: true }));
        }
        const src = srcCache.get(page.srcPath)!;
        const [copied] = await merged.copyPages(src, [page.srcIndex]);
        merged.addPage(copied);
      }
      const outBytes = await merged.save();
      const outPath = await save({
        defaultPath: 'merged.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!outPath) {
        setProcessing(false);
        return;
      }
      await writeBinaryFile(outPath, outBytes);
      setResult({ path: outPath, count: pages.length });
    } catch (e: any) {
      setError(e.message || '合并失败');
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  const srcFiles = [...new Set(pages.map((p) => p.srcName))];

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="📎"
        title="PDF 合并"
        subtitle={
          pages.length > 0
            ? `${pages.length} 页（来自 ${srcFiles.length} 个文件）· 拖拽页面调整顺序`
            : undefined
        }
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {srcFiles.length > 0 && (
          <div className="flex-shrink-0 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400">来源：</span>
            {srcFiles.map((name, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-full border border-red-200 dark:border-red-800 truncate max-w-[160px]"
              >
                {name}
              </span>
            ))}
            <button
              onClick={addFiles}
              disabled={loading}
              className="ml-auto flex items-center gap-1 text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
            >
              <Plus size={12} />
              添加更多
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto p-4">
          {pages.length === 0 ? (
            <div
              onClick={addFiles}
              className="h-full min-h-48 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
            >
              {loading ? (
                <div className="flex items-center gap-2 text-gray-400">
                  <Loader size={20} className="animate-spin" />
                  <span className="text-sm">加载中...</span>
                </div>
              ) : (
                <>
                  <Upload size={32} className="text-gray-400 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    点击选择 PDF 文件（支持多选）
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    所有页面合并为统一列表 · 拖拽调整顺序 · 点 × 删除页面
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              {loading && (
                <div className="flex items-center gap-2 text-gray-400 text-xs mb-3">
                  <Loader size={13} className="animate-spin" />
                  加载新文件中...
                </div>
              )}
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}
              >
                {pages.map((page, idx) => {
                  const isDraggingThis = draggingId === page.id;
                  const isOver = overIndex === idx && draggingId !== null && draggingId !== page.id;
                  return (
                    <div
                      key={page.id}
                      data-page-index={idx}
                      className={`relative flex flex-col rounded-lg border-2 overflow-hidden select-none transition-all
                        ${isDraggingThis ? 'opacity-40 scale-95 border-red-400' : ''}
                        ${isOver ? 'border-red-500 ring-2 ring-red-400 scale-105' : ''}
                        ${!isDraggingThis && !isOver ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800' : ''}
                      `}
                    >
                      {/* 拖拽手柄区域（整个缩略图可拖） */}
                      <div
                        className="relative bg-gray-100 dark:bg-gray-700 overflow-hidden cursor-grab active:cursor-grabbing"
                        onMouseDown={(e) => handleMouseDownFinal(e, page.id, idx)}
                      >
                        <img
                          src={page.dataUrl}
                          alt={`第 ${idx + 1} 页`}
                          className="w-full h-auto object-contain pointer-events-none"
                          style={{ maxHeight: 140, display: 'block' }}
                        />
                        {/* 序号（左上角） */}
                        <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow pointer-events-none">
                          {idx + 1}
                        </div>
                        {/* 删除按钮（右上角） */}
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => deletePage(page.id)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/40 hover:bg-red-500 text-white flex items-center justify-center transition-colors shadow"
                          title="删除此页"
                        >
                          <X size={10} />
                        </button>
                        {/* 拖拽提示图标 */}
                        <div className="absolute bottom-1 right-1 text-white/50 pointer-events-none">
                          <GripVertical size={12} />
                        </div>
                      </div>

                      {/* 页码 + 来源 */}
                      <div className="px-1 py-1 bg-white dark:bg-gray-800 flex-shrink-0">
                        <p className="text-[10px] text-center text-gray-500 dark:text-gray-400 truncate">
                          {page.srcName.replace(/\.pdf$/i, '')} · {page.pageNum}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {result && (
          <div className="mx-4 mb-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2">
            <CheckCircle size={15} className="text-green-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-green-700 dark:text-green-300">
                合并成功！共 {result.count} 页
              </p>
              <p className="text-xs text-green-600 dark:text-green-400 truncate">
                {result.path.split(/[\\/]/).pop()}
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className="mx-4 mb-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2">
            <AlertCircle size={15} className="text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <button
            onClick={addFiles}
            disabled={loading || processing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
          >
            <Upload size={14} />
            添加文件
          </button>
          {pages.length > 0 && !processing && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <X size={14} />
              清空
            </button>
          )}
          <div className="flex-1" />
          {pages.length > 0 && <span className="text-xs text-gray-400">{pages.length} 页</span>}
          <button
            onClick={handleSave}
            disabled={pages.length === 0 || processing}
            className="flex items-center gap-2 px-5 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
          >
            {processing ? (
              <>
                <Loader size={14} className="animate-spin" />
                合并中...
              </>
            ) : (
              <>
                <Save size={14} />
                保存合并 PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
