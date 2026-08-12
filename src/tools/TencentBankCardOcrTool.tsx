import { useCallback, useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { readBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  Banknote,
  CheckCircle,
  Clipboard,
  Copy,
  CreditCard,
  Image as ImageIcon,
  Loader,
  RefreshCw,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { useSettingsStore } from '../stores/settingsStore';

type InputSourceKind = 'image' | 'clipboard';

interface SelectedImage {
  path?: string;
  name: string;
  bytes: Uint8Array;
  previewUrl: string;
  base64: string;
  sourceKind: InputSourceKind;
  sourceLabel: string;
}

interface TencentBankCardOcrResult {
  cardNo: string;
  bankInfo: string;
  validDate: string;
  cardType: string;
  cardName: string;
  cardCategory: string;
  borderCutImage?: string | null;
  cardNoImage?: string | null;
  warningCode?: number[] | null;
  qualityValue?: number | null;
  requestId?: string | null;
}

interface BankCardOptions {
  retBorderCutImage: boolean;
  retCardNoImage: boolean;
  enableCopyCheck: boolean;
  enableReshootCheck: boolean;
  enableBorderCheck: boolean;
  enableQualityValue: boolean;
}

const defaultOptions: BankCardOptions = {
  retBorderCutImage: false,
  retCardNoImage: false,
  enableCopyCheck: true,
  enableReshootCheck: true,
  enableBorderCheck: true,
  enableQualityValue: true,
};

const warningLabels: Record<number, string> = {
  [-9102]: '复印件告警',
  [-9103]: '翻拍件告警',
  [-9106]: '边框不完整告警',
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

function resultRows(result: TencentBankCardOcrResult | null) {
  if (!result) return [];
  return [
    ['卡号', result.cardNo],
    ['银行信息', result.bankInfo],
    ['有效期', result.validDate],
    ['卡类型', result.cardType],
    ['卡名称', result.cardName],
    ['卡片类别', result.cardCategory],
    ['质量分', result.qualityValue == null ? '' : String(result.qualityValue)],
  ].filter(([, value]) => value);
}

export default function TencentBankCardOcrTool() {
  const ready = useToolTheme();
  const settings = useSettingsStore();
  const [image, setImage] = useState<SelectedImage | null>(null);
  const [options, setOptions] = useState<BankCardOptions>(defaultOptions);
  const [result, setResult] = useState<TencentBankCardOcrResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [loadingInput, setLoadingInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void useSettingsStore.getState().loadSettings();
  }, []);

  const settingsError = validateTencentOcrSettings(settings);
  const rows = useMemo(() => resultRows(result), [result]);
  const warningCodes = result?.warningCode || [];
  const canRecognize = !!image && !processing && !settingsError;

  const setSelectedImage = useCallback((nextImage: SelectedImage) => {
    setImage(nextImage);
    setResult(null);
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
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingInput(false);
    }
  }

  const loadClipboardImageFile = useCallback(
    async (file: File) => {
      setLoadingInput(true);
      setError(null);
      setResult(null);
      try {
        const bytes = await fileToBytes(file);
        const base64 = bytesToBase64(bytes);
        const extension = imageExtensionFromMime(file.type || 'image/png');
        setSelectedImage({
          name: file.name || `bank-card.${extension}`,
          bytes,
          base64,
          previewUrl: `data:${file.type || 'image/png'};base64,${base64}`,
          sourceKind: 'clipboard',
          sourceLabel: '剪贴板图片',
        });
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
            new File([blob], `bank-card.${imageExtensionFromMime(imageType)}`, {
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
    setCopied(false);
    try {
      await settings.loadSettings();
      const latestSettingsError = validateTencentOcrSettings(useSettingsStore.getState());
      if (latestSettingsError) {
        setError(latestSettingsError);
        return;
      }

      const response = await invoke<TencentBankCardOcrResult>('recognize_tencent_bank_card_ocr', {
        imageBase64: image.base64,
        ...options,
      });
      setResult(response);
      if (!response.cardNo && !response.bankInfo) {
        setError('腾讯云未返回银行卡信息，请确认图片中银行卡清晰完整。');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setProcessing(false);
    }
  }

  async function copyResult() {
    if (!result) return;
    const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function clearImage() {
    setImage(null);
    setResult(null);
    setError(null);
    setCopied(false);
  }

  function updateOption(key: keyof BankCardOptions, value: boolean) {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="💳"
        title="腾讯云 OCR 银行卡识别"
        subtitle="调用腾讯云 BankCardOCR，复用全局 OCR 腾讯云密钥"
      />

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto pb-4 pr-1">
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">银行卡图片</h2>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  支持本地图片和剪贴板图片，识别卡号、银行、有效期和卡类型。
                </p>
              </div>
              {image && (
                <button
                  type="button"
                  onClick={clearImage}
                  disabled={processing}
                  className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-50 dark:hover:bg-gray-700"
                  title="清除"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={pickImage}
                disabled={processing || loadingInput}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              >
                {loadingInput && !image ? (
                  <Loader size={15} className="animate-spin" />
                ) : (
                  <Upload size={15} />
                )}
                选择图片
              </button>
              <button
                type="button"
                onClick={pasteImageFromClipboard}
                disabled={processing || loadingInput}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2.5 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:disabled:bg-gray-700"
              >
                <Clipboard size={15} />
                粘贴图片
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              也可以复制图片后在此窗口按 Ctrl+V。
            </p>

            {image ? (
              <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex h-44 items-center justify-center bg-gray-100 p-3 sm:h-48 dark:bg-gray-900">
                  <img
                    src={image.previewUrl}
                    alt="银行卡图片预览"
                    className="max-h-full max-w-full rounded border border-gray-200 object-contain shadow-sm dark:border-gray-700"
                  />
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                      {image.name}
                    </p>
                    <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {image.sourceKind === 'clipboard' ? '剪贴板' : '图片'}
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
                  </p>
                </div>
              </div>
            ) : (
              <div
                onClick={pickImage}
                className="mt-4 flex h-44 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-center transition-colors hover:border-cyan-400 hover:bg-cyan-50 sm:h-48 dark:border-gray-700 dark:bg-gray-900/40 dark:hover:bg-cyan-950/20"
              >
                <ImageIcon size={42} className="text-gray-300 dark:text-gray-600" />
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                  选择银行卡图片，或按 Ctrl+V 粘贴
                </p>
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
              {[
                ['enableCopyCheck', '复印件检测'],
                ['enableReshootCheck', '翻拍件检测'],
                ['enableBorderCheck', '边框完整检测'],
                ['enableQualityValue', '返回质量分'],
                ['retBorderCutImage', '返回银行卡切图'],
                ['retCardNoImage', '返回卡号切图'],
              ].map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900/50 dark:text-gray-300"
                >
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={options[key as keyof BankCardOptions]}
                    onChange={(event) =>
                      updateOption(key as keyof BankCardOptions, event.target.checked)
                    }
                    className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
                  />
                </label>
              ))}
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
              开始识别
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
                正在调用腾讯云 BankCardOCR...
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
                        银行卡识别完成
                      </h2>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {result.requestId ? `RequestId: ${result.requestId}` : '已返回识别结果'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={copyResult}
                    className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm text-white hover:bg-cyan-700"
                  >
                    <Copy size={14} />
                    {copied ? '已复制' : '复制结果'}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 p-4 xl:grid-cols-[1fr_340px]">
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    {rows.map(([label, value]) => (
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

                  {warningCodes.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      <div className="flex items-start gap-2">
                        <ShieldAlert size={17} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="font-medium">检测告警</p>
                          <p className="mt-1 text-xs leading-5">
                            {warningCodes
                              .map((code) => `${warningLabels[code] || '未知告警'} (${code})`)
                              .join('；')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <aside className="space-y-3">
                  {result.borderCutImage && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                      <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                        银行卡切图
                      </p>
                      <img
                        src={`data:image/jpeg;base64,${result.borderCutImage}`}
                        alt="银行卡切图"
                        className="max-h-48 w-full rounded object-contain"
                      />
                    </div>
                  )}
                  {result.cardNoImage && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                      <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                        卡号切图
                      </p>
                      <img
                        src={`data:image/jpeg;base64,${result.cardNoImage}`}
                        alt="卡号切图"
                        className="max-h-32 w-full rounded object-contain"
                      />
                    </div>
                  )}
                </aside>
              </div>
            </section>
          ) : (
            <section className="flex min-h-[560px] flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <CreditCard size={54} className="text-gray-300 dark:text-gray-600" />
              <h2 className="mt-4 text-base font-semibold text-gray-800 dark:text-gray-100">
                腾讯云银行卡识别
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
                上传或粘贴银行卡图片后，将调用腾讯云 BankCardOCR 接口返回卡号、银行、有效期、卡类型和风险告警。
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={pickImage}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <Banknote size={15} />
                  选择图片
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
