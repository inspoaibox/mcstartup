import { useEffect, useMemo, useState } from 'react';
import { open as openDialog, save } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import {
  Archive,
  CheckCircle2,
  FileArchive,
  FolderOpen,
  KeyRound,
  Loader2,
  Lock,
  PackagePlus,
  RefreshCw,
  Trash2,
  Unlock,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { EmptyState, StatusMessage, ToolbarButton, formatBytes } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';

interface RuntimeStatus {
  installed: boolean;
  version?: string;
  path?: string;
  bundled: boolean;
  message: string;
}

interface PathInfo {
  path: string;
  name: string;
  parent: string;
  stem: string;
  extension: string;
  isDir: boolean;
  size: number;
}

interface ArchiveEntry {
  path: string;
  size?: number;
  packedSize?: number;
  modified?: string;
  attributes?: string;
  encrypted: boolean;
  isDir: boolean;
}

type TabKey = 'compress' | 'extract';

const ARCHIVE_FILTERS = [
  { name: '压缩包', extensions: ['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz', 'wim'] },
  { name: '全部文件', extensions: ['*'] },
];

export default function ArchiveManagerTool() {
  const ready = useToolTheme();
  const [tab, setTab] = useState<TabKey>('compress');
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [sources, setSources] = useState<PathInfo[]>([]);
  const [archivePath, setArchivePath] = useState('');
  const [archiveEntries, setArchiveEntries] = useState<ArchiveEntry[]>([]);
  const [outputPath, setOutputPath] = useState('');
  const [extractDir, setExtractDir] = useState('');
  const [format, setFormat] = useState('7z');
  const [level, setLevel] = useState(5);
  const [password, setPassword] = useState('');
  const [extractPassword, setExtractPassword] = useState('');
  const [encryptHeaders, setEncryptHeaders] = useState(true);
  const [splitSize, setSplitSize] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resultPath, setResultPath] = useState('');

  const totalSourceSize = useMemo(() => sources.reduce((sum, item) => sum + item.size, 0), [sources]);
  const archiveEncrypted = archiveEntries.some((entry) => entry.encrypted);

  const loadRuntime = async () => {
    const runtimeStatus = await invoke<RuntimeStatus>('archive_runtime_status');
    setRuntime(runtimeStatus);
  };

  const inspectAndAddSources = async (paths: string[]) => {
    if (paths.length === 0) return;
    const items = await invoke<PathInfo[]>('archive_inspect_paths', { paths });
    setSources((current) => {
      const seen = new Set(current.map((item) => item.path.toLowerCase()));
      return [...current, ...items.filter((item) => !seen.has(item.path.toLowerCase()))];
    });
    if (!outputPath && items.length > 0) {
      const suggested = await invoke<string>('archive_suggest_output_path', {
        paths: [...sources.map((item) => item.path), ...items.map((item) => item.path)],
        format,
      });
      setOutputPath(suggested);
    }
  };

  const loadArchive = async (path: string, nextPassword = extractPassword) => {
    setArchivePath(path);
    if (!extractDir) {
      const dir = await invoke<string>('archive_default_extract_dir', { archivePath: path });
      setExtractDir(dir);
    }
    try {
      const entries = await invoke<ArchiveEntry[]>('archive_list', {
        archivePath: path,
        password: nextPassword || null,
      });
      setArchiveEntries(entries);
      setError('');
    } catch (err) {
      setArchiveEntries([]);
      setError(String(err));
    }
  };

  useEffect(() => {
    void loadRuntime().catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    if (sources.length === 0) return;
    void invoke<string>('archive_suggest_output_path', {
      paths: sources.map((item) => item.path),
      format,
    })
      .then(setOutputPath)
      .catch(() => undefined);
  }, [format]);

  const addFiles = async () => {
    const selected = await openDialog({ multiple: true, directory: false });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    await inspectAndAddSources(paths);
  };

  const addFolder = async () => {
    const selected = await openDialog({ multiple: false, directory: true });
    if (typeof selected === 'string') await inspectAndAddSources([selected]);
  };

  const chooseOutput = async () => {
    const selected = await save({
      defaultPath: outputPath,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (selected) setOutputPath(selected.endsWith(`.${format}`) ? selected : `${selected}.${format}`);
  };

  const chooseArchive = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: ARCHIVE_FILTERS });
    if (typeof selected === 'string') await loadArchive(selected);
  };

  const chooseExtractDir = async () => {
    const selected = await openDialog({ multiple: false, directory: true });
    if (typeof selected === 'string') setExtractDir(selected);
  };

  const runCompress = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    setResultPath('');
    try {
      const result = await invoke<{ outputPath: string; message: string }>('archive_compress', {
        request: {
          sources: sources.map((item) => item.path),
          outputPath,
          format,
          level,
          password: password || null,
          encryptHeaders,
          splitSize: splitSize || null,
          overwrite,
        },
      });
      setResultPath(result.outputPath);
      setMessage(result.message);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const runExtract = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    setResultPath('');
    try {
      const result = await invoke<{ outputPath: string; message: string }>('archive_extract', {
        request: {
          archivePath,
          outputDir: extractDir,
          password: extractPassword || null,
          overwrite,
        },
      });
      setResultPath(result.outputPath);
      setMessage(result.message);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const openResult = async () => {
    if (!resultPath) return;
    await invoke('show_in_folder', { path: resultPath });
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🗜️"
        title="压缩解压"
        subtitle={runtime?.installed ? `${runtime.version || '7-Zip'} · 内置引擎` : '内置 7-Zip 运行时'}
        actions={
          <ToolbarButton onClick={() => void loadRuntime()}>
            <RefreshCw size={14} />
            检测
          </ToolbarButton>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="w-52 flex-shrink-0 border-r border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          {[
            ['compress', PackagePlus, '压缩文件'],
            ['extract', FileArchive, '解压文件'],
          ].map(([key, Icon, label]) => (
            <button
              key={key as string}
              onClick={() => setTab(key as TabKey)}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                tab === key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              <Icon size={16} />
              {label as string}
            </button>
          ))}
          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500 dark:bg-gray-950 dark:text-gray-400">
            7z/ZIP 支持密码压缩；RAR 支持解压，不提供 RAR 压缩。
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto p-4">
          {!runtime?.installed && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              未检测到内置 7-Zip：请确认应用资源目录包含 `resources/7zip/7z.exe` 和 `7z.dll`。
            </div>
          )}
          <StatusMessage message={message} error={error} />

          {tab === 'compress' && (
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_360px] gap-4">
              <section className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                  <div className="font-semibold">待压缩内容</div>
                  <div className="flex gap-2">
                    <ToolbarButton onClick={() => void addFiles()}>添加文件</ToolbarButton>
                    <ToolbarButton onClick={() => void addFolder()}>添加文件夹</ToolbarButton>
                    <ToolbarButton onClick={() => setSources([])} danger>
                      <Trash2 size={14} />
                      清空
                    </ToolbarButton>
                  </div>
                </div>
                <div className="max-h-[520px] overflow-auto p-3">
                  {sources.length === 0 ? (
                    <EmptyState icon={<Archive size={34} />} text="添加文件或文件夹后开始压缩" />
                  ) : (
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                      {sources.map((item) => (
                        <div key={item.path} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{item.name}</div>
                            <div className="truncate text-xs text-gray-400">{item.path}</div>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span>{item.isDir ? '文件夹' : formatBytes(item.size)}</span>
                            <button onClick={() => setSources((rows) => rows.filter((row) => row.path !== item.path))} className="text-red-500">移除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <Field label="格式">
                  <select value={format} onChange={(event) => setFormat(event.target.value)} className="input-sm w-full">
                    <option value="7z">7z</option>
                    <option value="zip">zip</option>
                    <option value="tar">tar</option>
                    <option value="wim">wim</option>
                  </select>
                </Field>
                <Field label="压缩等级">
                  <input type="range" min={0} max={9} value={level} onChange={(event) => setLevel(Number(event.target.value))} className="w-full" />
                  <div className="text-xs text-gray-500">{level} / 9</div>
                </Field>
                <Field label="保存位置">
                  <div className="flex gap-2">
                    <input value={outputPath} onChange={(event) => setOutputPath(event.target.value)} className="input-sm min-w-0 flex-1" />
                    <ToolbarButton onClick={() => void chooseOutput()}>选择</ToolbarButton>
                  </div>
                </Field>
                <Field label="密码">
                  <div className="flex items-center gap-2">
                    <KeyRound size={15} className="text-gray-400" />
                    <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="不填写则不加密" className="input-sm min-w-0 flex-1" />
                  </div>
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={encryptHeaders} disabled={format !== '7z'} onChange={(event) => setEncryptHeaders(event.target.checked)} />
                  加密文件名列表（仅 7z）
                </label>
                <Field label="分卷大小">
                  <input value={splitSize} onChange={(event) => setSplitSize(event.target.value)} placeholder="例如 100m / 1g，留空不分卷" className="input-sm w-full" />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
                  覆盖同名压缩包
                </label>
                <button
                  onClick={() => void runCompress()}
                  disabled={busy || sources.length === 0 || !outputPath || !runtime?.installed}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                  开始压缩 {sources.length > 0 ? `(${sources.length} 项 / ${formatBytes(totalSourceSize)})` : ''}
                </button>
                {resultPath && (
                  <button onClick={() => void openResult()} className="flex w-full items-center justify-center gap-2 rounded-lg border border-green-200 py-2 text-sm text-green-700 hover:bg-green-50 dark:border-green-900 dark:text-green-300 dark:hover:bg-green-950/30">
                    <CheckCircle2 size={16} />
                    打开结果位置
                  </button>
                )}
              </section>
            </div>
          )}

          {tab === 'extract' && (
            <div className="mt-4 grid grid-cols-[360px_minmax(0,1fr)] gap-4">
              <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <Field label="压缩包">
                  <div className="flex gap-2">
                    <input value={archivePath} onChange={(event) => setArchivePath(event.target.value)} className="input-sm min-w-0 flex-1" />
                    <ToolbarButton onClick={() => void chooseArchive()}>选择</ToolbarButton>
                  </div>
                </Field>
                <Field label="解压目录">
                  <div className="flex gap-2">
                    <input value={extractDir} onChange={(event) => setExtractDir(event.target.value)} className="input-sm min-w-0 flex-1" />
                    <ToolbarButton onClick={() => void chooseExtractDir()}>选择</ToolbarButton>
                  </div>
                </Field>
                <Field label={archiveEncrypted ? '密码（当前压缩包含加密项）' : '密码'}>
                  <div className="flex items-center gap-2">
                    {archiveEncrypted ? <Lock size={15} className="text-amber-500" /> : <Unlock size={15} className="text-gray-400" />}
                    <input type="password" value={extractPassword} onChange={(event) => setExtractPassword(event.target.value)} placeholder="需要时填写" className="input-sm min-w-0 flex-1" />
                    <ToolbarButton onClick={() => archivePath && void loadArchive(archivePath, extractPassword)}>预览</ToolbarButton>
                  </div>
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
                  覆盖同名文件
                </label>
                <button
                  onClick={() => void runExtract()}
                  disabled={busy || !archivePath || !extractDir || !runtime?.installed}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                  解压到目录
                </button>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                  <div className="font-semibold">压缩包内容</div>
                  <div className="text-xs text-gray-500">{archiveEntries.length} 项</div>
                </div>
                <div className="max-h-[580px] overflow-auto p-3">
                  {archiveEntries.length === 0 ? (
                    <EmptyState icon={<FileArchive size={34} />} text="选择压缩包后预览内容" />
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-gray-400">
                        <tr>
                          <th className="py-2">路径</th>
                          <th className="w-24 py-2">大小</th>
                          <th className="w-20 py-2">加密</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {archiveEntries.map((entry) => (
                          <tr key={entry.path}>
                            <td className="max-w-0 truncate py-2">{entry.path}</td>
                            <td className="py-2 text-xs text-gray-500">{entry.isDir ? '目录' : formatBytes(entry.size || 0)}</td>
                            <td className="py-2 text-xs">{entry.encrypted ? '是' : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</span>
      {children}
    </label>
  );
}
