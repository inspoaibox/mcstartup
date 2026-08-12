import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  Flag,
  FolderKanban,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  Target,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  useToolDataStore,
  type ProjectMilestone,
  type ProjectMilestoneStatus,
  type ProjectPriority,
  type ProjectRecord,
  type ProjectStatus,
  type ProjectTask,
} from '../stores/toolDataStore';

const STATUS_META: Record<ProjectStatus, { label: string; tone: string }> = {
  planning: {
    label: '规划中',
    tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
  active: {
    label: '进行中',
    tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  blocked: {
    label: '阻塞中',
    tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  },
  completed: {
    label: '已完成',
    tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  archived: {
    label: '已归档',
    tone: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
};

const PRIORITY_META: Record<ProjectPriority, { label: string; tone: string }> = {
  low: { label: '低', tone: 'text-slate-500 dark:text-slate-400' },
  medium: { label: '中', tone: 'text-blue-500 dark:text-blue-300' },
  high: { label: '高', tone: 'text-orange-500 dark:text-orange-300' },
  urgent: { label: '紧急', tone: 'text-red-500 dark:text-red-300' },
};

const MILESTONE_META: Record<ProjectMilestoneStatus, { label: string; tone: string }> = {
  upcoming: {
    label: '待推进',
    tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  done: {
    label: '已完成',
    tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  risk: {
    label: '有风险',
    tone: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
};

function createEmptyProject(): ProjectRecord {
  const now = new Date().toISOString();
  return {
    id: Date.now().toString(),
    name: '',
    client: '',
    owner: '',
    members: [],
    status: 'planning',
    priority: 'medium',
    startDate: '',
    dueDate: '',
    description: '',
    tags: [],
    tasks: [],
    milestones: [],
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

function createTaskDraft(): ProjectTask {
  return {
    id: `${Date.now()}`,
    title: '',
    completed: false,
    assignee: '',
    dueDate: '',
    notes: '',
    createdAt: new Date().toISOString(),
  };
}

function createMilestoneDraft(): ProjectMilestone {
  return {
    id: `${Date.now()}`,
    title: '',
    date: '',
    status: 'upcoming',
    description: '',
    createdAt: new Date().toISOString(),
  };
}

function formatDate(value?: string) {
  if (!value) return '未设置';
  return new Date(value).toLocaleDateString('zh-CN');
}

function calcProgress(tasks: ProjectTask[]) {
  if (!tasks.length) return 0;
  return Math.round((tasks.filter((task) => task.completed).length / tasks.length) * 100);
}

function normalizeProject(project: ProjectRecord): ProjectRecord {
  return {
    ...project,
    members: Array.isArray(project.members) ? project.members : [],
    tags: Array.isArray(project.tags) ? project.tags : [],
    tasks: Array.isArray(project.tasks)
      ? project.tasks.map((task) => ({
          ...task,
          assignee: task.assignee || '',
          dueDate: task.dueDate || '',
          notes: task.notes || '',
        }))
      : [],
    milestones: Array.isArray(project.milestones)
      ? project.milestones.map((milestone) => ({
          ...milestone,
          description: milestone.description || '',
        }))
      : [],
  };
}

function getProjectReport(project: ProjectRecord) {
  const completedTasks = project.tasks.filter((task) => task.completed);
  const pendingTasks = project.tasks.filter((task) => !task.completed);
  const riskMilestones = project.milestones.filter((item) => item.status === 'risk');
  const upcomingMilestones = project.milestones
    .filter((item) => item.status !== 'done')
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

  return [
    `# ${project.name} 项目汇报`,
    '',
    `- 项目状态：${STATUS_META[project.status].label}`,
    `- 项目优先级：${PRIORITY_META[project.priority].label}`,
    `- 客户/业务方：${project.client || '未填写'}`,
    `- 负责人：${project.owner || '未指定'}`,
    `- 参与成员：${project.members.length ? project.members.join('、') : '未填写'}`,
    `- 时间范围：${formatDate(project.startDate)} 至 ${formatDate(project.dueDate)}`,
    '',
    '## 本周进展',
    ...(completedTasks.length
      ? completedTasks.map((task) => `- 已完成：${task.title}`)
      : ['- 本周暂无已完成事项']),
    '',
    '## 当前待推进',
    ...(pendingTasks.length
      ? pendingTasks.map(
          (task) =>
            `- ${task.title}${task.assignee ? `（负责人：${task.assignee}）` : ''}${task.dueDate ? `，截止：${formatDate(task.dueDate)}` : ''}`
        )
      : ['- 当前暂无待办任务']),
    '',
    '## 里程碑/节点',
    ...(upcomingMilestones.length
      ? upcomingMilestones.map(
          (milestone) =>
            `- ${milestone.title}：${formatDate(milestone.date)}（${MILESTONE_META[milestone.status].label}）`
        )
      : ['- 暂无里程碑']),
    '',
    '## 风险与阻塞',
    ...(riskMilestones.length
      ? riskMilestones.map(
          (milestone) => `- ${milestone.title}${milestone.description ? `：${milestone.description}` : ''}`
        )
      : [project.status === 'blocked' ? '- 项目当前存在阻塞，请补充说明。' : '- 当前暂无明确风险']),
    '',
    '## 备注',
    project.notes || '暂无',
  ].join('\n');
}

export default function ProjectManagerTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateProjectManagerProjects } = useToolDataStore();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>('all');
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [showProjectEditor, setShowProjectEditor] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectRecord | null>(null);
  const [showTaskEditor, setShowTaskEditor] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [showMilestoneEditor, setShowMilestoneEditor] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<ProjectMilestone | null>(null);
  const hydratingRef = useRef(false);

  useEffect(() => {
    if (!loaded) {
      loadData();
    }
  }, [loaded, loadData]);

  useEffect(() => {
    if (!loaded) return;
    const nextProjects = (data.projectManager?.projects || []).map(normalizeProject);
    hydratingRef.current = true;
    setProjects(nextProjects);
  }, [loaded, data.projectManager?.projects]);

  useEffect(() => {
    if (!loaded) return;
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    updateProjectManagerProjects(projects);
  }, [projects, loaded, updateProjectManagerProjects]);

  useEffect(() => {
    if (!projects.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !projects.some((project) => project.id === selectedId)) {
      setSelectedId(projects[0].id);
    }
  }, [projects, selectedId]);

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      const keyword = search.trim().toLowerCase();
      const haystack = [
        project.name,
        project.client,
        project.owner,
        project.members.join(' '),
        project.description,
        project.notes,
        project.tags.join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return matchesStatus && (!keyword || haystack.includes(keyword));
    });
  }, [projects, search, statusFilter]);

  const selectedProject =
    projects.find((project) => project.id === selectedId) ||
    filteredProjects[0] ||
    null;

  const projectReport = selectedProject ? getProjectReport(selectedProject) : '';
  const activeCount = projects.filter((project) => project.status === 'active').length;
  const blockedCount = projects.filter((project) => project.status === 'blocked').length;
  const dueSoonCount = projects.filter((project) => {
    if (!project.dueDate || project.status === 'completed' || project.status === 'archived') {
      return false;
    }
    const diffDays = (new Date(project.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 7;
  }).length;

  function patchProject(projectId: string, updates: Partial<ProjectRecord>) {
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              ...updates,
              updatedAt: new Date().toISOString(),
            }
          : project
      )
    );
  }

  function upsertProject(project: ProjectRecord) {
    const normalized = normalizeProject({
      ...project,
      name: project.name.trim(),
      client: project.client?.trim() || '',
      owner: project.owner?.trim() || '',
      members: project.members.map((item) => item.trim()).filter(Boolean),
      description: project.description?.trim() || '',
      tags: project.tags.map((item) => item.trim()).filter(Boolean),
      notes: project.notes || '',
      updatedAt: new Date().toISOString(),
    });

    setProjects((current) => {
      const exists = current.some((item) => item.id === normalized.id);
      if (exists) {
        return current.map((item) => (item.id === normalized.id ? normalized : item));
      }
      return [normalized, ...current];
    });
    setSelectedId(normalized.id);
    setShowProjectEditor(false);
    setEditingProject(null);
  }

  function removeProject(projectId: string) {
    setProjects((current) => current.filter((project) => project.id !== projectId));
  }

  function moveProjectStatus(projectId: string, status: ProjectStatus) {
    patchProject(projectId, { status });
  }

  function upsertTask(task: ProjectTask) {
    if (!selectedProject) return;
    const normalizedTask = {
      ...task,
      title: task.title.trim(),
      assignee: task.assignee?.trim() || '',
      dueDate: task.dueDate || '',
      notes: task.notes?.trim() || '',
    };
    const exists = selectedProject.tasks.some((item) => item.id === normalizedTask.id);
    patchProject(selectedProject.id, {
      tasks: exists
        ? selectedProject.tasks.map((item) => (item.id === normalizedTask.id ? normalizedTask : item))
        : [...selectedProject.tasks, normalizedTask],
    });
    setShowTaskEditor(false);
    setEditingTask(null);
  }

  function toggleTask(taskId: string) {
    if (!selectedProject) return;
    patchProject(selectedProject.id, {
      tasks: selectedProject.tasks.map((task) =>
        task.id === taskId ? { ...task, completed: !task.completed } : task
      ),
    });
  }

  function deleteTask(taskId: string) {
    if (!selectedProject) return;
    patchProject(selectedProject.id, {
      tasks: selectedProject.tasks.filter((task) => task.id !== taskId),
    });
  }

  function upsertMilestone(milestone: ProjectMilestone) {
    if (!selectedProject) return;
    const normalizedMilestone = {
      ...milestone,
      title: milestone.title.trim(),
      description: milestone.description?.trim() || '',
      date: milestone.date || '',
    };
    const exists = selectedProject.milestones.some((item) => item.id === normalizedMilestone.id);
    patchProject(selectedProject.id, {
      milestones: exists
        ? selectedProject.milestones.map((item) =>
            item.id === normalizedMilestone.id ? normalizedMilestone : item
          )
        : [...selectedProject.milestones, normalizedMilestone],
    });
    setShowMilestoneEditor(false);
    setEditingMilestone(null);
  }

  function deleteMilestone(milestoneId: string) {
    if (!selectedProject) return;
    patchProject(selectedProject.id, {
      milestones: selectedProject.milestones.filter((item) => item.id !== milestoneId),
    });
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
  }

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="📁"
        title="项目管理"
        subtitle="项目、任务、里程碑、汇报模板统一管理，数据走工具箱统一存储，便于后续同步与备份"
        actions={
          <>
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 text-xs inline-flex items-center gap-1.5 transition-colors ${
                  viewMode === 'list'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-300'
                }`}
              >
                <List size={13} />
                列表
              </button>
              <button
                onClick={() => setViewMode('board')}
                className={`px-3 py-1.5 text-xs inline-flex items-center gap-1.5 transition-colors ${
                  viewMode === 'board'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-300'
                }`}
              >
                <LayoutGrid size={13} />
                看板
              </button>
            </div>
            <button
              onClick={() => {
                setEditingProject(createEmptyProject());
                setShowProjectEditor(true);
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs transition-colors"
            >
              <Plus size={14} />
              新建项目
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-hidden p-4">
        <div className="grid h-full grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-4">
          <section className="flex flex-col rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <MetricCard label="进行中" value={activeCount} icon={<FolderKanban size={15} />} />
                <MetricCard label="阻塞中" value={blockedCount} icon={<AlertCircle size={15} />} />
                <MetricCard label="7天内到期" value={dueSoonCount} icon={<Clock3 size={15} />} />
              </div>

              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索项目、负责人、标签..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | ProjectStatus)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">全部状态</option>
                {Object.entries(STATUS_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {filteredProjects.length === 0 ? (
                <EmptyPanel />
              ) : viewMode === 'list' ? (
                <div className="space-y-3">
                  {filteredProjects.map((project) => (
                    <ProjectListCard
                      key={project.id}
                      project={project}
                      selected={project.id === selectedProject?.id}
                      onSelect={() => setSelectedId(project.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                  {(['planning', 'active', 'blocked', 'completed', 'archived'] as ProjectStatus[]).map(
                    (status) => {
                      const items = filteredProjects.filter((project) => project.status === status);
                      return (
                        <div
                          key={status}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const projectId = e.dataTransfer.getData('text/plain');
                            if (projectId) moveProjectStatus(projectId, status);
                          }}
                          className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                              {STATUS_META[status].label}
                            </span>
                            <span className="text-[11px] text-gray-400">{items.length}</span>
                          </div>
                          <div className="space-y-2 min-h-[120px]">
                            {items.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-6 text-center text-xs text-gray-400">
                                拖项目到这里
                              </div>
                            ) : (
                              items.map((project) => (
                                <div
                                  key={project.id}
                                  draggable
                                  onDragStart={(e) => e.dataTransfer.setData('text/plain', project.id)}
                                >
                                  <ProjectListCard
                                    project={project}
                                    selected={project.id === selectedProject?.id}
                                    onSelect={() => setSelectedId(project.id)}
                                    compact
                                  />
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="flex flex-col rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
            {!selectedProject ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                <Target size={40} className="text-gray-300 dark:text-gray-600 mb-4" />
                <p className="text-base font-medium text-gray-600 dark:text-gray-300">先创建或选择一个项目</p>
                <p className="mt-2 text-sm text-gray-400">这里会展示项目概览、任务、里程碑和汇报模板</p>
              </div>
            ) : (
              <>
                <div className="p-5 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-semibold truncate">{selectedProject.name}</h2>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_META[selectedProject.status].tone}`}>
                          {STATUS_META[selectedProject.status].label}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                        {selectedProject.description || '这个项目还没有补充项目描述。'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <button
                        onClick={() => copyText(projectReport).catch(() => {})}
                        className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors inline-flex items-center gap-1.5"
                      >
                        <FileText size={14} />
                        复制周报模板
                      </button>
                      <button
                        onClick={() => {
                          const summary = [
                            `项目：${selectedProject.name}`,
                            `状态：${STATUS_META[selectedProject.status].label}`,
                            `优先级：${PRIORITY_META[selectedProject.priority].label}`,
                            `负责人：${selectedProject.owner || '未指定'}`,
                            `进度：${calcProgress(selectedProject.tasks)}%`,
                          ].join('\n');
                          copyText(summary).catch(() => {});
                        }}
                        className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors inline-flex items-center gap-1.5"
                      >
                        <Copy size={14} />
                        复制摘要
                      </button>
                      <button
                        onClick={() =>
                          patchProject(selectedProject.id, {
                            status: selectedProject.status === 'archived' ? 'active' : 'archived',
                          })
                        }
                        className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors inline-flex items-center gap-1.5"
                      >
                        <Archive size={14} />
                        {selectedProject.status === 'archived' ? '恢复项目' : '归档项目'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingProject(selectedProject);
                          setShowProjectEditor(true);
                        }}
                        className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors inline-flex items-center gap-1.5"
                      >
                        <Pencil size={14} />
                        编辑项目
                      </button>
                      <button
                        onClick={() => removeProject(selectedProject.id)}
                        className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="删除项目"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
                    <InfoCard label="客户/业务方" value={selectedProject.client || '未填写'} />
                    <InfoCard label="负责人" value={selectedProject.owner || '未指定'} />
                    <InfoCard
                      label="参与成员"
                      value={selectedProject.members.length ? selectedProject.members.join('、') : '未填写'}
                    />
                    <InfoCard label="开始日期" value={formatDate(selectedProject.startDate)} />
                    <InfoCard label="截止日期" value={formatDate(selectedProject.dueDate)} />
                  </div>

                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    {selectedProject.tags.length ? (
                      selectedProject.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-xs text-gray-600 dark:text-gray-300"
                        >
                          #{tag}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-gray-400">还没有标签</span>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-5">
                    <section className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold">任务清单</h3>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">支持负责人、截止日期和任务备注</p>
                        </div>
                        <button
                          onClick={() => {
                            setEditingTask(createTaskDraft());
                            setShowTaskEditor(true);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs inline-flex items-center gap-1.5"
                        >
                          <Plus size={13} />
                          新增任务
                        </button>
                      </div>

                      <div className="mt-4 space-y-2">
                        {selectedProject.tasks.length === 0 ? (
                          <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 px-4 py-6 text-center text-sm text-gray-400">
                            还没有任务，先添加第一条执行项
                          </div>
                        ) : (
                          selectedProject.tasks
                            .slice()
                            .sort((a, b) => Number(a.completed) - Number(b.completed))
                            .map((task) => (
                              <div
                                key={task.id}
                                className="rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-3"
                              >
                                <div className="flex items-start gap-3">
                                  <button
                                    onClick={() => toggleTask(task.id)}
                                    className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                                      task.completed
                                        ? 'border-emerald-500 bg-emerald-500 text-white'
                                        : 'border-gray-300 dark:border-gray-600'
                                    }`}
                                  >
                                    {task.completed && <CheckCircle2 size={12} />}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <div
                                      className={`text-sm ${
                                        task.completed
                                          ? 'line-through text-gray-400'
                                          : 'text-gray-700 dark:text-gray-200'
                                      }`}
                                    >
                                      {task.title}
                                    </div>
                                    <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] text-gray-400">
                                      <span className="inline-flex items-center gap-1">
                                        <User size={11} />
                                        {task.assignee || '未指定负责人'}
                                      </span>
                                      <span className="inline-flex items-center gap-1">
                                        <CalendarClock size={11} />
                                        {formatDate(task.dueDate)}
                                      </span>
                                    </div>
                                    {task.notes && (
                                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                                        {task.notes}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => {
                                        setEditingTask(task);
                                        setShowTaskEditor(true);
                                      }}
                                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      onClick={() => deleteTask(task.id)}
                                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    </section>

                    <section className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold">里程碑时间线</h3>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">记录关键节点、交付时间和风险提示</p>
                        </div>
                        <button
                          onClick={() => {
                            setEditingMilestone(createMilestoneDraft());
                            setShowMilestoneEditor(true);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs inline-flex items-center gap-1.5"
                        >
                          <Plus size={13} />
                          新增里程碑
                        </button>
                      </div>

                      <div className="mt-4 space-y-3">
                        {selectedProject.milestones.length === 0 ? (
                          <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 px-4 py-6 text-center text-sm text-gray-400">
                            还没有里程碑，建议把关键时间点先补进来
                          </div>
                        ) : (
                          selectedProject.milestones
                            .slice()
                            .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
                            .map((milestone) => (
                              <div key={milestone.id} className="flex gap-3">
                                <div className="flex flex-col items-center">
                                  <div className="w-3 h-3 rounded-full bg-blue-500 mt-1" />
                                  <div className="flex-1 w-px bg-gray-200 dark:bg-gray-700 mt-1" />
                                </div>
                                <div className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <div className="text-sm font-medium">{milestone.title}</div>
                                        <span
                                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${MILESTONE_META[milestone.status].tone}`}
                                        >
                                          {MILESTONE_META[milestone.status].label}
                                        </span>
                                      </div>
                                      <div className="mt-1 text-[11px] text-gray-400 inline-flex items-center gap-1">
                                        <Flag size={11} />
                                        {formatDate(milestone.date)}
                                      </div>
                                      {milestone.description && (
                                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                                          {milestone.description}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => {
                                          setEditingMilestone(milestone);
                                          setShowMilestoneEditor(true);
                                        }}
                                        className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                      >
                                        <Pencil size={14} />
                                      </button>
                                      <button
                                        onClick={() => deleteMilestone(milestone.id)}
                                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    </section>
                  </div>

                  <section className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">周报 / 汇报模板</h3>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">自动根据当前项目状态、任务和里程碑生成，适合直接发群或汇报</p>
                      </div>
                      <button
                        onClick={() => copyText(projectReport).catch(() => {})}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs inline-flex items-center gap-1.5"
                      >
                        <Copy size={13} />
                        复制模板
                      </button>
                    </div>
                    <textarea
                      value={projectReport}
                      readOnly
                      className="mt-4 w-full min-h-[220px] rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-sm resize-none focus:outline-none"
                    />
                  </section>

                  <section className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold">项目备注</h3>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">记录上下文、沟通结论、风险和下一步安排</p>
                      </div>
                      <div className="text-xs text-gray-400">最近更新 {formatDate(selectedProject.updatedAt)}</div>
                    </div>
                    <textarea
                      value={selectedProject.notes || ''}
                      onChange={(e) => patchProject(selectedProject.id, { notes: e.target.value })}
                      placeholder="把当前项目的关键信息、待确认事项、会议纪要写在这里..."
                      className="mt-4 w-full min-h-[220px] rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </section>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {showProjectEditor && editingProject && (
        <ProjectEditorModal
          project={editingProject}
          onClose={() => {
            setShowProjectEditor(false);
            setEditingProject(null);
          }}
          onSave={upsertProject}
        />
      )}

      {showTaskEditor && editingTask && (
        <TaskEditorModal
          task={editingTask}
          onClose={() => {
            setShowTaskEditor(false);
            setEditingTask(null);
          }}
          onSave={upsertTask}
        />
      )}

      {showMilestoneEditor && editingMilestone && (
        <MilestoneEditorModal
          milestone={editingMilestone}
          onClose={() => {
            setShowMilestoneEditor(false);
            setEditingMilestone(null);
          }}
          onSave={upsertMilestone}
        />
      )}
    </div>
  );
}

function EmptyPanel() {
  return (
    <div className="h-full rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 flex flex-col items-center justify-center text-center px-6">
      <FolderKanban size={34} className="text-gray-300 dark:text-gray-600 mb-3" />
      <p className="text-sm text-gray-500 dark:text-gray-400">还没有项目数据</p>
      <p className="mt-1 text-xs text-gray-400">可以先建一个项目，把负责人、节点和待办都收进来</p>
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-900/50 px-3 py-3">
      <div className="flex items-center gap-2 text-gray-400">{icon}</div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
      <div className="text-[11px] text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

function ProjectListCard({
  project,
  selected,
  onSelect,
  compact = false,
}: {
  project: ProjectRecord;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  const progress = calcProgress(project.tasks);
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border p-4 transition-all ${
        selected
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold truncate">{project.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_META[project.status].tone}`}>
              {STATUS_META[project.status].label}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
            {project.client || '未填写客户'} · {project.owner || '未指定负责人'}
          </p>
          {!compact && project.members.length > 0 && (
            <p className="mt-1 text-[11px] text-gray-400 inline-flex items-center gap-1">
              <Users size={11} />
              {project.members.join('、')}
            </p>
          )}
        </div>
        <ChevronRight size={16} className={selected ? 'text-blue-500' : 'text-gray-300'} />
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className={PRIORITY_META[project.priority].tone}>优先级 {PRIORITY_META[project.priority].label}</span>
        <span className="text-gray-400">截止 {formatDate(project.dueDate)}</span>
      </div>
      <div className="mt-3">
        <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          任务进度 {progress}% · {project.tasks.filter((task) => task.completed).length}/{project.tasks.length || 0}
        </div>
      </div>
    </button>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-900/50 px-3 py-3">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{value}</div>
    </div>
  );
}

function ProjectEditorModal({
  project,
  onClose,
  onSave,
}: {
  project: ProjectRecord;
  onClose: () => void;
  onSave: (project: ProjectRecord) => void;
}) {
  const [draft, setDraft] = useState<ProjectRecord>(project);
  return (
    <BaseModal title={project.name ? '编辑项目' : '新建项目'} onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="项目名称 *">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} />
        </Field>
        <Field label="客户 / 业务方">
          <input value={draft.client || ''} onChange={(e) => setDraft({ ...draft, client: e.target.value })} className={inputCls} />
        </Field>
        <Field label="负责人">
          <input value={draft.owner || ''} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} className={inputCls} />
        </Field>
        <Field label="参与成员（逗号分隔）">
          <input
            value={draft.members.join(', ')}
            onChange={(e) => setDraft({ ...draft, members: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })}
            className={inputCls}
          />
        </Field>
        <Field label="状态">
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ProjectStatus })} className={inputCls}>
            {Object.entries(STATUS_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="优先级">
          <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as ProjectPriority })} className={inputCls}>
            {Object.entries(PRIORITY_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="开始日期">
          <input type="date" value={draft.startDate || ''} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} className={inputCls} />
        </Field>
        <Field label="截止日期">
          <input type="date" value={draft.dueDate || ''} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} className={inputCls} />
        </Field>
        <Field label="标签（逗号分隔）">
          <input
            value={draft.tags.join(', ')}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })}
            className={inputCls}
          />
        </Field>
      </div>
      <Field label="项目描述">
        <textarea
          value={draft.description || ''}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          rows={4}
          className={textareaCls}
        />
      </Field>
      <ModalActions
        onClose={onClose}
        onSave={() => {
          if (!draft.name.trim()) return;
          onSave(draft);
        }}
        saveLabel="保存项目"
      />
    </BaseModal>
  );
}

function TaskEditorModal({
  task,
  onClose,
  onSave,
}: {
  task: ProjectTask;
  onClose: () => void;
  onSave: (task: ProjectTask) => void;
}) {
  const [draft, setDraft] = useState<ProjectTask>(task);
  return (
    <BaseModal title={task.title ? '编辑任务' : '新增任务'} onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="任务标题 *">
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputCls} />
        </Field>
        <Field label="负责人">
          <input value={draft.assignee || ''} onChange={(e) => setDraft({ ...draft, assignee: e.target.value })} className={inputCls} />
        </Field>
        <Field label="截止日期">
          <input type="date" value={draft.dueDate || ''} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <Field label="任务备注">
        <textarea value={draft.notes || ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={4} className={textareaCls} />
      </Field>
      <ModalActions
        onClose={onClose}
        onSave={() => {
          if (!draft.title.trim()) return;
          onSave(draft);
        }}
        saveLabel="保存任务"
      />
    </BaseModal>
  );
}

function MilestoneEditorModal({
  milestone,
  onClose,
  onSave,
}: {
  milestone: ProjectMilestone;
  onClose: () => void;
  onSave: (milestone: ProjectMilestone) => void;
}) {
  const [draft, setDraft] = useState<ProjectMilestone>(milestone);
  return (
    <BaseModal title={milestone.title ? '编辑里程碑' : '新增里程碑'} onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="里程碑标题 *">
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputCls} />
        </Field>
        <Field label="节点日期">
          <input type="date" value={draft.date || ''} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={inputCls} />
        </Field>
        <Field label="状态">
          <select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as ProjectMilestoneStatus })}
            className={inputCls}
          >
            {Object.entries(MILESTONE_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="说明">
        <textarea value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={4} className={textareaCls} />
      </Field>
      <ModalActions
        onClose={onClose}
        onSave={() => {
          if (!draft.title.trim()) return;
          onSave(draft);
        }}
        saveLabel="保存里程碑"
      />
    </BaseModal>
  );
}

function BaseModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-50 bg-black/45 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-3xl bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold">{title}</h3>
        </div>
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function ModalActions({
  onClose,
  onSave,
  saveLabel,
}: {
  onClose: () => void;
  onSave: () => void;
  saveLabel: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3 pt-2">
      <button onClick={onClose} className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
        取消
      </button>
      <button onClick={onSave} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors">
        {saveLabel}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const textareaCls =
  'w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500';
