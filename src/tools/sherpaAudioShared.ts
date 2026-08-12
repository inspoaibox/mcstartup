import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';

export type ModelStatus = 'unknown' | 'checking' | 'missing' | 'downloading' | 'ready' | 'error';

export interface SherpaRuntimeStatus {
  ready: boolean;
  version?: string | null;
  runtimeDir: string;
  binDir?: string | null;
  missing: string[];
}

export interface SherpaModelStatus {
  ready: boolean;
  modelDir: string;
  missing: string[];
  files: string[];
}

export interface DownloadProgressPayload {
  file: string;
  loaded: number;
  total: number;
  done: boolean;
}

export interface SherpaDownloadItem {
  label: string;
  url: string;
  relativePath: string;
  extractTo?: string;
  isReady?: () => Promise<boolean>;
}

export const SHERPA_RUNTIME_ITEM: SherpaDownloadItem = {
  label: 'sherpa-onnx Windows x64 运行时',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.2/sherpa-onnx-v1.13.2-win-x64-shared-MT-Release.tar.bz2',
  relativePath: 'sherpa-onnx/downloads/sherpa-onnx-v1.13.2-win-x64-shared-MT-Release.tar.bz2',
  extractTo: 'sherpa-onnx/runtime',
};

export const STT_PUNCTUATED_MODEL_ITEM: SherpaDownloadItem = {
  label: 'SenseVoice int8 多语言识别模型（标点版）',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2',
  relativePath:
    'sherpa-onnx/downloads/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2',
  extractTo: 'sherpa-onnx/models/stt',
};

export const STT_LATEST_MODEL_ITEM: SherpaDownloadItem = {
  label: 'SenseVoice int8 多语言识别模型（新版）',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2',
  relativePath:
    'sherpa-onnx/downloads/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2',
  extractTo: 'sherpa-onnx/models/stt',
};

export const STT_MODEL_ITEM = STT_PUNCTUATED_MODEL_ITEM;

export const PUNCTUATION_MODEL_ITEM: SherpaDownloadItem = {
  label: '中英文标点恢复模型',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12.tar.bz2',
  relativePath:
    'sherpa-onnx/downloads/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12.tar.bz2',
  extractTo: 'sherpa-onnx/models/punctuation',
};

export const TTS_INT8_MODEL_ITEM: SherpaDownloadItem = {
  label: 'Kokoro int8 多语言 TTS 模型（轻量）',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2',
  relativePath: 'sherpa-onnx/downloads/kokoro-int8-multi-lang-v1_1.tar.bz2',
  extractTo: 'sherpa-onnx/models/tts',
};

export const TTS_QUALITY_MODEL_ITEM: SherpaDownloadItem = {
  label: 'Kokoro 多语言 TTS 模型（高质量）',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2',
  relativePath: 'sherpa-onnx/downloads/kokoro-multi-lang-v1_1.tar.bz2',
  extractTo: 'sherpa-onnx/models/tts',
};

export const TTS_MODEL_ITEM = TTS_INT8_MODEL_ITEM;

export const DENOISE_MODEL_ITEMS: Record<string, SherpaDownloadItem> = {
  'dpdfnet2.onnx': {
    label: 'DPDFNet2 16k 降噪模型',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/dpdfnet2.onnx',
    relativePath: 'sherpa-onnx/models/denoise/dpdfnet2.onnx',
  },
  'dpdfnet4.onnx': {
    label: 'DPDFNet4 16k 降噪模型',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/dpdfnet4.onnx',
    relativePath: 'sherpa-onnx/models/denoise/dpdfnet4.onnx',
  },
  'dpdfnet8.onnx': {
    label: 'DPDFNet8 16k 降噪模型',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/dpdfnet8.onnx',
    relativePath: 'sherpa-onnx/models/denoise/dpdfnet8.onnx',
  },
  'dpdfnet2_48khz_hr.onnx': {
    label: 'DPDFNet2 48k 高采样率模型',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/dpdfnet2_48khz_hr.onnx',
    relativePath: 'sherpa-onnx/models/denoise/dpdfnet2_48khz_hr.onnx',
  },
};

export const SEPARATION_MODEL_ITEM: SherpaDownloadItem = {
  label: 'Spleeter 2-stem fp16 人声/伴奏分离模型',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/sherpa-onnx-spleeter-2stems-fp16.tar.bz2',
  relativePath: 'sherpa-onnx/downloads/sherpa-onnx-spleeter-2stems-fp16.tar.bz2',
  extractTo: 'sherpa-onnx/models/separation',
};

export const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  'm4a',
  'wma',
  'opus',
  'mp4',
  'mov',
  'mkv',
  'avi',
  'webm',
];

export function joinPath(base: string, relative: string): string {
  const normalized = relative.replace(/\//g, '\\');
  return `${base.replace(/[\\/]+$/, '')}\\${normalized}`;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export async function chooseModelDir(current: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath: current || undefined,
  });
  return typeof selected === 'string' ? selected : null;
}

export async function initModelDir(): Promise<string> {
  const customDir = await invoke<string | null>('get_custom_model_dir');
  const defaultDir = await invoke<string>('get_model_dir');
  return customDir || defaultDir;
}

export async function saveModelDir(path: string) {
  await invoke('set_model_dir', { path });
}

export async function downloadSherpaItems(
  modelDir: string,
  items: SherpaDownloadItem[],
  onProgress: (percent: number, label: string) => void
) {
  const unlisten = await listen<DownloadProgressPayload>('model-download-progress', (event) => {
    const file = event.payload.file || '';
    const current = items.find((item) => file.endsWith(item.relativePath.replace(/\//g, '\\')));
    const total = event.payload.total || 0;
    const percent = total > 0 ? Math.round((event.payload.loaded / total) * 100) : 0;
    onProgress(percent, current?.label || basename(file));
  });

  try {
    for (const item of items) {
      const destPath = joinPath(modelDir, item.relativePath);
      if (item.isReady && (await item.isReady())) {
        onProgress(100, `${item.label} 已就绪`);
        continue;
      }
      onProgress(0, item.label);
      await invoke('download_model_file', {
        url: item.url,
        destPath,
        overwrite: false,
      });
      if (item.extractTo) {
        onProgress(100, `解压 ${item.label}`);
        await invoke('sherpa_audio_extract_archive', {
          archivePath: destPath,
          outputDir: joinPath(modelDir, item.extractTo),
        });
      }
    }
  } finally {
    unlisten();
  }
}
