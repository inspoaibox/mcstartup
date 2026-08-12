import { useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  DownloadCloud,
  Edit2,
  FileText,
  Folder,
  Github,
  Globe,
  HardDrive,
  History,
  Layers,
  Library,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Star,
  Tags,
  Trash2,
  UploadCloud,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { writeText } from '@tauri-apps/api/clipboard';
import { open as openDialog, save as saveDialog } from '@tauri-apps/api/dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';
import {
  SKILLS_LIBRARY_VERSION,
  useToolDataStore,
  type ManagedSkillItem,
  type SkillActivity,
  type SkillAgent,
  type SkillPreset,
  type SkillsLibraryData,
  type SkillSourceType,
  type SkillSyncMode,
  type SkillSyncTarget,
  type SkillWorkspace,
  type SkillWorkspaceType,
} from '../stores/toolDataStore';

type ViewKey = 'library' | 'install' | 'workspace' | 'presets' | 'settings';
type InstallMode = 'paste' | 'local' | 'git';

const SOURCE_LABELS: Record<SkillSourceType, string> = {
  manual: '手动',
  local: '本地',
  git: 'Git',
  market: '市场',
};
const SOURCE_OPTIONS = Object.keys(SOURCE_LABELS) as SkillSourceType[];

const WORKSPACE_LABELS: Record<SkillWorkspaceType, string> = {
  global: '全局',
  project: '项目',
  linked: '关联',
};

const markdownComponents: Components = {
  a({ node: _node, children, ...props }) {
    return (
      <a {...props} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function nowIso() {
  return new Date().toISOString();
}

function idOf(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `skill-${Date.now()}`;
}

function splitTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，#\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function joinPath(base: string, child: string) {
  const separator = base.includes('\\') ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${separator}${child}`;
}

function uniqueValues<T>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseGitHubRepoRef(value: string) {
  const normalized = value.trim().replace(/\.git$/i, '');
  const match = normalized.match(
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/#?\s]+)(?:\/(?:tree|blob)\/([^/\s]+)(?:\/([^#?]+))?)?/i
  );
  if (!match) return null;
  return {
    owner: decodeURIComponent(match[1]),
    repo: decodeURIComponent(match[2].replace(/\.git$/i, '')),
    branch: match[3] ? decodeURIComponent(match[3]) : undefined,
    subpath: match[4] ? decodeURIComponent(match[4]).replace(/^\/+|\/+$/g, '') : '',
  };
}

async function readRemoteText(url: string) {
  return invoke<string>('http_get', {
    url,
    headers: { Accept: 'text/plain,*/*' },
    connectionMode: 'auto',
    proxyUrl: null,
  });
}

async function fetchGitHubSkillDocument(repoUrl: string, preferredBranch?: string) {
  const ref = parseGitHubRepoRef(repoUrl);
  if (!ref) return null;

  const branches = uniqueValues([preferredBranch?.trim(), ref.branch, 'main', 'master']);
  const docs = ['SKILL.md', 'skill.md', 'README.md', 'README.zh-CN.md', 'README.zh.md', 'readme.md'];

  for (const branch of branches) {
    for (const doc of docs) {
      const filePath = [ref.subpath, doc].filter(Boolean).join('/');
      const rawUrl = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${branch}/${filePath}`;
      try {
        const content = await readRemoteText(rawUrl);
        if (content.trim()) {
          return { content, branch, path: filePath, url: rawUrl };
        }
      } catch {
        // Continue trying the common skill/documentation entry points.
      }
    }
  }

  return null;
}

function getTargetBaseDir(skill: ManagedSkillItem, agent: SkillAgent) {
  const targetPath = skill.targets.find((target) => target.agentKey === agent.key)?.targetPath;
  if (!targetPath || /(?:^|[\\/])SKILL\.md$/i.test(targetPath)) return agent.globalPath;
  return targetPath;
}

function formatDate(value?: string) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sourceIcon(type: SkillSourceType): LucideIcon {
  if (type === 'git') return Github;
  if (type === 'local') return HardDrive;
  if (type === 'market') return Globe;
  return FileText;
}

function parseSkillMarkdown(content: string, fallbackName = '未命名 Skill') {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const frontmatterTags = content.match(/^tags:\s*\[?([^\]\n]+)\]?/m)?.[1] || '';
  const lines = content.split(/\r?\n/);
  const firstText = lines.find((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---') && !trimmed.includes(':');
  });
  const name = heading || fallbackName;
  return {
    name,
    slug: slugify(name),
    description: firstText?.trim() || '从 SKILL.md 导入',
    tags: splitTags(frontmatterTags),
  };
}

function makeTargets(agentKeys: string[], agents: SkillAgent[], mode: SkillSyncMode) {
  return agentKeys.map<SkillSyncTarget>((agentKey) => ({
    agentKey,
    enabled: true,
    mode,
    status: 'pending',
    targetPath: agents.find((agent) => agent.key === agentKey)?.globalPath,
  }));
}

function generateSkillMarkdown(skill: ManagedSkillItem, agents: SkillAgent[]) {
  const lines = [
    `# ${skill.name}`,
    '',
    skill.description,
    '',
    '## Metadata',
    `- Slug: ${skill.slug}`,
    `- Source: ${SOURCE_LABELS[skill.source.type]}`,
  ];

  if (skill.source.ref) lines.push(`- Source Ref: ${skill.source.ref}`);
  if (skill.source.branch) lines.push(`- Branch: ${skill.source.branch}`);
  if (skill.source.revision) lines.push(`- Revision: ${skill.source.revision}`);
  if (skill.tags.length) lines.push(`- Tags: ${skill.tags.join(', ')}`);
  if (skill.targets.length) {
    const labels = skill.targets
      .filter((target) => target.enabled)
      .map((target) => agents.find((agent) => agent.key === target.agentKey)?.name || target.agentKey);
    lines.push(`- Agents: ${labels.join(', ') || '无'}`);
  }

  lines.push('', '## Skill', '', skill.content || '');
  return lines.join('\n').trim();
}

async function copyText(value: string) {
  try {
    await writeText(value);
  } catch (error) {
    if (document.hasFocus() && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    throw error;
  }
}

function statusClass(status: ManagedSkillItem['updateStatus']) {
  if (status === 'current') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300';
  if (status === 'update-available') return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300';
  if (status === 'error') return 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
}

function statusLabel(status: ManagedSkillItem['updateStatus']) {
  if (status === 'current') return '已是最新';
  if (status === 'update-available') return '可更新';
  if (status === 'error') return '检查失败';
  return '未检查';
}

export default function SkillsLibraryTool() {
  const ready = useToolTheme();
  const { data, loaded, loading, loadData, updateSkillsLibraryData } = useToolDataStore();
  const [view, setView] = useState<ViewKey>('library');
  const [installMode, setInstallMode] = useState<InstallMode>('paste');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | SkillSourceType>('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editingSkill, setEditingSkill] = useState<ManagedSkillItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const library = data.skillsLibrary;
  const skills = library?.version === SKILLS_LIBRARY_VERSION ? library.skills : [];
  const presets = library?.version === SKILLS_LIBRARY_VERSION ? library.presets : [];
  const workspaces = library?.version === SKILLS_LIBRARY_VERSION ? library.workspaces : [];
  const agents = library?.version === SKILLS_LIBRARY_VERSION ? library.agents : [];
  const activityLog = library?.version === SKILLS_LIBRARY_VERSION ? library.activityLog : [];
  const syncMode = library?.version === SKILLS_LIBRARY_VERSION ? library.syncMode : 'copy';
  const baseDir = library?.version === SKILLS_LIBRARY_VERSION ? library.baseDir : '~/.mcheng/skills-manager';
  const gitRemote = library?.version === SKILLS_LIBRARY_VERSION ? library.gitRemote || '' : '';

  useEffect(() => {
    if (!loaded && !loading) {
      loadData();
    }
  }, [loadData, loaded, loading]);

  const activeSkills = useMemo(() => skills.filter((skill) => skill.status !== 'disabled'), [skills]);

  useEffect(() => {
    if (!detailId && activeSkills.length > 0) {
      setDetailId(activeSkills[0].id);
    }
    if (detailId && !activeSkills.some((skill) => skill.id === detailId)) {
      setDetailId(activeSkills[0]?.id || null);
    }
  }, [activeSkills, detailId]);

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2200);
  };

  const savePatch = (
    patch: Partial<SkillsLibraryData>,
    log?: Omit<SkillActivity, 'id' | 'createdAt'>
  ) => {
    const nextPatch = { ...patch };
    if (log) {
      const nextActivityLog = patch.activityLog || activityLog;
      nextPatch.activityLog = [
        {
          id: idOf('act'),
          createdAt: nowIso(),
          ...log,
        },
        ...nextActivityLog,
      ].slice(0, 160);
    }
    updateSkillsLibraryData(nextPatch);
  };

  const allTags = useMemo(
    () => Array.from(new Set(skills.flatMap((skill) => skill.tags))).sort((a, b) => a.localeCompare(b)),
    [skills]
  );

  const filteredSkills = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return skills
      .filter((skill) => skill.status !== 'disabled')
      .filter((skill) => {
        if (sourceFilter !== 'all' && skill.source.type !== sourceFilter) return false;
        if (tagFilter !== 'all' && !skill.tags.includes(tagFilter)) return false;
        if (agentFilter === 'untargeted' && skill.targets.some((target) => target.enabled)) return false;
        if (
          agentFilter !== 'all' &&
          agentFilter !== 'untargeted' &&
          !skill.targets.some((target) => target.agentKey === agentFilter && target.enabled)
        ) {
          return false;
        }
        if (!keyword) return true;
        return (
          skill.name.toLowerCase().includes(keyword) ||
          skill.slug.toLowerCase().includes(keyword) ||
          skill.description.toLowerCase().includes(keyword) ||
          skill.tags.some((tag) => tag.toLowerCase().includes(keyword)) ||
          skill.content.toLowerCase().includes(keyword) ||
          (skill.source.ref || '').toLowerCase().includes(keyword)
        );
      })
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt));
  }, [agentFilter, search, skills, sourceFilter, tagFilter]);

  const selectedSkill = activeSkills.find((skill) => skill.id === detailId) || null;
  const syncedTargetCount = activeSkills.reduce(
    (total, skill) => total + skill.targets.filter((target) => target.enabled && target.status === 'synced').length,
    0
  );

  const upsertSkill = (skill: ManagedSkillItem) => {
    const exists = skills.some((item) => item.id === skill.id);
    const nextSkills = exists
      ? skills.map((item) => (item.id === skill.id ? skill : item))
      : [skill, ...skills];
    savePatch(
      { skills: nextSkills },
      {
        action: exists ? 'update_skill' : 'create_skill',
        skillId: skill.id,
        message: `${exists ? '更新' : '新增'} ${skill.name}`,
      }
    );
    setDetailId(skill.id);
    setEditorOpen(false);
    setEditingSkill(null);
    notify(exists ? '已保存 Skill' : '已加入中央库');
  };

  const deleteSkills = (ids: string[]) => {
    if (ids.length === 0) return;
    if (!confirm(`确定删除 ${ids.length} 个 Skill 吗？`)) return;
    const idSet = new Set(ids);
    savePatch(
      {
        skills: skills.filter((skill) => !idSet.has(skill.id)),
        presets: presets.map((preset) => ({
          ...preset,
          skillIds: preset.skillIds.filter((id) => !idSet.has(id)),
          updatedAt: nowIso(),
        })),
        workspaces: workspaces.map((workspace) => ({
          ...workspace,
          skillIds: workspace.skillIds.filter((id) => !idSet.has(id)),
          updatedAt: nowIso(),
        })),
      },
      {
        action: 'delete_skill',
        message: `删除 ${ids.length} 个 Skill`,
      }
    );
    setSelectedIds([]);
    notify('已删除');
  };

  const toggleFavorite = (skillId: string) => {
    savePatch({
      skills: skills.map((skill) =>
        skill.id === skillId ? { ...skill, favorite: !skill.favorite, updatedAt: nowIso() } : skill
      ),
    });
  };

  const installSkillTargets = async (ids: string[], explicitAgentKeys?: string[]) => {
    const targetIds = new Set(ids);
    const selectedSkills = skills.filter((skill) => targetIds.has(skill.id) && skill.status !== 'disabled');
    if (selectedSkills.length === 0) {
      notify('没有可写入的 Skill');
      return;
    }

    const installed = new Map<string, Map<string, string>>();
    try {
      for (const skill of selectedSkills) {
        const assignedKeys = skill.targets.filter((target) => target.enabled).map((target) => target.agentKey);
        const agentKeys = explicitAgentKeys?.length ? explicitAgentKeys : assignedKeys;
        for (const agentKey of uniqueValues(agentKeys)) {
          const agent = agents.find((item) => item.key === agentKey && item.enabled);
          if (!agent) continue;
          const outputPath = await invoke<string>('install_skill_to_agent', {
            skillSlug: skill.slug || slugify(skill.name),
            targetDir: getTargetBaseDir(skill, agent),
            content: generateSkillMarkdown(skill, agents),
          });
          if (!installed.has(skill.id)) installed.set(skill.id, new Map());
          installed.get(skill.id)!.set(agent.key, outputPath);
        }
      }
    } catch (error) {
      notify(`写入失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const installedCount = Array.from(installed.values()).reduce((total, item) => total + item.size, 0);
    if (installedCount === 0) {
      notify('没有启用或分配的 Agent');
      return;
    }

    const syncedAt = nowIso();
    savePatch(
      {
        skills: skills.map((skill) =>
          installed.has(skill.id)
            ? (() => {
                const installedTargets = installed.get(skill.id)!;
                const targetMap = new Map(skill.targets.map((target) => [target.agentKey, target]));
                installedTargets.forEach((_outputPath, agentKey) => {
                  const agent = agents.find((item) => item.key === agentKey);
                  const existing = targetMap.get(agentKey);
                  targetMap.set(agentKey, {
                    agentKey,
                    enabled: true,
                    mode: existing?.mode || syncMode,
                    status: 'synced',
                    targetPath: existing?.targetPath || agent?.globalPath,
                    syncedAt,
                  });
                });
                return { ...skill, targets: Array.from(targetMap.values()), updatedAt: syncedAt, lastUsedAt: syncedAt };
              })()
            : skill
        ),
      },
      {
        action: 'sync_skill',
        message: `写入 ${selectedSkills.length} 个 Skill 到 ${installedCount} 个 Agent`,
      }
    );
    notify(`已写入 ${installedCount} 个 Agent 目标`);
  };

  const toggleSkillTarget = (skillId: string, agentKey: string) => {
    const time = nowIso();
    savePatch({
      skills: skills.map((skill) => {
        if (skill.id !== skillId) return skill;
        const existing = skill.targets.find((target) => target.agentKey === agentKey);
        const nextTargets: SkillSyncTarget[] = existing
          ? skill.targets.map((target) =>
                  target.agentKey === agentKey
                ? {
                    ...target,
                    enabled: !target.enabled,
                    status: target.enabled ? ('disabled' as const) : ('pending' as const),
                  }
                : target
            )
          : [
              ...skill.targets,
              {
                agentKey,
                enabled: true,
                mode: syncMode,
                status: 'pending',
                targetPath: agents.find((agent) => agent.key === agentKey)?.globalPath,
              } satisfies SkillSyncTarget,
            ];
        return { ...skill, targets: nextTargets, updatedAt: time };
      }),
    });
  };

  const createPresetFromSelection = () => {
    if (selectedIds.length === 0) {
      notify('先选择 Skill');
      return;
    }
    const name = window.prompt('Preset 名称', '新预设');
    if (!name?.trim()) return;
    const time = nowIso();
    const preset: SkillPreset = {
      id: idOf('preset'),
      name: name.trim(),
      description: '',
      icon: 'Layers',
      skillIds: selectedIds,
      agentKeys: agents.filter((agent) => agent.enabled).map((agent) => agent.key),
      sortOrder: presets.length,
      createdAt: time,
      updatedAt: time,
    };
    savePatch(
      {
        presets: [...presets, preset],
        skills: skills.map((skill) =>
          selectedIds.includes(skill.id)
            ? { ...skill, presetIds: Array.from(new Set([...skill.presetIds, preset.id])) }
            : skill
        ),
      },
      {
        action: 'create_preset',
        message: `创建 Preset ${preset.name}`,
      }
    );
    setView('presets');
    notify('Preset 已创建');
  };

  const applyPreset = (preset: SkillPreset) => {
    const time = nowIso();
    const agentKeys = preset.agentKeys.length ? preset.agentKeys : agents.filter((agent) => agent.enabled).map((agent) => agent.key);
    savePatch(
      {
        skills: skills.map((skill) => {
          if (!preset.skillIds.includes(skill.id)) return skill;
          const targetMap = new Map(skill.targets.map((target) => [target.agentKey, target]));
          for (const agentKey of agentKeys) {
            const target = targetMap.get(agentKey);
            targetMap.set(agentKey, {
              agentKey,
              enabled: true,
              mode: target?.mode || syncMode,
              status: 'synced',
              targetPath: target?.targetPath || agents.find((agent) => agent.key === agentKey)?.globalPath,
              syncedAt: time,
            });
          }
          return { ...skill, targets: Array.from(targetMap.values()), updatedAt: time };
        }),
      },
      {
        action: 'apply_preset',
        message: `应用 Preset ${preset.name}`,
      }
    );
    notify('Preset 已应用');
  };

  const importMarkdownSkill = (
    content: string,
    sourceType: SkillSourceType,
    sourceRef?: string,
    agentKeys: string[] = []
  ) => {
    const parsed = parseSkillMarkdown(content, sourceRef?.split(/[\\/]/).pop()?.replace(/\.(md|skill)$/i, ''));
    const time = nowIso();
    const skill: ManagedSkillItem = {
      id: idOf('skill'),
      name: parsed.name,
      slug: parsed.slug,
      description: parsed.description,
      tags: parsed.tags,
      source: {
        type: sourceType,
        ref: sourceRef,
        resolved: sourceRef,
      },
      content,
      files: [{ path: 'SKILL.md', content, language: 'markdown' }],
      status: 'active',
      updateStatus: 'unchecked',
      targets: makeTargets(agentKeys, agents, syncMode),
      presetIds: [],
      workspaceIds: [],
      favorite: false,
      createdAt: time,
      updatedAt: time,
    };
    upsertSkill(skill);
  };

  const copySkill = async (skill: ManagedSkillItem) => {
    await copyText(generateSkillMarkdown(skill, agents));
    const time = nowIso();
    savePatch({
      skills: skills.map((item) => (item.id === skill.id ? { ...item, lastUsedAt: time, updatedAt: time } : item)),
    });
    notify('已复制');
  };

  const exportSkill = async (skill: ManagedSkillItem) => {
    const target = await saveDialog({
      title: '导出 SKILL.md',
      defaultPath: `${skill.slug || 'SKILL'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!target) return;
    await writeTextFile(target, generateSkillMarkdown(skill, agents));
    notify('已导出');
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon={<Sparkles size={18} />}
        title="AI Skills Manager"
        subtitle={`${activeSkills.length} Skills · ${syncedTargetCount} Targets · ${presets.length} Presets`}
        closeMode="hide"
        actions={
          <>
          <button
            onClick={() => {
              setInstallMode('paste');
              setView('install');
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            <DownloadCloud size={15} />
            导入
          </button>
          <button
            onClick={() => {
              setEditingSkill(null);
              setEditorOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900"
          >
            <Plus size={15} />
            新建
          </button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 flex-col border-r border-gray-200 bg-gray-50/80 p-3 dark:border-gray-800 dark:bg-gray-900/60">
          <nav className="space-y-1">
            <NavButton icon={Library} label="技能库" active={view === 'library'} onClick={() => setView('library')} />
            <NavButton icon={DownloadCloud} label="安装导入" active={view === 'install'} onClick={() => setView('install')} />
            <NavButton icon={Users} label="工作区" active={view === 'workspace'} onClick={() => setView('workspace')} />
            <NavButton icon={Layers} label="Presets" active={view === 'presets'} onClick={() => setView('presets')} />
            <NavButton icon={Settings} label="设置与日志" active={view === 'settings'} onClick={() => setView('settings')} />
          </nav>

          <div className="mt-4 space-y-3">
            <FilterBlock title="Agent">
              <SideFilter active={agentFilter === 'all'} onClick={() => setAgentFilter('all')}>
                全部 Agent
              </SideFilter>
              <SideFilter active={agentFilter === 'untargeted'} onClick={() => setAgentFilter('untargeted')}>
                未分配
              </SideFilter>
              {agents.map((agent) => (
                <SideFilter key={agent.key} active={agentFilter === agent.key} onClick={() => setAgentFilter(agent.key)}>
                  {agent.name}
                </SideFilter>
              ))}
            </FilterBlock>

            <FilterBlock title="标签">
              <SideFilter active={tagFilter === 'all'} onClick={() => setTagFilter('all')}>
                全部标签
              </SideFilter>
              {allTags.slice(0, 12).map((tag) => (
                <SideFilter key={tag} active={tagFilter === tag} onClick={() => setTagFilter(tag)}>
                  #{tag}
                </SideFilter>
              ))}
            </FilterBlock>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {view === 'library' && (
            <LibraryView
              skills={filteredSkills}
              allSkills={skills}
              agents={agents}
              search={search}
              sourceFilter={sourceFilter}
              selectedIds={selectedIds}
              onSearch={setSearch}
              onSourceFilter={setSourceFilter}
              onSelectIds={setSelectedIds}
              onOpen={setDetailId}
              onEdit={(skill) => {
                setEditingSkill(skill);
                setEditorOpen(true);
              }}
              onDelete={(id) => deleteSkills([id])}
              onToggleFavorite={toggleFavorite}
              onCopy={copySkill}
              onSyncSelected={() => void installSkillTargets(selectedIds)}
              onDeleteSelected={() => deleteSkills(selectedIds)}
              onCreatePreset={createPresetFromSelection}
            />
          )}

          {view === 'install' && (
            <InstallView
              mode={installMode}
              setMode={setInstallMode}
              agents={agents}
              syncMode={syncMode}
              onImportMarkdown={importMarkdownSkill}
              onCreateSkill={upsertSkill}
              onNotice={notify}
            />
          )}

          {view === 'workspace' && (
            <WorkspaceView
              skills={activeSkills}
              agents={agents}
              workspaces={workspaces}
              syncMode={syncMode}
              onPatch={savePatch}
              onToggleTarget={toggleSkillTarget}
              onOpenSkill={setDetailId}
              onNotice={notify}
            />
          )}

          {view === 'presets' && (
            <PresetsView
              skills={activeSkills}
              agents={agents}
              presets={presets}
              onPatch={savePatch}
              onApply={applyPreset}
              onOpenSkill={setDetailId}
            />
          )}

          {view === 'settings' && (
            <SettingsView
              baseDir={baseDir}
              gitRemote={gitRemote}
              syncMode={syncMode}
              agents={agents}
              activityLog={activityLog}
              skills={skills}
              presets={presets}
              workspaces={workspaces}
              onPatch={savePatch}
              onNotice={notify}
            />
          )}
        </main>

        {view === 'library' && selectedSkill && (
          <SkillDetailPanel
            skill={selectedSkill}
            agents={agents}
            presets={presets}
            workspaces={workspaces}
            onClose={() => setDetailId(null)}
            onEdit={() => {
              setEditingSkill(selectedSkill);
              setEditorOpen(true);
            }}
            onCopy={() => copySkill(selectedSkill)}
            onExport={() => exportSkill(selectedSkill)}
            onToggleFavorite={() => toggleFavorite(selectedSkill.id)}
            onToggleTarget={(agentKey) => toggleSkillTarget(selectedSkill.id, agentKey)}
            onInstallAgent={(agentKey) => void installSkillTargets([selectedSkill.id], [agentKey])}
            onInstallAll={() => {
              const assignedKeys = selectedSkill.targets.filter((target) => target.enabled).map((target) => target.agentKey);
              const fallbackKeys = agents.filter((agent) => agent.enabled).map((agent) => agent.key);
              void installSkillTargets([selectedSkill.id], assignedKeys.length ? assignedKeys : fallbackKeys);
            }}
            onDelete={() => deleteSkills([selectedSkill.id])}
          />
        )}
      </div>

      {editorOpen && (
        <SkillEditorDialog
          skill={editingSkill}
          agents={agents}
          syncMode={syncMode}
          onClose={() => {
            setEditorOpen(false);
            setEditingSkill(null);
          }}
          onSave={upsertSkill}
        />
      )}

      {notice && (
        <div className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-gray-900">
          {notice}
        </div>
      )}
    </div>
  );
}

function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
        active
          ? 'bg-white font-medium text-gray-950 shadow-sm dark:bg-gray-800 dark:text-white'
          : 'text-gray-600 hover:bg-white hover:text-gray-950 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
      )}
    >
      <Icon size={16} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function FilterBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function SideFilter({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-full truncate rounded-md px-2 py-1.5 text-left text-xs',
        active
          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
          : 'text-gray-600 hover:bg-white dark:text-gray-400 dark:hover:bg-gray-800'
      )}
    >
      {children}
    </button>
  );
}

function LibraryView({
  skills,
  allSkills,
  agents,
  search,
  sourceFilter,
  selectedIds,
  onSearch,
  onSourceFilter,
  onSelectIds,
  onOpen,
  onEdit,
  onDelete,
  onToggleFavorite,
  onCopy,
  onSyncSelected,
  onDeleteSelected,
  onCreatePreset,
}: {
  skills: ManagedSkillItem[];
  allSkills: ManagedSkillItem[];
  agents: SkillAgent[];
  search: string;
  sourceFilter: 'all' | SkillSourceType;
  selectedIds: string[];
  onSearch: (value: string) => void;
  onSourceFilter: (value: 'all' | SkillSourceType) => void;
  onSelectIds: (ids: string[]) => void;
  onOpen: (id: string) => void;
  onEdit: (skill: ManagedSkillItem) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onCopy: (skill: ManagedSkillItem) => void;
  onSyncSelected: () => void;
  onDeleteSelected: () => void;
  onCreatePreset: () => void;
}) {
  const visibleIds = skills.map((skill) => skill.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const activeSkills = allSkills.filter((skill) => skill.status !== 'disabled');

  const toggle = (id: string) => {
    onSelectIds(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-gray-200 p-3 dark:border-gray-800">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
            <Search size={16} className="text-gray-400" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="搜索 Skill、标签、来源、内容"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            {search && (
              <button onClick={() => onSearch('')} className="text-gray-400 hover:text-gray-700">
                <X size={15} />
              </button>
            )}
          </div>
          <select
            value={sourceFilter}
            onChange={(event) => onSourceFilter(event.target.value as 'all' | SkillSourceType)}
            className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="all">全部来源</option>
            {SOURCE_OPTIONS.map((key) => (
              <option key={key} value={key}>
                {SOURCE_LABELS[key]}
              </option>
            ))}
          </select>
          <button
            onClick={() => onSelectIds(allSelected ? [] : visibleIds)}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            <ListChecks size={15} />
            {allSelected ? '取消' : '全选'}
          </button>
        </div>

        {selectedIds.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm dark:bg-gray-900">
            <span className="font-medium">{selectedIds.length} 已选</span>
            <button onClick={onSyncSelected} className="rounded px-2 py-1 hover:bg-white dark:hover:bg-gray-800">
              写入 Agent
            </button>
            <button onClick={onCreatePreset} className="rounded px-2 py-1 hover:bg-white dark:hover:bg-gray-800">
              建 Preset
            </button>
            <button onClick={onDeleteSelected} className="rounded px-2 py-1 text-rose-600 hover:bg-white dark:hover:bg-gray-800">
              删除
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-px border-b border-gray-200 bg-gray-200 text-xs dark:border-gray-800 dark:bg-gray-800">
        <Metric label="中央库" value={activeSkills.length} />
        <Metric label="收藏" value={activeSkills.filter((skill) => skill.favorite).length} />
        <Metric label="可更新" value={activeSkills.filter((skill) => skill.updateStatus === 'update-available').length} />
        <Metric label="未分配" value={activeSkills.filter((skill) => !skill.targets.some((target) => target.enabled)).length} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {skills.length === 0 ? (
          <EmptyState icon={Library} title="中央库为空" action="去安装导入" />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                agents={agents}
                selected={selectedIds.includes(skill.id)}
                onToggleSelect={() => toggle(skill.id)}
                onOpen={() => onOpen(skill.id)}
                onEdit={() => onEdit(skill)}
                onDelete={() => onDelete(skill.id)}
                onToggleFavorite={() => onToggleFavorite(skill.id)}
                onCopy={() => onCopy(skill)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white px-4 py-3 dark:bg-gray-950">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-gray-500">{label}</div>
    </div>
  );
}

function SkillCard({
  skill,
  agents,
  selected,
  onToggleSelect,
  onOpen,
  onEdit,
  onDelete,
  onToggleFavorite,
  onCopy,
}: {
  skill: ManagedSkillItem;
  agents: SkillAgent[];
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onCopy: () => void;
}) {
  const SourceIcon = sourceIcon(skill.source.type);

  return (
    <article
      className={cn(
        'rounded-lg border bg-white p-3 transition-colors dark:bg-gray-900',
        selected ? 'border-gray-900 dark:border-white' : 'border-gray-200 hover:border-gray-400 dark:border-gray-800'
      )}
    >
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1" />
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <SourceIcon size={15} className="text-gray-500" />
            <h3 className="truncate text-sm font-semibold">{skill.name}</h3>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px]', statusClass(skill.updateStatus))}>
              {statusLabel(skill.updateStatus)}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-600 dark:text-gray-400">{skill.description}</p>
        </button>
        <button onClick={onToggleFavorite} className="text-gray-400 hover:text-amber-500" title="收藏">
          <Star size={16} fill={skill.favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {skill.tags.slice(0, 5).map((tag) => (
          <span key={tag} className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            #{tag}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {agents.slice(0, 7).map((agent) => {
            const target = skill.targets.find((item) => item.agentKey === agent.key);
            const enabled = Boolean(target?.enabled);
            return (
              <span
                key={agent.key}
                title={agent.name}
                className={cn(
                  'inline-flex h-6 min-w-6 items-center justify-center rounded border px-1 text-[10px] font-medium',
                  enabled
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                    : 'border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-800 dark:bg-gray-950'
                )}
              >
                {agent.name.slice(0, 2)}
              </span>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <IconButton icon={Copy} title="复制" onClick={onCopy} />
          <IconButton icon={Edit2} title="编辑" onClick={onEdit} />
          <IconButton icon={Trash2} title="删除" onClick={onDelete} danger />
        </div>
      </div>
    </article>
  );
}

function IconButton({
  icon: Icon,
  title,
  onClick,
  danger = false,
}: {
  icon: LucideIcon;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={title}
      className={cn(
        'rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200',
        danger && 'hover:text-rose-600'
      )}
    >
      <Icon size={15} />
    </button>
  );
}

function InstallView({
  mode,
  setMode,
  agents,
  syncMode,
  onImportMarkdown,
  onCreateSkill,
  onNotice,
}: {
  mode: InstallMode;
  setMode: (mode: InstallMode) => void;
  agents: SkillAgent[];
  syncMode: SkillSyncMode;
  onImportMarkdown: (
    content: string,
    sourceType: SkillSourceType,
    sourceRef?: string,
    agentKeys?: string[]
  ) => void;
  onCreateSkill: (skill: ManagedSkillItem) => void;
  onNotice: (message: string) => void;
}) {
  const [pasteContent, setPasteContent] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [gitName, setGitName] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [targetKeys, setTargetKeys] = useState<string[]>([]);
  const [gitLoading, setGitLoading] = useState(false);

  const selectedAgents = targetKeys.length ? targetKeys : [];

  const addGitSkill = async () => {
    if (!gitUrl.trim()) return;
    setGitLoading(true);
    try {
      const repoUrl = gitUrl.trim();
      const fetched = await fetchGitHubSkillDocument(repoUrl, gitBranch.trim()).catch(() => null);
      const name =
        gitName.trim() ||
        (fetched?.content ? parseSkillMarkdown(fetched.content).name : '') ||
        repoUrl.replace(/\.git$/i, '').split('/').pop() ||
        'Git Skill';
      const time = nowIso();
      const content = fetched?.content || `# ${name}\n\n## Trigger\n\n## Workflow\n\n## Output\n`;
      const parsed = parseSkillMarkdown(content, name);
      onCreateSkill({
        id: idOf('skill'),
        name: parsed.name,
        slug: parsed.slug,
        description: parsed.description || `Git 仓库导入：${repoUrl}`,
        tags: Array.from(new Set(['git', ...parsed.tags])),
        source: {
          type: 'git',
          ref: repoUrl,
          resolved: fetched?.url || repoUrl,
          branch: fetched?.branch || gitBranch.trim() || undefined,
          subpath: fetched?.path,
        },
        content,
        files: [{ path: fetched?.path || 'SKILL.md', content, language: 'markdown' }],
        status: 'active',
        updateStatus: 'unchecked',
        targets: makeTargets(selectedAgents, agents, syncMode),
        presetIds: [],
        workspaceIds: [],
        favorite: false,
        createdAt: time,
        updatedAt: time,
      });
      onNotice(fetched ? `已读取 ${fetched.path}` : '未找到 SKILL/README，已创建 Git 占位 Skill');
      setGitUrl('');
      setGitName('');
      setGitBranch('');
    } finally {
      setGitLoading(false);
    }
  };
  const importSkillMdFile = async () => {
    const selected = await openDialog({
      title: '选择 SKILL.md',
      multiple: false,
      filters: [{ name: 'Skill', extensions: ['md', 'skill'] }],
    });
    if (!selected || Array.isArray(selected)) return;
    const content = await readTextFile(selected);
    onImportMarkdown(content, 'local', selected, selectedAgents);
  };

  const importSkillFolder = async () => {
    const selected = await openDialog({ title: '选择 Skill 文件夹', directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    let content = '';
    try {
      content = await readTextFile(joinPath(selected, 'SKILL.md'));
    } catch {
      try {
        content = await readTextFile(joinPath(selected, 'README.md'));
      } catch {
        const name = selected.split(/[\\/]/).filter(Boolean).pop() || 'Local Skill';
        content = `# ${name}\n\n## Trigger\n\n## Workflow\n\n## Output\n`;
      }
    }
    onImportMarkdown(content, 'local', selected, selectedAgents);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap gap-2">
        <ModeButton active={mode === 'paste'} icon={FileText} label="粘贴 SKILL.md" onClick={() => setMode('paste')} />
        <ModeButton active={mode === 'local'} icon={Folder} label="本地导入" onClick={() => setMode('local')} />
        <ModeButton active={mode === 'git'} icon={Github} label="Git 仓库" onClick={() => setMode('git')} />
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">目标 Agent</span>
          {agents.map((agent) => (
            <button
              key={agent.key}
              onClick={() =>
                setTargetKeys(
                  targetKeys.includes(agent.key)
                    ? targetKeys.filter((key) => key !== agent.key)
                    : [...targetKeys, agent.key]
                )
              }
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                targetKeys.includes(agent.key)
                  ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                  : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'
              )}
            >
              {agent.name}
            </button>
          ))}
        </div>

        {mode === 'paste' && (
          <div className="space-y-3">
            <textarea
              value={pasteContent}
              onChange={(event) => setPasteContent(event.target.value)}
              rows={18}
              placeholder="# Skill name"
              className="w-full rounded-md border border-gray-200 bg-white p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-700 dark:bg-gray-950"
            />
            <button
              onClick={() => {
                if (!pasteContent.trim()) return;
                onImportMarkdown(pasteContent, 'manual', undefined, selectedAgents);
                setPasteContent('');
              }}
              className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900"
            >
              <UploadCloud size={16} />
              加入中央库
            </button>
          </div>
        )}

        {mode === 'local' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <ActionTile icon={FileText} title="导入 SKILL.md" onClick={importSkillMdFile} />
            <ActionTile icon={Folder} title="导入 Skill 文件夹" onClick={importSkillFolder} />
          </div>
        )}

        {mode === 'git' && (
          <div className="grid max-w-2xl gap-3">
            <Input label="仓库 URL" value={gitUrl} onChange={setGitUrl} placeholder="https://github.com/user/repo.git" />
            <Input label="名称" value={gitName} onChange={setGitName} placeholder="可留空" />
            <Input label="分支" value={gitBranch} onChange={setGitBranch} placeholder="main / master" />
            <button
              onClick={() => void addGitSkill()}
              disabled={gitLoading}
              className="inline-flex w-fit items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-gray-900"
            >
              {gitLoading ? <RefreshCw size={16} className="animate-spin" /> : <Github size={16} />}
              {gitLoading ? '读取文档中' : '读取并加入'}
            </button>
          </div>
        )}
      </section>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <SmallInfo icon={Database} label="中央目录" value="~/.mcheng/skills-manager" />
        <SmallInfo icon={RefreshCw} label="同步模式" value={syncMode === 'copy' ? '复制' : '软链接'} />
        <SmallInfo icon={Users} label="目标选择" value={selectedAgents.length ? `${selectedAgents.length} Agents` : '未自动分配'} />
      </div>

      <button onClick={() => onNotice('安装导入面板已就绪')} className="mt-4 text-xs text-gray-400 hover:text-gray-700">
        状态检查
      </button>
    </div>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
        active
          ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
      )}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function ActionTile({ icon: Icon, title, onClick }: { icon: LucideIcon; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left hover:border-gray-400 dark:border-gray-800 dark:bg-gray-950"
    >
      <div className="rounded-md bg-gray-100 p-2 dark:bg-gray-800">
        <Icon size={18} />
      </div>
      <span className="font-medium">{title}</span>
      <ChevronRight size={16} className="ml-auto text-gray-400" />
    </button>
  );
}

function WorkspaceView({
  skills,
  agents,
  workspaces,
  syncMode,
  onPatch,
  onToggleTarget,
  onOpenSkill,
  onNotice,
}: {
  skills: ManagedSkillItem[];
  agents: SkillAgent[];
  workspaces: SkillWorkspace[];
  syncMode: SkillSyncMode;
  onPatch: (patch: Partial<SkillsLibraryData>, log?: Omit<SkillActivity, 'id' | 'createdAt'>) => void;
  onToggleTarget: (skillId: string, agentKey: string) => void;
  onOpenSkill: (id: string) => void;
  onNotice: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [type, setType] = useState<SkillWorkspaceType>('project');

  const createWorkspace = () => {
    if (!name.trim() || !path.trim()) return;
    const time = nowIso();
    const workspace: SkillWorkspace = {
      id: idOf('workspace'),
      name: name.trim(),
      path: path.trim(),
      type,
      agentKeys: agents.filter((agent) => agent.enabled).map((agent) => agent.key),
      skillIds: [],
      createdAt: time,
      updatedAt: time,
    };
    onPatch(
      { workspaces: [...workspaces, workspace] },
      { action: 'create_workspace', message: `创建工作区 ${workspace.name}` }
    );
    setName('');
    setPath('');
    onNotice('工作区已创建');
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section>
          <h2 className="mb-3 text-sm font-semibold">全局 Agent</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {agents.map((agent) => {
              const agentSkills = skills.filter((skill) =>
                skill.targets.some((target) => target.agentKey === agent.key && target.enabled)
              );
              return (
                <div key={agent.key} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{agent.name}</div>
                      <div className="truncate text-xs text-gray-500">{agent.globalPath}</div>
                    </div>
                    <span className="rounded bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800">{agentSkills.length}</span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {agentSkills.slice(0, 5).map((skill) => (
                      <button
                        key={skill.id}
                        onClick={() => onOpenSkill(skill.id)}
                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <span className="truncate">{skill.name}</span>
                        <CheckCircle2 size={14} className="text-emerald-500" />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <h2 className="mb-3 mt-5 text-sm font-semibold">工作区</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {workspaces.map((workspace) => (
              <div key={workspace.id} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{workspace.name}</div>
                    <div className="truncate text-xs text-gray-500">{workspace.path}</div>
                  </div>
                  <span className="rounded bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800">{WORKSPACE_LABELS[workspace.type]}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {workspace.agentKeys.map((key) => (
                    <span key={key} className="rounded bg-gray-100 px-2 py-0.5 text-[11px] dark:bg-gray-800">
                      {agents.find((agent) => agent.key === key)?.name || key}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold">新增工作区</h2>
            <div className="space-y-3">
              <Input label="名称" value={name} onChange={setName} placeholder="项目 / 关联目录" />
              <Input label="路径" value={path} onChange={setPath} placeholder="D:\\project\\.codex\\skills" />
              <label className="block text-xs font-medium text-gray-500">类型</label>
              <select
                value={type}
                onChange={(event) => setType(event.target.value as SkillWorkspaceType)}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
              >
                <option value="project">项目</option>
                <option value="linked">关联</option>
                <option value="global">全局</option>
              </select>
              <button onClick={createWorkspace} className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900">
                创建
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold">快速分配</h2>
            <div className="space-y-2">
              {skills.slice(0, 8).map((skill) => (
                <div key={skill.id} className="rounded-md border border-gray-100 p-2 dark:border-gray-800">
                  <div className="mb-2 truncate text-xs font-medium">{skill.name}</div>
                  <div className="flex flex-wrap gap-1">
                    {agents.map((agent) => {
                      const active = skill.targets.some((target) => target.agentKey === agent.key && target.enabled);
                      return (
                        <button
                          key={agent.key}
                          onClick={() => onToggleTarget(skill.id, agent.key)}
                          className={cn(
                            'rounded px-2 py-1 text-[11px]',
                            active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
                          )}
                        >
                          {agent.name.slice(0, 4)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-gray-500">模式：{syncMode === 'copy' ? '复制' : '软链接'}</div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function PresetsView({
  skills,
  agents,
  presets,
  onPatch,
  onApply,
  onOpenSkill,
}: {
  skills: ManagedSkillItem[];
  agents: SkillAgent[];
  presets: SkillPreset[];
  onPatch: (patch: Partial<SkillsLibraryData>, log?: Omit<SkillActivity, 'id' | 'createdAt'>) => void;
  onApply: (preset: SkillPreset) => void;
  onOpenSkill: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [agentKeys, setAgentKeys] = useState<string[]>(agents.filter((agent) => agent.enabled).map((agent) => agent.key));

  const createPreset = () => {
    if (!name.trim()) return;
    const time = nowIso();
    const preset: SkillPreset = {
      id: idOf('preset'),
      name: name.trim(),
      description: '',
      icon: 'Layers',
      skillIds,
      agentKeys,
      sortOrder: presets.length,
      createdAt: time,
      updatedAt: time,
    };
    onPatch(
      { presets: [...presets, preset] },
      { action: 'create_preset', message: `创建 Preset ${preset.name}` }
    );
    setName('');
    setSkillIds([]);
  };

  const removePreset = (id: string) => {
    onPatch(
      { presets: presets.filter((preset) => preset.id !== id) },
      { action: 'delete_preset', message: '删除 Preset' }
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="grid gap-3 lg:grid-cols-2">
          {presets.map((preset) => (
            <div key={preset.id} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{preset.name}</h2>
                  <div className="text-xs text-gray-500">
                    {preset.skillIds.length} Skills · {preset.agentKeys.length} Agents
                  </div>
                </div>
                <div className="flex gap-1">
                  <IconButton icon={Check} title="应用" onClick={() => onApply(preset)} />
                  <IconButton icon={Trash2} title="删除" onClick={() => removePreset(preset.id)} danger />
                </div>
              </div>
              <div className="mt-3 space-y-1">
                {preset.skillIds.slice(0, 6).map((id) => {
                  const skill = skills.find((item) => item.id === id);
                  if (!skill) return null;
                  return (
                    <button
                      key={id}
                      onClick={() => onOpenSkill(id)}
                      className="block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      {skill.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {presets.length === 0 && <EmptyState icon={Layers} title="暂无 Preset" action="右侧创建" />}
        </section>

        <aside className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold">新建 Preset</h2>
          <Input label="名称" value={name} onChange={setName} placeholder="如：前端开发" />
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-gray-500">Skills</div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {skills.map((skill) => (
                <label key={skill.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input
                    type="checkbox"
                    checked={skillIds.includes(skill.id)}
                    onChange={() =>
                      setSkillIds(
                        skillIds.includes(skill.id)
                          ? skillIds.filter((id) => id !== skill.id)
                          : [...skillIds, skill.id]
                      )
                    }
                  />
                  <span className="min-w-0 truncate">{skill.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-gray-500">Agents</div>
            <div className="flex flex-wrap gap-1">
              {agents.map((agent) => (
                <button
                  key={agent.key}
                  onClick={() =>
                    setAgentKeys(
                      agentKeys.includes(agent.key)
                        ? agentKeys.filter((key) => key !== agent.key)
                        : [...agentKeys, agent.key]
                    )
                  }
                  className={cn(
                    'rounded-full border px-2 py-1 text-xs',
                    agentKeys.includes(agent.key)
                      ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                      : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'
                  )}
                >
                  {agent.name}
                </button>
              ))}
            </div>
          </div>
          <button onClick={createPreset} className="mt-4 w-full rounded-md bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900">
            保存
          </button>
        </aside>
      </div>
    </div>
  );
}

function SettingsView({
  baseDir,
  gitRemote,
  syncMode,
  agents,
  activityLog,
  skills,
  presets,
  workspaces,
  onPatch,
  onNotice,
}: {
  baseDir: string;
  gitRemote: string;
  syncMode: SkillSyncMode;
  agents: SkillAgent[];
  activityLog: SkillActivity[];
  skills: ManagedSkillItem[];
  presets: SkillPreset[];
  workspaces: SkillWorkspace[];
  onPatch: (patch: Partial<SkillsLibraryData>, log?: Omit<SkillActivity, 'id' | 'createdAt'>) => void;
  onNotice: (message: string) => void;
}) {
  const [base, setBase] = useState(baseDir);
  const [remote, setRemote] = useState(gitRemote);

  const exportJson = async () => {
    const target = await saveDialog({
      title: '导出 Skills Manager 数据',
      defaultPath: 'skills-manager.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!target) return;
    const payload: SkillsLibraryData = {
      version: SKILLS_LIBRARY_VERSION,
      baseDir,
      gitRemote,
      syncMode,
      agents,
      skills,
      presets,
      workspaces,
      activityLog,
      lastModified: nowIso(),
    };
    await writeTextFile(target, JSON.stringify(payload, null, 2));
    onNotice('已导出');
  };

  const resetLibrary = () => {
    if (!confirm('确定清空 AI Skills Manager 数据吗？')) return;
    onPatch(
      {
        skills: [],
        presets: [],
        workspaces: [],
        activityLog: [],
      },
      { action: 'reset_library', message: '清空 Skills Manager' }
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <section className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold">仓库设置</h2>
            <div className="space-y-3">
              <Input label="中央目录" value={base} onChange={setBase} />
              <Input label="Git Remote" value={remote} onChange={setRemote} placeholder="git@github.com:user/skills.git" />
              <label className="block text-xs font-medium text-gray-500">同步模式</label>
              <select
                value={syncMode}
                onChange={(event) => onPatch({ syncMode: event.target.value as SkillSyncMode })}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
              >
                <option value="copy">复制</option>
                <option value="symlink">软链接</option>
              </select>
              <button
                onClick={() =>
                  onPatch(
                    { baseDir: base.trim() || baseDir, gitRemote: remote.trim() || undefined },
                    { action: 'update_settings', message: '更新 Skills Manager 设置' }
                  )
                }
                className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900"
              >
                保存设置
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold">数据</h2>
            <div className="flex flex-wrap gap-2">
              <button onClick={exportJson} className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                <UploadCloud size={15} />
                导出 JSON
              </button>
              <button onClick={resetLibrary} className="inline-flex items-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-600 dark:border-rose-800">
                <Trash2 size={15} />
                清空
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold">Agents</h2>
            <div className="space-y-2">
              {agents.map((agent) => (
                <div key={agent.key} className="grid grid-cols-[140px_1fr_auto] items-center gap-3 rounded-md border border-gray-100 p-2 dark:border-gray-800">
                  <div className="font-medium">{agent.name}</div>
                  <div className="truncate text-xs text-gray-500">{agent.globalPath}</div>
                  <button
                    onClick={() =>
                      onPatch({
                        agents: agents.map((item) =>
                          item.key === agent.key ? { ...item, enabled: !item.enabled } : item
                        ),
                      })
                    }
                    className={cn(
                      'rounded-full px-2 py-1 text-xs',
                      agent.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
                    )}
                  >
                    {agent.enabled ? '启用' : '停用'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold">活动日志</h2>
            <div className="max-h-[420px] space-y-2 overflow-y-auto">
              {activityLog.map((item) => (
                <div key={item.id} className="flex gap-3 rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-950">
                  <History size={15} className="mt-0.5 text-gray-400" />
                  <div className="min-w-0">
                    <div className="truncate">{item.message}</div>
                    <div className="text-xs text-gray-500">{formatDate(item.createdAt)}</div>
                  </div>
                </div>
              ))}
              {activityLog.length === 0 && <div className="text-sm text-gray-500">暂无日志</div>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SkillDetailPanel({
  skill,
  agents,
  presets,
  workspaces,
  onClose,
  onEdit,
  onCopy,
  onExport,
  onToggleFavorite,
  onToggleTarget,
  onInstallAgent,
  onInstallAll,
  onDelete,
}: {
  skill: ManagedSkillItem;
  agents: SkillAgent[];
  presets: SkillPreset[];
  workspaces: SkillWorkspace[];
  onClose: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onExport: () => void;
  onToggleFavorite: () => void;
  onToggleTarget: (agentKey: string) => void;
  onInstallAgent: (agentKey: string) => void;
  onInstallAll: () => void;
  onDelete: () => void;
}) {
  const SourceIcon = sourceIcon(skill.source.type);
  const relatedPresets = presets.filter((preset) => preset.skillIds.includes(skill.id));
  const relatedWorkspaces = workspaces.filter((workspace) => workspace.skillIds.includes(skill.id));

  return (
    <aside className="flex w-[430px] flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      <div className="border-b border-gray-200 p-4 dark:border-gray-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <SourceIcon size={14} />
              {SOURCE_LABELS[skill.source.type]}
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold">{skill.name}</h2>
          </div>
          <button onClick={onClose} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
            <X size={18} />
          </button>
        </div>
        <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{skill.description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <IconTextButton icon={Star} label="收藏" active={skill.favorite} onClick={onToggleFavorite} />
          <IconTextButton icon={Copy} label="复制" onClick={onCopy} />
          <IconTextButton icon={UploadCloud} label="导出" onClick={onExport} />
          <IconTextButton icon={Edit2} label="编辑" onClick={onEdit} />
          <IconTextButton icon={DownloadCloud} label="写入 Agent" onClick={onInstallAll} />
          <IconTextButton icon={Trash2} label="删除" onClick={onDelete} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section className="mb-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Agent Targets</h3>
          <div className="grid grid-cols-2 gap-2">
            {agents.map((agent) => {
              const target = skill.targets.find((item) => item.agentKey === agent.key);
              const active = Boolean(target?.enabled);
              return (
                <div
                  key={agent.key}
                  className={cn(
                    'rounded-md border px-3 py-2 text-xs',
                    active
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                      : 'border-gray-200 text-gray-500 dark:border-gray-800'
                  )}
                >
                  <div className="truncate font-medium">{agent.name}</div>
                  <div className="mt-1 truncate opacity-70">{target?.status || '未分配'}</div>
                  <div className="mt-2 flex gap-1">
                    <button
                      onClick={() => onToggleTarget(agent.key)}
                      className="rounded border border-current/20 px-2 py-1 hover:bg-white/70 dark:hover:bg-gray-900"
                    >
                      {active ? '取消' : '分配'}
                    </button>
                    <button
                      onClick={() => onInstallAgent(agent.key)}
                      className="rounded bg-gray-900 px-2 py-1 text-white dark:bg-white dark:text-gray-900"
                    >
                      写入
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mb-4 grid grid-cols-2 gap-2 text-xs">
          <SmallInfo icon={Tags} label="标签" value={skill.tags.join(', ') || '无'} />
          <SmallInfo icon={RefreshCw} label="更新" value={statusLabel(skill.updateStatus)} />
          <SmallInfo icon={Layers} label="Preset" value={relatedPresets.map((item) => item.name).join(', ') || '无'} />
          <SmallInfo icon={Folder} label="工作区" value={relatedWorkspaces.map((item) => item.name).join(', ') || '无'} />
        </section>

        <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:overflow-x-auto prose-code:break-words">
            <ReactMarkdown components={markdownComponents} skipHtml>
              {skill.content || '# Empty Skill'}
            </ReactMarkdown>
          </div>
        </section>
      </div>
    </aside>
  );
}

function SkillEditorDialog({
  skill,
  agents,
  syncMode,
  onClose,
  onSave,
}: {
  skill: ManagedSkillItem | null;
  agents: SkillAgent[];
  syncMode: SkillSyncMode;
  onClose: () => void;
  onSave: (skill: ManagedSkillItem) => void;
}) {
  const [name, setName] = useState(skill?.name || '');
  const [description, setDescription] = useState(skill?.description || '');
  const [tags, setTags] = useState(skill?.tags.join(', ') || '');
  const [sourceType, setSourceType] = useState<SkillSourceType>(skill?.source.type || 'manual');
  const [sourceRef, setSourceRef] = useState(skill?.source.ref || '');
  const [content, setContent] = useState(skill?.content || '# New Skill\n\n## Trigger\n\n## Workflow\n\n## Output\n');
  const [targetKeys, setTargetKeys] = useState<string[]>(
    skill?.targets.filter((target) => target.enabled).map((target) => target.agentKey) || []
  );

  const save = () => {
    if (!name.trim()) return;
    const time = nowIso();
    const nextSkill: ManagedSkillItem = {
      id: skill?.id || idOf('skill'),
      name: name.trim(),
      slug: skill?.slug || slugify(name),
      description: description.trim() || '无描述',
      tags: splitTags(tags),
      source: {
        type: sourceType,
        ref: sourceRef.trim() || undefined,
        resolved: sourceRef.trim() || undefined,
      },
      content,
      files: [{ path: 'SKILL.md', content, language: 'markdown' }],
      status: skill?.status || 'active',
      updateStatus: skill?.updateStatus || 'unchecked',
      targets: makeTargets(targetKeys, agents, syncMode),
      presetIds: skill?.presetIds || [],
      workspaceIds: skill?.workspaceIds || [],
      favorite: skill?.favorite || false,
      createdAt: skill?.createdAt || time,
      updatedAt: time,
      lastCheckedAt: skill?.lastCheckedAt,
      lastUsedAt: skill?.lastUsedAt,
    };
    onSave(nextSkill);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 className="font-semibold">{skill ? '编辑 Skill' : '新建 Skill'}</h2>
          <button onClick={onClose} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[360px_1fr]">
          <section className="space-y-3">
            <Input label="名称" value={name} onChange={setName} />
            <Input label="描述" value={description} onChange={setDescription} />
            <Input label="标签" value={tags} onChange={setTags} placeholder="ocr, docs, frontend" />
            <label className="block text-xs font-medium text-gray-500">来源</label>
            <select
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value as SkillSourceType)}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
            >
              {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <Input label="来源引用" value={sourceRef} onChange={setSourceRef} placeholder="URL / 路径 / 市场 ID" />
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500">目标 Agent</div>
              <div className="flex flex-wrap gap-1">
                {agents.map((agent) => (
                  <button
                    key={agent.key}
                    onClick={() =>
                      setTargetKeys(
                        targetKeys.includes(agent.key)
                          ? targetKeys.filter((key) => key !== agent.key)
                          : [...targetKeys, agent.key]
                      )
                    }
                    className={cn(
                      'rounded-full border px-2 py-1 text-xs',
                      targetKeys.includes(agent.key)
                        ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                        : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'
                    )}
                  >
                    {agent.name}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="min-h-[420px]">
            <label className="mb-2 block text-xs font-medium text-gray-500">SKILL.md</label>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="h-full min-h-[420px] w-full resize-y rounded-md border border-gray-200 bg-white p-3 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-700 dark:bg-gray-950"
            />
          </section>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">
            取消
          </button>
          <button onClick={save} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-700 dark:bg-gray-950"
      />
    </label>
  );
}

function SmallInfo({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
        <Icon size={13} />
        {label}
      </div>
      <div className="truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function IconTextButton({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs',
        active
          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20'
          : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900'
      )}
    >
      <Icon size={14} fill={active ? 'currentColor' : 'none'} />
      {label}
    </button>
  );
}

function EmptyState({ icon: Icon, title, action }: { icon: LucideIcon; title: string; action: string }) {
  return (
    <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-500 dark:border-gray-700">
      <Icon size={32} className="mb-3 text-gray-400" />
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-sm">{action}</div>
    </div>
  );
}
