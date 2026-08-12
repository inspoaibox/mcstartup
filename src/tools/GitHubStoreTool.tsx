import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open as openExternal } from '@tauri-apps/api/shell';
import {
  Bookmark,
  BookmarkCheck,
  Box,
  CalendarDays,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Filter,
  GitFork,
  Github,
  Package,
  RefreshCw,
  Search,
  Star,
  Tag,
  TrendingUp,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { EmptyState, StatusMessage, ToolbarButton, formatBytes } from './systemToolUtils';

interface GithubStoreOwner {
  login: string;
  avatarUrl: string | null;
  htmlUrl: string;
}

interface GithubStoreRepo {
  id: number;
  name: string;
  fullName: string;
  owner: GithubStoreOwner;
  htmlUrl: string;
  description: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  license: string | null;
  pushedAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  archived: boolean;
  fork: boolean;
  defaultBranch: string | null;
  homepage: string | null;
  size: number;
  score: number | null;
}

interface GithubRateLimit {
  limit: number | null;
  remaining: number | null;
  reset: string | null;
}

interface GithubStoreSearchResult {
  query: string;
  totalCount: number;
  incompleteResults: boolean;
  items: GithubStoreRepo[];
  page: number;
  perPage: number;
  rateLimit: GithubRateLimit;
}

interface GithubStoreDailyResult {
  sourceDate: string;
  since: string;
  mode: 'updated' | 'new';
  language: string | null;
  topic: string | null;
  minStars: number;
  generatedAt: string;
  cacheHit: boolean;
  query: string;
  items: GithubStoreRepo[];
  rateLimit: GithubRateLimit;
}

interface GithubStoreReleaseAsset {
  id: number;
  name: string;
  label: string | null;
  browserDownloadUrl: string;
  contentType: string | null;
  size: number;
  downloadCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

interface GithubStoreRelease {
  id: number;
  tagName: string;
  name: string | null;
  body: string | null;
  htmlUrl: string;
  publishedAt: string | null;
  prerelease: boolean;
  draft: boolean;
  assets: GithubStoreReleaseAsset[];
}

interface GithubStoreRepoDetail {
  repo: GithubStoreRepo;
  latestRelease: GithubStoreRelease | null;
  releases: GithubStoreRelease[];
  rateLimit: GithubRateLimit;
}

type Tab = 'daily' | 'search' | 'favorites';
type DailyMode = 'updated' | 'new';

const FAVORITES_KEY = 'mcstartup.github-store.favorites.v1';
const LANGUAGE_OPTIONS = [
  '',
  'TypeScript',
  'JavaScript',
  'Python',
  'Rust',
  'Go',
  'Java',
  'C#',
  'C++',
  'PHP',
  'Swift',
  'Kotlin',
];
const TOPIC_PRESETS = [
  'ai',
  'cli',
  'desktop',
  'developer-tools',
  'self-hosted',
  'tauri',
  'react',
  'rust',
  'python',
  'windows',
];
const CONTROL_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950';

function loadFavorites(): GithubStoreRepo[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveFavorites(items: GithubStoreRepo[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(items.slice(0, 300)));
}

function formatNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 10_000) return `${(value / 1000).toFixed(0)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function formatDate(value: string | null) {
  if (!value) return '-';
  return value.slice(0, 10);
}

function formatRelative(value: string | null) {
  if (!value) return '-';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return formatDate(value);
  const diff = Date.now() - time;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(value);
}

function releaseAssetScore(release: GithubStoreRelease | null) {
  if (!release) return 0;
  return release.assets.reduce((sum, asset) => sum + asset.downloadCount, 0);
}

export default function GitHubStoreTool() {
  const ready = useToolTheme();
  const [tab, setTab] = useState<Tab>('daily');
  const [token, setToken] = useState('');
  const [dailyMode, setDailyMode] = useState<DailyMode>('updated');
  const [dailyLanguage, setDailyLanguage] = useState('');
  const [dailyTopic, setDailyTopic] = useState('');
  const [dailyDays, setDailyDays] = useState(1);
  const [dailyMinStars, setDailyMinStars] = useState(50);
  const [query, setQuery] = useState('stars:>500');
  const [searchLanguage, setSearchLanguage] = useState('');
  const [searchTopic, setSearchTopic] = useState('');
  const [sort, setSort] = useState('stars');
  const [dailyResult, setDailyResult] = useState<GithubStoreDailyResult | null>(null);
  const [searchResult, setSearchResult] = useState<GithubStoreSearchResult | null>(null);
  const [favorites, setFavorites] = useState<GithubStoreRepo[]>(loadFavorites);
  const [selected, setSelected] = useState<GithubStoreRepo | null>(null);
  const [detail, setDetail] = useState<GithubStoreRepoDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState(
    '每日更新榜会按当天缓存，手动刷新可重新获取 GitHub 数据。'
  );
  const [error, setError] = useState('');

  const visibleRepos = useMemo(() => {
    if (tab === 'daily') return dailyResult?.items || [];
    if (tab === 'search') return searchResult?.items || [];
    return favorites;
  }, [dailyResult, favorites, searchResult, tab]);

  const favoriteIds = useMemo(() => new Set(favorites.map((repo) => repo.fullName)), [favorites]);

  const loadDaily = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError('');
      setMessage(forceRefresh ? '正在刷新 GitHub 每日更新榜...' : '正在读取 GitHub 每日更新榜...');
      try {
        const result = await invoke<GithubStoreDailyResult>('github_store_daily', {
          params: {
            language: dailyLanguage || null,
            topic: dailyTopic || null,
            minStars: dailyMinStars,
            days: dailyDays,
            mode: dailyMode,
            forceRefresh,
            token: token.trim() || null,
          },
        });
        setDailyResult(result);
        setTab('daily');
        setSelected(result.items[0] || null);
        setMessage(
          `${result.cacheHit ? '已读取缓存' : '已更新'}：${result.items.length} 个项目，查询 ${result.query}`
        );
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [dailyDays, dailyLanguage, dailyMinStars, dailyMode, dailyTopic, token]
  );

  const searchRepos = async () => {
    setLoading(true);
    setError('');
    setMessage('正在搜索 GitHub 仓库...');
    try {
      const result = await invoke<GithubStoreSearchResult>('github_store_search_repositories', {
        params: {
          query,
          language: searchLanguage || null,
          topic: searchTopic || null,
          sort,
          order: 'desc',
          page: 1,
          perPage: 40,
          token: token.trim() || null,
        },
      });
      setSearchResult(result);
      setTab('search');
      setSelected(result.items[0] || null);
      setMessage(
        `搜索完成：${formatNumber(result.totalCount)} 个结果，当前显示 ${result.items.length} 个`
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = useCallback(
    async (repo: GithubStoreRepo | null) => {
      if (!repo) {
        setDetail(null);
        return;
      }
      setDetailLoading(true);
      setError('');
      try {
        const result = await invoke<GithubStoreRepoDetail>('github_store_repository', {
          params: { fullName: repo.fullName, token: token.trim() || null },
        });
        setDetail(result);
      } catch (err) {
        setDetail(null);
        setError(String(err));
      } finally {
        setDetailLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (!ready || dailyResult) return;
    void loadDaily(false);
  }, [dailyResult, loadDaily, ready]);

  useEffect(() => {
    void loadDetail(selected);
  }, [loadDetail, selected]);

  const toggleFavorite = (repo: GithubStoreRepo) => {
    const exists = favoriteIds.has(repo.fullName);
    const next = exists
      ? favorites.filter((item) => item.fullName !== repo.fullName)
      : [repo, ...favorites];
    setFavorites(next);
    saveFavorites(next);
    setMessage(exists ? `已取消收藏 ${repo.fullName}` : `已收藏 ${repo.fullName}`);
  };

  const copyRepo = async (repo: GithubStoreRepo) => {
    await navigator.clipboard.writeText(`${repo.fullName}\n${repo.htmlUrl}`);
    setMessage(`已复制 ${repo.fullName}`);
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🧭"
        title="GitHub Store"
        subtitle="GitHub 项目发现、Release 资产和每日更新榜"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton onClick={() => void loadDaily(true)} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新日榜
            </ToolbarButton>
            <ToolbarButton onClick={() => selected && void copyRepo(selected)} disabled={!selected}>
              <Copy size={14} />
              复制仓库
            </ToolbarButton>
          </div>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)_420px] gap-3 p-4">
        <aside className="flex min-h-0 flex-col gap-3">
          <StatusMessage message={message} error={error} />
          <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Filter size={15} />
              数据源
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <TabButton
                active={tab === 'daily'}
                onClick={() => setTab('daily')}
                icon={<TrendingUp size={14} />}
                label="日榜"
              />
              <TabButton
                active={tab === 'search'}
                onClick={() => setTab('search')}
                icon={<Search size={14} />}
                label="搜索"
              />
              <TabButton
                active={tab === 'favorites'}
                onClick={() => setTab('favorites')}
                icon={<Bookmark size={14} />}
                label="收藏"
              />
            </div>
            <div className="mt-3">
              <Field label="GitHub Token">
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="可选，提高 API 额度"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                />
              </Field>
            </div>
          </section>

          {tab === 'daily' && (
            <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CalendarDays size={15} />
                每日更新榜
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="模式">
                  <select
                    value={dailyMode}
                    onChange={(event) => setDailyMode(event.target.value as DailyMode)}
                    className={CONTROL_CLASS}
                  >
                    <option value="updated">活跃更新</option>
                    <option value="new">新仓库</option>
                  </select>
                </Field>
                <Field label="窗口">
                  <select
                    value={dailyDays}
                    onChange={(event) => setDailyDays(Number(event.target.value))}
                    className={CONTROL_CLASS}
                  >
                    <option value={1}>1 天</option>
                    <option value={3}>3 天</option>
                    <option value={7}>7 天</option>
                    <option value={14}>14 天</option>
                  </select>
                </Field>
                <Field label="语言">
                  <select
                    value={dailyLanguage}
                    onChange={(event) => setDailyLanguage(event.target.value)}
                    className={CONTROL_CLASS}
                  >
                    {LANGUAGE_OPTIONS.map((item) => (
                      <option key={item || 'all'} value={item}>
                        {item || '全部'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="最少 Star">
                  <input
                    type="number"
                    value={dailyMinStars}
                    onChange={(event) =>
                      setDailyMinStars(Math.max(0, Number(event.target.value) || 0))
                    }
                    className={CONTROL_CLASS}
                  />
                </Field>
              </div>
              <Field label="Topic">
                <input
                  value={dailyTopic}
                  onChange={(event) => setDailyTopic(event.target.value)}
                  placeholder="可选 topic"
                  className={CONTROL_CLASS}
                />
              </Field>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TOPIC_PRESETS.slice(0, 6).map((topic) => (
                  <button
                    key={topic}
                    onClick={() => setDailyTopic(topic)}
                    className="rounded-md bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800"
                  >
                    {topic}
                  </button>
                ))}
              </div>
              <button
                onClick={() => void loadDaily(true)}
                disabled={loading}
                className="mt-3 h-9 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-50"
              >
                获取日榜
              </button>
            </section>
          )}

          {tab === 'search' && (
            <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Search size={15} />
                搜索发现
              </div>
              <div className="mt-3 space-y-2">
                <Field label="查询">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && void searchRepos()}
                    placeholder="关键词或 GitHub Search 语法"
                    className={CONTROL_CLASS}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="语言">
                    <select
                      value={searchLanguage}
                      onChange={(event) => setSearchLanguage(event.target.value)}
                      className={CONTROL_CLASS}
                    >
                      {LANGUAGE_OPTIONS.map((item) => (
                        <option key={item || 'all'} value={item}>
                          {item || '全部'}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="排序">
                    <select
                      value={sort}
                      onChange={(event) => setSort(event.target.value)}
                      className={CONTROL_CLASS}
                    >
                      <option value="stars">Stars</option>
                      <option value="updated">Updated</option>
                      <option value="forks">Forks</option>
                    </select>
                  </Field>
                </div>
                <Field label="Topic">
                  <input
                    value={searchTopic}
                    onChange={(event) => setSearchTopic(event.target.value)}
                    placeholder="可选 topic"
                    className={CONTROL_CLASS}
                  />
                </Field>
                <button
                  onClick={() => void searchRepos()}
                  disabled={loading}
                  className="h-9 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-50"
                >
                  搜索仓库
                </button>
              </div>
            </section>
          )}

          <section className="grid grid-cols-2 gap-2">
            <Metric icon={<Star size={14} />} label="结果" value={String(visibleRepos.length)} />
            <Metric
              icon={<BookmarkCheck size={14} />}
              label="收藏"
              value={String(favorites.length)}
            />
            <Metric
              icon={<Clock size={14} />}
              label="缓存"
              value={dailyResult?.cacheHit ? '命中' : dailyResult ? '刷新' : '-'}
            />
            <Metric
              icon={<Github size={14} />}
              label="额度"
              value={rateText(
                dailyResult?.rateLimit || searchResult?.rateLimit || detail?.rateLimit
              )}
            />
          </section>
        </aside>

        <section className="min-h-0 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <RepoList
            repos={visibleRepos}
            loading={loading}
            selected={selected}
            favoriteIds={favoriteIds}
            onSelect={setSelected}
            onFavorite={toggleFavorite}
            onOpen={(repo) => void openExternal(repo.htmlUrl)}
          />
        </section>

        <DetailPanel
          repo={selected}
          detail={detail}
          loading={detailLoading}
          favorite={selected ? favoriteIds.has(selected.fullName) : false}
          onFavorite={() => selected && toggleFavorite(selected)}
        />
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium ${
        active
          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-base font-semibold">{value}</div>
    </div>
  );
}

function RepoList({
  repos,
  loading,
  selected,
  favoriteIds,
  onSelect,
  onFavorite,
  onOpen,
}: {
  repos: GithubStoreRepo[];
  loading: boolean;
  selected: GithubStoreRepo | null;
  favoriteIds: Set<string>;
  onSelect: (repo: GithubStoreRepo) => void;
  onFavorite: (repo: GithubStoreRepo) => void;
  onOpen: (repo: GithubStoreRepo) => void;
}) {
  if (loading && !repos.length)
    return (
      <EmptyState
        icon={<RefreshCw size={32} className="animate-spin" />}
        text="正在获取 GitHub 数据"
      />
    );
  if (!repos.length) return <EmptyState icon={<Github size={32} />} text="暂无仓库结果" />;
  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 z-10 grid grid-cols-[minmax(280px,1fr)_130px_110px_120px] border-b border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900">
        <span>仓库</span>
        <span>语言</span>
        <span>热度</span>
        <span>更新</span>
      </div>
      {repos.map((repo) => (
        <RepoRow
          key={repo.id}
          repo={repo}
          selected={selected?.fullName === repo.fullName}
          favorite={favoriteIds.has(repo.fullName)}
          onSelect={() => onSelect(repo)}
          onFavorite={() => onFavorite(repo)}
          onOpen={() => onOpen(repo)}
        />
      ))}
    </div>
  );
}

function RepoRow({
  repo,
  selected,
  favorite,
  onSelect,
  onFavorite,
  onOpen,
}: {
  repo: GithubStoreRepo;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onFavorite: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className={`grid cursor-pointer grid-cols-[minmax(280px,1fr)_130px_110px_120px] items-center border-b border-gray-100 px-4 py-3 text-sm dark:border-gray-800 ${
        selected
          ? 'bg-blue-50/80 dark:bg-blue-900/20'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/70'
      }`}
      onClick={onSelect}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onFavorite();
            }}
            className="text-gray-400 hover:text-blue-600"
          >
            {favorite ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
          </button>
          <span className="truncate font-semibold" title={repo.fullName}>
            {repo.fullName}
          </span>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            className="text-gray-400 hover:text-blue-600"
          >
            <ExternalLink size={14} />
          </button>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-gray-500">
          {repo.description || 'No description'}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {repo.topics.slice(0, 4).map((topic) => (
            <span
              key={topic}
              className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              {topic}
            </span>
          ))}
        </div>
      </div>
      <span className="truncate text-xs text-gray-600 dark:text-gray-300">
        {repo.language || '-'}
      </span>
      <div className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
        <div className="flex items-center gap-1">
          <Star size={13} />
          {formatNumber(repo.stars)}
        </div>
        <div className="flex items-center gap-1">
          <GitFork size={13} />
          {formatNumber(repo.forks)}
        </div>
      </div>
      <span className="text-xs text-gray-500">
        {formatRelative(repo.pushedAt || repo.updatedAt)}
      </span>
    </div>
  );
}

function DetailPanel({
  repo,
  detail,
  loading,
  favorite,
  onFavorite,
}: {
  repo: GithubStoreRepo | null;
  detail: GithubStoreRepoDetail | null;
  loading: boolean;
  favorite: boolean;
  onFavorite: () => void;
}) {
  const release = detail?.latestRelease || null;
  if (!repo) {
    return (
      <section className="min-h-0 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <EmptyState icon={<Package size={32} />} text="选择仓库查看 Release 资产" />
      </section>
    );
  }
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-200 p-4 dark:border-gray-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {repo.owner.avatarUrl && (
                <img src={repo.owner.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
              )}
              <h2 className="truncate text-lg font-semibold" title={repo.fullName}>
                {repo.fullName}
              </h2>
            </div>
            <p className="mt-2 line-clamp-3 text-sm text-gray-600 dark:text-gray-300">
              {repo.description || 'No description'}
            </p>
          </div>
          <button
            onClick={onFavorite}
            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {favorite ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Metric icon={<Star size={14} />} label="Stars" value={formatNumber(repo.stars)} />
          <Metric icon={<GitFork size={14} />} label="Forks" value={formatNumber(repo.forks)} />
          <Metric
            icon={<Download size={14} />}
            label="Release"
            value={formatNumber(releaseAssetScore(release))}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ToolbarButton onClick={() => void openExternal(repo.htmlUrl)}>
            <Github size={14} />
            仓库
          </ToolbarButton>
          {repo.homepage && (
            <ToolbarButton onClick={() => repo.homepage && void openExternal(repo.homepage)}>
              <ExternalLink size={14} />
              主页
            </ToolbarButton>
          )}
          {release && (
            <ToolbarButton onClick={() => void openExternal(release.htmlUrl)}>
              <Tag size={14} />
              最新 Release
            </ToolbarButton>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <EmptyState
            icon={<RefreshCw size={32} className="animate-spin" />}
            text="正在读取仓库详情"
          />
        ) : (
          <div className="space-y-4">
            <InfoGrid repo={repo} />
            <ReleaseBlock release={release} title="最新 Release" />
            <section>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Box size={15} />
                最近 Release
              </div>
              <div className="space-y-2">
                {(detail?.releases || []).map((item) => (
                  <ReleaseBlock key={item.id} release={item} compact title={item.tagName} />
                ))}
                {detail && detail.releases.length === 0 && (
                  <p className="text-sm text-gray-500">暂无 Release</p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}

function InfoGrid({ repo }: { repo: GithubStoreRepo }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <Info label="语言" value={repo.language || '-'} />
      <Info label="协议" value={repo.license || '-'} />
      <Info label="创建" value={formatDate(repo.createdAt)} />
      <Info label="推送" value={formatRelative(repo.pushedAt || repo.updatedAt)} />
      <Info label="分支" value={repo.defaultBranch || '-'} />
      <Info label="大小" value={formatBytes(repo.size * 1024)} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-950">
      <div className="text-gray-500">{label}</div>
      <div className="mt-1 truncate font-medium" title={value}>
        {value}
      </div>
    </div>
  );
}

function ReleaseBlock({
  release,
  title,
  compact,
}: {
  release: GithubStoreRelease | null;
  title: string;
  compact?: boolean;
}) {
  if (!release) {
    if (compact) return null;
    return (
      <section>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Package size={15} />
          {title}
        </div>
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500 dark:bg-gray-950">
          暂无 Release
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Package size={15} />
            <span className="truncate" title={release.name || release.tagName}>
              {title}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>{release.tagName}</span>
            <span>{formatDate(release.publishedAt)}</span>
            {release.prerelease && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                pre
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => void openExternal(release.htmlUrl)}
          className="text-gray-400 hover:text-blue-600"
        >
          <ExternalLink size={15} />
        </button>
      </div>
      {!compact && release.body && (
        <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-300">
          {release.body}
        </p>
      )}
      <div className="mt-3 space-y-2">
        {release.assets.map((asset) => (
          <AssetRow key={asset.id} asset={asset} />
        ))}
        {release.assets.length === 0 && <p className="text-xs text-gray-500">暂无可下载资产</p>}
      </div>
    </section>
  );
}

function AssetRow({ asset }: { asset: GithubStoreReleaseAsset }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-2 text-xs dark:bg-gray-950">
      <div className="min-w-0">
        <div className="truncate font-medium" title={asset.name}>
          {asset.name}
        </div>
        <div className="mt-0.5 text-gray-500">
          {formatBytes(asset.size)} · {formatNumber(asset.downloadCount)} downloads
        </div>
      </div>
      <button
        onClick={() => void openExternal(asset.browserDownloadUrl)}
        className="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-white hover:text-blue-600 dark:border-gray-700 dark:hover:bg-gray-900"
      >
        <Download size={14} />
      </button>
    </div>
  );
}

function rateText(rate?: GithubRateLimit | null) {
  if (!rate || rate.remaining === null) return '-';
  return rate.limit ? `${rate.remaining}/${rate.limit}` : String(rate.remaining);
}
