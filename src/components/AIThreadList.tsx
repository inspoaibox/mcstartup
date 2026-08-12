import {
  MessageSquare,
  Archive,
  Trash2,
  MoreVertical,
  Pencil,
  Check,
  X,
  Pin,
  PinOff,
  Bot,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ChatThread } from '../types/aiChat';

const PINNED_KEY = 'ai_chat_pinned_threads';

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function savePinned(ids: Set<string>) {
  localStorage.setItem(PINNED_KEY, JSON.stringify([...ids]));
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

interface AIThreadListProps {
  threads: ChatThread[];
  activeThreadId: string | null;
  onThreadSelect: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread?: (threadId: string, newTitle: string) => void;
}

export default function AIThreadList({
  threads,
  activeThreadId,
  onThreadSelect,
  onArchiveThread,
  onDeleteThread,
  onRenameThread,
}: AIThreadListProps) {
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(loadPinned);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setThreadMenuId(null);
      }
    };
    if (threadMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [threadMenuId]);

  useEffect(() => {
    if (editingThreadId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingThreadId]);

  const togglePin = (threadId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      savePinned(next);
      return next;
    });
    setThreadMenuId(null);
  };

  const startRename = (thread: ChatThread) => {
    setEditingThreadId(thread.id);
    setEditingTitle(thread.title);
    setThreadMenuId(null);
  };

  const confirmRename = (threadId: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed && onRenameThread) onRenameThread(threadId, trimmed);
    setEditingThreadId(null);
    setEditingTitle('');
  };

  const cancelRename = () => {
    setEditingThreadId(null);
    setEditingTitle('');
  };

  const regularThreads = threads.filter((t) => t.status === 'regular');
  const archivedThreads = threads.filter((t) => t.status === 'archived');
  const pinnedThreads = regularThreads.filter((t) => pinnedIds.has(t.id));
  const unpinnedThreads = regularThreads.filter((t) => !pinnedIds.has(t.id));

  if (regularThreads.length === 0 && archivedThreads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mb-3">
          <Bot size={22} className="text-blue-500 dark:text-blue-400" />
        </div>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-300">还没有对话</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">点击上方按钮开始新对话</p>
      </div>
    );
  }

  const renderThread = (thread: ChatThread, isPinned: boolean) => {
    const isActive = activeThreadId === thread.id;
    return (
      <div key={thread.id} className="relative group/thread px-2">
        {editingThreadId === thread.id ? (
          <div className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-900/20">
            <input
              ref={inputRef}
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename(thread.id);
                if (e.key === 'Escape') cancelRename();
              }}
              className="flex-1 text-sm px-2 py-0.5 rounded-lg border border-blue-400 dark:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none"
            />
            <button
              onClick={() => confirmRename(thread.id)}
              className="p-1 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
            >
              <Check size={12} />
            </button>
            <button
              onClick={cancelRename}
              className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => onThreadSelect(thread.id)}
              onDoubleClick={() => onRenameThread && startRename(thread)}
              className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 ${
                isActive
                  ? 'bg-blue-500/10 dark:bg-blue-500/15 shadow-sm'
                  : 'hover:bg-gray-100/80 dark:hover:bg-white/5'
              }`}
            >
              <div className="flex items-start gap-2.5 pr-5">
                {/* 图标 */}
                <div
                  className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                    isActive
                      ? 'bg-blue-500/20 dark:bg-blue-400/20'
                      : 'bg-gray-200/80 dark:bg-gray-700/60'
                  }`}
                >
                  {isPinned ? (
                    <Pin
                      size={10}
                      className={
                        isActive
                          ? 'text-blue-500 dark:text-blue-400'
                          : 'text-gray-500 dark:text-gray-400'
                      }
                    />
                  ) : (
                    <MessageSquare
                      size={10}
                      className={
                        isActive
                          ? 'text-blue-500 dark:text-blue-400'
                          : 'text-gray-500 dark:text-gray-400'
                      }
                    />
                  )}
                </div>

                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm font-medium truncate leading-snug ${
                      isActive
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-800 dark:text-gray-200'
                    }`}
                  >
                    {thread.title}
                  </div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {formatDate(thread.updated_at)}
                  </div>
                </div>
              </div>

              {/* 激活指示条 */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-blue-500 rounded-r-full" />
              )}
            </button>

            {/* 操作按钮 */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover/thread:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (threadMenuId === thread.id) {
                    setThreadMenuId(null);
                  } else {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenuPos({ x: rect.right, y: rect.bottom + 4 });
                    setThreadMenuId(thread.id);
                  }
                }}
                className={`p-1 rounded-lg transition-colors ${
                  isActive
                    ? 'hover:bg-blue-500/20 text-blue-500/70 dark:text-blue-400/70'
                    : 'hover:bg-gray-200 dark:hover:bg-white/10 text-gray-400 dark:text-gray-500'
                }`}
              >
                <MoreVertical size={13} />
              </button>

              {threadMenuId === thread.id &&
                createPortal(
                  <div
                    ref={menuRef}
                    className="fixed bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80 rounded-xl shadow-xl py-1 z-[9999] min-w-[140px]"
                    style={{ left: Math.max(4, menuPos.x - 144), top: menuPos.y }}
                  >
                    <button
                      onClick={() => togglePin(thread.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    >
                      {isPinned ? (
                        <PinOff size={13} className="text-gray-400" />
                      ) : (
                        <Pin size={13} className="text-gray-400" />
                      )}
                      {isPinned ? '取消置顶' : '置顶'}
                    </button>
                    {onRenameThread && (
                      <button
                        onClick={() => startRename(thread)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                      >
                        <Pencil size={13} className="text-gray-400" />
                        重命名
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onArchiveThread(thread.id);
                        setThreadMenuId(null);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <Archive size={13} className="text-gray-400" />
                      归档
                    </button>
                    <div className="my-1 border-t border-gray-100 dark:border-gray-700/50" />
                    <button
                      onClick={() => {
                        onDeleteThread(thread.id);
                        setThreadMenuId(null);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
                    >
                      <Trash2 size={13} />
                      删除
                    </button>
                  </div>,
                  document.body
                )}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-0.5">
      {/* 置顶 */}
      {pinnedThreads.length > 0 && (
        <div className="mb-1">
          <div className="px-4 py-1.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
            <Pin size={9} />
            置顶
          </div>
          <div className="space-y-0.5">{pinnedThreads.map((t) => renderThread(t, true))}</div>
        </div>
      )}

      {/* 全部对话 */}
      {unpinnedThreads.length > 0 && (
        <div>
          {pinnedThreads.length > 0 && (
            <div className="px-4 py-1.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
              全部对话
            </div>
          )}
          <div className="space-y-0.5">{unpinnedThreads.map((t) => renderThread(t, false))}</div>
        </div>
      )}

      {/* 已归档 */}
      {archivedThreads.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/5">
          <div className="px-4 py-1.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
            <Archive size={9} />
            已归档 ({archivedThreads.length})
          </div>
          <div className="space-y-0.5">{archivedThreads.map((t) => renderThread(t, false))}</div>
        </div>
      )}
    </div>
  );
}
