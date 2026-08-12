import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { open as openExternal } from '@tauri-apps/api/shell';
import { appWindow } from '@tauri-apps/api/window';
import {
  BookOpen,
  ChevronRight,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Download,
  GripVertical,
  Globe2,
  Hash,
  Edit3,
  ExternalLink,
  FileUp,
  FolderPlus,
  Inbox,
  Languages,
  Loader2,
  Minimize2,
  Palette,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Settings2,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useSettingsStore } from '../stores/settingsStore';
import { useToolTheme } from './useToolTheme';
import { EmptyState, StatusMessage, ToolbarButton } from './systemToolUtils';
import {
  DEFAULT_RSS_CATEGORIES,
  DEFAULT_RSS_REFRESH_MINUTES,
  DEFAULT_RSS_SETTINGS,
  DEFAULT_RSS_WEB_CRAWL_RULE,
  RSS_READER_VERSION,
  applyArticleStates,
  articleTime,
  articleStatesFromArticles,
  downloadText,
  exportOpml,
  formatDateTime,
  formatFullDateTime,
  normalizeFeedUrl,
  normalizeRssReaderData,
  parseOpml,
  uid,
  type RssArticle,
  type RssArticleState,
  type RssCategory,
  type RssFeed,
  type RssFetchedItem,
  type RssFeedSourceType,
  type RssFetchResult,
  type RssKeywordScope,
  type RssKeywordSubscription,
  type RssReaderSettings,
  type RssReaderToolData,
  type RssReaderView,
  type RssWebCrawlRule,
} from './rssReaderStore';

type SourceFilter =
  | { type: 'all'; id: 'all' }
  | { type: 'category' | 'feed' | 'keyword'; id: string };

const CONTROL_CLASS =
  'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950';

const VIEW_TABS: Array<{ key: RssReaderView; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'starred', label: '收藏' },
  { key: 'later', label: '稍后读' },
];

const CATEGORY_COLORS = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#0891b2',
  '#7c3aed',
  '#dc2626',
  '#64748b',
  '#db2777',
];

const KEYWORD_SCOPE_OPTIONS: Array<{ key: RssKeywordScope; label: string }> = [
  { key: 'title', label: '标题' },
  { key: 'summary', label: '摘要' },
  { key: 'content', label: '正文' },
  { key: 'author', label: '作者' },
  { key: 'source', label: '订阅源' },
];

const INITIAL_ARTICLE_RENDER_LIMIT = 80;
const ARTICLE_RENDER_STEP = 80;
const ARTICLE_PAGE_SIZE = 120;
const RSS_ARTICLE_COMPARE_KEYS: Array<keyof RssArticle> = [
  'id',
  'feedId',
  'stableId',
  'title',
  'link',
  'author',
  'summary',
  'content',
  'summaryHtml',
  'contentHtml',
  'publishedAt',
  'updatedAt',
  'fetchedAt',
  'guid',
  'translatedTitle',
  'translatedSummary',
  'translatedHtml',
  'translatedContent',
  'translatedAt',
  'translatedProvider',
  'translationError',
  'read',
  'starred',
  'later',
];

type RssFetchRequestFeed = Pick<
  RssFeed,
  'sourceType' | 'title' | 'url' | 'siteUrl' | 'description' | 'etag' | 'lastModified' | 'webRule'
>;

interface FeedDialogState {
  mode: 'add' | 'edit';
  feedId?: string;
  sourceType: RssFeedSourceType;
  title: string;
  url: string;
  siteUrl: string;
  description: string;
  webRule: RssWebCrawlRule;
  categoryId: string;
  refreshMinutes: number;
  enabled: boolean;
  translateEnabled: boolean;
}

interface KeywordDialogState {
  mode: 'add' | 'edit';
  keywordId?: string;
  name: string;
  keywordsText: string;
  scopes: RssKeywordScope[];
  matchMode: 'any' | 'all';
  caseSensitive: boolean;
  enabled: boolean;
  color: string;
}

interface TranslateResult {
  translated_text: string;
  from_lang: string;
  to_lang: string;
}

interface RssArticleCounter {
  total: number;
  unread: number;
}

interface RssArticlePageKeywordRequest {
  id?: string;
  keywords: string[];
  scopes: RssKeywordScope[];
  matchMode: 'any' | 'all';
  caseSensitive: boolean;
  enabled?: boolean;
}

interface RssArticlePageFeedSource {
  feedId: string;
  title: string;
  description: string;
  siteUrl: string;
  url: string;
}

interface RssArticlePageQuery {
  search: string;
  feedIds: string[];
  view: RssReaderView;
  keyword: RssArticlePageKeywordRequest | null;
  keywords: RssArticlePageKeywordRequest[];
  feedSources: RssArticlePageFeedSource[];
}

interface RssArticlePageResponse {
  items: RssArticle[];
  total: number;
  unread: number;
  starred: number;
  later: number;
  allTotal: number;
  allUnread: number;
  byFeed: Record<string, RssArticleCounter>;
  byKeyword: Record<string, RssArticleCounter>;
}

const EMPTY_ARTICLE_PAGE_STATS = {
  total: 0,
  unread: 0,
  starred: 0,
  later: 0,
  allTotal: 0,
  allUnread: 0,
  byFeed: {} as Record<string, RssArticleCounter>,
  byKeyword: {} as Record<string, RssArticleCounter>,
};

function categorySnapshot(categories: RssCategory[]) {
  return JSON.stringify(
    categories.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
    }))
  );
}

export default function RssReaderTool() {
  const ready = useToolTheme();
  const globalSettings = useSettingsStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hydratingRef = useRef(false);
  const categoriesSnapshotRef = useRef('');
  const persistStoreRef = useRef<() => void>(() => {});
  const storeLoadedRef = useRef(false);
  const articlePageOffsetRef = useRef(0);
  const articlePageLoadingRef = useRef(false);
  const articlePageHasMoreRef = useRef(true);
  const articlePageQueryKeyRef = useRef('');
  const loadArticlePageRef = useRef<(reset?: boolean) => Promise<void>>(async () => {});
  const articlePageReloadQueuedRef = useRef(false);
  const articleDetailLoadingRef = useRef<Set<string>>(new Set());
  const articleDetailLoadedRef = useRef<Set<string>>(new Set());
  const articleContentScrollRef = useRef<HTMLDivElement | null>(null);
  const articleStatesRef = useRef<RssArticleState[]>([]);
  const articlesRef = useRef<RssArticle[]>([]);
  const feedsRef = useRef<RssFeed[]>([]);
  const autoRefreshRunningRef = useRef<Set<string>>(new Set());
  const selectedArticleIdRef = useRef<string | null>(null);
  const readerActiveAtRef = useRef(Date.now());
  const renderingArticleHtmlRef = useRef(false);
  const articleHtmlRenderRequestRef = useRef(0);
  const categoryDragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const dragOverCategoryRef = useRef<string | null>(null);
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [categories, setCategories] = useState<RssCategory[]>(DEFAULT_RSS_CATEGORIES);
  const [keywordSubscriptions, setKeywordSubscriptions] = useState<RssKeywordSubscription[]>([]);
  const [articles, setArticles] = useState<RssArticle[]>([]);
  const [articleStates, setArticleStates] = useState<RssArticleState[]>([]);
  const [settings, setSettings] = useState<RssReaderSettings>(DEFAULT_RSS_SETTINGS);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>({ type: 'all', id: 'all' });
  const [view, setView] = useState<RssReaderView>('all');
  const [search, setSearch] = useState('');
  const [feedCategoryId, setFeedCategoryId] = useState('tech');
  const [feedDialog, setFeedDialog] = useState<FeedDialogState | null>(null);
  const [webRulePreview, setWebRulePreview] = useState<RssFetchResult | null>(null);
  const [webRulePreviewLoading, setWebRulePreviewLoading] = useState(false);
  const [keywordDialog, setKeywordDialog] = useState<KeywordDialogState | null>(null);
  const [categoryMenu, setCategoryMenu] = useState<{
    categoryId: string | null;
    x: number;
    y: number;
  } | null>(null);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<string[]>([]);
  const [feedMenu, setFeedMenu] = useState<{
    feedId: string;
    x: number;
    y: number;
  } | null>(null);
  const [keywordMenu, setKeywordMenu] = useState<{
    keywordId: string | null;
    x: number;
    y: number;
  } | null>(null);
  const [draggingCategoryId, setDraggingCategoryId] = useState<string | null>(null);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [articleViewMode, setArticleViewMode] = useState<'translated' | 'original'>('original');
  const [selectedArticleHtml, setSelectedArticleHtml] = useState('');
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [articlesLoaded, setArticlesLoaded] = useState(false);
  const [articlePageHasMore, setArticlePageHasMore] = useState(true);
  const [articlePageStats, setArticlePageStats] = useState(EMPTY_ARTICLE_PAGE_STATS);
  const [loadingMoreArticles, setLoadingMoreArticles] = useState(false);
  const [loadingArticleDetailId, setLoadingArticleDetailId] = useState('');
  const [visibleArticleLimit, setVisibleArticleLimit] = useState(INITIAL_ARTICLE_RENDER_LIMIT);
  const [loading, setLoading] = useState(false);
  const [busyFeedId, setBusyFeedId] = useState('');
  const [showReaderSettings, setShowReaderSettings] = useState(false);
  const [translatingArticleId, setTranslatingArticleId] = useState('');
  const [message, setMessage] = useState('正在读取 RSS 本地数据库...');
  const [error, setError] = useState('');

  const persistStore = useCallback(
    (nextCategories?: RssCategory[]) => {
      const payload: Omit<RssReaderToolData, 'lastModified'> = {
        version: RSS_READER_VERSION,
        feeds,
        categories: nextCategories || categories,
        keywordSubscriptions,
        articleStates: [],
        settings,
      };
      void invoke('rss_reader_save_store', {
        data: JSON.stringify(payload, null, 2),
      }).catch((err) => {
        setError(String(err));
      });
    },
    [categories, feeds, keywordSubscriptions, settings]
  );

  useEffect(() => {
    persistStoreRef.current = persistStore;
  }, [persistStore]);

  useEffect(() => {
    let cancelled = false;
    const loadStore = async () => {
      try {
        const raw = await invoke<string>('rss_reader_load_store');
        const parsed = raw.trim() ? JSON.parse(raw) : {};
        const nextStore = normalizeRssReaderData(parsed);
        if (cancelled) return;
        hydratingRef.current = true;
        categoriesSnapshotRef.current = categorySnapshot(nextStore.categories);
        setFeeds(nextStore.feeds);
        setCategories(nextStore.categories.length ? nextStore.categories : DEFAULT_RSS_CATEGORIES);
        setKeywordSubscriptions(nextStore.keywordSubscriptions);
        setArticleStates(nextStore.articleStates);
        articleStatesRef.current = nextStore.articleStates;
        setSettings(nextStore.settings);
        setView(nextStore.settings.defaultView || 'all');
        setFeedCategoryId(nextStore.categories[0]?.id || 'tech');
        setArticles([]);
        setArticlesLoaded(false);
        setMessage('RSS 订阅配置已加载，正在后台读取文章缓存...');
        setError('');
      } catch (err) {
        if (!cancelled) {
          setFeeds([]);
          setCategories(DEFAULT_RSS_CATEGORIES);
          setKeywordSubscriptions([]);
          setArticleStates([]);
          articleStatesRef.current = [];
          setArticles([]);
          setSettings(DEFAULT_RSS_SETTINGS);
          categoriesSnapshotRef.current = categorySnapshot(DEFAULT_RSS_CATEGORIES);
          setMessage('RSS 本地数据库读取失败，已使用临时默认配置。');
          setError(String(err));
        }
      } finally {
        if (!cancelled) setStoreLoaded(true);
      }
    };
    void loadStore();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    articleStatesRef.current = articleStates;
  }, [articleStates]);

  useEffect(() => {
    storeLoadedRef.current = storeLoaded;
  }, [storeLoaded]);

  useEffect(() => {
    feedsRef.current = feeds;
  }, [feeds]);

  useEffect(() => {
    articlesRef.current = articles;
  }, [articles]);

  useEffect(() => {
    selectedArticleIdRef.current = selectedArticleId;
  }, [selectedArticleId]);

  useEffect(() => {
    if (!storeLoaded) return;
    void invoke('rss_reader_apply_resident_settings', {
      request: {
        startWithApp: settings.startWithApp,
        minimizeToTray: settings.minimizeToTray,
      },
    }).catch((err) => setError(String(err)));
  }, [settings.minimizeToTray, settings.startWithApp, storeLoaded]);

  const articlePageQuery = useMemo<RssArticlePageQuery>(() => {
    let feedIds = feeds.map((feed) => feed.id);
    if (sourceFilter.type === 'feed') {
      feedIds = feeds.some((feed) => feed.id === sourceFilter.id) ? [sourceFilter.id] : [];
    }
    if (sourceFilter.type === 'category') {
      feedIds = feeds.filter((feed) => feed.categoryId === sourceFilter.id).map((feed) => feed.id);
    }
    const selectedKeyword =
      sourceFilter.type === 'keyword'
        ? keywordSubscriptions.find((item) => item.id === sourceFilter.id)
        : null;
    return {
      search: search.trim(),
      feedIds,
      view,
      keyword: selectedKeyword
        ? {
            id: selectedKeyword.id,
            keywords: selectedKeyword.keywords,
            scopes: selectedKeyword.scopes,
            matchMode: selectedKeyword.matchMode,
            caseSensitive: selectedKeyword.caseSensitive,
            enabled: selectedKeyword.enabled,
          }
        : null,
      keywords: keywordSubscriptions.map((keyword) => ({
        id: keyword.id,
        keywords: keyword.keywords,
        scopes: keyword.scopes,
        matchMode: keyword.matchMode,
        caseSensitive: keyword.caseSensitive,
        enabled: keyword.enabled,
      })),
      feedSources: feeds.map((feed) => ({
        feedId: feed.id,
        title: feed.title,
        description: feed.description,
        siteUrl: feed.siteUrl,
        url: feed.url,
      })),
    };
  }, [feeds, keywordSubscriptions, search, sourceFilter, view]);
  const articlePageQueryKey = useMemo(
    () =>
      JSON.stringify({
        search: articlePageQuery.search,
        feedIds: articlePageQuery.feedIds,
        view: articlePageQuery.view,
        keyword: articlePageQuery.keyword,
        keywords: articlePageQuery.keywords,
      }),
    [
      articlePageQuery.feedIds,
      articlePageQuery.keyword,
      articlePageQuery.keywords,
      articlePageQuery.search,
      articlePageQuery.view,
    ]
  );

  const loadArticlePage = useCallback(
    async (reset = false) => {
      if (articlePageLoadingRef.current) return;
      if (!reset && !articlePageHasMoreRef.current) return;
      const requestKey = articlePageQueryKey;
      articlePageQueryKeyRef.current = requestKey;
      articlePageLoadingRef.current = true;
      setLoadingMoreArticles(!reset);
      try {
        const offset = reset ? 0 : articlePageOffsetRef.current;
        const page = await invoke<RssArticlePageResponse>('rss_reader_load_article_page', {
          request: {
            ...articlePageQuery,
            limit: ARTICLE_PAGE_SIZE,
            offset,
          },
        });
        if (articlePageQueryKeyRef.current !== requestKey) return;
        const normalizedPage = applyArticleStates(
          Array.isArray(page.items) ? page.items : [],
          articleStatesRef.current
        );
        articlePageOffsetRef.current = offset + normalizedPage.length;
        articlePageHasMoreRef.current = articlePageOffsetRef.current < page.total;
        setArticlePageStats({
          total: page.total || 0,
          unread: page.unread || 0,
          starred: page.starred || 0,
          later: page.later || 0,
          allTotal: page.allTotal || 0,
          allUnread: page.allUnread || 0,
          byFeed: page.byFeed || {},
          byKeyword: page.byKeyword || {},
        });
        setArticlePageHasMore(articlePageHasMoreRef.current);
        setArticles((current) => {
          const seen = new Set(current.map((article) => `${article.feedId}::${article.stableId}`));
          const merged = reset ? [] : [...current];
          for (const article of normalizedPage) {
            const key = `${article.feedId}::${article.stableId}`;
            const existing = current.find(
              (item) => item.feedId === article.feedId && item.stableId === article.stableId
            );
            if (!reset && seen.has(key)) continue;
            seen.add(key);
            merged.push(mergeRssArticleListItem(existing, article));
          }
          return merged;
        });
        setArticlesLoaded(true);
        setMessage(
          page.total > normalizedPage.length || articlePageHasMoreRef.current
            ? `当前条件共 ${page.total || 0} 篇，已按需加载 ${articlePageOffsetRef.current} 篇。`
            : `当前条件共 ${page.total || 0} 篇，已全部加载。`
        );
      } catch (err) {
        if (articlePageQueryKeyRef.current === requestKey) {
          setArticlesLoaded(true);
          setError(String(err));
        }
      } finally {
        if (articlePageQueryKeyRef.current === requestKey) {
          articlePageLoadingRef.current = false;
          setLoadingMoreArticles(false);
        }
      }
    },
    [articlePageQuery, articlePageQueryKey]
  );

  useEffect(() => {
    loadArticlePageRef.current = loadArticlePage;
  }, [loadArticlePage]);

  const loadArticleDetail = useCallback(async (article: RssArticle | null) => {
    if (!article) return;
    const key = rssArticleDetailKey(article);
    if (hasRssArticleDetailPayload(article) || articleDetailLoadedRef.current.has(key)) return;
    if (articleDetailLoadingRef.current.has(key)) return;
    articleDetailLoadingRef.current.add(key);
    setLoadingArticleDetailId(article.id);
    try {
      const detail = await invoke<RssArticle | null>('rss_reader_load_article_detail', {
        request: { feedId: article.feedId, stableId: article.stableId },
      });
      if (!detail) return;
      const [nextDetail] = applyArticleStates([detail], articleStatesRef.current);
      setArticles((current) => mergeRssArticleDetail(current, nextDetail).articles);
    } catch (err) {
      setError(String(err));
    } finally {
      articleDetailLoadedRef.current.add(key);
      articleDetailLoadingRef.current.delete(key);
      setLoadingArticleDetailId((current) => (current === article.id ? '' : current));
    }
  }, []);

  useEffect(() => {
    if (!storeLoaded) return;
    let cancelled = false;
    articlePageQueryKeyRef.current = articlePageQueryKey;
    articlePageLoadingRef.current = false;
    articlePageOffsetRef.current = 0;
    articlePageHasMoreRef.current = true;
    articleDetailLoadedRef.current.clear();
    setArticles([]);
    setSelectedArticleId(null);
    setSelectedArticleHtml('');
    setArticlesLoaded(false);
    setVisibleArticleLimit(INITIAL_ARTICLE_RENDER_LIMIT);
    setArticlePageHasMore(true);
    setArticlePageStats(EMPTY_ARTICLE_PAGE_STATS);
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        void loadArticlePage(true);
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [articlePageQueryKey, storeLoaded]);

  useEffect(() => {
    if (!storeLoaded) return;
    if (hydratingRef.current) {
      hydratingRef.current = false;
      categoriesSnapshotRef.current = categorySnapshot(categories);
      return;
    }

    const categoriesSnapshot = categorySnapshot(categories);
    if (categoriesSnapshotRef.current !== categoriesSnapshot) {
      categoriesSnapshotRef.current = categoriesSnapshot;
      persistStore(categories);
      return;
    }

    const timer = window.setTimeout(() => {
      persistStore(categories);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [categories, feeds, keywordSubscriptions, persistStore, settings, storeLoaded]);

  useEffect(() => {
    if (!categoryMenu && !feedMenu && !keywordMenu) return;
    const closeAllMenus = () => {
      setCategoryMenu(null);
      setFeedMenu(null);
      setKeywordMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAllMenus();
    };
    window.addEventListener('click', closeAllMenus);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', closeAllMenus);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [categoryMenu, feedMenu, keywordMenu]);

  useEffect(() => {
    if (!categories.length) return;
    if (!categories.some((category) => category.id === feedCategoryId)) {
      setFeedCategoryId(categories[0].id);
    }
    setCollapsedCategoryIds((current) =>
      current.filter((categoryId) => categories.some((category) => category.id === categoryId))
    );
  }, [categories, feedCategoryId]);

  useEffect(() => {
    return () => {
      if (storeLoadedRef.current && !hydratingRef.current) {
        persistStoreRef.current();
      }
    };
  }, []);

  const feedById = useMemo(() => Object.fromEntries(feeds.map((feed) => [feed.id, feed])), [feeds]);
  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category])),
    [categories]
  );
  const feedsByCategory = useMemo(() => {
    const grouped = Object.fromEntries(
      categories.map((category) => [category.id, [] as RssFeed[]])
    );
    for (const feed of feeds) {
      grouped[feed.categoryId] ||= [];
      grouped[feed.categoryId].push(feed);
    }
    return grouped;
  }, [categories, feeds]);
  const categoryMenuTarget = categoryMenu?.categoryId
    ? categoryById[categoryMenu.categoryId]
    : null;
  const feedMenuTarget = feedMenu ? feedById[feedMenu.feedId] : null;
  const keywordMenuTarget = keywordMenu?.keywordId
    ? keywordSubscriptions.find((item) => item.id === keywordMenu.keywordId) || null
    : null;

  const counts = useMemo(() => {
    const byFeed: Record<string, RssArticleCounter> = {};
    const byCategory: Record<string, RssArticleCounter> = {};
    const byKeyword: Record<string, RssArticleCounter> = {};
    for (const feed of feeds) {
      byFeed[feed.id] = articlePageStats.byFeed[feed.id] || { total: 0, unread: 0 };
      byCategory[feed.categoryId] ||= { total: 0, unread: 0 };
      byCategory[feed.categoryId].total += byFeed[feed.id].total;
      byCategory[feed.categoryId].unread += byFeed[feed.id].unread;
    }
    for (const keyword of keywordSubscriptions) {
      byKeyword[keyword.id] = articlePageStats.byKeyword[keyword.id] || { total: 0, unread: 0 };
    }
    return {
      byFeed,
      byCategory,
      byKeyword,
      unread: articlePageStats.unread,
      starred: articlePageStats.starred,
      later: articlePageStats.later,
      allTotal: articlePageStats.allTotal,
      allUnread: articlePageStats.allUnread,
    };
  }, [articlePageStats, feeds, keywordSubscriptions]);

  const visibleArticles = useMemo(() => {
    return [...articles].sort((a, b) => dateScore(b) - dateScore(a));
  }, [articles]);
  const renderedArticles = useMemo(
    () => visibleArticles.slice(0, visibleArticleLimit),
    [visibleArticles, visibleArticleLimit]
  );

  const selectedArticle = useMemo(
    () => articles.find((article) => article.id === selectedArticleId) || null,
    [articles, selectedArticleId]
  );
  const selectedFeed = selectedArticle ? feedById[selectedArticle.feedId] : null;
  const selectedArticleHasTranslation = hasRssArticleTranslationPayload(selectedArticle);
  const selectedArticleDisplayMode =
    articleViewMode === 'translated' && selectedArticleHasTranslation ? 'translated' : 'original';
  const selectedArticleTitle =
    selectedArticleDisplayMode === 'translated' && selectedArticle?.translatedTitle.trim()
      ? selectedArticle.translatedTitle
      : selectedArticle?.title || '';
  const showArticleDetailLoading = Boolean(
    selectedArticle &&
    loadingArticleDetailId === selectedArticle.id &&
    !hasRssArticleRenderablePayload(selectedArticle)
  );
  const visibleIds = useMemo(
    () => new Set(visibleArticles.map((article) => article.id)),
    [visibleArticles]
  );

  useEffect(() => {
    if (!visibleArticles.length) {
      setSelectedArticleId(null);
      setSelectedArticleHtml('');
      return;
    }
    if (!selectedArticleId || !visibleIds.has(selectedArticleId)) {
      const nextArticle = visibleArticles[0];
      setArticleViewMode(hasRssArticleTranslationPayload(nextArticle) ? 'translated' : 'original');
      setSelectedArticleId(nextArticle.id);
    }
  }, [selectedArticleId, visibleArticles, visibleIds]);

  useLayoutEffect(() => {
    if (!selectedArticleId) return;
    const nextMode = selectedArticleHasTranslation ? 'translated' : 'original';
    setArticleViewMode((current) => (current === nextMode ? current : nextMode));
  }, [selectedArticleId, selectedArticleHasTranslation]);

  useLayoutEffect(() => {
    if (!selectedArticleId) return;
    if (articleContentScrollRef.current) {
      articleContentScrollRef.current.scrollTop = 0;
    }
  }, [selectedArticleId]);

  useEffect(() => {
    if (!selectedArticle) {
      setSelectedArticleHtml('');
      return;
    }
    const requestId = articleHtmlRenderRequestRef.current + 1;
    articleHtmlRenderRequestRef.current = requestId;
    const timer = window.setTimeout(() => {
      renderingArticleHtmlRef.current = true;
      try {
        const html = renderRssArticleHtml(selectedArticle, selectedArticleDisplayMode);
        if (articleHtmlRenderRequestRef.current === requestId) {
          setSelectedArticleHtml(html);
        }
      } finally {
        renderingArticleHtmlRef.current = false;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedArticle, selectedArticleDisplayMode]);

  useEffect(() => {
    if (selectedArticle) void loadArticleDetail(selectedArticle);
  }, [loadArticleDetail, selectedArticle]);

  useEffect(() => {
    setVisibleArticleLimit(INITIAL_ARTICLE_RENDER_LIMIT);
  }, [search, sourceFilter, view]);

  useEffect(() => {
    if (!articlesLoaded || !articlePageHasMore) return;
    if (visibleArticles.length - renderedArticles.length > ARTICLE_RENDER_STEP) return;
    void loadArticlePage(false);
  }, [
    articlePageHasMore,
    articlesLoaded,
    loadArticlePage,
    renderedArticles.length,
    visibleArticles.length,
  ]);

  const syncArticleStates = useCallback((nextArticles: RssArticle[]) => {
    setArticleStates((current) => {
      const next = articleStatesFromArticles(nextArticles, current);
      articleStatesRef.current = next;
      return next;
    });
  }, []);

  const patchArticleStateRow = useCallback((article: RssArticle) => {
    setArticleStates((current) => {
      const next = upsertRssArticleState(current, article);
      articleStatesRef.current = next;
      return next;
    });
  }, []);

  const persistArticleStateRows = useCallback((nextArticles: RssArticle[]) => {
    const states = nextArticles.map((article) => ({
      feedId: article.feedId,
      stableId: article.stableId,
      read: article.read,
      starred: article.starred,
      later: article.later,
    }));
    if (!states.length) return;
    void invoke('rss_reader_update_article_states', {
      request: { states },
    }).catch((err) => setError(String(err)));
  }, []);

  const reloadArticlePagePreservingSelection = useCallback(async () => {
    if (articlePageReloadQueuedRef.current) return;
    articlePageReloadQueuedRef.current = true;
    const keepSelectedId = selectedArticleIdRef.current;
    try {
      await loadArticlePageRef.current(true);
      if (keepSelectedId) {
        setSelectedArticleId((current) => current || keepSelectedId);
      }
    } finally {
      articlePageReloadQueuedRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!storeLoaded) return;
    let disposed = false;
    let reloadTimer = 0;
    const scheduleReload = () => {
      if (disposed) return;
      window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        if (!disposed) void reloadArticlePagePreservingSelection();
      }, 800);
    };
    let unlisten: (() => void) | null = null;
    listen('rss-reader-background-updated', scheduleReload)
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => setError(String(err)));
    return () => {
      disposed = true;
      window.clearTimeout(reloadTimer);
      if (unlisten) unlisten();
    };
  }, [reloadArticlePagePreservingSelection, storeLoaded]);

  const patchArticlePageStatsForStateChange = useCallback(
    (previous: RssArticle, next: RssArticle) => {
      setArticlePageStats((current) => {
        const nextStats = {
          ...current,
          byFeed: { ...current.byFeed },
          byKeyword: { ...current.byKeyword },
        };
        const unreadDelta = (next.read ? 0 : 1) - (previous.read ? 0 : 1);
        const starredDelta = (next.starred ? 1 : 0) - (previous.starred ? 1 : 0);
        const laterDelta = (next.later ? 1 : 0) - (previous.later ? 1 : 0);
        if (unreadDelta) {
          nextStats.unread = Math.max(0, nextStats.unread + unreadDelta);
          nextStats.allUnread = Math.max(0, nextStats.allUnread + unreadDelta);
          const feedCounter = nextStats.byFeed[next.feedId];
          if (feedCounter) {
            nextStats.byFeed[next.feedId] = {
              ...feedCounter,
              unread: Math.max(0, feedCounter.unread + unreadDelta),
            };
          }
          const matchedKeywordIds =
            sourceFilter.type === 'keyword' ? [sourceFilter.id] : Object.keys(nextStats.byKeyword);
          for (const keywordId of matchedKeywordIds) {
            const counter = nextStats.byKeyword[keywordId];
            if (!counter) continue;
            nextStats.byKeyword[keywordId] = {
              ...counter,
              unread: Math.max(0, counter.unread + unreadDelta),
            };
          }
        }
        if (starredDelta) nextStats.starred = Math.max(0, nextStats.starred + starredDelta);
        if (laterDelta) nextStats.later = Math.max(0, nextStats.later + laterDelta);
        return nextStats;
      });
    },
    [sourceFilter]
  );

  const persistArticleTranslation = useCallback(async (article: RssArticle) => {
    await invoke('rss_reader_update_article_translation', {
      request: {
        feedId: article.feedId,
        stableId: article.stableId,
        translatedTitle: article.translatedTitle,
        translatedSummary: article.translatedSummary,
        translatedHtml: article.translatedHtml,
        translatedContent: article.translatedContent,
        translatedAt: article.translatedAt,
        translatedProvider: article.translatedProvider,
        translationError: article.translationError,
      },
    });
  }, []);

  const persistFeedArticles = useCallback(
    (feedId: string, nextArticles: RssArticle[], replaceFeed = false) => {
      const feedArticles = nextArticles.filter((article) => article.feedId === feedId);
      return invoke<number>('rss_reader_upsert_articles', {
        request: {
          feedId,
          articles: feedArticles,
          replaceFeed,
        },
      }).catch((err) => {
        setError(String(err));
        return 0;
      });
    },
    []
  );

  const deleteArticleRows = useCallback((items: Array<Pick<RssArticle, 'feedId' | 'stableId'>>) => {
    if (!items.length) return;
    void invoke('rss_reader_delete_articles', {
      request: { items },
    }).catch((err) => setError(String(err)));
  }, []);

  const fetchFeedResult = useCallback((feed: RssFetchRequestFeed) => {
    if (feed.sourceType === 'web') {
      return invoke<RssFetchResult>('rss_reader_fetch_web_feed', {
        request: {
          url: feed.url,
          title: feed.title || '',
          description: feed.description || '',
          siteUrl: feed.siteUrl || '',
          rule: feed.webRule,
          previewLimit: 0,
        },
      });
    }
    return invoke<RssFetchResult>('rss_reader_fetch_feed', {
      request: {
        url: feed.url,
        etag: feed.etag || '',
        lastModified: feed.lastModified || '',
      },
    });
  }, []);

  const translateWithDefaultProvider = useCallback(async (text: string) => {
    await useSettingsStore.getState().loadSettings();
    const latestSettings = useSettingsStore.getState();
    const provider = latestSettings.translateProvider || 'baidu';
    const result = await invoke<TranslateResult>('translate_text', {
      text,
      fromLang: latestSettings.translateFromLang || 'auto',
      toLang: latestSettings.translateToLang || 'zh',
      provider,
      autoDetectLanguage: latestSettings.translateAutoDetectLanguage ?? true,
      config: {
        baiduAppId: latestSettings.translateBaiduAppId || '',
        baiduSecretKey: latestSettings.translateBaiduSecretKey || '',
        googleApiKey: latestSettings.translateGoogleApiKey || '',
        bingApiKey: latestSettings.translateBingApiKey || '',
        tencentSecretId: latestSettings.translateTencentSecretId || '',
        tencentSecretKey: latestSettings.translateTencentSecretKey || '',
        tencentRegion: latestSettings.translateTencentRegion || 'ap-guangzhou',
        openaiApiKey: latestSettings.translateOpenaiApiKey || '',
        openaiModel: latestSettings.translateOpenaiModel || 'gpt-4o',
        openaiBaseUrl: latestSettings.translateOpenaiBaseUrl || '',
        geminiApiKey: latestSettings.translateGeminiApiKey || '',
        geminiModel: latestSettings.translateGeminiModel || 'gemini-pro',
      },
    });
    return {
      translatedText: result.translated_text,
      provider,
      fromLang: result.from_lang,
      toLang: result.to_lang,
    };
  }, []);

  const translateArticleWithFormat = useCallback(
    async (article: RssArticle) => {
      const source = buildArticleTranslationSource(article);
      if (!source.text && !source.html) throw new Error('文章没有可翻译的文本内容。');
      const titleResult = article.title.trim()
        ? await translateWithDefaultProvider(article.title.trim())
        : null;
      const summarySource = (article.summary || stripHtmlForSearch(article.summaryHtml)).trim();
      const summaryResult =
        summarySource && summarySource !== article.title.trim()
          ? await translateWithDefaultProvider(summarySource)
          : null;
      if (!source.html) {
        const result = await translateWithDefaultProvider(source.text);
        return {
          translatedTitle: titleResult?.translatedText || '',
          translatedSummary: summaryResult?.translatedText || '',
          translatedHtml: renderPlainTextAsHtml(result.translatedText),
          translatedText: result.translatedText,
          provider: result.provider,
          fromLang: result.fromLang,
          toLang: result.toLang,
        };
      }
      const translated = await translateHtmlPreservingFormat(
        source.html,
        translateWithDefaultProvider
      );
      return {
        translatedTitle: titleResult?.translatedText || '',
        translatedSummary: summaryResult?.translatedText || '',
        translatedHtml: translated.html,
        translatedText: translated.text,
        provider: translated.provider,
        fromLang: translated.fromLang,
        toLang: translated.toLang,
      };
    },
    [translateWithDefaultProvider]
  );

  const patchArticleAndPersist = useCallback(
    async (sourceArticle: RssArticle, patch: Partial<RssArticle>) => {
      const changedArticle = { ...sourceArticle, ...patch };
      await persistArticleTranslation(changedArticle);
      setArticles((current) =>
        current.map((article) =>
          article.feedId === sourceArticle.feedId && article.stableId === sourceArticle.stableId
            ? { ...article, ...patch }
            : article
        )
      );
      return changedArticle;
    },
    [persistArticleTranslation]
  );

  const translateArticleByRow = useCallback(
    async (article: RssArticle, silent = false) => {
      const articleId = article.id;
      if (!article || translatingArticleId === articleId) return;
      setTranslatingArticleId(articleId);
      if (!silent) {
        setError('');
        setMessage(`正在翻译：${article.title}`);
      }
      try {
        const result = await translateArticleWithFormat(article);
        const translatedAt = new Date().toISOString();
        const patch = {
          translatedTitle: result.translatedTitle,
          translatedSummary: result.translatedSummary,
          translatedHtml: result.translatedHtml,
          translatedContent: result.translatedText,
          translatedAt,
          translatedProvider: result.provider,
          translationError: '',
        };
        await patchArticleAndPersist(article, patch);
        setArticleViewMode('translated');
        if (!silent) {
          setMessage(`已翻译：${result.translatedTitle || article.title}`);
        }
      } catch (err) {
        const message = String(err);
        const patch = { translationError: message };
        void patchArticleAndPersist(article, patch).catch((saveError) =>
          setError(String(saveError))
        );
        if (!silent) setError(message);
      } finally {
        setTranslatingArticleId('');
      }
    },
    [
      patchArticleAndPersist,
      persistArticleTranslation,
      translateArticleWithFormat,
      translatingArticleId,
    ]
  );

  const translateArticle = useCallback(
    async (articleId: string, silent = false) => {
      const article = articles.find((item) => item.id === articleId);
      if (!article) return;
      await translateArticleByRow(article, silent);
    },
    [articles, translateArticleByRow]
  );

  const patchArticle = useCallback(
    (articleId: string, patch: Partial<RssArticle>) => {
      setArticles((current) => {
        let changedArticle: RssArticle | null = null;
        let previousArticle: RssArticle | null = null;
        const next = current.map((article) => {
          if (article.id !== articleId) return article;
          if (!rssArticlePatchChanges(article, patch)) return article;
          previousArticle = article;
          changedArticle = { ...article, ...patch };
          return changedArticle;
        });
        if (!changedArticle) return current;
        if (changedArticle && ('read' in patch || 'starred' in patch || 'later' in patch)) {
          patchArticleStateRow(changedArticle);
          persistArticleStateRows([changedArticle]);
          if (previousArticle) patchArticlePageStatsForStateChange(previousArticle, changedArticle);
        }
        return next;
      });
    },
    [patchArticlePageStatsForStateChange, patchArticleStateRow, persistArticleStateRows]
  );

  const selectArticle = useCallback(
    (articleId: string) => {
      const targetArticle = articles.find((article) => article.id === articleId);
      if (!targetArticle) return;
      readerActiveAtRef.current = Date.now();
      setArticleViewMode(
        hasRssArticleTranslationPayload(targetArticle) ? 'translated' : 'original'
      );
      setSelectedArticleId(articleId);
      if (settings.autoMarkRead && !targetArticle.read) {
        patchArticle(articleId, { read: true });
      }
    },
    [articles, patchArticle, settings.autoMarkRead]
  );

  const applyFetchResult = useCallback(
    async (feedId: string, result: RssFetchResult, options: { replaceFeed?: boolean } = {}) => {
      let didChange = !result.notModified;
      const now = new Date().toISOString();
      const feedForTranslate = feedsRef.current.find((item) => item.id === feedId);
      setFeeds((current) => {
        let changed = false;
        const next = current.map((feed) => {
          if (feed.id !== feedId) return feed;
          const nextFeed = {
            ...feed,
            title: result.notModified ? feed.title : result.feed.title || feed.title,
            url: result.notModified ? feed.url : result.feed.feedUrl || feed.url,
            siteUrl: result.notModified ? feed.siteUrl : result.feed.siteUrl || feed.siteUrl,
            description: result.notModified
              ? feed.description
              : result.feed.description || feed.description,
            lastFetchedAt: result.fetchedAt,
            etag: result.etag || feed.etag || '',
            lastModified: result.lastModified || feed.lastModified || '',
            lastError: '',
            updatedAt: now,
          };
          const feedChanged =
            didChange ||
            nextFeed.title !== feed.title ||
            nextFeed.url !== feed.url ||
            nextFeed.siteUrl !== feed.siteUrl ||
            nextFeed.description !== feed.description ||
            nextFeed.etag !== feed.etag ||
            nextFeed.lastModified !== feed.lastModified ||
            nextFeed.lastError !== feed.lastError;
          didChange = didChange || feedChanged;
          changed = changed || feedChanged;
          return feedChanged ? nextFeed : feed;
        });
        return changed ? next : current;
      });
      if (result.notModified) return didChange;
      const fetchedArticles = result.items.map((item) =>
        rssFetchedItemToArticle(feedId, item, result.fetchedAt, articleStatesRef.current)
      );
      await persistFeedArticles(feedId, fetchedArticles, Boolean(options.replaceFeed));
      const currentKeys = new Set(
        articlesRef.current
          .filter((article) => article.feedId === feedId)
          .map((article) => article.stableId)
      );
      if (feedForTranslate?.translateEnabled) {
        for (const article of fetchedArticles) {
          if (!shouldAutoTranslateArticle(feedForTranslate, article, currentKeys)) continue;
          void translateArticleByRow(article, true);
        }
      }
      if (options.replaceFeed) {
        void reloadArticlePagePreservingSelection();
      } else {
        const inserted = mergeFetchedArticlesIntoCurrentView(
          fetchedArticles,
          {
            query: articlePageQuery,
            feedSources: articlePageQuery.feedSources,
            states: articleStatesRef.current,
            currentArticles: articlesRef.current,
            maxItems: Math.max(articlePageOffsetRef.current, ARTICLE_PAGE_SIZE),
          },
          setArticles,
          setArticlePageStats,
          setArticlePageHasMore
        );
        if (inserted > 0) {
          articlePageOffsetRef.current += inserted;
          articlePageHasMoreRef.current = true;
        }
        if (inserted > 0 && !selectedArticleIdRef.current) {
          setSelectedArticleId((current) => current || articlesRef.current[0]?.id || null);
        }
      }
      return true;
    },
    [
      articlePageQuery,
      persistFeedArticles,
      reloadArticlePagePreservingSelection,
      translateArticleByRow,
    ]
  );

  const refreshFeed = useCallback(
    async (feedId: string, silent = false) => {
      const feed = feedsRef.current.find((item) => item.id === feedId);
      if (!feed || autoRefreshRunningRef.current.has(feedId)) return;
      autoRefreshRunningRef.current.add(feedId);
      if (!silent) {
        setLoading(true);
        setError('');
        setMessage(`正在刷新：${feed.title}`);
      }
      if (!silent) setBusyFeedId(feedId);
      try {
        const result = await fetchFeedResult(feed);
        await applyFetchResult(feedId, result);
        if (!silent) {
          setMessage(
            result.notModified
              ? `${feed.title} 没有新内容。`
              : `已刷新 ${feed.title}，读取 ${result.items.length} 篇文章。`
          );
        }
      } catch (err) {
        const nextError = String(err);
        setFeeds((current) =>
          current.map((item) =>
            item.id === feedId
              ? { ...item, lastError: nextError, updatedAt: new Date().toISOString() }
              : item
          )
        );
        if (!silent) setError(nextError);
      } finally {
        autoRefreshRunningRef.current.delete(feedId);
        if (!silent) setLoading(false);
        if (!silent) setBusyFeedId('');
      }
    },
    [applyFetchResult, fetchFeedResult]
  );

  const refreshAll = useCallback(async () => {
    const enabledFeeds = feeds.filter((feed) => feed.enabled);
    if (!enabledFeeds.length) {
      setMessage('没有可刷新的订阅源。');
      return;
    }
    setLoading(true);
    setError('');
    let success = 0;
    for (const feed of enabledFeeds) {
      setBusyFeedId(feed.id);
      setMessage(`正在刷新 ${success + 1}/${enabledFeeds.length}：${feed.title}`);
      try {
        const result = await fetchFeedResult(feed);
        await applyFetchResult(feed.id, result);
        success += 1;
      } catch (err) {
        const nextError = String(err);
        setFeeds((current) =>
          current.map((item) =>
            item.id === feed.id
              ? { ...item, lastError: nextError, updatedAt: new Date().toISOString() }
              : item
          )
        );
      }
    }
    setBusyFeedId('');
    setLoading(false);
    setMessage(`刷新完成：${success}/${enabledFeeds.length} 个订阅源成功。`);
  }, [applyFetchResult, feeds, fetchFeedResult]);

  const hideReaderToTray = useCallback(async () => {
    setShowReaderSettings(false);
    if (settings.minimizeToTray) {
      await invoke('rss_reader_ensure_tray_icon').catch((err) => {
        const message = String(err);
        setError(`托盘图标初始化失败：${message}`);
        throw err;
      });
      await appWindow.hide();
      return;
    }
    await appWindow.minimize();
  }, [settings.minimizeToTray]);

  const openAddFeedDialog = useCallback(
    (categoryId?: string) => {
      const nextCategory =
        categoryId && categories.some((category) => category.id === categoryId)
          ? categoryId
          : feedCategoryId;
      setFeedDialog({
        mode: 'add',
        sourceType: 'rss',
        title: '',
        url: '',
        siteUrl: '',
        description: '',
        webRule: DEFAULT_RSS_WEB_CRAWL_RULE,
        categoryId: nextCategory,
        refreshMinutes: DEFAULT_RSS_REFRESH_MINUTES,
        enabled: true,
        translateEnabled: false,
      });
      setWebRulePreview(null);
      setError('');
    },
    [categories, feedCategoryId]
  );

  const openEditFeedDialog = useCallback((feed: RssFeed) => {
    setFeedDialog({
      mode: 'edit',
      feedId: feed.id,
      sourceType: feed.sourceType,
      title: feed.title,
      url: feed.url,
      siteUrl: feed.siteUrl,
      description: feed.description,
      webRule: feed.webRule,
      categoryId: feed.categoryId,
      refreshMinutes: clampRefreshMinutes(feed.refreshMinutes),
      enabled: feed.enabled,
      translateEnabled: feed.translateEnabled,
    });
    setWebRulePreview(null);
    setError('');
  }, []);

  const previewWebRule = useCallback(async () => {
    if (!feedDialog || feedDialog.sourceType !== 'web') return;
    const url = normalizeFeedUrl(feedDialog.url);
    const webRule = normalizeDialogWebRule(feedDialog.webRule);
    const webRuleError = validateWebRuleForSubmit(webRule);
    if (!url) {
      setError('请输入网页列表地址。');
      return;
    }
    if (webRuleError) {
      setError(webRuleError);
      return;
    }
    setWebRulePreviewLoading(true);
    setWebRulePreview(null);
    setError('');
    try {
      const result = await invoke<RssFetchResult>('rss_reader_fetch_web_feed', {
        request: {
          url,
          title: feedDialog.title.trim(),
          description: feedDialog.description.trim(),
          siteUrl: feedDialog.siteUrl.trim(),
          rule: webRule,
          previewLimit: 8,
        },
      });
      setWebRulePreview(result);
      setMessage(`网页规则预览成功：抓取 ${result.items.length} 条。`);
    } catch (err) {
      setError(String(err));
    } finally {
      setWebRulePreviewLoading(false);
    }
  }, [feedDialog]);

  const submitFeedDialog = useCallback(async () => {
    if (!feedDialog) return;
    const url = normalizeFeedUrl(feedDialog.url);
    if (!url) {
      setError(
        feedDialog.sourceType === 'web' ? '请输入网页列表地址。' : '请输入 RSS/Atom 订阅源地址。'
      );
      return;
    }
    const title = feedDialog.title.trim();
    const sourceType = feedDialog.sourceType;
    const webRule = normalizeDialogWebRule(feedDialog.webRule);
    const webRuleError = sourceType === 'web' ? validateWebRuleForSubmit(webRule) : '';
    if (webRuleError) {
      setError(webRuleError);
      return;
    }
    const categoryId = categories.some((category) => category.id === feedDialog.categoryId)
      ? feedDialog.categoryId
      : categories[0]?.id || 'other';
    const refreshMinutes = clampRefreshMinutes(feedDialog.refreshMinutes);
    const duplicate = feeds.find(
      (feed) =>
        feed.sourceType === sourceType &&
        canonicalUrl(feed.url) === canonicalUrl(url) &&
        (feedDialog.mode === 'add' || feed.id !== feedDialog.feedId)
    );
    if (duplicate) {
      setSourceFilter({ type: 'feed', id: duplicate.id });
      setSelectedArticleId(null);
      setFeedDialog(null);
      setMessage('订阅源已存在，已切换到对应订阅。');
      return;
    }

    if (feedDialog.mode === 'edit' && feedDialog.feedId) {
      const existing = feeds.find((feed) => feed.id === feedDialog.feedId);
      if (
        existing &&
        existing.sourceType === sourceType &&
        canonicalUrl(existing.url) === canonicalUrl(url)
      ) {
        const now = new Date().toISOString();
        setFeeds((current) =>
          current.map((feed) =>
            feed.id === feedDialog.feedId
              ? {
                  ...feed,
                  sourceType,
                  title: title || feed.title,
                  url,
                  siteUrl: sourceType === 'web' ? feedDialog.siteUrl.trim() : feed.siteUrl,
                  description:
                    sourceType === 'web' ? feedDialog.description.trim() : feed.description,
                  webRule: sourceType === 'web' ? webRule : DEFAULT_RSS_WEB_CRAWL_RULE,
                  categoryId,
                  enabled: feedDialog.enabled,
                  refreshMinutes,
                  translateEnabled: feedDialog.translateEnabled,
                  translateEnabledAt:
                    feedDialog.translateEnabled && !feed.translateEnabled
                      ? now
                      : feed.translateEnabledAt,
                  updatedAt: now,
                }
              : feed
          )
        );
        setFeedCategoryId(categoryId);
        setSourceFilter({ type: 'feed', id: feedDialog.feedId });
        setFeedDialog(null);
        setMessage('订阅源设置已保存。');
        setError('');
        return;
      }
    }

    setLoading(true);
    setError('');
    setMessage(
      feedDialog.mode === 'add'
        ? sourceType === 'web'
          ? '正在测试网页规则...'
          : '正在读取订阅源...'
        : sourceType === 'web'
          ? '正在更新网页规则订阅...'
          : '正在更新订阅源...'
    );
    try {
      const result = await fetchFeedResult({
        sourceType,
        title,
        url,
        siteUrl: feedDialog.siteUrl.trim(),
        description: feedDialog.description.trim(),
        etag: '',
        lastModified: '',
        webRule,
      });
      const now = new Date().toISOString();
      if (feedDialog.mode === 'add') {
        const feedId = uid('feed');
        const nextFeed: RssFeed = {
          id: feedId,
          sourceType,
          title: title || result.feed.title || url,
          url: result.feed.feedUrl || url,
          siteUrl: result.feed.siteUrl || '',
          description: result.feed.description || '',
          webRule: sourceType === 'web' ? webRule : DEFAULT_RSS_WEB_CRAWL_RULE,
          categoryId,
          enabled: feedDialog.enabled,
          refreshMinutes,
          createdAt: now,
          updatedAt: now,
          lastFetchedAt: result.fetchedAt,
          etag: result.etag || '',
          lastModified: result.lastModified || '',
          translateEnabled: feedDialog.translateEnabled,
          translateEnabledAt: feedDialog.translateEnabled ? now : '',
          lastError: '',
        };
        setFeeds((current) => [...current, nextFeed]);
        const next = result.items.map((item) =>
          rssFetchedItemToArticle(feedId, item, result.fetchedAt, articleStatesRef.current)
        );
        void persistFeedArticles(feedId, next, true);
        setFeedCategoryId(categoryId);
        setSourceFilter({ type: 'feed', id: feedId });
        setArticles([]);
        setArticlesLoaded(false);
        window.setTimeout(() => void loadArticlePage(true), 0);
        setMessage(
          feedDialog.translateEnabled
            ? `已添加 ${nextFeed.title}，读取 ${result.items.length} 篇文章；自动翻译将从后续新增文章开始。`
            : `已添加 ${nextFeed.title}，读取 ${result.items.length} 篇文章。`
        );
      } else if (feedDialog.feedId) {
        const feedId = feedDialog.feedId;
        const existing = feeds.find((feed) => feed.id === feedId);
        const replacingFeed = existing
          ? existing.sourceType !== sourceType || canonicalUrl(existing.url) !== canonicalUrl(url)
          : true;
        const translateFeed =
          existing && feedDialog.translateEnabled
            ? {
                ...existing,
                id: feedId,
                translateEnabled: true,
                translateEnabledAt:
                  feedDialog.translateEnabled && !existing.translateEnabled
                    ? now
                    : existing.translateEnabledAt || now,
              }
            : undefined;
        setFeeds((current) =>
          current.map((feed) =>
            feed.id === feedId
              ? {
                  ...feed,
                  sourceType,
                  title: title || result.feed.title || feed.title,
                  url: result.feed.feedUrl || url,
                  siteUrl: result.feed.siteUrl || feed.siteUrl,
                  description: result.feed.description || feed.description,
                  webRule: sourceType === 'web' ? webRule : DEFAULT_RSS_WEB_CRAWL_RULE,
                  categoryId,
                  enabled: feedDialog.enabled,
                  refreshMinutes,
                  lastFetchedAt: result.fetchedAt,
                  etag: result.etag || '',
                  lastModified: result.lastModified || '',
                  translateEnabled: feedDialog.translateEnabled,
                  translateEnabledAt:
                    feedDialog.translateEnabled && !feed.translateEnabled
                      ? now
                      : feedDialog.translateEnabled
                        ? feed.translateEnabledAt || now
                        : '',
                  lastError: '',
                  updatedAt: now,
                }
              : feed
          )
        );
        const currentKeys = new Set(
          articles.filter((article) => article.feedId === feedId).map((article) => article.stableId)
        );
        const next = result.items.map((item) =>
          rssFetchedItemToArticle(feedId, item, result.fetchedAt, articleStatesRef.current)
        );
        await persistFeedArticles(feedId, next, replacingFeed);
        if (translateFeed && !replacingFeed) {
          for (const article of next) {
            if (!shouldAutoTranslateArticle(translateFeed, article, currentKeys)) continue;
            void translateArticleByRow(article, true);
          }
        }
        setFeedCategoryId(categoryId);
        setSourceFilter({ type: 'feed', id: feedId });
        setArticles([]);
        setArticlesLoaded(false);
        window.setTimeout(() => void loadArticlePage(true), 0);
        setMessage(`已更新订阅源，读取 ${result.items.length} 篇文章。`);
      }
      setFeedDialog(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setBusyFeedId('');
    }
  }, [
    categories,
    feedDialog,
    feeds,
    fetchFeedResult,
    articles,
    loadArticlePage,
    persistFeedArticles,
    translateArticleByRow,
  ]);

  const createCategory = useCallback(() => {
    const value = window.prompt('新增分类名称');
    if (value === null) return;
    const name = value.trim();
    if (!name) return;
    const duplicate = categories.find((category) => category.name === name);
    if (duplicate) {
      setFeedCategoryId(duplicate.id);
      setSourceFilter({ type: 'category', id: duplicate.id });
      setMessage(`分类「${name}」已存在。`);
      return;
    }
    const category: RssCategory = {
      id: uid('category'),
      name,
      color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length],
    };
    setCategories((current) => [...current, category]);
    setFeedCategoryId(category.id);
    setSourceFilter({ type: 'category', id: category.id });
    setMessage(`已新增分类「${category.name}」。`);
    setError('');
  }, [categories]);

  const openCategoryMenu = useCallback((event: ReactMouseEvent, categoryId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    setFeedMenu(null);
    setCategoryMenu({
      categoryId,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 230)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 300)),
    });
  }, []);

  const openFeedMenu = useCallback((event: ReactMouseEvent, feedId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setCategoryMenu(null);
    setKeywordMenu(null);
    setFeedMenu({
      feedId,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 230)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 300)),
    });
  }, []);

  const openKeywordMenu = useCallback((event: ReactMouseEvent, keywordId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    setCategoryMenu(null);
    setFeedMenu(null);
    setKeywordMenu({
      keywordId,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 230)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 300)),
    });
  }, []);

  const renameCategory = useCallback(
    (categoryId: string) => {
      const category = categoryById[categoryId];
      if (!category) return;
      const value = window.prompt('重命名分类', category.name);
      if (value === null) return;
      const name = value.trim();
      if (!name) return;
      const duplicate = categories.some((item) => item.id !== categoryId && item.name === name);
      if (duplicate) {
        setError('分类名称已存在。');
        return;
      }
      setCategories((current) =>
        current.map((item) => (item.id === categoryId ? { ...item, name } : item))
      );
      setMessage(`已重命名分类为「${name}」。`);
      setError('');
    },
    [categories, categoryById]
  );

  const openAddKeywordDialog = useCallback(() => {
    setKeywordDialog({
      mode: 'add',
      name: '',
      keywordsText: '',
      scopes: ['title', 'summary', 'content'],
      matchMode: 'any',
      caseSensitive: false,
      enabled: true,
      color: CATEGORY_COLORS[keywordSubscriptions.length % CATEGORY_COLORS.length],
    });
    setError('');
  }, [keywordSubscriptions.length]);

  const openEditKeywordDialog = useCallback((keyword: RssKeywordSubscription) => {
    setKeywordDialog({
      mode: 'edit',
      keywordId: keyword.id,
      name: keyword.name,
      keywordsText: keyword.keywords.join('\n'),
      scopes: keyword.scopes,
      matchMode: keyword.matchMode,
      caseSensitive: keyword.caseSensitive,
      enabled: keyword.enabled,
      color: keyword.color,
    });
    setError('');
  }, []);

  const submitKeywordDialog = useCallback(() => {
    if (!keywordDialog) return;
    const keywords = parseKeywordList(keywordDialog.keywordsText);
    if (!keywords.length) {
      setError('请输入至少一个关键词。');
      return;
    }
    const scopes: RssKeywordScope[] = keywordDialog.scopes.length
      ? keywordDialog.scopes
      : ['title'];
    const now = new Date().toISOString();
    const name = keywordDialog.name.trim() || keywords.join(' / ');
    if (keywordDialog.mode === 'edit' && keywordDialog.keywordId) {
      setKeywordSubscriptions((current) =>
        current.map((item) =>
          item.id === keywordDialog.keywordId
            ? {
                ...item,
                name,
                keywords,
                scopes,
                matchMode: keywordDialog.matchMode,
                caseSensitive: keywordDialog.caseSensitive,
                enabled: keywordDialog.enabled,
                color: keywordDialog.color,
                updatedAt: now,
              }
            : item
        )
      );
      setSourceFilter({ type: 'keyword', id: keywordDialog.keywordId });
      setMessage(`关键词订阅「${name}」已保存。`);
    } else {
      const keyword: RssKeywordSubscription = {
        id: uid('keyword'),
        name,
        keywords,
        scopes,
        matchMode: keywordDialog.matchMode,
        caseSensitive: keywordDialog.caseSensitive,
        enabled: keywordDialog.enabled,
        color: keywordDialog.color,
        createdAt: now,
        updatedAt: now,
      };
      setKeywordSubscriptions((current) => [...current, keyword]);
      setSourceFilter({ type: 'keyword', id: keyword.id });
      setMessage(`已新增关键词订阅「${name}」。`);
    }
    setKeywordDialog(null);
    setError('');
  }, [keywordDialog]);

  const toggleKeywordEnabled = useCallback((keywordId: string) => {
    setKeywordSubscriptions((current) =>
      current.map((item) =>
        item.id === keywordId
          ? { ...item, enabled: !item.enabled, updatedAt: new Date().toISOString() }
          : item
      )
    );
  }, []);

  const deleteKeywordSubscription = useCallback(
    (keywordId: string) => {
      const keyword = keywordSubscriptions.find((item) => item.id === keywordId);
      if (!keyword) return;
      if (!window.confirm(`删除关键词订阅「${keyword.name}」？`)) return;
      setKeywordSubscriptions((current) => current.filter((item) => item.id !== keywordId));
      if (sourceFilter.type === 'keyword' && sourceFilter.id === keywordId) {
        setSourceFilter({ type: 'all', id: 'all' });
      }
      setMessage(`已删除关键词订阅「${keyword.name}」。`);
      setError('');
    },
    [keywordSubscriptions, sourceFilter]
  );

  const moveKeywordSubscription = useCallback((keywordId: string, direction: -1 | 1) => {
    setKeywordSubscriptions((current) => {
      const index = current.findIndex((item) => item.id === keywordId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  }, []);

  const updateCategoryColor = useCallback((categoryId: string, color: string) => {
    setCategories((current) =>
      current.map((category) => (category.id === categoryId ? { ...category, color } : category))
    );
  }, []);

  const moveCategory = useCallback(
    (categoryId: string, direction: -1 | 1) => {
      setCategories((current) => {
        const index = current.findIndex((category) => category.id === categoryId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
        const next = [...current];
        [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
        categoriesSnapshotRef.current = categorySnapshot(next);
        persistStore(next);
        return next;
      });
    },
    [persistStore]
  );

  const moveCategoryBefore = useCallback(
    (draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;
      setCategories((current) => {
        const draggedIndex = current.findIndex((category) => category.id === draggedId);
        const targetIndex = current.findIndex((category) => category.id === targetId);
        if (draggedIndex < 0 || targetIndex < 0) return current;
        const next = [...current];
        const [dragged] = next.splice(draggedIndex, 1);
        const nextTargetIndex = next.findIndex((category) => category.id === targetId);
        next.splice(Math.max(0, nextTargetIndex), 0, dragged);
        categoriesSnapshotRef.current = categorySnapshot(next);
        persistStore(next);
        return next;
      });
    },
    [persistStore]
  );

  const setCategoryDragOver = useCallback((categoryId: string | null) => {
    dragOverCategoryRef.current = categoryId;
    setDragOverCategoryId((current) => (current === categoryId ? current : categoryId));
  }, []);

  const clearCategoryPointerDrag = useCallback(() => {
    categoryDragRef.current = null;
    setDraggingCategoryId(null);
    setCategoryDragOver(null);
  }, [setCategoryDragOver]);

  const handleCategoryPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, categoryId: string) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      categoryDragRef.current = {
        id: categoryId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
      setCategoryDragOver(null);
    },
    [setCategoryDragOver]
  );

  const handleCategoryPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = categoryDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!drag.active) {
        if (distance < 6) return;
        drag.active = true;
        setDraggingCategoryId(drag.id);
      }
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-rss-category-id]') as HTMLElement | null;
      const targetId = target?.dataset.rssCategoryId || null;
      setCategoryDragOver(targetId && targetId !== drag.id ? targetId : null);
    },
    [setCategoryDragOver]
  );

  const handleCategoryPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = categoryDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const targetId = dragOverCategoryRef.current;
      if (drag.active && targetId && targetId !== drag.id) {
        moveCategoryBefore(drag.id, targetId);
      }
      clearCategoryPointerDrag();
    },
    [clearCategoryPointerDrag, moveCategoryBefore]
  );

  const handleCategoryPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = categoryDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      clearCategoryPointerDrag();
    },
    [clearCategoryPointerDrag]
  );

  const toggleCategoryCollapsed = useCallback((categoryId: string) => {
    setCollapsedCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((item) => item !== categoryId)
        : [...current, categoryId]
    );
  }, []);

  const deleteCategory = useCallback(
    (categoryId: string) => {
      if (categories.length <= 1) {
        setError('至少需要保留一个分类。');
        return;
      }
      const category = categoryById[categoryId];
      if (!category) return;
      const fallback =
        categories.find((item) => item.id !== categoryId && item.id === 'other') ||
        categories.find((item) => item.id !== categoryId);
      if (!fallback) return;
      const feedCount = feeds.filter((feed) => feed.categoryId === categoryId).length;
      const confirmText = feedCount
        ? `删除分类「${category.name}」？该分类下 ${feedCount} 个订阅源会移动到「${fallback.name}」。`
        : `删除分类「${category.name}」？`;
      if (!window.confirm(confirmText)) return;
      setCategories((current) => current.filter((item) => item.id !== categoryId));
      setFeeds((current) =>
        current.map((feed) =>
          feed.categoryId === categoryId
            ? { ...feed, categoryId: fallback.id, updatedAt: new Date().toISOString() }
            : feed
        )
      );
      if (feedCategoryId === categoryId) setFeedCategoryId(fallback.id);
      if (sourceFilter.type === 'category' && sourceFilter.id === categoryId) {
        setSourceFilter({ type: 'category', id: fallback.id });
      }
      setMessage(`已删除分类「${category.name}」，订阅源已移动到「${fallback.name}」。`);
    },
    [categories, categoryById, feedCategoryId, feeds, sourceFilter]
  );

  const setCustomCategoryColor = useCallback(
    (categoryId: string) => {
      const category = categoryById[categoryId];
      if (!category) return;
      const value = window.prompt('输入 HEX 颜色，例如 #2563eb', category.color);
      if (value === null) return;
      const color = normalizeHexColor(value);
      if (!color) {
        setError('颜色格式不正确，请输入 #RRGGBB。');
        return;
      }
      updateCategoryColor(categoryId, color);
      setError('');
    },
    [categoryById, updateCategoryColor]
  );

  const deleteFeed = useCallback(
    (feedId: string) => {
      const feed = feedById[feedId];
      if (!feed) return;
      if (!window.confirm(`删除订阅源「${feed.title}」及其阅读状态？`)) return;
      const removingStableIds = new Set(
        articles.filter((article) => article.feedId === feedId).map((article) => article.stableId)
      );
      setFeeds((current) => current.filter((item) => item.id !== feedId));
      setArticles([]);
      setArticlesLoaded(false);
      setSelectedArticleId(null);
      setArticleStates((current) => {
        const next = current.filter((state) =>
          state.feedId ? state.feedId !== feedId : !removingStableIds.has(state.stableId)
        );
        articleStatesRef.current = next;
        return next;
      });
      void invoke('rss_reader_delete_feed_articles', {
        request: { feedId },
      }).catch((err) => setError(String(err)));
      if (sourceFilter.type === 'feed' && sourceFilter.id === feedId) {
        setSourceFilter({ type: 'all', id: 'all' });
      }
      void loadArticlePage(true);
    },
    [articles, feedById, loadArticlePage, sourceFilter]
  );

  const toggleFeedEnabled = useCallback((feedId: string) => {
    setFeeds((current) =>
      current.map((feed) =>
        feed.id === feedId
          ? { ...feed, enabled: !feed.enabled, updatedAt: new Date().toISOString() }
          : feed
      )
    );
  }, []);

  const moveFeedToCategory = useCallback(
    (feedId: string) => {
      const feed = feedById[feedId];
      if (!feed) return;
      const choices = categories
        .map((category, index) => `${index + 1}. ${category.name}`)
        .join('\n');
      const value = window.prompt(`移动「${feed.title}」到分类：\n${choices}`, '1');
      if (value === null) return;
      const index = Number(value.trim()) - 1;
      const category = categories[index];
      if (!category) {
        setError('分类序号无效。');
        return;
      }
      setFeeds((current) =>
        current.map((item) =>
          item.id === feedId
            ? { ...item, categoryId: category.id, updatedAt: new Date().toISOString() }
            : item
        )
      );
      setMessage(`已将「${feed.title}」移动到「${category.name}」。`);
      setError('');
    },
    [categories, feedById]
  );

  const copyFeedUrl = useCallback(
    async (feedId: string) => {
      const feed = feedById[feedId];
      if (!feed) return;
      await navigator.clipboard.writeText(feed.url);
      setMessage('已复制订阅源地址。');
    },
    [feedById]
  );

  const markVisibleRead = useCallback(() => {
    setArticles((current) => {
      const changed: RssArticle[] = [];
      const next = current.map((article) => {
        if (!visibleIds.has(article.id) || article.read) return article;
        const nextArticle = { ...article, read: true };
        changed.push(nextArticle);
        patchArticlePageStatsForStateChange(article, nextArticle);
        return nextArticle;
      });
      syncArticleStates(next);
      persistArticleStateRows(changed);
      return next;
    });
  }, [patchArticlePageStatsForStateChange, persistArticleStateRows, syncArticleStates, visibleIds]);

  const clearReadArticles = useCallback(() => {
    if (!window.confirm('清理当前视图中已读且未收藏、未稍后读的文章？')) return;
    setArticles((current) => {
      const removed = current.filter(
        (article) =>
          visibleIds.has(article.id) && article.read && !article.starred && !article.later
      );
      deleteArticleRows(removed);
      if (removed.length) void loadArticlePage(true);
      return current.filter(
        (article) =>
          !visibleIds.has(article.id) || !article.read || article.starred || article.later
      );
    });
  }, [deleteArticleRows, loadArticlePage, visibleIds]);

  const importOpmlFile = useCallback(
    async (file: File) => {
      try {
        const incoming = parseOpml(await file.text(), categories);
        const now = new Date().toISOString();
        let added = 0;
        const categoryByName = new Map(categories.map((category) => [category.name, category]));
        const categoryByIdMap = new Map(categories.map((category) => [category.id, category]));
        const nextCategories = [...categories];
        const ensureCategory = (item: (typeof incoming)[number]) => {
          if (categoryByIdMap.has(item.categoryId)) return item.categoryId;
          const name = item.categoryName.trim();
          if (!name) return 'other';
          const existing = categoryByName.get(name);
          if (existing) return existing.id;
          const category: RssCategory = {
            id: uid('category'),
            name,
            color: '#64748b',
          };
          nextCategories.push(category);
          categoryByName.set(name, category);
          categoryByIdMap.set(category.id, category);
          return category.id;
        };
        setFeeds((current) => {
          const seen = new Set(current.map((feed) => canonicalUrl(feed.url)));
          const next = [...current];
          for (const item of incoming) {
            if (seen.has(canonicalUrl(item.url))) continue;
            seen.add(canonicalUrl(item.url));
            next.push({
              id: uid('feed'),
              sourceType: 'rss',
              title: item.title,
              url: item.url,
              siteUrl: item.siteUrl,
              description: '',
              webRule: DEFAULT_RSS_WEB_CRAWL_RULE,
              categoryId: ensureCategory(item),
              enabled: true,
              refreshMinutes: DEFAULT_RSS_REFRESH_MINUTES,
              createdAt: now,
              updatedAt: now,
              lastFetchedAt: '',
              etag: '',
              lastModified: '',
              translateEnabled: false,
              translateEnabledAt: '',
              lastError: '',
            });
            added += 1;
          }
          return next;
        });
        if (nextCategories.length !== categories.length) {
          setCategories(nextCategories);
        }
        setMessage(`OPML 导入完成：新增 ${added} 个订阅源。`);
        setError('');
      } catch (err) {
        setError(String(err));
      }
    },
    [categories]
  );

  const exportSubscriptions = useCallback(() => {
    downloadText(
      `rss-reader-${Date.now()}.opml`,
      exportOpml(feeds, categories),
      'text/xml;charset=utf-8'
    );
  }, [categories, feeds]);

  const openArticle = useCallback((article: RssArticle | null) => {
    if (!article?.link) return;
    void openExternal(article.link);
  }, []);

  const handleArticleContentClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const link = target?.closest('a');
    if (!(link instanceof HTMLAnchorElement) || !link.href) return;
    event.preventDefault();
    void openExternal(link.href);
  }, []);

  const currentSourceTitle = useMemo(() => {
    if (sourceFilter.type === 'feed') return feedById[sourceFilter.id]?.title || '订阅源';
    if (sourceFilter.type === 'category') return categoryById[sourceFilter.id]?.name || '分类';
    if (sourceFilter.type === 'keyword') {
      return keywordSubscriptions.find((item) => item.id === sourceFilter.id)?.name || '关键词订阅';
    }
    return '全部订阅';
  }, [categoryById, feedById, keywordSubscriptions, sourceFilter]);

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="📰"
        title="RSS 阅读器"
        subtitle={`${feeds.length} 个订阅源 · ${counts.allUnread} 未读 · ${counts.allTotal} 篇文章`}
        actions={
          <>
            <ToolbarButton
              onClick={() =>
                openAddFeedDialog(sourceFilter.type === 'category' ? sourceFilter.id : undefined)
              }
              disabled={!storeLoaded}
            >
              <Plus size={14} />
              添加订阅
            </ToolbarButton>
            <ToolbarButton onClick={() => void refreshAll()} disabled={loading || !feeds.length}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              刷新全部
            </ToolbarButton>
            <ToolbarButton onClick={exportSubscriptions} disabled={!feeds.length}>
              <Download size={14} />
              导出 OPML
            </ToolbarButton>
            <ToolbarButton onClick={() => setShowReaderSettings(true)}>
              <Settings2 size={14} />
              设置
            </ToolbarButton>
            <ToolbarButton onClick={() => void hideReaderToTray()}>
              <Minimize2 size={14} />
              最小化
            </ToolbarButton>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[310px_minmax(380px,1fr)_430px] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-200 p-3 dark:border-gray-800">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button
                onClick={() =>
                  openAddFeedDialog(sourceFilter.type === 'category' ? sourceFilter.id : undefined)
                }
                disabled={!storeLoaded}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <Plus size={16} />
                添加订阅源
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                title="导入 OPML"
              >
                <FileUp size={14} />
                OPML
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".opml,.xml,text/xml"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importOpmlFile(file);
                event.currentTarget.value = '';
              }}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <button
              onClick={() => setSourceFilter({ type: 'all', id: 'all' })}
              className={`mb-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                sourceFilter.type === 'all'
                  ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:ring-blue-800'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Inbox size={16} />
                全部订阅
              </span>
              <span className="text-xs text-gray-400">{counts.unread}</span>
            </button>

            <div
              className="mt-4 space-y-1"
              onContextMenu={(event) => openCategoryMenu(event, null)}
            >
              <div className="flex items-center justify-between px-1 text-xs font-semibold text-gray-500">
                <span className="inline-flex items-center gap-1.5">
                  <FolderPlus size={14} />
                  订阅树
                </span>
                <span>
                  {categories.length} / {feeds.length}
                </span>
              </div>
              {categories.map((category) => {
                const categoryFeeds = feedsByCategory[category.id] || [];
                const collapsed = collapsedCategoryIds.includes(category.id);
                return (
                  <div
                    key={category.id}
                    data-rss-category-id={category.id}
                    className={`space-y-1 rounded-lg ${
                      dragOverCategoryId === category.id && draggingCategoryId !== category.id
                        ? 'ring-2 ring-blue-400 ring-offset-1 dark:ring-blue-700 dark:ring-offset-gray-900'
                        : ''
                    } ${draggingCategoryId === category.id ? 'opacity-60' : ''}`}
                  >
                    <div
                      onContextMenu={(event) => {
                        setSourceFilter({ type: 'category', id: category.id });
                        openCategoryMenu(event, category.id);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                        sourceFilter.type === 'category' && sourceFilter.id === category.id
                          ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:ring-blue-800'
                          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`拖拽排序 ${category.name}`}
                        className="mr-1 inline-flex h-5 w-4 flex-shrink-0 cursor-grab touch-none select-none items-center justify-center text-gray-300 active:cursor-grabbing dark:text-gray-600"
                        title="拖拽排序"
                        onPointerDown={(event) => handleCategoryPointerDown(event, category.id)}
                        onPointerMove={handleCategoryPointerMove}
                        onPointerUp={handleCategoryPointerUp}
                        onPointerCancel={handleCategoryPointerCancel}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                      >
                        <GripVertical size={14} />
                      </span>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleCategoryCollapsed(category.id);
                        }}
                        className="mr-1 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-white/70 dark:hover:bg-gray-900"
                        title={collapsed ? '展开分类' : '收起分类'}
                      >
                        <ChevronRight
                          size={14}
                          className={`transition-transform ${collapsed ? '' : 'rotate-90'}`}
                        />
                      </button>
                      <button
                        onClick={() => setSourceFilter({ type: 'category', id: category.id })}
                        className="inline-flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: category.color }}
                        />
                        <span className="truncate">{category.name}</span>
                        <span className="text-[11px] text-gray-400">{categoryFeeds.length}</span>
                      </button>
                      <span className="ml-2 flex-shrink-0 text-xs text-gray-400">
                        {counts.byCategory[category.id]?.unread || 0}
                      </span>
                    </div>
                    {!collapsed && categoryFeeds.length ? (
                      <div className="space-y-1 pl-5">
                        {categoryFeeds.map((feed) => (
                          <div
                            key={feed.id}
                            onClick={() => setSourceFilter({ type: 'feed', id: feed.id })}
                            onContextMenu={(event) => {
                              setSourceFilter({ type: 'feed', id: feed.id });
                              openFeedMenu(event, feed.id);
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                              sourceFilter.type === 'feed' && sourceFilter.id === feed.id
                                ? 'bg-white text-blue-700 ring-1 ring-blue-200 dark:bg-gray-900 dark:text-blue-200 dark:ring-blue-800'
                                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                            }`}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSourceFilter({ type: 'feed', id: feed.id });
                              }
                            }}
                          >
                            <span className="inline-flex min-w-0 items-center gap-2">
                              {feed.sourceType === 'web' ? (
                                <Globe2
                                  size={13}
                                  className={feed.enabled ? 'text-gray-400' : 'text-gray-300'}
                                />
                              ) : (
                                <Rss
                                  size={13}
                                  className={feed.enabled ? 'text-gray-400' : 'text-gray-300'}
                                />
                              )}
                              <span className={feed.enabled ? 'truncate' : 'truncate opacity-60'}>
                                {feed.title}
                              </span>
                              {feed.lastError && (
                                <span className="flex-shrink-0 text-[10px] text-red-500">异常</span>
                              )}
                            </span>
                            <span className="inline-flex flex-shrink-0 items-center gap-1 text-[11px] text-gray-400">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void refreshFeed(feed.id);
                                }}
                                disabled={loading}
                                className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-gray-200 disabled:opacity-50 dark:hover:bg-gray-700"
                                title="刷新订阅源"
                              >
                                {busyFeedId === feed.id ? (
                                  <Loader2 size={11} className="animate-spin" />
                                ) : (
                                  <RefreshCw size={11} />
                                )}
                              </button>
                              {counts.byFeed[feed.id]?.unread || 0}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-5 space-y-1" onContextMenu={(event) => openKeywordMenu(event, null)}>
              <div className="flex items-center justify-between px-1 text-xs font-semibold text-gray-500">
                <span className="inline-flex items-center gap-1.5">
                  <Hash size={14} />
                  关键词订阅
                </span>
                <button
                  onClick={openAddKeywordDialog}
                  className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                  title="新增关键词订阅"
                >
                  <Plus size={13} />
                </button>
              </div>
              {keywordSubscriptions.length ? (
                keywordSubscriptions.map((keyword) => (
                  <div
                    key={keyword.id}
                    onClick={() => setSourceFilter({ type: 'keyword', id: keyword.id })}
                    onContextMenu={(event) => {
                      setSourceFilter({ type: 'keyword', id: keyword.id });
                      openKeywordMenu(event, keyword.id);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                      sourceFilter.type === 'keyword' && sourceFilter.id === keyword.id
                        ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:ring-blue-800'
                        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSourceFilter({ type: 'keyword', id: keyword.id });
                      }
                    }}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: keyword.color }}
                      />
                      <span className={keyword.enabled ? 'truncate' : 'truncate opacity-50'}>
                        {keyword.name}
                      </span>
                      {!keyword.enabled && (
                        <span className="flex-shrink-0 text-[10px] text-gray-400">停用</span>
                      )}
                    </span>
                    <span className="ml-2 flex-shrink-0 text-xs text-gray-400">
                      {counts.byKeyword[keyword.id]?.unread || 0}
                    </span>
                  </div>
                ))
              ) : (
                <button
                  onClick={openAddKeywordDialog}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <Plus size={13} />
                  新增关注关键词
                </button>
              )}
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 flex-col border-r border-gray-200 dark:border-gray-800">
          <div className="border-b border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
                {VIEW_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setView(tab.key);
                      setSettings((current) => ({ ...current, defaultView: tab.key }));
                    }}
                    className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                      view === tab.key
                        ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-300'
                        : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="relative min-w-[220px] flex-1">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索标题、作者、正文..."
                  className={`${CONTROL_CLASS} w-full pl-9`}
                />
              </div>
              <ToolbarButton onClick={markVisibleRead} disabled={!visibleArticles.length}>
                <CheckCircle2 size={14} />
                标记已读
              </ToolbarButton>
              <ToolbarButton onClick={clearReadArticles} disabled={!visibleArticles.length}>
                <Trash2 size={14} />
                清理已读
              </ToolbarButton>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <span>
                {currentSourceTitle} · {articlePageStats.total} 篇
              </span>
              <span>
                收藏 {counts.starred} · 稍后读 {counts.later}
              </span>
            </div>
          </div>

          <StatusMessage message={message} error={error} />

          <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
            {!articlesLoaded ? (
              <EmptyState
                icon={<Loader2 size={36} className="animate-spin" />}
                text="正在加载文章缓存"
              />
            ) : visibleArticles.length ? (
              <>
                {renderedArticles.map((article) => {
                  const feed = feedById[article.feedId];
                  const active = article.id === selectedArticleId;
                  const articleListTitle = article.translatedTitle.trim() || article.title;
                  const articleListSummary =
                    article.translatedSummary.trim() ||
                    article.translatedContent.trim() ||
                    article.summary ||
                    article.content ||
                    stripHtmlForSearch(article.translatedHtml).trim() ||
                    '无摘要';
                  return (
                    <button
                      key={article.id}
                      onClick={() => selectArticle(article.id)}
                      className={`block w-full border-b px-4 py-3 text-left transition-colors ${
                        active
                          ? 'border-blue-200 bg-blue-50 ring-1 ring-inset ring-blue-300 dark:border-blue-900 dark:bg-blue-950/40 dark:ring-blue-800'
                          : article.read
                            ? 'border-gray-100 bg-gray-50/70 opacity-75 hover:bg-gray-100 dark:border-gray-900 dark:bg-gray-950/80 dark:hover:bg-gray-900'
                            : 'border-gray-200 bg-white hover:bg-blue-50/60 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-1">
                          {article.read ? (
                            <Circle size={9} className="text-gray-300 dark:text-gray-700" />
                          ) : (
                            <span className="block h-3 w-3 rounded-full bg-blue-600 shadow-sm shadow-blue-200 dark:bg-blue-400 dark:shadow-blue-900" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`line-clamp-2 text-sm font-semibold ${
                              article.read
                                ? 'text-gray-500 dark:text-gray-500'
                                : 'text-gray-950 dark:text-gray-50'
                            }`}
                          >
                            {articleListTitle}
                          </span>
                          <span
                            className={`mt-1 line-clamp-2 text-xs leading-5 ${
                              article.read
                                ? 'text-gray-400 dark:text-gray-600'
                                : 'text-gray-600 dark:text-gray-300'
                            }`}
                          >
                            {articleListSummary}
                          </span>
                          <span className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                            <span className="truncate">{feed?.title || '未知订阅源'}</span>
                            <span>·</span>
                            <span>{formatDateTime(articleTime(article))}</span>
                            {article.author && (
                              <>
                                <span>·</span>
                                <span className="truncate">{article.author}</span>
                              </>
                            )}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          {article.starred && (
                            <Star size={14} className="fill-amber-400 text-amber-400" />
                          )}
                          {article.later && <Clock3 size={14} className="text-emerald-500" />}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {visibleArticles.length > renderedArticles.length && (
                  <div className="border-b border-gray-200 bg-white p-3 text-center dark:border-gray-800 dark:bg-gray-950">
                    <button
                      onClick={() => {
                        setVisibleArticleLimit((current) => current + ARTICLE_RENDER_STEP);
                        if (articlePageHasMore) void loadArticlePage(false);
                      }}
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      加载更多{' '}
                      {Math.min(
                        ARTICLE_RENDER_STEP,
                        visibleArticles.length - renderedArticles.length
                      )}{' '}
                      篇
                    </button>
                  </div>
                )}
                {visibleArticles.length <= renderedArticles.length && articlePageHasMore && (
                  <div className="border-b border-gray-200 bg-white p-3 text-center dark:border-gray-800 dark:bg-gray-950">
                    <button
                      onClick={() => void loadArticlePage(false)}
                      disabled={loadingMoreArticles}
                      className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      {loadingMoreArticles && <Loader2 size={13} className="animate-spin" />}
                      {loadingMoreArticles ? '正在预加载...' : '加载更早文章'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <EmptyState icon={<BookOpen size={36} />} text="没有找到文章" />
            )}
          </div>
        </main>

        <section className="flex min-h-0 flex-col bg-white dark:bg-gray-900">
          {selectedArticle ? (
            <>
              <div className="border-b border-gray-200 p-4 dark:border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mb-2 text-xs font-medium text-blue-600 dark:text-blue-300">
                      {selectedFeed?.title || '未知订阅源'}
                    </p>
                    <h2 className="text-lg font-semibold leading-7 text-gray-950 dark:text-gray-50">
                      {selectedArticleTitle}
                    </h2>
                    <p className="mt-2 text-xs text-gray-500">
                      {formatFullDateTime(articleTime(selectedArticle))}
                      {selectedArticle.author ? ` · ${selectedArticle.author}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => openArticle(selectedArticle)}
                    disabled={!selectedArticle.link}
                    className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    title="在浏览器打开"
                  >
                    <ExternalLink size={16} />
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ToolbarButton
                    onClick={() =>
                      patchArticle(selectedArticle.id, { read: !selectedArticle.read })
                    }
                  >
                    {selectedArticle.read ? <Circle size={14} /> : <CheckCircle2 size={14} />}
                    {selectedArticle.read ? '标记未读' : '标记已读'}
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() =>
                      patchArticle(selectedArticle.id, { starred: !selectedArticle.starred })
                    }
                  >
                    <Star
                      size={14}
                      className={selectedArticle.starred ? 'fill-amber-400 text-amber-400' : ''}
                    />
                    收藏
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() =>
                      patchArticle(selectedArticle.id, { later: !selectedArticle.later })
                    }
                  >
                    <Clock3 size={14} />
                    稍后读
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => void translateArticle(selectedArticle.id)}
                    disabled={translatingArticleId === selectedArticle.id}
                  >
                    {translatingArticleId === selectedArticle.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Languages size={14} />
                    )}
                    翻译
                  </ToolbarButton>
                  {selectedArticleHasTranslation && (
                    <div className="inline-flex h-9 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs dark:border-gray-700 dark:bg-gray-950">
                      <button
                        onClick={() => setArticleViewMode('translated')}
                        className={`rounded-md px-3 font-medium transition-colors ${
                          selectedArticleDisplayMode === 'translated'
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                        }`}
                      >
                        译文
                      </button>
                      <button
                        onClick={() => setArticleViewMode('original')}
                        className={`rounded-md px-3 font-medium transition-colors ${
                          selectedArticleDisplayMode === 'original'
                            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100'
                            : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                        }`}
                      >
                        原文
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div
                ref={articleContentScrollRef}
                onScroll={() => {
                  readerActiveAtRef.current = Date.now();
                }}
                className="min-h-0 flex-1 overflow-y-auto p-5"
              >
                {selectedArticle.translationError && (
                  <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                    {selectedArticle.translationError}
                  </div>
                )}
                {showArticleDetailLoading && (
                  <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-600 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                    <Loader2 size={15} className="animate-spin" />
                    正在加载完整正文...
                  </div>
                )}
                {selectedArticleDisplayMode === 'translated' && selectedArticle.translatedAt && (
                  <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-blue-600 dark:text-blue-300">
                    <Languages size={14} />
                    <span>
                      {translateProviderName(selectedArticle.translatedProvider)} ·{' '}
                      {formatDateTime(selectedArticle.translatedAt)}
                    </span>
                  </div>
                )}
                <article
                  className="rss-reader-content text-sm leading-7 text-gray-700 dark:text-gray-200"
                  onClick={handleArticleContentClick}
                  dangerouslySetInnerHTML={{ __html: selectedArticleHtml }}
                />
                {selectedArticle.link && (
                  <button
                    onClick={() => openArticle(selectedArticle)}
                    className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-500"
                  >
                    <ExternalLink size={15} />
                    打开原文
                  </button>
                )}
              </div>
            </>
          ) : (
            <EmptyState icon={<Rss size={38} />} text="选择一篇文章开始阅读" />
          )}
        </section>
      </div>

      {showReaderSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowReaderSettings(false);
          }}
        >
          <div className="w-full max-w-xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  <Settings2 size={16} />
                  RSS 设置
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  阅读、更新和常驻行为在这里统一管理
                </div>
              </div>
              <button
                onClick={() => setShowReaderSettings(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  阅读
                </div>
                <div className="grid gap-3">
                  <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={settings.autoMarkRead}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          autoMarkRead: event.target.checked,
                        }))
                      }
                    />
                    点击文章自动标记已读
                  </label>
                  <select
                    value={settings.defaultView}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        defaultView: event.target.value as RssReaderView,
                      }))
                    }
                    className={`${CONTROL_CLASS} w-full`}
                  >
                    {VIEW_TABS.map((tab) => (
                      <option key={tab.key} value={tab.key}>
                        默认视图：{tab.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  更新
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={settings.autoRefreshEnabled}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          autoRefreshEnabled: event.target.checked,
                        }))
                      }
                    />
                    <RefreshCw size={14} className="text-gray-400" />
                    自动刷新订阅
                  </label>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  常驻
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={settings.startWithApp}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          startWithApp: event.target.checked,
                          minimizeToTray: event.target.checked ? true : current.minimizeToTray,
                        }))
                      }
                    />
                    跟随软件自启动
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={settings.minimizeToTray}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          minimizeToTray: event.target.checked,
                        }))
                      }
                    />
                    关闭时隐藏到托盘
                  </label>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-800 dark:bg-gray-950">
              <button
                onClick={() => void hideReaderToTray()}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <Minimize2 size={14} />
                {settings.minimizeToTray ? '隐藏到托盘' : '最小化窗口'}
              </button>
              <button
                onClick={() => setShowReaderSettings(false)}
                className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-4 text-xs font-medium text-white hover:bg-blue-700"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {feedDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFeedDialog(null);
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {feedDialog.mode === 'add' ? '添加订阅源' : '编辑订阅源'}
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {feedDialog.mode === 'add'
                    ? '新增 RSS / Atom 或网页规则订阅'
                    : '调整地址、规则、分类和刷新时间'}
                </div>
              </div>
              <button
                onClick={() => setFeedDialog(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>
            <form
              className="max-h-[calc(92vh-58px)] space-y-4 overflow-y-auto p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submitFeedDialog();
              }}
            >
              <div>
                <div className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  订阅类型
                </div>
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 text-xs dark:border-gray-700 dark:bg-gray-950">
                  {[
                    { key: 'rss' as const, label: 'RSS / Atom' },
                    { key: 'web' as const, label: '网页规则' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setFeedDialog((current) =>
                          current ? { ...current, sourceType: item.key } : current
                        );
                        setWebRulePreview(null);
                      }}
                      className={`h-8 rounded-md px-3 font-medium transition-colors ${
                        feedDialog.sourceType === item.key
                          ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-300'
                          : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  {feedDialog.sourceType === 'web' ? '网页列表地址' : '订阅地址'}
                </label>
                <input
                  value={feedDialog.url}
                  onChange={(event) =>
                    setFeedDialog((current) =>
                      current ? { ...current, url: event.target.value } : current
                    )
                  }
                  placeholder={
                    feedDialog.sourceType === 'web'
                      ? 'https://example.com/news'
                      : 'https://example.com/feed.xml'
                  }
                  className={`${CONTROL_CLASS} w-full`}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  显示名称
                </label>
                <input
                  value={feedDialog.title}
                  onChange={(event) =>
                    setFeedDialog((current) =>
                      current ? { ...current, title: event.target.value } : current
                    )
                  }
                  placeholder="留空则使用订阅源标题"
                  className={`${CONTROL_CLASS} w-full`}
                />
              </div>
              {feedDialog.sourceType === 'web' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                        站点地址
                      </label>
                      <input
                        value={feedDialog.siteUrl}
                        onChange={(event) =>
                          setFeedDialog((current) =>
                            current ? { ...current, siteUrl: event.target.value } : current
                          )
                        }
                        placeholder="留空则使用列表地址"
                        className={`${CONTROL_CLASS} w-full`}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                        说明
                      </label>
                      <input
                        value={feedDialog.description}
                        onChange={(event) =>
                          setFeedDialog((current) =>
                            current ? { ...current, description: event.target.value } : current
                          )
                        }
                        placeholder="可选"
                        className={`${CONTROL_CLASS} w-full`}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950/60">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                          网页爬取规则
                        </div>
                        <div className="mt-0.5 text-[11px] text-gray-400">
                          静态 HTML + CSS 选择器，保存前建议先测试预览
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void previewWebRule()}
                        disabled={webRulePreviewLoading}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        {webRulePreviewLoading ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Search size={13} />
                        )}
                        测试规则
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <WebRuleInput
                        label="文章项选择器"
                        value={feedDialog.webRule.listSelector}
                        placeholder=".article-item"
                        onChange={(value) =>
                          setFeedDialog((current) =>
                            current
                              ? {
                                  ...current,
                                  webRule: { ...current.webRule, listSelector: value },
                                }
                              : current
                          )
                        }
                      />
                      <WebRuleInput
                        label="标题选择器"
                        value={feedDialog.webRule.titleSelector}
                        placeholder=".title"
                        onChange={(value) =>
                          setFeedDialog((current) =>
                            current
                              ? {
                                  ...current,
                                  webRule: { ...current.webRule, titleSelector: value },
                                }
                              : current
                          )
                        }
                      />
                      <WebRuleInput
                        label="链接选择器"
                        value={feedDialog.webRule.linkSelector}
                        placeholder="a"
                        onChange={(value) =>
                          setFeedDialog((current) =>
                            current
                              ? {
                                  ...current,
                                  webRule: { ...current.webRule, linkSelector: value },
                                }
                              : current
                          )
                        }
                      />
                      <WebRuleInput
                        label="链接属性"
                        value={feedDialog.webRule.linkAttribute}
                        placeholder="href"
                        onChange={(value) =>
                          setFeedDialog((current) =>
                            current
                              ? {
                                  ...current,
                                  webRule: { ...current.webRule, linkAttribute: value },
                                }
                              : current
                          )
                        }
                      />
                      <WebRuleInput
                        label="摘要选择器"
                        value={feedDialog.webRule.summarySelector}
                        placeholder=".summary"
                        onChange={(value) =>
                          setFeedDialog((current) =>
                            current
                              ? {
                                  ...current,
                                  webRule: { ...current.webRule, summarySelector: value },
                                }
                              : current
                          )
                        }
                      />
                      <WebRuleInput
                        label="时间选择器"
                        value={feedDialog.webRule.dateSelector}
                        placeholder="time"
                        onChange={(value) =>
                          setFeedDialog((current) =>
                            current
                              ? {
                                  ...current,
                                  webRule: { ...current.webRule, dateSelector: value },
                                }
                              : current
                          )
                        }
                      />
                      <WebRuleInput
                        label="作者选择器"
                        value={feedDialog.webRule.authorSelector}
                        placeholder=".author"
                        onChange={(value) =>
                          setFeedDialog((current) =>
                            current
                              ? {
                                  ...current,
                                  webRule: { ...current.webRule, authorSelector: value },
                                }
                              : current
                          )
                        }
                      />
                      <WebRuleInput
                        label="排除元素"
                        value={feedDialog.webRule.excludeSelectors}
                        placeholder=".ad,.share,.related"
                        onChange={(value) =>
                          setFeedDialog((current) =>
                            current
                              ? {
                                  ...current,
                                  webRule: { ...current.webRule, excludeSelectors: value },
                                }
                              : current
                          )
                        }
                      />
                    </div>
                    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={feedDialog.webRule.detailEnabled}
                          onChange={(event) =>
                            setFeedDialog((current) =>
                              current
                                ? {
                                    ...current,
                                    webRule: {
                                      ...current.webRule,
                                      detailEnabled: event.target.checked,
                                    },
                                  }
                                : current
                            )
                          }
                        />
                        进入详情页抓正文
                      </label>
                      {feedDialog.webRule.detailEnabled && (
                        <div className="mt-3">
                          <WebRuleInput
                            label="详情正文选择器"
                            value={feedDialog.webRule.detailContentSelector}
                            placeholder="article,.post-content"
                            onChange={(value) =>
                              setFeedDialog((current) =>
                                current
                                  ? {
                                      ...current,
                                      webRule: {
                                        ...current.webRule,
                                        detailContentSelector: value,
                                      },
                                    }
                                  : current
                              )
                            }
                          />
                        </div>
                      )}
                    </div>
                    {webRulePreview && (
                      <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 dark:border-blue-900 dark:bg-gray-900">
                        <div className="mb-2 text-xs font-semibold text-blue-600 dark:text-blue-300">
                          预览结果 · {webRulePreview.items.length} 条
                        </div>
                        <div className="max-h-44 space-y-2 overflow-y-auto">
                          {webRulePreview.items.map((item) => (
                            <div
                              key={item.stableId}
                              className="rounded-lg border border-gray-100 px-3 py-2 text-xs dark:border-gray-800"
                            >
                              <div className="line-clamp-1 font-medium text-gray-800 dark:text-gray-100">
                                {item.title}
                              </div>
                              <div className="mt-1 line-clamp-1 text-gray-400">
                                {item.link || '未提取链接'}
                              </div>
                              {(item.summary || item.content) && (
                                <div className="mt-1 line-clamp-2 text-gray-500 dark:text-gray-400">
                                  {item.summary || item.content}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                    分类
                  </label>
                  <select
                    value={feedDialog.categoryId}
                    onChange={(event) =>
                      setFeedDialog((current) =>
                        current ? { ...current, categoryId: event.target.value } : current
                      )
                    }
                    className={`${CONTROL_CLASS} w-full`}
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                    刷新间隔（分钟）
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    step={5}
                    value={feedDialog.refreshMinutes}
                    onChange={(event) =>
                      setFeedDialog((current) =>
                        current
                          ? { ...current, refreshMinutes: Number(event.target.value) }
                          : current
                      )
                    }
                    className={`${CONTROL_CLASS} w-full`}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={feedDialog.enabled}
                  onChange={(event) =>
                    setFeedDialog((current) =>
                      current ? { ...current, enabled: event.target.checked } : current
                    )
                  }
                />
                启用自动刷新
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={feedDialog.translateEnabled}
                  onChange={(event) =>
                    setFeedDialog((current) =>
                      current ? { ...current, translateEnabled: event.target.checked } : current
                    )
                  }
                />
                <Languages size={13} className="text-gray-400" />
                新文章自动翻译
                <span className="ml-auto text-[11px] text-gray-400">
                  默认服务商：{translateProviderName(globalSettings.translateProvider || 'baidu')}
                </span>
              </label>
              <div className="flex justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setFeedDialog(null)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading && <Loader2 size={14} className="animate-spin" />}
                  {feedDialog.mode === 'add' ? '添加' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {keywordDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setKeywordDialog(null);
          }}
        >
          <div className="w-full max-w-xl rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {keywordDialog.mode === 'add' ? '新增关键词订阅' : '编辑关键词订阅'}
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  命中文章会显示在订阅树下方的虚拟目录中
                </div>
              </div>
              <button
                onClick={() => setKeywordDialog(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <X size={16} />
              </button>
            </div>
            <form
              className="space-y-4 p-4"
              onSubmit={(event) => {
                event.preventDefault();
                submitKeywordDialog();
              }}
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  显示名称
                </label>
                <input
                  value={keywordDialog.name}
                  onChange={(event) =>
                    setKeywordDialog((current) =>
                      current ? { ...current, name: event.target.value } : current
                    )
                  }
                  placeholder="例如 AI 行业 / 数据库 / 安全漏洞"
                  className={`${CONTROL_CLASS} w-full`}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  关键词
                </label>
                <textarea
                  value={keywordDialog.keywordsText}
                  onChange={(event) =>
                    setKeywordDialog((current) =>
                      current ? { ...current, keywordsText: event.target.value } : current
                    )
                  }
                  placeholder="每行一个关键词，也支持用逗号分隔"
                  className={`${CONTROL_CLASS} min-h-24 w-full resize-none`}
                />
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                  匹配范围
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {KEYWORD_SCOPE_OPTIONS.map((option) => (
                    <label
                      key={option.key}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300"
                    >
                      <input
                        type="checkbox"
                        checked={keywordDialog.scopes.includes(option.key)}
                        onChange={(event) =>
                          setKeywordDialog((current) =>
                            current
                              ? {
                                  ...current,
                                  scopes: event.target.checked
                                    ? [...current.scopes, option.key]
                                    : current.scopes.filter((scope) => scope !== option.key),
                                }
                              : current
                          )
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    checked={keywordDialog.matchMode === 'any'}
                    onChange={() =>
                      setKeywordDialog((current) =>
                        current ? { ...current, matchMode: 'any' } : current
                      )
                    }
                  />
                  任一命中
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    checked={keywordDialog.matchMode === 'all'}
                    onChange={() =>
                      setKeywordDialog((current) =>
                        current ? { ...current, matchMode: 'all' } : current
                      )
                    }
                  />
                  全部命中
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={keywordDialog.caseSensitive}
                    onChange={(event) =>
                      setKeywordDialog((current) =>
                        current ? { ...current, caseSensitive: event.target.checked } : current
                      )
                    }
                  />
                  区分大小写
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                <span className="text-xs font-medium text-gray-500">颜色</span>
                {CATEGORY_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() =>
                      setKeywordDialog((current) => (current ? { ...current, color } : current))
                    }
                    className={`h-5 w-5 rounded-full border ${
                      keywordDialog.color === color
                        ? 'border-gray-900 ring-2 ring-blue-200 dark:border-white'
                        : 'border-white/70'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
                <label className="ml-auto flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={keywordDialog.enabled}
                    onChange={(event) =>
                      setKeywordDialog((current) =>
                        current ? { ...current, enabled: event.target.checked } : current
                      )
                    }
                  />
                  启用
                </label>
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setKeywordDialog(null)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {keywordDialog.mode === 'add' ? '新增' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {categoryMenu && (
        <div
          className="fixed z-50 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
          style={{ left: categoryMenu.x, top: categoryMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <ContextMenuButton
            onClick={() => {
              setCategoryMenu(null);
              createCategory();
            }}
          >
            <Plus size={14} />
            新增分类
          </ContextMenuButton>
          {categoryMenuTarget && (
            <>
              <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
              <ContextMenuButton
                onClick={() => {
                  setCategoryMenu(null);
                  openAddFeedDialog(categoryMenuTarget.id);
                }}
              >
                <Rss size={14} />
                添加订阅源
              </ContextMenuButton>
              <ContextMenuButton
                onClick={() => {
                  setCategoryMenu(null);
                  renameCategory(categoryMenuTarget.id);
                }}
              >
                <Edit3 size={14} />
                重命名
              </ContextMenuButton>
              <ContextMenuButton
                disabled={categories[0]?.id === categoryMenuTarget.id}
                onClick={() => {
                  setCategoryMenu(null);
                  moveCategory(categoryMenuTarget.id, -1);
                }}
              >
                <span className="w-3 text-center text-xs">↑</span>
                上移
              </ContextMenuButton>
              <ContextMenuButton
                disabled={categories[categories.length - 1]?.id === categoryMenuTarget.id}
                onClick={() => {
                  setCategoryMenu(null);
                  moveCategory(categoryMenuTarget.id, 1);
                }}
              >
                <span className="w-3 text-center text-xs">↓</span>
                下移
              </ContextMenuButton>
              <ContextMenuButton
                onClick={() => {
                  updateCategoryColor(categoryMenuTarget.id, nextColor(categoryMenuTarget.color));
                }}
              >
                <Palette size={14} />
                切换颜色
              </ContextMenuButton>
              <div className="px-3 py-2">
                <div className="mb-1 text-[11px] font-medium text-gray-400">颜色</div>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => updateCategoryColor(categoryMenuTarget.id, color)}
                      className={`h-5 w-5 rounded-full border ${
                        categoryMenuTarget.color === color
                          ? 'border-gray-900 ring-2 ring-blue-200 dark:border-white'
                          : 'border-white/70'
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                  <button
                    onClick={() => {
                      setCategoryMenu(null);
                      setCustomCategoryColor(categoryMenuTarget.id);
                    }}
                    className="h-5 rounded border border-gray-200 px-1.5 text-[10px] text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    自定义
                  </button>
                </div>
              </div>
              <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
              <ContextMenuButton
                danger
                onClick={() => {
                  setCategoryMenu(null);
                  deleteCategory(categoryMenuTarget.id);
                }}
              >
                <Trash2 size={14} />
                删除分类
              </ContextMenuButton>
            </>
          )}
        </div>
      )}

      {feedMenu && feedMenuTarget && (
        <div
          className="fixed z-50 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
          style={{ left: feedMenu.x, top: feedMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
            <div className="truncate text-xs font-semibold text-gray-700 dark:text-gray-200">
              {feedMenuTarget.title}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-gray-400">
              {categoryById[feedMenuTarget.categoryId]?.name || '其他'}
              {feedMenuTarget.lastFetchedAt
                ? ` · ${formatDateTime(feedMenuTarget.lastFetchedAt)}`
                : ''}
            </div>
          </div>
          <ContextMenuButton
            onClick={() => {
              setFeedMenu(null);
              void refreshFeed(feedMenuTarget.id);
            }}
          >
            <RefreshCw size={14} />
            刷新订阅源
          </ContextMenuButton>
          <ContextMenuButton
            onClick={() => {
              setFeedMenu(null);
              openEditFeedDialog(feedMenuTarget);
            }}
          >
            <Edit3 size={14} />
            编辑订阅源
          </ContextMenuButton>
          <ContextMenuButton
            onClick={() => {
              setFeedMenu(null);
              moveFeedToCategory(feedMenuTarget.id);
            }}
          >
            <FolderPlus size={14} />
            移动到分类
          </ContextMenuButton>
          <ContextMenuButton
            onClick={() => {
              setFeedMenu(null);
              toggleFeedEnabled(feedMenuTarget.id);
            }}
          >
            {feedMenuTarget.enabled ? <Circle size={14} /> : <CheckCircle2 size={14} />}
            {feedMenuTarget.enabled ? '停用订阅源' : '启用订阅源'}
          </ContextMenuButton>
          <ContextMenuButton
            onClick={() => {
              setFeedMenu(null);
              void copyFeedUrl(feedMenuTarget.id);
            }}
          >
            <Copy size={14} />
            复制订阅地址
          </ContextMenuButton>
          {feedMenuTarget.siteUrl && (
            <ContextMenuButton
              onClick={() => {
                setFeedMenu(null);
                void openExternal(feedMenuTarget.siteUrl);
              }}
            >
              <ExternalLink size={14} />
              打开站点
            </ContextMenuButton>
          )}
          <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          <ContextMenuButton
            danger
            onClick={() => {
              setFeedMenu(null);
              deleteFeed(feedMenuTarget.id);
            }}
          >
            <Trash2 size={14} />
            删除订阅源
          </ContextMenuButton>
        </div>
      )}

      {keywordMenu && (
        <div
          className="fixed z-50 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
          style={{ left: keywordMenu.x, top: keywordMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <ContextMenuButton
            onClick={() => {
              setKeywordMenu(null);
              openAddKeywordDialog();
            }}
          >
            <Plus size={14} />
            新增关键词订阅
          </ContextMenuButton>
          {keywordMenuTarget && (
            <>
              <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                <div className="truncate text-xs font-semibold text-gray-700 dark:text-gray-200">
                  {keywordMenuTarget.name}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-gray-400">
                  {keywordMenuTarget.keywords.join(' / ')}
                </div>
              </div>
              <ContextMenuButton
                onClick={() => {
                  setKeywordMenu(null);
                  openEditKeywordDialog(keywordMenuTarget);
                }}
              >
                <Edit3 size={14} />
                编辑关键词
              </ContextMenuButton>
              <ContextMenuButton
                onClick={() => {
                  setKeywordMenu(null);
                  toggleKeywordEnabled(keywordMenuTarget.id);
                }}
              >
                {keywordMenuTarget.enabled ? <Circle size={14} /> : <CheckCircle2 size={14} />}
                {keywordMenuTarget.enabled ? '停用关键词' : '启用关键词'}
              </ContextMenuButton>
              <ContextMenuButton
                disabled={keywordSubscriptions[0]?.id === keywordMenuTarget.id}
                onClick={() => {
                  setKeywordMenu(null);
                  moveKeywordSubscription(keywordMenuTarget.id, -1);
                }}
              >
                <span className="w-3 text-center text-xs">↑</span>
                上移
              </ContextMenuButton>
              <ContextMenuButton
                disabled={
                  keywordSubscriptions[keywordSubscriptions.length - 1]?.id === keywordMenuTarget.id
                }
                onClick={() => {
                  setKeywordMenu(null);
                  moveKeywordSubscription(keywordMenuTarget.id, 1);
                }}
              >
                <span className="w-3 text-center text-xs">↓</span>
                下移
              </ContextMenuButton>
              <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
              <ContextMenuButton
                danger
                onClick={() => {
                  setKeywordMenu(null);
                  deleteKeywordSubscription(keywordMenuTarget.id);
                }}
              >
                <Trash2 size={14} />
                删除关键词
              </ContextMenuButton>
            </>
          )}
        </div>
      )}

      <style>{RSS_READER_CONTENT_CSS}</style>
    </div>
  );
}

function ContextMenuButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-full items-center gap-2 px-3 text-left text-xs transition-colors disabled:opacity-40 ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20'
          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
      }`}
    >
      {children}
    </button>
  );
}

function WebRuleInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
        {label}
      </label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`${CONTROL_CLASS} w-full text-xs`}
      />
    </div>
  );
}

function canonicalUrl(value: string) {
  return normalizeFeedUrl(value).replace(/\/+$/, '').toLowerCase();
}

function normalizeDialogWebRule(rule: RssWebCrawlRule): RssWebCrawlRule {
  return {
    listSelector: rule.listSelector.trim(),
    titleSelector: rule.titleSelector.trim(),
    linkSelector: rule.linkSelector.trim() || DEFAULT_RSS_WEB_CRAWL_RULE.linkSelector,
    linkAttribute: rule.linkAttribute.trim() || DEFAULT_RSS_WEB_CRAWL_RULE.linkAttribute,
    summarySelector: rule.summarySelector.trim(),
    dateSelector: rule.dateSelector.trim(),
    authorSelector: rule.authorSelector.trim(),
    detailEnabled: rule.detailEnabled,
    detailContentSelector: rule.detailContentSelector.trim(),
    excludeSelectors: rule.excludeSelectors.trim(),
  };
}

function validateWebRuleForSubmit(rule: RssWebCrawlRule) {
  if (!rule.listSelector) return '请填写文章项选择器。';
  if (!rule.titleSelector) return '请填写标题选择器。';
  if (!rule.linkSelector) return '请填写链接选择器。';
  if (rule.detailEnabled && !rule.detailContentSelector) return '请填写详情正文选择器。';
  return '';
}

function parseKeywordList(value: string) {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of value.split(/[\n,，;；]+/)) {
    const keyword = raw.trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords.slice(0, 20);
}

function rssFetchedItemToArticle(
  feedId: string,
  item: RssFetchedItem,
  fetchedAt: string,
  articleStates: RssArticleState[]
): RssArticle {
  const stableId = item.stableId || item.guid || item.link || `${item.title}-${item.publishedAt}`;
  const state =
    articleStates.find((row) => row.feedId === feedId && row.stableId === stableId) ||
    articleStates.find((row) => !row.feedId && row.stableId === stableId);
  return {
    id: uid('article'),
    feedId,
    stableId,
    title: item.title?.trim() || '未命名文章',
    link: item.link?.trim() || '',
    author: item.author?.trim() || '',
    summary: item.summary?.trim() || '',
    content: item.content?.trim() || '',
    summaryHtml: item.summaryHtml?.trim() || '',
    contentHtml: item.contentHtml?.trim() || '',
    publishedAt: item.publishedAt || '',
    updatedAt: item.updatedAt || '',
    fetchedAt,
    guid: item.guid || '',
    translatedTitle: '',
    translatedSummary: '',
    translatedHtml: '',
    translatedContent: '',
    translatedAt: '',
    translatedProvider: '',
    translationError: '',
    read: state?.read ?? false,
    starred: state?.starred ?? false,
    later: state?.later ?? false,
  };
}

function rssArticleDetailKey(article: Pick<RssArticle, 'feedId' | 'stableId'>) {
  return `${article.feedId}::${article.stableId}`;
}

function hasRssArticleDetailPayload(article: RssArticle) {
  return Boolean(article.contentHtml.trim() || article.content.trim() || article.summaryHtml.trim());
}

function hasRssArticleRenderablePayload(article: RssArticle) {
  return Boolean(
    article.contentHtml.trim() ||
    article.summaryHtml.trim() ||
    article.content.trim() ||
    article.summary.trim() ||
    article.translatedHtml.trim() ||
    article.translatedContent.trim() ||
    article.translatedSummary.trim()
  );
}

function hasRssArticleTranslationPayload(article: RssArticle | null) {
  return Boolean(
    article?.translatedHtml.trim() ||
      article?.translatedContent.trim() ||
      article?.translatedSummary.trim() ||
      article?.translatedTitle.trim()
  );
}

function mergeFetchedArticlesIntoCurrentView(
  incomingArticles: RssArticle[],
  options: {
    query: RssArticlePageQuery;
    feedSources: RssArticlePageFeedSource[];
    states: RssArticleState[];
    currentArticles: RssArticle[];
    maxItems: number;
  },
  setArticlesState: React.Dispatch<React.SetStateAction<RssArticle[]>>,
  setStatsState: React.Dispatch<React.SetStateAction<typeof EMPTY_ARTICLE_PAGE_STATS>>,
  setHasMoreState: React.Dispatch<React.SetStateAction<boolean>>
) {
  let insertedCount = 0;
  const sourceByFeedId = new Map(options.feedSources.map((source) => [source.feedId, source]));
  const normalized = applyArticleStates(incomingArticles, options.states)
    .filter((article) => articleMatchesPageQuery(article, options.query, sourceByFeedId))
    .sort((a, b) => dateScore(b) - dateScore(a));
  if (!normalized.length) return 0;

  const seen = new Set(options.currentArticles.map((article) => rssArticleDetailKey(article)));
  const insertedArticles = normalized.filter((article) => {
    const key = rssArticleDetailKey(article);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  insertedCount = insertedArticles.length;
  if (!insertedCount) return 0;

  setArticlesState((current) => {
    const currentKeys = new Set(current.map((article) => rssArticleDetailKey(article)));
    const additions = insertedArticles.filter(
      (article) => !currentKeys.has(rssArticleDetailKey(article))
    );
    if (!additions.length) return current;
    return [...additions, ...current]
      .sort((a, b) => dateScore(b) - dateScore(a))
      .slice(0, options.maxItems);
  });

  setStatsState((current) => {
    const next = {
      ...current,
      total: current.total + insertedCount,
      allTotal: current.allTotal + insertedCount,
      byFeed: { ...current.byFeed },
      byKeyword: { ...current.byKeyword },
    };
    const unreadAdded = insertedArticles.filter((article) => !article.read).length;
    next.unread += unreadAdded;
    next.allUnread += unreadAdded;
    for (const article of insertedArticles) {
      const feedCounter = next.byFeed[article.feedId] || { total: 0, unread: 0 };
      next.byFeed[article.feedId] = {
        total: feedCounter.total + 1,
        unread: feedCounter.unread + (article.read ? 0 : 1),
      };
      for (const keyword of options.query.keywords) {
        if (!articleMatchesKeywordRequest(article, sourceByFeedId.get(article.feedId), keyword)) {
          continue;
        }
        const counter = next.byKeyword[keyword.id || ''] || { total: 0, unread: 0 };
        next.byKeyword[keyword.id || ''] = {
          total: counter.total + 1,
          unread: counter.unread + (article.read ? 0 : 1),
        };
      }
    }
    return next;
  });
  setHasMoreState(true);
  return insertedCount;
}

function mergeRssArticleListItem(existing: RssArticle | undefined, incoming: RssArticle) {
  if (!existing) return incoming;
  const translation = pickRssArticleTranslation(existing, incoming);
  return {
    ...incoming,
    ...existing,
    translatedTitle: translation.translatedTitle,
    translatedSummary: translation.translatedSummary,
    translatedHtml: translation.translatedHtml,
    translatedContent: translation.translatedContent,
    translatedAt: translation.translatedAt,
    translatedProvider: translation.translatedProvider,
    translationError: translation.translationError,
  };
}

function mergeRssArticleDetail(articles: RssArticle[], detail: RssArticle) {
  let mergedArticle: RssArticle | null = null;
  let changed = false;
  const nextArticles = articles.map((item) => {
    if (item.feedId !== detail.feedId || item.stableId !== detail.stableId) return item;
    const translation = pickRssArticleTranslation(item, detail);
    const nextArticle = {
      ...item,
      ...detail,
      id: item.id,
      translatedTitle: translation.translatedTitle,
      translatedSummary: translation.translatedSummary,
      translatedHtml: translation.translatedHtml,
      translatedContent: translation.translatedContent,
      translatedAt: translation.translatedAt,
      translatedProvider: translation.translatedProvider,
      translationError: translation.translationError,
    };
    mergedArticle = nextArticle;
    if (sameRssArticle(item, nextArticle)) return item;
    changed = true;
    return nextArticle;
  });
  return {
    articles: changed ? nextArticles : articles,
    article: mergedArticle,
  };
}

function pickRssArticleTranslation(current: RssArticle, detail: RssArticle) {
  const currentScore = rssArticleTranslationScore(current);
  const detailScore = rssArticleTranslationScore(detail);
  if (!currentScore) return detail;
  if (!detailScore) return current;
  const currentTime = parseTime(current.translatedAt);
  const detailTime = parseTime(detail.translatedAt);
  if (currentTime && detailTime && currentTime !== detailTime) {
    return detailTime > currentTime ? detail : current;
  }
  if (detailScore !== currentScore) return detailScore > currentScore ? detail : current;
  return hasRssArticleTranslationPayload(detail) || detail.translationError.trim() ? detail : current;
}

function rssArticleTranslationScore(article: RssArticle) {
  let score = 0;
  if (article.translatedTitle.trim()) score += 1;
  if (article.translatedSummary.trim()) score += 1;
  if (article.translatedContent.trim()) score += 2;
  if (article.translatedHtml.trim()) score += 4;
  if (article.translatedAt.trim()) score += 1;
  if (article.translationError.trim()) score += 1;
  return score;
}

function upsertRssArticleState(states: RssArticleState[], article: RssArticle) {
  const key = rssArticleDetailKey(article);
  const nextState = {
    feedId: article.feedId,
    stableId: article.stableId,
    read: article.read,
    starred: article.starred,
    later: article.later,
    updatedAt: new Date().toISOString(),
  };
  let changed = false;
  let found = false;
  const next = states.flatMap((state) => {
    const stateKey = state.feedId ? `${state.feedId}::${state.stableId}` : state.stableId;
    if (stateKey !== key && state.stableId !== article.stableId) return [state];
    found = true;
    if (!article.read && !article.starred && !article.later) {
      changed = true;
      return [];
    }
    const merged = {
      ...nextState,
      updatedAt: state.updatedAt || nextState.updatedAt,
    };
    if (
      state.feedId === merged.feedId &&
      state.stableId === merged.stableId &&
      state.read === merged.read &&
      state.starred === merged.starred &&
      state.later === merged.later
    ) {
      return [state];
    }
    changed = true;
    return [merged];
  });
  if (!found && (article.read || article.starred || article.later)) {
    return [...states, nextState].slice(-5000);
  }
  return changed ? next.slice(-5000) : states;
}

function articleMatchesPageQuery(
  article: RssArticle,
  query: RssArticlePageQuery,
  sourceByFeedId: Map<string, RssArticlePageFeedSource>
) {
  if (query.feedIds.length && !query.feedIds.includes(article.feedId)) return false;
  if (!articleMatchesView(article, query.view)) return false;
  const source = sourceByFeedId.get(article.feedId);
  if (query.keyword && !articleMatchesKeywordRequest(article, source, query.keyword)) return false;
  if (!articleMatchesSearch(article, source, query.search)) return false;
  return true;
}

function articleMatchesView(article: RssArticle, view: RssReaderView) {
  if (view === 'unread') return !article.read;
  if (view === 'starred') return article.starred;
  if (view === 'later') return article.later;
  return true;
}

function articleMatchesSearch(
  article: RssArticle,
  source: RssArticlePageFeedSource | undefined,
  search: string
) {
  const keyword = search.trim().toLowerCase();
  if (!keyword) return true;
  return articleSearchText(article, source).toLowerCase().includes(keyword);
}

function articleMatchesKeywordRequest(
  article: RssArticle,
  source: RssArticlePageFeedSource | undefined,
  keyword: RssArticlePageKeywordRequest
) {
  const keywords = keyword.keywords.map((item) => item.trim()).filter(Boolean);
  if (!keyword.enabled || !keywords.length) return false;
  const scopes = keyword.scopes.length ? keyword.scopes : (['title'] as RssKeywordScope[]);
  const sourceText = scopes
    .flatMap((scope) => articleScopeText(article, source, scope))
    .filter((value) => value.trim())
    .join('\n');
  if (!sourceText.trim()) return false;
  const haystack = keyword.caseSensitive ? sourceText : sourceText.toLowerCase();
  const matcher = (value: string) => {
    const needle = keyword.caseSensitive ? value : value.toLowerCase();
    return haystack.includes(needle);
  };
  return keyword.matchMode === 'all' ? keywords.every(matcher) : keywords.some(matcher);
}

function articleSearchText(article: RssArticle, source?: RssArticlePageFeedSource) {
  return [
    article.title,
    article.translatedTitle,
    article.summary,
    article.translatedSummary,
    article.content,
    article.contentHtml,
    article.summaryHtml,
    article.translatedContent,
    article.translatedHtml,
    article.author,
    article.guid,
    article.link,
    source?.title || '',
    source?.description || '',
    source?.siteUrl || '',
    source?.url || '',
  ].join('\n');
}

function articleScopeText(
  article: RssArticle,
  source: RssArticlePageFeedSource | undefined,
  scope: RssKeywordScope
) {
  if (scope === 'title') return [article.title, article.translatedTitle];
  if (scope === 'summary') return [article.summary, article.summaryHtml, article.translatedSummary];
  if (scope === 'content') {
    return [
      article.content,
      article.contentHtml,
      article.translatedContent,
      article.translatedHtml,
    ];
  }
  if (scope === 'author') return [article.author];
  if (scope === 'source') {
    return [
      source?.title || '',
      source?.description || '',
      source?.siteUrl || '',
      source?.url || '',
    ];
  }
  return [];
}

function sameRssArticle(left: RssArticle, right: RssArticle) {
  return RSS_ARTICLE_COMPARE_KEYS.every((key) => left[key] === right[key]);
}

function rssArticlePatchChanges(article: RssArticle, patch: Partial<RssArticle>) {
  return Object.entries(patch).some(([key, value]) => {
    const field = key as keyof RssArticle;
    return article[field] !== value;
  });
}

function translateProviderName(provider: string) {
  const names: Record<string, string> = {
    baidu: '百度翻译',
    google: '谷歌翻译',
    bing: '必应翻译',
    tencent: '腾讯翻译',
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
  };
  return names[provider] || provider || '默认服务商';
}

function buildArticleTranslationSource(article: RssArticle) {
  const html = (article.contentHtml || article.summaryHtml || '').trim();
  const text = (
    article.content ||
    article.summary ||
    stripHtmlForSearch(html) ||
    article.title
  ).trim();
  return { html, text };
}

function shouldAutoTranslateArticle(
  feed: Pick<RssFeed, 'id' | 'translateEnabled' | 'translateEnabledAt'>,
  article: RssArticle,
  knownStableIds: Set<string>
) {
  if (!feed.translateEnabled) return false;
  if (article.feedId !== feed.id) return false;
  if (article.translatedAt) return false;
  if (article.translationError) return false;
  if (knownStableIds.has(article.stableId)) return false;
  const enabledAt = parseTime(feed.translateEnabledAt);
  const fetchedAt = parseTime(article.fetchedAt);
  return !enabledAt || !fetchedAt || fetchedAt >= enabledAt;
}

async function translateHtmlPreservingFormat(
  html: string,
  translateText: (text: string) => Promise<{
    translatedText: string;
    provider: string;
    fromLang: string;
    toLang: string;
  }>
) {
  const sanitized = sanitizeRssHtml(html);
  const doc = new DOMParser().parseFromString(sanitized, 'text/html');
  const nodes = collectTranslatableTextNodes(doc.body);
  const segments = nodes
    .map((node) => node.textContent || '')
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!segments.length) {
    const fallbackText = stripHtmlForSearch(sanitized);
    if (!fallbackText.trim()) throw new Error('文章没有可翻译的文本内容。');
    const result = await translateText(fallbackText);
    return {
      html: renderPlainTextAsHtml(result.translatedText),
      text: result.translatedText,
      provider: result.provider,
      fromLang: result.fromLang,
      toLang: result.toLang,
    };
  }

  const translatedSegments: string[] = [];
  let provider = '';
  let fromLang = '';
  let toLang = '';
  for (const batch of chunkIndexedTextSegments(segments, 3600)) {
    const result = await translateText(buildNumberMarkerBatch(batch));
    provider = result.provider;
    fromLang = result.fromLang;
    toLang = result.toLang;
    const parts = extractNumberMarkerBatch(result.translatedText, batch);
    if (parts) {
      translatedSegments.push(...parts);
      continue;
    }
    for (const segment of batch) {
      const retryResult = await translateText(segment.text);
      provider = retryResult.provider;
      fromLang = retryResult.fromLang;
      toLang = retryResult.toLang;
      translatedSegments.push(stripNumberMarkers(retryResult.translatedText).trim());
    }
  }

  let index = 0;
  for (const node of nodes) {
    const raw = node.textContent || '';
    const original = raw.replace(/\s+/g, ' ').trim();
    if (!original) continue;
    const leading = raw.match(/^\s*/)?.[0] || '';
    const trailing = raw.match(/\s*$/)?.[0] || '';
    node.textContent = `${leading}${translatedSegments[index] || original}${trailing}`;
    index += 1;
  }

  const translatedHtml = doc.body.innerHTML;
  return {
    html: translatedHtml,
    text: stripHtmlForSearch(translatedHtml),
    provider,
    fromLang,
    toLang,
  };
}

function collectTranslatableTextNodes(root: HTMLElement) {
  const skipTags = new Set(['script', 'style', 'pre', 'code', 'kbd', 'samp', 'textarea']);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || isMostlySymbolText(text)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(Array.from(skipTags).join(','))) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function chunkIndexedTextSegments(segments: string[], maxChars: number) {
  const chunks: Array<Array<{ index: number; text: string }>> = [];
  let current: Array<{ index: number; text: string }> = [];
  let size = 0;
  for (const [index, segment] of segments.entries()) {
    const itemSize = segment.length + translationStartMarker(index).length * 2 + 8;
    if (current.length && size + itemSize > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push({ index, text: segment });
    size += itemSize;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function buildNumberMarkerBatch(batch: Array<{ index: number; text: string }>) {
  return batch
    .map(
      (segment) =>
        `${translationStartMarker(segment.index)}\n${segment.text}\n${translationEndMarker(
          segment.index
        )}`
    )
    .join('\n\n');
}

function extractNumberMarkerBatch(value: string, batch: Array<{ index: number; text: string }>) {
  const translated: string[] = [];
  let cursor = 0;
  for (const segment of batch) {
    const start = translationStartMarker(segment.index);
    const end = translationEndMarker(segment.index);
    const startIndex = value.indexOf(start, cursor);
    if (startIndex < 0) return null;
    const contentStart = startIndex + start.length;
    const endIndex = value.indexOf(end, contentStart);
    if (endIndex < 0) return null;
    const text = stripNumberMarkers(value.slice(contentStart, endIndex)).trim();
    translated.push(text || segment.text);
    cursor = endIndex + end.length;
  }
  return translated;
}

function translationStartMarker(index: number) {
  return `9182736450${String(index).padStart(6, '0')}0123456789`;
}

function translationEndMarker(index: number) {
  return `9182736450${String(index).padStart(6, '0')}9876543210`;
}

function stripNumberMarkers(value: string) {
  return value.replace(/9182736450\d{6}(?:0123456789|9876543210)/g, '');
}

function isMostlySymbolText(value: string) {
  const lettersOrNumbers = value.match(/[\p{L}\p{N}]/gu)?.length || 0;
  return lettersOrNumbers === 0;
}

function renderPlainTextAsHtml(value: string) {
  const paragraphs = escapeHtml(value)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return paragraphs || '<p></p>';
}

function nextColor(current: string) {
  const index = CATEGORY_COLORS.findIndex((color) => color.toLowerCase() === current.toLowerCase());
  return CATEGORY_COLORS[(index + 1) % CATEGORY_COLORS.length];
}

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed}`;
  return '';
}

function dateScore(article: Pick<RssArticle, 'publishedAt' | 'updatedAt' | 'fetchedAt'>) {
  const time = new Date(articleTime(article)).getTime();
  return Number.isFinite(time) ? time : 0;
}

function parseTime(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function clampRefreshMinutes(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_RSS_REFRESH_MINUTES;
  return Math.min(1440, Math.max(5, Math.round(number)));
}

function renderRssArticleHtml(
  article: RssArticle | null,
  mode: 'translated' | 'original' = 'original'
) {
  if (!article) return '';
  if (mode === 'translated') {
    if (article.translatedHtml.trim()) {
      return decorateCodeBlocks(sanitizeRssHtml(article.translatedHtml));
    }
    if (article.translatedContent.trim()) {
      return renderPlainTextAsHtml(article.translatedContent);
    }
    if (article.translatedSummary.trim()) {
      return renderPlainTextAsHtml(article.translatedSummary);
    }
  }
  const html = article.contentHtml || article.summaryHtml;
  if (html.trim()) return decorateCodeBlocks(sanitizeRssHtml(html));
  const text = article.content || article.summary || '这篇文章没有可显示的正文内容。';
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return paragraphs || '<p>这篇文章没有可显示的正文内容。</p>';
}

function stripHtmlForSearch(value: string) {
  if (!value) return '';
  const doc = new DOMParser().parseFromString(value, 'text/html');
  return doc.body.textContent || '';
}

function sanitizeRssHtml(value: string) {
  const doc = new DOMParser().parseFromString(value, 'text/html');
  const allowedTags = new Set([
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'div',
    'em',
    'figcaption',
    'figure',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    's',
    'span',
    'strong',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'u',
    'ul',
  ]);
  const removeTags = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'svg',
    'math',
  ]);
  const elements = Array.from(doc.body.querySelectorAll('*')).reverse();
  for (const element of elements) {
    const tag = element.tagName.toLowerCase();
    if (removeTags.has(tag)) {
      element.remove();
      continue;
    }
    if (!allowedTags.has(tag)) {
      unwrapElement(element);
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const rawValue = attribute.value;
      if (name.startsWith('on') || name === 'style') {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (tag === 'a' && name === 'href') {
        if (isSafeLink(rawValue)) {
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer');
        } else {
          element.removeAttribute(attribute.name);
        }
        continue;
      }
      if (tag === 'img' && name === 'src') {
        if (isSafeImage(rawValue)) {
          element.setAttribute('loading', 'lazy');
          element.setAttribute('referrerpolicy', 'no-referrer');
        } else {
          element.removeAttribute(attribute.name);
        }
        continue;
      }
      if (tag === 'code' && name === 'class') {
        element.setAttribute('class', sanitizeCodeClass(rawValue));
        continue;
      }
      if (
        (tag === 'img' && ['alt', 'title', 'width', 'height'].includes(name)) ||
        (tag === 'a' && ['title', 'target', 'rel'].includes(name)) ||
        (['td', 'th'].includes(tag) && ['colspan', 'rowspan'].includes(name)) ||
        name === 'title'
      ) {
        continue;
      }
      element.removeAttribute(attribute.name);
    }
  }
  return doc.body.innerHTML;
}

function unwrapElement(element: Element) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  element.remove();
}

function isSafeLink(value: string) {
  if (!/^(https?:|mailto:)/i.test(value.trim())) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function isSafeImage(value: string) {
  if (!/^https?:/i.test(value.trim())) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeCodeClass(value: string) {
  return value
    .split(/\s+/)
    .filter((item) => /^language-[a-z0-9_-]+$/i.test(item))
    .join(' ');
}

function decorateCodeBlocks(value: string) {
  const doc = new DOMParser().parseFromString(value, 'text/html');
  for (const code of Array.from(doc.body.querySelectorAll('pre code'))) {
    code.innerHTML = highlightCode(code.textContent || '');
    code.classList.add('rss-highlighted-code');
  }
  for (const code of Array.from(doc.body.querySelectorAll('code:not(pre code)'))) {
    code.textContent = code.textContent || '';
    code.classList.add('rss-inline-code');
  }
  return doc.body.innerHTML;
}

function highlightCode(code: string) {
  const tokenPattern =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:async|await|break|case|catch|class|const|continue|default|else|export|extends|finally|for|from|function|if|import|in|let|new|null|return|switch|throw|try|type|undefined|var|while)\b|\b\d+(?:\.\d+)?\b)/g;
  let output = '';
  let lastIndex = 0;
  for (const match of code.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index || 0;
    output += escapeHtml(code.slice(lastIndex, index));
    output += `<span class="${codeTokenClass(token)}">${escapeHtml(token)}</span>`;
    lastIndex = index + token.length;
  }
  output += escapeHtml(code.slice(lastIndex));
  return output;
}

function codeTokenClass(token: string) {
  if (token.startsWith('//') || token.startsWith('/*')) return 'rss-code-comment';
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
    return 'rss-code-string';
  }
  if (/^\d/.test(token)) return 'rss-code-number';
  return 'rss-code-keyword';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const RSS_READER_CONTENT_CSS = `
.rss-reader-content {
  word-break: break-word;
}
.rss-reader-content :where(p, ul, ol, blockquote, pre, table, figure) {
  margin-bottom: 1rem;
}
.rss-reader-content :where(h1, h2, h3, h4, h5, h6) {
  margin: 1.25rem 0 0.65rem;
  font-weight: 700;
  line-height: 1.35;
  color: rgb(17 24 39);
}
.dark .rss-reader-content :where(h1, h2, h3, h4, h5, h6) {
  color: rgb(249 250 251);
}
.rss-reader-content h1 { font-size: 1.5rem; }
.rss-reader-content h2 { font-size: 1.25rem; }
.rss-reader-content h3 { font-size: 1.1rem; }
.rss-reader-content a {
  color: rgb(37 99 235);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.dark .rss-reader-content a {
  color: rgb(96 165 250);
}
.rss-reader-content img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  border: 1px solid rgb(229 231 235);
}
.dark .rss-reader-content img {
  border-color: rgb(55 65 81);
}
.rss-reader-content blockquote {
  border-left: 3px solid rgb(59 130 246);
  padding-left: 1rem;
  color: rgb(75 85 99);
  background: rgb(249 250 251);
}
.dark .rss-reader-content blockquote {
  color: rgb(209 213 219);
  background: rgb(17 24 39);
}
.rss-reader-content table {
  width: 100%;
  border-collapse: collapse;
  overflow: hidden;
  border-radius: 8px;
}
.rss-reader-content th,
.rss-reader-content td {
  border: 1px solid rgb(229 231 235);
  padding: 0.55rem 0.7rem;
  vertical-align: top;
}
.dark .rss-reader-content th,
.dark .rss-reader-content td {
  border-color: rgb(55 65 81);
}
.rss-reader-content th {
  background: rgb(243 244 246);
  font-weight: 700;
}
.dark .rss-reader-content th {
  background: rgb(31 41 55);
}
.rss-reader-content pre {
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid rgb(226 232 240);
  background: rgb(15 23 42);
  padding: 1rem;
  color: rgb(226 232 240);
  line-height: 1.65;
}
.rss-reader-content code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}
.rss-reader-content .rss-inline-code {
  border-radius: 5px;
  background: rgb(241 245 249);
  padding: 0.12rem 0.35rem;
  color: rgb(190 24 93);
}
.dark .rss-reader-content .rss-inline-code {
  background: rgb(31 41 55);
  color: rgb(244 114 182);
}
.rss-code-keyword { color: rgb(147 197 253); }
.rss-code-string { color: rgb(134 239 172); }
.rss-code-comment { color: rgb(148 163 184); }
.rss-code-number { color: rgb(253 186 116); }
`;
