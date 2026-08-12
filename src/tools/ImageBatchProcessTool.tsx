import { useMemo, useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileImage,
  FlipHorizontal2,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Loader2,
  Plus,
  RotateCw,
  Scissors,
  Settings2,
  Stamp,
  Trash2,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

type OutputFormat = 'keep' | 'jpeg' | 'png' | 'webp' | 'bmp' | 'tiff';
type StepType = 'crop' | 'resize' | 'transform' | 'watermark';

interface ImageItem {
  path: string;
  name: string;
  size: number;
  width: number;
  height: number;
  format: string;
  selected?: boolean;
  status?: 'pending' | 'processing' | 'done' | 'error';
  outputPath?: string;
  error?: string;
  outputSize?: number;
  outputWidth?: number;
  outputHeight?: number;
}

interface WorkflowStep {
  id: string;
  type: StepType;
  enabled: boolean;
  cropMode?: 'aspect' | 'size';
  aspectW?: number;
  aspectH?: number;
  cropW?: number;
  cropH?: number;
  anchor?: string;
  resizeMode?: 'fitBox' | 'exact' | 'fitWidth' | 'fitHeight' | 'percent';
  resizeW?: number;
  resizeH?: number;
  percent?: number;
  allowEnlarge?: boolean;
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  watermarkMode?: 'text' | 'image';
  watermarkText?: string;
  watermarkImagePath?: string;
  opacity?: number;
  scale?: number;
  fontSize?: number;
  color?: string;
  angle?: number;
  layout?: 'single' | 'tile';
  position?: string;
  gapX?: number;
  gapY?: number;
  offsetX?: number;
  offsetY?: number;
}

interface BatchResult {
  total: number;
  success: number;
  failed: number;
  items: Array<{
    inputPath: string;
    outputPath?: string;
    success: boolean;
    error?: string;
    width?: number;
    height?: number;
    size?: number;
  }>;
}

const RATIO_PRESETS = [
  ['1:1', 1, 1],
  ['4:3', 4, 3],
  ['3:2', 3, 2],
  ['16:9', 16, 9],
  ['9:16', 9, 16],
  ['3:4', 3, 4],
  ['2:3', 2, 3],
] as const;

const SIZE_PRESETS = [
  ['头像 512', 512, 512],
  ['小红书 1242x1660', 1242, 1660],
  ['公众号封面 900x383', 900, 383],
  ['视频封面 1920x1080', 1920, 1080],
  ['手机壁纸 1080x1920', 1080, 1920],
] as const;

const DEFAULT_STEPS: WorkflowStep[] = [
  {
    id: 'resize-default',
    type: 'resize',
    enabled: true,
    resizeMode: 'fitBox',
    resizeW: 1920,
    resizeH: 1080,
    allowEnlarge: false,
  },
];

function fmtSize(value?: number) {
  if (!value) return '-';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function makeId(type: string) {
  return `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createStep(type: StepType): WorkflowStep {
  if (type === 'crop') {
    return {
      id: makeId(type),
      type,
      enabled: true,
      cropMode: 'aspect',
      aspectW: 1,
      aspectH: 1,
      cropW: 1080,
      cropH: 1080,
      anchor: 'center',
    };
  }
  if (type === 'resize') {
    return {
      id: makeId(type),
      type,
      enabled: true,
      resizeMode: 'fitBox',
      resizeW: 1920,
      resizeH: 1080,
      percent: 50,
      allowEnlarge: false,
    };
  }
  if (type === 'transform') {
    return { id: makeId(type), type, enabled: true, rotate: 0, flipH: false, flipV: false };
  }
  return {
    id: makeId(type),
    type,
    enabled: true,
    watermarkMode: 'text',
    watermarkText: '仅供使用',
    opacity: 0.28,
    scale: 0.22,
    fontSize: 48,
    color: '#ffffff',
    angle: 0,
    layout: 'tile',
    position: 'center',
    gapX: 220,
    gapY: 160,
    offsetX: 0,
    offsetY: 0,
  };
}

function stepTitle(type: StepType) {
  if (type === 'crop') return '批量裁剪';
  if (type === 'resize') return '批量尺寸';
  if (type === 'transform') return '翻转旋转';
  return '添加水印';
}

function stepIcon(type: StepType) {
  if (type === 'crop') return <Scissors size={15} />;
  if (type === 'resize') return <ImageIcon size={15} />;
  if (type === 'transform') return <FlipHorizontal2 size={15} />;
  return <Stamp size={15} />;
}

export default function ImageBatchProcessTool() {
  const ready = useToolTheme();
  const [items, setItems] = useState<ImageItem[]>([]);
  const [steps, setSteps] = useState<WorkflowStep[]>(DEFAULT_STEPS);
  const [outputDir, setOutputDir] = useState('');
  const [outputTemplate, setOutputTemplate] = useState('{name}_processed');
  const [format, setFormat] = useState<OutputFormat>('keep');
  const [quality, setQuality] = useState(90);
  const [overwrite, setOverwrite] = useState(false);
  const [recursive, setRecursive] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');

  async function addFiles(paths: string[]) {
    const unique = paths.filter(Boolean);
    if (unique.length === 0) return;
    const inspected = await invoke<ImageItem[]>('image_batch_inspect_paths', { paths: unique });
    setItems((prev) => {
      const map = new Map(prev.map((item) => [item.path.toLowerCase(), item]));
      inspected.forEach((item) => map.set(item.path.toLowerCase(), { ...item, selected: true, status: 'pending' }));
      return Array.from(map.values());
    });
  }

  async function selectImages() {
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'] }],
    });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    await addFiles(paths as string[]);
  }

  async function scanFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    setMessage('');
    try {
      const result = await invoke<ImageItem[]>('image_batch_scan_dir', {
        root: selected,
        options: { recursive, includeHidden },
      });
      setItems((prev) => {
        const map = new Map(prev.map((item) => [item.path.toLowerCase(), item]));
        result.forEach((item) => map.set(item.path.toLowerCase(), { ...item, selected: true, status: 'pending' }));
        return Array.from(map.values());
      });
      setMessage(`已扫描 ${result.length} 张图片`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function chooseOutputDir() {
    const selected = await open({ directory: true, multiple: false });
    if (selected && !Array.isArray(selected)) setOutputDir(selected);
  }

  async function chooseWatermarkImage(id: string) {
    const selected = await open({
      directory: false,
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (selected && !Array.isArray(selected)) {
      updateStep(id, { watermarkImagePath: selected });
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter(Boolean) as string[];
    addFiles(paths);
  }

  function updateStep(id: string, patch: Partial<WorkflowStep>) {
    setSteps((prev) => prev.map((step) => (step.id === id ? { ...step, ...patch } : step)));
  }

  function removeStep(id: string) {
    setSteps((prev) => prev.filter((step) => step.id !== id));
  }

  function moveStep(id: string, direction: -1 | 1) {
    setSteps((prev) => {
      const index = prev.findIndex((step) => step.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const [step] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, step);
      return copy;
    });
  }

  const selectedItems = useMemo(() => items.filter((item) => item.selected !== false), [items]);
  const enabledSteps = useMemo(() => steps.filter((step) => step.enabled), [steps]);
  const doneCount = items.filter((item) => item.status === 'done').length;
  const failedCount = items.filter((item) => item.status === 'error').length;

  function buildBackendStep(step: WorkflowStep) {
    if (step.type === 'crop') {
      return {
        type: 'crop',
        mode: step.cropMode ?? 'aspect',
        aspectW: step.aspectW ?? 1,
        aspectH: step.aspectH ?? 1,
        width: step.cropW ?? 1080,
        height: step.cropH ?? 1080,
        anchor: step.anchor ?? 'center',
      };
    }
    if (step.type === 'resize') {
      return {
        type: 'resize',
        mode: step.resizeMode ?? 'fitBox',
        width: step.resizeW ?? 1920,
        height: step.resizeH ?? 1080,
        percent: step.percent ?? 100,
        allowEnlarge: !!step.allowEnlarge,
      };
    }
    if (step.type === 'transform') {
      return {
        type: 'transform',
        rotate: step.rotate ?? 0,
        flipH: !!step.flipH,
        flipV: !!step.flipV,
      };
    }
    return {
      type: 'watermark',
      mode: step.watermarkMode ?? 'text',
      text: step.watermarkText ?? '',
      imagePath: step.watermarkImagePath ?? '',
      opacity: step.opacity ?? 0.3,
      scale: step.scale ?? 0.2,
      fontSize: step.fontSize ?? 48,
      color: step.color ?? '#ffffff',
      angle: step.angle ?? 0,
      layout: step.layout ?? 'tile',
      position: step.position ?? 'center',
      gapX: step.gapX ?? 220,
      gapY: step.gapY ?? 160,
      offsetX: step.offsetX ?? 0,
      offsetY: step.offsetY ?? 0,
    };
  }

  async function runBatch() {
    if (selectedItems.length === 0) {
      setMessage('请先添加并选择图片');
      return;
    }
    if (!outputDir) {
      setMessage('请先选择输出目录');
      return;
    }
    if (enabledSteps.length === 0 && format === 'keep') {
      setMessage('请至少启用一个处理步骤，或选择格式转换');
      return;
    }

    setRunning(true);
    setMessage('');
    setItems((prev) =>
      prev.map((item) =>
        item.selected === false
          ? item
          : { ...item, status: 'processing', error: undefined, outputPath: undefined },
      ),
    );
    try {
      const result = await invoke<BatchResult>('image_batch_process', {
        options: {
          inputPaths: selectedItems.map((item) => item.path),
          outputDir,
          outputTemplate,
          overwrite,
          steps: enabledSteps.map(buildBackendStep),
          outputFormat: {
            keepOriginal: format === 'keep',
            format,
            quality,
          },
        },
      });
      const resultMap = new Map(result.items.map((item) => [item.inputPath.toLowerCase(), item]));
      setItems((prev) =>
        prev.map((item) => {
          const hit = resultMap.get(item.path.toLowerCase());
          if (!hit) return item;
          return {
            ...item,
            status: hit.success ? 'done' : 'error',
            outputPath: hit.outputPath,
            error: hit.error,
            outputWidth: hit.width,
            outputHeight: hit.height,
            outputSize: hit.size,
          };
        }),
      );
      setMessage(`完成 ${result.success}/${result.total}，失败 ${result.failed}`);
    } catch (error) {
      setMessage(String(error));
      setItems((prev) =>
        prev.map((item) => (item.status === 'processing' ? { ...item, status: 'error', error: String(error) } : item)),
      );
    } finally {
      setRunning(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-white">
      <ToolHeader title="图片批量处理" icon="🧰" subtitle="工作流式批量裁剪、尺寸、翻转、镜像、水印和格式转换" />
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <aside className="flex min-h-0 max-h-[72vh] w-full flex-shrink-0 flex-col overflow-hidden border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 lg:max-h-none lg:w-[420px] lg:border-b-0 lg:border-r">
          <section className="flex-shrink-0 border-b border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FileImage size={16} />
              图片来源
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={selectImages}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
              >
                <Plus size={15} />
                添加图片
              </button>
              <button
                onClick={scanFolder}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                <FolderOpen size={15} />
                扫描文件夹
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
                包含子目录
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeHidden}
                  onChange={(e) => setIncludeHidden(e.target.checked)}
                />
                隐藏图片
              </label>
            </div>
            <div className="mt-2 text-[11px] text-gray-400">支持拖拽图片或文件夹到窗口。</div>
          </section>

          <section className="flex min-h-0 flex-1 flex-col border-b border-gray-200 dark:border-gray-800">
            <div className="flex-shrink-0 p-4 pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Layers size={16} />
                处理工作流
              </div>
              <div className="flex gap-1">
                {(['crop', 'resize', 'transform', 'watermark'] as StepType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setSteps((prev) => [...prev, createStep(type)])}
                    title={stepTitle(type)}
                    className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                  >
                    {stepIcon(type)}
                  </button>
                ))}
              </div>
            </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 pr-3 overscroll-contain">
              {steps.map((step, index) => (
                <div key={step.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
                  <div className="mb-3 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={step.enabled}
                      onChange={(e) => updateStep(step.id, { enabled: e.target.checked })}
                    />
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {stepIcon(step.type)}
                      {index + 1}. {stepTitle(step.type)}
                    </div>
                    <div className="ml-auto flex gap-1">
                      <button
                        onClick={() => moveStep(step.id, -1)}
                        className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveStep(step.id, 1)}
                        className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removeStep(step.id)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <StepEditor step={step} update={(patch) => updateStep(step.id, patch)} chooseWatermarkImage={() => chooseWatermarkImage(step.id)} />
                </div>
              ))}
            </div>
          </section>

          <section className="max-h-[46vh] flex-shrink-0 overflow-y-auto p-4 lg:max-h-[44vh]">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Settings2 size={16} />
              输出设置
            </div>
            <button
              onClick={chooseOutputDir}
              className="mb-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <FolderOpen size={15} />
              {outputDir || '选择输出目录'}
            </button>
            <label className="block">
              <div className="mb-1 text-xs text-gray-500">命名模板</div>
              <input
                value={outputTemplate}
                onChange={(e) => setOutputTemplate(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
              />
            </label>
            <div className="mt-1 text-[11px] text-gray-400">可用：{'{name}'} {'{num}'} {'{index}'} {'{width}'} {'{height}'}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as OutputFormat)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="keep">保持原格式</option>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
                <option value="bmp">BMP</option>
                <option value="tiff">TIFF</option>
              </select>
              <input
                type="number"
                min={1}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value) || 90)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                title="JPEG 质量"
              />
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              允许覆盖输出目录同名文件
            </label>
            <button
              onClick={runBatch}
              disabled={running || selectedItems.length === 0}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {running ? '批处理中...' : `开始处理 ${selectedItems.length} 张`}
            </button>
            {message && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                {message}
              </div>
            )}
          </section>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="grid grid-cols-2 gap-2 border-b border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950 md:grid-cols-5">
            <Stat label="图片" value={items.length} />
            <Stat label="已选" value={selectedItems.length} />
            <Stat label="步骤" value={enabledSteps.length} />
            <Stat label="完成" value={doneCount} tone="green" />
            <Stat label="失败" value={failedCount} tone={failedCount ? 'red' : 'gray'} />
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
                <ImageIcon size={48} className="text-gray-300 dark:text-gray-700" />
                <div className="text-sm">添加图片后，在左侧配置工作流并批量输出</div>
              </div>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={items.every((item) => item.selected !== false)}
                        onChange={(e) => setItems((prev) => prev.map((item) => ({ ...item, selected: e.target.checked })))}
                      />
                    </th>
                    <th className="px-3 py-2">图片</th>
                    <th className="px-3 py-2">原始信息</th>
                    <th className="px-3 py-2">输出结果</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="w-10 px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-950">
                  {items.map((item) => (
                    <tr key={item.path}>
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={item.selected !== false}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((row) => (row.path === item.path ? { ...row, selected: e.target.checked } : row)),
                            )
                          }
                        />
                      </td>
                      <td className="max-w-[340px] px-3 py-2 align-top">
                        <div className="flex items-start gap-2">
                          <FileImage size={16} className="mt-0.5 flex-shrink-0 text-blue-500" />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-gray-800 dark:text-gray-100" title={item.name}>{item.name}</div>
                            <div className="mt-0.5 break-all text-[11px] text-gray-400">{item.path}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-500">
                        {item.width} × {item.height}
                        <div className="mt-0.5">{item.format.toUpperCase()} · {fmtSize(item.size)}</div>
                      </td>
                      <td className="max-w-[320px] px-3 py-2 align-top text-xs text-gray-500">
                        {item.outputPath ? (
                          <>
                            <div>{item.outputWidth} × {item.outputHeight} · {fmtSize(item.outputSize)}</div>
                            <div className="mt-0.5 break-all text-gray-400">{item.outputPath}</div>
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Status item={item} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <button
                          onClick={() => setItems((prev) => prev.filter((row) => row.path !== item.path))}
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function StepEditor({
  step,
  update,
  chooseWatermarkImage,
}: {
  step: WorkflowStep;
  update: (patch: Partial<WorkflowStep>) => void;
  chooseWatermarkImage: () => void;
}) {
  if (step.type === 'crop') {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <select value={step.cropMode} onChange={(e) => update({ cropMode: e.target.value as 'aspect' | 'size' })} className="input-sm">
            <option value="aspect">按比例居中裁剪</option>
            <option value="size">按像素裁剪</option>
          </select>
          <select value={step.anchor ?? 'center'} onChange={(e) => update({ anchor: e.target.value })} className="input-sm">
            <option value="center">居中</option>
            <option value="top">顶部</option>
            <option value="bottom">底部</option>
            <option value="left">左侧</option>
            <option value="right">右侧</option>
          </select>
        </div>
        {step.cropMode === 'aspect' ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {RATIO_PRESETS.map(([label, w, h]) => (
                <button key={label} onClick={() => update({ aspectW: w, aspectH: h })} className="chip">
                  {label}
                </button>
              ))}
            </div>
            <NumberPair left={step.aspectW ?? 1} right={step.aspectH ?? 1} onLeft={(v) => update({ aspectW: v })} onRight={(v) => update({ aspectH: v })} />
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {SIZE_PRESETS.map(([label, w, h]) => (
                <button key={label} onClick={() => update({ cropW: w, cropH: h })} className="chip">
                  {label}
                </button>
              ))}
            </div>
            <NumberPair left={step.cropW ?? 1080} right={step.cropH ?? 1080} onLeft={(v) => update({ cropW: v })} onRight={(v) => update({ cropH: v })} />
          </>
        )}
      </div>
    );
  }
  if (step.type === 'resize') {
    return (
      <div className="space-y-3">
        <select value={step.resizeMode} onChange={(e) => update({ resizeMode: e.target.value as WorkflowStep['resizeMode'] })} className="input-sm">
          <option value="fitBox">等比适应宽高框</option>
          <option value="exact">强制指定宽高</option>
          <option value="fitWidth">按宽度等比</option>
          <option value="fitHeight">按高度等比</option>
          <option value="percent">按百分比</option>
        </select>
        {step.resizeMode === 'percent' ? (
          <input type="number" value={step.percent ?? 100} onChange={(e) => update({ percent: Number(e.target.value) || 100 })} className="input-sm w-full" />
        ) : (
          <NumberPair left={step.resizeW ?? 1920} right={step.resizeH ?? 1080} onLeft={(v) => update({ resizeW: v })} onRight={(v) => update({ resizeH: v })} />
        )}
        <div className="flex flex-wrap gap-1.5">
          {SIZE_PRESETS.map(([label, w, h]) => (
            <button key={label} onClick={() => update({ resizeW: w, resizeH: h })} className="chip">
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={!!step.allowEnlarge} onChange={(e) => update({ allowEnlarge: e.target.checked })} />
          允许放大
        </label>
      </div>
    );
  }
  if (step.type === 'transform') {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-1.5">
          {[0, 90, 180, 270].map((rotate) => (
            <button key={rotate} onClick={() => update({ rotate: rotate as WorkflowStep['rotate'] })} className={`chip ${step.rotate === rotate ? 'chip-active' : ''}`}>
              <RotateCw size={12} /> {rotate}°
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!step.flipH} onChange={(e) => update({ flipH: e.target.checked })} />
            水平镜像
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!step.flipV} onChange={(e) => update({ flipV: e.target.checked })} />
            垂直翻转
          </label>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <select value={step.watermarkMode} onChange={(e) => update({ watermarkMode: e.target.value as 'text' | 'image' })} className="input-sm">
          <option value="text">文字水印</option>
          <option value="image">图片水印</option>
        </select>
        <select value={step.layout} onChange={(e) => update({ layout: e.target.value as 'single' | 'tile' })} className="input-sm">
          <option value="tile">平铺</option>
          <option value="single">单个</option>
        </select>
      </div>
      {step.watermarkMode === 'image' ? (
        <button onClick={chooseWatermarkImage} className="input-sm w-full truncate text-left">
          {step.watermarkImagePath || '选择水印图片'}
        </button>
      ) : (
        <input value={step.watermarkText ?? ''} onChange={(e) => update({ watermarkText: e.target.value })} className="input-sm w-full" placeholder="水印文字" />
      )}
      <div className="grid grid-cols-3 gap-2">
        <label className="text-[11px] text-gray-500">
          透明度
          <input type="number" min={0} max={1} step={0.05} value={step.opacity ?? 0.3} onChange={(e) => update({ opacity: Number(e.target.value) })} className="input-sm mt-1 w-full" />
        </label>
        <label className="text-[11px] text-gray-500">
          字号/比例
          <input type="number" value={step.watermarkMode === 'image' ? step.scale ?? 0.2 : step.fontSize ?? 48} onChange={(e) => step.watermarkMode === 'image' ? update({ scale: Number(e.target.value) }) : update({ fontSize: Number(e.target.value) })} className="input-sm mt-1 w-full" />
        </label>
        <label className="text-[11px] text-gray-500">
          角度
          <input type="number" value={step.angle ?? 0} onChange={(e) => update({ angle: Number(e.target.value) })} className="input-sm mt-1 w-full" />
        </label>
      </div>
      {step.watermarkMode === 'text' && (
        <input type="color" value={step.color ?? '#ffffff'} onChange={(e) => update({ color: e.target.value })} className="h-8 w-full rounded border border-gray-200 dark:border-gray-700" />
      )}
      <div className="grid grid-cols-2 gap-2">
        <input type="number" value={step.gapX ?? 220} onChange={(e) => update({ gapX: Number(e.target.value) })} className="input-sm" placeholder="水平间距" />
        <input type="number" value={step.gapY ?? 160} onChange={(e) => update({ gapY: Number(e.target.value) })} className="input-sm" placeholder="垂直间距" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select value={step.position ?? 'center'} onChange={(e) => update({ position: e.target.value })} className="input-sm">
          <option value="tl">左上</option>
          <option value="tr">右上</option>
          <option value="bl">左下</option>
          <option value="br">右下</option>
          <option value="center">居中</option>
        </select>
        <input type="number" value={step.offsetX ?? 0} onChange={(e) => update({ offsetX: Number(e.target.value) })} className="input-sm" placeholder="X 偏移" />
        <input type="number" value={step.offsetY ?? 0} onChange={(e) => update({ offsetY: Number(e.target.value) })} className="input-sm" placeholder="Y 偏移" />
      </div>
    </div>
  );
}

function NumberPair({ left, right, onLeft, onRight }: { left: number; right: number; onLeft: (v: number) => void; onRight: (v: number) => void }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <input type="number" value={left} onChange={(e) => onLeft(Number(e.target.value) || 1)} className="input-sm" />
      <span className="text-xs text-gray-400">×</span>
      <input type="number" value={right} onChange={(e) => onRight(Number(e.target.value) || 1)} className="input-sm" />
    </div>
  );
}

function Stat({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray' | 'green' | 'red' }) {
  const color = tone === 'green' ? 'text-green-600 dark:text-green-300' : tone === 'red' ? 'text-red-600 dark:text-red-300' : 'text-gray-800 dark:text-gray-100';
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function Status({ item }: { item: ImageItem }) {
  if (item.status === 'processing') {
    return <span className="inline-flex items-center gap-1.5 text-xs text-blue-500"><Loader2 size={14} className="animate-spin" />处理中</span>;
  }
  if (item.status === 'done') {
    return <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-300"><CheckCircle2 size={14} />完成</span>;
  }
  if (item.status === 'error') {
    return <span className="inline-flex items-start gap-1.5 text-xs text-red-600 dark:text-red-300"><AlertCircle size={14} className="mt-0.5" />{item.error}</span>;
  }
  return <span className="text-xs text-gray-400">待处理</span>;
}
