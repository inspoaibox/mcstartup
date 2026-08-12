import { useState, type ReactNode } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  resolveWordAiModelStatus,
  useWordAiModelRuntime,
  WordAiManualModelGuide,
  WordAiModelPrepPanel,
  type WordAiStatus,
} from './WordAiModelPrep';
import {
  AlertCircle,
  Brain,
  CheckCircle,
  FileText,
  FolderOpen,
  ListTree,
  Loader,
  Play,
  Settings2,
  Sparkles,
  Tags,
  Trash2,
  Upload,
} from 'lucide-react';

type AnalysisMode = 'rules' | 'ai';

interface SelectedFile {
  path: string;
  name: string;
}

interface WordOutlineItem {
  level: number;
  text: string;
}

interface WordStructureCounts {
  heading: number;
  body: number;
  list: number;
  note: number;
}

interface WordFormatResult {
  outputPath: string;
  paragraphCount: number;
  headingCount: number;
  removedEmptyParagraphs: number;
  normalizedSpacingCount: number;
  keywordCount: number;
  keywords: string[];
  summary: string[];
  outline: WordOutlineItem[];
  structureCounts: WordStructureCounts;
  aiStatus: WordAiStatus;
}

const FONT_OPTIONS = ['Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong', 'Arial'];

export default function WordFormatTool() {
  const ready = useToolTheme();
  const modelRuntime = useWordAiModelRuntime();
  const [mode, setMode] = useState<AnalysisMode>('rules');
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<WordFormatResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fontFamily, setFontFamily] = useState('Microsoft YaHei');
  const [bodyFontSize, setBodyFontSize] = useState(11);
  const [lineSpacing, setLineSpacing] = useState(1.5);
  const [paragraphSpacing, setParagraphSpacing] = useState(6);
  const [pageMarginCm, setPageMarginCm] = useState(2.54);
  const [standardFormatting, setStandardFormatting] = useState(true);
  const [smartHeadingDetection, setSmartHeadingDetection] = useState(true);
  const [optimizeStructure, setOptimizeStructure] = useState(true);
  const [generateToc, setGenerateToc] = useState(true);
  const [extractKeywords, setExtractKeywords] = useState(true);
  const [includeKeywordsInDocument, setIncludeKeywordsInDocument] = useState(false);
  const [generateSummary, setGenerateSummary] = useState(true);
  const [cleanEmptyParagraphs, setCleanEmptyParagraphs] = useState(true);
  const [normalizeSpaces, setNormalizeSpaces] = useState(true);

  const runLabel = mode === 'ai' ? 'AI 判断整理' : '规则自动整理';
  const canProcess = !!file && !processing && (mode === 'rules' || modelRuntime.modelReady);

  async function selectFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    });
    if (typeof selected !== 'string') return;
    setFile({
      path: selected,
      name: selected.split(/[\\/]/).pop() || selected,
    });
    setResult(null);
    setError(null);
  }

  async function handleDrop(fileLike: File & { path?: string }) {
    if (!fileLike?.path) return;
    setFile({
      path: fileLike.path,
      name: fileLike.name || fileLike.path.split(/[\\/]/).pop() || fileLike.path,
    });
    setResult(null);
    setError(null);
  }

  async function handleProcess() {
    if (!file) return;
    if (mode === 'ai' && !modelRuntime.modelReady) {
      setError('AI 判断整理需要先准备本地模型。请下载模型或按手动说明放入指定目录。');
      return;
    }

    setProcessing(true);
    setResult(null);
    setError(null);

    try {
      const stem = file.name.replace(/\.[^.]+$/, '');
      const outputPath = await save({
        defaultPath: `${stem}_${mode === 'ai' ? 'AI判断整理' : '规则自动整理'}.docx`,
        filters: [{ name: 'Word 文档', extensions: ['docx'] }],
      });
      if (!outputPath) {
        setProcessing(false);
        return;
      }

      const formatted = await invoke<WordFormatResult>('word_format_document', {
        inputPath: file.path,
        outputPath,
        options: {
          analysisMode: mode,
          fontFamily,
          bodyFontSize,
          lineSpacing,
          paragraphSpacing,
          pageMarginCm,
          cleanEmptyParagraphs,
          normalizeSpaces,
          detectHeadings: smartHeadingDetection,
          standardFormatting,
          smartHeadingDetection,
          optimizeStructure,
          generateToc,
          extractKeywords,
          generateSummary,
          includeKeywordsInDocument,
        },
      });
      setResult(formatted);
      modelRuntime.setRuntime(formatted.aiStatus);
      modelRuntime.setModelStatus(resolveWordAiModelStatus(formatted.aiStatus));
    } catch (err) {
      setError(String(err));
    } finally {
      setProcessing(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="🧠"
        title="AI 文档智能整理"
        subtitle="AI 只做判断，规则负责排版写入，避免生成不可打开的 Word 文件"
      />

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-5 overflow-auto p-6 lg:grid-cols-[1fr_380px]">
        <main className="space-y-5">
          <ModeTabs mode={mode} onChange={setMode} modelReady={modelRuntime.modelReady} />

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <FileText size={16} />
                选择 Word 文档
              </h3>
              <button
                onClick={selectFile}
                disabled={processing}
                className="rounded-lg bg-teal-50 px-3 py-1.5 text-xs text-teal-600 transition-colors hover:bg-teal-100 disabled:opacity-50 dark:bg-teal-900/20 dark:text-teal-400 dark:hover:bg-teal-900/40"
              >
                选择文件
              </button>
            </div>

            {!file ? (
              <div
                onClick={selectFile}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={async (event) => {
                  event.preventDefault();
                  setDragging(false);
                  const dropped = Array.from(event.dataTransfer.files)[0] as File & { path?: string };
                  await handleDrop(dropped);
                }}
                className={`flex h-44 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                  dragging
                    ? 'border-teal-400 bg-teal-50 dark:bg-teal-900/10'
                    : 'border-gray-300 hover:border-teal-400 hover:bg-teal-50 dark:border-gray-600 dark:hover:bg-teal-900/10'
                }`}
              >
                <Upload size={30} className="mb-2 text-gray-400" />
                <p className="text-sm text-gray-500 dark:text-gray-400">点击选择或拖入 `.docx`</p>
                <p className="mt-1 text-xs text-gray-400">输出新文件，原文档不会被覆盖</p>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-700/30">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText size={20} className="flex-shrink-0 text-teal-500" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-700 dark:text-gray-200">
                      {file.name}
                    </p>
                    <p className="truncate text-xs text-gray-400 dark:text-gray-500">{file.path}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setFile(null);
                    setResult(null);
                    setError(null);
                  }}
                  disabled={processing}
                  className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={handleProcess}
                disabled={!canProcess}
                className="flex items-center gap-2 rounded-lg bg-teal-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              >
                {processing ? (
                  <>
                    <Loader size={16} className="animate-spin" />
                    {runLabel}中...
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    开始{runLabel}
                  </>
                )}
              </button>
              <p className="text-xs text-gray-400">
                {mode === 'ai'
                  ? 'AI 只判断段落类型，Word 写入仍由规则层完成。'
                  : '无需模型，使用后端规则完成快速整理。'}
              </p>
            </div>
          </section>

          {mode === 'ai' && (
            <WordAiModelPrepPanel
              runtime={modelRuntime.runtime}
              status={modelRuntime.modelStatus}
              progress={modelRuntime.downloadProgress}
              file={modelRuntime.downloadFile}
              error={modelRuntime.modelError}
              onDownload={modelRuntime.downloadModels}
              onRetry={modelRuntime.refreshRuntime}
              onManual={() => modelRuntime.setShowManualGuide(true)}
            />
          )}

          {result && <ResultPanel result={result} />}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300">
              <div className="flex items-start gap-3">
                <AlertCircle size={18} className="mt-0.5 text-red-500" />
                <p className="flex-1 whitespace-pre-wrap text-sm">{error}</p>
              </div>
            </div>
          )}
        </main>

        <aside className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Sparkles size={16} />
              整理能力
            </h3>
            <div className="space-y-2">
              <OptionToggle
                checked={standardFormatting}
                onChange={setStandardFormatting}
                icon={<FileText size={15} />}
                label="标准排版"
              />
              <OptionToggle
                checked={smartHeadingDetection}
                onChange={setSmartHeadingDetection}
                icon={<Brain size={15} />}
                label={mode === 'ai' ? 'AI 判断标题层级' : '规则识别标题层级'}
              />
              <OptionToggle
                checked={optimizeStructure}
                onChange={setOptimizeStructure}
                icon={<ListTree size={15} />}
                label="段落结构优化"
              />
              <OptionToggle
                checked={generateToc}
                onChange={setGenerateToc}
                icon={<ListTree size={15} />}
                label="生成静态目录页"
              />
              <OptionToggle
                checked={extractKeywords}
                onChange={setExtractKeywords}
                icon={<Tags size={15} />}
                label="提取关键词"
              />
              <OptionToggle
                checked={generateSummary}
                onChange={setGenerateSummary}
                icon={<Sparkles size={15} />}
                label="摘要预览"
              />
              <OptionToggle
                checked={includeKeywordsInDocument}
                onChange={setIncludeKeywordsInDocument}
                icon={<Tags size={15} />}
                label="关键词写入文档"
              />
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Settings2 size={16} />
              排版参数
            </h3>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">字体</span>
                <select
                  value={fontFamily}
                  onChange={(event) => setFontFamily(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                >
                  {FONT_OPTIONS.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <NumberField label="正文字号" value={bodyFontSize} min={9} max={16} onChange={setBodyFontSize} />
                <NumberField label="段后 pt" value={paragraphSpacing} min={0} max={24} onChange={setParagraphSpacing} />
              </div>

              <RangeField
                label="行距"
                value={lineSpacing}
                min={1}
                max={2.5}
                step={0.1}
                suffix=""
                onChange={setLineSpacing}
              />
              <RangeField
                label="页边距"
                value={pageMarginCm}
                min={1.5}
                max={3.5}
                step={0.1}
                suffix=" cm"
                onChange={setPageMarginCm}
              />

              <OptionToggle checked={cleanEmptyParagraphs} onChange={setCleanEmptyParagraphs} label="清理空段落" />
              <OptionToggle checked={normalizeSpaces} onChange={setNormalizeSpaces} label="规范空格" />
            </div>
          </section>
        </aside>
      </div>

      {modelRuntime.showManualGuide && modelRuntime.runtime && (
        <WordAiManualModelGuide
          runtime={modelRuntime.runtime}
          modelBaseDir={modelRuntime.modelBaseDir}
          guideText={modelRuntime.manualGuideText}
          copyHint={modelRuntime.copyHint}
          onClose={() => modelRuntime.setShowManualGuide(false)}
          onCopy={modelRuntime.copyManualGuide}
          onOpenDir={modelRuntime.openModelDir}
        />
      )}
    </div>
  );
}

function ModeTabs({
  mode,
  modelReady,
  onChange,
}: {
  mode: AnalysisMode;
  modelReady: boolean;
  onChange: (mode: AnalysisMode) => void;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="grid gap-2 sm:grid-cols-2">
        <ModeButton
          active={mode === 'rules'}
          icon={<Settings2 size={16} />}
          title="规则自动处理"
          desc="无需模型，稳定快速"
          onClick={() => onChange('rules')}
        />
        <ModeButton
          active={mode === 'ai'}
          icon={<Brain size={16} />}
          title="AI 判断规则处理"
          desc={modelReady ? '本地模型已就绪' : '需要先准备本地模型'}
          onClick={() => onChange('ai')}
        />
      </div>
    </section>
  );
}

function ModeButton({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
        active
          ? 'border-teal-400 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-900/30 dark:text-teal-200'
          : 'border-transparent bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-900/50 dark:text-gray-300 dark:hover:bg-gray-700'
      }`}
    >
      {icon}
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs opacity-75">{desc}</span>
      </span>
    </button>
  );
}

function ResultPanel({ result }: { result: WordFormatResult }) {
  return (
    <section className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-300">
      <div className="flex items-start gap-3">
        <CheckCircle size={18} className="mt-0.5 text-green-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">整理完成</p>
          <p className="mt-1 text-xs opacity-90">
            段落 {result.paragraphCount} 个 · 标题 {result.headingCount} 个 · 列表{' '}
            {result.structureCounts.list} 个 · 说明 {result.structureCounts.note} 个 · 删除空段{' '}
            {result.removedEmptyParagraphs} 个
          </p>
          <p className="mt-1 truncate text-xs opacity-75">{result.outputPath}</p>

          {result.keywords.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {result.keywords.map((word) => (
                <span key={word} className="rounded-full bg-white px-2 py-1 text-xs text-green-700 dark:bg-gray-800 dark:text-green-300">
                  {word}
                </span>
              ))}
            </div>
          )}

          {result.outline.length > 0 && (
            <div className="mt-3 rounded-lg bg-white/70 p-3 dark:bg-gray-800/60">
              <p className="mb-2 text-xs font-medium">识别到的静态目录结构</p>
              <div className="max-h-28 space-y-1 overflow-auto text-xs opacity-90">
                {result.outline.slice(0, 12).map((item, index) => (
                  <p key={`${item.text}-${index}`} style={{ paddingLeft: `${(item.level - 1) * 14}px` }}>
                    {item.text}
                  </p>
                ))}
              </div>
            </div>
          )}

          {result.summary.length > 0 && (
            <div className="mt-3 rounded-lg bg-white/70 p-3 dark:bg-gray-800/60">
              <p className="mb-2 text-xs font-medium">摘要预览</p>
              <div className="space-y-1 text-xs opacity-90">
                {result.summary.map((item, index) => (
                  <p key={`${item}-${index}`}>{item}</p>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => invoke('open_file', { path: result.outputPath })}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700"
            >
              <FileText size={13} />
              打开文件
            </button>
            <button
              onClick={() => invoke('show_in_folder', { path: result.outputPath })}
              className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs text-green-700 hover:bg-green-100 dark:bg-gray-800 dark:text-green-300 dark:hover:bg-gray-700"
            >
              <FolderOpen size={13} />
              文件夹
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || min)}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
      />
    </label>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>{label}</span>
        <span>
          {value.toFixed(step < 1 ? 1 : 0)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-teal-500"
      />
    </label>
  );
}

function OptionToggle({
  label,
  checked,
  onChange,
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 flex-shrink-0 accent-teal-500"
      />
    </label>
  );
}
