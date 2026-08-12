import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { open as openExternal } from '@tauri-apps/api/shell';
import { invoke } from '@tauri-apps/api/tauri';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FolderPlus,
  Globe,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  useToolDataStore,
  type BookmarkCategory,
  type BookmarkItem,
} from '../stores/toolDataStore';

type CategoryNode = BookmarkCategory & { children: CategoryNode[] };
type BookmarkDisplayGroup = {
  id: string;
  title: string;
  icon: string;
  items: BookmarkItem[];
};

function createCategoryDraft(parentId?: string | null): BookmarkCategory {
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}`,
    name: '',
    parentId: parentId ?? null,
    icon: '📁',
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function createBookmarkDraft(categoryId?: string | null): BookmarkItem {
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}`,
    title: '',
    url: '',
    description: '',
    categoryId: categoryId ?? null,
    tags: [],
    icon: '',
    iconDataUrl: '',
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function buildTree(
  categories: BookmarkCategory[],
  parentId: string | null = null,
  visited = new Set<string>()
): CategoryNode[] {
  return categories
    .filter((category) => (category.parentId || null) === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))
    .map((category) => {
      if (visited.has(category.id)) {
        return {
          ...category,
          children: [],
        };
      }

      const nextVisited = new Set(visited);
      nextVisited.add(category.id);
      return {
        ...category,
        children: buildTree(categories, category.id, nextVisited),
      };
    });
}

function collectDescendantIds(
  categories: BookmarkCategory[],
  categoryId: string,
  visited = new Set<string>()
): string[] {
  if (visited.has(categoryId)) return [];
  const nextVisited = new Set(visited);
  nextVisited.add(categoryId);

  const ids = [categoryId];
  const children = categories.filter((category) => category.parentId === categoryId);
  for (const child of children) {
    ids.push(...collectDescendantIds(categories, child.id, nextVisited));
  }
  return ids;
}

function buildDescendantIdsMap(categories: BookmarkCategory[]) {
  const map = new Map<string, string[]>();
  categories.forEach((category) => {
    map.set(category.id, collectDescendantIds(categories, category.id));
  });
  return map;
}

function getCategoryMap(categories: BookmarkCategory[]) {
  return new Map(categories.map((category) => [category.id, category]));
}

function getImmediateChildGroupId(
  itemCategoryId: string | null | undefined,
  selectedCategoryId: string,
  categoryMap: Map<string, BookmarkCategory>
) {
  if (!itemCategoryId) return 'uncategorized';
  if (itemCategoryId === selectedCategoryId) return 'self';

  let currentId: string | null | undefined = itemCategoryId;
  let previousId = itemCategoryId;
  while (currentId) {
    const current = categoryMap.get(currentId);
    if (!current) break;
    if (current.parentId === selectedCategoryId) {
      return previousId;
    }
    previousId = current.id;
    currentId = current.parentId || null;
  }
  return 'self';
}

function getTopLevelGroupId(
  itemCategoryId: string | null | undefined,
  categoryMap: Map<string, BookmarkCategory>
) {
  if (!itemCategoryId) return 'uncategorized';
  let currentId: string | null | undefined = itemCategoryId;
  let current = categoryMap.get(currentId);
  if (!current) return 'uncategorized';
  while (current?.parentId) {
    currentId = current.parentId;
    current = categoryMap.get(currentId);
  }
  return current?.id || 'uncategorized';
}

function getDomainLabel(url: string) {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
  } catch {
    return normalizeUrl(url);
  }
}

function isDataUrlIconSource(value: string) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value.trim());
}

function isUrlIconSource(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function isImageLikeIconSource(value?: string) {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return isDataUrlIconSource(trimmed) || isUrlIconSource(trimmed);
}

function isRelativeIconPath(value?: string) {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isDataUrlIconSource(trimmed) || isUrlIconSource(trimmed)) return false;
  return trimmed.startsWith('/') || trimmed.includes('\\');
}

function isDefaultBookmarkIcon(icon?: string) {
  return !icon || icon.trim() === '' || icon.trim() === '🔗';
}

function isRenderableManualIcon(icon?: string) {
  if (!icon) return false;
  const trimmed = icon.trim();
  if (!trimmed || trimmed === '🔗') return false;
  if (isUrlIconSource(trimmed) || isDataUrlIconSource(trimmed)) return false;
  if (trimmed.startsWith('/') || trimmed.includes('\\')) return false;
  return Array.from(trimmed).length <= 4;
}

function getBookmarkGlyph(item: BookmarkItem) {
  const source = item.title.trim() || getDomainLabel(item.url) || '网';
  const glyph = Array.from(source).find((char) => !/\s/.test(char)) || '网';
  return /[a-z]/i.test(glyph) ? glyph.toUpperCase() : glyph;
}

function getBookmarkPalette(seed: string) {
  const hash = Array.from(seed).reduce((acc, char) => acc * 131 + char.charCodeAt(0), 17);
  const hue = Math.abs(hash) % 360;
  return {
    primary: `hsl(${hue} 84% 58%)`,
    secondary: `hsl(${(hue + 34) % 360} 88% 66%)`,
    glow: `hsla(${hue} 90% 62% / 0.22)`,
  };
}

function AutoBookmarkIcon({ item }: { item: BookmarkItem }) {
  if (item.iconDataUrl?.trim()) {
    return <img src={item.iconDataUrl} alt={`${item.title} 图标`} className="h-8 w-8 object-contain" loading="lazy" />;
  }

  if (isImageLikeIconSource(item.icon)) {
    return (
      <img
        src={encodeURI(item.icon!.trim())}
        alt={`${item.title} 图标`}
        className="h-8 w-8 object-contain"
        loading="lazy"
      />
    );
  }

  if (isRenderableManualIcon(item.icon)) {
    return <span className="text-xl leading-none">{item.icon}</span>;
  }

  const glyph = getBookmarkGlyph(item);
  const palette = getBookmarkPalette(`${item.title}|${item.url}`);
  return (
    <div
      className="flex h-8 w-8 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-[0_10px_20px_-16px_rgba(37,99,235,0.8)]"
      style={{
        backgroundImage: `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`,
        boxShadow: `0 16px 30px -22px ${palette.glow}`,
      }}
      title={`${item.title} 自动生成图标`}
    >
      {glyph}
    </div>
  );
}

export default function WebsiteBookmarksTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateWebsiteBookmarks } = useToolDataStore();
  const [categories, setCategories] = useState<BookmarkCategory[]>([]);
  const [items, setItems] = useState<BookmarkItem[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [columns, setColumns] = useState<3 | 4 | 5 | 6>(4);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [showCategoryEditor, setShowCategoryEditor] = useState(false);
  const [editingCategory, setEditingCategory] = useState<BookmarkCategory | null>(null);
  const [showBookmarkEditor, setShowBookmarkEditor] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<BookmarkItem | null>(null);
  const hydratingRef = useRef(false);
  const faviconLoadingIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!loaded) loadData();
  }, [loaded, loadData]);

  useEffect(() => {
    if (!loaded) return;
    hydratingRef.current = true;
    setCategories(data.websiteBookmarks?.categories || []);
    setItems(data.websiteBookmarks?.items || []);
  }, [loaded, data.websiteBookmarks?.categories, data.websiteBookmarks?.items]);

  useEffect(() => {
    if (!loaded) return;
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    updateWebsiteBookmarks(categories, items);
  }, [categories, items, loaded, updateWebsiteBookmarks]);

  const tree = useMemo(() => buildTree(categories), [categories]);
  const categoryMap = useMemo(() => getCategoryMap(categories), [categories]);
  const descendantIdsMap = useMemo(() => buildDescendantIdsMap(categories), [categories]);
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) || null;
  const activeCategoryIds = useMemo(
    () => (selectedCategoryId === 'all' ? [] : descendantIdsMap.get(selectedCategoryId) || []),
    [selectedCategoryId, descendantIdsMap]
  );
  const categoryItemCountMap = useMemo(() => {
    const map = new Map<string, number>();
    categories.forEach((category) => {
      const descendantIds = new Set(descendantIdsMap.get(category.id) || [category.id]);
      const count = items.filter((item) => item.categoryId && descendantIds.has(item.categoryId)).length;
      map.set(category.id, count);
    });
    return map;
  }, [categories, items, descendantIdsMap]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesCategory =
        selectedCategoryId === 'all' ||
        (item.categoryId ? activeCategoryIds.includes(item.categoryId) : false);
      const haystack = [item.title, item.url, item.description, item.tags.join(' ')]
        .join(' ')
        .toLowerCase();
      return matchesCategory && (!keyword || haystack.includes(keyword));
    });
  }, [items, search, selectedCategoryId, activeCategoryIds]);

  const visibleIconCandidates = useMemo(
    () =>
      filteredItems.filter(
        (item) =>
          item.url?.trim() &&
          !item.iconDataUrl?.trim() &&
          (!item.icon?.trim() || isRelativeIconPath(item.icon))
      ),
    [filteredItems]
  );

  useEffect(() => {
    if (!loaded) return;

    const sanitized = items.map((item) =>
      isRelativeIconPath(item.icon) ? { ...item, icon: '' } : item
    );
    const changed = sanitized.some((item, index) => item.icon !== items[index]?.icon);
    if (changed) {
      setItems(sanitized);
      return;
    }

    const pending = visibleIconCandidates.filter((item) => !faviconLoadingIdsRef.current.has(item.id));

    if (!pending.length) return;

    const batch = pending.slice(0, 6);
    batch.forEach((item) => faviconLoadingIdsRef.current.add(item.id));

    Promise.all(
      batch.map((item) =>
        invoke<string>('fetch_website_favicon', {
          url: item.url,
          title: item.title,
        })
          .then((iconDataUrl) => ({ id: item.id, iconDataUrl }))
          .catch(() => null)
      )
    )
      .then((results) => {
        const resolvedMap = new Map(
          results
            .filter((entry): entry is { id: string; iconDataUrl: string } => Boolean(entry?.iconDataUrl))
            .map((entry) => [entry.id, entry.iconDataUrl])
        );

        if (!resolvedMap.size) return;

        setItems((current) =>
          current.map((entry) =>
            resolvedMap.has(entry.id)
              ? { ...entry, iconDataUrl: resolvedMap.get(entry.id) || entry.iconDataUrl, updatedAt: entry.updatedAt }
              : entry
          )
        );
      })
      .finally(() => {
        batch.forEach((item) => faviconLoadingIdsRef.current.delete(item.id));
      });
  }, [visibleIconCandidates, loaded]);

  const displayGroups = useMemo<BookmarkDisplayGroup[]>(() => {
    if (!filteredItems.length) return [];

    const groups = new Map<string, BookmarkDisplayGroup>();
    const pushItem = (groupId: string, title: string, icon: string, item: BookmarkItem) => {
      const existing = groups.get(groupId);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(groupId, { id: groupId, title, icon, items: [item] });
      }
    };

    if (selectedCategoryId === 'all') {
      filteredItems.forEach((item) => {
        const groupId = getTopLevelGroupId(item.categoryId, categoryMap);
        if (groupId === 'uncategorized') {
          pushItem('uncategorized', '未分类', '🗂️', item);
          return;
        }
        const category = categoryMap.get(groupId);
        pushItem(groupId, category?.name || '未分类', category?.icon || '📁', item);
      });
    } else if (selectedCategory) {
      filteredItems.forEach((item) => {
        const groupId = getImmediateChildGroupId(item.categoryId, selectedCategory.id, categoryMap);
        if (groupId === 'uncategorized') {
          pushItem('uncategorized', '未分类', '🗂️', item);
        } else if (groupId === 'self') {
          pushItem(`self-${selectedCategory.id}`, selectedCategory.name, selectedCategory.icon || '📁', item);
        } else {
          const category = categoryMap.get(groupId);
          pushItem(groupId, category?.name || '未分类', category?.icon || '📁', item);
        }
      });
    }

    return Array.from(groups.values()).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }, [filteredItems, selectedCategoryId, selectedCategory, categoryMap]);

  function upsertCategory(category: BookmarkCategory) {
    const normalized = {
      ...category,
      name: category.name.trim(),
      icon: category.icon?.trim() || '📁',
      updatedAt: new Date().toISOString(),
    };
    setCategories((current) => {
      const exists = current.some((item) => item.id === normalized.id);
      if (exists) {
        return current.map((item) => (item.id === normalized.id ? normalized : item));
      }
      return [...current, normalized];
    });
    if (normalized.parentId) {
      setExpandedIds((current) => ({ ...current, [normalized.parentId!]: true }));
    }
    setShowCategoryEditor(false);
    setEditingCategory(null);
  }

  function deleteCategory(categoryId: string) {
    const ids = collectDescendantIds(categories, categoryId);
    setCategories((current) => current.filter((category) => !ids.includes(category.id)));
    setItems((current) => current.filter((item) => !item.categoryId || !ids.includes(item.categoryId)));
    if (selectedCategoryId !== 'all' && ids.includes(selectedCategoryId)) {
      setSelectedCategoryId('all');
    }
  }

  function upsertBookmark(bookmark: BookmarkItem) {
    const normalized = {
      ...bookmark,
      title: bookmark.title.trim(),
      url: normalizeUrl(bookmark.url),
      description: bookmark.description?.trim() || '',
      icon:
        isDefaultBookmarkIcon(bookmark.icon) || isRelativeIconPath(bookmark.icon)
          ? ''
          : bookmark.icon?.trim() || '',
      tags: bookmark.tags.map((tag) => tag.trim()).filter(Boolean),
      updatedAt: new Date().toISOString(),
    };
    const saveItem = (nextIconDataUrl?: string) =>
      setItems((current) => {
        const finalItem = {
          ...normalized,
          iconDataUrl: nextIconDataUrl ?? normalized.iconDataUrl ?? '',
        };
        const exists = current.some((item) => item.id === finalItem.id);
        if (exists) {
          return current.map((item) => (item.id === finalItem.id ? finalItem : item));
        }
        return [finalItem, ...current];
      });

    saveItem(normalized.iconDataUrl);
    setShowBookmarkEditor(false);
    setEditingBookmark(null);

    if (!normalized.icon?.trim() && !normalized.iconDataUrl?.trim()) {
      invoke<string>('fetch_website_favicon', {
        url: normalized.url,
        title: normalized.title,
      })
        .then((iconDataUrl) => {
          saveItem(iconDataUrl);
        })
        .catch(() => {});
    }
  }

  function deleteBookmark(bookmarkId: string) {
    setItems((current) => current.filter((item) => item.id !== bookmarkId));
  }

  async function openBookmark(bookmark: BookmarkItem) {
    await openExternal(normalizeUrl(bookmark.url));
  }

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(normalizeUrl(url));
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="🌐"
        title="网址收藏"
        subtitle="支持多级分类的网址导航，常用站点统一收集，数据走工具箱统一存储，便于后续同步与备份"
        actions={
          <>
            <button
              onClick={() => {
                setEditingCategory(createCategoryDraft(selectedCategoryId === 'all' ? null : selectedCategoryId));
                setShowCategoryEditor(true);
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <FolderPlus size={14} />
              新建分类
            </button>
            <button
              onClick={() => {
                setEditingBookmark(createBookmarkDraft(selectedCategoryId === 'all' ? null : selectedCategoryId));
                setShowBookmarkEditor(true);
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs transition-colors"
            >
              <Plus size={14} />
              添加网址
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-hidden p-4">
        <div className="grid h-full grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
          <section className="flex flex-col rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索标题、网址、标签..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <button
                onClick={() => setSelectedCategoryId('all')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  selectedCategoryId === 'all'
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Star size={14} />
                  全部收藏
                </span>
                <span className="text-xs text-gray-400">{items.length}</span>
              </button>

              {tree.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 py-10 text-center text-sm text-gray-400">
                  还没有分类，可以先建一个导航分组
                </div>
              ) : (
                tree.map((node) => (
                  <CategoryTreeNode
                    key={node.id}
                    node={node}
                    countMap={categoryItemCountMap}
                    selectedCategoryId={selectedCategoryId}
                    expandedIds={expandedIds}
                    onToggle={(categoryId) =>
                      setExpandedIds((current) => ({
                        ...current,
                        [categoryId]: !current[categoryId],
                      }))
                    }
                    onSelect={setSelectedCategoryId}
                    onEdit={(category) => {
                      setEditingCategory(category);
                      setShowCategoryEditor(true);
                    }}
                    onDelete={deleteCategory}
                  />
                ))
              )}
            </div>
          </section>

          <section className="flex flex-col rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-xl font-semibold">
                    {selectedCategory ? `${selectedCategory.icon || '📁'} ${selectedCategory.name}` : '全部收藏'}
                  </h2>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    {!ready
                      ? '正在初始化窗口主题与网址数据...'
                      : selectedCategory
                      ? '当前会展示这个分类及其所有子分类下的网址。'
                      : '适合把常用后台、工具站、协作链接统一做成导航。'}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 min-w-[240px]">
                  <BookmarkMetric label="分类" value={categories.length} icon={<FolderPlus size={14} />} />
                  <BookmarkMetric label="网址" value={items.length} icon={<Link2 size={14} />} />
                  <BookmarkMetric label="当前显示" value={filteredItems.length} icon={<Globe size={14} />} />
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400">每行列数</span>
                {[3, 4, 5, 6].map((count) => (
                  <button
                    key={count}
                    onClick={() => setColumns(count as 3 | 4 | 5 | 6)}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                      columns === count
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {count}列
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {filteredItems.length === 0 ? (
                <div className="h-full rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 flex flex-col items-center justify-center text-center px-6">
                  <Globe size={34} className="text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">这个分类下还没有网址</p>
                  <p className="mt-1 text-xs text-gray-400">可以先添加常用后台、文档、工作台或数据面板</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {displayGroups.map((group) => (
                    <section key={group.id}>
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-blue-500 to-fuchsia-500" />
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{group.icon}</span>
                            <h3 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                              {group.title}
                            </h3>
                          </div>
                        </div>
                        <span className="px-3 py-1.5 rounded-full bg-gray-50 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
                          {group.items.length} 个站点
                        </span>
                      </div>

                      <div
                        className="grid gap-4"
                        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                      >
                        {group.items.map((item) => (
                          <BookmarkNavCard
                            key={item.id}
                            item={item}
                            onOpen={() => openBookmark(item).catch(() => {})}
                            onCopy={() => copyUrl(item.url).catch(() => {})}
                            onEdit={() => {
                              setEditingBookmark(item);
                              setShowBookmarkEditor(true);
                            }}
                            onDelete={() => deleteBookmark(item.id)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {showCategoryEditor && editingCategory && (
        <BookmarkCategoryModal
          category={editingCategory}
          categories={categories}
          onClose={() => {
            setShowCategoryEditor(false);
            setEditingCategory(null);
          }}
          onSave={upsertCategory}
        />
      )}

      {showBookmarkEditor && editingBookmark && (
        <BookmarkItemModal
          item={editingBookmark}
          categories={categories}
          onClose={() => {
            setShowBookmarkEditor(false);
            setEditingBookmark(null);
          }}
          onSave={upsertBookmark}
        />
      )}
    </div>
  );
}

function CategoryTreeNode({
  node,
  countMap,
  selectedCategoryId,
  expandedIds,
  onToggle,
  onSelect,
  onEdit,
  onDelete,
  level = 0,
}: {
  node: CategoryNode;
  countMap: Map<string, number>;
  selectedCategoryId: string;
  expandedIds: Record<string, boolean>;
  onToggle: (categoryId: string) => void;
  onSelect: (categoryId: string) => void;
  onEdit: (category: BookmarkCategory) => void;
  onDelete: (categoryId: string) => void;
  level?: number;
}) {
  const expanded = expandedIds[node.id] ?? true;
  const count = countMap.get(node.id) || 0;

  return (
    <div>
      <div
        className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-xl transition-colors ${
          selectedCategoryId === node.id
            ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300'
            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
        }`}
        style={{ paddingLeft: `${12 + level * 16}px` }}
      >
        <button onClick={() => onSelect(node.id)} className="flex-1 min-w-0 text-left flex items-center gap-2">
          {node.children.length ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onToggle(node.id);
              }}
              className="text-gray-400 cursor-pointer"
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          ) : (
            <span className="w-[14px]" />
          )}
          <span>{node.icon || '📁'}</span>
          <span className="truncate text-sm">{node.name}</span>
        </button>

        <div className="flex items-center gap-1">
          <span className="text-[11px] text-gray-400">{count}</span>
          <button
            onClick={() => onEdit(node)}
            className="p-1 rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-all"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={() => onDelete(node.id)}
            className="p-1 rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {expanded &&
        node.children.map((child) => (
          <CategoryTreeNode
            key={child.id}
            node={child}
            countMap={countMap}
            selectedCategoryId={selectedCategoryId}
            expandedIds={expandedIds}
            onToggle={onToggle}
            onSelect={onSelect}
            onEdit={onEdit}
            onDelete={onDelete}
            level={level + 1}
          />
        ))}
    </div>
  );
}

function BookmarkMetric({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 px-3 py-3">
      <div className="text-gray-400">{icon}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="text-[11px] text-gray-400">{label}</div>
    </div>
  );
}

function HoverText({
  text,
  className,
}: {
  text: string;
  className: string;
}) {
  return (
    <div className="group/tooltip relative min-w-0">
      <div className={className}>{text}</div>
      <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden max-w-[260px] rounded-xl bg-slate-900 px-2.5 py-1.5 text-[11px] leading-4 text-white shadow-xl group-hover/tooltip:block dark:bg-slate-100 dark:text-slate-900 whitespace-normal break-words">
        {text}
      </div>
    </div>
  );
}

function BookmarkNavCard({
  item,
  onOpen,
  onCopy,
  onEdit,
  onDelete,
}: {
  item: BookmarkItem;
  onOpen: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const descriptionText = item.description || getDomainLabel(item.url);

  return (
    <div className="group relative overflow-visible rounded-[18px] border border-slate-200/85 bg-white px-3 py-1.5 shadow-[0_14px_32px_-28px_rgba(15,23,42,0.34)] transition-all hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_20px_48px_-30px_rgba(14,165,233,0.28)] dark:border-slate-700/80 dark:bg-slate-900/96 dark:hover:border-sky-500/70">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_38%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_42%)]" />
      <div className="relative flex min-h-[46px] items-center gap-2.5">
        <button onClick={onOpen} className="flex min-w-0 flex-shrink-0 items-center gap-2.5 text-left">
          <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[12px] border border-slate-100 bg-[linear-gradient(180deg,#ffffff,#f8fbff)] shadow-[0_8px_18px_-18px_rgba(37,99,235,0.46)] dark:border-slate-700 dark:bg-[linear-gradient(180deg,rgba(30,41,59,0.96),rgba(15,23,42,0.98))]">
            <AutoBookmarkIcon item={item} />
          </div>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start">
            <button onClick={onOpen} className="min-w-0 flex-1 pr-[64px] text-left">
              <HoverText
                text={item.title}
                className="truncate text-[14px] font-semibold tracking-tight text-slate-900 dark:text-slate-100"
              />
            </button>
          </div>
          <button onClick={onOpen} className="mt-[2px] block w-full text-left">
            <HoverText
              text={descriptionText}
              className="truncate text-[11px] leading-4 text-slate-500 dark:text-slate-400"
            />
          </button>
        </div>
        <div className="absolute right-0 top-0 z-10 flex items-center gap-0.5 rounded-full border border-slate-200/80 bg-white/94 px-1 py-0.5 text-slate-400 shadow-sm dark:border-slate-700 dark:bg-slate-800/94">
          <button
            onClick={onCopy}
            className="rounded-md p-0.5 transition-colors hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
            title="复制网址"
          >
            <Copy size={11} />
          </button>
          <button
            onClick={onEdit}
            className="rounded-md p-0.5 transition-colors hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
            title="编辑"
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={onDelete}
            className="rounded-md p-0.5 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-300"
            title="删除"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

function BookmarkCategoryModal({
  category,
  categories,
  onClose,
  onSave,
}: {
  category: BookmarkCategory;
  categories: BookmarkCategory[];
  onClose: () => void;
  onSave: (category: BookmarkCategory) => void;
}) {
  const [draft, setDraft] = useState(category);
  return (
    <BaseModal title={category.name ? '编辑分类' : '新建分类'} onClose={onClose}>
      <Field label="分类名称 *">
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className={inputCls}
        />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="图标">
          <input
            value={draft.icon || ''}
            onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
            className={inputCls}
            placeholder="📁"
          />
        </Field>
        <Field label="父级分类">
          <select
            value={draft.parentId || ''}
            onChange={(e) => setDraft({ ...draft, parentId: e.target.value || null })}
            className={inputCls}
          >
            <option value="">顶级分类</option>
            {categories
              .filter((item) => item.id !== draft.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <ModalActions
        onClose={onClose}
        onSave={() => {
          if (!draft.name.trim()) return;
          onSave(draft);
        }}
        saveLabel="保存分类"
      />
    </BaseModal>
  );
}

function BookmarkItemModal({
  item,
  categories,
  onClose,
  onSave,
}: {
  item: BookmarkItem;
  categories: BookmarkCategory[];
  onClose: () => void;
  onSave: (item: BookmarkItem) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(item);
  const [iconInput, setIconInput] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleIconUpload(file?: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) return;
      setDraft((current) => ({ ...current, icon: '', iconDataUrl: result }));
      setIconInput('');
    };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!draft.title.trim() || !draft.url.trim()) return;

    setSaving(true);
    try {
      let nextDraft = { ...draft };
      const trimmedIconInput = iconInput.trim();

      if (trimmedIconInput) {
        if (isDataUrlIconSource(trimmedIconInput)) {
          nextDraft = { ...nextDraft, icon: '', iconDataUrl: trimmedIconInput };
        } else if (isUrlIconSource(trimmedIconInput)) {
          const resolved = await invoke<string>('resolve_bookmark_icon_source', {
            input: trimmedIconInput,
            title: nextDraft.title,
          });
          nextDraft = { ...nextDraft, icon: '', iconDataUrl: resolved };
        } else {
          nextDraft = { ...nextDraft, icon: trimmedIconInput };
        }
      }

      await onSave(nextDraft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <BaseModal title={item.title ? '编辑网址' : '添加网址'} onClose={onClose}>
      <Field label="图标">
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <AutoBookmarkIcon item={draft} />
            </div>
            <div className="min-w-0 text-xs text-slate-500 dark:text-slate-400">
              当前显示的就是实际图标。留空时优先用网站图标，获取不到会自动生成字母图标。
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={iconInput}
              onChange={(e) => setIconInput(e.target.value)}
              className={inputCls}
              placeholder="支持 emoji、网站网址、图片网址、data:image/base64"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Upload size={13} />
              上传
            </button>
            <button
              type="button"
              onClick={() => {
                setIconInput('');
                setDraft((current) => ({ ...current, icon: '' }));
              }}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RotateCcw size={13} />
              自动
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void handleIconUpload(e.target.files?.[0] || null);
                e.currentTarget.value = '';
              }}
            />
          </div>
        </div>
      </Field>
      <Field label="标题 *">
        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="网址 *">
        <input
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          className={inputCls}
          placeholder="https://example.com"
        />
      </Field>
      <Field label="分类">
        <select
          value={draft.categoryId || ''}
          onChange={(e) => setDraft({ ...draft, categoryId: e.target.value || null })}
          className={inputCls}
        >
          <option value="">未分类</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="标签（逗号分隔）">
        <input
          value={draft.tags.join(', ')}
          onChange={(e) =>
            setDraft({
              ...draft,
              tags: e.target.value.split(',').map((tag) => tag.trim()).filter(Boolean),
            })
          }
          className={inputCls}
        />
      </Field>
      <Field label="描述">
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
          void handleSave();
        }}
        saveLabel={saving ? '保存中...' : '保存网址'}
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
      <button
        onClick={onClose}
        className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
      >
        取消
      </button>
      <button
        onClick={onSave}
        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors"
      >
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
