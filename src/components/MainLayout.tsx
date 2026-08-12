import { useCallback, useEffect, useRef, useState } from 'react';
import { useItemsStore } from '../stores/itemsStore';
import { useGroupsStore } from '../stores/groupsStore';
import { useSettingsStore } from '../stores/settingsStore';
import Sidebar from './Sidebar';
import ItemList from './ItemList';
import SearchBar from './SearchBar';
import ItemEditor from './ItemEditor';
import Settings from './Settings';
import ProgramImporter from './ProgramImporter';
import ToolboxPanel from '../tools/ToolboxPanel';
import AIChatPanel from './AIChatPanel';
import { Plus, LayoutGrid, List, LayoutList, Download, PlayCircle } from 'lucide-react';
import { DEFAULT_SYSTEM_GROUP, DEFAULT_SYSTEM_ITEMS } from '../utils/defaultItems';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { appWindow } from '@tauri-apps/api/window';
import { LaunchItem } from '../types';
import { message } from '@tauri-apps/api/dialog';

/** 判断拖入的文件路径是否是可接受的类型 */
async function isAcceptableFile(filePath: string): Promise<boolean> {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'exe' || ext === 'bat' || ext === 'cmd' || ext === 'lnk') {
    return true;
  }
  // 用后端检测是否为文件夹
  try {
    const fileType = await invoke<string>('detect_file_type', { path: filePath });
    return fileType === 'folder';
  } catch {
    return false;
  }
}

type LauncherItemType = NonNullable<LaunchItem['itemType']>;

interface EditorPrefillData {
  name?: string;
  alias?: string;
  targetPath?: string;
  groupId?: string;
  itemType?: LauncherItemType;
}

interface PendingAddRequest {
  paths?: string[];
  createdAt?: string;
}

function normalizeLauncherPath(path?: string): string {
  if (!path) return '';
  let normalized = path.trim().replace(/\//g, '\\');
  while (normalized.length > 3 && normalized.endsWith('\\')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

function getPathBaseName(path: string): string {
  const parts = path.replace(/\//g, '\\').split('\\').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function buildLauncherName(path: string, fileType: string): string {
  const baseName = getPathBaseName(path);
  const nameWithoutExt = fileType === 'folder' ? baseName : baseName.replace(/\.[^.]+$/, '');
  return (
    nameWithoutExt
      .replace(/[-_](x64|x86|win|windows|setup|installer)$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim() ||
    nameWithoutExt ||
    baseName
  );
}

function inferLauncherItemType(path: string, fileType: string): LauncherItemType {
  if (fileType === 'folder') return 'folder';
  if (/\.(cmd|bat|ps1|ahk)$/i.test(path)) return 'script';
  return 'app';
}

function buildUniqueAlias(name: string, existingItems: LaunchItem[]): string {
  const baseAlias =
    name
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/gi, '') || `item${Date.now().toString(36).slice(-4)}`;
  const used = new Set(existingItems.map((item) => item.alias.toLowerCase()));
  if (!used.has(baseAlias.toLowerCase())) return baseAlias;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseAlias}${index}`;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${baseAlias}${Date.now().toString(36).slice(-4)}`;
}

export default function MainLayout() {
  const { loadItems, addItem } = useItemsStore();
  const { loadGroups, addGroup } = useGroupsStore();
  const { viewMode, updateSettings, loadSettings } = useSettingsStore();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>();
  const [prefillData, setPrefillData] = useState<
    EditorPrefillData | undefined
  >(undefined);
  const [launcherReady, setLauncherReady] = useState(false);
  const [isProgramImporterOpen, setIsProgramImporterOpen] = useState(false);
  const [activeModule, setActiveModule] = useState<'launcher' | 'toolbox' | 'ai-chat'>('launcher');
  const [activeToolCategory, setActiveToolCategory] = useState<
    import('../tools/registry').ToolCategory | 'all'
  >('all');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [aiThreads, setAiThreads] = useState<any[]>([]);

  // 搜索防抖
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 200);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery]);

  // Escape 键关闭模态框
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isProgramImporterOpen) {
          setIsProgramImporterOpen(false);
        } else if (isSettingsOpen) {
          setIsSettingsOpen(false);
        } else if (isEditorOpen) {
          setEditingItemId(undefined);
          setPrefillData(undefined);
          setIsEditorOpen(false);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEditorOpen, isSettingsOpen, isProgramImporterOpen]);

  // 监听从 Sidebar 触发的打开设置事件
  useEffect(() => {
    const handleOpenSettings = () => {
      setIsSettingsOpen(true);
    };
    window.addEventListener('open-settings', handleOpenSettings);
    return () => window.removeEventListener('open-settings', handleOpenSettings);
  }, []);

  // 使用 ref 保存 selectedGroupId 以避免 listener 重建
  const selectedGroupIdRef = useRef(selectedGroupId);
  selectedGroupIdRef.current = selectedGroupId;

  const handleOpenEditor = useCallback((itemId?: string, prefill?: EditorPrefillData) => {
    setEditingItemId(itemId);
    setPrefillData(prefill);
    setIsEditorOpen(true);
  }, []);

  const handleCloseEditor = () => {
    setEditingItemId(undefined);
    setPrefillData(undefined);
    setIsEditorOpen(false);
  };

  const handleDropFile = useCallback(
    async (groupId: string | undefined, filePath: string) => {
      console.log('[Drop] File dropped:', filePath);

      try {
        let targetPath = filePath;
        let itemName = '';
        const fileName = filePath.split('\\').pop()?.split('/').pop() || '';

        // 如果是快捷方式，尝试快速解析
        if (filePath.toLowerCase().endsWith('.lnk')) {
          try {
            const resolved = await invoke<string>('resolve_shortcut', { lnkPath: filePath });
            console.log('[Drop] Resolved shortcut:', filePath, '->', resolved);

            // 只有当解析成功且不是 .lnk 时才使用解析后的路径
            if (!resolved.toLowerCase().endsWith('.lnk')) {
              targetPath = resolved;
            }
          } catch (error) {
            console.error('[Drop] Failed to resolve shortcut:', error);
            // 解析失败，使用原始路径
          }
        }

        // 生成名称
        const nameWithoutExt = fileName.replace(/\.(exe|bat|cmd|ps1|lnk)$/i, '');
        const cleanName = nameWithoutExt
          .replace(/[-_](x64|x86|win|windows|setup|installer)$/i, '')
          .replace(/[-_]/g, ' ')
          .trim();

        itemName =
          cleanName
            .split(' ')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ') || fileName;

        // 生成别名
        const alias = itemName
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(/[^a-z0-9]/gi, '');

        console.log('[Drop] Opening editor with:', { itemName, alias, targetPath });

        // 打开编辑器
        handleOpenEditor(undefined, {
          name: itemName,
          alias: alias || 'app',
          targetPath: targetPath,
          groupId: groupId,
        });
      } catch (error) {
        console.error('[Drop] Failed to process dropped file:', error);
        alert(`处理文件失败：${error}`);
      }
    },
    [handleOpenEditor]
  );

  const pendingAddInFlightRef = useRef(false);

  const openAddOrEditPath = useCallback(
    async (rawPath: string) => {
      const originalPath = rawPath.trim();
      if (!originalPath) return;

      try {
        let targetPath = originalPath;
        if (originalPath.toLowerCase().endsWith('.lnk')) {
          try {
            const resolved = await invoke<string>('resolve_shortcut', { lnkPath: originalPath });
            if (resolved && !resolved.toLowerCase().endsWith('.lnk')) {
              targetPath = resolved;
            }
          } catch (error) {
            console.error('[ContextMenuAdd] Failed to resolve shortcut:', error);
          }
        }

        const targetKey = normalizeLauncherPath(targetPath);
        const originalKey = normalizeLauncherPath(originalPath);
        const existingItem = useItemsStore
          .getState()
          .items.find((item) => {
            const itemKey = normalizeLauncherPath(item.targetPath);
            return itemKey === targetKey || itemKey === originalKey;
          });

        setActiveModule('launcher');
        if (existingItem) {
          handleOpenEditor(existingItem.id);
          return;
        }

        let detectedType = 'unknown';
        try {
          detectedType = await invoke<string>('detect_file_type', { path: targetPath });
        } catch (error) {
          console.error('[ContextMenuAdd] Failed to detect file type:', error);
        }

        const name = buildLauncherName(targetPath, detectedType);
        const alias = buildUniqueAlias(name, useItemsStore.getState().items);
        handleOpenEditor(undefined, {
          name,
          alias,
          targetPath,
          groupId: selectedGroupIdRef.current,
          itemType: inferLauncherItemType(targetPath, detectedType),
        });
      } catch (error) {
        console.error('[ContextMenuAdd] Failed to open add/edit modal:', error);
        await message(`打开添加窗口失败：${error}`, { title: '错误', type: 'error' });
      }
    },
    [handleOpenEditor]
  );

  const takePendingAddRequest = useCallback(async () => {
    if (pendingAddInFlightRef.current) return;
    pendingAddInFlightRef.current = true;
    try {
      const pending = await invoke<PendingAddRequest | null>('launcher_take_pending_add_request');
      const path = pending?.paths?.find((item) => item.trim().length > 0);
      if (path) {
        await openAddOrEditPath(path);
      }
    } catch (error) {
      console.error('[ContextMenuAdd] Failed to consume pending request:', error);
    } finally {
      pendingAddInFlightRef.current = false;
    }
  }, [openAddOrEditPath]);

  // 批量启动当前分组
  const handleLaunchGroup = useCallback(async () => {
    if (!selectedGroupId) return;
    try {
      const count = await invoke<number>('launch_group', { groupId: selectedGroupId });
      if (count > 0) {
        // 重新加载以更新 lastUsed 和 launchCount
        await loadItems();
      }
    } catch (error) {
      await message(`批量启动失败：${error}`, { title: '错误', type: 'error' });
    }
  }, [selectedGroupId, loadItems]);

  useEffect(() => {
    const initializeApp = async () => {
      // 1. 先加载设置和基础数据（必须同步）
      await loadSettings();
      await loadItems();
      await loadGroups();

      let currentItems = useItemsStore.getState().items;
      let currentGroups = useGroupsStore.getState().groups;

      // 2. 如果是首次启动，添加默认项目（必须同步）
      if (currentItems.length === 0 && currentGroups.length === 0) {
        try {
          const systemGroup = await addGroup(DEFAULT_SYSTEM_GROUP);

          for (const item of DEFAULT_SYSTEM_ITEMS) {
            await addItem({
              ...item,
              groupId: systemGroup.id,
            });
          }

          await loadItems();
          await loadGroups();
          console.log('默认系统应用已添加');
        } catch (error) {
          console.error('添加默认系统应用失败:', error);
        }
      }

      // 3. 数据加载完成，显示主窗口
      await appWindow.show();
      setLauncherReady(true);
      console.log('[UI] Main window shown');
    };

    // 后台任务函数（完全独立执行）
    const runBackgroundTasks = async () => {
      // 等待主界面渲染完成
      await new Promise((resolve) => setTimeout(resolve, 1000));

      console.log('[Background] Starting background tasks...');

      let needsReload = false;

      // 备份恢复检查（后台执行）
      try {
        const hasRecoverableBackup = await invoke<boolean>('check_recoverable_backup');
        if (hasRecoverableBackup) {
          const backups = await invoke<[string, string][]>('list_backups');
          const latestBackup = backups[0];

          if (latestBackup) {
            const [backupName] = latestBackup;
            const [, backupPath] = latestBackup;
            const confirmed = window.confirm(
              `检测到可恢复的自动备份\n\n最新备份：${backupName}\n\n是否先从这个备份恢复数据？`
            );

            if (confirmed) {
              await invoke('restore_from_backup', { path: backupPath });
              needsReload = true;
            }
          }
        }
      } catch (error) {
        console.error('备份恢复检查失败:', error);
      }

      // 清理重复分组（后台执行）
      try {
        await invoke('cleanup_duplicate_groups');
        needsReload = true;
      } catch (error) {
        console.error('清理重复分组失败:', error);
      }

      // 注册表恢复检查（后台执行）
      try {
        const recoverable = await invoke<LaunchItem[]>('recover_from_registry');
        if (recoverable.length > 0) {
          const itemList = recoverable
            .map((i: LaunchItem) => `• ${i.name}（${i.alias}）`)
            .slice(0, 10)
            .join('\n');
          const moreText = recoverable.length > 10 ? `\n...还有 ${recoverable.length - 10} 个` : '';
          const confirmed = window.confirm(
            `🔍 检测到可恢复的数据\n\n` +
              `发现 ${recoverable.length} 个未记录的快捷方式：\n\n` +
              itemList +
              moreText +
              `\n\n是否将这些数据恢复到软件中？`
          );
          if (confirmed) {
            const count = await invoke<number>('save_recovered_items', { items: recoverable });
            needsReload = true;
            alert(`✅ 已成功恢复 ${count} 个项目！`);
          }
        }
      } catch (error) {
        console.error('注册表恢复检查失败:', error);
      }

      // 只在需要时重新加载一次
      if (needsReload) {
        await loadGroups();
        await loadItems();
      }

      console.log('[Background] Background tasks completed');
    };

    // 立即执行主初始化
    initializeApp();

    // 独立执行后台任务（不阻塞主流程）
    runBackgroundTasks();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!launcherReady) return;

    void takePendingAddRequest();
    const timer = window.setInterval(() => {
      void takePendingAddRequest();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [launcherReady, takePendingAddRequest]);

  // 监听 Tauri 文件拖拽事件
  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen<string[]>('tauri://file-drop', async (event) => {
        console.log('File drop event:', event);
        const paths = event.payload;
        if (paths && paths.length > 0) {
          for (const path of paths) {
            const acceptable = await isAcceptableFile(path);
            if (acceptable) {
              handleDropFile(selectedGroupIdRef.current, path);
            }
          }
        }
      });

      return unlisten;
    };

    let unlistenFn: (() => void) | undefined;
    setupListener().then((fn) => {
      unlistenFn = fn;
    });

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [handleDropFile]);

  // 监听来自剪贴板窗口的"打开设置"事件
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    listen('open-settings', () => {
      setIsSettingsOpen(true);
    }).then((fn) => {
      unlistenFn = fn;
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // 监听工具箱快捷键事件（从 toolbox 窗口切换到主窗口工具箱模块）
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    listen('open-toolbox', () => {
      setActiveModule('toolbox');
    }).then((fn) => {
      unlistenFn = fn;
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // 监听 AI 聊天快捷键事件
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    listen('open-ai-chat', () => {
      setActiveModule('ai-chat');
    }).then((fn) => {
      unlistenFn = fn;
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      {/* Sidebar */}
      <Sidebar
        selectedGroupId={selectedGroupId}
        onSelectGroup={setSelectedGroupId}
        onDropFile={handleDropFile}
        activeModule={activeModule}
        onModuleChange={setActiveModule}
        activeToolCategory={activeToolCategory}
        onToolCategoryChange={setActiveToolCategory}
        activeThreadId={activeThreadId || undefined}
        onThreadSelect={(threadId) => setActiveThreadId(threadId)}
        onNewThread={() => {
          // 触发 AIChatPanel 打开新建对话弹窗
          const event = new CustomEvent('open-new-conversation-dialog');
          window.dispatchEvent(event);
        }}
        aiThreads={aiThreads}
        onArchiveThread={async (threadId) => {
          // 这个函数会由 AIChatPanel 提供
          const event = new CustomEvent('archive-thread', { detail: threadId });
          window.dispatchEvent(event);
        }}
        onDeleteThread={async (threadId) => {
          // 这个函数会由 AIChatPanel 提供
          const event = new CustomEvent('delete-thread', { detail: threadId });
          window.dispatchEvent(event);
        }}
        onRenameThread={(threadId, newTitle) => {
          const event = new CustomEvent('rename-thread', { detail: { threadId, newTitle } });
          window.dispatchEvent(event);
        }}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">{/* 移除了标题文字，保持布局 */}</div>
            <div className="flex items-center gap-3">
              {/* 视图切换按钮 - 仅启动器模式 */}
              {activeModule === 'launcher' && (
                <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
                  <button
                    onClick={() => updateSettings({ viewMode: 'grid' })}
                    className={`p-1.5 rounded transition-colors ${
                      viewMode === 'grid'
                        ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                    title="网格视图"
                  >
                    <LayoutGrid size={18} />
                  </button>
                  <button
                    onClick={() => updateSettings({ viewMode: 'list' })}
                    className={`p-1.5 rounded transition-colors ${
                      viewMode === 'list'
                        ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                    title="列表视图"
                  >
                    <List size={18} />
                  </button>
                  <button
                    onClick={() => updateSettings({ viewMode: 'compact' })}
                    className={`p-1.5 rounded transition-colors ${
                      viewMode === 'compact'
                        ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                    title="紧凑视图"
                  >
                    <LayoutList size={18} />
                  </button>
                </div>
              )}

              {activeModule === 'launcher' && (
                <>
                  <button
                    onClick={() => setIsProgramImporterOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 btn-secondary rounded-lg"
                    title="从已安装程序导入"
                  >
                    <Download size={18} />
                    <span className="text-sm">导入</span>
                  </button>
                  {selectedGroupId && (
                    <button
                      onClick={handleLaunchGroup}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow-sm hover:shadow-md transition-all duration-200"
                      title="启动当前分组所有项目"
                    >
                      <PlayCircle size={18} />
                      <span className="text-sm">全部启动</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleOpenEditor()}
                    className="flex items-center gap-2 px-4 py-2 btn-primary rounded-lg"
                  >
                    <Plus size={18} />
                    <span className="text-sm">添加项目</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Search Bar - 仅启动器模式 */}
        {activeModule === 'launcher' && (
          <div className="px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
            <SearchBar value={searchQuery} onChange={setSearchQuery} />
          </div>
        )}

        {/* 启动器内容 */}
        {activeModule === 'launcher' && (
          <div className="flex-1 overflow-auto px-6 py-6 custom-scrollbar">
            <ItemList
              searchQuery={debouncedSearchQuery}
              groupId={selectedGroupId}
              viewMode={viewMode}
              onEditItem={handleOpenEditor}
            />
          </div>
        )}

        {/* 工具箱内容 */}
        {activeModule === 'toolbox' && (
          <div className="flex-1 overflow-auto">
            <ToolboxPanel activeCategory={activeToolCategory} />
          </div>
        )}

        {/* AI 聊天内容 */}
        {activeModule === 'ai-chat' && (
          <div className="flex-1 overflow-hidden">
            <AIChatPanel
              activeThreadId={activeThreadId}
              onThreadIdChange={setActiveThreadId}
              onThreadsChange={setAiThreads}
            />
          </div>
        )}
      </div>

      {/* Item Editor Modal */}
      {isEditorOpen && (
        <ItemEditor
          key={editingItemId || prefillData?.targetPath || 'new-item'}
          itemId={editingItemId}
          defaultGroupId={selectedGroupId}
          prefillData={prefillData}
          onClose={handleCloseEditor}
        />
      )}

      {/* Settings Modal */}
      {isSettingsOpen && <Settings onClose={() => setIsSettingsOpen(false)} />}

      {/* Program Importer */}
      {isProgramImporterOpen && (
        <ProgramImporter
          onClose={() => {
            setIsProgramImporterOpen(false);
            loadItems();
          }}
        />
      )}
    </div>
  );
}
