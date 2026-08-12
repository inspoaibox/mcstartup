import { useMemo, useEffect, useState } from 'react';
import { useItemsStore } from '../stores/itemsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { Play, Edit, Trash2, Shield, Globe, Folder, Terminal, AlertTriangle } from 'lucide-react';
import { LaunchItem } from '../types';
import { message, ask } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';

/** 根据设置返回图标像素大小 */
function getIconPixelSize(iconSize: string, viewMode: string): number {
  if (viewMode === 'compact') {
    return iconSize === 'small' ? 14 : iconSize === 'large' ? 20 : 16;
  }
  if (viewMode === 'list') {
    return iconSize === 'small' ? 16 : iconSize === 'large' ? 28 : 20;
  }
  // grid
  return iconSize === 'small' ? 20 : iconSize === 'large' ? 36 : 24;
}

interface ItemListProps {
  searchQuery: string;
  groupId?: string;
  viewMode: 'grid' | 'list' | 'compact';
  onEditItem: (itemId: string) => void;
}

export default function ItemList({ searchQuery, groupId, viewMode, onEditItem }: ItemListProps) {
  const {
    items,
    launchItem,
    launchItemWithProfile,
    deleteItem,
    searchItems,
    pathValidity,
    validateAllPaths,
  } = useItemsStore();
  const { iconSize } = useSettingsStore();
  const iconPx = getIconPixelSize(iconSize, viewMode);

  // 路径有效性检测（加载后执行一次）
  useEffect(() => {
    if (items.length > 0) {
      validateAllPaths();
    }
  }, [items.length, validateAllPaths]);

  const filteredItems = useMemo(() => {
    let result = searchQuery ? searchItems(searchQuery) : items;
    if (groupId) result = result.filter((item) => item.groupId === groupId);
    return result;
  }, [items, searchQuery, groupId, searchItems]);

  const handleLaunch = async (id: string) => {
    try {
      await launchItem(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await message(`启动失败：${errorMessage}`, { title: '错误', type: 'error' });
      console.error('Failed to launch item:', error);
    }
  };

  const handleLaunchWithProfile = async (id: string, profileName: string) => {
    try {
      await launchItemWithProfile(id, profileName);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await message(`启动失败：${errorMessage}`, { title: '错误', type: 'error' });
      console.error('Failed to launch item with profile:', error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const item = items.find((i) => i.id === id);
      if (!item) return;

      const itemTypeText =
        item.itemType === 'url' ? '网址' : item.itemType === 'folder' ? '文件夹' : '应用程序';

      const confirmed = await ask(
        `确定要删除以下项目吗？\n\n` +
          `📌 名称：${item.name}\n` +
          `🔖 别名：${item.alias}\n` +
          `📂 类型：${itemTypeText}\n\n` +
          `⚠️ 删除后，Win+R 快捷方式"${item.alias}"也会被移除。`,
        {
          title: '确认删除',
          type: 'warning',
        }
      );

      if (confirmed) {
        await deleteItem(id);
      }
    } catch (error) {
      console.error('Failed to delete item:', error);
      await message(`删除失败：${error}`, { title: '错误', type: 'error' });
    }
  };

  if (filteredItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <Play size={28} className="text-gray-400" />
          </div>
          <p className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">没有找到项目</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">添加你的第一个启动项目开始使用</p>
        </div>
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="space-y-2">
        {filteredItems.map((item) => (
          <ItemListRow
            key={item.id}
            item={item}
            isValid={pathValidity[item.id]}
            iconSize={iconPx}
            onLaunch={handleLaunch}
            onLaunchWithProfile={handleLaunchWithProfile}
            onEdit={onEditItem}
            onDelete={handleDelete}
          />
        ))}
      </div>
    );
  }

  if (viewMode === 'compact') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1.5">
        {filteredItems.map((item) => (
          <ItemCompactCard
            key={item.id}
            item={item}
            isValid={pathValidity[item.id]}
            iconSize={iconPx}
            onLaunch={handleLaunch}
            onLaunchWithProfile={handleLaunchWithProfile}
            onEdit={onEditItem}
            onDelete={handleDelete}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
      {filteredItems.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          isValid={pathValidity[item.id]}
          iconSize={iconPx}
          onLaunch={handleLaunch}
          onLaunchWithProfile={handleLaunchWithProfile}
          onEdit={onEditItem}
          onDelete={handleDelete}
        />
      ))}
    </div>
  );
}

interface ItemCardProps {
  item: LaunchItem;
  isValid?: boolean;
  iconSize: number;
  onLaunch: (id: string) => void;
  onLaunchWithProfile: (id: string, profileName: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

/** 图标缓存，避免重复请求后端 */
const iconCache = new Map<string, string | null>();

/** 图标组件：根据类型显示不同图标 */
function ItemIcon({ item, size = 20 }: { item: LaunchItem; size?: number }) {
  const [iconData, setIconData] = useState<string | null>(iconCache.get(item.targetPath) ?? null);

  useEffect(() => {
    if (item.itemType === 'url' || item.itemType === 'folder') return;
    // 如果缓存中已有结果（包括 null），不再请求
    if (iconCache.has(item.targetPath)) {
      setIconData(iconCache.get(item.targetPath) ?? null);
      return;
    }
    let cancelled = false;
    invoke<string | null>('extract_icon', { targetPath: item.targetPath })
      .then((data) => {
        iconCache.set(item.targetPath, data);
        if (!cancelled) {
          setIconData(data);
        }
      })
      .catch(() => {
        iconCache.set(item.targetPath, null);
      });
    return () => {
      cancelled = true;
    };
  }, [item.targetPath, item.itemType]);

  if (item.itemType === 'url') {
    return <Globe size={size} className="text-blue-500" />;
  }
  if (item.itemType === 'folder') {
    return <Folder size={size} className="text-yellow-500" />;
  }

  if (iconData) {
    return <IconRenderer data={iconData} size={size} />;
  }

  return <Terminal size={size} className="text-green-500" />;
}

/** 将后端返回的 RGBA 数据渲染为图标 */
function IconRenderer({ data, size }: { data: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    try {
      const parsed = JSON.parse(data);
      const width = parsed.width as number;
      const height = parsed.height as number;
      const rgba = Uint8Array.from(atob(parsed.data), (c) => c.charCodeAt(0));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const imageData = ctx.createImageData(width, height);
      imageData.data.set(rgba);
      ctx.putImageData(imageData, 0, 0);
      setSrc(canvas.toDataURL());
    } catch {
      // 解析失败，不显示图标
    }
  }, [data]);

  if (!src) return <Terminal size={size} className="text-green-500" />;

  return <img src={src} alt="" width={size} height={size} className="rounded" />;
}

function ItemCard({
  item,
  isValid,
  iconSize,
  onLaunch,
  onLaunchWithProfile,
  onEdit,
  onDelete,
}: ItemCardProps) {
  const invalid = isValid === false;
  const profiles = item.launchProfiles || [];
  const hasProfiles = profiles.length > 0;
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      className={`card card-hover p-3.5 ${invalid ? 'opacity-70 border-red-200 dark:border-red-800' : ''}`}
    >
      <div className="flex items-center gap-3">
        {/* 左侧：图标 */}
        <div
          className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-50 dark:bg-gray-800 flex items-center justify-center cursor-pointer hover:bg-[#0066ff]/10 dark:hover:bg-[#0066ff]/20 transition-colors"
          onClick={() => onLaunch(item.id)}
          title="点击启动"
        >
          <ItemIcon item={item} size={iconSize} />
        </div>

        {/* 中间：名称 + 别名 + 描述 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {item.name}
            </h3>
            {item.runAsAdmin && <Shield size={11} className="text-yellow-500 flex-shrink-0" />}
            {invalid && <AlertTriangle size={11} className="text-red-500 flex-shrink-0" />}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="inline-flex items-center px-1.5 py-0 rounded text-xs font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              {item.alias}
            </span>
            {item.description && (
              <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {item.description}
              </span>
            )}
            {(item.launchCount || 0) > 0 && (
              <span className="text-xs text-gray-300 dark:text-gray-600 ml-auto flex-shrink-0">
                {item.launchCount}次
              </span>
            )}
          </div>
        </div>

        {/* 右侧：操作按钮 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="relative">
            <button
              onClick={() => (hasProfiles ? setShowMenu(!showMenu) : onLaunch(item.id))}
              className="p-1.5 text-[#0066ff] hover:bg-[#0066ff]/10 rounded-lg transition-colors"
              title="启动"
            >
              <Play size={16} fill="currentColor" />
            </button>
            {showMenu && hasProfiles && (
              <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
                <button
                  onClick={() => {
                    onLaunch(item.id);
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  默认
                </button>
                {profiles.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => {
                      onLaunchWithProfile(item.id, p.name);
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => onEdit(item.id)}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            title="编辑"
          >
            <Edit size={15} />
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            title="删除"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemListRow({
  item,
  isValid,
  iconSize,
  onLaunch,
  onLaunchWithProfile,
  onEdit,
  onDelete,
}: ItemCardProps) {
  const invalid = isValid === false;
  const profiles = item.launchProfiles || [];
  const hasProfiles = profiles.length > 0;
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      className={`card card-hover px-4 py-3 flex items-center gap-4 ${invalid ? 'opacity-70 border-red-200 dark:border-red-800' : ''}`}
    >
      <div className="flex-shrink-0">
        <ItemIcon item={item} size={iconSize} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {item.name}
          </h3>
          <span className="inline-flex items-center px-1.5 py-0 rounded text-xs font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
            {item.alias}
          </span>
          {item.runAsAdmin && <Shield size={11} className="text-yellow-500 flex-shrink-0" />}
          {invalid && <AlertTriangle size={11} className="text-red-500 flex-shrink-0" />}
          {(item.launchCount || 0) > 0 && (
            <span className="text-xs text-gray-300 dark:text-gray-600">{item.launchCount}次</span>
          )}
        </div>
        {item.description && (
          <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">
            {item.description}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <div className="relative">
          <button
            onClick={() => (hasProfiles ? setShowMenu(!showMenu) : onLaunch(item.id))}
            className="flex items-center gap-1.5 px-3 py-1.5 btn-primary rounded-lg text-xs"
          >
            <Play size={12} fill="currentColor" />
            启动
            {hasProfiles && <span className="ml-0.5">▾</span>}
          </button>
          {showMenu && hasProfiles && (
            <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
              <button
                onClick={() => {
                  onLaunch(item.id);
                  setShowMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                默认
              </button>
              {profiles.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    onLaunchWithProfile(item.id, p.name);
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => onEdit(item.id)}
          className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          title="编辑"
        >
          <Edit size={14} />
        </button>
        <button
          onClick={() => onDelete(item.id)}
          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          title="删除"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function ItemCompactCard({
  item,
  isValid,
  iconSize,
  onLaunch,
  onLaunchWithProfile: _onLaunchWithProfile,
  onEdit,
  onDelete,
}: ItemCardProps) {
  const invalid = isValid === false;

  return (
    <div
      className={`card card-hover px-3 py-2 ${invalid ? 'opacity-70 border-red-200 dark:border-red-800' : ''}`}
    >
      <div className="flex items-center gap-2">
        <ItemIcon item={item} size={iconSize} />
        <span className="text-sm font-medium text-gray-900 dark:text-white truncate flex-1">
          {item.name}
        </span>
        <span className="text-xs font-mono text-gray-400 flex-shrink-0">{item.alias}</span>
        {item.runAsAdmin && <Shield size={10} className="text-yellow-500 flex-shrink-0" />}
        {invalid && <AlertTriangle size={10} className="text-red-500 flex-shrink-0" />}

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => onLaunch(item.id)}
            className="p-1 text-[#0066ff] hover:bg-[#0066ff]/10 rounded transition-colors"
            title="启动"
          >
            <Play size={13} fill="currentColor" />
          </button>
          <button
            onClick={() => onEdit(item.id)}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
            title="编辑"
          >
            <Edit size={13} />
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
            title="删除"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
