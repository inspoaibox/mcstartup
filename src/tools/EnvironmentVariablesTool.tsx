import { useCallback, useEffect, useMemo, useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { ArrowDown, ArrowUp, Download, ExternalLink, FolderOpen, Plus, RefreshCw, RotateCcw, Save, Search, Trash2, Upload } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { StatusMessage, ToolbarButton } from './systemToolUtils';

interface EnvVarEntry {
  scope: 'user' | 'machine';
  name: string;
  value: string;
  isPath: boolean;
}

interface EnvPathValidationItem {
  path: string;
  expandedPath: string;
  exists: boolean;
  duplicate: boolean;
}

interface EnvBackupHistoryItem {
  key: string;
  label: string;
  value: string;
  time: string;
}

const SCOPE_LABEL: Record<string, string> = {
  user: '用户变量',
  machine: '系统变量',
};

function splitPath(value: string) {
  return value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePathKey(value: string) {
  const normalized = value.trim().replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
  return normalized.length === 2 && normalized.endsWith(':') ? `${normalized}\\` : normalized;
}

function backupHistoryKey() {
  return 'mcstartup.environmentVariables.backups';
}

export default function EnvironmentVariablesTool() {
  const ready = useToolTheme();
  const [items, setItems] = useState<EnvVarEntry[]>([]);
  const [scope, setScope] = useState<'user' | 'machine'>('user');
  const [mode, setMode] = useState<'path' | 'vars'>('path');
  const [search, setSearch] = useState('');
  const [selectedName, setSelectedName] = useState('Path');
  const [editorValue, setEditorValue] = useState('');
  const [pathRows, setPathRows] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('点击刷新读取环境变量。');
  const [error, setError] = useState('');
  const [backupMap, setBackupMap] = useState<Record<string, string>>({});
  const [pathValidation, setPathValidation] = useState<Record<string, EnvPathValidationItem>>({});
  const [backupHistory, setBackupHistory] = useState<EnvBackupHistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(backupHistoryKey()) || '[]');
    } catch {
      return [];
    }
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await invoke<EnvVarEntry[]>('system_env_list');
      setItems(rows);
      setMessage(`已读取 ${rows.length} 个环境变量`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      void load();
    }
  }, [load, ready]);

  const activeItem = useMemo(
    () => items.find((item) => item.scope === scope && item.name.toLowerCase() === selectedName.toLowerCase()) ?? null,
    [items, scope, selectedName],
  );
  const editingNewVar = mode === 'vars' && selectedName.trim() !== '' && !activeItem;

  useEffect(() => {
    const pathItem = items.find((item) => item.scope === scope && item.isPath);
    if (mode === 'path') {
      setSelectedName('Path');
      setPathRows(splitPath(pathItem?.value ?? ''));
    }
  }, [items, mode, scope]);

  useEffect(() => {
    if (mode === 'vars') {
      setEditorValue(activeItem?.value ?? '');
    }
  }, [activeItem, mode]);

  const filteredVars = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      if (item.scope !== scope) return false;
      if (mode === 'path' && !item.isPath) return false;
      if (mode === 'vars' && item.isPath) return false;
      if (!keyword) return true;
      return [item.name, item.value].join(' ').toLowerCase().includes(keyword);
    });
  }, [items, mode, scope, search]);

  const backupCurrentValue = (name: string, value: string) => {
    const key = `${scope}:${name}`;
    setBackupMap((current) => (current[key] ? current : { ...current, [key]: value }));
    const next = [
      { key, label: `${SCOPE_LABEL[scope]} ${name}`, value, time: new Date().toLocaleString() },
      ...backupHistory.filter((item) => item.key !== key || item.value !== value),
    ].slice(0, 12);
    setBackupHistory(next);
    localStorage.setItem(backupHistoryKey(), JSON.stringify(next));
  };

  const savePath = async () => {
    const currentValue = items.find((item) => item.scope === scope && item.isPath)?.value ?? '';
    const normalizedRows = pathRows.map((row) => row.trim().replace(/;+$/, '').trim()).filter(Boolean);
    const removed = pathRows.length - normalizedRows.length;
    const detail = [
      `${SCOPE_LABEL[scope]} PATH`,
      `当前 ${splitPath(currentValue).length} 条，保存后 ${normalizedRows.length} 条。`,
      removed > 0 ? `会移除 ${removed} 条空路径。` : '',
      scope === 'machine' ? '系统变量保存可能触发管理员授权。' : '',
    ]
      .filter(Boolean)
      .join('\n');
    if (!window.confirm(`确定保存 PATH 修改吗？\n\n${detail}`)) return;
    backupCurrentValue('Path', currentValue);
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const rows = await invoke<EnvVarEntry[]>('system_env_update_path', { request: { scope, paths: normalizedRows } });
      setItems(rows);
      setPathValidation({});
      setMessage(`${SCOPE_LABEL[scope]} Path 已保存，并已通知 Windows 刷新环境变量`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const saveVar = async () => {
    const name = selectedName.trim();
    if (!name) {
      setError('变量名不能为空');
      return;
    }
    if (name.includes('=')) {
      setError('变量名不能包含 =');
      return;
    }
    if (name.toLowerCase() === 'path') {
      setMode('path');
      setError('PATH 请在 PATH 面板中分条编辑');
      return;
    }
    if (scope === 'machine' && !window.confirm(`确定${editingNewVar ? '新增' : '保存'}系统变量“${name}”吗？可能需要管理员授权。`)) return;
    backupCurrentValue(name, activeItem?.value ?? '');
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const rows = await invoke<EnvVarEntry[]>('system_env_update', {
        request: { scope, name, value: editorValue },
      });
      setItems(rows);
      setSelectedName(name);
      setMessage(`${SCOPE_LABEL[scope]} ${name} 已${editingNewVar ? '新增' : '保存'}，并已通知 Windows 刷新环境变量`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const deleteVar = async () => {
    const name = selectedName.trim();
    if (!name) {
      setError('变量名不能为空');
      return;
    }
    if (name.toLowerCase() === 'path') {
      setError('PATH 不允许直接删除，请在 PATH 面板中分条编辑');
      return;
    }
    const currentValue = activeItem?.value ?? '';
    if (!activeItem) {
      setError('当前变量不存在，无法删除');
      return;
    }
    if (!window.confirm(`确定删除 ${SCOPE_LABEL[scope]}“${name}”吗？\n\n删除前会写入本地备份历史。`)) return;
    backupCurrentValue(name, currentValue);
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const rows = await invoke<EnvVarEntry[]>('system_env_delete', {
        request: { scope, name },
      });
      setItems(rows);
      setSelectedName('Path');
      setMode('path');
      setMessage(`${SCOPE_LABEL[scope]} ${name} 已删除，并已通知 Windows 刷新环境变量`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const startCreateVar = () => {
    setMode('vars');
    setSelectedName('');
    setEditorValue('');
    setError('');
    setMessage('请输入变量名和值，保存后会新增到当前范围。');
  };

  const validatePaths = async () => {
    setError('');
    try {
      const rows = await invoke<EnvPathValidationItem[]>('system_env_validate_paths', {
        request: { paths: pathRows, scope },
      });
      const map: Record<string, EnvPathValidationItem> = {};
      rows.forEach((item, index) => {
        map[`${index}:${item.path}`] = item;
      });
      setPathValidation(map);
      const missing = rows.filter((item) => !item.exists).length;
      const duplicate = rows.filter((item) => item.duplicate).length;
      setMessage(`检测完成：不存在 ${missing} 条，重复 ${duplicate} 条`);
    } catch (err) {
      setError(String(err));
    }
  };

  const cleanDuplicatePaths = () => {
    const seen = new Set<string>();
    const next = pathRows.filter((row) => {
      const key = normalizePathKey(row);
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setPathRows(next);
    setPathValidation({});
    setMessage(`已移除 ${pathRows.length - next.length} 条空路径或重复路径，保存后才会写入系统。`);
  };

  const addFolderToPath = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    setPathRows((current) => [...current, selected]);
    setPathValidation({});
  };

  const exportBackup = async () => {
    const target = await save({
      title: '导出环境变量备份',
      defaultPath: `mcstartup-env-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!target) return;
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
      backupHistory,
    };
    await writeTextFile(target, JSON.stringify(payload, null, 2));
    setMessage(`已导出环境变量备份：${target}`);
  };

  const importBackup = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      const text = await readTextFile(selected);
      const payload = JSON.parse(text) as { items?: EnvVarEntry[]; backupHistory?: EnvBackupHistoryItem[] };
      const importedHistory = Array.isArray(payload.backupHistory) ? payload.backupHistory : [];
      const itemBackups = Array.isArray(payload.items)
        ? payload.items.map((item) => ({
            key: `${item.scope}:${item.name}`,
            label: `${SCOPE_LABEL[item.scope]} ${item.name}`,
            value: item.value,
            time: payload.backupHistory?.[0]?.time || new Date().toLocaleString(),
          }))
        : [];
      const nextHistory = [...itemBackups, ...importedHistory].slice(0, 50);
      if (nextHistory.length === 0) {
        setError('备份文件没有可读取的环境变量数据');
        return;
      }
      setBackupHistory(nextHistory);
      localStorage.setItem(backupHistoryKey(), JSON.stringify(nextHistory));
      setMessage('已导入备份到历史记录。要写入系统，请在备份历史中点击恢复。');
    } catch (err) {
      setError(String(err));
    }
  };

  const restoreHistory = async (item: EnvBackupHistoryItem) => {
    const [historyScope, ...nameParts] = item.key.split(':');
    const name = nameParts.join(':');
    if (historyScope !== 'user' && historyScope !== 'machine') return;
    if (!window.confirm(`确定恢复 ${item.label} 到 ${item.time} 的备份吗？`)) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const rows =
        name.toLowerCase() === 'path'
          ? await invoke<EnvVarEntry[]>('system_env_update_path', { request: { scope: historyScope, paths: splitPath(item.value) } })
          : await invoke<EnvVarEntry[]>('system_env_update', { request: { scope: historyScope, name, value: item.value } });
      setItems(rows);
      setScope(historyScope);
      setSelectedName(name);
      setMode(name.toLowerCase() === 'path' ? 'path' : 'vars');
      setMessage(`${item.label} 已恢复历史备份`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const restoreCurrent = async () => {
    const name = mode === 'path' ? 'Path' : selectedName.trim();
    const backupKey = `${scope}:${name}`;
    if (!(backupKey in backupMap)) {
      setError('当前变量没有本轮备份');
      return;
    }
    const value = backupMap[backupKey];
    if (!window.confirm(`确定恢复 ${SCOPE_LABEL[scope]} ${name} 到本轮修改前的值吗？`)) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const rows =
        mode === 'path'
          ? await invoke<EnvVarEntry[]>('system_env_update_path', { request: { scope, paths: splitPath(value) } })
          : await invoke<EnvVarEntry[]>('system_env_update', { request: { scope, name, value } });
      setItems(rows);
      setMessage(`${SCOPE_LABEL[scope]} ${name} 已恢复到本轮备份`);
      setBackupMap((current) => {
        const next = { ...current };
        delete next[backupKey];
        return next;
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const movePath = (index: number, offset: number) => {
    const next = [...pathRows];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPathRows(next);
    setPathValidation({});
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🧬"
        title="环境变量 / PATH 管理"
        subtitle="分条管理用户和系统 PATH，支持变量新增、查看、编辑、删除和备份恢复"
        actions={
          <>
            <ToolbarButton onClick={() => void invoke('system_env_open_editor')}>
              <ExternalLink size={14} />
              系统面板
            </ToolbarButton>
            <ToolbarButton onClick={() => void importBackup()} disabled={loading}>
              <Upload size={14} />
              导入备份
            </ToolbarButton>
            <ToolbarButton onClick={() => void exportBackup()} disabled={loading || items.length === 0}>
              <Download size={14} />
              导出备份
            </ToolbarButton>
            <ToolbarButton onClick={startCreateVar} disabled={loading}>
              <Plus size={14} />
              新增变量
            </ToolbarButton>
            <ToolbarButton onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </ToolbarButton>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="grid grid-cols-2 gap-2">
            {(['user', 'machine'] as const).map((item) => (
              <button
                key={item}
                onClick={() => setScope(item)}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  scope === item
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                {SCOPE_LABEL[item]}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[
              ['path', 'PATH'],
              ['vars', '变量'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMode(key as 'path' | 'vars')}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  mode === key
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <Search size={16} className="text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索变量..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-auto">
            {filteredVars.map((item) => (
              <button
                key={`${item.scope}-${item.name}`}
                onClick={() => {
                  setSelectedName(item.name);
                  setMode(item.isPath ? 'path' : 'vars');
                }}
                className={`mb-2 w-full rounded-lg border p-3 text-left ${
                  selectedName.toLowerCase() === item.name.toLowerCase()
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800'
                }`}
              >
                <div className="font-semibold">{item.name}</div>
                <div className="mt-1 truncate text-xs text-gray-500">{item.value}</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <StatusMessage message={message} error={error} />
          {mode === 'path' ? (
            <div className="mt-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">{SCOPE_LABEL[scope]} PATH</div>
                <div className="flex gap-2">
                  <ToolbarButton onClick={() => void validatePaths()} disabled={loading}>
                    <Search size={14} />
                    检测
                  </ToolbarButton>
                  <ToolbarButton onClick={cleanDuplicatePaths} disabled={loading}>
                    <Trash2 size={14} />
                    清理重复
                  </ToolbarButton>
                  <ToolbarButton onClick={() => void restoreCurrent()} disabled={loading}>
                    <RotateCcw size={14} />
                    恢复本轮备份
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => {
                      setPathRows((current) => [...current, '']);
                      setPathValidation({});
                    }}
                  >
                    <Plus size={14} />
                    添加路径
                  </ToolbarButton>
                  <ToolbarButton onClick={() => void addFolderToPath()} disabled={loading}>
                    <FolderOpen size={14} />
                    选择文件夹
                  </ToolbarButton>
                  <ToolbarButton onClick={() => void savePath()} disabled={loading}>
                    <Save size={14} />
                    保存
                  </ToolbarButton>
                </div>
              </div>
              <div className="space-y-2">
                {pathRows.map((row, index) => {
                  const validation = pathValidation[`${index}:${row.trim()}`];
                  const invalid = validation && !validation.exists;
                  const duplicate = validation?.duplicate;
                  return (
                    <div
                      key={`${index}-${row}`}
                      className={`rounded-lg border p-2 ${
                        invalid || duplicate
                          ? 'border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-900/10'
                          : 'border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <input
                          value={row}
                          onChange={(event) => {
                            setPathRows((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)));
                            setPathValidation({});
                          }}
                          className="min-w-0 bg-transparent px-2 text-sm outline-none"
                        />
                        <div className="flex gap-1">
                          <button onClick={() => movePath(index, -1)} className="rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800">
                            <ArrowUp size={14} />
                          </button>
                          <button onClick={() => movePath(index, 1)} className="rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800">
                            <ArrowDown size={14} />
                          </button>
                          <button
                            onClick={() => {
                              setPathRows((current) => current.filter((_, itemIndex) => itemIndex !== index));
                              setPathValidation({});
                            }}
                            className="rounded-md p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {(invalid || duplicate) && (
                        <div className="mt-1 px-2 text-xs text-amber-700 dark:text-amber-200">
                          {invalid ? '路径不存在' : ''}
                          {invalid && duplicate ? '，' : ''}
                          {duplicate ? '重复路径' : ''}
                          {validation?.expandedPath && validation.expandedPath !== row.trim() ? `：${validation.expandedPath}` : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <div className="grid gap-3">
                <div className={`rounded-lg border px-3 py-2 text-sm ${
                  editingNewVar
                    ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300'
                }`}>
                  {editingNewVar ? '当前正在新增变量，保存后会写入当前范围。' : activeItem ? `正在编辑 ${SCOPE_LABEL[scope]} 中的现有变量。` : '请选择变量，或点击“新增变量”。'}
                </div>
                <label className="text-sm font-semibold">
                  变量名
                  <input
                    value={selectedName}
                    onChange={(event) => setSelectedName(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>
                <label className="text-sm font-semibold">
                  变量值
                  <textarea
                    value={editorValue}
                    onChange={(event) => setEditorValue(event.target.value)}
                    className="mt-2 min-h-[320px] w-full resize-none rounded-lg border border-gray-200 bg-white p-3 font-mono text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>
                <button
                  onClick={() => void saveVar()}
                  className="inline-flex h-10 w-fit items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  <Save size={16} />
                  {editingNewVar ? '新增变量' : '保存变量'}
                </button>
                <button
                  onClick={() => void restoreCurrent()}
                  disabled={loading}
                  className="inline-flex h-10 w-fit items-center gap-2 rounded-lg border border-blue-200 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/20"
                >
                  <RotateCcw size={16} />
                  恢复本轮备份
                </button>
                <button
                  onClick={() => void deleteVar()}
                  disabled={loading || !activeItem || selectedName.trim().toLowerCase() === 'path'}
                  className="inline-flex h-10 w-fit items-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20"
                >
                  <Trash2 size={16} />
                  删除变量
                </button>
              </div>
            </div>
          )}

          {backupHistory.length > 0 && (
            <div className="mt-6 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="text-sm font-semibold">备份历史</div>
              <div className="mt-2 space-y-2">
                {backupHistory.map((item) => (
                  <div key={`${item.key}-${item.time}`} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-950">
                    <div className="min-w-0">
                      <div className="font-medium">{item.label}</div>
                      <div className="mt-0.5 text-gray-500">{item.time}</div>
                    </div>
                    <button
                      onClick={() => void restoreHistory(item)}
                      className="h-7 shrink-0 rounded-lg border border-gray-200 px-2 font-medium text-blue-600 hover:bg-white dark:border-gray-700 dark:text-blue-300 dark:hover:bg-gray-800"
                    >
                      恢复
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
