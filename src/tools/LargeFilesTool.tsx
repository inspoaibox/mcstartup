import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { open as openExternal } from '@tauri-apps/api/shell';
import { invoke } from '@tauri-apps/api/tauri';
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileType,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { useSettingsStore } from '../stores/settingsStore';
import type { AppSettings } from '../types';

type ViewMode = 'tree' | 'files' | 'types' | 'duplicates' | 'age';
type ResultTargetKind = 'folder' | 'file';
type AIProvider = NonNullable<AppSettings['aiProviders']>[number];

interface LargeFileItem {
  path: string;
  name: string;
  size: number;
  modified?: number | null;
}

interface DiskUsageFolder {
  path: string;
  name: string;
  parentPath: string;
  size: number;
  fileCount: number;
  folderCount: number;
  depth: number;
  percent: number;
}

interface FileExtensionStat {
  extension: string;
  label: string;
  size: number;
  count: number;
  percent: number;
}

interface DuplicateFileGroup {
  signature: string;
  size: number;
  count: number;
  totalWaste: number;
  files: LargeFileItem[];
}

interface FileAgeStat {
  bucket: string;
  label: string;
  size: number;
  count: number;
  percent: number;
}

interface DiskUsageScanResult {
  root: string;
  scannedSize: number;
  fileCount: number;
  folderCount: number;
  durationMs: number;
  folders: DiskUsageFolder[];
  files: LargeFileItem[];
  extensions: FileExtensionStat[];
  duplicates: DuplicateFileGroup[];
  ageStats: FileAgeStat[];
  excludedPaths: string[];
}

interface DiskVolume {
  root: string;
  name: string;
  driveType: number;
  driveTypeLabel: string;
  fileSystem: string;
  total: number;
  free: number;
  available: boolean;
}

interface TreemapItem {
  id: string;
  label: string;
  path: string;
  size: number;
  color: string;
  kind: ResultTargetKind;
}

interface TreemapRect extends TreemapItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ResultTarget {
  kind: ResultTargetKind;
  path: string;
  name: string;
  size: number;
  percent?: number;
  modified?: number | null;
}

interface ContextMenuState {
  x: number;
  y: number;
  target: ResultTarget;
}

interface AiAdviceState {
  target: ResultTarget;
  loading: boolean;
  answer: string;
  error: string;
}

const TYPE_COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#4f46e5',
  '#be123c',
  '#0f766e',
  '#ca8a04',
];

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

function formatTime(value?: number | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function selectedPath(value: string | string[] | null): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

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

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function parseExcludePaths(value: string) {
  return value
    .split(/[\r\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function usedPercent(volume: DiskVolume) {
  if (!volume.total) return 0;
  return Math.max(0, Math.min(100, Math.round(((volume.total - volume.free) / volume.total) * 100)));
}

function colorForKey(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return TYPE_COLORS[hash % TYPE_COLORS.length];
}

function buildTreemap(items: TreemapItem[], width: number, height: number): TreemapRect[] {
  const filtered = items.filter((item) => item.size > 0).sort((a, b) => b.size - a.size).slice(0, 160);
  const total = filtered.reduce((sum, item) => sum + item.size, 0);
  if (!total) return [];
  return splitTreemap(filtered, 0, 0, width, height);
}

function splitTreemap(items: TreemapItem[], x: number, y: number, w: number, h: number): TreemapRect[] {
  if (items.length === 0 || w <= 0 || h <= 0) return [];
  if (items.length === 1) return [{ ...items[0], x, y, w, h }];

  const total = items.reduce((sum, item) => sum + item.size, 0);
  let leftSize = 0;
  let splitIndex = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (leftSize >= total / 2 && index > 0) break;
    leftSize += items[index].size;
    splitIndex = index + 1;
  }
  const left = items.slice(0, splitIndex);
  const right = items.slice(splitIndex);
  if (right.length === 0) return [{ ...items[0], x, y, w, h }];

  const ratio = leftSize / total;
  if (w >= h) {
    const leftWidth = Math.max(1, w * ratio);
    return [
      ...splitTreemap(left, x, y, leftWidth, h),
      ...splitTreemap(right, x + leftWidth, y, w - leftWidth, h),
    ];
  }
  const topHeight = Math.max(1, h * ratio);
  return [
    ...splitTreemap(left, x, y, w, topHeight),
    ...splitTreemap(right, x, y + topHeight, w, h - topHeight),
  ];
}

function getDefaultAiBaseUrl(type: AIProvider['type']) {
  switch (type) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'google':
      return 'https://generativelanguage.googleapis.com/v1beta';
    case 'vertex':
      return 'https://aiplatform.googleapis.com/v1';
    case 'azure':
    case 'custom':
    case 'sub2api':
    default:
      return '';
  }
}

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

function pickConfiguredAiProvider(settings: ReturnType<typeof useSettingsStore.getState>) {
  const providers = settings.aiProviders || [];
  const defaultModel = settings.defaultAiModel || '';
  if (defaultModel.includes('::')) {
    const [providerId, model] = defaultModel.split('::');
    const provider = providers.find((item) => item.id === providerId);
    if (provider && model) return { provider, model };
  }
  const activeProvider = providers.find((item) => item.id === settings.activeAiProviderId) || providers[0];
  if (!activeProvider) return null;
  return { provider: activeProvider, model: activeProvider.model || activeProvider.availableModels?.[0] || '' };
}

function extractOpenAiMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

async function postAiJson(provider: AIProvider, url: string, headers: Record<string, string>, body: Record<string, unknown>) {
  const text = await invoke<string>('http_post_json', {
    url,
    headers,
    body,
    connectionMode: provider.connectionMode || 'auto',
    proxyUrl: provider.proxyUrl || null,
  });
  const data = JSON.parse(text);
  if (data?.error) {
    const message = data.error.message || data.error.type || JSON.stringify(data.error);
    throw new Error(`AI 请求失败：${message}`);
  }
  return data;
}

async function callDefaultAi(provider: AIProvider, model: string, prompt: string) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl || getDefaultAiBaseUrl(provider.type));
  if (!provider.apiKey) throw new Error('当前 AI 提供商未配置 API Key');
  if (!model) throw new Error('当前 AI 提供商未配置模型');

  if (provider.type === 'openai' || provider.type === 'custom' || provider.type === 'sub2api') {
    if (!baseUrl) throw new Error('当前 AI 提供商未配置 API Base URL');
    const data = await postAiJson(
      provider,
      `${baseUrl}/chat/completions`,
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1600,
        stream: false,
      },
    );
    return extractOpenAiMessageText(data?.choices?.[0]?.message?.content);
  }

  if (provider.type === 'azure') {
    if (!baseUrl) throw new Error('Azure OpenAI 未配置 Endpoint');
    const data = await postAiJson(
      provider,
      `${baseUrl}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=2024-02-15-preview`,
      {
        'Content-Type': 'application/json',
        'api-key': provider.apiKey,
      },
      {
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1600,
        stream: false,
      },
    );
    return extractOpenAiMessageText(data?.choices?.[0]?.message?.content);
  }

  if (provider.type === 'google') {
    const data = await postAiJson(
      provider,
      `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(provider.apiKey)}`,
      { 'Content-Type': 'application/json' },
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1600 },
      },
    );
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (provider.type === 'anthropic') {
    const data = await postAiJson(
      provider,
      `${baseUrl}/messages`,
      {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model,
        max_tokens: 1600,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      },
    );
    return Array.isArray(data?.content) ? data.content.map((part: { text?: string }) => part.text || '').join('\n') : '';
  }

  if (provider.type === 'vertex') {
    const data = await postAiJson(
      provider,
      `${baseUrl}/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(provider.apiKey)}`,
      { 'Content-Type': 'application/json' },
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1600 },
      },
    );
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  throw new Error(`不支持的 AI 提供商类型：${provider.type}`);
}

function buildAiAdvicePrompt(target: ResultTarget) {
  return [
    '你是 Windows 磁盘空间分析助手。请用中文简洁分析下面这个本地文件或目录。',
    '',
    `类型：${target.kind === 'folder' ? '目录' : '文件'}`,
    `名称：${target.name}`,
    `路径：${target.path}`,
    `大小：${formatBytes(target.size)}`,
    target.percent !== undefined ? `占扫描总量比例：${target.percent.toFixed(2)}%` : '',
    target.modified ? `修改时间：${formatTime(target.modified)}` : '',
    '',
    '请按以下结构回答：',
    '1. 这通常可能是什么',
    '2. 常见用途或来源',
    '3. 删除风险：低/中/高/无法判断，并说明原因',
    '4. 删除前建议检查什么',
    '5. 如果要释放空间，推荐怎么处理',
    '',
    '重要规则：',
    '只给建议，不要假装能确定本机真实用途。',
    '必须明确提示：是否删除必须由用户自行确认，AI 结果可能不准确，应用和 AI 不对删除造成的后果负责。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildBrowserSearchUrl(target: ResultTarget) {
  const query = [
    target.name,
    target.kind === 'folder' ? 'Windows 文件夹 是什么 可以删除吗' : 'Windows 文件 是什么 可以删除吗',
    target.path.includes('AppData') ? 'AppData' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export default function LargeFilesTool() {
  const ready = useToolTheme();
  const [volumes, setVolumes] = useState<DiskVolume[]>([]);
  const [root, setRoot] = useState('');
  const [minSizeMb, setMinSizeMb] = useState(100);
  const [limit, setLimit] = useState(100);
  const [excludeText, setExcludeText] = useState(
    ['C:\\Windows\\WinSxS', 'C:\\System Volume Information', '$Recycle.Bin', 'node_modules'].join('\n'),
  );
  const [result, setResult] = useState<DiskUsageScanResult | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState('');
  const [search, setSearch] = useState('');
  const [loadingVolumes, setLoadingVolumes] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [aiAdvice, setAiAdvice] = useState<AiAdviceState | null>(null);
  const scanIdRef = useRef(0);

  const selectedVolume = useMemo(() => volumes.find((volume) => volume.root === root), [root, volumes]);
  const excludePaths = useMemo(() => parseExcludePaths(excludeText), [excludeText]);

  const loadVolumes = useCallback(async () => {
    setLoadingVolumes(true);
    setError('');
    try {
      const rows = await invoke<DiskVolume[]>('system_disk_volumes');
      setVolumes(rows);
      setRoot((current) => current || rows.find((item) => item.driveType === 3)?.root || rows[0]?.root || '');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingVolumes(false);
    }
  }, []);

  useEffect(() => {
    void loadVolumes();
  }, [loadVolumes]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, DiskUsageFolder[]>();
    for (const folder of result?.folders || []) {
      const list = map.get(folder.parentPath) || [];
      list.push(folder);
      map.set(folder.parentPath, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
    }
    return map;
  }, [result]);

  const folderByPath = useMemo(() => {
    const map = new Map<string, DiskUsageFolder>();
    for (const folder of result?.folders || []) map.set(folder.path, folder);
    return map;
  }, [result]);

  const visibleFolders = useMemo(() => {
    if (!result) return [];
    const rows: DiskUsageFolder[] = [];
    const visit = (parentPath: string) => {
      for (const folder of childrenByParent.get(parentPath) || []) {
        rows.push(folder);
        if (expanded.has(folder.path)) visit(folder.path);
      }
    };
    const rootFolder = folderByPath.get(result.root);
    if (rootFolder) {
      rows.push(rootFolder);
      if (expanded.has(rootFolder.path)) visit(rootFolder.path);
    } else {
      visit('');
    }
    const keyword = search.trim().toLowerCase();
    if (!keyword || viewMode !== 'tree') return rows;
    return rows.filter((folder) => `${folder.name} ${folder.path}`.toLowerCase().includes(keyword));
  }, [childrenByParent, expanded, folderByPath, result, search, viewMode]);

  const filteredFiles = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const rows = result?.files || [];
    if (!keyword || viewMode !== 'files') return rows;
    return rows.filter((file) => `${file.name} ${file.path}`.toLowerCase().includes(keyword));
  }, [result, search, viewMode]);

  const filteredTypes = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const rows = result?.extensions || [];
    if (!keyword || viewMode !== 'types') return rows;
    return rows.filter((item) => `${item.label} ${item.extension}`.toLowerCase().includes(keyword));
  }, [result, search, viewMode]);

  const filteredDuplicates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const rows = result?.duplicates || [];
    if (!keyword || viewMode !== 'duplicates') return rows;
    return rows.filter((group) =>
      group.files.some((file) => `${file.name} ${file.path}`.toLowerCase().includes(keyword)),
    );
  }, [result, search, viewMode]);

  const filteredAgeStats = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const rows = result?.ageStats || [];
    if (!keyword || viewMode !== 'age') return rows;
    return rows.filter((item) => item.label.toLowerCase().includes(keyword));
  }, [result, search, viewMode]);

  const treemapItems = useMemo<TreemapItem[]>(() => {
    if (!result) return [];
    const target = selectedFolder || result.root;
    const childFolders = childrenByParent.get(target) || [];
    if (childFolders.length > 0) {
      return childFolders.map((folder) => ({
        id: folder.path,
        label: folder.name,
        path: folder.path,
        size: folder.size,
        color: colorForKey(folder.path),
        kind: 'folder',
      }));
    }
    return result.files.slice(0, 120).map((file) => ({
      id: file.path,
      label: file.name,
      path: file.path,
      size: file.size,
      color: colorForKey(file.name.split('.').pop() || file.name),
      kind: 'file',
    }));
  }, [childrenByParent, result, selectedFolder]);

  const treemapRects = useMemo(() => buildTreemap(treemapItems, 1000, 260), [treemapItems]);

  const chooseFolder = async () => {
    const selected = await openDialog({ multiple: false, directory: true });
    const next = selectedPath(selected);
    if (next) setRoot(next);
  };

  const scan = async () => {
    if (!root.trim()) {
      setError('请先选择磁盘分区或扫描目录');
      return;
    }
    const scanId = scanIdRef.current + 1;
    scanIdRef.current = scanId;
    setLoading(true);
    setError('');
    setMessage(`正在扫描 ${root}，磁盘文件较多时可能需要一点时间...`);
    setSearch('');
    try {
      await nextPaint();
      const response = await invoke<DiskUsageScanResult>('system_disk_usage_scan', {
        root,
        minSizeMb,
        limit,
        excludePaths,
      });
      if (scanId !== scanIdRef.current) return;
      setResult(response);
      setExpanded(new Set([response.root]));
      setSelectedFolder(response.root);
      setViewMode('tree');
      setMessage(
        `扫描完成：${formatBytes(response.scannedSize)}，${response.fileCount} 个文件，${response.folderCount} 个文件夹，用时 ${(
          response.durationMs / 1000
        ).toFixed(1)} 秒`,
      );
    } catch (err) {
      if (scanId !== scanIdRef.current) return;
      setResult(null);
      setError(String(err));
    } finally {
      if (scanId === scanIdRef.current) setLoading(false);
    }
  };

  const cancelScan = () => {
    scanIdRef.current += 1;
    setLoading(false);
    void invoke('system_disk_usage_cancel_scan').catch(() => {});
    setMessage('已取消扫描，本次结果会被忽略。');
  };

  const exportJsonReport = () => {
    if (!result) return;
    const filename = `large-files-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    downloadText(filename, JSON.stringify(result, null, 2), 'application/json;charset=utf-8');
  };

  const exportCsvReport = () => {
    if (!result) return;
    const rows = [
      ['类型', '名称', '大小', '数量/修改时间', '路径'],
      ...result.folders.map((folder) => ['目录', folder.name, folder.size, folder.fileCount, folder.path]),
      ...result.files.map((file) => ['大文件', file.name, file.size, formatTime(file.modified), file.path]),
      ...result.extensions.map((item) => ['文件类型', item.label, item.size, item.count, item.extension]),
      ...result.ageStats.map((item) => ['文件年龄', item.label, item.size, item.count, item.bucket]),
      ...result.duplicates.flatMap((group) =>
        group.files.map((file) => ['重复大文件', file.name, file.size, `组内 ${group.count} 个`, file.path]),
      ),
    ];
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const filename = `large-files-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    downloadText(filename, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
  };

  const toggleFolder = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openContextMenu = (event: MouseEvent, target: ResultTarget) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 240),
      y: Math.min(event.clientY, window.innerHeight - 220),
      target,
    });
  };

  const openTargetLocation = async (target: ResultTarget) => {
    setContextMenu(null);
    if (target.kind === 'folder') {
      await invoke('open_file', { path: target.path });
    } else {
      await invoke('show_in_folder', { path: target.path });
    }
  };

  const searchTargetOnline = async (target: ResultTarget) => {
    setContextMenu(null);
    await openExternal(buildBrowserSearchUrl(target));
  };

  const askAiAboutTarget = async (target: ResultTarget) => {
    setContextMenu(null);
    setAiAdvice({ target, loading: true, answer: '', error: '' });
    try {
      const settings = useSettingsStore.getState();
      const selection = pickConfiguredAiProvider(settings);
      if (!selection) throw new Error('未配置默认 AI 模型，请先在设置中配置 AI 提供商和默认模型');
      const answer = await callDefaultAi(selection.provider, selection.model, buildAiAdvicePrompt(target));
      setAiAdvice({
        target,
        loading: false,
        answer: answer || 'AI 未返回有效内容',
        error: '',
      });
    } catch (err) {
      setAiAdvice({
        target,
        loading: false,
        answer: '',
        error: String(err),
      });
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="📦"
        title="大文件查找"
        subtitle="按 WizTree 思路显示磁盘分区、目录占用、最大文件、文件类型和空间图"
        actions={
          <button
            onClick={() => void loadVolumes()}
            disabled={loadingVolumes}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <RefreshCw size={14} className={loadingVolumes ? 'animate-spin' : ''} />
            刷新磁盘
          </button>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">我的电脑</div>
            <span className="text-xs text-gray-500">{volumes.length} 个分区</span>
          </div>

          <div className="mt-3 grid gap-2">
            {volumes.map((volume) => {
              const active = volume.root === root;
              const percent = usedPercent(volume);
              return (
                <button
                  key={volume.root}
                  onClick={() => setRoot(volume.root)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <HardDrive size={18} className={active ? 'text-blue-600' : 'text-gray-400'} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {volume.name} ({volume.root.replace('\\', '')})
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {volume.driveTypeLabel}
                          {volume.fileSystem ? ` · ${volume.fileSystem}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-gray-500">
                      <div>{formatBytes(volume.free)} 可用</div>
                      <div>{formatBytes(volume.total)}</div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
                  </div>
                </button>
              );
            })}
            {!loadingVolumes && volumes.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-800">
                未读取到磁盘分区，可使用自定义目录
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
            <div className="text-sm font-semibold">扫描设置</div>
            <div className="mt-3 flex gap-2">
              <input
                value={root}
                onChange={(event) => setRoot(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                placeholder="C:\\ 或自定义目录"
              />
              <button
                onClick={() => void chooseFolder()}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <FolderOpen size={16} />
                目录
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block space-y-2">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">大文件最小大小</span>
                <div className="flex rounded-lg border border-gray-200 bg-white focus-within:border-blue-500 dark:border-gray-700 dark:bg-gray-950">
                  <input
                    type="number"
                    min={1}
                    value={minSizeMb}
                    onChange={(event) => setMinSizeMb(Math.max(1, Number(event.target.value) || 1))}
                    className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm outline-none"
                  />
                  <span className="border-l border-gray-200 px-2 py-2 text-xs text-gray-500 dark:border-gray-700">
                    MB
                  </span>
                </div>
              </label>

              <label className="block space-y-2">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">最大文件显示数量</span>
                <div className="flex rounded-lg border border-gray-200 bg-white focus-within:border-blue-500 dark:border-gray-700 dark:bg-gray-950">
                  <input
                    type="number"
                    min={20}
                    max={10000}
                    value={limit}
                    onChange={(event) => setLimit(Math.max(20, Math.min(10000, Number(event.target.value) || 20)))}
                    className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm outline-none"
                  />
                  <span className="border-l border-gray-200 px-2 py-2 text-xs text-gray-500 dark:border-gray-700">
                    个
                  </span>
                </div>
              </label>
            </div>

            <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
              这两项只限制“最大文件”列表：目录树和文件类型统计仍会按扫描范围完整统计。
            </p>

            <label className="mt-3 block space-y-2">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">排除目录/路径</span>
              <textarea
                value={excludeText}
                onChange={(event) => setExcludeText(event.target.value)}
                rows={4}
                className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                placeholder="每行一个目录，例如 C:\\Windows\\WinSxS 或 node_modules"
              />
              <span className="text-xs text-gray-500">支持完整路径，也支持 node_modules 这类目录名。</span>
            </label>

            <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
              <button
                onClick={() => void scan()}
                disabled={loading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                扫描 {selectedVolume ? selectedVolume.root : root || '磁盘'}
              </button>
              <button
                onClick={cancelScan}
                disabled={!loading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <Square size={15} />
                停止
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={exportJsonReport}
                disabled={!result}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <Download size={14} />
                导出 JSON
              </button>
              <button
                onClick={exportCsvReport}
                disabled={!result}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <Download size={14} />
                导出 CSV
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
              <div className="text-xs text-gray-500">已扫描</div>
              <div className="mt-1 text-xl font-semibold">{formatBytes(result?.scannedSize || 0)}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
              <div className="text-xs text-gray-500">文件/目录</div>
              <div className="mt-1 text-xl font-semibold">
                {result ? `${result.fileCount}/${result.folderCount}` : '0/0'}
              </div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
              <div className="text-xs text-gray-500">重复组</div>
              <div className="mt-1 text-xl font-semibold">{result?.duplicates?.length || 0}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
              <div className="text-xs text-gray-500">排除</div>
              <div className="mt-1 text-xl font-semibold">{result?.excludedPaths?.length || excludePaths.length}</div>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-3 dark:border-gray-800">
            <div className="grid grid-cols-5 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
              {[
                ['tree', '目录树'],
                ['files', '最大文件'],
                ['types', '文件类型'],
                ['duplicates', '重复文件'],
                ['age', '年龄统计'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode as ViewMode)}
                  className={`h-8 rounded-md px-4 text-xs font-medium ${
                    viewMode === mode
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex min-w-[260px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950">
              <Search size={15} className="text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                placeholder="搜索当前视图..."
              />
            </div>
          </div>

          {(message || error) && (
            <div
              className={`mx-3 mt-3 rounded-lg px-3 py-2 text-sm ${
                error
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                  : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
              }`}
            >
              {error || message}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto px-3 pt-3">
            {viewMode === 'tree' && (
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[minmax(320px,1fr)_130px_120px_120px_160px] border-b border-gray-200 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
                  <span>目录</span>
                  <span>大小</span>
                  <span>占比</span>
                  <span>文件</span>
                  <span>路径</span>
                </div>
                {visibleFolders.map((folder) => {
                  const hasChildren = (childrenByParent.get(folder.path) || []).length > 0;
                  const selected = selectedFolder === folder.path;
                  return (
                    <div
                      key={folder.path}
                      onClick={() => setSelectedFolder(folder.path)}
                      onContextMenu={(event) =>
                        openContextMenu(event, {
                          kind: 'folder',
                          path: folder.path,
                          name: folder.name,
                          size: folder.size,
                          percent: folder.percent,
                        })
                      }
                      className={`grid cursor-default grid-cols-[minmax(320px,1fr)_130px_120px_120px_160px] items-center border-b border-gray-100 py-2 text-sm dark:border-gray-800 ${
                        selected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                    >
                      <div className="flex min-w-0 items-center" style={{ paddingLeft: `${folder.depth * 18}px` }}>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            if (hasChildren) toggleFolder(folder.path);
                          }}
                          className="mr-1 flex h-6 w-6 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          {hasChildren ? (
                            expanded.has(folder.path) ? <ChevronDown size={15} /> : <ChevronRight size={15} />
                          ) : (
                            <span className="h-4 w-4" />
                          )}
                        </button>
                        <FolderOpen size={15} className="mr-2 shrink-0 text-blue-500" />
                        <span className="truncate font-medium" title={folder.name}>
                          {folder.name}
                        </span>
                      </div>
                      <span className="font-semibold text-blue-600">{formatBytes(folder.size)}</span>
                      <span className="pr-4">
                        <span className="mb-1 block text-xs text-gray-500">{folder.percent.toFixed(2)}%</span>
                        <span className="block h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <span className="block h-full bg-blue-600" style={{ width: `${Math.min(100, folder.percent)}%` }} />
                        </span>
                      </span>
                      <span className="text-xs text-gray-500">{folder.fileCount}</span>
                      <span className="truncate font-mono text-xs text-gray-500" title={folder.path}>
                        {folder.path}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {viewMode === 'files' && (
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[120px_220px_minmax(260px,1fr)_170px_100px] border-b border-gray-200 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
                  <span>大小</span>
                  <span>文件名</span>
                  <span>路径</span>
                  <span>修改时间</span>
                  <span>操作</span>
                </div>
                {filteredFiles.map((file) => (
                  <div
                    key={file.path}
                    onContextMenu={(event) =>
                      openContextMenu(event, {
                        kind: 'file',
                        path: file.path,
                        name: file.name,
                        size: file.size,
                        modified: file.modified,
                      })
                    }
                    className="grid grid-cols-[120px_220px_minmax(260px,1fr)_170px_100px] items-center border-b border-gray-100 py-2 text-sm dark:border-gray-800"
                  >
                    <span className="font-semibold text-blue-600">{formatBytes(file.size)}</span>
                    <span className="truncate font-medium" title={file.name}>
                      {file.name}
                    </span>
                    <span className="truncate font-mono text-xs text-gray-500" title={file.path}>
                      {file.path}
                    </span>
                    <span className="text-xs text-gray-500">{formatTime(file.modified)}</span>
                    <button
                      onClick={() => void invoke('show_in_folder', { path: file.path })}
                      className="h-8 w-fit rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      定位
                    </button>
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'types' && (
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[180px_minmax(240px,1fr)_120px_120px] border-b border-gray-200 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
                  <span>类型</span>
                  <span>占用</span>
                  <span>大小</span>
                  <span>文件数</span>
                </div>
                {filteredTypes.map((item) => (
                  <div
                    key={item.extension}
                    className="grid grid-cols-[180px_minmax(240px,1fr)_120px_120px] items-center border-b border-gray-100 py-2 text-sm dark:border-gray-800"
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <FileType size={15} style={{ color: colorForKey(item.extension) }} />
                      {item.label}
                    </span>
                    <span className="pr-4">
                      <span className="mb-1 block text-xs text-gray-500">{item.percent.toFixed(2)}%</span>
                      <span className="block h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <span
                          className="block h-full"
                          style={{ width: `${Math.min(100, item.percent)}%`, backgroundColor: colorForKey(item.extension) }}
                        />
                      </span>
                    </span>
                    <span className="font-semibold text-blue-600">{formatBytes(item.size)}</span>
                    <span className="text-xs text-gray-500">{item.count}</span>
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'duplicates' && (
              <div className="min-w-[860px] space-y-3 pb-4">
                {filteredDuplicates.map((group) => (
                  <section
                    key={group.signature}
                    className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-950">
                      <div className="font-semibold">
                        {formatBytes(group.size)} · {group.count} 个疑似重复
                      </div>
                      <div className="text-xs text-amber-600 dark:text-amber-300">
                        理论可释放 {formatBytes(group.totalWaste)}
                      </div>
                    </div>
                    {group.files.map((file) => (
                      <div
                        key={file.path}
                        onContextMenu={(event) =>
                          openContextMenu(event, {
                            kind: 'file',
                            path: file.path,
                            name: file.name,
                            size: file.size,
                            modified: file.modified,
                          })
                        }
                        className="grid grid-cols-[220px_minmax(280px,1fr)_170px_90px] items-center border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 dark:border-gray-800"
                      >
                        <span className="truncate font-medium" title={file.name}>
                          {file.name}
                        </span>
                        <span className="truncate font-mono text-xs text-gray-500" title={file.path}>
                          {file.path}
                        </span>
                        <span className="text-xs text-gray-500">{formatTime(file.modified)}</span>
                        <button
                          onClick={() => void invoke('show_in_folder', { path: file.path })}
                          className="h-8 w-fit rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          定位
                        </button>
                      </div>
                    ))}
                  </section>
                ))}
                {result && filteredDuplicates.length === 0 && (
                  <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm text-gray-400 dark:border-gray-800">
                    未发现同名同大小的大文件重复组
                  </div>
                )}
              </div>
            )}

            {viewMode === 'age' && (
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[180px_minmax(240px,1fr)_120px_120px] border-b border-gray-200 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
                  <span>修改时间</span>
                  <span>占用</span>
                  <span>大小</span>
                  <span>文件数</span>
                </div>
                {filteredAgeStats.map((item) => (
                  <div
                    key={item.bucket}
                    className="grid grid-cols-[180px_minmax(240px,1fr)_120px_120px] items-center border-b border-gray-100 py-2 text-sm dark:border-gray-800"
                  >
                    <span className="font-semibold">{item.label}</span>
                    <span className="pr-4">
                      <span className="mb-1 block text-xs text-gray-500">{item.percent.toFixed(2)}%</span>
                      <span className="block h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <span
                          className="block h-full bg-emerald-600"
                          style={{ width: `${Math.min(100, item.percent)}%` }}
                        />
                      </span>
                    </span>
                    <span className="font-semibold text-blue-600">{formatBytes(item.size)}</span>
                    <span className="text-xs text-gray-500">{item.count}</span>
                  </div>
                ))}
              </div>
            )}

            {!result && !loading && (
              <div className="flex h-72 flex-col items-center justify-center text-gray-400">
                <Search size={36} />
                <p className="mt-2 text-sm">选择磁盘分区后开始扫描</p>
              </div>
            )}
          </div>

          <div className="h-[260px] shrink-0 border-t border-gray-200 bg-gray-950 p-2 dark:border-gray-800">
            <div className="relative h-full w-full overflow-hidden rounded-md bg-gray-900">
              {treemapRects.map((rect) => (
                <button
                  key={rect.id}
                  onClick={() => {
                    setSelectedFolder(rect.path);
                    setViewMode('tree');
                  }}
                  onContextMenu={(event) =>
                    openContextMenu(event, {
                      kind: rect.kind,
                      path: rect.path,
                      name: rect.label,
                      size: rect.size,
                    })
                  }
                  className="absolute overflow-hidden border border-gray-900/60 p-1 text-left text-[11px] leading-tight text-white/90 hover:brightness-110"
                  style={{
                    left: `${rect.x / 10}%`,
                    top: `${rect.y / 2.6}%`,
                    width: `${rect.w / 10}%`,
                    height: `${rect.h / 2.6}%`,
                    backgroundColor: rect.color,
                  }}
                  title={`${rect.label}\n${formatBytes(rect.size)}\n${rect.path}`}
                >
                  {rect.w > 80 && rect.h > 32 ? (
                    <>
                      <span className="block truncate font-semibold">{rect.label}</span>
                      <span className="block truncate opacity-80">{formatBytes(rect.size)}</span>
                    </>
                  ) : null}
                </button>
              ))}
              {treemapRects.length === 0 && (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">扫描后显示空间图</div>
              )}
            </div>
          </div>
        </section>
      </main>

      {contextMenu && (
        <div
          className="fixed z-50 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
            <div className="truncate font-medium">{contextMenu.target.name}</div>
            <div className="truncate text-xs text-gray-500">{formatBytes(contextMenu.target.size)}</div>
          </div>
          <button
            onClick={() => void openTargetLocation(contextMenu.target)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <FolderOpen size={15} />
            {contextMenu.target.kind === 'folder' ? '打开文件夹' : '打开所在文件夹'}
          </button>
          <button
            onClick={() => void searchTargetOnline(contextMenu.target)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <ExternalLink size={15} />
            浏览器搜索
          </button>
          <button
            onClick={() => void askAiAboutTarget(contextMenu.target)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/20"
          >
            <Sparkles size={15} />
            AI 咨询是否可删
          </button>
        </div>
      )}

      {aiAdvice && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <section className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles size={16} className="text-blue-600" />
                  AI 文件/目录建议
                </div>
                <div className="mt-1 truncate font-mono text-xs text-gray-500">{aiAdvice.target.path}</div>
              </div>
              <button
                onClick={() => setAiAdvice(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>

            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
              AI 仅基于名称、路径和大小给出建议，可能不准确。是否删除必须由你自行确认，应用和 AI 不对删除造成的后果负责。
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {aiAdvice.loading ? (
                <div className="flex h-48 flex-col items-center justify-center text-gray-500">
                  <Loader2 size={28} className="animate-spin text-blue-600" />
                  <div className="mt-3 text-sm">正在调用默认 AI 模型分析...</div>
                </div>
              ) : aiAdvice.error ? (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                  {aiAdvice.error}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-sm leading-6 text-gray-700 dark:bg-gray-950 dark:text-gray-200">
                  {aiAdvice.answer}
                </pre>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
