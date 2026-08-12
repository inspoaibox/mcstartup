import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  AlertTriangle,
  Camera,
  Copy,
  Database,
  Download,
  Edit3,
  Eraser,
  Info,
  MapPin,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import { copyImageToClipboard, fileToBase64, useClipboardPaste } from './useImageInput';

interface ExifField {
  tag: string;
  label?: string;
  value: string;
  rawText?: string;
  valueType?: string;
  ifd?: string;
  context?: string;
  code?: string;
  group?: string;
  privacy?: boolean;
  normalizedValue?: string | number;
}

interface ExifSummaryItem {
  label: string;
  value: string;
  group: string;
  source: string;
  privacy?: boolean;
}

interface ExifImageInfo {
  format: string;
  mime: string;
  width: number;
  height: number;
  megapixels: number;
  colorType: string;
  colorTypeRaw: string;
  bitsPerPixel: number;
  channelCount: number;
  hasAlpha: boolean;
  fileSize: number;
}

interface ExifGpsInfo {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  display: string;
  mapUrl: string;
}

interface ExifReadResult {
  image?: ExifImageInfo | null;
  summary?: ExifSummaryItem[];
  fields: ExifField[];
  gps?: ExifGpsInfo | null;
  warnings?: string[];
}

interface ExifToolStatus {
  installed: boolean;
  version?: string;
  path?: string;
  installHint?: string;
}

interface ExifEditValues {
  make: string;
  model: string;
  lensModel: string;
  artist: string;
  copyright: string;
  software: string;
  dateTimeOriginal: string;
  imageDescription: string;
  userComment: string;
  latitude: string;
  longitude: string;
  altitude: string;
}

interface ExifEdit {
  tag: string;
  value?: string | null;
}

const PRIVACY_TAGS = ['GPS', 'MakerNote', 'SerialNumber', 'UserComment'];
const GROUP_ORDER = ['图片信息', '相机信息', '拍摄参数', '时间信息', 'GPS 位置', '其他'];
const SUMMARY_ORDER = ['图片信息', '相机信息', '拍摄参数', '时间信息', 'GPS 位置'];

const EMPTY_EDIT_VALUES: ExifEditValues = {
  make: '',
  model: '',
  lensModel: '',
  artist: '',
  copyright: '',
  software: '',
  dateTimeOriginal: '',
  imageDescription: '',
  userComment: '',
  latitude: '',
  longitude: '',
  altitude: '',
};

const TEXT_EDIT_FIELDS: Array<{
  key: keyof ExifEditValues;
  tag: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  { key: 'make', tag: 'Make', label: '设备厂商', placeholder: 'Apple / Canon / Sony' },
  { key: 'model', tag: 'Model', label: '设备型号', placeholder: 'iPhone / EOS / Alpha' },
  { key: 'lensModel', tag: 'LensModel', label: '镜头型号', placeholder: '镜头型号' },
  { key: 'software', tag: 'Software', label: '处理软件', placeholder: 'Adobe / McStartUP' },
  { key: 'artist', tag: 'Artist', label: '作者', placeholder: '作者 / 摄影师' },
  { key: 'copyright', tag: 'Copyright', label: '版权', placeholder: 'Copyright 2026 ...' },
  { key: 'dateTimeOriginal', tag: 'DateTimeOriginal', label: '拍摄时间', placeholder: '2026:05:13 14:30:00' },
  { key: 'imageDescription', tag: 'ImageDescription', label: '图片描述', placeholder: '图片描述', multiline: true },
  { key: 'userComment', tag: 'UserComment', label: '用户备注', placeholder: '备注信息', multiline: true },
];

const GPS_EDIT_FIELDS: Array<{
  key: keyof ExifEditValues;
  tag: string;
  label: string;
  placeholder: string;
}> = [
  { key: 'latitude', tag: 'GPSLatitude', label: 'GPS 纬度', placeholder: '31.230416 或 -33.868820' },
  { key: 'longitude', tag: 'GPSLongitude', label: 'GPS 经度', placeholder: '121.473701 或 -151.209290' },
  { key: 'altitude', tag: 'GPSAltitude', label: 'GPS 海拔', placeholder: '12.5，负数表示海平面以下' },
];

const GROUP_COLORS: Record<string, string> = {
  图片信息: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
  相机信息: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20',
  拍摄参数: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
  时间信息: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
  'GPS 位置': 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
  其他: 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800',
};

function groupFields(fields: ExifField[]) {
  const groups: Record<string, ExifField[]> = {};
  for (const field of fields) {
    const group = field.group ?? '其他';
    if (!groups[group]) groups[group] = [];
    groups[group].push(field);
  }

  const ordered: [string, ExifField[]][] = [];
  for (const group of GROUP_ORDER) {
    if (groups[group]) ordered.push([group, groups[group]]);
  }
  for (const group of Object.keys(groups)) {
    if (!GROUP_ORDER.includes(group)) ordered.push([group, groups[group]]);
  }
  return ordered;
}

function groupSummary(items: ExifSummaryItem[]) {
  const groups: Record<string, ExifSummaryItem[]> = {};
  for (const item of items) {
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  }

  const ordered: [string, ExifSummaryItem[]][] = [];
  for (const group of SUMMARY_ORDER) {
    if (groups[group]) ordered.push([group, groups[group]]);
  }
  for (const group of Object.keys(groups)) {
    if (!SUMMARY_ORDER.includes(group)) ordered.push([group, groups[group]]);
  }
  return ordered;
}

function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  return (n / 1024).toFixed(1) + ' KB';
}

function formatRawValue(field: ExifField) {
  if (field.rawText && field.rawText !== field.value) return field.rawText;
  if (field.normalizedValue !== undefined && field.normalizedValue !== null) {
    return String(field.normalizedValue);
  }
  return '';
}

function fieldMatchesQuery(field: ExifField, query: string) {
  const haystack = [
    field.tag,
    field.label,
    field.value,
    field.rawText,
    field.valueType,
    field.ifd,
    field.context,
    field.code,
    field.group,
    field.normalizedValue,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function findExifValue(fields: ExifField[], tag: string) {
  const exact = fields.find((field) => field.tag === tag);
  if (exact) return String(exact.normalizedValue ?? exact.rawText ?? exact.value ?? '').trim();
  const lower = tag.toLowerCase();
  const loose = fields.find((field) => field.tag.toLowerCase() === lower);
  return loose ? String(loose.normalizedValue ?? loose.rawText ?? loose.value ?? '').trim() : '';
}

function editValuesFromExif(fields: ExifField[], gps?: ExifGpsInfo | null): ExifEditValues {
  return {
    make: findExifValue(fields, 'Make'),
    model: findExifValue(fields, 'Model'),
    lensModel: findExifValue(fields, 'LensModel'),
    artist: findExifValue(fields, 'Artist'),
    copyright: findExifValue(fields, 'Copyright'),
    software: findExifValue(fields, 'Software'),
    dateTimeOriginal: findExifValue(fields, 'DateTimeOriginal'),
    imageDescription: findExifValue(fields, 'ImageDescription'),
    userComment: findExifValue(fields, 'UserComment'),
    latitude: gps?.latitude !== undefined ? String(gps.latitude) : findExifValue(fields, 'GPSLatitude'),
    longitude: gps?.longitude !== undefined ? String(gps.longitude) : findExifValue(fields, 'GPSLongitude'),
    altitude:
      gps?.altitude !== undefined && gps?.altitude !== null
        ? String(gps.altitude)
        : findExifValue(fields, 'GPSAltitude'),
  };
}

function normalizeEditValue(value: string) {
  return value.trim();
}

function buildChangedEdits(current: ExifEditValues, original: ExifEditValues): ExifEdit[] {
  const edits: ExifEdit[] = [];
  for (const field of [...TEXT_EDIT_FIELDS, ...GPS_EDIT_FIELDS]) {
    const next = normalizeEditValue(current[field.key]);
    const prev = normalizeEditValue(original[field.key]);
    if (next !== prev) {
      edits.push({ tag: field.tag, value: next || null });
    }
  }
  return edits;
}

function baseName(name: string) {
  return (name || 'image').replace(/\.[^.]+$/, '');
}

function fileExt(name: string) {
  return name.includes('.') ? name.split('.').pop() || 'jpg' : 'jpg';
}

export default function ImageExifTool() {
  useToolTheme();
  const [origB64, setOrigB64] = useState('');
  const [fileName, setFileName] = useState('');
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);
  const [fileSize, setFileSize] = useState(0);
  const [fields, setFields] = useState<ExifField[]>([]);
  const [summary, setSummary] = useState<ExifSummaryItem[]>([]);
  const [imageInfo, setImageInfo] = useState<ExifImageInfo | null>(null);
  const [gpsInfo, setGpsInfo] = useState<ExifGpsInfo | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [stripping, setStripping] = useState(false);
  const [savingExif, setSavingExif] = useState(false);
  const [strippedB64, setStrippedB64] = useState('');
  const [editedB64, setEditedB64] = useState('');
  const [exifTool, setExifTool] = useState<ExifToolStatus | null>(null);
  const [checkingExifTool, setCheckingExifTool] = useState(false);
  const [editValues, setEditValues] = useState<ExifEditValues>(EMPTY_EDIT_VALUES);
  const [originalEditValues, setOriginalEditValues] = useState<ExifEditValues>(EMPTY_EDIT_VALUES);
  const [editError, setEditError] = useState('');
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [copiedResult, setCopiedResult] = useState(false);
  const [copiedEditedResult, setCopiedEditedResult] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingExif, setEditingExif] = useState(false);

  useEffect(() => {
    checkExifTool();
  }, []);

  async function checkExifTool() {
    setCheckingExifTool(true);
    try {
      const status = await invoke<ExifToolStatus>('image_exiftool_status');
      setExifTool(status);
    } catch (e) {
      setExifTool({
        installed: false,
        installHint:
          '安装 ExifTool 后重新检测：winget install OliverBetz.ExifTool，或下载后重命名为 exiftool.exe 并加入 PATH',
      });
    } finally {
      setCheckingExifTool(false);
    }
  }

  async function loadImage(b64: string, name?: string, size?: number) {
    setOrigB64(b64);
    setFileName(name ?? '图片');
    setFileSize(size ?? 0);
    setFields([]);
    setSummary([]);
    setImageInfo(null);
    setGpsInfo(null);
    setWarnings([]);
    setStrippedB64('');
    setEditedB64('');
    setEditValues(EMPTY_EDIT_VALUES);
    setOriginalEditValues(EMPTY_EDIT_VALUES);
    setEditError('');
    setSearchQuery('');
    setEditingExif(false);

    const img = new Image();
    img.onload = () => {
      setImgW(img.width);
      setImgH(img.height);
    };
    img.src = b64;

    setLoading(true);
    try {
      const result = await invoke<ExifReadResult>('image_read_exif', { data: b64 });
      const nextFields = result.fields ?? [];
      const nextGps = result.gps ?? null;
      const nextEditValues = editValuesFromExif(nextFields, nextGps);
      setFields(nextFields);
      setSummary(result.summary ?? []);
      setImageInfo(result.image ?? null);
      setGpsInfo(nextGps);
      setWarnings(result.warnings ?? []);
      setEditValues(nextEditValues);
      setOriginalEditValues(nextEditValues);
    } catch (e) {
      console.error('EXIF 读取失败:', e);
      setFields([]);
      setSummary([]);
      setImageInfo(null);
      setGpsInfo(null);
      setWarnings([String(e)]);
      setEditValues(EMPTY_EDIT_VALUES);
      setOriginalEditValues(EMPTY_EDIT_VALUES);
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(f: File) {
    if (!f.type.startsWith('image/')) return;
    const b64 = await fileToBase64(f);
    loadImage(b64, f.name, f.size);
  }

  useClipboardPaste((b64, file) => loadImage(b64, file?.name, file?.size));

  async function stripExif() {
    if (!origB64) return;
    setStripping(true);
    try {
      const result = await invoke<string>('image_strip_exif', { data: origB64 });
      setStrippedB64(result);
    } catch (e) {
      console.error('清除 EXIF 失败:', e);
    } finally {
      setStripping(false);
    }
  }

  function downloadStripped() {
    if (!strippedB64) return;
    const a = document.createElement('a');
    a.href = strippedB64;
    const ext = fileExt(fileName);
    a.download = `${baseName(fileName)}_no_exif.${ext}`;
    a.click();
  }

  async function applyExifEdits(edits: ExifEdit[]) {
    if (!origB64 || edits.length === 0) return;
    setSavingExif(true);
    setEditError('');
    try {
      const result = await invoke<string>('image_exif_apply_edits', { data: origB64, edits });
      await loadImage(result, fileName, undefined);
      setEditedB64(result);
      setEditError('');
    } catch (e) {
      console.error('EXIF 写入失败:', e);
      setEditError(String(e));
    } finally {
      setSavingExif(false);
    }
  }

  async function saveExifEdits() {
    const edits = buildChangedEdits(editValues, originalEditValues);
    if (edits.length === 0) {
      setEditError('没有检测到需要写入的修改');
      return;
    }
    await applyExifEdits(edits);
  }

  async function removeGpsExif() {
    await applyExifEdits([{ tag: 'GPS:all', value: null }]);
  }

  async function removePrivacyExif() {
    await applyExifEdits(
      [
        { tag: 'GPS:all', value: null },
        { tag: 'MakerNotes', value: null },
        { tag: 'MakerNote', value: null },
        { tag: 'SerialNumber', value: null },
        { tag: 'BodySerialNumber', value: null },
        { tag: 'InternalSerialNumber', value: null },
        { tag: 'UserComment', value: null },
      ],
    );
  }

  function downloadEdited() {
    if (!editedB64) return;
    const a = document.createElement('a');
    a.href = editedB64;
    const ext = fileExt(fileName);
    a.download = `${baseName(fileName)}_exif_edited.${ext}`;
    a.click();
  }

  function updateEditValue(key: keyof ExifEditValues, value: string) {
    setEditValues((prev) => ({ ...prev, [key]: value }));
    if (editError) setEditError('');
  }

  function copyTag(value: string, tag: string) {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 1500);
  }

  const hasPrivacy =
    !!gpsInfo ||
    fields.some((field) => field.privacy || PRIVACY_TAGS.some((tag) => field.tag.includes(tag))) ||
    summary.some((item) => item.privacy);
  const groups = groupFields(fields);
  const summaryGroups = groupSummary(summary);
  const displayWidth = imageInfo?.width ?? imgW;
  const displayHeight = imageInfo?.height ?? imgH;
  const displaySize = imageInfo?.fileSize || fileSize;
  const query = searchQuery.trim().toLowerCase();
  const filteredGroups = query
    ? groups
        .map(([group, groupFields]) => [
          group,
          groupFields.filter((field) => fieldMatchesQuery(field, query)),
        ] as [string, ExifField[]])
        .filter(([, groupFields]) => groupFields.length > 0)
    : groups;
  const hasReadableInfo = summary.length > 0 || fields.length > 0 || !!imageInfo;
  const changedEdits = buildChangedEdits(editValues, originalEditValues);
  const canWriteExif = !!origB64 && !!exifTool?.installed && !savingExif;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="EXIF 查看与修改" icon="🔎" />
      <div className="flex-1 overflow-hidden flex">
        <div className="w-72 flex-shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          {!origB64 ? (
            <label
              className="flex-1 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors m-3 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
            >
              <Upload size={28} className="text-gray-300 dark:text-gray-600" />
              <div className="text-center px-4">
                <div className="text-sm text-gray-400">点击上传</div>
                <div className="text-xs text-gray-300 dark:text-gray-600 mt-1">
                  拖拽 / Ctrl+V 粘贴
                </div>
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
          ) : (
            <>
              <div className="flex-1 flex items-center justify-center p-3 bg-gray-50 dark:bg-gray-900 min-h-0">
                <img
                  src={origB64}
                  alt={fileName}
                  className="max-w-full max-h-full object-contain rounded-lg shadow"
                />
              </div>

              <div className="p-3 space-y-2 border-t border-gray-100 dark:border-gray-700">
                <div
                  className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate"
                  title={fileName}
                >
                  {fileName}
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-400">
                  {displayWidth > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-1">
                      {displayWidth} × {displayHeight} px
                    </div>
                  )}
                  {displaySize > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-1">
                      {formatBytes(displaySize)}
                    </div>
                  )}
                  {imageInfo?.format && (
                    <div className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-1">
                      {imageInfo.format}
                    </div>
                  )}
                  {imageInfo?.colorType && (
                    <div className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-1">
                      {imageInfo.colorType}
                    </div>
                  )}
                  <div className="bg-gray-50 dark:bg-gray-700 rounded px-2 py-1">
                    {fields.length} 个字段
                  </div>
                  {hasPrivacy && (
                    <div className="bg-red-50 dark:bg-red-900/20 text-red-500 rounded px-2 py-1">
                      含隐私信息
                    </div>
                  )}
                </div>

                <div className="flex gap-1.5">
                  <button
                    onClick={stripExif}
                    disabled={stripping}
                    className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 ${
                      hasPrivacy
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    <Trash2 size={11} /> {stripping ? '清除中...' : '清除 EXIF'}
                  </button>
                  <label
                    className="flex items-center justify-center px-2 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer transition-colors"
                    title="重新选择图片"
                  >
                    <Upload size={11} />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(f);
                      }}
                    />
                  </label>
                </div>

                {strippedB64 && (
                  <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-2">
                    <div className="text-[10px] text-green-600 dark:text-green-400 mb-1.5">
                      ✓ EXIF 已清除
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={async () => {
                          if (await copyImageToClipboard(strippedB64)) setCopiedResult(true);
                          setTimeout(() => setCopiedResult(false), 1500);
                        }}
                        className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded"
                      >
                        <Copy size={10} /> {copiedResult ? '已复制 ✓' : '复制'}
                      </button>
                      <button
                        onClick={downloadStripped}
                        className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] bg-green-600 hover:bg-green-700 text-white rounded"
                      >
                        <Download size={10} /> 下载
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {!origB64 ? (
            <div className="flex-1 flex items-center justify-center text-gray-300 dark:text-gray-600 text-sm">
              上传图片后显示 EXIF 信息，支持常见字段修改
            </div>
          ) : loading ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              读取 EXIF 中...
            </div>
          ) : !hasReadableInfo ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-400">
              <div className="text-4xl">📷</div>
              <div className="text-sm">未读取到图片元数据</div>
              <div className="text-xs text-gray-300 dark:text-gray-600">
                可能是图片格式不受支持，或文件已损坏
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                    <Info size={14} />
                    准确概览
                  </div>
                  <button
                    onClick={() => {
                      setEditingExif((prev) => !prev);
                      setEditError('');
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      editingExif
                        ? 'border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    <Edit3 size={13} />
                    {editingExif ? '返回查看' : '编辑 EXIF'}
                  </button>
                </div>

                {warnings.length > 0 && (
                  <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                      <div className="space-y-1">
                        {warnings.map((warning) => (
                          <div key={warning}>{warning}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {editingExif && (
                <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 p-3">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                      <Edit3 size={14} />
                      修改 EXIF
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        exifTool?.installed
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {checkingExifTool
                        ? '检测 ExifTool...'
                        : exifTool?.installed
                          ? `ExifTool ${exifTool.version ?? '已就绪'}`
                          : '需要 ExifTool'}
                    </span>
                    {exifTool?.path && (
                      <span
                        className="min-w-0 flex-1 truncate text-[10px] text-gray-400"
                        title={exifTool.path}
                      >
                        {exifTool.path}
                      </span>
                    )}
                    <button
                      onClick={checkExifTool}
                      disabled={checkingExifTool}
                      className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1 text-[10px] text-gray-500 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50"
                    >
                      <RefreshCw size={11} className={checkingExifTool ? 'animate-spin' : ''} />
                      重新检测
                    </button>
                  </div>

                  {!exifTool?.installed && (
                    <div className="mb-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                      写入和修改依赖 ExifTool；查看、搜索、清除 EXIF 仍可直接使用。
                      <div className="mt-1 font-mono text-[11px] break-all">
                        {exifTool?.installHint ??
                          '安装参考：winget install OliverBetz.ExifTool，或从 exiftool.org 下载后重命名为 exiftool.exe 并加入 PATH'}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {TEXT_EDIT_FIELDS.map((field) => (
                      <label key={field.key} className={field.multiline ? 'xl:col-span-3' : ''}>
                        <div className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">
                          {field.label}
                        </div>
                        {field.multiline ? (
                          <textarea
                            value={editValues[field.key]}
                            onChange={(e) => updateEditValue(field.key, e.target.value)}
                            rows={2}
                            className="w-full resize-none rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 outline-none focus:border-blue-500"
                            placeholder={field.placeholder}
                          />
                        ) : (
                          <input
                            value={editValues[field.key]}
                            onChange={(e) => updateEditValue(field.key, e.target.value)}
                            className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 outline-none focus:border-blue-500"
                            placeholder={field.placeholder}
                          />
                        )}
                      </label>
                    ))}
                  </div>

                  <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-red-600 dark:text-red-300">
                      <MapPin size={12} />
                      GPS 位置
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {GPS_EDIT_FIELDS.map((field) => (
                        <label key={field.key}>
                          <div className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">
                            {field.label}
                          </div>
                          <input
                            value={editValues[field.key]}
                            onChange={(e) => updateEditValue(field.key, e.target.value)}
                            className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100 outline-none focus:border-blue-500"
                            placeholder={field.placeholder}
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  {editError && (
                    <div className="mt-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                      {editError}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={saveExifEdits}
                      disabled={!canWriteExif || changedEdits.length === 0}
                      className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Save size={12} />
                      {savingExif ? '写入中...' : `写入修改${changedEdits.length ? `(${changedEdits.length})` : ''}`}
                    </button>
                    <button
                      onClick={removeGpsExif}
                      disabled={!canWriteExif}
                      className="inline-flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <MapPin size={12} />
                      删除 GPS
                    </button>
                    <button
                      onClick={removePrivacyExif}
                      disabled={!canWriteExif}
                      className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ShieldAlert size={12} />
                      删除隐私字段
                    </button>
                    <button
                      onClick={() => {
                        setEditValues(originalEditValues);
                        setEditError('');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <Eraser size={12} />
                      还原表单
                    </button>
                  </div>

                  {editedB64 && (
                    <div className="mt-3 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-2">
                      <div className="mb-1.5 text-[11px] text-green-700 dark:text-green-300">
                        EXIF 修改已写入，右侧信息已重新读取
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={async () => {
                            if (await copyImageToClipboard(editedB64)) setCopiedEditedResult(true);
                            setTimeout(() => setCopiedEditedResult(false), 1500);
                          }}
                          className="inline-flex items-center justify-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] text-white hover:bg-blue-700"
                        >
                          <Copy size={10} /> {copiedEditedResult ? '已复制' : '复制修改图'}
                        </button>
                        <button
                          onClick={downloadEdited}
                          className="inline-flex items-center justify-center gap-1 rounded bg-green-600 px-2 py-1 text-[10px] text-white hover:bg-green-700"
                        >
                          <Download size={10} /> 下载修改图
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                )}

                {!editingExif && imageInfo && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
                    <InfoTile
                      icon={<Camera size={14} />}
                      label="格式"
                      value={`${imageInfo.format} · ${imageInfo.mime}`}
                    />
                    <InfoTile
                      icon={<Database size={14} />}
                      label="实际像素"
                      value={`${imageInfo.width} × ${imageInfo.height} px`}
                    />
                    <InfoTile
                      icon={<Info size={14} />}
                      label="颜色"
                      value={`${imageInfo.colorType} · ${imageInfo.bitsPerPixel} bpp`}
                    />
                    <InfoTile
                      icon={<Database size={14} />}
                      label="文件大小"
                      value={formatBytes(imageInfo.fileSize)}
                    />
                  </div>
                )}

                {!editingExif && gpsInfo && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                    <MapPin size={14} className="flex-shrink-0" />
                    <span className="font-mono">{gpsInfo.display}</span>
                    <a
                      className="ml-auto text-red-600 dark:text-red-300 hover:underline"
                      href={gpsInfo.mapUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      地图
                    </a>
                  </div>
                )}

                {!editingExif && summaryGroups.length > 0 && (
                  <div className="space-y-3">
                    {summaryGroups.map(([group, items]) => (
                      <div key={group}>
                        <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                          {group === 'GPS 位置' && (
                            <ShieldAlert size={13} className="text-red-500" />
                          )}
                          {group}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                          {items.map((item) => (
                            <button
                              key={`${item.group}-${item.label}`}
                              className="text-left rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                              onClick={() => copyTag(item.value, `summary-${item.label}`)}
                            >
                              <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
                                <span>{item.label}</span>
                                {item.privacy && (
                                  <span className="rounded bg-red-100 dark:bg-red-900/30 px-1 py-0.5 text-[10px] text-red-600 dark:text-red-300">
                                    隐私
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 break-words text-sm text-gray-800 dark:text-gray-200">
                                {item.value}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!editingExif && (
                <>
                  <div className="sticky top-0 z-10 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur">
                    <div className="relative">
                      <Search
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                      />
                      <input
                        className="w-full pl-9 pr-3 py-1.5 rounded-lg border text-sm outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500"
                        placeholder="搜索字段名、值、原始值、IFD、类型..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    {fields.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm">
                        <div>此图片没有可读取的 EXIF 字段</div>
                        <div className="mt-1 text-xs text-gray-300 dark:text-gray-600">
                          上方仍显示了文件格式、像素和颜色等基础信息
                        </div>
                      </div>
                    ) : filteredGroups.length === 0 ? (
                      <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                        未找到匹配的字段
                      </div>
                    ) : (
                      filteredGroups.map(([group, groupFields]) => (
                        <div key={group}>
                          <div
                            className={`sticky top-[51px] z-[1] px-4 py-1.5 flex items-center gap-2 text-xs font-semibold border-b border-gray-100 dark:border-gray-700 ${GROUP_COLORS[group] ?? GROUP_COLORS['其他']}`}
                          >
                            {group}
                            {group === 'GPS 位置' && (
                              <span className="text-[10px] bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded">
                                隐私
                              </span>
                            )}
                            <span className="ml-auto font-normal opacity-60">{groupFields.length}</span>
                          </div>

                          {groupFields.map((field) => {
                            const rawValue = formatRawValue(field);
                            return (
                              <div
                                key={`${field.ifd}-${field.context}-${field.code}-${field.tag}`}
                                className="flex items-start px-4 py-2 gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-50 dark:border-gray-800 group"
                              >
                                <div
                                  className="w-44 flex-shrink-0 text-xs text-gray-400 dark:text-gray-500 font-mono pt-0.5 truncate"
                                  title={`${field.tag} ${field.code ?? ''}`}
                                >
                                  <div className="truncate">{field.label || field.tag}</div>
                                  <div className="mt-0.5 truncate text-[10px] opacity-70">
                                    {field.tag}
                                    {field.code ? ` · ${field.code}` : ''}
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                                  <div className="break-words">{field.value}</div>
                                  <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
                                    {field.valueType && (
                                      <span className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5">
                                        {field.valueType}
                                      </span>
                                    )}
                                    {field.ifd && (
                                      <span className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5">
                                        {field.ifd}
                                      </span>
                                    )}
                                    {field.context && (
                                      <span className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5">
                                        {field.context}
                                      </span>
                                    )}
                                    {field.privacy && (
                                      <span className="rounded bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 text-red-600 dark:text-red-300">
                                        隐私
                                      </span>
                                    )}
                                  </div>
                                  {rawValue && (
                                    <div className="mt-1 break-words font-mono text-[11px] text-gray-400 dark:text-gray-500">
                                      原始：{rawValue}
                                    </div>
                                  )}
                                </div>
                                <button
                                  onClick={() => copyTag(field.value, field.tag)}
                                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-blue-500 transition-all pt-0.5"
                                  title="复制字段值"
                                >
                                  {copiedTag === field.tag ? (
                                    <span className="text-green-500 text-xs">✓</span>
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-medium text-gray-800 dark:text-gray-200">
        {value}
      </div>
    </div>
  );
}
