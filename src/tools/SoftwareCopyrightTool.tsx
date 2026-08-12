import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import { readTextFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Download,
  FileCode2,
  FileText,
  FolderOpen,
  Info,
  Loader2,
  RefreshCw,
  Save,
  Search,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { EmptyState, StatusMessage } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';

type TabId = 'overview' | 'info' | 'business' | 'project' | 'code' | 'check';
type OwnerType = 'enterprise' | 'individual' | 'other';
type PublishStatus = 'unpublished' | 'published';
type DevelopmentMethod = 'original' | 'modified' | 'composite';
type CodeMaterialMode = 'front-back' | 'all' | 'empty';
type ProjectFileKind = 'source' | 'config' | 'doc' | 'resource';
type MaterialDocumentKind = 'code' | 'report';
type ScreenshotMethod = '' | 'chrome-devtools' | 'computer-use' | 'user-supplied' | 'skip';

interface ApplicationInfo {
  softwareName: string;
  shortName: string;
  version: string;
  copyrightOwner: string;
  ownerType: OwnerType;
  completionDate: string;
  publishStatus: PublishStatus;
  publishDate: string;
  developmentMethod: DevelopmentMethod;
  devHardware: string;
  runHardware: string;
  devOs: string;
  runOs: string;
  devTools: string;
  supportSoftware: string;
  softwareCategory: string;
  industry: string;
  targetUsers: string;
  purpose: string;
  mainFunctions: string;
  technicalFeatures: string;
}

interface ProjectFile {
  path: string;
  relativePath: string;
  name: string;
  ext: string;
  language: string;
  kind?: ProjectFileKind;
  size: number;
  lines: number;
  content?: string;
}

interface NameCandidate {
  name: string;
  source: string;
  confidence: number;
  evidence?: string;
}

interface VersionCandidate {
  version: string;
  source: string;
  confidence: number;
}

interface DetectionItem {
  name: string;
  evidence: string[];
}

interface ScanRules {
  includeConfigs: string[];
  meaningfulDirs: string[];
  excludedDirs: string[];
  excludedFiles: string[];
}

interface ProjectModule {
  name: string;
  source: string;
  fileCount: number;
  evidence: string[];
}

interface TechStack {
  languages: string[];
  frameworks: DetectionItem[];
  databases: DetectionItem[];
  middleware: DetectionItem[];
  runtimes: DetectionItem[];
  buildTools: DetectionItem[];
  packageManagers: DetectionItem[];
  projectTypes: DetectionItem[];
}

interface ProjectScale {
  sourceFileCount: number;
  sourceLineCount: number;
  docFileCount: number;
  configFileCount: number;
  resourceFileCount: number;
  moduleCount: number;
  topDirectories: Array<{ path: string; files: number; lines: number }>;
}

interface ProjectAnalysis {
  root: string;
  name: string;
  totalFiles: number;
  configFiles: ProjectFile[];
  sourceFiles: ProjectFile[];
  docs: ProjectFile[];
  packageName: string;
  packageVersion: string;
  packageScripts: string[];
  dependencies: string[];
  framework: string;
  languages: Array<{ language: string; files: number; lines: number }>;
  entryHints: string[];
  functionHints: string[];
  nameCandidates: NameCandidate[];
  versionCandidates: VersionCandidate[];
  modules: ProjectModule[];
  techStack: TechStack;
  scale: ProjectScale;
  scanRules: ScanRules;
  projectType: string;
  architecture: string;
  scannedAt: string;
  scanTruncated: boolean;
}

interface ProjectScanResult {
  files: ProjectFile[];
  totalFiles: number;
  truncated: boolean;
}

interface DocxRequest {
  outputPath: string;
  title: string;
  content: string;
  kind: MaterialDocumentKind;
  headerText?: string;
  linesPerPage?: number;
}

interface TextFileWrite {
  path: string;
  content: string;
}

interface CodeSelectionItem {
  path: string;
  relativePath: string;
  language: string;
  lines: number;
  selected: boolean;
  startLine: number;
  endLine: number;
  reason: string;
}

interface CodeLineRange {
  startLine: number;
  endLine: number;
}

type CodeSelections = Record<string, CodeLineRange>;

interface WorkflowConfirmations {
  business: boolean;
  applicationFields: boolean;
  codeSelection: boolean;
  screenshotMethod: ScreenshotMethod;
  markdown: boolean;
}

interface CodePage {
  materialPage: number;
  originalPage: number;
  lines: string[];
}

interface CodeMaterial {
  mode: CodeMaterialMode;
  selectedFiles: ProjectFile[];
  selectionItems: CodeSelectionItem[];
  allPages: CodePage[];
  frontPages: CodePage[];
  backPages: CodePage[];
  allText: string;
  frontText: string;
  backText: string;
  frontBackText: string;
  manifestMarkdown: string;
  manifestJson: string;
  selectionMarkdown: string;
  selectionJson: string;
  totalSourcePages: number;
  submittedPages: number;
  submittedLines: number;
  totalSelectedLines: number;
  projectCandidatePages: number;
  supplementNeeded: boolean;
}

interface ConfirmationRecord {
  confirmed: boolean;
  confirmedAt: string;
  note: string;
}

interface GeneratedMaterials {
  basicInfo: ExtractedBasicInfo;
  applicationInfoText: string;
  businessUnderstandingMarkdown: string;
  businessUnderstandingJson: string;
  softwareIntroMarkdown: string;
  mainFunctionsMarkdown: string;
  technicalFeaturesMarkdown: string;
  operationManualMarkdown: string;
  manualSelfCheckMarkdown: string;
  manualSelfCheckJson: string;
  projectReportMarkdown: string;
  checklistMarkdown: string;
  code: CodeMaterial;
}

interface ValidationItem {
  label: string;
  ok: boolean;
  detail?: string;
}

interface BasicInfoRow {
  label: string;
  value: string;
  evidence: string;
  needsReview?: boolean;
}

interface ExtractedBasicInfo {
  rows: BasicInfoRow[];
  markdown: string;
  json: string;
}

interface KeywordRule {
  id: string;
  label: string;
  keywords: string[];
  baseScore?: number;
}

interface BusinessFormRule extends KeywordRule {
  purpose: string;
  targetUsers: string;
  compatibleIndustryIds?: string[];
  fallbackIndustryId?: string;
}

interface IndustryRule extends KeywordRule {
  purposePrefix: string;
}

interface HardwareRule extends KeywordRule {
  name: string;
  devHardware: string;
  runHardware: string;
  minScore?: number;
}

interface RuleEvidenceSource {
  source: string;
  text: string;
  weight: number;
}

interface RuleMatch<T extends KeywordRule> {
  rule: T;
  score: number;
  evidence: string[];
}

interface FunctionEntry {
  name: string;
  details: string[];
  evidence: string;
}

interface FunctionActionRule {
  id: string;
  pattern: RegExp;
  action: string;
}

type TextModelStatus = 'checking' | 'missing' | 'downloading' | 'ready' | 'loading' | 'generating' | 'error';

interface SoftwareCopyrightTextModelRuntime {
  modelReady: boolean;
  mode: string;
  modelDir: string;
  message: string;
  requiredFiles: string[];
  missingFiles: string[];
  validationError?: string | null;
}

interface SoftwareCopyrightQwenProgress {
  stage: string;
  progress: number;
  generatedTokens: number;
  maxNewTokens: number;
  message: string;
}

interface SoftwareCopyrightQwenResult {
  text: string;
  generatedTokens: number;
  modelDir: string;
}

interface SoftwareCopyrightQwenRequest {
  prompt: string;
  maxNewTokens: number;
  minOutputChars?: number;
}

interface QwenApplicationFields {
  softwareCategory: string;
  industry: string;
  targetUsers: string;
  purpose: string;
  technicalFeatures: string;
}

interface QwenApplicationDraft extends QwenApplicationFields {
  mainFunctions: string;
}

interface LanguageSummary {
  value: string;
  evidence: string;
  details: Array<{ language: string; files: number; lines: number; percent: number }>;
}

const STORAGE_KEY = 'mcstartup.software-copyright-tool.v4';
const MAX_SCAN_FILES = 10_000;
const MAX_SOURCE_FILE_CHARS = 220_000;
const CODE_LINES_PER_PAGE = 60;
const DEPOSIT_PAGE_COUNT = 30;
const FULL_DEPOSIT_PAGE_THRESHOLD = 60;
const MIN_MAIN_FUNCTION_CHARS = 500;
const MAX_MAIN_FUNCTION_CHARS = 1300;
const TEXT_MODEL_FIELD_MAX_NEW_TOKENS = 360;
const TEXT_MODEL_MAIN_REPAIR_MAX_NEW_TOKENS = 900;
const SOFTWARE_COPYRIGHT_TEXT_MODEL_REPO = 'onnx-community/Qwen2.5-0.5B-Instruct';
const SOFTWARE_COPYRIGHT_TEXT_MODEL_SIZE_MB = 420;
const SOFTWARE_COPYRIGHT_TEXT_MODEL_FILES = [
  {
    label: '模型配置',
    path: 'config.json',
    url: `https://huggingface.co/${SOFTWARE_COPYRIGHT_TEXT_MODEL_REPO}/resolve/main/config.json`,
  },
  {
    label: '生成配置',
    path: 'generation_config.json',
    url: `https://huggingface.co/${SOFTWARE_COPYRIGHT_TEXT_MODEL_REPO}/resolve/main/generation_config.json`,
  },
  {
    label: 'Tokenizer',
    path: 'tokenizer.json',
    url: `https://huggingface.co/${SOFTWARE_COPYRIGHT_TEXT_MODEL_REPO}/resolve/main/tokenizer.json`,
  },
  {
    label: 'Tokenizer 配置',
    path: 'tokenizer_config.json',
    url: `https://huggingface.co/${SOFTWARE_COPYRIGHT_TEXT_MODEL_REPO}/resolve/main/tokenizer_config.json`,
  },
  {
    label: 'Q4 ONNX 生成模型',
    path: 'onnx/model_q4.onnx',
    url: `https://huggingface.co/${SOFTWARE_COPYRIGHT_TEXT_MODEL_REPO}/resolve/main/onnx/model_q4.onnx`,
  },
] as const;
const PDF_A4_WIDTH = 595.28;
const PDF_A4_HEIGHT = 841.89;
const PDF_MARGIN = 72;
const PDF_CONTENT_WIDTH = PDF_A4_WIDTH - PDF_MARGIN * 2;
const PDF_CODE_FONT_SIZE = 9;
const PDF_CODE_LINE_HEIGHT = 12;
const PDF_REPORT_FONT_SIZE = 10.5;
const PDF_REPORT_LINE_HEIGHT = 16;
const PDF_TABLE_FONT_SIZE = 8.5;
const PDF_TABLE_LINE_HEIGHT = 12;

let cachedChinesePdfFontBytes: Uint8Array | null = null;

const SOURCE_EXTENSIONS: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript React',
  js: 'JavaScript',
  jsx: 'JavaScript React',
  vue: 'Vue',
  svelte: 'Svelte',
  java: 'Java',
  kt: 'Kotlin',
  go: 'Go',
  rs: 'Rust',
  py: 'Python',
  php: 'PHP',
  cs: 'C#',
  cpp: 'C++',
  c: 'C',
  h: 'C/C++ Header',
  hpp: 'C++ Header',
  dart: 'Dart',
  swift: 'Swift',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
};

const DOC_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'rst']);
const CONFIG_FILE_NAMES = [
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'requirements.txt',
  'pyproject.toml',
  'pubspec.yaml',
  'go.mod',
  'composer.json',
  'cargo.toml',
  'tauri.conf.json',
  'vite.config.ts',
  'vite.config.js',
  'webpack.config.js',
  'next.config.js',
  'nuxt.config.ts',
];
const MEANINGFUL_DIRS = [
  'controllers',
  'controller',
  'services',
  'service',
  'routers',
  'router',
  'routes',
  'apis',
  'api',
  'modules',
  'module',
  'pages',
  'views',
  'components',
  'stores',
  'store',
  'models',
  'entities',
  'docs',
];
const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'target',
  '.git',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'tests',
  'test',
  '__tests__',
  'mocks',
  'fixtures',
  'generated',
  'tmp',
  'temp',
];
const EXCLUDED_FILES = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'cargo.lock',
  'composer.lock',
  'poetry.lock',
  'go.sum',
  '*.min.*',
  '*.map',
  '*.d.ts',
  '*.test.*',
  '*.spec.*',
  '*.stories.*',
];
const SCAN_RULES: ScanRules = {
  includeConfigs: CONFIG_FILE_NAMES,
  meaningfulDirs: MEANINGFUL_DIRS,
  excludedDirs: EXCLUDED_DIRS,
  excludedFiles: EXCLUDED_FILES,
};
const HARDWARE_RULES: HardwareRule[] = [
  {
    id: 'realtime-call-center',
    name: '呼叫中心/实时通信服务',
    label: '呼叫中心/实时通信服务',
    keywords: ['呼叫中心', '座席', '坐席', 'IVR', 'ACD', 'SIP', 'WebRTC', 'FreeSWITCH', 'PSTN', '软电话', '通话录音', '语音网关', '实时通话', '录音质检'],
    devHardware: 'x86_64开发机，4核CPU/16GB内存/100GB磁盘',
    runHardware: 'x86_64服务器，8核CPU/32GB内存/500GB磁盘',
    minScore: 12,
  },
  {
    id: 'ai-inference',
    name: '人工智能/模型推理',
    label: '人工智能/模型推理',
    keywords: ['人工智能', '机器学习', '深度学习', '模型训练', '模型推理', '大模型', 'NLP', 'OCR', '图像识别', '语音识别', 'CUDA', 'GPU'],
    devHardware: 'x86_64开发机，8核CPU/32GB内存/独立GPU',
    runHardware: 'x86_64服务器，8核CPU/32GB内存/独立GPU',
    minScore: 12,
  },
  {
    id: 'microservice-cloud',
    name: '微服务/容器化部署',
    label: '微服务/容器化部署',
    keywords: ['微服务', '分布式', '高并发', '高可用', 'Kubernetes', 'Docker', 'Spring Cloud', '服务治理', '负载均衡', '网关', 'Nginx', '容器'],
    devHardware: 'x86_64开发机，4核CPU/16GB内存/100GB磁盘',
    runHardware: 'x86_64服务器，8核CPU/32GB内存/500GB磁盘',
    minScore: 10,
  },
  {
    id: 'data-analysis',
    name: '数据分析/报表看板',
    label: '数据分析/报表看板',
    keywords: ['BI', '数据分析', '大数据', '数据仓库', '数据湖', '报表', '看板', '指标', '统计分析', '可视化', 'Elasticsearch'],
    devHardware: 'x86_64开发机，4核CPU/16GB内存/100GB磁盘',
    runHardware: 'x86_64服务器，8核CPU/32GB内存/1TB磁盘',
    minScore: 10,
  },
  {
    id: 'transaction-management',
    name: '业务管理/交易库存',
    label: '业务管理/交易库存',
    keywords: ['ERP', '进销存', '采购', '销售', '库存', '订单', '商品', '支付', '商城', '会员', 'SKU', '仓库', '工单'],
    devHardware: 'x86_64开发机，4核CPU/8GB内存/100GB磁盘',
    runHardware: 'x86_64服务器，4核CPU/16GB内存/200GB磁盘',
    minScore: 10,
  },
  {
    id: 'server-api',
    name: '服务端/API/数据库服务',
    label: '服务端/API/数据库服务',
    keywords: ['服务端', '后端', 'API服务', '接口服务', '数据库', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Kafka', 'Spring Boot', 'Django', 'FastAPI', 'Laravel', 'Go Module', 'Node.js'],
    devHardware: 'x86_64开发机，4核CPU/16GB内存/100GB磁盘',
    runHardware: 'x86_64服务器，4核CPU/16GB内存/200GB磁盘',
    minScore: 10,
  },
  {
    id: 'iot-edge',
    name: '物联网/边缘设备',
    label: '物联网/边缘设备',
    keywords: ['物联网', 'IoT', '传感器', '网关', '边缘', '遥测', '设备采集', '设备监控', 'Modbus', 'MQTT'],
    devHardware: 'x86_64开发机，4核CPU/8GB内存/50GB磁盘',
    runHardware: '边缘网关或服务器，4核CPU/8GB内存/128GB存储',
    minScore: 10,
  },
  {
    id: 'mobile-cross-platform',
    name: '移动端/跨端应用',
    label: '移动端/跨端应用',
    keywords: ['Android', 'iOS', '移动端', 'Flutter', 'React Native', 'UniApp', '小程序', 'H5'],
    devHardware: 'x86_64开发机或macOS开发机，4核CPU/16GB内存/100GB磁盘',
    runHardware: '智能移动终端，4GB内存/64GB存储',
    minScore: 10,
  },
  {
    id: 'desktop-client',
    name: '桌面客户端',
    label: '桌面客户端',
    keywords: ['桌面', '客户端', 'Electron', 'Tauri', 'WinForm', 'WPF', 'Qt', 'Windows客户端'],
    devHardware: 'x86_64开发机，4核CPU/8GB内存/100GB磁盘',
    runHardware: 'x86_64客户端，2核CPU/4GB内存/20GB磁盘',
    minScore: 10,
  },
  {
    id: 'web-frontend',
    name: 'Web前端/管理后台',
    label: 'Web前端/管理后台',
    keywords: ['Web前端', '管理后台', '前端界面', '浏览器', 'React', 'Vue', 'Angular', 'Next.js', 'Nuxt', 'Vite', 'TypeScript'],
    devHardware: 'x86_64开发机，4核CPU/8GB内存/50GB磁盘',
    runHardware: 'x86_64服务器，2核CPU/4GB内存/50GB磁盘',
    minScore: 10,
  },
];

const BUSINESS_FORM_RULES: BusinessFormRule[] = [
  {
    id: 'call-center',
    label: '呼叫中心/客户联络',
    keywords: ['呼叫中心', '客服', '客户服务', '座席', '坐席', 'IVR', '呼入', '呼出', '工单', '质检', '录音', '满意度', '软电话', '语音导航'],
    purpose: '用于支撑客户联络、座席处理、通话记录和服务质检',
    targetUsers: '客服座席、运营管理人员、质检人员',
    compatibleIndustryIds: ['information-service', 'telecom', 'retail-commerce', 'transport-logistics', 'internet-platform'],
    fallbackIndustryId: 'information-service',
  },
  {
    id: 'crm',
    label: '客户关系管理',
    keywords: ['CRM', '客户管理', '客户档案', '线索', '商机', '跟进记录', '销售机会', '客户画像', '回访'],
    purpose: '用于支撑客户资料维护、销售跟进和客户服务管理',
    targetUsers: '销售人员、客服人员、客户运营人员',
    compatibleIndustryIds: ['information-service', 'retail-commerce', 'internet-platform', 'transport-logistics', 'finance'],
    fallbackIndustryId: 'information-service',
  },
  {
    id: 'oa-workflow',
    label: '办公协同/流程审批',
    keywords: ['OA', '办公', '协同', '流程审批', '公文', '会议', '日程', '通知公告', '考勤', '请假', '审批流'],
    purpose: '用于支撑组织办公协同、流程审批和日常事务处理',
    targetUsers: '企业员工、部门负责人、行政管理人员',
  },
  {
    id: 'ecommerce',
    label: '电商交易/订单履约',
    keywords: ['电商', '商城', '购物车', '支付', '订单', '商品', 'SKU', '会员', '优惠券', '售后', '店铺', '物流履约'],
    purpose: '用于支撑商品展示、线上交易、订单处理和售后履约',
    targetUsers: '运营人员、商家、消费者、客服人员',
    compatibleIndustryIds: ['retail-commerce', 'internet-platform', 'transport-logistics', 'information-service'],
    fallbackIndustryId: 'retail-commerce',
  },
  {
    id: 'erp-inventory',
    label: 'ERP/进销存管理',
    keywords: ['ERP', '进销存', '采购', '销售', '库存', '仓库', '供应商', '财务', '物料', '入库', '出库'],
    purpose: '用于支撑采购、销售、库存和经营数据的一体化管理',
    targetUsers: '企业管理人员、采购人员、销售人员、仓储人员',
  },
  {
    id: 'education-learning',
    label: '教学培训/学习管理',
    keywords: ['课程', '学习', '考试', '题库', '作业', '教务', '培训', '学生', '教师', '课堂', '成绩', '排课'],
    purpose: '用于支撑课程教学、学习过程管理和考试评价',
    targetUsers: '学生、教师、培训机构管理人员',
  },
  {
    id: 'healthcare-service',
    label: '诊疗健康服务',
    keywords: ['诊疗', '病历', '处方', '药品', '医生', '护士', '患者', '挂号', '检查报告', '随访', '健康档案'],
    purpose: '用于支撑诊疗记录、患者服务和健康数据管理',
    targetUsers: '医护人员、患者服务人员、医疗机构管理人员',
  },
  {
    id: 'logistics-dispatch',
    label: '物流运输/配送调度',
    keywords: ['配送', '运单', '车辆', '司机', '仓配', '路线', '签收', '货运', '调度', '轨迹', '电子面单'],
    purpose: '用于支撑运输调度、运单跟踪、配送履约和签收管理',
    targetUsers: '调度人员、司机、仓配人员、物流运营人员',
    compatibleIndustryIds: ['transport-logistics', 'internet-platform', 'information-service'],
    fallbackIndustryId: 'transport-logistics',
  },
  {
    id: 'manufacturing-mes',
    label: '生产制造/MES',
    keywords: ['MES', '生产工单', '产线', '质检', '工艺', '排产', '物料', '车间', '设备点检', '生产计划'],
    purpose: '用于支撑生产计划、制造执行、质量检查和车间协同',
    targetUsers: '生产管理人员、车间人员、质检人员',
  },
  {
    id: 'government-service',
    label: '政务办理/监管服务',
    keywords: ['政务', '办事', '审批', '监管', '执法', '事项', '公示', '网格', '民生', '政企', '一网通办'],
    purpose: '用于支撑政务事项办理、业务监管和公共服务管理',
    targetUsers: '政务工作人员、监管人员、办事群众或企业',
  },
  {
    id: 'data-bi',
    label: '数据分析/报表看板',
    keywords: ['BI', '数据分析', '大数据', '报表', '看板', '指标', '数据仓库', '数据湖', '可视化', '统计分析'],
    purpose: '用于支撑数据汇总、指标分析、报表展示和决策辅助',
    targetUsers: '业务分析人员、管理人员、数据运营人员',
  },
  {
    id: 'document-office',
    label: '文档/办公资料处理',
    keywords: ['文档', 'PDF', 'Word', 'Excel', 'OCR', '表格', '格式转换', '签章', '水印', '档案', '批量处理'],
    purpose: '用于支撑文档生成、格式转换、资料整理和办公处理',
    targetUsers: '办公人员、资料管理人员、业务经办人员',
  },
  {
    id: 'ai-service',
    label: '智能识别/模型服务',
    keywords: ['人工智能', '机器学习', '深度学习', '模型', '推理', '训练', '识别', 'NLP', '大模型', '智能问答', '图像识别'],
    purpose: '用于支撑智能识别、预测分析、内容理解和自动化处理',
    targetUsers: '业务操作人员、数据人员、系统管理员',
  },
  {
    id: 'iot-device',
    label: '物联网/设备监控',
    keywords: ['物联网', 'IoT', '设备', '传感器', '采集', '网关', '边缘', '遥测', '告警', '设备监控', 'MQTT'],
    purpose: '用于支撑设备接入、数据采集、状态监控和异常告警',
    targetUsers: '设备管理人员、运维人员、现场工作人员',
  },
  {
    id: 'devops-monitoring',
    label: '运维监控/持续交付',
    keywords: ['DevOps', 'CI/CD', '容器', 'Kubernetes', 'Docker', '监控告警', '日志', '链路追踪', '部署', '运维'],
    purpose: '用于支撑系统部署、运行监控、日志分析和持续交付',
    targetUsers: '研发人员、测试人员、运维人员',
  },
  {
    id: 'media-processing',
    label: '音视频/媒体处理',
    keywords: ['视频', '音频', '媒体', '直播', '录音', '转码', '剪辑', '字幕', '播放器', '流媒体'],
    purpose: '用于支撑音视频采集、处理、播放和媒体资源管理',
    targetUsers: '媒体运营人员、内容生产人员、审核人员',
  },
  {
    id: 'project-collaboration',
    label: '项目任务/研发协作',
    keywords: ['项目管理', '任务', '里程碑', '需求', '缺陷', '迭代', '看板', '工时', '版本管理', '协作'],
    purpose: '用于支撑项目计划、任务协作、进度跟踪和交付管理',
    targetUsers: '项目经理、研发人员、业务协同人员',
  },
  {
    id: 'hr-management',
    label: '人事/组织管理',
    keywords: ['人力资源', 'HR', '招聘', '员工', '薪酬', '绩效', '考勤', '组织架构', '培训', '档案'],
    purpose: '用于支撑员工档案、招聘培训、考勤绩效和组织管理',
    targetUsers: '人事人员、部门负责人、企业员工',
  },
  {
    id: 'gis-map',
    label: '地图/GIS空间管理',
    keywords: ['GIS', '地图', '地理', '定位', '轨迹', '坐标', '空间分析', '测绘', '遥感', '路径规划'],
    purpose: '用于支撑地理信息展示、空间分析、轨迹管理和定位服务',
    targetUsers: '业务调度人员、地理信息人员、管理人员',
  },
  {
    id: 'security-access',
    label: '安全管控/权限审计',
    keywords: ['安全', '加密', '权限', '审计', '漏洞', '防护', '登录认证', '密钥', '访问控制', '风控'],
    purpose: '用于支撑身份认证、权限控制、安全审计和风险防护',
    targetUsers: '系统管理员、安全管理员、业务管理人员',
  },
];

const INDUSTRY_RULES: IndustryRule[] = [
  {
    id: 'finance',
    label: '金融业',
    keywords: ['银行', '证券', '保险', '基金', '信贷', '授信', '风控', '清算', '账务', '支付结算', '交易流水', '金融'],
    purposePrefix: '金融业务',
  },
  {
    id: 'manufacturing',
    label: '制造业',
    keywords: ['制造执行', '生产制造', '智能制造', '工厂', '车间', '产线', 'MES', '工艺路线', '生产排产', '物料清单', 'BOM', '设备点检', '生产计划', '生产工单'],
    purposePrefix: '生产制造业务',
  },
  {
    id: 'healthcare',
    label: '卫生和社会工作',
    keywords: ['医疗', '医院', '诊疗', '医生', '护士', '患者', '病历', '处方', '药品', '挂号', '检查报告', '健康'],
    purposePrefix: '医疗健康服务',
  },
  {
    id: 'education',
    label: '教育',
    keywords: ['教育', '学校', '教务', '课程', '学生', '教师', '培训', '考试', '题库', '作业', '成绩'],
    purposePrefix: '教育教学业务',
  },
  {
    id: 'transport-logistics',
    label: '交通运输、仓储和邮政业',
    keywords: ['物流', '运输', '配送', '运单', '车辆', '司机', '仓配', '路线', '签收', '货运', '调度', '仓储'],
    purposePrefix: '运输仓储业务',
  },
  {
    id: 'government-public',
    label: '公共管理、社会保障和社会组织',
    keywords: ['政务', '办事', '审批', '监管', '执法', '事项', '公示', '网格', '民生', '政企', '街道', '社区治理'],
    purposePrefix: '政务公共服务',
  },
  {
    id: 'retail-commerce',
    label: '批发和零售业',
    keywords: ['零售', '门店', '商城', '电商', '商品', 'SKU', '购物车', '会员', '促销', '售后', '收银', '店铺'],
    purposePrefix: '商贸零售业务',
  },
  {
    id: 'information-service',
    label: '信息传输、软件和信息技术服务业',
    keywords: ['软件', 'SaaS', '云平台', '系统集成', '信息化', '数字化', 'API服务', '数据服务', '平台服务', '技术服务'],
    purposePrefix: '软件信息服务',
  },
  {
    id: 'internet-platform',
    label: '互联网和相关服务',
    keywords: ['互联网平台', '在线平台', '小程序', '移动应用', 'H5', '用户增长', '内容分发', '社区', '线上服务'],
    purposePrefix: '互联网平台业务',
  },
  {
    id: 'energy-utilities',
    label: '电力、热力、燃气及水生产和供应业',
    keywords: ['电力', '电网', '能源', '光伏', '风电', '燃气', '水务', '水表', '电表', '热力', '能耗'],
    purposePrefix: '能源供应业务',
  },
  {
    id: 'construction-realestate',
    label: '建筑业 / 房地产业',
    keywords: ['建筑', '工地', '施工', '工程项目', 'BIM', '房产', '地产', '物业', '楼宇', '租赁', '招商'],
    purposePrefix: '建筑地产业务',
  },
  {
    id: 'agriculture',
    label: '农、林、牧、渔业',
    keywords: ['农业', '农场', '种植', '养殖', '农资', '农产品', '林业', '渔业', '畜牧', '溯源'],
    purposePrefix: '农业生产经营',
  },
  {
    id: 'culture-media',
    label: '文化、体育和娱乐业',
    keywords: ['文化', '媒体', '直播', '短视频', '音视频', '内容审核', '赛事', '票务', '场馆', '文旅'],
    purposePrefix: '文化媒体服务',
  },
  {
    id: 'telecom',
    label: '通信服务业',
    keywords: ['通信运营商', '运营商', '通信业务', '短信平台', '5G网络', 'IMS网络', '宽带业务', '通信网络'],
    purposePrefix: '通信服务业务',
  },
  {
    id: 'tourism-hospitality',
    label: '住宿和餐饮业 / 旅游服务业',
    keywords: ['酒店', '民宿', '餐饮', '点餐', '外卖', '旅游', '景区', '门票', '预订', '客房'],
    purposePrefix: '旅游住宿餐饮业务',
  },
  {
    id: 'automotive',
    label: '汽车服务业',
    keywords: ['汽车', '车辆维保', '车联网', '维修保养', '4S店', '充电桩', '车队', '配件'],
    purposePrefix: '汽车服务业务',
  },
  {
    id: 'environment',
    label: '水利、环境和公共设施管理业',
    keywords: ['环保', '环境监测', '水利', '排污', '碳排放', '垃圾分类', '公共设施', '巡检'],
    purposePrefix: '环境公共设施管理',
  },
  {
    id: 'legal',
    label: '租赁和商务服务业',
    keywords: ['法务', '合同', '律所', '案件', '仲裁', '咨询服务', '商务服务', '招投标'],
    purposePrefix: '商务服务业务',
  },
  {
    id: 'research',
    label: '科学研究和技术服务业',
    keywords: ['科研', '实验室', '实验数据', '研发项目', '检测', '检验', '仿真', '算法研究'],
    purposePrefix: '科研技术服务',
  },
  {
    id: 'public-security',
    label: '公共安全相关服务',
    keywords: ['公安', '消防', '应急', '安防', '门禁', '巡更', '预警', '指挥调度', '安全生产'],
    purposePrefix: '公共安全业务',
  },
];

const DEFAULT_INFO: ApplicationInfo = {
  softwareName: '',
  shortName: '',
  version: '',
  copyrightOwner: '',
  ownerType: 'enterprise',
  completionDate: new Date().toISOString().slice(0, 10),
  publishStatus: 'unpublished',
  publishDate: '',
  developmentMethod: 'original',
  devHardware: '',
  runHardware: '',
  devOs: '',
  runOs: '',
  devTools: '',
  supportSoftware: '',
  softwareCategory: '',
  industry: '',
  targetUsers: '',
  purpose: '',
  mainFunctions: '',
  technicalFeatures: '',
};

const OFFICIAL_RULES = [
  '先形成业务理解、申请表信息、代码选择和操作手册 Markdown 草稿，逐阶段确认后再生成正式资料。',
  '著作权人、日期、硬件和操作系统等无法从项目准确判断的字段必须由用户填写并确认。',
  '源程序必须来自真实项目代码，不生成、不改写、不补造代码。',
  '代码材料只读取用户确认的文件和起止行段，抽取清单可回溯到真实源码。',
  '源程序达到 60 页及以上时按前 30 页和后 30 页交存；不足 60 页时提交全部。',
  `源程序材料按每页不少于 50 行要求处理，当前按 ${CODE_LINES_PER_PAGE} 行/页估算以避免页数不足。`,
  '操作手册保留可见截图位置；选择截图方式并确认全部草稿后才能导出正式 Word/TXT。',
];

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function joinPath(base: string, ...parts: string[]) {
  const separator = base.includes('\\') ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...parts.map((part) => part.replace(/^[\\/]+|[\\/]+$/g, ''))]
    .filter(Boolean)
    .join(separator);
}

function normalizeText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sanitizeFileName(value: string) {
  const invalid = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  return Array.from(value || '软件')
    .map((char) => (invalid.has(char) || char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function markdownTable(rows: Array<[string, string]>) {
  return ['| 项目 | 内容 |', '| --- | --- |', ...rows.map(([key, value]) => `| ${key} | ${value || '-'} |`)].join(
    '\n'
  );
}

function loadSavedInfo(): ApplicationInfo {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_INFO;
    return { ...DEFAULT_INFO, ...(JSON.parse(raw) as Partial<ApplicationInfo>) };
  } catch {
    return DEFAULT_INFO;
  }
}

function saveInfo(info: ApplicationInfo) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
}

function exportBlockingReason(analysis: ProjectAnalysis | null, failed?: ValidationItem) {
  if (!analysis) return '请先选择项目目录并完成自动分析';
  if (failed) return `自检未通过：${failed.label}`;
  return '可以导出资料';
}

function workflowBlockingReason(confirmations: WorkflowConfirmations) {
  if (!confirmations.business) return '请先确认业务理解';
  if (!confirmations.applicationFields) return '请补全并确认申请表字段';
  if (!confirmations.codeSelection) return '请确认代码文件和抽取行段';
  if (!confirmations.screenshotMethod) return '请选择操作手册截图方式';
  if (!confirmations.markdown) return '请确认全部 Markdown 草稿';
  return '';
}

interface PdfCursor {
  page: PDFPage;
  y: number;
}

async function loadChinesePdfFont(doc: PDFDocument) {
  doc.registerFontkit(fontkit);
  if (!cachedChinesePdfFontBytes) {
    const fontData = await invoke<number[]>('get_chinese_font');
    cachedChinesePdfFontBytes = new Uint8Array(fontData);
  }
  try {
    return await doc.embedFont(cachedChinesePdfFontBytes, { subset: true });
  } catch (error) {
    cachedChinesePdfFontBytes = null;
    throw new Error(`中文字体嵌入失败：${String(error)}`);
  }
}

function pdfSupportedChars(font: PDFFont) {
  try {
    return new Set(font.getCharacterSet());
  } catch {
    return null;
  }
}

function normalizePdfText(value: string, supportedChars: Set<number> | null) {
  const fallback = supportedChars?.has('?'.codePointAt(0) || 63) ? '?' : ' ';
  let output = '';
  for (const char of value.replace(/\t/g, '    ').replace(/\u00a0/g, ' ')) {
    const codePoint = char.codePointAt(0) || 0;
    if (codePoint < 32) {
      output += ' ';
      continue;
    }
    output += !supportedChars || supportedChars.has(codePoint) ? char : fallback;
  }
  return output;
}

function wrapPdfText(value: string, font: PDFFont, size: number, maxWidth: number, supportedChars: Set<number> | null) {
  const text = normalizePdfText(value, supportedChars);
  if (!text) return [''];
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const char of Array.from(text)) {
    const charWidth = font.widthOfTextAtSize(char, size);
    if (current && currentWidth + charWidth > maxWidth) {
      lines.push(current);
      current = char;
      currentWidth = charWidth;
    } else {
      current += char;
      currentWidth += charWidth;
    }
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}

function addPdfPage(doc: PDFDocument) {
  return doc.addPage([PDF_A4_WIDTH, PDF_A4_HEIGHT]);
}

function ensurePdfSpace(doc: PDFDocument, cursor: PdfCursor, neededHeight: number) {
  if (cursor.y - neededHeight < PDF_MARGIN) {
    cursor.page = addPdfPage(doc);
    cursor.y = PDF_A4_HEIGHT - PDF_MARGIN;
  }
}

function drawPdfWrappedText(
  doc: PDFDocument,
  cursor: PdfCursor,
  text: string,
  font: PDFFont,
  supportedChars: Set<number> | null,
  options: {
    size: number;
    lineHeight: number;
    x?: number;
    maxWidth?: number;
    align?: 'left' | 'center';
    spacingAfter?: number;
  }
) {
  const x = options.x ?? PDF_MARGIN;
  const maxWidth = options.maxWidth ?? PDF_CONTENT_WIDTH;
  const lines = wrapPdfText(text, font, options.size, maxWidth, supportedChars);
  for (const line of lines) {
    ensurePdfSpace(doc, cursor, options.lineHeight);
    const lineWidth = line ? font.widthOfTextAtSize(line, options.size) : 0;
    const textX = options.align === 'center' ? x + Math.max(0, (maxWidth - lineWidth) / 2) : x;
    if (line) {
      cursor.page.drawText(line, {
        x: textX,
        y: cursor.y - options.size,
        size: options.size,
        font,
        color: rgb(0, 0, 0),
      });
    }
    cursor.y -= options.lineHeight;
  }
  if (options.spacingAfter) {
    cursor.y -= options.spacingAfter;
  }
}

function isMarkdownTableLine(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function isMarkdownTableSeparator(cells: string[]) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function markdownTableColumnWidths(columnCount: number) {
  if (columnCount === 3) return [88, 206, PDF_CONTENT_WIDTH - 88 - 206];
  if (columnCount === 2) return [128, PDF_CONTENT_WIDTH - 128];
  const width = PDF_CONTENT_WIDTH / Math.max(1, columnCount);
  return Array.from({ length: Math.max(1, columnCount) }, () => width);
}

function drawPdfTable(
  doc: PDFDocument,
  cursor: PdfCursor,
  rawRows: string[][],
  font: PDFFont,
  supportedChars: Set<number> | null
) {
  const rows = rawRows.filter((row) => !isMarkdownTableSeparator(row));
  if (!rows.length) return;
  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = markdownTableColumnWidths(columnCount);
  const paddingX = 4;
  const paddingY = 4;
  const maxRowHeight = PDF_A4_HEIGHT - PDF_MARGIN * 2;

  rows.forEach((row, rowIndex) => {
    const cells = Array.from({ length: columnCount }, (_, index) => row[index] || '');
    const cellLines = cells.map((cell, index) =>
      wrapPdfText(cell, font, PDF_TABLE_FONT_SIZE, Math.max(8, widths[index] - paddingX * 2), supportedChars)
    );
    const rowHeight = Math.max(1, ...cellLines.map((lines) => lines.length)) * PDF_TABLE_LINE_HEIGHT + paddingY * 2;

    if (rowHeight > maxRowHeight) {
      drawPdfWrappedText(doc, cursor, cells.join('  '), font, supportedChars, {
        size: PDF_REPORT_FONT_SIZE,
        lineHeight: PDF_REPORT_LINE_HEIGHT,
        spacingAfter: 6,
      });
      return;
    }

    ensurePdfSpace(doc, cursor, rowHeight);
    const top = cursor.y;
    let x = PDF_MARGIN;
    cells.forEach((_, index) => {
      cursor.page.drawRectangle({
        x,
        y: top - rowHeight,
        width: widths[index],
        height: rowHeight,
        borderWidth: 0.5,
        borderColor: rgb(0.72, 0.75, 0.78),
        color: rowIndex === 0 ? rgb(0.95, 0.97, 0.97) : undefined,
      });
      x += widths[index];
    });

    x = PDF_MARGIN;
    cellLines.forEach((lines, cellIndex) => {
      let textY = top - paddingY - PDF_TABLE_FONT_SIZE;
      lines.forEach((line) => {
        if (line) {
          cursor.page.drawText(line, {
            x: x + paddingX,
            y: textY,
            size: PDF_TABLE_FONT_SIZE,
            font,
            color: rgb(0, 0, 0),
          });
        }
        textY -= PDF_TABLE_LINE_HEIGHT;
      });
      x += widths[cellIndex];
    });
    cursor.y = top - rowHeight;
  });
  cursor.y -= 8;
}

function renderCodePdf(doc: PDFDocument, cursor: PdfCursor, content: string, font: PDFFont, supportedChars: Set<number> | null) {
  for (const rawLine of content.split(/\r?\n/)) {
    const lines = wrapPdfText(rawLine.trimEnd(), font, PDF_CODE_FONT_SIZE, PDF_CONTENT_WIDTH, supportedChars);
    for (const line of lines) {
      ensurePdfSpace(doc, cursor, PDF_CODE_LINE_HEIGHT);
      if (line) {
        cursor.page.drawText(line, {
          x: PDF_MARGIN,
          y: cursor.y - PDF_CODE_FONT_SIZE,
          size: PDF_CODE_FONT_SIZE,
          font,
          color: rgb(0, 0, 0),
        });
      }
      cursor.y -= PDF_CODE_LINE_HEIGHT;
    }
  }
}

function renderReportPdf(
  doc: PDFDocument,
  cursor: PdfCursor,
  title: string,
  content: string,
  font: PDFFont,
  supportedChars: Set<number> | null
) {
  drawPdfWrappedText(doc, cursor, title, font, supportedChars, {
    size: 16,
    lineHeight: 24,
    align: 'center',
    spacingAfter: 10,
  });

  let lines = content.split(/\r?\n/);
  const firstHeading = lines[0]?.replace(/^#\s+/, '').trim();
  if (firstHeading === title.trim()) {
    lines = lines.slice(1);
    while (lines[0]?.trim() === '') lines.shift();
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    if (isMarkdownTableLine(line)) {
      const tableRows: string[][] = [];
      while (index < lines.length && isMarkdownTableLine(lines[index])) {
        tableRows.push(parseMarkdownTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      drawPdfTable(doc, cursor, tableRows, font, supportedChars);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      cursor.y -= 8;
      ensurePdfSpace(doc, cursor, PDF_REPORT_LINE_HEIGHT);
      continue;
    }

    if (trimmed.startsWith('# ')) {
      drawPdfWrappedText(doc, cursor, trimmed.slice(2), font, supportedChars, {
        size: 15,
        lineHeight: 22,
        spacingAfter: 4,
      });
    } else if (trimmed.startsWith('## ')) {
      drawPdfWrappedText(doc, cursor, trimmed.slice(3), font, supportedChars, {
        size: 13,
        lineHeight: 20,
        spacingAfter: 3,
      });
    } else if (trimmed.startsWith('### ')) {
      drawPdfWrappedText(doc, cursor, trimmed.slice(4), font, supportedChars, {
        size: 12,
        lineHeight: 18,
        spacingAfter: 2,
      });
    } else {
      const text = trimmed.startsWith('- ') ? `- ${trimmed.slice(2)}` : trimmed;
      drawPdfWrappedText(doc, cursor, text, font, supportedChars, {
        size: PDF_REPORT_FONT_SIZE,
        lineHeight: PDF_REPORT_LINE_HEIGHT,
        spacingAfter: 2,
      });
    }
  }
}

async function writePdf(outputPath: string, title: string, content: string, kind: MaterialDocumentKind) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator('McStartUP');
  doc.setProducer('McStartUP');
  const font = await loadChinesePdfFont(doc);
  const supportedChars = pdfSupportedChars(font);
  const cursor: PdfCursor = {
    page: addPdfPage(doc),
    y: PDF_A4_HEIGHT - PDF_MARGIN,
  };

  if (kind === 'code') {
    renderCodePdf(doc, cursor, content, font, supportedChars);
  } else {
    renderReportPdf(doc, cursor, title, content, font, supportedChars);
  }

  const pdfBytes = await doc.save();
  await writeBinaryFile(outputPath, pdfBytes);
}

function writeDocx(
  outputPath: string,
  title: string,
  content: string,
  kind: MaterialDocumentKind,
  headerText?: string,
  linesPerPage?: number
) {
  return invoke<void>('software_copyright_write_docx', {
    request: {
      outputPath,
      title,
      content,
      kind,
      headerText,
      linesPerPage,
    } satisfies DocxRequest,
  });
}

function writeGeneratedFiles(dirs: string[], files: TextFileWrite[]) {
  return invoke<void>('software_copyright_write_files', {
    request: {
      dirs,
      files,
    },
  });
}

function splitList(value: string, fallback: string[] = []) {
  const items = value
    .split(/[，,、；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? Array.from(new Set(items)) : fallback;
}

function fileKind(file: ProjectFile): ProjectFileKind {
  if (file.kind) return file.kind;
  const lowerName = file.name.toLowerCase();
  if (CONFIG_FILE_NAMES.includes(lowerName) || ['json', 'yaml', 'yml', 'toml', 'xml', 'gradle'].includes(file.ext)) {
    return 'config';
  }
  if (DOC_EXTENSIONS.has(file.ext) || lowerName.startsWith('readme.')) return 'doc';
  if (SOURCE_EXTENSIONS[file.ext]) return 'source';
  return 'resource';
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stackNames(items: DetectionItem[] | undefined) {
  return (items || []).map((item) => item.name);
}

function addDetection(target: Map<string, DetectionItem>, name: string, source: string, detail: string) {
  if (!name) return;
  const current = target.get(name) || { name, evidence: [] };
  const evidence = `${source}${detail ? `：${detail}` : ''}`;
  if (!current.evidence.includes(evidence) && current.evidence.length < 6) current.evidence.push(evidence);
  target.set(name, current);
}

function toDetectionList(map: Map<string, DetectionItem>) {
  return Array.from(map.values()).sort((a, b) => b.evidence.length - a.evidence.length || a.name.localeCompare(b.name));
}

function normalizeVersion(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 'V1.0';
  return /^v/i.test(trimmed) ? trimmed.toUpperCase() : `V${trimmed}`;
}

function humanizeName(value: string) {
  return value
    .replace(/^@[^/]+\//, '')
    .replace(/\.(software|app|web|server|client)$/i, '')
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map((part) => (/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function normalizeCandidateName(value: string) {
  return value
    .replace(/[《》"'`]/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/, '')
    .replace(/^>\s*/, '')
    .replace(/\s*(出品|版权所有|copyright).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function looksLikeChineseProductName(value: string) {
  return /[\u4e00-\u9fa5]/.test(value) && /(系统|平台|软件|应用|工具|中心|门户|管理|助手|客户端|服务)$/.test(value.trim());
}

function isWeakNameCandidate(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length < 2 ||
    [
      'app',
      'application',
      'software',
      'web',
      'website',
      'admin',
      'demo',
      'test',
      'index',
      'react app',
      'vite app',
      'next app',
      'vue app',
    ].includes(normalized)
  );
}

function canReadInlineTitle(file: ProjectFile) {
  const path = file.relativePath.toLowerCase();
  if (fileKind(file) === 'doc' || fileKind(file) === 'config') return true;
  return /(^|\/)(index\.html|app|main|layout|router|routes|config|settings?)\./i.test(path);
}

function addNameCandidate(candidates: NameCandidate[], seen: Set<string>, name: string, source: string, confidence: number) {
  const normalized = normalizeCandidateName(name);
  if (isWeakNameCandidate(normalized)) return;
  const key = normalized.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ name: normalized, source, confidence, evidence: source });
}

function extractNameCandidates(root: string, files: ProjectFile[], packageJson: Record<string, unknown> | null): NameCandidate[] {
  const candidates: NameCandidate[] = [];
  const seen = new Set<string>();
  const evidenceFiles = [
    ...files.filter((file) => /(^|\/)(readme(\.|$)|README(\.|$))/i.test(file.relativePath)),
    ...files.filter((file) => fileKind(file) === 'doc'),
    ...files.filter((file) => /(^|\/)(index\.html|app|main|layout|router|routes|config|setting)/i.test(file.relativePath)),
  ].slice(0, 160);

  for (const file of evidenceFiles) {
    const text = normalizeText(file.content || '').slice(0, 20000);
    if (!text) continue;
    const isReadme = /(^|\/)readme(\.|$)/i.test(file.relativePath);
    const mdHeadings =
      file.ext === 'md' || file.ext === 'markdown'
        ? Array.from(text.matchAll(/^\s*#\s+(.{2,80})$/gm)).map((match) => match[1])
        : [];
    for (const heading of mdHeadings.slice(0, 5)) {
      const cleaned = normalizeCandidateName(heading);
      const confidence = isReadme && looksLikeChineseProductName(cleaned) ? 98 : looksLikeChineseProductName(cleaned) ? 94 : isReadme ? 90 : 82;
      addNameCandidate(candidates, seen, cleaned, `${file.relativePath} 一级标题`, confidence);
    }

    const labeledName = text.match(/(?:软件名称|系统名称|项目名称|产品名称)\s*[:：]\s*([^\n\r|，,]{2,80})/i)?.[1];
    if (labeledName) addNameCandidate(candidates, seen, labeledName, `${file.relativePath} 名称字段`, 96);

    const title = text.match(/<title[^>]*>([^<]{2,80})<\/title>/i)?.[1];
    if (title) addNameCandidate(candidates, seen, title, `${file.relativePath} <title>`, looksLikeChineseProductName(title) ? 94 : 86);

    if (canReadInlineTitle(file)) {
      const appTitle = text.match(/\b(?:appName|appTitle|systemName|projectName|productName|title)\s*[:=]\s*['"`]([^'"`]{2,80})['"`]/i)?.[1];
      if (appTitle) addNameCandidate(candidates, seen, appTitle, `${file.relativePath} 标题字段`, looksLikeChineseProductName(appTitle) ? 92 : 78);
    }
  }

  const tauriConfig = files.find((file) => file.relativePath.toLowerCase().endsWith('tauri.conf.json'));
  const tauriJson = parseJsonObject(tauriConfig?.content);
  const tauriProductName = String(
    (tauriJson?.package as Record<string, unknown> | undefined)?.productName ||
      (tauriJson?.productName as string | undefined) ||
      ''
  ).trim();
  if (tauriProductName) addNameCandidate(candidates, seen, tauriProductName, `${tauriConfig?.relativePath || 'tauri.conf.json'} productName`, 88);

  const productName = String(packageJson?.productName || '').trim();
  if (productName) addNameCandidate(candidates, seen, productName, 'package.json productName', 86);
  const displayName = String(packageJson?.displayName || '').trim();
  if (displayName) addNameCandidate(candidates, seen, displayName, 'package.json displayName', 84);
  const packageName = String(packageJson?.name || '').trim();
  if (packageName) addNameCandidate(candidates, seen, humanizeName(packageName), 'package.json name（工程包名，低于 README 标题）', 62);
  const rootName = humanizeName(basename(root));
  addNameCandidate(candidates, seen, rootName, '项目目录名称（低置信，仅供参考）', 45);

  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}

function extractVersionCandidates(files: ProjectFile[], packageJson: Record<string, unknown> | null): VersionCandidate[] {
  const candidates: VersionCandidate[] = [];
  const seen = new Set<string>();
  const add = (version: string, source: string, confidence: number) => {
    const normalized = normalizeVersion(version.replace(/^version\s*[:=]\s*/i, '').trim());
    if (!/^V\d+(\.\d+)*([.-]?[A-Za-z0-9]+)?$/.test(normalized)) return;
    if (seen.has(normalized.toLowerCase())) return;
    seen.add(normalized.toLowerCase());
    candidates.push({ version: normalized, source, confidence });
  };
  const readmeFiles = files.filter((file) => /(^|\/)readme(\.|$)/i.test(file.relativePath));
  for (const file of readmeFiles.slice(0, 8)) {
    const text = normalizeText(file.content || '').slice(0, 8000);
    const version = text.match(/(?:版本|version)\s*[:：]\s*([vV]?\d+(?:\.\d+)+(?:[-._][A-Za-z0-9]+)?)/i)?.[1];
    if (version) add(version, `${file.relativePath} 版本字段`, 92);
  }
  if (packageJson?.version) add(String(packageJson.version), 'package.json version', 82);
  const cargo = files.find((file) => file.relativePath.toLowerCase().endsWith('cargo.toml'));
  const cargoVersion = cargo?.content?.match(/^\s*version\s*=\s*["']([^"']+)["']/m)?.[1];
  if (cargoVersion) add(cargoVersion, `${cargo?.relativePath} version`, 78);
  const pubspec = files.find((file) => file.relativePath.toLowerCase().endsWith('pubspec.yaml'));
  const pubspecVersion = pubspec?.content?.match(/^\s*version\s*:\s*([^\s#]+)/m)?.[1];
  if (pubspecVersion) add(pubspecVersion, `${pubspec?.relativePath} version`, 78);
  return candidates.slice(0, 6);
}

function versionLooksLowerThanOne(value: string) {
  const match = value.trim().match(/^v?0\./i);
  return Boolean(match);
}

function languagePriority(file: ProjectFile) {
  const path = file.relativePath.toLowerCase();
  const name = file.name.toLowerCase();
  let score = 50;
  if (/(^|\/)(src|app|pages|views|components|router|routes|store|stores|api|services|tools)(\/|$)/.test(path)) {
    score -= 18;
  }
  if (/app|main|index|router|routes|layout|page|tool|manager|service|api|store|component/.test(name)) {
    score -= 16;
  }
  if (/\.(test|spec|stories)\./.test(name) || /(^|\/)(__tests__|test|tests|mock|mocks)(\/|$)/.test(path)) {
    score += 35;
  }
  if (name.endsWith('.d.ts')) score += 28;
  if (['json', 'yml', 'yaml', 'toml', 'xml', 'css', 'scss', 'less'].includes(file.ext)) score += 16;
  if (file.lines < 3) score += 12;
  return score;
}

function detectFramework(files: ProjectFile[], packageJson: Record<string, unknown> | null) {
  const deps = {
    ...((packageJson?.dependencies as Record<string, unknown>) || {}),
    ...((packageJson?.devDependencies as Record<string, unknown>) || {}),
  };
  const names = Object.keys(deps);
  if (names.includes('@tauri-apps/api')) return 'Tauri 桌面应用';
  if (names.includes('electron')) return 'Electron 桌面应用';
  if (names.includes('next')) return 'Next.js Web 应用';
  if (names.includes('react')) return 'React 应用';
  if (names.includes('vue')) return 'Vue 应用';
  if (names.includes('svelte')) return 'Svelte 应用';
  if (files.some((file) => file.ext === 'rs')) return 'Rust 应用';
  if (files.some((file) => file.ext === 'py')) return 'Python 应用';
  if (names.length > 0) return 'Node.js 应用';
  return '通用软件项目';
}

function summarizeProjectType(techStack: TechStack, fallback: string) {
  return stackNames(techStack.projectTypes).slice(0, 3).join('、') || fallback;
}

function summarizeArchitecture(files: ProjectFile[], techStack: TechStack) {
  const paths = files.map((file) => file.relativePath.toLowerCase());
  const hasFrontend =
    paths.some((path) => /(^|\/)(pages|views|components|src\/app|src\/pages)\//.test(path)) ||
    stackNames(techStack.frameworks).some((name) => /react|vue|next|nuxt|svelte|flutter/i.test(name));
  const hasBackend =
    paths.some((path) => /(^|\/)(controllers|controller|services|service|routes|routers|api|apis)\//.test(path)) ||
    stackNames(techStack.frameworks).some((name) => /spring|express|koa|nestjs|django|fastapi|flask|gin|fiber|laravel/i.test(name));
  if (hasFrontend && hasBackend) return '前后端混合或全栈项目';
  if (hasFrontend) return '前端/客户端项目';
  if (hasBackend) return '后端/API 服务项目';
  return '未识别到明显前后端分层';
}

function detectTechStack(files: ProjectFile[], packageJson: Record<string, unknown> | null): TechStack {
  const deps = {
    ...((packageJson?.dependencies as Record<string, unknown>) || {}),
    ...((packageJson?.devDependencies as Record<string, unknown>) || {}),
  };
  const depNames = new Set(Object.keys(deps).map((item) => item.toLowerCase()));
  const paths = files.map((file) => file.relativePath.toLowerCase());
  const languages = summarizeLanguages(files)
    .filter((item) => item.lines > 0)
    .map((item) => item.language)
    .slice(0, 8);
  const frameworks = new Map<string, DetectionItem>();
  const databases = new Map<string, DetectionItem>();
  const middleware = new Map<string, DetectionItem>();
  const runtimes = new Map<string, DetectionItem>();
  const buildTools = new Map<string, DetectionItem>();
  const packageManagers = new Map<string, DetectionItem>();
  const projectTypes = new Map<string, DetectionItem>();

  const hasPath = (pattern: RegExp) => paths.some((path) => pattern.test(path));
  const hasDep = (...names: string[]) => names.some((name) => depNames.has(name.toLowerCase()));
  const configText = files
    .filter((file) => fileKind(file) === 'config')
    .map((file) => `${file.relativePath}\n${file.content || ''}`)
    .join('\n')
    .toLowerCase();
  const allEvidenceText = files
    .slice(0, 240)
    .map((file) => `${file.relativePath}\n${file.content || ''}`)
    .join('\n')
    .toLowerCase();

  if (depNames.size > 0 || hasPath(/(^|\/)package\.json$/)) {
    addDetection(runtimes, 'Node.js', 'package.json', '存在 Node 依赖或脚本配置');
    addDetection(packageManagers, 'npm/yarn/pnpm', 'package.json', 'Node 生态包管理配置');
  }
  if (hasDep('react')) {
    addDetection(frameworks, 'React', 'package.json dependencies', 'react');
    addDetection(projectTypes, 'Web 前端应用', 'React 依赖', '存在前端界面框架');
  }
  if (hasDep('vue')) {
    addDetection(frameworks, 'Vue', 'package.json dependencies', 'vue');
    addDetection(projectTypes, 'Web 前端应用', 'Vue 依赖', '存在前端界面框架');
  }
  if (hasDep('next')) addDetection(frameworks, 'Next.js', 'package.json dependencies', 'next');
  if (hasDep('nuxt')) addDetection(frameworks, 'Nuxt', 'package.json dependencies', 'nuxt');
  if (hasDep('svelte')) addDetection(frameworks, 'Svelte', 'package.json dependencies', 'svelte');
  if (hasDep('vite')) addDetection(buildTools, 'Vite', 'package.json dependencies', 'vite');
  if (hasDep('webpack')) addDetection(buildTools, 'Webpack', 'package.json dependencies', 'webpack');
  if (hasDep('@tauri-apps/api') || hasPath(/(^|\/)src-tauri\//)) {
    addDetection(frameworks, 'Tauri', 'Tauri 配置/依赖', '桌面壳与前端结合');
    addDetection(projectTypes, '桌面应用', 'src-tauri / @tauri-apps/api', '存在桌面应用运行容器');
  }
  if (hasDep('electron')) {
    addDetection(frameworks, 'Electron', 'package.json dependencies', 'electron');
    addDetection(projectTypes, '桌面应用', 'Electron 依赖', '存在桌面应用运行容器');
  }
  if (hasDep('express')) addDetection(frameworks, 'Express', 'package.json dependencies', 'express');
  if (hasDep('koa')) addDetection(frameworks, 'Koa', 'package.json dependencies', 'koa');
  if (hasDep('@nestjs/core', 'nestjs')) addDetection(frameworks, 'NestJS', 'package.json dependencies', '@nestjs/core');

  if (hasPath(/(^|\/)pom\.xml$/)) {
    addDetection(buildTools, 'Maven', 'pom.xml', 'Java 构建配置');
    addDetection(runtimes, 'JVM', 'pom.xml', 'Java 运行环境');
    addDetection(projectTypes, 'Java 后端应用', 'pom.xml', '存在 Java 项目配置');
  }
  if (hasPath(/(^|\/)build\.gradle(\.kts)?$/)) {
    addDetection(buildTools, 'Gradle', 'build.gradle', 'Java/Kotlin 构建配置');
    addDetection(runtimes, 'JVM', 'build.gradle', 'Java/Kotlin 运行环境');
  }
  if (/spring-boot|org\.springframework/.test(configText)) addDetection(frameworks, 'Spring Boot', 'Maven/Gradle 配置', 'Spring 依赖线索');
  if (/mybatis/.test(configText)) addDetection(frameworks, 'MyBatis', 'Maven/Gradle 配置', 'MyBatis 依赖线索');

  if (hasPath(/(^|\/)(requirements\.txt|pyproject\.toml)$/)) {
    addDetection(runtimes, 'Python', 'requirements.txt / pyproject.toml', 'Python 依赖配置');
    addDetection(projectTypes, 'Python 应用', 'Python 配置文件', '存在 Python 项目配置');
  }
  if (/django/.test(configText)) addDetection(frameworks, 'Django', 'Python 依赖配置', 'django');
  if (/fastapi/.test(configText)) addDetection(frameworks, 'FastAPI', 'Python 依赖配置', 'fastapi');
  if (/flask/.test(configText)) addDetection(frameworks, 'Flask', 'Python 依赖配置', 'flask');

  if (hasPath(/(^|\/)go\.mod$/)) {
    addDetection(runtimes, 'Go', 'go.mod', 'Go Module 配置');
    addDetection(projectTypes, 'Go 后端应用', 'go.mod', '存在 Go 项目配置');
  }
  if (/gin-gonic\/gin/.test(configText)) addDetection(frameworks, 'Gin', 'go.mod', 'gin-gonic/gin');
  if (/gofiber\/fiber/.test(configText)) addDetection(frameworks, 'Fiber', 'go.mod', 'gofiber/fiber');

  if (hasPath(/(^|\/)composer\.json$/)) {
    addDetection(runtimes, 'PHP', 'composer.json', 'PHP Composer 配置');
    addDetection(projectTypes, 'PHP 应用', 'composer.json', '存在 PHP 项目配置');
  }
  if (/laravel/.test(configText)) addDetection(frameworks, 'Laravel', 'composer.json', 'Laravel 依赖线索');

  if (hasPath(/(^|\/)pubspec\.yaml$/)) {
    addDetection(frameworks, 'Flutter', 'pubspec.yaml', 'Flutter/Dart 配置');
    addDetection(projectTypes, '移动/跨端应用', 'pubspec.yaml', '存在 Flutter 项目配置');
  }
  if (hasPath(/(^|\/)cargo\.toml$/)) {
    addDetection(runtimes, 'Rust', 'Cargo.toml', 'Rust 包配置');
    addDetection(buildTools, 'Cargo', 'Cargo.toml', 'Rust 构建工具');
  }

  if (/mysql|mariadb|mysql2/.test(allEvidenceText)) addDetection(databases, 'MySQL/MariaDB', '依赖/配置文本', 'mysql/mariadb');
  if (/postgres|postgresql|\bpg\b/.test(allEvidenceText)) addDetection(databases, 'PostgreSQL', '依赖/配置文本', 'postgres/postgresql');
  if (/mongodb|mongoose/.test(allEvidenceText)) addDetection(databases, 'MongoDB', '依赖/配置文本', 'mongodb/mongoose');
  if (/sqlite|rusqlite|better-sqlite3/.test(allEvidenceText)) addDetection(databases, 'SQLite', '依赖/配置文本', 'sqlite/rusqlite');
  if (/redis|ioredis/.test(allEvidenceText)) addDetection(middleware, 'Redis', '依赖/配置文本', 'redis/ioredis');
  if (/kafka/.test(allEvidenceText)) addDetection(middleware, 'Kafka', '依赖/配置文本', 'kafka');
  if (/rabbitmq|amqplib/.test(allEvidenceText)) addDetection(middleware, 'RabbitMQ', '依赖/配置文本', 'rabbitmq/amqplib');

  if (hasPath(/(^|\/)(api|apis|controllers|services|routes|routers)\//)) {
    addDetection(projectTypes, '后端/API 服务', '目录结构', '存在 API、Controller、Service 或 Router 目录');
  }
  if (hasPath(/(^|\/)(pages|views|components)\//)) {
    addDetection(projectTypes, '前端界面应用', '目录结构', '存在 Page、View 或 Component 目录');
  }

  return {
    languages,
    frameworks: toDetectionList(frameworks),
    databases: toDetectionList(databases),
    middleware: toDetectionList(middleware),
    runtimes: toDetectionList(runtimes),
    buildTools: toDetectionList(buildTools),
    packageManagers: toDetectionList(packageManagers),
    projectTypes: toDetectionList(projectTypes),
  };
}

function summarizeLanguages(files: ProjectFile[]) {
  const byLanguage = new Map<string, { files: number; lines: number }>();
  for (const file of files) {
    const current = byLanguage.get(file.language) || { files: 0, lines: 0 };
    current.files += 1;
    current.lines += file.lines;
    byLanguage.set(file.language, current);
  }
  return Array.from(byLanguage.entries())
    .map(([language, value]) => ({ language, ...value }))
    .sort((a, b) => b.lines - a.lines);
}

function inferFunctionHints(files: ProjectFile[], packageJson: Record<string, unknown> | null) {
  const hints = new Set<string>();
  const lowerPaths = files.map((file) => file.relativePath.toLowerCase());
  if (lowerPaths.some((path) => /tool|tools|plugin|plugins/.test(path))) hints.add('工具模块管理');
  if (lowerPaths.some((path) => /database|sql|db/.test(path))) hints.add('数据库连接与数据管理');
  if (lowerPaths.some((path) => /pdf|word|excel|office|docx|sheet/.test(path))) hints.add('办公文档处理');
  if (lowerPaths.some((path) => /ocr|image|screenshot|camera/.test(path))) hints.add('图像识别与图片处理');
  if (lowerPaths.some((path) => /download|media|video|audio/.test(path))) hints.add('下载与媒体处理');
  if (lowerPaths.some((path) => /setting|config|store|storage/.test(path))) hints.add('配置管理与本地数据存储');
  if (lowerPaths.some((path) => /api|service|request|http/.test(path))) hints.add('接口调用与服务集成');
  if (lowerPaths.some((path) => /auth|account|user|login/.test(path))) hints.add('用户与账号相关功能');
  if (lowerPaths.some((path) => /report|chart|dashboard|stat/.test(path))) hints.add('数据统计与可视化展示');
  if (lowerPaths.some((path) => /router|route|page|view/.test(path))) hints.add('页面导航与多模块操作');
  const scripts = (packageJson?.scripts as Record<string, unknown>) || {};
  if (Object.keys(scripts).length > 0) hints.add('项目构建、运行和打包流程');
  return Array.from(hints).slice(0, 10);
}

const MODULE_KEYWORDS: Array<[RegExp, string]> = [
  [/user|account|auth|login|permission|role|用户|账号|权限|角色/i, '用户权限管理'],
  [/order|trade|payment|订单|支付|交易/i, '订单管理'],
  [/product|goods|sku|商品|产品/i, '商品信息管理'],
  [/stock|inventory|warehouse|库存|仓库/i, '库存管理'],
  [/report|chart|dashboard|stat|analytics|统计|报表|看板/i, '数据统计分析'],
  [/setting|config|system|系统设置|配置/i, '系统配置管理'],
  [/file|upload|download|export|import|文件|上传|下载|导入|导出/i, '文件导入导出'],
  [/message|notice|notification|消息|通知/i, '消息通知管理'],
  [/customer|client|crm|客户/i, '客户管理'],
  [/log|audit|日志|审计/i, '日志审计管理'],
  [/pdf|word|excel|office|docx|sheet|文档|表格/i, '办公文档处理'],
  [/ocr|screenshot|capture|image|photo|图片|截图|识别/i, '图像识别与图片处理'],
  [/video|audio|media|music|语音|音频|视频/i, '音视频处理'],
  [/network|dns|ping|port|trace|http|网络/i, '网络诊断与请求处理'],
  [/password|secret|encrypt|decrypt|token|密码|加密/i, '安全与密码管理'],
  [/database|sql|db|redis|mongo|postgres|mysql|数据库/i, '数据库管理'],
];

function inferModules(files: ProjectFile[]): ProjectModule[] {
  const moduleMap = new Map<string, ProjectModule>();
  const candidates = files.filter((file) =>
    /(^|\/)(controller|controllers|service|services|router|routes|api|apis|module|modules|pages|views|components|tools|features|domains)(\/|$)/i.test(file.relativePath)
  );
  for (const file of candidates) {
    const normalizedPath = file.relativePath.replace(/\\/g, '/');
    const raw = normalizedPath
      .split('/')
      .filter(Boolean)
      .find((part) => !/^(src|app|controller|controllers|service|services|router|routes|api|apis|module|modules|pages|views|components|tools|features|domains)$/i.test(part));
    const haystack = `${normalizedPath} ${file.name}`;
    const keywordName = MODULE_KEYWORDS.find(([pattern]) => pattern.test(haystack))?.[1];
    const name = keywordName || (raw ? `${humanizeName(raw)}模块` : '核心业务模块');
    const current = moduleMap.get(name) || { name, source: keywordName ? '关键词识别' : '目录结构识别', fileCount: 0, evidence: [] };
    current.fileCount += 1;
    if (current.evidence.length < 6) current.evidence.push(file.relativePath);
    moduleMap.set(name, current);
  }
  return Array.from(moduleMap.values())
    .sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name))
    .slice(0, 16);
}

function analyzeScale(totalFiles: number, sourceFiles: ProjectFile[], docs: ProjectFile[], configFiles: ProjectFile[], modules: ProjectModule[]): ProjectScale {
  const resourceFileCount = Math.max(0, totalFiles - sourceFiles.length - docs.length - configFiles.length);
  const dirs = new Map<string, { path: string; files: number; lines: number }>();
  for (const file of sourceFiles) {
    const top = file.relativePath.replace(/\\/g, '/').split('/').slice(0, 2).join('/') || '.';
    const current = dirs.get(top) || { path: top, files: 0, lines: 0 };
    current.files += 1;
    current.lines += file.lines;
    dirs.set(top, current);
  }
  return {
    sourceFileCount: sourceFiles.length,
    sourceLineCount: sourceFiles.reduce((sum, file) => sum + file.lines, 0),
    docFileCount: docs.length,
    configFileCount: configFiles.length,
    resourceFileCount,
    moduleCount: modules.length,
    topDirectories: Array.from(dirs.values()).sort((a, b) => b.lines - a.lines).slice(0, 12),
  };
}

async function analyzeProject(root: string): Promise<ProjectAnalysis> {
  const scan = await invoke<ProjectScanResult>('software_copyright_scan_project', {
    request: {
      root,
      maxFiles: MAX_SCAN_FILES,
      maxCharsPerFile: MAX_SOURCE_FILE_CHARS,
    },
  });
  const { files, totalFiles, truncated } = scan;
  const sourceFiles = files
    .filter((file) => fileKind(file) === 'source')
    .sort((a, b) => languagePriority(a) - languagePriority(b) || b.lines - a.lines);
  const docs = files.filter((file) => fileKind(file) === 'doc').slice(0, 60);
  const configFiles = files.filter((file) => fileKind(file) === 'config');
  const packageFile =
    configFiles.find((file) => file.relativePath.replace(/\\/g, '/') === 'package.json') ||
    configFiles.find((file) => file.name.toLowerCase() === 'package.json');
  let packageJson: Record<string, unknown> | null = null;
  if (packageFile?.content) {
    packageJson = parseJsonObject(packageFile.content);
  }
  const scripts = Object.keys((packageJson?.scripts as Record<string, unknown>) || {});
  const deps = {
    ...((packageJson?.dependencies as Record<string, unknown>) || {}),
    ...((packageJson?.devDependencies as Record<string, unknown>) || {}),
  };
  const entryHints = sourceFiles
    .filter((file) => /(^|[\\/])(main|index|app|router|routes|layout)\./i.test(file.relativePath))
    .map((file) => file.relativePath)
    .slice(0, 10);
  const modules = inferModules(sourceFiles);
  const techStack = detectTechStack(files, packageJson);
  const framework = detectFramework(sourceFiles, packageJson);
  return {
    root,
    name: String(packageJson?.name || basename(root)),
    totalFiles,
    configFiles,
    sourceFiles,
    docs,
    packageName: String(packageJson?.name || ''),
    packageVersion: String(packageJson?.version || ''),
    packageScripts: scripts,
    dependencies: Object.keys(deps).slice(0, 30),
    framework,
    languages: summarizeLanguages(sourceFiles),
    entryHints,
    functionHints: inferFunctionHints(sourceFiles, packageJson),
    nameCandidates: extractNameCandidates(root, files, packageJson),
    versionCandidates: extractVersionCandidates(files, packageJson),
    modules,
    techStack,
    scale: analyzeScale(totalFiles, sourceFiles, docs, configFiles, modules),
    scanRules: SCAN_RULES,
    projectType: summarizeProjectType(techStack, framework),
    architecture: summarizeArchitecture(sourceFiles, techStack),
    scannedAt: new Date().toISOString(),
    scanTruncated: truncated,
  };
}

function recommendedCodeSelections(files: ProjectFile[]): CodeSelections {
  const allCandidatePages = Math.ceil(buildSourceLines(files).length / CODE_LINES_PER_PAGE);
  if (allCandidatePages > 0 && allCandidatePages < FULL_DEPOSIT_PAGE_THRESHOLD) {
    return Object.fromEntries(files.map((file) => [file.path, { startLine: 1, endLine: file.lines }]));
  }
  const selected: CodeSelections = {};
  let lines = 0;
  for (const file of files) {
    if (Object.keys(selected).length >= 120) break;
    if (/\.(test|spec|stories)\./i.test(file.name) || file.name.endsWith('.d.ts')) continue;
    selected[file.path] = { startLine: 1, endLine: file.lines };
    lines += file.lines + 2;
    if (lines >= FULL_DEPOSIT_PAGE_THRESHOLD * CODE_LINES_PER_PAGE && Object.keys(selected).length >= 12) break;
  }
  if (Object.keys(selected).length) return selected;
  return Object.fromEntries(files.slice(0, 80).map((file) => [file.path, { startLine: 1, endLine: file.lines }]));
}

function selectionReason(file: ProjectFile) {
  const path = file.relativePath.toLowerCase();
  if (/main|index|app|router|routes|layout/.test(file.name.toLowerCase())) return '入口、路由或布局文件，能够体现软件启动和页面组织逻辑。';
  if (/(^|\/)(pages|views|components)(\/|$)/.test(path)) return '页面或组件文件，能够体现用户界面和主要操作流程。';
  if (/(^|\/)(api|services)(\/|$)/.test(path)) return '接口或服务文件，能够体现业务请求、数据处理和外部服务调用。';
  if (/(^|\/)(store|stores|state)(\/|$)/.test(path)) return '状态管理文件，能够体现软件核心数据流转。';
  if (/tool|manager|controller|command|handler/.test(path)) return '业务处理文件，能够体现核心功能的执行逻辑。';
  return '与项目功能相关的源码文件，用于补足源程序鉴别材料页数并保持可追溯。';
}

function normalizeCodeRange(file: ProjectFile, range?: CodeLineRange): CodeLineRange {
  const lastLine = Math.max(1, file.lines);
  const startLine = Math.max(1, Math.min(lastLine, Math.trunc(range?.startLine || 1)));
  const endLine = Math.max(startLine, Math.min(lastLine, Math.trunc(range?.endLine || lastLine)));
  return { startLine, endLine };
}

function buildSelectionItems(analysis: ProjectAnalysis | null, selections: CodeSelections) {
  return (analysis?.sourceFiles || []).map<CodeSelectionItem>((file) => {
    const selected = Boolean(selections[file.path]);
    const range = normalizeCodeRange(file, selections[file.path]);
    return {
      path: file.path,
      relativePath: file.relativePath,
      language: file.language,
      lines: file.lines,
      selected,
      startLine: range.startLine,
      endLine: range.endLine,
      reason: selected
        ? selectionReason(file)
        : `${selectionReason(file)} 当前尚未选择；请结合已确认的业务理解决定是否抽取。`,
    };
  });
}

function buildSourceLines(files: ProjectFile[], selections?: CodeSelections) {
  const allLines: string[] = [];
  files.forEach((file) => {
    const lines = normalizeText(file.content || '')
      .split('\n')
      .map((line) => line.trimEnd());
    const range = normalizeCodeRange(file, selections?.[file.path]);
    allLines.push(...lines.slice(range.startLine - 1, range.endLine));
  });
  return allLines;
}

function paginate(lines: string[]) {
  if (lines.length === 0) return [];
  const pages: CodePage[] = [];
  for (let index = 0; index < lines.length; index += CODE_LINES_PER_PAGE) {
    const originalPage = Math.floor(index / CODE_LINES_PER_PAGE) + 1;
    pages.push({
      materialPage: originalPage,
      originalPage,
      lines: lines.slice(index, index + CODE_LINES_PER_PAGE),
    });
  }
  return pages;
}

function normalizeMaterialPages(pages: CodePage[]) {
  return pages.map((page, index) => ({ ...page, materialPage: index + 1 }));
}

function renderCodeText(pages: CodePage[]) {
  if (pages.length === 0) {
    return '尚未选择项目源码，无法生成源程序鉴别材料。';
  }
  return pages.flatMap((page) => page.lines).join('\n');
}

function combineCodeTextParts(parts: string[]) {
  return parts.filter(Boolean).join('\n');
}

function buildCodeMaterial(info: ApplicationInfo, analysis: ProjectAnalysis | null, selections: CodeSelections): CodeMaterial {
  const materialInfo = {
    ...info,
    softwareName: resolvedSoftwareName(info, analysis),
    version: info.version || analysis?.versionCandidates[0]?.version || 'V1.0',
  };
  const sourceFiles = analysis?.sourceFiles || [];
  const selectedFiles = sourceFiles.filter((file) => Boolean(selections[file.path]));
  const allLines = buildSourceLines(selectedFiles, selections);
  const pages = paginate(allLines);
  const totalSourcePages = pages.length;
  const projectCandidatePages = Math.ceil(buildSourceLines(sourceFiles).length / CODE_LINES_PER_PAGE);
  const mode: CodeMaterialMode =
    totalSourcePages === 0 ? 'empty' : totalSourcePages >= FULL_DEPOSIT_PAGE_THRESHOLD ? 'front-back' : 'all';
  const frontPages =
    mode === 'front-back' ? normalizeMaterialPages(pages.slice(0, DEPOSIT_PAGE_COUNT)) : normalizeMaterialPages(pages);
  const backPages = mode === 'front-back' ? normalizeMaterialPages(pages.slice(-DEPOSIT_PAGE_COUNT)) : [];
  const allPages = normalizeMaterialPages(pages);
  const submittedPages = mode === 'front-back' ? frontPages.length + backPages.length : allPages.length;
  const submittedLines =
    mode === 'front-back'
      ? [...frontPages, ...backPages].reduce((sum, page) => sum + page.lines.length, 0)
      : allPages.reduce((sum, page) => sum + page.lines.length, 0);
  const selectionItems = buildSelectionItems(analysis, selections);
  const supplementNeeded =
    mode === 'all' &&
    totalSourcePages < FULL_DEPOSIT_PAGE_THRESHOLD &&
    projectCandidatePages >= FULL_DEPOSIT_PAGE_THRESHOLD &&
    selectedFiles.length < sourceFiles.length;
  const manifestRows = selectedFiles.map((file, index) => {
    const range = normalizeCodeRange(file, selections[file.path]);
    return [
      String(index + 1),
      file.relativePath,
      file.language,
      `${range.startLine}-${range.endLine}`,
      String(range.endLine - range.startLine + 1),
      selectionReason(file),
    ];
  });
  const manifestMarkdown = [
    `# ${materialInfo.softwareName} 源程序提取清单`,
    '',
    `软件版本：${materialInfo.version}`,
    `项目目录：${analysis?.root || '-'}`,
    `抽取模式：${mode === 'front-back' ? '源程序达到 60 页及以上，生成前 30 页和后 30 页' : mode === 'all' ? '源程序不足 60 页，生成全部已选源码' : '未生成'}`,
    `已选文件：${selectedFiles.length} 个`,
    `已选源码估算页数：${totalSourcePages} 页`,
    '',
    '| 序号 | 文件 | 语言 | 抽取行段 | 抽取行数 | 选择理由 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...manifestRows.map((row) => `| ${row.join(' | ')} |`),
    '',
    supplementNeeded ? '> 提醒：当前已选源码不足 60 页，但项目候选源码可达到 60 页，建议继续选择相关源码补足材料。' : '',
  ]
    .filter(Boolean)
    .join('\n');
  const selectionMarkdown = [
    `# ${materialInfo.softwareName} 代码文件候选清单`,
    '',
    '| 选择 | 文件 | 语言 | 抽取行段 | 文件行数 | 建议理由 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...selectionItems.map((item) => `| ${item.selected ? '是' : '否'} | ${item.relativePath} | ${item.language} | ${item.startLine}-${item.endLine} | ${item.lines} | ${item.reason} |`),
  ].join('\n');
  const selectionJson = JSON.stringify(
    {
      softwareName: materialInfo.softwareName,
      version: materialInfo.version,
      generatedAt: analysis?.scannedAt || '',
      items: selectionItems,
    },
    null,
    2
  );
  const manifestJson = JSON.stringify(
    {
      softwareName: materialInfo.softwareName,
      version: materialInfo.version,
      projectRoot: analysis?.root || '',
      mode,
      linesPerPage: CODE_LINES_PER_PAGE,
      totalSourcePages,
      submittedPages,
      selectedFiles: selectedFiles.map((file) => {
        const range = normalizeCodeRange(file, selections[file.path]);
        return {
          path: file.path,
          relativePath: file.relativePath,
          language: file.language,
          sourceLines: file.lines,
          startLine: range.startLine,
          endLine: range.endLine,
          extractedLines: range.endLine - range.startLine + 1,
          reason: selectionReason(file),
        };
      }),
    },
    null,
    2
  );
  const frontText = renderCodeText(frontPages);
  const backText = renderCodeText(backPages);
  return {
    mode,
    selectedFiles,
    selectionItems,
    allPages,
    frontPages,
    backPages,
    allText: renderCodeText(allPages),
    frontText,
    backText,
    frontBackText: mode === 'front-back' ? combineCodeTextParts([frontText, backText]) : '',
    manifestMarkdown,
    manifestJson,
    selectionMarkdown,
    selectionJson,
    totalSourcePages,
    submittedPages,
    submittedLines,
    totalSelectedLines: allLines.length,
    projectCandidatePages,
    supplementNeeded,
  };
}

function businessFunctions(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const fromInput = splitList(info.mainFunctions);
  if (fromInput.length) return fromInput;
  const fromDocs = extractDocFunctionLines(analysis);
  if (fromDocs.length) return fromDocs;
  const fromModules = (analysis?.modules || []).map((item) => item.name);
  if (fromModules.length) return fromModules;
  return analysis?.functionHints || [];
}

function resolvedSoftwareName(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  return info.softwareName.trim() || analysis?.nameCandidates[0]?.name || analysis?.name || '待确认软件名称';
}

function stripMarkdownLine(value: string) {
  return value
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^[✅✔☑□-]\s*/, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readmeFiles(analysis: ProjectAnalysis | null) {
  return (analysis?.docs || []).filter((item) => /(^|\/)readme(\.|$)|说明|文档/i.test(item.relativePath));
}

function projectEvidenceText(analysis: ProjectAnalysis | null) {
  return readmeFiles(analysis)
    .slice(0, 6)
    .map((file) => file.content || '')
    .join('\n');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordHitCount(text: string, keyword: string) {
  const trimmed = keyword.trim();
  if (!trimmed) return 0;
  const escaped = escapeRegExp(trimmed);
  const isAsciiToken = /^[A-Za-z0-9+#./-]+$/.test(trimmed);
  const pattern = isAsciiToken
    ? new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, 'gi')
    : new RegExp(escaped, 'gi');
  return Array.from(text.matchAll(pattern)).length;
}

function keywordWeight(keyword: string) {
  if (/^[A-Za-z0-9+#./-]+$/.test(keyword)) return keyword.length <= 3 ? 3 : 4;
  return Math.max(2, Math.min(8, Math.ceil(keyword.length / 2)));
}

function ruleEvidenceSources(info: ApplicationInfo, analysis: ProjectAnalysis | null): RuleEvidenceSource[] {
  const sources: RuleEvidenceSource[] = [];
  const push = (source: string, text: string | undefined, weight: number) => {
    const normalized = normalizeText(text || '').trim();
    if (normalized) sources.push({ source, text: normalized.slice(0, 80_000), weight });
  };

  push('当前填写：软件名称', info.softwareName, 6);
  push('当前填写：主要功能', info.mainFunctions, 6);
  push('当前填写：开发目的', info.purpose, 6);
  push('项目名称/类型', `${analysis?.name || ''}\n${analysis?.projectType || ''}\n${analysis?.architecture || ''}`, 3);
  push('技术栈配置', [
    analysis?.framework || '',
    analysis?.dependencies.join(' ') || '',
    stackNames(analysis?.techStack.frameworks).join(' '),
    stackNames(analysis?.techStack.databases).join(' '),
    stackNames(analysis?.techStack.middleware).join(' '),
    stackNames(analysis?.techStack.runtimes).join(' '),
    stackNames(analysis?.techStack.projectTypes).join(' '),
    extractTechNamesFromDocs(analysis).join(' '),
  ].join('\n'), 3);
  push('源码模块路径', [
    analysis?.modules.map((item) => `${item.name} ${item.evidence.join(' ')}`).join(' ') || '',
    analysis?.entryHints.join(' ') || '',
  ].join('\n'), 2);

  for (const file of readmeFiles(analysis).slice(0, 8)) {
    const isReadme = /(^|\/)readme(\.|$)/i.test(file.relativePath);
    push(file.relativePath, file.content, isReadme ? 6 : 5);
  }

  return sources;
}

function matchKeywordRules<T extends KeywordRule>(
  rules: T[],
  sources: RuleEvidenceSource[],
  minScore = 1
): Array<RuleMatch<T>> {
  return rules
    .map((rule) => {
      let score = rule.baseScore || 0;
      const evidence: string[] = [];
      for (const source of sources) {
        const text = source.text.toLowerCase();
        for (const keyword of rule.keywords) {
          const hits = keywordHitCount(text, keyword.toLowerCase());
          if (hits <= 0) continue;
          score += Math.min(hits, 4) * source.weight * keywordWeight(keyword);
          if (evidence.length < 10) evidence.push(`${keyword}@${source.source}`);
        }
      }
      return { rule, score, evidence };
    })
    .filter((item) => item.score >= minScore && item.evidence.length > 0)
    .sort((a, b) => b.score - a.score || b.evidence.length - a.evidence.length || a.rule.label.localeCompare(b.rule.label));
}

function matchBusinessForm(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  return matchKeywordRules(BUSINESS_FORM_RULES, ruleEvidenceSources(info, analysis), 8)[0] || null;
}

function industryRuleById(id: string | undefined) {
  return INDUSTRY_RULES.find((rule) => rule.id === id) || null;
}

function matchIndustryRule(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const business = matchBusinessForm(info, analysis);
  const matches = matchKeywordRules(INDUSTRY_RULES, ruleEvidenceSources(info, analysis), 8);
  if (!business) return matches[0] || null;

  const allowedIds = business.rule.compatibleIndustryIds || [];
  const allowedMatches = allowedIds.length ? matches.filter((item) => allowedIds.includes(item.rule.id)) : matches;
  if (allowedMatches.length) return allowedMatches[0];

  const fallback = industryRuleById(business.rule.fallbackIndustryId);
  if (!fallback) return matches[0] || null;
  return {
    rule: fallback,
    score: business.score,
    evidence: [`${business.rule.label}@业务形态映射`],
  };
}

function formatRuleEvidence<T extends KeywordRule>(match: RuleMatch<T> | null) {
  if (!match) return '未命中特征库';
  return `${match.rule.label}；证据：${match.evidence.slice(0, 5).join('、')}；分数：${Math.round(match.score)}`;
}

function normalizeHeading(value: string) {
  return stripMarkdownLine(value).replace(/\s+/g, '');
}

function headingMatches(value: string, keywords: string[]) {
  const heading = normalizeHeading(value);
  return keywords.some((keyword) => heading.includes(keyword));
}

function extractMarkdownSections(analysis: ProjectAnalysis | null, keywords: string[]) {
  const sections: Array<{ title: string; body: string; source: string }> = [];
  for (const file of readmeFiles(analysis).slice(0, 8)) {
    const lines = normalizeText(file.content || '').split('\n');
    let current: { title: string; level: number; rows: string[] } | null = null;
    for (const line of lines) {
      const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (heading) {
        if (current?.rows.length) {
          sections.push({ title: current.title, body: current.rows.join('\n').trim(), source: file.relativePath });
        }
        const title = stripMarkdownLine(heading[2]);
        current = headingMatches(title, keywords) ? { title, level: heading[1].length, rows: [] } : null;
        continue;
      }
      if (current) current.rows.push(line);
    }
    if (current?.rows.length) {
      sections.push({ title: current.title, body: current.rows.join('\n').trim(), source: file.relativePath });
    }
  }
  return sections;
}

function extractIntroText(analysis: ProjectAnalysis | null) {
  const intro = extractMarkdownSections(analysis, ['项目简介', '软件简介', '系统简介', '产品简介', '平台简介', '概述', '介绍'])[0];
  if (!intro) return '';
  return normalizeText(intro.body)
    .split('\n')
    .map((line) => stripMarkdownLine(line))
    .find((line) => line.length > 20 && !line.startsWith('|')) || '';
}

function featureTitleAndDetail(line: string, fallbackTitle: string) {
  const cleaned = stripMarkdownLine(line).replace(/^【(.+?)】/, '$1：');
  const match = cleaned.match(/^(.{2,32}?)(?:[：:]|\s+[-–—]\s+)\s*(.{2,})$/);
  if (!match) return { title: fallbackTitle, detail: cleaned };
  const title = cleanFunctionTitle(stripMarkdownLine(match[1]).replace(/^(模块|功能)\s*/, '').trim());
  const detail = stripMarkdownLine(match[2]);
  if (!title || /[，。；,.]/.test(title)) return { title: fallbackTitle, detail: cleaned };
  return { title, detail };
}

function pushFeatureItem(groups: Array<{ title: string; items: string[]; source: string }>, title: string, detail: string, source: string) {
  const normalizedTitle = title || '主要功能';
  const normalizedDetail = stripMarkdownLine(detail);
  if (!normalizedDetail || normalizedDetail.length < 2) return;
  let group = groups.find((item) => item.title === normalizedTitle && item.source === source);
  if (!group) {
    group = { title: normalizedTitle, items: [], source };
    groups.push(group);
  }
  if (group.items.length < 8 && !group.items.includes(normalizedDetail)) group.items.push(normalizedDetail);
}

function extractFeatureGroups(analysis: ProjectAnalysis | null) {
  const groups: Array<{ title: string; items: string[]; source: string }> = [];
  const featureHeadings = ['功能特性', '主要功能', '核心功能', '功能模块', '业务功能', '系统功能', '功能清单', '产品功能', '模块说明', '功能说明'];
  for (const file of readmeFiles(analysis).slice(0, 8)) {
    const lines = normalizeText(file.content || '').split('\n');
    let inFeatureSection = false;
    let sectionLevel = 0;
    let currentTitle = '主要功能';

    for (const line of lines) {
      const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (heading) {
        const level = heading[1].length;
        const title = stripMarkdownLine(heading[2]);
        if (headingMatches(title, featureHeadings)) {
          inFeatureSection = true;
          sectionLevel = level;
          currentTitle = title;
          continue;
        }
        if (inFeatureSection && level > sectionLevel) {
          currentTitle = title;
          continue;
        }
        if (inFeatureSection && level <= sectionLevel) {
          inFeatureSection = false;
          currentTitle = '主要功能';
        }
        continue;
      }

      if (!inFeatureSection) continue;
      const isList = /^\s*([-*+]|\d+[.)])\s+/.test(line);
      const cleaned = stripMarkdownLine(line);
      if (!cleaned || cleaned.startsWith('|') || /^[-:| ]+$/.test(cleaned)) continue;

      if (isList) {
        const parsed = featureTitleAndDetail(cleaned, currentTitle);
        pushFeatureItem(groups, parsed.title, parsed.detail, file.relativePath);
        continue;
      }

      if (cleaned.length >= 12 && groups.length < 12) {
        pushFeatureItem(groups, currentTitle, cleaned, file.relativePath);
      }
    }
  }
  return groups.filter((group) => group.items.length > 0).slice(0, 12);
}

function extractTechNamesFromDocs(analysis: ProjectAnalysis | null) {
  const sections = extractMarkdownSections(analysis, ['技术栈', '技术架构', '系统架构', '运行环境', '环境要求', '基础设施', '部署']);
  const names = new Set<string>();
  for (const section of sections) {
    for (const line of section.body.split('\n')) {
      const cells = line
        .split('|')
        .map((cell) => stripMarkdownLine(cell))
        .filter(Boolean);
      if (cells.length >= 2 && !/^[-:]+$/.test(cells[0]) && !/技术|版本|用途|说明|指标|目标值/.test(cells[0])) {
        names.add(cells[0]);
      }
    }
  }
  return Array.from(names).slice(0, 18);
}

function hasDocSignal(analysis: ProjectAnalysis | null, pattern: RegExp) {
  const stackText = [
    analysis?.framework || '',
    analysis?.projectType || '',
    analysis?.architecture || '',
    analysis?.techStack.languages.join('、') || '',
    stackNames(analysis?.techStack.frameworks).join('、'),
    stackNames(analysis?.techStack.databases).join('、'),
    stackNames(analysis?.techStack.middleware).join('、'),
    stackNames(analysis?.techStack.runtimes).join('、'),
    extractTechNamesFromDocs(analysis).join('、'),
  ].join(' ');
  return pattern.test(`${projectEvidenceText(analysis)}\n${stackText}`);
}

function compactText(value: string) {
  return value.replace(/\s+/g, ' ').replace(/\s*([，。；：、])\s*/g, '$1').trim();
}

function stripDecorativeSymbols(value: string) {
  return value.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
}

function meaningfulCharCount(value: string) {
  return value.replace(/\s/g, '').length;
}

function removeSoftwareCopyrightUnsafeText(value: string) {
  return stripDecorativeSymbols(
    compactText(value)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(?:^|[\s，。；、])(?:[A-Za-z]:)?(?:src|app|lib|components|pages|views|services|stores|models|routes|controllers|modules|assets|public|dist|build|target|node_modules)[\\/][A-Za-z0-9_.\\/ -]+/gi, ' ')
    .replace(/\b[A-Za-z0-9_.-]+\.(?:vue|tsx?|jsx?|mjs|cjs|py|java|go|rs|cs|cpp|c|h|hpp|php|sql|html|css|scss|less|json|toml|yaml|yml|md)\b/gi, ' ')
    .replace(/#{1,6}\s*/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  );
}

function normalizeGeneratedMainFunctions(value: string) {
  let text = removeSoftwareCopyrightUnsafeText(value)
    .replace(/^(软件的主要功能|主要功能|输出|结果|正文)[:：\s]*/i, '')
    .replace(/^(以下是|如下)[:：\s]*/i, '');
  return trimMainFunctionText(text);
}

function validateQwenMainFunctions(value: string) {
  const generated = normalizeGeneratedMainFunctions(value);
  const count = meaningfulCharCount(generated);
  if (count < MIN_MAIN_FUNCTION_CHARS) {
    throw new Error(`Qwen 输出不足 ${MIN_MAIN_FUNCTION_CHARS} 字，当前 ${count} 字`);
  }
  if (/本地证据显示|从实现依据看|扫描过程中|Controller|Service|Router|Module|Page|View|Tool/i.test(generated)) {
    throw new Error('Qwen 输出仍包含内部证据或代码结构痕迹');
  }
  return generated;
}

function extractJsonObjectText(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || value;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return '';
  return fenced.slice(start, end + 1);
}

function parseLooseQwenFields(value: string): Record<string, string> {
  const normalized = normalizeText(value)
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const fieldAliases: Array<[keyof QwenApplicationDraft, RegExp[]]> = [
    ['softwareCategory', [/softwareCategory/i, /软件分类/, /软件类别/]],
    ['industry', [/industry/i, /面向领域/, /服务行业/, /所属行业/, /行业领域/, /^行业$/]],
    ['targetUsers', [/targetUsers/i, /目标用户/, /面向用户/, /使用人员/, /服务对象/]],
    ['purpose', [/purpose/i, /开发目的/, /应用目的/, /软件用途/, /^用途$/]],
    ['technicalFeatures', [/technicalFeatures/i, /技术特点/, /技术特色/, /技术特征/]],
    ['mainFunctions', [/mainFunctions/i, /软件的主要功能/, /主要功能正文/, /主要功能/]],
  ];
  const result: Record<string, string> = {};
  const lines = normalized.split('\n');
  let currentKey = '';
  const keyForLabel = (label: string) => fieldAliases.find(([, patterns]) => patterns.some((pattern) => pattern.test(label)))?.[0] || '';

  for (const rawLine of lines) {
    const line = rawLine.replace(/^\s*[-*+\d.、)）]+\s*/, '').trim();
    if (!line) continue;
    const pair = line.match(/^(.{2,32}?)(?:[:：=]|为|是)\s*(.+)$/);
    if (pair) {
      const key = keyForLabel(pair[1].trim());
      if (key) {
        currentKey = key;
        result[key] = [result[key], pair[2].trim()].filter(Boolean).join('');
        continue;
      }
    }
    if (currentKey && currentKey === 'mainFunctions') {
      result[currentKey] = [result[currentKey], line].filter(Boolean).join('');
    }
  }

  if (!result.mainFunctions) {
    const mainMatch = normalized.match(/(?:软件的主要功能|主要功能正文|主要功能)\s*[:：]\s*([\s\S]+)/);
    if (mainMatch) result.mainFunctions = mainMatch[1].trim();
  }
  return result;
}

function parseQwenObject(value: string): Record<string, unknown> {
  const jsonText = extractJsonObjectText(value);
  if (jsonText) {
    try {
      return JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      return parseLooseQwenFields(value);
    }
  }
  return parseLooseQwenFields(value);
}

function cleanQwenFieldValue(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return shortValue(
    removeSoftwareCopyrightUnsafeText(value)
      .replace(/[{}\[\]"'`]/g, '')
      .replace(/^(字段|内容|结果|输出)[:：]\s*/i, '')
      .trim(),
    maxLength
  );
}

function normalizeQwenSoftwareCategory(value: string, analysis: ProjectAnalysis | null) {
  const text = value.trim();
  const allowed = ['应用软件', '支撑软件', '嵌入式软件', '操作系统', '中间件'];
  return allowed.find((item) => text.includes(item)) || inferSoftwareCategory(analysis);
}

function normalizeQwenApplicationFields(value: string, analysis: ProjectAnalysis | null): QwenApplicationFields {
  const parsed = parseQwenObject(value);

  const unsafePattern = /本地证据显示|从实现依据看|扫描过程中|Controller|Service|Router|Module|Page|View|Tool|src[\\/]|\.tsx?|\.vue|\.rs|\.js/i;
  const fields: QwenApplicationFields = {
    softwareCategory: normalizeQwenSoftwareCategory(cleanQwenFieldValue(parsed.softwareCategory, 20), analysis),
    industry: cleanQwenFieldValue(parsed.industry, 50),
    targetUsers: cleanQwenFieldValue(parsed.targetUsers, 50),
    purpose: cleanQwenFieldValue(parsed.purpose, 50),
    technicalFeatures: cleanQwenFieldValue(parsed.technicalFeatures, 100),
  };

  if (fields.purpose && !/^(用于|面向|支撑|帮助)/.test(fields.purpose)) {
    fields.purpose = shortValue(`用于${fields.purpose}`, 50);
  }
  if (!fields.industry || !fields.purpose || !fields.technicalFeatures) {
    throw new Error('Qwen 字段分析缺少行业、开发目的或技术特点');
  }
  if (unsafePattern.test(Object.values(fields).join(' '))) {
    throw new Error('Qwen 字段分析包含内部证据或代码结构痕迹');
  }
  return fields;
}

function ensureSentenceEnd(value: string) {
  const text = compactText(value);
  return /[。！？]$/.test(text) ? text : `${text}。`;
}

const FUNCTION_NAME_TOKEN_LABELS: Record<string, string> = {
  ai: '智能辅助',
  api: '接口',
  audit: '审计',
  autocomplete: '自动补全',
  batch: '批量',
  command: '命令',
  common: '通用',
  config: '配置',
  editor: '编辑器',
  file: '文件',
  history: '历史',
  import: '导入',
  key: '密钥',
  log: '日志',
  manager: '管理',
  mobile: '移动端',
  panel: '面板',
  preview: '预览',
  remote: '远程',
  security: '安全',
  selector: '选择器',
  service: '服务',
  session: '会话',
  setting: '设置',
  sftp: 'SFTP',
  store: '数据存储',
  sync: '同步',
  tab: '标签',
  table: '表格',
  terminal: '终端',
  theme: '主题',
  toolbar: '工具栏',
  virtual: '虚拟',
  view: '视图',
};

function humanizeMixedFeatureName(value: string) {
  const normalized = value
    .replace(/\.[^.\\/]+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z]+)([\u4e00-\u9fa5])/g, '$1 $2')
    .replace(/([\u4e00-\u9fa5])([A-Za-z]+)/g, '$1 $2')
    .replace(/[-_]+/g, ' ');
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => FUNCTION_NAME_TOKEN_LABELS[token.toLowerCase()] || token)
    .join('');
}

function isSourcePathLike(value: string) {
  return /[\\/]/.test(value) || /\.(vue|tsx?|jsx?|mjs|cjs|py|java|go|rs|cs|cpp|c|h|hpp|php|sql|html|css|scss|less)$/i.test(value);
}

function functionDetailForOutput(value: string) {
  const text = stripDecorativeSymbols(compactText(value));
  if (!text) return '';
  if (isSourcePathLike(text)) {
    return humanizeMixedFeatureName(basename(text));
  }
  return shortenFunctionDetail(text);
}

function cleanFunctionTitle(value: string) {
  let title = stripDecorativeSymbols(compactText(value))
    .replace(/[（(]\s*$/, '')
    .replace(/^[（(]+|[）)]+$/g, '')
    .replace(/[：:]+$/, '')
    .trim();
  title = stripDecorativeSymbols(humanizeMixedFeatureName(title));
  const openChinese = (title.match(/（/g) || []).length;
  const closeChinese = (title.match(/）/g) || []).length;
  const openAscii = (title.match(/\(/g) || []).length;
  const closeAscii = (title.match(/\)/g) || []).length;
  if (openChinese > closeChinese) title += '）'.repeat(openChinese - closeChinese);
  if (openAscii > closeAscii) title += ')'.repeat(openAscii - closeAscii);
  return title;
}

function trimAtTextBoundary(value: string, maxChars: number, minChars = 0) {
  const chars = Array.from(compactText(value));
  if (chars.length <= maxChars) return compactText(value);
  const clipped = chars.slice(0, maxChars).join('');
  const boundaries = ['。', '！', '？', '；'];
  const boundaryIndex = Math.max(...boundaries.map((mark) => clipped.lastIndexOf(mark)));
  if (boundaryIndex >= minChars) {
    return clipped.slice(0, boundaryIndex + 1);
  }
  const softBoundary = Math.max(clipped.lastIndexOf('，'), clipped.lastIndexOf('、'));
  if (softBoundary >= minChars) {
    return `${clipped.slice(0, softBoundary)}。`;
  }
  return ensureSentenceEnd(clipped);
}

function trimMainFunctionText(value: string) {
  return trimAtTextBoundary(value, MAX_MAIN_FUNCTION_CHARS, MIN_MAIN_FUNCTION_CHARS);
}

function shortenFunctionDetail(value: string) {
  return trimAtTextBoundary(value, 90);
}

function appendMainFunctionSection(current: string, section: string) {
  const next = ensureSentenceEnd(`${current}${section}`);
  if (meaningfulCharCount(next) <= MAX_MAIN_FUNCTION_CHARS) return next;
  if (meaningfulCharCount(current) >= MIN_MAIN_FUNCTION_CHARS) return current;
  return trimMainFunctionText(next);
}

function addFunctionEntry(entries: FunctionEntry[], name: string, details: string[], evidence: string) {
  const title = cleanFunctionTitle(name);
  if (!title || entries.some((entry) => entry.name === title)) return;
  const cleanedDetails = Array.from(new Set(details.map(functionDetailForOutput).filter((item) => item.length >= 2))).slice(0, 6);
  entries.push({
    name: title,
    details: cleanedDetails,
    evidence,
  });
}

const FUNCTION_ACTION_RULES: FunctionActionRule[] = [
  {
    id: 'terminal',
    pattern: /终端|SSH|Shell|命令|Terminal/i,
    action: '支持远程连接、终端会话、命令输入输出、历史记录和交互状态维护，帮助用户完成服务器或远程主机的日常管理操作',
  },
  {
    id: 'session',
    pattern: /会话|Session|连接|主机|凭据/i,
    action: '支持连接信息维护、会话创建、状态恢复、分组管理和快捷访问，便于用户统一管理多台远程设备或服务资源',
  },
  {
    id: 'sftp',
    pattern: /SFTP|文件传输|远程文件|上传|下载/i,
    action: '支持远程文件浏览、上传下载、文件预览、批量传输和同步处理，满足服务器文件维护和资料交换需求',
  },
  {
    id: 'mobile',
    pattern: /移动端|Mobile|移动|同步/i,
    action: '支持移动端数据访问、远程同步、安全状态维护和跨端信息查看，便于用户在不同终端保持业务连续性',
  },
  {
    id: 'assistant',
    pattern: /智能辅助|AI|模型|问答|分析/i,
    action: '支持智能辅助处理、内容分析、结果提示和交互式操作建议，帮助用户提升复杂任务处理效率',
  },
  {
    id: 'call',
    pattern: /呼叫|呼入|呼出|IVR|语音|来电|通话/i,
    action: '支持呼入呼出处理、语音导航、路由分配、通话状态记录和呼叫结果跟踪，覆盖客户联络的核心操作流程',
  },
  {
    id: 'agent',
    pattern: /座席|坐席|技能组|话务员|客服/i,
    action: '支持座席状态管理、技能组分配、在线接听、工作整理和服务过程监控，帮助管理人员掌握座席工作情况',
  },
  {
    id: 'customer',
    pattern: /客户|CRM|会员|档案|来电弹屏/i,
    action: '支持客户资料展示、历史记录查询、等级标识、名单维护和来电关联，便于服务人员快速识别客户并开展业务处理',
  },
  {
    id: 'recording',
    pattern: /录音|加密|AES|播放|存储/i,
    action: '支持过程记录采集、加密存储、授权播放、记录检索和资料留存，为复核、追溯和质量管理提供依据',
  },
  {
    id: 'quality',
    pattern: /质检|满意度|评分|质量|评价/i,
    action: '支持质量评价、评分模板配置、满意度记录、复核处理和问题定位，辅助管理人员改进服务质量',
  },
  {
    id: 'identity',
    pattern: /用户|账号|权限|认证|登录|安全|审计|密码|密钥/i,
    action: '支持用户身份识别、账号资料维护、角色权限控制、访问校验和操作留痕，保障不同人员按授权范围使用系统功能',
  },
  {
    id: 'document',
    pattern: /文件|文档|PDF|Word|Excel|表格|OCR|识别|转换|水印|签章|档案/i,
    action: '支持文件导入、内容识别、格式转换、资料生成、批量处理和结果导出，满足办公资料处理与归档场景',
  },
  {
    id: 'analytics',
    pattern: /数据|统计|报表|看板|分析|图表|指标|BI/i,
    action: '支持业务数据汇总、指标计算、统计分析、报表展示和结果查询，辅助用户掌握业务运行情况',
  },
  {
    id: 'trade',
    pattern: /订单|商品|库存|采购|销售|仓库|物流|配送|运单|支付/i,
    action: '支持业务对象维护、状态流转、过程跟踪、明细查询和结果确认，覆盖交易履约与经营管理流程',
  },
  {
    id: 'workflow',
    pattern: /消息|通知|公告|任务|流程|审批|协同|日程|工单/i,
    action: '支持任务创建、流程流转、消息提醒、处理反馈和进度跟踪，提升多人协同和业务闭环处理效率',
  },
  {
    id: 'configuration',
    pattern: /配置|设置|系统|参数|模板|规则|插件|工具/i,
    action: '支持系统参数维护、功能入口管理、规则配置、模板复用和运行状态控制，便于按实际业务进行灵活调整',
  },
  {
    id: 'media',
    pattern: /视频|音频|图片|图像|截图|媒体|播放器|转码/i,
    action: '支持多媒体文件接入、预览处理、内容加工、质量调整和结果保存，满足图像、音频或视频处理需求',
  },
  {
    id: 'integration',
    pattern: /接口|API|服务|请求|网络|下载|同步|集成/i,
    action: '支持外部服务接入、接口请求、数据同步、状态反馈和异常处理，实现系统与相关资源的联动',
  },
];

function localFunctionAction(name: string) {
  return (
    FUNCTION_ACTION_RULES.find((rule) => rule.pattern.test(name))?.action ||
    '围绕该模块对应的业务对象提供信息维护、查询筛选、流程处理、状态反馈和结果输出等能力'
  );
}

function collectFunctionEntries(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const entries: FunctionEntry[] = [];
  const featureGroups = extractFeatureGroups(analysis);
  for (const group of featureGroups) {
    addFunctionEntry(entries, group.title, group.items, `README 功能章节：${group.source}`);
  }

  for (const module of analysis?.modules || []) {
    addFunctionEntry(entries, module.name, module.evidence, `源码模块：${module.source}`);
  }

  for (const hint of analysis?.functionHints || []) {
    addFunctionEntry(entries, hint, [hint], '源码路径和文件关键词');
  }

  const business = matchBusinessForm(info, analysis);
  if (business) {
    addFunctionEntry(entries, business.rule.label, [business.rule.purpose, `面向${business.rule.targetUsers}`], `业务形态规则：${formatRuleEvidence(business)}`);
  }

  for (const item of businessFunctions({ ...info, mainFunctions: '' }, analysis)) {
    addFunctionEntry(entries, item, [item], '本地功能候选');
  }

  return entries.slice(0, 10);
}

function buildDetailedMainFunctions(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const entries = collectFunctionEntries(info, analysis);
  const softwareName = resolvedSoftwareName(info, analysis);
  const business = matchBusinessForm(info, analysis);
  const targetUsers = info.targetUsers.trim() || business?.rule.targetUsers || '业务人员、管理人员和系统维护人员';
  const purpose = inferDevelopmentPurpose({ ...info, mainFunctions: '' }, analysis);
  const moduleNames = entries.map((entry) => entry.name).slice(0, 8);
  const languages = officialLanguageValue(analysis) || analysis?.languages.map((item) => item.language).join('、') || '项目源码语言';
  const frameworks = stackNames(analysis?.techStack.frameworks).join('、') || analysis?.framework || analysis?.projectType || '项目框架';
  const intro = `${softwareName}主要面向${targetUsers}，围绕${purpose}形成完整的软件功能体系。系统根据真实项目源码和文档线索，将${moduleNames.length ? moduleNames.join('、') : '核心业务处理'}等能力组织为可操作的业务模块，帮助用户完成日常数据录入、过程处理、结果查询、资料生成和运行管理。`;
  const moduleDetails = entries.slice(0, 8).map((entry, index) => {
    const detail = entry.details.length ? `具体包括${entry.details.slice(0, 4).join('、')}等操作。` : '';
    return `（${index + 1}）${entry.name}功能：${localFunctionAction(entry.name)}。${detail}`;
  });
  const evidenceSummary = `系统同时结合${languages}等实现基础和${frameworks}等运行支撑能力，提供参数配置、数据校验、状态提示、权限控制、日志留存和结果导出等辅助功能，保障日常操作过程稳定、可追溯、易维护。`;
  const workflowSummary = moduleNames.length
    ? `在业务流程上，软件将${moduleNames.slice(0, 6).join('、')}等功能串联起来，覆盖基础资料维护、业务操作处理、状态跟踪、异常提示、结果输出和后续复核等环节，使用户能够在同一系统内完成从输入到处理再到导出的闭环操作。`
    : '在业务流程上，软件围绕已识别的源码入口和功能目录组织操作能力，覆盖基础资料维护、业务处理、状态跟踪、结果输出和后续复核等环节。';
  let text = '';
  for (const section of [intro, ...moduleDetails, workflowSummary, evidenceSummary]) {
    text = appendMainFunctionSection(text, section);
    if (meaningfulCharCount(text) >= MAX_MAIN_FUNCTION_CHARS) break;
  }

  const supplements = [
    '系统还注重不同功能之间的数据衔接，用户在一个模块中产生的配置、文件、记录或处理结果，可以作为后续查询、转换、统计、导出或管理操作的基础，减少重复录入和人工整理成本。',
    '对于需要人工确认的业务字段，软件提供可编辑的资料整理入口，使用户能够在自动识别结果的基础上补充名称、版本、运行环境、开发目的和功能描述等登记信息，保证最终材料更贴合实际项目。',
    '整体来看，软件的主要功能不是单一页面或单一接口，而是围绕真实源码中识别出的模块、文档和配置证据形成的综合业务处理能力，能够支撑用户持续完成项目相关的核心工作。',
  ];
  for (const supplement of supplements) {
    if (meaningfulCharCount(text) >= MIN_MAIN_FUNCTION_CHARS) break;
    text = appendMainFunctionSection(text, supplement);
  }
  return trimMainFunctionText(text);
}

function resolveMainFunctionsText(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const manual = compactText(info.mainFunctions);
  if (manual) return trimMainFunctionText(manual);
  return buildDetailedMainFunctions(info, analysis);
}

function qwenProjectContextLines(info: ApplicationInfo, analysis: ProjectAnalysis | null, maxEntries = 10) {
  const entries = collectFunctionEntries({ ...info, mainFunctions: '' }, analysis).slice(0, maxEntries);
  const business = matchBusinessForm(info, analysis);
  const featureGroups = extractFeatureGroups(analysis).slice(0, 6);
  const docLines = extractDocFunctionLines(analysis).slice(0, 8);
  const modules = entries.map((entry) => `${entry.name}：${entry.details.slice(0, 4).join('、') || localFunctionAction(entry.name)}`).join('；');
  const readmeFeatures = featureGroups
    .map((group) => `${group.title}：${group.items.slice(0, 4).map(functionDetailForOutput).join('、')}`)
    .join('；');
  const tech = [
    analysis?.projectType,
    analysis?.architecture,
    officialLanguageValue(analysis),
    analysis?.framework,
    stackNames(analysis?.techStack.frameworks).slice(0, 6).join('、'),
    stackNames(analysis?.techStack.databases).slice(0, 3).join('、'),
    stackNames(analysis?.techStack.runtimes).slice(0, 4).join('、'),
  ]
    .filter(Boolean)
    .join('；');
  return {
    business,
    contextLines: [
      `软件名称：${resolvedSoftwareName(info, analysis)}`,
      `产品功能线索：${modules || '无明确模块，请根据项目名称、README和技术线索判断'}`,
      `产品特色线索：${readmeFeatures || docLines.join('；') || '无明确文档功能章节'}`,
      `业务形态参考：${business ? `${business.rule.label}；${business.rule.purpose}；面向${business.rule.targetUsers}` : '未命中明确业务形态，仅供模型结合产品功能自行判断'}`,
      `项目类型/技术线索：${tech || '无明确技术栈线索'}`,
      `README/文档简介：${extractIntroText(analysis) || '无明确简介'}`,
    ],
  };
}

function buildQwenApplicationFieldsPrompt(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  return [
    '你是软件著作权登记材料助手。请只根据项目证据分析可推断的申请字段。',
    ...qwenProjectContextLines(info, analysis).contextLines,
    '',
    '优先输出 JSON；如果无法稳定输出 JSON，就按“字段名：内容”逐行输出。不要 Markdown，不要解释，不要代码路径，不要文件名：',
    '{"softwareCategory":"应用软件","industry":"...","targetUsers":"...","purpose":"...","technicalFeatures":"..."}',
    '',
    '字段约束：',
    '1. softwareCategory 只能是：应用软件、支撑软件、嵌入式软件、操作系统、中间件。',
    '2. industry 由模型根据产品功能、产品特色和服务对象判断，填写该软件实际服务的领域或行业，10-40字。',
    '3. targetUsers 根据产品功能判断实际使用人员，不超过40字，用顿号分隔。',
    '4. purpose 根据产品功能和特色生成，不超过50字，优先以“用于”开头，表达真实用途。',
    '5. technicalFeatures 不超过100字，只写技术特点，不写营销话术。',
    '6. 不得输出“本地证据显示”“扫描过程中”“Controller”“Service”“Router”“Page”“View”“Tool”等内部证据词。',
  ].join('\n');
}

function buildQwenMainFunctionsPrompt(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const localDraft = buildDetailedMainFunctions({ ...info, mainFunctions: '' }, analysis);
  const { business, contextLines } = qwenProjectContextLines(info, analysis, 12);
  const businessRequirement = business
    ? `必须围绕“${business.rule.label}”及其项目证据展开，不要改写成其他业务领域。`
    : '必须围绕项目自身名称、README、模块和功能线索展开。';
  return [
    '你是软件著作权登记材料助手。请根据项目证据整理“软件的主要功能”。',
    ...contextLines,
    '',
    `本地规则草稿：${localDraft}`,
    '',
    '请只输出“软件的主要功能”正文，不要 JSON，不要标题，不要 Markdown，不要解释，不要代码路径，不要文件名。',
    `硬性要求：输出必须是 ${MIN_MAIN_FUNCTION_CHARS}-${MAX_MAIN_FUNCTION_CHARS} 字的连续中文段落，少于 ${MIN_MAIN_FUNCTION_CHARS} 字不合格。${businessRequirement}`,
    '写法要求：说明软件面向对象、核心业务问题、主要模块、业务流程、数据处理、查询统计、权限安全、资料输出和运行管理等真实功能；不得编造项目没有的功能。',
    '禁止词：本地证据显示、扫描过程中、Controller、Service、Router、Page、View、Tool、src、components、文件路径。',
  ].join('\n');
}

function buildQwenTechnicalFeaturesPrompt(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  return [
    '你是软件著作权登记材料助手。请只根据项目证据整理“软件的技术特点”。',
    ...qwenProjectContextLines(info, analysis).contextLines,
    '',
    '请只输出一条 technicalFeatures 字段，可以用“technicalFeatures：内容”或直接输出正文。不要 JSON，不要 Markdown，不要解释，不要代码路径，不要文件名。',
    '硬性要求：30-100 字，表达真实技术特点，可包含架构、语言、框架、数据处理、安全控制、部署或客户端形态；不要写营销话术。',
    '禁止词：本地证据显示、扫描过程中、Controller、Service、Router、Page、View、Tool、src、components、文件路径。',
  ].join('\n');
}

function normalizeQwenTechnicalFeatures(value: string) {
  const parsed = parseQwenObject(value);
  const raw = typeof parsed.technicalFeatures === 'string' ? parsed.technicalFeatures : value;
  const cleaned = cleanQwenFieldValue(raw, 100);
  if (!cleaned) throw new Error('Qwen 技术特点整理结果为空');
  if (/本地证据显示|从实现依据看|扫描过程中|Controller|Service|Router|Module|Page|View|Tool|src[\\/]|\.tsx?|\.vue|\.rs|\.js/i.test(cleaned)) {
    throw new Error('Qwen 技术特点包含内部证据或代码结构痕迹');
  }
  return cleaned;
}

function extractDocFunctionLines(analysis: ProjectAnalysis | null) {
  const grouped = extractFeatureGroups(analysis).map((group) =>
    group.title === '主要功能' || group.title === '功能特性'
      ? group.items.slice(0, 4).join('；')
      : `${group.title}：${group.items.slice(0, 3).join('；')}`
  );
  if (grouped.length) return grouped;
  const docs = analysis?.docs || [];
  const rows: string[] = [];
  for (const file of docs.filter((item) => /readme|说明|文档/i.test(item.relativePath)).slice(0, 8)) {
    const lines = normalizeText(file.content || '').split('\n');
    let inSection = false;
    for (const line of lines) {
      if (/^#{1,3}\s+/.test(line)) {
        inSection = /功能|特性|模块|系统架构|业务/.test(line);
        continue;
      }
      if (!inSection) continue;
      if (!/^\s*[-*+]|\d+[.)]\s+/.test(line)) continue;
      const cleaned = stripMarkdownLine(line);
      if (cleaned && cleaned.length > 2 && !rows.includes(cleaned)) rows.push(cleaned);
      if (rows.length >= 8) return rows;
    }
  }
  return rows;
}

function inferIndustry(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  if (info.industry.trim()) return info.industry.trim();
  const industry = matchIndustryRule(info, analysis);
  if (industry) return industry.rule.label;
  const business = matchBusinessForm(info, analysis);
  if (business || analysis?.sourceFiles.length) return '信息传输、软件和信息技术服务业';
  return '需人工确认';
}

function inferDevelopmentPurpose(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  if (info.purpose.trim()) return shortValue(info.purpose.trim(), 80);
  const business = matchBusinessForm(info, analysis);
  const industry = matchIndustryRule(info, analysis);
  if (business && industry) return shortValue(`${business.rule.purpose}，服务于${industry.rule.purposePrefix}场景`, 80);
  if (business) return shortValue(business.rule.purpose, 80);
  if (industry) return shortValue(`用于支撑${industry.rule.purposePrefix}的信息化处理和管理`, 80);
  const introText = extractIntroText(analysis);
  if (introText) return shortValue(introText, 80);
  return '需结合项目实际补充';
}

function industryEvidenceLabel(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  if (info.industry.trim()) return '当前填写值，需按实际行业确认';
  const industry = matchIndustryRule(info, analysis);
  const business = matchBusinessForm(info, analysis);
  if (industry) {
    const mapped = business && industry.evidence.some((item) => item.includes('业务形态映射'));
    return `${mapped ? '按业务形态映射行业' : '命中行业规则'}：${formatRuleEvidence(industry)}${
      business ? `；业务形态：${formatRuleEvidence(business)}` : ''
    }`;
  }
  if (business) return `仅命中业务形态：${formatRuleEvidence(business)}；未命中垂直行业，暂按软件信息服务业，需确认`;
  return '未命中行业特征库，需人工确认';
}

function purposeEvidenceLabel(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  if (info.purpose.trim()) return '当前填写值';
  const business = matchBusinessForm(info, analysis);
  const industry = matchIndustryRule(info, analysis);
  if (business && industry) return `业务形态：${formatRuleEvidence(business)}；行业：${formatRuleEvidence(industry)}`;
  if (business) return `业务形态：${formatRuleEvidence(business)}`;
  if (industry) return `行业：${formatRuleEvidence(industry)}`;
  return '未命中开发目的规则，需人工补充';
}

function matchHardwareRule(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const matches = matchKeywordRules(HARDWARE_RULES, ruleEvidenceSources(info, analysis), 1)
    .filter((item) => item.score >= (item.rule.minScore || 1));
  return matches[0] || null;
}

function inferDevHardware(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  return matchHardwareRule(info, analysis)?.rule.devHardware || '需人工确认';
}

function inferRunHardware(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  return matchHardwareRule(info, analysis)?.rule.runHardware || '需人工确认';
}

function hardwareEvidenceLabel(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const match = matchHardwareRule(info, analysis);
  return match ? `命中硬件规则：${match.rule.name}；证据：${match.evidence.slice(0, 5).join('、')}` : '未命中硬件规则库，需人工确认';
}

function inferDevOs(analysis: ProjectAnalysis | null) {
  if (hasDocSignal(analysis, /iOS|Xcode|Swift|Objective-C/i)) return 'macOS';
  if (hasDocSignal(analysis, /Docker|Kubernetes|Linux|Spring|Java|Go|Python|PHP/i)) return 'Windows/Linux/macOS';
  return '需人工确认';
}

function inferRuntimePlatform(analysis: ProjectAnalysis | null) {
  const frameworks = stackNames(analysis?.techStack.frameworks).join('、');
  const runtimes = stackNames(analysis?.techStack.runtimes).join('、');
  if (hasDocSignal(analysis, /Android|iOS|移动端/i)) return 'Android/iOS';
  if (hasDocSignal(analysis, /Kubernetes|Docker|微服务|Spring Cloud|Nginx|Linux/i)) return 'Linux服务器操作系统';
  if (/Tauri|Electron/.test(frameworks)) return 'Windows 10/11';
  if (/React|Vue|Next|Nuxt|Svelte/.test(frameworks)) return 'Web浏览器';
  if (/JVM|Java/.test(runtimes)) return '服务器操作系统';
  if (/Python|Go|PHP|Rust/.test(runtimes)) return '服务器操作系统';
  return '需人工确认';
}

function inferSupportSoftware(analysis: ProjectAnalysis | null) {
  const techNames = extractTechNamesFromDocs(analysis);
  if (techNames.length) return techNames.slice(0, 6).join('、');
  const rows = [
    ...stackNames(analysis?.techStack.runtimes),
    ...stackNames(analysis?.techStack.frameworks).slice(0, 4),
    ...stackNames(analysis?.techStack.databases),
    ...stackNames(analysis?.techStack.middleware),
  ];
  return Array.from(new Set(rows)).join('、') || '需人工确认';
}

function inferSoftwareCategory(analysis: ProjectAnalysis | null) {
  if (hasDocSignal(analysis, /操作系统|内核|Kernel|驱动程序|文件系统|调度器/i)) return '操作系统';
  if (hasDocSignal(analysis, /嵌入式|固件|单片机|MCU|ARM|边缘网关|设备固件|工业控制/i)) return '嵌入式软件';
  if (hasDocSignal(analysis, /中间件|SDK|组件库|框架|消息队列|API Gateway|服务网关|插件平台/i)) return '中间件';
  return '应用软件';
}

function inferDevTools(analysis: ProjectAnalysis | null) {
  const text = projectEvidenceText(analysis);
  if (/Java|Spring|Maven|Gradle/.test(text)) return 'IntelliJ IDEA';
  if (/Vue|React|Node\.js|TypeScript|JavaScript/.test(text)) return 'Visual Studio Code';
  const languages = analysis?.techStack.languages.join('、') || '';
  if (/Java/.test(languages)) return 'IntelliJ IDEA';
  if (/TypeScript|JavaScript|HTML|Vue|React/.test(languages)) return 'Visual Studio Code';
  if (/Python/.test(languages)) return 'PyCharm';
  return '需人工确认';
}

function summarizeTechnicalFeatures(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  if (info.technicalFeatures.trim()) return shortValue(info.technicalFeatures.trim(), 100);
  const traits: string[] = [];
  if (hasDocSignal(analysis, /微服务|Spring Cloud|服务治理|网关/i)) traits.push('微服务架构');
  else if (hasDocSignal(analysis, /前后端分离|Vue|React|Angular|管理后台/i)) traits.push('前后端分离架构');
  else if (hasDocSignal(analysis, /桌面|Tauri|Electron/i)) traits.push('桌面客户端架构');
  if (hasDocSignal(analysis, /高并发|高可用|集群|负载均衡/i)) traits.push('高并发高可用');
  if (hasDocSignal(analysis, /WebSocket|实时|消息推送/i)) traits.push('实时通信');
  if (hasDocSignal(analysis, /加密|权限|审计|安全/i)) traits.push('安全控制');
  if (hasDocSignal(analysis, /Docker|Kubernetes|容器/i)) traits.push('容器化部署');
  const languages = officialLanguageValue(analysis) || '项目语言';
  const frameworks = [...extractTechNamesFromDocs(analysis), ...stackNames(analysis?.techStack.frameworks)].slice(0, 4).join('、');
  const databases = stackNames(analysis?.techStack.databases).slice(0, 3).join('、');
  return shortValue(`${traits.join('，') || '模块化设计'}，采用${languages}开发${frameworks ? `，基于${frameworks}` : ''}${databases ? `，使用${databases}` : ''}`, 100);
}

function officialLanguageSummary(analysis: ProjectAnalysis | null): LanguageSummary {
  const totalLines = (analysis?.languages || []).reduce((sum, item) => sum + item.lines, 0);
  const details = (analysis?.languages || [])
    .filter((item) => item.files > 0)
    .map((item) => ({
      language: item.language,
      files: item.files,
      lines: item.lines,
      percent: totalLines > 0 ? Math.round((item.lines / totalLines) * 100) : 0,
    }));

  const value = details.map((item) => item.language).join('、');
  const evidence = details.length
    ? `源码语言统计：${details.map((item) => `${item.language}${item.files}个文件/${item.lines}行/${item.percent}%`).join('；')}`
    : '未识别到源码编程语言，需人工确认';
  return { value, evidence, details };
}

function officialLanguageValue(analysis: ProjectAnalysis | null) {
  return officialLanguageSummary(analysis).value;
}

function shortValue(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function buildBasicInfo(info: ApplicationInfo, analysis: ProjectAnalysis | null): ExtractedBasicInfo {
  const softwareName = resolvedSoftwareName(info, analysis);
  const version = info.version || analysis?.versionCandidates[0]?.version || 'V1.0';
  const functions = businessFunctions(info, analysis);
  const featureGroups = extractFeatureGroups(analysis);
  const mainFunctions = resolveMainFunctionsText(info, analysis);
  const mainFunctionsCount = meaningfulCharCount(mainFunctions);
  const hasMainFunctionsInput = Boolean(compactText(info.mainFunctions));
  const languageSummary = officialLanguageSummary(analysis);
  const languages = languageSummary.value || '需人工确认';
  const supportSoftware = info.supportSoftware.trim() || inferSupportSoftware(analysis);
  const runOs = info.runOs.trim() || inferRuntimePlatform(analysis);
  const purpose = inferDevelopmentPurpose(info, analysis);
  const technicalFeatures = summarizeTechnicalFeatures(info, analysis);
  const hardwareRule = matchHardwareRule(info, analysis);
  const industryRule = matchIndustryRule(info, analysis);
  const businessRule = matchBusinessForm(info, analysis);
  const rows: BasicInfoRow[] = [
    { label: '软件全称', value: softwareName, evidence: info.softwareName ? '当前填写值' : '项目名称候选，仅供参考', needsReview: !info.softwareName.trim() },
    { label: '软件简称', value: info.shortName.trim(), evidence: info.shortName ? '当前填写值' : '无简称可留空', needsReview: false },
    { label: '版本号', value: version, evidence: info.version ? '当前填写值' : '项目版本候选，仅供参考', needsReview: !info.version.trim() },
    { label: '著作权人', value: info.copyrightOwner.trim(), evidence: info.copyrightOwner ? '当前填写值' : '不能从源码判断，必须由申请人确认', needsReview: !info.copyrightOwner.trim() },
    {
      label: '著作权人类型',
      value: info.ownerType === 'enterprise' ? '企业' : info.ownerType === 'individual' ? '个人' : '其他组织',
      evidence: '当前填写值，需与申请主体证件一致',
      needsReview: !info.copyrightOwner.trim(),
    },
    { label: '权利范围', value: '全部权利', evidence: '登记字段默认值' },
    { label: '软件分类', value: info.softwareCategory || inferSoftwareCategory(analysis), evidence: '按软著分类规则和项目形态推断，需确认' },
    { label: '软件说明', value: info.developmentMethod === 'modified' ? '修改（含翻译软件、合成软件）' : '原创', evidence: '默认按原创填写，需按实际权属确认' },
    { label: '开发方式', value: '单独开发', evidence: '默认值，合作/委托/下达任务需人工修改', needsReview: true },
    { label: '开发完成日期', value: info.completionDate, evidence: '默认当前日期，需人工确认', needsReview: true },
    {
      label: '发表状态',
      value: info.publishStatus === 'published' ? `已发表${info.publishDate ? `，首次发表日期 ${info.publishDate}` : ''}` : '未发表',
      evidence: '当前填写值，需人工确认',
      needsReview: info.publishStatus === 'published' && !info.publishDate,
    },
    { label: '开发的硬件环境', value: shortValue(info.devHardware || inferDevHardware(info, analysis), 50), evidence: hardwareEvidenceLabel(info, analysis), needsReview: !info.devHardware || !hardwareRule },
    { label: '运行的硬件环境', value: shortValue(info.runHardware || inferRunHardware(info, analysis), 50), evidence: hardwareEvidenceLabel(info, analysis), needsReview: !info.runHardware || !hardwareRule },
    { label: '开发该软件的操作系统', value: shortValue(info.devOs || inferDevOs(analysis), 50), evidence: '按开发语言和工具链推断，需人工确认' },
    { label: '软件开发环境 / 开发工具', value: shortValue(info.devTools || inferDevTools(analysis), 50), evidence: '按语言推断，IDE 需人工确认', needsReview: true },
    { label: '该软件的运行平台 / 操作系统', value: shortValue(runOs, 50), evidence: '按项目运行形态推断' },
    { label: '软件运行支撑环境 / 支持软件', value: shortValue(supportSoftware, 50), evidence: '由配置依赖和运行时识别' },
    { label: '编程语言', value: languages, evidence: languageSummary.evidence, needsReview: !languageSummary.value },
    { label: '源程序量', value: `${analysis?.scale.sourceLineCount || 0} 行`, evidence: '真实源码行数统计' },
    { label: '开发目的', value: purpose, evidence: purposeEvidenceLabel(info, analysis), needsReview: !businessRule && !industryRule },
    { label: '面向领域 / 行业', value: shortValue(inferIndustry(info, analysis), 50), evidence: industryEvidenceLabel(info, analysis), needsReview: !industryRule },
    {
      label: '软件的主要功能',
      value: mainFunctions,
      evidence:
        hasMainFunctionsInput
          ? `当前填写值，${mainFunctionsCount} 字；要求 ${MIN_MAIN_FUNCTION_CHARS}-${MAX_MAIN_FUNCTION_CHARS} 字`
          : featureGroups.length
            ? `本地规则整理，${mainFunctionsCount} 字；README 功能章节：${Array.from(new Set(featureGroups.map((item) => item.source))).slice(0, 4).join('、')}`
            : functions.length
              ? `本地规则整理，${mainFunctionsCount} 字；源码目录模块线索`
              : `本地规则整理，${mainFunctionsCount} 字；需人工复核`,
      needsReview: mainFunctionsCount < MIN_MAIN_FUNCTION_CHARS || !functions.length,
    },
    { label: '软件的技术特点', value: technicalFeatures, evidence: '由语言、框架、数据库配置生成' },
  ];
  const markdown = [
    `# ${softwareName} 软著基础信息`,
    '',
    '| 字段 | 提取内容 | 证据/说明 |',
    '| --- | --- | --- |',
    ...rows.map((row) => `| ${row.label} | ${row.value || '待填写'} | ${row.evidence}${row.needsReview ? '；需人工确认' : ''} |`),
  ].join('\n');
  return {
    rows,
    markdown,
    json: JSON.stringify(
      {
        rows,
        ruleMatches: {
          businessForm: businessRule
            ? { label: businessRule.rule.label, score: businessRule.score, evidence: businessRule.evidence }
            : null,
          industry: industryRule ? { label: industryRule.rule.label, score: industryRule.score, evidence: industryRule.evidence } : null,
          hardware: hardwareRule ? { label: hardwareRule.rule.name, score: hardwareRule.score, evidence: hardwareRule.evidence } : null,
          programmingLanguages: languageSummary,
        },
        generatedAt: new Date().toISOString(),
        projectRoot: analysis?.root || '',
      },
      null,
      2
    ),
  };
}

function buildApplicationInfoText(basicInfo: ExtractedBasicInfo) {
  return basicInfo.rows.map((row) => `${row.label}：${row.value || '待填写'}`).join('\n');
}

function buildBusinessUnderstanding(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const featureDetails = extractFeatureGroups(analysis).map((group) => ({
    name: group.title,
    details: group.items.slice(0, 6),
    evidence: group.source,
  }));
  const fallbackFeatures = businessFunctions(info, analysis).slice(0, 10);
  const businessFeatures = featureDetails.length ? featureDetails.map((item) => item.name) : fallbackFeatures;
  const context = {
    productPositioning: buildSoftwareIntro(info, analysis),
    industry: info.industry.trim() || '待用户确认',
    targetUsers: info.targetUsers.trim() || '待用户确认',
    coreValue: info.purpose.trim() || '待用户确认',
    businessFeatures,
    businessFeatureDetails: featureDetails,
    operationFlow: businessFeatures.length
      ? businessFeatures.slice(0, 6).map((feature, index) => `${index + 1}. 进入${feature}相关页面，按界面提示完成业务操作并核对系统反馈。`)
      : ['待结合项目界面和用户实际操作补充。'],
    applicationPurpose: inferDevelopmentPurpose(info, analysis),
    mainFunctions: resolveMainFunctionsText(info, analysis),
    technicalCharacteristics: summarizeTechnicalFeatures(info, analysis),
    manualSections: ['软件概述', '运行环境', '进入软件', ...businessFeatures.slice(0, 6), '注意事项'],
    evidence: [
      ...(analysis?.docs.slice(0, 8).map((file) => file.relativePath) || []),
      ...(analysis?.entryHints || []),
      ...(analysis?.modules.flatMap((item) => item.evidence).slice(0, 12) || []),
    ],
  };
  const markdown = [
    `# ${resolvedSoftwareName(info, analysis)} 业务理解`,
    '',
    '## 产品定位',
    '',
    context.productPositioning,
    '',
    '## 行业、用户与核心价值',
    '',
    markdownTable([
      ['面向领域 / 行业', context.industry],
      ['目标用户', context.targetUsers],
      ['核心价值', context.coreValue],
      ['申请口径', context.applicationPurpose],
    ]),
    '',
    '## 主要业务功能',
    '',
    ...(businessFeatures.length ? businessFeatures.map((item) => `- ${item}`) : ['- 待用户确认']),
    '',
    '## 典型操作流程',
    '',
    ...context.operationFlow,
    '',
    '## 证据来源',
    '',
    ...(context.evidence.length ? context.evidence.map((item) => `- ${item}`) : ['- 当前项目材料不足，需用户补充产品说明。']),
    '',
    '> 本文由项目证据整理，行业、目标用户、业务功能和申请口径必须由用户确认后才能进入正式资料生成。',
  ].join('\n');
  return { context, markdown, json: JSON.stringify(context, null, 2) };
}

function buildOperationManual(info: ApplicationInfo, analysis: ProjectAnalysis | null, screenshotMethod: ScreenshotMethod) {
  const softwareName = resolvedSoftwareName(info, analysis);
  const version = info.version || analysis?.versionCandidates[0]?.version || 'V1.0';
  const features = extractFeatureGroups(analysis).flatMap((group) => group.items.slice(0, 3)).slice(0, 8);
  const modules = features.length ? features : businessFunctions(info, analysis).slice(0, 8);
  const screenshotNote = screenshotMethod
    ? `当前截图方式：${screenshotMethod === 'skip' ? '暂不截图' : screenshotMethod}`
    : '截图方式尚未确认';
  return [
    `# ${softwareName} 操作手册`,
    '',
    `版本号：${version}`,
    '',
    '## 一、软件概述',
    '',
    `${softwareName}面向${info.targetUsers || '实际业务用户'}，用于${info.purpose || '完成项目所覆盖的业务处理'}。本手册根据当前项目文档、页面和源码证据整理，介绍用户可见的主要操作。`,
    '',
    '## 二、运行环境',
    '',
    `软件运行平台为${info.runOs || '待确认'}，运行支撑环境为${info.supportSoftware || '待确认'}，建议使用满足“${info.runHardware || '待确认'}”条件的设备。`,
    '',
    '## 三、进入软件',
    '',
    '启动软件后，用户从主界面或导航区域进入需要使用的功能。操作前应先检查页面提示、当前数据范围和必要的输入条件，避免在资料不完整时直接提交。',
    '',
    '【截图预留：请在此处插入软件主界面或首页截图。】',
    '',
    '## 四、主要功能与操作',
    '',
    ...(modules.length
      ? modules.flatMap((module, index) => [
          `### 4.${index + 1} ${module}`,
          '',
          `用户进入“${module}”相关页面后，根据界面字段和提示选择或填写业务内容。执行操作前应核对输入内容，提交后查看页面返回的状态、结果列表或提示信息；如结果不符合预期，应根据提示修正后重新操作。`,
          '',
          `【截图预留：请在此处插入“${module}”页面或操作结果截图。】`,
          '',
        ])
      : ['当前项目证据不足，需在确认业务理解后补充核心模块操作说明。', '']),
    '## 五、注意事项',
    '',
    '- 正式使用前确认软件名称、版本号、运行环境和业务数据范围。',
    '- 涉及删除、覆盖、导出或批量处理时，先核对目标内容并保留必要备份。',
    '- 页面提示失败时记录操作步骤和错误信息，再根据提示检查输入或运行环境。',
    '',
    `截图说明：${screenshotNote}。`,
  ].join('\n');
}

function buildManualSelfCheck(manualMarkdown: string) {
  const screenshotPlaceholders = (manualMarkdown.match(/【截图预留：/g) || []).length;
  const checks = [
    { round: 1, focus: '章节完整性、截图预留和模块内容厚度', ok: manualMarkdown.includes('## 五、注意事项') && screenshotPlaceholders > 0 },
    { round: 2, focus: '按项目操作流程补足模块用途、操作过程和结果反馈', ok: manualMarkdown.includes('提交后查看页面返回') },
    { round: 3, focus: '清理营销化、制式化和过度技术化表达', ok: !/赋能|一站式|显著提升|强大能力|丰富功能/.test(manualMarkdown) },
  ];
  return {
    markdown: [
      '# 操作手册自检记录',
      '',
      ...checks.flatMap((item) => [`## 第 ${item.round} 轮`, '', `检查重点：${item.focus}`, `结果：${item.ok ? '通过' : '待修正'}`, '']),
      `截图预留位置：${screenshotPlaceholders} 处。`,
    ].join('\n'),
    json: JSON.stringify({ checks, screenshotPlaceholders }, null, 2),
  };
}

function buildSoftwareIntro(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const softwareName = resolvedSoftwareName(info, analysis);
  const framework = stackNames(analysis?.techStack.frameworks).join('、') || analysis?.framework || '项目技术栈';
  const databases = stackNames(analysis?.techStack.databases).join('、') || '项目数据存储线索';
  const modules = businessFunctions(info, analysis).slice(0, 5).join('、') || '核心业务处理';
  const target = info.targetUsers || '实际业务用户';
  return `${softwareName}是一套面向${target}的${info.industry || analysis?.framework || '应用'}软件，主要用于${info.purpose || modules}。项目代码显示，系统围绕${modules}等业务能力组织功能，采用${framework}等技术实现，并结合${databases}完成数据支撑。`;
}

function buildSoftwareIntroMarkdown(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  return [
    `# ${resolvedSoftwareName(info, analysis)} 软件简介`,
    '',
    buildSoftwareIntro(info, analysis),
    '',
    '## 名称候选与证据',
    '',
    ...(analysis?.nameCandidates.length
      ? analysis.nameCandidates.map((item) => `- ${item.name}（来源：${item.source}，置信度：${item.confidence}%）`)
      : ['- 暂未识别到可靠名称候选，请人工填写软件全称。']),
  ].join('\n');
}

function buildMainFunctionsMarkdown(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const detailed = resolveMainFunctionsText(info, analysis);
  return [
    `# ${resolvedSoftwareName(info, analysis)} 主要功能`,
    '',
    detailed,
    '',
    `整理字数：${meaningfulCharCount(detailed)} 字`,
    '',
    '## 模块证据',
    '',
    ...(analysis?.modules.length
      ? analysis.modules.map((item) => `- ${item.name}：${item.evidence.join('；')}`)
      : ['- 暂未在 Controller、Service、Router、API、Module、页面目录中识别到明确模块。']),
  ].join('\n');
}

function buildTechnicalFeaturesMarkdown(info: ApplicationInfo, analysis: ProjectAnalysis | null) {
  const stack = analysis?.techStack;
  const languages = stack?.languages.join('、') || analysis?.languages.map((item) => item.language).join('、') || '项目源码语言';
  const frameworks = stackNames(stack?.frameworks).join('、') || analysis?.framework || '项目框架';
  const databases = stackNames(stack?.databases).join('、') || '未识别到明确数据库';
  const middleware = stackNames(stack?.middleware).join('、') || '未识别到明确中间件';
  const buildTools = stackNames(stack?.buildTools).join('、') || '项目构建工具';
  return [
    `# ${resolvedSoftwareName(info, analysis)} 技术特点`,
    '',
    info.technicalFeatures ||
      `本软件主要采用${languages}开发，项目框架或技术形态包括${frameworks}。项目构建与运行涉及${buildTools}，数据库线索包括${databases}，中间件线索包括${middleware}。源码结构中包含入口、页面/接口、业务处理和配置等文件，能够体现软件的启动、交互、数据处理和结果输出流程。`,
    '',
    markdownTable([
      ['开发语言', languages],
      ['框架信息', frameworks],
      ['数据库', databases],
      ['中间件/缓存', middleware],
      ['运行环境', stackNames(stack?.runtimes).join('、') || info.supportSoftware],
      ['构建工具', buildTools],
      ['包管理器', stackNames(stack?.packageManagers).join('、') || '-'],
    ]),
  ].join('\n');
}

function buildProjectReportMarkdown(info: ApplicationInfo, analysis: ProjectAnalysis | null, code: CodeMaterial) {
  if (!analysis) return '# 项目分析报告\n\n尚未扫描项目。';
  return [
    `# ${resolvedSoftwareName(info, analysis)} 项目分析报告`,
    '',
    '## 一、项目基础信息',
    '',
    markdownTable([
      ['项目目录', analysis.root],
      ['项目名称', analysis.name],
      ['软件名称候选', analysis.nameCandidates.map((item) => `${item.name}(${item.source})`).join('；') || '-'],
      ['版本候选', analysis.versionCandidates.map((item) => `${item.version}(${item.source})`).join('；') || '-'],
      ['项目类型', analysis.projectType],
      ['架构判断', analysis.architecture],
      ['包版本号', analysis.packageVersion || '-'],
      ['扫描时间', new Date(analysis.scannedAt).toLocaleString()],
      ['扫描完整性', analysis.scanTruncated ? `达到 ${MAX_SCAN_FILES} 个可读文件上限，结果可能不完整` : '未触发扫描上限'],
    ]),
    '',
    '## 二、扫描规则',
    '',
    markdownTable([
      ['重点配置', analysis.scanRules.includeConfigs.join('、')],
      ['重点目录', analysis.scanRules.meaningfulDirs.join('、')],
      ['排除目录', analysis.scanRules.excludedDirs.join('、')],
      ['排除文件', analysis.scanRules.excludedFiles.join('、')],
    ]),
    '',
    '## 三、技术栈识别',
    '',
    markdownTable([
      ['开发语言', analysis.techStack.languages.join('、') || '-'],
      ['框架信息', stackNames(analysis.techStack.frameworks).join('、') || '-'],
      ['数据库', stackNames(analysis.techStack.databases).join('、') || '-'],
      ['中间件/缓存', stackNames(analysis.techStack.middleware).join('、') || '-'],
      ['运行环境', stackNames(analysis.techStack.runtimes).join('、') || '-'],
      ['构建工具', stackNames(analysis.techStack.buildTools).join('、') || '-'],
      ['包管理器', stackNames(analysis.techStack.packageManagers).join('、') || '-'],
    ]),
    '',
    '### 技术栈证据',
    '',
    ...[
      ...analysis.techStack.frameworks,
      ...analysis.techStack.databases,
      ...analysis.techStack.middleware,
      ...analysis.techStack.runtimes,
      ...analysis.techStack.buildTools,
    ]
      .slice(0, 20)
      .map((item) => `- ${item.name}：${item.evidence.join('；')}`),
    '',
    '## 四、功能模块识别',
    '',
    ...(analysis.modules.length
      ? analysis.modules.map((item) => `- ${item.name}：识别来源 ${item.source}，涉及 ${item.fileCount} 个文件；证据：${item.evidence.join('；')}`)
      : ['- 暂未识别到明确功能模块。']),
    '',
    '## 五、项目规模统计',
    '',
    markdownTable([
      ['源码文件数量', String(analysis.scale.sourceFileCount)],
      ['代码总行数', String(analysis.scale.sourceLineCount)],
      ['文档文件数量', String(analysis.scale.docFileCount)],
      ['技术配置文件数量', String(analysis.scale.configFileCount)],
      ['其他资源/未读文件数量', String(analysis.scale.resourceFileCount)],
      ['模块数量', String(analysis.scale.moduleCount)],
      ['代码材料提交口径', code.mode === 'front-back' ? '前30页和后30页' : code.mode === 'all' ? '不足60页，提交全部' : '未生成'],
    ]),
    '',
    '## 六、主要目录结构',
    '',
    ...analysis.scale.topDirectories.map((item) => `- ${item.path}：${item.files} 个源码文件，${item.lines} 行`),
  ].join('\n');
}

function buildChecklistMarkdown(info: ApplicationInfo, analysis: ProjectAnalysis | null, code: CodeMaterial) {
  const safeName = sanitizeFileName(resolvedSoftwareName(info, analysis));
  const checks: ValidationItem[] = [
    { label: '已扫描真实项目源码', ok: Boolean(analysis && analysis.sourceFiles.length > 0) },
    { label: '已读取技术栈配置证据', ok: Boolean(analysis && analysis.configFiles.length > 0) },
    { label: '软件全称已人工填写', ok: Boolean(info.softwareName.trim()) },
    { label: '版本号已人工填写', ok: Boolean(info.version.trim()) },
    { label: '著作权人已人工填写', ok: Boolean(info.copyrightOwner.trim()) },
    { label: '已识别功能模块线索', ok: Boolean(analysis && (analysis.modules.length > 0 || analysis.functionHints.length > 0)) },
    { label: '源程序材料规则', ok: code.mode !== 'empty' && !code.supplementNeeded },
  ];
  return [
    `# ${resolvedSoftwareName(info, analysis)} 软著信息提取结果清单`,
    '',
    '## 一、工具生成文件',
    '',
    '- 草稿/业务理解.md',
    '- 草稿/申请表信息.md',
    '- 草稿/代码文件候选清单.md',
    '- 草稿/代码文件选择.json',
    '- 草稿/代码提取清单.md',
    '- 草稿/操作手册.md',
    '- 草稿/操作手册自检记录.md',
    '- 正式资料/申请表信息.txt',
    `- 正式资料/${safeName}_操作手册.docx`,
    code.mode === 'front-back'
      ? `- 正式资料/${safeName}-代码(前30页).docx\n- 正式资料/${safeName}-代码(后30页).docx`
      : `- 正式资料/${safeName}-代码(全部).docx`,
    '- 正式资料/生成报告.md',
    '',
    '## 二、自检结果',
    '',
    '| 检查项 | 状态 |',
    '| --- | --- |',
    ...checks.map((item) => `| ${item.label} | ${item.ok ? '通过' : '待补充'} |`),
    '',
    `源程序已选文件：${code.selectedFiles.length} 个；已选源码估算页数：${code.totalSourcePages} 页；正式提交页数：${code.submittedPages} 页。`,
    code.supplementNeeded ? '当前已选源码不足 60 页，但项目候选源码可达到 60 页，建议继续勾选相关源码。' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildMaterials(
  info: ApplicationInfo,
  analysis: ProjectAnalysis | null,
  selections: CodeSelections,
  screenshotMethod: ScreenshotMethod = '',
  manualDraft = '',
  businessDraft = ''
): GeneratedMaterials {
  const code = buildCodeMaterial(info, analysis, selections);
  const basicInfo = buildBasicInfo(info, analysis);
  const businessUnderstanding = buildBusinessUnderstanding(info, analysis);
  const operationManualMarkdown = manualDraft.trim() || buildOperationManual(info, analysis, screenshotMethod);
  const manualSelfCheck = buildManualSelfCheck(operationManualMarkdown);
  const softwareIntroMarkdown = buildSoftwareIntroMarkdown(info, analysis);
  const mainFunctionsMarkdown = buildMainFunctionsMarkdown(info, analysis);
  const technicalFeaturesMarkdown = buildTechnicalFeaturesMarkdown(info, analysis);
  const projectReportMarkdown = buildProjectReportMarkdown(info, analysis, code);
  const checklistMarkdown = buildChecklistMarkdown(info, analysis, code);
  return {
    basicInfo,
    applicationInfoText: buildApplicationInfoText(basicInfo),
    businessUnderstandingMarkdown: businessDraft.trim() || businessUnderstanding.markdown,
    businessUnderstandingJson: businessDraft.trim()
      ? JSON.stringify({ ...businessUnderstanding.context, confirmedMarkdown: businessDraft.trim() }, null, 2)
      : businessUnderstanding.json,
    softwareIntroMarkdown,
    mainFunctionsMarkdown,
    technicalFeaturesMarkdown,
    operationManualMarkdown,
    manualSelfCheckMarkdown: manualSelfCheck.markdown,
    manualSelfCheckJson: manualSelfCheck.json,
    projectReportMarkdown,
    checklistMarkdown,
    code,
  };
}

function Field({
  label,
  value,
  onChange,
  textarea,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-24 w-full resize-none rounded border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 dark:border-gray-700 dark:bg-gray-950"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded border border-gray-200 bg-white px-3 text-sm outline-none focus:border-teal-400 dark:border-gray-700 dark:bg-gray-950"
        />
      )}
    </label>
  );
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 ${className}`}>{children}</div>;
}

function resolveTextModelStatus(status: SoftwareCopyrightTextModelRuntime): TextModelStatus {
  if (status.modelReady) return 'ready';
  if (status.mode === 'invalid') return 'error';
  return 'missing';
}

function useSoftwareCopyrightTextModelRuntime() {
  const [runtime, setRuntime] = useState<SoftwareCopyrightTextModelRuntime | null>(null);
  const [modelStatus, setModelStatus] = useState<TextModelStatus>('checking');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadFile, setDownloadFile] = useState('');
  const [showManualGuide, setShowManualGuide] = useState(false);
  const [copyHint, setCopyHint] = useState('');
  const [modelError, setModelError] = useState<string | null>(null);

  const modelRoot = runtime?.modelDir || '';

  const manualGuideText = useMemo(() => {
    const root = modelRoot.replace(/\//g, '\\');
    return [
      '软著申请字段文本模型 - 手动下载说明',
      '',
      `模型目录：${root}`,
      '',
      ...SOFTWARE_COPYRIGHT_TEXT_MODEL_FILES.flatMap((fileItem, index) => [
        `${index + 1}. ${fileItem.label}`,
        `下载链接：${fileItem.url}`,
        `保存位置：${joinPath(modelRoot, fileItem.path).replace(/\//g, '\\')}`,
        '',
      ]),
      '下载完成后回到工具窗口，点击“重新检测”。',
    ].join('\n');
  }, [modelRoot]);

  async function refreshRuntime() {
    setModelStatus('checking');
    try {
      const status = await invoke<SoftwareCopyrightTextModelRuntime>('check_software_copyright_text_model_runtime');
      setRuntime(status);
      setModelStatus(resolveTextModelStatus(status));
      setModelError(null);
    } catch (err) {
      setModelStatus('error');
      setModelError(String(err));
    }
  }

  async function downloadModels() {
    if (!modelRoot) return;
    setModelStatus('downloading');
    setModelError(null);
    setDownloadProgress(0);
    setDownloadFile('');
    let doneFiles = 0;
    const totalFiles = SOFTWARE_COPYRIGHT_TEXT_MODEL_FILES.length;

    const unlisten = await listen<any>('model-download-progress', (event) => {
      const { loaded, total, done, file } = event.payload;
      setDownloadFile((file as string).split(/[/\\]/).pop() || file);
      const fileProgress = total > 0 ? loaded / total : 0;
      const overall = ((doneFiles + fileProgress) / totalFiles) * 100;
      setDownloadProgress(Math.round(Math.min(100, overall)));
      if (done) doneFiles++;
    });

    try {
      for (const fileItem of SOFTWARE_COPYRIGHT_TEXT_MODEL_FILES) {
        await invoke('download_model_file', {
          url: fileItem.url,
          destPath: joinPath(modelRoot, fileItem.path),
          overwrite: true,
        });
      }
      await refreshRuntime();
    } catch (err) {
      setModelStatus('error');
      setModelError(String(err));
    } finally {
      unlisten();
    }
  }

  async function copyManualGuide() {
    try {
      await navigator.clipboard.writeText(manualGuideText);
      setCopyHint('说明已复制');
    } catch {
      setCopyHint('复制失败');
    }
    window.setTimeout(() => setCopyHint(''), 2000);
  }

  async function openModelDir() {
    if (!modelRoot) return;
    await invoke('open_path', { targetPath: modelRoot });
  }

  useEffect(() => {
    refreshRuntime();
  }, []);

  return {
    runtime,
    modelStatus,
    setModelStatus,
    modelRoot,
    modelError,
    setModelError,
    downloadProgress,
    setDownloadProgress,
    downloadFile,
    setDownloadFile,
    showManualGuide,
    setShowManualGuide,
    manualGuideText,
    copyHint,
    refreshRuntime,
    downloadModels,
    copyManualGuide,
    openModelDir,
  };
}

function SoftwareCopyrightTextModelPanel({
  runtime,
  status,
  progress,
  file,
  error,
  onDownload,
  onRetry,
  onManual,
}: {
  runtime: SoftwareCopyrightTextModelRuntime | null;
  status: TextModelStatus;
  progress: number;
  file: string;
  error?: string | null;
  onDownload: () => void;
  onRetry: () => void;
  onManual: () => void;
}) {
  if (!runtime) {
    return (
      <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300">
        <div className="flex items-start gap-2">
          {status === 'checking' ? <Loader2 size={15} className="mt-0.5 animate-spin" /> : <AlertTriangle size={15} className="mt-0.5" />}
          <div>
            <div className="font-semibold">{status === 'checking' ? '正在检测软著文本模型' : '文本模型检测失败'}</div>
            <div className="mt-1 opacity-80">{error || '正在确认本地模型文件。'}</div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'ready' || status === 'loading' || status === 'generating') {
    return (
      <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-300">
        <div className="flex items-start gap-2">
          {status === 'loading' || status === 'generating' ? <Loader2 size={15} className="mt-0.5 animate-spin" /> : <CheckCircle2 size={15} className="mt-0.5" />}
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              {status === 'loading' ? '正在加载 Qwen 文本模型' : status === 'generating' ? '正在生成软著申请内容' : 'Qwen 文本模型已就绪'}
            </div>
            <div className="mt-1 opacity-80">{runtime.message}</div>
            <div className="mt-1 opacity-70">添加目录扫描默认使用本地规则；只有点击 AI 整理或 AI 分析字段时才会调用 Qwen 后端 worker。</div>
            <div className="mt-1 truncate opacity-70">模型目录：{runtime.modelDir}</div>
            {(status === 'loading' || status === 'generating') && (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-950">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-1 truncate opacity-70">{file || '准备推理环境'}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'downloading') {
    return (
      <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300">
        <div className="flex items-start gap-2">
          <Loader2 size={15} className="mt-0.5 animate-spin" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">正在下载 Qwen 文本模型</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-1 truncate opacity-80">
              {progress}% {file ? `· ${file}` : ''}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
      <div className="flex items-start gap-2">
        {status === 'error' ? <AlertTriangle size={15} className="mt-0.5" /> : <Info size={15} className="mt-0.5" />}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{status === 'error' ? '文本模型不可用' : '可选：下载 Qwen 文本模型'}</div>
          <div className="mt-1 opacity-80">{error || runtime.message}</div>
          <div className="mt-1 truncate opacity-70">下载位置：{runtime.modelDir}</div>
          {runtime.missingFiles.length > 0 && <div className="mt-1 opacity-70">缺少：{runtime.missingFiles.join(' / ')}</div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex h-7 items-center gap-1 rounded bg-amber-500 px-2 text-[11px] font-medium text-white hover:bg-amber-600"
            >
              <Download size={12} />
              下载模型（约 {SOFTWARE_COPYRIGHT_TEXT_MODEL_SIZE_MB}MB）
            </button>
            <button
              type="button"
              onClick={onManual}
              className="h-7 rounded border border-amber-200 bg-white px-2 text-[11px] text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-300"
            >
              手动下载方法
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-7 items-center gap-1 rounded border border-amber-200 bg-white px-2 text-[11px] text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-300"
            >
              <RefreshCw size={12} />
              重新检测
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SoftwareCopyrightTextModelGuide({
  runtime,
  guideText,
  copyHint,
  onClose,
  onCopy,
  onOpenDir,
}: {
  runtime: SoftwareCopyrightTextModelRuntime;
  guideText: string;
  copyHint: string;
  onClose: () => void;
  onCopy: () => void;
  onOpenDir: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded bg-white shadow-2xl dark:bg-gray-900">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">软著文本模型下载方法</div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                模型不会内置在软件中，下载后仅作为本机软著申请字段和文案整理能力使用。
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              关闭
            </button>
          </div>
        </div>
        <div className="space-y-4 px-5 py-4 text-xs text-gray-700 dark:text-gray-200">
          <div className="rounded border border-blue-100 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-900/20">
            <div className="font-medium text-blue-700 dark:text-blue-300">模型目录</div>
            <div className="mt-2 break-all rounded bg-white px-3 py-2 font-mono text-[11px] dark:bg-gray-950">
              {runtime.modelDir.replace(/\//g, '\\')}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onOpenDir} className="rounded bg-blue-500 px-3 py-2 text-white hover:bg-blue-600">
                打开模型目录
              </button>
              <button type="button" onClick={onCopy} className="rounded bg-gray-100 px-3 py-2 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-100">
                复制下载说明
              </button>
              {copyHint && <span className="self-center text-green-600 dark:text-green-400">{copyHint}</span>}
            </div>
          </div>
          <div className="space-y-3">
            {SOFTWARE_COPYRIGHT_TEXT_MODEL_FILES.map((fileItem) => (
              <div key={fileItem.path} className="rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
                <div className="font-medium text-gray-900 dark:text-gray-100">{fileItem.label}</div>
                <a href={fileItem.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-blue-600 underline dark:text-blue-400">
                  {fileItem.url}
                </a>
                <div className="mt-2 break-all rounded bg-white px-3 py-2 font-mono text-[11px] dark:bg-gray-900">
                  {joinPath(runtime.modelDir, fileItem.path).replace(/\//g, '\\')}
                </div>
              </div>
            ))}
          </div>
          <textarea
            readOnly
            value={guideText}
            className="h-36 w-full resize-none rounded border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] dark:border-gray-800 dark:bg-gray-950"
          />
        </div>
      </div>
    </div>
  );
}

export default function SoftwareCopyrightTool() {
  const ready = useToolTheme();
  const [tab, setTab] = useState<TabId>('overview');
  const [info, setInfo] = useState<ApplicationInfo>(() => loadSavedInfo());
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [codeSelections, setCodeSelections] = useState<CodeSelections>({});
  const [manualDraft, setManualDraft] = useState('');
  const [businessDraft, setBusinessDraft] = useState('');
  const [confirmations, setConfirmations] = useState<WorkflowConfirmations>({
    business: false,
    applicationFields: false,
    codeSelection: false,
    screenshotMethod: '',
    markdown: false,
  });
  const [codeFilter, setCodeFilter] = useState('');
  const [outputRoot, setOutputRoot] = useState('');
  const [scanning, setScanning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const textModelRuntime = useSoftwareCopyrightTextModelRuntime();

  const materials = useMemo(
    () => buildMaterials(info, analysis, codeSelections, confirmations.screenshotMethod, manualDraft, businessDraft),
    [analysis, businessDraft, codeSelections, confirmations.screenshotMethod, info, manualDraft]
  );
  const validations = useMemo<ValidationItem[]>(
    () => {
      const mainFunctionCount = meaningfulCharCount(info.mainFunctions);
      return [
        { label: '项目源码', ok: Boolean(analysis && analysis.sourceFiles.length > 0), detail: `${analysis?.sourceFiles.length || 0} 个源码文件` },
        { label: '扫描完整性', ok: Boolean(analysis && !analysis.scanTruncated), detail: analysis?.scanTruncated ? `已达到 ${MAX_SCAN_FILES} 个可读文件上限` : '未触发扫描上限' },
        {
          label: '软件全称',
          ok: Boolean(info.softwareName.trim()),
          detail: info.softwareName || '待用户确认',
        },
        {
          label: '版本号',
          ok: Boolean(info.version.trim()),
          detail: info.version || '待用户确认',
        },
        { label: '著作权人', ok: Boolean(info.copyrightOwner.trim()), detail: info.copyrightOwner || '待填写' },
        { label: '开发完成日期', ok: Boolean(info.completionDate.trim()), detail: info.completionDate || '待填写' },
        {
          label: '发表信息',
          ok: info.publishStatus === 'unpublished' || Boolean(info.publishDate.trim()),
          detail: info.publishStatus === 'unpublished' ? '未发表' : info.publishDate || '缺少首次发表日期',
        },
        { label: '开发硬件环境', ok: Boolean(info.devHardware.trim() && info.devHardware !== '需人工确认'), detail: info.devHardware || '待填写' },
        { label: '运行硬件环境', ok: Boolean(info.runHardware.trim() && info.runHardware !== '需人工确认'), detail: info.runHardware || '待填写' },
        { label: '开发操作系统', ok: Boolean(info.devOs.trim() && info.devOs !== '需人工确认'), detail: info.devOs || '待填写' },
        { label: '开发工具', ok: Boolean(info.devTools.trim() && info.devTools !== '需人工确认'), detail: info.devTools || '待填写' },
        { label: '运行平台', ok: Boolean(info.runOs.trim() && info.runOs !== '需人工确认'), detail: info.runOs || '待填写' },
        { label: '运行支撑环境', ok: Boolean(info.supportSoftware.trim() && info.supportSoftware !== '需人工确认'), detail: info.supportSoftware || '待填写' },
        {
          label: '主要功能字数',
          ok: mainFunctionCount >= MIN_MAIN_FUNCTION_CHARS,
          detail: `${mainFunctionCount}/${MIN_MAIN_FUNCTION_CHARS}-${MAX_MAIN_FUNCTION_CHARS} 字`,
        },
        { label: '源码文档', ok: materials.code.mode !== 'empty' && !materials.code.supplementNeeded, detail: `${materials.code.totalSourcePages} 页` },
        {
          label: '截图方式与手册',
          ok: Boolean(
            confirmations.screenshotMethod &&
              (confirmations.screenshotMethod === 'skip' || !/【截图预留：/.test(materials.operationManualMarkdown))
          ),
          detail: !confirmations.screenshotMethod
            ? '待选择截图方式'
            : confirmations.screenshotMethod === 'skip'
              ? '本次跳过截图并保留占位'
              : /【截图预留：/.test(materials.operationManualMarkdown)
                ? '仍有截图占位待替换'
                : '截图内容已整理',
        },
      ];
    },
    [analysis, confirmations.screenshotMethod, info, materials]
  );
  const filteredSourceFiles = useMemo(() => {
    const q = codeFilter.trim().toLowerCase();
    const files = analysis?.sourceFiles || [];
    if (!q) return files;
    return files.filter(
      (file) =>
        file.relativePath.toLowerCase().includes(q) ||
        file.language.toLowerCase().includes(q) ||
        selectionReason(file).toLowerCase().includes(q)
    );
  }, [analysis, codeFilter]);

  const failedValidation = validations.find((item) => !item.ok);
  const workflowReason = workflowBlockingReason(confirmations);
  const canExportFinal = Boolean(analysis) && !failedValidation && !workflowReason;
  const exportReason = workflowReason || exportBlockingReason(analysis, failedValidation);
  const canAddProject = !['loading', 'generating'].includes(textModelRuntime.modelStatus);
  const addProjectReason = canAddProject ? '选择软件项目目录' : 'Qwen 正在推理，请稍后再添加项目';

  const patchInfo = (patch: Partial<ApplicationInfo>) => {
    setInfo((current) => {
      const next = { ...current, ...patch };
      saveInfo(next);
      return next;
    });
    const businessKeys: Array<keyof ApplicationInfo> = [
      'softwareName',
      'industry',
      'targetUsers',
      'purpose',
      'mainFunctions',
      'technicalFeatures',
    ];
    const invalidatesBusiness = businessKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
    setConfirmations((current) => ({
      ...current,
      business: invalidatesBusiness ? false : current.business,
      applicationFields: false,
      codeSelection: invalidatesBusiness ? false : current.codeSelection,
      markdown: false,
    }));
  };

  const replaceCodeSelections = (next: CodeSelections) => {
    setCodeSelections(next);
    setConfirmations((current) => ({ ...current, codeSelection: false, markdown: false }));
  };

  const parseSelectionDraft = (raw: string) => {
    if (!analysis) throw new Error('当前项目尚未扫描。');
    const parsed = JSON.parse(raw) as { items?: Array<Partial<CodeSelectionItem>> };
    const filesByPath = new Map(analysis.sourceFiles.map((file) => [file.path, file]));
    const next: CodeSelections = {};
    for (const item of parsed.items || []) {
      if (!item.selected || !item.path) continue;
      const file = filesByPath.get(item.path);
      if (!file) throw new Error(`选择文件不在当前扫描结果中：${item.path}`);
      next[file.path] = normalizeCodeRange(file, {
        startLine: Number(item.startLine || 1),
        endLine: Number(item.endLine || file.lines),
      });
    }
    return next;
  };

  const sameCodeSelections = (left: CodeSelections, right: CodeSelections) => {
    const leftPaths = Object.keys(left).sort();
    const rightPaths = Object.keys(right).sort();
    return (
      leftPaths.length === rightPaths.length &&
      leftPaths.every(
        (path, index) =>
          path === rightPaths[index] &&
          left[path].startLine === right[path].startLine &&
          left[path].endLine === right[path].endLine
      )
    );
  };

  const confirmStage = async (stage: keyof WorkflowConfirmations) => {
    if (outputRoot) {
      try {
        const draftMaterials =
          stage === 'codeSelection'
            ? materials
            : confirmations.codeSelection
              ? buildMaterials(
                  info,
                  analysis,
                  await readConfirmedSelections(),
                  confirmations.screenshotMethod,
                  manualDraft,
                  businessDraft
                )
              : materials;
        await createDraftPackage(draftMaterials, outputRoot);
        await writeConfirmationRecord(
          stage,
          stage === 'business'
            ? '用户确认业务理解草稿'
            : stage === 'applicationFields'
              ? '用户确认申请表字段'
              : stage === 'codeSelection'
                ? '用户确认代码文件和抽取行段'
                : '用户确认全部 Markdown 草稿'
        );
      } catch (err) {
        setError(`保存确认草稿失败：${String(err)}`);
        return;
      }
    }
    setConfirmations((current) => ({ ...current, [stage]: true }));
    setMessage(
      stage === 'business'
        ? '已确认业务理解，可以继续补全申请表字段。'
        : stage === 'applicationFields'
          ? '已确认申请表字段，可以继续确认代码文件和抽取行段。'
          : stage === 'codeSelection'
            ? '已确认代码选择，请选择操作手册截图方式并检查全部草稿。'
            : '已确认全部 Markdown 草稿，可以生成正式资料。'
    );
  };

  const loadSelectionFromDraft = async () => {
    if (!analysis || !outputRoot) return;
    try {
      const raw = await readTextFile(joinPath(outputRoot, '草稿', '代码文件选择.json'));
      const next = parseSelectionDraft(raw);
      replaceCodeSelections(next);
      setMessage(`已从草稿读取 ${Object.keys(next).length} 个代码文件行段，请核对后点击确认。`);
    } catch (err) {
      setError(`读取代码文件选择失败：${String(err)}`);
    }
  };

  const readConfirmedSelections = async () => {
    if (!analysis || !outputRoot) throw new Error('当前项目或输出目录不存在。');
    const raw = await readTextFile(joinPath(outputRoot, '草稿', '代码文件选择.json'));
    const next = parseSelectionDraft(raw);
    if (!Object.keys(next).length) throw new Error('代码文件选择.json 未包含已选择的源码行段。');
    if (!sameCodeSelections(next, codeSelections)) {
      throw new Error('代码文件选择.json 与当前已确认的界面选择不一致，请重新读取 JSON 并确认代码行段。');
    }
    return next;
  };

  const runQwenTextGeneration = async (
    prompt: string,
    maxNewTokens: number,
    preparingLabel: string,
    minOutputChars = 0
  ) => {
    textModelRuntime.setDownloadProgress(0);
    textModelRuntime.setDownloadFile(preparingLabel);
    const unlisten = await listen<SoftwareCopyrightQwenProgress>('software-copyright-qwen-progress', (event) => {
      textModelRuntime.setDownloadProgress(Math.max(0, Math.min(100, event.payload.progress || 0)));
      textModelRuntime.setDownloadFile(
        event.payload.message || `${event.payload.generatedTokens || 0}/${event.payload.maxNewTokens || maxNewTokens} tokens`
      );
    });
    try {
      const request: SoftwareCopyrightQwenRequest = {
        prompt,
        maxNewTokens,
        minOutputChars,
      };
      const result = await invoke<SoftwareCopyrightQwenResult>('software_copyright_generate_main_functions', {
        request,
      });
      return result.text;
    } finally {
      unlisten();
    }
  };

  const generateApplicationFieldsWithQwen = async (currentInfo: ApplicationInfo, currentAnalysis: ProjectAnalysis) => {
    textModelRuntime.setModelStatus('generating');
    const prompt = buildQwenApplicationFieldsPrompt(currentInfo, currentAnalysis);
    const text = await runQwenTextGeneration(prompt, TEXT_MODEL_FIELD_MAX_NEW_TOKENS, '后端 Qwen 推理准备中：行业和申请字段');
    return normalizeQwenApplicationFields(text, currentAnalysis);
  };

  const generateMainFunctionsTextWithQwen = async (currentInfo: ApplicationInfo, currentAnalysis: ProjectAnalysis) => {
    textModelRuntime.setModelStatus('generating');
    const text = await runQwenTextGeneration(
      buildQwenMainFunctionsPrompt(currentInfo, currentAnalysis),
      TEXT_MODEL_MAIN_REPAIR_MAX_NEW_TOKENS,
      '后端 Qwen 正在整理主要功能',
      MIN_MAIN_FUNCTION_CHARS
    );
    return validateQwenMainFunctions(text);
  };

  const generateTechnicalFeaturesWithQwen = async (currentInfo: ApplicationInfo, currentAnalysis: ProjectAnalysis) => {
    textModelRuntime.setModelStatus('generating');
    const text = await runQwenTextGeneration(
      buildQwenTechnicalFeaturesPrompt(currentInfo, currentAnalysis),
      TEXT_MODEL_FIELD_MAX_NEW_TOKENS,
      '后端 Qwen 正在整理技术特点'
    );
    return normalizeQwenTechnicalFeatures(text);
  };

  const generateApplicationFieldsWithAi = async () => {
    if (!analysis) {
      setError('请先添加目录并完成项目扫描。');
      return;
    }
    if (!textModelRuntime.runtime?.modelReady) {
      setError('请先下载并检测 Qwen 文本模型。');
      return;
    }
    setError('');
    setMessage('正在使用本地 Qwen 模型分析行业、目标用户和开发目的...');
    textModelRuntime.setModelStatus('generating');
    try {
      const fields = await generateApplicationFieldsWithQwen(info, analysis);
      const { technicalFeatures: _technicalFeatures, ...basicFields } = fields;
      patchInfo(basicFields);
      textModelRuntime.setModelStatus('ready');
      setMessage('已用本地 Qwen 模型分析可推断字段；技术特点和主要功能默认保留本地规则结果，可在对应字段单独 AI 整理。');
    } catch (err) {
      textModelRuntime.setModelStatus('error');
      textModelRuntime.setModelError(String(err));
      setError(`AI 字段分析失败：${String(err)}。未使用本地规则冒充 AI 结果，请检查模型文件后重试。`);
    }
  };

  const generateMainFunctionsWithAi = async () => {
    if (!analysis) {
      setError('请先添加目录并完成项目扫描。');
      return;
    }
    if (!textModelRuntime.runtime?.modelReady) {
      setError('请先下载并检测 Qwen 文本模型，或使用“本地规则整理”。');
      return;
    }
    setError('');
    setMessage('正在使用本地 Qwen 模型生成软著申请内容...');
    textModelRuntime.setModelStatus('generating');
    try {
      const mainFunctions = await generateMainFunctionsTextWithQwen(info, analysis);
      patchInfo({ mainFunctions });
      textModelRuntime.setModelStatus('ready');
      setMessage(`已用本地 Qwen 模型整理主要功能：${meaningfulCharCount(mainFunctions)} 字，仍建议人工复核。`);
    } catch (err) {
      textModelRuntime.setModelStatus('error');
      textModelRuntime.setModelError(String(err));
      setError(`AI 整理失败：${String(err)}。可先使用“本地规则整理”继续生成资料。`);
    }
  };

  const generateTechnicalFeaturesWithAi = async () => {
    if (!analysis) {
      setError('请先添加目录并完成项目扫描。');
      return;
    }
    if (!textModelRuntime.runtime?.modelReady) {
      setError('请先下载并检测 Qwen 文本模型，或使用“本地规则整理”。');
      return;
    }
    setError('');
    setMessage('正在使用本地 Qwen 模型整理软件技术特点...');
    textModelRuntime.setModelStatus('generating');
    try {
      const technicalFeatures = await generateTechnicalFeaturesWithQwen(info, analysis);
      patchInfo({ technicalFeatures });
      textModelRuntime.setModelStatus('ready');
      setMessage('已用本地 Qwen 模型整理软件技术特点，仍建议人工复核。');
    } catch (err) {
      textModelRuntime.setModelStatus('error');
      textModelRuntime.setModelError(String(err));
      setError(`AI 技术特点整理失败：${String(err)}。可先使用“本地规则整理”继续生成资料。`);
    }
  };

  const createDraftPackage = async (
    currentMaterials: GeneratedMaterials,
    root: string,
    projectAnalysis: ProjectAnalysis | null = analysis
  ) => {
    if (!root) return;
    const draft = joinPath(root, '草稿');
    const analysisDir = joinPath(root, 'analysis');
    const files: TextFileWrite[] = [
      { path: joinPath(analysisDir, 'project.json'), content: JSON.stringify(projectAnalysis, null, 2) },
      { path: joinPath(draft, '业务理解.md'), content: currentMaterials.businessUnderstandingMarkdown },
      { path: joinPath(draft, '业务理解.json'), content: currentMaterials.businessUnderstandingJson },
      { path: joinPath(draft, '申请表信息.md'), content: currentMaterials.basicInfo.markdown },
      { path: joinPath(draft, '基础信息.json'), content: currentMaterials.basicInfo.json },
      { path: joinPath(draft, '代码文件候选清单.md'), content: currentMaterials.code.selectionMarkdown },
      { path: joinPath(draft, '代码文件选择.json'), content: currentMaterials.code.selectionJson },
      { path: joinPath(draft, '代码提取清单.md'), content: currentMaterials.code.manifestMarkdown },
      { path: joinPath(draft, '代码提取清单.json'), content: currentMaterials.code.manifestJson },
      { path: joinPath(draft, '操作手册.md'), content: currentMaterials.operationManualMarkdown },
      { path: joinPath(draft, '操作手册自检记录.md'), content: currentMaterials.manualSelfCheckMarkdown },
      { path: joinPath(draft, '操作手册自检记录.json'), content: currentMaterials.manualSelfCheckJson },
    ];
    await writeGeneratedFiles([root, draft, analysisDir], files);
  };

  const writeConfirmationRecord = async (stage: keyof WorkflowConfirmations, note: string) => {
    if (!outputRoot) return;
    const record: ConfirmationRecord = {
      confirmed: true,
      confirmedAt: new Date().toISOString(),
      note,
    };
    await writeGeneratedFiles([joinPath(outputRoot, '确认记录')], [
      {
        path: joinPath(outputRoot, '确认记录', `${stage}.json`),
        content: JSON.stringify(record, null, 2),
      },
    ]);
  };

  const selectScreenshotMethod = async (method: ScreenshotMethod) => {
    setConfirmations((current) => ({ ...current, screenshotMethod: method, markdown: false }));
    try {
      await writeConfirmationRecord(
        'screenshotMethod',
        method === 'skip' ? '用户选择本次跳过截图并保留可见占位' : `用户选择截图方式：${method}`
      );
    } catch (err) {
      setError(`保存截图方式确认记录失败：${String(err)}`);
    }
  };

  const chooseProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false, title: '选择软件项目目录' });
    if (typeof selected !== 'string') return;
    setScanning(true);
    setError('');
    setMessage('正在扫描项目源码...');
    try {
      const result = await analyzeProject(selected);
      const bestName = result.nameCandidates[0];
      const suggestedName = bestName && bestName.confidence >= 85 ? bestName.name : '';
      const nextName = '';
      const baseInfoSeed: ApplicationInfo = {
        ...DEFAULT_INFO,
        softwareName: nextName,
        version: '',
      };
      const baseInfo: ApplicationInfo = {
        ...baseInfoSeed,
        mainFunctions: buildDetailedMainFunctions(baseInfoSeed, result),
        technicalFeatures: summarizeTechnicalFeatures(baseInfoSeed, result),
        softwareCategory: inferSoftwareCategory(result),
        industry: inferIndustry(baseInfoSeed, result),
        targetUsers: matchBusinessForm(baseInfoSeed, result)?.rule.targetUsers || '业务人员、管理人员和系统维护人员',
        purpose: inferDevelopmentPurpose(baseInfoSeed, result),
      };
      const inferredInfo = buildBasicInfo(
        baseInfo,
        result
      );
      const rowValue = (label: string) => inferredInfo.rows.find((row) => row.label === label)?.value || '';
      const nextInfo: ApplicationInfo = {
        ...baseInfo,
        softwareName: nextName,
        shortName: '',
        devHardware: rowValue('开发的硬件环境') || inferDevHardware(baseInfo, result),
        runHardware: rowValue('运行的硬件环境') || inferRunHardware(baseInfo, result),
        devOs: rowValue('开发该软件的操作系统') || inferDevOs(result),
        runOs: rowValue('该软件的运行平台 / 操作系统') || '需人工确认',
        devTools: rowValue('软件开发环境 / 开发工具') || '需人工确认',
        supportSoftware: rowValue('软件运行支撑环境 / 支持软件') || '需人工确认',
        softwareCategory: baseInfo.softwareCategory,
        industry: baseInfo.industry,
        targetUsers: baseInfo.targetUsers,
        mainFunctions: baseInfo.mainFunctions,
        purpose: baseInfo.purpose,
        technicalFeatures: baseInfo.technicalFeatures,
      };
      const root = joinPath(result.root, '软件著作权申请资料');
      const stagedMaterials = buildMaterials(nextInfo, result, {});
      setAnalysis(result);
      setCodeSelections({});
      setManualDraft('');
      setBusinessDraft('');
      setConfirmations({ business: false, applicationFields: false, codeSelection: false, screenshotMethod: '', markdown: false });
      setInfo(nextInfo);
      saveInfo(nextInfo);
      setOutputRoot(root);
      await createDraftPackage(stagedMaterials, root, result);
      const nameHint = suggestedName ? `；软件名称候选为“${suggestedName}”，请人工填写确认` : '';
      const versionHint = result.versionCandidates[0]?.version
        ? `；项目版本候选为 ${result.versionCandidates[0].version}，请确认软著版本号`
        : '；未识别到可靠版本号，请人工填写';
      const lowVersionHint = result.packageVersion && versionLooksLowerThanOne(result.packageVersion) ? '；项目版本低于 V1.0，首次申报口径通常需单独确认' : '';
      const scanHint = result.scanTruncated ? `；已达到 ${MAX_SCAN_FILES} 个可读文件上限，请缩小项目范围后重新扫描` : '';
      setMessage(`已扫描项目并生成业务理解、申请表和代码候选草稿：${root}${nameHint}${versionHint}${lowVersionHint}${scanHint}。请先确认业务理解。`);
      setTab('business');
    } catch (err) {
      setError(`扫描失败：${String(err)}`);
    } finally {
      setScanning(false);
    }
  };

  const exportPackage = async () => {
    if (!analysis || !outputRoot) {
      setError('请先选择项目并完成自动分析。');
      return;
    }
    const workflowFailure = workflowBlockingReason(confirmations);
    if (workflowFailure) {
      setError(workflowFailure);
      if (!confirmations.business) setTab('business');
      else if (!confirmations.applicationFields) setTab('info');
      else if (!confirmations.codeSelection) setTab('code');
      else setTab('check');
      return;
    }
    const failed = validations.find((item) => !item.ok);
    if (failed) {
      setError(`自检未通过：${failed.label}。请补充后再导出资料。`);
      setTab(failed.label === '源码文档' ? 'code' : 'info');
      return;
    }
    if (confirmations.screenshotMethod !== 'skip' && /【截图预留：/.test(materials.operationManualMarkdown)) {
      setError('已选择实际截图方式，但操作手册仍包含截图预留位置。请插入或引用截图后再确认 Markdown；如本次不截图，请选择“暂不截图”。');
      setTab('check');
      return;
    }
    setExporting(true);
    setError('');
    setMessage('正在生成正式 PDF/DOCX/TXT 资料...');
    try {
      const confirmedSelections = await readConfirmedSelections();
      const confirmedMaterials = buildMaterials(
        info,
        analysis,
        confirmedSelections,
        confirmations.screenshotMethod,
        manualDraft,
        businessDraft
      );
      if (confirmedMaterials.code.mode === 'empty' || confirmedMaterials.code.supplementNeeded) {
        throw new Error('已确认的代码文件选择不满足源程序材料规则，请返回代码选择页重新确认。');
      }
      await createDraftPackage(confirmedMaterials, outputRoot);
      const finalDir = joinPath(outputRoot, '正式资料');
      const outputName = resolvedSoftwareName(info, analysis);
      const safeName = sanitizeFileName(outputName);
      const finalFiles: TextFileWrite[] = [
        { path: joinPath(finalDir, '申请表信息.txt'), content: confirmedMaterials.applicationInfoText },
        { path: joinPath(finalDir, '生成报告.md'), content: confirmedMaterials.checklistMarkdown },
      ];
      if (confirmedMaterials.code.mode === 'front-back') {
        await writeGeneratedFiles([finalDir], finalFiles);
        const frontTitle = `${outputName} 源程序鉴别材料（前30页）`;
        const backTitle = `${outputName} 源程序鉴别材料（后30页）`;
        await writeDocx(joinPath(finalDir, `${safeName}-代码(前30页).docx`), frontTitle, confirmedMaterials.code.frontText, 'code', `${outputName} ${info.version}`, CODE_LINES_PER_PAGE);
        await writeDocx(joinPath(finalDir, `${safeName}-代码(后30页).docx`), backTitle, confirmedMaterials.code.backText, 'code', `${outputName} ${info.version}`, CODE_LINES_PER_PAGE);
      } else {
        await writeGeneratedFiles([finalDir], finalFiles);
        const allTitle = `${outputName} 源程序鉴别材料（全部）`;
        await writeDocx(joinPath(finalDir, `${safeName}-代码(全部).docx`), allTitle, confirmedMaterials.code.allText, 'code', `${outputName} ${info.version}`, CODE_LINES_PER_PAGE);
      }
      await writeDocx(
        joinPath(finalDir, `${safeName}_操作手册.docx`),
        `${outputName} 操作手册`,
        confirmedMaterials.operationManualMarkdown,
        'report',
        `${outputName} ${info.version}`
      );
      await invoke('open_path', { targetPath: finalDir });
      setMessage(`资料已导出：${finalDir}`);
    } catch (err) {
      setError(`导出失败：${String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const exportSingle = async (name: string, content: string, ext: string) => {
    const path = await saveDialog({
      defaultPath: `${sanitizeFileName(resolvedSoftwareName(info, analysis))}_${name}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return;
    await writeGeneratedFiles([], [{ path, content }]);
    setMessage(`已保存：${path}`);
  };

  const exportApplicationInfoPdf = async () => {
    const outputName = resolvedSoftwareName(info, analysis);
    const path = await saveDialog({
      defaultPath: `${sanitizeFileName(outputName)}_申请表信息.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!path) return;
    await writePdf(path, `${outputName} 申请表信息`, materials.basicInfo.markdown, 'report');
    setMessage(`已保存：${path}`);
  };

  if (!ready) return null;

  return (
    <>
      <div className="flex h-screen flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="📜"
        title="软著基础信息提取"
        subtitle="添加目录，扫描代码，提取登记基础信息并整理前后各 30 页源码"
        actions={
          <>
            <button
              onClick={chooseProject}
              disabled={scanning || !canAddProject}
              title={addProjectReason}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {scanning ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
              添加目录
            </button>
            <button
              onClick={exportPackage}
              disabled={exporting || !analysis || !canExportFinal}
              title={exportReason}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              导出资料
            </button>
          </>
        }
      />
      <StatusMessage message={message} error={error} />

      <main className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)_380px] overflow-hidden">
        <aside className="border-r border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-1">
            {[
              { id: 'overview', label: '流程', icon: BookOpenCheck },
              { id: 'business', label: '业务理解', icon: Info },
              { id: 'info', label: '申请表信息', icon: FileText },
              { id: 'project', label: '项目证据', icon: Search },
              { id: 'code', label: '代码选择', icon: FileCode2 },
              { id: 'check', label: '草稿确认', icon: CheckCircle2 },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id as TabId)}
                  className={`flex h-10 w-full items-center gap-2 rounded px-3 text-left text-sm ${
                    tab === item.id
                      ? 'bg-teal-50 font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-100'
                      : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <Panel className="mt-4 text-xs">
            <div className="font-semibold">当前资料</div>
            <div className="mt-2 space-y-1 text-gray-500 dark:text-gray-400">
              <div>软件：{analysis ? resolvedSoftwareName(info, analysis) : '-'}</div>
              <div>版本：{info.version || analysis?.versionCandidates[0]?.version || '-'}</div>
              <div>源码：{analysis?.sourceFiles.length || 0} 个文件</div>
              <div>已选：{materials.code.selectedFiles.length} 个文件</div>
              <div>页数：{materials.code.totalSourcePages} 页</div>
              <div>目录：{outputRoot || '-'}</div>
            </div>
          </Panel>

          <Panel className="mt-3 text-xs">
            <div className="font-semibold">当前流程</div>
            <div className="mt-2 space-y-1 text-gray-500 dark:text-gray-400">
              <div>1. 添加目录并扫描证据</div>
              <div>2. 确认业务理解</div>
              <div>3. 确认申请表字段</div>
              <div>4. 确认代码文件和行段</div>
              <div>5. 选择截图方式</div>
              <div>6. 确认草稿并导出</div>
            </div>
          </Panel>
        </aside>

        <section className="min-h-0 overflow-auto p-4">
          {tab === 'overview' && (
            <div className="space-y-4">
              <Panel>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">本地文本模型环境</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      启动后先检测 Qwen2.5 文本模型；缺失时先下载或按手动说明放入模型目录，再添加项目整理材料。
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={textModelRuntime.refreshRuntime}
                    disabled={textModelRuntime.modelStatus === 'checking' || textModelRuntime.modelStatus === 'downloading'}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    {textModelRuntime.modelStatus === 'checking' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    检测环境
                  </button>
                </div>
                <SoftwareCopyrightTextModelPanel
                  runtime={textModelRuntime.runtime}
                  status={textModelRuntime.modelStatus}
                  progress={textModelRuntime.downloadProgress}
                  file={textModelRuntime.downloadFile}
                  error={textModelRuntime.modelError}
                  onDownload={textModelRuntime.downloadModels}
                  onRetry={textModelRuntime.refreshRuntime}
                  onManual={() => textModelRuntime.setShowManualGuide(true)}
                />
              </Panel>
              <Panel>
                <div className="mb-2 text-sm font-semibold">软著材料生成口径</div>
                <div className="space-y-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                  {OFFICIAL_RULES.map((item) => (
                    <div key={item} className="flex gap-2">
                      <CheckCircle2 size={15} className="mt-1 shrink-0 text-teal-600" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel>
                <div className="mb-2 text-sm font-semibold">建议流程</div>
                <div className="grid gap-2 text-sm text-gray-600 dark:text-gray-300 md:grid-cols-2">
                  {['添加项目目录并扫描证据', '确认业务理解', '补全申请表字段', '确认代码文件和行段', '选择截图方式', '确认草稿并生成正式资料'].map((item, index) => (
                    <div key={item} className="rounded bg-gray-50 px-3 py-2 dark:bg-gray-950">
                      {index + 1}. {item}
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel>
                <div className="mb-2 text-sm font-semibold">扫描边界</div>
                <div className="grid gap-3 text-xs text-gray-600 dark:text-gray-300 md:grid-cols-2">
                  <div>
                    <div className="mb-1 font-medium text-gray-800 dark:text-gray-100">重点配置</div>
                    <div className="leading-5">{SCAN_RULES.includeConfigs.join('、')}</div>
                  </div>
                  <div>
                    <div className="mb-1 font-medium text-gray-800 dark:text-gray-100">重点目录</div>
                    <div className="leading-5">{SCAN_RULES.meaningfulDirs.join('、')}</div>
                  </div>
                  <div>
                    <div className="mb-1 font-medium text-gray-800 dark:text-gray-100">排除目录</div>
                    <div className="leading-5">{SCAN_RULES.excludedDirs.join('、')}</div>
                  </div>
                  <div>
                    <div className="mb-1 font-medium text-gray-800 dark:text-gray-100">排除文件</div>
                    <div className="leading-5">{SCAN_RULES.excludedFiles.join('、')}</div>
                  </div>
                </div>
              </Panel>
            </div>
          )}

          {tab === 'info' && (
            <div className="space-y-4">
              {!analysis ? (
                <EmptyState icon={<FolderOpen size={36} />} text="添加目录后自动扫描代码并提取软著基础信息" />
              ) : (
                <div className="space-y-4">
                  <Panel>
                    <div className="mb-3 text-sm font-semibold">基础信息提取结果</div>
                    <div className="overflow-auto rounded border border-gray-100 dark:border-gray-800">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-50 text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                          <tr>
                            <th className="w-44 px-3 py-2 font-medium">登记字段</th>
                            <th className="px-3 py-2 font-medium">提取内容</th>
                            <th className="w-72 px-3 py-2 font-medium">证据/说明</th>
                          </tr>
                        </thead>
                        <tbody>
                          {materials.basicInfo.rows.map((row) => (
                            <tr key={row.label} className="border-t border-gray-100 dark:border-gray-800">
                              <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">{row.label}</td>
                              <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{row.value || '待填写'}</td>
                              <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.evidence}{row.needsReview ? '；需人工确认' : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                  <Panel>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold">可修改字段</div>
                      <button
                        type="button"
                        onClick={generateApplicationFieldsWithAi}
                        disabled={!analysis || !textModelRuntime.runtime?.modelReady || textModelRuntime.modelStatus === 'loading' || textModelRuntime.modelStatus === 'generating'}
                        className="inline-flex h-7 items-center gap-1 rounded bg-teal-600 px-2 text-[11px] text-white hover:bg-teal-700 disabled:opacity-50"
                      >
                        {textModelRuntime.modelStatus === 'loading' || textModelRuntime.modelStatus === 'generating' ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RefreshCw size={12} />
                        )}
                        AI分析字段
                      </button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="软件全称" value={info.softwareName} onChange={(value) => patchInfo({ softwareName: value })} placeholder="请输入软件全称" />
                      <Field label="软件简称" value={info.shortName} onChange={(value) => patchInfo({ shortName: value })} placeholder="无简称留空" />
                      <Field label="版本号" value={info.version} onChange={(value) => patchInfo({ version: value ? normalizeVersion(value) : '' })} placeholder="请输入版本号" />
                      <Field label="著作权人" value={info.copyrightOwner} onChange={(value) => patchInfo({ copyrightOwner: value })} placeholder="必须与申请主体证件一致" />
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">著作权人类型</span>
                        <select
                          value={info.ownerType}
                          onChange={(event) => patchInfo({ ownerType: event.target.value as OwnerType })}
                          className="h-9 w-full rounded border border-gray-200 bg-white px-3 text-sm outline-none focus:border-teal-400 dark:border-gray-700 dark:bg-gray-950"
                        >
                          <option value="enterprise">企业</option>
                          <option value="individual">个人</option>
                          <option value="other">其他组织</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">发表状态</span>
                        <select
                          value={info.publishStatus}
                          onChange={(event) => patchInfo({ publishStatus: event.target.value as PublishStatus })}
                          className="h-9 w-full rounded border border-gray-200 bg-white px-3 text-sm outline-none focus:border-teal-400 dark:border-gray-700 dark:bg-gray-950"
                        >
                          <option value="unpublished">未发表</option>
                          <option value="published">已发表</option>
                        </select>
                      </label>
                      {info.publishStatus === 'published' && (
                        <Field label="首次发表日期" value={info.publishDate} onChange={(value) => patchInfo({ publishDate: value })} placeholder="YYYY-MM-DD" />
                      )}
                      <Field label="软件分类" value={info.softwareCategory} onChange={(value) => patchInfo({ softwareCategory: value.slice(0, 20) })} placeholder="应用软件/嵌入式软件/中间件/操作系统" />
                      <Field label="目标用户" value={info.targetUsers} onChange={(value) => patchInfo({ targetUsers: value.slice(0, 50) })} placeholder="请输入实际使用人员" />
                      <Field label="开发完成日期" value={info.completionDate} onChange={(value) => patchInfo({ completionDate: value })} />
                      <Field label="开发的硬件环境" value={info.devHardware} onChange={(value) => patchInfo({ devHardware: value.slice(0, 50) })} placeholder="请输入..." />
                      <Field label="运行的硬件环境" value={info.runHardware} onChange={(value) => patchInfo({ runHardware: value.slice(0, 50) })} placeholder="请输入..." />
                      <Field label="开发该软件的操作系统" value={info.devOs} onChange={(value) => patchInfo({ devOs: value.slice(0, 50) })} placeholder="请输入..." />
                      <Field label="软件开发环境 / 开发工具" value={info.devTools} onChange={(value) => patchInfo({ devTools: value.slice(0, 50) })} placeholder="请输入..." />
                      <Field label="运行平台 / 操作系统" value={info.runOs} onChange={(value) => patchInfo({ runOs: value.slice(0, 50) })} placeholder="请输入..." />
                      <Field label="运行支撑环境 / 支持软件" value={info.supportSoftware} onChange={(value) => patchInfo({ supportSoftware: value.slice(0, 50) })} placeholder="请输入..." />
                      <Field label="开发目的" value={info.purpose} onChange={(value) => patchInfo({ purpose: value.slice(0, 50) })} placeholder="请输入..." />
                      <Field label="面向领域 / 行业" value={info.industry} onChange={(value) => patchInfo({ industry: value.slice(0, 50) })} placeholder="请输入..." />
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                            软件的主要功能（{meaningfulCharCount(info.mainFunctions)}/{MIN_MAIN_FUNCTION_CHARS}-{MAX_MAIN_FUNCTION_CHARS}字）
                          </span>
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={generateMainFunctionsWithAi}
                              disabled={!analysis || !textModelRuntime.runtime?.modelReady || textModelRuntime.modelStatus === 'loading' || textModelRuntime.modelStatus === 'generating'}
                              className="inline-flex h-6 items-center gap-1 rounded bg-teal-600 px-2 text-[11px] text-white hover:bg-teal-700 disabled:opacity-50"
                            >
                              {textModelRuntime.modelStatus === 'loading' || textModelRuntime.modelStatus === 'generating' ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <RefreshCw size={11} />
                              )}
                              AI整理
                            </button>
                            <button
                              type="button"
                              onClick={() => patchInfo({ mainFunctions: buildDetailedMainFunctions({ ...info, mainFunctions: '' }, analysis) })}
                              disabled={!analysis}
                              className="inline-flex h-6 items-center gap-1 rounded border border-gray-200 px-2 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                            >
                              <RefreshCw size={11} />
                              本地规则整理
                            </button>
                          </div>
                        </div>
                        <textarea
                          value={info.mainFunctions}
                          onChange={(event) => patchInfo({ mainFunctions: event.target.value.slice(0, MAX_MAIN_FUNCTION_CHARS) })}
                          placeholder="请填写或使用扫描后的本地规则整理结果"
                          className="h-24 w-full resize-none rounded border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 dark:border-gray-700 dark:bg-gray-950"
                        />
                        <div className="mt-2">
                          <SoftwareCopyrightTextModelPanel
                            runtime={textModelRuntime.runtime}
                            status={textModelRuntime.modelStatus}
                            progress={textModelRuntime.downloadProgress}
                            file={textModelRuntime.downloadFile}
                            error={textModelRuntime.modelError}
                            onDownload={textModelRuntime.downloadModels}
                            onRetry={textModelRuntime.refreshRuntime}
                            onManual={() => textModelRuntime.setShowManualGuide(true)}
                          />
                        </div>
                      </label>
                      <label className="block">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">软件的技术特点（{info.technicalFeatures.length}/100字）</span>
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={generateTechnicalFeaturesWithAi}
                              disabled={!analysis || !textModelRuntime.runtime?.modelReady || textModelRuntime.modelStatus === 'loading' || textModelRuntime.modelStatus === 'generating'}
                              className="inline-flex h-6 items-center gap-1 rounded bg-teal-600 px-2 text-[11px] text-white hover:bg-teal-700 disabled:opacity-50"
                            >
                              {textModelRuntime.modelStatus === 'loading' || textModelRuntime.modelStatus === 'generating' ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <RefreshCw size={11} />
                              )}
                              AI整理
                            </button>
                            <button
                              type="button"
                              onClick={() => patchInfo({ technicalFeatures: summarizeTechnicalFeatures({ ...info, technicalFeatures: '' }, analysis) })}
                              disabled={!analysis}
                              className="inline-flex h-6 items-center gap-1 rounded border border-gray-200 px-2 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                            >
                              <RefreshCw size={11} />
                              本地规则整理
                            </button>
                          </div>
                        </div>
                        <textarea
                          value={info.technicalFeatures}
                          onChange={(event) => patchInfo({ technicalFeatures: event.target.value.slice(0, 100) })}
                          placeholder="请填写或使用扫描后的本地规则整理结果"
                          className="h-24 w-full resize-none rounded border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 dark:border-gray-700 dark:bg-gray-950"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => confirmStage('applicationFields')}
                        disabled={!confirmations.business || validations.some((item) => ['软件全称', '版本号', '著作权人', '开发完成日期', '发表信息', '开发硬件环境', '运行硬件环境', '开发操作系统', '开发工具', '运行平台', '运行支撑环境', '主要功能字数'].includes(item.label) && !item.ok) || confirmations.applicationFields}
                        className="inline-flex h-8 items-center gap-1 rounded bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                      >
                        <CheckCircle2 size={13} />
                        {confirmations.applicationFields ? '申请表字段已确认' : '确认申请表字段'}
                      </button>
                    </div>
                  </Panel>
                </div>
              )}
            </div>
          )}

          {tab === 'business' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => exportSingle('项目分析报告', materials.projectReportMarkdown, 'md')}
                  className="inline-flex h-8 items-center gap-1 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  <Save size={13} />
                  保存项目分析报告
                </button>
                <button
                  type="button"
                  onClick={() => confirmStage('business')}
                  disabled={!analysis || confirmations.business}
                  className="inline-flex h-8 items-center gap-1 rounded bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  <CheckCircle2 size={13} />
                  {confirmations.business ? '业务理解已确认' : '确认业务理解'}
                </button>
              </div>
              <Panel>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">业务理解草稿</div>
                  <button
                    type="button"
                    onClick={() => {
                      setBusinessDraft('');
                      setConfirmations((current) => ({
                        ...current,
                        business: false,
                        applicationFields: false,
                        codeSelection: false,
                        markdown: false,
                      }));
                    }}
                    className="inline-flex h-7 items-center gap-1 rounded border border-gray-200 px-2 text-xs dark:border-gray-700"
                  >
                    <RefreshCw size={12} />
                    按项目证据重建
                  </button>
                </div>
                <textarea
                  value={materials.businessUnderstandingMarkdown}
                  onChange={(event) => {
                    setBusinessDraft(event.target.value);
                    setConfirmations((current) => ({
                      ...current,
                      business: false,
                      applicationFields: false,
                      codeSelection: false,
                      markdown: false,
                    }));
                  }}
                  className="h-[52vh] w-full resize-y rounded border border-gray-200 bg-white p-3 text-xs leading-6 outline-none focus:border-teal-400 dark:border-gray-700 dark:bg-gray-950"
                />
              </Panel>
              <div className="grid gap-3 xl:grid-cols-3">
                {[
                  ['软件简介', materials.softwareIntroMarkdown],
                  ['主要功能', materials.mainFunctionsMarkdown],
                  ['技术特点', materials.technicalFeaturesMarkdown],
                ].map(([title, content]) => (
                  <Panel key={title}>
                    <div className="mb-2 text-sm font-semibold">{title}</div>
                    <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap text-xs leading-6 text-gray-600 dark:text-gray-300">
                      {content}
                    </pre>
                  </Panel>
                ))}
              </div>
              <Panel>
                <div className="mb-2 text-sm font-semibold">项目分析报告</div>
                <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap text-xs leading-6 text-gray-600 dark:text-gray-300">
                  {materials.projectReportMarkdown}
                </pre>
              </Panel>
            </div>
          )}

          {tab === 'project' && (
            <div className="space-y-4">
              {!analysis ? (
                <EmptyState icon={<FolderOpen size={36} />} text="选择项目目录后显示扫描结果" />
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-4">
                    {[
                      ['项目名称', analysis.name],
                      ['项目类型', analysis.projectType],
                      ['架构判断', analysis.architecture],
                      ['源码文件', String(analysis.sourceFiles.length)],
                      ['配置证据', String(analysis.configFiles.length)],
                    ].map(([label, value]) => (
                      <Panel key={label}>
                        <div className="text-xs text-gray-500">{label}</div>
                        <div className="mt-1 truncate text-sm font-semibold">{value}</div>
                      </Panel>
                    ))}
                  </div>
                  <Panel>
                    <div className="mb-2 text-sm font-semibold">语言统计</div>
                    <div className="space-y-2">
                      {analysis.languages.map((item) => (
                        <div key={item.language} className="grid grid-cols-[120px_1fr_80px] items-center gap-2 text-xs">
                          <span>{item.language}</span>
                          <div className="h-2 rounded bg-gray-100 dark:bg-gray-800">
                            <div
                              className="h-2 rounded bg-teal-500"
                              style={{
                                width: `${Math.max(4, (item.lines / Math.max(1, analysis.languages[0].lines)) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className="text-right text-gray-500">{item.lines} 行</span>
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel>
                    <div className="mb-2 text-sm font-semibold">技术栈证据</div>
                    <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
                      {[
                        ['框架', analysis.techStack.frameworks],
                        ['数据库', analysis.techStack.databases],
                        ['中间件', analysis.techStack.middleware],
                        ['运行环境', analysis.techStack.runtimes],
                        ['构建工具', analysis.techStack.buildTools],
                      ].map(([label, items]) => (
                        <div key={label as string}>
                          <span className="font-medium text-gray-800 dark:text-gray-100">{label as string}：</span>
                          {(items as DetectionItem[]).length
                            ? (items as DetectionItem[]).map((item) => `${item.name}（${item.evidence[0]}）`).join('；')
                            : '-'}
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel>
                    <div className="mb-2 text-sm font-semibold">功能线索</div>
                    <div className="flex flex-wrap gap-2">
                      {analysis.functionHints.map((hint) => (
                        <span key={hint} className="rounded bg-teal-50 px-2 py-1 text-xs text-teal-700 dark:bg-teal-900/30 dark:text-teal-100">
                          {hint}
                        </span>
                      ))}
                      {analysis.functionHints.length === 0 && <span className="text-xs text-gray-400">未识别到明显功能线索</span>}
                    </div>
                  </Panel>
                </>
              )}
            </div>
          )}

          {tab === 'code' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">源码文档范围</div>
                  <div className="text-xs text-gray-500">默认使用推荐源码范围直接生成文档；调整勾选后导出会按当前范围重新生成。</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => replaceCodeSelections(recommendedCodeSelections(analysis?.sourceFiles || []))}
                    className="inline-flex h-8 items-center gap-1 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    <RefreshCw size={13} />
                    恢复推荐
                  </button>
                  <button
                    onClick={() =>
                      replaceCodeSelections(
                        Object.fromEntries((analysis?.sourceFiles || []).map((file) => [file.path, { startLine: 1, endLine: file.lines }]))
                      )
                    }
                    className="inline-flex h-8 items-center gap-1 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    全选源码
                  </button>
                  <button
                    onClick={loadSelectionFromDraft}
                    className="inline-flex h-8 items-center gap-1 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    读取选择JSON
                  </button>
                </div>
              </div>
              {!analysis ? (
                <EmptyState icon={<FileCode2 size={36} />} text="先扫描项目，再选择源码文件" />
              ) : (
                <>
                  <div className="flex items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
                    <Search size={14} className="text-gray-400" />
                    <input
                      value={codeFilter}
                      onChange={(event) => setCodeFilter(event.target.value)}
                      placeholder="筛选源码文件"
                      className="flex-1 bg-transparent text-sm outline-none"
                    />
                  </div>
                  <Panel className="text-xs">
                    <div className="grid gap-2 md:grid-cols-4">
                      <div>已选文件：{materials.code.selectedFiles.length}</div>
                      <div>估算页数：{materials.code.totalSourcePages}</div>
                      <div>候选页数：{materials.code.projectCandidatePages}</div>
                      <div>提交口径：{materials.code.mode === 'front-back' ? '前后各30页' : materials.code.mode === 'all' ? '全部' : '未生成'}</div>
                    </div>
                    {materials.code.supplementNeeded && (
                      <div className="mt-2 flex items-center gap-2 text-amber-600">
                        <AlertTriangle size={14} />
                        当前已选源码不足 60 页，但项目候选源码可达到 60 页，建议继续勾选相关源码。
                      </div>
                    )}
                  </Panel>
                  <div className="max-h-[52vh] overflow-auto rounded border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    {filteredSourceFiles.map((file) => {
                      const range = normalizeCodeRange(file, codeSelections[file.path]);
                      return (
                      <div
                        key={file.path}
                        className="flex items-center gap-3 border-b border-gray-100 px-3 py-2 text-xs last:border-b-0 dark:border-gray-800"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(codeSelections[file.path])}
                          onChange={(event) => {
                            const next = { ...codeSelections };
                            if (event.target.checked) next[file.path] = { startLine: 1, endLine: file.lines };
                            else delete next[file.path];
                            replaceCodeSelections(next);
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate" title={file.relativePath}>
                          {file.relativePath}
                        </span>
                        <span className="w-28 text-gray-500">{file.language}</span>
                        {codeSelections[file.path] ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={1}
                              max={file.lines}
                              value={range.startLine}
                              onChange={(event) =>
                                replaceCodeSelections({
                                  ...codeSelections,
                                  [file.path]: normalizeCodeRange(file, { startLine: Number(event.target.value), endLine: range.endLine }),
                                })
                              }
                              className="h-7 w-16 rounded border border-gray-200 bg-white px-1 text-right dark:border-gray-700 dark:bg-gray-950"
                              aria-label={`${file.relativePath} 起始行`}
                            />
                            <span className="text-gray-400">-</span>
                            <input
                              type="number"
                              min={range.startLine}
                              max={file.lines}
                              value={range.endLine}
                              onChange={(event) =>
                                replaceCodeSelections({
                                  ...codeSelections,
                                  [file.path]: normalizeCodeRange(file, { startLine: range.startLine, endLine: Number(event.target.value) }),
                                })
                              }
                              className="h-7 w-16 rounded border border-gray-200 bg-white px-1 text-right dark:border-gray-700 dark:bg-gray-950"
                              aria-label={`${file.relativePath} 结束行`}
                            />
                          </div>
                        ) : (
                          <span className="w-36 text-right text-gray-400">共 {file.lines} 行</span>
                        )}
                      </div>
                    );})}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => confirmStage('codeSelection')}
                      disabled={!confirmations.applicationFields || materials.code.mode === 'empty' || materials.code.supplementNeeded || confirmations.codeSelection}
                      className="inline-flex h-8 items-center gap-1 rounded bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      <CheckCircle2 size={13} />
                      {confirmations.codeSelection ? '代码选择已确认' : '确认文件和行段'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'check' && (
            <div className="space-y-4">
              <Panel className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">草稿确认与正式导出门禁</div>
                  <div className="text-xs text-gray-500">业务、申请字段、代码行段、截图方式和全部 Markdown 均确认后才能生成正式资料。</div>
                </div>
              </Panel>
              <Panel>
                <div className="mb-3 text-sm font-semibold">操作手册截图方式</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {[
                    ['chrome-devtools', 'Chrome DevTools MCP'],
                    ['computer-use', 'Codex Computer Use'],
                    ['user-supplied', '用户自行截图'],
                    ['skip', '暂不截图，保留可见占位'],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 rounded border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                      <input
                        type="radio"
                        name="copyright-screenshot-method"
                        value={value}
                        checked={confirmations.screenshotMethod === value}
                        disabled={!confirmations.codeSelection}
                        onChange={() => void selectScreenshotMethod(value as ScreenshotMethod)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Panel>
              <Panel>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">操作手册草稿</div>
                  <button
                    type="button"
                    onClick={() => {
                      setManualDraft('');
                      setConfirmations((current) => ({ ...current, markdown: false }));
                    }}
                    className="inline-flex h-7 items-center gap-1 rounded border border-gray-200 px-2 text-xs dark:border-gray-700"
                  >
                    <RefreshCw size={12} />
                    按项目证据重建
                  </button>
                </div>
                <textarea
                  value={materials.operationManualMarkdown}
                  onChange={(event) => {
                    setManualDraft(event.target.value);
                    setConfirmations((current) => ({ ...current, markdown: false }));
                  }}
                  className="h-[38vh] w-full resize-y rounded border border-gray-200 bg-white p-3 text-xs leading-6 outline-none focus:border-teal-400 dark:border-gray-700 dark:bg-gray-950"
                />
              </Panel>
              <div className="grid gap-3 md:grid-cols-2">
                {validations.map((item) => (
                  <Panel key={item.label} className="flex items-center gap-2 text-sm">
                    {item.ok ? <CheckCircle2 size={16} className="text-emerald-500" /> : <AlertTriangle size={16} className="text-amber-500" />}
                    <span className="flex-1">{item.label}</span>
                    <span className="text-xs text-gray-500">{item.detail || (item.ok ? '通过' : '待补充')}</span>
                  </Panel>
                ))}
              </div>
              <pre className="max-h-[48vh] overflow-auto rounded border border-gray-200 bg-white p-4 text-xs leading-6 dark:border-gray-800 dark:bg-gray-900">
                {materials.checklistMarkdown}
              </pre>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => confirmStage('markdown')}
                  disabled={!confirmations.business || !confirmations.applicationFields || !confirmations.codeSelection || !confirmations.screenshotMethod || Boolean(failedValidation) || confirmations.markdown}
                  className="inline-flex h-8 items-center gap-1 rounded bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  <CheckCircle2 size={13} />
                  {confirmations.markdown ? '全部草稿已确认' : '确认全部 Markdown 草稿'}
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-auto border-l border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">材料预览</div>
            <div className="flex gap-1">
              <button
                onClick={() => exportSingle('申请表信息', materials.basicInfo.markdown, 'md')}
                className="inline-flex h-7 items-center gap-1 rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <Save size={12} />
                Markdown
              </button>
              <button
                onClick={exportApplicationInfoPdf}
                className="inline-flex h-7 items-center gap-1 rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <Save size={12} />
                PDF
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {!canExportFinal && (
              <Panel>
                <div className="text-xs text-gray-500">导出状态</div>
                <div className="mt-1 text-sm">{exportReason}</div>
              </Panel>
            )}
            <Panel>
              <div className="mb-2 text-xs font-semibold text-gray-500">基础信息</div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-gray-600 dark:text-gray-300">
                {materials.basicInfo.markdown}
              </pre>
            </Panel>
            <Panel>
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-gray-500">
                <span>源程序材料</span>
                <span>{materials.code.submittedPages} 页</span>
              </div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-4 text-gray-600 dark:text-gray-300">
                {(materials.code.mode === 'front-back' ? materials.code.frontBackText : materials.code.allText).slice(0, 9000)}
              </pre>
            </Panel>
          </div>
        </aside>
      </main>
      </div>
      {textModelRuntime.showManualGuide && textModelRuntime.runtime && (
        <SoftwareCopyrightTextModelGuide
          runtime={textModelRuntime.runtime}
          guideText={textModelRuntime.manualGuideText}
          copyHint={textModelRuntime.copyHint}
          onClose={() => textModelRuntime.setShowManualGuide(false)}
          onCopy={textModelRuntime.copyManualGuide}
          onOpenDir={textModelRuntime.openModelDir}
        />
      )}
    </>
  );
}
