import { useGroupsStore } from '../stores/groupsStore';
import { useItemsStore } from '../stores/itemsStore';
import {
  Folder,
  Plus,
  MoreVertical,
  Edit2,
  Trash2,
  Info,
  X,
  Zap,
  Search,
  Globe,
  FolderOpen,
  Settings,
  Shield,
  Rocket,
  Wrench,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import GroupEditor from './GroupEditor';
import AIThreadList from './AIThreadList';
import { ask, message } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import { type ToolCategory } from '../tools/registry';
import { useToolCategoryStore } from '../stores/toolCategoryStore';
import type { ChatThread } from '../types/aiChat';

interface SidebarProps {
  selectedGroupId?: string;
  onSelectGroup: (groupId?: string) => void;
  onDropFile: (groupId: string | undefined, filePath: string) => void;
  activeModule: 'launcher' | 'toolbox' | 'ai-chat';
  onModuleChange: (module: 'launcher' | 'toolbox' | 'ai-chat') => void;
  activeToolCategory: ToolCategory | 'all';
  onToolCategoryChange: (cat: ToolCategory | 'all') => void;
  // AI 聊天相关
  activeThreadId?: string;
  onThreadSelect?: (threadId: string) => void;
  onNewThread?: () => void;
  aiThreads?: ChatThread[];
  onArchiveThread?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onRenameThread?: (threadId: string, newTitle: string) => void;
}

export default function Sidebar({
  selectedGroupId,
  onSelectGroup,
  onDropFile,
  activeModule,
  onModuleChange,
  activeToolCategory,
  onToolCategoryChange,
  activeThreadId,
  onThreadSelect,
  onNewThread,
  aiThreads = [],
  onArchiveThread,
  onDeleteThread,
  onRenameThread,
}: SidebarProps) {
  const { groups, deleteGroup, updateGroup } = useGroupsStore();
  const { items } = useItemsStore();
  const {
    getAllCategories,
    addCategory,
    updateCategory,
    deleteCategory: deleteToolCategory,
  } = useToolCategoryStore();
  const allToolCategories = getAllCategories();
  const BUILTIN_CAT_IDS = [
    'ai',
    'efficiency',
    'text',
    'network',
    'download',
    'system',
    'dev',
    'image',
    'media',
    'pdf',
    'office',
    'other',
  ];
  const [toolCatContextId, setToolCatContextId] = useState<string | null>(null);
  const [isAddingToolCat, setIsAddingToolCat] = useState(false);
  const [editingToolCat, setEditingToolCat] = useState<
    import('../stores/toolCategoryStore').ToolCategory | null
  >(null);
  const [toolCatName, setToolCatName] = useState('');
  const [toolCatColor, setToolCatColor] = useState('#6b7280');
  const [isGroupEditorOpen, setIsGroupEditorOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | undefined>();
  const [contextMenuGroupId, setContextMenuGroupId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toolCatMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭启动器分组菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setContextMenuGroupId(null);
      }
    };
    if (contextMenuGroupId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenuGroupId]);

  // 点击外部关闭工具分类菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolCatMenuRef.current && !toolCatMenuRef.current.contains(event.target as Node)) {
        setToolCatContextId(null);
      }
    };
    if (toolCatContextId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [toolCatContextId]);

  const handleDragOver = (e: React.DragEvent, groupId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroupId(groupId || 'all');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroupId(null);
  };

  const handleDrop = async (e: React.DragEvent, groupId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroupId(null);

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const filePath = (file as File & { path?: string }).path;
      if (filePath) {
        const ext = filePath.split('.').pop()?.toLowerCase();
        if (ext === 'exe' || ext === 'bat' || ext === 'cmd' || ext === 'lnk') {
          onDropFile(groupId, filePath);
        } else {
          // 用后端检测是否为文件夹
          try {
            const fileType = await invoke<string>('detect_file_type', { path: filePath });
            if (fileType === 'folder') {
              onDropFile(groupId, filePath);
            }
          } catch {
            // 忽略检测失败的文件
          }
        }
      }
    }
  };

  const handleEditGroup = (groupId: string) => {
    setEditingGroupId(groupId);
    setIsGroupEditorOpen(true);
    setContextMenuGroupId(null);
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;

      const itemCount = items.filter((item) => item.groupId === groupId).length;

      const confirmed = await ask(
        `确定要删除分组"${group.name}"吗？\n\n` +
          `📊 包含项目：${itemCount} 个\n\n` +
          `⚠️ 分组内的项目不会被删除，将移至"全部项目"。`,
        {
          title: '确认删除',
          type: 'warning',
        }
      );

      if (confirmed) {
        await deleteGroup(groupId);
        if (selectedGroupId === groupId) {
          onSelectGroup(undefined);
        }
      }
    } catch (error) {
      console.error('Failed to delete group:', error);
      await message(`删除失败：${error}`, { title: '错误', type: 'error' });
    }
    setContextMenuGroupId(null);
  };

  const handleNewGroup = () => {
    setEditingGroupId(undefined);
    setIsGroupEditorOpen(true);
  };

  // 处理分组拖拽排序
  const handleGroupDragStart = (e: React.DragEvent, groupId: string) => {
    setDraggingGroupId(groupId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', groupId);
  };

  const handleGroupDragOver = (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggingGroupId && draggingGroupId !== targetGroupId) {
      setDragOverGroupId(targetGroupId);
    }
  };

  const handleGroupDragLeave = () => {
    setDragOverGroupId(null);
  };

  const handleGroupDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroupId(null);

    if (!draggingGroupId || draggingGroupId === targetGroupId) {
      setDraggingGroupId(null);
      return;
    }

    // 重新排序分组
    const draggedIndex = groups.findIndex((g) => g.id === draggingGroupId);
    const targetIndex = groups.findIndex((g) => g.id === targetGroupId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggingGroupId(null);
      return;
    }

    // 更新所有分组的 order — 批量调用后端
    const newGroups = [...groups];
    const [draggedGroup] = newGroups.splice(draggedIndex, 1);
    newGroups.splice(targetIndex, 0, draggedGroup);

    try {
      await invoke('reorder_groups', {
        groupIds: newGroups.map((g) => g.id),
      });
      // 重新加载以获取最新状态
      const { loadGroups } = useGroupsStore.getState();
      await loadGroups();
    } catch (error) {
      console.error('Failed to reorder groups:', error);
      // 回退：逐个更新
      for (let i = 0; i < newGroups.length; i++) {
        await updateGroup(newGroups[i].id, { ...newGroups[i], order: i });
      }
    }

    setDraggingGroupId(null);
  };

  const handleGroupDragEnd = () => {
    setDraggingGroupId(null);
    setDragOverGroupId(null);
  };

  return (
    <>
      <aside className="w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col">
        {/* 一级模块切换 - 左右布局 */}
        <div className="p-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
            <button
              onClick={() => onModuleChange('launcher')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                activeModule === 'launcher'
                  ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <Rocket size={14} />
              <span>启动器</span>
            </button>
            <button
              onClick={() => onModuleChange('toolbox')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                activeModule === 'toolbox'
                  ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <Wrench size={14} />
              <span>工具箱</span>
            </button>
            <button
              onClick={() => onModuleChange('ai-chat')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                activeModule === 'ai-chat'
                  ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
              <span>AI</span>
            </button>
          </div>
        </div>

        {/* 启动器：分组列表 */}
        {activeModule === 'launcher' && (
          <>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                分组
              </h2>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
              {/* All Items */}
              <button
                onClick={() => onSelectGroup(undefined)}
                onDragOver={(e) => handleDragOver(e, undefined)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, undefined)}
                className={`w-full flex items-center gap-3 sidebar-item ${
                  selectedGroupId === undefined ? 'sidebar-item-active' : ''
                } ${dragOverGroupId === 'all' ? 'ring-2 ring-[#0066ff]' : ''}`}
              >
                <Folder size={18} />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  全部项目
                </span>
              </button>

              {/* Group List */}
              <div className="space-y-1 pt-1">
                {groups.map((group) => (
                  <div
                    key={group.id}
                    className="relative"
                    draggable
                    onDragStart={(e) => handleGroupDragStart(e, group.id)}
                    onDragOver={(e) => handleGroupDragOver(e, group.id)}
                    onDragLeave={handleGroupDragLeave}
                    onDrop={(e) => handleGroupDrop(e, group.id)}
                    onDragEnd={handleGroupDragEnd}
                  >
                    <div className="group/item">
                      <button
                        onClick={() => onSelectGroup(group.id)}
                        onDragOver={(e) => handleDragOver(e, group.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, group.id)}
                        className={`w-full flex items-center gap-3 sidebar-item ${
                          selectedGroupId === group.id ? 'sidebar-item-active' : ''
                        } ${dragOverGroupId === group.id && !draggingGroupId ? 'ring-2 ring-[#0066ff]' : ''} ${
                          draggingGroupId === group.id ? 'opacity-50' : ''
                        } ${dragOverGroupId === group.id && draggingGroupId ? 'border-t-2 border-[#0066ff]' : ''}`}
                      >
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: group.color || '#6b7280' }}
                        />
                        <span className="text-sm font-medium truncate flex-1 text-left text-gray-900 dark:text-gray-100">
                          {group.name}
                        </span>
                      </button>

                      {/* 分组操作按钮 */}
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 transition-opacity z-10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setContextMenuGroupId(
                              contextMenuGroupId === group.id ? null : group.id
                            );
                          }}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                        >
                          <MoreVertical size={14} />
                        </button>
                      </div>
                    </div>

                    {/* 下拉菜单 - 使用独立的定位层 */}
                    {contextMenuGroupId === group.id && (
                      <div
                        ref={menuRef}
                        className="absolute right-2 top-full mt-1 card rounded-lg shadow-xl py-1 z-[100] min-w-[120px] animate-fade-in"
                      >
                        <button
                          onClick={() => handleEditGroup(group.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                          <Edit2 size={14} />
                          <span>编辑</span>
                        </button>
                        <button
                          onClick={() => handleDeleteGroup(group.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Trash2 size={14} />
                          <span>删除</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </nav>

            {/* Add Group Button */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-800 space-y-1.5">
              <button
                onClick={handleNewGroup}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm btn-secondary rounded-lg"
              >
                <Plus size={16} className="flex-shrink-0" />
                新建分组
              </button>
              <button
                onClick={() => {
                  // 触发打开设置面板
                  window.dispatchEvent(new CustomEvent('open-settings'));
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <Settings size={16} className="flex-shrink-0" />
                全局设置
              </button>
              <button
                onClick={() => setIsAboutOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <Info size={13} className="flex-shrink-0" />
                关于 McStartUP
              </button>
            </div>
          </>
        )}

        {/* 工具箱模式：分类列表 */}
        {activeModule === 'toolbox' && (
          <>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                分类
              </h2>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
              {/* 全部工具 */}
              <button
                onClick={() => onToolCategoryChange('all')}
                className={`w-full flex items-center gap-3 sidebar-item ${
                  activeToolCategory === 'all' ? 'sidebar-item-active' : ''
                }`}
              >
                <Wrench size={18} />
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  全部工具
                </span>
              </button>

              {/* 分类列表 */}
              {allToolCategories.map((cat) => (
                <div key={cat.id} className="relative group/cat">
                  <button
                    onClick={() => onToolCategoryChange(cat.id)}
                    className={`w-full flex items-center gap-3 sidebar-item ${
                      activeToolCategory === cat.id ? 'sidebar-item-active' : ''
                    }`}
                  >
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: cat.color || '#6b7280' }}
                    />
                    <span className="text-sm font-medium truncate flex-1 text-left text-gray-900 dark:text-gray-100">
                      {cat.name}
                    </span>
                  </button>
                  {/* 编辑/删除按钮（自定义分类才显示删除） */}
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/cat:opacity-100 transition-opacity z-10">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setToolCatContextId(toolCatContextId === cat.id ? null : cat.id);
                      }}
                      className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                    >
                      <MoreVertical size={14} />
                    </button>
                  </div>
                  {toolCatContextId === cat.id && (
                    <div
                      ref={toolCatMenuRef}
                      className="absolute right-2 top-full mt-1 card rounded-lg shadow-xl py-1 z-[100] min-w-[120px] animate-fade-in"
                    >
                      <button
                        onClick={() => {
                          setEditingToolCat(cat);
                          setToolCatName(cat.name);
                          setToolCatColor(cat.color || '#6b7280');
                          setToolCatContextId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      >
                        <Edit2 size={14} />
                        <span>编辑</span>
                      </button>
                      {!BUILTIN_CAT_IDS.includes(cat.id) && (
                        <button
                          onClick={() => {
                            deleteToolCategory(cat.id);
                            setToolCatContextId(null);
                            if (activeToolCategory === cat.id) onToolCategoryChange('all');
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Trash2 size={14} />
                          <span>删除</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </nav>

            {/* 新建分类 */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-800 space-y-1.5">
              <button
                onClick={() => setIsAddingToolCat(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm btn-secondary rounded-lg"
              >
                <Plus size={16} className="flex-shrink-0" />
                新建分类
              </button>
              <button
                onClick={() => {
                  // 触发打开设置面板
                  window.dispatchEvent(new CustomEvent('open-settings'));
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <Settings size={16} className="flex-shrink-0" />
                全局设置
              </button>
              <button
                onClick={() => setIsAboutOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <Info size={13} className="flex-shrink-0" />
                关于 McStartUP
              </button>
            </div>
          </>
        )}

        {/* AI 聊天模式：对话线程列表 */}
        {activeModule === 'ai-chat' && (
          <>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                对话
              </h2>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
              {onThreadSelect && onArchiveThread && onDeleteThread && (
                <AIThreadList
                  threads={aiThreads}
                  activeThreadId={activeThreadId || null}
                  onThreadSelect={onThreadSelect}
                  onArchiveThread={onArchiveThread}
                  onDeleteThread={onDeleteThread}
                  onRenameThread={onRenameThread}
                />
              )}
            </nav>

            {/* 新建对话按钮 */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-800 space-y-1.5">
              <button
                onClick={onNewThread}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm btn-primary rounded-lg"
              >
                <Plus size={16} className="flex-shrink-0" />
                新建对话
              </button>
              <button
                onClick={() => {
                  // 触发打开设置面板
                  window.dispatchEvent(new CustomEvent('open-settings'));
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <Settings size={16} className="flex-shrink-0" />
                全局设置
              </button>
              <button
                onClick={() => setIsAboutOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <Info size={13} className="flex-shrink-0" />
                关于 McStartUP
              </button>
            </div>
          </>
        )}
      </aside>

      {/* Group Editor Modal */}
      {isGroupEditorOpen && (
        <GroupEditor
          groupId={editingGroupId}
          onClose={() => {
            setIsGroupEditorOpen(false);
            setEditingGroupId(undefined);
          }}
        />
      )}

      {/* 工具分类 新增/编辑 弹窗 */}
      {(isAddingToolCat || editingToolCat) && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => {
            setIsAddingToolCat(false);
            setEditingToolCat(null);
            setToolCatName('');
            setToolCatColor('#6b7280');
          }}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {editingToolCat ? '编辑分类' : '新建分类'}
              </h2>
              <button
                onClick={() => {
                  setIsAddingToolCat(false);
                  setEditingToolCat(null);
                  setToolCatName('');
                  setToolCatColor('#6b7280');
                }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  分类名称 *
                </label>
                <input
                  autoFocus
                  type="text"
                  value={toolCatName}
                  onChange={(e) => setToolCatName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const name = toolCatName.trim();
                      if (!name) return;
                      if (editingToolCat) {
                        updateCategory(editingToolCat.id, name, toolCatColor);
                      } else {
                        addCategory(name, toolCatColor);
                      }
                      setIsAddingToolCat(false);
                      setEditingToolCat(null);
                      setToolCatName('');
                      setToolCatColor('#6b7280');
                    }
                  }}
                  placeholder="输入分类名称"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  颜色标签
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={toolCatColor}
                    onChange={(e) => setToolCatColor(e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border border-gray-300 dark:border-gray-600 p-0.5"
                  />
                  <div className="flex gap-2 flex-wrap">
                    {[
                      '#3b82f6',
                      '#8b5cf6',
                      '#10b981',
                      '#f59e0b',
                      '#ef4444',
                      '#ec4899',
                      '#06b6d4',
                      '#6b7280',
                    ].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setToolCatColor(c)}
                        className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${toolCatColor === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => {
                  setIsAddingToolCat(false);
                  setEditingToolCat(null);
                  setToolCatName('');
                  setToolCatColor('#6b7280');
                }}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const name = toolCatName.trim();
                  if (!name) return;
                  if (editingToolCat) {
                    updateCategory(editingToolCat.id, name, toolCatColor);
                  } else {
                    addCategory(name, toolCatColor);
                  }
                  setIsAddingToolCat(false);
                  setEditingToolCat(null);
                  setToolCatName('');
                  setToolCatColor('#6b7280');
                }}
                disabled={!toolCatName.trim()}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {editingToolCat ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* About Modal */}
      {isAboutOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setIsAboutOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative px-8 pt-8 pb-5 text-center border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
              <button
                onClick={() => setIsAboutOpen(false)}
                className="absolute right-4 top-4 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0066ff] to-[#5856D6] flex items-center justify-center mx-auto mb-3 shadow-lg shadow-blue-500/30">
                <span className="text-white font-bold text-3xl">M</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">McStartUP</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Windows 全能效率工具箱
              </p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <span className="text-xs px-2.5 py-1 rounded-full bg-[#0066ff]/10 text-[#0066ff] font-medium">
                  v0.1.0
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">作者：暮城</span>
              </div>
            </div>

            {/* Features - scrollable */}
            <div className="px-6 py-5 overflow-y-auto flex-1">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed text-center">
                McStartUP 是一款专为 Windows 用户打造的全能效率工具箱，集快速启动、截图编辑、OCR
                识别、翻译、剪贴板管理、AI 对话等功能于一体。
              </p>

              <div className="grid grid-cols-2 gap-2.5">
                {[
                  {
                    icon: <Zap size={14} />,
                    color: 'blue',
                    title: '快速启动',
                    desc: '自定义别名，Win+R 一键启动',
                  },
                  {
                    icon: <Search size={14} />,
                    color: 'purple',
                    title: '全局搜索',
                    desc: 'Alt+Space 搜索，支持 Everything',
                  },
                  {
                    icon: <Globe size={14} />,
                    color: 'green',
                    title: '多类型管理',
                    desc: '应用、网址、文件夹统一管理',
                  },
                  {
                    icon: <FolderOpen size={14} />,
                    color: 'yellow',
                    title: '分组批量启动',
                    desc: '按类别整理，一键批量启动',
                  },
                  {
                    icon: <Settings size={14} />,
                    color: 'orange',
                    title: '截图编辑',
                    desc: '区域截图 + 矩形/箭头/文字/马赛克',
                  },
                  {
                    icon: <Shield size={14} />,
                    color: 'red',
                    title: 'OCR 文字识别',
                    desc: '截图识别，支持百度/腾讯/谷歌',
                  },
                  {
                    icon: <Rocket size={14} />,
                    color: 'indigo',
                    title: '截图翻译',
                    desc: '截图 OCR + 多引擎翻译一体化',
                  },
                  {
                    icon: <Wrench size={14} />,
                    color: 'teal',
                    title: '划词翻译',
                    desc: '优先使用 UIAutomation，自动兼容不支持的应用',
                  },
                  {
                    icon: <Zap size={14} />,
                    color: 'cyan',
                    title: '剪贴板历史',
                    desc: '自动记录，快速检索复用',
                  },
                  {
                    icon: <Search size={14} />,
                    color: 'pink',
                    title: 'AI 智能对话',
                    desc: '支持 OpenAI / Gemini / 自定义',
                  },
                  {
                    icon: <Globe size={14} />,
                    color: 'violet',
                    title: '工具箱',
                    desc: 'JSON/正则/Base64/二维码等 20+ 工具',
                  },
                  {
                    icon: <Shield size={14} />,
                    color: 'slate',
                    title: '数据安全',
                    desc: '本地存储，自动备份，注册表恢复',
                  },
                ].map(({ icon, color, title, desc }) => {
                  const colorMap: Record<string, string> = {
                    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
                    purple:
                      'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
                    green: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
                    yellow:
                      'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400',
                    orange:
                      'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
                    red: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
                    indigo:
                      'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
                    teal: 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400',
                    cyan: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400',
                    pink: 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400',
                    violet:
                      'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
                    slate: 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400',
                  };
                  return (
                    <div
                      key={title}
                      className="flex items-start gap-2.5 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors"
                    >
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}
                      >
                        {icon}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-tight">
                          {title}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">
                          {desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="px-8 py-4 border-t border-gray-100 dark:border-gray-800 text-center flex-shrink-0">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                基于 Tauri 1.5 + React 18 构建 · 数据完全存储于本地
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
