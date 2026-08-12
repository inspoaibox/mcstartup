import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  CheckCircle,
  Clipboard,
  Download,
  FileImage,
  Loader,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { fileToBase64, useClipboardPaste } from './useImageInput';
import { useToolTheme } from './useToolTheme';

const AUTO_SIZE_MODE = '200';

interface SourceImage {
  kind: 'path' | 'dataUrl';
  name: string;
  previewUrl: string;
  path?: string;
  dataUrl?: string;
}

interface ConvertResult {
  outputPath: string;
  outputFormat: string;
  width: number;
  height: number;
  outputSize: number;
  copiedToClipboard: boolean;
  note?: string | null;
}

function formatSize(size: number | undefined) {
  if (!size || Number.isNaN(size)) return '0 KB';
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  return `${(size / 1024).toFixed(1)} KB`;
}

function inferFormat(result: Partial<ConvertResult> | null | undefined) {
  const explicit = result?.outputFormat?.trim().toLowerCase();
  if (explicit) return explicit;

  const path = result?.outputPath || '';
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'gif' || ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
    return ext;
  }
  return 'png';
}

export default function WechatMemeTool() {
  const ready = useToolTheme();
  const [source, setSource] = useState<SourceImage | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recopying, setRecopying] = useState(false);
  const [saving, setSaving] = useState(false);

  async function runConvertFor(nextSource: SourceImage) {
    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const converted = await invoke<ConvertResult>('convert_to_wechat_meme', {
        inputPath: nextSource.kind === 'path' ? nextSource.path : null,
        dataUrl: nextSource.kind === 'dataUrl' ? nextSource.dataUrl : null,
        sizeMode: AUTO_SIZE_MODE,
      });
      setResult(converted);
    } catch (e) {
      setError(String(e));
    } finally {
      setProcessing(false);
    }
  }

  async function applySource(nextSource: SourceImage, autoConvert = true) {
    setSource(nextSource);
    setResult(null);
    setError(null);

    if (autoConvert) {
      await runConvertFor(nextSource);
    }
  }

  useClipboardPaste(async (b64, file) => {
    if (!file) return;
    await applySource({
      kind: 'dataUrl',
      name: file.name || 'clipboard-image.png',
      previewUrl: b64,
      dataUrl: b64,
    });
  });

  async function selectFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
    });

    if (typeof selected !== 'string') return;

    const name = selected.split(/[\\/]/).pop() || selected;
    await applySource({
      kind: 'path',
      name,
      path: selected,
      previewUrl: convertFileSrc(selected),
    });
  }

  async function handleDrop(fileLike: File & { path?: string }) {
    if (fileLike?.path) {
      await applySource({
        kind: 'path',
        name: fileLike.name || fileLike.path.split(/[\\/]/).pop() || fileLike.path,
        path: fileLike.path,
        previewUrl: convertFileSrc(fileLike.path),
      });
    } else if (fileLike?.type?.startsWith('image/')) {
      const b64 = await fileToBase64(fileLike);
      await applySource({
        kind: 'dataUrl',
        name: fileLike.name || 'dropped-image.png',
        dataUrl: b64,
        previewUrl: b64,
      });
    } else {
      return;
    }
  }

  async function handleRecopy() {
    if (!result) return;
    setRecopying(true);
    setError(null);
    try {
      await invoke('copy_wechat_meme_to_clipboard', {
        filePath: result.outputPath,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setRecopying(false);
    }
  }

  async function handleSave() {
    if (!result || !source) return;
    setSaving(true);
    setError(null);

    try {
      const stem = source.name.replace(/\.[^.]+$/, '');
      const ext = inferFormat(result);
      const outputPath = await save({
        defaultPath: `${stem}_微信表情.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });

      if (!outputPath) {
        setSaving(false);
        return;
      }

      await invoke('export_wechat_meme', {
        tempPath: result.outputPath,
        outputPath,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return null;

  const resultFormat = inferFormat(result);
  const resultPreviewUrl = result ? convertFileSrc(result.outputPath) : null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="😄"
        title="微信表情包转换"
        subtitle="默认表情模式：输出适配到 200×200 范围内，静态图转 GIF，GIF 动图保持动画并写入微信可粘贴的文件剪贴板"
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="space-y-6">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
              <div className="font-semibold flex items-center gap-2 mb-2">
                <Sparkles size={16} />
                工作原理
              </div>
              <p className="text-xs opacity-90">
                工具会把图片处理成更适合微信粘贴的文件，并把这个文件写进系统剪贴板。转换完成后去微信里直接
                <span className="font-semibold"> Ctrl+V </span>
                。当前默认是表情模式：输出宽和高都会限制在 200 以内，静态图会转成 GIF，原图是 GIF 时则保留动画并缩放。
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">
                  添加图片
                </h3>
                {!source ? (
                  <div
                    onClick={selectFile}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setDragging(false);
                      const dropped = Array.from(e.dataTransfer.files)[0] as File & {
                        path?: string;
                      };
                      if (dropped) await handleDrop(dropped);
                    }}
                    className={`h-44 rounded-xl border-2 border-dashed cursor-pointer transition-colors flex flex-col items-center justify-center text-center px-6 ${
                      dragging
                        ? 'border-green-400 bg-green-50 dark:bg-green-900/10'
                        : 'border-gray-300 dark:border-gray-600 hover:border-green-400 hover:bg-green-50/60 dark:hover:bg-green-900/10'
                    }`}
                  >
                    <Upload size={28} className="text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      点击选择、拖拽图片，或直接 Ctrl+V 粘贴
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      进入后会自动按表情模式处理，并自动复制到微信剪贴板
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-gray-50 dark:bg-gray-900/40">
                    <div className="aspect-square max-h-[320px] overflow-hidden flex items-center justify-center bg-[linear-gradient(45deg,#f3f4f6_25%,transparent_25%),linear-gradient(-45deg,#f3f4f6_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f3f4f6_75%),linear-gradient(-45deg,transparent_75%,#f3f4f6_75%)] dark:bg-[linear-gradient(45deg,#1f2937_25%,transparent_25%),linear-gradient(-45deg,#1f2937_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1f2937_75%),linear-gradient(-45deg,transparent_75%,#1f2937_75%)] [background-size:24px_24px] [background-position:0_0,0_12px,12px_-12px,-12px_0px]">
                      <img src={source.previewUrl} alt={source.name} className="max-w-full max-h-full object-contain" />
                    </div>
                    <div className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{source.name}</div>
                        <div className="text-xs text-gray-400">
                          {source.kind === 'path' ? '本地文件' : '剪贴板图片'}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setSource(null);
                          setResult(null);
                          setError(null);
                        }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="移除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="px-4 py-2.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm flex items-center gap-2">
                  {processing ? (
                    <>
                      <Loader size={16} className="animate-spin" />
                      自动处理中...
                    </>
                  ) : source ? (
                    <>
                      <Clipboard size={16} />
                      已按表情模式自动处理并复制
                    </>
                  ) : (
                    <>
                      <Clipboard size={16} />
                      选择图片后会自动处理并复制
                    </>
                  )}
                </div>
                <button
                  onClick={selectFile}
                  disabled={processing}
                  className="px-4 py-2.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  重新选择
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  转换结果
                </h3>
                {result && (
                  <div className="text-xs text-gray-400">
                    {resultFormat.toUpperCase()} · {result.width} × {result.height} · {formatSize(result.outputSize)}
                  </div>
                )}
              </div>

              {!result ? (
                <div className="h-[420px] rounded-xl border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 flex flex-col items-center justify-center text-center px-6">
                  <FileImage size={34} className="text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    还没有生成可粘贴结果
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    转换成功后，这里会显示可直接粘贴到微信的结果文件
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-[linear-gradient(45deg,#f3f4f6_25%,transparent_25%),linear-gradient(-45deg,#f3f4f6_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f3f4f6_75%),linear-gradient(-45deg,transparent_75%,#f3f4f6_75%)] dark:bg-[linear-gradient(45deg,#1f2937_25%,transparent_25%),linear-gradient(-45deg,#1f2937_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1f2937_75%),linear-gradient(-45deg,transparent_75%,#1f2937_75%)] [background-size:24px_24px] [background-position:0_0,0_12px,12px_-12px,-12px_0px] h-[420px] flex items-center justify-center">
                    <img
                      src={resultPreviewUrl || undefined}
                      alt="转换结果"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={handleRecopy}
                      disabled={recopying}
                      className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm transition-colors flex items-center gap-2 disabled:opacity-60"
                    >
                      {recopying ? (
                        <>
                          <Loader size={15} className="animate-spin" />
                          重新复制中...
                        </>
                      ) : (
                        <>
                          <Clipboard size={15} />
                          重新复制到剪贴板
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors flex items-center gap-2 disabled:opacity-60"
                    >
                      {saving ? (
                        <>
                          <Loader size={15} className="animate-spin" />
                          保存中...
                        </>
                      ) : (
                        <>
                          <Download size={15} />
                          另存结果
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">
                使用说明
              </h3>
              <ol className="space-y-2 text-sm text-gray-600 dark:text-gray-300 list-decimal pl-5">
                <li>把任意图片拖进来，或直接在窗口里按 Ctrl+V 粘贴图片。</li>
                <li>工具会立即按默认表情策略自动处理，并自动复制到微信剪贴板。</li>
                <li>切回微信聊天窗口，直接按 Ctrl+V 粘贴。</li>
              </ol>
            </div>

            {result && (
              <div className="p-4 rounded-xl border border-green-200 dark:border-green-800/50 bg-green-50 dark:bg-green-900/20 flex items-start gap-3">
                <CheckCircle size={18} className="text-green-500 mt-0.5" />
                <div className="text-sm text-green-800 dark:text-green-300">
                  <p className="font-medium">
                    已生成 {resultFormat.toUpperCase()} 并写入剪贴板，现在可以切到微信直接粘贴。
                  </p>
                  {result.note && <p className="mt-1 text-xs opacity-90">{result.note}</p>}
                  <p className="mt-1 text-xs opacity-70 select-all">{result.outputPath}</p>
                </div>
              </div>
            )}

            {error && (
              <div className="p-4 rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 flex items-start gap-3">
                <AlertCircle size={18} className="text-red-500 mt-0.5" />
                <p className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">
                  {error}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
