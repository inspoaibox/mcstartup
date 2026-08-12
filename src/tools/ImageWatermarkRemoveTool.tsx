import { useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { open, save } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  AlertCircle,
  CheckCircle,
  Download,
  Eraser,
  Eye,
  FolderOpen,
  Info,
  Loader,
  Pencil,
  RefreshCw,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
} from 'lucide-react';

type Mode = 'auto' | 'manual';
type ModelStatus = 'unknown' | 'checking' | 'missing' | 'downloading' | 'ready' | 'error';
type BrushMode = 'paint' | 'erase';
type AutoSensitivity = 'conservative' | 'balanced' | 'aggressive';

interface ManualResult {
  dataUrl: string;
}

interface AutoMaskComponent {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  ratio: number;
}

interface AutoMaskResult {
  maskDataUrl: string;
  coverage: number;
  modelsUsed: string[];
  width: number;
  height: number;
  components: AutoMaskComponent[];
  warnings: string[];
}

const MODEL_FILES = [
  {
    label: '自动分割模型 - 居中文字水印',
    modelName: 'ai-watermark-remove/auto/segmenter_centered_text.pth',
    url: 'https://huggingface.co/christophernavas/watermark-remover/resolve/main/segmenter_centered_text.pth',
  },
  {
    label: '自动分割模型 - 重复文字水印',
    modelName: 'ai-watermark-remove/auto/segmenter_repeated_text.pth',
    url: 'https://huggingface.co/christophernavas/watermark-remover/resolve/main/segmenter_repeated_text.pth',
  },
  {
    label: '自动分割模型 - Logo 水印',
    modelName: 'ai-watermark-remove/auto/segmenter_logo.pth',
    url: 'https://huggingface.co/christophernavas/watermark-remover/resolve/main/segmenter_logo.pth',
  },
  {
    label: '自动分割模型 - 覆盖文字水印',
    modelName: 'ai-watermark-remove/auto/segmenter_overlay_text.pth',
    url: 'https://huggingface.co/christophernavas/watermark-remover/resolve/main/segmenter_overlay_text.pth',
  },
  {
    label: '自动分割模型 - 小角标水印',
    modelName: 'ai-watermark-remove/auto/segmenter_tiny_corner.pth',
    url: 'https://huggingface.co/christophernavas/watermark-remover/resolve/main/segmenter_tiny_corner.pth',
  },
  {
    label: '自动分割模型 - 线性/平铺水印',
    modelName: 'ai-watermark-remove/auto/segmenter_line_pattern.pth',
    url: 'https://huggingface.co/christophernavas/watermark-remover/resolve/main/segmenter_line_pattern.pth',
  },
  {
    label: '自动分割模型 - 通用兜底',
    modelName: 'ai-watermark-remove/auto/segmenter_universal.pth',
    url: 'https://huggingface.co/christophernavas/watermark-remover/resolve/main/segmenter_universal.pth',
  },
  {
    label: 'LaMa 修复模型（自动/手动共用）',
    modelName: 'ai-watermark-remove/manual/lama_fp32.onnx',
    url: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
  },
] as const;

const MODEL_SIZE_MB = 780;
const MODE_LABELS: Record<Mode, string> = {
  auto: '智能自动',
  manual: '手动标注',
};
const AUTO_SENSITIVITY_LABELS: Record<AutoSensitivity, string> = {
  conservative: '保守',
  balanced: '均衡',
  aggressive: '强力',
};

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export default function ImageWatermarkRemoveTool() {
  const ready = useToolTheme();
  const [mode, setMode] = useState<Mode>('auto');
  const [modelsValidated, setModelsValidated] = useState(false);
  const [modelDir, setModelDir] = useState('');
  const [customDirInput, setCustomDirInput] = useState('');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('unknown');
  const [modelError, setModelError] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadFile, setDownloadFile] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showManualDownloadGuide, setShowManualDownloadGuide] = useState(false);
  const [copyHint, setCopyHint] = useState('');
  const [inputPath, setInputPath] = useState('');
  const [inputName, setInputName] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [processing, setProcessing] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [autoMask, setAutoMask] = useState<AutoMaskResult | null>(null);
  const [autoSensitivity, setAutoSensitivity] = useState<AutoSensitivity>('balanced');
  const [autoMaskDilate, setAutoMaskDilate] = useState(2);
  const [autoMaxMaskRatio, setAutoMaxMaskRatio] = useState(35);
  const [autoEdgeFilter, setAutoEdgeFilter] = useState(true);
  const [autoMaskOpacity, setAutoMaskOpacity] = useState(55);
  const [brushMode, setBrushMode] = useState<BrushMode>('paint');
  const [brushSize, setBrushSize] = useState(28);
  const [showMaskHint, setShowMaskHint] = useState(true);
  const [sliderPos, setSliderPos] = useState(50);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const manualDownloadRoot = `${modelDir.replace(/\//g, '\\')}\\ai-watermark-remove`;

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
          setModelsValidated(false);
        } else {
          setModelStatus('missing');
          setModelError('自动分割模型或 LaMa 修复模型未下载完整');
          setModelsValidated(false);
        }
      } catch (e: any) {
        setModelStatus('error');
        setModelError(getErrorMessage(e, '初始化失败'));
        setModelsValidated(false);
      }
    };
    init();
  }, []);

  const checkAllFiles = async (dir: string) => {
    for (const file of MODEL_FILES) {
      const exists = await invoke<boolean>('check_model_exists', {
        modelDir: dir,
        modelName: file.modelName,
      });
      if (!exists) return false;
    }
    return true;
  };

  const validateModels = async (dir: string) => {
    const allExist = await checkAllFiles(dir);
    if (!allExist) {
      return '自动分割模型或 LaMa 修复模型未下载完整';
    }
    try {
      await invoke('validate_watermark_auto_models', { modelDir: dir });
      return '';
    } catch (e) {
      return getErrorMessage(e, '模型校验失败');
    }
  };

  const handleDownloadModels = async () => {
    setModelStatus('downloading');
    setModelError('');
    setDownloadProgress(0);
    setDownloadFile('');
    let doneFiles = 0;
    const totalFiles = MODEL_FILES.length;

    const unlisten = await listen<any>('model-download-progress', (event) => {
      const { loaded, total, done, file } = event.payload;
      setDownloadFile((file as string).split(/[/\\]/).pop() || file);
      const fileProgress = total > 0 ? loaded / total : 0;
      const overall = ((doneFiles + fileProgress) / totalFiles) * 100;
      setDownloadProgress(Math.round(overall));
      if (done) doneFiles++;
    });

    try {
      for (const file of MODEL_FILES) {
        const destPath = `${modelDir.replace(/\\/g, '/')}/${file.modelName}`;
        await invoke('download_model_file', { url: file.url, destPath, overwrite: true });
      }
      const validationError = await validateModels(modelDir);
      if (validationError) {
        setModelStatus('error');
        setModelError(validationError);
        setModelsValidated(false);
      } else {
        setModelStatus('ready');
        setModelError('');
        setModelsValidated(true);
      }
    } catch (e) {
      setModelStatus('error');
      setModelError(getErrorMessage(e, '模型下载失败，请检查网络连接'));
      setModelsValidated(false);
    } finally {
      unlisten();
    }
  };

  const handleSelectImage = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    });
    if (!selected || typeof selected !== 'string') return;

    setInputPath(selected);
    setInputName(selected.split(/[/\\]/).pop() || selected);
    setOriginalUrl(convertFileSrc(selected));
    setResultUrl('');
    setTaskError('');
    setAutoMask(null);
    clearMask();
  };

  const handleSaveModelDir = async () => {
    await invoke('set_model_dir', { path: customDirInput });
    setModelDir(customDirInput);
    setShowSettings(false);
    const validationError = await validateModels(customDirInput);
    if (!validationError) {
      setModelStatus('ready');
      setModelError('');
      setModelsValidated(true);
    } else {
      setModelStatus('missing');
      setModelError(validationError);
      setModelsValidated(false);
    }
  };

  const handleSelectModelDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir && typeof dir === 'string') setCustomDirInput(dir);
  };

  const handleCopyManualGuide = async () => {
    const content = [
      'AI 智能去水印 - 手动下载模型说明',
      '',
      `模型根目录：${manualDownloadRoot}`,
      '',
      ...MODEL_FILES.flatMap((file, index) => [
        `${index + 1}. ${file.label}`,
        `下载链接：${file.url}`,
        `保存位置：${modelDir.replace(/\//g, '\\')}\\${file.modelName.replace(/\//g, '\\')}`,
        '',
      ]),
      '下载完成后回到工具窗口，点击“重试”即可重新检测模型。',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(content);
      setCopyHint('说明已复制');
      window.setTimeout(() => setCopyHint(''), 2000);
    } catch {
      setCopyHint('复制失败，请手动复制');
      window.setTimeout(() => setCopyHint(''), 2000);
    }
  };

  const handleOpenModelDir = async () => {
    await invoke('open_path', { targetPath: modelDir });
  };

  const setupMaskCanvas = () => {
    const img = imageRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setShowMaskHint(true);
  };

  const clearMask = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setShowMaskHint(true);
  };

  const canvasPointFromEvent = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((clientX - rect.left) * canvas.width) / rect.width,
      y: ((clientY - rect.top) * canvas.height) / rect.height,
      scale: canvas.width / rect.width,
    };
  };

  const drawSegment = (
    from: { x: number; y: number; scale: number },
    to: { x: number; y: number; scale: number }
  ) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const width = Math.max(4, brushSize * from.scale);
    ctx.save();
    ctx.globalCompositeOperation = brushMode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.42)';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
    setShowMaskHint(false);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'manual' || resultUrl) return;
    const point = canvasPointFromEvent(e.clientX, e.clientY);
    if (!point) return;
    drawingRef.current = true;
    lastPointRef.current = point;
    drawSegment(point, point);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || mode !== 'manual' || resultUrl) return;
    const point = canvasPointFromEvent(e.clientX, e.clientY);
    const lastPoint = lastPointRef.current;
    if (!point || !lastPoint) return;
    drawSegment(lastPoint, point);
    lastPointRef.current = point;
  };

  const stopDrawing = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const exportMaskDataUrl = () => {
    const source = canvasRef.current;
    if (!source) return '';
    const srcCtx = source.getContext('2d');
    if (!srcCtx) return '';
    const { width, height } = source;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return '';

    const imageData = srcCtx.getImageData(0, 0, width, height);
    const out = maskCtx.createImageData(width, height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const alpha = imageData.data[i + 3];
      const value = alpha > 8 ? 255 : 0;
      out.data[i] = value;
      out.data[i + 1] = value;
      out.data[i + 2] = value;
      out.data[i + 3] = 255;
    }
    maskCtx.putImageData(out, 0, 0);
    return maskCanvas.toDataURL('image/png');
  };

  const hasMaskPixels = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return false;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < imageData.length; i += 4) {
      if (imageData[i] > 8) return true;
    }
    return false;
  };

  const ensureModelsValidated = async () => {
    if (modelsValidated) return;
    const validationError = await validateModels(modelDir);
    if (validationError) {
      setModelStatus('error');
      setModelError(validationError);
      setModelsValidated(false);
      throw new Error(validationError);
    }
    setModelsValidated(true);
  };

  const getAutoOptions = () => ({
    sensitivity: autoSensitivity,
    maskDilate: autoMaskDilate,
    maxMaskRatio: autoMaxMaskRatio / 100,
    edgeFilter: autoEdgeFilter,
  });

  const handleAutoDetect = async () => {
    if (!inputPath || modelStatus !== 'ready' || processing) return;
    setProcessing(true);
    setTaskError('');
    setResultUrl('');
    try {
      await ensureModelsValidated();
      const result = await invoke<AutoMaskResult>('image_watermark_auto_detect', {
        inputPath,
        modelDir,
        options: getAutoOptions(),
      });
      setAutoMask(result);
      if (!result.components.length || result.coverage <= 0) {
        setTaskError('未识别到可靠水印区域，可以切换到强力模式或使用手动标注。');
      }
    } catch (e) {
      setAutoMask(null);
      setTaskError(getErrorMessage(e, '智能识别水印区域失败'));
    } finally {
      setProcessing(false);
    }
  };

  const handleAutoOneClick = async () => {
    if (!inputPath || modelStatus !== 'ready' || processing) return;
    setProcessing(true);
    setTaskError('');
    setResultUrl('');
    try {
      await ensureModelsValidated();
      const result = await invoke<ManualResult>('image_watermark_auto_remove', {
        inputPath,
        modelDir,
        options: getAutoOptions(),
      });
      setResultUrl(result.dataUrl);
    } catch (e) {
      setTaskError(getErrorMessage(e, '智能自动去水印失败'));
    } finally {
      setProcessing(false);
    }
  };

  const handleAutoRepair = async () => {
    if (!inputPath || !autoMask || modelStatus !== 'ready' || processing) return;
    if (!autoMask.components.length || autoMask.coverage <= 0) {
      setTaskError('当前遮罩为空，请重新识别或切换手动标注。');
      return;
    }
    setProcessing(true);
    setTaskError('');
    try {
      await ensureModelsValidated();
      const result = await invoke<ManualResult>('image_watermark_repair_with_mask', {
        inputPath,
        maskDataUrl: autoMask.maskDataUrl,
        modelDir,
      });
      setResultUrl(result.dataUrl);
    } catch (e) {
      setTaskError(getErrorMessage(e, '按自动遮罩去水印失败'));
    } finally {
      setProcessing(false);
    }
  };

  const handleManualRepair = async () => {
    if (!inputPath || modelStatus !== 'ready' || processing) return;
    setProcessing(true);
    setTaskError('');
    try {
      await ensureModelsValidated();
      if (!hasMaskPixels()) {
        throw new Error('请先在图片上涂抹需要去除的水印区域');
      }
      const result = await invoke<ManualResult>('image_watermark_manual_remove', {
        inputPath,
        maskDataUrl: exportMaskDataUrl(),
        modelDir,
      });
      setResultUrl(result.dataUrl);
    } catch (e) {
      setTaskError(getErrorMessage(e, '去水印失败'));
    } finally {
      setProcessing(false);
    }
  };

  const handleProcess = async () => {
    if (mode === 'auto') {
      await handleAutoOneClick();
      return;
    }
    await handleManualRepair();
  };

  const saveResult = async () => {
    if (!resultUrl || !inputName) return;
    const stem = inputName.replace(/\.[^.]+$/, '');
    const outputPath = await save({
      defaultPath: `${stem}_dewatermarked.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (!outputPath) return;
    await invoke('save_base64_image', { base64Data: resultUrl, outputPath });
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="🧼"
        title="AI 智能去水印"
        subtitle={modelStatus === 'ready' ? `自动分割 + LaMa 修复 · 手动标注保持本地修复` : undefined}
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
          <p className="text-xs font-medium text-blue-700 dark:text-blue-300">模型存储目录</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customDirInput}
              onChange={(e) => setCustomDirInput(e.target.value)}
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
            需要下载多自动分割模型 + LaMa 修复模型约 {MODEL_SIZE_MB}MB。
          </p>
        </div>
      )}

      {(modelStatus === 'missing' || modelStatus === 'downloading' || modelStatus === 'error') && (
        <div className="flex-shrink-0 border-b border-gray-200 bg-white px-4 py-4 dark:border-gray-700 dark:bg-gray-800">
          {modelStatus === 'missing' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Info size={18} className="mt-0.5 flex-shrink-0 text-blue-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium">需要下载 AI 去水印模型</p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    默认会下载多自动分割模型和 LaMa 修复模型，自动模式通过 Python worker 先生成精细 mask
                  </p>
                  {modelError && (
                    <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">
                      {modelError}
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
                onClick={handleDownloadModels}
                className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              >
                <Download size={15} />
                下载模型（{MODEL_SIZE_MB}MB）
              </button>
              <button
                onClick={() => setShowManualDownloadGuide(true)}
                className="text-xs text-blue-500 underline hover:text-blue-600"
              >
                查看手动下载方法
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
              <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              {downloadFile && <p className="truncate text-[11px] text-gray-400">{downloadFile}</p>}
            </div>
          )}

          {modelStatus === 'error' && (
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-red-500" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">模型准备失败</p>
                <p className="mt-0.5 break-all text-xs text-gray-500 dark:text-gray-400">
                  {modelError}
                </p>
                <button
                  onClick={handleDownloadModels}
                  className="mt-2 flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-600"
                >
                  <RefreshCw size={12} />
                  重试
                </button>
                <button
                  onClick={() => setShowManualDownloadGuide(true)}
                  className="mt-2 ml-2 text-xs text-blue-500 underline hover:text-blue-600"
                >
                  查看手动下载方法
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {modelStatus === 'checking' && (
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3 text-xs text-gray-400 dark:border-gray-700 dark:bg-gray-800">
          <Loader size={14} className="animate-spin" />
          检查模型状态...
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col p-4">
          {!originalUrl ? (
            <button
              onClick={handleSelectImage}
              className="flex h-full min-h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-blue-900/10"
            >
              <Upload size={32} className="mb-3 text-gray-400" />
              <p className="text-sm text-gray-500 dark:text-gray-400">点击选择图片</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                默认进入智能自动模式，可随时切换到手动标注
              </p>
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2 pb-3">
                {(['auto', 'manual'] as Mode[]).map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      setMode(item);
                      setResultUrl('');
                      setTaskError('');
                    }}
                    className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      mode === item
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {MODE_LABELS[item]}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                {mode === 'manual' && !resultUrl ? (
                  <div className="relative flex h-full items-center justify-center overflow-auto bg-gray-100 p-4 dark:bg-gray-900">
                    <div className="relative max-h-full max-w-full">
                      <img
                        ref={imageRef}
                        src={originalUrl}
                        alt="原图"
                        className="block max-h-[calc(100vh-220px)] max-w-full select-none object-contain"
                        onLoad={setupMaskCanvas}
                        draggable={false}
                      />
                      <canvas
                        ref={canvasRef}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={stopDrawing}
                        onPointerLeave={stopDrawing}
                        className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
                      />
                      {showMaskHint && (
                        <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-lg bg-black/55 px-3 py-2 text-center text-xs text-white">
                          在水印区域上直接涂抹。红色覆盖区域会作为修复遮罩发送到后端。
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div 
                    className="relative h-full overflow-hidden bg-gray-100 dark:bg-gray-900 touch-none select-none"
                    onPointerDown={(e) => {
                      if (!resultUrl) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
                      setSliderPos((x / rect.width) * 100);
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (!resultUrl || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
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
                      src={originalUrl}
                      alt="原图"
                      className="absolute inset-0 h-full w-full object-contain pointer-events-none select-none"
                      style={{ clipPath: resultUrl ? `inset(0 ${100 - sliderPos}% 0 0)` : 'none' }}
                      draggable={false}
                    />
                    {mode === 'auto' && autoMask && !resultUrl && (
                      <>
                        <div
                          className="pointer-events-none absolute inset-0 bg-red-500"
                          style={{
                            opacity: autoMaskOpacity / 100,
                            WebkitMaskImage: `url(${autoMask.maskDataUrl})`,
                            maskImage: `url(${autoMask.maskDataUrl})`,
                            WebkitMaskRepeat: 'no-repeat',
                            maskRepeat: 'no-repeat',
                            WebkitMaskPosition: 'center',
                            maskPosition: 'center',
                            WebkitMaskSize: 'contain',
                            maskSize: 'contain',
                          }}
                        />
                        <span className="pointer-events-none absolute bottom-3 left-3 z-20 rounded bg-black/55 px-2 py-1 text-[10px] text-white">
                          原图
                        </span>
                        <span className="pointer-events-none absolute bottom-3 right-3 z-20 rounded bg-red-500/85 px-2 py-1 text-[10px] text-white">
                          AI 遮罩
                        </span>
                      </>
                    )}
                    {resultUrl && (
                      <>
                        <img
                          src={resultUrl}
                          alt="结果图"
                          className="absolute inset-0 h-full w-full object-contain pointer-events-none select-none"
                          style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
                          draggable={false}
                        />
                        <div 
                          className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_5px_rgba(0,0,0,0.5)] cursor-col-resize flex items-center justify-center z-10"
                          style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md text-gray-500">
                            <div className="flex gap-1">
                              <div className="h-3 w-0.5 bg-gray-400" />
                              <div className="h-3 w-0.5 bg-gray-400" />
                            </div>
                          </div>
                        </div>
                        <span className="absolute bottom-3 left-3 rounded bg-black/55 px-2 py-1 text-[10px] text-white z-20 pointer-events-none">
                          原图
                        </span>
                        <span className="absolute bottom-3 right-3 rounded bg-green-500/85 px-2 py-1 text-[10px] text-white z-20 pointer-events-none">
                          去水印
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <button
                    onClick={handleSelectImage}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-gray-100 hover:text-blue-500 dark:hover:bg-gray-800"
                  >
                    <Upload size={12} />
                    重选图片
                  </button>
                  <span className="truncate">{inputName}</span>
                </div>
                {resultUrl && (
                  <button
                    onClick={saveResult}
                    className="flex items-center gap-1.5 rounded-lg bg-green-500 px-3 py-2 text-xs text-white transition-colors hover:bg-green-600"
                  >
                    <Download size={13} />
                    保存结果
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="w-80 flex-shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
              <div className="flex items-start gap-2">
                {mode === 'auto' ? (
                  <Sparkles size={16} className="mt-0.5 text-blue-500" />
                ) : (
                  <Pencil size={16} className="mt-0.5 text-blue-500" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {mode === 'auto' ? '智能自动模式' : '手动标注模式'}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {mode === 'auto'
                      ? '直接自动识别并尝试去除明显水印，适合常见角标、文字水印和简单平铺水印。'
                      : '你自己标出需要清理的区域，再交给 LaMa 在后端修复，适合复杂或误检场景。'}
                  </p>
                </div>
              </div>
            </div>

            {mode === 'auto' && (
              <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                  <SlidersHorizontal size={14} />
                  自动识别参数
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>识别强度</span>
                    <span>{AUTO_SENSITIVITY_LABELS[autoSensitivity]}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['conservative', 'balanced', 'aggressive'] as AutoSensitivity[]).map((item) => (
                      <button
                        key={item}
                        onClick={() => {
                          setAutoSensitivity(item);
                          setAutoMask(null);
                          setResultUrl('');
                          setTaskError('');
                        }}
                        className={`rounded-lg px-2 py-1.5 text-xs transition-colors ${
                          autoSensitivity === item
                            ? 'bg-blue-500 text-white'
                            : 'bg-white text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                      >
                        {AUTO_SENSITIVITY_LABELS[item]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>遮罩扩张</span>
                    <span>{autoMaskDilate}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="8"
                    value={autoMaskDilate}
                    onChange={(e) => {
                      setAutoMaskDilate(Number(e.target.value));
                      setAutoMask(null);
                      setResultUrl('');
                      setTaskError('');
                    }}
                    className="w-full cursor-pointer accent-blue-500"
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>最大遮罩面积</span>
                    <span>{autoMaxMaskRatio}%</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="45"
                    value={autoMaxMaskRatio}
                    onChange={(e) => {
                      setAutoMaxMaskRatio(Number(e.target.value));
                      setAutoMask(null);
                      setResultUrl('');
                      setTaskError('');
                    }}
                    className="w-full cursor-pointer accent-blue-500"
                  />
                </div>

                <label className="flex cursor-pointer items-center justify-between rounded-lg bg-white px-2.5 py-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  <span>过滤边缘长条误检</span>
                  <input
                    type="checkbox"
                    checked={autoEdgeFilter}
                    onChange={(e) => {
                      setAutoEdgeFilter(e.target.checked);
                      setAutoMask(null);
                      setResultUrl('');
                      setTaskError('');
                    }}
                    className="h-4 w-4 accent-blue-500"
                  />
                </label>

                {autoMask && !resultUrl && (
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>遮罩透明度</span>
                      <span>{autoMaskOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="85"
                      value={autoMaskOpacity}
                      onChange={(e) => setAutoMaskOpacity(Number(e.target.value))}
                      className="w-full cursor-pointer accent-red-500"
                    />
                  </div>
                )}
              </div>
            )}

            {mode === 'manual' && (
              <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">标注工具</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBrushMode('paint')}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors ${
                      brushMode === 'paint'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    <Pencil size={13} />
                    画笔
                  </button>
                  <button
                    onClick={() => setBrushMode('erase')}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors ${
                      brushMode === 'erase'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    <Eraser size={13} />
                    橡皮擦
                  </button>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>笔刷大小</span>
                    <span>{brushSize}px</span>
                  </div>
                  <input
                    type="range"
                    min="8"
                    max="96"
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-full cursor-pointer accent-blue-500"
                  />
                </div>

                <button
                  onClick={() => {
                    clearMask();
                    setResultUrl('');
                    setTaskError('');
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <RotateCcw size={13} />
                  清空标注
                </button>
              </div>
            )}

            {taskError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 text-red-500" />
                  <div className="text-xs text-red-600 dark:text-red-300">{taskError}</div>
                </div>
              </div>
            )}

            {mode === 'auto' && autoMask && !resultUrl && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                <div className="flex items-start gap-2">
                  <Eye size={16} className="mt-0.5 text-blue-500" />
                  <div className="flex-1 text-xs text-blue-700 dark:text-blue-200">
                    <p>
                      已识别 {autoMask.components.length} 个区域，覆盖{' '}
                      {(autoMask.coverage * 100).toFixed(2)}%
                    </p>
                    {autoMask.components[0] && (
                      <p className="mt-1 text-blue-600/80 dark:text-blue-200/80">
                        最大区域 {autoMask.components[0].width}×{autoMask.components[0].height}
                      </p>
                    )}
                    {autoMask.warnings.length > 0 && (
                      <p className="mt-1 text-amber-600 dark:text-amber-300">
                        {autoMask.warnings.join('；')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {resultUrl && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
                <div className="flex items-start gap-2">
                  <CheckCircle size={16} className="mt-0.5 text-green-500" />
                  <div className="text-xs text-green-700 dark:text-green-300">
                    去水印已完成。你可以直接保存结果，或者切换模式重新处理同一张图。
                  </div>
                </div>
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={handleProcess}
                disabled={!inputPath || modelStatus !== 'ready' || processing}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-600"
              >
                {processing ? (
                  <>
                    <Loader size={15} className="animate-spin" />
                    处理中...
                  </>
                ) : mode === 'auto' ? (
                  <>
                    <Sparkles size={15} />
                    一键智能去水印
                  </>
                ) : (
                  <>
                    <Pencil size={15} />
                    按标注去水印
                  </>
                )}
              </button>
              {mode === 'auto' && !processing && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={handleAutoDetect}
                    disabled={!inputPath || modelStatus !== 'ready'}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    {autoMask && !resultUrl ? <RefreshCw size={13} /> : <Eye size={13} />}
                    {autoMask && !resultUrl ? '重新预览' : '预览识别'}
                  </button>
                  <button
                    onClick={handleAutoRepair}
                    disabled={!autoMask || !inputPath || modelStatus !== 'ready'}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <Sparkles size={13} />
                    用预览修复
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showManualDownloadGuide && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    手动下载模型方法
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    适用于网络波动、代理异常，或你想提前离线准备模型文件的情况。
                  </p>
                </div>
                <button
                  onClick={() => setShowManualDownloadGuide(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  关闭
                </button>
              </div>
            </div>

            <div className="space-y-5 px-5 py-4 text-sm text-gray-700 dark:text-gray-200">
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-900/20">
                <p className="text-xs font-medium text-blue-700 dark:text-blue-300">模型存储根目录</p>
                <div className="mt-2 break-all rounded-lg bg-white px-3 py-2 font-mono text-[12px] text-gray-700 dark:bg-gray-900 dark:text-gray-200">
                  {manualDownloadRoot}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={handleOpenModelDir}
                    className="rounded-lg bg-blue-500 px-3 py-2 text-xs text-white transition-colors hover:bg-blue-600"
                  >
                    打开模型目录
                  </button>
                  <button
                    onClick={handleCopyManualGuide}
                    className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                  >
                    复制下载说明
                  </button>
                  {copyHint && (
                    <span className="self-center text-xs text-green-600 dark:text-green-400">
                      {copyHint}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">操作步骤</p>
                <ol className="list-decimal space-y-2 pl-5 text-xs leading-6 text-gray-600 dark:text-gray-300">
                  <li>先确认上面的模型根目录存在。如果你修改过模型目录，以这里显示的路径为准。</li>
                  <li>进入对应网址，把模型文件下载到本机，不要改文件名。</li>
                  <li>如果目录不存在，请手动创建 `auto` 和 `manual` 两个子目录。</li>
                  <li>把下载好的文件放到下方“保存位置”显示的完整路径里。</li>
                  <li>回到当前工具窗口，点击“重试”，程序会重新检查模型是否齐全。</li>
                </ol>
              </div>

              <div className="space-y-3">
                {MODEL_FILES.map((file) => {
                  const fullPath = `${modelDir.replace(/\//g, '\\')}\\${file.modelName.replace(/\//g, '\\')}`;
                  return (
                    <div
                      key={file.modelName}
                      className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60"
                    >
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{file.label}</p>
                      <div className="mt-3 space-y-2 text-xs">
                        <div>
                          <p className="mb-1 text-gray-500 dark:text-gray-400">下载链接</p>
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
                          >
                            {file.url}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
