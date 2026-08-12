import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { readBinaryFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjsLib from 'pdfjs-dist';
import {
  AlertCircle,
  CheckCircle,
  Eye,
  FileText,
  FolderOpen,
  Languages,
  Loader,
  Save,
  ScanText,
  Settings2,
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

type TranslateProvider = 'baidu' | 'google' | 'bing' | 'tencent' | 'chatgpt' | 'gemini';
type OcrProvider = 'baidu' | 'google' | 'tencent' | 'aliyun' | 'wechat' | 'paddle' | 'wps';
type WorkMode = 'auto' | 'text' | 'ocr';
type RenderQuality = 'balanced' | 'high';

interface TranslateResult {
  translated_text: string;
  from_lang: string;
  to_lang: string;
}

interface OcrResult {
  text: string;
  text_blocks?: OcrTextBlock[];
}

interface OcrTextBlock {
  text: string;
  location: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

interface PdfPageInfo {
  pageCount: number;
  previewUrl: string;
  width: number;
  height: number;
}

interface LayoutBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  source: 'pdf' | 'ocr';
}

interface ProgressState {
  page: number;
  pageCount: number;
  block: number;
  blockCount: number;
  message: string;
}

const LANGUAGES = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'fr', label: '法语' },
  { value: 'de', label: '德语' },
  { value: 'es', label: '西班牙语' },
  { value: 'ru', label: '俄语' },
  { value: 'pt', label: '葡萄牙语' },
  { value: 'it', label: '意大利语' },
  { value: 'ar', label: '阿拉伯语' },
  { value: 'th', label: '泰语' },
  { value: 'vi', label: '越南语' },
];

const TRANSLATE_PROVIDER_LABELS: Record<TranslateProvider, string> = {
  baidu: '百度翻译',
  google: 'Google',
  bing: '必应翻译',
  tencent: '腾讯翻译',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
};

const OCR_PROVIDER_LABELS: Record<OcrProvider, string> = {
  baidu: '百度 OCR',
  google: 'Google Vision',
  tencent: '腾讯 OCR',
  aliyun: '阿里云 OCR',
  wechat: '微信本机 OCR',
  paddle: 'PaddleOCR 本地',
  wps: 'WPS OCR 本地',
};

function isTranslateProvider(value: unknown): value is TranslateProvider {
  return typeof value === 'string' && value in TRANSLATE_PROVIDER_LABELS;
}

function isOcrProvider(value: unknown): value is OcrProvider {
  return typeof value === 'string' && value in OCR_PROVIDER_LABELS;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || dataUrl;
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function canvasToBase64(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.94): string {
  return canvas.toDataURL(type, quality).split(',')[1] || '';
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function shouldTranslate(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 2) return false;
  return /[\p{L}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
    compact
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parsePageRange(input: string, pageCount: number): number[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return Array.from({ length: pageCount }, (_, idx) => idx + 1);
  }

  const pages = new Set<number>();
  for (const part of trimmed.split(/[,，]/)) {
    const piece = part.trim();
    if (!piece) continue;
    const range = piece.match(/^(\d+)\s*[-~]\s*(\d+)$/);
    if (range) {
      const start = clamp(Number(range[1]), 1, pageCount);
      const end = clamp(Number(range[2]), 1, pageCount);
      const [from, to] = start <= end ? [start, end] : [end, start];
      for (let page = from; page <= to; page += 1) pages.add(page);
      continue;
    }
    const page = Number(piece);
    if (Number.isInteger(page) && page >= 1 && page <= pageCount) pages.add(page);
  }

  return Array.from(pages).sort((a, b) => a - b);
}

function getFileStem(path: string): string {
  const name = path.split(/[\\/]/).pop() || 'translated';
  return name.replace(/\.pdf$/i, '');
}

function validateTranslateProvider(provider: TranslateProvider, settings: ReturnType<typeof useSettingsStore.getState>) {
  if (provider === 'baidu' && (!settings.translateBaiduAppId || !settings.translateBaiduSecretKey)) {
    return '请先在设置中配置百度翻译 App ID 和 Secret Key。';
  }
  if (provider === 'google' && !settings.translateGoogleApiKey) {
    return '请先在设置中配置 Google 翻译 API Key。';
  }
  if (provider === 'bing' && !settings.translateBingApiKey) {
    return '请先在设置中配置必应翻译 API Key。';
  }
  if (
    provider === 'tencent' &&
    (!settings.translateTencentSecretId || !settings.translateTencentSecretKey)
  ) {
    return '请先在设置中配置腾讯翻译 Secret ID 和 Secret Key。';
  }
  if (provider === 'chatgpt' && !settings.translateOpenaiApiKey) {
    return '请先在设置中配置 ChatGPT API Key。';
  }
  if (provider === 'gemini' && !settings.translateGeminiApiKey) {
    return '请先在设置中配置 Gemini API Key。';
  }
  return null;
}

function validateOcrProvider(provider: OcrProvider, settings: ReturnType<typeof useSettingsStore.getState>) {
  if (provider === 'baidu' && (!settings.ocrBaiduApiKey || !settings.ocrBaiduSecretKey)) {
    return '扫描件 PDF 需要 OCR，请先在设置中配置百度 OCR API Key 和 Secret Key。';
  }
  if (provider === 'google' && !settings.ocrGoogleApiKey) {
    return '扫描件 PDF 需要 OCR，请先在设置中配置 Google Cloud Vision API Key。';
  }
  if (provider === 'tencent' && (!settings.ocrTencentSecretId || !settings.ocrTencentSecretKey)) {
    return '扫描件 PDF 需要 OCR，请先在设置中配置腾讯 OCR Secret ID 和 Secret Key。';
  }
  if (provider === 'aliyun' && (!settings.ocrAliyunAccessKeyId || !settings.ocrAliyunAccessKeySecret)) {
    return '扫描件 PDF 需要 OCR，请先在设置中配置阿里云 OCR AccessKey。';
  }
  return null;
}

async function renderPageToCanvas(page: any, scale: number): Promise<{
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  viewport: any;
}> {
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
    viewport,
  };
}

async function makePreview(path: string): Promise<PdfPageInfo> {
  const bytes = await readBinaryFile(path);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
  try {
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1.5, 640 / baseViewport.width);
    const { canvas } = await renderPageToCanvas(page, scale);
    page.cleanup();
    return {
      pageCount: doc.numPages,
      previewUrl: canvas.toDataURL('image/jpeg', 0.92),
      width: baseViewport.width,
      height: baseViewport.height,
    };
  } finally {
    await doc.destroy();
  }
}

function textItemToBlock(item: any, viewport: any, pageHeight: number): LayoutBlock | null {
  const text = normalizeText(item.str || '');
  if (!text) return null;

  const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const rawFontSize = Math.max(
    Math.abs(tx[0] || 0),
    Math.abs(tx[3] || 0),
    Math.abs(item.height || 0),
    8
  );
  const width = Math.max(Math.abs(item.width || 0), rawFontSize * text.length * 0.45, 8);
  const height = Math.max(rawFontSize * 1.15, 8);
  const x = tx[4] || 0;
  const top = (tx[5] || 0) - height;
  const y = pageHeight - top - height;

  return {
    text,
    x: clamp(x, 0, viewport.width),
    y: clamp(y, 0, pageHeight),
    width: clamp(width, 8, viewport.width),
    height,
    fontSize: clamp(rawFontSize * 0.92, 6, 28),
    source: 'pdf',
  };
}

function mergeLineBlocks(blocks: LayoutBlock[], pageWidth: number): LayoutBlock[] {
  const sorted = [...blocks].sort((a, b) => {
    const lineDiff = Math.abs(b.y - a.y);
    if (lineDiff > Math.max(a.fontSize, b.fontSize) * 0.4) return b.y - a.y;
    return a.x - b.x;
  });
  const lines: LayoutBlock[] = [];

  for (const block of sorted) {
    const last = lines[lines.length - 1];
    const lastRight = last ? last.x + last.width : 0;
    const gap = last ? block.x - lastRight : 0;
    const joinGapLimit = last
      ? Math.max(Math.max(last.fontSize, block.fontSize) * 3.2, pageWidth * 0.025)
      : 0;
    if (
      last &&
      Math.abs(last.y - block.y) <= Math.max(last.fontSize, block.fontSize) * 0.45 &&
      block.x >= last.x - 2 &&
      gap <= joinGapLimit
    ) {
      const blockRight = block.x + block.width;
      last.text += gap > Math.max(2, last.fontSize * 0.2) ? ` ${block.text}` : block.text;
      last.width = clamp(Math.max(lastRight, blockRight) - last.x, 8, pageWidth - last.x);
      last.height = Math.max(last.height, block.height);
      last.fontSize = Math.max(last.fontSize, block.fontSize);
    } else {
      lines.push({ ...block });
    }
  }

  return lines.filter((line) => shouldTranslate(line.text));
}

async function extractPdfTextBlocks(page: any): Promise<LayoutBlock[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const rawBlocks = (content.items || [])
    .map((item: any) => textItemToBlock(item, viewport, viewport.height))
    .filter(Boolean) as LayoutBlock[];
  return mergeLineBlocks(rawBlocks, viewport.width);
}

function ocrBlocksToLayoutBlocks(
  ocr: OcrResult,
  canvasWidth: number,
  canvasHeight: number,
  pageWidth: number,
  pageHeight: number
): LayoutBlock[] {
  const blocks = ocr.text_blocks || [];
  if (!blocks.length && ocr.text.trim()) {
    const lines = ocr.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const lineHeight = Math.max(14, pageHeight / 42);
    return lines.map((line, index) => ({
      text: line,
      x: pageWidth * 0.08,
      y: pageHeight - pageHeight * 0.12 - index * lineHeight,
      width: pageWidth * 0.84,
      height: lineHeight,
      fontSize: Math.min(12, lineHeight * 0.82),
      source: 'ocr',
    }));
  }

  const layoutBlocks = blocks
    .map((block) => {
      const text = normalizeText(block.text);
      const left = block.location.left / canvasWidth;
      const top = block.location.top / canvasHeight;
      const width = block.location.width / canvasWidth;
      const height = block.location.height / canvasHeight;
      const boxHeight = Math.max(height * pageHeight, 8);
      return {
        text,
        x: clamp(left * pageWidth, 0, pageWidth),
        y: clamp(pageHeight - (top + height) * pageHeight, 0, pageHeight),
        width: clamp(width * pageWidth, 8, pageWidth),
        height: boxHeight,
        fontSize: clamp(boxHeight * 0.72, 6, 18),
        source: 'ocr' as const,
      };
    })
    .filter((block) => shouldTranslate(block.text));

  return mergeLineBlocks(layoutBlocks, pageWidth);
}

function splitTextUnits(text: string): string[] {
  if (/\s/.test(text)) {
    return text.split(/(\s+)/).filter(Boolean);
  }
  return Array.from(text);
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const units = splitTextUnits(text);
  const lines: string[] = [];
  let current = '';

  for (const unit of units) {
    const candidate = current ? current + unit : unit;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current.trimEnd());
    current = unit.trimStart();
  }

  if (current.trim()) lines.push(current.trimEnd());
  return lines.length ? lines : [text];
}

function fitText(font: PDFFont, text: string, baseSize: number, maxWidth: number, maxHeight: number) {
  let size = clamp(baseSize, 5, 24);
  let lines = wrapText(font, text, size, maxWidth);
  while (size > 4.2) {
    const lineHeight = size * 1.18;
    const tooTall = lines.length * lineHeight > maxHeight;
    const tooWide = lines.some((line) => font.widthOfTextAtSize(line, size) > maxWidth);
    if (!tooTall && !tooWide) break;
    size -= 0.5;
    lines = wrapText(font, text, size, maxWidth);
  }
  return { size, lines, lineHeight: size * 1.18 };
}

function drawTranslatedBlock(
  page: PDFPage,
  font: PDFFont,
  block: LayoutBlock,
  translated: string,
  options: { pageWidth: number; pageHeight: number; coverOpacity: number; keepOriginal: boolean }
) {
  const padX = Math.max(1.5, block.fontSize * 0.18);
  const padY = Math.max(1, block.fontSize * 0.12);
  const availableWidth = clamp(block.width + padX * 2, 10, options.pageWidth - block.x + padX);
  const maxHeight = clamp(block.height * 2.4 + padY * 2, block.height + 2, options.pageHeight);
  const { size, lines, lineHeight } = fitText(
    font,
    translated,
    block.fontSize,
    Math.max(8, availableWidth - padX * 2),
    maxHeight - padY * 2
  );
  const textHeight = lines.length * lineHeight;
  const rectHeight = clamp(Math.max(block.height + padY * 2, textHeight + padY * 2), 6, maxHeight);
  const rectY = clamp(block.y - padY - Math.max(0, rectHeight - block.height), 0, options.pageHeight);
  const rectX = clamp(block.x - padX, 0, options.pageWidth);
  const rectWidth = clamp(availableWidth, 8, options.pageWidth - rectX);

  if (!options.keepOriginal) {
    page.drawRectangle({
      x: rectX,
      y: rectY,
      width: rectWidth,
      height: rectHeight,
      color: rgb(1, 1, 1),
      opacity: options.coverOpacity,
    });
  }

  const firstBaseline = rectY + rectHeight - padY - size;
  lines.forEach((line, index) => {
    const y = firstBaseline - index * lineHeight;
    if (y < rectY) return;
    page.drawText(line, {
      x: rectX + padX,
      y,
      size,
      font,
      color: rgb(0.08, 0.1, 0.13),
      maxWidth: rectWidth - padX * 2,
    });
  });
}

function providerConfig(settings: ReturnType<typeof useSettingsStore.getState>) {
  return {
    baiduAppId: settings.translateBaiduAppId || '',
    baiduSecretKey: settings.translateBaiduSecretKey || '',
    googleApiKey: settings.translateGoogleApiKey || '',
    bingApiKey: settings.translateBingApiKey || '',
    tencentSecretId: settings.translateTencentSecretId || '',
    tencentSecretKey: settings.translateTencentSecretKey || '',
    tencentRegion: settings.translateTencentRegion || 'ap-guangzhou',
    openaiApiKey: settings.translateOpenaiApiKey || '',
    openaiModel: settings.translateOpenaiModel || 'gpt-4o',
    openaiBaseUrl: settings.translateOpenaiBaseUrl || '',
    geminiApiKey: settings.translateGeminiApiKey || '',
    geminiModel: settings.translateGeminiModel || 'gemini-pro',
  };
}

function ocrConfig(settings: ReturnType<typeof useSettingsStore.getState>) {
  return {
    baiduApiKey: settings.ocrBaiduApiKey || '',
    baiduSecretKey: settings.ocrBaiduSecretKey || '',
    baiduHighAccuracy: settings.ocrBaiduHighAccuracy !== false,
    googleApiKey: settings.ocrGoogleApiKey || '',
    tencentSecretId: settings.ocrTencentSecretId || '',
    tencentSecretKey: settings.ocrTencentSecretKey || '',
    tencentRegion: settings.ocrTencentRegion || 'ap-guangzhou',
    aliyunAccessKeyId: settings.ocrAliyunAccessKeyId || '',
    aliyunAccessKeySecret: settings.ocrAliyunAccessKeySecret || '',
  };
}

export default function PdfTranslateTool() {
  const ready = useToolTheme();
  const settings = useSettingsStore();
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [info, setInfo] = useState<PdfPageInfo | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [mode, setMode] = useState<WorkMode>('auto');
  const [fromLang, setFromLang] = useState(settings.translateFromLang || 'auto');
  const [toLang, setToLang] = useState(settings.translateToLang || 'zh');
  const [translateProvider, setTranslateProvider] = useState<TranslateProvider>(
    (settings.translateProvider || 'baidu') as TranslateProvider
  );
  const [ocrProvider, setOcrProvider] = useState<OcrProvider>(
    (settings.ocrProvider || 'baidu') as OcrProvider
  );
  const [pageRange, setPageRange] = useState('');
  const [quality, setQuality] = useState<RenderQuality>('balanced');
  const [coverOpacity, setCoverOpacity] = useState(0.92);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [resultPath, setResultPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const cancelRef = useRef(false);
  const hydratedFromSettingsRef = useRef(false);

  const selectedPages = useMemo(() => {
    if (!info) return [];
    return parsePageRange(pageRange, info.pageCount);
  }, [info, pageRange]);

  const ocrEnvironmentMessage = useMemo(
    () => validateOcrProvider(ocrProvider, settings),
    [ocrProvider, settings]
  );

  const environmentMessage = useMemo(() => {
    const translateError = validateTranslateProvider(translateProvider, settings);
    if (translateError) return translateError;
    if (mode === 'ocr') return ocrEnvironmentMessage;
    return null;
  }, [mode, ocrEnvironmentMessage, settings, translateProvider]);

  const autoOcrWarning = useMemo(() => {
    if (mode !== 'auto' || !ocrEnvironmentMessage) return null;
    return `自动模式遇到扫描页时需要 OCR；当前 OCR 未就绪。文字版 PDF 仍可直接处理。${ocrEnvironmentMessage}`;
  }, [mode, ocrEnvironmentMessage]);

  useEffect(() => {
    if (!ready || hydratedFromSettingsRef.current) return;
    setFromLang(settings.translateFromLang || 'auto');
    setToLang(settings.translateToLang && settings.translateToLang !== 'auto' ? settings.translateToLang : 'zh');
    if (isTranslateProvider(settings.translateProvider)) {
      setTranslateProvider(settings.translateProvider);
    }
    if (isOcrProvider(settings.ocrProvider)) {
      setOcrProvider(settings.ocrProvider);
    }
    hydratedFromSettingsRef.current = true;
  }, [
    ready,
    settings.ocrProvider,
    settings.translateFromLang,
    settings.translateProvider,
    settings.translateToLang,
  ]);

  const selectFile = async () => {
    const selected = await open({ filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!selected || Array.isArray(selected)) return;
    setFilePath(selected);
    setFileName(selected.split(/[\\/]/).pop() || selected);
    setInfo(null);
    setError(null);
    setWarning(null);
    setResultPath('');
    setLoadingPreview(true);
    try {
      setInfo(await makePreview(selected));
    } catch (e: any) {
      setError(`无法读取 PDF：${e?.message || String(e)}`);
    } finally {
      setLoadingPreview(false);
    }
  };

  const translateOne = useCallback(
    async (text: string, cache: Map<string, string>): Promise<string> => {
      const normalized = normalizeText(text);
      if (!shouldTranslate(normalized)) return text;
      const cacheKey = `${fromLang}|${toLang}|${translateProvider}|${normalized}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const result = await invoke<TranslateResult>('translate_text', {
        text: normalized,
        fromLang,
        toLang,
        provider: translateProvider,
        autoDetectLanguage: settings.translateAutoDetectLanguage ?? true,
        config: providerConfig(settings),
      });
      const translated = normalizeText(result.translated_text || '') || normalized;
      cache.set(cacheKey, translated);
      return translated;
    },
    [fromLang, settings, toLang, translateProvider]
  );

  const runOcr = useCallback(
    async (canvas: HTMLCanvasElement): Promise<OcrResult> => {
      const imageBase64 = canvasToBase64(canvas, 'image/png');
      return invoke<OcrResult>('ocr_recognize', {
        imageBase64,
        provider: ocrProvider,
        config: ocrConfig(settings),
      });
    },
    [ocrProvider, settings]
  );

  const loadFont = async (doc: PDFDocument) => {
    doc.registerFontkit(fontkit);
    const fontData = await invoke<number[]>('get_chinese_font');
    return doc.embedFont(new Uint8Array(fontData), { subset: true });
  };

  const handleTranslate = async () => {
    if (!filePath || !info || processing) return;
    const translateError = validateTranslateProvider(translateProvider, settings);
    if (translateError) {
      setError(translateError);
      return;
    }
    const pagesToProcess = selectedPages;
    if (!pagesToProcess.length) {
      setError('页码范围无效，请输入如 1-3,5 或留空处理全部页面。');
      return;
    }

    const output = await save({
      defaultPath: `${getFileStem(filePath)}_translated_${toLang}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!output) return;

    cancelRef.current = false;
    setProcessing(true);
    setError(null);
    setWarning(null);
    setResultPath('');
    setProgress({
      page: 0,
      pageCount: pagesToProcess.length,
      block: 0,
      blockCount: 0,
      message: '准备翻译 PDF...',
    });

    let usedOcr = false;
    const renderScale = quality === 'high' ? 2.2 : 1.65;
    const ocrScale = quality === 'high' ? 2.4 : 1.8;
    const translationCache = new Map<string, string>();

    try {
      const sourceBytes = await readBinaryFile(filePath);
      const sourceDoc = await pdfjsLib.getDocument({ data: new Uint8Array(sourceBytes) }).promise;
      const outDoc = await PDFDocument.create();
      const font = await loadFont(outDoc);

      try {
        for (let index = 0; index < pagesToProcess.length; index += 1) {
          if (cancelRef.current) throw new Error('已取消处理');
          const pageNum = pagesToProcess[index];
          setProgress({
            page: index + 1,
            pageCount: pagesToProcess.length,
            block: 0,
            blockCount: 0,
            message: `渲染第 ${pageNum} 页...`,
          });

          const sourcePage = await sourceDoc.getPage(pageNum);
          const baseViewport = sourcePage.getViewport({ scale: 1 });
          const rendered = await renderPageToCanvas(sourcePage, renderScale);
          const page = outDoc.addPage([baseViewport.width, baseViewport.height]);
          const bgBytes = dataUrlToBytes(rendered.canvas.toDataURL('image/jpeg', 0.92));
          const bgImage = await outDoc.embedJpg(bgBytes);
          page.drawImage(bgImage, {
            x: 0,
            y: 0,
            width: baseViewport.width,
            height: baseViewport.height,
          });

          setProgress({
            page: index + 1,
            pageCount: pagesToProcess.length,
            block: 0,
            blockCount: 0,
            message: `分析第 ${pageNum} 页文本...`,
          });

          let blocks = mode === 'ocr' ? [] : await extractPdfTextBlocks(sourcePage);
          let pageMode: WorkMode = 'text';

          if (mode === 'ocr' || (mode === 'auto' && blocks.map((b) => b.text).join('').length < 20)) {
            const ocrError = validateOcrProvider(ocrProvider, settings);
            if (ocrError) {
              throw new Error(`第 ${pageNum} 页像扫描件，需要 OCR。${ocrError}`);
            }
            usedOcr = true;
            pageMode = 'ocr';
            setProgress({
              page: index + 1,
              pageCount: pagesToProcess.length,
              block: 0,
              blockCount: 0,
              message: `OCR 识别第 ${pageNum} 页...`,
            });
            const ocrRendered =
              Math.abs(ocrScale - renderScale) < 0.05
                ? rendered
                : await renderPageToCanvas(sourcePage, ocrScale);
            const ocr = await runOcr(ocrRendered.canvas);
            blocks = ocrBlocksToLayoutBlocks(
              ocr,
              ocrRendered.canvas.width,
              ocrRendered.canvas.height,
              baseViewport.width,
              baseViewport.height
            );
          }

          if (!blocks.length) {
            setWarning((prev) =>
              prev || `部分页面未检测到可翻译文字；已保留原页面画面。`
            );
            sourcePage.cleanup();
            continue;
          }

          for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
            if (cancelRef.current) throw new Error('已取消处理');
            const block = blocks[blockIndex];
            setProgress({
              page: index + 1,
              pageCount: pagesToProcess.length,
              block: blockIndex + 1,
              blockCount: blocks.length,
              message: `${pageMode === 'ocr' ? 'OCR' : '文本'} 翻译第 ${pageNum} 页 ${blockIndex + 1}/${blocks.length}`,
            });
            try {
              const translated = await translateOne(block.text, translationCache);
              drawTranslatedBlock(page, font, block, translated, {
                pageWidth: baseViewport.width,
                pageHeight: baseViewport.height,
                coverOpacity,
                keepOriginal,
              });
            } catch (e: any) {
              throw new Error(`第 ${pageNum} 页「${block.text.slice(0, 18)}」翻译失败：${String(e)}`);
            }
          }

          sourcePage.cleanup();
        }
      } finally {
        await sourceDoc.destroy();
      }

      const pdfBytes = await outDoc.save();
      await writeBinaryFile(output, pdfBytes);
      setResultPath(output);
      setProgress({
        page: pagesToProcess.length,
        pageCount: pagesToProcess.length,
        block: 0,
        blockCount: 0,
        message: 'PDF 翻译完成',
      });

      if (usedOcr && ocrProvider === 'aliyun') {
        setWarning('阿里云 OCR 当前接口未返回文本坐标，扫描页会按段落回排，版面保真度会弱一些。');
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setProcessing(false);
      cancelRef.current = false;
    }
  };

  const resetFile = () => {
    setFilePath('');
    setFileName('');
    setInfo(null);
    setResultPath('');
    setError(null);
    setWarning(null);
    setProgress(null);
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="🌐"
        title="AI PDF 格式翻译"
        subtitle={info ? `${info.pageCount} 页 · ${TRANSLATE_PROVIDER_LABELS[translateProvider]}` : undefined}
      />

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-[340px] flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col">
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {!filePath ? (
              <button
                onClick={selectFile}
                className="w-full h-32 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl flex flex-col items-center justify-center hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
              >
                <Upload size={26} className="text-gray-400 mb-2" />
                <span className="text-sm text-gray-500 dark:text-gray-400">选择 PDF 文件</span>
              </button>
            ) : (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-3 flex items-center gap-3">
                <FileText size={22} className="text-red-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{fileName}</p>
                  <p className="text-xs text-gray-400">
                    {info ? `${info.pageCount} 页` : loadingPreview ? '读取中...' : 'PDF'}
                  </p>
                </div>
                <button
                  onClick={resetFile}
                  disabled={processing}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                  title="移除文件"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <section className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300">
                <Settings2 size={14} />
                处理模式
              </div>
              <div className="grid grid-cols-3 gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                {[
                  { value: 'auto', label: '自动' },
                  { value: 'text', label: '文字版' },
                  { value: 'ocr', label: '扫描件' },
                ].map((item) => (
                  <button
                    key={item.value}
                    onClick={() => setMode(item.value as WorkMode)}
                    disabled={processing}
                    className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      mode === item.value
                        ? 'bg-red-500 text-white shadow-sm'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-600'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">源语言</span>
                <select
                  value={fromLang}
                  onChange={(e) => setFromLang(e.target.value)}
                  disabled={processing}
                  className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">目标语言</span>
                <select
                  value={toLang}
                  onChange={(e) => setToLang(e.target.value)}
                  disabled={processing}
                  className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  {LANGUAGES.filter((lang) => lang.value !== 'auto').map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="space-y-3">
              <label className="space-y-1 block">
                <span className="text-xs text-gray-500 dark:text-gray-400">翻译引擎</span>
                <select
                  value={translateProvider}
                  onChange={(e) => setTranslateProvider(e.target.value as TranslateProvider)}
                  disabled={processing}
                  className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  {(Object.keys(TRANSLATE_PROVIDER_LABELS) as TranslateProvider[]).map((provider) => (
                    <option key={provider} value={provider}>
                      {TRANSLATE_PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </label>

              {(mode === 'auto' || mode === 'ocr') && (
                <label className="space-y-1 block">
                  <span className="text-xs text-gray-500 dark:text-gray-400">扫描件 OCR</span>
                  <select
                    value={ocrProvider}
                    onChange={(e) => setOcrProvider(e.target.value as OcrProvider)}
                    disabled={processing}
                    className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                  >
                    {(Object.keys(OCR_PROVIDER_LABELS) as OcrProvider[]).map((provider) => (
                      <option key={provider} value={provider}>
                        {OCR_PROVIDER_LABELS[provider]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </section>

            <section className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">页码范围</span>
                <input
                  value={pageRange}
                  onChange={(e) => setPageRange(e.target.value)}
                  disabled={processing}
                  placeholder="全部 / 1-3,5"
                  className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">输出清晰度</span>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as RenderQuality)}
                  disabled={processing}
                  className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  <option value="balanced">均衡</option>
                  <option value="high">高清</option>
                </select>
              </label>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">原文遮盖</span>
                <span className="text-xs text-red-500 font-medium">{Math.round(coverOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={50}
                max={100}
                value={Math.round(coverOpacity * 100)}
                disabled={processing || keepOriginal}
                onChange={(e) => setCoverOpacity(Number(e.target.value) / 100)}
                className="w-full accent-red-500"
              />
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={keepOriginal}
                  disabled={processing}
                  onChange={(e) => setKeepOriginal(e.target.checked)}
                  className="accent-red-500"
                />
                保留原文并叠加译文
              </label>
            </section>

            {environmentMessage && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-2">
                <AlertCircle size={15} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                  {environmentMessage}
                </p>
              </div>
            )}

            {autoOcrWarning && !environmentMessage && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-2">
                <AlertCircle size={15} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                  {autoOcrWarning}
                </p>
              </div>
            )}

            {warning && (
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 flex gap-2">
                <AlertCircle size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">{warning}</p>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 flex gap-2">
                <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed whitespace-pre-wrap">
                  {error}
                </p>
              </div>
            )}

            {resultPath && (
              <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3 space-y-2">
                <div className="flex gap-2">
                  <CheckCircle size={15} className="text-green-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs text-green-700 dark:text-green-300 font-medium">
                      翻译完成
                    </p>
                    <p className="text-[11px] text-green-600 dark:text-green-400 truncate">
                      {resultPath.split(/[\\/]/).pop()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => invoke('show_in_folder', { path: resultPath })}
                  className="w-full flex items-center justify-center gap-1.5 text-xs rounded-lg bg-green-600 hover:bg-green-700 text-white px-3 py-1.5"
                >
                  <FolderOpen size={13} />
                  打开位置
                </button>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 p-3 flex items-center gap-2">
            <button
              onClick={selectFile}
              disabled={processing}
              className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              <Upload size={13} />
              {filePath ? '重选' : '选择'}
            </button>
            <div className="flex-1" />
            {processing ? (
              <button
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="px-4 py-2 text-xs rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                取消
              </button>
            ) : null}
            <button
              onClick={handleTranslate}
              disabled={!filePath || !info || processing || Boolean(environmentMessage)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-medium disabled:cursor-not-allowed"
            >
              {processing ? <Loader size={13} className="animate-spin" /> : <Save size={13} />}
              {processing ? '处理中' : '生成译文 PDF'}
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-auto p-5 bg-gray-100 dark:bg-gray-900/60">
          {!filePath ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3">
              <Languages size={42} />
              <p className="text-sm">选择 PDF 后开始格式翻译</p>
            </div>
          ) : loadingPreview ? (
            <div className="h-full flex items-center justify-center gap-2 text-gray-400 text-sm">
              <Loader size={18} className="animate-spin" />
              正在读取 PDF...
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex items-center gap-3">
                  <FileText size={18} className="text-red-500" />
                  <div>
                    <p className="text-[11px] text-gray-400">页面</p>
                    <p className="text-sm font-semibold">{selectedPages.length || 0} / {info?.pageCount || 0}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex items-center gap-3">
                  {mode === 'ocr' ? <ScanText size={18} className="text-red-500" /> : <Eye size={18} className="text-red-500" />}
                  <div>
                    <p className="text-[11px] text-gray-400">识别</p>
                    <p className="text-sm font-semibold">
                      {mode === 'auto' ? '自动判断' : mode === 'text' ? '文本坐标' : 'OCR 坐标'}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex items-center gap-3">
                  <Languages size={18} className="text-red-500" />
                  <div>
                    <p className="text-[11px] text-gray-400">语言</p>
                    <p className="text-sm font-semibold">{fromLang} → {toLang}</p>
                  </div>
                </div>
              </div>

              {progress && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{progress.message}</p>
                    <p className="text-xs text-gray-400">
                      {progress.page}/{progress.pageCount}
                      {progress.blockCount ? ` · ${progress.block}/${progress.blockCount}` : ''}
                    </p>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full bg-red-500 transition-all"
                      style={{
                        width: `${Math.round(
                          ((Math.max(progress.page - 1, 0) +
                            (progress.blockCount ? progress.block / progress.blockCount : 0)) /
                            Math.max(progress.pageCount, 1)) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {info?.previewUrl ? (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">
                    第 1 页预览
                  </p>
                  <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-white shadow-sm">
                    <img src={info.previewUrl} alt="PDF 预览" className="w-full h-auto block" />
                  </div>
                </div>
              ) : (
                <div className="h-80 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center text-sm text-gray-400">
                  暂无预览
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
