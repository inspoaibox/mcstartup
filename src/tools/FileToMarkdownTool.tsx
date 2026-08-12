import { useEffect, useState, type ReactNode } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import { open as openExternal } from '@tauri-apps/api/shell';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  List,
  Loader,
  RefreshCw,
  Settings,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { formatBytes } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';

type RuntimeStatusKind = 'checking' | 'missing' | 'installing' | 'ready' | 'error';
type CloudMode = 'local' | 'docintel' | 'contentUnderstanding';

interface MarkitdownRuntimeStatus {
  ready: boolean;
  mode: string;
  pythonPath?: string | null;
  pythonVersion?: string | null;
  packageVersion?: string | null;
  installDir: string;
  message: string;
  docsUrl: string;
}

interface MarkitdownPluginInfo {
  name: string;
  value: string;
}

interface MarkitdownConvertResult {
  outputPath: string;
  outputSize: number;
  title?: string | null;
  characters: number;
  preview: string;
  pythonPath: string;
  packageVersion?: string | null;
  commandSummary: string;
}

interface SelectedFile {
  path: string;
  name: string;
}

interface MarkitdownRuntimeState {
  runtime: MarkitdownRuntimeStatus | null;
  runtimeStatus: RuntimeStatusKind;
  runtimeReady: boolean;
  runtimeError: string | null;
  installProgress: number;
  installMessage: string;
  refreshRuntime: () => Promise<void>;
  installRuntime: () => Promise<void>;
  choosePython: () => Promise<void>;
  clearPythonPath: () => Promise<void>;
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function stem(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

function openMarkitdownDocs(url?: string | null) {
  void openExternal(url || 'https://github.com/microsoft/markitdown');
}

function resolveRuntimeStatus(runtime: MarkitdownRuntimeStatus | null): RuntimeStatusKind {
  if (!runtime) return 'checking';
  if (runtime.ready) return 'ready';
  return 'missing';
}

function useMarkitdownRuntime(): MarkitdownRuntimeState {
  const [runtime, setRuntime] = useState<MarkitdownRuntimeStatus | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusKind>('checking');
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState(0);
  const [installMessage, setInstallMessage] = useState('');

  async function refreshRuntime() {
    setRuntimeStatus('checking');
    setRuntimeError(null);
    try {
      const next = await invoke<MarkitdownRuntimeStatus>('markitdown_check_runtime');
      setRuntime(next);
      setRuntimeStatus(resolveRuntimeStatus(next));
    } catch (err) {
      setRuntimeStatus('error');
      setRuntimeError(String(err));
    }
  }

  async function installRuntime() {
    setRuntimeStatus('installing');
    setRuntimeError(null);
    setInstallProgress(0);
    setInstallMessage('准备安装');
    const unlisten = await listen<{ message?: string; progress?: number }>(
      'markitdown-install-progress',
      (event) => {
        const payload = event.payload || {};
        setInstallMessage(String(payload.message || '安装中'));
        setInstallProgress(Number(payload.progress || 0));
      }
    );

    try {
      const next = await invoke<MarkitdownRuntimeStatus>('markitdown_install_runtime', {
        pythonPath: runtime?.pythonPath || null,
      });
      setRuntime(next);
      setRuntimeStatus(resolveRuntimeStatus(next));
      setInstallProgress(100);
      setInstallMessage('完成');
    } catch (err) {
      setRuntimeStatus('error');
      setRuntimeError(String(err));
    } finally {
      unlisten();
    }
  }

  async function choosePython() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Python', extensions: ['exe'] }],
    });
    if (typeof selected !== 'string') return;
    try {
      const next = await invoke<MarkitdownRuntimeStatus>('markitdown_set_python_path', {
        path: selected,
      });
      setRuntime(next);
      setRuntimeStatus(resolveRuntimeStatus(next));
      setRuntimeError(null);
    } catch (err) {
      setRuntimeStatus('error');
      setRuntimeError(String(err));
    }
  }

  async function clearPythonPath() {
    try {
      const next = await invoke<MarkitdownRuntimeStatus>('markitdown_clear_python_path');
      setRuntime(next);
      setRuntimeStatus(resolveRuntimeStatus(next));
      setRuntimeError(null);
    } catch (err) {
      setRuntimeStatus('error');
      setRuntimeError(String(err));
    }
  }

  useEffect(() => {
    refreshRuntime();
  }, []);

  return {
    runtime,
    runtimeStatus,
    runtimeReady: runtimeStatus === 'ready',
    runtimeError,
    installProgress,
    installMessage,
    refreshRuntime,
    installRuntime,
    choosePython,
    clearPythonPath,
  };
}

export default function FileToMarkdownTool() {
  const ready = useToolTheme();
  const runtimeState = useMarkitdownRuntime();
  const [inputFile, setInputFile] = useState<SelectedFile | null>(null);
  const [enablePlugins, setEnablePlugins] = useState(false);
  const [keepDataUris, setKeepDataUris] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [extensionHint, setExtensionHint] = useState('');
  const [mimeTypeHint, setMimeTypeHint] = useState('');
  const [charsetHint, setCharsetHint] = useState('');
  const [cloudMode, setCloudMode] = useState<CloudMode>('local');
  const [docintelEndpoint, setDocintelEndpoint] = useState('');
  const [cuEndpoint, setCuEndpoint] = useState('');
  const [cuAnalyzer, setCuAnalyzer] = useState('');
  const [cuFileTypes, setCuFileTypes] = useState('');
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [llmModel, setLlmModel] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [llmPrompt, setLlmPrompt] = useState('');
  const [plugins, setPlugins] = useState<MarkitdownPluginInfo[] | null>(null);
  const [loadingPlugins, setLoadingPlugins] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<MarkitdownConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const canConvert = !!inputFile && runtimeState.runtimeReady && !processing;

  async function selectInputFile() {
    const selected = await open({ multiple: false });
    if (typeof selected !== 'string') return;
    setInputFile({ path: selected, name: basename(selected) });
    setResult(null);
    setError(null);
    setCopied(false);
  }

  async function convert() {
    if (!inputFile) return;
    if (!runtimeState.runtimeReady) {
      setError('MarkItDown 未就绪，请先安装或选择可用的 Python 环境。');
      return;
    }

    setProcessing(true);
    setResult(null);
    setError(null);
    setCopied(false);

    try {
      const outputPath = await save({
        defaultPath: `${stem(inputFile.name)}.md`,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      });
      if (!outputPath) {
        setProcessing(false);
        return;
      }

      const converted = await invoke<MarkitdownConvertResult>('markitdown_convert_file', {
        inputPath: inputFile.path,
        outputPath,
        options: {
          enablePlugins,
          keepDataUris,
          extensionHint: extensionHint.trim() || null,
          mimeTypeHint: mimeTypeHint.trim() || null,
          charsetHint: charsetHint.trim() || null,
          useDocintel: cloudMode === 'docintel',
          docintelEndpoint: docintelEndpoint.trim() || null,
          useContentUnderstanding: cloudMode === 'contentUnderstanding',
          contentUnderstandingEndpoint: cuEndpoint.trim() || null,
          contentUnderstandingAnalyzer: cuAnalyzer.trim() || null,
          contentUnderstandingFileTypes: cuFileTypes.trim() || null,
          llmEnabled,
          llmApiKey: llmApiKey.trim() || null,
          llmBaseUrl: llmBaseUrl.trim() || null,
          llmModel: llmModel.trim() || null,
          llmPrompt: llmPrompt.trim() || null,
        },
      });
      setResult(converted);
      await runtimeState.refreshRuntime();
    } catch (err) {
      setError(String(err));
    } finally {
      setProcessing(false);
    }
  }

  async function copyPreview() {
    if (!result?.preview) return;
    await navigator.clipboard.writeText(result.preview);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function loadPlugins() {
    setLoadingPlugins(true);
    setError(null);
    try {
      const items = await invoke<MarkitdownPluginInfo[]>('markitdown_list_plugins');
      setPlugins(items);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingPlugins(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="📝"
        title="文件转 Markdown"
        subtitle="基于 Microsoft MarkItDown 将文档、表格、演示、网页等文件转为 Markdown"
      />

      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 overflow-auto p-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <MarkitdownRuntimePanel runtimeState={runtimeState} />
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <FileBox
              label="输入文件"
              file={inputFile}
              empty="PDF / Word / PPT / Excel / HTML / CSV / JSON / 图片 / 音频等"
            />
            <button
              onClick={selectInputFile}
              disabled={processing}
              className="flex items-center justify-center gap-1 rounded-lg bg-teal-500 px-4 py-2 text-sm text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              <FolderOpen size={14} />
              选择文件
            </button>
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <Settings size={13} />
              高级选项
            </button>
          </div>

          {showAdvanced && (
            <div className="mt-3 space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={enablePlugins}
                    onChange={(event) => setEnablePlugins(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
                  />
                  启用 MarkItDown 插件
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={keepDataUris}
                    onChange={(event) => setKeepDataUris(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
                  />
                  保留 Data URI
                </label>
                <button
                  type="button"
                  onClick={loadPlugins}
                  disabled={!runtimeState.runtimeReady || loadingPlugins}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  {loadingPlugins ? (
                    <Loader size={12} className="animate-spin" />
                  ) : (
                    <List size={12} />
                  )}
                  查看插件
                </button>
              </div>

              {plugins && (
                <div className="rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
                  {plugins.length ? (
                    <div className="space-y-1">
                      {plugins.map((plugin) => (
                        <div
                          key={`${plugin.name}-${plugin.value}`}
                          className="grid gap-2 text-xs text-gray-600 dark:text-gray-300 md:grid-cols-[160px_1fr]"
                        >
                          <span className="font-medium">{plugin.name}</span>
                          <span className="break-all text-gray-400">{plugin.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">未检测到已安装插件</p>
                  )}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                    扩展名提示
                  </span>
                  <input
                    value={extensionHint}
                    onChange={(event) => setExtensionHint(event.target.value)}
                    placeholder=".pdf"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                    MIME 类型
                  </span>
                  <input
                    value={mimeTypeHint}
                    onChange={(event) => setMimeTypeHint(event.target.value)}
                    placeholder="application/pdf"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                    字符集
                  </span>
                  <input
                    value={charsetHint}
                    onChange={(event) => setCharsetHint(event.target.value)}
                    placeholder="utf-8"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                    云端增强
                  </span>
                  <select
                    value={cloudMode}
                    onChange={(event) => setCloudMode(event.target.value as CloudMode)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                  >
                    <option value="local">本地转换</option>
                    <option value="docintel">Document Intelligence</option>
                    <option value="contentUnderstanding">Content Understanding</option>
                  </select>
                </label>

                {cloudMode === 'docintel' && (
                  <label className="block">
                    <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                      Document Intelligence Endpoint
                    </span>
                    <input
                      value={docintelEndpoint}
                      onChange={(event) => setDocintelEndpoint(event.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                    />
                  </label>
                )}

                {cloudMode === 'contentUnderstanding' && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                        CU Endpoint
                      </span>
                      <input
                        value={cuEndpoint}
                        onChange={(event) => setCuEndpoint(event.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                        Analyzer
                      </span>
                      <input
                        value={cuAnalyzer}
                        onChange={(event) => setCuAnalyzer(event.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                        文件类型
                      </span>
                      <input
                        value={cuFileTypes}
                        onChange={(event) => setCuFileTypes(event.target.value)}
                        placeholder="pdf,jpeg,mp4"
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={llmEnabled}
                    onChange={(event) => setLlmEnabled(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
                  />
                  LLM 图片描述
                </label>
                {llmEnabled && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                        模型
                      </span>
                      <input
                        value={llmModel}
                        onChange={(event) => setLlmModel(event.target.value)}
                        placeholder="gpt-4o"
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                        API Key
                      </span>
                      <input
                        type="password"
                        value={llmApiKey}
                        onChange={(event) => setLlmApiKey(event.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                        Base URL
                      </span>
                      <input
                        value={llmBaseUrl}
                        onChange={(event) => setLlmBaseUrl(event.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                        Prompt
                      </span>
                      <input
                        value={llmPrompt}
                        onChange={(event) => setLlmPrompt(event.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={convert}
              disabled={!canConvert}
              className="flex items-center gap-2 rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {processing ? <Loader size={14} className="animate-spin" /> : <FileText size={14} />}
              {processing ? '转换中...' : '转换为 Markdown'}
            </button>
            <p className="text-xs text-gray-400">
              输出为 UTF-8 Markdown 文件，转换能力取决于当前 Python 环境中的 MarkItDown extras。
            </p>
          </div>
        </section>

        {result && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm dark:border-emerald-800/40 dark:bg-emerald-900/15">
            <div className="flex items-start gap-3">
              <CheckCircle size={18} className="mt-0.5 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  转换完成
                </p>
                <p className="mt-1 break-all text-xs text-emerald-700/85 dark:text-emerald-200/90">
                  输出文件：{result.outputPath}
                </p>
                <p className="mt-1 text-xs text-emerald-700/75 dark:text-emerald-200/80">
                  {result.commandSummary} · {formatBytes(result.outputSize)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => invoke('open_file', { path: result.outputPath })}
                    className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs text-white hover:bg-emerald-600"
                  >
                    打开文件
                  </button>
                  <button
                    onClick={() => invoke('show_in_folder', { path: result.outputPath })}
                    className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/35"
                  >
                    打开所在目录
                  </button>
                  <button
                    onClick={copyPreview}
                    disabled={!result.preview}
                    className="flex items-center gap-1 rounded-lg border border-emerald-300 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/35"
                  >
                    <Copy size={12} />
                    {copied ? '已复制' : '复制预览'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {result?.preview && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Markdown 预览</p>
              <span className="text-xs text-gray-400">前 8000 字符</span>
            </div>
            <textarea
              readOnly
              value={result.preview}
              className="h-72 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-700 outline-none dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-200"
            />
          </section>
        )}

        {error && <ErrorPanel message={error} />}
      </div>
    </div>
  );
}

function MarkitdownRuntimePanel({ runtimeState }: { runtimeState: MarkitdownRuntimeState }) {
  const {
    runtime,
    runtimeStatus,
    runtimeError,
    installProgress,
    installMessage,
    refreshRuntime,
    installRuntime,
    choosePython,
    clearPythonPath,
  } = runtimeState;

  if (runtimeStatus === 'checking') {
    return (
      <RuntimeNotice
        icon={<Loader size={16} className="animate-spin text-blue-500" />}
        title="检查 MarkItDown 状态..."
        subtitle="正在检测 Python 与 markitdown 包。"
      />
    );
  }

  if (runtimeStatus === 'ready' && runtime) {
    return (
      <RuntimeNotice
        icon={<CheckCircle size={16} className="text-emerald-500" />}
        title="MarkItDown 已就绪"
        subtitle={`${runtime.packageVersion || 'markitdown'} · ${
          runtime.mode === 'cached'
            ? '本地缓存'
            : runtime.mode === 'custom'
              ? '自定义 Python'
              : '系统 Python'
        }${runtime.pythonVersion ? ` · ${runtime.pythonVersion}` : ''}`}
        actions={
          <>
            <button
              onClick={() => invoke('open_path', { targetPath: runtime.installDir })}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              打开运行时目录
            </button>
            <button
              onClick={refreshRuntime}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <RefreshCw size={12} />
              重新检测
            </button>
            <button
              onClick={installRuntime}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <Download size={12} />
              更新 MarkItDown
            </button>
            <button
              onClick={choosePython}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              选择 python.exe
            </button>
            <button
              onClick={clearPythonPath}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              自动检测
            </button>
            <button
              onClick={() => openMarkitdownDocs(runtime.docsUrl)}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <ExternalLink size={12} />
              官方项目
            </button>
          </>
        }
      />
    );
  }

  return (
    <RuntimeNotice
      icon={
        runtimeStatus === 'installing' ? (
          <Loader size={16} className="animate-spin text-blue-500" />
        ) : (
          <AlertCircle size={16} className="text-amber-500" />
        )
      }
      title={runtimeStatus === 'installing' ? '安装 MarkItDown 中...' : '需要准备 MarkItDown'}
      subtitle={
        runtimeStatus === 'installing'
          ? `${installProgress}% ${installMessage ? `· ${installMessage}` : ''}`
          : runtime?.message || runtimeError || '当前环境未安装 MarkItDown。'
      }
      progress={runtimeStatus === 'installing' ? installProgress : undefined}
      actions={
        <>
          {runtimeStatus !== 'installing' && (
            <>
              <button
                onClick={installRuntime}
                className="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600"
              >
                <Download size={12} />
                安装到本地缓存
              </button>
              <button
                onClick={choosePython}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                选择 python.exe
              </button>
              <button
                onClick={clearPythonPath}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                自动检测
              </button>
            </>
          )}
          <button
            onClick={() => openMarkitdownDocs(runtime?.docsUrl)}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ExternalLink size={12} />
            官方项目
          </button>
        </>
      }
    />
  );
}

function FileBox({
  label,
  file,
  empty,
}: {
  label: string;
  file: SelectedFile | null;
  empty: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-gray-700 dark:text-gray-200">
        {file ? file.name : empty}
      </p>
      {file && (
        <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">{file.path}</p>
      )}
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <section className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm dark:border-red-800/40 dark:bg-red-900/15">
      <div className="flex items-start gap-3">
        <AlertCircle size={18} className="mt-0.5 text-red-500" />
        <p className="whitespace-pre-wrap text-sm text-red-700 dark:text-red-300">{message}</p>
      </div>
    </section>
  );
}

function RuntimeNotice({
  icon,
  title,
  subtitle,
  actions,
  progress,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  progress?: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{title}</p>
          <p className="mt-0.5 break-all text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
      </div>
      {typeof progress === 'number' && (
        <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
