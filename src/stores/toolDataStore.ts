import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/tauri';
import {
  DEFAULT_SUBSCRIPTION_STORE,
  SUBSCRIPTION_MANAGER_VERSION,
  normalizeSubscriptionManagerData,
  type SubscriptionManagerToolData,
} from '../tools/subscriptionManagerStore';

// 工具数据类型定义
export interface TodoTask {
  id: string;
  title: string;
  completed: boolean;
  quadrant: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  deadline?: string;
  notes?: string;
  createdAt: string;
}

export interface ColorItem {
  id: string;
  hex: string;
  name?: string;
  timestamp: number;
}

export interface GradientItem {
  id: string;
  colors: string[];
  angle: number;
  type: 'linear' | 'radial';
  css: string;
  timestamp: number;
}

export interface ColorFavoriteData {
  hex: string;
  name?: string;
  description?: string;
}

export interface GradientFavoriteData {
  colors: string[];
  angle: number;
  type: 'linear' | 'radial';
  css: string;
}

export interface PaletteFavoriteData {
  colors?: string[];
  css?: string;
  hex?: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

interface BaseFavoriteItem {
  id: string;
  tags: string[];
  timestamp: number;
}

export type FavoriteItem =
  | (BaseFavoriteItem & { type: 'color'; data: ColorFavoriteData })
  | (BaseFavoriteItem & { type: 'gradient'; data: GradientFavoriteData })
  | (BaseFavoriteItem & { type: 'palette'; data: PaletteFavoriteData });

export interface ScreenshotHistoryItem {
  id: string;
  timestamp: number;
  base64: string;
  width: number;
  height: number;
}

export interface ReplaceRule {
  id: string;
  enabled: boolean;
  mode: 'text' | 'regex';
  find: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  description?: string;
}

export type ProjectStatus = 'planning' | 'active' | 'blocked' | 'completed' | 'archived';
export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ProjectMilestoneStatus = 'upcoming' | 'done' | 'risk';

export interface ProjectTask {
  id: string;
  title: string;
  completed: boolean;
  assignee?: string;
  dueDate?: string;
  notes?: string;
  createdAt: string;
}

export interface ProjectMilestone {
  id: string;
  title: string;
  date: string;
  status: ProjectMilestoneStatus;
  description?: string;
  createdAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  client?: string;
  owner?: string;
  members: string[];
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate?: string;
  dueDate?: string;
  description?: string;
  tags: string[];
  tasks: ProjectTask[];
  milestones: ProjectMilestone[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkCategory {
  id: string;
  name: string;
  parentId?: string | null;
  icon?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  description?: string;
  categoryId?: string | null;
  tags: string[];
  icon?: string;
  iconDataUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export type AssetStatus = 'active' | 'testing' | 'needs-review' | 'archived';

export interface AssetMeta {
  sourceName?: string;
  sourceUrl?: string;
  collectReason?: string;
  rating?: number;
  status?: AssetStatus;
  lastVerified?: string;
  usageCount?: number;
}

// Prompt Library 数据类型
export interface PromptItem {
  id: string;
  title: string;
  category: string;
  tags: string[];
  content: string;
  models: string[];
  language: 'zh' | 'en';
  previewImages?: string[];
  note?: string;
  meta?: AssetMeta;
  favorite: boolean;
  createTime: string;
  updateTime: string;
}

// AI Skills Manager v2 数据类型
export const SKILLS_LIBRARY_VERSION = 'mcheng-skills-manager-v2';

export type SkillSourceType = 'manual' | 'local' | 'git' | 'market';
export type SkillSyncMode = 'copy' | 'symlink';
export type SkillTargetStatus = 'synced' | 'pending' | 'missing' | 'disabled';
export type SkillWorkspaceType = 'global' | 'project' | 'linked';
export type SkillUpdateStatus = 'unchecked' | 'current' | 'update-available' | 'error';
export type SkillStatus = 'active' | 'disabled';
export type SkillAgentCategory = 'coding' | 'assistant' | 'custom';

export interface SkillAgent {
  key: string;
  name: string;
  category: SkillAgentCategory;
  enabled: boolean;
  installed: boolean;
  globalPath: string;
  projectRelativePath?: string;
  isCustom?: boolean;
  order: number;
}

export interface SkillSource {
  type: SkillSourceType;
  ref?: string;
  resolved?: string;
  subpath?: string;
  branch?: string;
  revision?: string;
  remoteRevision?: string;
}

export interface SkillSyncTarget {
  agentKey: string;
  enabled: boolean;
  mode: SkillSyncMode;
  status: SkillTargetStatus;
  targetPath?: string;
  syncedAt?: string;
}

export interface SkillDocumentFile {
  path: string;
  content: string;
  language?: string;
}

export interface ManagedSkillItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  tags: string[];
  source: SkillSource;
  content: string;
  files: SkillDocumentFile[];
  status: SkillStatus;
  updateStatus: SkillUpdateStatus;
  targets: SkillSyncTarget[];
  presetIds: string[];
  workspaceIds: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  lastUsedAt?: string;
}

export interface SkillPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  skillIds: string[];
  agentKeys: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillWorkspace {
  id: string;
  name: string;
  path: string;
  type: SkillWorkspaceType;
  agentKeys: string[];
  skillIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SkillActivity {
  id: string;
  action: string;
  skillId?: string;
  message: string;
  createdAt: string;
}

export interface SkillsLibraryData {
  version: typeof SKILLS_LIBRARY_VERSION;
  baseDir: string;
  syncMode: SkillSyncMode;
  gitRemote?: string;
  skills: ManagedSkillItem[];
  presets: SkillPreset[];
  workspaces: SkillWorkspace[];
  agents: SkillAgent[];
  activityLog: SkillActivity[];
  lastModified: string;
}

// One MCP Manager v2 数据类型
export const MCP_MANAGER_VERSION = 'mcheng-one-mcp-v2';

export type McpTransport = 'stdio' | 'sse' | 'streamable-http';
export type McpServiceStatus = 'unknown' | 'healthy' | 'unhealthy' | 'disabled';
export type McpPackageManager = 'npm' | 'pypi' | 'docker' | 'custom';
export type McpClientType =
  | 'codex'
  | 'claude'
  | 'cursor'
  | 'kiro'
  | 'gemini'
  | 'windsurf'
  | 'vscode'
  | 'cline'
  | 'custom';
export type McpLogLevel = 'info' | 'warn' | 'error' | 'success';

export interface McpEnvVar {
  key: string;
  value: string;
  required: boolean;
  secret: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema?: string;
}

export interface McpServiceStats {
  totalRequests: number;
  todayRequests: number;
  avgLatencyMs: number;
  errorCount: number;
}

export interface McpService {
  id: string;
  name: string;
  displayName: string;
  description: string;
  transport: McpTransport;
  enabled: boolean;
  status: McpServiceStatus;
  command?: string;
  args: string[];
  url?: string;
  headers: Record<string, string>;
  env: McpEnvVar[];
  packageManager: McpPackageManager;
  packageName?: string;
  sourceUrl?: string;
  tags: string[];
  tools: McpToolDefinition[];
  stats: McpServiceStats;
  lastHealthCheck?: string;
  healthMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpGroup {
  id: string;
  name: string;
  displayName: string;
  description: string;
  serviceIds: string[];
  enabled: boolean;
  endpointPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpClientProfile {
  id: string;
  name: string;
  type: McpClientType;
  enabled: boolean;
  configPath?: string;
  serviceIds: string[];
  groupIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface McpMarketService {
  id: string;
  name: string;
  displayName: string;
  description: string;
  packageManager: McpPackageManager;
  packageName?: string;
  command?: string;
  args: string[];
  url?: string;
  env: McpEnvVar[];
  tags: string[];
  sourceUrl?: string;
  stars?: number;
}

export interface McpRequestLog {
  id: string;
  serviceId?: string;
  groupId?: string;
  level: McpLogLevel;
  message: string;
  latencyMs?: number;
  createdAt: string;
}

export interface McpManagerData {
  version: typeof MCP_MANAGER_VERSION;
  proxyBaseUrl: string;
  userToken: string;
  services: McpService[];
  groups: McpGroup[];
  clients: McpClientProfile[];
  market: McpMarketService[];
  logs: McpRequestLog[];
  lastModified: string;
}

function mcpClient(
  id: string,
  name: string,
  type: McpClientType,
  configPath: string
): McpClientProfile {
  const now = new Date().toISOString();
  return {
    id,
    name,
    type,
    enabled: true,
    configPath,
    serviceIds: [],
    groupIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

const DEFAULT_MCP_CLIENTS: McpClientProfile[] = [
  mcpClient('client_codex', 'Codex', 'codex', '~/.codex/config.toml'),
  mcpClient('client_claude', 'Claude Desktop', 'claude', '~/.claude_desktop_config.json'),
  mcpClient('client_cursor', 'Cursor', 'cursor', '~/.cursor/mcp.json'),
  mcpClient('client_kiro', 'Kiro', 'kiro', '~/.kiro/settings/mcp.json'),
  mcpClient('client_gemini', 'Gemini CLI', 'gemini', '~/.gemini/settings.json'),
  mcpClient('client_windsurf', 'Windsurf', 'windsurf', '~/.codeium/windsurf/mcp_config.json'),
  mcpClient('client_vscode', 'VS Code', 'vscode', '~/.vscode/mcp.json'),
  mcpClient('client_cline', 'Cline', 'cline', '~/.cline/mcp_settings.json'),
];

const MCP_CLIENT_ORDER: McpClientType[] = [
  'codex',
  'claude',
  'cursor',
  'kiro',
  'gemini',
  'windsurf',
  'vscode',
  'cline',
  'custom',
];

export interface ResumeGeneratorData {
  version: string;
  draft: unknown;
  lastModified: string;
}

export interface MindMapDocumentRecord {
  id: string;
  title: string;
  data: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface MindMapToolData {
  version: string;
  activeId: string | null;
  documents: MindMapDocumentRecord[];
  lastModified: string;
}

export interface FlowchartDocumentRecord {
  id: string;
  title: string;
  nodes: unknown[];
  edges: unknown[];
  viewport?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface FlowchartToolData {
  version: string;
  activeId: string | null;
  documents: FlowchartDocumentRecord[];
  lastModified: string;
}

export interface WhiteboardToolData {
  version: string;
  snapshot: unknown | null;
  lastModified: string;
}

export interface AutoClickerToolData {
  version: string;
  config: unknown;
  shortcut: string;
  shortcutEnabled: boolean;
  lastModified: string;
}

export interface DnsOriginalRecord {
  interfaceIndex: number;
  name: string;
  dnsServers: string[];
  capturedAt: string;
}

export interface DnsSwitchToolData {
  version: string;
  originals: Record<string, DnsOriginalRecord>;
  lastModified: string;
}

export interface TikHubDownloadHistoryItem {
  id: string;
  platform: 'douyin' | 'tiktok' | 'auto' | string;
  title: string;
  author?: string;
  input: string;
  outputPath?: string;
  createdAt: string;
}

export interface TikHubDownloaderToolData {
  version: string;
  apiKey: string;
  apiBase: string;
  defaultPlatform:
    | 'auto'
    | 'douyin'
    | 'tiktok'
    | 'xiaohongshu'
    | 'kuaishou'
    | 'bilibili'
    | 'youtube'
    | 'toutiao'
    | 'weibo';
  defaultRegion: string;
  outputDir: string;
  history: TikHubDownloadHistoryItem[];
  lastModified: string;
}

export interface DouyinDownloaderToolData {
  version: string;
  cookieMode: 'none' | 'chrome' | 'edge' | 'brave' | 'vivaldi' | 'opera' | 'manual';
  cookieBrowser: 'chrome' | 'edge' | 'brave' | 'vivaldi' | 'opera';
  manualCookie: string;
  outputDir: string;
  lastModified: string;
}

export interface DownloadManagerHeader {
  name: string;
  value: string;
}

export interface DownloadManagerTaskRecord {
  id: string;
  url: string;
  fileName: string;
  outputPath?: string;
  status: string;
  total?: number;
  downloaded: number;
  downloadType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadManagerToolData {
  version: string;
  outputDir: string;
  threadCount: number;
  overwrite: boolean;
  userAgentPreset: string;
  userAgent: string;
  referer: string;
  cookieMode: 'none' | 'chrome' | 'edge' | 'brave' | 'vivaldi' | 'opera' | 'manual';
  cookieBrowser: 'chrome' | 'edge' | 'brave' | 'vivaldi' | 'opera';
  cookie: string;
  headers: DownloadManagerHeader[];
  history: DownloadManagerTaskRecord[];
  lastModified: string;
}

export interface WxChannelsDownloaderToolData {
  version: string;
  outputDir: string;
  lastModified: string;
}

export interface PasswordManagerVaultEnvelope {
  version: string;
  storageMode: 'encrypted' | 'plain';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt?: string;
  nonce?: string;
  ciphertext?: string;
  plainData?: unknown;
  verifier?: string;
  updatedAt: string;
}

export interface PasswordManagerToolData {
  version: string;
  requireUnlockOnOpen: boolean;
  encryptedSave: boolean;
  autoLockMinutes: number;
  clearClipboardSeconds: number;
  vault: PasswordManagerVaultEnvelope | null;
  lastModified: string;
}

export const ESIM_MANAGER_VERSION = 'mcheng-esim-manager-v1';

export type EsimLineType = 'phone-number' | 'esim' | 'physical-sim';
export type EsimLineStatus = 'active' | 'paused';

export interface EsimRenewalLog {
  id: string;
  date: string;
  amount: number;
  currency: string;
  nextExpiryDate: string;
  note: string;
}

export interface EsimNumberRecord {
  id: string;
  displayName: string;
  provider: string;
  lineType: EsimLineType;
  country: string;
  countryCode: string;
  phoneNumber: string;
  iccid: string;
  planName: string;
  usagePurpose: string;
  keeper: string;
  accountEmail: string;
  loginUrl: string;
  renewalMethod: string;
  renewalCycleDays: number;
  activationDate: string;
  expiryDate: string;
  reminderDays: number;
  costAmount: number;
  currency: string;
  status: EsimLineStatus;
  tags: string[];
  notes: string;
  renewalLogs: EsimRenewalLog[];
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface EsimManagerData {
  version: typeof ESIM_MANAGER_VERSION;
  numbers: EsimNumberRecord[];
  lastModified: string;
}

export const ECOMMERCE_STORE_MANAGER_VERSION = 'mcheng-ecommerce-store-manager-v1';

export type EcommercePlatform = 'amazon' | 'walmart' | 'shein' | 'temu' | 'tiktok' | 'other';
export type EcommerceStoreStatus =
  | 'preparing'
  | 'under-review'
  | 'active'
  | 'limited'
  | 'suspended'
  | 'closed'
  | 'terminated';
export type EcommerceOperationStatus = 'normal' | 'watch' | 'paused' | 'risk' | 'maintenance';
export type EcommerceMaintenanceStatus = 'todo' | 'done' | 'risk';

export interface EcommerceMaintenanceLog {
  id: string;
  date: string;
  type: string;
  title: string;
  owner: string;
  status: EcommerceMaintenanceStatus;
  nextFollowDate?: string;
  note?: string;
}

export interface EcommerceAppealRecord {
  id: string;
  suspensionDate: string;
  suspensionReason: string;
  appealDate: string;
  appealCount: number;
  appealCost: number;
  appealResult: string;
  recoveryDate: string;
  appealNote: string;
}

export interface EcommerceStoreRecord {
  id: string;
  platform: EcommercePlatform;
  storeName: string;
  country: string;
  site: string;
  storeId?: string;
  storeUrl?: string;
  storeSourceChannel?: string;
  storeRegistrationDate?: string;
  storeStatus: EcommerceStoreStatus;
  operationStatus: EcommerceOperationStatus;
  subjectName: string;
  subjectType?: string;
  legalPerson: string;
  legalPersonIdNo?: string;
  legalPersonPhone?: string;
  licenseNo?: string;
  officialSealNo?: string;
  taxId?: string;
  registeredAddress?: string;
  registrationDate?: string;
  accountEmail?: string;
  accountPhone?: string;
  manager?: string;
  contactEmail?: string;
  contactName?: string;
  contactPhone?: string;
  receivingChannel?: string;
  receivingChannelOther?: string;
  receivingAccountName?: string;
  receivingAccountId?: string;
  receivingAccountEmail?: string;
  receivingCurrency?: string;
  receivingBankName?: string;
  receivingBankAccount?: string;
  receivingRoutingInfo?: string;
  receivingSettlementCycle?: string;
  receivingNote?: string;
  currency: string;
  last30dSales: number;
  last30dOrders: number;
  adSpend: number;
  skuCount: number;
  inventoryAlerts: number;
  policyWarnings: number;
  rating?: string;
  lastReviewDate?: string;
  nextAnnualReviewDate?: string;
  tags: string[];
  notes?: string;
  archivedAt?: string;
  maintenanceLogs: EcommerceMaintenanceLog[];
  appealRecords: EcommerceAppealRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface EcommerceStoreManagerData {
  version: typeof ECOMMERCE_STORE_MANAGER_VERSION;
  stores: EcommerceStoreRecord[];
  lastModified: string;
}

export const ECOMMERCE_APPEAL_LEDGER_VERSION = 'mcheng-ecommerce-appeal-ledger-v1';

export type EcommerceAppealLedgerStatus =
  | 'pending-review'
  | 'preparing'
  | 'submitted'
  | 'waiting-platform'
  | 'need-material'
  | 'successful'
  | 'failed'
  | 'cancelled';

export type EcommerceAppealSettlementStatus =
  | 'unsettled'
  | 'partial'
  | 'settled'
  | 'refunded'
  | 'waived';

export interface EcommerceAppealLedgerRecord {
  id: string;
  clientWechat: string;
  storeName: string;
  platform: EcommercePlatform | '';
  country: string;
  subjectName: string;
  browserProfile: string;
  loginCompanyName: string;
  account: string;
  password: string;
  suspensionReason: string;
  appealStatus: EcommerceAppealLedgerStatus;
  appealDate: string;
  appealResult: string;
  resultFeedbackDate: string;
  chargeAmount: number;
  currency: string;
  settlementStatus: EcommerceAppealSettlementStatus;
  settlementDate: string;
  settlementNote: string;
  markNote: string;
  handler: string;
  followUpDate: string;
  notes: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EcommerceAppealLedgerData {
  version: typeof ECOMMERCE_APPEAL_LEDGER_VERSION;
  records: EcommerceAppealLedgerRecord[];
  lastModified: string;
}

// 统一的工具数据结构
export interface ToolData {
  todo: {
    tasks: TodoTask[];
    lastModified: string;
  };
  projectManager?: {
    projects?: ProjectRecord[];
    lastModified?: string;
  };
  websiteBookmarks?: {
    categories?: BookmarkCategory[];
    items?: BookmarkItem[];
    lastModified?: string;
  };
  colorAssistant?: {
    favorites?: FavoriteItem[];
    colorHistory?: ColorItem[];
  };
  screenshotTool?: {
    history?: ScreenshotHistoryItem[];
  };
  textBatchReplace?: {
    rules?: ReplaceRule[];
    lastModified?: string;
  };
  promptLibrary?: {
    items: PromptItem[];
    lastModified: string;
  };
  skillsLibrary?: SkillsLibraryData;
  mcpLibrary?: McpManagerData;
  resumeGenerator?: ResumeGeneratorData;
  mindMap?: MindMapToolData;
  flowchart?: FlowchartToolData;
  whiteboard?: WhiteboardToolData;
  autoClicker?: AutoClickerToolData;
  dnsSwitch?: DnsSwitchToolData;
  tikhubDownloader?: TikHubDownloaderToolData;
  douyinDownloader?: DouyinDownloaderToolData;
  downloadManager?: DownloadManagerToolData;
  wxChannelsDownloader?: WxChannelsDownloaderToolData;
  passwordManager?: PasswordManagerToolData;
  esimManager?: EsimManagerData;
  subscriptionManager?: SubscriptionManagerToolData;
  ecommerceStoreManager?: EcommerceStoreManagerData;
  ecommerceAppealLedger?: EcommerceAppealLedgerData;
  // 未来可以添加其他工具的数据
  // notes: { ... }
  // bookmarks: { ... }
}

// 默认数据
const defaultToolData: ToolData = {
  todo: {
    tasks: [],
    lastModified: new Date().toISOString(),
  },
  projectManager: {
    projects: [],
    lastModified: new Date().toISOString(),
  },
  websiteBookmarks: {
    categories: [],
    items: [],
    lastModified: new Date().toISOString(),
  },
  promptLibrary: {
    items: [],
    lastModified: new Date().toISOString(),
  },
  skillsLibrary: {
    version: SKILLS_LIBRARY_VERSION,
    baseDir: '~/.mcheng/skills-manager',
    syncMode: 'copy',
    skills: [],
    presets: [],
    workspaces: [],
    agents: [
      {
        key: 'codex',
        name: 'Codex',
        category: 'coding',
        enabled: true,
        installed: true,
        globalPath: '~/.codex/skills',
        projectRelativePath: '.codex/skills',
        order: 0,
      },
      {
        key: 'claude',
        name: 'Claude Code',
        category: 'coding',
        enabled: true,
        installed: false,
        globalPath: '~/.claude/skills',
        projectRelativePath: '.claude/skills',
        order: 1,
      },
      {
        key: 'cursor',
        name: 'Cursor',
        category: 'coding',
        enabled: true,
        installed: false,
        globalPath: '~/.cursor/skills',
        projectRelativePath: '.cursor/skills',
        order: 2,
      },
      {
        key: 'kiro',
        name: 'Kiro',
        category: 'coding',
        enabled: true,
        installed: false,
        globalPath: '~/.kiro/skills',
        projectRelativePath: '.kiro/skills',
        order: 3,
      },
      {
        key: 'gemini',
        name: 'Gemini CLI',
        category: 'coding',
        enabled: true,
        installed: false,
        globalPath: '~/.gemini/skills',
        projectRelativePath: '.gemini/skills',
        order: 4,
      },
      {
        key: 'windsurf',
        name: 'Windsurf',
        category: 'coding',
        enabled: true,
        installed: false,
        globalPath: '~/.windsurf/skills',
        projectRelativePath: '.windsurf/skills',
        order: 5,
      },
    ],
    activityLog: [],
    lastModified: new Date().toISOString(),
  },
  mcpLibrary: {
    version: MCP_MANAGER_VERSION,
    proxyBaseUrl: 'http://127.0.0.1:3000',
    userToken: '',
    services: [],
    groups: [],
    clients: DEFAULT_MCP_CLIENTS,
    market: [],
    logs: [],
    lastModified: new Date().toISOString(),
  },
  resumeGenerator: {
    version: 'mcheng-resume-v2',
    draft: null,
    lastModified: new Date().toISOString(),
  },
  mindMap: {
    version: 'mcheng-mind-map-v1',
    activeId: null,
    documents: [],
    lastModified: new Date().toISOString(),
  },
  flowchart: {
    version: 'mcheng-flowchart-v1',
    activeId: null,
    documents: [],
    lastModified: new Date().toISOString(),
  },
  whiteboard: {
    version: 'mcheng-whiteboard-v1',
    snapshot: null,
    lastModified: new Date().toISOString(),
  },
  autoClicker: {
    version: 'mcheng-auto-clicker-v1',
    config: {
      intervalMs: 100,
      button: 'left',
      clickMode: 'single',
      maxClicks: null,
      startDelayMs: 0,
      pressDurationMs: 10,
      targetMode: 'current',
      points: [],
      returnToOriginal: true,
    },
    shortcut: 'F8',
    shortcutEnabled: true,
    lastModified: new Date().toISOString(),
  },
  dnsSwitch: {
    version: 'mcheng-dns-switch-v1',
    originals: {},
    lastModified: new Date().toISOString(),
  },
  tikhubDownloader: {
    version: 'mcheng-tikhub-downloader-v1',
    apiKey: '',
    apiBase: 'https://api.tikhub.io',
    defaultPlatform: 'auto',
    defaultRegion: 'CN',
    outputDir: '',
    history: [],
    lastModified: new Date().toISOString(),
  },
  douyinDownloader: {
    version: 'mcheng-douyin-downloader-v1',
    cookieMode: 'none',
    cookieBrowser: 'chrome',
    manualCookie: '',
    outputDir: '',
    lastModified: new Date().toISOString(),
  },
  downloadManager: {
    version: 'mcheng-download-manager-v1',
    outputDir: '',
    threadCount: 8,
    overwrite: false,
    userAgentPreset: 'chrome-windows',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    referer: '',
    cookieMode: 'none',
    cookieBrowser: 'chrome',
    cookie: '',
    headers: [],
    history: [],
    lastModified: new Date().toISOString(),
  },
  wxChannelsDownloader: {
    version: 'mcheng-wx-channels-downloader-v2',
    outputDir: '',
    lastModified: new Date().toISOString(),
  },
  passwordManager: {
    version: 'mcheng-password-manager-v1',
    requireUnlockOnOpen: true,
    encryptedSave: true,
    autoLockMinutes: 5,
    clearClipboardSeconds: 30,
    vault: null,
    lastModified: new Date().toISOString(),
  },
  esimManager: {
    version: ESIM_MANAGER_VERSION,
    numbers: [],
    lastModified: new Date().toISOString(),
  },
  subscriptionManager: {
    version: SUBSCRIPTION_MANAGER_VERSION,
    ...DEFAULT_SUBSCRIPTION_STORE,
    lastModified: new Date().toISOString(),
  },
  ecommerceStoreManager: {
    version: ECOMMERCE_STORE_MANAGER_VERSION,
    stores: [],
    lastModified: new Date().toISOString(),
  },
  ecommerceAppealLedger: {
    version: ECOMMERCE_APPEAL_LEDGER_VERSION,
    records: [],
    lastModified: new Date().toISOString(),
  },
};

type LegacyToolData = Partial<ToolData> & { rssReader?: unknown };

function stripLegacyToolData<T extends object>(data: T): Omit<T, 'rssReader'> {
  const next = { ...data } as T & { rssReader?: unknown };
  delete next.rssReader;
  return next;
}

function normalizeSkillsLibraryData(value?: Partial<SkillsLibraryData>): SkillsLibraryData {
  if (value?.version !== SKILLS_LIBRARY_VERSION) {
    return defaultToolData.skillsLibrary!;
  }
  const cleanedSkills = (value.skills || []).filter((skill) => {
    const legacy = skill as unknown as { status?: string; source?: { type?: string } };
    const legacyStatus = legacy.status;
    const legacySourceType = legacy.source?.type;
    return legacyStatus !== 'archived' && legacySourceType !== 'archive';
  });
  return {
    ...defaultToolData.skillsLibrary!,
    ...value,
    version: SKILLS_LIBRARY_VERSION,
    skills: cleanedSkills,
    presets: value.presets || [],
    workspaces: value.workspaces || [],
    agents: value.agents?.length ? value.agents : defaultToolData.skillsLibrary!.agents,
    activityLog: (value.activityLog || []).filter((item) => !item.action.includes('archive')),
    lastModified: value.lastModified || new Date().toISOString(),
  };
}

function mergeDefaultMcpClients(clients?: McpClientProfile[]): McpClientProfile[] {
  const existing = clients || [];
  const byType = new Set(existing.map((client) => client.type));
  const byId = new Set(existing.map((client) => client.id));
  const missing = DEFAULT_MCP_CLIENTS.filter(
    (client) => !byType.has(client.type) && !byId.has(client.id)
  );
  return [...existing, ...missing].sort((a, b) => {
    const left = MCP_CLIENT_ORDER.indexOf(a.type);
    const right = MCP_CLIENT_ORDER.indexOf(b.type);
    return (
      (left === -1 ? MCP_CLIENT_ORDER.length : left) -
      (right === -1 ? MCP_CLIENT_ORDER.length : right)
    );
  });
}

function normalizeMcpManagerData(value?: Partial<McpManagerData>): McpManagerData {
  if (value?.version !== MCP_MANAGER_VERSION) return defaultToolData.mcpLibrary!;
  return {
    ...defaultToolData.mcpLibrary!,
    ...value,
    version: MCP_MANAGER_VERSION,
    services: value.services || [],
    groups: value.groups || [],
    clients: mergeDefaultMcpClients(value.clients),
    market: value.market || [],
    logs: value.logs || [],
    lastModified: value.lastModified || new Date().toISOString(),
  };
}

function readLegacyStoreCountry(site?: string) {
  return (
    (site || '')
      .split(/[/、,，;；|]+/)
      .map((item) => item.trim())
      .filter(Boolean)[0] || ''
  );
}

function normalizeEcommerceStoreManagerData(
  value?: Partial<EcommerceStoreManagerData>
): EcommerceStoreManagerData {
  return {
    ...defaultToolData.ecommerceStoreManager!,
    ...(value || {}),
    version: ECOMMERCE_STORE_MANAGER_VERSION,
    stores: Array.isArray(value?.stores)
      ? value.stores.map((store) => ({
          ...store,
          country: store.country || readLegacyStoreCountry(store.site),
          site: store.site || '',
          archivedAt: store.archivedAt || '',
          tags: Array.isArray(store.tags) ? store.tags : [],
          maintenanceLogs: Array.isArray(store.maintenanceLogs) ? store.maintenanceLogs : [],
          appealRecords: Array.isArray(store.appealRecords)
            ? store.appealRecords.map((record) => ({
                ...record,
                appealCount: Number.isFinite(record.appealCount) ? record.appealCount : 0,
                appealCost: Number.isFinite(record.appealCost) ? record.appealCost : 0,
              }))
            : [],
          last30dSales: Number.isFinite(store.last30dSales) ? store.last30dSales : 0,
          last30dOrders: Number.isFinite(store.last30dOrders) ? store.last30dOrders : 0,
          adSpend: Number.isFinite(store.adSpend) ? store.adSpend : 0,
          skuCount: Number.isFinite(store.skuCount) ? store.skuCount : 0,
          inventoryAlerts: Number.isFinite(store.inventoryAlerts) ? store.inventoryAlerts : 0,
          policyWarnings: Number.isFinite(store.policyWarnings) ? store.policyWarnings : 0,
        }))
      : [],
    lastModified: value?.lastModified || new Date().toISOString(),
  };
}

function normalizeEsimManagerData(value?: Partial<EsimManagerData>): EsimManagerData {
  return {
    version: ESIM_MANAGER_VERSION,
    numbers: Array.isArray(value?.numbers) ? value.numbers : [],
    lastModified: value?.lastModified || new Date().toISOString(),
  };
}

function normalizeEcommerceAppealLedgerData(
  value?: Partial<EcommerceAppealLedgerData>
): EcommerceAppealLedgerData {
  return {
    ...defaultToolData.ecommerceAppealLedger!,
    ...(value || {}),
    version: ECOMMERCE_APPEAL_LEDGER_VERSION,
    records: Array.isArray(value?.records)
      ? value.records.map((record) => ({
          ...record,
          platform: record.platform || '',
          country: record.country || '',
          browserProfile: record.browserProfile || '',
          loginCompanyName: record.loginCompanyName || '',
          suspensionReason: record.suspensionReason || '',
          appealStatus: record.appealStatus || 'pending-review',
          appealDate: record.appealDate || '',
          appealResult: record.appealResult || '',
          resultFeedbackDate: record.resultFeedbackDate || '',
          chargeAmount: Number.isFinite(record.chargeAmount) ? record.chargeAmount : 0,
          currency: record.currency || 'CNY',
          settlementStatus: record.settlementStatus || 'unsettled',
          settlementDate: record.settlementDate || '',
          settlementNote: record.settlementNote || '',
          markNote: record.markNote || '',
          handler: record.handler || '',
          followUpDate: record.followUpDate || '',
          notes: record.notes || '',
          archivedAt: record.archivedAt || '',
        }))
      : [],
    lastModified: value?.lastModified || new Date().toISOString(),
  };
}

interface ToolDataState {
  data: ToolData;
  loaded: boolean;
  loading: boolean;
  error: string | null;

  // 操作方法
  loadData: () => Promise<void>;
  saveData: (newData?: ToolData) => Promise<void>;
  updateTodoTasks: (tasks: TodoTask[]) => void;
  updateProjectManagerProjects: (projects: ProjectRecord[]) => void;
  updateWebsiteBookmarks: (categories: BookmarkCategory[], items: BookmarkItem[]) => void;
  updateReplaceRules: (rules: ReplaceRule[]) => void;
  updatePromptLibraryItems: (items: PromptItem[]) => void;
  updateSkillsLibraryData: (patch: Partial<SkillsLibraryData>) => void;
  updateMcpLibraryData: (patch: Partial<McpManagerData>) => void;
  updateResumeGeneratorData: (draft: unknown, version?: string) => void;
  updateMindMapData: (mindMap: Omit<MindMapToolData, 'lastModified'>) => void;
  updateFlowchartData: (flowchart: Omit<FlowchartToolData, 'lastModified'>) => void;
  updateWhiteboardData: (whiteboard: Omit<WhiteboardToolData, 'lastModified'>) => void;
  updateAutoClickerData: (autoClicker: Omit<AutoClickerToolData, 'lastModified'>) => void;
  updateDnsSwitchData: (dnsSwitch: Omit<DnsSwitchToolData, 'lastModified'>) => void;
  updateTikHubDownloaderData: (
    tikhubDownloader: Omit<TikHubDownloaderToolData, 'lastModified'>
  ) => void;
  updateDouyinDownloaderData: (
    douyinDownloader: Omit<DouyinDownloaderToolData, 'lastModified'>
  ) => void;
  updateDownloadManagerData: (
    downloadManager: Omit<DownloadManagerToolData, 'lastModified'>
  ) => void;
  updateWxChannelsDownloaderData: (
    wxChannelsDownloader: Omit<WxChannelsDownloaderToolData, 'lastModified'>
  ) => void;
  updatePasswordManagerData: (
    passwordManager: Omit<PasswordManagerToolData, 'lastModified'>
  ) => void;
  updateEsimManagerData: (esimManager: Omit<EsimManagerData, 'lastModified'>) => void;
  updateSubscriptionManagerData: (
    subscriptionManager: Omit<SubscriptionManagerToolData, 'lastModified'>
  ) => Promise<void>;
  updateEcommerceStoreManagerData: (
    ecommerceStoreManager: Omit<EcommerceStoreManagerData, 'lastModified'>
  ) => void;
  updateEcommerceAppealLedgerData: (
    ecommerceAppealLedger: Omit<EcommerceAppealLedgerData, 'lastModified'>
  ) => void;
  exportData: () => Promise<string>;
  importData: (jsonData: string) => Promise<void>;
}

export const useToolDataStore = create<ToolDataState>((set, get) => ({
  data: defaultToolData,
  loaded: false,
  loading: false,
  error: null,

  // 加载数据
  loadData: async () => {
    set({ loading: true, error: null });
    try {
      const data = await invoke<string>('load_tool_data');
      const parsed: LegacyToolData = JSON.parse(data);
      const parsedBase = stripLegacyToolData(parsed);
      set({
        data: {
          ...defaultToolData,
          ...parsedBase,
          todo: parsed.todo || defaultToolData.todo,
          projectManager: {
            ...defaultToolData.projectManager,
            ...(parsed.projectManager || {}),
          },
          websiteBookmarks: {
            ...defaultToolData.websiteBookmarks,
            ...(parsed.websiteBookmarks || {}),
          },
          promptLibrary: parsed.promptLibrary || defaultToolData.promptLibrary,
          skillsLibrary: normalizeSkillsLibraryData(parsed.skillsLibrary),
          mcpLibrary: normalizeMcpManagerData(parsed.mcpLibrary),
          resumeGenerator: parsed.resumeGenerator || defaultToolData.resumeGenerator,
          mindMap: parsed.mindMap || defaultToolData.mindMap,
          flowchart: parsed.flowchart || defaultToolData.flowchart,
          whiteboard: parsed.whiteboard || defaultToolData.whiteboard,
          autoClicker: parsed.autoClicker || defaultToolData.autoClicker,
          dnsSwitch: parsed.dnsSwitch || defaultToolData.dnsSwitch,
          tikhubDownloader: {
            ...defaultToolData.tikhubDownloader!,
            ...(parsed.tikhubDownloader || {}),
          },
          douyinDownloader: {
            ...defaultToolData.douyinDownloader!,
            ...(parsed.douyinDownloader || {}),
          },
          downloadManager: {
            ...defaultToolData.downloadManager!,
            ...(parsed.downloadManager || {}),
          },
          wxChannelsDownloader: {
            ...defaultToolData.wxChannelsDownloader!,
            ...(parsed.wxChannelsDownloader || {}),
          },
          passwordManager: {
            ...defaultToolData.passwordManager!,
            ...(parsed.passwordManager || {}),
          },
          esimManager: normalizeEsimManagerData(parsed.esimManager),
          subscriptionManager: normalizeSubscriptionManagerData(parsed.subscriptionManager),
          ecommerceStoreManager: normalizeEcommerceStoreManagerData(parsed.ecommerceStoreManager),
          ecommerceAppealLedger: normalizeEcommerceAppealLedgerData(parsed.ecommerceAppealLedger),
        },
        loaded: true,
        loading: false,
      });
    } catch (error) {
      console.error('Failed to load tool data:', error);
      // 如果文件不存在，使用默认数据
      set({ data: defaultToolData, loaded: true, loading: false });
    }
  },

  // 保存数据
  saveData: async (newData?: ToolData) => {
    const dataToSave = stripLegacyToolData(newData || get().data);
    if (newData) {
      set({ data: newData });
    }
    try {
      await invoke('save_tool_data', { data: JSON.stringify(dataToSave, null, 2) });
    } catch (error) {
      console.error('Failed to save tool data:', error);
      set({ error: String(error) });
    }
  },

  // 更新待办任务
  updateTodoTasks: (tasks: TodoTask[]) => {
    set((state) => ({
      data: {
        ...state.data,
        todo: {
          tasks,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    // 自动保存
    get().saveData();
  },

  updateProjectManagerProjects: (projects: ProjectRecord[]) => {
    set((state) => ({
      data: {
        ...state.data,
        projectManager: {
          projects,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updateWebsiteBookmarks: (categories: BookmarkCategory[], items: BookmarkItem[]) => {
    set((state) => ({
      data: {
        ...state.data,
        websiteBookmarks: {
          categories,
          items,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  // 更新批量替换规则
  updateReplaceRules: (rules: ReplaceRule[]) => {
    set((state) => ({
      data: {
        ...state.data,
        textBatchReplace: {
          rules,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    // 自动保存
    get().saveData();
  },

  // 更新 Prompt Library 数据
  updatePromptLibraryItems: (items: PromptItem[]) => {
    set((state) => ({
      data: {
        ...state.data,
        promptLibrary: {
          items,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    // 自动保存
    get().saveData();
  },

  updateSkillsLibraryData: (patch: Partial<SkillsLibraryData>) => {
    set((state) => {
      const current = state.data.skillsLibrary || defaultToolData.skillsLibrary!;
      return {
        data: {
          ...state.data,
          skillsLibrary: {
            ...current,
            ...patch,
            version: SKILLS_LIBRARY_VERSION,
            skills: patch.skills || current.skills || [],
            presets: patch.presets || current.presets || [],
            workspaces: patch.workspaces || current.workspaces || [],
            agents: patch.agents || current.agents || [],
            activityLog: patch.activityLog || current.activityLog || [],
            lastModified: new Date().toISOString(),
          },
        },
      };
    });
    get().saveData();
  },

  updateMcpLibraryData: (patch: Partial<McpManagerData>) => {
    set((state) => {
      const current = state.data.mcpLibrary || defaultToolData.mcpLibrary!;
      return {
        data: {
          ...state.data,
          mcpLibrary: {
            ...current,
            ...patch,
            version: MCP_MANAGER_VERSION,
            services: patch.services || current.services || [],
            groups: patch.groups || current.groups || [],
            clients: patch.clients
              ? mergeDefaultMcpClients(patch.clients)
              : mergeDefaultMcpClients(current.clients),
            market: patch.market || current.market || [],
            logs: patch.logs || current.logs || [],
            lastModified: new Date().toISOString(),
          },
        },
      };
    });
    get().saveData();
  },

  updateResumeGeneratorData: (draft: unknown, version = 'mcheng-resume-v2') => {
    set((state) => ({
      data: {
        ...state.data,
        resumeGenerator: {
          version,
          draft,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updateMindMapData: (mindMap: Omit<MindMapToolData, 'lastModified'>) => {
    set((state) => ({
      data: {
        ...state.data,
        mindMap: {
          ...mindMap,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updateFlowchartData: (flowchart: Omit<FlowchartToolData, 'lastModified'>) => {
    set((state) => ({
      data: {
        ...state.data,
        flowchart: {
          ...flowchart,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updateWhiteboardData: (whiteboard: Omit<WhiteboardToolData, 'lastModified'>) => {
    set((state) => ({
      data: {
        ...state.data,
        whiteboard: {
          ...whiteboard,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updateAutoClickerData: (autoClicker: Omit<AutoClickerToolData, 'lastModified'>) => {
    set((state) => ({
      data: {
        ...state.data,
        autoClicker: {
          ...autoClicker,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updateDnsSwitchData: (dnsSwitch: Omit<DnsSwitchToolData, 'lastModified'>) => {
    set((state) => ({
      data: {
        ...state.data,
        dnsSwitch: {
          ...dnsSwitch,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updateTikHubDownloaderData: (
    tikhubDownloader: Omit<TikHubDownloaderToolData, 'lastModified'>
  ) => {
    set((state) => ({
      data: {
        ...state.data,
        tikhubDownloader: {
          ...tikhubDownloader,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updateDouyinDownloaderData: (
    douyinDownloader: Omit<DouyinDownloaderToolData, 'lastModified'>
  ) => {
    set((state) => ({
      data: {
        ...state.data,
        douyinDownloader: {
          ...douyinDownloader,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updateDownloadManagerData: (downloadManager: Omit<DownloadManagerToolData, 'lastModified'>) => {
    set((state) => ({
      data: {
        ...state.data,
        downloadManager: {
          ...downloadManager,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updateWxChannelsDownloaderData: (
    wxChannelsDownloader: Omit<WxChannelsDownloaderToolData, 'lastModified'>
  ) => {
    set((state) => ({
      data: {
        ...state.data,
        wxChannelsDownloader: {
          ...wxChannelsDownloader,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updatePasswordManagerData: (passwordManager: Omit<PasswordManagerToolData, 'lastModified'>) => {
    set((state) => ({
      data: {
        ...state.data,
        passwordManager: {
          ...passwordManager,
          lastModified: new Date().toISOString(),
        },
      },
    }));
    get().saveData();
  },

  updateEsimManagerData: (esimManager: Omit<EsimManagerData, 'lastModified'>) => {
    set((state) => ({
      data: {
        ...state.data,
        esimManager: normalizeEsimManagerData({
          ...esimManager,
          lastModified: new Date().toISOString(),
        }),
      },
    }));
    get().saveData();
  },

  updateSubscriptionManagerData: async (
    subscriptionManager: Omit<SubscriptionManagerToolData, 'lastModified'>
  ) => {
    const nextData = {
      ...get().data,
      subscriptionManager: normalizeSubscriptionManagerData({
        ...subscriptionManager,
        lastModified: new Date().toISOString(),
      }),
    };
    set({
      data: {
        ...nextData,
      },
    });
    await get().saveData(nextData);
  },

  updateEcommerceStoreManagerData: (
    ecommerceStoreManager: Omit<EcommerceStoreManagerData, 'lastModified'>
  ) => {
    set((state) => ({
      data: {
        ...state.data,
        ecommerceStoreManager: normalizeEcommerceStoreManagerData({
          ...ecommerceStoreManager,
          lastModified: new Date().toISOString(),
        }),
      },
    }));
    get().saveData();
  },

  updateEcommerceAppealLedgerData: (
    ecommerceAppealLedger: Omit<EcommerceAppealLedgerData, 'lastModified'>
  ) => {
    set((state) => ({
      data: {
        ...state.data,
        ecommerceAppealLedger: normalizeEcommerceAppealLedgerData({
          ...ecommerceAppealLedger,
          lastModified: new Date().toISOString(),
        }),
      },
    }));
    get().saveData();
  },

  // 导出数据
  exportData: async () => {
    const { data } = get();
    return JSON.stringify(data, null, 2);
  },

  // 导入数据
  importData: async (jsonData: string) => {
    try {
      const parsed: LegacyToolData = JSON.parse(jsonData);
      const parsedBase = stripLegacyToolData(parsed);
      set({
        data: {
          ...defaultToolData,
          ...parsedBase,
          todo: parsed.todo || defaultToolData.todo,
          projectManager: {
            ...defaultToolData.projectManager,
            ...(parsed.projectManager || {}),
          },
          websiteBookmarks: {
            ...defaultToolData.websiteBookmarks,
            ...(parsed.websiteBookmarks || {}),
          },
          promptLibrary: parsed.promptLibrary || defaultToolData.promptLibrary,
          skillsLibrary: normalizeSkillsLibraryData(parsed.skillsLibrary),
          mcpLibrary: normalizeMcpManagerData(parsed.mcpLibrary),
          resumeGenerator: parsed.resumeGenerator || defaultToolData.resumeGenerator,
          mindMap: parsed.mindMap || defaultToolData.mindMap,
          flowchart: parsed.flowchart || defaultToolData.flowchart,
          whiteboard: parsed.whiteboard || defaultToolData.whiteboard,
          autoClicker: parsed.autoClicker || defaultToolData.autoClicker,
          dnsSwitch: parsed.dnsSwitch || defaultToolData.dnsSwitch,
          tikhubDownloader: {
            ...defaultToolData.tikhubDownloader!,
            ...(parsed.tikhubDownloader || {}),
          },
          douyinDownloader: {
            ...defaultToolData.douyinDownloader!,
            ...(parsed.douyinDownloader || {}),
          },
          downloadManager: {
            ...defaultToolData.downloadManager!,
            ...(parsed.downloadManager || {}),
          },
          wxChannelsDownloader: {
            ...defaultToolData.wxChannelsDownloader!,
            ...(parsed.wxChannelsDownloader || {}),
          },
          passwordManager: {
            ...defaultToolData.passwordManager!,
            ...(parsed.passwordManager || {}),
          },
          esimManager: normalizeEsimManagerData(parsed.esimManager),
          subscriptionManager: normalizeSubscriptionManagerData(parsed.subscriptionManager),
          ecommerceStoreManager: normalizeEcommerceStoreManagerData(parsed.ecommerceStoreManager),
          ecommerceAppealLedger: normalizeEcommerceAppealLedgerData(parsed.ecommerceAppealLedger),
        },
      });
      await get().saveData();
    } catch (error) {
      throw new Error('导入数据格式错误');
    }
  },
}));
