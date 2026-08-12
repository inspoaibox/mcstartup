import { useCallback, useEffect, useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertTriangle,
  Bluetooth,
  CheckSquare,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Monitor,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
  Trash2,
  Usb,
  Volume2,
  Wifi,
  Wrench,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { EmptyState, StatusMessage, ToolbarButton, formatBytes } from './systemToolUtils';

interface DriverPackage {
  publishedName: string;
  originalName: string;
  providerName: string;
  className: string;
  category: string;
  categoryLabel: string;
  classGuid: string;
  extensionId: string;
  driverVersion: string;
  driverDate: string;
  signerName: string;
  catalogFile: string;
  driverFiles: string[];
  size: number;
  installed: boolean;
  deviceNames: string[];
  olderDuplicate: boolean;
  selectedByDefault: boolean;
}

interface DriverUpdateInfo {
  title: string;
  description: string;
  categories: string[];
  severity: string;
  rebootRequired: boolean;
  driverClass: string;
  driverManufacturer: string;
  driverModel: string;
  driverProvider: string;
  driverVersion: string;
  matchedCategories: string[];
  matchedPackages: string[];
}

interface DriverStoreStatus {
  packages: DriverPackage[];
  totalSize: number;
  thirdPartyCount: number;
  duplicateCount: number;
  installedCount: number;
  updateChecked: boolean;
  updateCheckTime: string;
  updateCount: number;
  updates: DriverUpdateInfo[];
  updateMessage: string;
  message: string;
}

interface DriverActionResult {
  status: DriverStoreStatus;
  message: string;
  failed: string[];
}

type StatusFilter = 'all' | 'updates' | 'duplicates' | 'installed' | 'unused';
type DriverAction =
  | 'export'
  | 'delete'
  | 'scan-devices'
  | 'check-updates'
  | 'install-updates'
  | 'open-updates';

const EMPTY_STATUS: DriverStoreStatus = {
  packages: [],
  totalSize: 0,
  thirdPartyCount: 0,
  duplicateCount: 0,
  installedCount: 0,
  updateChecked: false,
  updateCheckTime: '',
  updateCount: 0,
  updates: [],
  updateMessage: '尚未检测驱动更新',
  message: '点击刷新读取 Windows Driver Store 第三方驱动包。',
};

const STATUS_FILTERS: Array<[StatusFilter, string]> = [
  ['all', '全部'],
  ['updates', '可更新包'],
  ['duplicates', '旧版重复'],
  ['installed', '正在使用'],
  ['unused', '未使用'],
];

const CATEGORY_META = [
  { key: 'all', label: '全部驱动', icon: Database },
  { key: 'display', label: '显卡', icon: Monitor },
  { key: 'network', label: '网卡', icon: Wifi },
  { key: 'audio', label: '音频', icon: Volume2 },
  { key: 'bluetooth', label: '蓝牙', icon: Bluetooth },
  { key: 'chipset', label: '芯片组/系统', icon: Cpu },
  { key: 'storage', label: '存储', icon: HardDrive },
  { key: 'usb', label: 'USB', icon: Usb },
  { key: 'printer', label: '打印', icon: Printer },
  { key: 'extension', label: '扩展组件', icon: Wrench },
  { key: 'other', label: '其他', icon: ShieldAlert },
];

function packageMatches(item: DriverPackage, keyword: string) {
  if (!keyword) return true;
  return [
    item.publishedName,
    item.originalName,
    item.providerName,
    item.className,
    item.categoryLabel,
    item.classGuid,
    item.extensionId,
    item.driverVersion,
    item.driverDate,
    item.signerName,
    item.catalogFile,
    item.deviceNames.join(' '),
    item.driverFiles.join(' '),
  ]
    .join(' ')
    .toLowerCase()
    .includes(keyword);
}

function shortDevices(item: DriverPackage) {
  if (!item.deviceNames.length) return '';
  const names = item.deviceNames.slice(0, 2).join('、');
  return item.deviceNames.length > 2 ? `${names} 等 ${item.deviceNames.length} 个设备` : names;
}

function filePreview(item: DriverPackage) {
  if (!item.driverFiles.length) return item.catalogFile || '-';
  const names = item.driverFiles.slice(0, 2).join('、');
  return item.driverFiles.length > 2 ? `${names} 等 ${item.driverFiles.length} 个文件` : names;
}

function categoryCounts(packages: DriverPackage[]) {
  const counts: Record<string, number> = { all: packages.length };
  packages.forEach((item) => {
    const key = item.category || 'other';
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function matchedUpdatePackageCount(updates: DriverUpdateInfo[]) {
  const names = new Set<string>();
  updates.forEach((update) => {
    update.matchedPackages.forEach((name) => names.add(name));
  });
  return names.size;
}

function uniqueUpdateTitles(updates: DriverUpdateInfo[]) {
  return Array.from(
    new Set(updates.map((update) => update.title.trim()).filter((title) => title.length > 0))
  );
}

export default function DriverManagerTool() {
  const ready = useToolTheme();
  const [status, setStatus] = useState<DriverStoreStatus>(EMPTY_STATUS);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [forceDelete, setForceDelete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(EMPTY_STATUS.message);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await invoke<DriverStoreStatus>('system_drivers_list');
      setStatus(next);
      setMessage(next.message);
      setSelected((current) => {
        const names = new Set(next.packages.map((item) => item.publishedName));
        const kept: Record<string, boolean> = {};
        Object.entries(current).forEach(([name, checked]) => {
          if (checked && names.has(name)) kept[name] = true;
        });
        return kept;
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => categoryCounts(status.packages), [status.packages]);
  const updateHints = useMemo(() => {
    const map: Record<string, DriverUpdateInfo[]> = {};
    status.updates.forEach((update) => {
      update.matchedPackages.forEach((name) => {
        map[name] = [...(map[name] || []), update];
      });
    });
    return map;
  }, [status.updates]);
  const updatePackageCount = useMemo(
    () => matchedUpdatePackageCount(status.updates),
    [status.updates]
  );
  const categoryPackages = useMemo(
    () =>
      status.packages.filter(
        (item) => category === 'all' || (item.category || 'other') === category
      ),
    [category, status.packages]
  );
  const statusFilterCounts = useMemo<Record<StatusFilter, number>>(
    () => ({
      all: categoryPackages.length,
      updates: categoryPackages.filter((item) => updateHints[item.publishedName]?.length).length,
      duplicates: categoryPackages.filter((item) => item.olderDuplicate).length,
      installed: categoryPackages.filter((item) => item.installed).length,
      unused: categoryPackages.filter((item) => !item.installed).length,
    }),
    [categoryPackages, updateHints]
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return status.packages.filter((item) => {
      if (category !== 'all' && (item.category || 'other') !== category) return false;
      if (filter === 'updates' && !updateHints[item.publishedName]?.length) return false;
      if (filter === 'duplicates' && !item.olderDuplicate) return false;
      if (filter === 'installed' && !item.installed) return false;
      if (filter === 'unused' && item.installed) return false;
      return packageMatches(item, keyword);
    });
  }, [category, filter, search, status.packages, updateHints]);

  const selectedPackages = useMemo(
    () => status.packages.filter((item) => selected[item.publishedName]),
    [selected, status.packages]
  );

  const selectedSize = selectedPackages.reduce((sum, item) => sum + item.size, 0);
  const selectedInstalled = selectedPackages.filter((item) => item.installed);

  const toggleSelected = (name: string) => {
    setSelected((current) => ({ ...current, [name]: !current[name] }));
  };

  const selectVisible = () => {
    setSelected((current) => {
      const next = { ...current };
      filtered.forEach((item) => {
        next[item.publishedName] = true;
      });
      return next;
    });
  };

  const selectSuggested = () => {
    const next: Record<string, boolean> = {};
    status.packages.forEach((item) => {
      if (item.selectedByDefault) next[item.publishedName] = true;
    });
    setSelected(next);
    setMessage(`已选择 ${Object.keys(next).length} 个疑似旧版且当前未使用的驱动包`);
  };

  const runAction = async (
    action: DriverAction,
    packages: DriverPackage[] = [],
    outputDir?: string,
    updateTitles: string[] = []
  ) => {
    const names = packages.map((item) => item.publishedName);
    if ((action === 'export' || action === 'delete') && !names.length) return;
    if (action === 'install-updates' && !updateTitles.length) return;
    setLoading(true);
    setError('');
    try {
      const result = await invoke<DriverActionResult>('system_drivers_action', {
        request: {
          action,
          publishedNames: names,
          updateTitles,
          outputDir,
          force: forceDelete,
        },
      });
      setStatus((current) =>
        action === 'open-updates'
          ? {
              ...result.status,
              updateChecked: current.updateChecked,
              updateCheckTime: current.updateCheckTime,
              updateCount: current.updateCount,
              updates: current.updates,
              updateMessage: current.updateMessage,
            }
          : result.status
      );
      setMessage(result.message);
      if (
        action !== 'scan-devices' &&
        action !== 'check-updates' &&
        action !== 'install-updates' &&
        action !== 'open-updates'
      ) {
        setSelected({});
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const exportPackages = async (packages: DriverPackage[]) => {
    if (!packages.length) return;
    const dir = await openDialog({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    await runAction('export', packages, dir);
  };

  const deleteSelected = async () => {
    if (!selectedPackages.length) return;
    const installedText = selectedInstalled.length
      ? `\n其中 ${selectedInstalled.length} 个正在被已连接设备使用。`
      : '';
    const detail = selectedPackages
      .slice(0, 8)
      .map(
        (item) =>
          `${item.publishedName} (${item.categoryLabel || item.className || '未分类'} · ${item.providerName || '未知厂商'} ${item.driverVersion || ''})`
      )
      .join('\n');
    const more = selectedPackages.length > 8 ? `\n... 以及 ${selectedPackages.length - 8} 个` : '';
    const confirmText = `确定删除选中的 ${selectedPackages.length} 个驱动包吗？${installedText}\n\n${detail}${more}\n\n建议先导出备份；删除驱动需要管理员权限。`;
    if (!window.confirm(confirmText)) return;
    await runAction('delete', selectedPackages);
  };

  const installUpdates = async (updates: DriverUpdateInfo[]) => {
    const titles = uniqueUpdateTitles(updates);
    if (!titles.length) return;
    const detail = titles.slice(0, 6).join('\n');
    const more = titles.length > 6 ? `\n... 以及 ${titles.length - 6} 个` : '';
    const confirmText = `确定下载并安装 ${titles.length} 个驱动更新吗？\n\n${detail}${more}\n\n驱动更新可能导致设备短暂断连，部分更新需要重启后生效。`;
    if (!window.confirm(confirmText)) return;
    await runAction('install-updates', [], undefined, titles);
  };

  const openDriverFolder = async () => {
    await invoke('show_in_folder', {
      path: 'C:\\Windows\\System32\\DriverStore\\FileRepository',
    });
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🧩"
        title="驱动管理"
        subtitle="按设备类别管理 Driver Store，检测 Windows 可用驱动更新，支持备份、清理和硬件扫描"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton onClick={() => void runAction('check-updates')} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              检测更新
            </ToolbarButton>
            <ToolbarButton
              onClick={() => void installUpdates(status.updates)}
              disabled={loading || status.updates.length === 0}
            >
              <Download size={14} />
              下载并安装
            </ToolbarButton>
            <ToolbarButton onClick={() => void runAction('open-updates')} disabled={loading}>
              <ExternalLink size={14} />
              备用入口
            </ToolbarButton>
            <ToolbarButton onClick={() => void runAction('scan-devices')} disabled={loading}>
              <RefreshCw size={14} />
              扫描硬件
            </ToolbarButton>
            <ToolbarButton onClick={() => void openDriverFolder()}>
              <FolderOpen size={14} />
              仓库目录
            </ToolbarButton>
            <ToolbarButton onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </ToolbarButton>
          </div>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[286px_minmax(0,1fr)] gap-3 p-4 max-lg:grid-cols-1">
        <aside className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <StatusMessage message={message} error={error} />
          <section className="grid grid-cols-2 gap-2">
            <SummaryCard
              icon={<Database size={15} />}
              label="第三方"
              value={String(status.thirdPartyCount)}
            />
            <SummaryCard
              icon={<AlertTriangle size={15} />}
              label="可更新包"
              value={status.updateChecked ? String(updatePackageCount) : '未检测'}
              sub={status.updateChecked ? `更新项 ${status.updateCount}` : '更新项待检测'}
              warn={updatePackageCount > 0}
            />
            <SummaryCard
              icon={<HardDrive size={15} />}
              label="旧版重复"
              value={String(status.duplicateCount)}
              warn
            />
            <SummaryCard
              icon={<ShieldAlert size={15} />}
              label="使用中"
              value={String(status.installedCount)}
            />
          </section>

          <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-semibold">驱动分类</div>
            <div className="mt-3 space-y-1.5">
              {CATEGORY_META.map((item) => {
                const Icon = item.icon;
                const active = category === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setCategory(item.key)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                        : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon size={15} />
                      <span className="truncate">{item.label}</span>
                    </span>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {counts[item.key] || 0}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-semibold">状态筛选</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {STATUS_FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`flex items-center justify-between rounded-lg border px-2 py-2 text-xs ${
                    filter === key
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                      : 'border-gray-200 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800'
                  }`}
                >
                  <span>{label}</span>
                  <span className="font-mono">
                    {key === 'updates' && !status.updateChecked ? '-' : statusFilterCounts[key]}
                  </span>
                </button>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={forceDelete}
                onChange={(event) => setForceDelete(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              允许强制删除使用中驱动
            </label>
          </section>
        </aside>

        <section className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <UpdatePanel
            status={status}
            matchedPackageCount={updatePackageCount}
            loading={loading}
            onCheck={() => void runAction('check-updates')}
            onInstall={() => void installUpdates(status.updates)}
            onOpen={() => void runAction('open-updates')}
          />

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
              <Search size={16} className="text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索 oem 名称、厂商、类别、版本、设备..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <ToolbarButton onClick={selectVisible} disabled={loading || filtered.length === 0}>
              <CheckSquare size={14} />
              选择当前
            </ToolbarButton>
            <ToolbarButton
              onClick={selectSuggested}
              disabled={loading || status.duplicateCount === 0}
            >
              <CheckSquare size={14} />
              建议项
            </ToolbarButton>
            <ToolbarButton
              onClick={() => setSelected({})}
              disabled={loading || selectedPackages.length === 0}
            >
              <Square size={14} />
              清空
            </ToolbarButton>
            <ToolbarButton
              onClick={() => void exportPackages(selectedPackages)}
              disabled={loading || selectedPackages.length === 0}
            >
              <Download size={14} />
              导出 {selectedPackages.length ? `(${selectedPackages.length})` : ''}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => void deleteSelected()}
              disabled={loading || selectedPackages.length === 0}
              danger
            >
              <Trash2 size={14} />
              删除 {selectedPackages.length ? `(${selectedPackages.length})` : ''}
            </ToolbarButton>
          </div>

          {selectedPackages.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
              已选择 {selectedPackages.length} 个驱动包，估算 {formatBytes(selectedSize)}
              {selectedInstalled.length ? `；${selectedInstalled.length} 个正在使用` : ''}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {filtered.map((item) => (
              <DriverCard
                key={item.publishedName}
                item={item}
                checked={!!selected[item.publishedName]}
                onToggle={() => toggleSelected(item.publishedName)}
                onOnly={() => {
                  setSelected({ [item.publishedName]: true });
                  setMessage(`已只选择 ${item.publishedName}`);
                }}
                onExport={() => void exportPackages([item])}
                onUpdate={() =>
                  updateHints[item.publishedName]?.length
                    ? void installUpdates(updateHints[item.publishedName])
                    : void runAction('check-updates')
                }
                updates={updateHints[item.publishedName] || []}
                updateChecked={status.updateChecked}
              />
            ))}
            {filtered.length === 0 && (
              <EmptyState
                icon={<Database size={32} />}
                text={
                  status.packages.length === 0 ? '正在读取或未发现第三方驱动包' : '没有匹配的驱动包'
                }
              />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  sub,
  warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        {icon}
        {label}
      </div>
      <div
        className={`mt-1 truncate text-lg font-semibold ${warn ? 'text-amber-600 dark:text-amber-300' : ''}`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 truncate text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

function UpdatePanel({
  status,
  matchedPackageCount,
  loading,
  onCheck,
  onInstall,
  onOpen,
}: {
  status: DriverStoreStatus;
  matchedPackageCount: number;
  loading: boolean;
  onCheck: () => void;
  onInstall: () => void;
  onOpen: () => void;
}) {
  const checkedAt = status.updateCheckTime ? status.updateCheckTime.replace('T', ' ') : '';
  const hasUpdates = status.updateChecked && status.updates.length > 0;
  const unmatchedUpdateCount = status.updates.filter(
    (update) => update.matchedPackages.length === 0
  ).length;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <RefreshCw size={15} className={loading ? 'animate-spin text-blue-600' : ''} />
            驱动更新检测
            {hasUpdates ? (
              <>
                <Badge tone="warn">{status.updateCount} 个更新项</Badge>
                <Badge tone={matchedPackageCount > 0 ? 'warn' : undefined}>
                  {matchedPackageCount} 个匹配包
                </Badge>
              </>
            ) : status.updateChecked ? (
              <Badge tone="ok">已检测</Badge>
            ) : (
              <Badge>未检测</Badge>
            )}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {status.updateMessage}
            {status.updateChecked ? ` · 匹配 ${matchedPackageCount} 个本地驱动包` : ''}
            {unmatchedUpdateCount > 0 ? `，${unmatchedUpdateCount} 个更新项未匹配到本地包` : ''}
            {checkedAt ? ` · ${checkedAt}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ToolbarButton onClick={onCheck} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {status.updateChecked ? '重新检测' : '检测更新'}
          </ToolbarButton>
          <ToolbarButton onClick={onInstall} disabled={loading || status.updates.length === 0}>
            <Download size={14} />
            下载并安装
          </ToolbarButton>
          <ToolbarButton onClick={onOpen} disabled={loading}>
            <ExternalLink size={14} />
            备用入口
          </ToolbarButton>
        </div>
      </div>

      {hasUpdates ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {status.updates.slice(0, 4).map((update, index) => (
            <div
              key={`${update.title}-${index}`}
              className="min-w-0 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100"
            >
              <div className="truncate font-semibold" title={update.title}>
                {update.title || '未命名驱动更新'}
              </div>
              <div className="mt-1 truncate">
                {[update.driverManufacturer, update.driverModel, update.driverVersion]
                  .filter(Boolean)
                  .join(' · ') ||
                  update.categories.join(' · ') ||
                  'Windows 驱动更新'}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded bg-white/70 px-1.5 py-0.5 dark:bg-gray-950/40">
                  {update.matchedPackages.length
                    ? `匹配 ${update.matchedPackages.length} 个本地包`
                    : '未匹配本地包'}
                </span>
                {update.matchedCategories.map((item) => (
                  <span
                    key={item}
                    className="rounded bg-white/70 px-1.5 py-0.5 dark:bg-gray-950/40"
                  >
                    {CATEGORY_META.find((meta) => meta.key === item)?.label || item}
                  </span>
                ))}
                {update.rebootRequired && (
                  <span className="rounded bg-white/70 px-1.5 py-0.5 dark:bg-gray-950/40">
                    需要重启
                  </span>
                )}
              </div>
            </div>
          ))}
          {status.updates.length > 4 && (
            <div className="rounded-lg border border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-800">
              还有 {status.updates.length - 4} 个更新，可点击“下载并安装”统一处理。
            </div>
          )}
        </div>
      ) : (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            status.updateChecked
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200'
              : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-800 dark:bg-gray-950'
          }`}
        >
          {status.updateChecked
            ? '本次 Windows Update Agent 查询未返回可用驱动更新。'
            : '尚未执行驱动更新检测。'}
        </div>
      )}
    </section>
  );
}

function DriverCard({
  item,
  checked,
  onToggle,
  onOnly,
  onExport,
  onUpdate,
  updates,
  updateChecked,
}: {
  item: DriverPackage;
  checked: boolean;
  onToggle: () => void;
  onOnly: () => void;
  onExport: () => void;
  onUpdate: () => void;
  updates: DriverUpdateInfo[];
  updateChecked: boolean;
}) {
  const hasUpdates = updates.length > 0;

  return (
    <article className="border-b border-gray-100 p-4 dark:border-gray-800">
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
          title={checked ? '取消选择' : '选择'}
        >
          {checked ? (
            <CheckSquare size={18} className="text-blue-600" />
          ) : (
            <Square size={18} className="text-gray-400" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-300">
              {item.publishedName}
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {item.categoryLabel || item.className || '未分类'}
            </span>
            {item.olderDuplicate && <Badge tone="warn">旧版重复</Badge>}
            {hasUpdates && <Badge tone="warn">可更新</Badge>}
            {item.installed ? <Badge tone="ok">正在使用</Badge> : <Badge>未使用</Badge>}
          </div>
          <div
            className="mt-1 truncate text-base font-semibold"
            title={`${item.providerName} ${item.originalName}`}
          >
            {item.providerName || '未知厂商'} ·{' '}
            {item.originalName || item.catalogFile || '未知驱动'}
          </div>
          <div className="mt-2 grid gap-2 text-xs text-gray-500 md:grid-cols-4">
            <Info label="版本" value={item.driverVersion || '-'} />
            <Info label="日期" value={item.driverDate || '-'} />
            <Info label="大小" value={item.size ? formatBytes(item.size) : '-'} />
            <Info label="签名" value={item.signerName || '-'} />
          </div>
          <div className="mt-2 grid gap-2 text-xs text-gray-500 md:grid-cols-2">
            <Info label="设备" value={item.installed ? shortDevices(item) : '未匹配到已连接设备'} />
            <Info label="文件" value={filePreview(item)} />
          </div>
          {hasUpdates && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100">
              <div className="font-semibold">检测到可用更新</div>
              <div className="mt-1 truncate" title={updates[0].title}>
                {updates[0].title || 'Windows 驱动更新'}
              </div>
              {updates.length > 1 && (
                <div className="mt-1">另有 {updates.length - 1} 个匹配更新</div>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <ToolbarButton onClick={onOnly}>
            <CheckSquare size={14} />
            只选
          </ToolbarButton>
          <ToolbarButton onClick={onExport}>
            <Download size={14} />
            导出
          </ToolbarButton>
          <ToolbarButton onClick={onUpdate}>
            {hasUpdates ? <Download size={14} /> : <RefreshCw size={14} />}
            {hasUpdates ? '安装更新' : updateChecked ? '再检测' : '检测'}
          </ToolbarButton>
        </div>
      </div>
    </article>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' }) {
  const cls =
    tone === 'ok'
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
      : tone === 'warn'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
  return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{children}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-gray-50 px-2 py-1.5 dark:bg-gray-950">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="truncate" title={value}>
        {value}
      </div>
    </div>
  );
}
