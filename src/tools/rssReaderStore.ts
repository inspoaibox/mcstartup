export type RssReaderView = 'all' | 'unread' | 'starred' | 'later';
export type RssKeywordScope = 'title' | 'summary' | 'content' | 'author' | 'source';
export type RssFeedSourceType = 'rss' | 'web';

export interface RssWebCrawlRule {
  listSelector: string;
  titleSelector: string;
  linkSelector: string;
  linkAttribute: string;
  summarySelector: string;
  dateSelector: string;
  authorSelector: string;
  detailEnabled: boolean;
  detailContentSelector: string;
  excludeSelectors: string;
}

export interface RssCategory {
  id: string;
  name: string;
  color: string;
}

export interface RssFeed {
  id: string;
  sourceType: RssFeedSourceType;
  title: string;
  url: string;
  siteUrl: string;
  description: string;
  webRule: RssWebCrawlRule;
  categoryId: string;
  enabled: boolean;
  refreshMinutes: number;
  createdAt: string;
  updatedAt: string;
  lastFetchedAt: string;
  etag: string;
  lastModified: string;
  translateEnabled: boolean;
  translateEnabledAt: string;
  lastError: string;
}

export interface RssKeywordSubscription {
  id: string;
  name: string;
  keywords: string[];
  scopes: RssKeywordScope[];
  matchMode: 'any' | 'all';
  caseSensitive: boolean;
  enabled: boolean;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface RssArticle {
  id: string;
  feedId: string;
  stableId: string;
  title: string;
  link: string;
  author: string;
  summary: string;
  content: string;
  summaryHtml: string;
  contentHtml: string;
  publishedAt: string;
  updatedAt: string;
  fetchedAt: string;
  guid: string;
  translatedTitle: string;
  translatedSummary: string;
  translatedHtml: string;
  translatedContent: string;
  translatedAt: string;
  translatedProvider: string;
  translationError: string;
  read: boolean;
  starred: boolean;
  later: boolean;
}

export interface RssArticleState {
  feedId: string;
  stableId: string;
  read: boolean;
  starred: boolean;
  later: boolean;
  updatedAt: string;
}

export interface RssReaderSettings {
  autoMarkRead: boolean;
  defaultView: RssReaderView;
  autoRefreshEnabled: boolean;
  startWithApp: boolean;
  minimizeToTray: boolean;
}

export interface RssReaderStore {
  feeds: RssFeed[];
  categories: RssCategory[];
  keywordSubscriptions: RssKeywordSubscription[];
  articleStates: RssArticleState[];
  settings: RssReaderSettings;
}

export interface RssReaderToolData extends RssReaderStore {
  version: string;
  lastModified: string;
}

export interface RssFetchedFeed {
  title: string;
  description: string;
  siteUrl?: string | null;
  feedUrl: string;
}

export interface RssFetchedItem {
  stableId: string;
  title: string;
  link?: string | null;
  author?: string | null;
  summary: string;
  content: string;
  summaryHtml: string;
  contentHtml: string;
  publishedAt?: string | null;
  updatedAt?: string | null;
  guid?: string | null;
}

export interface RssFetchResult {
  feed: RssFetchedFeed;
  items: RssFetchedItem[];
  fetchedAt: string;
  notModified: boolean;
  etag?: string | null;
  lastModified?: string | null;
}

export const RSS_READER_VERSION = 'mcheng-rss-reader-v1';
export const DEFAULT_RSS_REFRESH_MINUTES = 15;

export const DEFAULT_RSS_WEB_CRAWL_RULE: RssWebCrawlRule = {
  listSelector: '',
  titleSelector: '',
  linkSelector: 'a',
  linkAttribute: 'href',
  summarySelector: '',
  dateSelector: '',
  authorSelector: '',
  detailEnabled: false,
  detailContentSelector: '',
  excludeSelectors: '.ad,.ads,.advertisement,.share,.social,.related,.recommend',
};

export const DEFAULT_RSS_CATEGORIES: RssCategory[] = [
  { id: 'news', name: '新闻资讯', color: '#2563eb' },
  { id: 'tech', name: '科技开发', color: '#16a34a' },
  { id: 'product', name: '产品设计', color: '#d97706' },
  { id: 'finance', name: '商业财经', color: '#0891b2' },
  { id: 'life', name: '生活兴趣', color: '#dc2626' },
  { id: 'other', name: '其他', color: '#64748b' },
];

export const DEFAULT_RSS_SETTINGS: RssReaderSettings = {
  autoMarkRead: true,
  defaultView: 'all',
  autoRefreshEnabled: false,
  startWithApp: false,
  minimizeToTray: true,
};

export const DEFAULT_RSS_READER_STORE: RssReaderStore = {
  feeds: [],
  categories: DEFAULT_RSS_CATEGORIES,
  keywordSubscriptions: [],
  articleStates: [],
  settings: DEFAULT_RSS_SETTINGS,
};

export function normalizeRssReaderStore(source?: Partial<RssReaderStore>): RssReaderStore {
  const categories = mergeCategories(source?.categories);
  const categoryIds = new Set(categories.map((item) => item.id));
  return {
    feeds: Array.isArray(source?.feeds)
      ? source.feeds.map(normalizeFeed).map((feed) => ({
          ...feed,
          categoryId: categoryIds.has(feed.categoryId) ? feed.categoryId : 'other',
        }))
      : [],
    categories,
    keywordSubscriptions: Array.isArray(source?.keywordSubscriptions)
      ? source.keywordSubscriptions.map(normalizeKeywordSubscription).filter((item) => item.name)
      : [],
    articleStates: normalizeArticleStates(source),
    settings: normalizeSettings(source?.settings),
  };
}

export function normalizeRssReaderData(source?: Partial<RssReaderToolData>): RssReaderToolData {
  return {
    version: source?.version || RSS_READER_VERSION,
    ...normalizeRssReaderStore(source),
    lastModified: source?.lastModified || new Date().toISOString(),
  };
}

export function uid(prefix = 'rss') {
  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

export function normalizeFeedUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function articleTime(article: Pick<RssArticle, 'publishedAt' | 'updatedAt' | 'fetchedAt'>) {
  return article.publishedAt || article.updatedAt || article.fetchedAt;
}

export function formatDateTime(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatFullDateTime(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function mergeFetchedArticles(
  currentArticles: RssArticle[],
  articleStates: RssArticleState[],
  feedId: string,
  items: RssFetchedItem[],
  fetchedAt: string
) {
  const existingByStableId = new Map(
    currentArticles.filter((item) => item.feedId === feedId).map((item) => [item.stableId, item])
  );
  const stateByStableId = new Map(
    articleStates.flatMap((item) => {
      const entries: Array<[string, RssArticleState]> = [];
      if (item.feedId) entries.push([articleStateKey(item.feedId, item.stableId), item]);
      entries.push([item.stableId, item]);
      return entries;
    })
  );
  const otherArticles = currentArticles.filter((item) => item.feedId !== feedId);
  const nextForFeed: RssArticle[] = [];

  for (const item of items) {
    const stableId = item.stableId || item.guid || item.link || `${item.title}-${item.publishedAt}`;
    const existing = existingByStableId.get(stableId);
    const savedState =
      stateByStableId.get(articleStateKey(feedId, stableId)) || stateByStableId.get(stableId);
    nextForFeed.push({
      id: existing?.id || uid('article'),
      feedId,
      stableId,
      title: item.title?.trim() || '未命名文章',
      link: item.link?.trim() || existing?.link || '',
      author: item.author?.trim() || existing?.author || '',
      summary: item.summary?.trim() || existing?.summary || '',
      content: item.content?.trim() || existing?.content || '',
      summaryHtml: item.summaryHtml?.trim() || existing?.summaryHtml || '',
      contentHtml: item.contentHtml?.trim() || existing?.contentHtml || '',
      publishedAt: item.publishedAt || existing?.publishedAt || '',
      updatedAt: item.updatedAt || existing?.updatedAt || '',
      fetchedAt,
      guid: item.guid || existing?.guid || '',
      translatedTitle: existing?.translatedTitle || '',
      translatedSummary: existing?.translatedSummary || '',
      translatedHtml: existing?.translatedHtml || '',
      translatedContent: existing?.translatedContent || '',
      translatedAt: existing?.translatedAt || '',
      translatedProvider: existing?.translatedProvider || '',
      translationError: existing?.translationError || '',
      read: savedState?.read ?? existing?.read ?? false,
      starred: savedState?.starred ?? existing?.starred ?? false,
      later: savedState?.later ?? existing?.later ?? false,
    });
  }

  for (const existing of existingByStableId.values()) {
    if (!nextForFeed.some((item) => item.stableId === existing.stableId)) {
      nextForFeed.push(existing);
    }
  }

  nextForFeed.sort((a, b) => dateScore(b) - dateScore(a));
  return [...otherArticles, ...nextForFeed];
}

export function exportOpml(feeds: RssFeed[], categories: RssCategory[]) {
  const categoryById = Object.fromEntries(categories.map((item) => [item.id, item.name]));
  const grouped = categories.map((category) => ({
    category,
    feeds: feeds.filter((feed) => feed.categoryId === category.id),
  }));
  const ungrouped = feeds.filter((feed) => !categoryById[feed.categoryId]);
  const outlines = grouped
    .filter((group) => group.feeds.length)
    .map(
      (group) =>
        `    <outline text="${escapeXml(group.category.name)}" title="${escapeXml(group.category.name)}">\n${group.feeds
          .map(feedOutline)
          .join('\n')}\n    </outline>`
    );
  if (ungrouped.length) outlines.push(...ungrouped.map(feedOutline));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>McStartUP RSS 阅读器订阅</title>\n  </head>\n  <body>\n${outlines.join('\n')}\n  </body>\n</opml>\n`;
}

export function parseOpml(text: string, categories: RssCategory[]) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('OPML 文件解析失败');
  }
  const categoryByName = new Map(categories.map((item) => [item.name, item.id]));
  const outlines = Array.from(doc.querySelectorAll('outline[xmlUrl], outline[xmlurl]'));
  return outlines
    .map((node) => {
      const parentTitle =
        node.parentElement?.getAttribute('title') || node.parentElement?.getAttribute('text') || '';
      const url = node.getAttribute('xmlUrl') || node.getAttribute('xmlurl') || '';
      return {
        title: node.getAttribute('title') || node.getAttribute('text') || url,
        url: normalizeFeedUrl(url),
        siteUrl: node.getAttribute('htmlUrl') || '',
        categoryName: parentTitle,
        categoryId: categoryByName.get(parentTitle) || 'other',
      };
    })
    .filter((item) => item.url);
}

export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function articleStatesFromArticles(
  articles: RssArticle[],
  existingStates: RssArticleState[] = []
) {
  const map = new Map(
    existingStates.map((item) => [
      item.feedId ? articleStateKey(item.feedId, item.stableId) : item.stableId,
      item,
    ])
  );
  const now = new Date().toISOString();
  for (const article of articles) {
    const key = articleStateKey(article.feedId, article.stableId);
    const changed = article.read || article.starred || article.later;
    if (!changed) {
      map.delete(key);
      map.delete(article.stableId);
      continue;
    }
    const existing = map.get(key) || map.get(article.stableId);
    map.delete(article.stableId);
    map.set(key, {
      feedId: article.feedId,
      stableId: article.stableId,
      read: article.read,
      starred: article.starred,
      later: article.later,
      updatedAt: existing?.updatedAt || now,
    });
  }
  return Array.from(map.values()).slice(-5000);
}

export function applyArticleStates(articles: RssArticle[], states: RssArticleState[]) {
  const map = new Map(
    states.flatMap((item) => {
      const entries: Array<[string, RssArticleState]> = [];
      if (item.feedId) entries.push([articleStateKey(item.feedId, item.stableId), item]);
      entries.push([item.stableId, item]);
      return entries;
    })
  );
  return articles.map((article) => {
    const state =
      map.get(articleStateKey(article.feedId, article.stableId)) || map.get(article.stableId);
    if (!state) return article;
    return {
      ...article,
      read: state.read,
      starred: state.starred,
      later: state.later,
    };
  });
}

function normalizeSettings(source?: Partial<RssReaderSettings>): RssReaderSettings {
  return {
    autoMarkRead: source?.autoMarkRead ?? DEFAULT_RSS_SETTINGS.autoMarkRead,
    defaultView: source?.defaultView || DEFAULT_RSS_SETTINGS.defaultView,
    autoRefreshEnabled: source?.autoRefreshEnabled ?? DEFAULT_RSS_SETTINGS.autoRefreshEnabled,
    startWithApp: source?.startWithApp ?? DEFAULT_RSS_SETTINGS.startWithApp,
    minimizeToTray: source?.minimizeToTray ?? DEFAULT_RSS_SETTINGS.minimizeToTray,
  };
}

function normalizeArticleStates(source?: Partial<RssReaderStore> & { articles?: RssArticle[] }) {
  if (Array.isArray(source?.articleStates)) {
    return source.articleStates.map(normalizeArticleState).filter((state) => state.stableId);
  }
  if (Array.isArray(source?.articles)) {
    return source.articles
      .map(normalizeArticle)
      .filter((article) => article.read || article.starred || article.later)
      .map((article) => ({
        feedId: article.feedId,
        stableId: article.stableId,
        read: article.read,
        starred: article.starred,
        later: article.later,
        updatedAt: new Date().toISOString(),
      }));
  }
  return [];
}

function normalizeArticleState(source: Partial<RssArticleState>): RssArticleState {
  return {
    feedId: source.feedId || '',
    stableId: source.stableId || '',
    read: Boolean(source.read),
    starred: Boolean(source.starred),
    later: Boolean(source.later),
    updatedAt: source.updatedAt || new Date().toISOString(),
  };
}

function articleStateKey(feedId: string, stableId: string) {
  return `${feedId}::${stableId}`;
}

function mergeCategories(source?: RssCategory[]) {
  const defaultById = new Map(DEFAULT_RSS_CATEGORIES.map((category) => [category.id, category]));
  const result: RssCategory[] = [];
  const seen = new Set<string>();

  if (Array.isArray(source)) {
    for (const category of source) {
      if (!category?.id || !category.name || seen.has(category.id)) continue;
      seen.add(category.id);
      result.push({
        id: category.id,
        name: category.name,
        color:
          category.color ||
          defaultById.get(category.id)?.color ||
          DEFAULT_RSS_CATEGORIES[DEFAULT_RSS_CATEGORIES.length - 1]?.color ||
          '#64748b',
      });
    }
  }

  for (const category of DEFAULT_RSS_CATEGORIES) {
    if (seen.has(category.id)) continue;
    result.push(category);
  }

  return result;
}

function normalizeFeed(source: Partial<RssFeed>): RssFeed {
  const now = new Date().toISOString();
  return {
    id: source.id || uid('feed'),
    sourceType: source.sourceType === 'web' ? 'web' : 'rss',
    title: source.title || source.url || '未命名订阅源',
    url: normalizeFeedUrl(source.url || ''),
    siteUrl: source.siteUrl || '',
    description: source.description || '',
    webRule: normalizeWebCrawlRule(source.webRule),
    categoryId: source.categoryId || 'other',
    enabled: source.enabled ?? true,
    refreshMinutes: clamp(source.refreshMinutes, 5, 1440, DEFAULT_RSS_REFRESH_MINUTES),
    createdAt: source.createdAt || now,
    updatedAt: source.updatedAt || now,
    lastFetchedAt: source.lastFetchedAt || '',
    etag: source.etag || '',
    lastModified: source.lastModified || '',
    translateEnabled: Boolean(source.translateEnabled),
    translateEnabledAt: source.translateEnabledAt || '',
    lastError: source.lastError || '',
  };
}

function normalizeWebCrawlRule(source?: Partial<RssWebCrawlRule>): RssWebCrawlRule {
  return {
    listSelector: source?.listSelector?.trim() || '',
    titleSelector: source?.titleSelector?.trim() || '',
    linkSelector: source?.linkSelector?.trim() || DEFAULT_RSS_WEB_CRAWL_RULE.linkSelector,
    linkAttribute: source?.linkAttribute?.trim() || DEFAULT_RSS_WEB_CRAWL_RULE.linkAttribute,
    summarySelector: source?.summarySelector?.trim() || '',
    dateSelector: source?.dateSelector?.trim() || '',
    authorSelector: source?.authorSelector?.trim() || '',
    detailEnabled: Boolean(source?.detailEnabled),
    detailContentSelector: source?.detailContentSelector?.trim() || '',
    excludeSelectors:
      source?.excludeSelectors?.trim() || DEFAULT_RSS_WEB_CRAWL_RULE.excludeSelectors,
  };
}

function normalizeKeywordSubscription(
  source: Partial<RssKeywordSubscription>
): RssKeywordSubscription {
  const now = new Date().toISOString();
  const keywords = Array.isArray(source.keywords)
    ? source.keywords
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const scopes = Array.isArray(source.scopes)
    ? source.scopes.filter((scope): scope is RssKeywordScope =>
        ['title', 'summary', 'content', 'author', 'source'].includes(scope)
      )
    : [];
  return {
    id: source.id || uid('keyword'),
    name: source.name?.trim() || keywords[0] || '关键词订阅',
    keywords,
    scopes: scopes.length ? scopes : ['title', 'summary', 'content'],
    matchMode: source.matchMode === 'all' ? 'all' : 'any',
    caseSensitive: Boolean(source.caseSensitive),
    enabled: source.enabled ?? true,
    color: source.color || '#7c3aed',
    createdAt: source.createdAt || now,
    updatedAt: source.updatedAt || now,
  };
}

function normalizeArticle(source: Partial<RssArticle>): RssArticle {
  const now = new Date().toISOString();
  return {
    id: source.id || uid('article'),
    feedId: source.feedId || '',
    stableId: source.stableId || source.guid || source.link || uid('stable'),
    title: source.title || '未命名文章',
    link: source.link || '',
    author: source.author || '',
    summary: source.summary || '',
    content: source.content || '',
    summaryHtml: source.summaryHtml || '',
    contentHtml: source.contentHtml || '',
    publishedAt: source.publishedAt || '',
    updatedAt: source.updatedAt || '',
    fetchedAt: source.fetchedAt || now,
    guid: source.guid || '',
    translatedTitle: source.translatedTitle || '',
    translatedSummary: source.translatedSummary || '',
    translatedHtml: source.translatedHtml || '',
    translatedContent: source.translatedContent || '',
    translatedAt: source.translatedAt || '',
    translatedProvider: source.translatedProvider || '',
    translationError: source.translationError || '',
    read: Boolean(source.read),
    starred: Boolean(source.starred),
    later: Boolean(source.later),
  };
}

function feedOutline(feed: RssFeed) {
  if (feed.sourceType === 'web') {
    return `      <outline text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" type="html" htmlUrl="${escapeXml(feed.url)}" />`;
  }
  return `      <outline text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" type="rss" xmlUrl="${escapeXml(feed.url)}" htmlUrl="${escapeXml(feed.siteUrl)}" />`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function dateScore(article: Pick<RssArticle, 'publishedAt' | 'updatedAt' | 'fetchedAt'>) {
  const value = articleTime(article);
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
