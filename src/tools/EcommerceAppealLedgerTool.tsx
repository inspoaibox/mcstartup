import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ClipboardList,
  Copy,
  Eye,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  WalletCards,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  useToolDataStore,
  type EcommerceAppealLedgerRecord,
  type EcommerceAppealLedgerStatus,
  type EcommerceAppealSettlementStatus,
  type EcommercePlatform,
} from '../stores/toolDataStore';

const LEDGER_VERSION = 'mcheng-ecommerce-appeal-ledger-v1';

const PLATFORM_META: Record<EcommercePlatform, { label: string; tone: string }> = {
  amazon: { label: 'Amazon', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  walmart: { label: 'Walmart', tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  shein: { label: 'SHEIN', tone: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200' },
  temu: { label: 'Temu', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  tiktok: { label: 'TikTok', tone: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  other: { label: '其他', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
};

const APPEAL_STATUS_META: Record<EcommerceAppealLedgerStatus, { label: string; tone: string }> = {
  'pending-review': { label: '待审核', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
  preparing: { label: '准备资料', tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  submitted: { label: '已提交', tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  'waiting-platform': { label: '等平台', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  'need-material': { label: '补资料', tone: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  successful: { label: '成功', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  failed: { label: '失败', tone: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  cancelled: { label: '取消', tone: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
};

const SETTLEMENT_STATUS_META: Record<EcommerceAppealSettlementStatus, { label: string; tone: string }> = {
  unsettled: { label: '未结算', tone: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  partial: { label: '部分结算', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  settled: { label: '已结算', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  refunded: { label: '已退款', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  waived: { label: '免收', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
};

const PLATFORMS: EcommercePlatform[] = ['amazon', 'walmart', 'shein', 'temu', 'tiktok', 'other'];
const COUNTRY_SPLIT_PATTERN = /[\/、,，;；|]+/;

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value: string | number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function formatDate(value?: string) {
  if (!value) return '未设置';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  return new Date(value).toLocaleDateString('zh-CN');
}

function splitCountryValues(value?: string) {
  return (value || '')
    .split(COUNTRY_SPLIT_PATTERN)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatMoney(value: number, currency = 'CNY') {
  return `${currency || 'CNY'} ${Number(value || 0).toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
  })}`;
}

function createEmptyRecord(): EcommerceAppealLedgerRecord {
  const now = new Date().toISOString();
  return {
    id: uid('appeal-ledger'),
    clientWechat: '',
    storeName: '',
    platform: '',
    country: '',
    subjectName: '',
    browserProfile: '',
    loginCompanyName: '',
    account: '',
    password: '',
    suspensionReason: '',
    appealStatus: 'pending-review',
    appealDate: todayInput(),
    appealResult: '',
    resultFeedbackDate: '',
    chargeAmount: 0,
    currency: 'CNY',
    settlementStatus: 'unsettled',
    settlementDate: '',
    settlementNote: '',
    markNote: '',
    handler: '',
    followUpDate: '',
    notes: '',
    archivedAt: '',
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeRecord(record: EcommerceAppealLedgerRecord): EcommerceAppealLedgerRecord {
  return {
    ...record,
    clientWechat: record.clientWechat || '',
    storeName: record.storeName || '',
    platform: record.platform || '',
    country: record.country || '',
    subjectName: record.subjectName || '',
    browserProfile: record.browserProfile || '',
    loginCompanyName: record.loginCompanyName || '',
    account: record.account || '',
    password: record.password || '',
    suspensionReason: record.suspensionReason || '',
    appealStatus: record.appealStatus || 'pending-review',
    appealDate: record.appealDate || '',
    appealResult: record.appealResult || '',
    resultFeedbackDate: record.resultFeedbackDate || '',
    chargeAmount: Number.isFinite(record.chargeAmount) ? record.chargeAmount : 0,
    currency: record.currency || 'CNY',
    settlementStatus: record.settlementStatus || 'unsettled',
    settlementDate: record.settlementDate || '',
    settlementNote: record.settlementNote || '',
    markNote: record.markNote || '',
    handler: record.handler || '',
    followUpDate: record.followUpDate || '',
    notes: record.notes || '',
    archivedAt: record.archivedAt || '',
  };
}

function cloneRecord(record: EcommerceAppealLedgerRecord) {
  const now = new Date().toISOString();
  return normalizeRecord({
    ...record,
    id: uid('appeal-ledger'),
    storeName: `${record.storeName} 副本`,
    appealDate: todayInput(),
    appealStatus: 'pending-review',
    resultFeedbackDate: '',
    settlementStatus: 'unsettled',
    settlementDate: '',
    archivedAt: '',
    createdAt: now,
    updatedAt: now,
  });
}

function getRecordReport(record: EcommerceAppealLedgerRecord) {
  return [
    `# ${record.storeName || '跨境电商申诉记录'}`,
    '',
    `- 对接微信：${record.clientWechat || '未填写'}`,
    `- 店铺：${record.storeName || '未填写'}`,
    `- 平台：${record.platform ? PLATFORM_META[record.platform].label : '未填写'}`,
    `- 国家：${record.country || '未填写'}`,
    `- 主体：${record.subjectName || '未填写'}`,
    `- 浏览器：${record.browserProfile || '未填写'}`,
    `- 登录公司名：${record.loginCompanyName || '未填写'}`,
    `- 账号：${record.account || '未填写'}`,
    `- 密码：${record.password || '未填写'}`,
    `- 暂停原因：${record.suspensionReason || '未填写'}`,
    `- 申诉状态：${APPEAL_STATUS_META[record.appealStatus].label}`,
    `- 申诉时间：${formatDate(record.appealDate)}`,
    `- 申诉结果：${record.appealResult || '未填写'}`,
    `- 结果反馈时间：${formatDate(record.resultFeedbackDate)}`,
    `- 收费金额：${formatMoney(record.chargeAmount, record.currency)}`,
    `- 结算：${SETTLEMENT_STATUS_META[record.settlementStatus].label}`,
    `- 结算时间：${formatDate(record.settlementDate)}`,
    `- 结算情况：${record.settlementNote || '未填写'}`,
    `- 标记情况：${record.markNote || '未填写'}`,
    `- 处理人：${record.handler || '未填写'}`,
    `- 下次跟进：${formatDate(record.followUpDate)}`,
    `- 归档时间：${record.archivedAt ? formatDate(record.archivedAt) : '未归档'}`,
    '',
    '## 备注',
    record.notes || '暂无',
  ].join('\n');
}

export default function EcommerceAppealLedgerTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateEcommerceAppealLedgerData } = useToolDataStore();
  const [records, setRecords] = useState<EcommerceAppealLedgerRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | EcommercePlatform>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | EcommerceAppealLedgerStatus>('all');
  const [settlementFilter, setSettlementFilter] = useState<'all' | EcommerceAppealSettlementStatus>('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editingRecord, setEditingRecord] = useState<EcommerceAppealLedgerRecord | null>(null);
  const [previewRecord, setPreviewRecord] = useState<EcommerceAppealLedgerRecord | null>(null);
  const [pendingDeleteRecord, setPendingDeleteRecord] = useState<EcommerceAppealLedgerRecord | null>(null);
  const hydratingRef = useRef(false);

  useEffect(() => {
    if (!loaded) {
      loadData();
    }
  }, [loaded, loadData]);

  useEffect(() => {
    if (!loaded) return;
    hydratingRef.current = true;
    setRecords((data.ecommerceAppealLedger?.records || []).map(normalizeRecord));
  }, [loaded, data.ecommerceAppealLedger?.records]);

  useEffect(() => {
    if (!loaded) return;
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    updateEcommerceAppealLedgerData({
      version: LEDGER_VERSION,
      records,
    });
  }, [records, loaded, updateEcommerceAppealLedgerData]);

  useEffect(() => {
    if (!records.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !records.some((record) => record.id === selectedId)) {
      setSelectedId(records[0].id);
    }
  }, [records, selectedId]);

  const countryOptions = useMemo(
    () =>
      Array.from(new Set(records.flatMap((record) => splitCountryValues(record.country)))).sort((a, b) =>
        a.localeCompare(b, 'zh-CN')
      ),
    [records]
  );

  useEffect(() => {
    if (countryFilter !== 'all' && !countryOptions.includes(countryFilter)) {
      setCountryFilter('all');
    }
  }, [countryFilter, countryOptions]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const keyword = search.trim().toLowerCase();
      const countries = splitCountryValues(record.country);
      const archived = Boolean(record.archivedAt);
      const haystack = [
        record.clientWechat,
        record.storeName,
        record.platform ? PLATFORM_META[record.platform].label : '',
        record.country,
        record.subjectName,
        record.browserProfile,
        record.loginCompanyName,
        record.account,
        record.suspensionReason,
        APPEAL_STATUS_META[record.appealStatus].label,
        record.appealDate,
        record.appealResult,
        record.settlementNote,
        record.markNote,
        record.handler,
        record.notes,
      ]
        .join(' ')
        .toLowerCase();

      return (
        (viewMode === 'archived' ? archived : !archived) &&
        (platformFilter === 'all' || record.platform === platformFilter) &&
        (statusFilter === 'all' || record.appealStatus === statusFilter) &&
        (settlementFilter === 'all' || record.settlementStatus === settlementFilter) &&
        (countryFilter === 'all' || countries.includes(countryFilter)) &&
        (!keyword || haystack.includes(keyword))
      );
    });
  }, [records, search, platformFilter, statusFilter, settlementFilter, countryFilter, viewMode]);

  const stats = useMemo(() => {
    const activeRecords = records.filter((record) => !record.archivedAt);
    const archivedRecords = records.filter((record) => record.archivedAt);
    const visibleRecords = viewMode === 'archived' ? archivedRecords : activeRecords;
    const totalCharge = visibleRecords.reduce((sum, record) => sum + record.chargeAmount, 0);
    const unsettledAmount = visibleRecords
      .filter((record) => record.settlementStatus === 'unsettled' || record.settlementStatus === 'partial')
      .reduce((sum, record) => sum + record.chargeAmount, 0);
    const processingCount = visibleRecords.filter(
      (record) =>
        record.appealStatus !== 'successful' &&
        record.appealStatus !== 'failed' &&
        record.appealStatus !== 'cancelled'
    ).length;
    const successCount = visibleRecords.filter((record) => record.appealStatus === 'successful').length;
    return {
      activeCount: activeRecords.length,
      archivedCount: archivedRecords.length,
      totalCharge,
      unsettledAmount,
      processingCount,
      successCount,
      visibleCount: visibleRecords.length,
    };
  }, [records, viewMode]);

  function upsertRecord(record: EcommerceAppealLedgerRecord) {
    const normalized = normalizeRecord({
      ...record,
      clientWechat: record.clientWechat.trim(),
      storeName: record.storeName.trim(),
      country: record.country.trim(),
      subjectName: record.subjectName.trim(),
      browserProfile: record.browserProfile.trim(),
      loginCompanyName: record.loginCompanyName.trim(),
      account: record.account.trim(),
      password: record.password.trim(),
      suspensionReason: record.suspensionReason.trim(),
      appealResult: record.appealResult.trim(),
      chargeAmount: Number.isFinite(record.chargeAmount) ? record.chargeAmount : 0,
      currency: record.currency.trim() || 'CNY',
      settlementNote: record.settlementNote.trim(),
      markNote: record.markNote.trim(),
      handler: record.handler.trim(),
      notes: record.notes.trim(),
      updatedAt: new Date().toISOString(),
    });

    if (!normalized.clientWechat && !normalized.storeName) {
      setError('请至少填写对接微信或店铺名称');
      return;
    }

    setRecords((current) => {
      const exists = current.some((item) => item.id === normalized.id);
      if (exists) return current.map((item) => (item.id === normalized.id ? normalized : item));
      return [normalized, ...current];
    });
    setSelectedId(normalized.id);
    setEditingRecord(null);
    setError('');
    setMessage('申诉记录已保存');
  }

  async function copyText(text: string, success: string) {
    await navigator.clipboard.writeText(text);
    setMessage(success);
    setError('');
  }

  async function copyReport(record: EcommerceAppealLedgerRecord) {
    await copyText(getRecordReport(record), '申诉记录已复制');
  }

  function confirmDelete(record: EcommerceAppealLedgerRecord) {
    setRecords((current) => current.filter((item) => item.id !== record.id));
    setPendingDeleteRecord(null);
    if (selectedId === record.id) setSelectedId(null);
    if (previewRecord?.id === record.id) setPreviewRecord(null);
    setMessage('申诉记录已删除');
  }

  function toggleArchive(record: EcommerceAppealLedgerRecord, archived: boolean) {
    const archivedAt = archived ? new Date().toISOString() : '';
    setRecords((current) =>
      current.map((item) =>
        item.id === record.id
          ? {
              ...item,
              archivedAt,
              updatedAt: new Date().toISOString(),
            }
          : item
      )
    );
    setPreviewRecord((current) =>
      current?.id === record.id
        ? {
            ...current,
            archivedAt,
            updatedAt: new Date().toISOString(),
          }
        : current
    );
    setSelectedId(record.id);
    setMessage(archived ? '申诉记录已归档' : '申诉记录已取消归档');
    setError('');
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon={<ClipboardList size={18} />}
        title="跨境电商申诉记录"
        subtitle="管理代申诉业务台账、收费结算、结果反馈和日常跟进"
        actions={
          <button
            onClick={() => setEditingRecord(createEmptyRecord())}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
          >
            <Plus size={14} />
            新增记录
          </button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/50">
          {message || error ? (
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                error
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
              }`}
            >
              {error || message}
            </div>
          ) : null}

          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-950">
            {[
              { value: 'active', label: '当前记录', count: stats.activeCount },
              { value: 'archived', label: '归档记录', count: stats.archivedCount },
            ].map((item) => {
              const active = viewMode === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setViewMode(item.value as 'active' | 'archived')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-900 dark:hover:text-gray-100'
                  }`}
                >
                  {item.label} {item.count}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <MetricCard label={viewMode === 'archived' ? '归档记录' : '当前记录'} value={stats.visibleCount} icon={<ClipboardList size={15} />} />
            <MetricCard label="处理中" value={stats.processingCount} icon={<FileText size={15} />} />
            <MetricCard label="成功" value={stats.successCount} icon={<CheckCircle2 size={15} />} />
            <MetricCard label="收费合计" value={formatMoney(stats.totalCharge)} icon={<WalletCards size={15} />} />
            <MetricCard label="待结算金额" value={formatMoney(stats.unsettledAmount)} icon={<WalletCards size={15} />} />
          </div>

          <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_150px_150px_150px]">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索微信、店铺、主体、账号、暂停原因、结果..."
                className={inputClassName('pl-9')}
              />
            </div>
            <select
              value={platformFilter}
              onChange={(event) => setPlatformFilter(event.target.value as 'all' | EcommercePlatform)}
              className={inputClassName()}
            >
              <option value="all">全部平台</option>
              {PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {PLATFORM_META[platform].label}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | EcommerceAppealLedgerStatus)}
              className={inputClassName()}
            >
              <option value="all">全部申诉状态</option>
              {Object.entries(APPEAL_STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
            <select
              value={settlementFilter}
              onChange={(event) => setSettlementFilter(event.target.value as 'all' | EcommerceAppealSettlementStatus)}
              className={inputClassName()}
            >
              <option value="all">全部结算</option>
              {Object.entries(SETTLEMENT_STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { value: 'all', label: '所有国家' },
              ...countryOptions.map((country) => ({ value: country, label: country })),
            ].map((item) => {
              const active = countryFilter === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setCountryFilter(item.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-200'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-200'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 dark:border-gray-800">
          {filteredRecords.length ? (
            <table className="min-w-[1680px] w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-gray-100 text-xs font-semibold text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-3">对接微信</th>
                  <th className="px-3 py-3">店铺</th>
                  <th className="px-3 py-3">平台 / 国家</th>
                  <th className="px-3 py-3">主体</th>
                  <th className="px-3 py-3">浏览器</th>
                  <th className="px-3 py-3">登录公司名</th>
                  <th className="px-3 py-3">账号</th>
                  <th className="px-3 py-3">密码</th>
                  <th className="px-3 py-3">暂停原因</th>
                  <th className="px-3 py-3">申诉状态</th>
                  <th className="px-3 py-3">申诉时间</th>
                  <th className="px-3 py-3">申诉结果</th>
                  <th className="px-3 py-3">收费</th>
                  <th className="px-3 py-3">结算</th>
                  <th className="px-3 py-3">标记情况</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredRecords.map((record) => (
                  <tr
                    key={record.id}
                    className={`transition-colors hover:bg-blue-50/70 dark:hover:bg-blue-950/20 ${
                      selectedId === record.id ? 'bg-blue-50 dark:bg-blue-950/30' : ''
                    }`}
                  >
                    <td className="max-w-[150px] truncate px-3 py-3 font-medium" title={record.clientWechat}>
                      {record.clientWechat || '未填写'}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-3 font-medium" title={record.storeName}>
                      {record.storeName || '未填写'}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {record.platform ? (
                          <Badge className={PLATFORM_META[record.platform].tone}>
                            {PLATFORM_META[record.platform].label}
                          </Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">未填平台</Badge>
                        )}
                        {record.country ? (
                          <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                            {record.country}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-3" title={record.subjectName}>
                      {record.subjectName || '未填写'}
                    </td>
                    <td className="max-w-[120px] truncate px-3 py-3" title={record.browserProfile}>
                      {record.browserProfile || '未填写'}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-3" title={record.loginCompanyName}>
                      {record.loginCompanyName || '未填写'}
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-3" title={record.account}>
                      {record.account || '未填写'}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-3" title={record.password}>
                      {record.password || '未填写'}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-3" title={record.suspensionReason}>
                      {record.suspensionReason || '未填写'}
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={APPEAL_STATUS_META[record.appealStatus].tone}>
                        {APPEAL_STATUS_META[record.appealStatus].label}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">{formatDate(record.appealDate)}</td>
                    <td className="max-w-[220px] truncate px-3 py-3" title={record.appealResult}>
                      {record.appealResult || '未填写'}
                    </td>
                    <td className="px-3 py-3 font-medium">{formatMoney(record.chargeAmount, record.currency)}</td>
                    <td className="px-3 py-3">
                      <Badge className={SETTLEMENT_STATUS_META[record.settlementStatus].tone}>
                        {SETTLEMENT_STATUS_META[record.settlementStatus].label}
                      </Badge>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-3" title={record.markNote}>
                      {record.markNote || '未填写'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconButton
                          title="查看"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(record.id);
                            setPreviewRecord(record);
                          }}
                        >
                          <Eye size={14} />
                        </IconButton>
                        <IconButton
                          title="编辑"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(record.id);
                            setEditingRecord(record);
                          }}
                        >
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton
                          title="复制为新记录"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditingRecord(cloneRecord(record));
                          }}
                        >
                          <Copy size={14} />
                        </IconButton>
                        <IconButton
                          title="复制详情文本"
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyReport(record);
                          }}
                        >
                          <ClipboardList size={14} />
                        </IconButton>
                        <IconButton
                          title={record.archivedAt ? '取消归档' : '归档'}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleArchive(record, !record.archivedAt);
                          }}
                        >
                          {record.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                        </IconButton>
                        <IconButton
                          title="删除"
                          danger
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDeleteRecord(record);
                          }}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="暂无申诉记录"
              description="新增一条代申诉台账，用于跟进收费、结果反馈和结算状态。"
              action={
                <button
                  onClick={() => setEditingRecord(createEmptyRecord())}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Plus size={16} />
                  新增记录
                </button>
              }
            />
          )}
        </div>
      </div>

      {editingRecord && (
        <RecordEditorModal
          record={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSave={upsertRecord}
        />
      )}

      {previewRecord && (
        <RecordPreviewModal
          record={previewRecord}
          onClose={() => setPreviewRecord(null)}
          onEdit={() => {
            setEditingRecord(previewRecord);
            setPreviewRecord(null);
          }}
          onCopyReport={() => void copyReport(previewRecord)}
          onCopyField={(label, value) => void copyText(value, `${label}已复制`)}
          onToggleArchive={() => toggleArchive(previewRecord, !previewRecord.archivedAt)}
          onDelete={() => {
            setPendingDeleteRecord(previewRecord);
            setPreviewRecord(null);
          }}
        />
      )}

      {pendingDeleteRecord && (
        <DeleteConfirmModal
          record={pendingDeleteRecord}
          onCancel={() => setPendingDeleteRecord(null)}
          onConfirm={() => confirmDelete(pendingDeleteRecord)}
        />
      )}
    </div>
  );
}

function RecordPreviewModal({
  record,
  onClose,
  onEdit,
  onCopyReport,
  onCopyField,
  onToggleArchive,
  onDelete,
}: {
  record: EcommerceAppealLedgerRecord;
  onClose: () => void;
  onEdit: () => void;
  onCopyReport: () => void;
  onCopyField: (label: string, value: string) => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <BaseModal title="申诉记录预览" onClose={onClose} width="max-w-6xl">
      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap gap-2">
                {record.platform ? (
                  <Badge className={PLATFORM_META[record.platform].tone}>{PLATFORM_META[record.platform].label}</Badge>
                ) : null}
                <Badge className={APPEAL_STATUS_META[record.appealStatus].tone}>
                  {APPEAL_STATUS_META[record.appealStatus].label}
                </Badge>
                <Badge className={SETTLEMENT_STATUS_META[record.settlementStatus].tone}>
                  {SETTLEMENT_STATUS_META[record.settlementStatus].label}
                </Badge>
                {record.archivedAt ? (
                  <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    已归档
                  </Badge>
                ) : null}
              </div>
              <h2 className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
                {record.storeName || record.clientWechat || '未命名申诉记录'}
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                {[record.clientWechat, record.country, record.subjectName].filter(Boolean).join(' / ') || '未填写基础信息'}
              </p>
            </div>
            <div className="flex gap-1">
              <IconButton title="复制详情文本" onClick={onCopyReport}>
                <ClipboardList size={14} />
              </IconButton>
              <IconButton title="编辑" onClick={onEdit}>
                <Pencil size={14} />
              </IconButton>
              <IconButton title={record.archivedAt ? '取消归档' : '归档'} onClick={onToggleArchive}>
                {record.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </IconButton>
              <IconButton title="删除" danger onClick={onDelete}>
                <Trash2 size={14} />
              </IconButton>
            </div>
          </div>
        </div>

        <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
          <DetailSection title="申诉基础" icon={<ClipboardList size={16} />}>
            <DetailGrid
              onCopy={onCopyField}
              items={[
                ['对接微信', record.clientWechat],
                ['店铺', record.storeName],
                ['平台', record.platform ? PLATFORM_META[record.platform].label : '未填写'],
                ['国家', record.country],
                ['主体', record.subjectName],
                ['浏览器', record.browserProfile],
                ['登录公司名', record.loginCompanyName],
                ['账号', record.account],
                ['密码', record.password],
              ]}
            />
          </DetailSection>

          <DetailSection title="申诉进度" icon={<FileText size={16} />}>
            <DetailGrid
              onCopy={onCopyField}
              items={[
                ['暂停原因', record.suspensionReason],
                ['申诉状态', APPEAL_STATUS_META[record.appealStatus].label],
                ['申诉时间', formatDate(record.appealDate)],
                ['申诉结果', record.appealResult],
                ['结果反馈时间', formatDate(record.resultFeedbackDate)],
                ['处理人', record.handler],
                ['下次跟进', formatDate(record.followUpDate)],
                ['归档时间', record.archivedAt ? formatDate(record.archivedAt) : '未归档'],
              ]}
            />
          </DetailSection>

          <DetailSection title="收费与结算" icon={<WalletCards size={16} />}>
            <DetailGrid
              onCopy={onCopyField}
              items={[
                ['收费金额', formatMoney(record.chargeAmount, record.currency)],
                ['结算状态', SETTLEMENT_STATUS_META[record.settlementStatus].label],
                ['结算时间', formatDate(record.settlementDate)],
                ['结算情况', record.settlementNote],
                ['标记情况', record.markNote],
              ]}
            />
          </DetailSection>

          <DetailSection title="备注" icon={<FileText size={16} />}>
            <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm leading-6 text-gray-700 dark:bg-gray-900 dark:text-gray-200">
              {record.notes || '暂无备注'}
            </p>
          </DetailSection>
        </div>
      </div>
    </BaseModal>
  );
}

function RecordEditorModal({
  record,
  onClose,
  onSave,
}: {
  record: EcommerceAppealLedgerRecord;
  onClose: () => void;
  onSave: (record: EcommerceAppealLedgerRecord) => void;
}) {
  const [draft, setDraft] = useState<EcommerceAppealLedgerRecord>(() => normalizeRecord(record));

  function patch(updates: Partial<EcommerceAppealLedgerRecord>) {
    setDraft((current) => ({ ...current, ...updates }));
  }

  return (
    <BaseModal title={record.storeName || record.clientWechat ? '编辑申诉记录' : '新增申诉记录'} onClose={onClose} width="max-w-6xl">
      <div className="max-h-[72vh] space-y-5 overflow-y-auto pr-1">
        <EditorSection title="基础信息">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="对接微信">
              <input value={draft.clientWechat} onChange={(event) => patch({ clientWechat: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="店铺">
              <input value={draft.storeName} onChange={(event) => patch({ storeName: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="平台">
              <select value={draft.platform} onChange={(event) => patch({ platform: event.target.value as EcommercePlatform | '' })} className={inputClassName()}>
                <option value="">未选择</option>
                {PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {PLATFORM_META[platform].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="国家">
              <input value={draft.country} onChange={(event) => patch({ country: event.target.value })} placeholder="美国 / 加拿大..." className={inputClassName()} />
            </Field>
            <Field label="主体">
              <input value={draft.subjectName} onChange={(event) => patch({ subjectName: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="浏览器">
              <input value={draft.browserProfile} onChange={(event) => patch({ browserProfile: event.target.value })} placeholder="如 紫鸟 / AdsPower / 1号浏览器..." className={inputClassName()} />
            </Field>
            <Field label="登录公司名">
              <input value={draft.loginCompanyName} onChange={(event) => patch({ loginCompanyName: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="账号">
              <input value={draft.account} onChange={(event) => patch({ account: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="密码">
              <input value={draft.password} onChange={(event) => patch({ password: event.target.value })} className={inputClassName()} />
            </Field>
          </div>
        </EditorSection>

        <EditorSection title="申诉进度">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="暂停原因">
              <input value={draft.suspensionReason} onChange={(event) => patch({ suspensionReason: event.target.value })} placeholder="自发货绩效 / 负面绩效 / 账号关联..." className={inputClassName()} />
            </Field>
            <Field label="申诉状态">
              <select value={draft.appealStatus} onChange={(event) => patch({ appealStatus: event.target.value as EcommerceAppealLedgerStatus })} className={inputClassName()}>
                {Object.entries(APPEAL_STATUS_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="申诉时间">
              <input type="date" value={draft.appealDate} onChange={(event) => patch({ appealDate: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="申诉结果" className="md:col-span-2">
              <input value={draft.appealResult} onChange={(event) => patch({ appealResult: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="结果反馈时间">
              <input type="date" value={draft.resultFeedbackDate} onChange={(event) => patch({ resultFeedbackDate: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="处理人">
              <input value={draft.handler} onChange={(event) => patch({ handler: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="下次跟进">
              <input type="date" value={draft.followUpDate} onChange={(event) => patch({ followUpDate: event.target.value })} className={inputClassName()} />
            </Field>
          </div>
        </EditorSection>

        <EditorSection title="收费与结算">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="收费金额">
              <input type="number" value={draft.chargeAmount} onChange={(event) => patch({ chargeAmount: toNumber(event.target.value) })} className={inputClassName()} />
            </Field>
            <Field label="币种">
              <input value={draft.currency} onChange={(event) => patch({ currency: event.target.value.toUpperCase() })} className={inputClassName()} />
            </Field>
            <Field label="结算">
              <select value={draft.settlementStatus} onChange={(event) => patch({ settlementStatus: event.target.value as EcommerceAppealSettlementStatus })} className={inputClassName()}>
                {Object.entries(SETTLEMENT_STATUS_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="结算时间">
              <input type="date" value={draft.settlementDate} onChange={(event) => patch({ settlementDate: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="结算情况" className="md:col-span-2">
              <input value={draft.settlementNote} onChange={(event) => patch({ settlementNote: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="标记情况" className="md:col-span-3">
              <input value={draft.markNote} onChange={(event) => patch({ markNote: event.target.value })} className={inputClassName()} />
            </Field>
          </div>
        </EditorSection>

        <EditorSection title="备注">
          <textarea
            value={draft.notes}
            onChange={(event) => patch({ notes: event.target.value })}
            rows={4}
            className={textareaClassName()}
          />
        </EditorSection>
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
        <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
          取消
        </button>
        <button onClick={() => onSave(draft)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          保存
        </button>
      </div>
    </BaseModal>
  );
}

function DeleteConfirmModal({
  record,
  onCancel,
  onConfirm,
}: {
  record: EcommerceAppealLedgerRecord;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <BaseModal title="确认删除申诉记录" onClose={onCancel} width="max-w-lg">
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200">
          确定删除「{record.storeName || record.clientWechat || '未命名记录'}」吗？此操作不可撤销。
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            取消
          </button>
          <button onClick={onConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700">
            确认删除
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

function BaseModal({
  title,
  children,
  onClose,
  width = 'max-w-3xl',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`w-full ${width} rounded-xl bg-white p-5 shadow-2xl dark:bg-gray-950`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: ReactNode; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
      <div className="mb-2 flex items-center justify-between text-gray-500">
        <span className="text-xs">{label}</span>
        {icon}
      </div>
      <p className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}

function DetailSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function DetailGrid({
  items,
  onCopy,
}: {
  items: Array<[string, ReactNode]>;
  onCopy?: (label: string, value: string) => void;
}) {
  return (
    <dl className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_28px] gap-2 rounded-lg bg-gray-50 p-2.5 dark:bg-gray-900">
          <div className="min-w-0">
            <dt className="text-[11px] text-gray-500">{label}</dt>
            <dd className="mt-1 min-w-0 break-words text-sm font-medium text-gray-800 dark:text-gray-200">{value || '未填写'}</dd>
          </div>
          {onCopy ? <CopyFieldButton label={label} value={String(value || '')} onCopy={onCopy} /> : <span />}
        </div>
      ))}
    </dl>
  );
}

function CopyFieldButton({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <button
      type="button"
      title={`复制${label}`}
      disabled={!value.trim() || value === '未设置' || value === '未填写'}
      onClick={() => onCopy(label, value)}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
    >
      <Copy size={13} />
    </button>
  );
}

function EditorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center p-8 text-center">
      <ClipboardList size={42} className="mb-3 text-gray-300" />
      <p className="font-medium text-gray-700 dark:text-gray-200">{title}</p>
      <p className="mb-4 mt-1 text-sm text-gray-500">{description}</p>
      {action}
    </div>
  );
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

function IconButton({
  title,
  children,
  danger,
  onClick,
}: {
  title: string;
  children: ReactNode;
  danger?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
        danger
          ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/20'
          : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900'
      }`}
    >
      {children}
    </button>
  );
}

function inputClassName(extra = '') {
  return `w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 ${extra}`;
}

function textareaClassName() {
  return 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
}
