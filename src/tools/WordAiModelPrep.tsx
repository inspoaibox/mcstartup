import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { AlertCircle, CheckCircle, Download, Info, Loader, RefreshCw } from 'lucide-react';

export type WordAiModelStatus = 'checking' | 'missing' | 'downloading' | 'ready' | 'error';

export interface WordAiStatus {
  modelReady: boolean;
  mode: string;
  modelDir: string;
  message: string;
  requiredFiles: string[];
  missingFiles: string[];
  validationError?: string | null;
}

export const WORD_MODEL_FILES = [
  {
    label: '段落结构分类模型',
    modelName: 'word-organizer/document-structure.onnx',
    url: 'https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/onnx/model_quantized.onnx',
  },
  {
    label: 'Tokenizer 配置',
    modelName: 'word-organizer/tokenizer.json',
    url: 'https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer.json',
  },
] as const;

export const WORD_MODEL_SIZE_MB = 120;

export function resolveWordAiModelStatus(status: WordAiStatus): WordAiModelStatus {
  if (status.modelReady) return 'ready';
  if (status.mode === 'invalid') return 'error';
  return 'missing';
}

export function useWordAiModelRuntime() {
  const [runtime, setRuntime] = useState<WordAiStatus | null>(null);
  const [modelStatus, setModelStatus] = useState<WordAiModelStatus>('checking');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadFile, setDownloadFile] = useState('');
  const [showManualGuide, setShowManualGuide] = useState(false);
  const [copyHint, setCopyHint] = useState('');
  const [modelError, setModelError] = useState<string | null>(null);

  const modelRoot = runtime?.modelDir || '';
  const modelBaseDir = modelRoot.replace(/\\word-organizer$/i, '').replace(/\/word-organizer$/i, '');
  const modelReady = modelStatus === 'ready';

  const manualGuideText = useMemo(() => {
    const root = modelRoot.replace(/\//g, '\\');
    return [
      'AI 文档语义模型 - 手动下载说明',
      '',
      `模型目录：${root}`,
      '',
      ...WORD_MODEL_FILES.flatMap((fileItem, index) => [
        `${index + 1}. ${fileItem.label}`,
        `下载链接：${fileItem.url}`,
        `保存位置：${modelBaseDir.replace(/\//g, '\\')}\\${fileItem.modelName.replace(/\//g, '\\')}`,
        '',
      ]),
      '下载完成后回到工具窗口，点击“重新检测”。',
    ].join('\n');
  }, [modelBaseDir, modelRoot]);

  async function refreshRuntime() {
    setModelStatus('checking');
    try {
      const status = await invoke<WordAiStatus>('check_word_ai_runtime');
      setRuntime(status);
      setModelStatus(resolveWordAiModelStatus(status));
      setModelError(null);
    } catch (err) {
      setModelStatus('error');
      setModelError(String(err));
    }
  }

  async function downloadModels() {
    if (!modelBaseDir) return;
    setModelStatus('downloading');
    setModelError(null);
    setDownloadProgress(0);
    setDownloadFile('');
    let doneFiles = 0;
    const totalFiles = WORD_MODEL_FILES.length;

    const unlisten = await listen<any>('model-download-progress', (event) => {
      const { loaded, total, done, file } = event.payload;
      setDownloadFile((file as string).split(/[/\\]/).pop() || file);
      const fileProgress = total > 0 ? loaded / total : 0;
      const overall = ((doneFiles + fileProgress) / totalFiles) * 100;
      setDownloadProgress(Math.round(overall));
      if (done) doneFiles++;
    });

    try {
      for (const fileItem of WORD_MODEL_FILES) {
        const destPath = `${modelBaseDir.replace(/\\/g, '/')}/${fileItem.modelName}`;
        await invoke('download_model_file', {
          url: fileItem.url,
          destPath,
          overwrite: true,
        });
      }
      await refreshRuntime();
    } catch (err) {
      setModelStatus('error');
      setModelError(String(err));
    } finally {
      unlisten();
    }
  }

  async function copyManualGuide() {
    try {
      await navigator.clipboard.writeText(manualGuideText);
      setCopyHint('说明已复制');
    } catch {
      setCopyHint('复制失败');
    }
    window.setTimeout(() => setCopyHint(''), 2000);
  }

  async function openModelDir() {
    if (!modelRoot) return;
    await invoke('open_path', { targetPath: modelRoot });
  }

  useEffect(() => {
    refreshRuntime();
  }, []);

  return {
    runtime,
    setRuntime,
    modelStatus,
    setModelStatus,
    modelReady,
    modelRoot,
    modelBaseDir,
    modelError,
    setModelError,
    downloadProgress,
    downloadFile,
    showManualGuide,
    setShowManualGuide,
    manualGuideText,
    copyHint,
    refreshRuntime,
    downloadModels,
    copyManualGuide,
    openModelDir,
  };
}

export function WordAiModelPrepPanel({
  runtime,
  status,
  progress,
  file,
  error,
  onDownload,
  onRetry,
  onManual,
}: {
  runtime: WordAiStatus | null;
  status: WordAiModelStatus;
  progress: number;
  file: string;
  error?: string | null;
  onDownload: () => void;
  onRetry: () => void;
  onManual: () => void;
}) {
  if (!runtime) {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 shadow-sm dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300">
        <div className="flex items-start gap-3">
          {status === 'checking' ? <Loader size={18} className="mt-0.5 animate-spin" /> : <AlertCircle size={18} className="mt-0.5" />}
          <div className="min-w-0 flex-1">
            <p className="font-medium">{status === 'checking' ? '正在检测 AI 文档语义模型' : 'AI 模型检测失败'}</p>
            <p className="mt-1 whitespace-pre-wrap text-xs opacity-90">
              {error || '正在确认本地模型文件和运行环境，请稍候。'}
            </p>
            {status !== 'checking' && (
              <button
                onClick={onRetry}
                className="mt-3 flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs text-blue-700 transition-colors hover:bg-blue-100 dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-gray-700"
              >
                <RefreshCw size={13} />
                重新检测
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'ready') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 shadow-sm dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300">
        <div className="flex items-start gap-3">
          <CheckCircle size={18} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">AI 文档语义模型已就绪</p>
            <p className="mt-1 text-xs opacity-90">{runtime.message}</p>
            <p className="mt-1 truncate text-xs opacity-75">模型目录：{runtime.modelDir}</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'downloading') {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 shadow-sm dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300">
        <div className="flex items-start gap-3">
          <Loader size={18} className="mt-0.5 animate-spin" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">下载模型中...</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 truncate text-xs opacity-80">
              {progress}% {file ? `· ${file}` : ''}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
      <div className="flex items-start gap-3">
        {status === 'error' ? <AlertCircle size={18} className="mt-0.5" /> : <Info size={18} className="mt-0.5" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {status === 'error' ? 'AI 模型校验失败' : '需要提前准备 AI 文档语义模型'}
          </p>
          <p className="mt-1 text-xs opacity-90">{runtime.message}</p>
          <p className="mt-1 truncate text-xs opacity-75">模型目录：{runtime.modelDir}</p>
          {runtime.missingFiles.length > 0 && (
            <p className="mt-1 text-xs opacity-75">缺少：{runtime.missingFiles.join(' / ')}</p>
          )}
          {runtime.validationError && (
            <p className="mt-1 whitespace-pre-wrap text-xs opacity-75">校验失败：{runtime.validationError}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={onDownload}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs text-white transition-colors hover:bg-amber-600"
            >
              <Download size={13} />
              下载模型（约 {WORD_MODEL_SIZE_MB}MB）
            </button>
            <button
              onClick={onManual}
              className="rounded-lg bg-white px-3 py-2 text-xs text-amber-700 transition-colors hover:bg-amber-100 dark:bg-gray-800 dark:text-amber-300 dark:hover:bg-gray-700"
            >
              查看手动下载方法
            </button>
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs text-amber-700 transition-colors hover:bg-amber-100 dark:bg-gray-800 dark:text-amber-300 dark:hover:bg-gray-700"
            >
              <RefreshCw size={13} />
              重新检测
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WordAiManualModelGuide({
  runtime,
  modelBaseDir,
  guideText,
  copyHint,
  onClose,
  onCopy,
  onOpenDir,
}: {
  runtime: WordAiStatus;
  modelBaseDir: string;
  guideText: string;
  copyHint: string;
  onClose: () => void;
  onCopy: () => void;
  onOpenDir: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-base font-semibold text-gray-900 dark:text-gray-100">手动下载模型方法</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                适用于网络波动、代理异常，或你想提前离线准备模型文件的情况。
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-4 text-sm text-gray-700 dark:text-gray-200">
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-900/20">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-300">模型存储目录</p>
            <div className="mt-2 break-all rounded-lg bg-white px-3 py-2 font-mono text-[12px] text-gray-700 dark:bg-gray-900 dark:text-gray-200">
              {runtime.modelDir.replace(/\//g, '\\')}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={onOpenDir}
                className="rounded-lg bg-blue-500 px-3 py-2 text-xs text-white transition-colors hover:bg-blue-600"
              >
                打开模型目录
              </button>
              <button
                onClick={onCopy}
                className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
              >
                复制下载说明
              </button>
              {copyHint && <span className="self-center text-xs text-green-600 dark:text-green-400">{copyHint}</span>}
            </div>
          </div>

          <ol className="list-decimal space-y-2 pl-5 text-xs leading-6 text-gray-600 dark:text-gray-300">
            <li>先确认上面的模型目录存在。</li>
            <li>进入对应网址，把模型文件下载到本机。</li>
            <li>保存位置必须和下方显示的完整路径一致。</li>
            <li>下载完成后回到当前工具窗口，点击“重新检测”。</li>
          </ol>

          <div className="space-y-3">
            {WORD_MODEL_FILES.map((fileItem) => {
              const fullPath = `${modelBaseDir.replace(/\//g, '\\')}\\${fileItem.modelName.replace(/\//g, '\\')}`;
              return (
                <div
                  key={fileItem.modelName}
                  className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60"
                >
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{fileItem.label}</p>
                  <div className="mt-3 space-y-2 text-xs">
                    <div>
                      <p className="mb-1 text-gray-500 dark:text-gray-400">下载链接</p>
                      <a
                        href={fileItem.url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
                      >
                        {fileItem.url}
                      </a>
                    </div>
                    <div>
                      <p className="mb-1 text-gray-500 dark:text-gray-400">保存位置</p>
                      <div className="break-all rounded-lg bg-white px-3 py-2 font-mono text-[12px] text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                        {fullPath}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <textarea
            readOnly
            value={guideText}
            className="h-40 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          />
        </div>
      </div>
    </div>
  );
}
