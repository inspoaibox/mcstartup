import { useEffect, useMemo, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { invoke } from '@tauri-apps/api/tauri';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { format } from 'sql-formatter';
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  FilePlus2,
  FolderOpen,
  ListPlus,
  Network,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Table2,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type * as monaco from 'monaco-editor';
import ToolHeader from './ToolHeader';
import { EmptyState, StatusMessage, ToolbarButton } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';

type DatabaseKind = 'sqlite' | 'postgresql' | 'mysql' | 'redis' | 'mongodb';

interface DatabaseConnectionDraft {
  id: string;
  name: string;
  kind: DatabaseKind;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  filePath: string;
  url: string;
  savePassword: boolean;
}

interface DatabaseColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string;
  primaryKey: boolean;
  foreignKey?: {
    table: string;
    schema: string;
    column: string;
  } | null;
}

interface DatabaseSchemaObject {
  id: string;
  name: string;
  schema: string;
  objectType: string;
  rowCount?: number | null;
  columns: DatabaseColumnInfo[];
}

interface DatabaseSchemaGroup {
  id: string;
  name: string;
  groupType: string;
  objects: DatabaseSchemaObject[];
}

interface DatabaseSchemaResult {
  summary: Array<{ label: string; value: string }>;
  groups: DatabaseSchemaGroup[];
  message: string;
}

interface DatabaseQueryResult {
  columns: string[];
  rows: string[][];
  nullCells: boolean[][];
  affectedRows: number;
  durationMs: number;
  rowCount: number;
  totalRows?: number | null;
  truncated: boolean;
  message: string;
}

interface DatabaseCellValue {
  column: string;
  value: string;
  isNull: boolean;
}

interface EditingCell {
  rowIndex: number;
  column: string;
  oldValue: string;
  oldValueIsNull: boolean;
  value: string;
  isNull: boolean;
  nullable: boolean;
  dataType: string;
  key: DatabaseCellValue[];
}

interface InsertRowDraft {
  values: Record<string, InsertCellDraft>;
}

interface InsertCellDraft {
  value: string;
  isNull: boolean;
  include: boolean;
}

interface TableBrowseState {
  pageIndex: number;
  pageSize: number;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  filters: Record<string, string>;
}

interface DatabaseTestResult {
  ok: boolean;
  databaseVersion: string;
  latencyMs: number;
  message: string;
}

const STORAGE_KEY = 'mcstartup.database-manager.connections.v1';
const HISTORY_STORAGE_KEY = 'mcstartup.database-manager.history.v1';
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

interface QueryHistoryItem {
  id: string;
  connectionName: string;
  kind: DatabaseKind;
  query: string;
  createdAt: string;
  durationMs: number;
  rowCount: number;
}

const KIND_OPTIONS: Array<{
  value: DatabaseKind;
  label: string;
  port: number;
  accent: string;
}> = [
  { value: 'sqlite', label: 'SQLite', port: 0, accent: 'bg-sky-500' },
  { value: 'postgresql', label: 'PostgreSQL', port: 5432, accent: 'bg-blue-600' },
  { value: 'mysql', label: 'MySQL', port: 3306, accent: 'bg-orange-500' },
  { value: 'redis', label: 'Redis', port: 6379, accent: 'bg-red-500' },
  { value: 'mongodb', label: 'MongoDB', port: 27017, accent: 'bg-emerald-600' },
];

function createConnection(kind: DatabaseKind = 'sqlite'): DatabaseConnectionDraft {
  const option = KIND_OPTIONS.find((item) => item.value === kind) || KIND_OPTIONS[0];
  return {
    id: `db-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: option.label,
    kind,
    host: kind === 'sqlite' ? '' : '127.0.0.1',
    port: option.port,
    username: '',
    password: '',
    database: kind === 'redis' ? '0' : '',
    filePath: '',
    url: '',
    savePassword: false,
  };
}

function connectionToPayload(connection: DatabaseConnectionDraft) {
  return {
    kind: connection.kind,
    name: connection.name,
    host: connection.host,
    port: connection.port || null,
    username: connection.username,
    password: connection.password,
    database: connection.database,
    filePath: connection.filePath,
    url: connection.url,
  };
}

function persistableConnection(connection: DatabaseConnectionDraft): DatabaseConnectionDraft {
  return {
    ...connection,
    password: connection.savePassword ? connection.password : '',
  };
}

function loadConnections(): DatabaseConnectionDraft[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [createConnection('sqlite')];
    const parsed = JSON.parse(raw) as DatabaseConnectionDraft[];
    return parsed.length > 0 ? parsed : [createConnection('sqlite')];
  } catch {
    return [createConnection('sqlite')];
  }
}

function saveConnections(connections: DatabaseConnectionDraft[]) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(connections.map((connection) => persistableConnection(connection)))
  );
}

function loadHistory(): QueryHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueryHistoryItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(items: QueryHistoryItem[]) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items.slice(0, 80)));
}

function kindLabel(kind: DatabaseKind) {
  return KIND_OPTIONS.find((item) => item.value === kind)?.label || kind;
}

function defaultQueryFor(
  connection: DatabaseConnectionDraft,
  object?: DatabaseSchemaObject | null
) {
  if (connection.kind === 'redis') return object ? `GET "${object.name}"` : 'KEYS *';
  if (connection.kind === 'mongodb') return '{}';
  if (!object) return 'select 1;';
  if (connection.kind === 'postgresql') {
    const table = object.schema ? `"${object.schema}"."${object.name}"` : `"${object.name}"`;
    return `select * from ${table} limit 100;`;
  }
  if (connection.kind === 'mysql') return `select * from \`${object.name}\` limit 100;`;
  return `select * from "${object.name.replace(/"/g, '""')}" limit 100;`;
}

function isSqlKind(kind: DatabaseKind) {
  return kind === 'sqlite' || kind === 'postgresql' || kind === 'mysql';
}

function editorLanguage(kind: DatabaseKind) {
  if (kind === 'redis') return 'shell';
  if (kind === 'mongodb') return 'json';
  return 'sql';
}

function dangerousQueryReason(kind: DatabaseKind, query: string) {
  const text = query.trim().toLowerCase();
  if (!text) return '';
  if (kind === 'redis') {
    const command = query.trim().split(/\s+/)[0]?.toUpperCase();
    if (
      [
        'DEL',
        'UNLINK',
        'FLUSHALL',
        'FLUSHDB',
        'SET',
        'MSET',
        'HSET',
        'HMSET',
        'SADD',
        'ZADD',
        'LPUSH',
        'RPUSH',
        'LPOP',
        'RPOP',
        'EXPIRE',
        'PERSIST',
        'RENAME',
        'RENAMENX',
        'EVAL',
        'EVALSHA',
        'CONFIG',
        'SHUTDOWN',
      ].includes(command)
    ) {
      return `Redis ${command} 会修改或删除数据`;
    }
    return '';
  }
  if (kind === 'mongodb') return '';
  const normalized = text.replace(/\s+/g, ' ');
  const firstWord = normalized.split(/[;\s]/).find(Boolean) || '';
  if (
    [
      'insert',
      'update',
      'delete',
      'replace',
      'merge',
      'drop',
      'truncate',
      'alter',
      'create',
      'rename',
      'grant',
      'revoke',
      'vacuum',
      'analyze',
      'reindex',
      'call',
      'execute',
      'exec',
    ].includes(firstWord)
  ) {
    return `${firstWord.toUpperCase()} 语句会修改数据或结构`;
  }
  if (/;\s*(drop|truncate|delete|update|alter)\s/.test(normalized)) {
    return '检测到多语句中的高风险操作';
  }
  return '';
}

function chartData(result: DatabaseQueryResult | null) {
  if (!result || result.columns.length < 2 || result.rows.length === 0) return null;
  const numericIndex = result.columns.findIndex((_, index) =>
    result.rows.some((row) => Number.isFinite(Number(row[index])))
  );
  if (numericIndex < 0) return null;
  const labelIndex = result.columns.findIndex((_, index) => index !== numericIndex) || 0;
  return {
    nameKey: result.columns[labelIndex],
    valueKey: result.columns[numericIndex],
    rows: result.rows.slice(0, 40).map((row, index) => ({
      name: row[labelIndex] || String(index + 1),
      value: Number(row[numericIndex]) || 0,
    })),
  };
}

function buildCompletionWords(schema: DatabaseSchemaResult | null) {
  const words = new Set<string>();
  for (const keyword of [
    'select',
    'from',
    'where',
    'join',
    'left join',
    'group by',
    'order by',
    'limit',
    'insert',
    'update',
    'delete',
    'create',
    'alter',
    'drop',
  ]) {
    words.add(keyword);
  }
  for (const group of schema?.groups || []) {
    for (const object of group.objects) {
      words.add(object.name);
      if (object.schema) words.add(object.schema);
      for (const column of object.columns) {
        words.add(column.name);
      }
    }
  }
  return Array.from(words).filter(Boolean).sort();
}

function erGraph(schema: DatabaseSchemaResult | null): { nodes: Node[]; edges: Edge[] } {
  const tables =
    schema?.groups
      .flatMap((group) => group.objects)
      .filter((object) => object.objectType === 'table' && object.columns.length > 0) || [];
  const nodes: Node[] = tables.slice(0, 60).map((table, index) => ({
    id: table.id,
    position: {
      x: (index % 4) * 240,
      y: Math.floor(index / 4) * 170,
    },
    data: {
      label: `${table.schema ? `${table.schema}.` : ''}${table.name}\n${table.columns
        .slice(0, 6)
        .map((column) => `${column.primaryKey ? 'PK ' : ''}${column.name}`)
        .join('\n')}`,
    },
    style: {
      width: 210,
      whiteSpace: 'pre-line',
      border: '1px solid #d1d5db',
      borderRadius: 8,
      padding: 10,
      fontSize: 11,
      textAlign: 'left',
      background: '#ffffff',
      color: '#111827',
    },
  }));
  const edges: Edge[] = [];
  const tableByName = new Map(
    tables.map((table) => [`${table.schema || ''}.${table.name}`.toLowerCase(), table])
  );
  for (const table of tables) {
    for (const column of table.columns.filter((column) => column.foreignKey)) {
      const foreignKey = column.foreignKey;
      if (!foreignKey) continue;
      const target =
        tableByName.get(`${foreignKey.schema || ''}.${foreignKey.table}`.toLowerCase()) ||
        tables.find((candidate) => candidate.name.toLowerCase() === foreignKey.table.toLowerCase());
      if (target) {
        edges.push({
          id: `${table.id}-${column.name}-${target.id}`,
          source: table.id,
          target: target.id,
          label: `${column.name} -> ${foreignKey.column}`,
          animated: false,
          style: { stroke: '#2563eb' },
        });
      }
    }
    for (const column of table.columns.filter(
      (column) => !column.foreignKey && /(^|_)id$/i.test(column.name) && !column.primaryKey
    )) {
      const base = column.name.replace(/_?id$/i, '').toLowerCase();
      const target = tables.find(
        (candidate) =>
          candidate.id !== table.id &&
          (candidate.name.toLowerCase() === base ||
            candidate.name.toLowerCase() === `${base}s` ||
            candidate.name.toLowerCase().replace(/s$/, '') === base)
      );
      if (target) {
        edges.push({
          id: `${table.id}-${column.name}-${target.id}`,
          source: table.id,
          target: target.id,
          label: column.name,
          animated: false,
          style: { stroke: '#2563eb' },
        });
      }
    }
  }
  return { nodes, edges };
}

function createTableBrowseState(): TableBrowseState {
  return {
    pageIndex: 0,
    pageSize: 100,
    sortColumn: '',
    sortDirection: 'asc',
    filters: {},
  };
}

function primaryKeyColumns(object: DatabaseSchemaObject | null) {
  return object?.columns.filter((column) => column.primaryKey).map((column) => column.name) || [];
}

function keyLabel(key: DatabaseCellValue[]) {
  return key.map((cell) => `${cell.column} = ${cell.isNull ? 'NULL' : cell.value}`).join(', ');
}

function displayCellValue(value: string, isNull: boolean) {
  return isNull ? 'NULL' : value;
}

export default function DatabaseManagerTool() {
  const ready = useToolTheme();
  const [connections, setConnections] = useState<DatabaseConnectionDraft[]>(() =>
    loadConnections()
  );
  const [activeId, setActiveId] = useState(() => connections[0]?.id || '');
  const [schema, setSchema] = useState<DatabaseSchemaResult | null>(null);
  const [selectedObject, setSelectedObject] = useState<DatabaseSchemaObject | null>(null);
  const [query, setQuery] = useState(defaultQueryFor(connections[0] || createConnection()));
  const [result, setResult] = useState<DatabaseQueryResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<QueryHistoryItem[]>(() => loadHistory());
  const [rightTab, setRightTab] = useState<'config' | 'er' | 'history' | 'chart'>('config');
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [tableBrowse, setTableBrowse] = useState<TableBrowseState>(() => createTableBrowseState());
  const [connectionDialog, setConnectionDialog] = useState<DatabaseConnectionDraft | null>(null);
  const [insertDraft, setInsertDraft] = useState<InsertRowDraft | null>(null);
  const [savingCell, setSavingCell] = useState(false);
  const [mutatingRow, setMutatingRow] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const active = useMemo(
    () => connections.find((connection) => connection.id === activeId) || connections[0],
    [activeId, connections]
  );

  useEffect(() => {
    saveConnections(connections);
  }, [connections]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  const filteredGroups = useMemo(() => {
    if (!schema) return [];
    const keyword = search.trim().toLowerCase();
    if (!keyword) return schema.groups;
    return schema.groups
      .map((group) => ({
        ...group,
        objects: group.objects.filter((object) =>
          [
            object.name,
            object.schema,
            object.objectType,
            object.columns.map((column) => column.name).join(' '),
          ]
            .join(' ')
            .toLowerCase()
            .includes(keyword)
        ),
      }))
      .filter((group) => group.objects.length > 0);
  }, [schema, search]);

  const activeChart = useMemo(() => chartData(result), [result]);
  const graph = useMemo(() => erGraph(schema), [schema]);
  const completionWords = useMemo(() => buildCompletionWords(schema), [schema]);
  const dangerousReason = useMemo(
    () => (active ? dangerousQueryReason(active.kind, query) : ''),
    [active, query]
  );
  const selectedPrimaryKeys = useMemo(() => primaryKeyColumns(selectedObject), [selectedObject]);
  const canMutateRows = Boolean(
    active && selectedObject?.objectType === 'table' && isSqlKind(active.kind)
  );
  const canDeleteResultRows = Boolean(
    canMutateRows &&
    selectedPrimaryKeys.length > 0 &&
    selectedPrimaryKeys.every((column) => result?.columns.includes(column))
  );
  const canBrowseTableData = Boolean(
    active &&
    selectedObject &&
    isSqlKind(active.kind) &&
    ['table', 'view'].includes(selectedObject.objectType)
  );
  const totalRows = result?.totalRows ?? result?.rowCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / tableBrowse.pageSize));
  const connectionDialogOption = connectionDialog
    ? KIND_OPTIONS.find((item) => item.value === connectionDialog.kind) || KIND_OPTIONS[0]
    : null;

  const updateActive = (patch: Partial<DatabaseConnectionDraft>) => {
    if (!active) return;
    setConnections((current) =>
      current.map((connection) =>
        connection.id === active.id
          ? {
              ...connection,
              ...patch,
              port:
                patch.kind && patch.kind !== connection.kind
                  ? KIND_OPTIONS.find((item) => item.value === patch.kind)?.port || 0
                  : (patch.port ?? connection.port),
              host:
                patch.kind && patch.kind !== connection.kind
                  ? patch.kind === 'sqlite'
                    ? ''
                    : '127.0.0.1'
                  : (patch.host ?? connection.host),
              database:
                patch.kind && patch.kind !== connection.kind
                  ? patch.kind === 'redis'
                    ? '0'
                    : ''
                  : (patch.database ?? connection.database),
            }
          : connection
      )
    );
  };

  const addConnection = (kind: DatabaseKind = 'sqlite') => {
    setConnectionDialog(createConnection(kind));
  };

  const updateConnectionDialog = (patch: Partial<DatabaseConnectionDraft>) => {
    setConnectionDialog((current) => {
      if (!current) return current;
      const kindChanged = patch.kind && patch.kind !== current.kind;
      const nextKind = patch.kind || current.kind;
      const option = KIND_OPTIONS.find((item) => item.value === nextKind) || KIND_OPTIONS[0];
      return {
        ...current,
        ...patch,
        port: kindChanged ? option.port : (patch.port ?? current.port),
        host: kindChanged
          ? nextKind === 'sqlite'
            ? ''
            : '127.0.0.1'
          : (patch.host ?? current.host),
        database: kindChanged
          ? nextKind === 'redis'
            ? '0'
            : ''
          : (patch.database ?? current.database),
        name: kindChanged ? option.label : (patch.name ?? current.name),
        filePath: kindChanged && nextKind !== 'sqlite' ? '' : (patch.filePath ?? current.filePath),
        url: kindChanged ? '' : (patch.url ?? current.url),
      };
    });
  };

  const saveConnectionDialog = () => {
    if (!connectionDialog) return;
    const connection = connectionDialog;
    setConnections((current) => [...current, connection]);
    setActiveId(connection.id);
    setSchema(null);
    setSelectedObject(null);
    setResult(null);
    setTableBrowse(createTableBrowseState());
    setQuery(defaultQueryFor(connection));
    setConnectionDialog(null);
  };

  const removeActive = () => {
    if (!active || connections.length <= 1) return;
    const next = connections.filter((connection) => connection.id !== active.id);
    setConnections(next);
    setActiveId(next[0].id);
    setSchema(null);
    setSelectedObject(null);
    setResult(null);
    setTableBrowse(createTableBrowseState());
    setQuery(defaultQueryFor(next[0]));
  };

  const chooseSqliteFile = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    if (typeof selected === 'string') {
      updateActive({ filePath: selected, name: active?.name || 'SQLite' });
    }
  };

  const chooseDialogSqliteFile = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    if (typeof selected === 'string') {
      setConnectionDialog((current) => (current ? { ...current, filePath: selected } : current));
    }
  };

  const testConnection = async () => {
    if (!active) return;
    setTesting(true);
    setError('');
    setMessage('');
    try {
      const response = await invoke<DatabaseTestResult>('database_test_connection', {
        request: connectionToPayload(active),
      });
      setMessage(`${response.message} · ${response.latencyMs} ms · ${response.databaseVersion}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setTesting(false);
    }
  };

  const loadSchema = async () => {
    if (!active) return;
    setLoadingSchema(true);
    setError('');
    setMessage('');
    try {
      const response = await invoke<DatabaseSchemaResult>('database_load_schema', {
        request: connectionToPayload(active),
      });
      setSchema(response);
      setSelectedObject(null);
      setResult(null);
      setTableBrowse(createTableBrowseState());
      setMessage(response.message);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingSchema(false);
    }
  };

  const rememberQuery = (response: DatabaseQueryResult) => {
    if (!active || !query.trim()) return;
    setHistory((current) => [
      {
        id: `query-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        connectionName: active.name || kindLabel(active.kind),
        kind: active.kind,
        query,
        createdAt: new Date().toISOString(),
        durationMs: response.durationMs,
        rowCount: response.rowCount,
      },
      ...current.filter((item) => item.query.trim() !== query.trim()).slice(0, 79),
    ]);
  };

  const executeQuery = async () => {
    if (!active) return;
    const reason = dangerousQueryReason(active.kind, query);
    const allowDangerous =
      !reason ||
      window.confirm(
        `检测到高风险操作：${reason}\n\n该操作可能修改或删除数据/结构。确认要继续执行吗？`
      );
    if (!allowDangerous) return;
    setExecuting(true);
    setError('');
    setMessage('');
    try {
      const response = await invoke<DatabaseQueryResult>('database_execute_query', {
        request: {
          connection: connectionToPayload(active),
          query,
          limit: 300,
          allowDangerous: Boolean(reason),
          target: selectedObject
            ? {
                name: selectedObject.name,
                schema: selectedObject.schema,
                objectType: selectedObject.objectType,
              }
            : null,
        },
      });
      setResult(response);
      rememberQuery(response);
      setMessage(
        `${response.message} · ${response.rowCount} 行 · ${response.durationMs} ms${
          response.truncated ? ' · 已截断' : ''
        }`
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setExecuting(false);
    }
  };

  const previewObject = async (object: DatabaseSchemaObject, browseOverride?: TableBrowseState) => {
    if (!active) return;
    const browse =
      browseOverride || (selectedObject?.id === object.id ? tableBrowse : createTableBrowseState());
    setSelectedObject(object);
    setTableBrowse(browse);
    setQuery(defaultQueryFor(active, object));
    setExecuting(true);
    setError('');
    setMessage('');
    try {
      const sqlBrowsable = isSqlKind(active.kind) && ['table', 'view'].includes(object.objectType);
      const filters = sqlBrowsable
        ? Object.entries(browse.filters)
            .filter(([, value]) => value.trim() !== '')
            .map(([column, value]) => ({
              column,
              value,
              operator: 'contains',
            }))
        : [];
      const response = await invoke<DatabaseQueryResult>('database_preview_object', {
        request: {
          connection: connectionToPayload(active),
          query: '',
          limit: sqlBrowsable ? browse.pageSize : 200,
          offset: sqlBrowsable ? browse.pageIndex * browse.pageSize : 0,
          sort:
            sqlBrowsable && browse.sortColumn
              ? {
                  column: browse.sortColumn,
                  direction: browse.sortDirection,
                }
              : null,
          filters,
          target: {
            name: object.name,
            schema: object.schema,
            objectType: object.objectType,
          },
        },
      });
      setResult(response);
      setMessage(`${object.name} · ${response.rowCount} 行 · ${response.durationMs} ms`);
    } catch (err) {
      setError(String(err));
    } finally {
      setExecuting(false);
    }
  };

  const buildRowKey = (rowIndex: number): { key: DatabaseCellValue[]; error?: string } => {
    if (!selectedObject || !result) return { key: [], error: '没有可用的表格结果。' };
    const primaryKeys = primaryKeyColumns(selectedObject);
    if (primaryKeys.length === 0) {
      return { key: [], error: '当前表没有识别到主键，暂不允许直接编辑或删除。' };
    }
    const key: DatabaseCellValue[] = [];
    for (const column of primaryKeys) {
      const columnIndex = result.columns.indexOf(column);
      if (columnIndex < 0) {
        return {
          key: [],
          error: '结果集中没有完整主键列，请预览表或查询时包含全部主键列后再操作。',
        };
      }
      const isNull = result.nullCells?.[rowIndex]?.[columnIndex] ?? false;
      if (isNull) {
        return { key: [], error: '主键列为 NULL，无法安全定位单行。' };
      }
      key.push({
        column,
        value: result.rows[rowIndex]?.[columnIndex] ?? '',
        isNull: false,
      });
    }
    return { key };
  };

  const startEditCell = (rowIndex: number, column: string, oldValue: string) => {
    if (
      !active ||
      !selectedObject ||
      !isSqlKind(active.kind) ||
      selectedObject.objectType !== 'table'
    )
      return;
    const primaryKeys = primaryKeyColumns(selectedObject);
    if (primaryKeys.includes(column)) {
      setError('为避免定位失效，暂不允许直接编辑主键列。');
      return;
    }
    const columnIndex = result?.columns.indexOf(column) ?? -1;
    const columnInfo = selectedObject.columns.find((item) => item.name === column);
    if (columnIndex < 0 || !columnInfo) {
      setError('没有找到当前列的结构信息。');
      return;
    }
    const keyResult = buildRowKey(rowIndex);
    if (keyResult.error) {
      setError(keyResult.error);
      return;
    }
    const oldValueIsNull = result?.nullCells?.[rowIndex]?.[columnIndex] ?? false;
    setEditingCell({
      rowIndex,
      column,
      oldValue,
      oldValueIsNull,
      value: oldValue,
      isNull: oldValueIsNull,
      nullable: columnInfo.nullable,
      dataType: columnInfo.dataType,
      key: keyResult.key,
    });
  };

  const submitCellEdit = async () => {
    if (!active || !selectedObject || !editingCell) return;
    if (
      editingCell.value === editingCell.oldValue &&
      editingCell.isNull === editingCell.oldValueIsNull
    ) {
      setEditingCell(null);
      return;
    }
    if (editingCell.isNull && !editingCell.nullable) {
      setError('当前列不允许 NULL。');
      return;
    }
    const ok = window.confirm(
      `确认更新单元格？\n\n表：${selectedObject.name}\n主键：${keyLabel(editingCell.key)}\n字段：${editingCell.column}\n原值：${displayCellValue(editingCell.oldValue, editingCell.oldValueIsNull)}\n新值：${displayCellValue(editingCell.value, editingCell.isNull)}`
    );
    if (!ok) return;
    setSavingCell(true);
    setError('');
    setMessage('');
    try {
      const response = await invoke<DatabaseQueryResult>('database_update_cell', {
        request: {
          connection: connectionToPayload(active),
          target: {
            name: selectedObject.name,
            schema: selectedObject.schema,
            objectType: selectedObject.objectType,
          },
          key: editingCell.key,
          column: editingCell.column,
          value: editingCell.value,
          isNull: editingCell.isNull,
        },
      });
      setMessage(response.message);
      setEditingCell(null);
      await previewObject(selectedObject);
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingCell(false);
    }
  };

  const openInsertRow = () => {
    if (!active || !isSqlKind(active.kind)) {
      setError('当前连接类型不支持直接新增行。');
      return;
    }
    if (!selectedObject || selectedObject.objectType !== 'table') {
      setError('请选择普通表后再新增行。');
      return;
    }
    const values = Object.fromEntries(
      selectedObject.columns
        .filter((column) => !column.primaryKey)
        .map((column) => [column.name, { value: '', isNull: false, include: false }])
    );
    setInsertDraft({ values });
  };

  const submitInsertRow = async () => {
    if (!active || !selectedObject || !insertDraft) return;
    const values = Object.entries(insertDraft.values)
      .filter(([, draft]) => draft.include)
      .map(([column, draft]) => ({
        column,
        value: draft.value,
        isNull: draft.isNull,
      }));
    if (values.length === 0) {
      setError('至少选择并填写一个字段值。');
      return;
    }
    const ok = window.confirm(
      `确认新增一行到 ${selectedObject.name}？\n\n字段：${values
        .map((item) => `${item.column}=${displayCellValue(item.value, item.isNull)}`)
        .join(', ')}`
    );
    if (!ok) return;
    setMutatingRow(true);
    setError('');
    setMessage('');
    try {
      const response = await invoke<DatabaseQueryResult>('database_insert_row', {
        request: {
          connection: connectionToPayload(active),
          target: {
            name: selectedObject.name,
            schema: selectedObject.schema,
            objectType: selectedObject.objectType,
          },
          values,
        },
      });
      setMessage(response.message);
      setInsertDraft(null);
      await previewObject(selectedObject);
    } catch (err) {
      setError(String(err));
    } finally {
      setMutatingRow(false);
    }
  };

  const deleteRow = async (rowIndex: number) => {
    if (!active || !selectedObject || selectedObject.objectType !== 'table') return;
    const keyResult = buildRowKey(rowIndex);
    if (keyResult.error) {
      setError(keyResult.error);
      return;
    }
    const ok = window.confirm(
      `确认删除这一行？\n\n表：${selectedObject.name}\n主键：${keyLabel(
        keyResult.key
      )}\n\n删除后不可从工具内直接恢复。`
    );
    if (!ok) return;
    setMutatingRow(true);
    setError('');
    setMessage('');
    try {
      const response = await invoke<DatabaseQueryResult>('database_delete_row', {
        request: {
          connection: connectionToPayload(active),
          target: {
            name: selectedObject.name,
            schema: selectedObject.schema,
            objectType: selectedObject.objectType,
          },
          key: keyResult.key,
        },
      });
      setMessage(response.message);
      await previewObject(selectedObject);
    } catch (err) {
      setError(String(err));
    } finally {
      setMutatingRow(false);
    }
  };

  const applyBrowse = (patch: Partial<TableBrowseState>) => {
    if (!selectedObject) return;
    const next = {
      ...tableBrowse,
      ...patch,
      filters: patch.filters ?? tableBrowse.filters,
    };
    void previewObject(selectedObject, next);
  };

  const updateColumnFilter = (column: string, value: string) => {
    setTableBrowse((current) => ({
      ...current,
      pageIndex: 0,
      filters: {
        ...current.filters,
        [column]: value,
      },
    }));
  };

  const applyFilters = () => {
    if (!selectedObject) return;
    void previewObject(selectedObject, { ...tableBrowse, pageIndex: 0 });
  };

  const resetFilters = () => {
    if (!selectedObject) return;
    const next = { ...tableBrowse, pageIndex: 0, filters: {} };
    void previewObject(selectedObject, next);
  };

  const toggleSort = (column: string) => {
    if (!selectedObject || !canBrowseTableData) return;
    const next =
      tableBrowse.sortColumn === column
        ? {
            ...tableBrowse,
            pageIndex: 0,
            sortDirection:
              tableBrowse.sortDirection === 'asc' ? ('desc' as const) : ('asc' as const),
          }
        : {
            ...tableBrowse,
            pageIndex: 0,
            sortColumn: column,
            sortDirection: 'asc' as const,
          };
    void previewObject(selectedObject, next);
  };

  const formatQuery = () => {
    if (!active || !isSqlKind(active.kind)) return;
    try {
      setQuery(
        format(query, { language: active.kind === 'postgresql' ? 'postgresql' : active.kind })
      );
    } catch (err) {
      setError(String(err));
    }
  };

  const insertObjectQuery = (object: DatabaseSchemaObject) => {
    if (!active) return;
    setSelectedObject(object);
    setQuery(defaultQueryFor(active, object));
  };

  const insertColumnList = (object: DatabaseSchemaObject) => {
    if (!object.columns.length) return;
    setQuery(object.columns.map((column) => column.name).join(', '));
  };

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      void executeQuery();
    });
    monacoInstance.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: () => ({
        suggestions: completionWords.map((word) => ({
          label: word,
          kind: monacoInstance.languages.CompletionItemKind.Field,
          insertText: word,
          range: null as unknown as monaco.IRange,
        })),
      }),
    });
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {connectionDialog && connectionDialogOption && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Database size={16} />
                新建数据库连接
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {connectionDialog.kind === 'mysql'
                  ? 'MySQL 常用主机/IP 地址和端口连接，也可以填写完整 URL。'
                  : `${connectionDialogOption.label} 连接`}
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4 text-xs">
              <div className="grid grid-cols-5 gap-1">
                {KIND_OPTIONS.map((kind) => (
                  <button
                    key={kind.value}
                    onClick={() => updateConnectionDialog({ kind: kind.value })}
                    className={`inline-flex h-9 items-center justify-center rounded border text-xs font-semibold ${
                      connectionDialog.kind === kind.value
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                    }`}
                  >
                    {kind.label}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="mb-1 block text-gray-500">名称</span>
                <input
                  value={connectionDialog.name}
                  onChange={(event) => updateConnectionDialog({ name: event.target.value })}
                  className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>

              {connectionDialog.kind === 'sqlite' ? (
                <label className="block">
                  <span className="mb-1 block text-gray-500">数据库文件</span>
                  <div className="flex gap-2">
                    <input
                      value={connectionDialog.filePath}
                      onChange={(event) => updateConnectionDialog({ filePath: event.target.value })}
                      className="h-9 min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                    />
                    <button
                      onClick={() => void chooseDialogSqliteFile()}
                      className="inline-flex h-9 w-9 items-center justify-center rounded border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                      title="选择文件"
                    >
                      <FolderOpen size={15} />
                    </button>
                  </div>
                </label>
              ) : (
                <>
                  <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                    <label className="block">
                      <span className="mb-1 block text-gray-500">
                        {connectionDialog.kind === 'mysql' ? '主机/IP 地址' : '主机'}
                      </span>
                      <input
                        value={connectionDialog.host}
                        onChange={(event) => updateConnectionDialog({ host: event.target.value })}
                        placeholder="127.0.0.1"
                        className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-gray-500">端口</span>
                      <input
                        value={connectionDialog.port || ''}
                        onChange={(event) =>
                          updateConnectionDialog({ port: Number(event.target.value) || 0 })
                        }
                        placeholder={String(connectionDialogOption.port)}
                        inputMode="numeric"
                        className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-gray-500">用户</span>
                      <input
                        value={connectionDialog.username}
                        onChange={(event) =>
                          updateConnectionDialog({ username: event.target.value })
                        }
                        className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-gray-500">密码</span>
                      <input
                        type="password"
                        value={connectionDialog.password}
                        onChange={(event) =>
                          updateConnectionDialog({ password: event.target.value })
                        }
                        className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-gray-500">
                      {connectionDialog.kind === 'redis' ? '数据库编号' : '数据库'}
                    </span>
                    <input
                      value={connectionDialog.database}
                      onChange={(event) => updateConnectionDialog({ database: event.target.value })}
                      className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-gray-500">连接 URL</span>
                    <input
                      value={connectionDialog.url}
                      onChange={(event) => updateConnectionDialog({ url: event.target.value })}
                      placeholder={`${connectionDialog.kind}://...`}
                      className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                    />
                  </label>
                </>
              )}
              <label className="flex items-center gap-2 text-gray-500">
                <input
                  type="checkbox"
                  checked={connectionDialog.savePassword}
                  onChange={(event) =>
                    updateConnectionDialog({ savePassword: event.target.checked })
                  }
                />
                <span>保存密码到本地配置</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <button
                onClick={() => setConnectionDialog(null)}
                className="h-9 rounded border border-gray-200 px-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                取消
              </button>
              <button
                onClick={saveConnectionDialog}
                className="h-9 rounded bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
              >
                保存连接
              </button>
            </div>
          </div>
        </div>
      )}

      {editingCell && selectedObject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-lg rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div className="text-sm font-semibold">编辑单元格</div>
              <div className="mt-1 text-xs text-gray-500">
                {selectedObject.schema ? `${selectedObject.schema}.` : ''}
                {selectedObject.name} · {keyLabel(editingCell.key)}
              </div>
            </div>
            <div className="space-y-3 px-5 py-4 text-xs">
              <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
                <div className="text-gray-500">字段</div>
                <div className="font-semibold">
                  {editingCell.column}
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-500 dark:bg-gray-800">
                    {editingCell.dataType || 'value'}
                  </span>
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-gray-500">原值</span>
                <textarea
                  value={displayCellValue(editingCell.oldValue, editingCell.oldValueIsNull)}
                  readOnly
                  className="h-20 w-full resize-none rounded border border-gray-200 bg-gray-50 p-2 font-mono text-[11px] dark:border-gray-800 dark:bg-gray-950"
                />
              </label>
              <label className="flex items-center gap-2 text-gray-500">
                <input
                  type="checkbox"
                  checked={editingCell.isNull}
                  disabled={!editingCell.nullable}
                  onChange={(event) =>
                    setEditingCell((current) =>
                      current ? { ...current, isNull: event.target.checked } : current
                    )
                  }
                />
                <span>写入 NULL</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-gray-500">新值</span>
                <textarea
                  value={editingCell.value}
                  disabled={editingCell.isNull}
                  onChange={(event) =>
                    setEditingCell((current) =>
                      current ? { ...current, value: event.target.value } : current
                    )
                  }
                  className="h-28 w-full resize-none rounded border border-gray-200 bg-white p-2 font-mono text-[11px] outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>
              <div className="rounded bg-amber-50 p-2 text-amber-700 dark:bg-amber-900/20 dark:text-amber-100">
                只会提交带主键条件的单行更新；后端若发现影响超过 1 行会拒绝。
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <button
                onClick={() => setEditingCell(null)}
                className="h-9 rounded border border-gray-200 px-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                取消
              </button>
              <button
                onClick={() => void submitCellEdit()}
                disabled={savingCell}
                className="h-9 rounded bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {savingCell ? '保存中' : '确认更新'}
              </button>
            </div>
          </div>
        </div>
      )}

      {insertDraft && selectedObject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ListPlus size={16} />
                新增行
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {selectedObject.schema ? `${selectedObject.schema}.` : ''}
                {selectedObject.name}
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4 text-xs">
              {selectedObject.columns
                .filter((column) => !column.primaryKey)
                .map((column) => {
                  const draft = insertDraft.values[column.name] || {
                    value: '',
                    isNull: false,
                    include: false,
                  };
                  return (
                    <div key={column.name} className="block">
                      <div className="mb-1 flex items-center gap-2 text-gray-500">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={draft.include}
                            onChange={(event) =>
                              setInsertDraft((current) =>
                                current
                                  ? {
                                      values: {
                                        ...current.values,
                                        [column.name]: {
                                          ...draft,
                                          include: event.target.checked,
                                        },
                                      },
                                    }
                                  : current
                              )
                            }
                          />
                          <span>{column.name}</span>
                        </label>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] dark:bg-gray-800">
                          {column.dataType || 'value'}
                        </span>
                        {!column.nullable && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-100">
                            必填
                          </span>
                        )}
                        {column.foreignKey && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-100">
                            FK {column.foreignKey.table}.{column.foreignKey.column}
                          </span>
                        )}
                        <label className="ml-auto flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={draft.isNull}
                            disabled={!column.nullable}
                            onChange={(event) =>
                              setInsertDraft((current) =>
                                current
                                  ? {
                                      values: {
                                        ...current.values,
                                        [column.name]: {
                                          ...draft,
                                          include: true,
                                          isNull: event.target.checked,
                                        },
                                      },
                                    }
                                  : current
                              )
                            }
                          />
                          <span>NULL</span>
                        </label>
                      </div>
                      <textarea
                        value={draft.value}
                        disabled={draft.isNull}
                        onChange={(event) =>
                          setInsertDraft((current) =>
                            current
                              ? {
                                  values: {
                                    ...current.values,
                                    [column.name]: {
                                      ...draft,
                                      include: true,
                                      value: event.target.value,
                                    },
                                  },
                                }
                              : current
                          )
                        }
                        className="h-16 w-full resize-none rounded border border-gray-200 bg-white p-2 font-mono text-[11px] outline-none focus:border-blue-400 disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:disabled:bg-gray-900"
                      />
                    </div>
                  );
                })}
              <div className="rounded bg-amber-50 p-2 text-amber-700 dark:bg-amber-900/20 dark:text-amber-100">
                只有勾选的字段会提交；勾选字段但留空会写入空字符串，NULL 需要单独勾选。
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <button
                onClick={() => setInsertDraft(null)}
                className="h-9 rounded border border-gray-200 px-3 text-sm font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                取消
              </button>
              <button
                onClick={() => void submitInsertRow()}
                disabled={mutatingRow}
                className="h-9 rounded bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {mutatingRow ? '提交中' : '确认新增'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToolHeader
        icon="🧭"
        title="数据库管理"
        subtitle="连接、浏览对象、运行查询和查看数据"
        actions={
          <>
            <ToolbarButton onClick={() => void testConnection()} disabled={!active || testing}>
              <CheckCircle2 size={14} />
              {testing ? '测试中' : '测试连接'}
            </ToolbarButton>
            <ToolbarButton onClick={() => void loadSchema()} disabled={!active || loadingSchema}>
              <RefreshCw size={14} className={loadingSchema ? 'animate-spin' : ''} />
              读取结构
            </ToolbarButton>
          </>
        }
      />
      <main className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_360px] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex h-10 items-center justify-between border-b border-gray-200 px-3 dark:border-gray-800">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">连接</div>
            <button
              onClick={() => addConnection('sqlite')}
              className="inline-flex h-7 items-center gap-1 rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              <Plus size={13} />
              新建
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {connections.map((connection) => {
              const activeConnection = connection.id === active?.id;
              const option =
                KIND_OPTIONS.find((item) => item.value === connection.kind) || KIND_OPTIONS[0];
              return (
                <button
                  key={connection.id}
                  onClick={() => {
                    setActiveId(connection.id);
                    setSchema(null);
                    setSelectedObject(null);
                    setResult(null);
                    setTableBrowse(createTableBrowseState());
                    setQuery(defaultQueryFor(connection));
                  }}
                  className={`mb-1 grid w-full grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-2 text-left text-xs ${
                    activeConnection
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${option.accent}`} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {connection.name || kindLabel(connection.kind)}
                    </span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {kindLabel(connection.kind)}
                      {connection.kind === 'sqlite'
                        ? connection.filePath
                          ? ` · ${connection.filePath}`
                          : ''
                        : ` · ${connection.host || '127.0.0.1'}:${connection.port}`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-gray-200 p-3 dark:border-gray-800">
            <div className="grid grid-cols-5 gap-1">
              {KIND_OPTIONS.map((kind) => (
                <button
                  key={kind.value}
                  onClick={() => addConnection(kind.value)}
                  className="h-8 rounded border border-gray-200 text-[10px] hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  title={`新增 ${kind.label}`}
                >
                  {kind.label.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden">
          <StatusMessage message={message} error={error} />
          <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
            <div className="flex min-h-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="flex h-10 items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-800">
                <Search size={14} className="text-gray-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索对象、列名..."
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {filteredGroups.map((group) => (
                  <div key={group.id} className="mb-3">
                    <div className="mb-1 flex items-center gap-1 px-1 text-[11px] font-semibold text-gray-500">
                      <ChevronRight size={12} />
                      {group.name}
                      <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">
                        {group.objects.length}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {group.objects.map((object) => {
                        const selected = selectedObject?.id === object.id;
                        return (
                          <button
                            key={object.id}
                            onClick={() => void previewObject(object)}
                            onDoubleClick={() => insertObjectQuery(object)}
                            className={`w-full rounded-md px-2 py-2 text-left text-xs ${
                              selected
                                ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {object.objectType === 'database' ? (
                                <Database size={14} />
                              ) : object.objectType === 'collection' ||
                                object.objectType === 'key' ? (
                                <Server size={14} />
                              ) : (
                                <Table2 size={14} />
                              )}
                              <span className="min-w-0 flex-1 truncate font-semibold">
                                {object.name}
                              </span>
                              {typeof object.rowCount === 'number' && (
                                <span className="text-[10px] text-gray-400">{object.rowCount}</span>
                              )}
                            </div>
                            {object.columns.length > 0 && (
                              <div className="mt-1 flex min-w-0 items-center gap-1 pl-6">
                                <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">
                                  {object.columns
                                    .slice(0, 5)
                                    .map((column) => column.name)
                                    .join(', ')}
                                </span>
                                <span
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    insertColumnList(object);
                                  }}
                                  className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-white hover:text-blue-600 dark:hover:bg-gray-900"
                                  title="插入列清单"
                                >
                                  <ListPlus size={12} />
                                </span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {!schema && <EmptyState icon={<Database size={32} />} text="读取结构后显示对象" />}
                {schema && filteredGroups.length === 0 && (
                  <EmptyState icon={<Search size={32} />} text="没有匹配对象" />
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden">
              <div className="flex h-10 items-center justify-between border-b border-gray-200 bg-white px-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Database size={14} />
                  {active
                    ? `${active.name || kindLabel(active.kind)} / ${kindLabel(active.kind)}`
                    : '未选择连接'}
                  {selectedObject && <span> / {selectedObject.name}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {isSqlKind(active?.kind || 'sqlite') && (
                    <button
                      onClick={formatQuery}
                      className="inline-flex h-8 items-center gap-1.5 rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      <Wand2 size={13} />
                      格式化
                    </button>
                  )}
                  <button
                    onClick={() => void executeQuery()}
                    disabled={!active || executing}
                    className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white disabled:opacity-50 ${
                      dangerousReason
                        ? 'bg-amber-600 hover:bg-amber-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    <Play size={13} />
                    {executing ? '执行中' : '运行'}
                  </button>
                </div>
              </div>
              {dangerousReason && (
                <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-100">
                  高风险提示：{dangerousReason}。执行前需要二次确认，后端也会校验确认标记。
                </div>
              )}
              <div className="h-52 border-b border-gray-200 dark:border-gray-800">
                <Editor
                  height="100%"
                  value={query}
                  language={editorLanguage(active?.kind || 'sqlite')}
                  theme="vs-dark"
                  onMount={handleEditorMount}
                  onChange={(value) => setQuery(value || '')}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineHeight: 20,
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    automaticLayout: true,
                    tabSize: 2,
                    roundedSelection: false,
                    padding: { top: 10, bottom: 10 },
                  }}
                />
              </div>
              <div className="flex min-h-10 items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 py-1 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  结果
                  {result && (
                    <span className="font-normal text-gray-500">
                      {result.rowCount} 行
                      {typeof result.totalRows === 'number' ? ` / ${result.totalRows}` : ''} ·{' '}
                      {result.durationMs} ms
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canBrowseTableData && (
                    <>
                      <select
                        value={tableBrowse.pageSize}
                        onChange={(event) =>
                          applyBrowse({
                            pageIndex: 0,
                            pageSize: Number(event.target.value) || 100,
                          })
                        }
                        className="h-7 rounded border border-gray-200 bg-white px-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
                      >
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size}/页
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() =>
                          applyBrowse({ pageIndex: Math.max(0, tableBrowse.pageIndex - 1) })
                        }
                        disabled={tableBrowse.pageIndex <= 0 || executing}
                        className="h-7 rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                      >
                        上页
                      </button>
                      <span className="text-xs text-gray-500">
                        {tableBrowse.pageIndex + 1}/{totalPages}
                      </span>
                      <button
                        onClick={() =>
                          applyBrowse({
                            pageIndex: Math.min(totalPages - 1, tableBrowse.pageIndex + 1),
                          })
                        }
                        disabled={tableBrowse.pageIndex + 1 >= totalPages || executing}
                        className="h-7 rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                      >
                        下页
                      </button>
                      <button
                        onClick={applyFilters}
                        disabled={executing}
                        className="h-7 rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                      >
                        应用筛选
                      </button>
                      <button
                        onClick={resetFilters}
                        disabled={executing}
                        className="h-7 rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                      >
                        清空
                      </button>
                    </>
                  )}
                  <button
                    onClick={openInsertRow}
                    disabled={!canMutateRows || mutatingRow}
                    className="inline-flex h-7 items-center gap-1.5 rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                    title={canMutateRows ? '新增行' : '需要选择 SQL 普通表'}
                  >
                    <ListPlus size={13} />
                    新增行
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-white dark:bg-gray-900">
                {result && result.columns.length > 0 ? (
                  <table className="min-w-full border-separate border-spacing-0 text-xs">
                    <thead className="sticky top-0 z-10 bg-gray-100 dark:bg-gray-800">
                      <tr>
                        {canDeleteResultRows && (
                          <th className="w-20 border-b border-r border-gray-200 px-3 py-2 text-left font-semibold dark:border-gray-700">
                            操作
                          </th>
                        )}
                        {result.columns.map((column) => (
                          <th
                            key={column}
                            className="border-b border-r border-gray-200 px-3 py-2 text-left font-semibold dark:border-gray-700"
                          >
                            <button
                              onClick={() => toggleSort(column)}
                              disabled={!canBrowseTableData}
                              className="inline-flex max-w-[220px] items-center gap-1 text-left disabled:cursor-default"
                              title={canBrowseTableData ? '点击排序' : undefined}
                            >
                              <span className="truncate">{column}</span>
                              {tableBrowse.sortColumn === column && (
                                <span className="text-[10px] text-blue-600">
                                  {tableBrowse.sortDirection.toUpperCase()}
                                </span>
                              )}
                            </button>
                          </th>
                        ))}
                      </tr>
                      {canBrowseTableData && (
                        <tr>
                          {canDeleteResultRows && (
                            <th className="border-b border-r border-gray-200 px-2 py-1 dark:border-gray-700" />
                          )}
                          {result.columns.map((column) => (
                            <th
                              key={`filter-${column}`}
                              className="border-b border-r border-gray-200 px-2 py-1 dark:border-gray-700"
                            >
                              <input
                                value={tableBrowse.filters[column] || ''}
                                onChange={(event) => updateColumnFilter(column, event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') applyFilters();
                                }}
                                placeholder="筛选"
                                className="h-7 w-full min-w-[120px] rounded border border-gray-200 bg-white px-2 text-[11px] font-normal outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                              />
                            </th>
                          ))}
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {result.rows.map((row, rowIndex) => (
                        <tr
                          key={`${rowIndex}-${row.join('|')}`}
                          className={
                            rowIndex % 2 === 0
                              ? 'bg-white dark:bg-gray-900'
                              : 'bg-gray-50 dark:bg-gray-950'
                          }
                        >
                          {canDeleteResultRows && (
                            <td className="border-b border-r border-gray-100 px-3 py-1.5 align-top dark:border-gray-800">
                              <button
                                onClick={() => void deleteRow(rowIndex)}
                                disabled={mutatingRow}
                                className="inline-flex h-7 items-center gap-1 rounded border border-red-200 px-2 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/50 dark:text-red-300"
                              >
                                <Trash2 size={12} />
                                删除
                              </button>
                            </td>
                          )}
                          {result.columns.map((column, index) => {
                            const isNull = result.nullCells?.[rowIndex]?.[index] ?? false;
                            return (
                              <td
                                key={`${rowIndex}-${column}`}
                                onDoubleClick={() =>
                                  startEditCell(rowIndex, column, row[index] ?? '')
                                }
                                title={
                                  selectedObject?.objectType === 'table'
                                    ? '双击编辑单元格'
                                    : undefined
                                }
                                className="max-w-[320px] border-b border-r border-gray-100 px-3 py-1.5 align-top dark:border-gray-800"
                              >
                                <span
                                  className={`block truncate font-mono text-[11px] ${
                                    isNull ? 'italic text-gray-400' : ''
                                  }`}
                                >
                                  {displayCellValue(row[index] ?? '', isNull)}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : result ? (
                  <EmptyState icon={<CheckCircle2 size={32} />} text={result.message} />
                ) : (
                  <EmptyState icon={<Table2 size={32} />} text="运行查询后显示结果" />
                )}
              </div>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-200 dark:border-gray-800">
            <div className="grid grid-cols-4 gap-1 p-2">
              {[
                { id: 'config', label: '配置', icon: Database },
                { id: 'er', label: 'ER', icon: Network },
                { id: 'history', label: '历史', icon: Clock },
                { id: 'chart', label: '图表', icon: BarChart3 },
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setRightTab(tab.id as typeof rightTab)}
                    className={`inline-flex h-8 items-center justify-center gap-1 rounded text-xs ${
                      rightTab === tab.id
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Icon size={13} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
          {active && (
            <div className="space-y-3 overflow-auto p-3 text-xs">
              {rightTab === 'config' && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-gray-600 dark:text-gray-300">连接配置</div>
                    <button
                      onClick={removeActive}
                      disabled={connections.length <= 1}
                      className="inline-flex h-7 items-center gap-1 rounded border border-red-200 px-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/50 dark:text-red-300"
                    >
                      <Trash2 size={13} />
                      删除
                    </button>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-gray-500">名称</span>
                    <input
                      value={active.name}
                      onChange={(event) => updateActive({ name: event.target.value })}
                      className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-gray-500">类型</span>
                    <select
                      value={active.kind}
                      onChange={(event) => {
                        const kind = event.target.value as DatabaseKind;
                        updateActive({ kind, name: kindLabel(kind) });
                        setSchema(null);
                        setSelectedObject(null);
                        setResult(null);
                        setTableBrowse(createTableBrowseState());
                        setQuery(defaultQueryFor(createConnection(kind)));
                      }}
                      className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                    >
                      {KIND_OPTIONS.map((kind) => (
                        <option key={kind.value} value={kind.value}>
                          {kind.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {active.kind === 'sqlite' ? (
                    <label className="block">
                      <span className="mb-1 block text-gray-500">数据库文件</span>
                      <div className="flex gap-2">
                        <input
                          value={active.filePath}
                          onChange={(event) => updateActive({ filePath: event.target.value })}
                          className="h-9 min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                        />
                        <button
                          onClick={() => void chooseSqliteFile()}
                          className="inline-flex h-9 w-9 items-center justify-center rounded border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                          title="选择文件"
                        >
                          <FolderOpen size={15} />
                        </button>
                      </div>
                    </label>
                  ) : (
                    <>
                      <label className="block">
                        <span className="mb-1 block text-gray-500">连接 URL</span>
                        <input
                          value={active.url}
                          onChange={(event) => updateActive({ url: event.target.value })}
                          placeholder={`${active.kind}://...`}
                          className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                        />
                      </label>
                      <div className="grid grid-cols-[1fr_88px] gap-2">
                        <label className="block">
                          <span className="mb-1 block text-gray-500">主机</span>
                          <input
                            value={active.host}
                            onChange={(event) => updateActive({ host: event.target.value })}
                            className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-gray-500">端口</span>
                          <input
                            value={active.port || ''}
                            onChange={(event) =>
                              updateActive({ port: Number(event.target.value) || 0 })
                            }
                            className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-gray-500">用户</span>
                          <input
                            value={active.username}
                            onChange={(event) => updateActive({ username: event.target.value })}
                            className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-gray-500">密码</span>
                          <input
                            type="password"
                            value={active.password}
                            onChange={(event) => updateActive({ password: event.target.value })}
                            className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                          />
                        </label>
                      </div>
                      <label className="block">
                        <span className="mb-1 block text-gray-500">
                          {active.kind === 'redis' ? '数据库编号' : '数据库'}
                        </span>
                        <input
                          value={active.database}
                          onChange={(event) => updateActive({ database: event.target.value })}
                          className="h-9 w-full rounded border border-gray-200 bg-white px-2 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-950"
                        />
                      </label>
                    </>
                  )}
                  <label className="flex items-center gap-2 text-gray-500">
                    <input
                      type="checkbox"
                      checked={active.savePassword}
                      onChange={(event) => updateActive({ savePassword: event.target.checked })}
                    />
                    <span>保存密码到本地配置</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => void testConnection()}
                      disabled={testing}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded border border-gray-200 font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      <CheckCircle2 size={14} />
                      测试
                    </button>
                    <button
                      onClick={() => void loadSchema()}
                      disabled={loadingSchema}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded bg-blue-600 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Save size={14} />
                      连接
                    </button>
                  </div>

                  <div className="border-t border-gray-200 pt-3 dark:border-gray-800">
                    <div className="mb-2 flex items-center gap-2 font-semibold">
                      <FilePlus2 size={14} />
                      摘要
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(schema?.summary || []).map((item) => (
                        <div
                          key={item.label}
                          className="rounded border border-gray-200 p-2 dark:border-gray-800"
                        >
                          <div className="text-[11px] text-gray-500">{item.label}</div>
                          <div className="mt-1 truncate font-semibold">{item.value || '-'}</div>
                        </div>
                      ))}
                      {!schema && (
                        <div className="col-span-2 rounded border border-dashed border-gray-200 p-3 text-center text-gray-400 dark:border-gray-800">
                          暂无结构摘要
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {rightTab === 'history' && (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold">
                      <Clock size={14} />
                      查询历史
                    </div>
                    <button
                      onClick={() => setHistory([])}
                      disabled={history.length === 0}
                      className="text-[11px] text-gray-400 hover:text-red-500 disabled:opacity-40"
                    >
                      清空
                    </button>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-auto pr-1">
                    {history.slice(0, 12).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setQuery(item.query)}
                        className="w-full rounded border border-gray-200 p-2 text-left hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500">
                          <span className="truncate">
                            {item.connectionName} · {kindLabel(item.kind)}
                          </span>
                          <span>{item.durationMs} ms</span>
                        </div>
                        <div className="mt-1 line-clamp-2 font-mono text-[11px] text-gray-700 dark:text-gray-200">
                          {item.query}
                        </div>
                      </button>
                    ))}
                    {history.length === 0 && (
                      <div className="rounded border border-dashed border-gray-200 p-3 text-center text-gray-400 dark:border-gray-800">
                        暂无查询历史
                      </div>
                    )}
                  </div>
                </div>
              )}

              {rightTab === 'er' && (
                <div>
                  <div className="mb-2 flex items-center gap-2 font-semibold">
                    <Network size={14} />
                    ER 关系图
                  </div>
                  <div className="h-[620px] overflow-hidden rounded border border-gray-200 dark:border-gray-800">
                    {graph.nodes.length > 0 ? (
                      <ReactFlow nodes={graph.nodes} edges={graph.edges} fitView>
                        <Background />
                        <Controls />
                      </ReactFlow>
                    ) : (
                      <div className="flex h-full items-center justify-center text-center text-gray-400">
                        读取 SQL 表结构后显示
                      </div>
                    )}
                  </div>
                </div>
              )}

              {rightTab === 'chart' && (
                <div>
                  <div className="mb-2 flex items-center gap-2 font-semibold">
                    <BarChart3 size={14} />
                    图表预览
                  </div>
                  <div className="h-56 rounded border border-gray-200 p-2 dark:border-gray-800">
                    {activeChart ? (
                      <ResponsiveContainer width="100%" height="100%">
                        {activeChart.rows.length > 8 ? (
                          <LineChart data={activeChart.rows}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" hide />
                            <YAxis />
                            <Tooltip />
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke="#2563eb"
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        ) : (
                          <BarChart data={activeChart.rows}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" hide />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="value" fill="#2563eb" />
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-center text-gray-400">
                        结果包含数值列后显示
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
