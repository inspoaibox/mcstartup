import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertCircle,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Check,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  FileJson,
  FileText,
  GraduationCap,
  LayoutTemplate,
  Loader,
  Palette,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  Trophy,
  Upload,
  X,
  Sparkles,
  User,
  Wrench,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { useToolDataStore } from '../stores/toolDataStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { AppSettings } from '../types';

type TemplateId = 'classic' | 'ats' | 'compact' | 'modern';
type EditorSection = 'basics' | 'work' | 'projects' | 'education' | 'skills' | 'awards' | 'custom' | 'layout' | 'ai';
type ResumeModuleId = 'summary' | 'work' | 'projects' | 'education' | 'skills' | 'awards' | 'custom';
type DensityId = 'comfortable' | 'balanced' | 'compact';
type EditableListKey = 'work' | 'projects' | 'education' | 'skills' | 'awards' | 'customSections';
type AIProvider = NonNullable<AppSettings['aiProviders']>[number];

interface ResumeBasics {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  expectedSalary: string;
  avatar: string;
  summary: string;
}

interface ResumeWork {
  id: string;
  company: string;
  position: string;
  location: string;
  startDate: string;
  endDate: string;
  highlights: string[];
}

interface ResumeProject {
  id: string;
  name: string;
  role: string;
  url: string;
  startDate: string;
  endDate: string;
  description: string;
  highlights: string[];
}

interface ResumeEducation {
  id: string;
  school: string;
  degree: string;
  major: string;
  startDate: string;
  endDate: string;
  description: string;
}

interface ResumeSkill {
  id: string;
  name: string;
  level: string;
  keywords: string[];
}

interface ResumeAward {
  id: string;
  title: string;
  date: string;
  issuer: string;
}

interface ResumeCustomSection {
  id: string;
  title: string;
  content: string[];
}

interface ResumeData {
  basics: ResumeBasics;
  work: ResumeWork[];
  projects: ResumeProject[];
  education: ResumeEducation[];
  skills: ResumeSkill[];
  awards: ResumeAward[];
  customSections: ResumeCustomSection[];
}

interface ResumeSettings {
  template: TemplateId;
  accent: string;
  density: DensityId;
  hiddenModules: Record<ResumeModuleId, boolean>;
  moduleOrder: ResumeModuleId[];
}

interface ResumeDraftState {
  resume: ResumeData;
  settings: ResumeSettings;
}

interface ResumeDocument {
  id: string;
  name: string;
  data: ResumeData;
  settings: ResumeSettings;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'mc-resume-generator-draft';
const DRAFT_VERSION = 'mcheng-resume-v3';

const TEMPLATES: Array<{ id: TemplateId; name: string; description: string }> = [
  { id: 'classic', name: '双栏经典', description: '适合技术岗、产品岗，信息密度高' },
  { id: 'ats', name: 'ATS 单栏', description: '结构清晰，适合投递系统解析' },
  { id: 'compact', name: '紧凑商务', description: '一页优先，适合经历较多的候选人' },
  { id: 'modern', name: '现代重点', description: '突出头部信息和核心项目成果' },
];

const ACCENT_COLORS = ['#2563eb', '#0f766e', '#7c3aed', '#be123c', '#111827'];
const MODULE_ORDER: ResumeModuleId[] = ['summary', 'work', 'projects', 'education', 'skills', 'awards', 'custom'];
const MODULE_META: Array<{ id: ResumeModuleId; label: string; description: string }> = [
  { id: 'summary', label: '个人简介', description: '求职方向、核心优势和职业概览' },
  { id: 'work', label: '工作经历', description: '公司、岗位、时间和关键成果' },
  { id: 'projects', label: '项目经历', description: '项目背景、角色、链接和量化亮点' },
  { id: 'education', label: '教育经历', description: '学校、学历、专业和补充说明' },
  { id: 'skills', label: '技能清单', description: '技能名称、熟练程度和关键词' },
  { id: 'awards', label: '荣誉奖项', description: '奖项、证书、颁发方和时间' },
  { id: 'custom', label: '自定义模块', description: '论文、开源、语言能力等补充内容' },
];

const DENSITIES: Array<{ id: DensityId; label: string }> = [
  { id: 'comfortable', label: '舒展' },
  { id: 'balanced', label: '标准' },
  { id: 'compact', label: '紧凑' },
];

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createSampleResume(): ResumeData {
  return {
    basics: {
      name: '林知夏',
      title: '产品运营经理',
      email: 'lin.zhixia@example.com',
      phone: '16600008888',
      location: '苏州',
      website: 'portfolio.example.com/linzhixia',
      expectedSalary: '18k-24k',
      avatar: '',
      summary:
        '6 年互联网产品运营经验，长期负责 B 端 SaaS 产品增长、用户分层运营和商业化转化。擅长把业务目标拆解为可执行的运营策略，通过数据分析、内容体系和跨团队协作提升留存与付费转化。',
    },
    work: [
      {
        id: createId('work'),
        company: '云舟协作科技',
        position: '产品运营经理',
        location: '上海',
        startDate: '2022-05',
        endDate: '至今',
        highlights: [
          '负责企业协同产品的用户增长与留存运营，搭建新客激活、功能教育和续费提醒链路',
          '基于用户行为数据重构分层触达策略，核心功能 30 日使用率提升 34%',
          '联合销售、产品和客户成功团队推进试用转付费项目，季度付费转化率提升 18%',
        ],
      },
      {
        id: createId('work'),
        company: '青橙数据服务',
        position: '增长运营专员',
        location: '南京',
        startDate: '2019-07',
        endDate: '2022-04',
        highlights: [
          '负责官网、内容渠道和活动落地页的线索增长，建立从访问到留资的转化监控看板',
          '策划 20+ 场线上行业直播与白皮书专题，累计获取有效线索 1.6 万条',
          '沉淀内容选题库和活动复盘模板，使单场活动筹备周期从 10 天缩短至 6 天',
        ],
      },
    ],
    projects: [
      {
        id: createId('project'),
        name: 'SaaS 新客激活增长专项',
        role: '项目负责人',
        url: '',
        startDate: '2023-02',
        endDate: '2023-11',
        description: '围绕企业试用用户的首周激活路径，优化 onboarding、消息触达和关键功能引导。',
        highlights: [
          '通过漏斗分析定位 3 个主要流失节点，推动产品侧补齐模板推荐和任务清单引导',
          '设计邮件、站内信和企微触达组合策略，首周关键行为完成率提升 41%',
          '建立 A/B 测试流程和复盘机制，沉淀可复用的激活实验 12 个',
        ],
      },
      {
        id: createId('project'),
        name: '行业内容线索转化体系',
        role: '运营策划',
        url: '',
        startDate: '2021-03',
        endDate: '2022-01',
        description: '面向制造、教育和咨询行业搭建内容矩阵，用案例、指南和直播承接销售线索。',
        highlights: [
          '搭建行业专题页和资料下载流程，资料下载到商机转化率稳定在 12% 以上',
          '协调客户成功团队输出 8 篇案例访谈，提升高意向客户咨询量',
          '构建内容 ROI 追踪表，帮助团队按行业、渠道和主题评估投放优先级',
        ],
      },
    ],
    education: [
      {
        id: createId('edu'),
        school: '江南财经大学',
        degree: '本科',
        major: '市场营销',
        startDate: '2015-09',
        endDate: '2019-06',
        description: '主修消费者行为、品牌管理、数据分析与数字营销',
      },
    ],
    skills: [
      { id: createId('skill'), name: '用户增长策略', level: '熟练', keywords: ['激活', '留存', '转化'] },
      { id: createId('skill'), name: '数据分析', level: '熟练', keywords: ['SQL', '漏斗分析', 'A/B 测试'] },
      { id: createId('skill'), name: '内容运营', level: '精通', keywords: ['选题规划', '白皮书', '案例访谈'] },
      { id: createId('skill'), name: '活动运营', level: '熟练', keywords: ['直播', '社群', '复盘'] },
      { id: createId('skill'), name: 'CRM 与营销自动化', level: '熟练', keywords: ['线索评分', '触达策略'] },
      { id: createId('skill'), name: '跨团队协作', level: '熟练', keywords: ['销售协同', '产品反馈', '项目推进'] },
    ],
    awards: [
      { id: createId('award'), title: '年度增长项目奖', date: '2024.01', issuer: '云舟协作科技' },
      { id: createId('award'), title: '优秀运营复盘案例', date: '2021.12', issuer: '青橙数据服务' },
    ],
    customSections: [
      {
        id: createId('custom'),
        title: '补充信息',
        content: [
          '熟悉 B 端产品从试用、激活、续费到增购的完整运营链路',
          '可独立完成用户研究、数据分析、方案设计、落地执行和复盘沉淀',
        ],
      },
    ],
  };
}

function createEmptyResume(): ResumeData {
  return {
    basics: {
      name: '',
      title: '',
      email: '',
      phone: '',
      location: '',
      website: '',
      expectedSalary: '',
      avatar: '',
      summary: '',
    },
    work: [],
    projects: [],
    education: [],
    skills: [],
    awards: [],
    customSections: [],
  };
}

function createDefaultSettings(): ResumeSettings {
  return {
    template: 'classic',
    accent: ACCENT_COLORS[0],
    density: 'balanced',
    hiddenModules: MODULE_ORDER.reduce(
      (acc, moduleId) => ({ ...acc, [moduleId]: false }),
      {} as Record<ResumeModuleId, boolean>
    ),
    moduleOrder: [...MODULE_ORDER],
  };
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function joinLines(lines: string[]) {
  return lines.join('\n');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtmlToLines(html?: string): string[] {
  if (!html) return [];
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const listItems = Array.from(doc.querySelectorAll('li'))
      .map((item) => item.textContent?.trim() || '')
      .filter(Boolean);
    if (listItems.length > 0) return listItems;
    const text = doc.body.textContent?.trim() || '';
    return splitLines(text);
  } catch {
    return splitLines(html.replace(/<li[^>]*>/gi, '\n').replace(/<[^>]+>/g, ''));
  }
}

function normalizeModuleOrder(value?: unknown): ResumeModuleId[] {
  const incoming = Array.isArray(value) ? value : [];
  const valid = incoming.filter((item): item is ResumeModuleId => MODULE_ORDER.includes(item as ResumeModuleId));
  return [...valid, ...MODULE_ORDER.filter((item) => !valid.includes(item))];
}

function normalizeSettings(value?: Partial<ResumeSettings> & Record<string, any>): ResumeSettings {
  const defaults = createDefaultSettings();
  const template =
    value?.template && TEMPLATES.some((item) => item.id === value.template) ? value.template : defaults.template;
  const density =
    value?.density && DENSITIES.some((item) => item.id === value.density) ? value.density : defaults.density;
  const accent = typeof value?.accent === 'string' && value.accent ? value.accent : defaults.accent;
  const hiddenModules = MODULE_ORDER.reduce(
    (acc, moduleId) => ({
      ...acc,
      [moduleId]: Boolean(value?.hiddenModules?.[moduleId]),
    }),
    {} as Record<ResumeModuleId, boolean>
  );

  return {
    template,
    accent,
    density,
    hiddenModules,
    moduleOrder: normalizeModuleOrder(value?.moduleOrder),
  };
}

function normalizeBasics(basics: Record<string, any>): ResumeBasics {
  return {
    ...createEmptyResume().basics,
    name: basics.name || '',
    title: basics.title || basics.label || '',
    email: basics.email || '',
    phone: basics.phone || '',
    location: basics.location?.city || basics.location || '',
    website: basics.website || basics.url || '',
    expectedSalary: basics.expectedSalary || basics.salary || '',
    avatar: basics.avatar || basics.image || basics.picture || '',
    summary: basics.summary || '',
  };
}

function normalizeImportedResume(raw: unknown): ResumeData {
  const candidate = raw as Partial<ResumeData> & Record<string, any>;
  if (candidate?.basics && Array.isArray(candidate.work) && Array.isArray(candidate.projects)) {
    return {
      basics: normalizeBasics(candidate.basics as Record<string, any>),
      work: (candidate.work || []).map(normalizeWork),
      projects: (candidate.projects || []).map(normalizeProject),
      education: (candidate.education || []).map(normalizeEducation),
      skills: (candidate.skills || []).map(normalizeSkill),
      awards: (candidate.awards || []).map(normalizeAward),
      customSections: (candidate.customSections || []).map(normalizeCustomSection),
    };
  }

  const data = (candidate?.data || candidate) as Record<string, any>;
  const empty = createEmptyResume();
  const basics = data.basics || {};

  return {
    basics: {
      ...normalizeBasics(basics),
      summary: stripHtmlToLines(data['x-op-aboutmeHtml']).join('\n') || basics.summary || '',
    },
    work: (data.work || empty.work).map((item: Record<string, any>) =>
      normalizeWork({
        company: item.name,
        position: item.position,
        location: item.location || '',
        startDate: item.startDate,
        endDate: item.endDate || '至今',
        highlights: item.highlights?.length
          ? item.highlights
          : stripHtmlToLines(item['x-op-workDescHtml'] || item.summary),
      })
    ),
    projects: (data.projects || empty.projects).map((item: Record<string, any>) =>
      normalizeProject({
        name: item.name,
        role: Array.isArray(item.roles) ? item.roles.join(' / ') : item.role,
        url: item.url,
        startDate: item.startDate,
        endDate: item.endDate,
        description: item.description,
        highlights: item.highlights?.length
          ? item.highlights
          : stripHtmlToLines(item['x-op-projectContentHtml']),
      })
    ),
    education: (data.education || empty.education).map((item: Record<string, any>) =>
      normalizeEducation({
        school: item.institution,
        degree: item.studyType,
        major: item.area,
        startDate: item.startDate,
        endDate: item.endDate,
        description: item.score || '',
      })
    ),
    skills: (data.skills || empty.skills).map((item: Record<string, any>) =>
      normalizeSkill({
        name: item.name,
        level: item.level,
        keywords: item.keywords || [],
      })
    ),
    awards: (data.awards || empty.awards).map((item: Record<string, any>) =>
      normalizeAward({
        title: item.title,
        date: item.date,
        issuer: item.awarder || item.issuer,
      })
    ),
    customSections: (data.customSections || data.publications || data.languages || [])
      .map((item: Record<string, any>) =>
        normalizeCustomSection({
          title: item.title || item.name || item.language || '自定义模块',
          content: item.content || item.highlights || item.keywords || [item.summary || item.fluency || item.publisher],
        })
      )
      .filter((item: ResumeCustomSection) => item.title || item.content.length),
  };
}

function normalizeWork(item: Partial<ResumeWork> & Record<string, any>): ResumeWork {
  return {
    id: item.id || createId('work'),
    company: item.company || item.name || '',
    position: item.position || '',
    location: item.location || '',
    startDate: item.startDate || '',
    endDate: item.endDate || '',
    highlights: Array.isArray(item.highlights) ? item.highlights : [],
  };
}

function normalizeProject(item: Partial<ResumeProject> & Record<string, any>): ResumeProject {
  return {
    id: item.id || createId('project'),
    name: item.name || '',
    role: item.role || (Array.isArray(item.roles) ? item.roles.join(' / ') : ''),
    url: item.url || '',
    startDate: item.startDate || '',
    endDate: item.endDate || '',
    description: item.description || '',
    highlights: Array.isArray(item.highlights) ? item.highlights : [],
  };
}

function normalizeEducation(item: Partial<ResumeEducation> & Record<string, any>): ResumeEducation {
  return {
    id: item.id || createId('edu'),
    school: item.school || item.institution || '',
    degree: item.degree || item.studyType || '',
    major: item.major || item.area || '',
    startDate: item.startDate || '',
    endDate: item.endDate || '',
    description: item.description || item.score || '',
  };
}

function normalizeSkill(item: Partial<ResumeSkill> & Record<string, any>): ResumeSkill {
  return {
    id: item.id || createId('skill'),
    name: item.name || '',
    level: item.level || '',
    keywords: Array.isArray(item.keywords) ? item.keywords : splitLines(String(item.keywords || '').replace(/[,，、]/g, '\n')),
  };
}

function normalizeAward(item: Partial<ResumeAward> & Record<string, any>): ResumeAward {
  return {
    id: item.id || createId('award'),
    title: item.title || '',
    date: item.date || '',
    issuer: item.issuer || item.awarder || '',
  };
}

function normalizeCustomSection(item: Partial<ResumeCustomSection> & Record<string, any>): ResumeCustomSection {
  return {
    id: item.id || createId('custom'),
    title: item.title || item.name || '自定义模块',
    content: Array.isArray(item.content) ? item.content.filter(Boolean) : splitLines(String(item.content || item.summary || '')),
  };
}

function isLegacyBuiltInSample(resume: ResumeData) {
  const text = JSON.stringify(resume);
  return (
    resume.basics.name === '张三' ||
    resume.basics.email === 'zhangsan@example.com' ||
    /字节跳动|蚂蚁集团|飞书文档协同编辑器|低代码搭建平台|清华大学|北京大学|opresume|oopooa/i.test(text)
  );
}

function replaceLegacyBuiltInSample(resume: ResumeData) {
  return isLegacyBuiltInSample(resume) ? createSampleResume() : resume;
}

function loadStoredDraft(): ResumeDraftState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return { resume: createSampleResume(), settings: createDefaultSettings() };
    }
    const parsed = JSON.parse(saved);
    const resume = replaceLegacyBuiltInSample(normalizeImportedResume(parsed?.data || parsed));
    return {
      resume,
      settings: normalizeSettings(parsed?.settings),
    };
  } catch {
    return { resume: createSampleResume(), settings: createDefaultSettings() };
  }
}

function createResumeDocument(name = '默认简历', data = createSampleResume(), settings = createDefaultSettings()): ResumeDocument {
  const now = new Date().toISOString();
  return {
    id: createId('resume'),
    name,
    data,
    settings,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeResumeDocument(raw: unknown, fallbackName = '默认简历'): ResumeDocument {
  const candidate = raw as Partial<ResumeDocument> & Record<string, any>;
  const data = replaceLegacyBuiltInSample(normalizeImportedResume(candidate?.data || candidate?.resume || candidate));
  const settings = normalizeSettings(candidate?.settings);
  return {
    id: candidate?.id || createId('resume'),
    name: candidate?.name || data.basics.name || fallbackName,
    data,
    settings,
    createdAt: candidate?.createdAt || new Date().toISOString(),
    updatedAt: candidate?.updatedAt || new Date().toISOString(),
  };
}

function normalizeStoredDocuments(raw: unknown): { documents: ResumeDocument[]; activeId: string } {
  const candidate = raw as Record<string, any>;
  if (Array.isArray(candidate?.documents)) {
    const documents = candidate.documents.map((item: unknown, index: number) =>
      normalizeResumeDocument(item, `简历 ${index + 1}`)
    );
    const activeId = documents.some((item) => item.id === candidate.activeId)
      ? candidate.activeId
      : documents[0]?.id || createResumeDocument().id;
    return documents.length
      ? { documents, activeId }
      : (() => {
          const fallback = createResumeDocument();
          return { documents: [fallback], activeId: fallback.id };
        })();
  }

  const legacyDraft = candidate?.data || candidate ? replaceLegacyBuiltInSample(normalizeImportedResume(raw)) : createSampleResume();
  const legacySettings = normalizeSettings(candidate?.settings);
  const fallback = createResumeDocument(legacyDraft.basics.name || '默认简历', legacyDraft, legacySettings);
  return { documents: [fallback], activeId: fallback.id };
}

function dateRange(start?: string, end?: string) {
  return [start, end].filter(Boolean).join(' - ');
}

function downloadText(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getDefaultAiBaseUrl(type: AIProvider['type']) {
  switch (type) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'sub2api':
    case 'azure':
    case 'custom':
      return '';
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'google':
      return 'https://generativelanguage.googleapis.com/v1beta';
    case 'vertex':
      return 'https://aiplatform.googleapis.com/v1';
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

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 未返回 JSON 结构');
  return raw.slice(start, end + 1);
}

function resumeHasAnyContent(resume: ResumeData) {
  return Boolean(
    Object.entries(resume.basics)
      .filter(([key]) => key !== 'avatar')
      .some(([, value]) => String(value || '').trim()) ||
      resume.work.length ||
      resume.projects.length ||
      resume.education.length ||
      resume.skills.length ||
      resume.awards.length ||
      resume.customSections.length
  );
}

async function callResumeAi(provider: AIProvider, model: string, prompt: string) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl || getDefaultAiBaseUrl(provider.type));
  if (!provider.apiKey) throw new Error('当前 AI 提供商未配置 API Key');
  if (!model) throw new Error('当前 AI 提供商未配置模型');

  const postJson = async (
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>
  ): Promise<any> => {
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
  };

  const commonOpenAiBody = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.35,
    max_tokens: 4096,
    stream: false,
  };

  if (provider.type === 'openai' || provider.type === 'custom' || provider.type === 'sub2api') {
    if (!baseUrl) throw new Error('当前 AI 提供商未配置 API Base URL');
    const data = await postJson(
      `${baseUrl}/chat/completions`,
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      commonOpenAiBody
    );
    return extractOpenAiMessageText(data?.choices?.[0]?.message?.content);
  }

  if (provider.type === 'azure') {
    if (!baseUrl) throw new Error('Azure OpenAI 未配置 Endpoint');
    const data = await postJson(
      `${baseUrl}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=2024-02-15-preview`,
      {
        'Content-Type': 'application/json',
        'api-key': provider.apiKey,
      },
      {
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.35,
        max_tokens: 4096,
        stream: false,
      }
    );
    return extractOpenAiMessageText(data?.choices?.[0]?.message?.content);
  }

  if (provider.type === 'google') {
    const data = await postJson(
      `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(provider.apiKey)}`,
      { 'Content-Type': 'application/json' },
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 4096 },
      }
    );
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (provider.type === 'anthropic') {
    const data = await postJson(
      `${baseUrl}/messages`,
      {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model,
        max_tokens: 4096,
        temperature: 0.35,
        messages: [{ role: 'user', content: prompt }],
      }
    );
    return Array.isArray(data?.content) ? data.content.map((part: any) => part.text || '').join('\n') : '';
  }

  if (provider.type === 'vertex') {
    const data = await postJson(
      `${baseUrl}/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(provider.apiKey)}`,
      { 'Content-Type': 'application/json' },
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 4096 },
      }
    );
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  throw new Error(`不支持的 AI 提供商类型：${provider.type}`);
}

function buildResumeAiPrompt(mode: 'extract' | 'polish', pastedText: string, currentResume: ResumeData) {
  const baseSchema = JSON.stringify({ version: DRAFT_VERSION, data: createEmptyResume() }, null, 2);
  return [
    '你是专业中文简历顾问。请只返回一个 JSON 对象，不要 Markdown，不要解释。',
    'JSON 必须符合这个结构：',
    baseSchema,
    '',
    mode === 'extract'
      ? '任务：从用户粘贴的 Word/文本内容中提取并整理为结构化简历。缺失字段留空数组或空字符串。'
      : '任务：在保留事实不虚构的前提下润色当前简历，优化表达为量化、清晰、适合投递的中文简历。',
    '要求：项目/工作亮点使用短句；不要编造公司、学校、时间、薪资；保留用户原有头像字段为空即可；website 不要凭空填写；不要返回 settings，模板样式由应用保留。',
    '',
    '当前简历 JSON：',
    JSON.stringify({ data: currentResume, settings: createDefaultSettings() }, null, 2),
    '',
    '用户粘贴文本：',
    pastedText || '(无)',
  ].join('\n');
}

function isModuleVisible(settings: ResumeSettings, moduleId: ResumeModuleId) {
  return !settings.hiddenModules[moduleId];
}

function orderedVisibleModules(settings: ResumeSettings) {
  return normalizeModuleOrder(settings.moduleOrder).filter((moduleId) => isModuleVisible(settings, moduleId));
}

function moduleHasContent(resume: ResumeData, moduleId: ResumeModuleId) {
  if (moduleId === 'summary') return Boolean(resume.basics.summary.trim());
  if (moduleId === 'work') return resume.work.length > 0;
  if (moduleId === 'projects') return resume.projects.length > 0;
  if (moduleId === 'education') return resume.education.length > 0;
  if (moduleId === 'skills') return resume.skills.length > 0;
  if (moduleId === 'awards') return resume.awards.length > 0;
  return resume.customSections.length > 0;
}

function estimateResumeContentScore(resume: ResumeData, settings: ResumeSettings) {
  const modules = orderedVisibleModules(settings).filter((moduleId) => moduleHasContent(resume, moduleId));
  const bulletCount =
    resume.work.reduce((sum, item) => sum + item.highlights.length, 0) +
    resume.projects.reduce((sum, item) => sum + item.highlights.length, 0) +
    resume.customSections.reduce((sum, item) => sum + item.content.length, 0);
  const textLength =
    resume.basics.summary.length +
    resume.work.reduce((sum, item) => sum + item.company.length + item.position.length + item.highlights.join('').length, 0) +
    resume.projects.reduce((sum, item) => sum + item.name.length + item.description.length + item.highlights.join('').length, 0);

  return (
    modules.length * 8 +
    resume.work.length * 18 +
    resume.projects.length * 16 +
    resume.education.length * 7 +
    resume.skills.length * 3 +
    resume.awards.length * 4 +
    bulletCount * 5 +
    Math.ceil(textLength / 70)
  );
}

function getFitStatus(score: number, settings: ResumeSettings) {
  const densityOffset = settings.density === 'compact' ? 12 : settings.density === 'comfortable' ? -12 : 0;
  const templateOffset = settings.template === 'classic' || settings.template === 'compact' ? 8 : 0;
  const limit = 118 + densityOffset + templateOffset;
  if (score <= limit * 0.82) {
    return { level: 'ok' as const, label: '一页余量充足', description: '当前内容适合一页投递。' };
  }
  if (score <= limit) {
    return { level: 'warn' as const, label: '接近一页上限', description: '如继续增加经历，建议切换紧凑密度或隐藏次要模块。' };
  }
  return { level: 'danger' as const, label: '可能超过一页', description: '建议精简描述、隐藏荣誉/自定义模块，或使用紧凑商务模板。' };
}

function resumeToMarkdown(resume: ResumeData, settings: ResumeSettings) {
  const lines: string[] = [
    `# ${resume.basics.name}`,
    resume.basics.title,
    '',
    [resume.basics.phone, resume.basics.email, resume.basics.location, resume.basics.website, resume.basics.expectedSalary]
      .filter(Boolean)
      .join(' | '),
    '',
  ];

  orderedVisibleModules(settings).forEach((moduleId) => {
    if (!moduleHasContent(resume, moduleId)) return;
    if (moduleId === 'summary') {
      lines.push('## 个人简介', resume.basics.summary, '');
    }
    if (moduleId === 'work') {
      lines.push(
        '## 工作经历',
        ...resume.work.flatMap((item) => [
          `### ${item.company} · ${item.position}`,
          [dateRange(item.startDate, item.endDate), item.location].filter(Boolean).join(' | '),
          ...item.highlights.map((line) => `- ${line}`),
          '',
        ])
      );
    }
    if (moduleId === 'projects') {
      lines.push(
        '## 项目经历',
        ...resume.projects.flatMap((item) => [
          `### ${item.name}${item.role ? ` · ${item.role}` : ''}`,
          [dateRange(item.startDate, item.endDate), item.url].filter(Boolean).join(' | '),
          item.description,
          ...item.highlights.map((line) => `- ${line}`),
          '',
        ])
      );
    }
    if (moduleId === 'education') {
      lines.push(
        '## 教育经历',
        ...resume.education.map(
          (item) =>
            `- ${item.school} · ${item.degree} · ${item.major} ${dateRange(item.startDate, item.endDate)}`
        ),
        ''
      );
    }
    if (moduleId === 'skills') {
      lines.push('## 技能', ...resume.skills.map((item) => `- ${item.name}${item.level ? `：${item.level}` : ''}`), '');
    }
    if (moduleId === 'awards') {
      lines.push(
        '## 荣誉奖项',
        ...resume.awards.map((item) =>
          `- ${item.title}${item.issuer ? ` · ${item.issuer}` : ''}${item.date ? ` · ${item.date}` : ''}`
        ),
        ''
      );
    }
    if (moduleId === 'custom') {
      resume.customSections.forEach((item) => {
        lines.push(`## ${item.title}`, ...item.content.map((line) => `- ${line}`), '');
      });
    }
  });

  return lines.filter((line, index) => line || lines[index - 1]).join('\n').trim();
}

function resumeToJsonResume(resume: ResumeData) {
  return {
    basics: {
      name: resume.basics.name,
      label: resume.basics.title,
      email: resume.basics.email,
      phone: resume.basics.phone,
      url: resume.basics.website,
      expectedSalary: resume.basics.expectedSalary,
      image: resume.basics.avatar,
      summary: resume.basics.summary,
      location: {
        city: resume.basics.location,
      },
    },
    work: resume.work.map((item) => ({
      name: item.company,
      position: item.position,
      location: item.location,
      startDate: item.startDate,
      endDate: item.endDate,
      highlights: item.highlights,
    })),
    projects: resume.projects.map((item) => ({
      name: item.name,
      description: item.description,
      url: item.url,
      roles: item.role ? [item.role] : [],
      startDate: item.startDate,
      endDate: item.endDate,
      highlights: item.highlights,
    })),
    education: resume.education.map((item) => ({
      institution: item.school,
      studyType: item.degree,
      area: item.major,
      startDate: item.startDate,
      endDate: item.endDate,
      score: item.description,
    })),
    skills: resume.skills.map((item) => ({
      name: item.name,
      level: item.level,
      keywords: item.keywords,
    })),
    awards: resume.awards.map((item) => ({
      title: item.title,
      date: item.date,
      awarder: item.issuer,
    })),
    meta: {
      canonical: 'https://jsonresume.org/schema/',
      source: 'mcheng-start-up resume generator',
    },
    'x-mcheng-customSections': resume.customSections,
  };
}

function resumeToHtml(resume: ResumeData, settings: ResumeSettings) {
  const { template, accent, density } = settings;
  const section = (title: string, body: string) => `<section><h2>${title}</h2>${body}</section>`;
  const bullets = (items: string[]) =>
    items.length ? `<ul>${items.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '';
  const work = resume.work
    .map(
      (item) => `<div class="item"><h3>${escapeHtml(item.company)} · ${escapeHtml(item.position)}</h3>
      <p class="meta">${escapeHtml(dateRange(item.startDate, item.endDate))}${item.location ? ` · ${escapeHtml(item.location)}` : ''}</p>${bullets(item.highlights)}</div>`
    )
    .join('');
  const projects = resume.projects
    .map(
      (item) => `<div class="item"><h3>${escapeHtml(item.name)}${item.role ? ` · ${escapeHtml(item.role)}` : ''}</h3>
      <p class="meta">${escapeHtml(dateRange(item.startDate, item.endDate))}${item.url ? ` · ${escapeHtml(item.url)}` : ''}</p>
      <p>${escapeHtml(item.description)}</p>${bullets(item.highlights)}</div>`
    )
    .join('');
  const education = resume.education
    .map(
      (item) => `<div class="item"><h3>${escapeHtml(item.school)} · ${escapeHtml(item.degree)}</h3>
      <p class="meta">${escapeHtml(item.major)} · ${escapeHtml(dateRange(item.startDate, item.endDate))}</p>
      ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}</div>`
    )
    .join('');
  const skills = `<div class="skills">${resume.skills
    .map((item) => `<span>${escapeHtml(item.name)}${item.level ? ` · ${escapeHtml(item.level)}` : ''}</span>`)
    .join('')}</div>`;
  const awards = resume.awards
    .map(
      (item) =>
        `<p>${escapeHtml(item.title)}${item.issuer ? ` · ${escapeHtml(item.issuer)}` : ''}${item.date ? ` · ${escapeHtml(item.date)}` : ''}</p>`
    )
    .join('');
  const custom = resume.customSections
    .map((item) => section(escapeHtml(item.title), bullets(item.content)))
    .join('');
  const sectionByModule: Record<ResumeModuleId, string> = {
    summary: section('个人简介', `<p>${escapeHtml(resume.basics.summary)}</p>`),
    work: section('工作经历', work),
    projects: section('项目经历', projects),
    education: section('教育经历', education),
    skills: section('技能', skills),
    awards: section('荣誉奖项', awards),
    custom,
  };
  const modules = orderedVisibleModules(settings).filter((moduleId) => moduleHasContent(resume, moduleId));
  const sidebarModules: ResumeModuleId[] = ['skills', 'education', 'awards'];
  const mainHtml =
    template === 'classic'
      ? `<div class="content"><aside>${modules
          .filter((moduleId) => sidebarModules.includes(moduleId))
          .map((moduleId) => sectionByModule[moduleId])
          .join('')}</aside><div>${modules
          .filter((moduleId) => !sidebarModules.includes(moduleId))
          .map((moduleId) => sectionByModule[moduleId])
          .join('')}</div></div>`
      : modules.map((moduleId) => sectionByModule[moduleId]).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(resume.basics.name || 'resume')}</title>
<style>
@page { size: A4; margin: 14mm; }
body { margin: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; color: #111827; }
.page { width: 210mm; min-height: 297mm; margin: 0 auto; background: white; padding: 16mm; box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
.density-comfortable { padding: 17mm; }
.density-compact { padding: 12mm 14mm; }
.header { border-bottom: 2px solid ${accent}; padding-bottom: 12px; margin-bottom: 18px; }
.template-modern .header { background: ${accent}; color: white; margin: -16mm -16mm 16px; padding: 16mm; border: 0; }
.template-modern .header .meta, .template-modern .header p { color: rgba(255,255,255,.86); }
.header-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.avatar { width: 28mm; height: 28mm; border-radius: 50%; object-fit: cover; border: 2px solid ${accent}; flex: 0 0 auto; }
.template-modern .avatar { border-color: rgba(255,255,255,.85); }
h1 { margin: 0; font-size: 30px; }
h2 { color: ${accent}; font-size: 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin: 18px 0 10px; }
h3 { margin: 0 0 4px; font-size: 14px; }
p { margin: 4px 0; line-height: 1.6; font-size: 12px; }
li { margin: 3px 0; line-height: 1.55; font-size: 12px; }
.density-compact h2 { margin-top: 12px; }
.density-compact p, .density-compact li { line-height: 1.45; }
.meta { color: #6b7280; font-size: 11px; }
.item { margin-bottom: 12px; }
.skills { display: flex; flex-wrap: wrap; gap: 6px; }
.skills span { border: 1px solid #d1d5db; border-radius: 4px; padding: 3px 7px; font-size: 12px; }
.template-classic .content { display: grid; grid-template-columns: 58mm 1fr; gap: 10mm; }
.template-classic aside { background: #f9fafb; padding: 10px; }
.template-compact { font-size: 12px; }
@media print { body { background: white; } .page { margin: 0; box-shadow: none; } }
</style>
</head>
<body>
<main class="page template-${template} density-${density}">
<header class="header">
<div class="header-row">
<div>
<h1>${escapeHtml(resume.basics.name)}</h1>
<p>${escapeHtml(resume.basics.title)}</p>
<p class="meta">${escapeHtml([resume.basics.phone, resume.basics.email, resume.basics.location, resume.basics.website, resume.basics.expectedSalary].filter(Boolean).join(' · '))}</p>
</div>
${resume.basics.avatar ? `<img class="avatar" src="${escapeHtml(resume.basics.avatar)}" alt="${escapeHtml(resume.basics.name || 'avatar')}" />` : ''}
</div>
</header>
${mainHtml}
</main>
</body>
</html>`;
}

export default function ResumeGeneratorTool() {
  const ready = useToolTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const lastSavedDraftRef = useRef('');
  const { data, loaded, loadData, updateResumeGeneratorData } = useToolDataStore();
  const appSettings = useSettingsStore();
  const initialDraft = loadStoredDraft();
  const initialDocument = createResumeDocument(initialDraft.resume.basics.name || '默认简历', initialDraft.resume, initialDraft.settings);
  const [documents, setDocuments] = useState<ResumeDocument[]>([initialDocument]);
  const [activeDocumentId, setActiveDocumentId] = useState(initialDocument.id);
  const activeDocument = documents.find((item) => item.id === activeDocumentId) || documents[0] || initialDocument;
  const resume = activeDocument.data;
  const settings = activeDocument.settings;
  const [section, setSection] = useState<EditorSection>('basics');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiMode, setAiMode] = useState<'extract' | 'polish'>('extract');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const activeDocumentName = activeDocument.name || resume.basics.name || '未命名简历';
  const aiSelection = useMemo(() => pickConfiguredAiProvider(appSettings), [appSettings]);
  const visibleModuleCount = useMemo(
    () => orderedVisibleModules(settings).filter((moduleId) => moduleHasContent(resume, moduleId)).length,
    [resume, settings]
  );
  const contentScore = useMemo(() => estimateResumeContentScore(resume, settings), [resume, settings]);
  const fitStatus = useMemo(() => getFitStatus(contentScore, settings), [contentScore, settings]);

  useEffect(() => {
    if (!loaded) {
      loadData();
    }
  }, [loaded, loadData]);

  useEffect(() => {
    void appSettings.loadSettings();
  }, [appSettings.loadSettings]);

  useEffect(() => {
    if (!loaded || hydrated) return;
    const storedDraft = data.resumeGenerator?.draft;
    if (storedDraft) {
      const normalized = normalizeStoredDocuments(storedDraft);
      setDocuments(normalized.documents);
      setActiveDocumentId(normalized.activeId);
    } else {
      const legacyDraft = loadStoredDraft();
      const legacyDocument = createResumeDocument(legacyDraft.resume.basics.name || '默认简历', legacyDraft.resume, legacyDraft.settings);
      setDocuments([legacyDocument]);
      setActiveDocumentId(legacyDocument.id);
      updateResumeGeneratorData(
        { version: DRAFT_VERSION, documents: [legacyDocument], activeId: legacyDocument.id },
        DRAFT_VERSION
      );
    }
    setHydrated(true);
  }, [data.resumeGenerator?.draft, hydrated, loaded, updateResumeGeneratorData]);

  useEffect(() => {
    if (!loaded || !hydrated) return;
    const payload = { version: DRAFT_VERSION, documents, activeId: activeDocumentId };
    const serialized = JSON.stringify(payload);
    if (lastSavedDraftRef.current === serialized) return;
    lastSavedDraftRef.current = serialized;
    localStorage.setItem(STORAGE_KEY, serialized);
    updateResumeGeneratorData(payload, DRAFT_VERSION);
  }, [activeDocumentId, documents, hydrated, loaded, updateResumeGeneratorData]);

  const markdown = useMemo(() => resumeToMarkdown(resume, settings), [resume, settings]);

  function updateActiveDocument(updater: (document: ResumeDocument) => ResumeDocument) {
    setDocuments((current) =>
      current.map((document) =>
        document.id === activeDocumentId ? { ...updater(document), updatedAt: new Date().toISOString() } : document
      )
    );
  }

  function renameActiveDocument(name: string) {
    updateActiveDocument((document) => ({ ...document, name }));
  }

  function addDocument() {
    const next = createResumeDocument(`简历 ${documents.length + 1}`);
    setDocuments((current) => [...current, next]);
    setActiveDocumentId(next.id);
    setStatus('已新建简历');
  }

  function duplicateDocument() {
    const now = new Date().toISOString();
    const next: ResumeDocument = {
      ...activeDocument,
      id: createId('resume'),
      name: `${activeDocumentName} 副本`,
      data: normalizeImportedResume(activeDocument.data),
      settings: normalizeSettings(activeDocument.settings),
      createdAt: now,
      updatedAt: now,
    };
    setDocuments((current) => [...current, next]);
    setActiveDocumentId(next.id);
    setStatus('已复制当前简历');
  }

  function deleteDocument(id: string) {
    if (documents.length <= 1) {
      setStatus('至少保留一份简历');
      return;
    }
    const target = documents.find((item) => item.id === id);
    if (!confirm(`确定删除「${target?.name || '未命名简历'}」吗？`)) return;
    setDocuments((current) => {
      const next = current.filter((item) => item.id !== id);
      if (id === activeDocumentId) {
        setActiveDocumentId(next[0]?.id || '');
      }
      return next;
    });
    setStatus('已删除简历');
  }

  function patchBasics(patch: Partial<ResumeBasics>) {
    updateActiveDocument((document) => ({
      ...document,
      data: { ...document.data, basics: { ...document.data.basics, ...patch } },
    }));
  }

  async function updateAvatar(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('头像上传失败：请选择图片文件');
      return;
    }
    try {
      const avatar = await readFileAsDataUrl(file);
      patchBasics({ avatar });
      setStatus('已更新头像');
    } catch {
      setStatus('头像上传失败：无法读取图片');
    }
  }

  function patchSettings(patch: Partial<ResumeSettings>) {
    updateActiveDocument((document) => ({
      ...document,
      settings: normalizeSettings({ ...document.settings, ...patch }),
    }));
  }

  function patchListItem<K extends EditableListKey>(
    key: K,
    id: string,
    patch: Partial<ResumeData[K][number]>
  ) {
    updateActiveDocument((document) => ({
      ...document,
      data: {
        ...document.data,
        [key]: document.data[key].map((item) => (item.id === id ? { ...item, ...patch } : item)),
      },
    }));
  }

  function removeListItem(key: EditableListKey, id: string) {
    updateActiveDocument((document) => ({
      ...document,
      data: {
        ...document.data,
        [key]: document.data[key].filter((item) => item.id !== id),
      },
    }));
  }

  function moveListItem(key: EditableListKey, id: string, direction: -1 | 1) {
    updateActiveDocument((document) => {
      const items = [...document.data[key]];
      const index = items.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return document;
      const [item] = items.splice(index, 1);
      items.splice(nextIndex, 0, item);
      return { ...document, data: { ...document.data, [key]: items } };
    });
  }

  function moveModule(moduleId: ResumeModuleId, direction: -1 | 1) {
    const order = normalizeModuleOrder(settings.moduleOrder);
    const index = order.indexOf(moduleId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const nextOrder = [...order];
    const [item] = nextOrder.splice(index, 1);
    nextOrder.splice(nextIndex, 0, item);
    patchSettings({ moduleOrder: nextOrder });
  }

  function toggleModule(moduleId: ResumeModuleId) {
    patchSettings({
      hiddenModules: {
        ...settings.hiddenModules,
        [moduleId]: !settings.hiddenModules[moduleId],
      },
    });
  }

  function addWork() {
    updateActiveDocument((document) => ({
      ...document,
      data: {
        ...document.data,
        work: [
          ...document.data.work,
          normalizeWork({ company: '公司名称', position: '职位名称', highlights: ['负责核心模块开发'] }),
        ],
      },
    }));
  }

  function addProject() {
    updateActiveDocument((document) => ({
      ...document,
      data: {
        ...document.data,
        projects: [
          ...document.data.projects,
          normalizeProject({ name: '项目名称', role: '项目角色', highlights: ['描述项目成果'] }),
        ],
      },
    }));
  }

  function addEducation() {
    updateActiveDocument((document) => ({
      ...document,
      data: {
        ...document.data,
        education: [...document.data.education, normalizeEducation({ school: '学校名称', degree: '学历' })],
      },
    }));
  }

  function addSkill() {
    updateActiveDocument((document) => ({
      ...document,
      data: {
        ...document.data,
        skills: [...document.data.skills, normalizeSkill({ name: '技能名称', level: '熟练' })],
      },
    }));
  }

  function addAward() {
    updateActiveDocument((document) => ({
      ...document,
      data: {
        ...document.data,
        awards: [...document.data.awards, normalizeAward({ title: '奖项名称', date: '2026.05' })],
      },
    }));
  }

  function addCustomSection() {
    updateActiveDocument((document) => ({
      ...document,
      data: {
        ...document.data,
        customSections: [
          ...document.data.customSections,
          normalizeCustomSection({ title: '自定义模块', content: ['补充一条关键信息'] }),
        ],
      },
    }));
  }

  async function copyMarkdown() {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setStatus('已复制 Markdown');
    setTimeout(() => setCopied(false), 1400);
  }

  function exportJson() {
    downloadText(
      `${resume.basics.name || 'resume'}.json`,
      JSON.stringify({ version: DRAFT_VERSION, data: resume, settings }, null, 2),
      'application/json;charset=utf-8'
    );
  }

  function exportStandardJson() {
    downloadText(
      `${resume.basics.name || 'resume'}-jsonresume.json`,
      JSON.stringify(resumeToJsonResume(resume), null, 2),
      'application/json;charset=utf-8'
    );
  }

  function exportHtml() {
    downloadText(
      `${resume.basics.name || 'resume'}.html`,
      resumeToHtml(resume, settings),
      'text/html;charset=utf-8'
    );
  }

  async function importJson(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      updateActiveDocument((document) => ({
        ...document,
        name: parsed?.name || document.name,
        data: normalizeImportedResume(parsed),
        settings: normalizeSettings(parsed?.settings),
      }));
      setStatus('已导入简历 JSON');
    } catch {
      setStatus('导入失败：请检查 JSON 文件格式');
    }
  }

  async function pasteAiTextFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setAiInput(text);
      setAiError('');
    } catch {
      setAiError('读取剪贴板失败，请手动粘贴文本');
    }
  }

  async function runAiResume() {
    if (!aiSelection) {
      setAiError('请先在设置中配置默认 AI 模型或激活一个 AI 提供商');
      return;
    }
    if (aiMode === 'extract' && !aiInput.trim()) {
      setAiError('请先粘贴 Word 或文本内容');
      return;
    }

    setAiBusy(true);
    setAiError('');
    try {
      const prompt = buildResumeAiPrompt(aiMode, aiInput, resume);
      const answer = await callResumeAi(aiSelection.provider, aiSelection.model, prompt);
      const parsed = JSON.parse(extractJsonObject(answer));
      const nextResume = normalizeImportedResume(parsed?.data || parsed);
      if (!resumeHasAnyContent(nextResume)) {
        throw new Error('AI 返回的简历内容为空，请补充文本后重试');
      }
      updateActiveDocument((document) => ({
        ...document,
        name: nextResume.basics.name || parsed?.name || document.name,
        data: {
          ...nextResume,
          basics: {
            ...nextResume.basics,
            avatar: nextResume.basics.avatar || document.data.basics.avatar,
          },
        },
        settings: document.settings,
      }));
      setStatus(aiMode === 'extract' ? 'AI 已整理并应用简历' : 'AI 已润色当前简历');
      setSection('basics');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiBusy(false);
    }
  }

  function resetSample() {
    if (confirm('确定要恢复为示例简历吗？当前草稿会被覆盖。')) {
      updateActiveDocument((document) => ({
        ...document,
        name: '示例简历',
        data: createSampleResume(),
        settings: createDefaultSettings(),
      }));
      setStatus('已恢复示例简历');
    }
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-100 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <style>{`
        @page { size: A4; margin: 0; }
        @media print {
          html, body, #root { width: 210mm; min-height: 297mm; background: white !important; }
          body * { visibility: hidden; }
          #resume-print-area, #resume-print-area * { visibility: visible; }
          #resume-print-area { position: absolute; left: 0; top: 0; width: 210mm; margin: 0; padding: 0; }
          #resume-print-area .resume-page { box-shadow: none !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>
      <ToolHeader
        icon="📄"
        title="简历生成器"
        subtitle="本地编辑 · 实时预览 · JSON/HTML/Markdown 导出"
        actions={
          <div className="flex items-center gap-1">
            <ToolbarButton icon={<Upload size={15} />} label="导入" onClick={() => fileInputRef.current?.click()} />
            <ToolbarButton icon={<FileJson size={15} />} label="JSON" onClick={exportJson} />
            <ToolbarButton icon={<FileJson size={15} />} label="标准" onClick={exportStandardJson} />
            <ToolbarButton icon={<FileText size={15} />} label="HTML" onClick={exportHtml} />
            <ToolbarButton
              icon={copied ? <Check size={15} /> : <Copy size={15} />}
              label="复制"
              onClick={() => void copyMarkdown()}
            />
            <ToolbarButton icon={<Printer size={15} />} label="打印" onClick={() => window.print()} />
          </div>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importJson(file);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void updateAvatar(event.target.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[460px_minmax(0,1fr)]">
        <aside className="flex min-h-[45vh] flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 xl:min-h-0">
          <div className="border-b border-gray-200 p-3 dark:border-gray-800">
            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/50">
              <div className="flex items-center gap-2">
                <select
                  value={activeDocumentId}
                  onChange={(event) => setActiveDocumentId(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  title="选择简历"
                >
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.name || document.data.basics.name || '未命名简历'}
                    </option>
                  ))}
                </select>
                <button
                  onClick={addDocument}
                  className="rounded-lg p-1.5 text-gray-500 hover:bg-white hover:text-blue-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  title="新建简历"
                >
                  <Plus size={15} />
                </button>
                <button
                  onClick={duplicateDocument}
                  className="rounded-lg p-1.5 text-gray-500 hover:bg-white hover:text-blue-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  title="复制当前简历"
                >
                  <CopyPlus size={15} />
                </button>
                <button
                  onClick={() => deleteDocument(activeDocumentId)}
                  disabled={documents.length <= 1}
                  className="rounded-lg p-1.5 text-gray-500 hover:bg-white hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-35 dark:text-gray-300 dark:hover:bg-gray-800"
                  title="删除当前简历"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Save size={13} className="shrink-0 text-gray-400" />
                <input
                  value={activeDocumentName}
                  onChange={(event) => renameActiveDocument(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium text-gray-700 outline-none focus:border-blue-300 focus:bg-white dark:text-gray-200 dark:focus:bg-gray-900"
                  title="简历名称"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => patchSettings({ template: item.id })}
                  className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                    settings.template === item.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-1 text-xs font-semibold">
                    <LayoutTemplate size={13} />
                    {item.name}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[10px] opacity-70">{item.description}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Palette size={14} />
                配色
              </div>
              <div className="flex gap-1.5">
                {ACCENT_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => patchSettings({ accent: color })}
                    className={`h-6 w-6 rounded-full border-2 ${
                      settings.accent === color ? 'border-gray-900 dark:border-white' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Settings2 size={14} />
                密度
              </div>
              <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-gray-200 text-xs dark:border-gray-700">
                {DENSITIES.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => patchSettings({ density: item.id })}
                    className={`px-3 py-1.5 transition-colors ${
                      settings.density === item.id
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-500 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[92px_minmax(0,1fr)]">
            <nav className="border-r border-gray-200 bg-gray-50/70 p-2 dark:border-gray-800 dark:bg-gray-950/30">
              <div className="space-y-1">
                {SECTION_META.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSection(item.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                      section === item.id
                        ? 'bg-white text-blue-600 shadow-sm ring-1 ring-blue-100 dark:bg-gray-800 dark:text-blue-300 dark:ring-blue-900/40'
                        : 'text-gray-500 hover:bg-white hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                    }`}
                    title={item.label}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </nav>

            <div className="min-h-0 overflow-y-auto p-4">
              {section === 'basics' && (
                <BasicsEditor
                  basics={resume.basics}
                  onChange={patchBasics}
                  onPickAvatar={() => avatarInputRef.current?.click()}
                  onRemoveAvatar={() => patchBasics({ avatar: '' })}
                />
              )}
              {section === 'work' && (
                <WorkEditor
                  items={resume.work}
                  onAdd={addWork}
                  onRemove={(id) => removeListItem('work', id)}
                  onChange={(id, patch) => patchListItem('work', id, patch)}
                  onMove={(id, direction) => moveListItem('work', id, direction)}
                />
              )}
              {section === 'projects' && (
                <ProjectEditor
                  items={resume.projects}
                  onAdd={addProject}
                  onRemove={(id) => removeListItem('projects', id)}
                  onChange={(id, patch) => patchListItem('projects', id, patch)}
                  onMove={(id, direction) => moveListItem('projects', id, direction)}
                />
              )}
              {section === 'education' && (
                <EducationEditor
                  items={resume.education}
                  onAdd={addEducation}
                  onRemove={(id) => removeListItem('education', id)}
                  onChange={(id, patch) => patchListItem('education', id, patch)}
                  onMove={(id, direction) => moveListItem('education', id, direction)}
                />
              )}
              {section === 'skills' && (
                <SkillEditor
                  items={resume.skills}
                  onAdd={addSkill}
                  onRemove={(id) => removeListItem('skills', id)}
                  onChange={(id, patch) => patchListItem('skills', id, patch)}
                  onMove={(id, direction) => moveListItem('skills', id, direction)}
                />
              )}
              {section === 'awards' && (
                <AwardEditor
                  items={resume.awards}
                  onAdd={addAward}
                  onRemove={(id) => removeListItem('awards', id)}
                  onChange={(id, patch) => patchListItem('awards', id, patch)}
                  onMove={(id, direction) => moveListItem('awards', id, direction)}
                />
              )}
              {section === 'custom' && (
                <CustomSectionEditor
                  items={resume.customSections}
                  onAdd={addCustomSection}
                  onRemove={(id) => removeListItem('customSections', id)}
                  onChange={(id, patch) => patchListItem('customSections', id, patch)}
                  onMove={(id, direction) => moveListItem('customSections', id, direction)}
                />
              )}
              {section === 'layout' && (
                <LayoutEditor
                  settings={settings}
                  onToggle={toggleModule}
                  onMove={moveModule}
                  onReset={() => patchSettings({ hiddenModules: createDefaultSettings().hiddenModules, moduleOrder: MODULE_ORDER })}
                />
              )}
              {section === 'ai' && (
                <AiResumeEditor
                  input={aiInput}
                  mode={aiMode}
                  busy={aiBusy}
                  error={aiError}
                  aiProviderLabel={
                    aiSelection ? `${aiSelection.provider.name} · ${aiSelection.model || '未设置模型'}` : '未配置默认 AI 模型'
                  }
                  onInputChange={setAiInput}
                  onModeChange={setAiMode}
                  onPaste={pasteAiTextFromClipboard}
                  onRun={() => void runAiResume()}
                />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 dark:border-gray-800">
            <span className="truncate text-xs text-gray-500 dark:text-gray-400">
              {status || '草稿会自动保存在本机'}
            </span>
            <button
              onClick={resetSample}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <RotateCcw size={13} />
              示例
            </button>
          </div>
        </aside>

        <main className="min-h-0 overflow-auto bg-gray-100 p-6 dark:bg-gray-950">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1">
                <Eye size={14} />
                A4 预览
              </span>
              <span className="ml-2 text-gray-400">模块 {visibleModuleCount} · 内容量 {contentScore}</span>
            </div>
            <div
              className={`shrink-0 rounded-full px-2.5 py-1 ${
                fitStatus.level === 'ok'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                  : fitStatus.level === 'warn'
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
              }`}
              title={fitStatus.description}
            >
              {fitStatus.label}
            </div>
          </div>
          {fitStatus.level !== 'ok' && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              {fitStatus.description}
            </div>
          )}
          <div id="resume-print-area" className="flex justify-center">
            <ResumePreview resume={resume} settings={settings} />
          </div>
        </main>
      </div>
    </div>
  );
}

const SECTION_META: Array<{ id: EditorSection; label: string; icon: React.ReactNode }> = [
  { id: 'basics', label: '资料', icon: <User size={14} /> },
  { id: 'work', label: '工作', icon: <Briefcase size={14} /> },
  { id: 'projects', label: '项目', icon: <Wrench size={14} /> },
  { id: 'education', label: '教育', icon: <GraduationCap size={14} /> },
  { id: 'skills', label: '技能', icon: <Palette size={14} /> },
  { id: 'awards', label: '荣誉', icon: <Trophy size={14} /> },
  { id: 'custom', label: '自定义', icon: <FileText size={14} /> },
  { id: 'layout', label: '布局', icon: <Settings2 size={14} /> },
  { id: 'ai', label: 'AI', icon: <Sparkles size={14} /> },
];

function ToolbarButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
      title={label}
    >
      {icon}
      {label}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      />
    </label>
  );
}

function EditorBlock({
  title,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  children,
}: {
  title: string;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
        <div className="flex items-center gap-1">
          {onMoveUp && (
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              title="上移"
            >
              <ChevronUp size={15} />
            </button>
          )}
          {onMoveDown && (
            <button
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              title="下移"
            >
              <ChevronDown size={15} />
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
              title="删除"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 dark:border-gray-700 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:text-blue-300"
    >
      <Plus size={15} />
      {label}
    </button>
  );
}

function BasicsEditor({
  basics,
  onChange,
  onPickAvatar,
  onRemoveAvatar,
}: {
  basics: ResumeBasics;
  onChange: (patch: Partial<ResumeBasics>) => void;
  onPickAvatar: () => void;
  onRemoveAvatar: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-800">
          {basics.avatar ? (
            <img src={basics.avatar} alt="头像" className="h-full w-full object-cover" />
          ) : (
            <User size={28} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">头像</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">用于右侧 A4 预览，可留空。</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onPickAvatar}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300"
            >
              <Upload size={13} />
              上传头像
            </button>
            {basics.avatar && (
              <button
                type="button"
                onClick={onRemoveAvatar}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
              >
                <X size={13} />
                移除
              </button>
            )}
          </div>
        </div>
      </div>
      <Field label="姓名" value={basics.name} onChange={(name) => onChange({ name })} />
      <Field label="求职方向" value={basics.title} onChange={(title) => onChange({ title })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="手机" value={basics.phone} onChange={(phone) => onChange({ phone })} />
        <Field label="邮箱" value={basics.email} onChange={(email) => onChange({ email })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="城市" value={basics.location} onChange={(location) => onChange({ location })} />
        <Field
          label="期待薪资"
          value={basics.expectedSalary}
          onChange={(expectedSalary) => onChange({ expectedSalary })}
          placeholder="如 25k-35k / 面议"
        />
      </div>
      <div className="grid grid-cols-1 gap-3">
        <Field label="链接" value={basics.website} onChange={(website) => onChange({ website })} />
      </div>
      <TextAreaField
        label="个人简介"
        value={basics.summary}
        onChange={(summary) => onChange({ summary })}
        rows={6}
      />
    </div>
  );
}

function WorkEditor({
  items,
  onAdd,
  onRemove,
  onChange,
  onMove,
}: {
  items: ResumeWork[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<ResumeWork>) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <ListEditorHeader title="工作经历" onAdd={onAdd} addLabel="添加工作经历">
      {items.map((item, index) => (
        <EditorBlock
          key={item.id}
          title={item.company || '工作经历'}
          onRemove={() => onRemove(item.id)}
          onMoveUp={() => onMove(item.id, -1)}
          onMoveDown={() => onMove(item.id, 1)}
          canMoveUp={index > 0}
          canMoveDown={index < items.length - 1}
        >
          <Field label="公司" value={item.company} onChange={(company) => onChange(item.id, { company })} />
          <Field label="职位" value={item.position} onChange={(position) => onChange(item.id, { position })} />
          <div className="grid grid-cols-3 gap-2">
            <Field label="开始" value={item.startDate} onChange={(startDate) => onChange(item.id, { startDate })} />
            <Field label="结束" value={item.endDate} onChange={(endDate) => onChange(item.id, { endDate })} />
            <Field label="地点" value={item.location} onChange={(location) => onChange(item.id, { location })} />
          </div>
          <TextAreaField
            label="工作内容"
            value={joinLines(item.highlights)}
            onChange={(value) => onChange(item.id, { highlights: splitLines(value) })}
            rows={5}
          />
        </EditorBlock>
      ))}
    </ListEditorHeader>
  );
}

function ProjectEditor({
  items,
  onAdd,
  onRemove,
  onChange,
  onMove,
}: {
  items: ResumeProject[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<ResumeProject>) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <ListEditorHeader title="项目经历" onAdd={onAdd} addLabel="添加项目经历">
      {items.map((item, index) => (
        <EditorBlock
          key={item.id}
          title={item.name || '项目经历'}
          onRemove={() => onRemove(item.id)}
          onMoveUp={() => onMove(item.id, -1)}
          onMoveDown={() => onMove(item.id, 1)}
          canMoveUp={index > 0}
          canMoveDown={index < items.length - 1}
        >
          <Field label="项目" value={item.name} onChange={(name) => onChange(item.id, { name })} />
          <Field label="角色" value={item.role} onChange={(role) => onChange(item.id, { role })} />
          <div className="grid grid-cols-3 gap-2">
            <Field label="开始" value={item.startDate} onChange={(startDate) => onChange(item.id, { startDate })} />
            <Field label="结束" value={item.endDate} onChange={(endDate) => onChange(item.id, { endDate })} />
            <Field label="链接" value={item.url} onChange={(url) => onChange(item.id, { url })} />
          </div>
          <TextAreaField
            label="项目简介"
            value={item.description}
            onChange={(description) => onChange(item.id, { description })}
            rows={3}
          />
          <TextAreaField
            label="项目亮点"
            value={joinLines(item.highlights)}
            onChange={(value) => onChange(item.id, { highlights: splitLines(value) })}
            rows={5}
          />
        </EditorBlock>
      ))}
    </ListEditorHeader>
  );
}

function EducationEditor({
  items,
  onAdd,
  onRemove,
  onChange,
  onMove,
}: {
  items: ResumeEducation[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<ResumeEducation>) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <ListEditorHeader title="教育经历" onAdd={onAdd} addLabel="添加教育经历">
      {items.map((item, index) => (
        <EditorBlock
          key={item.id}
          title={item.school || '教育经历'}
          onRemove={() => onRemove(item.id)}
          onMoveUp={() => onMove(item.id, -1)}
          onMoveDown={() => onMove(item.id, 1)}
          canMoveUp={index > 0}
          canMoveDown={index < items.length - 1}
        >
          <Field label="学校" value={item.school} onChange={(school) => onChange(item.id, { school })} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="学历" value={item.degree} onChange={(degree) => onChange(item.id, { degree })} />
            <Field label="专业" value={item.major} onChange={(major) => onChange(item.id, { major })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="开始" value={item.startDate} onChange={(startDate) => onChange(item.id, { startDate })} />
            <Field label="结束" value={item.endDate} onChange={(endDate) => onChange(item.id, { endDate })} />
          </div>
          <Field label="补充" value={item.description} onChange={(description) => onChange(item.id, { description })} />
        </EditorBlock>
      ))}
    </ListEditorHeader>
  );
}

function SkillEditor({
  items,
  onAdd,
  onRemove,
  onChange,
  onMove,
}: {
  items: ResumeSkill[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<ResumeSkill>) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <ListEditorHeader title="技能清单" onAdd={onAdd} addLabel="添加技能">
      {items.map((item, index) => (
        <EditorBlock
          key={item.id}
          title={item.name || '技能'}
          onRemove={() => onRemove(item.id)}
          onMoveUp={() => onMove(item.id, -1)}
          onMoveDown={() => onMove(item.id, 1)}
          canMoveUp={index > 0}
          canMoveDown={index < items.length - 1}
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="技能" value={item.name} onChange={(name) => onChange(item.id, { name })} />
            <Field label="程度" value={item.level} onChange={(level) => onChange(item.id, { level })} />
          </div>
          <Field
            label="关键词"
            value={item.keywords.join('、')}
            onChange={(value) => onChange(item.id, { keywords: value.split(/[、,，]/).map((v) => v.trim()).filter(Boolean) })}
          />
        </EditorBlock>
      ))}
    </ListEditorHeader>
  );
}

function AwardEditor({
  items,
  onAdd,
  onRemove,
  onChange,
  onMove,
}: {
  items: ResumeAward[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<ResumeAward>) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <ListEditorHeader title="荣誉奖项" onAdd={onAdd} addLabel="添加荣誉奖项">
      {items.map((item, index) => (
        <EditorBlock
          key={item.id}
          title={item.title || '荣誉奖项'}
          onRemove={() => onRemove(item.id)}
          onMoveUp={() => onMove(item.id, -1)}
          onMoveDown={() => onMove(item.id, 1)}
          canMoveUp={index > 0}
          canMoveDown={index < items.length - 1}
        >
          <Field label="奖项" value={item.title} onChange={(title) => onChange(item.id, { title })} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="日期" value={item.date} onChange={(date) => onChange(item.id, { date })} />
            <Field label="颁发方" value={item.issuer} onChange={(issuer) => onChange(item.id, { issuer })} />
          </div>
        </EditorBlock>
      ))}
    </ListEditorHeader>
  );
}

function CustomSectionEditor({
  items,
  onAdd,
  onRemove,
  onChange,
  onMove,
}: {
  items: ResumeCustomSection[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<ResumeCustomSection>) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <ListEditorHeader title="自定义模块" onAdd={onAdd} addLabel="添加自定义模块">
      {items.map((item, index) => (
        <EditorBlock
          key={item.id}
          title={item.title || '自定义模块'}
          onRemove={() => onRemove(item.id)}
          onMoveUp={() => onMove(item.id, -1)}
          onMoveDown={() => onMove(item.id, 1)}
          canMoveUp={index > 0}
          canMoveDown={index < items.length - 1}
        >
          <Field label="模块标题" value={item.title} onChange={(title) => onChange(item.id, { title })} />
          <TextAreaField
            label="模块内容"
            value={joinLines(item.content)}
            onChange={(value) => onChange(item.id, { content: splitLines(value) })}
            rows={5}
          />
        </EditorBlock>
      ))}
    </ListEditorHeader>
  );
}

function LayoutEditor({
  settings,
  onToggle,
  onMove,
  onReset,
}: {
  settings: ResumeSettings;
  onToggle: (moduleId: ResumeModuleId) => void;
  onMove: (moduleId: ResumeModuleId, direction: -1 | 1) => void;
  onReset: () => void;
}) {
  const order = normalizeModuleOrder(settings.moduleOrder);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">模块布局</h2>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <RotateCcw size={13} />
          重置
        </button>
      </div>
      <div className="space-y-2">
        {order.map((moduleId, index) => {
          const meta = MODULE_META.find((item) => item.id === moduleId);
          if (!meta) return null;
          const hidden = settings.hiddenModules[moduleId];
          return (
            <div
              key={moduleId}
              className={`rounded-lg border p-3 transition-colors ${
                hidden
                  ? 'border-gray-200 bg-gray-50 opacity-75 dark:border-gray-800 dark:bg-gray-800/40'
                  : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    {meta.label}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{meta.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => onMove(moduleId, -1)}
                    disabled={index === 0}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    title="上移"
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    onClick={() => onMove(moduleId, 1)}
                    disabled={index === order.length - 1}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    title="下移"
                  >
                    <ChevronDown size={15} />
                  </button>
                  <button
                    onClick={() => onToggle(moduleId)}
                    className={`rounded-lg px-2 py-1 text-xs ${
                      hidden
                        ? 'bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200'
                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300'
                    }`}
                  >
                    {hidden ? '显示' : '隐藏'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AiResumeEditor({
  input,
  mode,
  busy,
  error,
  aiProviderLabel,
  onInputChange,
  onModeChange,
  onPaste,
  onRun,
}: {
  input: string;
  mode: 'extract' | 'polish';
  busy: boolean;
  error: string;
  aiProviderLabel: string;
  onInputChange: (value: string) => void;
  onModeChange: (mode: 'extract' | 'polish') => void;
  onPaste: () => void;
  onRun: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">AI 整理与润色</h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          调用应用设置里的默认 AI 模型，把粘贴文本整理为简历数据，或润色当前简历内容。
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <div className="mb-3 flex flex-col gap-2">
          <div className="min-w-0 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            当前生成模型：<span className="font-medium text-gray-700 dark:text-gray-200">{aiProviderLabel}</span>
          </div>
          <div className="grid w-full grid-cols-2 overflow-hidden rounded-lg border border-gray-200 text-xs dark:border-gray-700">
            <button
              onClick={() => onModeChange('extract')}
              className={`min-w-0 whitespace-nowrap px-3 py-1.5 ${mode === 'extract' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
            >
              整理导入
            </button>
            <button
              onClick={() => onModeChange('polish')}
              className={`min-w-0 whitespace-nowrap px-3 py-1.5 ${mode === 'polish' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
            >
              润色当前
            </button>
          </div>
        </div>

        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="从 Word、网页或 TXT 复制文本后粘贴到这里。AI 会尽量提取姓名、联系方式、工作经历、项目经历、教育、技能等结构。"
          rows={10}
          className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        />

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <button
            onClick={onPaste}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300"
          >
            <Copy size={14} />
            粘贴剪贴板
          </button>
          <button
            onClick={onRun}
            disabled={busy}
            className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {mode === 'extract' ? 'AI 整理并应用' : 'AI 润色当前简历'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ListEditorHeader({
  title,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
      </div>
      {children}
      <AddButton label={addLabel} onClick={onAdd} />
    </div>
  );
}

function ResumePreview({ resume, settings }: { resume: ResumeData; settings: ResumeSettings }) {
  const { template, accent, density } = settings;
  const modules = orderedVisibleModules(settings).filter((moduleId) => moduleHasContent(resume, moduleId));
  const compact = density === 'compact' || template === 'compact';
  const pagePadding =
    density === 'comfortable' ? 'px-12 py-12' : density === 'compact' ? 'px-10 py-8' : 'px-12 py-10';
  const sidebarModules: ResumeModuleId[] = ['skills', 'education', 'awards'];
  const renderModule = (moduleId: ResumeModuleId, inSidebar = false) => (
    <ResumeModule
      key={moduleId}
      moduleId={moduleId}
      resume={resume}
      accent={accent}
      compact={compact || inSidebar}
    />
  );

  if (template === 'classic') {
    return (
      <article className="resume-page min-h-[297mm] w-[210mm] bg-white text-gray-900 shadow-xl print:shadow-none">
        <div className="flex min-h-[297mm]">
          <aside className="w-[70mm] bg-gray-50 px-7 py-8">
            <ResumeHeader resume={resume} accent={accent} compact sidebar />
            {modules.filter((moduleId) => sidebarModules.includes(moduleId)).map((moduleId) => renderModule(moduleId, true))}
          </aside>
          <main className="flex-1 px-8 py-8">
            {modules.filter((moduleId) => !sidebarModules.includes(moduleId)).map((moduleId) => renderModule(moduleId))}
          </main>
        </div>
      </article>
    );
  }

  if (template === 'modern') {
    return (
      <article className="resume-page min-h-[297mm] w-[210mm] bg-white text-gray-900 shadow-xl print:shadow-none">
        <div className="px-12 py-9 text-white" style={{ backgroundColor: accent }}>
          <ResumeHeader resume={resume} accent={accent} inverted />
        </div>
        <div className="grid grid-cols-[1fr_62mm] gap-8 px-12 py-8">
          <main>{modules.filter((moduleId) => !sidebarModules.includes(moduleId)).map((moduleId) => renderModule(moduleId))}</main>
          <aside className="border-l border-gray-200 pl-6">
            {modules.filter((moduleId) => sidebarModules.includes(moduleId)).map((moduleId) => renderModule(moduleId, true))}
          </aside>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`resume-page min-h-[297mm] w-[210mm] bg-white text-gray-900 shadow-xl print:shadow-none ${pagePadding} ${
        compact ? 'text-[12px]' : ''
      }`}
    >
      <ResumeHeader resume={resume} accent={accent} compactText={compact} />
      {modules.map((moduleId) => renderModule(moduleId))}
    </article>
  );
}

function ResumeModule({
  moduleId,
  resume,
  accent,
  compact = false,
}: {
  moduleId: ResumeModuleId;
  resume: ResumeData;
  accent: string;
  compact?: boolean;
}) {
  if (moduleId === 'summary') {
    return (
      <PreviewSection title="个人简介" accent={accent} compact={compact}>
        <p className={`text-[12px] ${compact ? 'leading-snug' : 'leading-relaxed'}`}>{resume.basics.summary}</p>
      </PreviewSection>
    );
  }

  if (moduleId === 'work') {
    return (
      <PreviewSection title="工作经历" accent={accent} compact={compact}>
        <WorkList items={resume.work} compact={compact} />
      </PreviewSection>
    );
  }

  if (moduleId === 'projects') {
    return (
      <PreviewSection title="项目经历" accent={accent} compact={compact}>
        <ProjectList items={resume.projects} compact={compact} />
      </PreviewSection>
    );
  }

  if (moduleId === 'education') {
    return (
      <PreviewSection title="教育经历" accent={accent} compact={compact}>
        <EducationList items={resume.education} compact={compact} />
      </PreviewSection>
    );
  }

  if (moduleId === 'skills') {
    return (
      <PreviewSection title="技能" accent={accent} compact={compact}>
        <SkillTags skills={resume.skills} compact={compact} />
      </PreviewSection>
    );
  }

  if (moduleId === 'awards') {
    return (
      <PreviewSection title="荣誉奖项" accent={accent} compact={compact}>
        <AwardList items={resume.awards} compact={compact} />
      </PreviewSection>
    );
  }

  return (
    <>
      {resume.customSections.map((item) => (
        <PreviewSection key={item.id} title={item.title || '自定义模块'} accent={accent} compact={compact}>
          <BulletList items={item.content} compact={compact} />
        </PreviewSection>
      ))}
    </>
  );
}

function ResumeHeader({
  resume,
  accent,
  compact = false,
  compactText = false,
  sidebar = false,
  inverted = false,
  showAvatar = true,
}: {
  resume: ResumeData;
  accent: string;
  compact?: boolean;
  compactText?: boolean;
  sidebar?: boolean;
  inverted?: boolean;
  showAvatar?: boolean;
}) {
  const isCompactText = compact || compactText;
  const avatarSize = sidebar ? 'h-[72px] w-[72px]' : compactText ? 'h-[86px] w-[86px]' : 'h-[104px] w-[104px]';
  const contactItems = [
    resume.basics.phone,
    resume.basics.email,
    resume.basics.location,
    resume.basics.website,
    resume.basics.expectedSalary ? `期望 ${resume.basics.expectedSalary}` : '',
  ].filter(Boolean);
  const avatar = showAvatar && resume.basics.avatar ? (
    <img
      src={resume.basics.avatar}
      alt={`${resume.basics.name || '简历'}头像`}
      className={`${avatarSize} shrink-0 rounded-full object-cover`}
      style={{ border: `2px solid ${inverted ? 'rgba(255,255,255,.75)' : accent}` }}
    />
  ) : null;

  return (
    <header
      className={`${isCompactText || inverted ? 'mb-6 text-left' : 'mb-7 border-b pb-5'} ${
        sidebar ? 'block' : 'flex items-center justify-between gap-5'
      }`}
      style={{ borderColor: accent }}
    >
      <div className={`min-w-0 flex-1 ${sidebar ? 'space-y-4' : ''}`}>
        <div className={sidebar ? 'flex items-start justify-between gap-3' : ''}>
          <div className="min-w-0 flex-1">
            <h1
              className={`${isCompactText ? 'text-3xl' : 'text-4xl'} break-words font-bold`}
              style={{ color: inverted ? 'white' : accent }}
            >
              {resume.basics.name || '姓名'}
            </h1>
            <p className={`mt-1 text-sm font-medium ${inverted ? 'text-white/90' : 'text-gray-700'}`}>{resume.basics.title}</p>
          </div>
          {sidebar && avatar}
        </div>
        <div className={`${sidebar ? 'mt-4 space-y-1.5' : 'mt-3 flex flex-wrap gap-x-3 gap-y-1.5'} text-[11px]`}>
          {contactItems.map((item) => (
            <span
              key={item}
              className={`min-w-0 break-all ${
                sidebar
                  ? `block leading-snug ${inverted ? 'text-white/85' : 'text-gray-600'}`
                  : `rounded-full px-2 py-0.5 ${inverted ? 'bg-white/15 text-white/90' : 'bg-gray-100 text-gray-600'}`
              }`}
            >
              {item}
            </span>
          ))}
        </div>
      </div>
      {!sidebar && avatar}
    </header>
  );
}

function PreviewSection({
  title,
  accent,
  compact = false,
  children,
}: {
  title: string;
  accent: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={compact ? 'mb-3' : 'mb-5'}>
      <h2
        className={`${compact ? 'mb-1.5 text-[13px]' : 'mb-2 text-[15px]'} border-b pb-1 font-bold`}
        style={{ color: accent, borderColor: `${accent}66` }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function WorkList({ items, compact = false }: { items: ResumeWork[]; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {items.map((item) => (
        <div key={item.id}>
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="min-w-0 break-words text-[13px] font-bold">
              {[item.company, item.position].filter(Boolean).join(' · ') || '工作经历'}
            </h3>
            <span className="shrink-0 text-right text-[11px] text-gray-500">{dateRange(item.startDate, item.endDate)}</span>
          </div>
          {item.location && <p className="mt-0.5 text-[11px] text-gray-500">{item.location}</p>}
          <BulletList items={item.highlights} compact={compact} />
        </div>
      ))}
    </div>
  );
}

function ProjectList({ items, compact = false }: { items: ResumeProject[]; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {items.map((item) => (
        <div key={item.id}>
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="min-w-0 break-words text-[13px] font-bold">
              {item.name}
              {item.role && <span className="font-medium text-gray-600"> · {item.role}</span>}
            </h3>
            <span className="shrink-0 text-right text-[11px] text-gray-500">{dateRange(item.startDate, item.endDate)}</span>
          </div>
          {item.description && <p className="mt-1 text-[12px] leading-relaxed text-gray-700">{item.description}</p>}
          <BulletList items={item.highlights} compact={compact} />
        </div>
      ))}
    </div>
  );
}

function EducationList({ items, compact = false }: { items: ResumeEducation[]; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {items.map((item) => (
        <div key={item.id}>
          <div className={compact ? 'block' : 'flex items-baseline justify-between gap-4'}>
            <h3 className="break-words text-[13px] font-bold">{item.school || '学校名称'}</h3>
            <span className="shrink-0 text-[11px] text-gray-500">{dateRange(item.startDate, item.endDate)}</span>
          </div>
          <p className="text-[12px] text-gray-700">
            {[item.degree, item.major].filter(Boolean).join(' · ')}
          </p>
          {item.description && <p className="text-[11px] text-gray-500">{item.description}</p>}
        </div>
      ))}
    </div>
  );
}

function SkillTags({ skills, compact = false }: { skills: ResumeSkill[]; compact?: boolean }) {
  return (
    <div className={`flex flex-wrap ${compact ? 'gap-1' : 'gap-1.5'}`}>
      {skills.map((item) => (
        <span key={item.id} className="max-w-full break-words rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700">
          {item.name}
          {item.level && <span className="text-gray-500"> · {item.level}</span>}
          {item.keywords.length > 0 && <span className="text-gray-500"> · {item.keywords.join('、')}</span>}
        </span>
      ))}
    </div>
  );
}

function AwardList({ items, compact = false }: { items: ResumeAward[]; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      {items.map((item) => (
        <p key={item.id} className="text-[12px] leading-relaxed">
          {item.title}
          {item.issuer && <span className="text-gray-600"> · {item.issuer}</span>}
          {item.date && <span className="text-gray-500"> · {item.date}</span>}
        </p>
      ))}
    </div>
  );
}

function BulletList({ items, compact = false }: { items: string[]; compact?: boolean }) {
  if (items.length === 0) return null;
  return (
    <ul className={`mt-1 list-disc pl-4 text-[12px] leading-relaxed text-gray-700 ${compact ? 'space-y-0' : 'space-y-0.5'}`}>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}
