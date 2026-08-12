import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { readBinaryFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { PDFDocument } from 'pdf-lib';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { usePdfPreview } from './usePdfPreview';
import { Upload, X, CheckCircle, Loader, AlertCircle, Trash2, RotateCcw, Save } from 'lucide-react';
import type { PdfPageInfo } from './usePdfPreview';

export default function PdfDeletePagesTool() {
  const ready = useToolTheme();
  const { pages, loading, error: previewError, loadPdf, clear } = usePdfPreview(150);

  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  // 当前显示的页面列表（删除后实时更新）
  const [visiblePages, setVisiblePages] = useState<PdfPageInfo[]>([]);
  // 已删除的原始页面索引（用于最终保存时过滤）
  const [deletedIndices, setDeletedIndices] = useState<Set<number>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectFile = async () => {
    const sel = await open({ filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!sel || Array.isArray(sel)) return;
    setFilePath(sel);
    setFileName(sel.split(/[\\/]/).pop() || sel);
    setDeletedIndices(new Set());
    setResult(null);
    setError(null);
    clear();
    setVisiblePages([]);
    await loadPdf(sel);
  };

  // 当 pages 从 hook 更新时同步到 visiblePages（仅初始加载）
  const [lastLoadedPath, setLastLoadedPath] = useState('');
  if (filePath && filePath !== lastLoadedPath && pages.length > 0) {
    setLastLoadedPath(filePath);
    setVisiblePages(pages);
    setDeletedIndices(new Set());
  }
  // 渲染中追加新页
  if (
    filePath === lastLoadedPath &&
    pages.length > visiblePages.length &&
    deletedIndices.size === 0
  ) {
    setVisiblePages(pages);
  }

  // 直接删除：从预览里移除，记录原始索引
  const deletePage = (originalIndex: number) => {
    setVisiblePages((prev) => prev.filter((p) => p.index !== originalIndex));
    setDeletedIndices((prev) => new Set([...prev, originalIndex]));
    setResult(null);
  };

  // 撤销所有删除
  const undoAll = () => {
    setVisiblePages(pages);
    setDeletedIndices(new Set());
    setResult(null);
  };

  // 保存结果
  const handleSave = async () => {
    if (!filePath || deletedIndices.size === 0) return;
    if (deletedIndices.size >= pages.length) {
      setError('不能删除所有页面');
      return;
    }
    setProcessing(true);
    setError(null);
    setResult(null);
    try {
      const bytes = await readBinaryFile(filePath);
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const doc = await PDFDocument.create();
      const keepIndices = Array.from({ length: pages.length }, (_, i) => i).filter(
        (i) => !deletedIndices.has(i)
      );
      const copied = await doc.copyPages(src, keepIndices);
      copied.forEach((p) => doc.addPage(p));
      const outBytes = await doc.save();
      const stem = fileName.replace(/\.pdf$/i, '');
      const outPath = await save({
        defaultPath: `${stem}_deleted.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!outPath) {
        setProcessing(false);
        return;
      }
      await writeBinaryFile(outPath, outBytes);
      setResult(outPath);
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  const totalOriginal = pages.length;
  const deletedCount = deletedIndices.size;
  const remainingCount = totalOriginal - deletedCount;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="🗑️"
        title="PDF 删除页面"
        subtitle={
          totalOriginal > 0
            ? deletedCount > 0
              ? `原 ${totalOriginal} 页 → 剩余 ${remainingCount} 页（已删 ${deletedCount} 页）`
              : `共 ${totalOriginal} 页 · 点击页面上的 🗑️ 直接删除`
            : undefined
        }
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 工具栏 */}
        {totalOriginal > 0 && (
          <div className="flex-shrink-0 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
            {deletedCount > 0 && (
              <button
                onClick={undoAll}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                <RotateCcw size={12} />
                撤销全部删除
              </button>
            )}
            <div className="flex-1" />
            {deletedCount > 0 && (
              <span className="text-xs text-red-500 font-medium">
                已删除 {deletedCount} 页，剩余 {remainingCount} 页
              </span>
            )}
          </div>
        )}

        {/* 主内容 */}
        <div className="flex-1 overflow-auto p-4">
          {!filePath ? (
            <div
              onClick={selectFile}
              className="h-full min-h-48 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
            >
              <Upload size={32} className="text-gray-400 mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">点击选择 PDF 文件</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                加载后悬停页面点击 🗑️ 即可直接删除，所见即所得
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* 文件信息 */}
              <div className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700">
                <span className="text-xl">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{fileName}</p>
                  {totalOriginal > 0 && (
                    <p className="text-xs text-gray-400">
                      {totalOriginal} 页{deletedCount > 0 ? ` · 已删 ${deletedCount} 页` : ''}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    setFilePath('');
                    setFileName('');
                    clear();
                    setVisiblePages([]);
                    setDeletedIndices(new Set());
                    setLastLoadedPath('');
                    setResult(null);
                    setError(null);
                  }}
                  className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              {previewError && (
                <div className="p-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg text-xs text-orange-600 dark:text-orange-400">
                  预览加载失败: {previewError}
                </div>
              )}

              {/* 加载中 */}
              {loading && visiblePages.length === 0 && (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                  <Loader size={18} className="animate-spin" />
                  渲染预览中...
                </div>
              )}

              {/* 页面网格 — 直接操作版 */}
              {visiblePages.length > 0 && (
                <>
                  {loading && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <Loader size={11} className="animate-spin" />
                      渲染中 {visiblePages.length} / {totalOriginal} 页...
                    </div>
                  )}
                  <div
                    className="grid gap-2"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
                  >
                    {visiblePages.map((page) => (
                      <div
                        key={page.index}
                        className="relative flex flex-col rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden group hover:border-red-300 dark:hover:border-red-700 transition-all"
                      >
                        {/* 缩略图 */}
                        <div className="relative w-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                          <img
                            src={page.dataUrl}
                            alt={`第 ${page.pageNum} 页`}
                            className="w-full h-auto object-contain"
                            style={{ maxHeight: 160, display: 'block' }}
                            draggable={false}
                          />
                          {/* hover 遮罩 + 删除按钮 */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <button
                              onClick={() => deletePage(page.index)}
                              className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-xl transition-colors"
                              title="删除此页"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                        {/* 页码 */}
                        <div className="text-[11px] font-medium text-center py-1 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 flex-shrink-0">
                          第 {page.pageNum} 页
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* 结果/错误 */}
        {result && (
          <div className="mx-4 mb-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2">
            <CheckCircle size={15} className="text-green-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-green-700 dark:text-green-300">
                保存成功，共 {remainingCount} 页
              </p>
              <p className="text-xs text-green-600 dark:text-green-400 truncate">
                {result.split(/[\\/]/).pop()}
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

        {/* 底部操作栏 */}
        <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <button
            onClick={selectFile}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            <Upload size={14} />
            {filePath ? '重新选择' : '选择文件'}
          </button>
          <div className="flex-1" />
          <button
            onClick={handleSave}
            disabled={!filePath || deletedCount === 0 || processing}
            className="flex items-center gap-2 px-5 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
          >
            {processing ? (
              <>
                <Loader size={14} className="animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save size={14} />
                保存 PDF（{remainingCount} 页）
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
