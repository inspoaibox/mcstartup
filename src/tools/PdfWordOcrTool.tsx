import { useMemo, useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { readBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import * as pdfjsLib from 'pdfjs-dist';
import {
  AlertCircle,
  CheckCircle,
  FileText,
  FolderOpen,
  Loader,
  Save,
  Settings2,
  Upload,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface SelectedPdf {
  path: string;
  name: string;
  pageCount: number;
  width: number;
  height: number;
  previewUrl: string;
}

interface PdfOcrWordPage {
  pageNumber: number;
  imageBase64: string;
  width: number;
  height: number;
}

interface PdfOcrWordPageResult {
  pageNumber: number;
  lineCount: number;
  tableCount: number;
  imageCount: number;
  textPreview: string;
}

interface PdfOcrWordResult {
  outputPath: string;
  pageCount: number;
  paragraphCount: number;
  tableCount: number;
  imageCount: number;
  recognizedPages: PdfOcrWordPageResult[];
}

interface ProgressState {
  page: number;
  pageCount: number;
  message: string;
}

const RENDER_SCALE_OPTIONS = [
  { value: 1.5, label: '标准' },
  { value: 2, label: '清晰' },
  { value: 2.5, label: '高清' },
  { value: 3, label: '极清' },
];

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function stem(path: string): string {
  return basename(path).replace(/\.pdf$/i, '');
}

function formatPageSize(width: number, height: number): string {
  if (!width || !height) return '未知尺寸';
  return `${Math.round(width)} x ${Math.round(height)}`;
}

function canvasToBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').split(',')[1] || '';
}

async function renderPageToCanvas(
  page: pdfjsLib.PDFPageProxy,
  scale: number
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 PDF 渲染画布');
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return {
    canvas,
    width: viewport.width,
    height: viewport.height,
  };
}

async function inspectPdf(path: string): Promise<SelectedPdf> {
  const bytes = await readBinaryFile(path);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
  try {
    const firstPage = await doc.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });
    const previewScale = Math.min(1.4, 520 / viewport.width);
    const rendered = await renderPageToCanvas(firstPage, previewScale);
    firstPage.cleanup();
    return {
      path,
      name: basename(path),
      pageCount: doc.numPages,
      width: viewport.width,
      height: viewport.height,
      previewUrl: rendered.canvas.toDataURL('image/jpeg', 0.88),
    };
  } finally {
    doc.destroy();
  }
}

async function renderPdfPages(
  path: string,
  scale: number,
  onProgress: (progress: ProgressState) => void
): Promise<PdfOcrWordPage[]> {
  const bytes = await readBinaryFile(path);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: PdfOcrWordPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      onProgress({
        page: pageNumber,
        pageCount: doc.numPages,
        message: `正在渲染第 ${pageNumber} 页`,
      });
      const page = await doc.getPage(pageNumber);
      const rendered = await renderPageToCanvas(page, scale);
      pages.push({
        pageNumber,
        imageBase64: canvasToBase64(rendered.canvas),
        width: rendered.width,
        height: rendered.height,
      });
      page.cleanup();
    }
  } finally {
    doc.destroy();
  }

  return pages;
}

export default function PdfWordOcrTool() {
  const ready = useToolTheme();
  const [selectedPdf, setSelectedPdf] = useState<SelectedPdf | null>(null);
  const [renderScale, setRenderScale] = useState(2);
  const [includePageHeadings, setIncludePageHeadings] = useState(true);
  const [detectTables, setDetectTables] = useState(true);
  const [includePageImages, setIncludePageImages] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [result, setResult] = useState<PdfOcrWordResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canConvert = !!selectedPdf && !processing;
  const progressPercent = useMemo(() => {
    if (!progress || progress.pageCount <= 0) return 0;
    return Math.min(100, Math.round((progress.page / progress.pageCount) * 100));
  }, [progress]);

  async function selectPdf() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    });
    if (typeof selected !== 'string') return;

    setProcessing(true);
    setResult(null);
    setError(null);
    setProgress({ page: 0, pageCount: 0, message: '正在读取 PDF' });
    try {
      const pdf = await inspectPdf(selected);
      setSelectedPdf(pdf);
      setProgress(null);
    } catch (err) {
      setError(String(err));
      setProgress(null);
    } finally {
      setProcessing(false);
    }
  }

  async function convertToWord() {
    if (!selectedPdf) return;

    const outputPath = await save({
      defaultPath: `${stem(selectedPdf.name)}_OCR.docx`,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    });
    if (!outputPath) return;

    setProcessing(true);
    setResult(null);
    setError(null);
    try {
      const pages = await renderPdfPages(selectedPdf.path, renderScale, setProgress);
      setProgress({
        page: pages.length,
        pageCount: pages.length,
        message: '正在调用 PaddleOCR 并生成 Word',
      });
      const converted = await invoke<PdfOcrWordResult>('doc_pdf_ocr_to_word', {
        request: {
          pages,
          outputPath,
          title: selectedPdf.name,
          includePageHeadings,
          detectTables,
          includePageImages,
        },
      });
      setResult(converted);
      setProgress(null);
    } catch (err) {
      setError(String(err));
      setProgress(null);
    } finally {
      setProcessing(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="📄"
        title="PDF 转 Word"
        subtitle="使用内置 PaddleOCR 将扫描件 PDF 转为结构化 Word"
      />

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">PDF 文件</h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  适合扫描件、图片型 PDF 和拍照文档
                </p>
              </div>
              {selectedPdf && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPdf(null);
                    setResult(null);
                    setError(null);
                  }}
                  disabled={processing}
                  className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-700"
                  title="清除"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={selectPdf}
              disabled={processing}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {processing && progress?.message === '正在读取 PDF' ? (
                <Loader size={16} className="animate-spin" />
              ) : (
                <Upload size={16} />
              )}
              选择 PDF
            </button>

            {selectedPdf ? (
              <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex h-64 items-center justify-center bg-gray-100 p-3 dark:bg-gray-900">
                  <img
                    src={selectedPdf.previewUrl}
                    alt="PDF 首屏预览"
                    className="max-h-full max-w-full rounded border border-gray-200 object-contain shadow-sm dark:border-gray-700"
                  />
                </div>
                <div className="space-y-1 p-3">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                    {selectedPdf.name}
                  </p>
                  <p className="break-all text-xs text-gray-400 dark:text-gray-500">
                    {selectedPdf.path}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className="rounded bg-white px-2 py-1 dark:bg-gray-800">
                      {selectedPdf.pageCount} 页
                    </span>
                    <span className="rounded bg-white px-2 py-1 dark:bg-gray-800">
                      {formatPageSize(selectedPdf.width, selectedPdf.height)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-center dark:border-gray-700 dark:bg-gray-900/40">
                <FileText size={42} className="text-gray-300 dark:text-gray-600" />
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">未选择 PDF</p>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-3 flex items-center gap-2">
              <Settings2 size={16} className="text-teal-500" />
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">识别设置</h2>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">渲染清晰度</span>
              <select
                value={renderScale}
                onChange={(event) => setRenderScale(Number(event.target.value))}
                disabled={processing}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 dark:border-gray-600 dark:bg-gray-700"
              >
                {RENDER_SCALE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}（{option.value}x）
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={includePageHeadings}
                onChange={(event) => setIncludePageHeadings(event.target.checked)}
                disabled={processing}
                className="h-4 w-4 rounded border-gray-300 text-teal-500 focus:ring-teal-400"
              />
              输出每页页码标题
            </label>

            <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={detectTables}
                onChange={(event) => setDetectTables(event.target.checked)}
                disabled={processing}
                className="h-4 w-4 rounded border-gray-300 text-teal-500 focus:ring-teal-400"
              />
              自动恢复表格结构
            </label>

            <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={includePageImages}
                onChange={(event) => setIncludePageImages(event.target.checked)}
                disabled={processing}
                className="h-4 w-4 rounded border-gray-300 text-teal-500 focus:ring-teal-400"
              />
              保留每页原图
            </label>

            <button
              type="button"
              onClick={convertToWord}
              disabled={!canConvert}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {processing ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}
              转为 Word
            </button>
          </section>
        </aside>

        <main className="space-y-4">
          {progress && (
            <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/60 dark:bg-blue-950/30">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
                <Loader size={16} className="animate-spin" />
                {progress.message}
              </div>
              {progress.pageCount > 0 && (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/60">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-blue-600 dark:text-blue-300">
                    {progress.page} / {progress.pageCount} 页
                  </p>
                </div>
              )}
            </section>
          )}

          {error && (
            <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <div className="flex items-start gap-2">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">转换失败</p>
                  <p className="mt-1 break-words text-xs leading-5">{error}</p>
                </div>
              </div>
            </section>
          )}

          {result ? (
            <section className="rounded-lg border border-green-200 bg-white p-4 shadow-sm dark:border-green-900/60 dark:bg-gray-800">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <CheckCircle size={22} className="mt-0.5 text-green-500" />
                  <div>
                    <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      Word 已生成
                    </h2>
                    <p className="mt-1 break-all text-xs text-gray-500 dark:text-gray-400">
                      {result.outputPath}
                    </p>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      共处理 {result.pageCount} 页，输出 {result.paragraphCount} 段文本、
                      {result.tableCount} 个表格、{result.imageCount} 张页面图
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => invoke('show_in_folder', { path: result.outputPath })}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <FolderOpen size={14} />
                  打开位置
                </button>
              </div>

              <div className="mt-4 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-100 dark:divide-gray-700 dark:border-gray-700">
                {result.recognizedPages.map((page) => (
                  <div
                    key={page.pageNumber}
                    className="grid gap-2 px-3 py-2 text-sm md:grid-cols-[90px_90px_1fr]"
                  >
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      第 {page.pageNumber} 页
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">{page.lineCount} 行</span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {page.tableCount} 表 / {page.imageCount} 图
                    </span>
                    <span className="truncate text-gray-500 dark:text-gray-400">
                      {page.textPreview || '未识别到文字'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section className="flex min-h-[520px] flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <FileText size={54} className="text-gray-300 dark:text-gray-600" />
              <h2 className="mt-4 text-base font-semibold text-gray-800 dark:text-gray-100">
                PDF OCR 转 Word
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
                选择 PDF 后会逐页渲染为图片，使用内置 PaddleOCR 识别文字，并输出带段落、
                表格和页面图的 DOCX 文件。
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
