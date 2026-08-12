import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng, toSvg } from 'html-to-image';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Braces,
  Copy,
  Diamond,
  Download,
  FilePlus2,
  GitBranch,
  Image as ImageIcon,
  LayoutGrid,
  Maximize2,
  Network,
  Save,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  useToolDataStore,
  type FlowchartDocumentRecord,
  type FlowchartToolData,
} from '../stores/toolDataStore';

const TOOL_VERSION = 'mcheng-flowchart-v1';

type FlowNodeData = {
  label: string;
  description?: string;
  shape?: FlowShape;
  color?: string;
  fill?: string;
  border?: string;
};

type FlowShape = 'process' | 'decision' | 'startEnd' | 'document' | 'data' | 'subprocess';
type FlowNode = Node<FlowNodeData, 'flowNode'>;
type FlowEdge = Edge<{ label?: string }, 'smoothstep' | 'step' | 'straight' | 'default'>;
type SaveState = 'idle' | 'saving' | 'saved';
type LayoutDirection = 'leftRight' | 'rightLeft' | 'topBottom' | 'bottomTop';

const SHAPES: Array<{ value: FlowShape; label: string; icon: React.ReactNode }> = [
  { value: 'process', label: '流程', icon: <Square size={15} /> },
  { value: 'decision', label: '判断', icon: <Diamond size={15} /> },
  { value: 'startEnd', label: '开始/结束', icon: <Braces size={15} /> },
  { value: 'document', label: '文档', icon: <FilePlus2 size={15} /> },
  { value: 'data', label: '数据', icon: <Network size={15} /> },
  { value: 'subprocess', label: '子流程', icon: <LayoutGrid size={15} /> },
];

const PALETTES = [
  { name: '蓝', color: '#1d4ed8', fill: '#eff6ff', border: '#93c5fd' },
  { name: '绿', color: '#047857', fill: '#ecfdf5', border: '#6ee7b7' },
  { name: '橙', color: '#b45309', fill: '#fff7ed', border: '#fdba74' },
  { name: '紫', color: '#6d28d9', fill: '#f5f3ff', border: '#c4b5fd' },
  { name: '灰', color: '#334155', fill: '#f8fafc', border: '#cbd5e1' },
];

const TEMPLATES = [
  {
    id: 'basic',
    name: '基础流程',
    description: '开始、处理、判断、结束',
    nodes: [
      createFlowNode('start', '开始', 'startEnd', 80, 120, '准备输入'),
      createFlowNode('collect', '收集信息', 'process', 300, 120, '整理需求、资料和约束'),
      createFlowNode('judge', '是否通过', 'decision', 540, 120, '根据条件选择分支'),
      createFlowNode('done', '完成', 'startEnd', 800, 60, '输出结果'),
      createFlowNode('fix', '补充处理', 'process', 800, 190, '回到上一环节修正'),
    ],
    edges: [
      createFlowEdge('e-start-collect', 'start', 'collect'),
      createFlowEdge('e-collect-judge', 'collect', 'judge'),
      createFlowEdge('e-judge-done', 'judge', 'done', '是'),
      createFlowEdge('e-judge-fix', 'judge', 'fix', '否'),
      createFlowEdge('e-fix-collect', 'fix', 'collect'),
    ],
  },
  {
    id: 'approval',
    name: '审批流',
    description: '提交、审核、驳回、归档',
    nodes: [
      createFlowNode('submit', '提交申请', 'startEnd', 80, 140, '申请人提交材料'),
      createFlowNode('review', '主管审核', 'process', 300, 140, '检查材料完整性'),
      createFlowNode('pass', '审核通过？', 'decision', 540, 140, '判断是否满足审批标准'),
      createFlowNode('archive', '归档生效', 'document', 780, 70, '生成记录并通知相关人员'),
      createFlowNode('reject', '退回修改', 'process', 780, 210, '补充材料后重新提交'),
    ],
    edges: [
      createFlowEdge('e-submit-review', 'submit', 'review'),
      createFlowEdge('e-review-pass', 'review', 'pass'),
      createFlowEdge('e-pass-archive', 'pass', 'archive', '通过'),
      createFlowEdge('e-pass-reject', 'pass', 'reject', '驳回'),
      createFlowEdge('e-reject-submit', 'reject', 'submit', '重提'),
    ],
  },
  {
    id: 'swimlane',
    name: '跨部门协作',
    description: '需求、执行、验收协作流程',
    nodes: [
      createFlowNode('demand', '业务提出需求', 'document', 80, 80, '明确目标和范围'),
      createFlowNode('analysis', '产品分析', 'process', 310, 80, '拆解场景和优先级'),
      createFlowNode('dev', '研发实现', 'subprocess', 540, 80, '设计、开发、联调'),
      createFlowNode('qa', '测试验收', 'decision', 770, 80, '验证是否达标'),
      createFlowNode('release', '发布上线', 'startEnd', 1000, 30, '完成交付'),
      createFlowNode('rework', '问题修复', 'process', 1000, 160, '回流修复后复测'),
    ],
    edges: [
      createFlowEdge('e-demand-analysis', 'demand', 'analysis'),
      createFlowEdge('e-analysis-dev', 'analysis', 'dev'),
      createFlowEdge('e-dev-qa', 'dev', 'qa'),
      createFlowEdge('e-qa-release', 'qa', 'release', '通过'),
      createFlowEdge('e-qa-rework', 'qa', 'rework', '不通过'),
      createFlowEdge('e-rework-dev', 'rework', 'dev'),
    ],
  },
];

const nodeTypes = { flowNode: FlowNodeView };

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createFlowNode(
  id: string,
  label: string,
  shape: FlowShape,
  x: number,
  y: number,
  description = '',
  palette = PALETTES[0]
): FlowNode {
  return {
    id,
    type: 'flowNode',
    position: { x, y },
    data: {
      label,
      description,
      shape,
      color: palette.color,
      fill: palette.fill,
      border: palette.border,
    },
  };
}

function createFlowEdge(id: string, source: string, target: string, label = ''): FlowEdge {
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    label,
    data: { label },
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    style: { stroke: '#64748b', strokeWidth: 1.8 },
    labelStyle: { fill: '#334155', fontWeight: 600 },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
  };
}

function createDefaultDocument(title = '业务流程图'): FlowchartDocumentRecord {
  const template = TEMPLATES[0];
  const now = new Date().toISOString();
  return {
    id: createId('flowchart'),
    title,
    nodes: template.nodes,
    edges: template.edges,
    viewport: { x: 40, y: 120, zoom: 0.9 },
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeNodes(value: unknown): FlowNode[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is FlowNode => Boolean(item && typeof item === 'object' && 'id' in item))
    .map((node) => ({
      ...node,
      type: 'flowNode',
      data: {
        label: String((node.data as FlowNodeData | undefined)?.label || '节点'),
        description: String((node.data as FlowNodeData | undefined)?.description || ''),
        shape: ((node.data as FlowNodeData | undefined)?.shape || 'process') as FlowShape,
        color: String((node.data as FlowNodeData | undefined)?.color || '#1d4ed8'),
        fill: String((node.data as FlowNodeData | undefined)?.fill || '#eff6ff'),
        border: String((node.data as FlowNodeData | undefined)?.border || '#93c5fd'),
      },
    }));
}

function normalizeEdges(value: unknown): FlowEdge[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is FlowEdge => Boolean(item && typeof item === 'object' && 'id' in item && 'source' in item && 'target' in item))
    .map((edge) => ({
      ...edge,
      type: (edge.type as FlowEdge['type']) || 'smoothstep',
      data: { label: String((edge.data as { label?: string } | undefined)?.label || edge.label || '') },
      label: String((edge.data as { label?: string } | undefined)?.label || edge.label || ''),
      markerEnd: edge.markerEnd || { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      style: edge.style || { stroke: '#64748b', strokeWidth: 1.8 },
    }));
}

function normalizeDocuments(saved?: FlowchartToolData): { documents: FlowchartDocumentRecord[]; activeId: string } {
  const now = new Date().toISOString();
  const docs = Array.isArray(saved?.documents)
    ? saved.documents
        .filter((item) => item && item.id)
        .map((doc) => ({
          ...doc,
          title: doc.title || '未命名流程图',
          nodes: normalizeNodes(doc.nodes),
          edges: normalizeEdges(doc.edges),
          viewport: doc.viewport || { x: 0, y: 0, zoom: 1 },
          createdAt: doc.createdAt || now,
          updatedAt: doc.updatedAt || now,
        }))
    : [];
  const documents = docs.length ? docs : [createDefaultDocument()];
  const activeId = saved?.activeId && documents.some((doc) => doc.id === saved.activeId) ? saved.activeId : documents[0].id;
  return { documents, activeId };
}

function safeFileName(name: string) {
  return (name || '流程图').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

function downloadText(content: string, fileName: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, fileName);
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function downloadUrl(url: string, fileName: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsText(file);
  });
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

function FlowchartToolInner() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateFlowchartData } = useToolDataStore();
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const documentsRef = useRef<FlowchartDocumentRecord[]>([]);
  const nodesRef = useRef<FlowNode[]>([]);
  const edgesRef = useRef<FlowEdge[]>([]);
  const pendingPersistRef = useRef<{ documents: FlowchartDocumentRecord[]; activeId: string | null } | null>(null);
  const initializedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const reactFlow = useReactFlow<FlowNode, FlowEdge>();

  const [documents, setDocuments] = useState<FlowchartDocumentRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [message, setMessage] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'node' | 'edge' | 'file'>('node');
  const [edgeDraft, setEdgeDraft] = useState({ label: '', type: 'smoothstep' as FlowEdge['type'] });

  const activeDocument = useMemo(
    () => documents.find((doc) => doc.id === activeId) || documents[0] || null,
    [activeId, documents]
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) || null,
    [edges, selectedEdgeId]
  );
  const selectedEdgeDraftLabel = selectedEdge ? String(selectedEdge.data?.label || selectedEdge.label || '') : '';
  const selectedEdgeDraftType = selectedEdge?.type || 'smoothstep';

  useEffect(() => {
    if (!loaded) void loadData();
  }, [loadData, loaded]);

  useEffect(() => {
    if (!loaded || initializedRef.current) return;
    const normalized = normalizeDocuments(data.flowchart);
    initializedRef.current = true;
    documentsRef.current = normalized.documents;
    activeIdRef.current = normalized.activeId;
    setDocuments(normalized.documents);
    setActiveId(normalized.activeId);
  }, [data.flowchart, loaded]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    if (!activeId) return;
    const currentDocument = documentsRef.current.find((item) => item.id === activeId);
    if (!currentDocument) return;
    setNodes(normalizeNodes(currentDocument.nodes));
    setEdges(normalizeEdges(currentDocument.edges));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    window.requestAnimationFrame(() => {
      if (currentDocument.viewport) {
        reactFlow.setViewport(currentDocument.viewport as { x: number; y: number; zoom: number });
      } else {
        reactFlow.fitView({ padding: 0.2, duration: 200 });
      }
    });
  }, [activeId, reactFlow, setEdges, setNodes]);

  const flushFlowchartPersist = useCallback(() => {
    const pending = pendingPersistRef.current;
    if (!pending) return;
    pendingPersistRef.current = null;
    updateFlowchartData({
      version: TOOL_VERSION,
      activeId: pending.activeId,
      documents: pending.documents,
    });
  }, [updateFlowchartData]);

  const persistDocuments = useCallback(
    (nextDocuments: FlowchartDocumentRecord[], nextActiveId: string | null, delay = 300) => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      pendingPersistRef.current = { documents: nextDocuments, activeId: nextActiveId };
      if (delay <= 0) {
        flushFlowchartPersist();
        return;
      }
      persistTimerRef.current = window.setTimeout(() => {
        flushFlowchartPersist();
      }, delay);
    },
    [flushFlowchartPersist]
  );

  const commitDocuments = useCallback(
    (
      updater: (current: FlowchartDocumentRecord[]) => FlowchartDocumentRecord[],
      nextActiveId = activeIdRef.current,
      delay = 300
    ) => {
      setDocuments((current) => {
        const next = updater(current);
        documentsRef.current = next;
        persistDocuments(next, nextActiveId, delay);
        return next;
      });
    },
    [persistDocuments]
  );

  const saveSnapshot = useCallback(
    (nextNodes = nodes, nextEdges = edges, delay = 300) => {
      const id = activeIdRef.current;
      if (!id) return;
      const viewport = reactFlow.getViewport();
      const now = new Date().toISOString();
      setSaveState('saving');
      commitDocuments(
        (current) =>
          current.map((doc) =>
            doc.id === id
              ? {
                  ...doc,
                  nodes: nextNodes,
                  edges: nextEdges,
                  viewport,
                  updatedAt: now,
                }
              : doc
          ),
        id,
        delay
      );
      window.setTimeout(() => setSaveState('saved'), delay + 120);
    },
    [commitDocuments, edges, nodes, reactFlow]
  );

  useEffect(() => {
    return () => {
      const id = activeIdRef.current;
      if (!id) {
        if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
        flushFlowchartPersist();
        return;
      }
      const viewport = reactFlow.getViewport();
      const now = new Date().toISOString();
      const nextDocuments = documentsRef.current.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              nodes: nodesRef.current,
              edges: edgesRef.current,
              viewport,
              updatedAt: now,
            }
          : doc
      );
      documentsRef.current = nextDocuments;
      pendingPersistRef.current = { documents: nextDocuments, activeId: id };
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      flushFlowchartPersist();
    };
  }, [flushFlowchartPersist, reactFlow]);

  const updateNodesAndSave = useCallback(
    (updater: (current: FlowNode[]) => FlowNode[]) => {
      setNodes((current) => {
        const next = updater(current);
        saveSnapshot(next, edges);
        return next;
      });
    },
    [edges, saveSnapshot]
  );

  const updateEdgesAndSave = useCallback(
    (updater: (current: FlowEdge[]) => FlowEdge[]) => {
      setEdges((current) => {
        const next = updater(current);
        saveSnapshot(nodes, next);
        return next;
      });
    },
    [nodes, saveSnapshot]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        saveSnapshot(next, edges, 500);
        return next;
      });
    },
    [edges, saveSnapshot]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      setEdges((current) => {
        const next = applyEdgeChanges(changes, current);
        saveSnapshot(nodes, next, 500);
        return next;
      });
    },
    [nodes, saveSnapshot]
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const edge = createFlowEdge(createId('edge'), connection.source || '', connection.target || '');
      edge.sourceHandle = connection.sourceHandle;
      edge.targetHandle = connection.targetHandle;
      setEdges((current) => {
        const next = addEdge(edge, current) as FlowEdge[];
        saveSnapshot(nodes, next, 250);
        return next;
      });
    },
    [nodes, saveSnapshot]
  );

  const addNode = useCallback(
    (shape: FlowShape = 'process') => {
      const center = reactFlow.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const shapeConfig = SHAPES.find((item) => item.value === shape);
      const node = createFlowNode(createId('node'), shapeConfig?.label || '流程节点', shape, center.x - 90, center.y - 45);
      updateNodesAndSave((current) => [...current, node]);
      setSelectedNodeId(node.id);
      setSidebarTab('node');
    },
    [reactFlow, updateNodesAndSave]
  );

  const deleteSelection = useCallback(() => {
    if (selectedNodeId) {
      const nextNodes = nodes.filter((node) => node.id !== selectedNodeId);
      const nextEdges = edges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelectedNodeId(null);
      saveSnapshot(nextNodes, nextEdges, 0);
      return;
    }
    if (selectedEdgeId) {
      const nextEdges = edges.filter((edge) => edge.id !== selectedEdgeId);
      setEdges(nextEdges);
      setSelectedEdgeId(null);
      saveSnapshot(nodes, nextEdges, 0);
    }
  }, [edges, nodes, saveSnapshot, selectedEdgeId, selectedNodeId]);

  const duplicateNode = useCallback(() => {
    if (!selectedNode) return;
    const node: FlowNode = {
      ...selectedNode,
      id: createId('node'),
      selected: false,
      position: { x: selectedNode.position.x + 36, y: selectedNode.position.y + 36 },
      data: { ...selectedNode.data, label: `${selectedNode.data.label} 副本` },
    };
    updateNodesAndSave((current) => [...current, node]);
    setSelectedNodeId(node.id);
  }, [selectedNode, updateNodesAndSave]);

  const updateSelectedNodeData = useCallback(
    (patch: Partial<FlowNodeData>) => {
      if (!selectedNodeId) return;
      updateNodesAndSave((current) =>
        current.map((node) => (node.id === selectedNodeId ? { ...node, data: { ...node.data, ...patch } } : node))
      );
    },
    [selectedNodeId, updateNodesAndSave]
  );

  const updateSelectedNodePosition = useCallback(
    (axis: 'x' | 'y', value: number) => {
      if (!selectedNodeId) return;
      updateNodesAndSave((current) =>
        current.map((node) =>
          node.id === selectedNodeId
            ? {
                ...node,
                position: {
                  ...node.position,
                  [axis]: Number.isFinite(value) ? value : node.position[axis],
                },
              }
            : node
        )
      );
    },
    [selectedNodeId, updateNodesAndSave]
  );

  const applyEdgeDraft = useCallback(() => {
    if (!selectedEdgeId) return;
    updateEdgesAndSave((current) =>
      current.map((edge) =>
        edge.id === selectedEdgeId
          ? {
              ...edge,
              type: edgeDraft.type,
              label: edgeDraft.label,
              data: { ...edge.data, label: edgeDraft.label },
            }
          : edge
      )
    );
  }, [edgeDraft, selectedEdgeId, updateEdgesAndSave]);

  useEffect(() => {
    if (!selectedEdgeId) {
      setEdgeDraft({ label: '', type: 'smoothstep' });
      return;
    }
    setEdgeDraft({
      label: selectedEdgeDraftLabel,
      type: selectedEdgeDraftType,
    });
  }, [selectedEdgeDraftLabel, selectedEdgeDraftType, selectedEdgeId]);

  const renameDocument = useCallback(
    (title: string) => {
      const id = activeIdRef.current;
      if (!id) return;
      commitDocuments(
        (current) =>
          current.map((doc) => (doc.id === id ? { ...doc, title: title.trim() || '未命名流程图', updatedAt: new Date().toISOString() } : doc)),
        id
      );
    },
    [commitDocuments]
  );

  const switchDocument = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      saveSnapshot(nodes, edges, 0);
      activeIdRef.current = id;
      setActiveId(id);
      persistDocuments(documentsRef.current, id, 0);
    },
    [edges, nodes, persistDocuments, saveSnapshot]
  );

  const createNewDocument = useCallback(
    (templateId?: string) => {
      saveSnapshot(nodes, edges, 0);
      const template = TEMPLATES.find((item) => item.id === templateId);
      const doc = createDefaultDocument(template?.name || '未命名流程图');
      if (template) {
        doc.nodes = template.nodes.map((node) => ({ ...node, id: createId('node'), data: { ...node.data }, position: { ...node.position } }));
        const idMap = new Map(template.nodes.map((node, index) => [node.id, String((doc.nodes[index] as FlowNode | undefined)?.id || node.id)]));
        doc.edges = template.edges.map((edge) => ({
          ...edge,
          id: createId('edge'),
          source: idMap.get(edge.source) || edge.source,
          target: idMap.get(edge.target) || edge.target,
          data: { ...edge.data },
        }));
      }
      activeIdRef.current = doc.id;
      setActiveId(doc.id);
      commitDocuments((current) => [doc, ...current], doc.id, 0);
    },
    [commitDocuments, edges, nodes, saveSnapshot]
  );

  const duplicateDocument = useCallback(() => {
    if (!activeDocument) return;
    saveSnapshot(nodes, edges, 0);
    const now = new Date().toISOString();
    const doc: FlowchartDocumentRecord = {
      ...activeDocument,
      id: createId('flowchart'),
      title: `${activeDocument.title} 副本`,
      nodes: nodes.map((node) => ({ ...node, data: { ...node.data }, position: { ...node.position } })),
      edges: edges.map((edge) => ({ ...edge, data: { ...edge.data } })),
      viewport: reactFlow.getViewport(),
      createdAt: now,
      updatedAt: now,
    };
    activeIdRef.current = doc.id;
    setActiveId(doc.id);
    commitDocuments((current) => [doc, ...current], doc.id, 0);
  }, [activeDocument, commitDocuments, edges, nodes, reactFlow, saveSnapshot]);

  const deleteDocument = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const rest = documentsRef.current.filter((doc) => doc.id !== id);
    const nextDocuments = rest.length ? rest : [createDefaultDocument('未命名流程图')];
    const nextActiveId = nextDocuments[0].id;
    documentsRef.current = nextDocuments;
    activeIdRef.current = nextActiveId;
    setDocuments(nextDocuments);
    setActiveId(nextActiveId);
    persistDocuments(nextDocuments, nextActiveId, 0);
  }, [persistDocuments]);

  const importFile = useCallback(
    async (file: File) => {
      try {
        const parsed = JSON.parse(await readFileAsText(file));
        const now = new Date().toISOString();
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.documents)) {
          const restored = normalizeDocuments(parsed as FlowchartToolData);
          documentsRef.current = restored.documents;
          activeIdRef.current = restored.activeId;
          setDocuments(restored.documents);
          setActiveId(restored.activeId);
          persistDocuments(restored.documents, restored.activeId, 0);
          setMessage(`已恢复备份：${file.name}`);
          return;
        }
        const doc: FlowchartDocumentRecord = {
          id: createId('flowchart'),
          title: String(parsed.title || file.name.replace(/\.[^.]+$/, '') || '导入流程图'),
          nodes: normalizeNodes(parsed.nodes),
          edges: normalizeEdges(parsed.edges),
          viewport: parsed.viewport || { x: 0, y: 0, zoom: 1 },
          createdAt: now,
          updatedAt: now,
        };
        activeIdRef.current = doc.id;
        setActiveId(doc.id);
        commitDocuments((current) => [doc, ...current], doc.id, 0);
        setMessage(`已导入：${file.name}`);
      } catch (error) {
        setMessage(`导入失败：${String(error)}`);
      }
    },
    [commitDocuments, persistDocuments]
  );

  const handleImport = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void importFile(file);
    },
    [importFile]
  );

  const exportJson = useCallback(() => {
    const doc = {
      ...(activeDocument || createDefaultDocument()),
      nodes,
      edges,
      viewport: reactFlow.getViewport(),
      updatedAt: new Date().toISOString(),
    };
    downloadText(JSON.stringify(doc, null, 2), `${safeFileName(doc.title)}.json`);
    setMessage('已导出当前流程图 JSON');
  }, [activeDocument, edges, nodes, reactFlow]);

  const exportBackup = useCallback(() => {
    const id = activeIdRef.current;
    const viewport = reactFlow.getViewport();
    const now = new Date().toISOString();
    const nextDocuments = documentsRef.current.map((doc) =>
      doc.id === id ? { ...doc, nodes, edges, viewport, updatedAt: now } : doc
    );
    persistDocuments(nextDocuments, id, 0);
    downloadText(JSON.stringify({ version: TOOL_VERSION, activeId: id, documents: nextDocuments }, null, 2), `flowcharts-${Date.now()}.json`);
    setMessage('已导出全部流程图备份');
  }, [edges, nodes, persistDocuments, reactFlow]);

  const exportImage = useCallback(
    async (type: 'png' | 'svg') => {
      const root = flowWrapperRef.current?.querySelector('.react-flow') as HTMLElement | null;
      if (!root || !activeDocument) return;
      try {
        const dataUrl =
          type === 'png'
            ? await toPng(root, { cacheBust: true, pixelRatio: 2, backgroundColor: '#f8fafc' })
            : await toSvg(root, { cacheBust: true, backgroundColor: '#f8fafc' });
        downloadUrl(dataUrl, `${safeFileName(activeDocument.title)}.${type}`);
        setMessage(`已导出 ${type.toUpperCase()}`);
      } catch (error) {
        setMessage(`导出失败：${String(error)}`);
      }
    },
    [activeDocument]
  );

  const autoLayout = useCallback(
    (direction: LayoutDirection) => {
      const levels = new Map<string, number>();
      const indegree = new Map(nodes.map((node) => [node.id, 0]));
      edges.forEach((edge) => indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1));
      const queue = nodes.filter((node) => (indegree.get(node.id) || 0) === 0).map((node) => node.id);
      queue.forEach((id) => levels.set(id, 0));
      for (let i = 0; i < queue.length; i += 1) {
        const id = queue[i];
        const level = levels.get(id) || 0;
        edges
          .filter((edge) => edge.source === id)
          .forEach((edge) => {
            indegree.set(edge.target, (indegree.get(edge.target) || 1) - 1);
            levels.set(edge.target, Math.max(level + 1, levels.get(edge.target) || 0));
            if ((indegree.get(edge.target) || 0) <= 0) queue.push(edge.target);
          });
      }
      nodes.forEach((node) => {
        if (!levels.has(node.id)) levels.set(node.id, 0);
      });
      const maxLevel = Math.max(0, ...Array.from(levels.values()));
      const buckets = new Map<number, FlowNode[]>();
      nodes.forEach((node) => {
        const level = levels.get(node.id) || 0;
        buckets.set(level, [...(buckets.get(level) || []), node]);
      });
      const nextNodes = nodes.map((node) => {
        const rawLevel = levels.get(node.id) || 0;
        const level = direction === 'rightLeft' || direction === 'bottomTop' ? maxLevel - rawLevel : rawLevel;
        const siblings = buckets.get(rawLevel) || [];
        const index = siblings.findIndex((item) => item.id === node.id);
        const isHorizontal = direction === 'leftRight' || direction === 'rightLeft';
        return {
          ...node,
          position: isHorizontal
            ? { x: 100 + level * 250, y: 80 + index * 150 }
            : { x: 100 + index * 250, y: 80 + level * 150 },
        };
      });
      setNodes(nextNodes);
      saveSnapshot(nextNodes, edges, 0);
      window.requestAnimationFrame(() => reactFlow.fitView({ padding: 0.18, duration: 260 }));
    },
    [edges, nodes, reactFlow, saveSnapshot]
  );

  const saveLabel = saveState === 'saving' ? '保存中' : saveState === 'saved' ? '已保存' : '待编辑';

  if (!ready || !loaded) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🔀"
        title="流程图"
        subtitle="基于 React Flow / XYFlow，支持节点连线、模板、自动布局、导入导出和本地保存"
        actions={
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{saveLabel}</span>
            <button
              className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              title="保存"
              onClick={() => saveSnapshot(nodes, edges, 0)}
            >
              <Save size={15} />
            </button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-slate-200 p-3 dark:border-gray-800">
            <div className="flex gap-2">
              <button className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700" onClick={() => createNewDocument()}>
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
              <input ref={fileInputRef} className="hidden" type="file" accept=".json" onChange={handleImport} />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-2">
              {documents.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => switchDocument(doc.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    doc.id === activeId
                      ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
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
              <button className="rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800" onClick={duplicateDocument}>
                复制
              </button>
              <button className="rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800" onClick={exportBackup}>
                备份
              </button>
              <button className="rounded-md border border-red-200 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30" onClick={deleteDocument}>
                删除
              </button>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
            {SHAPES.map((shape) => (
              <ToolbarButton key={shape.value} title={`添加${shape.label}`} icon={shape.icon} onClick={() => addNode(shape.value)} />
            ))}
            <Divider />
            <ToolbarButton title="复制节点" icon={<Copy size={16} />} disabled={!selectedNode} onClick={duplicateNode} />
            <ToolbarButton title="删除选择" icon={<Trash2 size={16} />} disabled={!selectedNode && !selectedEdge} onClick={deleteSelection} />
            <Divider />
            <ToolbarButton title="左到右排布" icon={<ArrowRight size={16} />} onClick={() => autoLayout('leftRight')} />
            <ToolbarButton title="右到左排布" icon={<ArrowLeft size={16} />} onClick={() => autoLayout('rightLeft')} />
            <ToolbarButton title="上到下排布" icon={<ArrowDown size={16} />} onClick={() => autoLayout('topBottom')} />
            <ToolbarButton title="下到上排布" icon={<ArrowUp size={16} />} onClick={() => autoLayout('bottomTop')} />
            <ToolbarButton title="适应画布" icon={<Maximize2 size={16} />} onClick={() => reactFlow.fitView({ padding: 0.18, duration: 240 })} />
            <div className="ml-auto flex items-center gap-2">
              <button className="rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800" onClick={exportJson}>
                JSON
              </button>
              <button className="rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800" onClick={() => void exportImage('png')}>
                PNG
              </button>
              <button className="rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800" onClick={() => void exportImage('svg')}>
                SVG
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <div ref={flowWrapperRef} className="relative min-w-0 flex-1 bg-slate-100 dark:bg-gray-950">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => {
                  setSelectedNodeId(node.id);
                  setSelectedEdgeId(null);
                  setSidebarTab('node');
                }}
                onEdgeClick={(_, edge) => {
                  setSelectedEdgeId(edge.id);
                  setSelectedNodeId(null);
                  setSidebarTab('edge');
                }}
                onPaneClick={() => {
                  setSelectedNodeId(null);
                  setSelectedEdgeId(null);
                }}
                onMoveEnd={() => saveSnapshot(nodes, edges, 700)}
                fitView
                fitViewOptions={{ padding: 0.18 }}
                defaultEdgeOptions={{
                  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
                  style: { stroke: '#64748b', strokeWidth: 1.8 },
                }}
                connectionLineStyle={{ stroke: '#2563eb', strokeWidth: 2 }}
              >
                <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#cbd5e1" />
                <Controls position="bottom-right" />
                <MiniMap pannable zoomable position="bottom-left" nodeStrokeWidth={3} />
                {message && (
                  <Panel position="top-left">
                    <div className="flex max-w-xl items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-700 shadow-sm dark:border-blue-900 dark:bg-gray-900 dark:text-blue-200">
                      <span className="truncate">{message}</span>
                      <button className="text-blue-500" onClick={() => setMessage('')}>
                        <X size={14} />
                      </button>
                    </div>
                  </Panel>
                )}
              </ReactFlow>
            </div>

            <aside className="flex w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="grid grid-cols-3 border-b border-slate-200 dark:border-gray-800">
                <TabButton active={sidebarTab === 'node'} label="节点" icon={<Square size={15} />} onClick={() => setSidebarTab('node')} />
                <TabButton active={sidebarTab === 'edge'} label="连线" icon={<GitBranch size={15} />} onClick={() => setSidebarTab('edge')} />
                <TabButton active={sidebarTab === 'file'} label="模板" icon={<LayoutGrid size={15} />} onClick={() => setSidebarTab('file')} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {sidebarTab === 'node' && (
                  <PanelBlock title={selectedNode ? '节点属性' : '未选择节点'}>
                    {selectedNode ? (
                      <div className="space-y-3">
                        <Field label="标题">
                          <input value={selectedNode.data.label} onChange={(event) => updateSelectedNodeData({ label: event.target.value })} className={inputClass} />
                        </Field>
                        <Field label="说明">
                          <textarea value={selectedNode.data.description || ''} onChange={(event) => updateSelectedNodeData({ description: event.target.value })} rows={4} className={`${inputClass} resize-none`} />
                        </Field>
                        <Field label="形状">
                          <select value={selectedNode.data.shape || 'process'} onChange={(event) => updateSelectedNodeData({ shape: event.target.value as FlowShape })} className={inputClass}>
                            {SHAPES.map((shape) => (
                              <option key={shape.value} value={shape.value}>
                                {shape.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="X">
                            <input type="number" value={Math.round(selectedNode.position.x)} onChange={(event) => updateSelectedNodePosition('x', Number(event.target.value))} className={inputClass} />
                          </Field>
                          <Field label="Y">
                            <input type="number" value={Math.round(selectedNode.position.y)} onChange={(event) => updateSelectedNodePosition('y', Number(event.target.value))} className={inputClass} />
                          </Field>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {PALETTES.map((palette) => (
                            <button
                              key={palette.name}
                              className="rounded-md border px-2 py-2 text-xs"
                              style={{ borderColor: palette.border, color: palette.color, background: palette.fill }}
                              onClick={() => updateSelectedNodeData({ color: palette.color, fill: palette.fill, border: palette.border })}
                            >
                              {palette.name}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <ColorField label="文字" value={selectedNode.data.color || '#1d4ed8'} onChange={(value) => updateSelectedNodeData({ color: value })} />
                          <ColorField label="填充" value={selectedNode.data.fill || '#eff6ff'} onChange={(value) => updateSelectedNodeData({ fill: value })} />
                          <ColorField label="边框" value={selectedNode.data.border || '#93c5fd'} onChange={(value) => updateSelectedNodeData({ border: value })} />
                        </div>
                      </div>
                    ) : (
                      <EmptyState text="点击节点后可修改标题、形状、颜色和位置。" />
                    )}
                  </PanelBlock>
                )}

                {sidebarTab === 'edge' && (
                  <PanelBlock title={selectedEdge ? '连线属性' : '未选择连线'}>
                    {selectedEdge ? (
                      <div className="space-y-3">
                        <Field label="标签">
                          <input value={edgeDraft.label} onChange={(event) => setEdgeDraft((current) => ({ ...current, label: event.target.value }))} className={inputClass} />
                        </Field>
                        <Field label="类型">
                          <select value={edgeDraft.type || 'smoothstep'} onChange={(event) => setEdgeDraft((current) => ({ ...current, type: event.target.value as FlowEdge['type'] }))} className={inputClass}>
                            <option value="smoothstep">平滑折线</option>
                            <option value="step">直角折线</option>
                            <option value="straight">直线</option>
                            <option value="default">贝塞尔</option>
                          </select>
                        </Field>
                        <button className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700" onClick={applyEdgeDraft}>
                          保存连线
                        </button>
                      </div>
                    ) : (
                      <EmptyState text="点击连线后可修改标签和连线类型。" />
                    )}
                  </PanelBlock>
                )}

                {sidebarTab === 'file' && (
                  <div className="space-y-4">
                    <PanelBlock title="模板">
                      <div className="space-y-2">
                        {TEMPLATES.map((template) => (
                          <button key={template.id} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800" onClick={() => createNewDocument(template.id)}>
                            <div className="text-sm font-medium">{template.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{template.description}</div>
                          </button>
                        ))}
                      </div>
                    </PanelBlock>
                    <PanelBlock title="导入导出">
                      <div className="grid grid-cols-2 gap-2">
                        <ActionButton icon={<Upload size={15} />} label="导入 JSON" onClick={() => fileInputRef.current?.click()} />
                        <ActionButton icon={<Download size={15} />} label="导出 JSON" onClick={exportJson} />
                        <ActionButton icon={<ImageIcon size={15} />} label="导出 PNG" onClick={() => void exportImage('png')} />
                        <ActionButton icon={<ImageIcon size={15} />} label="导出 SVG" onClick={() => void exportImage('svg')} />
                      </div>
                    </PanelBlock>
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

export default function FlowchartTool() {
  return (
    <ReactFlowProvider>
      <FlowchartToolInner />
    </ReactFlowProvider>
  );
}

function FlowNodeView({ data, selected }: NodeProps<FlowNode>) {
  const shape = data.shape || 'process';
  const style: CSSProperties = {
    color: data.color || '#1d4ed8',
    background: data.fill || '#eff6ff',
    borderColor: selected ? '#2563eb' : data.border || '#93c5fd',
  };
  return (
    <div className={`min-w-[160px] max-w-[240px] border-2 px-4 py-3 text-center shadow-sm ${shapeClass(shape)}`} style={style}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-blue-500" />
      <div className="whitespace-pre-wrap break-words text-sm font-semibold leading-snug">{data.label || '节点'}</div>
      {data.description && <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed opacity-75">{data.description}</div>}
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-blue-500" />
    </div>
  );
}

function shapeClass(shape: FlowShape) {
  switch (shape) {
    case 'decision':
      return 'rotate-45 rounded-md [&>*]:-rotate-45';
    case 'startEnd':
      return 'rounded-full';
    case 'document':
      return 'rounded-md [clip-path:polygon(0_0,100%_0,100%_85%,75%_100%,50%_85%,25%_100%,0_85%)]';
    case 'data':
      return 'rounded-md skew-x-[-10deg] [&>*]:skew-x-[10deg]';
    case 'subprocess':
      return 'rounded-md border-double border-4';
    default:
      return 'rounded-md';
  }
}

const inputClass =
  'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950';

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

function PanelBlock({ title, children }: { title: string; children: React.ReactNode }) {
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
      <input value={value} onChange={(event) => onChange(event.target.value)} type="color" className="h-9 w-full rounded-md border border-slate-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-950" />
    </Field>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 py-2 text-sm text-slate-700 transition hover:bg-slate-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
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
