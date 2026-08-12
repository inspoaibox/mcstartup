import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { appWindow, WebviewWindow } from '@tauri-apps/api/window';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import {
  Search,
  Star,
  Trash2,
  Copy,
  FileText,
  Image,
  Files,
  Link,
  Mail,
  Palette,
  FolderOpen,
  X,
  Pin,
  PinOff,
  Settings,
  ChevronUp,
  Edit3,
} from 'lucide-react';
import { useClipboardStore } from '../stores/clipboardStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { ClipboardItem, ClipboardGroup } from '../types';

// ─── 工具函数 ─────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 30) return `${days} 天前`;
  return date.toLocaleDateString('zh-CN');
}

function formatCount(item: ClipboardItem): string {
  if (item.itemType === 'text' || item.itemType === 'html' || item.itemType === 'rtf') {
    return `${item.count} 字符`;
  }
  if (item.itemType === 'image' || item.subtype === 'image-file') {
    const kb = Math.round(item.count / 1024);
    return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
  }
  if (item.itemType === 'files') {
    return `${item.count} 个文件`;
  }
  return '';
}

function getTypeLabel(item: ClipboardItem): string {
  if (item.subtype === 'url') return '链接';
  if (item.subtype === 'email') return '邮箱';
  if (item.subtype === 'color') return '颜色';
  if (item.subtype === 'path') return '路径';
  if (item.subtype === 'image-file') return '图片文件';
  switch (item.itemType) {
    case 'text':
      return '纯文本';
    case 'html':
      return 'HTML';
    case 'rtf':
      return '富文本';
    case 'image':
      return '图片';
    case 'files':
      return '文件';
    default:
      return '文本';
  }
}

// ─── 分组 Tab ─────────────────────────────────────────────────────

const GROUPS: { id: ClipboardGroup; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'text', label: '文本' },
  { id: 'image', label: '图片' },
  { id: 'files', label: '文件' },
  { id: 'favorite', label: '收藏' },
];

// ─── 单条历史记录 ─────────────────────────────────────────────────

interface ItemCardProps {
  item: ClipboardItem;
  isActive: boolean;
  searchKeyword: string;
  autoPaste: 'single' | 'double';
  showPinAction: boolean;
  onSelect: () => void;
  onPaste: (asPlain?: boolean) => void;
  onCopy: () => void;
  onTogglePin: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onNote: () => void;
}

function highlightText(text: string, keyword: string): React.ReactNode {
  if (!keyword || !text) return text;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === keyword.toLowerCase() ? (
      <mark key={i} className="bg-blue-200 dark:bg-blue-700 text-inherit rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function parseFilePaths(value: string): string[] {
  try {
    const paths = JSON.parse(value);
    return Array.isArray(paths) ? paths.filter((path) => typeof path === 'string') : [value];
  } catch {
    return [value];
  }
}

function getPreviewImageSrc(item: ClipboardItem): string {
  if (item.itemType === 'image') {
    return item.value.startsWith('data:') ? item.value : convertFileSrc(item.value);
  }
  const [path] = parseFilePaths(item.value);
  return path ? convertFileSrc(path) : '';
}

function ItemCard({
  item,
  isActive,
  searchKeyword,
  autoPaste,
  showPinAction,
  onSelect,
  onPaste,
  onCopy,
  onTogglePin,
  onToggleFavorite,
  onDelete,
  onEdit,
  onNote,
}: ItemCardProps) {
  const [hovered, setHovered] = useState(false);

  const handleClick = () => {
    onSelect();
    if (autoPaste === 'single') onPaste();
  };

  const handleDoubleClick = () => {
    if (autoPaste === 'double') onPaste();
  };

  const renderContent = () => {
    switch (item.itemType) {
      case 'image':
        return (
          <div className="h-[86px] overflow-hidden rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <img
              src={getPreviewImageSrc(item)}
              alt="clipboard image"
              className="w-full h-full object-contain"
              draggable={false}
              onError={(e) => {
                // 加载失败时显示占位符
                const target = e.currentTarget;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent && !parent.querySelector('.img-error')) {
                  const placeholder = document.createElement('div');
                  placeholder.className =
                    'img-error flex flex-col items-center justify-center w-full h-full text-gray-400 text-xs gap-1';
                  placeholder.innerHTML =
                    '<span style="font-size:24px">🖼️</span><span>图片加载失败</span>';
                  parent.appendChild(placeholder);
                }
              }}
            />
          </div>
        );
      case 'files': {
        const paths = parseFilePaths(item.value);
        if (item.subtype === 'image-file') {
          return (
            <div className="h-[86px] overflow-hidden rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <img
                src={getPreviewImageSrc(item)}
                alt="clipboard image file"
                className="w-full h-full object-contain"
                draggable={false}
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent && !parent.querySelector('.img-error')) {
                    const placeholder = document.createElement('div');
                    placeholder.className =
                      'img-error flex flex-col items-center justify-center w-full h-full text-gray-400 text-xs gap-1';
                    placeholder.innerHTML =
                      '<span style="font-size:24px">🖼️</span><span>图片加载失败</span>';
                    parent.appendChild(placeholder);
                  }
                }}
              />
            </div>
          );
        }
        return (
          <div className="space-y-0.5 max-h-[86px] overflow-hidden">
            {paths.slice(0, 3).map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 truncate"
              >
                <FolderOpen size={12} className="flex-shrink-0 text-blue-500" />
                <span className="truncate">{p.split(/[\\/]/).pop()}</span>
              </div>
            ))}
            {paths.length > 3 && (
              <div className="text-xs text-gray-400">+{paths.length - 3} 个文件</div>
            )}
          </div>
        );
      }
      default:
        return (
          <div className="text-sm text-gray-700 dark:text-gray-300 break-words leading-relaxed whitespace-pre-wrap max-h-[86px] overflow-hidden">
            {item.subtype === 'color' ? (
              <span className="flex items-center gap-2">
                <span
                  className="inline-block w-4 h-4 rounded-full border border-gray-300 flex-shrink-0"
                  style={{ background: item.value }}
                />
                {highlightText(item.value, searchKeyword)}
              </span>
            ) : (
              highlightText(item.value, searchKeyword)
            )}
          </div>
        );
    }
  };

  const showButtons = hovered || isActive;

  return (
    <div
      className={`
        group mx-3 rounded-lg border p-1.5 cursor-pointer transition-all duration-150 select-none
        ${
          isActive
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
            : 'border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-600'
        }
      `}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 overflow-hidden">
          <TypeIcon item={item} />
          <span className="truncate">{getTypeLabel(item)}</span>
          <span>·</span>
          <span className="truncate">{formatCount(item)}</span>
          {item.itemType === 'image' && item.width && item.height && (
            <>
              <span>·</span>
              <span>
                {item.width}×{item.height}
              </span>
            </>
          )}
          <span>·</span>
          <span className="truncate">{formatTime(item.createTime)}</span>
        </div>

        {/* 操作按钮 */}
        <div
          className={`flex items-center gap-1 transition-opacity duration-100 ${showButtons ? 'opacity-100' : 'opacity-0'}`}
        >
          <ActionBtn
            title="复制"
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
          >
            <Copy size={13} />
          </ActionBtn>
          {showPinAction && (
            <ActionBtn
              title={item.pinned ? '取消置顶' : '置顶'}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              active={item.pinned}
            >
              <Pin size={13} />
            </ActionBtn>
          )}
          {item.favorite && ['text', 'html', 'rtf'].includes(item.itemType) && (
            <ActionBtn
              title="编辑内容"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <Edit3 size={13} />
            </ActionBtn>
          )}
          <ActionBtn
            title="备注"
            onClick={(e) => {
              e.stopPropagation();
              onNote();
            }}
          >
            <FileText size={13} />
          </ActionBtn>
          <ActionBtn
            title={item.favorite ? '取消收藏' : '收藏'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            active={item.favorite}
          >
            <Star size={13} fill={item.favorite ? 'currentColor' : 'none'} />
          </ActionBtn>
          <ActionBtn
            title="删除"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            danger
          >
            <Trash2 size={13} />
          </ActionBtn>
        </div>
      </div>

      {item.shortcut && (
        <div className="mb-1 inline-flex max-w-full items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:bg-blue-900/20 dark:text-blue-300">
          <span className="truncate">快捷键 {item.shortcut}</span>
        </div>
      )}

      {/* Content */}
      <div className="overflow-hidden">{renderContent()}</div>

      {/* Note indicator - 始终在底部显示备注，增加可见性 */}
      {item.note && (
        <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
          <FileText size={12} className="flex-shrink-0" />
          <span className="truncate font-medium">备注：{item.note}</span>
        </div>
      )}
    </div>
  );
}

function TypeIcon({ item }: { item: ClipboardItem }) {
  const cls = 'flex-shrink-0';
  if (item.subtype === 'url') return <Link size={11} className={cls} />;
  if (item.subtype === 'email') return <Mail size={11} className={cls} />;
  if (item.subtype === 'color') return <Palette size={11} className={cls} />;
  if (item.itemType === 'image' || item.subtype === 'image-file') {
    return <Image size={11} className={cls} />;
  }
  if (item.itemType === 'files') return <Files size={11} className={cls} />;
  return <FileText size={11} className={cls} />;
}

function ActionBtn({
  children,
  title,
  onClick,
  active,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`
        p-1 rounded transition-colors
        ${
          danger
            ? 'text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
            : active
              ? 'text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
              : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'
        }
      `}
    >
      {children}
    </button>
  );
}

// ─── 备注弹窗 ─────────────────────────────────────────────────────

function NoteModal({
  item,
  onClose,
  onSave,
}: {
  item: ClipboardItem;
  onClose: () => void;
  onSave: (note: string | null) => void;
}) {
  const [value, setValue] = useState(item.note || '');

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-80 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900 dark:text-white text-sm">添加备注</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={16} />
          </button>
        </div>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="输入备注..."
          rows={3}
          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex justify-end gap-2 mt-3">
          {item.note && (
            <button
              onClick={() => {
                onSave(null);
                onClose();
              }}
              className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              删除备注
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => {
              onSave(value.trim() || null);
              onClose();
            }}
            className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function EditContentModal({
  item,
  onClose,
  onSave,
  onSaveShortcut,
}: {
  item: ClipboardItem;
  onClose: () => void;
  onSave: (value: string) => void;
  onSaveShortcut: (shortcut: string | null) => Promise<void>;
}) {
  const [value, setValue] = useState(item.value || '');
  const [shortcut, setShortcut] = useState(item.shortcut || '');
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(false);
        return;
      }
      const parts: string[] = [];
      if (event.ctrlKey) parts.push('Ctrl');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');
      if (event.metaKey) parts.push('Meta');
      let key = event.key;
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;
      if (key === ' ') key = 'Space';
      else if (key.length === 1) key = key.toUpperCase();
      if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) return;
      const isAltDigitRow =
        event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        /^[0-9]$/.test(event.key) &&
        event.code.startsWith('Digit');
      setShortcut(isAltDigitRow ? `Alt+Shift+${key}` : [...parts, key].join('+'));
      setRecording(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recording]);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[420px] max-w-[calc(100vw-32px)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900 dark:text-white text-sm">编辑收藏内容</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={16} />
          </button>
        </div>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="输入剪贴板文本内容..."
          rows={8}
          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            收藏快捷键
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRecording(true)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-mono transition-colors ${
                recording
                  ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/20'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'
              }`}
            >
              {recording ? '按下快捷键...' : shortcut || '未设置'}
            </button>
            {shortcut && (
              <button
                type="button"
                onClick={() => setShortcut('')}
                className="rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                清除
              </button>
            )}
          </div>
          <div className="mt-2 text-[11px] text-gray-400">
            全局生效，在输入框中按下后会自动填入该收藏内容。
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            disabled={saving}
            onClick={async () => {
              const nextValue = value.trim();
              if (!nextValue) return;
              setSaving(true);
              try {
                onSave(nextValue);
                await onSaveShortcut(shortcut.trim() || null);
                onClose();
              } finally {
                setSaving(false);
              }
            }}
            className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white rounded-lg transition-colors"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 主窗口组件───────────────────────────────────────────────────

export default function ClipboardWindow() {
  const {
    items,
    group,
    search,
    hasMore,
    loading,
    activeId,
    setGroup,
    setSearch,
    setActiveId,
    loadMore,
    reload,
    toggleFavorite,
    togglePin,
    updateNote,
    updateTextValue,
    updateFavoriteShortcut,
    deleteItem,
    copyItem,
    pasteItem,
  } = useClipboardStore();

  // 从全局设置读取剪贴板配置
  const {
    clipboardAutoPaste: autoPaste = 'double',
    clipboardPastePlain: pastePlain = false,
    clipboardSearchPosition: searchPosition = 'top',
    clipboardSearchAutoClear = false,
  } = useSettingsStore();

  const [pinned, setPinned] = useState(false);
  const [noteItem, setNoteItem] = useState<ClipboardItem | null>(null);
  const [editItem, setEditItem] = useState<ClipboardItem | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 初始加载
  useEffect(() => {
    reload();
  }, [reload]);

  // 监听剪贴板变化事件
  useEffect(() => {
    const unlisten = listen('clipboard-changed', () => {
      reload();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [reload]);

  // 检测暗色模式
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // 拖动状态追踪：用延迟 + 重新获焦取消隐藏
  // 原理：Tauri 拖动在原生层处理，mousedown 后立即失焦，拖动结束后重新获焦
  // 所以用一个 hideTimer：失焦时不立即隐藏，而是延迟 600ms。
  // 如果在此期间重新获焦（拖动结束），取消隐藏计划
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 窗口失焦自动隐藏（未固定时，用延迟+重获焦取消来处理拖动）
  useEffect(() => {
    const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        // 重新获焦（拖动结束 or 正常聚焦）：取消任何待执行的隐藏
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      } else {
        // 失焦：如果未固定且窗口当前可见，延迟隐藏
        appWindow
          .isVisible()
          .then((visible) => {
            if (!pinned && visible) {
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
              // 增加延迟时间到 600ms，给拖拽更多时间
              hideTimerRef.current = setTimeout(() => {
                hideTimerRef.current = null;
                if (clipboardSearchAutoClear) setSearch('');
                appWindow.hide();
              }, 600);
            }
          })
          .catch(() => {});
      }
    });
    return () => {
      unlisten.then((fn) => fn());
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [pinned, clipboardSearchAutoClear, setSearch]);

  // 键盘导航
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        appWindow.hide();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = items.findIndex((i) => i.id === activeId);
        const next =
          e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
        if (items[next]) setActiveId(items[next].id);
      }
      if (e.key === 'Enter' && activeId) {
        const item = items.find((i) => i.id === activeId);
        if (item) pasteItem(activeId, e.shiftKey || pastePlain);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, activeId, pastePlain, pasteItem, setActiveId]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setShowScrollTop(el.scrollTop > 200);
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100 && hasMore && !loading) {
      loadMore();
    }
  }, [hasMore, loading, loadMore]);

  const scrollToTop = () => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    if (items[0]) setActiveId(items[0].id);
  };

  const handleDelete = async (id: string) => {
    await deleteItem(id);
  };

  const searchBar = (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700/60 rounded-lg">
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索剪贴板..."
          className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600">
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );

  const groupTabs = (
    <div className="flex items-center justify-between px-3 pb-1">
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
        {GROUPS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setGroup(id)}
            className={`
              px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors
              ${
                group === id
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }
            `}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
        <button
          title={pinned ? '取消固定' : '固定窗口'}
          onClick={() => setPinned(!pinned)}
          className={`p-1.5 rounded-lg transition-colors ${pinned ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
        >
          {pinned ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
        <button
          title="设置"
          onClick={() => {
            const main = WebviewWindow.getByLabel('main');
            if (main) {
              main.show();
              main.setFocus();
              main.emit('open-settings', {});
            }
          }}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={`flex flex-col h-screen rounded-2xl overflow-hidden shadow-2xl border border-gray-200/50 dark:border-gray-700/50 ${isDark ? 'dark' : ''}`}
      style={{ background: isDark ? 'rgba(24,24,27,0.97)' : 'rgba(255,255,255,0.97)' }}
      data-tauri-drag-region
    >
      {/* 拖拽区域标题栏 */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1" data-tauri-drag-region>
        <span
          className="text-xs font-semibold text-gray-500 dark:text-gray-400 select-none"
          data-tauri-drag-region
        >
          剪贴板历史
        </span>
        <button
          onClick={() => appWindow.hide()}
          className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* 搜索框（顶部） */}
      {searchPosition !== 'bottom' && searchBar}

      {/* 分组 Tab */}
      {groupTabs}

      {/* 历史列表 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto py-1 space-y-2"
        onScroll={handleScroll}
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(156,163,175,0.4) transparent' }}
      >
        {items.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-600">
            <Copy size={32} className="mb-2 opacity-30" />
            <p className="text-sm">暂无剪贴板记录</p>
          </div>
        )}

        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            isActive={item.id === activeId}
            searchKeyword={search}
            autoPaste={autoPaste}
            showPinAction={group === 'favorite'}
            onSelect={() => setActiveId(item.id)}
            onPaste={(asPlain) => pasteItem(item.id, asPlain ?? pastePlain)}
            onCopy={() => copyItem(item.id)}
            onTogglePin={() => togglePin(item.id)}
            onToggleFavorite={() => toggleFavorite(item.id)}
            onDelete={() => handleDelete(item.id)}
            onEdit={() => setEditItem(item)}
            onNote={() => setNoteItem(item)}
          />
        ))}

        {loading && (
          <div className="flex justify-center py-3">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!hasMore && items.length > 0 && (
          <div className="text-center text-xs text-gray-400 dark:text-gray-600 py-2">
            已加载全部 {items.length} 条记录
          </div>
        )}
      </div>

      {/* 搜索框（底部�?*/}
      {searchPosition === 'bottom' && searchBar}

      {/* 回到顶部 */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="absolute bottom-16 right-4 p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg transition-all"
        >
          <ChevronUp size={16} />
        </button>
      )}

      {/* 备注弹窗 */}
      {noteItem && (
        <NoteModal
          item={noteItem}
          onClose={() => setNoteItem(null)}
          onSave={(note) => updateNote(noteItem.id, note)}
        />
      )}

      {/* 编辑收藏内容弹窗 */}
      {editItem && (
        <EditContentModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={(value) => updateTextValue(editItem.id, value)}
          onSaveShortcut={(shortcut) => updateFavoriteShortcut(editItem.id, shortcut)}
        />
      )}
    </div>
  );
}
