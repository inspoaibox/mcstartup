import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Upload, X, CheckCircle, Loader, AlertCircle, FolderOpen } from 'lucide-react';

interface GsStatus {
  installed: boolean;
  version?: string;
  path?: string;
}
interface FileItem {
  id: string;
  path: string;
  name: string;
  inputSize?: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  outputPath?: string;
  outputSize?: number;
  error?: string;
}

const PRESETS = [
  {
    id: 'screen',
    label: '屏幕',
    desc: '72 dpi · 最小体积',
    color: 'border-red-400 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
  },
  {
    id: 'ebook',
    label: '电子书',
    desc: '150 dpi · 推荐',
    color: 'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300',
  },
  {
    id: 'printer',
    label: '打印',
    desc: '300 dpi · 高质量',
    color: 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
  },
  {
    id: 'prepress',
    label: '印刷',
    desc: '300 dpi · 最高质量',
    color:
      'border-purple-400 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300',
  },
];

function GsGuide({ onRecheck, checking }: { onRecheck: () => void; checking: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4">
      <div className="text-5xl">📦</div>
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
        需要安装 Ghostscript
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
        PDF 压缩需要 Ghostscript 进行重新渲染，请按以下方式安装：
      </p>
      <div className="w-full max-w-md bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">方式一：winget（推荐）</p>
        <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded-lg font-mono select-all">
          winget install ArtifexSoftware.GhostScript
        </code>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          方式二：Chocolatey（winget 失败时推荐）
        </p>
        <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded-lg font-mono select-all">
          choco install ghostscript -y
        </code>
        <p className="text-xs text-gray-500 dark:text-gray-400">方式三：Scoop</p>
        <code className="block bg-gray-900 text-green-400 text-xs p-3 rounded-lg font-mono select-all">
          scoop install ghostscript
        </code>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          方式四：官网下载 →{' '}
          <a
            href="https://www.ghostscript.com/releases/gsdnld.html"
            target="_blank"
            rel="noreferrer"
            className="text-blue-500 underline"
          >
            ghostscript.com
          </a>
        </p>
      </div>
      <button
        onClick={onRecheck}
        disabled={checking}
        className="flex items-center gap-1.5 px-4 py-2 text-sm bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg transition-colors"
      >
        {checking ? <Loader size={13} className="animate-spin" /> : null}安装完成？重新检测
      </button>
    </div>
  );
}

export default function PdfCompressTool() {
  const ready = useToolTheme();
  const [gs, setGs] = useState<GsStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [preset, setPreset] = useState('ebook');
  const [processing, setProcessing] = useState(false);

  const checkGs = useCallback(async () => {
    setChecking(true);
    try {
      setGs(await invoke<GsStatus>('check_ghostscript'));
    } catch {
      setGs({ installed: false });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkGs();
  }, [checkGs]);

  const addFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const items: FileItem[] = await Promise.all(
      paths.map(async (p) => {
        let inputSize: number | undefined;
        try {
          inputSize = await invoke<number>('get_file_size', { path: p });
        } catch {}
        return {
          id: Math.random().toString(36).slice(2),
          path: p,
          name: p.split(/[\\/]/).pop() || p,
          inputSize,
          status: 'pending' as const,
        };
      })
    );
    setFiles((prev) => [...prev, ...items]);
  };

  const handleCompress = async () => {
    if (!files.length || processing) return;
    setProcessing(true);
    setFiles((prev) =>
      prev.map((f) => ({
        ...f,
        status: 'pending' as const,
        outputPath: undefined,
        outputSize: undefined,
        error: undefined,
      }))
    );

    for (const file of files) {
      setFiles((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, status: 'processing' as const } : f))
      );
      try {
        const result = await invoke<{ output_path: string; output_size: number }>(
          'compress_pdf_gs',
          {
            inputPath: file.path,
            preset,
          }
        );
        setFiles((prev) =>
          prev.map((f) =>
            f.id === file.id
              ? {
                  ...f,
                  status: 'done' as const,
                  outputPath: result.output_path,
                  outputSize: result.output_size,
                }
              : f
          )
        );
      } catch (e: any) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === file.id ? { ...f, status: 'error' as const, error: String(e) } : f
          )
        );
      }
    }
    setProcessing(false);
  };

  const formatBytes = (b?: number) => {
    if (!b) return '';
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getSaving = (input?: number, output?: number) => {
    if (!input || !output) return null;
    return ((input - output) / input) * 100;
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="📦"
        title="PDF 压缩"
        subtitle={gs?.installed ? `Ghostscript ${gs.version ?? ''}` : undefined}
      />

      {gs === null ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-gray-400">
            <Loader size={18} className="animate-spin" />
            <span className="text-sm">检测 Ghostscript...</span>
          </div>
        </div>
      ) : !gs.installed ? (
        <div className="flex-1 overflow-auto">
          <GsGuide onRecheck={checkGs} checking={checking} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 预设 */}
          <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div className="flex gap-2 flex-wrap">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={`flex flex-col items-start px-3 py-2 rounded-lg border-2 text-left transition-all ${preset === p.id ? p.color : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}
                >
                  <span className="text-xs font-semibold">{p.label}</span>
                  <span className="text-[10px] opacity-70 mt-0.5">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 文件列表 */}
          <div className="flex-1 overflow-auto p-4">
            {files.length === 0 ? (
              <div
                onClick={addFiles}
                className="h-full min-h-40 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
              >
                <Upload size={28} className="text-gray-400 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">点击选择 PDF 文件</p>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((file) => {
                  const saving = getSaving(file.inputSize, file.outputSize);
                  return (
                    <div
                      key={file.id}
                      className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg px-3 py-2.5 border border-gray-200 dark:border-gray-700"
                    >
                      <div className="flex-shrink-0 w-5">
                        {file.status === 'pending' && (
                          <div className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 mx-auto" />
                        )}
                        {file.status === 'processing' && (
                          <Loader size={16} className="animate-spin text-red-500" />
                        )}
                        {file.status === 'done' && (
                          <CheckCircle size={16} className="text-green-500" />
                        )}
                        {file.status === 'error' && (
                          <AlertCircle size={16} className="text-red-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm truncate flex-1">{file.name}</p>
                          {file.inputSize && file.status === 'pending' && (
                            <span className="text-[11px] text-gray-400 flex-shrink-0">
                              {formatBytes(file.inputSize)}
                            </span>
                          )}
                        </div>
                        {file.status === 'done' && file.outputPath && (
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {file.inputSize && (
                              <span className="text-[11px] text-gray-400">
                                原始{' '}
                                <span className="font-medium text-gray-600 dark:text-gray-300">
                                  {formatBytes(file.inputSize)}
                                </span>
                              </span>
                            )}
                            {file.outputSize && (
                              <>
                                <span className="text-[11px] text-gray-300 dark:text-gray-600">
                                  →
                                </span>
                                <span className="text-[11px] text-gray-400">
                                  压缩后{' '}
                                  <span className="font-medium text-green-600 dark:text-green-400">
                                    {formatBytes(file.outputSize)}
                                  </span>
                                </span>
                              </>
                            )}
                            {saving !== null && (
                              <span
                                className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${saving < 0 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600' : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'}`}
                              >
                                {saving < 0
                                  ? `↑ +${Math.abs(saving).toFixed(1)}%`
                                  : `节省 ${saving.toFixed(1)}%`}
                              </span>
                            )}
                          </div>
                        )}
                        {file.status === 'error' && (
                          <p className="text-xs text-red-500 truncate mt-0.5">{file.error}</p>
                        )}
                      </div>
                      {file.status === 'done' && file.outputPath && (
                        <button
                          onClick={() => invoke('show_in_folder', { path: file.outputPath })}
                          className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors"
                          title="在文件夹中显示"
                        >
                          <FolderOpen size={14} />
                        </button>
                      )}
                      {!processing && (
                        <button
                          onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
                          className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
            <button
              onClick={addFiles}
              disabled={processing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
            >
              <Upload size={14} />
              添加文件
            </button>
            {files.length > 0 && !processing && (
              <button
                onClick={() => setFiles([])}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <X size={14} />
                清空
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={handleCompress}
              disabled={!files.length || processing}
              className="flex items-center gap-2 px-5 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  压缩中...
                </>
              ) : (
                <>开始压缩</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
