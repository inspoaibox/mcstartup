import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Copy,
  CreditCard,
  Pencil,
  Phone,
  Plus,
  RefreshCcw,
  Search,
  Smartphone,
  Trash2,
  Wifi,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { EmptyState } from './systemToolUtils';
import {
  ESIM_MANAGER_VERSION,
  useToolDataStore,
  type EsimLineStatus,
  type EsimLineType,
  type EsimNumberRecord,
  type EsimRenewalLog,
} from '../stores/toolDataStore';

type RiskKey = 'safe' | 'attention' | 'urgent' | 'expired' | 'paused' | 'archived';
type FilterKey = 'all' | RiskKey;

interface EnrichedNumber {
  item: EsimNumberRecord;
  daysLeft: number | null;
  risk: RiskKey;
}

const LINE_TYPE_META: Record<EsimLineType, { label: string; icon: ReactNode; tone: string }> = {
  'phone-number': {
    label: '手机号码',
    icon: <Phone size={14} />,
    tone: 'bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-900/30 dark:text-blue-200 dark:ring-blue-800',
  },
  esim: {
    label: 'eSIM',
    icon: <Wifi size={14} />,
    tone: 'bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-900/30 dark:text-violet-200 dark:ring-violet-800',
  },
  'physical-sim': {
    label: '实体 SIM',
    icon: <CreditCard size={14} />,
    tone: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
  },
};

const STATUS_META: Record<
  RiskKey,
  { label: string; helper: string; tone: string; border: string; icon: ReactNode }
> = {
  safe: {
    label: '状态安全',
    helper: '>45 天',
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-200 dark:ring-emerald-800',
    border: 'border-l-emerald-400',
    icon: <CheckCircle2 size={15} />,
  },
  attention: {
    label: '建议关注',
    helper: '<=45 天',
    tone: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-200 dark:ring-amber-800',
    border: 'border-l-amber-400',
    icon: <CalendarClock size={15} />,
  },
  urgent: {
    label: '告警/过期',
    helper: '<=15 天',
    tone: 'bg-orange-50 text-orange-700 ring-orange-100 dark:bg-orange-900/25 dark:text-orange-200 dark:ring-orange-800',
    border: 'border-l-orange-500',
    icon: <AlertTriangle size={15} />,
  },
  expired: {
    label: '已过期',
    helper: '需处理',
    tone: 'bg-red-50 text-red-700 ring-red-100 dark:bg-red-900/25 dark:text-red-200 dark:ring-red-800',
    border: 'border-l-red-500',
    icon: <AlertTriangle size={15} />,
  },
  paused: {
    label: '暂停使用',
    helper: '暂不提醒',
    tone: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
    border: 'border-l-slate-300',
    icon: <CalendarClock size={15} />,
  },
  archived: {
    label: '已归档',
    helper: '隐藏',
    tone: 'bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700',
    border: 'border-l-zinc-300',
    icon: <Archive size={15} />,
  },
};

const FILTERS: Array<[FilterKey, string]> = [
  ['all', '全部'],
  ['safe', '安全'],
  ['attention', '关注'],
  ['urgent', '告警'],
  ['expired', '过期'],
  ['paused', '暂停'],
  ['archived', '归档'],
];

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function localDateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

function daysUntil(value?: string) {
  if (!value) return null;
  const target = localDateParts(value);
  const today = localDateParts(todayInput());
  if (target === null || today === null) return null;
  return Math.ceil((target - today) / 86_400_000);
}

function addDays(value: string, days: number) {
  const base = localDateParts(value) ?? localDateParts(todayInput())!;
  const next = new Date(base + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

function riskFor(item: EsimNumberRecord): RiskKey {
  if (item.archivedAt) return 'archived';
  if (item.status === 'paused') return 'paused';
  const left = daysUntil(item.expiryDate);
  if (left === null) return 'attention';
  if (left < 0) return 'expired';
  if (left <= Math.min(15, item.reminderDays || 15)) return 'urgent';
  if (left <= 45) return 'attention';
  return 'safe';
}

function formatDate(value?: string) {
  if (!value) return '';
  const time = localDateParts(value);
  if (time === null) return value;
  return new Date(time).toLocaleDateString('zh-CN');
}

function formatMoney(value: number, currency: string) {
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${currency || 'USD'} ${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

function toNumber(value: string | number, fallback = 0) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function normalizeNumber(record: EsimNumberRecord): EsimNumberRecord {
  const now = new Date().toISOString();
  return {
    ...record,
    displayName: record.displayName || '',
    provider: record.provider || '',
    lineType: record.lineType || 'phone-number',
    country: record.country || '',
    countryCode: record.countryCode || '',
    phoneNumber: record.phoneNumber || '',
    iccid: record.iccid || '',
    planName: record.planName || '',
    usagePurpose: record.usagePurpose || '',
    keeper: record.keeper || '',
    accountEmail: record.accountEmail || '',
    loginUrl: record.loginUrl || '',
    renewalMethod: record.renewalMethod || '',
    renewalCycleDays: Math.max(1, toNumber(record.renewalCycleDays, 180)),
    activationDate: record.activationDate || '',
    expiryDate: record.expiryDate || '',
    reminderDays: Math.max(1, toNumber(record.reminderDays, 15)),
    costAmount: Math.max(0, toNumber(record.costAmount, 0)),
    currency: record.currency || 'USD',
    status: record.status || 'active',
    tags: Array.isArray(record.tags) ? record.tags : [],
    notes: record.notes || '',
    renewalLogs: Array.isArray(record.renewalLogs) ? record.renewalLogs : [],
    archivedAt: record.archivedAt || '',
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
  };
}

function createEmptyNumber(): EsimNumberRecord {
  const now = new Date().toISOString();
  return {
    id: uid('esim'),
    displayName: '',
    provider: '',
    lineType: 'phone-number',
    country: '',
    countryCode: '',
    phoneNumber: '',
    iccid: '',
    planName: '',
    usagePurpose: '',
    keeper: '',
    accountEmail: '',
    loginUrl: '',
    renewalMethod: '',
    renewalCycleDays: 180,
    activationDate: todayInput(),
    expiryDate: addDays(todayInput(), 180),
    reminderDays: 15,
    costAmount: 0,
    currency: 'USD',
    status: 'active',
    tags: [],
    notes: '',
    renewalLogs: [],
    archivedAt: '',
    createdAt: now,
    updatedAt: now,
  };
}

function displayTitle(item: EsimNumberRecord) {
  return item.displayName || item.provider || item.phoneNumber || '新号码';
}

function displayNumber(item: EsimNumberRecord) {
  return [item.countryCode, item.phoneNumber].filter(Boolean).join(' ');
}

function splitTags(value: string) {
  return value
    .split(/[,，、;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function EsimManagerTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateEsimManagerData } = useToolDataStore();
  const [numbers, setNumbers] = useState<EsimNumberRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [country, setCountry] = useState('all');
  const [editing, setEditing] = useState<EsimNumberRecord | null>(null);
  const [deleting, setDeleting] = useState<EsimNumberRecord | null>(null);
  const [message, setMessage] = useState('数据仅保存在本机工具箱数据文件。');
  const hydratingRef = useRef(false);

  useEffect(() => {
    if (!loaded) void loadData();
  }, [loadData, loaded]);

  useEffect(() => {
    if (!loaded) return;
    hydratingRef.current = true;
    setNumbers((data.esimManager?.numbers || []).map(normalizeNumber));
  }, [data.esimManager?.numbers, loaded]);

  useEffect(() => {
    if (!loaded) return;
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    updateEsimManagerData({
      version: ESIM_MANAGER_VERSION,
      numbers,
    });
  }, [loaded, numbers, updateEsimManagerData]);

  const enriched = useMemo<EnrichedNumber[]>(
    () =>
      numbers.map((item) => ({
        item,
        daysLeft: daysUntil(item.expiryDate),
        risk: riskFor(item),
      })),
    [numbers]
  );

  const countries = useMemo(() => {
    const values = new Set<string>();
    numbers.forEach((item) => {
      if (item.country) values.add(item.country);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [numbers]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return enriched
      .filter(({ item, risk }) => {
        if (filter !== 'all' && risk !== filter) return false;
        if (country !== 'all' && item.country !== country) return false;
        if (!keyword) return true;
        return [
          item.displayName,
          item.provider,
          item.country,
          item.countryCode,
          item.phoneNumber,
          item.iccid,
          item.planName,
          item.usagePurpose,
          item.keeper,
          item.accountEmail,
          item.renewalMethod,
          item.notes,
          item.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      })
      .sort((a, b) => {
        if (a.risk === 'archived' && b.risk !== 'archived') return 1;
        if (a.risk !== 'archived' && b.risk === 'archived') return -1;
        const left = a.daysLeft ?? 9999;
        const right = b.daysLeft ?? 9999;
        return left - right;
      });
  }, [country, enriched, filter, search]);

  const stats = useMemo(() => {
    const active = enriched.filter(({ risk }) => risk !== 'archived');
    const safe = active.filter(({ risk }) => risk === 'safe').length;
    const attention = active.filter(({ risk }) => risk === 'attention').length;
    const urgent = active.filter(({ risk }) => risk === 'urgent' || risk === 'expired').length;
    const paused = active.filter(({ risk }) => risk === 'paused').length;
    const upcoming = active
      .filter(({ daysLeft }) => daysLeft !== null && daysLeft >= 0)
      .sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999))[0];
    return {
      safe,
      attention,
      urgent,
      paused,
      archived: enriched.filter(({ risk }) => risk === 'archived').length,
      total: active.length,
      upcoming,
    };
  }, [enriched]);

  const updateNumbers = (updater: (current: EsimNumberRecord[]) => EsimNumberRecord[]) => {
    setNumbers((current) => updater(current).map(normalizeNumber));
  };

  const handleSave = (record: EsimNumberRecord) => {
    const nextRecord = normalizeNumber({
      ...record,
      updatedAt: new Date().toISOString(),
    });
    updateNumbers((current) => {
      const exists = current.some((item) => item.id === nextRecord.id);
      if (exists) return current.map((item) => (item.id === nextRecord.id ? nextRecord : item));
      return [nextRecord, ...current];
    });
    setEditing(null);
    setMessage('号码资料已保存。');
  };

  const handleQuickRenew = (record: EsimNumberRecord) => {
    const base =
      record.expiryDate && (daysUntil(record.expiryDate) ?? -1) > 0
        ? record.expiryDate
        : todayInput();
    const nextExpiryDate = addDays(base, Math.max(1, record.renewalCycleDays || 180));
    const log: EsimRenewalLog = {
      id: uid('renew'),
      date: todayInput(),
      amount: Math.max(0, record.costAmount || 0),
      currency: record.currency || 'USD',
      nextExpiryDate,
      note: '快速续费',
    };
    updateNumbers((current) =>
      current.map((item) =>
        item.id === record.id
          ? {
              ...item,
              expiryDate: nextExpiryDate,
              status: 'active',
              renewalLogs: [log, ...item.renewalLogs],
              updatedAt: new Date().toISOString(),
            }
          : item
      )
    );
    setMessage(`${displayTitle(record)} 已续费到 ${formatDate(nextExpiryDate)}。`);
  };

  const handleArchive = (record: EsimNumberRecord, archived: boolean) => {
    updateNumbers((current) =>
      current.map((item) =>
        item.id === record.id
          ? {
              ...item,
              archivedAt: archived ? new Date().toISOString() : '',
              updatedAt: new Date().toISOString(),
            }
          : item
      )
    );
    setMessage(archived ? '已归档。' : '已恢复。');
  };

  const handleDelete = () => {
    if (!deleting) return;
    updateNumbers((current) => current.filter((item) => item.id !== deleting.id));
    setDeleting(null);
    setMessage('号码已删除。');
  };

  const handleCopy = async (record: EsimNumberRecord) => {
    const text = displayNumber(record);
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setMessage('号码已复制。');
  };

  const headerActions = (
    <button
      onClick={() => setEditing(createEmptyNumber())}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
    >
      <Plus size={15} />
      添加号码
    </button>
  );

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <ToolHeader
        icon={<Smartphone size={18} className="text-blue-600" />}
        title="手机号码 eSIM 管理"
        subtitle="管理多国家手机号、eSIM / SIM 卡有效期、续费提醒和使用资料"
        actions={headerActions}
      />

      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4">
          <section className="rounded-xl border border-white/60 bg-gradient-to-br from-fuchsia-100 via-sky-100 to-emerald-50 p-4 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-blue-950 dark:to-emerald-950">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/70 pb-4 dark:border-slate-800">
              <div>
                <h2 className="text-xl font-bold text-slate-950 dark:text-white">eSIM 保号看板</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  今日：{formatDate(todayInput())}
                  {stats.upcoming
                    ? ` · 最近到期：${displayTitle(stats.upcoming.item)} ${stats.upcoming.daysLeft} 天`
                    : ''}
                </p>
              </div>
              <div className="rounded-full bg-white/75 px-3 py-1 text-xs text-slate-600 shadow-sm dark:bg-slate-900/70 dark:text-slate-300">
                {message}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="安全"
                value={stats.safe}
                helper="剩余 >45 天"
                tone="border-l-emerald-400"
                icon={<CheckCircle2 size={18} />}
              />
              <StatCard
                label="建议关注"
                value={stats.attention}
                helper="45 天内到期"
                tone="border-l-amber-400"
                icon={<CalendarClock size={18} />}
              />
              <StatCard
                label="告警/过期"
                value={stats.urgent}
                helper="15 天内或已过期"
                tone="border-l-red-500"
                icon={<AlertTriangle size={18} />}
              />
              <StatCard
                label="暂停使用"
                value={stats.paused}
                helper="暂不参与提醒"
                tone="border-l-slate-400"
                icon={<Archive size={18} />}
              />
              <StatCard
                label="管理中"
                value={stats.total}
                helper={`已归档 ${stats.archived}`}
                tone="border-l-blue-500"
                icon={<Smartphone size={18} />}
              />
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="relative min-w-[260px] flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索国家、号码、运营商、用途、账号、备注..."
                className={inputClassName('pl-9')}
              />
            </div>
            <select
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className={inputClassName('w-36')}
            >
              <option value="all">所有国家</option>
              {countries.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-950">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    filter === key
                      ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-800 dark:text-blue-200'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {filtered.length ? (
            <NumbersTable
              rows={filtered}
              onEdit={setEditing}
              onRenew={handleQuickRenew}
              onCopy={(item) => {
                void handleCopy(item);
              }}
              onArchive={(item) => handleArchive(item, !item.archivedAt)}
              onDelete={setDeleting}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <EmptyState
                icon={<Smartphone size={44} />}
                text="暂无匹配号码，添加一个手机号或 eSIM 开始管理"
              />
            </div>
          )}
        </div>
      </main>

      {editing && (
        <NumberEditor record={editing} onCancel={() => setEditing(null)} onSave={handleSave} />
      )}

      {deleting && (
        <ConfirmDialog
          title="删除号码"
          body={`确定删除 ${displayTitle(deleting)}？这个操作会同步更新本机工具数据。`}
          confirmText="删除"
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  helper,
  tone,
  icon,
}: {
  label: string;
  value: number;
  helper: string;
  tone: string;
  icon: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-white/70 border-l-4 ${tone} bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80`}
    >
      <div className="flex items-center justify-between gap-3 text-slate-500 dark:text-slate-400">
        <span className="text-xs font-semibold">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{helper}</div>
    </div>
  );
}

function NumbersTable({
  rows,
  onEdit,
  onRenew,
  onCopy,
  onArchive,
  onDelete,
}: {
  rows: EnrichedNumber[];
  onEdit: (item: EsimNumberRecord) => void;
  onRenew: (item: EsimNumberRecord) => void;
  onCopy: (item: EsimNumberRecord) => void;
  onArchive: (item: EsimNumberRecord) => void;
  onDelete: (item: EsimNumberRecord) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="overflow-auto">
        <table className="min-w-[1080px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-950 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-semibold">名称/运营商</th>
              <th className="px-4 py-3 font-semibold">号码</th>
              <th className="px-4 py-3 font-semibold">国家</th>
              <th className="px-4 py-3 font-semibold">类型</th>
              <th className="px-4 py-3 font-semibold">到期日</th>
              <th className="px-4 py-3 font-semibold">剩余</th>
              <th className="px-4 py-3 font-semibold">用途</th>
              <th className="px-4 py-3 font-semibold">费用</th>
              <th className="px-4 py-3 font-semibold">状态</th>
              <th className="px-4 py-3 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map(({ item, daysLeft, risk }) => (
              <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-950/70">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    {displayTitle(item)}
                  </div>
                  <div className="text-xs text-slate-500">{item.provider}</div>
                </td>
                <td className="px-4 py-3 font-medium">{displayNumber(item)}</td>
                <td className="px-4 py-3">{item.country}</td>
                <td className="px-4 py-3">{LINE_TYPE_META[item.lineType].label}</td>
                <td className="px-4 py-3">{formatDate(item.expiryDate)}</td>
                <td className="px-4 py-3">
                  {daysLeft === null
                    ? ''
                    : daysLeft < 0
                      ? `过期 ${Math.abs(daysLeft)} 天`
                      : `${daysLeft} 天`}
                </td>
                <td className="max-w-[220px] truncate px-4 py-3">{item.usagePurpose}</td>
                <td className="px-4 py-3">{formatMoney(item.costAmount, item.currency)}</td>
                <td className="px-4 py-3">
                  <Badge className={STATUS_META[risk].tone}>{STATUS_META[risk].label}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <IconButton
                      onClick={() => onRenew(item)}
                      title="续费"
                      disabled={Boolean(item.archivedAt)}
                    >
                      <RefreshCcw size={15} />
                    </IconButton>
                    <IconButton onClick={() => onCopy(item)} title="复制号码">
                      <Copy size={15} />
                    </IconButton>
                    <IconButton onClick={() => onEdit(item)} title="编辑">
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton
                      onClick={() => onArchive(item)}
                      title={item.archivedAt ? '恢复' : '归档'}
                    >
                      {item.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                    </IconButton>
                    <IconButton onClick={() => onDelete(item)} title="删除" danger>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NumberEditor({
  record,
  onCancel,
  onSave,
}: {
  record: EsimNumberRecord;
  onCancel: () => void;
  onSave: (record: EsimNumberRecord) => void;
}) {
  const [draft, setDraft] = useState(() => normalizeNumber(record));
  const [tagText, setTagText] = useState(() => record.tags.join('，'));

  const patch = (value: Partial<EsimNumberRecord>) => {
    setDraft((current) => ({
      ...current,
      ...value,
    }));
  };

  const submit = () => {
    onSave({
      ...draft,
      tags: splitTags(tagText),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">
              {record.displayName || record.phoneNumber ? '编辑号码' : '添加号码'}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              未填写的字段会保持为空。
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <EditorSection title="基础信息">
              <Field label="名称">
                <input
                  value={draft.displayName}
                  onChange={(event) => patch({ displayName: event.target.value })}
                  className={inputClassName()}
                />
              </Field>
              <Field label="运营商/平台">
                <input
                  value={draft.provider}
                  onChange={(event) => patch({ provider: event.target.value })}
                  placeholder="Lycamobile / Giffgaff / A1..."
                  className={inputClassName()}
                />
              </Field>
              <Field label="类型">
                <select
                  value={draft.lineType}
                  onChange={(event) => patch({ lineType: event.target.value as EsimLineType })}
                  className={inputClassName()}
                >
                  <option value="phone-number">手机号码</option>
                  <option value="esim">eSIM</option>
                  <option value="physical-sim">实体 SIM</option>
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="国家/地区">
                  <input
                    value={draft.country}
                    onChange={(event) => patch({ country: event.target.value })}
                    placeholder="英国 / 美国 / 荷兰..."
                    className={inputClassName()}
                  />
                </Field>
                <Field label="区号">
                  <input
                    value={draft.countryCode}
                    onChange={(event) => patch({ countryCode: event.target.value })}
                    placeholder="+44"
                    className={inputClassName()}
                  />
                </Field>
              </div>
              <Field label="手机号码">
                <input
                  value={draft.phoneNumber}
                  onChange={(event) => patch({ phoneNumber: event.target.value })}
                  className={inputClassName()}
                />
              </Field>
              <Field label="ICCID / 卡号">
                <input
                  value={draft.iccid}
                  onChange={(event) => patch({ iccid: event.target.value })}
                  className={inputClassName()}
                />
              </Field>
            </EditorSection>

            <EditorSection title="有效期与续费">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="激活日期">
                  <input
                    type="date"
                    value={draft.activationDate}
                    onChange={(event) => patch({ activationDate: event.target.value })}
                    className={inputClassName()}
                  />
                </Field>
                <Field label="到期日期">
                  <input
                    type="date"
                    value={draft.expiryDate}
                    onChange={(event) => patch({ expiryDate: event.target.value })}
                    className={inputClassName()}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="续费周期（天）">
                  <input
                    type="number"
                    min={1}
                    value={draft.renewalCycleDays}
                    onChange={(event) =>
                      patch({ renewalCycleDays: toNumber(event.target.value, 180) })
                    }
                    className={inputClassName()}
                  />
                </Field>
                <Field label="提醒提前量（天）">
                  <input
                    type="number"
                    min={1}
                    value={draft.reminderDays}
                    onChange={(event) => patch({ reminderDays: toNumber(event.target.value, 15) })}
                    className={inputClassName()}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="续费金额">
                  <input
                    type="number"
                    min={0}
                    value={draft.costAmount}
                    onChange={(event) => patch({ costAmount: toNumber(event.target.value) })}
                    className={inputClassName()}
                  />
                </Field>
                <Field label="币种">
                  <input
                    value={draft.currency}
                    onChange={(event) => patch({ currency: event.target.value.toUpperCase() })}
                    placeholder="USD / GBP / EUR"
                    className={inputClassName()}
                  />
                </Field>
              </div>
              <Field label="续费方式">
                <textarea
                  value={draft.renewalMethod}
                  onChange={(event) => patch({ renewalMethod: event.target.value })}
                  rows={3}
                  placeholder="如 180 天内收发一次短信、充值、官网续费..."
                  className={inputClassName('min-h-[86px]')}
                />
              </Field>
              <Field label="状态">
                <select
                  value={draft.status}
                  onChange={(event) => patch({ status: event.target.value as EsimLineStatus })}
                  className={inputClassName()}
                >
                  <option value="active">启用</option>
                  <option value="paused">暂停提醒</option>
                </select>
              </Field>
            </EditorSection>

            <EditorSection title="账号与用途">
              <Field label="套餐/计划">
                <input
                  value={draft.planName}
                  onChange={(event) => patch({ planName: event.target.value })}
                  className={inputClassName()}
                />
              </Field>
              <Field label="使用用途">
                <input
                  value={draft.usagePurpose}
                  onChange={(event) => patch({ usagePurpose: event.target.value })}
                  placeholder="Telegram / 店铺验证 / 银行 / 客户..."
                  className={inputClassName()}
                />
              </Field>
              <Field label="负责人">
                <input
                  value={draft.keeper}
                  onChange={(event) => patch({ keeper: event.target.value })}
                  className={inputClassName()}
                />
              </Field>
              <Field label="登录邮箱/账号">
                <input
                  value={draft.accountEmail}
                  onChange={(event) => patch({ accountEmail: event.target.value })}
                  className={inputClassName()}
                />
              </Field>
              <Field label="登录/续费链接">
                <input
                  value={draft.loginUrl}
                  onChange={(event) => patch({ loginUrl: event.target.value })}
                  placeholder="https://..."
                  className={inputClassName()}
                />
              </Field>
              <Field label="标签">
                <input
                  value={tagText}
                  onChange={(event) => setTagText(event.target.value)}
                  placeholder="英国，店铺验证，Telegram"
                  className={inputClassName()}
                />
              </Field>
            </EditorSection>

            <EditorSection title="备注与续费记录">
              <Field label="备注">
                <textarea
                  value={draft.notes}
                  onChange={(event) => patch({ notes: event.target.value })}
                  rows={5}
                  className={inputClassName('min-h-[120px]')}
                />
              </Field>
              <div>
                <div className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  续费记录
                </div>
                <div className="max-h-48 space-y-2 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950">
                  {draft.renewalLogs.length ? (
                    draft.renewalLogs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-md bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-800 dark:text-white">
                            {formatDate(log.date)}
                          </span>
                          <span>{formatMoney(log.amount, log.currency)}</span>
                        </div>
                        <div className="mt-1">续费到：{formatDate(log.nextExpiryDate)}</div>
                        {log.note && <div className="mt-1">{log.note}</div>}
                      </div>
                    ))
                  ) : (
                    <div className="py-8 text-center text-xs text-slate-400">暂无续费记录</div>
                  )}
                </div>
              </div>
            </EditorSection>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            取消
          </button>
          <button
            onClick={submit}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmText,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmText: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-bold text-slate-950 dark:text-white">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
      <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ring-1 ${className}`}
    >
      {children}
    </span>
  );
}

function IconButton({
  children,
  onClick,
  title,
  danger,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20'
          : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

function inputClassName(extra = '') {
  return `w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-900/40 ${extra}`;
}
