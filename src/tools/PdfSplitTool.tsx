import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { readBinaryFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { PDFDocument } from 'pdf-lib';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { usePdfPreview } from './usePdfPreview';
import PdfPageGrid from './PdfPageGrid';
import { Upload, X, CheckCircle, Loader, AlertCircle, Plus, Trash2 } from 'lucide-react';

interface Range {
  id: string;
  from: string;
  to: string;
}

export default function PdfSplitTool() {
  const ready = useToolTheme();
  const { pages, pageCount, loading, error: previewError, loadPdf, clear } = usePdfPreview(120);
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<'ranges' | 'each'>('ranges');
  const [ranges, setRanges] = useState<Range[]>([{ id: '1', from: '1', to: '1' }]);
  // 高亮当前范围覆盖的页面
  const [activeRangeId, setActiveRangeId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectFile = async () => {
    const sel = await open({ filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!sel || Array.isArray(sel)) return;
    try {
      const bytes = await readBinaryFile(sel);
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      setFilePath(sel);
      setFileName(sel.split(/[\\/]/).pop() || sel);
      setRanges([{ id: '1', from: '1', to: String(doc.getPageCount()) }]);
      setResults([]);
      setError(null);
      await loadPdf(sel);
    } catch (e: any) {
      setError('无法读取 PDF: ' + (e as any).message);
    }
  };

  const addRange = () =>
    setRanges((prev) => [...prev, { id: Date.now().toString(), from: '1', to: String(pageCount) }]);
  const removeRange = (id: string) => setRanges((prev) => prev.filter((r) => r.id !== id));
  const updateRange = (id: string, field: 'from' | 'to', val: string) =>
    setRanges((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)));

  // 计算当前激活范围覆盖的页面（0-based）
  const getHighlightedPages = (): Set<number> => {
    if (!activeRangeId) return new Set();
    const r = ranges.find((r) => r.id === activeRangeId);
    if (!r) return new Set();
    const from = Math.max(1, parseInt(r.from) || 1) - 1;
    const to = Math.min(pageCount, parseInt(r.to) || pageCount) - 1;
    const s = new Set<number>();
    for (let i = from; i <= to; i++) s.add(i);
    return s;
  };

  const handleSplit = async () => {
    if (!filePath) return;
    setProcessing(true);
    setError(null);
    setResults([]);
    try {
      const bytes = await readBinaryFile(filePath);
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const stem = fileName.replace(/\.pdf$/i, '');
      const saved: string[] = [];

      if (mode === 'each') {
        for (let i = 0; i < src.getPageCount(); i++) {
          const doc = await PDFDocument.create();
          const [page] = await doc.copyPages(src, [i]);
          doc.addPage(page);
          const outBytes = await doc.save();
          const outPath = await save({
            defaultPath: `${stem}_page${i + 1}.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
          });
          if (outPath) {
            await writeBinaryFile(outPath, outBytes);
            saved.push(outPath);
          }
        }
      } else {
        for (const range of ranges) {
          const from = Math.max(1, parseInt(range.from) || 1) - 1;
          const to = Math.min(src.getPageCount(), parseInt(range.to) || src.getPageCount()) - 1;
          if (from > to) continue;
          const doc = await PDFDocument.create();
          const indices = Array.from({ length: to - from + 1 }, (_, i) => from + i);
          const copied = await doc.copyPages(src, indices);
          copied.forEach((p) => doc.addPage(p));
          const outBytes = await doc.save();
          const outPath = await save({
            defaultPath: `${stem}_p${from + 1}-${to + 1}.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
          });
          if (outPath) {
            await writeBinaryFile(outPath, outBytes);
            saved.push(outPath);
          }
        }
      }
      setResults(saved);
    } catch (e: any) {
      setError(e.message || '拆分失败');
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  const highlighted = getHighlightedPages();

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="✂️"
        title="PDF 拆分"
        subtitle={pageCount > 0 ? `共 ${pageCount} 页` : undefined}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧设置 */}
        <div className="w-72 flex-shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex-1 overflow-auto p-3 space-y-3">
            {/* 文件选择 */}
            {!filePath ? (
              <div
                onClick={selectFile}
                className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
              >
                <Upload size={24} className="text-gray-400 mb-1.5" />
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
                    clear();
                    setResults([]);
                    setError(null);
                  }}
                  className="p-0.5 text-gray-400 hover:text-red-500"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            {pageCount > 0 && (
              <>
                {/* 模式 */}
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setMode('ranges')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${mode === 'ranges' ? 'bg-red-500 border-red-500 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}
                  >
                    按范围
                  </button>
                  <button
                    onClick={() => setMode('each')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${mode === 'each' ? 'bg-red-500 border-red-500 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}
                  >
                    每页单独
                  </button>
                </div>

                {mode === 'ranges' && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-gray-400">悬停范围可在右侧高亮预览</p>
                    {ranges.map((r, idx) => (
                      <div
                        key={r.id}
                        onMouseEnter={() => setActiveRangeId(r.id)}
                        onMouseLeave={() => setActiveRangeId(null)}
                        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 border transition-colors ${activeRangeId === r.id ? 'border-red-400 bg-red-50 dark:bg-red-900/10' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}
                      >
                        <span className="text-[10px] text-gray-400 w-8 flex-shrink-0">
                          段 {idx + 1}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={pageCount}
                          value={r.from}
                          onChange={(e) => updateRange(r.id, 'from', e.target.value)}
                          className="w-12 text-xs text-center bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1 py-0.5"
                        />
                        <span className="text-[10px] text-gray-400">-</span>
                        <input
                          type="number"
                          min={1}
                          max={pageCount}
                          value={r.to}
                          onChange={(e) => updateRange(r.id, 'to', e.target.value)}
                          className="w-12 text-xs text-center bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1 py-0.5"
                        />
                        <span className="text-[10px] text-gray-400">页</span>
                        {ranges.length > 1 && (
                          <button
                            onClick={() => removeRange(r.id)}
                            className="ml-auto p-0.5 text-gray-400 hover:text-red-500"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={addRange}
                      className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-600 px-2 py-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                    >
                      <Plus size={11} />
                      添加范围
                    </button>
                  </div>
                )}

                {mode === 'each' && (
                  <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      将 {pageCount} 页分别保存为 {pageCount} 个文件
                    </p>
                  </div>
                )}
              </>
            )}

            {results.length > 0 && (
              <div className="p-2.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <div className="flex items-center gap-1.5 mb-1">
                  <CheckCircle size={13} className="text-green-500" />
                  <p className="text-xs text-green-700 dark:text-green-300 font-medium">
                    拆分成功 {results.length} 个文件
                  </p>
                </div>
                {results.map((p, i) => (
                  <p
                    key={i}
                    className="text-[10px] text-green-600 dark:text-green-400 truncate ml-4"
                  >
                    {p.split(/[\\/]/).pop()}
                  </p>
                ))}
              </div>
            )}
            {(error || previewError) && (
              <div className="p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-1.5">
                <AlertCircle size={13} className="text-red-500 flex-shrink-0" />
                <p className="text-xs text-red-600 dark:text-red-400">{error || previewError}</p>
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
              onClick={handleSplit}
              disabled={!filePath || processing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-xs font-medium transition-colors disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <Loader size={12} className="animate-spin" />
                  拆分中...
                </>
              ) : (
                <>开始拆分</>
              )}
            </button>
          </div>
        </div>

        {/* 右侧预览 */}
        <div className="flex-1 overflow-auto p-3 bg-gray-100 dark:bg-gray-900/50">
          {!filePath ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              选择文件后显示预览
            </div>
          ) : (
            <PdfPageGrid
              pages={pages}
              loading={loading}
              selected={highlighted.size > 0 ? highlighted : undefined}
              accentColor="border-red-500 ring-2 ring-red-400"
              renderBadge={(page) => {
                if (!highlighted.has(page.index)) return null;
                const rangeIdx = ranges.findIndex((r) => {
                  const from = Math.max(1, parseInt(r.from) || 1) - 1;
                  const to = Math.min(pageCount, parseInt(r.to) || pageCount) - 1;
                  return page.index >= from && page.index <= to;
                });
                return rangeIdx >= 0 ? (
                  <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded font-medium">
                    段 {rangeIdx + 1}
                  </span>
                ) : null;
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
