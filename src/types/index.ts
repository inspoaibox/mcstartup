import type { McpServerConfig } from './mcp';

export interface LaunchProfile {
  name: string; // 配置名称，如"无痕模式"
  alias: string; // 独立别名，如"chrome-i"，用于 Win+R
  arguments?: string;
  workingDir?: string;
}

export interface LaunchItem {
  id: string;
  name: string;
  alias: string;
  targetPath: string;
  itemType?: 'app' | 'url' | 'folder' | 'script';
  arguments?: string;
  workingDir?: string;
  envVars?: Record<string, string>;
  runAsAdmin: boolean;
  startupEnabled: boolean;
  groupId?: string;
  icon?: string;
  description?: string;
  hotkey?: string;
  scriptShowWindow?: boolean; // 脚本类型：是否显示执行窗口
  scriptContent?: string; // 脚本类型：直接输入的脚本内容
  scriptType?: 'bat' | 'ps1' | 'ahk'; // 脚本类型：当使用 scriptContent 时指定脚本语言
  createdAt: number;
  lastUsed?: number;
  launchCount?: number;
  launchProfiles?: LaunchProfile[];
}

export interface Group {
  id: string;
  name: string;
  color?: string;
  order: number;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  startMinimized: boolean;
  showInTray: boolean;
  closeToTray: boolean;
  autoStart: boolean;
  contextMenuEnabled: boolean;
  autoBackup: boolean;
  backupPath?: string;
  language: string;
  viewMode: 'grid' | 'list' | 'compact';
  quickLaunchShortcut: string;
  iconSize: 'small' | 'medium' | 'large';
  searchEngines: SearchEngine[];
  qweatherApiKey: string;
  qweatherApiHost: string;
  clipboardShortcut?: string;
  clipboardMaxCount: number;
  clipboardDurationDays: number;
  clipboardEnabled?: boolean;
  clipboardAutoPaste?: 'single' | 'double';
  clipboardPastePlain?: boolean;
  clipboardAutoSort?: boolean;
  clipboardSearchPosition?: 'top' | 'bottom';
  clipboardSearchAutoClear?: boolean;
  toolboxShortcut?: string;
  // OCR 设置
  ocrShortcut?: string;
  ocrProvider?: 'baidu' | 'google' | 'tencent' | 'aliyun' | 'wechat' | 'paddle' | 'wps';
  ocrBaiduApiKey?: string;
  ocrBaiduSecretKey?: string;
  ocrBaiduHighAccuracy?: boolean;
  ocrGoogleApiKey?: string;
  ocrTencentSecretId?: string;
  ocrTencentSecretKey?: string;
  ocrTencentRegion?: string;
  ocrAliyunAccessKeyId?: string;
  ocrAliyunAccessKeySecret?: string;
  ocrAutoRecognize?: boolean;
  ocrCopyAfterRecognize?: boolean;
  // 翻译设置
  translateShortcut?: string;
  quickTranslateShortcut?: string;
  wordSelectionTranslateShortcut?: string;
  translateProvider?:
    | 'baidu'
    | 'google'
    | 'bing'
    | 'tencent'
    | 'chatgpt'
    | 'openai-compatible'
    | 'deepseek'
    | 'gemini';
  translateMode?: 'window' | 'overlay'; // 翻译显示模式：窗口模式 或 覆盖模式
  translateFromLang?: string;
  translateToLang?: string;
  translateBaiduAppId?: string;
  translateBaiduSecretKey?: string;
  translateGoogleApiKey?: string;
  translateBingApiKey?: string;
  translateTencentSecretId?: string;
  translateTencentSecretKey?: string;
  translateTencentRegion?: string;
  translateOpenaiApiKey?: string;
  translateOpenaiModel?: string;
  translateOpenaiBaseUrl?: string;
  translateOpenaiCompatibleProviders?: TranslateOpenaiCompatibleProvider[];
  translateOpenaiCompatibleProviderId?: string;
  translateDeepseekApiKey?: string;
  translateDeepseekModel?: string;
  translateDeepseekBaseUrl?: string;
  translateGeminiApiKey?: string;
  translateGeminiModel?: string;
  translateAutoDetectLanguage?: boolean;
  translateShowOriginalText?: boolean;
  translateAutoCopy?: boolean;
  translateOverlayOpacity?: number; // 覆盖模式的透明度 (0-1)
  translateOverlayFontSize?: number; // 覆盖模式的字体大小
  // 截图设置
  screenshotFullscreenShortcut?: string;
  screenshotRegionShortcut?: string;
  // AI 聊天设置
  aiChatShortcut?: string;
  aiProviders?: Array<{
    id: string;
    name: string;
    type: 'openai' | 'anthropic' | 'google' | 'vertex' | 'azure' | 'custom' | 'sub2api';
    apiKey: string;
    baseUrl?: string;
    connectionMode?: 'auto' | 'direct' | 'system' | 'custom';
    proxyUrl?: string;
    model: string;
    availableModels?: string[];
  }>;
  activeAiProviderId?: string;
  // 默认模型（用于快捷搜索等场景）：格式 "providerId::modelName"
  defaultAiModel?: string;
  // MCP 服务器配置
  mcpServers?: McpServerConfig[];
}

export interface TranslateOpenaiCompatibleProvider {
  id: string;
  name: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface SearchEngine {
  name: string;
  prefix: string;
  url: string; // 包含 {query} 占位符
  enabled: boolean;
}

export interface AppConfig {
  items: LaunchItem[];
  groups: Group[];
  settings: AppSettings;
}

export type ItemFormData = Omit<LaunchItem, 'id' | 'createdAt' | 'lastUsed' | 'launchCount'>;

export interface SearchFilter {
  query: string;
  groupId?: string;
  sortBy: 'name' | 'alias' | 'lastUsed' | 'createdAt' | 'launchCount';
  sortOrder: 'asc' | 'desc';
}

export interface InstalledProgram {
  name: string;
  targetPath: string;
  iconPath?: string;
  source: string;
}

export interface PathCheckResult {
  id: string;
  valid: boolean;
}

export interface EverythingStatus {
  available: boolean;
  esPath?: string;
  message: string;
  ipcClass?: string;
  autoStarted?: boolean;
}

export interface EverythingResult {
  name: string;
  fullPath: string;
  isFolder: boolean;
}

// 和风天气数据类型
export interface WeatherNow {
  obsTime: string;
  temp: string;
  feelsLike: string;
  icon: string;
  text: string;
  wind360: string;
  windDir: string;
  windScale: string;
  windSpeed: string;
  humidity: string;
  precip: string;
  pressure: string;
  vis: string;
  cloud: string;
  dew: string;
}

export interface WeatherDaily {
  fxDate: string;
  sunrise: string;
  sunset: string;
  moonrise: string;
  moonset: string;
  moonPhase: string;
  moonPhaseIcon: string;
  tempMax: string;
  tempMin: string;
  iconDay: string;
  textDay: string;
  iconNight: string;
  textNight: string;
  wind360Day: string;
  windDirDay: string;
  windScaleDay: string;
  windSpeedDay: string;
  wind360Night: string;
  windDirNight: string;
  windScaleNight: string;
  windSpeedNight: string;
  humidity: string;
  precip: string;
  pressure: string;
  vis: string;
  cloud: string;
  uvIndex: string;
}

export interface WeatherResult {
  cityName: string;
  cityId: string;
  now: WeatherNow;
  daily: WeatherDaily[];
  updateTime: string;
}

// ─── 剪贴板历史类型 ───────────────────────────────────────────────

export type ClipboardItemType = 'text' | 'image' | 'files' | 'html' | 'rtf';
export type ClipboardTextSubtype = 'url' | 'email' | 'color' | 'path' | 'image-file';
export type ClipboardGroup = 'all' | 'text' | 'image' | 'files' | 'favorite';

export interface ClipboardItem {
  id: string;
  itemType: ClipboardItemType;
  group: string;
  value: string;
  search: string;
  count: number;
  width?: number;
  height?: number;
  favorite: boolean;
  pinned?: boolean;
  shortcut?: string;
  createTime: string;
  note?: string;
  subtype?: ClipboardTextSubtype;
}

export interface ClipboardSettings {
  shortcut: string;
  maxCount: number;
  durationDays: number;
  autoPaste: 'single' | 'double';
  copyPlain: boolean;
  pastePlain: boolean;
  autoSort: boolean;
  deleteConfirm: boolean;
  searchPosition: 'top' | 'bottom';
  searchDefaultFocus: boolean;
  searchAutoClear: boolean;
}

// ─── AI Prompt 管理类型 ───────────────────────────────────────────────

export type PromptCategory =
  | '图片生成'
  | 'Logo设计'
  | '视频生成'
  | '文案写作'
  | '代码开发'
  | '电商运营'
  | '短视频脚本'
  | '角色扮演'
  | '办公效率'
  | '翻译润色'
  | '营销推广'
  | '自媒体内容';

export type PromptLanguage = 'zh' | 'en';

export type PromptModel =
  | 'ChatGPT'
  | 'Claude'
  | 'Gemini'
  | 'Midjourney'
  | 'Stable Diffusion'
  | 'DALL-E'
  | 'Runway'
  | 'Sora'
  | 'Copilot'
  | '通用';

export interface PromptItem {
  id: string;
  title: string;
  category: PromptCategory;
  tags: string[];
  content: string;
  models: PromptModel[];
  language: PromptLanguage;
  note?: string;
  favorite: boolean;
  createTime: string;
  updateTime: string;
}
