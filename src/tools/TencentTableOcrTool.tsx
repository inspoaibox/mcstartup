import { useCallback, useEffect, useMemo, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { open, save } from '@tauri-apps/api/dialog';
import { readBinaryFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  CheckCircle,
  Clipboard,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { useSettingsStore } from '../stores/settingsStore';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

type InputSourceKind = 'image' | 'pdf' | 'clipboard';

interface SelectedImage {
  path?: string;
  name: string;
  bytes: Uint8Array;
  previewUrl: string;
  base64: string;
  sourceKind: InputSourceKind;
  sourceLabel: string;
  pageNum?: number;
  pageCount?: number;
}

interface PdfPagePreview {
  pageNum: number;
  dataUrl: string;
}

interface SelectedPdf {
  path: string;
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  selectedPage: number;
  pages: PdfPagePreview[];
}

interface TencentTableCellPreview {
  text: string;
  rowTl: number;
  colTl: number;
  rowBr: number;
  colBr: number;
  confidence?: number | null;
  cellType?: string | null;
}

interface TencentTablePreview {
  rowCount: number;
  colCount: number;
  cellCount: number;
  rows: string[][];
  cells: TencentTableCellPreview[];
}

interface TencentTableOcrResult {
  excelBase64?: string | null;
  tables: TencentTablePreview[];
  requestId?: string | null;
  pdfPageSize?: number | null;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function stem(path: string): string {
  return basename(path).replace(/\.[^.]+$/, '');
}

function imageMimeType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'bmp') return 'image/bmp';
  return 'image/png';
}

function imageExtensionFromMime(type: string): string {
  if (type.includes('jpeg')) return 'jpg';
  if (type.includes('webp')) return 'webp';
  if (type.includes('bmp')) return 'bmp';
  return 'png';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function fileToBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function renderPdfPreviews(bytes: Uint8Array): Promise<{
  pageCount: number;
  pages: PdfPagePreview[];
}> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), password: '' }).promise;
  try {
    const pages: PdfPagePreview[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.6, 180 / viewport.width);
      const scaledViewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(scaledViewport.width);
      canvas.height = Math.ceil(scaledViewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建 PDF 预览画布');

      await page.render({ canvasContext: context, viewport: scaledViewport, canvas }).promise;
      page.cleanup();
      pages.push({
        pageNum,
        dataUrl: canvas.toDataURL('image/jpeg', 0.82),
      });
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    await doc.destroy();
  }
}

function validateTencentOcrSettings(settings: ReturnType<typeof useSettingsStore.getState>) {
  const secretId = (settings.ocrTencentSecretId || '').trim();
  const secretKey = (settings.ocrTencentSecretKey || '').trim();

  if (!secretId || !secretKey) {
    return '请先在全局设置的 OCR 识别中配置腾讯云 Secret ID 和 Secret Key。';
  }
  if (/^\d+$/.test(secretId)) {
    return '腾讯 OCR 的 Secret ID 看起来像纯数字 AppID。请填写访问管理 API 密钥里的 SecretId。';
  }
  if (secretKey.startsWith('AKID') && !secretId.startsWith('AKID')) {
    return '腾讯 OCR 的 Secret ID 和 Secret Key 可能填反了。SecretId 通常以 AKID 开头。';
  }
  return null;
}

function tableStats(result: TencentTableOcrResult | null) {
  if (!result) return { tables: 0, rows: 0, cols: 0, cells: 0 };
  return result.tables.reduce(
    (acc, table) => ({
      tables: acc.tables + 1,
      rows: acc.rows + table.rowCount,
      cols: Math.max(acc.cols, table.colCount),
      cells: acc.cells + table.cellCount,
    }),
    { tables: 0, rows: 0, cols: 0, cells: 0 }
  );
}

export default function TencentTableOcrTool() {
  const ready = useToolTheme();
  const settings = useSettingsStore();
  const [image, setImage] = useState<SelectedImage | null>(null);
  const [pdf, setPdf] = useState<SelectedPdf | null>(null);
  const [result, setResult] = useState<TencentTableOcrResult | null>(null);
  const [activeTable, setActiveTable] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingInput, setLoadingInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void useSettingsStore.getState().loadSettings();
  }, []);

  const stats = useMemo(() => tableStats(result), [result]);
  const active = result?.tables[activeTable] || null;
  const settingsError = validateTencentOcrSettings(settings);
  const canRecognize = !!image && !processing && !settingsError;
  const canSave = !!result?.excelBase64 && !saving;

  const setSelectedImage = useCallback((nextImage: SelectedImage, nextPdf?: SelectedPdf | null) => {
    setImage(nextImage);
    if (nextPdf !== undefined) {
      setPdf(nextPdf);
    }
    setResult(null);
    setActiveTable(0);
    setError(null);
  }, []);

  async function pickImage() {
    const selected = await open({
      multiple: false,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    });
    if (typeof selected !== 'string') return;

    setLoadingInput(true);
    setError(null);
    setResult(null);
    setActiveTable(0);
    try {
      const bytes = await readBinaryFile(selected);
      const base64 = bytesToBase64(bytes);
      setSelectedImage({
        path: selected,
        name: basename(selected),
        bytes,
        base64,
        previewUrl: `data:${imageMimeType(selected)};base64,${base64}`,
        sourceKind: 'image',
        sourceLabel: '图片文件',
      }, null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingInput(false);
    }
  }

  async function pickPdf() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (typeof selected !== 'string') return;

    setLoadingInput(true);
    setError(null);
    setResult(null);
    setActiveTable(0);
    try {
      const bytes = await readBinaryFile(selected);
      const previews = await renderPdfPreviews(bytes);
      const base64 = bytesToBase64(bytes);
      const firstPage = previews.pages[0];
      const nextPdf: SelectedPdf = {
        path: selected,
        name: basename(selected),
        bytes,
        pageCount: previews.pageCount,
        selectedPage: 1,
        pages: previews.pages,
      };
      setSelectedImage(
        {
          name: basename(selected),
          bytes,
          base64,
          previewUrl: firstPage?.dataUrl || '',
          sourceKind: 'pdf',
          sourceLabel: `${basename(selected)} · 第 1 页`,
          pageNum: 1,
          pageCount: previews.pageCount,
          path: selected,
        },
        nextPdf
      );
    } catch (err) {
      setError(`读取 PDF 失败：${String(err)}`);
    } finally {
      setLoadingInput(false);
    }
  }

  async function selectPdfPage(pageNum: number) {
    if (!pdf || pageNum === pdf.selectedPage || loadingInput || processing) return;

    setLoadingInput(true);
    setError(null);
    setResult(null);
    setActiveTable(0);
    try {
      const nextPdf = { ...pdf, selectedPage: pageNum };
      const preview = pdf.pages.find((page) => page.pageNum === pageNum);
      setSelectedImage(
        {
          name: pdf.name,
          bytes: pdf.bytes,
          base64: bytesToBase64(pdf.bytes),
          previewUrl: preview?.dataUrl || '',
          sourceKind: 'pdf',
          sourceLabel: `${pdf.name} · 第 ${pageNum} 页`,
          pageNum,
          pageCount: pdf.pageCount,
          path: pdf.path,
        },
        nextPdf
      );
    } catch (err) {
      setError(`渲染 PDF 第 ${pageNum} 页失败：${String(err)}`);
    } finally {
      setLoadingInput(false);
    }
  }

  const loadClipboardImageFile = useCallback(
    async (file: File) => {
      setLoadingInput(true);
      setError(null);
      setResult(null);
      setActiveTable(0);
      try {
        const bytes = await fileToBytes(file);
        const base64 = bytesToBase64(bytes);
        const extension = imageExtensionFromMime(file.type || 'image/png');
        setSelectedImage(
          {
            name: file.name || `clipboard-table.${extension}`,
            bytes,
            base64,
            previewUrl: `data:${file.type || 'image/png'};base64,${base64}`,
            sourceKind: 'clipboard',
            sourceLabel: '剪贴板图片',
          },
          null
        );
      } catch (err) {
        setError(`读取剪贴板图片失败：${String(err)}`);
      } finally {
        setLoadingInput(false);
      }
    },
    [setSelectedImage]
  );

  async function pasteImageFromClipboard() {
    if (!navigator.clipboard?.read) {
      setError('当前环境不支持直接读取剪贴板图片，可以在窗口中按 Ctrl+V 粘贴。');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          await loadClipboardImageFile(
            new File([blob], `clipboard-table.${imageExtensionFromMime(imageType)}`, {
              type: imageType,
            })
          );
          return;
        }
      }
      setError('剪贴板中没有可识别的图片。');
    } catch (err) {
      setError(`读取剪贴板失败：${String(err)}。也可以直接按 Ctrl+V 粘贴图片。`);
    }
  }

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.items || [])
        .find((item) => item.type.startsWith('image/'))
        ?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void loadClipboardImageFile(file);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [loadClipboardImageFile]);

  async function recognize() {
    if (!image || settingsError) return;

    setProcessing(true);
    setError(null);
    setResult(null);
    setActiveTable(0);
    try {
      await settings.loadSettings();
      const latestSettings = useSettingsStore.getState();
      const latestSettingsError = validateTencentOcrSettings(latestSettings);
      if (latestSettingsError) {
        setError(latestSettingsError);
        return;
      }

      const response = await invoke<TencentTableOcrResult>('recognize_tencent_table_accurate_ocr', {
        imageBase64: image.base64,
        pdfPageNumber: image.sourceKind === 'pdf' ? image.pageNum || 1 : null,
      });
      setResult(response);
      setActiveTable(0);
      if (!response.tables.length && !response.excelBase64) {
        setError('腾讯云未返回可预览的表格，也未返回 Excel 数据。');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setProcessing(false);
    }
  }

  async function saveExcel() {
    if (!result?.excelBase64) return;
    const outputPath = await save({
      defaultPath: `${image ? stem(image.name) : 'tencent_table_ocr'}.xlsx`,
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
    });
    if (!outputPath) return;

    setSaving(true);
    setError(null);
    try {
      await writeBinaryFile(outputPath, base64ToBytes(result.excelBase64));
      await invoke('show_in_folder', { path: outputPath });
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function clearImage() {
    setImage(null);
    setPdf(null);
    setResult(null);
    setActiveTable(0);
    setError(null);
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="📊"
        title="腾讯云 OCR 表格识别"
        subtitle="调用腾讯云表格识别 V3，支持图片、PDF 和剪贴板图片并导出 Excel"
      />

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto pb-4 pr-1">
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">表格图片</h2>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  图片和 PDF 会直接提交给腾讯云表格识别 V3；剪贴板图片可直接粘贴。
                </p>
              </div>
              {image && (
                <button
                  type="button"
                  onClick={clearImage}
                  disabled={processing || saving}
                  className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-50 dark:hover:bg-gray-700"
                  title="清除"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={pickImage}
                disabled={processing || saving || loadingInput}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-teal-500 px-3 py-2.5 text-sm font-medium text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              >
                {loadingInput && !image ? (
                  <Loader size={15} className="animate-spin" />
                ) : (
                  <Upload size={15} />
                )}
                图片
              </button>
              <button
                type="button"
                onClick={pickPdf}
                disabled={processing || saving || loadingInput}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2.5 text-sm font-medium text-white hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              >
                <FileText size={15} />
                PDF
              </button>
              <button
                type="button"
                onClick={pasteImageFromClipboard}
                disabled={processing || saving || loadingInput}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2.5 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:disabled:bg-gray-700"
              >
                <Clipboard size={15} />
                粘贴
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              也可以复制图片后在此窗口按 Ctrl+V。
            </p>

            {image ? (
              <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex h-48 items-center justify-center bg-gray-100 p-3 sm:h-52 dark:bg-gray-900">
                  {image.previewUrl ? (
                    <img
                      src={image.previewUrl}
                      alt="表格图片预览"
                      className="max-h-full max-w-full rounded border border-gray-200 object-contain shadow-sm dark:border-gray-700"
                    />
                  ) : (
                    <FileText size={48} className="text-gray-300 dark:text-gray-600" />
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                      {image.name}
                    </p>
                    <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {image.sourceKind === 'pdf'
                        ? 'PDF'
                        : image.sourceKind === 'clipboard'
                          ? '剪贴板'
                          : '图片'}
                    </span>
                  </div>
                  <p className="break-all text-xs text-gray-400 dark:text-gray-500">
                    {image.sourceLabel}
                  </p>
                  {image.path && (
                    <p className="break-all text-xs text-gray-400 dark:text-gray-500">
                      {image.path}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatBytes(image.bytes.length)}
                    {image.pageNum && image.pageCount
                      ? ` · 第 ${image.pageNum}/${image.pageCount} 页`
                      : ''}
                  </p>
                  {image.sourceKind === 'pdf' && (
                    <p className="text-xs leading-5 text-indigo-600 dark:text-indigo-300">
                      识别时会传 PDF 原文件 Base64 和 PdfPageNumber，不会把 PDF 转成图片再上传。
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div
                onClick={pickImage}
                className="mt-4 flex h-48 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-center transition-colors hover:border-teal-400 hover:bg-teal-50 sm:h-52 dark:border-gray-700 dark:bg-gray-900/40 dark:hover:bg-teal-950/20"
              >
                <ImageIcon size={42} className="text-gray-300 dark:text-gray-600" />
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                  选择图片、PDF，或按 Ctrl+V 粘贴图片
                </p>
              </div>
            )}

            {pdf && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
                    PDF 页面
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {pdf.pageCount} 页
                  </p>
                </div>
                <div className="mt-3 grid max-h-40 grid-cols-3 gap-2 overflow-auto pr-1">
                  {pdf.pages.map((page) => (
                    <button
                      key={page.pageNum}
                      type="button"
                      onClick={() => void selectPdfPage(page.pageNum)}
                      disabled={loadingInput || processing}
                      className={`overflow-hidden rounded-md border text-left transition-colors ${
                        pdf.selectedPage === page.pageNum
                          ? 'border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900'
                          : 'border-gray-200 hover:border-indigo-300 dark:border-gray-700'
                      }`}
                    >
                      <div className="flex h-20 items-center justify-center bg-gray-100 dark:bg-gray-900">
                        <img
                          src={page.dataUrl}
                          alt={`PDF 第 ${page.pageNum} 页`}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="px-2 py-1 text-center text-[11px] text-gray-500 dark:text-gray-400">
                        第 {page.pageNum} 页
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">识别配置</h2>
            <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
              使用全局设置中的 OCR 腾讯云配置：
              <div className="mt-1">
                Secret ID：
                {settings.ocrTencentSecretId
                  ? `${settings.ocrTencentSecretId.slice(0, 4)}...`
                  : '未配置'}
              </div>
              <div>地域：{settings.ocrTencentRegion || 'ap-guangzhou'}</div>
            </div>

            {settingsError && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {settingsError}
              </div>
            )}

            <button
              type="button"
              onClick={recognize}
              disabled={!canRecognize}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {processing ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {image?.sourceKind === 'pdf' ? '识别 PDF 当前页' : '开始识别'}
            </button>

            <button
              type="button"
              onClick={saveExcel}
              disabled={!canSave}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {saving ? <Loader size={16} className="animate-spin" /> : <Download size={16} />}
              保存 Excel
            </button>
          </section>
        </aside>

        <main className="min-h-0 overflow-auto">
          {error && (
            <section className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <div className="flex items-start gap-2">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">识别失败</p>
                  <p className="mt-1 break-words text-xs leading-5">{error}</p>
                </div>
              </div>
            </section>
          )}

          {processing && (
            <section className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
              <div className="flex items-center gap-2">
                <Loader size={16} className="animate-spin" />
                正在调用腾讯云 OCR 表格识别...
              </div>
            </section>
          )}

          {result ? (
            <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="border-b border-gray-200 p-4 dark:border-gray-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle size={22} className="mt-0.5 text-green-500" />
                    <div>
                      <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                        表格识别完成
                      </h2>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {stats.tables} 个表格，{stats.rows} 行，最大 {stats.cols} 列，{stats.cells}{' '}
                        个单元格
                        {result.pdfPageSize ? ` · PDF 共 ${result.pdfPageSize} 页` : ''}
                        {result.requestId ? ` · RequestId: ${result.requestId}` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={saveExcel}
                    disabled={!canSave}
                    className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FileSpreadsheet size={14} />
                    保存 Excel
                  </button>
                </div>

                {result.tables.length > 1 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {result.tables.map((table, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setActiveTable(index)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          activeTable === index
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >
                        表格 {index + 1} · {table.rowCount} x {table.colCount}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {active ? (
                <div className="overflow-auto p-4">
                  <table className="min-w-full border-collapse text-sm">
                    <tbody>
                      {active.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, colIndex) => (
                            <td
                              key={`${rowIndex}-${colIndex}`}
                              className="max-w-[260px] whitespace-pre-wrap border border-gray-200 px-2 py-1.5 align-top text-gray-700 dark:border-gray-700 dark:text-gray-200"
                            >
                              {cell || (
                                <span className="text-gray-300 dark:text-gray-600">&nbsp;</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex min-h-[420px] items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  腾讯云返回了 Excel 数据，但没有返回可预览的表格结构。可以直接保存 Excel 查看。
                </div>
              )}
            </section>
          ) : (
            <section className="flex min-h-[560px] flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <FileSpreadsheet size={54} className="text-gray-300 dark:text-gray-600" />
              <h2 className="mt-4 text-base font-semibold text-gray-800 dark:text-gray-100">
                腾讯云高精度表格识别
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
                选择包含表格的图片后，将调用腾讯云 RecognizeTableAccurateOCR 接口，
                返回结构化表格预览并支持导出 Excel。PDF 将按腾讯云表格识别 V3 的原生 PDF 参数提交。
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={pickImage}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <FolderOpen size={15} />
                  选择图片
                </button>
                <button
                  type="button"
                  onClick={pickPdf}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <FileText size={15} />
                  选择 PDF
                </button>
                <button
                  type="button"
                  onClick={pasteImageFromClipboard}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <Clipboard size={15} />
                  粘贴图片
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
