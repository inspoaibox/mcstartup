import { useMemo, useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  AlertCircle,
  Archive,
  CheckCircle,
  Download,
  FolderOpen,
  ImageIcon,
  Info,
  Loader,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';

type ColorMode = 'rgba' | 'rgb';
type SourceMode = 'image' | 'text';
type TextIconShape = 'rounded' | 'square' | 'circle';
type TextBackgroundStyle = 'gradient' | 'solid' | 'transparent';

interface IcoSourceInfo {
  path: string;
  name: string;
  width: number;
  height: number;
}

interface IcoGeneratedFile {
  inputPath: string;
  outputPath: string;
  outputSize: number;
  sizes: number[];
}

interface IcoGenerateResult {
  totalInputs: number;
  generated: IcoGeneratedFile[];
  errors: string[];
  skippedSizes: number[];
  zipPath?: string | null;
}

interface IcoTextIconRequest {
  text: string;
  name: string;
  textColor: string;
  backgroundColor: string;
  backgroundColor2: string;
  shape: TextIconShape;
  backgroundStyle: TextBackgroundStyle;
  paddingPercent: number;
  fontPath: string;
}

const PRESET_SIZES = [16, 24, 32, 48, 64, 72, 96, 128, 256, 512, 768, 1024];
const DEFAULT_SIZES = [16, 24, 32, 48, 256];
const VALID_ICO_MAX_SIZE = 256;
const TEXT_PALETTES = [
  ['#2563eb', '#06b6d4'],
  ['#111827', '#475569'],
  ['#dc2626', '#f97316'],
  ['#16a34a', '#14b8a6'],
  ['#7c3aed', '#db2777'],
  ['#f59e0b', '#ef4444'],
];

function formatBytes(bytes?: number) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function parseCustomSizes(value: string) {
  return value
    .split(/[，,\s]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
    .slice(0, 50);
}

export default function ImageIcoGeneratorTool() {
  const ready = useToolTheme();
  const [sourceMode, setSourceMode] = useState<SourceMode>('image');
  const [items, setItems] = useState<IcoSourceInfo[]>([]);
  const [textValue, setTextValue] = useState('M\nAI\n工具');
  const [textOutputName, setTextOutputName] = useState('');
  const [textColor, setTextColor] = useState('#ffffff');
  const [backgroundColor, setBackgroundColor] = useState('#2563eb');
  const [backgroundColor2, setBackgroundColor2] = useState('#06b6d4');
  const [textShape, setTextShape] = useState<TextIconShape>('rounded');
  const [backgroundStyle, setBackgroundStyle] = useState<TextBackgroundStyle>('gradient');
  const [paddingPercent, setPaddingPercent] = useState(20);
  const [fontPath, setFontPath] = useState('');
  const [selectedSizes, setSelectedSizes] = useState<number[]>(DEFAULT_SIZES);
  const [customSizes, setCustomSizes] = useState('');
  const [colorMode, setColorMode] = useState<ColorMode>('rgba');
  const [recursive, setRecursive] = useState(false);
  const [includeZip, setIncludeZip] = useState(false);
  const [outputDir, setOutputDir] = useState('');
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<IcoGenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const customSizeList = useMemo(() => parseCustomSizes(customSizes), [customSizes]);
  const allSizes = useMemo(() => {
    const values = [...selectedSizes, ...customSizeList];
    values.sort((a, b) => a - b);
    return Array.from(new Set(values));
  }, [customSizeList, selectedSizes]);
  const icoSizes = allSizes.filter((size) => size <= VALID_ICO_MAX_SIZE);
  const oversizedSizes = allSizes.filter((size) => size > VALID_ICO_MAX_SIZE);
  const textIcons = useMemo(() => buildTextIconRequests(), [
    backgroundColor,
    backgroundColor2,
    backgroundStyle,
    fontPath,
    paddingPercent,
    textColor,
    textOutputName,
    textShape,
    textValue,
  ]);
  const hasSource = sourceMode === 'image' ? items.length > 0 : textIcons.length > 0;
  const canRun = hasSource && icoSizes.length > 0 && outputDir && !running;

  function buildTextIconRequests(): IcoTextIconRequest[] {
    const blocks = textValue
      .split(/\n\s*\n/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 50);
    const singleName = textOutputName.trim();
    return blocks.map((text, index) => ({
      text,
      name: blocks.length === 1 ? singleName : singleName ? `${singleName}-${index + 1}` : '',
      textColor,
      backgroundColor,
      backgroundColor2,
      shape: textShape,
      backgroundStyle,
      paddingPercent,
      fontPath,
    }));
  }

  async function inspectAndAdd(paths: string[]) {
    if (paths.length === 0) return;
    setError(null);
    try {
      const scanned = await invoke<IcoSourceInfo[]>('image_ico_inspect_files', { paths });
      mergeItems(scanned);
    } catch (err) {
      setError(String(err));
    }
  }

  function mergeItems(nextItems: IcoSourceInfo[]) {
    setItems((current) => {
      const seen = new Set(current.map((item) => item.path));
      const merged = [...current];
      for (const item of nextItems) {
        if (!seen.has(item.path)) {
          seen.add(item.path);
          merged.push(item);
        }
      }
      return merged;
    });
    setResult(null);
  }

  async function addImages() {
    const selected = await open({
      multiple: true,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'ico'] }],
    });
    if (!selected) return;
    await inspectAndAdd(Array.isArray(selected) ? selected : [selected]);
  }

  async function addDirectory() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== 'string') return;
    setError(null);
    try {
      const scanned = await invoke<IcoSourceInfo[]>('image_ico_scan_directory', {
        path: selected,
        recursive,
      });
      if (scanned.length === 0) {
        setError('该目录下未找到支持的图片文件。');
      }
      mergeItems(scanned);
    } catch (err) {
      setError(String(err));
    }
  }

  async function chooseOutputDir() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') setOutputDir(selected);
  }

  async function chooseFont() {
    const selected = await open({
      multiple: false,
      filters: [{ name: '字体', extensions: ['ttf', 'otf'] }],
    });
    if (typeof selected === 'string') setFontPath(selected);
  }

  function toggleSize(size: number) {
    setSelectedSizes((current) =>
      current.includes(size) ? current.filter((item) => item !== size) : [...current, size].sort((a, b) => a - b)
    );
  }

  async function generateIco() {
    if (!canRun) {
      setError('请先添加图片或输入文字、选择输出目录，并至少选择一个 256×256 以内的 ICO 尺寸。');
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const data = await invoke<IcoGenerateResult>('image_ico_generate', {
        options: {
          inputPaths: sourceMode === 'image' ? items.map((item) => item.path) : [],
          outputDir,
          sizes: allSizes,
          colorMode,
          textIcons: sourceMode === 'text' ? textIcons : [],
          includeZip,
          recursive,
          zipName: 'icons.zip',
        },
      });
      setResult(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader title="ICO 生成器" icon="🧩" subtitle="图片或文字批量生成 Windows ICO，多尺寸图标和 ZIP 打包" />

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-5 overflow-auto p-6 lg:grid-cols-[1fr_360px]">
        <main className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setSourceMode('image');
                  setError(null);
                  setResult(null);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  sourceMode === 'image'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                <ImageIcon size={16} />
                图片生成
              </button>
              <button
                onClick={() => {
                  setSourceMode('text');
                  setError(null);
                  setResult(null);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  sourceMode === 'text'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                <Sparkles size={16} />
                文字生成
              </button>
            </div>
          </section>

          {sourceMode === 'text' && (
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <Sparkles size={16} />
                  文字图标
                </h3>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-600 dark:bg-blue-900/20 dark:text-blue-300">
                  {textIcons.length} 个文字源
                </span>
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500">文字内容</span>
                    <textarea
                      value={textValue}
                      onChange={(event) => {
                        setTextValue(event.target.value);
                        setResult(null);
                      }}
                      placeholder="单个图标可输入 1-3 行文字；多个图标之间空一行"
                      className="h-44 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-blue-400 dark:border-gray-600 dark:bg-gray-700"
                    />
                    <p className="mt-1 text-xs text-gray-400">空一行会拆成多个文字图标；每个图标最多取 3 行。</p>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500">输出名称</span>
                      <input
                        value={textOutputName}
                        onChange={(event) => setTextOutputName(event.target.value)}
                        placeholder="留空则使用文字内容"
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500">字体文件</span>
                      <button
                        onClick={chooseFont}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-blue-300 dark:border-gray-600 dark:bg-gray-700"
                      >
                        <span className="truncate text-gray-600 dark:text-gray-300">
                          {fontPath ? fileNameFromPath(fontPath) : '系统字体 / 手动选择'}
                        </span>
                        <FolderOpen size={15} className="text-gray-400" />
                      </button>
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <SegmentedOption
                      label="形状"
                      value={textShape}
                      options={[
                        ['rounded', '圆角'],
                        ['square', '方形'],
                        ['circle', '圆形'],
                      ]}
                      onChange={(value) => setTextShape(value as TextIconShape)}
                    />
                    <SegmentedOption
                      label="背景"
                      value={backgroundStyle}
                      options={[
                        ['gradient', '渐变'],
                        ['solid', '纯色'],
                        ['transparent', '透明'],
                      ]}
                      onChange={(value) => setBackgroundStyle(value as TextBackgroundStyle)}
                    />
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500">内边距 {paddingPercent}%</span>
                      <input
                        type="range"
                        min={8}
                        max={42}
                        value={paddingPercent}
                        onChange={(event) => setPaddingPercent(Number(event.target.value))}
                        className="h-10 w-full accent-blue-500"
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <ColorField label="文字" value={textColor} onChange={setTextColor} />
                    <ColorField label="背景 A" value={backgroundColor} onChange={setBackgroundColor} />
                    <ColorField label="背景 B" value={backgroundColor2} onChange={setBackgroundColor2} />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {TEXT_PALETTES.map(([a, b]) => (
                      <button
                        key={`${a}-${b}`}
                        onClick={() => {
                          setBackgroundColor(a);
                          setBackgroundColor2(b);
                          setBackgroundStyle('gradient');
                        }}
                        className="h-8 w-14 rounded-lg border border-gray-200 dark:border-gray-700"
                        style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
                        title={`${a} / ${b}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
                    <div
                      className={`mx-auto flex h-44 w-44 items-center justify-center overflow-hidden text-center shadow-inner ${
                        textShape === 'circle' ? 'rounded-full' : textShape === 'square' ? 'rounded-none' : 'rounded-[28px]'
                      }`}
                      style={{
                        color: textColor,
                        background:
                          backgroundStyle === 'transparent'
                            ? 'transparent'
                            : backgroundStyle === 'gradient'
                              ? `linear-gradient(135deg, ${backgroundColor}, ${backgroundColor2})`
                              : backgroundColor,
                      }}
                    >
                      <div className="max-w-[82%] whitespace-pre-line break-words text-5xl font-black leading-tight">
                        {textIcons[0]?.text || 'ICO'}
                      </div>
                    </div>
                    <p className="mt-3 text-center text-xs text-gray-400">实时预览，最终由后端字体引擎生成</p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {sourceMode === 'image' && (
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <ImageIcon size={16} />
                图片列表
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={addImages}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-xs font-medium text-white hover:bg-blue-600"
                >
                  <Plus size={14} />
                  添加图片
                </button>
                <button
                  onClick={addDirectory}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-medium text-white hover:bg-amber-600"
                >
                  <FolderOpen size={14} />
                  添加目录
                </button>
                <button
                  onClick={() => {
                    setItems([]);
                    setResult(null);
                    setError(null);
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-xs font-medium text-white hover:bg-red-600"
                >
                  <Trash2 size={14} />
                  全部清除
                </button>
              </div>
            </div>

            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={async (event) => {
                event.preventDefault();
                setDragging(false);
                const paths = Array.from(event.dataTransfer.files)
                  .map((file) => (file as File & { path?: string }).path)
                  .filter((path): path is string => Boolean(path));
                await inspectAndAdd(paths);
              }}
              onClick={addImages}
              className={`flex h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
                dragging
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/10'
                  : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-900/40 dark:hover:bg-blue-900/10'
              }`}
            >
              <Upload size={28} className="mb-2 text-gray-400" />
              <p className="text-sm text-gray-500 dark:text-gray-400">拖放图片到此处，或单击添加</p>
              <p className="mt-1 text-xs text-gray-400">支持 PNG/JPG/WebP/BMP/TIFF/ICO</p>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
              <span>已添加 {items.length} 张图片</span>
              {items.length > 0 && <span>将为每张图片生成一个 `.ico` 文件</span>}
            </div>

            {items.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                  <div
                    key={item.path}
                    className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50"
                  >
                    <div className="flex aspect-video items-center justify-center bg-white dark:bg-gray-950">
                      <img
                        src={convertFileSrc(item.path)}
                        alt={item.name}
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <div className="space-y-1.5 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.name}</p>
                          <p className="text-xs text-gray-400">
                            {item.width}×{item.height}
                          </p>
                        </div>
                        <button
                          onClick={() => setItems((current) => current.filter((file) => file.path !== item.path))}
                          className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <p className="truncate text-[11px] text-gray-400">{item.path}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}

          {error && <MessageBox tone="error" message={error} />}
          {oversizedSizes.length > 0 && (
            <MessageBox
              tone="info"
              message={`ICO 标准尺寸上限为 256×256，${oversizedSizes.join(' / ')} 会被跳过；如需大图标资源，建议另存 PNG。`}
            />
          )}
          {result && <ResultPanel result={result} outputDir={outputDir} />}
        </main>

        <aside className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Settings2 size={16} />
              生成设置
            </h3>

            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-gray-500">预设尺寸</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedSizes(PRESET_SIZES)}
                      className="rounded-md bg-gray-100 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
                    >
                      全选
                    </button>
                    <button
                      onClick={() => setSelectedSizes([])}
                      className="rounded-md bg-gray-100 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
                    >
                      清空
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {PRESET_SIZES.map((size) => {
                    const selected = selectedSizes.includes(size);
                    const oversized = size > VALID_ICO_MAX_SIZE;
                    return (
                      <button
                        key={size}
                        onClick={() => toggleSize(size)}
                        className={`rounded-lg border px-2 py-2 text-xs transition-colors ${
                          selected
                            ? 'border-blue-500 bg-blue-500 text-white'
                            : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                        } ${oversized ? 'opacity-70' : ''}`}
                      >
                        {size}×{size}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs text-gray-500">自定义尺寸</span>
                <input
                  value={customSizes}
                  onChange={(event) => setCustomSizes(event.target.value)}
                  placeholder="例如：20,40,128"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-gray-600 dark:bg-gray-700"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-gray-500">颜色模式</span>
                <select
                  value={colorMode}
                  onChange={(event) => setColorMode(event.target.value as ColorMode)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                >
                  <option value="rgba">RGB/Alpha（32位，带透明）</option>
                  <option value="rgb">RGB（24位，白底无透明）</option>
                </select>
              </label>

              <label className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/50">
                <span>目录递归扫描</span>
                <input
                  type="checkbox"
                  checked={recursive}
                  onChange={(event) => setRecursive(event.target.checked)}
                  className="h-4 w-4 accent-blue-500"
                />
              </label>

              <label className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/50">
                <span>同时打包 ZIP</span>
                <input
                  type="checkbox"
                  checked={includeZip}
                  onChange={(event) => setIncludeZip(event.target.checked)}
                  className="h-4 w-4 accent-blue-500"
                />
              </label>

              <div>
                <span className="mb-1 block text-xs text-gray-500">输出目录</span>
                <button
                  onClick={chooseOutputDir}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-blue-300 dark:border-gray-600 dark:bg-gray-700"
                >
                  <span className="truncate text-gray-600 dark:text-gray-300">
                    {outputDir || '选择输出目录'}
                  </span>
                  <FolderOpen size={15} className="text-gray-400" />
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Sparkles size={16} />
              输出
            </h3>
            <p className="text-xs leading-6 text-gray-500 dark:text-gray-400">
              当前会写入 {icoSizes.length} 个 ICO 尺寸层：{icoSizes.length ? icoSizes.join(' / ') : '未选择'}。
              {sourceMode === 'text' && ` 文字源 ${textIcons.length} 个。`}
            </p>
            <button
              onClick={generateIco}
              disabled={!canRun}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {running ? <Loader size={16} className="animate-spin" /> : <Download size={16} />}
              {running ? '生成中...' : includeZip ? '生成 ICO 并打包' : '生成 ICO'}
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}

function MessageBox({ tone, message }: { tone: 'error' | 'info'; message: string }) {
  const isError = tone === 'error';
  return (
    <div
      className={`rounded-xl border p-4 text-sm ${
        isError
          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300'
          : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300'
      }`}
    >
      <div className="flex items-start gap-3">
        {isError ? <AlertCircle size={18} className="mt-0.5" /> : <Info size={18} className="mt-0.5" />}
        <p className="flex-1 whitespace-pre-wrap">{message}</p>
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-500">{label}</span>
      <div className="flex rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-600 dark:bg-gray-700">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs outline-none"
        />
      </div>
    </label>
  );
}

function SegmentedOption({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs text-gray-500">{label}</span>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-900">
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            onClick={() => onChange(optionValue)}
            className={`h-8 rounded-md text-xs font-medium transition-colors ${
              value === optionValue
                ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-300'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
            }`}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultPanel({ result, outputDir }: { result: IcoGenerateResult; outputDir: string }) {
  return (
    <section className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-300">
      <div className="flex items-start gap-3">
        <CheckCircle size={18} className="mt-0.5 text-green-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">生成完成</p>
          <p className="mt-1 text-xs opacity-90">
            输入 {result.totalInputs} 张 · 成功 {result.generated.length} 个 · 失败 {result.errors.length} 个
          </p>
          {result.skippedSizes.length > 0 && (
            <p className="mt-1 text-xs opacity-75">已跳过超出 ICO 标准的尺寸：{result.skippedSizes.join(' / ')}</p>
          )}
          <div className="mt-3 max-h-60 space-y-2 overflow-auto pr-1">
            {result.generated.map((item) => (
              <div key={item.outputPath} className="rounded-lg bg-white/80 p-3 text-xs dark:bg-gray-800/70">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{fileNameFromPath(item.outputPath)}</p>
                    <p className="mt-1 truncate opacity-75">
                      {item.sizes.join(' / ')} · {formatBytes(item.outputSize)}
                    </p>
                  </div>
                  <button
                    onClick={() => invoke('open_file', { path: item.outputPath })}
                    className="rounded-md bg-green-600 px-2 py-1 text-white hover:bg-green-700"
                  >
                    打开
                  </button>
                </div>
              </div>
            ))}
          </div>
          {result.zipPath && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white/80 p-3 text-xs dark:bg-gray-800/70">
              <span className="flex min-w-0 items-center gap-2">
                <Archive size={14} />
                <span className="truncate">{result.zipPath}</span>
              </span>
              <button
                onClick={() => invoke('open_file', { path: result.zipPath })}
                className="rounded-md bg-green-600 px-2 py-1 text-white hover:bg-green-700"
              >
                打开 ZIP
              </button>
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="mt-3 rounded-lg bg-white/80 p-3 text-xs text-red-600 dark:bg-gray-800/70 dark:text-red-300">
              {result.errors.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          )}
          <button
            onClick={() => invoke('open_path', { targetPath: outputDir })}
            className="mt-3 flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs text-green-700 hover:bg-green-100 dark:bg-gray-800 dark:text-green-300 dark:hover:bg-gray-700"
          >
            <FolderOpen size={13} />
            打开输出目录
          </button>
        </div>
      </div>
    </section>
  );
}
