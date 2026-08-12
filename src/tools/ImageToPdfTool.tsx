import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { readBinaryFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { PDFDocument, PageSizes } from 'pdf-lib';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Upload, X, ArrowUp, ArrowDown, CheckCircle, Loader, AlertCircle } from 'lucide-react';

interface ImgFile {
  id: string;
  path: string;
  name: string;
}

const PAGE_SIZES: Record<string, [number, number]> = {
  A4: PageSizes.A4,
  A3: PageSizes.A3,
  Letter: PageSizes.Letter,
  原始尺寸: [0, 0],
};

export default function ImageToPdfTool() {
  const ready = useToolTheme();
  const [files, setFiles] = useState<ImgFile[]>([]);
  const [pageSize, setPageSize] = useState('A4');
  const [fitMode, setFitMode] = useState<'fit' | 'fill' | 'original'>('fit');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setFiles((prev) => [
      ...prev,
      ...paths.map((p) => ({
        id: Math.random().toString(36).slice(2),
        path: p,
        name: p.split(/[\\/]/).pop() || p,
      })),
    ]);
    setResult(null);
    setError(null);
  };

  const moveUp = (id: string) =>
    setFiles((prev) => {
      const i = prev.findIndex((f) => f.id === id);
      if (i <= 0) return prev;
      const n = [...prev];
      [n[i - 1], n[i]] = [n[i], n[i - 1]];
      return n;
    });
  const moveDown = (id: string) =>
    setFiles((prev) => {
      const i = prev.findIndex((f) => f.id === id);
      if (i >= prev.length - 1) return prev;
      const n = [...prev];
      [n[i], n[i + 1]] = [n[i + 1], n[i]];
      return n;
    });

  const handleConvert = async () => {
    if (!files.length) return;
    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const doc = await PDFDocument.create();
      const [pw, ph] = PAGE_SIZES[pageSize] || PageSizes.A4;

      for (const file of files) {
        const bytes = await readBinaryFile(file.path);
        const ext = file.name.split('.').pop()?.toLowerCase() || '';

        let img;
        if (ext === 'png') {
          img = await doc.embedPng(bytes);
        } else if (['jpg', 'jpeg'].includes(ext)) {
          img = await doc.embedJpg(bytes);
        } else {
          // 其他格式尝试 JPG
          try {
            img = await doc.embedJpg(bytes);
          } catch {
            img = await doc.embedPng(bytes);
          }
        }

        const { width: iw, height: ih } = img;
        let pageW = pw,
          pageH = ph;

        if (pageSize === '原始尺寸') {
          pageW = iw;
          pageH = ih;
        }

        const page = doc.addPage([pageW, pageH]);

        let drawW = iw,
          drawH = ih,
          x = 0,
          y = 0;
        if (fitMode === 'fit' && pageSize !== '原始尺寸') {
          const scale = Math.min(pageW / iw, pageH / ih);
          drawW = iw * scale;
          drawH = ih * scale;
          x = (pageW - drawW) / 2;
          y = (pageH - drawH) / 2;
        } else if (fitMode === 'fill' && pageSize !== '原始尺寸') {
          const scale = Math.max(pageW / iw, pageH / ih);
          drawW = iw * scale;
          drawH = ih * scale;
          x = (pageW - drawW) / 2;
          y = (pageH - drawH) / 2;
        }

        page.drawImage(img, { x, y, width: drawW, height: drawH });
      }

      const outBytes = await doc.save();
      const outPath = await save({
        defaultPath: 'images.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!outPath) {
        setProcessing(false);
        return;
      }
      await writeBinaryFile(outPath, outBytes);
      setResult(outPath);
    } catch (e: any) {
      setError(e.message || '转换失败');
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="📄"
        title="图片转 PDF"
        subtitle={files.length > 0 ? `${files.length} 张图片` : undefined}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 设置栏 */}
        <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">页面尺寸</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value)}
              className="text-xs bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5"
            >
              {Object.keys(PAGE_SIZES).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {pageSize !== '原始尺寸' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">适应方式</span>
              <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                {[
                  ['fit', '适应'],
                  ['fill', '填充'],
                  ['original', '原始'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setFitMode(v as any)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${fitMode === v ? 'bg-red-500 text-white shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {files.length === 0 ? (
            <div
              onClick={addFiles}
              className="h-full min-h-48 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
            >
              <Upload size={32} className="text-gray-400 mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">点击选择图片文件</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                支持 PNG / JPG / WebP，可多选
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((file, idx) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg px-3 py-2.5 border border-gray-200 dark:border-gray-700"
                >
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <p className="flex-1 text-sm truncate">{file.name}</p>
                  <div className="flex gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => moveUp(file.id)}
                      disabled={idx === 0}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      onClick={() => moveDown(file.id)}
                      disabled={idx === files.length - 1}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
                    className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {result && (
          <div className="mx-4 mb-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2">
            <CheckCircle size={15} className="text-green-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-green-700 dark:text-green-300">
                转换成功！{files.length} 张图片 → PDF
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

        <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <button
            onClick={addFiles}
            disabled={processing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
          >
            <Upload size={14} />
            添加图片
          </button>
          {files.length > 0 && !processing && (
            <button
              onClick={() => {
                setFiles([]);
                setResult(null);
                setError(null);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <X size={14} />
              清空
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={handleConvert}
            disabled={!files.length || processing}
            className="flex items-center gap-2 px-5 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
          >
            {processing ? (
              <>
                <Loader size={14} className="animate-spin" />
                转换中...
              </>
            ) : (
              <>转换为 PDF</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
