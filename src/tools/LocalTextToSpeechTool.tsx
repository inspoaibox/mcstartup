import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  CheckCircle,
  Download,
  FolderOpen,
  Loader,
  Play,
  RefreshCw,
  Settings,
  Volume2,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  SHERPA_RUNTIME_ITEM,
  TTS_INT8_MODEL_ITEM,
  TTS_QUALITY_MODEL_ITEM,
  SherpaModelStatus,
  SherpaRuntimeStatus,
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

interface KokoroVoice {
  id: number;
  name: string;
  language: VoiceLanguage;
  group: string;
  role: VoiceRole;
}

const sampleText = '你好，欢迎使用本地离线文字转语音。';
const previewText = '你好，这是当前音色的本地离线试听。';
const TTS_MODEL_VARIANTS = [
  {
    id: 'quality',
    label: '高质量',
    description: '非量化 Kokoro，音质优先',
    item: TTS_QUALITY_MODEL_ITEM,
  },
  {
    id: 'int8',
    label: '轻量',
    description: 'int8 Kokoro，占用更小',
    item: TTS_INT8_MODEL_ITEM,
  },
] as const;
const KOKORO_VOICE_NAMES = [
  'af_maple',
  'af_sol',
  'bf_vale',
  'zf_001',
  'zf_002',
  'zf_003',
  'zf_004',
  'zf_005',
  'zf_006',
  'zf_007',
  'zf_008',
  'zf_017',
  'zf_018',
  'zf_019',
  'zf_021',
  'zf_022',
  'zf_023',
  'zf_024',
  'zf_026',
  'zf_027',
  'zf_028',
  'zf_032',
  'zf_036',
  'zf_038',
  'zf_039',
  'zf_040',
  'zf_042',
  'zf_043',
  'zf_044',
  'zf_046',
  'zf_047',
  'zf_048',
  'zf_049',
  'zf_051',
  'zf_059',
  'zf_060',
  'zf_067',
  'zf_070',
  'zf_071',
  'zf_072',
  'zf_073',
  'zf_074',
  'zf_075',
  'zf_076',
  'zf_077',
  'zf_078',
  'zf_079',
  'zf_083',
  'zf_084',
  'zf_085',
  'zf_086',
  'zf_087',
  'zf_088',
  'zf_090',
  'zf_092',
  'zf_093',
  'zf_094',
  'zf_099',
  'zm_009',
  'zm_010',
  'zm_011',
  'zm_012',
  'zm_013',
  'zm_014',
  'zm_015',
  'zm_016',
  'zm_020',
  'zm_025',
  'zm_029',
  'zm_030',
  'zm_031',
  'zm_033',
  'zm_034',
  'zm_035',
  'zm_037',
  'zm_041',
  'zm_045',
  'zm_050',
  'zm_052',
  'zm_053',
  'zm_054',
  'zm_055',
  'zm_056',
  'zm_057',
  'zm_058',
  'zm_061',
  'zm_062',
  'zm_063',
  'zm_064',
  'zm_065',
  'zm_066',
  'zm_068',
  'zm_069',
  'zm_080',
  'zm_081',
  'zm_082',
  'zm_089',
  'zm_091',
  'zm_095',
  'zm_096',
  'zm_097',
  'zm_098',
  'zm_100',
];
const VOICE_GROUPS = ['美式女声', '英式女声', '中文女声', '中文男声'];
const KOKORO_VOICES: KokoroVoice[] = KOKORO_VOICE_NAMES.map((name, id) => ({
  id,
  name,
  language: voiceLanguageFor(name),
  group: voiceGroupFor(name),
  role: voiceRoleFor(name),
}));
type TtsModelVariant = (typeof TTS_MODEL_VARIANTS)[number]['id'];
type VoiceLanguage = 'zh' | 'en';
type VoiceRole = 'female' | 'male';

const VOICE_LANGUAGES: { id: VoiceLanguage; label: string }[] = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: '英文' },
];
const VOICE_ROLES: { id: VoiceRole; label: string }[] = [
  { id: 'female', label: '女声' },
  { id: 'male', label: '男声' },
];

function voiceLanguageFor(name: string): VoiceLanguage {
  return name.startsWith('z') ? 'zh' : 'en';
}

function voiceGroupFor(name: string) {
  if (name.startsWith('af_')) return '美式女声';
  if (name.startsWith('bf_')) return '英式女声';
  if (name.startsWith('zf_')) return '中文女声';
  return '中文男声';
}

function voiceRoleFor(name: string): VoiceRole {
  return name.startsWith('zm_') ? 'male' : 'female';
}

export default function LocalTextToSpeechTool() {
  const ready = useToolTheme();
  const [modelDir, setModelDir] = useState('');
  const [runtime, setRuntime] = useState<SherpaRuntimeStatus | null>(null);
  const [model, setModel] = useState<SherpaModelStatus | null>(null);
  const [text, setText] = useState(sampleText);
  const [modelVariant, setModelVariant] = useState<TtsModelVariant>('quality');
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>('zh');
  const [voiceRole, setVoiceRole] = useState<VoiceRole>('female');
  const [speakerId, setSpeakerId] = useState(45);
  const [speed, setSpeed] = useState(1);
  const [numThreads, setNumThreads] = useState(2);
  const [denoiseOutput, setDenoiseOutput] = useState(false);
  const [outputDir, setOutputDir] = useState('');
  const [result, setResult] = useState<AudioResult | null>(null);
  const [preview, setPreview] = useState<AudioResult | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadLabel, setDownloadLabel] = useState('');
  const [checking, setChecking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');

  const refreshStatus = useCallback(
    async (dir = modelDir) => {
      if (!dir) return;
      setChecking(true);
      try {
        const [runtimeStatus, modelStatus] = await Promise.all([
          invoke<SherpaRuntimeStatus>('sherpa_audio_check_runtime', { modelDir: dir }),
          invoke<SherpaModelStatus>('sherpa_audio_check_model', {
            modelDir: dir,
            tool: 'tts',
            ttsModelVariant: modelVariant,
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
  }, [modelVariant, modelDir, refreshStatus]);

  async function changeModelDir() {
    const selected = await chooseModelDir(modelDir);
    if (!selected) return;
    await saveModelDir(selected);
    setModelDir(selected);
    await refreshStatus(selected);
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
      const selectedModel = TTS_MODEL_VARIANTS.find((item) => item.id === modelVariant);
      const runtimeReady = async () => {
        const status = await invoke<SherpaRuntimeStatus>('sherpa_audio_check_runtime', { modelDir });
        return status.ready;
      };
      const modelReady = async () => {
        const status = await invoke<SherpaModelStatus>('sherpa_audio_check_model', {
          modelDir,
          tool: 'tts',
          ttsModelVariant: modelVariant,
        });
        return status.ready;
      };
      await downloadSherpaItems(
        modelDir,
        [
          { ...SHERPA_RUNTIME_ITEM, isReady: runtimeReady },
          { ...(selectedModel?.item || TTS_QUALITY_MODEL_ITEM), isReady: modelReady },
        ],
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

  async function synthesize() {
    if (!runtime?.ready || !model?.ready || !text.trim() || previewing) return;
    setProcessing(true);
    setError('');
    setResult(null);
    try {
      const response = await invoke<AudioResult>('sherpa_audio_tts', {
        modelDir,
        text,
        outputDir: outputDir || null,
        options: {
          speakerId,
          speed,
          numThreads,
          modelVariant,
          denoiseOutput,
        },
      });
      setResult(response);
    } catch (err) {
      setError(String(err));
    } finally {
      setProcessing(false);
    }
  }

  async function previewVoice() {
    if (!runtime?.ready || !model?.ready || processing || downloading) return;
    setPreviewing(true);
    setError('');
    setPreview(null);
    try {
      const response = await invoke<AudioResult>('sherpa_audio_tts', {
        modelDir,
        text: previewText,
        outputDir: null,
        options: {
          speakerId,
          speed,
          numThreads,
          modelVariant,
          denoiseOutput,
        },
      });
      setPreview(response);
    } catch (err) {
      setError(String(err));
    } finally {
      setPreviewing(false);
    }
  }

  if (!ready) return null;
  const canRun = runtime?.ready && model?.ready && text.trim() && !processing && !downloading && !previewing;
  const canPreview = runtime?.ready && model?.ready && !processing && !downloading && !previewing;
  const selectedVariant = TTS_MODEL_VARIANTS.find((item) => item.id === modelVariant);
  const needsDownload = !runtime?.ready || !model?.ready;
  const availableRoles = VOICE_ROLES.filter((role) =>
    KOKORO_VOICES.some((voice) => voice.language === voiceLanguage && voice.role === role.id)
  );
  const filteredVoices = KOKORO_VOICES.filter(
    (voice) => voice.language === voiceLanguage && voice.role === voiceRole
  );
  const selectedVoice = KOKORO_VOICES.find((voice) => voice.id === speakerId) || KOKORO_VOICES[45];
  const filteredGroups = VOICE_GROUPS.filter((group) => filteredVoices.some((voice) => voice.group === group));

  function applyVoiceFilters(nextLanguage: VoiceLanguage, nextRole: VoiceRole) {
    const normalizedRole =
      KOKORO_VOICES.some((voice) => voice.language === nextLanguage && voice.role === nextRole)
        ? nextRole
        : KOKORO_VOICES.find((voice) => voice.language === nextLanguage)?.role || nextRole;
    const currentVoice = KOKORO_VOICES.find((voice) => voice.id === speakerId);
    setVoiceLanguage(nextLanguage);
    setVoiceRole(normalizedRole);
    if (currentVoice?.language !== nextLanguage || currentVoice?.role !== normalizedRole) {
      setSpeakerId(
        KOKORO_VOICES.find(
          (voice) => voice.language === nextLanguage && voice.role === normalizedRole
        )?.id || 0
      );
      setPreview(null);
    }
  }

  function changeVoiceLanguage(nextLanguage: VoiceLanguage) {
    applyVoiceFilters(nextLanguage, voiceRole);
  }

  function changeVoiceRole(nextRole: VoiceRole) {
    applyVoiceFilters(voiceLanguage, nextRole);
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="🗣️"
        title="本地文字转语音 TTS"
        subtitle="sherpa-onnx + Kokoro，本地离线合成"
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
              <div>Kokoro：{model?.ready ? '已就绪' : '未就绪'}</div>
              <div className="mt-1">当前模型：{selectedVariant?.label} / {selectedVariant?.description}</div>
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
            <h2 className="text-sm font-semibold">合成参数</h2>
            <label className="mt-3 block text-xs text-gray-500">
              模型质量
              <select
                value={modelVariant}
                onChange={(event) => setModelVariant(event.target.value as TtsModelVariant)}
                disabled={processing || downloading}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              >
                {TTS_MODEL_VARIANTS.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label} - {variant.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs text-gray-500">
              语种
              <select
                value={voiceLanguage}
                onChange={(event) => changeVoiceLanguage(event.target.value as VoiceLanguage)}
                disabled={processing || previewing}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              >
                {VOICE_LANGUAGES.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs text-gray-500">
              角色
              <select
                value={voiceRole}
                onChange={(event) => changeVoiceRole(event.target.value as VoiceRole)}
                disabled={processing || previewing}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              >
                {availableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs text-gray-500">
              音色
              <select
                value={speakerId}
                onChange={(event) => setSpeakerId(Number(event.target.value) || 0)}
                disabled={processing || previewing}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              >
                {filteredGroups.map((group) => (
                  <optgroup key={group} label={group}>
                    {filteredVoices.filter((voice) => voice.group === group).map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.id} - {voice.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="mt-2 rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
              <div>{selectedVoice.name}</div>
              <div>{selectedVoice.group} · sid {selectedVoice.id}</div>
            </div>
            <button
              type="button"
              onClick={previewVoice}
              disabled={!canPreview}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950/30 dark:disabled:border-gray-700 dark:disabled:text-gray-500"
            >
              {previewing ? <Loader size={15} className="animate-spin" /> : <Play size={15} />}
              试听当前音色
            </button>
            {preview && (
              <audio
                key={preview.outputPath}
                className="mt-3 w-full"
                controls
                autoPlay
                src={convertFileSrc(preview.outputPath)}
              />
            )}
            <label className="mt-3 block text-xs text-gray-500">
              语速 {speed.toFixed(2)}x
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                className="mt-2 w-full"
              />
            </label>
            <label className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
              <span>音频后处理降噪</span>
              <input
                type="checkbox"
                checked={denoiseOutput}
                onChange={(event) => setDenoiseOutput(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </label>
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
              onClick={synthesize}
              disabled={!canRun}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {processing ? <Loader size={16} className="animate-spin" /> : <Volume2 size={16} />}
              开始合成
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

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-gray-200 p-4 dark:border-gray-700">
              <h2 className="text-sm font-semibold">文本</h2>
            </div>
            <div className="p-4">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="min-h-[260px] w-full resize-y rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm leading-6 text-gray-800 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-100"
              />
            </div>
          </section>

          {result && (
            <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-start gap-3">
                <CheckCircle size={22} className="mt-0.5 text-green-500" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold">合成完成</h2>
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
          )}
        </main>
      </div>
    </div>
  );
}
