import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertTriangle,
  File,
  Folder,
  Globe2,
  HardDrive,
  Image as ImageIcon,
  Info,
  Monitor,
  Music,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  Trash2,
  Power,
  Video,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { EmptyState, StatusMessage, ToolbarButton } from './systemToolUtils';

interface ContextMenuEntry {
  id: string;
  root: string;
  sourceLabel: string;
  scope: string;
  scopeLabel: string;
  menuType: string;
  menuTypeLabel: string;
  key: string;
  label: string;
  command: string;
  icon: string;
  shiftOnly: boolean;
  disabled: boolean;
  canDelete: boolean;
  canEdit: boolean;
  registryPath: string;
  registryItemPath: string;
  commandRegistryPath: string;
  extensionId: string;
  extensionName: string;
  extensionServer: string;
  appliesTo: string;
  position: string;
  note: string;
}

const SCOPE_OPTIONS = [
  { value: 'all', label: '全部对象', icon: Search },
  { value: 'desktop', label: '桌面空白处', icon: Monitor },
  { value: 'desktop-background', label: '桌面背景类', icon: Monitor },
  { value: 'folder', label: '文件夹', icon: Folder },
  { value: 'folder-root', label: 'Folder 类', icon: Folder },
  { value: 'file', label: '任意文件', icon: File },
  { value: 'all-filesystem', label: '文件系统对象', icon: Folder },
  { value: 'drive', label: '磁盘驱动器', icon: HardDrive },
  { value: 'shortcut', label: '快捷方式', icon: File },
  { value: 'executable', label: '可执行文件', icon: File },
  { value: 'image', label: '图片文件', icon: ImageIcon },
  { value: 'audio', label: '音频文件', icon: Music },
  { value: 'video', label: '视频文件', icon: Video },
  { value: 'this-pc', label: '此电脑', icon: Monitor },
  { value: 'recycle-bin', label: '回收站', icon: Trash2 },
  { value: 'network', label: '网络', icon: Globe2 },
  { value: 'browser', label: '浏览器扩展', icon: Globe2 },
];

const TYPE_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'shell', label: '命令菜单' },
  { value: 'ContextMenuHandlers', label: '扩展菜单' },
  { value: 'DragDropHandlers', label: '拖放扩展' },
  { value: 'browser-extension', label: '浏览器扩展菜单' },
];

const SOURCE_OPTIONS = [
  { value: 'all', label: '全部来源' },
  { value: 'HKCU', label: '当前用户' },
  { value: 'HKCR', label: '系统合并视图' },
  { value: 'BROWSER', label: '浏览器扩展' },
];

const WRITE_SCOPE_OPTIONS = [
  { value: 'desktop', label: '桌面空白处', desc: '写入 HKCU\\Software\\Classes\\Directory\\Background\\shell' },
  { value: 'folder', label: '文件夹', desc: '写入 HKCU\\Software\\Classes\\Directory\\shell' },
  { value: 'file', label: '任意文件', desc: '写入 HKCU\\Software\\Classes\\*\\shell' },
];

function scopeCount(items: ContextMenuEntry[], scope: string) {
  if (scope === 'all') return items.length;
  return items.filter((item) => item.scope === scope).length;
}

function typeTone(type: string) {
  if (type === 'shell') return 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-200';
  if (type === 'DragDropHandlers') return 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-200';
  if (type === 'browser-extension') return 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-200';
  return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200';
}

function sourceTone(root: string) {
  if (root === 'BROWSER') return 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-200';
  return root === 'HKCU'
    ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-200'
    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
}

function detailValue(value?: string) {
  return value && value.trim() ? value : '-';
}

export default function ContextMenuManagerTool() {
  const ready = useToolTheme();
  const [items, setItems] = useState<ContextMenuEntry[]>([]);
  const [scope, setScope] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ContextMenuEntry | null>(null);
  const [editing, setEditing] = useState<ContextMenuEntry | null>(null);
  const [writeScope, setWriteScope] = useState('desktop');
  const [label, setLabel] = useState('');
  const [command, setCommand] = useState('');
  const [icon, setIcon] = useState('');
  const [shiftOnly, setShiftOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await invoke<ContextMenuEntry[]>('system_context_menu_list');
      setItems(rows);
      setSelected((current) => current ?? rows[0] ?? null);
      setMessage(`已读取 ${rows.length} 个右键菜单项`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      if (scope !== 'all' && item.scope !== scope) return false;
      if (typeFilter !== 'all' && item.menuType !== typeFilter) return false;
      if (sourceFilter !== 'all' && item.root !== sourceFilter) return false;
      if (!keyword) return true;
      return [
        item.label,
        item.key,
        item.command,
        item.icon,
        item.registryPath,
        item.registryItemPath,
        item.commandRegistryPath,
        item.extensionId,
        item.sourceLabel,
        item.scopeLabel,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [items, scope, search, sourceFilter, typeFilter]);

  const startEdit = (item?: ContextMenuEntry) => {
    setEditing(item ?? null);
    setWriteScope(item?.scope ?? (scope === 'all' ? 'desktop' : scope));
    setLabel(item?.label ?? '');
    setCommand(item?.command ?? '');
    setIcon(item?.icon ?? '');
    setShiftOnly(item?.shiftOnly ?? false);
    if (item) setSelected(item);
  };

  const save = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const rows = await invoke<ContextMenuEntry[]>('system_context_menu_save', {
        request: {
          scope: writeScope,
          key: editing?.canEdit ? editing.key : undefined,
          label,
          command,
          icon,
          shiftOnly,
        },
      });
      setItems(rows);
      const next = rows.find((item) => item.label === label && item.scope === writeScope) ?? rows[0] ?? null;
      setSelected(next);
      setMessage(`${label} 已保存到当前用户右键菜单`);
      startEdit();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const remove = async (item: ContextMenuEntry) => {
    const detail = item.menuType === 'shell' ? item.command || item.registryItemPath : item.extensionId || item.registryItemPath;
    if (!window.confirm(`确定删除右键菜单“${item.label}”吗？\n\n位置：${item.registryItemPath}\n内容：${detail}`)) return;
    setError('');
    setMessage('');
    try {
      const rows = await invoke<ContextMenuEntry[]>('system_context_menu_delete', { request: { id: item.id } });
      setItems(rows);
      setSelected(rows[0] ?? null);
      setMessage(`${item.label} 已删除`);
    } catch (err) {
      setError(String(err));
    }
  };

  const setDisabled = async (item: ContextMenuEntry, disabled: boolean) => {
    const text = disabled ? '禁用' : '恢复';
    if (!window.confirm(`确定${text}右键菜单“${item.label}”吗？\n\n位置：${item.registryItemPath}`)) return;
    setError('');
    setMessage('');
    try {
      const rows = await invoke<ContextMenuEntry[]>('system_context_menu_set_disabled', {
        request: { id: item.id, disabled },
      });
      setItems(rows);
      const next = rows.find((row) => row.id === item.id) ?? rows[0] ?? null;
      setSelected(next);
      setMessage(`${item.label} 已${text}`);
    } catch (err) {
      setError(String(err));
    }
  };

  const exportReg = async (item: ContextMenuEntry) => {
    setError('');
    setMessage('');
    try {
      const path = await invoke<string>('system_context_menu_export', { request: { id: item.id } });
      setMessage(`已导出 .reg 备份：${path}`);
    } catch (err) {
      setError(String(err));
    }
  };

  const refreshExplorer = async () => {
    if (!window.confirm('确定刷新 Explorer 吗？桌面和任务栏会短暂重启。')) return;
    setError('');
    setMessage('');
    try {
      await invoke('system_explorer_refresh');
      setMessage('已刷新 Explorer');
    } catch (err) {
      setError(String(err));
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🖱️"
        title="右键菜单管理"
        subtitle="查看 Explorer、文件类型、Shell 扩展和浏览器扩展右键菜单来源，区分可编辑命令与只读扩展"
        actions={
          <>
            <ToolbarButton onClick={() => startEdit()}>
              <Plus size={14} />
              新增命令
            </ToolbarButton>
            <ToolbarButton onClick={() => void refreshExplorer()}>
              <RefreshCw size={14} />
              刷新 Explorer
            </ToolbarButton>
            <ToolbarButton onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </ToolbarButton>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_430px] gap-4 overflow-hidden p-4 max-lg:grid-cols-1">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="grid grid-cols-6 gap-2 max-2xl:grid-cols-4 max-xl:grid-cols-3 max-lg:grid-cols-2">
            {SCOPE_OPTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.value}
                  onClick={() => setScope(item.value)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${
                    scope === item.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={15} />
                    <span className="font-medium">{item.label}</span>
                  </div>
                  <div className="mt-1 text-xs opacity-70">{scopeCount(items, item.value)} 项</div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-[1fr_190px_170px] gap-2 max-lg:grid-cols-1">
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
              <Search size={16} className="text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索菜单名称、命令、CLSID、注册表路径..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none dark:border-gray-700 dark:bg-gray-950"
            >
              {TYPE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none dark:border-gray-700 dark:bg-gray-950"
            >
              {SOURCE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
            {filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelected(item)}
                onDoubleClick={() => item.canEdit && startEdit(item)}
                className={`mb-2 w-full rounded-lg border p-3 text-left ${
                  selected?.id === item.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-semibold">{item.label || item.key}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${typeTone(item.menuType)}`}>
                        {item.menuTypeLabel}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${sourceTone(item.root)}`}>
                        {item.sourceLabel}
                      </span>
                      {item.root === 'BROWSER' && <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] text-cyan-700">只读候选</span>}
                      {item.shiftOnly && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">Shift 显示</span>}
                      {item.disabled && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-600">已禁用</span>}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{item.appliesTo}</div>
                    <div className="mt-1 truncate font-mono text-xs text-gray-500">
                      {item.command || item.extensionId || item.registryItemPath}
                    </div>
                    <div className="mt-1 truncate text-xs text-gray-400">{item.registryItemPath}</div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-gray-400">
                    <div>{item.root}</div>
                    <div className="mt-1">{item.key}</div>
                  </div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <EmptyState icon={<Search size={32} />} text="没有找到右键菜单项" />}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-3 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <StatusMessage message={message} error={error} />

          <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">当前选中项</div>
              {selected?.canDelete && (
                <div className="flex gap-2">
                  <button
                    onClick={() => void setDisabled(selected, !selected.disabled)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 px-3 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/20"
                  >
                    <Power size={14} />
                    {selected.disabled ? '恢复' : '禁用'}
                  </button>
                  <button
                    onClick={() => void exportReg(selected)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <Save size={14} />
                    备份
                  </button>
                  <button
                    onClick={() => void remove(selected)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                </div>
              )}
            </div>

            {selected ? (
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <div className="text-base font-semibold">{selected.label || selected.key}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${typeTone(selected.menuType)}`}>{selected.menuTypeLabel}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${sourceTone(selected.root)}`}>{selected.sourceLabel}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {selected.scopeLabel}
                    </span>
                  </div>
                </div>

                {[
                  ['作用对象', selected.appliesTo],
                  ['注册表项名', selected.key],
                  ['父级位置', selected.registryPath],
                  ['完整位置', selected.registryItemPath],
                  ['命令位置', selected.commandRegistryPath],
                  ['执行命令', selected.command],
                  ['扩展 CLSID', selected.extensionId],
                  ['CLSID 名称', selected.extensionName],
                  ['CLSID 组件', selected.extensionServer],
                  ['图标', selected.icon],
                  ['菜单排序', selected.position],
                  ['显示条件', selected.shiftOnly ? '仅按住 Shift 时显示' : '普通右键直接显示'],
                  ['状态', selected.disabled ? '注册表标记为禁用/仅程序调用' : '正常'],
                ].map(([name, value]) => (
                  <div key={name}>
                    <div className="text-xs text-gray-500">{name}</div>
                    <div className="mt-1 break-all font-mono text-xs leading-5">{detailValue(value)}</div>
                  </div>
                ))}

                {selected.note && (
                  <div className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <Info size={14} />
                      说明
                    </div>
                    <div className="mt-1">{selected.note}</div>
                  </div>
                )}

                {selected.canEdit ? (
                  <button
                    onClick={() => startEdit(selected)}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-blue-200 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/20"
                  >
                    <Save size={15} />
                    编辑当前用户命令
                  </button>
                ) : (
                  <div className="rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                    系统合并视图、COM 扩展和浏览器扩展项不提供直接编辑命令。浏览器右键菜单由扩展运行时动态创建，请到浏览器扩展管理页禁用或删除。
                  </div>
                )}
              </div>
            ) : (
              <EmptyState icon={<Search size={28} />} text="请选择一个右键菜单项" />
            )}
          </section>

          <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Plus size={15} />
              {editing ? '编辑命令菜单' : '新增命令菜单'}
            </div>
            <div className="mt-3 space-y-3">
              <label className="block text-sm font-semibold">
                写入位置
                <select
                  value={writeScope}
                  onChange={(event) => setWriteScope(event.target.value)}
                  disabled={Boolean(editing?.canEdit)}
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-70 dark:border-gray-700 dark:bg-gray-950"
                >
                  {WRITE_SCOPE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-xs font-normal text-gray-400">
                  {WRITE_SCOPE_OPTIONS.find((item) => item.value === writeScope)?.desc}
                </div>
              </label>
              <label className="block text-sm font-semibold">
                菜单名称
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>
              <label className="block text-sm font-semibold">
                执行命令
                <textarea
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder='例如："C:\\Program Files\\App\\app.exe" "%1"'
                  className="mt-2 min-h-[110px] w-full resize-none rounded-lg border border-gray-200 bg-white p-3 font-mono text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>
              <label className="block text-sm font-semibold">
                图标路径（可选）
                <input
                  value={icon}
                  onChange={(event) => setIcon(event.target.value)}
                  placeholder="可填写 exe / ico / dll 路径"
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={shiftOnly} onChange={(event) => setShiftOnly(event.target.checked)} />
                仅按住 Shift 时显示
              </label>
              <button
                onClick={() => void save()}
                disabled={loading}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Save size={16} />
                保存到当前用户
              </button>
              <div className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle size={14} />
                  注册表修改提示
                </div>
                <p className="mt-1">
                  新增和编辑只写入当前用户 HKCU，不需要管理员权限。删除系统合并视图 HKCR 项时请确认来源；浏览器扩展项只做来源展示，不在这里删除。
                </p>
              </div>
              <div className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Shield size={14} />
                  类型说明
                </div>
                <p className="mt-1">命令菜单是可直接运行的 shell 命令；扩展菜单是 Explorer 加载的 COM 组件；浏览器扩展菜单来自扩展 manifest 权限和运行时代码。</p>
              </div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
