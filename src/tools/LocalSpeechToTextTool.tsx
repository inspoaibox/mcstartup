import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  CheckCircle,
  Clipboard,
  Download,
  FileAudio,
  FolderOpen,
  Loader,
  RefreshCw,
  Settings,
  Upload,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  AUDIO_EXTENSIONS,
  PUNCTUATION_MODEL_ITEM,
  SHERPA_RUNTIME_ITEM,
  STT_LATEST_MODEL_ITEM,
  STT_PUNCTUATED_MODEL_ITEM,
  SherpaModelStatus,
  SherpaRuntimeStatus,
  basename,
  chooseModelDir,
  downloadSherpaItems,
  formatBytes,
  initModelDir,
  saveModelDir,
} from './sherpaAudioShared';

interface TranscribeResult {
  text: string;
  rawOutput: string;
  preparedWav?: string | null;
}

const STT_MODEL_VARIANTS = [
  {
    id: 'punctuated',
    label: '中文/英文标点版',
    description: '2024-07-17，原生标点，默认推荐',
    item: STT_PUNCTUATED_MODEL_ITEM,
  },
  {
    id: 'latest',
    label: '新版多语言版',
    description: '2025-09-09，多语言识别，无原生标点',
    item: STT_LATEST_MODEL_ITEM,
  },
] as const;
type SttModelVariant = (typeof STT_MODEL_VARIANTS)[number]['id'];

export default function LocalSpeechToTextTool() {
  const ready = useToolTheme();
  const [modelDir, setModelDir] = useState('');
  const [runtime, setRuntime] = useState<SherpaRuntimeStatus | null>(null);
  const [model, setModel] = useState<SherpaModelStatus | null>(null);
  const [punctuationModel, setPunctuationModel] = useState<SherpaModelStatus | null>(null);
  const [inputPath, setInputPath] = useState('');
  const [inputSize, setInputSize] = useState<number | null>(null);
  const [modelVariant, setModelVariant] = useState<SttModelVariant>('punctuated');
  const [language, setLanguage] = useState('zh');
  const [useItn, setUseItn] = useState(true);
  const [restorePunctuation, setRestorePunctuation] = useState(true);
  const [numThreads, setNumThreads] = useState(2);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadLabel, setDownloadLabel] = useState('');
  const [checking, setChecking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const refreshStatus = useCallback(
    async (dir = modelDir) => {
      if (!dir) return;
      setChecking(true);
      try {
        const [runtimeStatus, modelStatus, punctuationStatus] = await Promise.all([
          invoke<SherpaRuntimeStatus>('sherpa_audio_check_runtime', { modelDir: dir }),
          invoke<SherpaModelStatus>('sherpa_audio_check_model', {
            modelDir: dir,
            tool: 'stt',
            sttModelVariant: modelVariant,
          }),
          invoke<SherpaModelStatus>('sherpa_audio_check_model', { modelDir: dir, tool: 'punctuation' }),
        ]);
        setRuntime(runtimeStatus);
        setModel(modelStatus);
        setPunctuationModel(punctuationStatus);
        setError('');
      } catch (err) {
        setError(String(err));
      } finally {
        setChecking(false);
      }
    },
    [modelDir, modelVariant]
  );

  useEffect(() => {
    void (async () => {
      try {
        const dir = await initModelDir();
        setModelDir(dir);
      } catch (err) {
        setError(String(err));
      }
    })();
  }, []);

  useEffect(() => {
    if (modelDir) {
      void refreshStatus(modelDir);
    }
  }, [modelDir, modelVariant, refreshStatus]);

  async function changeModelDir() {
    const selected = await chooseModelDir(modelDir);
    if (!selected) return;
    await saveModelDir(selected);
    setModelDir(selected);
    await refreshStatus(selected);
  }

  async function downloadAll() {
    if (!modelDir) return;
    setDownloading(true);
    setError('');
    try {
      const runtimeReady = async () => {
        const status = await invoke<SherpaRuntimeStatus>('sherpa_audio_check_runtime', { modelDir });
        return status.ready;
      };
      const sttReady = async () => {
        const status = await invoke<SherpaModelStatus>('sherpa_audio_check_model', {
          modelDir,
          tool: 'stt',
          sttModelVariant: modelVariant,
        });
        return status.ready;
      };
      const punctuationReady = async () => {
        const status = await invoke<SherpaModelStatus>('sherpa_audio_check_model', {
          modelDir,
          tool: 'punctuation',
        });
        return status.ready;
      };
      const selectedModel = STT_MODEL_VARIANTS.find((item) => item.id === modelVariant);
      const items = [
        { ...SHERPA_RUNTIME_ITEM, isReady: runtimeReady },
        { ...(selectedModel?.item || STT_PUNCTUATED_MODEL_ITEM), isReady: sttReady },
      ];
      if (modelVariant === 'latest' && restorePunctuation) {
        items.push({ ...PUNCTUATION_MODEL_ITEM, isReady: punctuationReady });
      }
      await downloadSherpaItems(
        modelDir,
        items,
        (percent, label) => {
          setDownloadProgress(percent);
          setDownloadLabel(label);
        }
      );
      await refreshStatus(modelDir);
    } catch (err) {
      setError(String(err));
    } finally {
      setDownloading(false);
    }
  }

  async function checkCurrentModel() {
    if (!modelDir) return;
    setChecking(true);
    setDownloadProgress(100);
    setDownloadLabel('当前模型已就绪');
    try {
      await refreshStatus(modelDir);
      setError('');
    } catch (err) {
      setError(String(err));
    } finally {
      setChecking(false);
    }
  }

  async function handleModelAction() {
    if (needsDownload) {
      await downloadAll();
    } else {
      await checkCurrentModel();
    }
  }

  async function selectInput() {
    const selected = await open({
      multiple: false,
      filters: [{ name: '音频/视频文件', extensions: AUDIO_EXTENSIONS }],
    });
    if (typeof selected !== 'string') return;
    setInputPath(selected);
    setResult(null);
    setError('');
    try {
      setInputSize(await invoke<number>('get_file_size', { path: selected }));
    } catch {
      setInputSize(null);
    }
  }

  async function transcribe() {
    if (!inputPath || !runtime?.ready || !model?.ready) return;
    setProcessing(true);
    setError('');
    setResult(null);
    try {
      const response = await invoke<TranscribeResult>('sherpa_audio_transcribe', {
        modelDir,
        inputPath,
        options: {
          language,
          useItn,
          numThreads,
          restorePunctuation,
          modelVariant,
        },
      });
      setResult(response);
    } catch (err) {
      setError(String(err));
    } finally {
      setProcessing(false);
    }
  }

  async function copyText() {
    if (!result?.text) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  if (!ready) return null;
  const needsPunctuationModel = restorePunctuation && modelVariant === 'latest';
  const readyToRun =
    !!inputPath &&
    runtime?.ready &&
    model?.ready &&
    (!needsPunctuationModel || punctuationModel?.ready) &&
    !processing &&
    !downloading;
  const selectedVariant = STT_MODEL_VARIANTS.find((item) => item.id === modelVariant);
  const needsDownload = !runtime?.ready || !model?.ready || (needsPunctuationModel && !punctuationModel?.ready);

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="🎙️"
        title="本地语音转文字"
        subtitle="sherpa-onnx + SenseVoice，本地离线识别"
      />

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto pb-4 pr-1">
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">模型与运行时</h2>
              <button
                type="button"
                onClick={() => void refreshStatus()}
                disabled={checking || downloading}
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                title="重新检测"
              >
                {checking ? <Loader size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              </button>
            </div>

            <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
              <div className="break-all">目录：{modelDir || '加载中...'}</div>
              <div className="mt-1">运行时：{runtime?.ready ? '已就绪' : '未就绪'}</div>
              <div>SenseVoice：{model?.ready ? '已就绪' : '未就绪'}</div>
              <div>当前模型：{selectedVariant?.label} / {selectedVariant?.description}</div>
              {modelVariant === 'latest' && (
                <div>中/英文后置标点：{punctuationModel?.ready ? '已就绪' : '未就绪'}</div>
              )}
              {runtime?.version && <div className="mt-1 break-all">{runtime.version}</div>}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={changeModelDir}
                disabled={downloading || processing}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <Settings size={15} />
                模型目录
              </button>
              <button
                type="button"
                onClick={handleModelAction}
                disabled={!modelDir || downloading || processing || checking}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              >
                {downloading || checking ? <Loader size={15} className="animate-spin" /> : <Download size={15} />}
                {needsDownload ? '下载模型' : '检测更新'}
              </button>
            </div>

            {downloading && (
              <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{downloadLabel || '下载中...'}</span>
                  <span>{downloadProgress}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded bg-blue-100 dark:bg-blue-900">
                  <div className="h-full bg-blue-500" style={{ width: `${downloadProgress}%` }} />
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-sm font-semibold">输入文件</h2>
            <button
              type="button"
              onClick={selectInput}
              disabled={processing}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <Upload size={16} />
              选择音频/视频
            </button>
            {inputPath ? (
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <p className="truncate text-sm font-medium">{basename(inputPath)}</p>
                <p className="mt-1 break-all text-xs text-gray-400">{inputPath}</p>
                {inputSize != null && <p className="mt-1 text-xs text-gray-500">{formatBytes(inputSize)}</p>}
              </div>
            ) : (
              <div className="mt-3 flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 text-center text-sm text-gray-400 dark:border-gray-700">
                <FileAudio size={34} className="mb-2 text-gray-300" />
                支持音频和带音轨的视频
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-sm font-semibold">识别参数</h2>
            <label className="mt-3 block text-xs text-gray-500">
              识别模型
              <select
                value={modelVariant}
                onChange={(event) => setModelVariant(event.target.value as SttModelVariant)}
                disabled={processing || downloading}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              >
                {STT_MODEL_VARIANTS.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label} - {variant.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs text-gray-500">
              语言
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              >
                <option value="auto">自动</option>
                <option value="zh">中文</option>
                <option value="en">英文</option>
                <option value="yue">粤语</option>
                <option value="ja">日语</option>
                <option value="ko">韩语</option>
              </select>
            </label>
            <label className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
              <span>{modelVariant === 'punctuated' ? '数字/日期与原生标点规范化' : '数字/日期规范化'}</span>
              <input
                type="checkbox"
                checked={useItn}
                onChange={(event) => setUseItn(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
            </label>
            {modelVariant === 'latest' && (
              <label className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
                <span>中/英文后置标点恢复</span>
                <input
                  type="checkbox"
                  checked={restorePunctuation}
                  onChange={(event) => setRestorePunctuation(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                />
              </label>
            )}
            <label className="mt-3 block text-xs text-gray-500">
              线程数
              <input
                type="number"
                min={1}
                max={8}
                value={numThreads}
                onChange={(event) => setNumThreads(Number(event.target.value) || 1)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              />
            </label>
            <button
              type="button"
              onClick={transcribe}
              disabled={!readyToRun}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {processing ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              开始识别
            </button>
          </section>
        </aside>

        <main className="min-h-0 overflow-auto">
          {error && (
            <section className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <div className="flex items-start gap-2">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />
                <p className="break-words">{error}</p>
              </div>
            </section>
          )}

          {result ? (
            <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
                <div className="flex items-start gap-3">
                  <CheckCircle size={22} className="mt-0.5 text-green-500" />
                  <div>
                    <h2 className="text-sm font-semibold">识别完成</h2>
                    <p className="mt-1 text-xs text-gray-500">本地离线处理完成</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={copyText}
                  className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm text-white hover:bg-teal-700"
                >
                  <Clipboard size={14} />
                  {copied ? '已复制' : '复制文本'}
                </button>
              </div>
              <div className="p-4">
                <textarea
                  value={result.text}
                  onChange={(event) => setResult({ ...result, text: event.target.value })}
                  className="min-h-[360px] w-full resize-y rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm leading-6 text-gray-800 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-100"
                />
                {result.rawOutput && (
                  <details className="mt-3 rounded-lg bg-gray-900 text-xs text-gray-200">
                    <summary className="cursor-pointer px-3 py-2 text-gray-300">查看运行日志</summary>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-3 pb-3">{result.rawOutput}</pre>
                  </details>
                )}
              </div>
            </section>
          ) : (
            <section className="flex min-h-[560px] flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <FileAudio size={56} className="text-gray-300 dark:text-gray-600" />
              <h2 className="mt-4 text-base font-semibold">本地离线语音识别</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
                准备 sherpa-onnx 运行时和 SenseVoice 模型后，选择音频或视频文件进行离线转写。
              </p>
              <button
                type="button"
                onClick={selectInput}
                className="mt-5 flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <FolderOpen size={15} />
                选择文件
              </button>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
