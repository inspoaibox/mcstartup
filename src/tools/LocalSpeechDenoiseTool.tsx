import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  CheckCircle,
  Download,
  FileAudio,
  FolderOpen,
  Loader,
  Play,
  RefreshCw,
  Settings,
  Upload,
  Waves,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  AUDIO_EXTENSIONS,
  DENOISE_MODEL_ITEMS,
  SHERPA_RUNTIME_ITEM,
  SherpaModelStatus,
  SherpaRuntimeStatus,
  basename,
  chooseModelDir,
  downloadSherpaItems,
  formatBytes,
  initModelDir,
  saveModelDir,
} from './sherpaAudioShared';

interface AudioResult {
  outputPath: string;
  outputSize: number;
  log: string;
}

const denoiseModels = [
  { value: 'dpdfnet4.onnx', label: 'DPDFNet4 16k', desc: '推荐，质量和速度均衡' },
  { value: 'dpdfnet2.onnx', label: 'DPDFNet2 16k', desc: '更快，适合长音频' },
  { value: 'dpdfnet8.onnx', label: 'DPDFNet8 16k', desc: '更强，速度较慢' },
  { value: 'dpdfnet2_48khz_hr.onnx', label: 'DPDFNet2 48k', desc: '高采样率输出' },
];

export default function LocalSpeechDenoiseTool() {
  const ready = useToolTheme();
  const [modelDir, setModelDir] = useState('');
  const [runtime, setRuntime] = useState<SherpaRuntimeStatus | null>(null);
  const [model, setModel] = useState<SherpaModelStatus | null>(null);
  const [inputPath, setInputPath] = useState('');
  const [inputSize, setInputSize] = useState<number | null>(null);
  const [denoiseModel, setDenoiseModel] = useState('dpdfnet4.onnx');
  const [numThreads, setNumThreads] = useState(2);
  const [outputDir, setOutputDir] = useState('');
  const [result, setResult] = useState<AudioResult | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadLabel, setDownloadLabel] = useState('');
  const [checking, setChecking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const refreshStatus = useCallback(
    async (dir = modelDir, selectedModel = denoiseModel) => {
      if (!dir) return;
      setChecking(true);
      try {
        const [runtimeStatus, modelStatus] = await Promise.all([
          invoke<SherpaRuntimeStatus>('sherpa_audio_check_runtime', { modelDir: dir }),
          invoke<SherpaModelStatus>('sherpa_audio_check_model', {
            modelDir: dir,
            tool: 'denoise',
            denoiseModel: selectedModel,
          }),
        ]);
        setRuntime(runtimeStatus);
        setModel(modelStatus);
        setError('');
      } catch (err) {
        setError(String(err));
      } finally {
        setChecking(false);
      }
    },
    [modelDir, denoiseModel]
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
      void refreshStatus(modelDir, denoiseModel);
    }
  }, [modelDir, denoiseModel, refreshStatus]);

  async function changeModelDir() {
    const selected = await chooseModelDir(modelDir);
    if (!selected) return;
    await saveModelDir(selected);
    setModelDir(selected);
    await refreshStatus(selected, denoiseModel);
  }

  async function chooseOutputDir() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') setOutputDir(selected);
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
      const denoiseReady = async () => {
        const status = await invoke<SherpaModelStatus>('sherpa_audio_check_model', {
          modelDir,
          tool: 'denoise',
          denoiseModel,
        });
        return status.ready;
      };
      await downloadSherpaItems(
        modelDir,
        [
          { ...SHERPA_RUNTIME_ITEM, isReady: runtimeReady },
          { ...DENOISE_MODEL_ITEMS[denoiseModel], isReady: denoiseReady },
        ],
        (percent, label) => {
          setDownloadProgress(percent);
          setDownloadLabel(label);
        }
      );
      await refreshStatus(modelDir, denoiseModel);
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
      await refreshStatus(modelDir, denoiseModel);
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

  async function process() {
    if (!inputPath || !runtime?.ready || !model?.ready) return;
    setProcessing(true);
    setResult(null);
    setError('');
    try {
      const response = await invoke<AudioResult>('sherpa_audio_denoise', {
        modelDir,
        inputPath,
        outputDir: outputDir || null,
        options: {
          numThreads,
          denoiseModel,
        },
      });
      setResult(response);
    } catch (err) {
      setError(String(err));
    } finally {
      setProcessing(false);
    }
  }

  if (!ready) return null;
  const canRun = !!inputPath && runtime?.ready && model?.ready && !processing && !downloading;
  const needsDownload = !runtime?.ready || !model?.ready;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="🔊"
        title="本地语音增强 / 降噪"
        subtitle="sherpa-onnx + DPDFNet，本地离线处理"
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
              <div>降噪模型：{model?.ready ? '已就绪' : '未就绪'}</div>
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
            <h2 className="text-sm font-semibold">处理参数</h2>
            <label className="mt-3 block text-xs text-gray-500">
              模型
              <select
                value={denoiseModel}
                onChange={(event) => {
                  setDenoiseModel(event.target.value);
                  void refreshStatus(modelDir, event.target.value);
                }}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              >
                {denoiseModels.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-1 text-xs text-gray-400">
              {denoiseModels.find((item) => item.value === denoiseModel)?.desc}
            </p>
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
              onClick={chooseOutputDir}
              disabled={processing}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <FolderOpen size={15} />
              输出目录
            </button>
            {outputDir && <p className="mt-2 break-all text-xs text-gray-400">{outputDir}</p>}
            <button
              type="button"
              onClick={process}
              disabled={!canRun}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {processing ? <Loader size={16} className="animate-spin" /> : <Waves size={16} />}
              开始增强
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
            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-start gap-3">
                <CheckCircle size={22} className="mt-0.5 text-green-500" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold">增强完成</h2>
                  <p className="mt-1 break-all text-xs text-gray-500">{result.outputPath}</p>
                  <p className="mt-1 text-xs text-gray-500">{formatBytes(result.outputSize)}</p>
                  <audio className="mt-3 w-full" controls src={convertFileSrc(result.outputPath)} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => invoke('open_file', { path: result.outputPath })}
                      className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm text-white hover:bg-teal-700"
                    >
                      <Play size={14} />
                      打开试听
                    </button>
                    <button
                      type="button"
                      onClick={() => invoke('show_in_folder', { path: result.outputPath })}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      <FolderOpen size={14} />
                      定位文件
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className="flex min-h-[560px] flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <Waves size={56} className="text-gray-300 dark:text-gray-600" />
              <h2 className="mt-4 text-base font-semibold">本地语音增强 / 降噪</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
                使用 DPDFNet 模型离线降低背景噪声，输出真实增强后的 WAV 文件。
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
