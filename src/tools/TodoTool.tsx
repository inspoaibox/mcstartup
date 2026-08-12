import { useState, useEffect } from 'react';
import { Plus, MoreVertical, Calendar, Trash2, Edit2, Check } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';
import { useToolDataStore, type TodoTask } from '../stores/toolDataStore';

type Quadrant = 'Q1' | 'Q2' | 'Q3' | 'Q4';

const QUADRANT_INFO = {
  Q1: {
    name: '重要 + 紧急',
    color: 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800',
    badge: 'bg-red-500',
  },
  Q2: {
    name: '重要 + 不紧急',
    color: 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800',
    badge: 'bg-blue-500',
  },
  Q3: {
    name: '不重要 + 紧急',
    color: 'bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800',
    badge: 'bg-yellow-500',
  },
  Q4: {
    name: '不重要 + 不紧急',
    color: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700',
    badge: 'bg-gray-500',
  },
};

export default function TodoTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateTodoTasks } = useToolDataStore();
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedQuadrant, setSelectedQuadrant] = useState<Quadrant>('Q1');
  const [editingTask, setEditingTask] = useState<TodoTask | null>(null);
  const [showMenu, setShowMenu] = useState<string | null>(null);
  const [draggedTask, setDraggedTask] = useState<string | null>(null);

  // 加载数据
  useEffect(() => {
    if (!loaded) {
      loadData();
    }
  }, [loaded, loadData]);

  // 同步数据到本地状态
  useEffect(() => {
    if (loaded) {
      setTasks(data.todo.tasks);
    }
  }, [loaded, data.todo.tasks]);

  // 保存任务到存储
  useEffect(() => {
    if (loaded && tasks.length >= 0) {
      updateTodoTasks(tasks);
    }
  }, [tasks]);

  const addTask = (title: string, quadrant: Quadrant, deadline?: string, notes?: string) => {
    const newTask: TodoTask = {
      id: Date.now().toString(),
      title,
      completed: false,
      quadrant,
      deadline,
      notes,
      createdAt: new Date().toISOString(),
    };
    setTasks([...tasks, newTask]);
    setShowAddModal(false);
  };

  const updateTask = (id: string, updates: Partial<TodoTask>) => {
    setTasks(tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const deleteTask = (id: string) => {
    setTasks(tasks.filter((t) => t.id !== id));
    setShowMenu(null);
  };

  const toggleComplete = (id: string) => {
    updateTask(id, { completed: !tasks.find((t) => t.id === id)?.completed });
  };

  const moveTask = (id: string, quadrant: Quadrant) => {
    updateTask(id, { quadrant });
    setShowMenu(null);
  };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedTask(taskId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, quadrant: Quadrant) => {
    e.preventDefault();
    if (draggedTask) {
      moveTask(draggedTask, quadrant);
      setDraggedTask(null);
    }
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
  };

  const getTasksByQuadrant = (quadrant: Quadrant) => {
    return tasks
      .filter((t) => t.quadrant === quadrant && !t.completed)
      .sort((a, b) => {
        if (a.deadline && !b.deadline) return -1;
        if (!a.deadline && b.deadline) return 1;
        if (a.deadline && b.deadline)
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  };

  const completedTasks = tasks.filter((t) => t.completed);

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden">
      <ToolHeader icon="✅" title="待办事项" subtitle="四象限管理" closeMode="hide" />

      {/* 四象限布局 */}
      <div className="flex-1 grid grid-cols-2 gap-3 p-4 overflow-hidden">
        {(['Q1', 'Q2', 'Q3', 'Q4'] as Quadrant[]).map((quadrant) => (
          <div
            key={quadrant}
            className={`flex flex-col rounded-xl border-2 ${QUADRANT_INFO[quadrant].color} overflow-hidden transition-all ${
              draggedTask ? 'ring-2 ring-blue-400 ring-opacity-50' : ''
            }`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, quadrant)}
          >
            {/* 象限标题 */}
            <div className="flex items-center justify-between px-3 py-2 bg-white/50 dark:bg-gray-900/50">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${QUADRANT_INFO[quadrant].badge}`} />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {QUADRANT_INFO[quadrant].name}
                </span>
                <span className="text-xs text-gray-400">{getTasksByQuadrant(quadrant).length}</span>
              </div>
              <button
                onClick={() => {
                  setSelectedQuadrant(quadrant);
                  setEditingTask(null);
                  setShowAddModal(true);
                }}
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <Plus size={14} className="text-gray-500" />
              </button>
            </div>

            {/* 任务列表 */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
              {getTasksByQuadrant(quadrant).map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  onDragEnd={handleDragEnd}
                  className={`group relative p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all cursor-move ${
                    draggedTask === task.id ? 'opacity-30 scale-95' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => toggleComplete(task.id)}
                      className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-800 dark:text-gray-200 break-words">
                        {task.title}
                      </div>
                      {task.deadline && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                          <Calendar size={10} />
                          <span>{new Date(task.deadline).toLocaleDateString('zh-CN')}</span>
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setShowMenu(showMenu === task.id ? null : task.id)}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
                      >
                        <MoreVertical size={14} className="text-gray-400" />
                      </button>
                      {showMenu === task.id && (
                        <div className="absolute right-0 top-6 z-10 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
                          <button
                            onClick={() => {
                              setEditingTask(task);
                              setShowAddModal(true);
                              setShowMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            <Edit2 size={12} />
                            编辑
                          </button>
                          <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                          <div className="px-2 py-1 text-xs text-gray-500 dark:text-gray-500">
                            移动到：
                          </div>
                          {(['Q1', 'Q2', 'Q3', 'Q4'] as Quadrant[])
                            .filter((q) => q !== task.quadrant)
                            .map((q) => (
                              <button
                                key={q}
                                onClick={() => moveTask(task.id, q)}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                              >
                                <div className={`w-2 h-2 rounded-full ${QUADRANT_INFO[q].badge}`} />
                                {QUADRANT_INFO[q].name}
                              </button>
                            ))}
                          <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                          <button
                            onClick={() => deleteTask(task.id)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            <Trash2 size={12} />
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 已完成任务 */}
      {completedTasks.length > 0 && (
        <div className="px-4 pb-4">
          <details className="group">
            <summary className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
              <Check size={14} className="text-green-500" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                已完成 ({completedTasks.length})
              </span>
            </summary>
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
              {completedTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-800/50"
                >
                  <button
                    onClick={() => toggleComplete(task.id)}
                    className="flex-shrink-0 w-4 h-4 rounded bg-green-500 flex items-center justify-center"
                  >
                    <Check size={10} className="text-white" />
                  </button>
                  <span className="flex-1 text-xs text-gray-400 line-through truncate">
                    {task.title}
                  </span>
                  <button
                    onClick={() => deleteTask(task.id)}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    <Trash2 size={12} className="text-gray-400" />
                  </button>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* 添加/编辑任务模态框 */}
      {showAddModal && (
        <AddTaskModal
          quadrant={editingTask?.quadrant || selectedQuadrant}
          task={editingTask}
          onSave={(title, quadrant, deadline, notes) => {
            if (editingTask) {
              updateTask(editingTask.id, { title, quadrant, deadline, notes });
              setShowAddModal(false);
              setEditingTask(null);
            } else {
              addTask(title, quadrant, deadline, notes);
            }
          }}
          onClose={() => {
            setShowAddModal(false);
            setEditingTask(null);
          }}
        />
      )}
    </div>
  );
}

interface AddTaskModalProps {
  quadrant: Quadrant;
  task: TodoTask | null;
  onSave: (title: string, quadrant: Quadrant, deadline?: string, notes?: string) => void;
  onClose: () => void;
}

function AddTaskModal({ quadrant, task, onSave, onClose }: AddTaskModalProps) {
  const [title, setTitle] = useState(task?.title || '');
  const [selectedQuadrant, setSelectedQuadrant] = useState<Quadrant>(task?.quadrant || quadrant);
  const [deadline, setDeadline] = useState(task?.deadline || '');
  const [notes, setNotes] = useState(task?.notes || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave(title.trim(), selectedQuadrant, deadline || undefined, notes.trim() || undefined);
  };

  return (
    <div
      className="absolute inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-96 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
          {task ? '编辑任务' : '添加任务'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              任务标题 *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务标题..."
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              截止日期
            </label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              象限 *
            </label>
            <select
              value={selectedQuadrant}
              onChange={(e) => setSelectedQuadrant(e.target.value as Quadrant)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="Q1">Q1 - 重要 + 紧急</option>
              <option value="Q2">Q2 - 重要 + 不紧急</option>
              <option value="Q3">Q3 - 不重要 + 紧急</option>
              <option value="Q4">Q4 - 不重要 + 不紧急</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              备注
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="添加备注..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-500 text-sm text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
