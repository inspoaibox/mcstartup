import { useCallback, useEffect, useMemo, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { open } from '@tauri-apps/api/dialog';
import { readBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  CheckCircle,
  Clipboard,
  Copy,
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

interface SelectedInput {
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

interface TencentGeneralInvoiceItem {
  code: string;
  invoiceType?: number | null;
  subType: string;
  typeDescription: string;
  subTypeDescription: string;
  page?: number | null;
  angle?: number | null;
  cutImage?: string | null;
  singleInvoiceInfos: unknown;
  raw: unknown;
}

interface TencentGeneralInvoiceOcrResult {
  mixedInvoiceItems: TencentGeneralInvoiceItem[];
  totalPdfCount?: number | null;
  requestId?: string | null;
}

interface GeneralInvoiceOptions {
  enableOther: boolean;
  enableMultiplePage: boolean;
  enableCutImage: boolean;
  enableItemPolygon: boolean;
  enableQrCode: boolean;
  enableSeal: boolean;
}

interface FieldRow {
  label: string;
  value: string;
  row?: number | null;
}

const defaultOptions: GeneralInvoiceOptions = {
  enableOther: true,
  enableMultiplePage: false,
  enableCutImage: false,
  enableItemPolygon: false,
  enableQrCode: false,
  enableSeal: false,
};

const invoiceTypeOptions = [
  { value: 0, label: '出租车' },
  { value: 1, label: '定额' },
  { value: 2, label: '火车票' },
  { value: 3, label: '增值税' },
  { value: 5, label: '机票' },
  { value: 8, label: '机打' },
  { value: 9, label: '汽车票' },
  { value: 10, label: '轮船票' },
  { value: 11, label: '卷票' },
  { value: 12, label: '购车' },
  { value: 13, label: '通行费' },
  { value: 15, label: '非税' },
  { value: 16, label: '全电' },
  { value: 17, label: '医疗' },
  { value: 18, label: '完税' },
  { value: 19, label: '海关缴款' },
  { value: 20, label: '银行回单' },
  { value: 21, label: '网约车' },
  { value: 22, label: '报关单' },
  { value: 23, label: '海外' },
  { value: 24, label: '购物小票' },
  { value: 25, label: '销货清单' },
  { value: -1, label: '其他' },
];

const fieldLabels: Record<string, string> = {
  Title: '票据名称',
  Code: '发票代码',
  Number: '发票号码',
  Date: '日期',
  Time: '时间',
  Total: '金额',
  TotalCn: '大写金额',
  PretaxAmount: '税前金额',
  Tax: '税额',
  Buyer: '购买方',
  BuyerTaxID: '购买方税号',
  Seller: '销售方',
  SellerTaxID: '销售方税号',
  UserName: '姓名',
  StationGetOn: '出发站',
  StationGetOff: '到达站',
  CurrencyCode: '币种',
  Kind: '类型',
  Province: '省份',
  City: '城市',
};

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(hasDisplayValue);
  if (isRecord(value)) return Object.values(value).some(hasDisplayValue);
  return true;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function labelForKey(key: string): string {
  return fieldLabels[key] || key;
}

function joinLabel(prefix: string, label: string): string {
  if (!prefix) return label;
  if (!label) return prefix;
  return `${prefix} / ${label}`;
}

function valueToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function rowsFromValue(value: unknown, prefix = '', depth = 0): FieldRow[] {
  if (!hasDisplayValue(value)) return [];
  if (depth > 4) {
    return [{ label: prefix || '内容', value: valueToText(value) }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      if (isRecord(entry)) {
        const name = asString(entry.Name) || asString(entry.Key) || asString(entry.Title);
        const rowValue = entry.Value ?? entry.Content ?? entry.Text ?? entry.Total;
        if (name && hasDisplayValue(rowValue)) {
          return [
            {
              label: joinLabel(prefix, name),
              value: valueToText(rowValue),
              row: asNumber(entry.Row),
            },
          ];
        }
        return rowsFromValue(entry, joinLabel(prefix, `项目 ${index + 1}`), depth + 1);
      }
      return [
        {
          label: joinLabel(prefix, `项目 ${index + 1}`),
          value: valueToText(entry),
        },
      ];
    });
  }

  if (isRecord(value)) {
    const name = asString(value.Name) || asString(value.Key);
    const rowValue = value.Value ?? value.Content ?? value.Text;
    if (name && hasDisplayValue(rowValue)) {
      return [
        {
          label: joinLabel(prefix, name),
          value: valueToText(rowValue),
          row: asNumber(value.Row),
        },
      ];
    }

    return Object.entries(value).flatMap(([key, entry]) => {
      if (!hasDisplayValue(entry)) return [];
      const label = labelForKey(key);
      if (Array.isArray(entry) || isRecord(entry)) {
        const nested = rowsFromValue(entry, joinLabel(prefix, label), depth + 1);
        return nested.length ? nested : [{ label: joinLabel(prefix, label), value: valueToText(entry) }];
      }
      return [{ label: joinLabel(prefix, label), value: valueToText(entry) }];
    });
  }

  return [{ label: prefix || '内容', value: valueToText(value) }];
}

function extractInvoiceContent(item: TencentGeneralInvoiceItem): unknown {
  const infos = item.singleInvoiceInfos;
  if (!isRecord(infos)) return infos;
  if (item.subType && hasDisplayValue(infos[item.subType])) {
    return infos[item.subType];
  }

  const nonEmptyEntries = Object.entries(infos).filter(([, value]) => hasDisplayValue(value));
  if (nonEmptyEntries.length === 1) {
    return nonEmptyEntries[0][1];
  }
  return Object.fromEntries(nonEmptyEntries);
}

function invoiceTitle(item: TencentGeneralInvoiceItem, index: number): string {
  return (
    item.subTypeDescription ||
    item.typeDescription ||
    item.subType ||
    (item.invoiceType == null ? '' : `类型 ${item.invoiceType}`) ||
    `票据 ${index + 1}`
  );
}

function optionLabel(count: number): string {
  return count > 0 ? `已限定 ${count} 类票据` : '自动识别全部类型';
}

export default function TencentGeneralInvoiceOcrTool() {
  const ready = useToolTheme();
  const settings = useSettingsStore();
  const [input, setInput] = useState<SelectedInput | null>(null);
  const [pdf, setPdf] = useState<SelectedPdf | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<number[]>([]);
  const [options, setOptions] = useState<GeneralInvoiceOptions>(defaultOptions);
  const [result, setResult] = useState<TencentGeneralInvoiceOcrResult | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [loadingInput, setLoadingInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void useSettingsStore.getState().loadSettings();
  }, []);

  const selectedTypeSet = useMemo(() => new Set(selectedTypes), [selectedTypes]);
  const settingsError = validateTencentOcrSettings(settings);
  const pdfTooLarge = !!pdf && pdf.pageCount > 30;
  const canRecognize = !!input && !processing && !loadingInput && !settingsError && !pdfTooLarge;
  const activeItem = result?.mixedInvoiceItems[activeIndex] || null;
  const activeContent = useMemo(() => (activeItem ? extractInvoiceContent(activeItem) : null), [activeItem]);
  const fieldRows = useMemo(
    () => (activeContent ? rowsFromValue(activeContent).slice(0, 120) : []),
    [activeContent]
  );

  const setSelectedInput = useCallback((nextInput: SelectedInput, nextPdf?: SelectedPdf | null) => {
    setInput(nextInput);
    if (nextPdf !== undefined) {
      setPdf(nextPdf);
    }
    setResult(null);
    setActiveIndex(0);
    setError(null);
    setCopied(false);
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
    setActiveIndex(0);
    try {
      const bytes = await readBinaryFile(selected);
      const base64 = bytesToBase64(bytes);
      setSelectedInput(
        {
          path: selected,
          name: basename(selected),
          bytes,
          base64,
          previewUrl: `data:${imageMimeType(selected)};base64,${base64}`,
          sourceKind: 'image',
          sourceLabel: '图片文件',
        },
        null
      );
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
    setActiveIndex(0);
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
      setSelectedInput(
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
      if (previews.pageCount > 30) {
        setError('腾讯云通用票据识别高级版仅支持返回 PDF 前 30 页，请拆分后再识别。');
      }
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
    setActiveIndex(0);
    try {
      const nextPdf = { ...pdf, selectedPage: pageNum };
      const preview = pdf.pages.find((page) => page.pageNum === pageNum);
      setSelectedInput(
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
      setError(`切换 PDF 第 ${pageNum} 页失败：${String(err)}`);
    } finally {
      setLoadingInput(false);
    }
  }

  const loadClipboardImageFile = useCallback(
    async (file: File) => {
      setLoadingInput(true);
      setError(null);
      setResult(null);
      setActiveIndex(0);
      try {
        const bytes = await fileToBytes(file);
        const base64 = bytesToBase64(bytes);
        const extension = imageExtensionFromMime(file.type || 'image/png');
        setSelectedInput(
          {
            name: file.name || `invoice.${extension}`,
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
    [setSelectedInput]
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
            new File([blob], `invoice.${imageExtensionFromMime(imageType)}`, {
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
    if (!input || settingsError || pdfTooLarge) return;

    setProcessing(true);
    setError(null);
    setResult(null);
    setActiveIndex(0);
    setCopied(false);
    try {
      await settings.loadSettings();
      const latestSettingsError = validateTencentOcrSettings(useSettingsStore.getState());
      if (latestSettingsError) {
        setError(latestSettingsError);
        return;
      }

      const isPdf = input.sourceKind === 'pdf';
      const response = await invoke<TencentGeneralInvoiceOcrResult>(
        'recognize_tencent_general_invoice_ocr',
        {
          imageBase64: input.base64,
          types: selectedTypes,
          enableOther: options.enableOther,
          enablePdf: isPdf,
          pdfPageNumber: isPdf && !options.enableMultiplePage ? input.pageNum || 1 : null,
          enableMultiplePage: isPdf ? options.enableMultiplePage : false,
          enableCutImage: options.enableCutImage,
          enableItemPolygon: options.enableItemPolygon,
          enableQrCode: options.enableQrCode,
          enableSeal: options.enableSeal,
        }
      );
      setResult(response);
      setActiveIndex(0);
      if (!response.mixedInvoiceItems.length) {
        setError('腾讯云未返回票据识别结果，请确认图片或 PDF 中票据清晰可见。');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setProcessing(false);
    }
  }

  async function copyResult() {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function clearInput() {
    setInput(null);
    setPdf(null);
    setResult(null);
    setActiveIndex(0);
    setError(null);
    setCopied(false);
  }

  function updateOption(key: keyof GeneralInvoiceOptions, value: boolean) {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }

  function toggleType(value: number) {
    setSelectedTypes((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="🧾"
        title="腾讯云 OCR 通用票据识别"
        subtitle="调用腾讯云 RecognizeGeneralInvoice，高级版票据识别复用全局 OCR 密钥"
      />

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto pb-4 pr-1">
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">票据来源</h2>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  支持图片、PDF 和剪贴板图片，PDF 会按腾讯云原生 PDF 参数提交。
                </p>
              </div>
              {input && (
                <button
                  type="button"
                  onClick={clearInput}
                  disabled={processing}
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
                disabled={processing || loadingInput}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-teal-500 px-3 py-2.5 text-sm font-medium text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              >
                {loadingInput && !input ? (
                  <Loader size={15} className="animate-spin" />
                ) : (
                  <Upload size={15} />
                )}
                图片
              </button>
              <button
                type="button"
                onClick={pickPdf}
                disabled={processing || loadingInput}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2.5 text-sm font-medium text-white hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              >
                <FileText size={15} />
                PDF
              </button>
              <button
                type="button"
                onClick={pasteImageFromClipboard}
                disabled={processing || loadingInput}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2.5 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:disabled:bg-gray-700"
              >
                <Clipboard size={15} />
                粘贴
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              也可以复制图片后在此窗口按 Ctrl+V。
            </p>

            {input ? (
              <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex h-48 items-center justify-center bg-gray-100 p-3 sm:h-52 dark:bg-gray-900">
                  {input.previewUrl ? (
                    <img
                      src={input.previewUrl}
                      alt="票据预览"
                      className="max-h-full max-w-full rounded border border-gray-200 object-contain shadow-sm dark:border-gray-700"
                    />
                  ) : (
                    <FileText size={48} className="text-gray-300 dark:text-gray-600" />
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                      {input.name}
                    </p>
                    <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {input.sourceKind === 'pdf'
                        ? 'PDF'
                        : input.sourceKind === 'clipboard'
                          ? '剪贴板'
                          : '图片'}
                    </span>
                  </div>
                  <p className="break-all text-xs text-gray-400 dark:text-gray-500">
                    {input.sourceLabel}
                  </p>
                  {input.path && (
                    <p className="break-all text-xs text-gray-400 dark:text-gray-500">
                      {input.path}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatBytes(input.bytes.length)}
                    {input.pageNum && input.pageCount
                      ? ` · 第 ${input.pageNum}/${input.pageCount} 页`
                      : ''}
                  </p>
                  {input.sourceKind === 'pdf' && (
                    <p className="text-xs leading-5 text-indigo-600 dark:text-indigo-300">
                      当前页模式会传 PdfPageNumber；多页模式会让腾讯云返回前 30 页。
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
                  选择票据图片、PDF，或按 Ctrl+V 粘贴图片
                </p>
              </div>
            )}

            {pdf && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-200">PDF 页面</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{pdf.pageCount} 页</p>
                </div>
                <div className="mt-3 grid max-h-40 grid-cols-3 gap-2 overflow-auto pr-1">
                  {pdf.pages.map((page) => (
                    <button
                      key={page.pageNum}
                      type="button"
                      onClick={() => void selectPdfPage(page.pageNum)}
                      disabled={loadingInput || processing || options.enableMultiplePage}
                      className={`overflow-hidden rounded-md border text-left transition-colors ${
                        pdf.selectedPage === page.pageNum
                          ? 'border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900'
                          : 'border-gray-200 hover:border-indigo-300 dark:border-gray-700'
                      } ${options.enableMultiplePage ? 'opacity-60' : ''}`}
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

            <div className="mt-3 space-y-2">
              {input?.sourceKind === 'pdf' && (
                <label className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
                  <span>PDF 多页识别</span>
                  <input
                    type="checkbox"
                    checked={options.enableMultiplePage}
                    onChange={(event) => updateOption('enableMultiplePage', event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>
              )}
              {[
                ['enableOther', '其他票智能识别'],
                ['enableCutImage', '返回票据切图'],
                ['enableItemPolygon', '返回字段坐标'],
                ['enableQrCode', '识别二维码'],
                ['enableSeal', '识别印章'],
              ].map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900/50 dark:text-gray-300"
                >
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={options[key as keyof GeneralInvoiceOptions]}
                    onChange={(event) =>
                      updateOption(key as keyof GeneralInvoiceOptions, event.target.checked)
                    }
                    className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                  />
                </label>
              ))}
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-gray-700 dark:text-gray-200">票据类型</h3>
                <button
                  type="button"
                  onClick={() => setSelectedTypes([])}
                  disabled={!selectedTypes.length || processing}
                  className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-40 dark:hover:text-gray-200"
                >
                  清空
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {optionLabel(selectedTypes.length)}
              </p>
              <div className="mt-2 grid max-h-44 grid-cols-3 gap-2 overflow-auto pr-1">
                {invoiceTypeOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => toggleType(item.value)}
                    disabled={processing}
                    className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                      selectedTypeSet.has(item.value)
                        ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-200'
                        : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-teal-300 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {settingsError && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {settingsError}
              </div>
            )}
            {pdfTooLarge && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                PDF 超过 30 页，当前接口仅支持返回前 30 页，请拆分后再识别。
              </div>
            )}

            <button
              type="button"
              onClick={recognize}
              disabled={!canRecognize}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {processing ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {input?.sourceKind === 'pdf'
                ? options.enableMultiplePage
                  ? '识别 PDF 多页'
                  : '识别 PDF 当前页'
                : '开始识别'}
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
                正在调用腾讯云 RecognizeGeneralInvoice...
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
                        通用票据识别完成
                      </h2>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {result.mixedInvoiceItems.length} 张票据
                        {result.totalPdfCount ? ` · PDF 共 ${result.totalPdfCount} 页` : ''}
                        {result.requestId ? ` · RequestId: ${result.requestId}` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={copyResult}
                    className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm text-white hover:bg-teal-700"
                  >
                    <Copy size={14} />
                    {copied ? '已复制' : '复制 JSON'}
                  </button>
                </div>

                {result.mixedInvoiceItems.length > 1 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {result.mixedInvoiceItems.map((item, index) => (
                      <button
                        key={`${item.subType}-${index}`}
                        type="button"
                        onClick={() => setActiveIndex(index)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          activeIndex === index
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >
                        {invoiceTitle(item, index)}
                        {item.page ? ` · P${item.page}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {activeItem ? (
                <div className="grid gap-4 p-4 xl:grid-cols-[1fr_340px]">
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      {[
                        ['识别状态', activeItem.code || 'OK'],
                        ['票据类型', invoiceTitle(activeItem, activeIndex)],
                        ['页码/角度', `${activeItem.page || '-'} / ${activeItem.angle ?? '-'}`],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
                        >
                          <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
                          <p className="mt-1 break-all text-sm font-medium text-gray-800 dark:text-gray-100">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                          结构化字段
                        </h3>
                      </div>
                      {fieldRows.length ? (
                        <div className="max-h-[460px] overflow-auto">
                          <table className="min-w-full border-collapse text-sm">
                            <tbody>
                              {fieldRows.map((row, index) => (
                                <tr
                                  key={`${row.label}-${index}`}
                                  className="border-b border-gray-100 last:border-b-0 dark:border-gray-700"
                                >
                                  <th className="w-44 bg-gray-50 px-3 py-2 text-left align-top text-xs font-medium text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
                                    {row.label}
                                    {row.row != null && row.row >= 0 ? (
                                      <span className="ml-1 text-gray-300">#{row.row}</span>
                                    ) : null}
                                  </th>
                                  <td className="whitespace-pre-wrap break-words px-3 py-2 text-gray-700 dark:text-gray-200">
                                    {row.value}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
                          当前票据没有可展开的结构化字段，可查看右侧原始 JSON。
                        </div>
                      )}
                    </div>
                  </div>

                  <aside className="space-y-3">
                    {activeItem.cutImage && (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                        <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                          票据切图
                        </p>
                        <img
                          src={`data:image/jpeg;base64,${activeItem.cutImage}`}
                          alt="票据切图"
                          className="max-h-64 w-full rounded object-contain"
                        />
                      </div>
                    )}
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                      <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                        原始 JSON
                      </p>
                      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-gray-600 dark:text-gray-300">
                        {JSON.stringify(activeItem.raw || activeItem, null, 2)}
                      </pre>
                    </div>
                  </aside>
                </div>
              ) : (
                <div className="flex min-h-[420px] items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  腾讯云返回了请求信息，但没有返回票据条目。
                </div>
              )}
            </section>
          ) : (
            <section className="flex min-h-[560px] flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <FileText size={54} className="text-gray-300 dark:text-gray-600" />
              <h2 className="mt-4 text-base font-semibold text-gray-800 dark:text-gray-100">
                腾讯云通用票据识别高级版
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
                上传图片、PDF 或粘贴票据截图后，将调用 RecognizeGeneralInvoice 返回多类型票据的结构化字段。
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
