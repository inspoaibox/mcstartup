import { useEffect, useState, type ReactNode } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  CheckCircle,
  Download,
  ExternalLink,
  Loader,
  RefreshCw,
} from 'lucide-react';

export type PandocRuntimeStatusKind = 'checking' | 'missing' | 'downloading' | 'ready' | 'error';

export interface PandocRuntimeStatus {
  ready: boolean;
  mode: string;
  pandocPath?: string | null;
  installDir: string;
  version?: string | null;
  message: string;
  releasesUrl: string;
}

export interface PandocConvertOptions {
  referenceDocx?: string | null;
  referenceDocxTemplate?: string | null;
  referencePptx?: string | null;
  extractMedia?: boolean;
  metadataTitle?: string | null;
  metadataAuthor?: string | null;
  epubCoverImage?: string | null;
  epubCss?: string | null;
  toc?: boolean;
}

export interface PandocConvertResult {
  outputPath: string;
  mediaDir?: string | null;
  commandSummary: string;
}

export interface SelectedFile {
  path: string;
  name: string;
}

export interface PandocRuntimeState {
  runtime: PandocRuntimeStatus | null;
  runtimeStatus: PandocRuntimeStatusKind;
  runtimeReady: boolean;
  runtimeError: string | null;
  downloadProgress: number;
  downloadFile: string;
  refreshRuntime: () => Promise<void>;
  downloadPandoc: () => Promise<void>;
  chooseInstalledPandoc: () => Promise<void>;
  choosePandocDirectory: () => Promise<void>;
  clearCustomPath: () => Promise<void>;
}

export function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function stem(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

function resolveRuntimeStatus(runtime: PandocRuntimeStatus | null): PandocRuntimeStatusKind {
  if (!runtime) return 'checking';
  if (runtime.ready) return 'ready';
  if (runtime.mode === 'invalid') return 'error';
  return 'missing';
}

export function usePandocRuntime(): PandocRuntimeState {
  const [runtime, setRuntime] = useState<PandocRuntimeStatus | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<PandocRuntimeStatusKind>('checking');
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadFile, setDownloadFile] = useState('');

  async function refreshRuntime() {
    setRuntimeStatus('checking');
    setRuntimeError(null);
    try {
      const next = await invoke<PandocRuntimeStatus>('check_pandoc_runtime');
      setRuntime(next);
      setRuntimeStatus(resolveRuntimeStatus(next));
    } catch (err) {
      setRuntimeStatus('error');
      setRuntimeError(String(err));
    }
  }

  async function chooseInstalledPandoc() {
    const selected = await open({ multiple: false });
    if (typeof selected !== 'string') return;
    try {
      const next = await invoke<PandocRuntimeStatus>('set_pandoc_path', { path: selected });
      setRuntime(next);
      setRuntimeStatus(resolveRuntimeStatus(next));
      setRuntimeError(null);
    } catch (err) {
      setRuntimeStatus('error');
      setRuntimeError(String(err));
    }
  }

  async function choosePandocDirectory() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== 'string') return;
    try {
      const next = await invoke<PandocRuntimeStatus>('set_pandoc_path', { path: selected });
      setRuntime(next);
      setRuntimeStatus(resolveRuntimeStatus(next));
      setRuntimeError(null);
    } catch (err) {
      setRuntimeStatus('error');
      setRuntimeError(String(err));
    }
  }

  async function clearCustomPath() {
    try {
      const next = await invoke<PandocRuntimeStatus>('clear_pandoc_path');
      setRuntime(next);
      setRuntimeStatus(resolveRuntimeStatus(next));
      setRuntimeError(null);
    } catch (err) {
      setRuntimeStatus('error');
      setRuntimeError(String(err));
    }
  }

  async function downloadPandoc() {
    setRuntimeStatus('downloading');
    setDownloadProgress(0);
    setDownloadFile('');
    setRuntimeError(null);
    const unlisten = await listen<any>('pandoc-download-progress', (event) => {
      const payload = event.payload || {};
      const file = String(payload.file || '');
      const loaded = Number(payload.loaded || 0);
      const total = Number(payload.total || 0);
      const done = Boolean(payload.done);
      setDownloadFile(basename(file));

      if (file.includes('查询')) {
        setDownloadProgress(done ? 3 : 1);
        return;
      }
      if (file.includes('解压')) {
        setDownloadProgress(done ? 100 : 96);
        return;
      }
      if (total > 0) {
        const percent = Math.min(95, Math.round((loaded / total) * 95));
        setDownloadProgress(done ? 95 : percent);
      } else if (done) {
        setDownloadProgress(95);
      }
    });

    try {
      const next = await invoke<PandocRuntimeStatus>('download_pandoc', {
        installDir: runtime?.installDir,
        overwrite: true,
      });
      setRuntime(next);
      setRuntimeStatus(resolveRuntimeStatus(next));
      setDownloadProgress(100);
    } catch (err) {
      setRuntimeStatus('error');
      setRuntimeError(String(err));
    } finally {
      unlisten();
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
    downloadProgress,
    downloadFile,
    refreshRuntime,
    downloadPandoc,
    chooseInstalledPandoc,
    choosePandocDirectory,
    clearCustomPath,
  };
}

export function PandocRuntimePanel({ runtimeState }: { runtimeState: PandocRuntimeState }) {
  const {
    runtime,
    runtimeStatus,
    runtimeError,
    downloadProgress,
    downloadFile,
    refreshRuntime,
    downloadPandoc,
    chooseInstalledPandoc,
    choosePandocDirectory,
    clearCustomPath,
  } = runtimeState;

  if (runtimeStatus === 'checking') {
    return (
      <RuntimeNotice
        icon={<Loader size={16} className="animate-spin text-blue-500" />}
        title="检查 Pandoc 状态..."
        subtitle="正在确认本地缓存和系统安装情况。"
      />
    );
  }

  if (runtimeStatus === 'ready' && runtime) {
    return (
      <RuntimeNotice
        icon={<CheckCircle size={16} className="text-emerald-500" />}
        title="Pandoc 已就绪"
        subtitle={`${runtime.version || ''} · ${
          runtime.mode === 'cached'
            ? '本地缓存'
            : runtime.mode === 'system'
              ? '系统安装'
              : '自定义路径'
        }`}
        actions={
          <>
            <button
              onClick={() => invoke('open_path', { targetPath: runtime.installDir })}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              打开缓存目录
            </button>
            <button
              onClick={refreshRuntime}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <RefreshCw size={12} />
              重新检测
            </button>
          </>
        }
      />
    );
  }

  return (
    <RuntimeNotice
      icon={
        runtimeStatus === 'downloading' ? (
          <Loader size={16} className="animate-spin text-blue-500" />
        ) : (
          <AlertCircle size={16} className="text-amber-500" />
        )
      }
      title={runtimeStatus === 'downloading' ? '下载 Pandoc 中...' : '需要准备 Pandoc 运行时'}
      subtitle={
        runtimeStatus === 'downloading'
          ? `${downloadProgress}% ${downloadFile ? `· ${downloadFile}` : ''}`
          : runtime?.message ||
            runtimeError ||
            '未检测到 Pandoc，可下载到本地缓存或指定已安装的可执行文件。'
      }
      progress={runtimeStatus === 'downloading' ? downloadProgress : undefined}
      actions={
        <>
          {runtimeStatus !== 'downloading' && (
            <>
              <button
                onClick={downloadPandoc}
                className="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600"
              >
                <Download size={12} />
                下载 Pandoc
              </button>
              <button
                onClick={chooseInstalledPandoc}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                选择 pandoc.exe
              </button>
              <button
                onClick={choosePandocDirectory}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                选择安装目录
              </button>
            </>
          )}
          <button
            onClick={clearCustomPath}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            恢复自动检测
          </button>
          <button
            onClick={() =>
              invoke('open_file', {
                path: runtime?.releasesUrl || 'https://github.com/jgm/pandoc/releases/latest',
              })
            }
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ExternalLink size={12} />
            官方发布页
          </button>
        </>
      }
    />
  );
}

export function PandocResultPanel({ result }: { result: PandocConvertResult }) {
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm dark:border-emerald-800/40 dark:bg-emerald-900/15">
      <div className="flex items-start gap-3">
        <CheckCircle size={18} className="mt-0.5 text-emerald-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">转换完成</p>
          <p className="mt-1 break-all text-xs text-emerald-700/85 dark:text-emerald-200/90">
            输出文件：{result.outputPath}
          </p>
          {result.mediaDir && (
            <p className="mt-1 break-all text-xs text-emerald-700/85 dark:text-emerald-200/90">
              图片目录：{result.mediaDir}
            </p>
          )}
          <p className="mt-1 text-xs text-emerald-700/75 dark:text-emerald-200/80">
            {result.commandSummary}
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
          </div>
        </div>
      </div>
    </section>
  );
}

export function PandocErrorPanel({ message }: { message: string }) {
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
