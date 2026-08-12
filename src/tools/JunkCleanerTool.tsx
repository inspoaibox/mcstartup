import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { CheckSquare, Eye, RefreshCw, ShieldCheck, Sparkles, Square, Trash2 } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

interface CleanupItem {
  id: string;
  name: string;
  description: string;
  path: string;
  category: string;
  categoryLabel: string;
  risk: string;
  riskLabel: string;
  size: number;
  count: number;
  selectedByDefault: boolean;
  safe: boolean;
}

interface CleanupResult {
  deletedSize: number;
  deletedCount: number;
  failed: string[];
}

interface CleanupPreviewItem {
  path: string;
  name: string;
  size: number;
  modified?: number | null;
}

interface CleanupHistoryItem {
  time: string;
  size: number;
  count: number;
  failed: number;
}

type CleanMode = 'safe' | 'deep';

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

export default function JunkCleanerTool() {
  const ready = useToolTheme();
  const [items, setItems] = useState<CleanupItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<CleanMode>('safe');
  const [category, setCategory] = useState('all');
  const [minAgeDays, setMinAgeDays] = useState(0);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState('点击重新扫描开始统计可清理内容。');
  const [error, setError] = useState('');
  const [excludeText, setExcludeText] = useState('');
  const [previewTarget, setPreviewTarget] = useState<CleanupItem | null>(null);
  const [previewRows, setPreviewRows] = useState<CleanupPreviewItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [history, setHistory] = useState<CleanupHistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('mcstartup.junkCleaner.history') || '[]');
    } catch {
      return [];
    }
  });

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );
  const selectedSize = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.size, 0),
    [selectedItems],
  );
  const totalSize = useMemo(() => items.reduce((sum, item) => sum + item.size, 0), [items]);
  const categories = useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number; size: number }>();
    for (const item of items) {
      const row = map.get(item.category) || { id: item.category, label: item.categoryLabel, count: 0, size: 0 };
      row.count += 1;
      row.size += item.size;
      map.set(item.category, row);
    }
    return [{ id: 'all', label: '全部', count: items.length, size: totalSize }, ...map.values()];
  }, [items, totalSize]);
  const visibleItems = useMemo(
    () => items.filter((item) => category === 'all' || item.category === category),
    [category, items],
  );
  const excludePaths = useMemo(
    () =>
      excludeText
        .split(/[\r\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    [excludeText],
  );

  const scan = useCallback(async () => {
      setLoading(true);
    setError('');
    setMessage('');
    try {
      const rows = await invoke<CleanupItem[]>('system_cleanup_scan_with_options', {
        request: { minAgeDays: minAgeDays || undefined },
      });
      setItems(rows);
      setSelectedIds(
        rows
          .filter((item) => item.size > 0 && (mode === 'deep' ? item.safe : item.selectedByDefault && item.risk === 'safe'))
          .map((item) => item.id),
      );
      setMessage(`扫描完成，发现 ${formatBytes(rows.reduce((sum, item) => sum + item.size, 0))} 可清理内容`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [minAgeDays, mode]);

  const cancelWork = async () => {
    await invoke('system_cleanup_cancel').catch(() => {});
    setLoading(false);
    setCleaning(false);
    setMessage('已取消当前扫描/清理任务');
  };

  const toggleItem = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const clean = async () => {
    if (selectedIds.length === 0) {
      setError('请选择要清理的项目');
      return;
    }
    const detail = selectedItems
      .slice(0, 8)
      .map((item) => `- ${item.name}: ${formatBytes(item.size)} / ${item.count} 个文件`)
      .join('\n');
    const more = selectedItems.length > 8 ? `\n...另有 ${selectedItems.length - 8} 项` : '';
    if (
      !window.confirm(
        `确定清理已选项目吗？\n\n预计释放：${formatBytes(selectedSize)}\n项目：\n${detail}${more}\n\n建议在清理系统目录或浏览器缓存前关闭相关软件；如担心风险，请先创建系统还原点。`,
      )
    )
      return;
    setCleaning(true);
    setError('');
    setMessage('');
    try {
      const result = await invoke<CleanupResult>('system_cleanup_delete_with_options', {
        request: { ids: selectedIds, excludePaths, minAgeDays: minAgeDays || undefined },
      });
      const failedText = result.failed.length ? `，${result.failed.length} 项未完全清理` : '';
      setMessage(`已清理 ${formatBytes(result.deletedSize)} / ${result.deletedCount} 个文件${failedText}`);
      const nextHistory = [
        { time: new Date().toLocaleString(), size: result.deletedSize, count: result.deletedCount, failed: result.failed.length },
        ...history,
      ].slice(0, 8);
      setHistory(nextHistory);
      localStorage.setItem('mcstartup.junkCleaner.history', JSON.stringify(nextHistory));
      await scan();
    } catch (err) {
      setError(String(err));
    } finally {
      setCleaning(false);
    }
  };

  const preview = async (item: CleanupItem) => {
    setPreviewTarget(item);
    setPreviewRows([]);
    setPreviewLoading(true);
    setError('');
    try {
      const rows = await invoke<CleanupPreviewItem[]>('system_cleanup_preview', {
        request: { id: item.id, limit: 300, minAgeDays: minAgeDays || undefined },
      });
      setPreviewRows(rows);
    } catch (err) {
      setError(String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🧹"
        title="垃圾清理"
        subtitle="扫描常见临时文件、系统缓存与崩溃转储"
        actions={
          <div className="flex gap-2">
            {(loading || cleaning) && (
              <button
                onClick={() => void cancelWork()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20"
              >
                <Square size={14} />
                停止
              </button>
            )}
            <button
              onClick={() => void scan()}
              disabled={loading || cleaning}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              重新扫描
            </button>
          </div>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={16} />
            清理汇总
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
              <div className="text-xs text-gray-500">扫描总量</div>
              <div className="mt-1 text-xl font-semibold">{formatBytes(totalSize)}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
              <div className="text-xs text-gray-500">已选</div>
              <div className="mt-1 text-xl font-semibold text-blue-600">{formatBytes(selectedSize)}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
            {[
              ['safe', '安全清理'],
              ['deep', '深度清理'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMode(key as CleanMode)}
                className={`h-9 rounded-md text-sm font-medium ${
                  mode === key
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="mt-4 block space-y-2">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">只清理多少天前的文件</span>
            <select
              value={minAgeDays}
              onChange={(event) => setMinAgeDays(Number(event.target.value))}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
            >
              <option value={0}>不限时间</option>
              <option value={1}>1 天前</option>
              <option value={7}>7 天前</option>
              <option value={30}>30 天前</option>
            </select>
          </label>

          <button
            onClick={() => void clean()}
            disabled={cleaning || selectedIds.length === 0}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-green-600 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            <Trash2 size={16} />
            {cleaning ? '正在清理...' : `清理已选 ${selectedIds.length} 项`}
          </button>

          <label className="mt-4 block space-y-2">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">排除白名单</span>
            <textarea
              value={excludeText}
              onChange={(event) => setExcludeText(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              placeholder="每行一个不清理的文件或目录"
            />
          </label>

          <div className="mt-4 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck size={14} />
              白名单清理
            </div>
            <p className="mt-1">安全清理只默认勾选低风险项；深度清理会勾选更多缓存项，但仍不扫描个人文档、桌面、下载目录。</p>
          </div>

          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            深度清理前建议先创建系统还原点；清理浏览器缓存前建议关闭浏览器，避免缓存文件被占用。
          </div>

          {history.length > 0 && (
            <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">清理历史</div>
              <div className="mt-2 space-y-2">
                {history.map((item) => (
                  <div key={`${item.time}-${item.size}`} className="text-xs text-gray-500">
                    {item.time} · {formatBytes(item.size)} · {item.count} 个文件
                    {item.failed ? ` · 失败 ${item.failed}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(message || error) && (
            <div
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${
                error
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                  : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
              }`}
            >
              {error || message}
            </div>
          )}
        </section>

        <section className="min-h-0 min-w-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex flex-wrap gap-2">
            {categories.map((item) => (
              <button
                key={item.id}
                onClick={() => setCategory(item.id)}
                className={`rounded-lg border px-3 py-2 text-left text-xs ${
                  category === item.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                <div className="font-semibold">{item.label}</div>
                <div className="mt-0.5 opacity-70">
                  {item.count} 项 · {formatBytes(item.size)}
                </div>
              </button>
            ))}
          </div>
          <div className="grid gap-3">
            {visibleItems.map((item) => {
              const checked = selectedIds.includes(item.id);
              return (
                <div
                  key={item.id}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    checked
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleItem(item.id)}
                          className="inline-flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-white/70 dark:hover:bg-gray-800"
                        >
                          <CheckSquare size={16} className={checked ? 'text-blue-600' : 'text-gray-400'} />
                        </button>
                        <span className="font-semibold">{item.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                          item.risk === 'safe'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
                        }`}>
                          {item.riskLabel}
                        </span>
                        {!item.selectedByDefault && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                            手动选择
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{item.description}</p>
                      <p className="mt-1 text-xs text-gray-500">{item.categoryLabel}</p>
                      <p className="mt-1 truncate font-mono text-xs text-gray-400" title={item.path}>
                        {item.path}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-lg font-semibold text-blue-600">{formatBytes(item.size)}</div>
                      <div className="text-xs text-gray-500">{item.count} 个文件</div>
                      <button
                        onClick={() => void preview(item)}
                        className="mt-2 inline-flex h-7 items-center gap-1 rounded-lg border border-gray-200 px-2 text-xs font-medium text-gray-600 hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <Eye size={13} />
                        预览
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {visibleItems.length === 0 && !loading && (
              <div className="flex h-72 flex-col items-center justify-center text-gray-400">
                <Sparkles size={36} />
                <p className="mt-2 text-sm">点击重新扫描开始统计可清理内容</p>
              </div>
            )}
          </div>
        </section>
      </main>

      {previewTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <section className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{previewTarget.name} 文件预览</div>
                <div className="mt-1 truncate font-mono text-xs text-gray-500">{previewTarget.path}</div>
              </div>
              <button
                onClick={() => setPreviewTarget(null)}
                className="h-8 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {previewLoading ? (
                <div className="flex h-48 items-center justify-center text-sm text-gray-500">正在读取文件列表...</div>
              ) : (
                <div className="min-w-[700px]">
                  <div className="grid grid-cols-[120px_220px_minmax(260px,1fr)] border-b border-gray-200 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
                    <span>大小</span>
                    <span>文件名</span>
                    <span>路径</span>
                  </div>
                  {previewRows.map((row) => (
                    <div
                      key={row.path}
                      className="grid grid-cols-[120px_220px_minmax(260px,1fr)] border-b border-gray-100 py-2 text-sm dark:border-gray-800"
                    >
                      <span className="font-semibold text-blue-600">{formatBytes(row.size)}</span>
                      <span className="truncate" title={row.name}>
                        {row.name}
                      </span>
                      <span className="truncate font-mono text-xs text-gray-500" title={row.path}>
                        {row.path}
                      </span>
                    </div>
                  ))}
                  {previewRows.length === 0 && (
                    <div className="flex h-40 items-center justify-center text-sm text-gray-400">没有可预览文件</div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
