import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import MindMap from 'simple-mind-map/dist/simpleMindMap.esm.js';
import 'simple-mind-map/dist/simpleMindMap.esm.css';
import {
  ArrowDown,
  ArrowUp,
  Braces,
  Clipboard,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FolderOpen,
  Frame,
  GitBranchPlus,
  Image as ImageIcon,
  Link2,
  Maximize2,
  Minus,
  Network,
  Paintbrush,
  Palette,
  Plus,
  Presentation,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  Search,
  StickyNote,
  Tags,
  Trash2,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  useToolDataStore,
  type MindMapDocumentRecord,
  type MindMapToolData,
} from '../stores/toolDataStore';

const TOOL_VERSION = 'mcheng-mind-map-v1';

type MindMapTree = {
  data: Record<string, unknown> & { text?: string };
  children?: MindMapTree[];
};

type MindMapFullData = {
  root: MindMapTree;
  layout: string;
  theme: {
    template: string;
    config: Record<string, unknown>;
  };
  view?: unknown;
};

type SaveState = 'idle' | 'saving' | 'saved';

type MindMapNode = {
  getData?: () => Record<string, unknown>;
  getStyle?: (name: string) => unknown;
};

type MindMapInstance = {
  renderer?: {
    textEdit?: {
      hideEditTextBox?: () => void;
    };
    activeNodeList?: MindMapNode[];
    copy?: () => void;
    cut?: () => void;
    paste?: () => void;
    setRootNodeCenter?: () => void;
  };
  miniMap?: {
    calculationMiniMap: (width: number, height: number) => {
      svgHTML?: string;
      viewBoxStyle?: CSSProperties;
    };
  };
  search?: {
    search: (text: string) => void;
    endSearch: () => void;
    replace: (text: string, currentOnly?: boolean) => void;
    replaceAll: (text: string) => void;
  };
  view?: {
    fit?: () => void;
    enlarge?: () => void;
    narrow?: () => void;
  };
  painter?: {
    startPainter?: () => void;
  };
  associativeLine?: {
    createLineFromActiveNode?: () => void;
  };
  demonstrate?: {
    enter?: () => void;
  };
  getData: (withConfig?: boolean) => unknown;
  execCommand: (command: string, ...args: unknown[]) => void;
  setLayout: (layout: string) => void;
  setThemeConfig: (config: Record<string, unknown>) => void;
  on: (event: string, handler: (...args: never[]) => void) => void;
  off: (event: string, handler: (...args: never[]) => void) => void;
  resize: () => void;
  destroy: () => void;
  export: (...args: unknown[]) => Promise<string>;
};

type MindMapStatic = {
  new (options: Record<string, unknown>): MindMapInstance;
  iconList?: unknown[];
  markdown?: {
    transformMarkdownTo?: (text: string) => MindMapTree;
  };
  xmind: {
    parseXmindFile: (file: File, selector: (sheets: unknown[]) => unknown) => Promise<MindMapTree>;
  };
};

const MindMapLibrary = MindMap as MindMapStatic;

const LAYOUT_OPTIONS = [
  { value: 'logicalStructure', label: '逻辑结构图' },
  { value: 'logicalStructureLeft', label: '向左逻辑结构图' },
  { value: 'mindMap', label: '思维导图' },
  { value: 'organizationStructure', label: '组织结构图' },
  { value: 'catalogOrganization', label: '目录组织图' },
  { value: 'timeline', label: '时间轴' },
  { value: 'timeline2', label: '时间轴 2' },
  { value: 'verticalTimeline', label: '竖向时间轴' },
  { value: 'verticalTimeline2', label: '竖向时间轴 2' },
  { value: 'verticalTimeline3', label: '竖向时间轴 3' },
  { value: 'fishbone', label: '鱼骨图' },
  { value: 'fishbone2', label: '鱼骨图 2' },
  { value: 'rightFishbone', label: '向右鱼骨图' },
  { value: 'rightFishbone2', label: '向右鱼骨图 2' },
];

const SHAPE_OPTIONS = [
  { value: 'rectangle', label: '矩形' },
  { value: 'roundedRectangle', label: '圆角矩形' },
  { value: 'diamond', label: '菱形' },
  { value: 'parallelogram', label: '平行四边形' },
  { value: 'octagonalRectangle', label: '八角矩形' },
  { value: 'outerTriangularRectangle', label: '外三角矩形' },
  { value: 'innerTriangularRectangle', label: '内三角矩形' },
  { value: 'ellipse', label: '椭圆' },
  { value: 'circle', label: '圆形' },
];

const LINE_STYLE_OPTIONS = [
  { value: 'straight', label: '直线' },
  { value: 'curve', label: '曲线' },
  { value: 'direct', label: '直连' },
];

const ICON_OPTIONS = [
  { value: '', label: '无图标' },
  { value: 'priority_1', label: '优先级 1' },
  { value: 'priority_2', label: '优先级 2' },
  { value: 'priority_3', label: '优先级 3' },
  { value: 'priority_4', label: '优先级 4' },
  { value: 'priority_5', label: '优先级 5' },
  { value: 'progress_1', label: '进度 1/8' },
  { value: 'progress_2', label: '进度 2/8' },
  { value: 'progress_4', label: '进度 4/8' },
  { value: 'progress_8', label: '完成' },
  { value: 'expression_17', label: '赞' },
  { value: 'expression_20', label: '锁定' },
  { value: 'expression_23', label: '成员' },
];

const THEME_PRESETS = [
  {
    id: 'fresh',
    label: '清爽',
    config: {
      backgroundColor: '#f8fafc',
      lineColor: '#0f766e',
      generalizationLineColor: '#0f766e',
      root: { fillColor: '#0f766e', color: '#ffffff', borderRadius: 6 },
      second: { fillColor: '#ffffff', borderColor: '#0f766e', color: '#164e63' },
      node: { fillColor: 'transparent', color: '#334155' },
    },
  },
  {
    id: 'business',
    label: '商务',
    config: {
      backgroundColor: '#f9fafb',
      lineColor: '#2563eb',
      generalizationLineColor: '#2563eb',
      root: { fillColor: '#1d4ed8', color: '#ffffff', borderRadius: 4 },
      second: { fillColor: '#eff6ff', borderColor: '#93c5fd', color: '#1e3a8a' },
      node: { fillColor: '#ffffff', borderColor: '#dbeafe', borderWidth: 1, color: '#1f2937' },
    },
  },
  {
    id: 'paper',
    label: '纸张',
    config: {
      backgroundColor: '#fffdf7',
      lineColor: '#b45309',
      generalizationLineColor: '#b45309',
      root: { fillColor: '#92400e', color: '#ffffff', borderRadius: 3 },
      second: { fillColor: '#fffbeb', borderColor: '#f59e0b', color: '#78350f' },
      node: { fillColor: 'transparent', color: '#44403c' },
    },
  },
  {
    id: 'focus',
    label: '专注',
    config: {
      backgroundColor: '#f5f3ff',
      lineColor: '#7c3aed',
      generalizationLineColor: '#7c3aed',
      root: { fillColor: '#7c3aed', color: '#ffffff', borderRadius: 6 },
      second: { fillColor: '#ffffff', borderColor: '#a78bfa', color: '#4c1d95' },
      node: { fillColor: '#ffffff', borderColor: '#ddd6fe', borderWidth: 1, color: '#312e81' },
    },
  },
];

const EXPORT_OPTIONS = [
  { type: 'png', label: 'PNG 图片' },
  { type: 'jpg', label: 'JPG 图片' },
  { type: 'svg', label: 'SVG 矢量' },
  { type: 'pdf', label: 'PDF 文件' },
  { type: 'xmind', label: 'XMind' },
  { type: 'md', label: 'Markdown' },
  { type: 'txt', label: 'TXT 大纲' },
  { type: 'json', label: 'JSON' },
  { type: 'smm', label: 'SMM' },
];

const DEFAULT_THEME_CONFIG = THEME_PRESETS[0].config;

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stripHtml(value: unknown) {
  const text = String(value ?? '');
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  const el = document.createElement('div');
  el.innerHTML = text;
  return el.textContent || el.innerText || '';
}

function createDefaultRoot(): MindMapTree {
  return {
    data: {
      text: '中心主题',
      expand: true,
    },
    children: [
      {
        data: { text: '目标', expand: true },
        children: [
          { data: { text: '关键结果' }, children: [] },
          { data: { text: '衡量方式' }, children: [] },
        ],
      },
      {
        data: { text: '计划', expand: true },
        children: [
          { data: { text: '阶段一' }, children: [] },
          { data: { text: '阶段二' }, children: [] },
        ],
      },
      {
        data: { text: '风险', expand: true },
        children: [{ data: { text: '待确认事项' }, children: [] }],
      },
    ],
  };
}

function createDefaultFullData(): MindMapFullData {
  return {
    root: createDefaultRoot(),
    layout: 'mindMap',
    theme: {
      template: 'default',
      config: DEFAULT_THEME_CONFIG,
    },
  };
}

function ensureFullData(value: unknown): MindMapFullData {
  const data = value as Partial<MindMapFullData> | MindMapTree | null | undefined;
  if (data && typeof data === 'object' && 'root' in data && data.root) {
    return {
      root: data.root as MindMapTree,
      layout: typeof data.layout === 'string' ? data.layout : 'mindMap',
      theme: {
        template:
          data.theme && typeof data.theme === 'object' && 'template' in data.theme
            ? String(data.theme.template || 'default')
            : 'default',
        config:
          data.theme && typeof data.theme === 'object' && 'config' in data.theme
            ? ((data.theme.config || {}) as Record<string, unknown>)
            : DEFAULT_THEME_CONFIG,
      },
      view: data.view,
    };
  }
  if (data && typeof data === 'object' && 'data' in data) {
    return {
      ...createDefaultFullData(),
      root: data as MindMapTree,
    };
  }
  return createDefaultFullData();
}

function getRootTitle(data: unknown) {
  const full = ensureFullData(data);
  const title = stripHtml(full.root?.data?.text).trim();
  return title || '未命名思维导图';
}

function createDocument(title = '未命名思维导图', data: unknown = createDefaultFullData()) {
  const now = new Date().toISOString();
  return {
    id: createId('mind-map'),
    title,
    data: ensureFullData(data),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeDocuments(saved?: MindMapToolData): { documents: MindMapDocumentRecord[]; activeId: string } {
  const documents = Array.isArray(saved?.documents)
    ? saved.documents
        .filter((item) => item && item.id)
        .map((item) => ({
          ...item,
          title: item.title || getRootTitle(item.data),
          data: ensureFullData(item.data),
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString(),
        }))
    : [];
  const normalized = documents.length ? documents : [createDocument('示例思维导图')];
  const activeId = saved?.activeId && normalized.some((item) => item.id === saved.activeId) ? saved.activeId : normalized[0].id;
  return { documents: normalized, activeId };
}

function isDocumentBackup(value: unknown): value is MindMapToolData {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as MindMapToolData).documents));
}

function isMindMapNode(value: unknown): value is MindMapNode {
  return Boolean(value && typeof value === 'object');
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function getImageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => resolve({ width: 320, height: 180 });
    image.src = src;
  });
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  link.click();
}

function downloadText(content: string, fileName: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, fileName);
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function safeFileName(name: string) {
  return (name || '思维导图').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

function getFileExt(file: File) {
  return file.name.split('.').pop()?.toLowerCase() || '';
}

function getTagText(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object' && 'text' in item) return String(item.text || '');
        return String(item || '');
      })
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

function parseTags(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTime(value?: string) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createMarkdownFallback(markdown: string, fallbackTitle: string): MindMapTree {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  return {
    data: { text: lines[0] || fallbackTitle, expand: true },
    children: lines.slice(1).map((line) => ({ data: { text: line }, children: [] })),
  };
}

export default function MindMapTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateMindMapData } = useToolDataStore();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mindMapRef = useRef<MindMapInstance | null>(null);
  const selectedNodeRef = useRef<MindMapNode | null>(null);
  const documentsRef = useRef<MindMapDocumentRecord[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const miniMapTimerRef = useRef<number | null>(null);
  const pendingPersistRef = useRef<{ documents: MindMapDocumentRecord[]; activeId: string | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const initializedRef = useRef(false);

  const [documents, setDocuments] = useState<MindMapDocumentRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<Record<string, unknown> | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [nodeTextDraft, setNodeTextDraft] = useState('');
  const [nodeLinkDraft, setNodeLinkDraft] = useState('');
  const [nodeLinkTitleDraft, setNodeLinkTitleDraft] = useState('');
  const [nodeNoteDraft, setNodeNoteDraft] = useState('');
  const [nodeTagsDraft, setNodeTagsDraft] = useState('');
  const [nodeIconDraft, setNodeIconDraft] = useState('');
  const [styleDraft, setStyleDraft] = useState({
    color: '#334155',
    fillColor: '#ffffff',
    borderColor: '#d1d5db',
    lineColor: '#0f766e',
    fontSize: '14',
    shape: 'rectangle',
    lineStyle: 'straight',
  });
  const [currentLayout, setCurrentLayout] = useState('mindMap');
  const [zoom, setZoom] = useState(100);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [searchInfo, setSearchInfo] = useState({ currentIndex: -1, total: 0 });
  const [miniMap, setMiniMap] = useState<{ html: string; viewBoxStyle: CSSProperties }>({
    html: '',
    viewBoxStyle: {},
  });
  const [message, setMessage] = useState('');
  const [rightTab, setRightTab] = useState<'node' | 'style' | 'file' | 'search'>('node');

  const activeDocument = useMemo(
    () => documents.find((item) => item.id === activeId) || documents[0] || null,
    [documents, activeId]
  );

  const canUseNode = selectedCount > 0;

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (!loaded) {
      void loadData();
    }
  }, [loadData, loaded]);

  useEffect(() => {
    if (!loaded || initializedRef.current) return;
    const normalized = normalizeDocuments(data.mindMap);
    initializedRef.current = true;
    documentsRef.current = normalized.documents;
    activeIdRef.current = normalized.activeId;
    setDocuments(normalized.documents);
    setActiveId(normalized.activeId);
  }, [data.mindMap, loaded]);

  const flushMindMapPersist = useCallback(() => {
    const pending = pendingPersistRef.current;
    if (!pending) return;
    pendingPersistRef.current = null;
    updateMindMapData({
      version: TOOL_VERSION,
      activeId: pending.activeId,
      documents: pending.documents,
    });
  }, [updateMindMapData]);

  const persistMindMap = useCallback(
    (nextDocuments: MindMapDocumentRecord[], nextActiveId: string | null, delay = 250) => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      pendingPersistRef.current = { documents: nextDocuments, activeId: nextActiveId };
      if (delay <= 0) {
        flushMindMapPersist();
        return;
      }
      persistTimerRef.current = window.setTimeout(() => {
        flushMindMapPersist();
      }, delay);
    },
    [flushMindMapPersist]
  );

  const commitDocuments = useCallback(
    (
      updater: (current: MindMapDocumentRecord[]) => MindMapDocumentRecord[],
      nextActiveId = activeIdRef.current,
      delay = 250
    ) => {
      setDocuments((current) => {
        const next = updater(current);
        documentsRef.current = next;
        persistMindMap(next, nextActiveId, delay);
        return next;
      });
    },
    [persistMindMap]
  );

  const getDocumentsWithCurrentSnapshot = useCallback(() => {
    const mindMap = mindMapRef.current;
    const savingId = activeIdRef.current;
    const currentDocuments = documentsRef.current;
    if (!mindMap || !savingId) return currentDocuments;
    try {
      mindMap.renderer?.textEdit?.hideEditTextBox?.();
      const fullData = ensureFullData(mindMap.getData(true));
      const now = new Date().toISOString();
      const nextDocuments = currentDocuments.map((doc) =>
        doc.id === savingId
          ? {
              ...doc,
              data: fullData,
              title: doc.title || getRootTitle(fullData),
              updatedAt: now,
            }
          : doc
      );
      documentsRef.current = nextDocuments;
      return nextDocuments;
    } catch {
      return currentDocuments;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      if (miniMapTimerRef.current) window.clearTimeout(miniMapTimerRef.current);
      const nextDocuments = getDocumentsWithCurrentSnapshot();
      pendingPersistRef.current = { documents: nextDocuments, activeId: activeIdRef.current };
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      flushMindMapPersist();
    };
  }, [flushMindMapPersist, getDocumentsWithCurrentSnapshot]);

  const refreshMiniMap = useCallback(() => {
    const mindMap = mindMapRef.current;
    if (!mindMap?.miniMap) return;
    try {
      const result = mindMap.miniMap.calculationMiniMap(220, 132);
      setMiniMap({
        html: result.svgHTML || '',
        viewBoxStyle: result.viewBoxStyle || {},
      });
    } catch {
      setMiniMap({ html: '', viewBoxStyle: {} });
    }
  }, []);

  const scheduleMiniMapRefresh = useCallback(() => {
    if (miniMapTimerRef.current) window.clearTimeout(miniMapTimerRef.current);
    miniMapTimerRef.current = window.setTimeout(refreshMiniMap, 160);
  }, [refreshMiniMap]);

  const syncSelectedNode = useCallback((node: MindMapNode | null, list: MindMapNode[] = node ? [node] : []) => {
    selectedNodeRef.current = node || null;
    setSelectedCount(list.length);
    if (!node) {
      setSelectedNodeData(null);
      setNodeTextDraft('');
      setNodeLinkDraft('');
      setNodeLinkTitleDraft('');
      setNodeNoteDraft('');
      setNodeTagsDraft('');
      setNodeIconDraft('');
      return;
    }
    const nodeData = { ...(node.getData?.() || {}) };
    setSelectedNodeData(nodeData);
    setNodeTextDraft(stripHtml(nodeData.text).trim());
    setNodeLinkDraft(String(nodeData.hyperlink || ''));
    setNodeLinkTitleDraft(String(nodeData.hyperlinkTitle || ''));
    setNodeNoteDraft(String(nodeData.note || ''));
    setNodeTagsDraft(getTagText(nodeData.tag));
    setNodeIconDraft(Array.isArray(nodeData.icon) ? String(nodeData.icon[0] || '') : '');
    setStyleDraft((current) => ({
      ...current,
      color: String(nodeData.color || node.getStyle?.('color') || current.color),
      fillColor: String(nodeData.fillColor || node.getStyle?.('fillColor') || current.fillColor),
      borderColor: String(nodeData.borderColor || node.getStyle?.('borderColor') || current.borderColor),
      lineColor: String(nodeData.lineColor || node.getStyle?.('lineColor') || current.lineColor),
      fontSize: String(nodeData.fontSize || node.getStyle?.('fontSize') || current.fontSize),
      shape: String(nodeData.shape || node.getStyle?.('shape') || current.shape),
      lineStyle: String(nodeData.lineStyle || node.getStyle?.('lineStyle') || current.lineStyle),
    }));
  }, []);

  const saveCurrentDocumentSnapshot = useCallback(
    (delay = 0) => {
      const mindMap = mindMapRef.current;
      const savingId = activeIdRef.current;
      if (!mindMap || !savingId) return;
      try {
        mindMap.renderer?.textEdit?.hideEditTextBox?.();
        const fullData = ensureFullData(mindMap.getData(true));
        const now = new Date().toISOString();
        setSaveState('saving');
        commitDocuments(
          (current) =>
            current.map((doc) =>
              doc.id === savingId
                ? {
                    ...doc,
                    data: fullData,
                    title: doc.title || getRootTitle(fullData),
                    updatedAt: now,
                  }
                : doc
            ),
          activeIdRef.current,
          delay
        );
        window.setTimeout(() => setSaveState('saved'), delay + 120);
      } catch (error) {
        setMessage(`保存失败：${String(error)}`);
      }
    },
    [commitDocuments]
  );

  const scheduleSaveCurrentDocument = useCallback(
    (delay = 700) => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      setSaveState('saving');
      autosaveTimerRef.current = window.setTimeout(() => {
        saveCurrentDocumentSnapshot(0);
      }, delay);
    },
    [saveCurrentDocumentSnapshot]
  );

  useEffect(() => {
    if (!ready || !loaded || !activeId || !containerRef.current) return;
    const currentDoc = documentsRef.current.find((item) => item.id === activeId);
    if (!currentDoc) return;

    const container = containerRef.current;
    container.innerHTML = '';
    const full = ensureFullData(currentDoc.data);
    setCurrentLayout(full.layout);
    const mindMap = new MindMapLibrary({
      el: container,
      data: full.root,
      layout: full.layout,
      theme: full.theme.template || 'default',
      themeConfig: full.theme.config || DEFAULT_THEME_CONFIG,
      viewData: full.view,
      fit: true,
      iconList: MindMapLibrary.iconList || [],
      enableAutoEnterTextEditWhenKeydown: true,
      openRealtimeRenderOnNodeTextEdit: true,
      enableDragModifyNodeWidth: true,
      mouseScaleCenterUseMousePosition: true,
      enableCtrlKeyNodeSelection: true,
      alwaysShowExpandBtn: true,
      defaultInsertSecondLevelNodeText: '分支主题',
      defaultInsertBelowSecondLevelNodeText: '子主题',
      defaultGeneralizationText: '概要',
      errorHandler: (_code: string, error: unknown) => setMessage(`思维导图错误：${String(error)}`),
    });
    mindMapRef.current = mindMap;

    const onActive = (nodeValue: unknown, activeListValue: unknown) => {
      const activeList = Array.isArray(activeListValue) ? activeListValue.filter(isMindMapNode) : [];
      const node = isMindMapNode(nodeValue) ? nodeValue : null;
      syncSelectedNode(activeList[0] || node, activeList);
    };
    const onClear = () => syncSelectedNode(null, []);
    const onScale = (value: number) => setZoom(Math.round((value || 1) * 100));
    const onSearchInfo = (info: { currentIndex: number; total: number }) => {
      setSearchInfo(info || { currentIndex: -1, total: 0 });
    };
    const onDataChanged = () => {
      scheduleSaveCurrentDocument();
      scheduleMiniMapRefresh();
    };
    const onViewChanged = () => {
      scheduleSaveCurrentDocument(1200);
      scheduleMiniMapRefresh();
    };
    const onLayoutChanged = (layout: string) => {
      setCurrentLayout(layout);
      scheduleSaveCurrentDocument(250);
      scheduleMiniMapRefresh();
    };

    mindMap.on('node_active', onActive);
    mindMap.on('draw_click', onClear);
    mindMap.on('data_change', onDataChanged);
    mindMap.on('view_data_change', onViewChanged);
    mindMap.on('layout_change', onLayoutChanged);
    mindMap.on('scale', onScale);
    mindMap.on('search_info_change', onSearchInfo);
    mindMap.on('node_tree_render_end', scheduleMiniMapRefresh);

    const resizeObserver = new ResizeObserver(() => {
      mindMap.resize();
      scheduleMiniMapRefresh();
    });
    resizeObserver.observe(container);
    const fitTimer = window.setTimeout(() => {
      mindMap.view?.fit?.();
      scheduleMiniMapRefresh();
    }, 80);

    return () => {
      window.clearTimeout(fitTimer);
      resizeObserver.disconnect();
      mindMap.off('node_active', onActive);
      mindMap.off('draw_click', onClear);
      mindMap.off('data_change', onDataChanged);
      mindMap.off('view_data_change', onViewChanged);
      mindMap.off('layout_change', onLayoutChanged);
      mindMap.off('scale', onScale);
      mindMap.off('search_info_change', onSearchInfo);
      mindMap.off('node_tree_render_end', scheduleMiniMapRefresh);
      mindMap.destroy();
      if (mindMapRef.current === mindMap) mindMapRef.current = null;
      selectedNodeRef.current = null;
    };
  }, [
    activeId,
    loaded,
    ready,
    scheduleMiniMapRefresh,
    scheduleSaveCurrentDocument,
    syncSelectedNode,
  ]);

  const runCommand = useCallback(
    (command: string, ...args: unknown[]) => {
      const mindMap = mindMapRef.current;
      if (!mindMap) return;
      mindMap.execCommand(command, ...args);
      scheduleSaveCurrentDocument(200);
    },
    [scheduleSaveCurrentDocument]
  );

  const getActiveNodes = useCallback(() => {
    return mindMapRef.current?.renderer?.activeNodeList || [];
  }, []);

  const applyNodeText = useCallback(() => {
    const node = selectedNodeRef.current;
    if (!node) return;
    runCommand('SET_NODE_TEXT', node, nodeTextDraft, false, true);
    syncSelectedNode(node, getActiveNodes());
  }, [getActiveNodes, nodeTextDraft, runCommand, syncSelectedNode]);

  const applyNodeMeta = useCallback(() => {
    const node = selectedNodeRef.current;
    if (!node) return;
    runCommand('SET_NODE_HYPERLINK', node, nodeLinkDraft.trim(), nodeLinkTitleDraft.trim());
    runCommand('SET_NODE_NOTE', node, nodeNoteDraft);
    runCommand('SET_NODE_TAG', node, parseTags(nodeTagsDraft));
    runCommand('SET_NODE_ICON', node, nodeIconDraft ? [nodeIconDraft] : []);
    syncSelectedNode(node, getActiveNodes());
  }, [
    getActiveNodes,
    nodeIconDraft,
    nodeLinkDraft,
    nodeLinkTitleDraft,
    nodeNoteDraft,
    nodeTagsDraft,
    runCommand,
    syncSelectedNode,
  ]);

  const applyNodeStyle = useCallback(() => {
    const nodes = getActiveNodes();
    if (!nodes.length) return;
    const style = {
      color: styleDraft.color,
      fillColor: styleDraft.fillColor,
      borderColor: styleDraft.borderColor,
      borderWidth: 1,
      lineColor: styleDraft.lineColor,
      fontSize: Number(styleDraft.fontSize) || 14,
      shape: styleDraft.shape,
      lineStyle: styleDraft.lineStyle,
    };
    nodes.forEach((node) => runCommand('SET_NODE_STYLES', node, style));
    syncSelectedNode(nodes[0], nodes);
  }, [getActiveNodes, runCommand, styleDraft, syncSelectedNode]);

  const handleImageUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const node = selectedNodeRef.current;
      event.target.value = '';
      if (!file || !node) return;
      const dataUrl = await readFileAsDataUrl(file);
      const size = await getImageSize(dataUrl);
      runCommand('SET_NODE_IMAGE', node, {
        url: dataUrl,
        title: file.name,
        width: size.width,
        height: size.height,
      });
      syncSelectedNode(node, getActiveNodes());
    },
    [getActiveNodes, runCommand, syncSelectedNode]
  );

  const removeNodeImage = useCallback(() => {
    const node = selectedNodeRef.current;
    if (!node) return;
    runCommand('SET_NODE_IMAGE', node, null);
    syncSelectedNode(node, getActiveNodes());
  }, [getActiveNodes, runCommand, syncSelectedNode]);

  const changeLayout = useCallback(
    (layout: string) => {
      const mindMap = mindMapRef.current;
      if (!mindMap) return;
      mindMap.setLayout(layout);
      setCurrentLayout(layout);
      scheduleSaveCurrentDocument(150);
    },
    [scheduleSaveCurrentDocument]
  );

  const applyThemePreset = useCallback(
    (config: Record<string, unknown>) => {
      const mindMap = mindMapRef.current;
      if (!mindMap) return;
      mindMap.setThemeConfig(config);
      scheduleSaveCurrentDocument(150);
      scheduleMiniMapRefresh();
    },
    [scheduleMiniMapRefresh, scheduleSaveCurrentDocument]
  );

  const switchDocument = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      saveCurrentDocumentSnapshot(0);
      activeIdRef.current = id;
      setActiveId(id);
      persistMindMap(documentsRef.current, id, 0);
    },
    [persistMindMap, saveCurrentDocumentSnapshot]
  );

  const createNewDocument = useCallback(() => {
    saveCurrentDocumentSnapshot(0);
    const doc = createDocument('未命名思维导图');
    activeIdRef.current = doc.id;
    setActiveId(doc.id);
    commitDocuments((current) => [doc, ...current], doc.id, 0);
  }, [commitDocuments, saveCurrentDocumentSnapshot]);

  const duplicateDocument = useCallback(() => {
    const source = activeDocument;
    if (!source) return;
    saveCurrentDocumentSnapshot(0);
    const doc = createDocument(`${source.title} 副本`, source.data);
    activeIdRef.current = doc.id;
    setActiveId(doc.id);
    commitDocuments((current) => [doc, ...current], doc.id, 0);
  }, [activeDocument, commitDocuments, saveCurrentDocumentSnapshot]);

  const deleteDocument = useCallback(() => {
    const deletingId = activeIdRef.current;
    if (!deletingId) return;
    const current = documentsRef.current;
    const rest = current.filter((item) => item.id !== deletingId);
    const nextDocuments = rest.length ? rest : [createDocument('未命名思维导图')];
    const nextActiveId = nextDocuments[0].id;
    documentsRef.current = nextDocuments;
    activeIdRef.current = nextActiveId;
    setDocuments(nextDocuments);
    setActiveId(nextActiveId);
    persistMindMap(nextDocuments, nextActiveId, 0);
  }, [persistMindMap]);

  const renameDocument = useCallback(
    (title: string) => {
      const id = activeIdRef.current;
      if (!id) return;
      commitDocuments(
        (current) =>
          current.map((doc) =>
            doc.id === id
              ? {
                  ...doc,
                  title: title.trim() || '未命名思维导图',
                  updatedAt: new Date().toISOString(),
                }
              : doc
          ),
        id,
        250
      );
    },
    [commitDocuments]
  );

  const importFile = useCallback(
    async (file: File) => {
      try {
        saveCurrentDocumentSnapshot(0);
        const ext = getFileExt(file);
        let importedData: MindMapFullData;
        if (ext === 'md' || ext === 'markdown') {
          const text = await readFileAsText(file);
          const root = MindMapLibrary.markdown?.transformMarkdownTo?.(text) || createMarkdownFallback(text, file.name);
          importedData = {
            ...createDefaultFullData(),
            root,
          };
        } else if (ext === 'xmind') {
          const root = await MindMapLibrary.xmind.parseXmindFile(file, (sheets: unknown[]) => (Array.isArray(sheets) ? sheets[0] : null));
          importedData = {
            ...createDefaultFullData(),
            root,
          };
        } else {
          const text = await readFileAsText(file);
          const parsed = JSON.parse(text);
          if (isDocumentBackup(parsed)) {
            const restored = normalizeDocuments(parsed);
            documentsRef.current = restored.documents;
            activeIdRef.current = restored.activeId;
            setDocuments(restored.documents);
            setActiveId(restored.activeId);
            persistMindMap(restored.documents, restored.activeId, 0);
            setMessage(`已恢复备份：${file.name}`);
            return;
          }
          importedData = ensureFullData(parsed);
        }
        const title = getRootTitle(importedData) || file.name.replace(/\.[^.]+$/, '');
        const doc = createDocument(title, importedData);
        activeIdRef.current = doc.id;
        setActiveId(doc.id);
        commitDocuments((current) => [doc, ...current], doc.id, 0);
        setMessage(`已导入：${file.name}`);
      } catch (error) {
        setMessage(`导入失败：${String(error)}`);
      }
    },
    [commitDocuments, persistMindMap, saveCurrentDocumentSnapshot]
  );

  const handleImportChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void importFile(file);
    },
    [importFile]
  );

  const exportCurrent = useCallback(
    async (type: string) => {
      const mindMap = mindMapRef.current;
      if (!mindMap || !activeDocument) return;
      saveCurrentDocumentSnapshot(0);
      try {
        const title = safeFileName(activeDocument.title || getRootTitle(activeDocument.data));
        if (type === 'json' || type === 'smm') {
          const result = await mindMap.export(type, false, title, true);
          downloadDataUrl(result, `${title}.${type}`);
        } else if (type === 'pdf') {
          const result = await mindMap.export(type, false, title, false, true);
          downloadDataUrl(result, `${title}.pdf`);
        } else {
          const result = await mindMap.export(type, false, title);
          downloadDataUrl(result, `${title}.${type}`);
        }
        setMessage(`已导出 ${EXPORT_OPTIONS.find((item) => item.type === type)?.label || type}`);
      } catch (error) {
        setMessage(`导出失败：${String(error)}`);
      }
    },
    [activeDocument, saveCurrentDocumentSnapshot]
  );

  const exportAllDocuments = useCallback(() => {
    const nextDocuments = getDocumentsWithCurrentSnapshot();
    persistMindMap(nextDocuments, activeIdRef.current, 0);
    downloadText(
      JSON.stringify({ version: TOOL_VERSION, activeId: activeIdRef.current, documents: nextDocuments }, null, 2),
      `mind-map-documents-${Date.now()}.json`
    );
    setSaveState('saved');
    setMessage('已导出全部思维导图备份');
  }, [getDocumentsWithCurrentSnapshot, persistMindMap]);

  const runSearch = useCallback(() => {
    const mindMap = mindMapRef.current;
    if (!mindMap?.search) return;
    if (!searchText.trim()) {
      mindMap.search.endSearch();
      setSearchInfo({ currentIndex: -1, total: 0 });
      return;
    }
    mindMap.search.search(searchText.trim());
  }, [searchText]);

  const replaceCurrent = useCallback(() => {
    const mindMap = mindMapRef.current;
    if (!mindMap?.search) return;
    mindMap.search.replace(replaceText, true);
    scheduleSaveCurrentDocument(150);
  }, [replaceText, scheduleSaveCurrentDocument]);

  const replaceAll = useCallback(() => {
    const mindMap = mindMapRef.current;
    if (!mindMap?.search) return;
    mindMap.search.replaceAll(replaceText);
    scheduleSaveCurrentDocument(150);
  }, [replaceText, scheduleSaveCurrentDocument]);

  const clearSearch = useCallback(() => {
    const mindMap = mindMapRef.current;
    mindMap?.search?.endSearch?.();
    setSearchText('');
    setReplaceText('');
    setSearchInfo({ currentIndex: -1, total: 0 });
  }, []);

  const saveLabel = saveState === 'saving' ? '保存中' : saveState === 'saved' ? '已保存' : '待编辑';

  if (!ready || !loaded) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🧠"
        title="思维导图"
        subtitle="基于 simple-mind-map，支持编辑、主题、导入导出和本地保存"
        actions={
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{saveLabel}</span>
            <button
              className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              title="保存"
              onClick={() => saveCurrentDocumentSnapshot(0)}
            >
              <Save size={15} />
            </button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 flex-col border-r border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-slate-200 p-3 dark:border-gray-800">
            <div className="flex gap-2">
              <button
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                onClick={createNewDocument}
              >
                <FilePlus2 size={15} />
                新建
              </button>
              <button
                className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                title="导入"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={15} />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.smm,.md,.markdown,.xmind"
              className="hidden"
              onChange={handleImportChange}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-2">
              {documents.map((doc) => (
                <button
                  key={doc.id}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    doc.id === activeId
                      ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => switchDocument(doc.id)}
                >
                  <div className="truncate text-sm font-medium">{doc.title}</div>
                  <div className="mt-1 text-xs text-slate-400">{formatTime(doc.updatedAt)}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 p-3 dark:border-gray-800">
            <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">当前文件</div>
            <input
              value={activeDocument?.title || ''}
              onChange={(event) => renameDocument(event.target.value)}
              className="mb-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
            />
            <div className="grid grid-cols-3 gap-2">
              <button
                className="rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800"
                onClick={duplicateDocument}
              >
                复制
              </button>
              <button
                className="rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800"
                onClick={exportAllDocuments}
              >
                备份
              </button>
              <button
                className="rounded-md border border-red-200 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30"
                onClick={deleteDocument}
              >
                删除
              </button>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
            <ToolbarButton title="撤销" icon={<Undo2 size={16} />} onClick={() => runCommand('BACK')} />
            <ToolbarButton title="重做" icon={<Redo2 size={16} />} onClick={() => runCommand('FORWARD')} />
            <Divider />
            <ToolbarButton title="子节点" icon={<GitBranchPlus size={16} />} disabled={!canUseNode} onClick={() => runCommand('INSERT_CHILD_NODE')} />
            <ToolbarButton title="同级节点" icon={<Plus size={16} />} disabled={!canUseNode} onClick={() => runCommand('INSERT_NODE')} />
            <ToolbarButton title="父节点" icon={<Network size={16} />} disabled={!canUseNode} onClick={() => runCommand('INSERT_PARENT_NODE')} />
            <ToolbarButton title="删除节点" icon={<Trash2 size={16} />} disabled={!canUseNode} onClick={() => runCommand('REMOVE_NODE')} />
            <ToolbarButton title="仅删当前" icon={<X size={16} />} disabled={!canUseNode} onClick={() => runCommand('REMOVE_CURRENT_NODE')} />
            <Divider />
            <ToolbarButton title="上移" icon={<ArrowUp size={16} />} disabled={!canUseNode} onClick={() => runCommand('UP_NODE')} />
            <ToolbarButton title="下移" icon={<ArrowDown size={16} />} disabled={!canUseNode} onClick={() => runCommand('DOWN_NODE')} />
            <ToolbarButton title="提升层级" icon={<RotateCcw size={16} />} disabled={!canUseNode} onClick={() => runCommand('MOVE_UP_ONE_LEVEL')} />
            <Divider />
            <ToolbarButton title="复制节点" icon={<Copy size={16} />} disabled={!canUseNode} onClick={() => mindMapRef.current?.renderer?.copy?.()} />
            <ToolbarButton title="剪切节点" icon={<Scissors size={16} />} disabled={!canUseNode} onClick={() => mindMapRef.current?.renderer?.cut?.()} />
            <ToolbarButton title="粘贴节点" icon={<Clipboard size={16} />} disabled={!canUseNode} onClick={() => mindMapRef.current?.renderer?.paste?.()} />
            <ToolbarButton title="格式刷" icon={<Paintbrush size={16} />} disabled={!canUseNode} onClick={() => mindMapRef.current?.painter?.startPainter?.()} />
            <Divider />
            <ToolbarButton title="展开全部" icon={<Eye size={16} />} onClick={() => runCommand('EXPAND_ALL')} />
            <ToolbarButton title="收起全部" icon={<Minus size={16} />} onClick={() => runCommand('UNEXPAND_ALL')} />
            <ToolbarButton title="适应画布" icon={<Maximize2 size={16} />} onClick={() => mindMapRef.current?.view?.fit?.()} />
            <ToolbarButton title="放大" icon={<ZoomIn size={16} />} onClick={() => mindMapRef.current?.view?.enlarge?.()} />
            <ToolbarButton title="缩小" icon={<ZoomOut size={16} />} onClick={() => mindMapRef.current?.view?.narrow?.()} />
            <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{zoom}%</span>
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="relative min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_1px_1px,#d1d5db_1px,transparent_0)] [background-size:18px_18px] dark:bg-[radial-gradient(circle_at_1px_1px,#374151_1px,transparent_0)]">
              <div ref={containerRef} className="h-full w-full" />
              {message && (
                <div className="absolute left-4 top-4 flex max-w-xl items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-700 shadow-sm dark:border-blue-900 dark:bg-gray-900 dark:text-blue-200">
                  <span className="truncate">{message}</span>
                  <button className="text-blue-500" onClick={() => setMessage('')}>
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="absolute bottom-4 left-4 overflow-hidden rounded-lg border border-slate-200 bg-white/95 p-2 shadow-sm dark:border-gray-800 dark:bg-gray-900/95">
                <div className="relative h-[132px] w-[220px] overflow-hidden bg-slate-50 dark:bg-gray-950">
                  {miniMap.html ? (
                    <>
                      <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: miniMap.html }} />
                      <div className="absolute border border-blue-500 bg-blue-500/10" style={miniMap.viewBoxStyle} />
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-slate-400">缩略图</div>
                  )}
                </div>
              </div>
            </div>

            <aside className="flex w-[360px] flex-col border-l border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="grid grid-cols-4 border-b border-slate-200 dark:border-gray-800">
                <TabButton active={rightTab === 'node'} onClick={() => setRightTab('node')} icon={<Braces size={15} />} label="节点" />
                <TabButton active={rightTab === 'style'} onClick={() => setRightTab('style')} icon={<Palette size={15} />} label="样式" />
                <TabButton active={rightTab === 'file'} onClick={() => setRightTab('file')} icon={<FolderOpen size={15} />} label="文件" />
                <TabButton active={rightTab === 'search'} onClick={() => setRightTab('search')} icon={<Search size={15} />} label="搜索" />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {rightTab === 'node' && (
                  <Panel title={selectedCount ? `已选 ${selectedCount} 个节点` : '未选择节点'}>
                    {selectedNodeData ? (
                      <div className="space-y-4">
                        <Field label="节点内容">
                          <textarea
                            value={nodeTextDraft}
                            onChange={(event) => setNodeTextDraft(event.target.value)}
                            onBlur={applyNodeText}
                            rows={4}
                            className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                          />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="链接地址">
                            <input
                              value={nodeLinkDraft}
                              onChange={(event) => setNodeLinkDraft(event.target.value)}
                              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                            />
                          </Field>
                          <Field label="链接标题">
                            <input
                              value={nodeLinkTitleDraft}
                              onChange={(event) => setNodeLinkTitleDraft(event.target.value)}
                              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                            />
                          </Field>
                        </div>
                        <Field label="备注">
                          <textarea
                            value={nodeNoteDraft}
                            onChange={(event) => setNodeNoteDraft(event.target.value)}
                            rows={3}
                            className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                          />
                        </Field>
                        <Field label="标签">
                          <input
                            value={nodeTagsDraft}
                            onChange={(event) => setNodeTagsDraft(event.target.value)}
                            placeholder="逗号分隔"
                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                          />
                        </Field>
                        <Field label="图标">
                          <select
                            value={nodeIconDraft}
                            onChange={(event) => setNodeIconDraft(event.target.value)}
                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                          >
                            {ICON_OPTIONS.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="grid grid-cols-2 gap-2">
                          <ActionButton icon={<Link2 size={15} />} label="保存信息" onClick={applyNodeMeta} />
                          <ActionButton icon={<ImageIcon size={15} />} label="添加图片" onClick={() => imageInputRef.current?.click()} />
                          <ActionButton icon={<StickyNote size={15} />} label="添加概要" onClick={() => runCommand('ADD_GENERALIZATION')} />
                          <ActionButton icon={<Frame size={15} />} label="添加外框" onClick={() => runCommand('ADD_OUTER_FRAME', [], { text: '分组' })} />
                          <ActionButton icon={<Network size={15} />} label="关联线" onClick={() => mindMapRef.current?.associativeLine?.createLineFromActiveNode?.()} />
                          <ActionButton icon={<Trash2 size={15} />} label="移除图片" onClick={removeNodeImage} />
                        </div>
                        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                      </div>
                    ) : (
                      <EmptyState text="点击画布节点后可编辑内容、备注、链接、标签、图片和概要。" />
                    )}
                  </Panel>
                )}

                {rightTab === 'style' && (
                  <div className="space-y-4">
                    <Panel title="结构">
                      <Field label="布局结构">
                        <select
                          value={currentLayout}
                          onChange={(event) => changeLayout(event.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                        >
                          {LAYOUT_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {[1, 2, 3, 4, 5, 6].map((level) => (
                          <button
                            key={level}
                            className="rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800"
                            onClick={() => runCommand('UNEXPAND_TO_LEVEL', level)}
                          >
                            {level} 级
                          </button>
                        ))}
                      </div>
                    </Panel>

                    <Panel title="主题">
                      <div className="grid grid-cols-2 gap-2">
                        {THEME_PRESETS.map((theme) => (
                          <button
                            key={theme.id}
                            className="rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800"
                            onClick={() => applyThemePreset(theme.config)}
                          >
                            {theme.label}
                          </button>
                        ))}
                      </div>
                    </Panel>

                    <Panel title={selectedCount ? '节点样式' : '节点样式'}>
                      <div className="space-y-3">
                        <Field label="形状">
                          <select
                            value={styleDraft.shape}
                            onChange={(event) => setStyleDraft((current) => ({ ...current, shape: event.target.value }))}
                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                          >
                            {SHAPE_OPTIONS.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                          <ColorField label="文字" value={styleDraft.color} onChange={(value) => setStyleDraft((current) => ({ ...current, color: value }))} />
                          <ColorField label="填充" value={styleDraft.fillColor} onChange={(value) => setStyleDraft((current) => ({ ...current, fillColor: value }))} />
                          <ColorField label="边框" value={styleDraft.borderColor} onChange={(value) => setStyleDraft((current) => ({ ...current, borderColor: value }))} />
                          <ColorField label="连线" value={styleDraft.lineColor} onChange={(value) => setStyleDraft((current) => ({ ...current, lineColor: value }))} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="字号">
                            <input
                              type="number"
                              min={10}
                              max={48}
                              value={styleDraft.fontSize}
                              onChange={(event) => setStyleDraft((current) => ({ ...current, fontSize: event.target.value }))}
                              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                            />
                          </Field>
                          <Field label="连线">
                            <select
                              value={styleDraft.lineStyle}
                              onChange={(event) => setStyleDraft((current) => ({ ...current, lineStyle: event.target.value }))}
                              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                            >
                              {LINE_STYLE_OPTIONS.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <ActionButton icon={<Palette size={15} />} label="应用样式" disabled={!canUseNode} onClick={applyNodeStyle} />
                          <ActionButton icon={<RotateCcw size={15} />} label="清除样式" disabled={!canUseNode} onClick={() => runCommand('REMOVE_CUSTOM_STYLES')} />
                        </div>
                      </div>
                    </Panel>
                  </div>
                )}

                {rightTab === 'file' && (
                  <div className="space-y-4">
                    <Panel title="导入">
                      <div className="grid grid-cols-2 gap-2">
                        <ActionButton icon={<Upload size={15} />} label="导入文件" onClick={() => fileInputRef.current?.click()} />
                        <ActionButton icon={<FilePlus2 size={15} />} label="新建空白" onClick={createNewDocument} />
                      </div>
                      <p className="mt-2 text-xs text-slate-400">支持 JSON、SMM、Markdown、XMind。</p>
                    </Panel>
                    <Panel title="导出当前">
                      <div className="grid grid-cols-2 gap-2">
                        {EXPORT_OPTIONS.map((item) => (
                          <ActionButton
                            key={item.type}
                            icon={<Download size={15} />}
                            label={item.label}
                            onClick={() => void exportCurrent(item.type)}
                          />
                        ))}
                      </div>
                    </Panel>
                    <Panel title="演示">
                      <div className="grid grid-cols-2 gap-2">
                        <ActionButton icon={<Presentation size={15} />} label="演示模式" onClick={() => mindMapRef.current?.demonstrate?.enter?.()} />
                        <ActionButton icon={<Maximize2 size={15} />} label="画布居中" onClick={() => mindMapRef.current?.renderer?.setRootNodeCenter?.()} />
                      </div>
                    </Panel>
                  </div>
                )}

                {rightTab === 'search' && (
                  <div className="space-y-4">
                    <Panel title="查找替换">
                      <div className="space-y-3">
                        <Field label="查找">
                          <input
                            value={searchText}
                            onChange={(event) => setSearchText(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') runSearch();
                            }}
                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                          />
                        </Field>
                        <Field label="替换为">
                          <input
                            value={replaceText}
                            onChange={(event) => setReplaceText(event.target.value)}
                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                          />
                        </Field>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {searchInfo.total > 0 ? `${searchInfo.currentIndex + 1} / ${searchInfo.total}` : '无匹配'}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <ActionButton icon={<Search size={15} />} label="查找下一个" onClick={runSearch} />
                          <ActionButton icon={<X size={15} />} label="清除" onClick={clearSearch} />
                          <ActionButton icon={<Tags size={15} />} label="替换当前" onClick={replaceCurrent} />
                          <ActionButton icon={<Download size={15} />} label="全部替换" onClick={replaceAll} />
                        </div>
                      </div>
                    </Panel>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px bg-slate-200 dark:bg-gray-700" />;
}

function ToolbarButton({
  title,
  icon,
  onClick,
  disabled = false,
}: {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      {icon}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 px-2 py-3 text-sm transition ${
        active
          ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
          : 'text-slate-500 hover:bg-slate-50 dark:text-gray-400 dark:hover:bg-gray-800'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-gray-200">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500 dark:text-gray-400">{label}</span>
      {children}
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-gray-700 dark:bg-gray-950">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-9 bg-transparent" />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
      </div>
    </Field>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-gray-700 dark:text-gray-500">
      {text}
    </div>
  );
}
