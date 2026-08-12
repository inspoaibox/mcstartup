import { useEffect, useState, useCallback } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { useMcpStore } from '../stores/mcpStore';
import * as aiChatApi from '../api/aiChatApi';
import type { ChatThread } from '../types/aiChat';
import ChatInterface from './ChatInterface';
import ArtifactChatInterface from './ArtifactChatInterface';
import NewConversationDialog from './NewConversationDialog';
import MemoryPanel from './MemoryPanel';

interface AIChatPanelProps {
  activeThreadId: string | null;
  onThreadIdChange: (threadId: string | null) => void;
  onThreadsChange: (threads: ChatThread[]) => void;
}

export default function AIChatPanel({
  activeThreadId,
  onThreadIdChange,
  onThreadsChange,
}: AIChatPanelProps) {
  const { aiProviders, activeAiProviderId } = useSettingsStore();
  const { refreshTools, refreshServersStatus, subscribeToEvents } = useMcpStore();
  const [showNewConversationDialog, setShowNewConversationDialog] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [chatReloadKey, setChatReloadKey] = useState(0);

  const reloadChat = () => setChatReloadKey((k) => k + 1);

  const activeProvider = aiProviders?.find((p) => p.id === activeAiProviderId);

  // 应用启动时初始化 MCP store：加载工具列表并订阅实时更新事件
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    refreshTools();
    refreshServersStatus();
    let unlisten: (() => void) | null = null;
    subscribeToEvents().then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const allThreads = await aiChatApi.listThreads();
      setThreads(allThreads);
      onThreadsChange(allThreads);
    } catch (error) {
      console.error('Failed to load threads:', error);
    }
  }, [onThreadsChange]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const handleCreateThread = useCallback(
    async (
      providerId: string,
      model: string,
      params: {
        title: string;
        system_prompt: string;
        temperature: number;
        max_tokens: number;
        top_p: number;
        frequency_penalty: number;
        presence_penalty: number;
      }
    ) => {
      try {
        const newThread = await aiChatApi.createThread({
          title: params.title || '新对话',
          provider_id: providerId,
          model: model,
          system_prompt: params.system_prompt,
          temperature: params.temperature,
          max_tokens: params.max_tokens,
          top_p: params.top_p,
          frequency_penalty: params.frequency_penalty,
          presence_penalty: params.presence_penalty,
        });
        const newThreads = [newThread, ...threads];
        setThreads(newThreads);
        onThreadsChange(newThreads);
        onThreadIdChange(newThread.id);
        setShowNewConversationDialog(false);
      } catch (error) {
        console.error('Failed to create thread:', error);
        alert('创建对话失败：' + error);
      }
    },
    [threads, onThreadsChange, onThreadIdChange]
  );

  const handleRenameThread = useCallback(
    async (threadId: string, newTitle: string) => {
      try {
        await aiChatApi.updateThreadTitle({ thread_id: threadId, title: newTitle });
        const newThreads = threads.map((t) => (t.id === threadId ? { ...t, title: newTitle } : t));
        setThreads(newThreads);
        onThreadsChange(newThreads);
      } catch (error) {
        console.error('Failed to rename thread:', error);
        alert('重命名失败：' + error);
      }
    },
    [threads, onThreadsChange]
  );

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      const userConfirmed = await Promise.resolve(confirm('确定要删除这个对话吗？'));
      if (!userConfirmed) return;

      try {
        await aiChatApi.deleteThread(threadId);
        const newThreads = threads.filter((t) => t.id !== threadId);
        setThreads(newThreads);
        onThreadsChange(newThreads);
        if (activeThreadId === threadId) {
          onThreadIdChange(null);
        }
      } catch (error) {
        console.error('Failed to delete thread:', error);
        alert('删除对话失败：' + error);
      }
    },
    [threads, activeThreadId, onThreadsChange, onThreadIdChange]
  );

  const handleArchiveThread = useCallback(
    async (threadId: string) => {
      try {
        await aiChatApi.archiveThread(threadId);
        await loadThreads();
      } catch (error) {
        console.error('Failed to archive thread:', error);
      }
    },
    [loadThreads]
  );

  useEffect(() => {
    const handleArchive = async (e: Event) => {
      const threadId = (e as CustomEvent).detail;
      await handleArchiveThread(threadId);
    };

    const handleDelete = async (e: Event) => {
      const threadId = (e as CustomEvent).detail;
      await handleDeleteThread(threadId);
    };

    const handleRename = async (e: Event) => {
      const { threadId, newTitle } = (e as CustomEvent).detail;
      await handleRenameThread(threadId, newTitle);
    };

    const handleOpenNewDialog = () => {
      setShowNewConversationDialog(true);
    };

    window.addEventListener('archive-thread', handleArchive);
    window.addEventListener('delete-thread', handleDelete);
    window.addEventListener('rename-thread', handleRename);
    window.addEventListener('open-new-conversation-dialog', handleOpenNewDialog);

    return () => {
      window.removeEventListener('archive-thread', handleArchive);
      window.removeEventListener('delete-thread', handleDelete);
      window.removeEventListener('rename-thread', handleRename);
      window.removeEventListener('open-new-conversation-dialog', handleOpenNewDialog);
    };
  }, [handleArchiveThread, handleDeleteThread, handleRenameThread]);

  if (!activeProvider) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">AI 聊天设置</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">配置你的 AI 助手</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
              <p className="text-sm text-purple-700 dark:text-purple-300">
                请先在设置中添加 AI 提供商配置
              </p>
              <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">
                点击右上角的"设置"按钮，在"AI 聊天"标签页中添加提供商。
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header - 仅在有活动对话时显示 */}
      {activeThreadId && (
        <div className="flex-shrink-0 px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                {showMemoryPanel
                  ? 'AI 记忆管理'
                  : threads.find((t) => t.id === activeThreadId)?.title || '新对话'}
              </h2>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {showMemoryPanel ? (
                  '查看和管理自动提取的记忆'
                ) : (
                  <>
                    {(() => {
                      const currentThread = threads.find((t) => t.id === activeThreadId);
                      if (currentThread) {
                        const threadProvider = aiProviders?.find(
                          (p) => p.id === currentThread.provider_id
                        );
                        return (
                          <>
                            {currentThread.model} · {threadProvider?.name || '未知提供商'}
                          </>
                        );
                      }
                      return '加载中...';
                    })()}
                  </>
                )}
              </div>
            </div>
            {showMemoryPanel && (
              <button
                onClick={() => setShowMemoryPanel(false)}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                返回对话
              </button>
            )}
          </div>
        </div>
      )}

      {/* Chat Area or Memory Panel */}
      {showMemoryPanel ? (
        <MemoryPanel threadId={activeThreadId ?? ''} />
      ) : activeThreadId ? (
        <div className="flex-1 overflow-hidden">
          {(() => {
            const currentThread = threads.find((t) => t.id === activeThreadId);
            const isArtifactMode = currentThread?.system_prompt?.includes('__artifact_mode__');
            return isArtifactMode ? (
              <ArtifactChatInterface
                key={`${activeThreadId}-${chatReloadKey}`}
                threadId={activeThreadId}
                onThreadUpdated={loadThreads}
                onMessageDeleted={() => {
                  loadThreads();
                  reloadChat();
                }}
                onTitleGenerated={(title) => {
                  const newThreads = threads.map((t) =>
                    t.id === activeThreadId ? { ...t, title } : t
                  );
                  setThreads(newThreads);
                  onThreadsChange(newThreads);
                }}
              />
            ) : (
              <ChatInterface
                key={`${activeThreadId}-${chatReloadKey}`}
                threadId={activeThreadId}
                userId="default-user"
                enableMemory={true}
                onThreadUpdated={loadThreads}
                onMessageDeleted={() => {
                  loadThreads();
                  reloadChat();
                }}
                onTitleGenerated={(title) => {
                  const newThreads = threads.map((t) =>
                    t.id === activeThreadId ? { ...t, title } : t
                  );
                  setThreads(newThreads);
                  onThreadsChange(newThreads);
                }}
              />
            );
          })()}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <div className="inline-flex p-4 bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900/20 dark:to-pink-900/20 rounded-full mb-4">
              <Sparkles className="w-12 h-12 text-purple-600 dark:text-purple-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">开始新对话</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              点击左侧"新建对话"按钮，选择提供商和模型开始聊天
            </p>
            <button
              onClick={() => setShowNewConversationDialog(true)}
              className="px-6 py-3 bg-[#0066ff] hover:bg-[#0052cc] text-white rounded-lg transition-colors"
            >
              新建对话
            </button>
          </div>
        </div>
      )}

      {/* 新建对话弹窗 */}
      {showNewConversationDialog && (
        <>
          {!aiProviders || aiProviders.length === 0 ? (
            <div
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
              onClick={() => setShowNewConversationDialog(false)}
            >
              <div
                className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  未配置 AI 提供商
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  请先在设置中添加至少一个 AI 提供商配置。
                </p>
                <button
                  onClick={() => setShowNewConversationDialog(false)}
                  className="w-full px-4 py-2 bg-[#0066ff] hover:bg-[#0052cc] text-white rounded-lg transition-colors"
                >
                  知道了
                </button>
              </div>
            </div>
          ) : (
            <NewConversationDialog
              providers={aiProviders}
              onClose={() => setShowNewConversationDialog(false)}
              onCreate={handleCreateThread}
            />
          )}
        </>
      )}
    </div>
  );
}
