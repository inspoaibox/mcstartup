import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { readBinaryFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { PDFDocument, degrees } from 'pdf-lib';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { usePdfPreview } from './usePdfPreview';
import {
  Upload,
  X,
  CheckCircle,
  Loader,
  AlertCircle,
  RotateCcw,
  RotateCw,
  Save,
} from 'lucide-react';
import type { PdfPageInfo } from './usePdfPreview';

type Angle = 90 | 180 | 270;

interface PageState {
  page: PdfPageInfo; // 原始缩略图
  rotation: number; // 累计旋转角度（0/90/180/270）
}

export default function PdfRotateTool() {
  const ready = useToolTheme();
  const { pages, loading, error: previewError, loadPdf, clear } = usePdfPreview(150);

  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  // 每页的旋转状态
  const [pageStates, setPageStates] = useState<PageState[]>([]);
  const [lastLoadedPath, setLastLoadedPath] = useState('');
  const [angle, setAngle] = useState<Angle>(90);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectFile = async () => {
    const sel = await open({ filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!sel || Array.isArray(sel)) return;
    setFilePath(sel);
    setFileName(sel.split(/[\\/]/).pop() || sel);
    setPageStates([]);
    setLastLoadedPath('');
    setResult(null);
    setError(null);
    clear();
    await loadPdf(sel);
  };

  // 初始化 pageStates（pages 加载完成后）
  if (filePath && filePath !== lastLoadedPath && pages.length > 0) {
    setLastLoadedPath(filePath);
    setPageStates(pages.map((p) => ({ page: p, rotation: 0 })));
  }
  // 渲染中追加新页
  if (filePath === lastLoadedPath && pages.length > pageStates.length) {
    setPageStates(pages.map((p, i) => pageStates[i] ?? { page: p, rotation: 0 }));
  }

  // 旋转单页：立刻更新预览
  const rotatePage = (index: number, delta: Angle) => {
    setPageStates((prev) =>
      prev.map((s) => (s.page.index === index ? { ...s, rotation: (s.rotation + delta) % 360 } : s))
    );
    setResult(null);
  };

  // 旋转全部
  const rotateAll = (delta: Angle) => {
    setPageStates((prev) => prev.map((s) => ({ ...s, rotation: (s.rotation + delta) % 360 })));
    setResult(null);
  };

  // 重置全部
  const resetAll = () => {
    setPageStates((prev) => prev.map((s) => ({ ...s, rotation: 0 })));
    setResult(null);
  };

  const hasChanges = pageStates.some((s) => s.rotation !== 0);

  const handleSave = async () => {
    if (!filePath || !hasChanges) return;
    setProcessing(true);
    setError(null);
    setResult(null);
    try {
      const bytes = await readBinaryFile(filePath);
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pdfPages = doc.getPages();
      pageStates.forEach((s) => {
        if (s.rotation !== 0) {
          const page = pdfPages[s.page.index];
          const current = page.getRotation().angle;
          page.setRotation(degrees((current + s.rotation) % 360));
        }
      });
      const outBytes = await doc.save();
      const stem = fileName.replace(/\.pdf$/i, '');
      const outPath = await save({
        defaultPath: `${stem}_rotated.pdf`,
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

  const rotatedCount = pageStates.filter((s) => s.rotation !== 0).length;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="🔄"
        title="PDF 旋转"
        subtitle={
          pageStates.length > 0
            ? rotatedCount > 0
              ? `共 ${pageStates.length} 页 · 已旋转 ${rotatedCount} 页`
              : `共 ${pageStates.length} 页 · 悬停页面点击旋转按钮`
            : undefined
        }
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 工具栏 */}
        {pageStates.length > 0 && (
          <div className="flex-shrink-0 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 flex-wrap">
            {/* 角度选择 */}
            <span className="text-xs text-gray-500 dark:text-gray-400">旋转角度</span>
            <div className="flex gap-1">
              {([90, 180, 270] as Angle[]).map((a) => (
                <button
                  key={a}
                  onClick={() => setAngle(a)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border-2 transition-colors ${
                    angle === a
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {a}°
                </button>
              ))}
            </div>
            <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
            {/* 批量操作 */}
            <button
              onClick={() => rotateAll(angle)}
              className="flex items-center gap-1 text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              <RotateCw size={12} />
              全部旋转 {angle}°
            </button>
            {hasChanges && (
              <button
                onClick={resetAll}
                className="flex items-center gap-1 text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                <RotateCcw size={12} />
                重置全部
              </button>
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
                悬停页面点击旋转按钮，实时预览效果
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700">
                <span className="text-xl">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{fileName}</p>
                  {pageStates.length > 0 && (
                    <p className="text-xs text-gray-400">{pageStates.length} 页</p>
                  )}
                </div>
                <button
                  onClick={() => {
                    setFilePath('');
                    setFileName('');
                    clear();
                    setPageStates([]);
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

              {loading && pageStates.length === 0 && (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                  <Loader size={18} className="animate-spin" />
                  渲染预览中...
                </div>
              )}

              {pageStates.length > 0 && (
                <>
                  {loading && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <Loader size={11} className="animate-spin" />
                      渲染中 {pageStates.length} / {pages.length} 页...
                    </div>
                  )}
                  <div
                    className="grid gap-2"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
                  >
                    {pageStates.map((state) => (
                      <div
                        key={state.page.index}
                        className={`relative flex flex-col rounded-lg border-2 overflow-hidden group transition-all
                          ${
                            state.rotation !== 0
                              ? 'border-orange-400 shadow-md bg-orange-50 dark:bg-orange-900/10'
                              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-orange-300 dark:hover:border-orange-700'
                          }`}
                      >
                        {/* 缩略图（CSS旋转实时预览） */}
                        <div
                          className="relative w-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex items-center justify-center"
                          style={{ minHeight: 100 }}
                        >
                          <img
                            src={state.page.dataUrl}
                            alt={`第 ${state.page.pageNum} 页`}
                            className="object-contain transition-transform duration-300"
                            style={{
                              maxHeight: 150,
                              maxWidth: '100%',
                              display: 'block',
                              transform: `rotate(${state.rotation}deg)`,
                              // 90/270度时需要调整尺寸避免溢出
                              ...(state.rotation === 90 || state.rotation === 270
                                ? { maxHeight: 110, maxWidth: 110 }
                                : {}),
                            }}
                            draggable={false}
                          />

                          {/* hover 操作层 */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                            <button
                              onClick={() => rotatePage(state.page.index, angle)}
                              className="w-9 h-9 rounded-full bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center shadow-xl transition-colors"
                              title={`顺时针旋转 ${angle}°`}
                            >
                              <RotateCw size={16} />
                            </button>
                            {state.rotation !== 0 && (
                              <button
                                onClick={() =>
                                  rotatePage(state.page.index, (360 - state.rotation) as Angle)
                                }
                                className="w-9 h-9 rounded-full bg-white hover:bg-gray-100 text-gray-700 flex items-center justify-center shadow-xl transition-colors"
                                title="重置此页"
                              >
                                <RotateCcw size={16} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 页码 + 旋转角度 */}
                        <div
                          className={`text-[11px] font-medium text-center py-1 flex-shrink-0 flex items-center justify-center gap-1
                          ${
                            state.rotation !== 0
                              ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20'
                              : 'text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800'
                          }`}
                        >
                          第 {state.page.pageNum} 页
                          {state.rotation !== 0 && (
                            <span className="bg-orange-500 text-white text-[9px] px-1 py-0.5 rounded-full font-bold">
                              {state.rotation}°
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {result && (
          <div className="mx-4 mb-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2">
            <CheckCircle size={15} className="text-green-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-green-700 dark:text-green-300">保存成功</p>
              <p className="text-xs text-green-600 dark:text-green-400 truncate">
                {result.split(/[\\/]/).pop()}
              </p>
            </div>
          </div>
        )}
        {(error || previewError) && (
          <div className="mx-4 mb-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2">
            <AlertCircle size={15} className="text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">{error || previewError}</p>
          </div>
        )}

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
            disabled={!filePath || !hasChanges || processing}
            className="flex items-center gap-2 px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
          >
            {processing ? (
              <>
                <Loader size={14} className="animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save size={14} />
                保存旋转结果
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
