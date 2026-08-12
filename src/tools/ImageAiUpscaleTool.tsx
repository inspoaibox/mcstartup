import { useEffect, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { open, save } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  AlertCircle,
  CheckCircle,
  Download,
  FolderOpen,
  Info,
  Loader,
  RefreshCw,
  Settings,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';

type RuntimeStatus = 'unknown' | 'checking' | 'missing' | 'downloading' | 'ready' | 'error';
type FileStatus = 'pending' | 'processing' | 'done' | 'error';
type OutputFormat = 'png' | 'jpg' | 'webp';

interface RealEsrganRuntimeStatus {
  installed: boolean;
  runtimeDir: string;
  executablePath?: string | null;
  modelsPath?: string | null;
  missingFiles: string[];
  platform: string;
  version: string;
  archiveName: string;
  downloadUrl: string;
}

interface UpscaleResult {
  inputPath: string;
  outputPath: string;
  inputWidth: number;
  inputHeight: number;
  outputWidth: number;
  outputHeight: number;
  inputSize: number;
  outputSize: number;
}

interface FileItem {
  id: string;
  path: string;
  name: string;
  originalUrl: string;
  status: FileStatus;
  inputSize?: number;
  outputPath?: string;
  resultUrl?: string;
  inputWidth?: number;
  inputHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  outputSize?: number;
  error?: string;
}

const RUNTIME_SIZE_MB = 45;
const MODEL_OPTIONS = [
  {
    id: 'realesrgan-x4plus',
    label: '通用高清',
    desc: '照片、产品图、真实素材',
  },
  {
    id: 'realesrgan-x4plus-anime',
    label: '动漫插画',
    desc: '插画、线稿、二次元图片',
  },
  {
    id: 'realesr-animevideov3',
    label: '轻量动画',
    desc: '动画帧、低噪素材',
  },
] as const;
const SCALE_OPTIONS = [2, 3, 4] as const;
const FORMAT_OPTIONS: OutputFormat[] = ['png', 'jpg', 'webp'];
const TILE_OPTIONS = [
  { value: 0, label: '自动' },
  { value: 128, label: '128' },
  { value: 256, label: '256' },
  { value: 512, label: '512' },
];

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

function formatBytes(bytes?: number) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getExtension(path?: string, fallback: OutputFormat = 'png') {
  const match = path?.match(/\.([a-z0-9]+)$/i);
  return (match?.[1]?.toLowerCase() || fallback) as OutputFormat;
}

function joinPath(dir: string, filename: string) {
  const separator = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${filename}`;
}

function outputNameFor(file: FileItem) {
  const stem = file.name.replace(/\.[^.]+$/, '') || 'image';
  return `${stem}_upscaled.${getExtension(file.outputPath)}`;
}

function FilePreviewItem({
  file,
  onRemove,
  onSave,
}: {
  file: FileItem;
  onRemove: () => void;
  onSave: () => void;
}) {
  const [sliderPos, setSliderPos] = useState(50);

  const updateSlider = (target: HTMLDivElement, clientX: number) => {
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setSliderPos((x / rect.width) * 100);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div
        className="relative aspect-square touch-none select-none overflow-hidden bg-gray-100 dark:bg-gray-900"
        onPointerDown={(event) => {
          if (!file.resultUrl) return;
          updateSlider(event.currentTarget, event.clientX);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!file.resultUrl || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          updateSlider(event.currentTarget, event.clientX);
        }}
      >
        <img
          src={file.originalUrl}
          alt="原图"
          className="absolute inset-0 h-full w-full select-none object-contain"
          style={{ clipPath: file.resultUrl ? `inset(0 ${100 - sliderPos}% 0 0)` : 'none' }}
          draggable={false}
        />
        {file.resultUrl && (
          <>
            <img
              src={file.resultUrl}
              alt="增强结果"
              className="absolute inset-0 h-full w-full select-none object-contain"
              style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
              draggable={false}
            />
            <div
              className="absolute inset-y-0 z-10 flex w-0.5 cursor-col-resize items-center justify-center bg-white shadow-[0_0_5px_rgba(0,0,0,0.5)]"
              style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-gray-500 shadow-md">
                <div className="flex gap-0.5">
                  <div className="h-3 w-px bg-gray-400" />
                  <div className="h-3 w-px bg-gray-400" />
                </div>
              </div>
            </div>
            <span className="pointer-events-none absolute bottom-2 left-2 z-20 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
              原图
            </span>
            <span className="pointer-events-none absolute bottom-2 right-2 z-20 rounded bg-green-500/85 px-1.5 py-0.5 text-[10px] text-white">
              增强
            </span>
          </>
        )}

        {file.status === 'processing' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45">
            <div className="flex flex-col items-center gap-2">
              <Loader size={24} className="animate-spin text-white" />
              <span className="text-xs text-white">AI 放大中...</span>
            </div>
          </div>
        )}
        {file.status === 'done' && (
          <div className="absolute right-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 shadow">
            <CheckCircle size={14} className="text-white" />
          </div>
        )}
        {file.status === 'error' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-red-500/20">
            <AlertCircle size={24} className="text-red-500" />
          </div>
        )}
        <button
          onClick={onRemove}
          className="absolute left-2 top-2 z-30 flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-red-500"
        >
          <X size={10} />
        </button>
      </div>

      <div className="space-y-1.5 px-2.5 py-2">
        <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-300">{file.name}</p>
        <div className="flex items-center justify-between gap-2 text-[10px] text-gray-400">
          <span>{formatBytes(file.inputSize)}</span>
          {file.outputWidth && file.outputHeight && (
            <span>
              {file.inputWidth}×{file.inputHeight} → {file.outputWidth}×{file.outputHeight}
            </span>
          )}
        </div>
        {file.status === 'error' && (
          <p className="line-clamp-2 text-[10px] text-red-500">{file.error}</p>
        )}
        {file.status === 'done' && (
          <button
            onClick={onSave}
            className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg bg-green-50 py-1 text-[11px] text-green-600 transition-colors hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400"
          >
            <Download size={11} />
            保存结果
          </button>
        )}
      </div>
    </div>
  );
}

export default function ImageAiUpscaleTool() {
  const ready = useToolTheme();
  const [modelDir, setModelDir] = useState('');
  const [customDirInput, setCustomDirInput] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>('unknown');
  const [runtimeInfo, setRuntimeInfo] = useState<RealEsrganRuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadFile, setDownloadFile] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [scale, setScale] = useState<(typeof SCALE_OPTIONS)[number]>(4);
  const [modelName, setModelName] = useState<(typeof MODEL_OPTIONS)[number]['id']>(
    'realesrgan-x4plus'
  );
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('png');
  const [tileSize, setTileSize] = useState(0);
  const [tta, setTta] = useState(false);
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customModelDir, setCustomModelDir] = useState('');
  const [customModelName, setCustomModelName] = useState('');

  useEffect(() => {
    const init = async () => {
      setRuntimeStatus('checking');
      try {
        const customDir = await invoke<string | null>('get_custom_model_dir');
        const defaultDir = await invoke<string>('get_model_dir');
        const dir = customDir || defaultDir;
        setModelDir(dir);
        setCustomDirInput(dir);
        await refreshRuntime(dir);
      } catch (error) {
        setRuntimeStatus('error');
        setRuntimeError(getErrorMessage(error, '初始化 Real-ESRGAN 运行时失败'));
      }
    };
    init();
  }, []);

  const refreshRuntime = async (dir = modelDir) => {
    const status = await invoke<RealEsrganRuntimeStatus>('check_realesrgan_runtime', {
      modelDir: dir,
    });
    setRuntimeInfo(status);
    if (status.installed) {
      setRuntimeStatus('ready');
      setRuntimeError('');
    } else {
      setRuntimeStatus('missing');
      setRuntimeError(status.missingFiles.join('、'));
    }
  };

  const handleDownloadRuntime = async () => {
    setRuntimeStatus('downloading');
    setDownloadProgress(0);
    setDownloadFile('');
    setRuntimeError('');

    const unlisten = await listen<any>('model-download-progress', (event) => {
      const { loaded, total, done, file } = event.payload;
      const filename = (file as string).split(/[/\\]/).pop() || file;
      setDownloadFile(filename);
      if (String(file).includes('解压')) {
        setDownloadProgress(done ? 100 : 98);
        return;
      }
      const progress = total > 0 ? Math.round((loaded / total) * 95) : 0;
      setDownloadProgress(done ? 96 : progress);
    });

    try {
      const status = await invoke<RealEsrganRuntimeStatus>('download_realesrgan_runtime', {
        modelDir,
        overwrite: true,
      });
      setRuntimeInfo(status);
      setRuntimeStatus(status.installed ? 'ready' : 'error');
      setRuntimeError(status.installed ? '' : status.missingFiles.join('、'));
      setDownloadProgress(status.installed ? 100 : downloadProgress);
    } catch (error) {
      setRuntimeStatus('error');
      setRuntimeError(getErrorMessage(error, '下载 Real-ESRGAN 运行时失败，请检查网络连接'));
    } finally {
      unlisten();
    }
  };

  const handleSelectFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (!selected) return;

    const paths = Array.isArray(selected) ? selected : [selected];
    const newItems = await Promise.all(
      paths.map(async (path) => {
        const inputSize = await invoke<number>('get_file_size', { path }).catch(() => 0);
        return {
          id: Math.random().toString(36).slice(2),
          path,
          name: path.split(/[/\\]/).pop() || path,
          originalUrl: convertFileSrc(path),
          inputSize,
          status: 'pending' as const,
        };
      })
    );
    setFiles((prev) => [...prev, ...newItems]);
  };

  const handleSelectModelDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir && typeof dir === 'string') setCustomDirInput(dir);
  };

  const handleSaveModelDir = async () => {
    await invoke('set_model_dir', { path: customDirInput });
    setModelDir(customDirInput);
    setShowSettings(false);
    setRuntimeStatus('checking');
    try {
      await refreshRuntime(customDirInput);
    } catch (error) {
      setRuntimeStatus('error');
      setRuntimeError(getErrorMessage(error, '检查运行时失败'));
    }
  };

  const handleSelectCustomModelDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir && typeof dir === 'string') setCustomModelDir(dir);
  };

  const handleProcess = async () => {
    if (runtimeStatus !== 'ready' || processing) return;
    if (useCustomModel && (!customModelDir.trim() || !customModelName.trim())) {
      setTaskError('自定义模型需要选择模型目录并填写模型名称');
      return;
    }

    const pending = files.filter((file) => file.status === 'pending' || file.status === 'error');
    if (pending.length === 0) return;

    setProcessing(true);
    setTaskError('');

    for (const file of pending) {
      setFiles((prev) =>
        prev.map((item) =>
          item.id === file.id
            ? {
                ...item,
                status: 'processing' as const,
                error: undefined,
                resultUrl: undefined,
                outputPath: undefined,
              }
            : item
        )
      );

      try {
        const result = await invoke<UpscaleResult>('image_ai_upscale', {
          inputPath: file.path,
          modelDir,
          options: {
            scale,
            modelName: useCustomModel ? 'custom' : modelName,
            outputFormat,
            tileSize,
            tta,
            customModelDir: useCustomModel ? customModelDir : null,
            customModelName: useCustomModel ? customModelName : null,
          },
        });
        setFiles((prev) =>
          prev.map((item) =>
            item.id === file.id
              ? {
                  ...item,
                  status: 'done' as const,
                  outputPath: result.outputPath,
                  resultUrl: convertFileSrc(result.outputPath),
                  inputWidth: result.inputWidth,
                  inputHeight: result.inputHeight,
                  outputWidth: result.outputWidth,
                  outputHeight: result.outputHeight,
                  inputSize: result.inputSize,
                  outputSize: result.outputSize,
                }
              : item
          )
        );
      } catch (error) {
        const message = getErrorMessage(error, 'AI 图像放大失败');
        setTaskError(message);
        setFiles((prev) =>
          prev.map((item) =>
            item.id === file.id ? { ...item, status: 'error' as const, error: message } : item
          )
        );
      }
    }

    setProcessing(false);
  };

  const saveResult = async (file: FileItem) => {
    if (!file.outputPath) return;
    const extension = getExtension(file.outputPath);
    const outputPath = await save({
      defaultPath: outputNameFor(file),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!outputPath) return;
    await invoke('copy_ai_upscale_output', { sourcePath: file.outputPath, outputPath });
  };

  const saveAll = async () => {
    const doneFiles = files.filter((file) => file.status === 'done' && file.outputPath);
    if (doneFiles.length === 0) return;
    const dir = await open({ directory: true, multiple: false });
    if (!dir || typeof dir !== 'string') return;

    for (const file of doneFiles) {
      await invoke('copy_ai_upscale_output', {
        sourcePath: file.outputPath,
        outputPath: joinPath(dir, outputNameFor(file)),
      });
    }
  };

  if (!ready) return null;

  const doneCount = files.filter((file) => file.status === 'done').length;
  const pendingCount = files.filter(
    (file) => file.status === 'pending' || file.status === 'error'
  ).length;
  const runningCount = files.filter((file) => file.status === 'processing').length;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="🔍"
        title="AI 图像放大增强"
        subtitle={runtimeStatus === 'ready' ? 'Real-ESRGAN NCNN/Vulkan · 本地超分' : undefined}
        actions={
          <button
            onClick={() => setShowSettings((value) => !value)}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <Settings size={15} />
          </button>
        }
      />

      {showSettings && (
        <div className="flex-shrink-0 space-y-2 border-b border-blue-100 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/20">
          <p className="text-xs font-medium text-blue-700 dark:text-blue-300">AI 运行时存储目录</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customDirInput}
              onChange={(event) => setCustomDirInput(event.target.value)}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
            />
            <button
              onClick={handleSelectModelDir}
              className="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              <FolderOpen size={13} />
              浏览
            </button>
            <button
              onClick={handleSaveModelDir}
              className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-600"
            >
              保存
            </button>
          </div>
          <p className="text-[10px] text-blue-500 dark:text-blue-400">
            Real-ESRGAN NCNN/Vulkan 运行时约 {RUNTIME_SIZE_MB}MB，下载后会缓存到本地。
          </p>
        </div>
      )}

      {(runtimeStatus === 'missing' ||
        runtimeStatus === 'downloading' ||
        runtimeStatus === 'error') && (
        <div className="flex-shrink-0 border-b border-gray-200 bg-white px-4 py-4 dark:border-gray-700 dark:bg-gray-800">
          {runtimeStatus === 'missing' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Info size={18} className="mt-0.5 flex-shrink-0 text-blue-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium">需要下载 Real-ESRGAN NCNN/Vulkan 运行时</p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    包含本地 upscaler 可执行文件和官方 NCNN 模型，处理过程不上传图片。
                  </p>
                  {runtimeError && (
                    <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">
                      缺少：{runtimeError}
                    </p>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="max-w-xs truncate text-xs text-gray-400">存储位置：{modelDir}</span>
                    <button
                      onClick={() => setShowSettings(true)}
                      className="flex-shrink-0 text-xs text-blue-500 underline hover:text-blue-600"
                    >
                      修改
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={handleDownloadRuntime}
                className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              >
                <Download size={15} />
                下载运行时（约 {RUNTIME_SIZE_MB}MB）
              </button>
            </div>
          )}

          {runtimeStatus === 'downloading' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader size={15} className="animate-spin text-blue-500" />
                  <span className="text-sm font-medium">准备 Real-ESRGAN 运行时...</span>
                </div>
                <span className="text-sm font-medium text-blue-500">{downloadProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              {downloadFile && <p className="truncate text-[11px] text-gray-400">{downloadFile}</p>}
            </div>
          )}

          {runtimeStatus === 'error' && (
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-red-500" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">运行时不可用</p>
                <p className="mt-0.5 break-all text-xs text-gray-500 dark:text-gray-400">
                  {runtimeError}
                </p>
                <button
                  onClick={handleDownloadRuntime}
                  className="mt-2 flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-600"
                >
                  <RefreshCw size={12} />
                  重试下载
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {runtimeStatus === 'checking' && (
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3 text-xs text-gray-400 dark:border-gray-700 dark:bg-gray-800">
          <Loader size={14} className="animate-spin" />
          检查 Real-ESRGAN 运行时...
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col p-4">
          {files.length === 0 ? (
            <button
              onClick={handleSelectFiles}
              className="flex h-full min-h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-blue-900/10"
            >
              <Upload size={34} className="mb-3 text-gray-400" />
              <p className="text-sm text-gray-500 dark:text-gray-400">点击选择图片</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                支持 PNG / JPG / WebP，可多选批量增强
              </p>
            </button>
          ) : (
            <div
              className="grid flex-1 content-start gap-3 overflow-y-auto"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}
            >
              {files.map((file) => (
                <FilePreviewItem
                  key={file.id}
                  file={file}
                  onRemove={() => setFiles((prev) => prev.filter((item) => item.id !== file.id))}
                  onSave={() => saveResult(file)}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">放大倍数</div>
              <div className="grid grid-cols-3 gap-2">
                {SCALE_OPTIONS.map((item) => (
                  <button
                    key={item}
                    onClick={() => setScale(item)}
                    className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                      scale === item
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {item}x
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">模型</span>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={useCustomModel}
                    onChange={(event) => setUseCustomModel(event.target.checked)}
                    className="h-3.5 w-3.5 accent-blue-500"
                  />
                  自定义
                </label>
              </div>

              {!useCustomModel ? (
                <div className="space-y-2">
                  {MODEL_OPTIONS.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => setModelName(model.id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                        modelName === model.id
                          ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/25 dark:text-blue-200'
                          : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:bg-gray-700'
                      }`}
                    >
                      <div className="text-sm font-medium">{model.label}</div>
                      <div className="mt-0.5 text-[11px] opacity-75">{model.desc}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customModelDir}
                      onChange={(event) => setCustomModelDir(event.target.value)}
                      placeholder="模型目录"
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-800"
                    />
                    <button
                      onClick={handleSelectCustomModelDir}
                      className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
                    >
                      浏览
                    </button>
                  </div>
                  <input
                    type="text"
                    value={customModelName}
                    onChange={(event) => setCustomModelName(event.target.value)}
                    placeholder="模型名，不含 .param/.bin"
                    className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-800"
                  />
                  <p className="text-[10px] text-gray-400">目录中需包含同名 .param 和 .bin 文件。</p>
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">输出格式</div>
              <div className="grid grid-cols-3 gap-2">
                {FORMAT_OPTIONS.map((format) => (
                  <button
                    key={format}
                    onClick={() => setOutputFormat(format)}
                    className={`rounded-lg px-3 py-2 text-xs uppercase transition-colors ${
                      outputFormat === format
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {format}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">Tile 尺寸</div>
              <select
                value={tileSize}
                onChange={(event) => setTileSize(Number(event.target.value))}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-900"
              >
                {TILE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-900/60">
              <span className="flex items-center gap-2">
                <Sparkles size={15} className="text-blue-500" />
                TTA 精细增强
              </span>
              <input
                type="checkbox"
                checked={tta}
                onChange={(event) => setTta(event.target.checked)}
                className="h-4 w-4 accent-blue-500"
              />
            </label>

            {runtimeInfo && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                  {runtimeStatus === 'ready' ? (
                    <CheckCircle size={14} className="text-green-500" />
                  ) : (
                    <Info size={14} className="text-blue-500" />
                  )}
                  Real-ESRGAN {runtimeInfo.version}
                </div>
                <div className="space-y-1 text-[11px] text-gray-400">
                  <p>平台：{runtimeInfo.platform}</p>
                  <p className="truncate">运行时：{runtimeInfo.runtimeDir}</p>
                  {runtimeInfo.modelsPath && <p className="truncate">模型：{runtimeInfo.modelsPath}</p>}
                </div>
              </div>
            )}

            {taskError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {taskError}
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="flex flex-shrink-0 items-center gap-3 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <button
          onClick={handleSelectFiles}
          className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
        >
          <Upload size={14} />
          添加图片
        </button>
        {files.length > 0 && !processing && (
          <button
            onClick={() => setFiles([])}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
          >
            <X size={14} />
            清空
          </button>
        )}
        <div className="flex-1" />
        {files.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            {pendingCount > 0 && <span>{pendingCount} 待处理</span>}
            {runningCount > 0 && <span className="text-blue-500">{runningCount} 处理中</span>}
            {doneCount > 0 && <span className="text-green-500">✓ {doneCount} 完成</span>}
          </div>
        )}
        {doneCount > 1 && !processing && (
          <button
            onClick={saveAll}
            className="flex items-center gap-1.5 rounded-lg bg-green-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-green-600"
          >
            <Download size={14} />
            保存全部
          </button>
        )}
        <button
          onClick={handleProcess}
          disabled={runtimeStatus !== 'ready' || pendingCount === 0 || processing}
          className="flex items-center gap-2 rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-600"
        >
          {processing ? (
            <>
              <Loader size={14} className="animate-spin" />
              处理中...
            </>
          ) : (
            <>
              <Sparkles size={14} />
              开始放大增强
            </>
          )}
        </button>
      </div>
    </div>
  );
}
