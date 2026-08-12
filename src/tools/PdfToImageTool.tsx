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
interface ConvertResult {
  page: number;
  output_path: string;
}

function GsGuide({ onRecheck, checking }: { onRecheck: () => void; checking: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4">
      <div className="text-5xl">🖼️</div>
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
        需要安装 Ghostscript
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
        PDF 转图片需要 Ghostscript 进行渲染，请按以下方式安装：
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

export default function PdfToImageTool() {
  const ready = useToolTheme();
  const [gs, setGs] = useState<GsStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState<'png' | 'jpg'>('png');
  const [dpi, setDpi] = useState(150);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<ConvertResult[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  const selectFile = async () => {
    const sel = await open({ filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!sel || Array.isArray(sel)) return;
    setFilePath(sel);
    setFileName(sel.split(/[\\/]/).pop() || sel);
    setResults([]);
    setError(null);
  };

  const handleConvert = async () => {
    if (!filePath || processing) return;
    setProcessing(true);
    setError(null);
    setResults([]);
    try {
      const res = await invoke<ConvertResult[]>('pdf_to_images_gs', {
        inputPath: filePath,
        format,
        dpi,
      });
      setResults(res);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="🖼️"
        title="PDF 转图片"
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
          {/* 设置栏 */}
          <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">输出格式</span>
              <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                {(['png', 'jpg'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${format === f ? 'bg-red-500 text-white shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">分辨率</span>
              <select
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value))}
                className="text-xs bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5"
              >
                {[72, 96, 150, 200, 300, 600].map((d) => (
                  <option key={d} value={d}>
                    {d} DPI
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* 文件选择 */}
            {!filePath ? (
              <div
                onClick={selectFile}
                className="h-40 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
              >
                <Upload size={28} className="text-gray-400 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">点击选择 PDF 文件</p>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg px-3 py-2.5 border border-gray-200 dark:border-gray-700">
                <span className="text-2xl">📄</span>
                <p className="flex-1 text-sm font-medium truncate">{fileName}</p>
                <button
                  onClick={() => {
                    setFilePath('');
                    setFileName('');
                    setResults([]);
                    setError(null);
                  }}
                  className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* 结果列表 */}
            {results.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={15} className="text-green-500" />
                  <p className="text-sm text-green-700 dark:text-green-300 font-medium">
                    转换成功，共 {results.length} 张图片
                  </p>
                </div>
                {results.map((r) => (
                  <div
                    key={r.page}
                    className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700"
                  >
                    <span className="text-xs text-gray-400 w-12 flex-shrink-0">第 {r.page} 页</span>
                    <p className="flex-1 text-xs truncate text-gray-600 dark:text-gray-300">
                      {r.output_path.split(/[\\/]/).pop()}
                    </p>
                    <button
                      onClick={() => invoke('show_in_folder', { path: r.output_path })}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      title="在文件夹中显示"
                    >
                      <FolderOpen size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2">
                <AlertCircle size={15} className="text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
            <button
              onClick={selectFile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              <Upload size={14} />
              {filePath ? '重新选择' : '选择文件'}
            </button>
            <div className="flex-1" />
            <button
              onClick={handleConvert}
              disabled={!filePath || processing}
              className="flex items-center gap-2 px-5 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  转换中...
                </>
              ) : (
                <>开始转换</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
