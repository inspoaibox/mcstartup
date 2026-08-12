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
  FolderOpen,
  Info,
  Loader,
  Paintbrush,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Upload,
} from 'lucide-react';

type ModelStatus = 'unknown' | 'checking' | 'missing' | 'downloading' | 'ready' | 'error';
type BrushMode = 'paint' | 'erase';

interface EraseResult {
  dataUrl: string;
}

const LAMA_MODEL = {
  label: 'LaMa 智能擦除修复模型',
  modelName: 'ai-watermark-remove/manual/lama_fp32.onnx',
  url: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
} as const;
const MODEL_SIZE_MB = 200;

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export default function ImageMagicEraserTool() {
  const ready = useToolTheme();
  const [modelDir, setModelDir] = useState('');
  const [customDirInput, setCustomDirInput] = useState('');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('unknown');
  const [modelError, setModelError] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadFile, setDownloadFile] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [copyHint, setCopyHint] = useState('');
  const [inputPath, setInputPath] = useState('');
  const [inputName, setInputName] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [processing, setProcessing] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [brushMode, setBrushMode] = useState<BrushMode>('paint');
  const [brushSize, setBrushSize] = useState(36);
  const [maskOpacity, setMaskOpacity] = useState(48);
  const [cleanupStrength, setCleanupStrength] = useState(10);
  const [secondPass, setSecondPass] = useState(true);
  const [showMaskHint, setShowMaskHint] = useState(true);
  const [sliderPos, setSliderPos] = useState(50);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number; scale: number } | null>(null);

  const modelPath = `${modelDir.replace(/\//g, '\\')}\\${LAMA_MODEL.modelName.replace(/\//g, '\\')}`;

  useEffect(() => {
    const init = async () => {
      setModelStatus('checking');
      try {
        const customDir = await invoke<string | null>('get_custom_model_dir');
        const defaultDir = await invoke<string>('get_model_dir');
        const dir = customDir || defaultDir;
        setModelDir(dir);
        setCustomDirInput(dir);
        const exists = await checkModel(dir);
        setModelStatus(exists ? 'ready' : 'missing');
        setModelError(exists ? '' : 'LaMa 智能擦除修复模型未下载');
      } catch (error) {
        setModelStatus('error');
        setModelError(getErrorMessage(error, '初始化失败'));
      }
    };
    init();
  }, []);

  const checkModel = async (dir: string) =>
    invoke<boolean>('check_model_exists', {
      modelDir: dir,
      modelName: LAMA_MODEL.modelName,
    });

  const handleDownloadModel = async () => {
    setModelStatus('downloading');
    setModelError('');
    setDownloadProgress(0);
    setDownloadFile('');
    const unlisten = await listen<any>('model-download-progress', (event) => {
      const { loaded, total, done, file } = event.payload;
      setDownloadFile((file as string).split(/[/\\]/).pop() || file);
      const progress = total > 0 ? Math.round((loaded / total) * 100) : done ? 100 : 0;
      setDownloadProgress(progress);
    });

    try {
      const destPath = `${modelDir.replace(/\\/g, '/')}/${LAMA_MODEL.modelName}`;
      await invoke('download_model_file', { url: LAMA_MODEL.url, destPath, overwrite: true });
      const exists = await checkModel(modelDir);
      if (!exists) throw new Error('模型下载后仍未检测到，请检查保存目录');
      setModelStatus('ready');
      setModelError('');
      setDownloadProgress(100);
    } catch (error) {
      setModelStatus('error');
      setModelError(getErrorMessage(error, '模型下载失败，请检查网络连接'));
    } finally {
      unlisten();
    }
  };

  const handleSelectModelDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === 'string') setCustomDirInput(selected);
  };

  const handleSaveModelDir = async () => {
    await invoke('set_model_dir', { dir: customDirInput });
    setModelDir(customDirInput);
    const exists = await checkModel(customDirInput);
    setModelStatus(exists ? 'ready' : 'missing');
    setModelError(exists ? '' : 'LaMa 智能擦除修复模型未下载');
  };

  const handleCopyManualGuide = async () => {
    const content = [
      'AI 智能擦除 - 手动下载模型说明',
      '',
      `模型保存位置：${modelPath}`,
      `下载链接：${LAMA_MODEL.url}`,
      '',
      '下载后不要改文件名，回到工具窗口点击“重试”即可重新检测。',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(content);
      setCopyHint('说明已复制');
    } catch {
      setCopyHint('复制失败，请手动复制');
    }
    window.setTimeout(() => setCopyHint(''), 2000);
  };

  const handleOpenModelDir = async () => {
    await invoke('open_path', { targetPath: modelDir });
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
    clearMask();
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
    ctx.strokeStyle = `rgba(239, 68, 68, ${maskOpacity / 100})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
    setShowMaskHint(false);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (resultUrl) return;
    const point = canvasPointFromEvent(event.clientX, event.clientY);
    if (!point) return;
    drawingRef.current = true;
    lastPointRef.current = point;
    drawSegment(point, point);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || resultUrl) return;
    const point = canvasPointFromEvent(event.clientX, event.clientY);
    const lastPoint = lastPointRef.current;
    if (!point || !lastPoint) return;
    drawSegment(lastPoint, point);
    lastPointRef.current = point;
  };

  const stopDrawing = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
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

  const handleErase = async () => {
    if (!inputPath || modelStatus !== 'ready' || processing) return;
    setProcessing(true);
    setTaskError('');
    setResultUrl('');
    try {
      if (!(await checkModel(modelDir))) {
        setModelStatus('missing');
        throw new Error('LaMa 智能擦除修复模型未下载');
      }
      if (!hasMaskPixels()) throw new Error('请先涂抹需要删除的人物、物体或文字');
      const result = await invoke<EraseResult>('image_magic_erase', {
        inputPath,
        maskDataUrl: exportMaskDataUrl(),
        modelDir,
        options: {
          maskExpand: cleanupStrength,
          blendFeather: Math.max(1.5, cleanupStrength * 0.28),
          secondPass,
        },
      });
      setResultUrl(result.dataUrl);
      setSliderPos(50);
    } catch (error) {
      setTaskError(getErrorMessage(error, 'AI 智能擦除失败'));
    } finally {
      setProcessing(false);
    }
  };

  const saveResult = async () => {
    if (!resultUrl || !inputName) return;
    const stem = inputName.replace(/\.[^.]+$/, '');
    const outputPath = await save({
      defaultPath: `${stem}_erased.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (!outputPath) return;
    await invoke('save_base64_image', { base64Data: resultUrl, outputPath });
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="🪄"
        title="AI 智能擦除"
        subtitle={modelStatus === 'ready' ? 'LaMa 本地修复 · 魔法橡皮擦' : undefined}
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
        <div className="flex-shrink-0 space-y-2 border-b border-emerald-100 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-900/20">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">模型存储目录</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customDirInput}
              onChange={(event) => setCustomDirInput(event.target.value)}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:border-gray-600 dark:bg-gray-700"
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
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs text-white transition-colors hover:bg-emerald-600"
            >
              保存
            </button>
          </div>
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
            仅需要 LaMa 修复模型，和 AI 智能去水印手动模式共用。
          </p>
        </div>
      )}

      {(modelStatus === 'missing' || modelStatus === 'downloading' || modelStatus === 'error') && (
        <div className="flex-shrink-0 border-b border-gray-200 bg-white px-4 py-4 dark:border-gray-700 dark:bg-gray-800">
          {modelStatus === 'missing' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Info size={18} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium">需要下载 AI 擦除模型</p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    只下载 LaMa 修复模型，已安装图片去水印模型时会自动复用。
                  </p>
                  {modelError && <p className="mt-1.5 text-xs text-red-500">{modelError}</p>}
                  <p className="mt-1.5 max-w-xl truncate text-xs text-gray-400">保存位置：{modelPath}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleDownloadModel}
                  className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600"
                >
                  <Download size={15} />
                  下载模型（约 {MODEL_SIZE_MB}MB）
                </button>
                <button onClick={handleCopyManualGuide} className="text-xs text-emerald-600 underline">
                  复制手动下载方法
                </button>
                {copyHint && <span className="text-xs text-emerald-600">{copyHint}</span>}
              </div>
            </div>
          )}

          {modelStatus === 'downloading' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader size={15} className="animate-spin text-emerald-500" />
                  <span className="text-sm font-medium">下载模型中...</span>
                </div>
                <span className="text-sm font-medium text-emerald-500">{downloadProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
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
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={handleDownloadModel}
                    className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-600"
                  >
                    <RefreshCw size={12} />
                    重试
                  </button>
                  <button
                    onClick={handleCopyManualGuide}
                    className="text-xs text-emerald-600 underline"
                  >
                    复制手动下载方法
                  </button>
                </div>
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
        <main className="flex flex-1 flex-col p-4">
          {!originalUrl ? (
            <button
              onClick={handleSelectImage}
              className="flex h-full min-h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white transition-colors hover:border-emerald-400 hover:bg-emerald-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-emerald-900/10"
            >
              <Upload size={32} className="mb-3 text-gray-400" />
              <p className="text-sm text-gray-500 dark:text-gray-400">点击选择图片</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                涂抹人物、物体、文字或杂物，AI 自动补背景
              </p>
            </button>
          ) : (
            <>
              <div className="flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                {!resultUrl ? (
                  <div className="relative flex h-full items-center justify-center overflow-auto bg-gray-100 p-4 dark:bg-gray-900">
                    <div className="relative max-h-full max-w-full">
                      <img
                        ref={imageRef}
                        src={originalUrl}
                        alt="原图"
                        className="block max-h-[calc(100vh-210px)] max-w-full select-none object-contain"
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
                          涂抹要删除的区域，红色部分会交给 AI 补背景。
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    className="relative h-full touch-none select-none overflow-hidden bg-gray-100 dark:bg-gray-900"
                    onPointerDown={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
                      setSliderPos((x / rect.width) * 100);
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
                      setSliderPos((x / rect.width) * 100);
                    }}
                  >
                    <img
                      src={originalUrl}
                      alt="原图"
                      className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                      style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                      draggable={false}
                    />
                    <img
                      src={resultUrl}
                      alt="擦除结果"
                      className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                      style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
                      draggable={false}
                    />
                    <div
                      className="absolute inset-y-0 z-10 flex w-0.5 cursor-col-resize items-center justify-center bg-white shadow-[0_0_5px_rgba(0,0,0,0.5)]"
                      style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-500 shadow-md">
                        <div className="flex gap-1">
                          <div className="h-3 w-0.5 bg-gray-400" />
                          <div className="h-3 w-0.5 bg-gray-400" />
                        </div>
                      </div>
                    </div>
                    <span className="pointer-events-none absolute bottom-3 left-3 z-20 rounded bg-black/55 px-2 py-1 text-[10px] text-white">
                      原图
                    </span>
                    <span className="pointer-events-none absolute bottom-3 right-3 z-20 rounded bg-emerald-500/85 px-2 py-1 text-[10px] text-white">
                      擦除
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-xs text-gray-400">
                  <button
                    onClick={handleSelectImage}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-gray-100 hover:text-emerald-500 dark:hover:bg-gray-800"
                  >
                    <Upload size={12} />
                    重选图片
                  </button>
                  <span className="truncate">{inputName}</span>
                </div>
                {resultUrl && (
                  <button
                    onClick={saveResult}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs text-white transition-colors hover:bg-emerald-600"
                  >
                    <Download size={13} />
                    保存结果
                  </button>
                )}
              </div>
            </>
          )}
        </main>

        <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
              <div className="flex items-start gap-2">
                <Sparkles size={16} className="mt-0.5 text-emerald-500" />
                <div>
                  <p className="text-sm font-medium">魔法橡皮擦</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    适合删除路人、小物体、文字、污点和局部瑕疵。大面积人物或复杂结构建议少量多次涂抹。
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">涂抹工具</div>
              <div className="flex gap-2">
                <button
                  onClick={() => setBrushMode('paint')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors ${
                    brushMode === 'paint'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  <Paintbrush size={13} />
                  涂抹
                </button>
                <button
                  onClick={() => setBrushMode('erase')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors ${
                    brushMode === 'erase'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  <Eraser size={13} />
                  撤回涂抹
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
                  max="128"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                  className="w-full cursor-pointer accent-emerald-500"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>遮罩透明度</span>
                  <span>{maskOpacity}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="85"
                  value={maskOpacity}
                  onChange={(event) => setMaskOpacity(Number(event.target.value))}
                  className="w-full cursor-pointer accent-red-500"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>清理强度</span>
                  <span>{cleanupStrength}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="24"
                  value={cleanupStrength}
                  onChange={(event) => setCleanupStrength(Number(event.target.value))}
                  className="w-full cursor-pointer accent-emerald-500"
                />
                <p className="mt-1 text-[11px] leading-5 text-gray-400">
                  扩展涂抹边缘，减少人物/物体轮廓残留。
                </p>
              </div>

              <label className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                <span>二次清理残留</span>
                <input
                  type="checkbox"
                  checked={secondPass}
                  onChange={(event) => setSecondPass(event.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
              </label>

              <button
                onClick={() => {
                  clearMask();
                  setResultUrl('');
                  setTaskError('');
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <RotateCcw size={13} />
                清空涂抹
              </button>
            </div>

            {taskError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>{taskError}</span>
                </div>
              </div>
            )}

            {modelStatus === 'ready' && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300">
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} />
                  模型已就绪
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 space-y-2">
            <button
              onClick={handleErase}
              disabled={!inputPath || modelStatus !== 'ready' || processing}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-600"
            >
              {processing ? <Loader size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {processing ? 'AI 擦除中...' : '一键智能擦除'}
            </button>
            <button
              onClick={handleOpenModelDir}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <FolderOpen size={13} />
              打开模型目录
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
