import { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  CheckCircle,
  FileSearch,
  FileText,
  Loader,
  Search,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react';
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
  type WordSemanticSearchHit,
  type WordSemanticSearchResult,
} from './wordSemanticTypes';

export default function WordSemanticSearchTool() {
  const ready = useToolTheme();
  const modelRuntime = useWordAiModelRuntime();
  const [files, setFiles] = useState<SelectedWordFile[]>([]);
  const [query, setQuery] = useState('');
  const [threshold, setThreshold] = useState(0.35);
  const [maxResults, setMaxResults] = useState(50);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<WordSemanticSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRun = files.length > 0 && query.trim().length >= 2 && modelRuntime.modelReady && !processing;

  async function selectFiles() {
    const picked = await pickWordFiles(true);
    if (picked.length === 0) return;
    setFiles((current) => {
      const seen = new Set(current.map((item) => item.path));
      const merged = [...current];
      for (const file of picked) {
        if (!seen.has(file.path)) {
          seen.add(file.path);
          merged.push(file);
        }
      }
      return merged;
    });
    setResult(null);
    setError(null);
  }

  async function runSearch() {
    if (query.trim().length < 2) {
      setError('请输入至少 2 个字符的搜索内容。');
      return;
    }
    if (files.length === 0) {
      setError('请先选择 Word 文档。');
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
      const data = await invoke<WordSemanticSearchResult>('word_ai_semantic_search', {
        inputPaths: files.map((file) => file.path),
        query,
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
        icon="🗂️"
        title="AI 本地文档语义搜索"
        subtitle="在本机 Word 文档中按语义查找相关段落"
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
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Search size={16} />
                搜索内容
              </span>
              <textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例如：付款违约责任、用户权限设计、上线前风险控制"
                className="h-24 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 dark:border-gray-600 dark:bg-gray-700"
              />
            </label>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={runSearch}
                disabled={!canRun}
                className="flex items-center gap-2 rounded-lg bg-teal-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              >
                {processing ? <Loader size={16} className="animate-spin" /> : <FileSearch size={16} />}
                {processing ? '搜索中...' : '开始语义搜索'}
              </button>
              <p className="text-xs text-gray-400">无需完全匹配关键词，会返回语义相关段落。</p>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <FileText size={16} />
                搜索范围
              </h3>
              <button
                onClick={selectFiles}
                disabled={processing}
                className="rounded-lg bg-teal-50 px-3 py-1.5 text-xs text-teal-600 transition-colors hover:bg-teal-100 disabled:opacity-50 dark:bg-teal-900/20 dark:text-teal-400"
              >
                添加文件
              </button>
            </div>

            {files.length === 0 ? (
              <button
                onClick={selectFiles}
                className="flex h-32 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 transition-colors hover:border-teal-400 hover:bg-teal-50 dark:border-gray-600 dark:hover:bg-teal-900/10"
              >
                <Upload size={26} className="mb-2 text-gray-400" />
                <span className="text-sm text-gray-500 dark:text-gray-400">选择一个或多个 `.docx` 文档</span>
              </button>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-700/30"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="truncate text-xs text-gray-400">{file.path}</p>
                    </div>
                    <button
                      onClick={() => setFiles((current) => current.filter((item) => item.path !== file.path))}
                      className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {error && <ErrorBox message={error} />}
          {result && <SearchResultPanel result={result} />}
        </main>

        <aside className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Settings2 size={16} />
              搜索参数
            </h3>
            <label className="block">
              <span className="mb-2 block text-xs text-gray-500">最低相关度：{percent(threshold)}</span>
              <input
                type="range"
                min={0.1}
                max={0.8}
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
                min={5}
                max={500}
                value={maxResults}
                onChange={(event) => setMaxResults(Number(event.target.value))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
              />
            </label>
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

function SearchResultPanel({ result }: { result: WordSemanticSearchResult }) {
  return (
    <section className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-300">
      <div className="flex items-start gap-3">
        <CheckCircle size={18} className="mt-0.5 text-green-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">搜索完成</p>
          <p className="mt-1 text-xs opacity-90">
            文档 {result.documentCount} 个 · 可分析段落 {result.paragraphCount} 个 · 命中 {result.hits.length} 条
          </p>
          <div className="mt-3 max-h-[420px] space-y-3 overflow-auto pr-1">
            {result.hits.length === 0 ? (
              <p className="rounded-lg bg-white/70 p-3 text-xs dark:bg-gray-800/60">未找到超过最低相关度的段落。</p>
            ) : (
              result.hits.map((hit, index) => <HitCard key={index} hit={hit} />)
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function HitCard({ hit }: { hit: WordSemanticSearchHit }) {
  return (
    <div className="rounded-lg bg-white/80 p-3 text-xs text-gray-700 dark:bg-gray-800/70 dark:text-gray-200">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className={`text-sm font-semibold ${similarityTone(hit.score)}`}>{percent(hit.score)}</span>
        <span className="truncate text-gray-400">
          {hit.paragraph.documentName} #{hit.paragraph.paragraphIndex}
        </span>
      </div>
      <p className="rounded-md bg-gray-50 p-2 leading-5 dark:bg-gray-900/60">{hit.paragraph.text}</p>
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
