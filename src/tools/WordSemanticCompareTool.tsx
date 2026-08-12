import { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { AlertCircle, BarChart3, CheckCircle, FileText, Loader, Play, Settings2, Upload } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  useWordAiModelRuntime,
  WordAiManualModelGuide,
  WordAiModelPrepPanel,
} from './WordAiModelPrep';
import {
  clampThreshold,
  percent,
  pickWordFiles,
  similarityTone,
  type SelectedWordFile,
  type WordCompareResult,
  type WordSimilarityMatch,
} from './wordSemanticTypes';

export default function WordSemanticCompareTool() {
  const ready = useToolTheme();
  const modelRuntime = useWordAiModelRuntime();
  const [leftFile, setLeftFile] = useState<SelectedWordFile | null>(null);
  const [rightFile, setRightFile] = useState<SelectedWordFile | null>(null);
  const [threshold, setThreshold] = useState(0.76);
  const [maxResults, setMaxResults] = useState(80);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<WordCompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRun = !!leftFile && !!rightFile && modelRuntime.modelReady && !processing;

  async function selectSide(side: 'left' | 'right') {
    const picked = await pickWordFiles(false);
    const file = picked[0];
    if (!file) return;
    if (side === 'left') setLeftFile(file);
    else setRightFile(file);
    setResult(null);
    setError(null);
  }

  async function runCompare() {
    if (!leftFile || !rightFile) {
      setError('请先选择两个 Word 文档。');
      return;
    }
    if (!modelRuntime.modelReady) {
      setError('请先准备 AI 文档语义模型。');
      return;
    }
    setProcessing(true);
    setResult(null);
    setError(null);
    try {
      const data = await invoke<WordCompareResult>('word_ai_compare_documents', {
        leftPath: leftFile.path,
        rightPath: rightFile.path,
        options: {
          threshold: clampThreshold(threshold),
          maxResults,
        },
      });
      setResult(data);
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
        icon="🧭"
        title="AI 双文档语义对比"
        subtitle="比较两个 Word 文档的段落语义覆盖和相似内容"
      />

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-5 overflow-auto p-6 lg:grid-cols-[1fr_360px]">
        <main className="space-y-5">
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

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="grid gap-4 md:grid-cols-2">
              <FilePicker title="原文档" file={leftFile} onPick={() => selectSide('left')} />
              <FilePicker title="对比文档" file={rightFile} onPick={() => selectSide('right')} />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={runCompare}
                disabled={!canRun}
                className="flex items-center gap-2 rounded-lg bg-teal-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              >
                {processing ? <Loader size={16} className="animate-spin" /> : <Play size={16} />}
                {processing ? '对比中...' : '开始语义对比'}
              </button>
              <p className="text-xs text-gray-400">输出相似段落和语义覆盖率，不修改原文档。</p>
            </div>
          </section>

          {error && <ErrorBox message={error} />}
          {result && <CompareResultPanel result={result} />}
        </main>

        <aside className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Settings2 size={16} />
              对比参数
            </h3>
            <label className="block">
              <span className="mb-2 block text-xs text-gray-500">命中阈值：{percent(threshold)}</span>
              <input
                type="range"
                min={0.6}
                max={0.95}
                step={0.01}
                value={threshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
                className="w-full"
              />
            </label>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs text-gray-500">最多结果</span>
              <input
                type="number"
                min={10}
                max={500}
                value={maxResults}
                onChange={(event) => setMaxResults(Number(event.target.value))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
              />
            </label>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <BarChart3 size={16} />
              指标说明
            </h3>
            <p className="text-xs leading-6 text-gray-500 dark:text-gray-400">
              平均最佳相似度表示原文档每段在对比文档中的最佳匹配均值；覆盖率表示超过阈值的段落占比。
            </p>
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

function FilePicker({ title, file, onPick }: { title: string; file: SelectedWordFile | null; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="min-h-36 rounded-xl border border-gray-200 bg-gray-50 p-4 text-left transition-colors hover:border-teal-300 hover:bg-teal-50 dark:border-gray-700 dark:bg-gray-900/50 dark:hover:bg-teal-900/10"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <FileText size={16} />
          {title}
        </span>
        <Upload size={15} className="text-gray-400" />
      </div>
      {file ? (
        <>
          <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{file.name}</p>
          <p className="mt-1 line-clamp-2 break-all text-xs text-gray-400">{file.path}</p>
        </>
      ) : (
        <p className="text-sm text-gray-400">点击选择 `.docx` 文件</p>
      )}
    </button>
  );
}

function CompareResultPanel({ result }: { result: WordCompareResult }) {
  return (
    <section className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-300">
      <div className="flex items-start gap-3">
        <CheckCircle size={18} className="mt-0.5 text-green-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">语义对比完成</p>
          <p className="mt-1 text-xs opacity-90">
            原文档段落 {result.leftParagraphCount} 个 · 对比文档段落 {result.rightParagraphCount} 个 · 平均最佳相似度{' '}
            {percent(result.averageBestScore)} · 覆盖率 {percent(result.coverage)}
          </p>
          <div className="mt-3 max-h-[420px] space-y-3 overflow-auto pr-1">
            {result.matches.length === 0 ? (
              <p className="rounded-lg bg-white/70 p-3 text-xs dark:bg-gray-800/60">未找到超过阈值的语义匹配段落。</p>
            ) : (
              result.matches.map((match, index) => <MatchCard key={index} match={match} />)
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MatchCard({ match }: { match: WordSimilarityMatch }) {
  return (
    <div className="rounded-lg bg-white/80 p-3 text-xs text-gray-700 dark:bg-gray-800/70 dark:text-gray-200">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className={`text-sm font-semibold ${similarityTone(match.score)}`}>{percent(match.score)}</span>
        <span className="truncate text-gray-400">
          #{match.left.paragraphIndex} ↔ #{match.right.paragraphIndex}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <p className="rounded-md bg-gray-50 p-2 leading-5 dark:bg-gray-900/60">{match.left.text}</p>
        <p className="rounded-md bg-gray-50 p-2 leading-5 dark:bg-gray-900/60">{match.right.text}</p>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300">
      <div className="flex items-start gap-3">
        <AlertCircle size={18} className="mt-0.5 text-red-500" />
        <p className="flex-1 whitespace-pre-wrap text-sm">{message}</p>
      </div>
    </div>
  );
}
