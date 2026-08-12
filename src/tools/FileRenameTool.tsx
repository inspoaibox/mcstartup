import { useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eraser,
  File as FileIcon,
  Folder,
  FolderOpen,
  ListRestart,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

type CaseMode = 'none' | 'lower' | 'upper' | 'title';
type ExtensionMode = 'keep' | 'lower' | 'upper' | 'replace' | 'remove';
type SeparatorMode = 'none' | 'space' | 'underscore' | 'dash' | 'dot';
type InsertPosition = 'append' | 'prepend' | 'beforeName' | 'afterName' | 'replace';
type SequenceMode =
  | 'number'
  | 'padded'
  | 'alphaLower'
  | 'alphaUpper'
  | 'chinese'
  | 'chineseFormal'
  | 'circled'
  | 'romanLower'
  | 'romanUpper'
  | 'custom';

interface RenameItem {
  path: string;
  parent: string;
  name: string;
  stem: string;
  extension: string;
  isDir: boolean;
  size: number;
  modified?: number;
  selected?: boolean;
}

interface RenameConfig {
  configVersion: number;
  template: string;
  prefix: string;
  suffix: string;
  find: string;
  replace: string;
  useRegex: boolean;
  regexFlags: string;
  trim: boolean;
  collapseSpaces: boolean;
  replaceIllegal: boolean;
  fullWidthToHalfWidth: boolean;
  normalizePunctuation: boolean;
  removeBracketText: boolean;
  removeDuplicateSuffix: boolean;
  removeEmoji: boolean;
  removeDiacritics: boolean;
  separatorMode: SeparatorMode;
  caseMode: CaseMode;
  start: number;
  step: number;
  padding: number;
  sequenceMode: SequenceMode;
  customSequence: string;
  customSequenceLoop: boolean;
  extensionMode: ExtensionMode;
  newExtension: string;
}

interface ScanOptions {
  includeFiles: boolean;
  includeFolders: boolean;
  recursive: boolean;
  includeHidden: boolean;
  extensions: string;
}

interface PreviewRow {
  item: RenameItem;
  index: number;
  newName: string;
  targetPath: string;
  changed: boolean;
  errors: string[];
  warnings: string[];
}

interface RenameRulePreset {
  name: string;
  description: string;
  patch: Partial<RenameConfig>;
}

interface TemplateToken {
  token: string;
  label: string;
  description: string;
}

const INSERT_POSITION_LABELS: Record<InsertPosition, string> = {
  append: '追加到末尾',
  prepend: '插入到开头',
  beforeName: '放在原名前',
  afterName: '放在原名后',
  replace: '替换模板',
};

const STORAGE_KEY = 'mcheng:file-rename-config:v1';
const CONFIG_VERSION = 4;

const DEFAULT_CONFIG: RenameConfig = {
  configVersion: CONFIG_VERSION,
  template: '{name}',
  prefix: '',
  suffix: '',
  find: '',
  replace: '',
  useRegex: false,
  regexFlags: 'g',
  trim: false,
  collapseSpaces: false,
  replaceIllegal: false,
  fullWidthToHalfWidth: false,
  normalizePunctuation: false,
  removeBracketText: false,
  removeDuplicateSuffix: false,
  removeEmoji: false,
  removeDiacritics: false,
  separatorMode: 'none',
  caseMode: 'none',
  start: 1,
  step: 1,
  padding: 3,
  sequenceMode: 'padded',
  customSequence: '春,夏,秋,冬',
  customSequenceLoop: true,
  extensionMode: 'keep',
  newExtension: '',
};

const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  includeFiles: true,
  includeFolders: false,
  recursive: false,
  includeHidden: false,
  extensions: '',
};

const PRESETS: RenameRulePreset[] = [
  {
    name: '照片日期编号',
    description: '{date}_{seq}_{name}',
    patch: {
      template: '{date}_{seq}_{name}',
      sequenceMode: 'padded',
      extensionMode: 'lower',
      padding: 3,
      trim: true,
      collapseSpaces: true,
    },
  },
  {
    name: '截图时间序号',
    description: '2026-05-14_153012_001',
    patch: {
      template: '{dateDash}_{time}_{seq}',
      sequenceMode: 'padded',
      extensionMode: 'lower',
      padding: 3,
      trim: true,
      collapseSpaces: true,
    },
  },
  {
    name: '资料归档名',
    description: '日期_文件夹_序号_原名',
    patch: {
      template: '{dateDash}_{parent}_{seq}_{name}',
      sequenceMode: 'padded',
      padding: 3,
      separatorMode: 'underscore',
      trim: true,
      collapseSpaces: true,
    },
  },
  {
    name: '素材统一编号',
    description: '父文件夹_0001',
    patch: {
      template: '{parent}_{seq}',
      sequenceMode: 'padded',
      padding: 4,
      extensionMode: 'lower',
      trim: true,
      collapseSpaces: true,
    },
  },
  {
    name: '网页友好名',
    description: 'lower-case-dash',
    patch: {
      template: '{name}',
      separatorMode: 'dash',
      caseMode: 'lower',
      fullWidthToHalfWidth: true,
      normalizePunctuation: true,
      removeEmoji: true,
      removeDiacritics: true,
      extensionMode: 'lower',
      trim: true,
      collapseSpaces: true,
    },
  },
  {
    name: '文档版本号',
    description: '{name}_v001',
    patch: {
      template: '{name}_v{seq}',
      sequenceMode: 'padded',
      padding: 3,
      trim: true,
      collapseSpaces: true,
    },
  },
  {
    name: '简单数字序列',
    description: '1、2、3、4',
    patch: {
      template: '{seq}_{name}',
      sequenceMode: 'number',
      start: 1,
      step: 1,
      trim: true,
      collapseSpaces: true,
    },
  },
  {
    name: '字母序列',
    description: 'A、B、C、D',
    patch: {
      template: '{seq}_{name}',
      sequenceMode: 'alphaUpper',
      start: 1,
      step: 1,
      trim: true,
      collapseSpaces: true,
    },
  },
  {
    name: '中文序列',
    description: '一、二、三、四',
    patch: {
      template: '{seq}_{name}',
      sequenceMode: 'chinese',
      start: 1,
      step: 1,
      trim: true,
      collapseSpaces: true,
    },
  },
  {
    name: '自定义轮换',
    description: '春夏秋冬/甲乙丙丁',
    patch: {
      template: '{seq}_{name}',
      sequenceMode: 'custom',
      customSequence: '春,夏,秋,冬',
      customSequenceLoop: true,
      trim: true,
      collapseSpaces: true,
    },
  },
  {
    name: '按类型归档',
    description: '图片_日期_序号_原名',
    patch: {
      template: '{type}_{date}_{seq}_{name}',
      sequenceMode: 'padded',
      padding: 3,
      separatorMode: 'underscore',
      extensionMode: 'lower',
      trim: true,
      collapseSpaces: true,
    },
  },
  {
    name: '清理下载名',
    description: '空格/非法字符整理',
    patch: {
      template: '{name}',
      find: '[_-]+',
      replace: ' ',
      useRegex: true,
      regexFlags: 'g',
      trim: true,
      collapseSpaces: true,
      replaceIllegal: true,
      normalizePunctuation: true,
      fullWidthToHalfWidth: true,
    },
  },
  {
    name: '去副本标记',
    description: '(1)、副本、copy',
    patch: {
      find: '',
      replace: '',
      useRegex: false,
      removeDuplicateSuffix: true,
      trim: true,
    },
  },
  {
    name: '扩展名小写',
    description: 'JPG -> jpg',
    patch: {
      template: '{name}',
      extensionMode: 'lower',
    },
  },
];

const TEMPLATE_TOKENS: TemplateToken[] = [
  { token: '{name}', label: '原名', description: '当前文件名，不含扩展名' },
  { token: '{orig}', label: '原始名', description: '未清洗前的文件名' },
  { token: '{seq}', label: '智能序列', description: '按下方序列样式自动填充' },
  { token: '{num}', label: '补零序号', description: '001 / 0001' },
  { token: '{index}', label: '普通序号', description: '1 / 2 / 3' },
  { token: '{date}', label: '日期', description: '20260514' },
  { token: '{dateDash}', label: '横线日期', description: '2026-05-14' },
  { token: '{time}', label: '时间', description: '153012' },
  { token: '{year}', label: '年', description: '2026' },
  { token: '{month}', label: '月', description: '05' },
  { token: '{day}', label: '日', description: '14' },
  { token: '{parent}', label: '父文件夹', description: '所在文件夹名' },
  { token: '{type}', label: '类型', description: '图片 / 文档 / 视频等' },
  { token: '{ext}', label: '扩展名', description: 'jpg / docx' },
  { token: '{size}', label: '大小', description: '1.24MB' },
];
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma']);
const DOC_EXTENSIONS = new Set(['doc', 'docx', 'pdf', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz']);
const CODE_EXTENSIONS = new Set(['js', 'ts', 'tsx', 'jsx', 'rs', 'py', 'java', 'go', 'cpp', 'c', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'yml']);

function loadConfig(): RenameConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<RenameConfig>;
    if (parsed.configVersion !== CONFIG_VERSION) return DEFAULT_CONFIG;

    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      configVersion: CONFIG_VERSION,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function createConfig(patch: Partial<RenameConfig> = {}): RenameConfig {
  return {
    ...DEFAULT_CONFIG,
    ...patch,
    configVersion: CONFIG_VERSION,
  };
}

function pathKey(value: string) {
  return value.replace(/\//g, '\\').toLowerCase();
}

function exactPathKey(value: string) {
  return value.replace(/\//g, '\\');
}

function joinPath(parent: string, name: string) {
  const sep = parent.includes('/') && !parent.includes('\\') ? '/' : '\\';
  return parent.endsWith('/') || parent.endsWith('\\') ? `${parent}${name}` : `${parent}${sep}${name}`;
}

function parentFolderName(parent: string) {
  return parent.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

function formatBytes(value: number) {
  if (!value) return '-';
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function padNumber(value: number, padding: number) {
  return String(value).padStart(Math.max(1, padding), '0');
}

function toAlphabetic(value: number, upper: boolean) {
  const base = upper ? 65 : 97;
  let n = Math.max(1, value);
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(base + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function toRoman(value: number) {
  let n = Math.max(1, Math.min(3999, value));
  const pairs: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [num, roman] of pairs) {
    while (n >= num) {
      out += roman;
      n -= num;
    }
  }
  return out;
}

function toChineseNumber(value: number, formal = false) {
  if (value <= 0 || value > 9999) return String(value);
  const digits = formal ? ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'] : ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const units = formal ? ['', '拾', '佰', '仟'] : ['', '十', '百', '千'];
  const parts = String(value).split('').map(Number).reverse();
  let out = '';
  let zero = false;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const digit = parts[i];
    if (digit === 0) {
      zero = out.length > 0;
      continue;
    }
    if (zero) {
      out += digits[0];
      zero = false;
    }
    out += digits[digit] + units[i];
  }
  if (!formal) out = out.replace(/^一十/, '十');
  return out || digits[0];
}

function parseCustomSequence(value: string) {
  return value
    .split(/[\n,，;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatSequenceValue(order: number, config: RenameConfig) {
  const currentNumber = config.start + order * config.step;
  if (config.sequenceMode === 'number') return String(currentNumber);
  if (config.sequenceMode === 'padded') return padNumber(currentNumber, config.padding);
  if (config.sequenceMode === 'alphaLower') return toAlphabetic(currentNumber, false);
  if (config.sequenceMode === 'alphaUpper') return toAlphabetic(currentNumber, true);
  if (config.sequenceMode === 'chinese') return toChineseNumber(currentNumber);
  if (config.sequenceMode === 'chineseFormal') return toChineseNumber(currentNumber, true);
  if (config.sequenceMode === 'circled') {
    const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
    return circled[currentNumber - 1] || `(${currentNumber})`;
  }
  if (config.sequenceMode === 'romanLower') return toRoman(currentNumber).toLowerCase();
  if (config.sequenceMode === 'romanUpper') return toRoman(currentNumber);
  const values = parseCustomSequence(config.customSequence);
  if (!values.length) return String(currentNumber);
  if (config.customSequenceLoop) return values[order % values.length];
  return values[order] ?? values[values.length - 1] ?? String(currentNumber);
}

function dateParts(timestamp?: number) {
  const d = timestamp ? new Date(timestamp) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return {
    year: String(y),
    month: m,
    day,
    date: `${y}${m}${day}`,
    dateDash: `${y}-${m}-${day}`,
    time: `${h}${min}${s}`,
  };
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/(^|[\s._-])([a-z])/g, (_, prefix: string, ch: string) => `${prefix}${ch.toUpperCase()}`);
}

function sanitizeName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '');
}

function fullWidthToHalfWidth(value: string) {
  return value.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  ).replace(/\u3000/g, ' ');
}

function normalizePunctuation(value: string) {
  return value
    .replace(/[，、；：！？]/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[【】〔〕［］]/g, ' ')
    .replace(/[（）]/g, ' ')
    .replace(/[·•]/g, ' ')
    .replace(/[—–]/g, '-');
}

function removeBracketText(value: string) {
  return value
    .replace(/\s*[\(（\[][^()\[\]（）]{1,40}[\)）\]]\s*/g, ' ')
    .replace(/\s*【[^【】]{1,40}】\s*/g, ' ');
}

function removeDuplicateSuffix(value: string) {
  return value
    .replace(/\s*[-_ ]*(副本|复制|copy)\s*\d*$/i, '')
    .replace(/\s*[\(（](副本|复制|copy|\d+)[\)）]$/i, '')
    .replace(/\s*[-_ ]+副本$/i, '');
}

function removeEmoji(value: string) {
  return value.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '');
}

function removeDiacritics(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function applySeparator(value: string, mode: SeparatorMode) {
  if (mode === 'none') return value;
  const separator = mode === 'space' ? ' ' : mode === 'underscore' ? '_' : mode === 'dash' ? '-' : '.';
  const escaped = separator === '.' ? '\\.' : separator;
  return value
    .replace(/[\s._-]+/g, separator)
    .replace(new RegExp(`${escaped}{2,}`, 'g'), separator)
    .replace(new RegExp(`^${escaped}|${escaped}$`, 'g'), '');
}

function fileTypeLabel(item: RenameItem) {
  if (item.isDir) return '文件夹';
  const ext = item.extension.toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return '图片';
  if (VIDEO_EXTENSIONS.has(ext)) return '视频';
  if (AUDIO_EXTENSIONS.has(ext)) return '音频';
  if (DOC_EXTENSIONS.has(ext)) return '文档';
  if (ARCHIVE_EXTENSIONS.has(ext)) return '压缩包';
  if (CODE_EXTENSIONS.has(ext)) return '代码';
  return ext ? ext.toUpperCase() : '文件';
}

function compactSize(value: number) {
  if (!value) return '0B';
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)}GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

function validateName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '名称不能为空';
  if (/[<>:"/\\|?*\x00-\x1F]/.test(name)) return '包含 Windows 不允许的字符';
  if (/[. ]$/.test(name)) return '不能以空格或点结尾';
  const stem = trimmed.split('.')[0].toUpperCase();
  const reserved = [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9',
  ];
  if (reserved.includes(stem)) return 'Windows 保留名称';
  return '';
}

function normalizeExtension(value: string) {
  return value.trim().replace(/^\.+/, '');
}

function normalizeRegexFlags(value: string) {
  return Array.from(new Set(value.replace(/[^gimsuy]/g, '').split(''))).join('');
}

function applyCase(value: string, mode: CaseMode) {
  if (mode === 'lower') return value.toLowerCase();
  if (mode === 'upper') return value.toUpperCase();
  if (mode === 'title') return titleCase(value);
  return value;
}

function renderTemplateName(item: RenameItem, order: number, config: RenameConfig, currentName: string) {
  const currentNumber = config.start + order * config.step;
  const number = String(currentNumber);
  const num = padNumber(currentNumber, config.padding);
  const seq = formatSequenceValue(order, config);
  const dates = dateParts(item.modified);
  return (config.template || '{name}')
    .replace(/\{name\}/g, currentName)
    .replace(/\{orig\}/g, item.isDir ? item.name : item.stem)
    .replace(/\{ext\}/g, item.extension)
    .replace(/\{seq\}/g, seq)
    .replace(/\{index\}/g, number)
    .replace(/\{num\}/g, num)
    .replace(/\{date\}/g, dates.date)
    .replace(/\{dateDash\}/g, dates.dateDash)
    .replace(/\{time\}/g, dates.time)
    .replace(/\{year\}/g, dates.year)
    .replace(/\{month\}/g, dates.month)
    .replace(/\{day\}/g, dates.day)
    .replace(/\{parent\}/g, parentFolderName(item.parent))
    .replace(/\{type\}/g, fileTypeLabel(item))
    .replace(/\{size\}/g, compactSize(item.size));
}

function applyFindReplace(value: string, config: RenameConfig) {
  if (!config.find) return value;
  if (config.useRegex) {
    const regex = new RegExp(config.find, config.regexFlags || 'g');
    return value.replace(regex, config.replace);
  }
  return value.split(config.find).join(config.replace);
}

function applyRenameRule(item: RenameItem, order: number, config: RenameConfig) {
  let base = item.isDir ? item.name : item.stem;
  if (config.fullWidthToHalfWidth) base = fullWidthToHalfWidth(base);
  if (config.removeBracketText) base = removeBracketText(base);
  if (config.removeDuplicateSuffix) base = removeDuplicateSuffix(base);
  if (config.removeEmoji) base = removeEmoji(base);
  if (config.removeDiacritics) base = removeDiacritics(base);
  if (config.normalizePunctuation) base = normalizePunctuation(base);
  if (config.find) base = applyFindReplace(base, config);
  if (config.template !== '{name}') base = renderTemplateName(item, order, config, base);
  if (config.prefix) base = `${config.prefix}${base}`;
  if (config.suffix) base = `${base}${config.suffix}`;
  if (config.trim) base = base.trim();
  if (config.collapseSpaces) base = base.replace(/\s+/g, ' ');
  if (config.separatorMode !== 'none') base = applySeparator(base, config.separatorMode);
  if (config.caseMode !== 'none') base = applyCase(base, config.caseMode);
  if (config.replaceIllegal) base = sanitizeName(base);

  if (item.isDir) return base;

  let ext = item.extension;
  if (config.extensionMode === 'lower') ext = ext.toLowerCase();
  if (config.extensionMode === 'upper') ext = ext.toUpperCase();
  if (config.extensionMode === 'replace') ext = normalizeExtension(config.newExtension);
  if (config.extensionMode === 'remove') ext = '';
  return ext ? `${base}.${ext}` : base;
}

function insertTokenIntoTemplate(template: string, token: string, position: InsertPosition) {
  const current = template || '{name}';
  if (position === 'replace') return token;
  if (position === 'prepend') return `${token}_${current}`;
  if (position === 'append') return `${current}_${token}`;
  if (position === 'beforeName') {
    return current.includes('{name}') ? current.replace('{name}', `${token}_{name}`) : `${token}_${current}`;
  }
  return current.includes('{name}') ? current.replace('{name}', `{name}_${token}`) : `${current}_${token}`;
}

function getSmartPresets(items: RenameItem[]): RenameRulePreset[] {
  const selected = items.filter((item) => item.selected !== false);
  if (!selected.length) return [];
  const files = selected.filter((item) => !item.isDir);
  const dirs = selected.filter((item) => item.isDir);
  const exts = files.map((item) => item.extension.toLowerCase()).filter(Boolean);
  const allImages = files.length > 0 && files.every((item) => IMAGE_EXTENSIONS.has(item.extension.toLowerCase()));
  const allDocs = files.length > 0 && files.every((item) => DOC_EXTENSIONS.has(item.extension.toLowerCase()));
  const mixedExtCase = exts.some((ext) => ext !== ext.toLowerCase());
  const hasMessyNames = selected.some((item) =>
    /副本|复制|copy|\(\d+\)|（\d+）|[_-]{2,}|\s{2,}|[\uFF01-\uFF5E\u3000]|[\p{Extended_Pictographic}]/iu.test(
      item.isDir ? item.name : item.stem,
    ),
  );
  const hasManySameParent = new Set(selected.map((item) => pathKey(item.parent))).size <= Math.max(1, Math.ceil(selected.length / 3));

  const suggestions: RenameRulePreset[] = [];
  if (allImages) {
    suggestions.push({
      name: '智能：照片整理',
      description: '日期_序号_原名，扩展名小写',
      patch: {
        template: '{date}_{seq}_{name}',
        sequenceMode: 'padded',
        padding: selected.length >= 1000 ? 4 : 3,
        extensionMode: 'lower',
        separatorMode: 'underscore',
        trim: true,
        collapseSpaces: true,
      },
    });
  }
  if (allDocs) {
    suggestions.push({
      name: '智能：文档归档',
      description: '日期_父目录_序号_原名',
      patch: {
        template: '{dateDash}_{parent}_{seq}_{name}',
        sequenceMode: 'padded',
        padding: selected.length >= 1000 ? 4 : 3,
        separatorMode: 'underscore',
        trim: true,
        collapseSpaces: true,
      },
    });
  }
  if (hasMessyNames) {
    suggestions.push({
      name: '智能：清洗杂乱名',
      description: '去副本、括号、emoji、全角符号',
      patch: {
        template: '{name}',
        removeDuplicateSuffix: true,
        removeBracketText: true,
        removeEmoji: true,
        fullWidthToHalfWidth: true,
        normalizePunctuation: true,
        trim: true,
        collapseSpaces: true,
        replaceIllegal: true,
      },
    });
  }
  if (mixedExtCase) {
    suggestions.push({
      name: '智能：扩展名统一',
      description: '全部扩展名转小写',
      patch: {
        extensionMode: 'lower',
      },
    });
  }
  if (hasManySameParent && selected.length >= 5) {
    suggestions.push({
      name: '智能：批量编号',
      description: '父目录_0001',
      patch: {
        template: '{parent}_{seq}',
        sequenceMode: 'padded',
        padding: selected.length >= 1000 ? 4 : 3,
        separatorMode: 'underscore',
        trim: true,
        collapseSpaces: true,
      },
    });
  }
  if (dirs.length > 0 && files.length === 0) {
    suggestions.push({
      name: '智能：文件夹规范',
      description: '标题式 + 清理符号',
      patch: {
        template: '{name}',
        removeDuplicateSuffix: true,
        fullWidthToHalfWidth: true,
        normalizePunctuation: true,
        trim: true,
        collapseSpaces: true,
        replaceIllegal: true,
      },
    });
  }

  return suggestions.slice(0, 4);
}

export default function FileRenameTool() {
  const ready = useToolTheme();
  const [items, setItems] = useState<RenameItem[]>([]);
  const [config, setConfig] = useState<RenameConfig>(loadConfig);
  const [scanOptions, setScanOptions] = useState<ScanOptions>(DEFAULT_SCAN_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [message, setMessage] = useState('');
  const [previewQuery, setPreviewQuery] = useState('');
  const [insertPosition, setInsertPosition] = useState<InsertPosition>('append');

  useEffect(() => {
    if (config.configVersion !== CONFIG_VERSION) {
      setConfig(DEFAULT_CONFIG);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  function updateConfig(patch: Partial<RenameConfig>) {
    setConfig((prev) => ({ ...prev, ...patch }));
  }

  function applyPreset(patch: Partial<RenameConfig>) {
    setConfig(createConfig(patch));
  }

  function updateScanOptions(patch: Partial<ScanOptions>) {
    setScanOptions((prev) => ({ ...prev, ...patch }));
  }

  async function addPaths(paths: string[]) {
    const unique = paths.filter(Boolean);
    if (unique.length === 0) return;
    setLoading(true);
    setMessage('');
    try {
      const result = await invoke<{ items: RenameItem[] }>('file_rename_inspect_paths', {
        paths: unique,
      });
      setItems((prev) => {
        const map = new Map(prev.map((item) => [pathKey(item.path), item]));
        for (const item of result.items) {
          map.set(pathKey(item.path), { ...item, selected: true });
        }
        return Array.from(map.values());
      });
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  async function selectFiles() {
    const selected = await open({ multiple: true, directory: false });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    await addPaths(paths as string[]);
  }

  async function selectFolders() {
    const selected = await open({ multiple: true, directory: true });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    await addPaths(paths as string[]);
  }

  async function scanFolder() {
    const selected = await open({ multiple: false, directory: true });
    if (!selected || Array.isArray(selected)) return;
    setLoading(true);
    setMessage('');
    try {
      const result = await invoke<{ items: RenameItem[] }>('file_rename_scan_dir', {
        root: selected,
        options: {
          includeFiles: scanOptions.includeFiles,
          includeFolders: scanOptions.includeFolders,
          recursive: scanOptions.recursive,
          includeHidden: scanOptions.includeHidden,
          extensions: scanOptions.extensions
            .split(/[,\s;，；]+/)
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      setItems((prev) => {
        const map = new Map(prev.map((item) => [pathKey(item.path), item]));
        for (const item of result.items) {
          map.set(pathKey(item.path), { ...item, selected: true });
        }
        return Array.from(map.values());
      });
      setMessage(`已扫描 ${result.items.length} 个项目`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter(Boolean) as string[];
    addPaths(paths);
  }

  const preview = useMemo<PreviewRow[]>(() => {
    let regexError = '';
    if (config.find && config.useRegex) {
      try {
        new RegExp(config.find, config.regexFlags || 'g');
      } catch (error) {
        regexError = String(error);
      }
    }

    const selectedItems = items.filter((item) => item.selected !== false);
    const sourceKeys = new Set(selectedItems.map((item) => pathKey(item.path)));
    const rows = selectedItems.map((item, index) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      let newName = item.name;
      if (regexError) {
        errors.push(`正则错误: ${regexError}`);
      } else {
        try {
          newName = applyRenameRule(item, index, config);
        } catch (error) {
          errors.push(String(error));
        }
      }
      const nameError = validateName(newName);
      if (nameError) errors.push(nameError);
      const targetPath = joinPath(item.parent, newName);
      const changed = exactPathKey(targetPath) !== exactPathKey(item.path);
      if (!changed) warnings.push('名称未变化');
      return { item, index, newName, targetPath, changed, errors, warnings };
    });

    const targetGroups = new Map<string, PreviewRow[]>();
    for (const row of rows) {
      const key = pathKey(row.targetPath);
      targetGroups.set(key, [...(targetGroups.get(key) ?? []), row]);
    }
    for (const group of targetGroups.values()) {
      if (group.length > 1) {
        group.forEach((row) => row.errors.push('目标名称重复'));
      }
    }

    const itemBySource = new Map(rows.map((row) => [pathKey(row.item.path), row]));
    for (const row of rows) {
      const targetKey = pathKey(row.targetPath);
      const targetSourceRow = itemBySource.get(targetKey);
      if (targetSourceRow && targetSourceRow.item.path !== row.item.path && !targetSourceRow.changed) {
        row.errors.push('目标被未改名项目占用');
      }
      if (!sourceKeys.has(targetKey)) {
        const existing = items.find(
          (item) => pathKey(item.path) === targetKey && item.selected === false,
        );
        if (existing) row.errors.push('目标与列表中未选择项目同名');
      }
    }

    for (const row of rows.filter((value) => value.item.isDir && value.changed)) {
      const folderKey = pathKey(row.item.path);
      for (const other of rows) {
        if (other.item.path !== row.item.path && pathKey(other.item.path).startsWith(`${folderKey}\\`)) {
          row.errors.push('同批包含此文件夹内部项目');
          break;
        }
      }
    }

    return rows;
  }, [config, items]);

  const filteredPreview = useMemo(() => {
    const query = previewQuery.trim().toLowerCase();
    if (!query) return preview;
    return preview.filter((row) =>
      [row.item.name, row.newName, row.item.parent, row.item.path]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [preview, previewQuery]);

  const smartPresets = useMemo(() => getSmartPresets(items), [items]);

  const stats = useMemo(() => {
    const errors = preview.filter((row) => row.errors.length > 0).length;
    const changed = preview.filter((row) => row.changed && row.errors.length === 0).length;
    const unchanged = preview.filter((row) => !row.changed).length;
    return {
      total: preview.length,
      files: preview.filter((row) => !row.item.isDir).length,
      folders: preview.filter((row) => row.item.isDir).length,
      changed,
      unchanged,
      errors,
    };
  }, [preview]);

  async function applyRename() {
    if (stats.errors > 0) {
      setMessage('请先处理预览中的错误后再执行');
      return;
    }
    const operations = preview
      .filter((row) => row.changed)
      .map((row) => ({ sourcePath: row.item.path, targetPath: row.targetPath }));
    if (operations.length === 0) {
      setMessage('没有需要重命名的项目');
      return;
    }
    if (!window.confirm(`确认重命名 ${operations.length} 个项目？此操作会直接修改本地文件名。`)) {
      return;
    }

    setExecuting(true);
    setMessage('');
    try {
      const result = await invoke<{ renamed: number; items: { sourcePath: string; targetPath: string }[] }>(
        'file_rename_apply',
        { operations },
      );
      const sourceSet = new Set(result.items.map((item) => pathKey(item.sourcePath)));
      const targetPaths = result.items.map((item) => item.targetPath);
      const inspected = await invoke<{ items: RenameItem[] }>('file_rename_inspect_paths', {
        paths: targetPaths,
      });
      setItems((prev) => [
        ...prev.filter((item) => !sourceSet.has(pathKey(item.path))),
        ...inspected.items.map((item) => ({ ...item, selected: true })),
      ]);
      setMessage(`已完成 ${result.renamed} 个项目重命名`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setExecuting(false);
    }
  }

  function copyPreview() {
    const text = preview
      .map((row) => `${row.item.path}\t=>\t${row.targetPath}${row.errors.length ? `\t错误: ${row.errors.join('; ')}` : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
    setMessage('预览结果已复制');
  }

  function removeSelected() {
    setItems((prev) => prev.filter((item) => item.selected === false));
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-white">
      <ToolHeader title="批量重命名" icon="🗂️" subtitle="文件/文件夹批量改名，支持模板、序号、扩展名和正则替换" />

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <aside className="flex w-full flex-shrink-0 flex-col overflow-y-auto border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 lg:w-[390px] lg:border-b-0 lg:border-r">
          <section className="border-b border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
              <Upload size={16} />
              导入对象
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={selectFiles}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
              >
                <FileIcon size={15} />
                添加文件
              </button>
              <button
                onClick={selectFolders}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                <Folder size={15} />
                添加文件夹
              </button>
            </div>
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
              <button
                onClick={scanFolder}
                disabled={loading}
                className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <FolderOpen size={15} />
                {loading ? '读取中...' : '扫描文件夹内容'}
              </button>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={scanOptions.includeFiles}
                    onChange={(e) => updateScanOptions({ includeFiles: e.target.checked })}
                  />
                  文件
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={scanOptions.includeFolders}
                    onChange={(e) => updateScanOptions({ includeFolders: e.target.checked })}
                  />
                  文件夹
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={scanOptions.recursive}
                    onChange={(e) => updateScanOptions({ recursive: e.target.checked })}
                  />
                  包含子目录
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={scanOptions.includeHidden}
                    onChange={(e) => updateScanOptions({ includeHidden: e.target.checked })}
                  />
                  隐藏项目
                </label>
              </div>
              <input
                value={scanOptions.extensions}
                onChange={(e) => updateScanOptions({ extensions: e.target.value })}
                placeholder="扩展名过滤：jpg,png,docx"
                className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800"
              />
            </div>
            <div className="mt-2 text-[11px] text-gray-400">也可以把文件或文件夹直接拖到窗口里。</div>
          </section>

          <section className="border-b border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
              <Settings2 size={16} />
              改名规则
            </div>

            {smartPresets.length > 0 && (
              <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900/60 dark:bg-blue-900/20">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  <Sparkles size={14} />
                  智能建议
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {smartPresets.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => applyPreset(preset.patch)}
                      title={preset.description}
                      className="rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-blue-700 hover:border-blue-300 hover:bg-blue-50 dark:border-blue-900/60 dark:bg-gray-900 dark:text-blue-300 dark:hover:bg-blue-900/30"
                    >
                      {preset.name.replace(/^智能：/, '')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="mb-3 block">
              <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">快速方案</div>
              <select
                value=""
                onChange={(event) => {
                  const preset = PRESETS.find((item) => item.name === event.target.value);
                  if (preset) applyPreset(preset.patch);
                }}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="">选择常用方案...</option>
                {PRESETS.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name} - {preset.description}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">模板</div>
              <input
                value={config.template}
                onChange={(e) => updateConfig({ template: e.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                placeholder="{name}_{num}"
              />
            </label>
            <div className="mt-1 text-[11px] leading-relaxed text-gray-400">
              可用：{'{name}'} {'{orig}'} {'{seq}'} {'{num}'} {'{index}'} {'{date}'} {'{dateDash}'} {'{time}'} {'{parent}'} {'{type}'}
            </div>
            <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2">
              <span className="text-[11px] text-gray-500">插入位置</span>
              <select
                value={insertPosition}
                onChange={(e) => setInsertPosition(e.target.value as InsertPosition)}
                className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              >
                {(Object.keys(INSERT_POSITION_LABELS) as InsertPosition[]).map((position) => (
                  <option key={position} value={position}>
                    {INSERT_POSITION_LABELS[position]}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TEMPLATE_TOKENS.map((token) => (
                <button
                  key={token.token}
                  onClick={() =>
                    updateConfig({
                      template: insertTokenIntoTemplate(config.template, token.token, insertPosition),
                    })
                  }
                  title={token.description}
                  className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-[10px] text-gray-500 hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                >
                  {token.label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label>
                <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">前缀</div>
                <input
                  value={config.prefix}
                  onChange={(e) => updateConfig({ prefix: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                />
              </label>
              <label>
                <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">后缀</div>
                <input
                  value={config.suffix}
                  onChange={(e) => updateConfig({ suffix: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                />
              </label>
            </div>

            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">查找替换</span>
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  <input
                    type="checkbox"
                    checked={config.useRegex}
                    onChange={(e) => updateConfig({ useRegex: e.target.checked })}
                  />
                  正则
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={config.find}
                  onChange={(e) => updateConfig({ find: e.target.value })}
                  placeholder={config.useRegex ? '正则表达式' : '查找文本'}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800"
                />
                <input
                  value={config.replace}
                  onChange={(e) => updateConfig({ replace: e.target.value })}
                  placeholder="替换为"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800"
                />
              </div>
              {config.useRegex && (
                <input
                  value={config.regexFlags}
                  onChange={(e) => updateConfig({ regexFlags: normalizeRegexFlags(e.target.value) })}
                  placeholder="flags: g/i/m"
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800"
                />
              )}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <label>
                <div className="mb-1 text-xs text-gray-500">起始</div>
                <input
                  type="number"
                  value={config.start}
                  onChange={(e) => updateConfig({ start: Number(e.target.value) || 1 })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-gray-700 dark:bg-gray-900"
                />
              </label>
              <label>
                <div className="mb-1 text-xs text-gray-500">步长</div>
                <input
                  type="number"
                  value={config.step}
                  onChange={(e) => updateConfig({ step: Number(e.target.value) || 1 })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-gray-700 dark:bg-gray-900"
                />
              </label>
              <label>
                <div className="mb-1 text-xs text-gray-500">补零</div>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={config.padding}
                  onChange={(e) => updateConfig({ padding: Number(e.target.value) || 1 })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-gray-700 dark:bg-gray-900"
                />
              </label>
            </div>

            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">智能序列 {'{seq}'}</span>
                <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-400 dark:bg-gray-800">
                  示例：{[0, 1, 2, 3].map((idx) => formatSequenceValue(idx, config)).join(' / ')}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={config.sequenceMode}
                  onChange={(e) => updateConfig({ sequenceMode: e.target.value as SequenceMode })}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"
                >
                  <option value="number">数字 1,2,3</option>
                  <option value="padded">补零 001,002</option>
                  <option value="alphaUpper">大写字母 A,B,C</option>
                  <option value="alphaLower">小写字母 a,b,c</option>
                  <option value="chinese">中文 一,二,三</option>
                  <option value="chineseFormal">大写中文 壹,贰,叁</option>
                  <option value="circled">圈号 ①,②,③</option>
                  <option value="romanUpper">罗马 I,II,III</option>
                  <option value="romanLower">小写罗马 i,ii,iii</option>
                  <option value="custom">自定义列表</option>
                </select>
                <button
                  onClick={() =>
                    updateConfig({
                      template: config.template.includes('{seq}')
                        ? config.template
                        : insertTokenIntoTemplate(config.template, '{seq}', insertPosition),
                    })
                  }
                  className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs text-gray-600 hover:bg-blue-50 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  插入智能序列
                </button>
              </div>
              {config.sequenceMode === 'custom' && (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={config.customSequence}
                    onChange={(e) => updateConfig({ customSequence: e.target.value })}
                    rows={2}
                    placeholder="每项用逗号/换行分隔，例如：甲,乙,丙,丁"
                    className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800"
                  />
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={config.customSequenceLoop}
                      onChange={(e) => updateConfig({ customSequenceLoop: e.target.checked })}
                    />
                    自定义列表用完后循环填充
                  </label>
                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label>
                <div className="mb-1 text-xs text-gray-500">大小写</div>
                <select
                  value={config.caseMode}
                  onChange={(e) => updateConfig({ caseMode: e.target.value as CaseMode })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="none">不处理</option>
                  <option value="lower">全部小写</option>
                  <option value="upper">全部大写</option>
                  <option value="title">英文标题式</option>
                </select>
              </label>
              <label>
                <div className="mb-1 text-xs text-gray-500">扩展名</div>
                <select
                  value={config.extensionMode}
                  onChange={(e) => updateConfig({ extensionMode: e.target.value as ExtensionMode })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="keep">保持</option>
                  <option value="lower">转小写</option>
                  <option value="upper">转大写</option>
                  <option value="replace">替换为</option>
                  <option value="remove">移除</option>
                </select>
              </label>
              <label>
                <div className="mb-1 text-xs text-gray-500">分隔符</div>
                <select
                  value={config.separatorMode}
                  onChange={(e) => updateConfig({ separatorMode: e.target.value as SeparatorMode })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="none">不统一</option>
                  <option value="space">空格</option>
                  <option value="underscore">下划线 _</option>
                  <option value="dash">短横线 -</option>
                  <option value="dot">点号 .</option>
                </select>
              </label>
            </div>
            {config.extensionMode === 'replace' && (
              <input
                value={config.newExtension}
                onChange={(e) => updateConfig({ newExtension: e.target.value })}
                placeholder="新扩展名，例如 jpg"
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
              />
            )}

            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-gray-600 dark:text-gray-300">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.fullWidthToHalfWidth}
                    onChange={(e) => updateConfig({ fullWidthToHalfWidth: e.target.checked })}
                  />
                  全角转半角
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.normalizePunctuation}
                    onChange={(e) => updateConfig({ normalizePunctuation: e.target.checked })}
                  />
                  规范标点
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.removeDuplicateSuffix}
                    onChange={(e) => updateConfig({ removeDuplicateSuffix: e.target.checked })}
                  />
                  去副本标记
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.removeBracketText}
                    onChange={(e) => updateConfig({ removeBracketText: e.target.checked })}
                  />
                  去括号内容
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.removeEmoji}
                    onChange={(e) => updateConfig({ removeEmoji: e.target.checked })}
                  />
                  去 emoji
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.removeDiacritics}
                    onChange={(e) => updateConfig({ removeDiacritics: e.target.checked })}
                  />
                  去音调符号
                </label>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.trim}
                  onChange={(e) => updateConfig({ trim: e.target.checked })}
                />
                去除首尾空格
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.collapseSpaces}
                  onChange={(e) => updateConfig({ collapseSpaces: e.target.checked })}
                />
                合并连续空白
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.replaceIllegal}
                  onChange={(e) => updateConfig({ replaceIllegal: e.target.checked })}
                />
                自动替换非法字符
              </label>
            </div>
          </section>

          <section className="p-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={applyRename}
                disabled={executing || stats.changed === 0 || stats.errors > 0}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play size={15} />
                {executing ? '执行中...' : '执行重命名'}
              </button>
              <button
                onClick={() => setConfig(createConfig())}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <ListRestart size={15} />
                重置规则
              </button>
              <button
                onClick={removeSelected}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Eraser size={15} />
                移除选中
              </button>
              <button
                onClick={() => setItems([])}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:bg-gray-900 dark:hover:bg-red-900/20"
              >
                <Trash2 size={15} />
                清空列表
              </button>
            </div>
            {message && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                {message}
              </div>
            )}
          </section>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-6">
              <Stat label="总数" value={stats.total} />
              <Stat label="文件" value={stats.files} />
              <Stat label="文件夹" value={stats.folders} />
              <Stat label="将修改" value={stats.changed} tone="green" />
              <Stat label="未变化" value={stats.unchanged} />
              <Stat label="错误" value={stats.errors} tone={stats.errors ? 'red' : 'gray'} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[260px] flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={previewQuery}
                  onChange={(e) => setPreviewQuery(e.target.value)}
                  placeholder="搜索原名称、新名称、路径..."
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
              <button
                onClick={copyPreview}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Copy size={15} />
                复制预览
              </button>
              <button
                onClick={() => setItems((prev) => prev.map((item) => ({ ...item, selected: true })))}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <RefreshCw size={15} />
                全选
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
                <FolderOpen size={46} className="text-gray-300 dark:text-gray-700" />
                <div className="text-sm">选择文件、文件夹，或扫描一个目录后开始预览</div>
              </div>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={items.length > 0 && items.every((item) => item.selected !== false)}
                        onChange={(e) =>
                          setItems((prev) => prev.map((item) => ({ ...item, selected: e.target.checked })))
                        }
                      />
                    </th>
                    <th className="px-3 py-2">原名称</th>
                    <th className="px-3 py-2">新名称</th>
                    <th className="px-3 py-2">位置</th>
                    <th className="px-3 py-2">大小</th>
                    <th className="px-3 py-2">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-950">
                  {filteredPreview.map((row) => (
                    <tr key={row.item.path} className={row.errors.length ? 'bg-red-50/60 dark:bg-red-900/10' : ''}>
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={row.item.selected !== false}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((item) =>
                                item.path === row.item.path ? { ...item, selected: e.target.checked } : item,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="max-w-[280px] px-3 py-2 align-top">
                        <div className="flex items-start gap-2">
                          {row.item.isDir ? (
                            <Folder size={15} className="mt-0.5 flex-shrink-0 text-amber-500" />
                          ) : (
                            <FileIcon size={15} className="mt-0.5 flex-shrink-0 text-blue-500" />
                          )}
                          <div className="min-w-0">
                            <div className="break-words font-medium text-gray-800 dark:text-gray-100">{row.item.name}</div>
                            <div className="mt-0.5 text-[11px] text-gray-400">{row.item.isDir ? '文件夹' : row.item.extension || '无扩展名'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[320px] px-3 py-2 align-top">
                        <div className={`break-words font-medium ${row.changed ? 'text-green-700 dark:text-green-300' : 'text-gray-400'}`}>
                          {row.newName}
                        </div>
                      </td>
                      <td className="max-w-[320px] px-3 py-2 align-top">
                        <div className="break-all text-xs text-gray-500 dark:text-gray-400" title={row.item.parent}>
                          {row.item.parent}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-500">{formatBytes(row.item.size)}</td>
                      <td className="min-w-[180px] px-3 py-2 align-top">
                        {row.errors.length > 0 ? (
                          <div className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-300">
                            <XCircle size={14} className="mt-0.5 flex-shrink-0" />
                            <span>{row.errors.join('；')}</span>
                          </div>
                        ) : row.changed ? (
                          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-300">
                            <CheckCircle2 size={14} />
                            可执行
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-gray-400">
                            <AlertTriangle size={14} />
                            {row.warnings[0] ?? '未变化'}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray' | 'green' | 'red' }) {
  const toneClass =
    tone === 'green'
      ? 'text-green-700 dark:text-green-300'
      : tone === 'red'
        ? 'text-red-600 dark:text-red-300'
        : 'text-gray-800 dark:text-gray-100';
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
