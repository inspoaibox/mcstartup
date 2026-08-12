import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertTriangle,
  BadgeCheck,
  CheckSquare,
  ChevronDown,
  Download,
  ExternalLink,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { EmptyState, formatBytes, StatusMessage, ToolbarButton } from './systemToolUtils';

interface InstalledAppEntry {
  id: string;
  name: string;
  publisher: string;
  version: string;
  installDate: string;
  installLocation: string;
  estimatedSize: number;
  uninstallString: string;
  quietUninstallString: string;
  registryPath: string;
  scope: string;
  appKind: string;
}

interface InstalledAppLeftoverItem {
  id: string;
  kind: string;
  kindLabel: string;
  path: string;
  displayPath: string;
  size: number;
  count: number;
  confidence: string;
  reason: string;
  selectedByDefault: boolean;
}

interface InstalledAppLeftoverDeleteResult {
  deletedSize: number;
  deletedCount: number;
  failed: string[];
  backupPath?: string | null;
}

interface LeftoverPrompt {
  appName: string;
  totalCount: number;
  defaultCount: number;
  defaultSize: number;
  totalSize: number;
  manualReviewCount: number;
}

type AppSortMode = 'name' | 'size-desc' | 'size-asc' | 'date-desc' | 'date-asc';
type AppTypeFilter = 'all' | 'desktop' | 'current-user' | 'all-users' | 'store';
type AppInsightFilter =
  | 'all'
  | 'quiet'
  | 'interactive'
  | 'large'
  | 'recent'
  | 'caution'
  | 'system-risk'
  | 'orphan-risk';
type AppConfidence = 'high' | 'medium' | 'low' | 'protected';

interface AppProfile {
  uninstallKindLabel: string;
  quietAvailable: boolean;
  orphanRisk: boolean;
  orphanReasons: string[];
  sharedComponent: boolean;
  systemProtected: boolean;
  protectedReasons: string[];
  categoryLabel: string;
  recent: boolean;
  large: boolean;
  microsoft: boolean;
  confidence: AppConfidence;
  confidenceLabel: string;
  flags: string[];
  commandPreview: string;
}

const LARGE_APP_BYTES = 500 * 1024 * 1024;
const RECENT_APP_DAYS = 45;

const APP_INSIGHT_FILTERS: Array<{ value: AppInsightFilter; label: string }> = [
  { value: 'all', label: '全部分析' },
  { value: 'quiet', label: '可静默' },
  { value: 'interactive', label: '需交互' },
  { value: 'large', label: '大体积' },
  { value: 'recent', label: '最近安装' },
  { value: 'caution', label: '谨慎处理' },
  { value: 'system-risk', label: '系统相关' },
  { value: 'orphan-risk', label: '登记异常' },
];

function downloadText(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatInstallDate(value: string) {
  const date = parseInstallDate(value);
  if (date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (!value) return '-';
  return value;
}

function parseInstallDate(value: string): Date | null {
  const text = (value || '').trim();
  if (!text) return null;
  if (/^\d{8}$/.test(text)) {
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(4, 6));
    const day = Number(text.slice(6, 8));
    return validDate(year, month, day);
  }
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    return validDate(Number(slash[3]), Number(slash[1]), Number(slash[2]));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validDate(year: number, month: number, day: number): Date | null {
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function installDateTime(value: string) {
  return parseInstallDate(value)?.getTime() || 0;
}

function compact(value: string) {
  return (value || '').trim();
}

function appIconSeed(name: string) {
  const colors = [
    'bg-blue-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-purple-500',
    'bg-rose-500',
    'bg-cyan-500',
    'bg-slate-500',
  ];
  const code = Array.from(name || '?').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return colors[code % colors.length];
}

function appTypeLabel(item: InstalledAppEntry) {
  if (item.appKind === 'store') return 'Store 应用';
  if (item.scope.includes('当前用户')) return '当前用户程序';
  if (item.scope.includes('32 位')) return '桌面程序 32 位';
  if (item.scope.includes('64 位')) return '桌面程序 64 位';
  return '桌面程序';
}

function appTypeBadgeClass(item: InstalledAppEntry) {
  if (item.appKind === 'store')
    return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-200';
  if (item.scope.includes('当前用户'))
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
}

function detectUninstallKind(item: InstalledAppEntry) {
  const command = `${item.uninstallString || ''} ${item.quietUninstallString || ''}`.toLowerCase();
  const registryPath = (item.registryPath || '').toLowerCase();
  if (item.appKind === 'store' || command.includes('remove-appxpackage')) return 'Store/Appx';
  if (command.includes('msiexec') || command.includes('.msi') || registryPath.includes('{'))
    return 'MSI';
  if (command.includes('unins') || registryPath.includes('inno')) return 'Inno Setup';
  if (command.includes('nsis')) return 'NSIS';
  if (command.includes('installshield') || command.includes('setup.exe')) return 'InstallShield';
  if (command.includes('powershell')) return 'PowerShell';
  if (command.includes('uninstall') || command.includes('uninst')) return 'EXE 卸载器';
  return command ? '自定义命令' : '未知';
}

function isSharedComponent(item: InstalledAppEntry) {
  const text = `${item.name} ${item.publisher}`.toLowerCase();
  return /runtime|redistributable|framework|driver|visual c\+\+|\.net|sdk|update|驱动|运行库|组件/.test(
    text
  );
}

function pushUnique(list: string[], value: string) {
  if (value && !list.includes(value)) list.push(value);
}

function classifySystemProtection(
  item: InstalledAppEntry,
  sharedComponent: boolean,
  microsoft: boolean
) {
  const text =
    `${item.name} ${item.publisher} ${item.version} ${item.installLocation} ${item.registryPath}`.toLowerCase();
  const reasons: string[] = [];
  let categoryLabel = '普通软件';

  if (
    /driver|display|graphics|audio|bluetooth|wireless|wi-?fi|chipset|realtek|nvidia|intel\(r\)|amd|synaptics|dolby|驱动|显卡|网卡|声卡|蓝牙|芯片组|控制器/.test(
      text
    )
  ) {
    categoryLabel = '驱动/硬件组件';
    pushUnique(reasons, '可能影响显卡、网卡、声卡、蓝牙或芯片组等硬件功能');
  }

  if (
    /visual c\+\+|vcredist|redistributable|\.net|asp\.net core|windows desktop runtime|webview2|windows app runtime|microsoft ui xaml|vclibs|framework|runtime|运行库|组件/.test(
      text
    )
  ) {
    categoryLabel = categoryLabel === '普通软件' ? '共享运行库/组件' : categoryLabel;
    pushUnique(reasons, '其他软件可能依赖该运行库或共享组件，删除后可能无法启动');
  }

  if (
    /windows security|microsoft defender|defender|security health|windows update|windows installer|servicing stack|app installer|desktop app installer|microsoft store|store purchase|edge webview|webview2|windows terminal|windows subsystem|wsl|windows 功能|系统组件/.test(
      text
    )
  ) {
    categoryLabel = 'Windows 系统组件';
    pushUnique(reasons, '属于 Windows 或 Microsoft 基础组件，删除后可能影响系统功能');
  }

  if (item.appKind === 'store' && microsoft) {
    categoryLabel = categoryLabel === '普通软件' ? 'Store/系统应用' : categoryLabel;
    pushUnique(reasons, 'Microsoft Store 应用可能与系统功能、账户或应用商店能力相关');
  }

  if (sharedComponent && reasons.length === 0) {
    categoryLabel = '共享组件';
    pushUnique(reasons, '名称或发布者显示为共享组件，建议不要批量卸载');
  }

  return {
    systemProtected: reasons.length > 0,
    categoryLabel,
    protectedReasons: reasons,
  };
}

function getAppProfile(item: InstalledAppEntry): AppProfile {
  const uninstallString = compact(item.uninstallString);
  const quietUninstallString = compact(item.quietUninstallString);
  const installLocation = compact(item.installLocation);
  const installTime = installDateTime(item.installDate);
  const recentThreshold = Date.now() - RECENT_APP_DAYS * 24 * 60 * 60 * 1000;
  const recent = installTime > 0 && installTime >= recentThreshold;
  const large = (item.estimatedSize || 0) >= LARGE_APP_BYTES;
  const microsoft = /microsoft|windows/i.test(`${item.name} ${item.publisher}`);
  const sharedComponent = isSharedComponent(item);
  const systemProtection = classifySystemProtection(item, sharedComponent, microsoft);
  const orphanReasons: string[] = [];
  if (item.appKind === 'desktop' && uninstallString) {
    if (!compact(item.publisher)) orphanReasons.push('缺少发布者');
    if (!compact(item.version)) orphanReasons.push('缺少版本');
    if (!installLocation) orphanReasons.push('缺少安装位置');
    if ((item.estimatedSize || 0) <= 0) orphanReasons.push('缺少体积信息');
  }
  const orphanRisk =
    item.appKind === 'desktop' &&
    Boolean(uninstallString) &&
    !systemProtection.systemProtected &&
    orphanReasons.length >= 3;
  const quietAvailable = Boolean(quietUninstallString);
  const uninstallKindLabel = detectUninstallKind(item);
  const flags: string[] = [uninstallKindLabel];

  if (systemProtection.systemProtected) {
    flags.unshift('不建议卸载');
    flags.push(systemProtection.categoryLabel);
  }
  flags.push(quietAvailable ? '可静默卸载' : '需要交互');
  if (large) flags.push('大体积');
  if (recent) flags.push(`近 ${RECENT_APP_DAYS} 天安装`);
  if (orphanRisk) flags.push('登记异常');
  if (sharedComponent) flags.push('共享组件');
  if (microsoft) flags.push('Microsoft/系统相关');
  if (!uninstallString) flags.push('缺少卸载命令');

  let confidence: AppConfidence = 'high';
  if (systemProtection.systemProtected) {
    confidence = 'protected';
  } else if (!uninstallString || orphanRisk) {
    confidence = 'low';
  } else if (!quietAvailable || item.appKind === 'store' || microsoft) {
    confidence = 'medium';
  }

  return {
    uninstallKindLabel,
    quietAvailable,
    orphanRisk,
    orphanReasons,
    sharedComponent,
    systemProtected: systemProtection.systemProtected,
    protectedReasons: systemProtection.protectedReasons,
    categoryLabel: systemProtection.categoryLabel,
    recent,
    large,
    microsoft,
    confidence,
    confidenceLabel:
      confidence === 'high'
        ? '适合批量'
        : confidence === 'medium'
          ? '需确认'
          : confidence === 'protected'
            ? '不建议卸载'
            : '谨慎处理',
    flags: Array.from(new Set(flags)),
    commandPreview: quietAvailable ? quietUninstallString : uninstallString,
  };
}

function profileMatchesFilter(item: InstalledAppEntry, filter: AppInsightFilter) {
  if (filter === 'all') return true;
  const profile = getAppProfile(item);
  if (filter === 'quiet') return profile.quietAvailable;
  if (filter === 'interactive') return !profile.quietAvailable;
  if (filter === 'large') return profile.large;
  if (filter === 'recent') return profile.recent;
  if (filter === 'caution') return profile.confidence !== 'high';
  if (filter === 'system-risk') return profile.systemProtected;
  if (filter === 'orphan-risk') return profile.orphanRisk;
  return true;
}

function matchesTypeFilter(item: InstalledAppEntry, filter: AppTypeFilter) {
  if (filter === 'desktop') return item.appKind === 'desktop';
  if (filter === 'store') return item.appKind === 'store';
  if (filter === 'current-user') return item.scope.includes('当前用户');
  if (filter === 'all-users') return item.scope.includes('所有用户');
  return true;
}

function confidenceBadgeClass(confidence: AppConfidence) {
  if (confidence === 'protected')
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200';
  if (confidence === 'high')
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200';
  if (confidence === 'medium')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200';
}

function insightBadgeClass(flag: string) {
  if (flag.includes('不建议') || flag.includes('Windows') || flag.includes('驱动/硬件')) {
    return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-200';
  }
  if (flag.includes('可静默'))
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200';
  if (flag.includes('大体积'))
    return 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-200';
  if (flag.includes('登记异常') || flag.includes('共享') || flag.includes('系统')) {
    return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200';
  }
  if (flag.includes('Store'))
    return 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-200';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
}

export default function InstalledAppsTool() {
  const ready = useToolTheme();
  const [items, setItems] = useState<InstalledAppEntry[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<AppTypeFilter>('all');
  const [selected, setSelected] = useState<InstalledAppEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanningLeftovers, setScanningLeftovers] = useState(false);
  const [cleaningLeftovers, setCleaningLeftovers] = useState(false);
  const [leftovers, setLeftovers] = useState<InstalledAppLeftoverItem[]>([]);
  const [selectedLeftoverIds, setSelectedLeftoverIds] = useState<string[]>([]);
  const [leftoverPrompt, setLeftoverPrompt] = useState<LeftoverPrompt | null>(null);
  const [confirmedUninstalledIds, setConfirmedUninstalledIds] = useState<string[]>([]);
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<AppSortMode>('name');
  const [insightFilter, setInsightFilter] = useState<AppInsightFilter>('all');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await invoke<InstalledAppEntry[]>('system_installed_apps_list');
      setItems(rows);
      setSelected((current) => current ?? rows[0] ?? null);
      setSelectedAppIds([]);
      setConfirmedUninstalledIds((current) =>
        current.filter((id) => rows.every((item) => item.id !== id))
      );
      setMessage(`已读取 ${rows.length} 个已安装软件`);
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
    const scoped = items
      .filter((item) => matchesTypeFilter(item, typeFilter))
      .filter((item) => profileMatchesFilter(item, insightFilter));
    const base = keyword
      ? scoped.filter((item) =>
          [
            item.name,
            item.publisher,
            item.version,
            item.installLocation,
            item.scope,
            appTypeLabel(item),
            getAppProfile(item).flags.join(' '),
          ]
            .join(' ')
            .toLowerCase()
            .includes(keyword)
        )
      : scoped;
    return [...base].sort((a, b) => {
      switch (sortMode) {
        case 'size-desc':
          return (b.estimatedSize || 0) - (a.estimatedSize || 0);
        case 'size-asc':
          return (a.estimatedSize || 0) - (b.estimatedSize || 0);
        case 'date-desc':
          return (
            installDateTime(b.installDate) - installDateTime(a.installDate) ||
            a.name.localeCompare(b.name)
          );
        case 'date-asc':
          return (
            installDateTime(a.installDate) - installDateTime(b.installDate) ||
            a.name.localeCompare(b.name)
          );
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [insightFilter, items, search, sortMode, typeFilter]);

  const typeCounts = useMemo(() => {
    const counts: Record<AppTypeFilter, number> = {
      all: items.length,
      desktop: items.filter((item) => item.appKind === 'desktop').length,
      'current-user': items.filter((item) => item.scope.includes('当前用户')).length,
      'all-users': items.filter((item) => item.scope.includes('所有用户')).length,
      store: items.filter((item) => item.appKind === 'store').length,
    };
    return counts;
  }, [items]);

  const selectedLeftovers = useMemo(
    () => leftovers.filter((item) => selectedLeftoverIds.includes(item.id)),
    [leftovers, selectedLeftoverIds]
  );
  const selectedLeftoverSize = useMemo(
    () => selectedLeftovers.reduce((sum, item) => sum + item.size, 0),
    [selectedLeftovers]
  );
  const totalSize = useMemo(
    () => filtered.reduce((sum, item) => sum + (item.estimatedSize || 0), 0),
    [filtered]
  );
  const selectedAppsSize = useMemo(
    () =>
      items
        .filter((item) => selectedAppIds.includes(item.id))
        .reduce((sum, item) => sum + (item.estimatedSize || 0), 0),
    [items, selectedAppIds]
  );
  const selectedApps = useMemo(
    () => items.filter((item) => selectedAppIds.includes(item.id)),
    [items, selectedAppIds]
  );
  const selectedProfile = useMemo(() => (selected ? getAppProfile(selected) : null), [selected]);
  const selectedConfirmedUninstalled = Boolean(
    selected && confirmedUninstalledIds.includes(selected.id)
  );
  const insightCounts = useMemo(() => {
    const scopedItems = items.filter((item) => matchesTypeFilter(item, typeFilter));
    const counts: Record<AppInsightFilter, number> = {
      all: scopedItems.length,
      quiet: 0,
      interactive: 0,
      large: 0,
      recent: 0,
      caution: 0,
      'system-risk': 0,
      'orphan-risk': 0,
    };
    for (const item of scopedItems) {
      const profile = getAppProfile(item);
      if (profile.quietAvailable) counts.quiet += 1;
      if (!profile.quietAvailable) counts.interactive += 1;
      if (profile.large) counts.large += 1;
      if (profile.recent) counts.recent += 1;
      if (profile.confidence !== 'high') counts.caution += 1;
      if (profile.systemProtected) counts['system-risk'] += 1;
      if (profile.orphanRisk) counts['orphan-risk'] += 1;
    }
    return counts;
  }, [items, typeFilter]);
  const selectedQuietCount = useMemo(
    () =>
      selectedApps.filter((item) => {
        const profile = getAppProfile(item);
        return profile.quietAvailable && !profile.systemProtected;
      }).length,
    [selectedApps]
  );
  const selectedCautionCount = useMemo(
    () => selectedApps.filter((item) => getAppProfile(item).confidence !== 'high').length,
    [selectedApps]
  );

  const uninstall = async (quiet: boolean) => {
    if (!selected) return;
    const profile = getAppProfile(selected);
    const protectedText = profile.systemProtected
      ? `\n\n该项目被标记为“不建议卸载”：\n${profile.protectedReasons.map((reason) => `- ${reason}`).join('\n')}\n\n继续可能影响系统或其他软件。`
      : '';
    if (
      !window.confirm(
        `确定启动“${selected.name}”的卸载程序吗？实际卸载由软件自己的卸载器完成。${protectedText}`
      )
    )
      return;
    setError('');
    setMessage('');
    try {
      await invoke('system_installed_app_uninstall', {
        request: {
          name: selected.name,
          uninstallString: selected.uninstallString,
          quietUninstallString: selected.quietUninstallString,
          quiet,
        },
      });
      setMessage('已启动卸载程序。卸载完成后可点击“扫描残留”检查遗留文件和登记项。');
    } catch (err) {
      setError(String(err));
    }
  };

  const scanLeftovers = async () => {
    if (!selected) return;
    if (!selectedConfirmedUninstalled) {
      setError(
        '请先确认该软件已经完成卸载，再扫描残留。未卸载的软件目录和登记项不能当作残留处理。'
      );
      return;
    }
    setScanningLeftovers(true);
    setError('');
    setMessage('');
    try {
      const rows = await invoke<InstalledAppLeftoverItem[]>('system_installed_app_leftovers_scan', {
        request: {
          name: selected.name,
          appKind: selected.appKind,
          publisher: selected.publisher,
          installLocation: selected.installLocation,
          registryPath: selected.registryPath,
          uninstalled: true,
        },
      });
      setLeftoverPrompt(null);
      setLeftovers(rows);
      const defaultSelectedRows = rows.filter((item) => item.selectedByDefault);
      setSelectedLeftoverIds(defaultSelectedRows.map((item) => item.id));
      setLeftoverPrompt(
        rows.length > 0
          ? {
              appName: selected.name,
              totalCount: rows.length,
              defaultCount: defaultSelectedRows.length,
              defaultSize: defaultSelectedRows.reduce((sum, item) => sum + item.size, 0),
              totalSize: rows.reduce((sum, item) => sum + item.size, 0),
              manualReviewCount: rows.filter((item) => item.confidence !== 'high').length,
            }
          : null
      );
      setMessage(`扫描完成，发现 ${rows.length} 个可能残留项`);
    } catch (err) {
      setError(String(err));
    } finally {
      setScanningLeftovers(false);
    }
  };

  const cleanLeftovers = async () => {
    if (!selected) {
      setError('请选择软件后再清理残留');
      setLeftoverPrompt(null);
      return;
    }
    if (selectedLeftovers.length === 0) {
      setError('请选择要清理的残留项');
      setLeftoverPrompt(null);
      return;
    }
    const manualReviewCount = selectedLeftovers.filter((item) => item.confidence !== 'high').length;
    const manualReviewText =
      manualReviewCount > 0
        ? `\n\n其中 ${manualReviewCount} 个是中/低置信度疑似项，将按你的手动勾选清理。请确认路径确实属于该软件。`
        : '';
    if (
      !window.confirm(
        `确定清理 ${selectedLeftovers.length} 个残留项吗？预计释放 ${formatBytes(selectedLeftoverSize)}。${manualReviewText}`
      )
    )
      return;
    setCleaningLeftovers(true);
    setError('');
    setMessage('');
    try {
      const result = await invoke<InstalledAppLeftoverDeleteResult>(
        'system_installed_app_leftovers_delete',
        {
          request: {
            app: {
              name: selected.name,
              appKind: selected.appKind,
              publisher: selected.publisher,
              installLocation: selected.installLocation,
              registryPath: selected.registryPath,
              uninstalled: selectedConfirmedUninstalled,
            },
            items: selectedLeftovers,
          },
        }
      );
      const failedText = result.failed.length ? `，${result.failed.length} 项失败` : '';
      const backupText = result.backupPath ? `，注册表备份：${result.backupPath}` : '';
      setMessage(
        `已清理 ${result.deletedCount} 项 / ${formatBytes(result.deletedSize)}${failedText}${backupText}`
      );
      setLeftoverPrompt(null);
      await scanLeftovers();
    } catch (err) {
      setError(String(err));
    } finally {
      setCleaningLeftovers(false);
    }
  };

  const toggleLeftover = (id: string) => {
    setLeftoverPrompt(null);
    setSelectedLeftoverIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const toggleApp = (id: string) => {
    const item = items.find((row) => row.id === id);
    const profile = item ? getAppProfile(item) : null;
    if (item && profile?.systemProtected && !selectedAppIds.includes(id)) {
      setError(
        `“${item.name}”属于${profile.categoryLabel}，不建议加入批量卸载，请在右侧详情单独确认。`
      );
      return;
    }
    setSelectedAppIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const batchUninstall = async (quiet = false) => {
    const protectedTargets = selectedApps.filter((item) => getAppProfile(item).systemProtected);
    const candidates = selectedApps.filter((item) => !getAppProfile(item).systemProtected);
    const targets = candidates.filter((item) => !quiet || getAppProfile(item).quietAvailable);
    if (targets.length === 0) {
      setError(
        protectedTargets.length > 0
          ? '已选项目均为系统相关或不建议卸载项目，不能批量卸载'
          : quiet
            ? '已选软件里没有可静默卸载的项目'
            : '请选择要批量卸载的软件'
      );
      return;
    }
    const skipped = selectedApps.length - targets.length;
    const cautionCount = targets.filter((item) => getAppProfile(item).confidence !== 'high').length;
    const modeLabel = quiet ? '静默卸载命令' : '卸载程序';
    const extra = [
      skipped > 0 ? `${skipped} 个未提供静默命令的项目会跳过` : '',
      protectedTargets.length > 0 ? `${protectedTargets.length} 个系统相关项目会被保护跳过` : '',
      cautionCount > 0 ? `${cautionCount} 个项目标记为需确认或谨慎处理` : '',
    ]
      .filter(Boolean)
      .join('，');
    if (
      !window.confirm(
        `确定依次启动 ${targets.length} 个软件的${modeLabel}吗？${extra ? `\n${extra}。` : ''}`
      )
    )
      return;
    setError('');
    setMessage('');
    try {
      for (const item of targets) {
        await invoke('system_installed_app_uninstall', {
          request: {
            name: item.name,
            uninstallString: item.uninstallString,
            quietUninstallString: item.quietUninstallString,
            quiet,
          },
        });
      }
      setMessage(
        `已依次启动 ${targets.length} 个${modeLabel}${skipped > 0 ? `，跳过 ${skipped} 个无静默命令项目` : ''}`
      );
    } catch (err) {
      setError(`批量卸载中断：${String(err)}`);
    }
  };

  const exportLeftovers = () => {
    if (!selected || leftovers.length === 0) return;
    const filename = `uninstall-leftovers-${selected.name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
    downloadText(
      filename,
      JSON.stringify({ app: selected, leftovers }, null, 2),
      'application/json;charset=utf-8'
    );
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {leftoverPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-lg rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <ShieldAlert size={18} className="text-amber-500" />
                    发现可能残留项
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{leftoverPrompt.appName}</div>
                </div>
                <button
                  onClick={() => setLeftoverPrompt(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  title="关闭"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-gray-700 dark:text-gray-200">
              <div>
                扫描发现 <span className="font-semibold">{leftoverPrompt.totalCount}</span>{' '}
                个可能残留项， 总大小约{' '}
                <span className="font-semibold">{formatBytes(leftoverPrompt.totalSize)}</span>。
              </div>
              <div className="rounded-md bg-gray-50 p-3 text-xs leading-5 dark:bg-gray-950">
                默认只勾选后端可严格校验的高置信度项目：
                <span className="font-semibold"> {leftoverPrompt.defaultCount}</span> 项 /{' '}
                <span className="font-semibold">{formatBytes(leftoverPrompt.defaultSize)}</span>。
                {leftoverPrompt.manualReviewCount > 0 && (
                  <>
                    {' '}
                    另有 {leftoverPrompt.manualReviewCount}{' '}
                    个中/低置信度项目已默认保留，需要你手动确认。
                  </>
                )}
              </div>
              <div className="text-xs text-amber-700 dark:text-amber-200">
                删除前会再次检测安装目录内的运行中进程；如果仍有相关进程，后端会拒绝清理。
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <button
                onClick={() => {
                  setSelectedLeftoverIds([]);
                  setLeftoverPrompt(null);
                }}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                保留并关闭
              </button>
              <button
                onClick={() => setLeftoverPrompt(null)}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-blue-200 px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/20"
              >
                查看详情
              </button>
              <button
                onClick={() => {
                  if (leftoverPrompt.defaultCount > 0) {
                    void cleanLeftovers();
                  } else {
                    setLeftoverPrompt(null);
                  }
                }}
                disabled={cleaningLeftovers}
                className={`inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold disabled:opacity-50 ${
                  leftoverPrompt.defaultCount > 0
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'border border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-900/20'
                }`}
              >
                {leftoverPrompt.defaultCount > 0 ? '删除默认勾选项' : '查看并手动勾选'}
              </button>
            </div>
          </div>
        </div>
      )}
      <ToolHeader
        icon="📦"
        title="软件卸载管理"
        subtitle="读取已安装软件，调用原卸载器，并支持扫描清理卸载残留"
        actions={
          <ToolbarButton onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </ToolbarButton>
        }
      />
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_420px] gap-4 overflow-hidden p-4 pb-6 max-lg:grid-cols-1">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <StatusMessage message={message} error={error} />
          <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-white disabled:opacity-50 dark:hover:bg-gray-800"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                刷新
              </button>
              <button
                onClick={() => setSelectedAppIds([])}
                disabled={selectedAppIds.length === 0}
                className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-white disabled:opacity-40 dark:hover:bg-gray-800"
              >
                <X size={13} />
                清空选择
              </button>
              <button
                onClick={() => void batchUninstall(false)}
                disabled={selectedAppIds.length === 0}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-900/20"
              >
                <Trash2 size={13} />
                批量卸载 {selectedAppIds.length || ''}
              </button>
              <button
                onClick={() => void batchUninstall(true)}
                disabled={selectedQuietCount === 0}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
              >
                <Sparkles size={13} />
                静默批量 {selectedQuietCount || ''}
              </button>
            </div>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as AppSortMode)}
              className="h-7 rounded border border-gray-200 bg-white px-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
            >
              <option value="name">按名称</option>
              <option value="size-desc">大小从大到小</option>
              <option value="size-asc">大小从小到大</option>
              <option value="date-desc">安装时间从新到旧</option>
              <option value="date-asc">安装时间从旧到新</option>
            </select>
          </div>

          <div className="flex gap-2 overflow-x-auto border-b border-gray-200 bg-white px-3 py-2 text-xs dark:border-gray-800 dark:bg-gray-900">
            {[
              ['all', '全部'],
              ['desktop', '桌面程序'],
              ['current-user', '当前用户'],
              ['all-users', '所有用户'],
              ['store', 'Store 应用'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTypeFilter(value as AppTypeFilter)}
                className={`shrink-0 rounded-full border px-3 py-1 ${
                  typeFilter === value
                    ? 'border-blue-500 bg-blue-600 text-white'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {label} {typeCounts[value as AppTypeFilter]}
              </button>
            ))}
          </div>

          <div className="grid gap-3 border-b border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-gray-600 dark:text-gray-300">
                <Filter size={13} />
                智能筛选
              </span>
              {APP_INSIGHT_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setInsightFilter(filter.value)}
                  className={`shrink-0 rounded-full border px-3 py-1 ${
                    insightFilter === filter.value
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  {filter.label} {insightCounts[filter.value]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-2 text-xs max-xl:grid-cols-3 max-md:grid-cols-2">
              {[
                ['软件总数', items.length],
                ['可静默卸载', insightCounts.quiet],
                ['不建议卸载', insightCounts['system-risk']],
                ['需谨慎处理', insightCounts.caution],
                ['登记异常', insightCounts['orphan-risk']],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900"
                >
                  <div className="text-gray-500">{label}</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid h-8 grid-cols-[34px_minmax(320px,1fr)_130px_120px_120px] items-center border-b border-gray-300 bg-gray-100 px-2 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
            <div />
            <button
              onClick={() => setSortMode('name')}
              className="flex items-center gap-1 text-left"
            >
              Program Name
              {sortMode === 'name' && <ChevronDown size={12} />}
            </button>
            <div className="text-right">Analysis</div>
            <button
              onClick={() => setSortMode(sortMode === 'size-desc' ? 'size-asc' : 'size-desc')}
              className="flex items-center justify-end gap-1 text-right"
            >
              Size
              {sortMode.startsWith('size') && (
                <ChevronDown size={12} className={sortMode === 'size-asc' ? 'rotate-180' : ''} />
              )}
            </button>
            <button
              onClick={() => setSortMode(sortMode === 'date-desc' ? 'date-asc' : 'date-desc')}
              className="flex items-center justify-end gap-1 text-right"
            >
              Installed On
              {sortMode.startsWith('date') && (
                <ChevronDown size={12} className={sortMode === 'date-asc' ? 'rotate-180' : ''} />
              )}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {filtered.map((item, index) => {
              const checked = selectedAppIds.includes(item.id);
              const active = selected?.id === item.id;
              const profile = getAppProfile(item);
              return (
                <div
                  key={item.id}
                  onClick={() => setSelected(item)}
                  onDoubleClick={() => void uninstall(false)}
                  className={`grid min-h-12 cursor-default grid-cols-[34px_minmax(320px,1fr)_130px_120px_120px] items-center px-2 py-1 text-xs ${
                    active
                      ? 'bg-blue-100 text-blue-950 dark:bg-blue-900/40 dark:text-blue-100'
                      : index % 2 === 0
                        ? 'bg-white hover:bg-blue-50 dark:bg-gray-900 dark:hover:bg-gray-800'
                        : 'bg-gray-50 hover:bg-blue-50 dark:bg-gray-950 dark:hover:bg-gray-800'
                  }`}
                >
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleApp(item.id);
                    }}
                    className={`flex h-7 w-7 items-center justify-center rounded ${
                      profile.systemProtected
                        ? 'cursor-not-allowed opacity-60'
                        : 'hover:bg-white/70 dark:hover:bg-gray-800'
                    }`}
                    title={profile.systemProtected ? '系统相关项目不建议批量选择' : '选择'}
                  >
                    {profile.systemProtected ? (
                      <ShieldAlert size={14} className="text-red-500" />
                    ) : (
                      <CheckSquare
                        size={14}
                        className={checked ? 'text-blue-600' : 'text-gray-400'}
                      />
                    )}
                  </button>
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold text-white ${appIconSeed(item.name)}`}
                    >
                      {(item.name || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{item.name}</span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${appTypeBadgeClass(item)}`}
                        >
                          {appTypeLabel(item)}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                        {profile.flags.slice(0, 4).map((flag) => (
                          <span
                            key={flag}
                            className={`rounded px-1.5 py-0.5 text-[10px] ${insightBadgeClass(flag)}`}
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${confidenceBadgeClass(profile.confidence)}`}
                    >
                      {profile.confidenceLabel}
                    </span>
                  </div>
                  <div className="text-right tabular-nums text-gray-600 dark:text-gray-300">
                    {item.estimatedSize ? formatBytes(item.estimatedSize) : '-'}
                  </div>
                  <div className="text-right tabular-nums text-gray-600 dark:text-gray-300">
                    {formatInstallDate(item.installDate)}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <EmptyState icon={<Search size={32} />} text="没有找到软件" />
            )}
          </div>

          <div className="grid h-10 grid-cols-[1fr_auto] items-center gap-3 border-t border-gray-300 bg-gray-50 px-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950">
              <Search size={14} className="text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Type to find a program"
                className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none"
              />
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              <span className="font-semibold">{filtered.length}</span> programs
              {totalSize > 0 && (
                <>
                  {' '}
                  / <span className="font-semibold">{formatBytes(totalSize)}</span>
                </>
              )}
              {selectedAppIds.length > 0 && (
                <>
                  {' '}
                  · selected {selectedAppIds.length} / {formatBytes(selectedAppsSize)}
                  {selectedCautionCount > 0 && <> · caution {selectedCautionCount}</>}
                </>
              )}
            </div>
          </div>
        </section>
        <aside className="min-h-0 overflow-auto rounded-lg border border-gray-300 bg-white pb-16 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-950">
            <div className="text-sm font-semibold">软件详情</div>
            <div className="mt-1 truncate text-xs text-gray-500">
              {selected?.name || '请选择一个软件'}
            </div>
          </div>
          <div className="space-y-3 p-4 text-sm">
            {[
              ['名称', selected?.name],
              ['发布者', selected?.publisher],
              ['版本', selected?.version],
              ['类型', selected ? appTypeLabel(selected) : ''],
              ['范围', selected?.scope],
              ['安装日期', selected?.installDate ? formatInstallDate(selected.installDate) : ''],
              ['大小', selected?.estimatedSize ? formatBytes(selected.estimatedSize) : ''],
              ['位置', selected?.installLocation],
              ['注册表', selected?.registryPath],
            ].map(([label, value]) => (
              <div
                key={label}
                className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 border-b border-gray-100 pb-2 last:border-b-0 dark:border-gray-800"
              >
                <div className="text-xs text-gray-500">{label}</div>
                <div className="break-all text-xs text-gray-800 dark:text-gray-200">
                  {value || '-'}
                </div>
              </div>
            ))}
          </div>
          {selectedProfile && (
            <div className="mx-4 mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {selectedProfile.confidence === 'low' ? (
                    <AlertTriangle size={15} className="text-amber-500" />
                  ) : (
                    <BadgeCheck size={15} className="text-emerald-500" />
                  )}
                  卸载分析
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${confidenceBadgeClass(selectedProfile.confidence)}`}
                >
                  {selectedProfile.confidenceLabel}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selectedProfile.flags.map((flag) => (
                  <span
                    key={flag}
                    className={`rounded px-2 py-1 text-[11px] ${insightBadgeClass(flag)}`}
                  >
                    {flag}
                  </span>
                ))}
              </div>
              <div className="mt-3 grid gap-2 text-xs">
                <div className="grid grid-cols-[78px_minmax(0,1fr)] gap-2">
                  <div className="text-gray-500">分类</div>
                  <div className="font-medium text-gray-800 dark:text-gray-200">
                    {selectedProfile.categoryLabel}
                  </div>
                </div>
                {selectedProfile.protectedReasons.length > 0 && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-2 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                    <div className="font-semibold">不建议删除</div>
                    <div className="mt-1 space-y-1">
                      {selectedProfile.protectedReasons.map((reason) => (
                        <div key={reason}>{reason}</div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedProfile.orphanRisk && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                    <div className="font-semibold">登记异常依据</div>
                    <div className="mt-1">
                      {selectedProfile.orphanReasons.join('、')}
                      。这只表示卸载登记信息不完整，不代表软件一定异常。
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-[78px_minmax(0,1fr)] gap-2">
                  <div className="text-gray-500">卸载方式</div>
                  <div className="font-medium text-gray-800 dark:text-gray-200">
                    {selectedProfile.uninstallKindLabel}
                  </div>
                </div>
                <div className="grid grid-cols-[78px_minmax(0,1fr)] gap-2">
                  <div className="text-gray-500">批量建议</div>
                  <div className="text-gray-800 dark:text-gray-200">
                    {selectedProfile.confidence === 'high'
                      ? '适合加入批量卸载队列'
                      : selectedProfile.confidence === 'medium'
                        ? '建议先确认弹窗和卸载范围'
                        : selectedProfile.confidence === 'protected'
                          ? '不允许批量卸载；确实需要处理时请单独确认'
                          : '可能涉及残留项或异常登记，建议单独处理'}
                  </div>
                </div>
                <div className="grid grid-cols-[78px_minmax(0,1fr)] gap-2">
                  <div className="text-gray-500">命令</div>
                  <div className="max-h-20 overflow-auto break-all rounded bg-white p-2 font-mono text-[11px] text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                    {selectedProfile.commandPreview || '-'}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="grid gap-2 px-4">
            <button
              onClick={() => void uninstall(false)}
              disabled={!selected}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 ${
                selectedProfile?.systemProtected
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              <Trash2 size={16} />
              {selectedProfile?.systemProtected
                ? '风险确认后卸载'
                : selected?.appKind === 'store'
                  ? '卸载 Store 应用'
                  : '调用卸载程序'}
            </button>
            <button
              onClick={() => void uninstall(true)}
              disabled={!selected?.quietUninstallString || selectedProfile?.systemProtected}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <ExternalLink size={16} />
              静默卸载命令
            </button>
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-100">
              <input
                type="checkbox"
                checked={selectedConfirmedUninstalled}
                disabled={!selected}
                onChange={(event) => {
                  if (!selected) return;
                  const checked = event.target.checked;
                  setConfirmedUninstalledIds((current) =>
                    checked
                      ? Array.from(new Set([...current, selected.id]))
                      : current.filter((id) => id !== selected.id)
                  );
                  setLeftoverPrompt(null);
                  setLeftovers([]);
                  setSelectedLeftoverIds([]);
                }}
                className="mt-1"
              />
              <span>我确认该软件已经完成卸载，再允许扫描和清理残留。</span>
            </label>
            <button
              onClick={() => void scanLeftovers()}
              disabled={!selected || scanningLeftovers || !selectedConfirmedUninstalled}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/20"
            >
              <Sparkles size={16} />
              {scanningLeftovers ? '正在扫描残留...' : '扫描残留'}
            </button>
            <button
              onClick={exportLeftovers}
              disabled={!selected || leftovers.length === 0}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <Download size={16} />
              导出残留报告
            </button>
          </div>
          <div className="mx-4 mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            残留清理必须在确认软件已卸载后执行；高置信度项目会默认勾选，中/低置信度疑似项默认保留，可在核对路径后手动勾选清理。
          </div>
          <div className="mt-4 border-t border-gray-200 px-4 pt-4 dark:border-gray-800">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">卸载残留</div>
              <button
                onClick={() => void cleanLeftovers()}
                disabled={cleaningLeftovers || selectedLeftoverIds.length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 size={14} />
                清理已选
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-950">
                <div className="text-gray-500">已选</div>
                <div className="mt-1 font-semibold">{selectedLeftoverIds.length} 项</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-950">
                <div className="text-gray-500">大小</div>
                <div className="mt-1 font-semibold">{formatBytes(selectedLeftoverSize)}</div>
              </div>
            </div>
            <div className="mt-3 max-h-[320px] space-y-2 overflow-auto pr-1">
              {leftovers.map((item) => {
                const checked = selectedLeftoverIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleLeftover(item.id)}
                    className={`w-full rounded-lg border p-3 text-left ${
                      checked
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <CheckSquare
                            size={14}
                            className={checked ? 'text-blue-600' : 'text-gray-400'}
                          />
                          <span className="text-xs font-semibold">{item.kindLabel}</span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                              item.confidence === 'high'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
                                : item.confidence === 'medium'
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
                            }`}
                          >
                            {item.confidence === 'high'
                              ? '高'
                              : item.confidence === 'medium'
                                ? '中'
                                : '低'}
                          </span>
                        </div>
                        <div className="mt-1 break-all font-mono text-[11px] text-gray-500">
                          {item.displayPath}
                        </div>
                        <div className="mt-1 text-[11px] text-gray-400">{item.reason}</div>
                      </div>
                      <div className="shrink-0 text-right text-[11px] text-gray-500">
                        <div>{formatBytes(item.size)}</div>
                        <div>{item.count} 项</div>
                      </div>
                    </div>
                  </button>
                );
              })}
              {leftovers.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400 dark:border-gray-800">
                  <ShieldAlert size={24} className="mx-auto mb-2" />
                  卸载完成后点击扫描残留
                </div>
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
