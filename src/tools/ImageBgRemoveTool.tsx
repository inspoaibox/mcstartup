import { useState, useEffect } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/tauri';
import { open, save } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  Upload,
  Download,
  FolderOpen,
  Settings,
  Loader,
  CheckCircle,
  AlertCircle,
  X,
  RefreshCw,
  Info,
} from 'lucide-react';

type ModelStatus = 'unknown' | 'checking' | 'missing' | 'downloading' | 'ready' | 'error';

interface FileItem {
  id: string;
  path: string;
  name: string;
  originalUrl: string;
  resultUrl?: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

interface BgRemoveResult {
  inputPath: string;
  dataUrl?: string | null;
  error?: string | null;
}

type CleanupMode = 'soft' | 'standard' | 'clean' | 'logo';

const CLEANUP_MODES: Record<
  CleanupMode,
  {
    title: string;
    description: string;
    alphaThreshold: number;
    foregroundThreshold: number;
    decontaminateEdges: boolean;
  }
> = {
  soft: {
    title: '精细边缘',
    description: '保留发丝、毛边和半透明细节',
    alphaThreshold: 4,
    foregroundThreshold: 252,
    decontaminateEdges: false,
  },
  standard: {
    title: '通用干净',
    description: '适合大多数商品、人像和普通图片',
    alphaThreshold: 12,
    foregroundThreshold: 240,
    decontaminateEdges: true,
  },
  clean: {
    title: '强力清理',
    description: '减少浅色底、灰边和残留阴影',
    alphaThreshold: 28,
    foregroundThreshold: 220,
    decontaminateEdges: true,
  },
  logo: {
    title: 'Logo/文字',
    description: '适合白底图标、文字、印章和品牌标识',
    alphaThreshold: 48,
    foregroundThreshold: 185,
    decontaminateEdges: true,
  },
};

const MODEL_REPO_ID = 'onnx-community/BiRefNet_lite-ONNX';
const HF_BASE = `https://huggingface.co/${MODEL_REPO_ID}/resolve/main`;
const COMMON_MODEL_FILES = ['config.json', 'preprocessor_config.json'];
const DOWNLOAD_MODEL_FILES = [...COMMON_MODEL_FILES, 'onnx/model_fp16.onnx', 'onnx/model.onnx'];
const MODEL_SIZE_MB = 340;
const RUNTIME_LABEL = 'Rust · ONNX Runtime';

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

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div 
        className="relative aspect-square bg-gray-100 dark:bg-gray-700 overflow-hidden touch-none select-none"
        onPointerDown={(e) => {
          if (!file.resultUrl) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
          setSliderPos((x / rect.width) * 100);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!file.resultUrl || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
          setSliderPos((x / rect.width) * 100);
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
          }}
        />
        <img
          src={file.originalUrl}
          alt="原图"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
          style={{ clipPath: file.resultUrl ? `inset(0 ${100 - sliderPos}% 0 0)` : 'none' }}
          draggable={false}
        />
        {file.resultUrl && (
          <>
            <img
              src={file.resultUrl}
              alt="抠图"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
              style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
              draggable={false}
            />
            <div 
              className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_5px_rgba(0,0,0,0.5)] cursor-col-resize flex items-center justify-center z-10"
              style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md text-gray-500">
                <div className="flex gap-0.5">
                  <div className="h-2 w-px bg-gray-400" />
                  <div className="h-2 w-px bg-gray-400" />
                </div>
              </div>
            </div>
            <span className="absolute bottom-2 left-2 text-[9px] bg-black/50 text-white px-1.5 py-0.5 rounded z-20 pointer-events-none">
              原图
            </span>
            <span className="absolute bottom-2 right-2 text-[9px] bg-green-500/80 text-white px-1.5 py-0.5 rounded z-20 pointer-events-none">
              抠图
            </span>
          </>
        )}
        {file.status === 'processing' && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-30">
            <div className="flex flex-col items-center gap-2">
              <Loader size={24} className="animate-spin text-white" />
              <span className="text-white text-xs">AI 处理中...</span>
            </div>
          </div>
        )}
        {file.status === 'done' && (
          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center shadow z-30">
            <CheckCircle size={14} className="text-white" />
          </div>
        )}
        {file.status === 'error' && (
          <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center z-30">
            <AlertCircle size={24} className="text-red-500" />
          </div>
        )}
        <button
          onClick={onRemove}
          className="absolute top-2 left-2 w-5 h-5 rounded-full bg-black/40 hover:bg-red-500 text-white flex items-center justify-center transition-colors z-30"
        >
          <X size={10} />
        </button>
      </div>
      <div className="px-2.5 py-2">
        <p className="text-xs font-medium truncate text-gray-700 dark:text-gray-300">
          {file.name}
        </p>
        {file.status === 'error' && (
          <p className="text-[10px] text-red-500 truncate mt-0.5">{file.error}</p>
        )}
        {file.status === 'done' && (
          <button
            onClick={onSave}
            className="mt-1.5 w-full flex items-center justify-center gap-1 py-1 text-[11px] bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 rounded-lg transition-colors"
          >
            <Download size={11} />
            保存 PNG
          </button>
        )}
      </div>
    </div>
  );
}

export default function ImageBgRemoveTool() {
  const ready = useToolTheme();
  const [modelDir, setModelDir] = useState('');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('unknown');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadFile, setDownloadFile] = useState('');
  const [processing, setProcessing] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [customDirInput, setCustomDirInput] = useState('');
  const [modelError, setModelError] = useState('');
  const [cleanupMode, setCleanupMode] = useState<CleanupMode>('standard');

  useEffect(() => {
    const init = async () => {
      setModelStatus('checking');
      try {
        const customDir = await invoke<string | null>('get_custom_model_dir');
        const defaultDir = await invoke<string>('get_model_dir');
        const dir = customDir || defaultDir;
        setModelDir(dir);
        setCustomDirInput(dir);
        const allExist = await checkAllFiles(dir);
        if (allExist) {
          setModelStatus('ready');
          setModelError('');
        } else {
          setModelStatus('missing');
        }
      } catch (e: any) {
        setModelStatus('error');
        setModelError(e.message || '初始化失败');
      }
    };
    init();
  }, []);

  const checkAllFiles = async (dir: string) => {
    for (const f of DOWNLOAD_MODEL_FILES) {
      const exists = await invoke<boolean>('check_model_exists', {
        modelDir: dir,
        modelName: `${MODEL_REPO_ID}/${f}`,
      });
      if (!exists) return false;
    }
    return true;
  };

  const handleDownload = async () => {
    setModelStatus('downloading');
    setDownloadProgress(0);
    setDownloadFile('');
    setModelError('');
    let doneFiles = 0;
    const totalFiles = DOWNLOAD_MODEL_FILES.length;
    const unlisten = await listen<any>('model-download-progress', (e) => {
      const { loaded, total, done, file } = e.payload;
      setDownloadFile((file as string).split(/[/\\]/).pop() || file);
      const fileProgress = total > 0 ? loaded / total : 0;
      const overall = ((doneFiles + fileProgress) / totalFiles) * 100;
      setDownloadProgress(Math.round(overall));
      if (done) doneFiles++;
    });
    try {
      for (const f of DOWNLOAD_MODEL_FILES) {
        const destPath = modelDir.replace(/\\/g, '/') + '/' + MODEL_REPO_ID + '/' + f;
        const url = HF_BASE + '/' + f;
        await invoke('download_model_file', { url, destPath });
      }
      setModelStatus('ready');
      setModelError('');
    } catch (e: any) {
      setModelStatus('error');
      setModelError(e.message || '下载失败，请检查网络连接');
    } finally {
      unlisten();
    }
  };

  const handleSelectFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const newItems: FileItem[] = await Promise.all(
      paths.map(async (p) => {
        const originalUrl = convertFileSrc(p);
        return {
          id: Math.random().toString(36).slice(2),
          path: p,
          name: p.split(/[/\\]/).pop() || p,
          originalUrl,
          status: 'pending' as const,
        };
      })
    );
    setFiles((prev) => [...prev, ...newItems]);
  };

  const handleProcess = async () => {
    if (modelStatus !== 'ready' || processing) return;
    setProcessing(true);
    const pending = files.filter((f) => f.status === 'pending');
    if (pending.length === 0) {
      setProcessing(false);
      return;
    }

    setFiles((prev) =>
      prev.map((f) =>
        pending.some((item) => item.id === f.id) ? { ...f, status: 'processing' as const } : f
      )
    );

    try {
      const cleanup = CLEANUP_MODES[cleanupMode];
      const results = await invoke<BgRemoveResult[]>('image_bg_remove_batch', {
        inputPaths: pending.map((file) => file.path),
        modelDir,
        options: {
          cleanupMode,
          alphaThreshold: cleanup.alphaThreshold,
          foregroundThreshold: cleanup.foregroundThreshold,
          decontaminateEdges: cleanup.decontaminateEdges,
        },
      });
      const resultMap = new Map(results.map((item) => [item.inputPath, item]));
      for (const file of pending) {
        const result = resultMap.get(file.path);
        setFiles((prev) =>
          prev.map((f) => {
            if (f.id !== file.id) return f;
            if (result?.dataUrl) {
              return { ...f, status: 'done' as const, resultUrl: result.dataUrl };
            }
            return {
              ...f,
              status: 'error' as const,
              error: result?.error || '抠图失败',
            };
          })
        );
      }
    } catch (e: any) {
      const message = e?.message || '抠图失败';
      setFiles((prev) =>
        prev.map((f) =>
          pending.some((item) => item.id === f.id)
            ? { ...f, status: 'error' as const, error: message }
            : f
        )
      );
    } finally {
      setProcessing(false);
    }
  };

  const saveResult = async (file: FileItem) => {
    if (!file.resultUrl) return;
    const stem = file.name.replace(/\.[^.]+$/, '');
    const outPath = await save({
      defaultPath: stem + '_nobg.png',
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (!outPath) return;
    await invoke('save_base64_image', { base64Data: file.resultUrl, outputPath: outPath });
  };

  const saveAll = async () => {
    for (const f of files.filter((f) => f.status === 'done' && f.resultUrl)) await saveResult(f);
  };

  const handleSelectModelDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir && typeof dir === 'string') setCustomDirInput(dir);
  };

  const handleSaveModelDir = async () => {
    await invoke('set_model_dir', { path: customDirInput });
    setModelDir(customDirInput);
    setShowSettings(false);
    const allExist = await checkAllFiles(customDirInput);
    if (allExist) {
      setModelStatus('ready');
      setModelError('');
    } else {
      setModelStatus('missing');
    }
  };

  if (!ready) return null;
  const doneCount = files.filter((f) => f.status === 'done').length;
  const pendingCount = files.filter((f) => f.status === 'pending').length;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="✂️"
        title="AI 智能抠图"
        subtitle={modelStatus === 'ready' ? `BiRefNet_lite · ${RUNTIME_LABEL}` : undefined}
        actions={
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <Settings size={15} />
          </button>
        }
      />

      {showSettings && (
        <div className="flex-shrink-0 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800 space-y-2">
          <p className="text-xs font-medium text-blue-700 dark:text-blue-300">模型存储目录</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customDirInput}
              onChange={(e) => setCustomDirInput(e.target.value)}
              className="flex-1 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={handleSelectModelDir}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              <FolderOpen size={13} />
              浏览
            </button>
            <button
              onClick={handleSaveModelDir}
              className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            >
              保存
            </button>
          </div>
          <p className="text-[10px] text-blue-500 dark:text-blue-400">
            模型约 {MODEL_SIZE_MB}MB，建议选择空间充足的目录。修改后需重新下载模型。
          </p>
        </div>
      )}

      {(modelStatus === 'missing' || modelStatus === 'downloading' || modelStatus === 'error') && (
        <div className="flex-shrink-0 px-4 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          {modelStatus === 'missing' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Info size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">需要下载 AI 模型</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    BiRefNet_lite 模型（约 {MODEL_SIZE_MB}MB），下载后永久缓存到本地，无需重复下载
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-gray-400 truncate max-w-xs">
                      存储位置：{modelDir}
                    </span>
                    <button
                      onClick={() => setShowSettings(true)}
                      className="text-xs text-blue-500 hover:text-blue-600 underline flex-shrink-0"
                    >
                      修改
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Download size={15} />
                下载模型（{MODEL_SIZE_MB}MB）
              </button>
            </div>
          )}
          {modelStatus === 'downloading' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader size={15} className="animate-spin text-blue-500" />
                  <span className="text-sm font-medium">
                    {downloadProgress === 0 ? '初始化模型...' : '下载模型中...'}
                  </span>
                </div>
                <span className="text-sm font-medium text-blue-500">{downloadProgress}%</span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: downloadProgress + '%' }}
                />
              </div>
              {downloadFile && <p className="text-[11px] text-gray-400 truncate">{downloadFile}</p>}
              <p className="text-[11px] text-gray-400">下载完成后自动缓存，下次启动无需重新下载</p>
            </div>
          )}
          {modelStatus === 'error' && (
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">模型加载失败</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-all">
                  {modelError}
                </p>
                <button
                  onClick={handleDownload}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
                >
                  <RefreshCw size={12} />
                  重试
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {modelStatus === 'checking' && (
        <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 text-gray-400">
          <Loader size={14} className="animate-spin" />
          <span className="text-xs">检查模型状态...</span>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">边缘清理</p>
              <p className="mt-0.5 text-[11px] text-gray-400">
                Logo、文字或白底图残留明显时，建议使用 Logo/文字 或 强力清理。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(Object.keys(CLEANUP_MODES) as CleanupMode[]).map((mode) => {
              const item = CLEANUP_MODES[mode];
              const active = cleanupMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setCleanupMode(mode)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/25 dark:text-blue-200'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <span className="block text-xs font-semibold">{item.title}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 opacity-75">
                    {item.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {files.length === 0 ? (
          <div
            onClick={handleSelectFiles}
            className="h-full min-h-48 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
          >
            <Upload size={32} className="text-gray-400 mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">点击选择图片</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              支持 PNG / JPG / WebP，可多选
            </p>
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}
          >
            {files.map((file) => (
              <FilePreviewItem 
                key={file.id} 
                file={file} 
                onRemove={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
                onSave={() => saveResult(file)} 
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
        <button
          onClick={handleSelectFiles}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
        >
          <Upload size={14} />
          添加图片
        </button>
        {files.length > 0 && !processing && (
          <button
            onClick={() => setFiles([])}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <X size={14} />
            清空
          </button>
        )}
        <div className="flex-1" />
        {files.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            {pendingCount > 0 && <span>{pendingCount} 待处理</span>}
            {processing && <span className="text-blue-500">处理中...</span>}
            {doneCount > 0 && <span className="text-green-500">✓ {doneCount} 完成</span>}
          </div>
        )}
        {doneCount > 1 && !processing && (
          <button
            onClick={saveAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
          >
            <Download size={14} />
            保存全部
          </button>
        )}
        <button
          onClick={handleProcess}
          disabled={modelStatus !== 'ready' || pendingCount === 0 || processing}
          className="flex items-center gap-2 px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
        >
          {processing ? (
            <>
              <Loader size={14} className="animate-spin" />
              处理中...
            </>
          ) : (
            <>开始抠图</>
          )}
        </button>
      </div>
    </div>
  );
}
