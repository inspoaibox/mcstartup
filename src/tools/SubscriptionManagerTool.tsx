import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import {
  BarChart3,
  Bell,
  CalendarDays,
  CreditCard,
  Download,
  Edit3,
  FileDown,
  FileUp,
  Filter,
  Plus,
  Search,
  Settings2,
  Tag,
  Trash2,
  Wallet,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { StatusMessage, ToolbarButton } from './systemToolUtils';
import { useToolDataStore } from '../stores/toolDataStore';
import {
  CURRENCIES,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  EDITOR_REQUEST_KEY,
  SUBSCRIPTION_MANAGER_VERSION,
  TODAY,
  clampNumber,
  convertAmount,
  cycleLabel,
  daysBetween,
  downloadText,
  exportCsv,
  itemInitial,
  clearLegacyStore,
  loadLegacyStore,
  money,
  monthlyNative,
  normalizedNextDate,
  statusLabel,
  toDateInput,
  uid,
  yearlyNative,
  type SubscriptionManagerToolData,
  type SubscriptionCategory,
  type SubscriptionItem,
  type SubscriptionSettings,
  type SubscriptionStore,
} from './subscriptionManagerStore';

type FilterKey = 'all' | 'upcoming' | 'cancelWindow' | 'active' | 'paused' | 'cancelled';
type SortKey = 'next' | 'cost' | 'name' | 'category';

interface SubscriptionRowModel {
  item: SubscriptionItem;
  next: Date;
  daysLeft: number;
  monthlyConverted: { value: number; converted: boolean };
  yearlyConverted: { value: number; converted: boolean };
  category: SubscriptionCategory;
}

const FILTERS: Array<[FilterKey, string]> = [
  ['all', '全部'],
  ['upcoming', '即将扣款'],
  ['cancelWindow', '可取消窗口'],
  ['active', '启用'],
  ['paused', '暂停'],
  ['cancelled', '已取消'],
];

export default function SubscriptionManagerTool() {
  const ready = useToolTheme();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { data, loaded, loadData, updateSubscriptionManagerData } = useToolDataStore();
  const storeData = data.subscriptionManager;
  const [items, setItems] = useState<SubscriptionItem[]>([]);
  const [categories, setCategories] = useState<SubscriptionCategory[]>(DEFAULT_CATEGORIES);
  const [settings, setSettings] = useState<SubscriptionSettings>(DEFAULT_SETTINGS);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortKey>('next');
  const [message, setMessage] = useState('订阅数据仅保存在本机。');
  const [error, setError] = useState('');
  const hydratingRef = useRef(false);
  const hasMigratedLegacyRef = useRef(false);

  useEffect(() => {
    if (!loaded) void loadData();
  }, [loadData, loaded]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen('subscription-manager-updated', () => {
      void loadData();
      setMessage('订阅数据已刷新');
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadData]);

  useEffect(() => {
    if (!loaded) return;
    const legacyStore = loadLegacyStore();
    const currentItems = storeData?.items || [];
    if (
      !hasMigratedLegacyRef.current &&
      legacyStore &&
      legacyStore.items.length &&
      !currentItems.length
    ) {
      hasMigratedLegacyRef.current = true;
      void updateSubscriptionManagerData({
        version: SUBSCRIPTION_MANAGER_VERSION,
        ...legacyStore,
      });
      clearLegacyStore();
      setMessage('已迁移旧版订阅数据到统一工具数据文件。');
      return;
    }

    hydratingRef.current = true;
    setItems(storeData?.items || []);
    setCategories(storeData?.categories?.length ? storeData.categories : DEFAULT_CATEGORIES);
    setSettings(storeData?.settings || DEFAULT_SETTINGS);
  }, [loaded, storeData, updateSubscriptionManagerData]);

  const persistStore = useCallback(
    (next: Omit<SubscriptionManagerToolData, 'lastModified'>) => {
      void updateSubscriptionManagerData(next);
    },
    [updateSubscriptionManagerData]
  );

  useEffect(() => {
    if (!loaded) return;
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    persistStore({
      version: SUBSCRIPTION_MANAGER_VERSION,
      items,
      categories,
      settings,
    });
  }, [categories, items, loaded, persistStore, settings]);

  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((item) => [item.id, item])),
    [categories]
  );

  const enriched = useMemo(
    () =>
      items.map((item) => {
        const next = normalizedNextDate(item);
        const daysLeft = daysBetween(TODAY, next);
        const monthly = monthlyNative(item);
        const yearly = yearlyNative(item);
        const monthlyConverted = convertAmount(monthly, item.currency, settings);
        const yearlyConverted = convertAmount(yearly, item.currency, settings);
        return {
          item,
          next,
          daysLeft,
          monthly,
          yearly,
          monthlyConverted,
          yearlyConverted,
          category: categoryById[item.categoryId] || DEFAULT_CATEGORIES.at(-1)!,
        };
      }),
    [categoryById, items, settings]
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const rows = enriched.filter(({ item, daysLeft }) => {
      if (category !== 'all' && item.categoryId !== category) return false;
      if (filter === 'upcoming' && !(item.status === 'active' && daysLeft <= item.reminderDays)) {
        return false;
      }
      if (
        filter === 'cancelWindow' &&
        !(item.status === 'active' && daysLeft <= item.cancellationDays)
      ) {
        return false;
      }
      if (filter === 'active' && item.status !== 'active') return false;
      if (filter === 'paused' && item.status !== 'paused') return false;
      if (filter === 'cancelled' && item.status !== 'cancelled') return false;
      if (!keyword) return true;
      return [
        item.name,
        item.currency,
        item.paymentMethod,
        item.owner,
        item.website,
        item.notes,
        categoryById[item.categoryId]?.name,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
    rows.sort((a, b) => {
      if (sort === 'cost') return b.monthlyConverted.value - a.monthlyConverted.value;
      if (sort === 'name') return a.item.name.localeCompare(b.item.name);
      if (sort === 'category') return a.category.name.localeCompare(b.category.name);
      return a.daysLeft - b.daysLeft;
    });
    return rows;
  }, [category, categoryById, enriched, filter, search, sort]);

  const stats = useMemo(() => {
    const active = enriched.filter(({ item }) => item.status === 'active');
    const monthlyRows = active.map((row) => row.monthlyConverted);
    const yearlyRows = active.map((row) => row.yearlyConverted);
    const monthlyTotal = monthlyRows.reduce((sum, item) => sum + item.value, 0);
    const yearlyTotal = yearlyRows.reduce((sum, item) => sum + item.value, 0);
    const unconverted = active.filter((row) => !row.monthlyConverted.converted).length;
    const next30 = active
      .filter((row) => row.daysLeft <= 30)
      .reduce((sum, row) => {
        const converted = convertAmount(row.item.amount, row.item.currency, settings);
        return converted.converted ? sum + converted.value : sum;
      }, 0);
    const upcoming = active.filter((row) => row.daysLeft <= row.item.reminderDays).length;
    const cancelWindow = active.filter((row) => row.daysLeft <= row.item.cancellationDays).length;
    const categoryTotals = categories.map((cat) => ({
      category: cat,
      value: active
        .filter((row) => row.item.categoryId === cat.id)
        .reduce((sum, row) => sum + row.monthlyConverted.value, 0),
    }));
    return {
      activeCount: active.length,
      monthlyTotal,
      yearlyTotal,
      next30,
      upcoming,
      cancelWindow,
      unconverted,
      categoryTotals,
      budgetUsage: settings.budgetMonthly > 0 ? (monthlyTotal / settings.budgetMonthly) * 100 : 0,
    };
  }, [categories, enriched, settings]);

  const filterCounts = useMemo<Record<FilterKey, number>>(
    () => ({
      all: enriched.length,
      upcoming: enriched.filter(
        (row) => row.item.status === 'active' && row.daysLeft <= row.item.reminderDays
      ).length,
      cancelWindow: enriched.filter(
        (row) => row.item.status === 'active' && row.daysLeft <= row.item.cancellationDays
      ).length,
      active: enriched.filter((row) => row.item.status === 'active').length,
      paused: enriched.filter((row) => row.item.status === 'paused').length,
      cancelled: enriched.filter((row) => row.item.status === 'cancelled').length,
    }),
    [enriched]
  );

  const openEditorWindow = async (request: { mode: 'create' | 'edit'; id?: string }) => {
    setError('');
    window.localStorage.setItem(
      EDITOR_REQUEST_KEY,
      JSON.stringify({ ...request, nonce: Date.now() })
    );
    await invoke('show_tool_window', { label: 'tool-subscription-editor' });
  };

  const beginCreate = () => {
    setMessage('正在打开新增订阅窗口');
    void openEditorWindow({ mode: 'create' }).catch((err) => {
      setError(`打开新增窗口失败：${String(err)}`);
    });
  };

  const beginEdit = (item: SubscriptionItem) => {
    setMessage(`正在打开 ${item.name} 的编辑窗口`);
    void openEditorWindow({ mode: 'edit', id: item.id }).catch((err) => {
      setError(`打开编辑窗口失败：${String(err)}`);
    });
  };

  const deleteItem = (id: string) => {
    const item = items.find((row) => row.id === id);
    if (!item) return;
    if (!window.confirm(`确定删除 ${item.name} 吗？`)) return;
    setItems((current) => current.filter((row) => row.id !== id));
    setMessage(`已删除 ${item.name}`);
  };

  const addCategory = () => {
    const name = window.prompt('分类名称');
    if (!name?.trim()) return;
    setCategories((current) => [
      ...current,
      {
        id: uid(),
        name: name.trim(),
        color: '#2563eb',
      },
    ]);
  };

  const exportJson = () => {
    downloadText(
      `subscriptions-${Date.now()}.json`,
      JSON.stringify({ items, categories, settings }, null, 2),
      'application/json;charset=utf-8'
    );
  };

  const exportSubscriptionsCsv = () => {
    downloadText(
      `subscriptions-${Date.now()}.csv`,
      exportCsv(items, categories),
      'text/csv;charset=utf-8'
    );
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Partial<SubscriptionStore>;
      if (!Array.isArray(data.items)) throw new Error('文件中没有订阅列表');
      setItems(data.items);
      if (Array.isArray(data.categories)) setCategories(data.categories);
      if (data.settings) {
        setSettings({
          ...DEFAULT_SETTINGS,
          ...data.settings,
          exchangeRates: {
            ...DEFAULT_SETTINGS.exchangeRates,
            ...(data.settings.exchangeRates || {}),
          },
        });
      }
      setMessage(`已导入 ${data.items.length} 条订阅`);
    } catch (err) {
      setError(`导入失败：${String(err)}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateRate = (currency: string, value: number) => {
    setSettings((current) => ({
      ...current,
      exchangeRates: {
        ...current.exchangeRates,
        [currency]: clampNumber(value),
      },
    }));
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="📆"
        title="订阅管理"
        subtitle="管理循环扣费、续费提醒、分类预算和订阅成本"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton onClick={beginCreate}>
              <Plus size={14} />
              新增
            </ToolbarButton>
            <ToolbarButton onClick={exportJson} disabled={!items.length}>
              <FileDown size={14} />
              JSON
            </ToolbarButton>
            <ToolbarButton onClick={exportSubscriptionsCsv} disabled={!items.length}>
              <Download size={14} />
              CSV
            </ToolbarButton>
            <ToolbarButton onClick={() => fileInputRef.current?.click()}>
              <FileUp size={14} />
              导入
            </ToolbarButton>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importJson(file);
              }}
            />
          </div>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_360px] gap-3 p-4 max-2xl:grid-cols-[290px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <StatusMessage message={message} error={error} />

          <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Search size={15} />
              搜索筛选
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
              <Search size={15} className="text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="名称、分类、付款方式..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="next">按扣款日期</option>
              <option value="cost">按月成本</option>
              <option value="name">按名称</option>
              <option value="category">按分类</option>
            </select>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Filter size={15} />
              状态
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`flex items-center justify-between rounded-lg border px-2 py-2 text-xs ${
                    filter === key
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                  }`}
                >
                  <span>{label}</span>
                  <span className="font-mono">{filterCounts[key]}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Tag size={15} />
                分类
              </div>
              <button
                onClick={addCategory}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Plus size={15} />
              </button>
            </div>
            <div className="mt-3 space-y-1.5">
              <CategoryButton
                active={category === 'all'}
                label="全部分类"
                count={items.length}
                color="#2563eb"
                onClick={() => setCategory('all')}
              />
              {categories.map((cat) => (
                <CategoryButton
                  key={cat.id}
                  active={category === cat.id}
                  label={cat.name}
                  count={items.filter((item) => item.categoryId === cat.id).length}
                  color={cat.color}
                  onClick={() => setCategory(cat.id)}
                />
              ))}
            </div>
          </section>
        </aside>

        <section className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <section className="grid gap-3 md:grid-cols-4">
            <MetricCard
              icon={<Wallet size={15} />}
              label="月成本"
              value={money(stats.monthlyTotal, settings.baseCurrency)}
              warn={settings.budgetMonthly > 0 && stats.budgetUsage >= 90}
            />
            <MetricCard
              icon={<BarChart3 size={15} />}
              label="年成本"
              value={money(stats.yearlyTotal, settings.baseCurrency)}
            />
            <MetricCard
              icon={<CalendarDays size={15} />}
              label="未来 30 天"
              value={money(stats.next30, settings.baseCurrency)}
              warn={stats.next30 > 0}
            />
            <MetricCard
              icon={<Bell size={15} />}
              label="提醒"
              value={`${stats.upcoming} / ${stats.cancelWindow}`}
              sub="扣款 / 可取消"
              warn={stats.upcoming > 0 || stats.cancelWindow > 0}
            />
          </section>

          {stats.unconverted > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
              有 {stats.unconverted} 个外币订阅未配置汇率，未计入折算总额。
            </div>
          )}

          <section className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {filtered.length ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map((row) => (
                  <SubscriptionRow
                    key={row.item.id}
                    row={row}
                    baseCurrency={settings.baseCurrency}
                    selected={false}
                    onEdit={() => beginEdit(row.item)}
                    onDelete={() => deleteItem(row.item.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center text-gray-400">
                <CreditCard size={32} />
                <div className="mt-2 text-sm">没有匹配的订阅</div>
              </div>
            )}
          </section>
        </section>

        <aside className="flex min-h-0 flex-col gap-3 overflow-auto max-2xl:hidden">
          <SettingsPanel settings={settings} onSettings={setSettings} onRate={updateRate} />
          <StatsPanel stats={stats} categories={categories} currency={settings.baseCurrency} />
        </aside>

        <section className="hidden max-2xl:flex max-2xl:min-h-0 max-2xl:flex-col max-2xl:gap-3 max-2xl:overflow-auto max-lg:flex">
          <SettingsPanel settings={settings} onSettings={setSettings} onRate={updateRate} />
          <StatsPanel stats={stats} categories={categories} currency={settings.baseCurrency} />
        </section>
      </main>
    </div>
  );
}

function CategoryButton({
  active,
  label,
  count,
  color,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm ${
        active
          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
          : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate">{label}</span>
      </span>
      <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
        {count}
      </span>
    </button>
  );
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        {icon}
        {label}
      </div>
      <div
        className={`mt-1 truncate text-lg font-semibold ${warn ? 'text-amber-600 dark:text-amber-300' : ''}`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 truncate text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

function SubscriptionRow({
  row,
  baseCurrency,
  selected,
  onEdit,
  onDelete,
}: {
  row: SubscriptionRowModel;
  baseCurrency: string;
  selected: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { item, next, daysLeft, category } = row;
  const dueSoon = item.status === 'active' && daysLeft <= item.reminderDays;
  const cancelSoon = item.status === 'active' && daysLeft <= item.cancellationDays;
  return (
    <article className={`p-4 ${selected ? 'bg-blue-50/70 dark:bg-blue-900/10' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: category.color }}
            >
              {itemInitial(item)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold">{item.name || '未命名订阅'}</span>
                <Badge
                  tone={
                    item.status === 'active' ? 'ok' : item.status === 'paused' ? 'warn' : undefined
                  }
                >
                  {statusLabel(item.status)}
                </Badge>
                {dueSoon && <Badge tone="warn">即将扣款</Badge>}
                {cancelSoon && <Badge tone="warn">可取消窗口</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                <span>{category.name}</span>
                <span>{cycleLabel(item.billingCycle, item.customDays)}</span>
                {item.paymentMethod && <span>{item.paymentMethod}</span>}
                {item.owner && <span>{item.owner}</span>}
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
            <Info label="原始金额" value={`${money(item.amount, item.currency)} / 次`} />
            <Info
              label="月折算"
              value={
                row.monthlyConverted.converted
                  ? money(row.monthlyConverted.value, baseCurrency)
                  : '未配置汇率'
              }
            />
            <Info label="下次扣款" value={`${toDateInput(next)} (${Math.max(0, daysLeft)} 天)`} />
            <Info
              label="年折算"
              value={
                row.yearlyConverted.converted
                  ? money(row.yearlyConverted.value, baseCurrency)
                  : '未配置汇率'
              }
            />
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <ToolbarButton onClick={onEdit}>
            <Edit3 size={14} />
            编辑
          </ToolbarButton>
          <ToolbarButton onClick={onDelete} danger>
            <Trash2 size={14} />
            删除
          </ToolbarButton>
        </div>
      </div>
    </article>
  );
}

function SettingsPanel({
  settings,
  onSettings,
  onRate,
}: {
  settings: SubscriptionSettings;
  onSettings: (settings: SubscriptionSettings) => void;
  onRate: (currency: string, value: number) => void;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Settings2 size={15} />
        预算与汇率
      </div>
      <div className="mt-3 grid gap-3 text-sm">
        <Field label="基准币种">
          <select
            value={settings.baseCurrency}
            onChange={(event) => onSettings({ ...settings, baseCurrency: event.target.value })}
            className="field"
          >
            {CURRENCIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="月预算">
          <input
            type="number"
            min={0}
            value={settings.budgetMonthly}
            onChange={(event) =>
              onSettings({ ...settings, budgetMonthly: Number(event.target.value) })
            }
            className="field"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {CURRENCIES.map((currency) => (
            <label key={currency} className="block">
              <span className="text-gray-500">{currency} 汇率</span>
              <input
                type="number"
                min={0}
                step={0.0001}
                value={settings.exchangeRates[currency] || 0}
                onChange={(event) => onRate(currency, Number(event.target.value))}
                className="field mt-1"
                disabled={currency === settings.baseCurrency}
              />
            </label>
          ))}
        </div>
      </div>
      <style>{`
        .field {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(229 231 235);
          background: transparent;
          padding: 0.5rem 0.75rem;
          outline: none;
        }
        .dark .field {
          border-color: rgb(55 65 81);
        }
      `}</style>
    </section>
  );
}

function StatsPanel({
  stats,
  categories,
  currency,
}: {
  stats: {
    monthlyTotal: number;
    budgetUsage: number;
    categoryTotals: Array<{ category: SubscriptionCategory; value: number }>;
  };
  categories: SubscriptionCategory[];
  currency: string;
}) {
  const max = Math.max(1, ...stats.categoryTotals.map((item) => item.value));
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BarChart3 size={15} />
        费用分布
      </div>
      <div className="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>预算使用</span>
          <span>{stats.budgetUsage ? `${stats.budgetUsage.toFixed(1)}%` : '未设置'}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
          <div
            className={`h-full rounded-full ${stats.budgetUsage >= 90 ? 'bg-amber-500' : 'bg-blue-600'}`}
            style={{ width: `${Math.min(100, stats.budgetUsage || 0)}%` }}
          />
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {stats.categoryTotals
          .filter((item) => item.value > 0 || categories.some((cat) => cat.id === item.category.id))
          .map((item) => (
            <div key={item.category.id}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: item.category.color }}
                  />
                  <span className="truncate">{item.category.name}</span>
                </span>
                <span className="font-mono">{money(item.value, currency)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(item.value / max) * 100}%`,
                    backgroundColor: item.category.color,
                  }}
                />
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-gray-500">
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-50 px-2 py-1.5 dark:bg-gray-950">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' }) {
  const cls =
    tone === 'ok'
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
      : tone === 'warn'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
  return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{children}</span>;
}
