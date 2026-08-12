import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardList,
  Copy,
  CopyPlus,
  ExternalLink,
  FileText,
  Globe2,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Store,
  Trash2,
  UserRound,
  Wrench,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  useToolDataStore,
  type EcommerceAppealRecord,
  type EcommerceMaintenanceLog,
  type EcommerceMaintenanceStatus,
  type EcommercePlatform,
  type EcommerceStoreRecord,
  type EcommerceStoreStatus,
} from '../stores/toolDataStore';

const PLATFORM_META: Record<EcommercePlatform, { label: string; tone: string }> = {
  amazon: { label: 'Amazon', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  walmart: { label: 'Walmart', tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  shein: { label: 'SHEIN', tone: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200' },
  temu: { label: 'Temu', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  tiktok: { label: 'TikTok', tone: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  other: { label: '其他', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
};

const STORE_STATUS_META: Record<EcommerceStoreStatus, { label: string; tone: string }> = {
  preparing: { label: '筹备中', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
  'under-review': { label: '审核中', tone: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  active: { label: '运营中', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  limited: { label: '受限', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  suspended: { label: '暂停/封禁', tone: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  closed: { label: '已关闭', tone: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  terminated: { label: '已终止', tone: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200' },
};

const LOG_STATUS_META: Record<EcommerceMaintenanceStatus, { label: string; tone: string }> = {
  todo: { label: '待处理', tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  done: { label: '已完成', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  risk: { label: '有风险', tone: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
};

const PLATFORMS: EcommercePlatform[] = ['amazon', 'walmart', 'shein', 'temu', 'tiktok', 'other'];
const SUBJECT_TYPE_OPTIONS = ['个人', '企业'];
const RECEIVING_CHANNEL_OPTIONS = [
  '派安盈 Payoneer',
  '万里汇 WorldFirst',
  'PingPong',
  '连连国际 LianLian Global',
  '空中云汇 Airwallex',
  'XTransfer',
  'iPayLinks 艾贝盈',
  'PayPal',
  'Wise',
  '银行账户 / 电汇',
  '其他',
];
const PAYOUT_CYCLE_OPTIONS = [
  'T+1',
  'T+3',
  'T+5',
  'T+7',
  'T+8',
  'T+14',
  'T+21',
  'T+30',
  'T+31',
  'T+45',
  'T+90',
];
const COUNTRY_SPLIT_PATTERN = /[\/、,，;；|]+/;

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value?: string) {
  if (!value) return '未设置';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  return new Date(value).toLocaleDateString('zh-CN');
}

function formatMoney(value: number, currency: string) {
  return `${currency || 'USD'} ${Number(value || 0).toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
  })}`;
}

function toNumber(value: string | number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function splitCountryValues(value?: string) {
  return (value || '')
    .split(COUNTRY_SPLIT_PATTERN)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createEmptyStore(): EcommerceStoreRecord {
  const now = new Date().toISOString();
  return {
    id: uid('store'),
    platform: 'amazon',
    storeName: '',
    country: '',
    site: '',
    storeId: '',
    storeUrl: '',
    storeSourceChannel: '',
    storeRegistrationDate: '',
    storeStatus: 'preparing',
    operationStatus: 'normal',
    subjectName: '',
    subjectType: '',
    legalPerson: '',
    legalPersonIdNo: '',
    legalPersonPhone: '',
    licenseNo: '',
    officialSealNo: '',
    taxId: '',
    registeredAddress: '',
    registrationDate: '',
    accountEmail: '',
    accountPhone: '',
    manager: '',
    contactEmail: '',
    contactName: '',
    contactPhone: '',
    receivingChannel: '',
    receivingChannelOther: '',
    receivingAccountName: '',
    receivingAccountId: '',
    receivingAccountEmail: '',
    receivingCurrency: '',
    receivingBankName: '',
    receivingBankAccount: '',
    receivingRoutingInfo: '',
    receivingSettlementCycle: '',
    receivingNote: '',
    currency: 'USD',
    last30dSales: 0,
    last30dOrders: 0,
    adSpend: 0,
    skuCount: 0,
    inventoryAlerts: 0,
    policyWarnings: 0,
    rating: '',
    lastReviewDate: '',
    nextAnnualReviewDate: '',
    tags: [],
    notes: '',
    archivedAt: '',
    maintenanceLogs: [],
    appealRecords: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createEmptyLog(): EcommerceMaintenanceLog {
  return {
    id: uid('log'),
    date: todayInput(),
    type: '日常维护',
    title: '',
    owner: '',
    status: 'todo',
    nextFollowDate: '',
    note: '',
  };
}

function createEmptyAppealRecord(): EcommerceAppealRecord {
  return {
    id: uid('appeal'),
    suspensionDate: '',
    suspensionReason: '',
    appealDate: '',
    appealCount: 1,
    appealCost: 0,
    appealResult: '',
    recoveryDate: '',
    appealNote: '',
  };
}

function cloneStoreForCreate(store: EcommerceStoreRecord): EcommerceStoreRecord {
  const now = new Date().toISOString();
  return normalizeStore({
    ...store,
    id: uid('store'),
    storeName: `${store.storeName} 副本`,
    archivedAt: '',
    maintenanceLogs: store.maintenanceLogs.map((log) => ({
      ...log,
      id: uid('log'),
    })),
    appealRecords: store.appealRecords.map((record) => ({
      ...record,
      id: uid('appeal'),
    })),
    createdAt: now,
    updatedAt: now,
  });
}

function normalizeStore(store: EcommerceStoreRecord): EcommerceStoreRecord {
  const legacyCountry = store.site || '';
  return {
    ...store,
    country: store.country || legacyCountry,
    site: store.site || '',
    storeId: store.storeId || '',
    storeUrl: store.storeUrl || '',
    storeSourceChannel: store.storeSourceChannel || '',
    storeRegistrationDate: store.storeRegistrationDate || '',
    subjectName: store.subjectName || '',
    subjectType: store.subjectType || '',
    legalPerson: store.legalPerson || '',
    legalPersonIdNo: store.legalPersonIdNo || '',
    legalPersonPhone: store.legalPersonPhone || '',
    licenseNo: store.licenseNo || '',
    officialSealNo: store.officialSealNo || '',
    taxId: store.taxId || '',
    registeredAddress: store.registeredAddress || '',
    registrationDate: store.registrationDate || '',
    accountEmail: store.accountEmail || '',
    accountPhone: store.accountPhone || '',
    manager: store.manager || '',
    contactEmail: store.contactEmail || '',
    contactName: store.contactName || '',
    contactPhone: store.contactPhone || '',
    receivingChannel: store.receivingChannel || '',
    receivingChannelOther: store.receivingChannelOther || '',
    receivingAccountName: store.receivingAccountName || '',
    receivingAccountId: store.receivingAccountId || '',
    receivingAccountEmail: store.receivingAccountEmail || '',
    receivingCurrency: store.receivingCurrency || '',
    receivingBankName: store.receivingBankName || '',
    receivingBankAccount: store.receivingBankAccount || '',
    receivingRoutingInfo: store.receivingRoutingInfo || '',
    receivingSettlementCycle: store.receivingSettlementCycle || '',
    receivingNote: store.receivingNote || '',
    currency: store.currency || 'USD',
    last30dSales: Number.isFinite(store.last30dSales) ? store.last30dSales : 0,
    last30dOrders: Number.isFinite(store.last30dOrders) ? store.last30dOrders : 0,
    adSpend: Number.isFinite(store.adSpend) ? store.adSpend : 0,
    skuCount: Number.isFinite(store.skuCount) ? store.skuCount : 0,
    inventoryAlerts: Number.isFinite(store.inventoryAlerts) ? store.inventoryAlerts : 0,
    policyWarnings: Number.isFinite(store.policyWarnings) ? store.policyWarnings : 0,
    rating: store.rating || '',
    lastReviewDate: store.lastReviewDate || '',
    nextAnnualReviewDate: store.nextAnnualReviewDate || '',
    tags: Array.isArray(store.tags) ? store.tags : [],
    notes: store.notes || '',
    archivedAt: store.archivedAt || '',
    maintenanceLogs: Array.isArray(store.maintenanceLogs)
      ? store.maintenanceLogs.map((log) => ({
          ...log,
          type: log.type || '日常维护',
          owner: log.owner || '',
          nextFollowDate: log.nextFollowDate || '',
          note: log.note || '',
        }))
      : [],
    appealRecords: Array.isArray(store.appealRecords)
      ? store.appealRecords.map((record) => ({
          ...record,
          suspensionDate: record.suspensionDate || '',
          suspensionReason: record.suspensionReason || '',
          appealDate: record.appealDate || '',
          appealCount: Number.isFinite(record.appealCount) ? record.appealCount : 0,
          appealCost: Number.isFinite(record.appealCost) ? record.appealCost : 0,
          appealResult: record.appealResult || '',
          recoveryDate: record.recoveryDate || '',
          appealNote: record.appealNote || '',
        }))
      : [],
  };
}

function getStoreReport(store: EcommerceStoreRecord) {
  return [
    `# ${store.storeName}`,
    '',
    `- 平台：${PLATFORM_META[store.platform].label}`,
    `- 国家：${store.country || '未填写'}`,
    `- 店铺状态：${STORE_STATUS_META[store.storeStatus].label}`,
    `- 来源渠道：${store.storeSourceChannel || '未填写'}`,
    `- 店铺注册时间：${formatDate(store.storeRegistrationDate)}`,
    `- 店铺SKU数量：${store.skuCount}`,
    `- 回款时间：${store.receivingSettlementCycle || '未填写'}`,
    `- 店铺主体：${store.subjectName || '未填写'}`,
    `- 法人信息：${store.legalPerson || '未填写'}`,
    `- 法人身份证号码：${store.legalPersonIdNo || '未填写'}`,
    `- 法人手机：${store.legalPersonPhone || '未填写'}`,
    `- 公章编号：${store.officialSealNo || '未填写'}`,
    `- 主体注册时间：${formatDate(store.registrationDate)}`,
    `- 注册邮箱号：${store.accountEmail || '未填写'}`,
    `- 绑定手机：${store.accountPhone || '未填写'}`,
    `- 联系人姓名：${store.contactName || '未填写'}`,
    `- 联系人手机：${store.contactPhone || '未填写'}`,
    `- 收款渠道：${store.receivingChannel === '其他' ? store.receivingChannelOther || '其他' : store.receivingChannel || '未填写'}`,
    `- 收款账户名：${store.receivingAccountName || '未填写'}`,
    `- 收款账号/店铺ID：${store.receivingAccountId || '未填写'}`,
    `- 收款币种：${store.receivingCurrency || '未填写'}`,
    `- 负责人：${store.manager || '未指定'}`,
    `- 近30天销售额：${formatMoney(store.last30dSales, store.currency)}`,
    `- 近30天订单：${store.last30dOrders}`,
    `- 库存预警：${store.inventoryAlerts}`,
    `- 政策警告：${store.policyWarnings}`,
    `- 下次年审：${formatDate(store.nextAnnualReviewDate)}`,
    `- 归档时间：${store.archivedAt ? formatDate(store.archivedAt) : '未归档'}`,
    '',
    '## 维护记录',
    ...(store.maintenanceLogs.length
      ? store.maintenanceLogs.map(
          (log) =>
            `- ${formatDate(log.date)} ${log.title}（${LOG_STATUS_META[log.status].label}${log.owner ? `，负责人：${log.owner}` : ''}）`
        )
      : ['- 暂无维护记录']),
    '',
    '## 申诉记录',
    ...(store.appealRecords.length
      ? store.appealRecords.map(
          (record) =>
            `- 暂停：${formatDate(record.suspensionDate)}；原因：${record.suspensionReason || '未填写'}；申诉：${formatDate(record.appealDate)}；次数：${record.appealCount}；成本：${record.appealCost}；结果：${record.appealResult || '未填写'}；恢复：${formatDate(record.recoveryDate)}；备注：${record.appealNote || '无'}`
        )
      : ['- 暂无申诉记录']),
    '',
    '## 备注',
    store.notes || '暂无',
  ].join('\n');
}

export default function EcommerceStoreManagerTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateEcommerceStoreManagerData } = useToolDataStore();
  const [stores, setStores] = useState<EcommerceStoreRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | EcommercePlatform>('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | EcommerceStoreStatus>('all');
  const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showStorePreview, setShowStorePreview] = useState(false);
  const [pendingDeleteStore, setPendingDeleteStore] = useState<EcommerceStoreRecord | null>(null);
  const [showStoreEditor, setShowStoreEditor] = useState(false);
  const [editingStore, setEditingStore] = useState<EcommerceStoreRecord | null>(null);
  const [showLogEditor, setShowLogEditor] = useState(false);
  const [editingLog, setEditingLog] = useState<EcommerceMaintenanceLog | null>(null);
  const hydratingRef = useRef(false);

  useEffect(() => {
    if (!loaded) {
      loadData();
    }
  }, [loaded, loadData]);

  useEffect(() => {
    if (!loaded) return;
    hydratingRef.current = true;
    setStores((data.ecommerceStoreManager?.stores || []).map(normalizeStore));
  }, [loaded, data.ecommerceStoreManager?.stores]);

  useEffect(() => {
    if (!loaded) return;
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    updateEcommerceStoreManagerData({
      version: 'mcheng-ecommerce-store-manager-v1',
      stores,
    });
  }, [stores, loaded, updateEcommerceStoreManagerData]);

  useEffect(() => {
    if (!stores.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !stores.some((store) => store.id === selectedId)) {
      setSelectedId(stores[0].id);
    }
  }, [stores, selectedId]);

  const countryOptions = useMemo(
    () =>
      Array.from(new Set(stores.flatMap((store) => splitCountryValues(store.country))))
        .sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [stores]
  );

  useEffect(() => {
    if (countryFilter !== 'all' && !countryOptions.includes(countryFilter)) {
      setCountryFilter('all');
    }
  }, [countryFilter, countryOptions]);

  const filteredStores = useMemo(() => {
    return stores.filter((store) => {
      const keyword = search.trim().toLowerCase();
      const countryValues = splitCountryValues(store.country);
      const archived = Boolean(store.archivedAt);
      const haystack = [
        PLATFORM_META[store.platform].label,
        store.storeName,
        store.country,
        store.site,
        store.storeId,
        store.storeSourceChannel,
        store.storeRegistrationDate,
        store.subjectName,
        store.legalPerson,
        store.legalPersonIdNo,
        store.legalPersonPhone,
        store.officialSealNo,
        store.manager,
        store.accountEmail,
        store.accountPhone,
        store.contactName,
        store.contactPhone,
        store.contactEmail,
        store.receivingChannel,
        store.receivingChannelOther,
        store.receivingAccountName,
        store.receivingAccountId,
        store.receivingAccountEmail,
        store.receivingCurrency,
        store.receivingBankName,
        store.receivingBankAccount,
        store.receivingRoutingInfo,
        store.receivingSettlementCycle,
        store.receivingNote,
        String(store.skuCount),
        store.appealRecords
          .map((record) =>
            [
              record.suspensionDate,
              record.suspensionReason,
              record.appealDate,
              String(record.appealCount),
              String(record.appealCost),
              record.appealResult,
              record.recoveryDate,
              record.appealNote,
            ].join(' ')
          )
          .join(' '),
        store.tags.join(' '),
        store.notes,
      ]
        .join(' ')
        .toLowerCase();
      return (
        (viewMode === 'archived' ? archived : !archived) &&
        (platformFilter === 'all' || store.platform === platformFilter) &&
        (countryFilter === 'all' || countryValues.includes(countryFilter)) &&
        (statusFilter === 'all' || store.storeStatus === statusFilter) &&
        (!keyword || haystack.includes(keyword))
      );
    });
  }, [stores, search, platformFilter, countryFilter, statusFilter, viewMode]);

  const selectedStore =
    stores.find((store) => store.id === selectedId) ||
    filteredStores[0] ||
    null;

  const activeStores = stores.filter((store) => !store.archivedAt);
  const archivedStores = stores.filter((store) => store.archivedAt);
  const visibleStores = viewMode === 'archived' ? archivedStores : activeStores;
  const operatingCount = visibleStores.filter((store) => store.storeStatus === 'active').length;
  const riskCount = visibleStores.filter(
    (store) =>
      store.storeStatus === 'limited' ||
      store.storeStatus === 'suspended' ||
      store.policyWarnings > 0
  ).length;
  const todoLogCount = visibleStores.reduce(
    (sum, store) =>
      sum + store.maintenanceLogs.filter((log) => log.status === 'todo' || log.status === 'risk').length,
    0
  );
  const totalSales = visibleStores.reduce((sum, store) => sum + store.last30dSales, 0);

  function patchStore(storeId: string, updates: Partial<EcommerceStoreRecord>) {
    setStores((current) =>
      current.map((store) =>
        store.id === storeId
          ? {
              ...store,
              ...updates,
              updatedAt: new Date().toISOString(),
            }
          : store
      )
    );
  }

  function upsertStore(store: EcommerceStoreRecord) {
    const normalized = normalizeStore({
      ...store,
      storeName: store.storeName.trim(),
      country: store.country.trim(),
      site: store.site.trim(),
      storeId: store.storeId?.trim() || '',
      storeUrl: store.storeUrl?.trim() || '',
      storeSourceChannel: store.storeSourceChannel?.trim() || '',
      storeRegistrationDate: store.storeRegistrationDate || '',
      subjectName: store.subjectName.trim(),
      subjectType: store.subjectType?.trim() || '',
      legalPerson: store.legalPerson.trim(),
      legalPersonIdNo: store.legalPersonIdNo?.trim() || '',
      legalPersonPhone: store.legalPersonPhone?.trim() || '',
      licenseNo: store.licenseNo?.trim() || '',
      officialSealNo: store.officialSealNo?.trim() || '',
      taxId: store.taxId?.trim() || '',
      registeredAddress: store.registeredAddress?.trim() || '',
      accountEmail: store.accountEmail?.trim() || '',
      accountPhone: store.accountPhone?.trim() || '',
      manager: store.manager?.trim() || '',
      contactEmail: store.contactEmail?.trim() || '',
      contactName: store.contactName?.trim() || '',
      contactPhone: store.contactPhone?.trim() || '',
      receivingChannel: store.receivingChannel?.trim() || '',
      receivingChannelOther: store.receivingChannelOther?.trim() || '',
      receivingAccountName: store.receivingAccountName?.trim() || '',
      receivingAccountId: store.receivingAccountId?.trim() || '',
      receivingAccountEmail: store.receivingAccountEmail?.trim() || '',
      receivingCurrency: store.receivingCurrency?.trim() || '',
      receivingBankName: store.receivingBankName?.trim() || '',
      receivingBankAccount: store.receivingBankAccount?.trim() || '',
      receivingRoutingInfo: store.receivingRoutingInfo?.trim() || '',
      receivingSettlementCycle: store.receivingSettlementCycle?.trim() || '',
      receivingNote: store.receivingNote?.trim() || '',
      skuCount: Number.isFinite(store.skuCount) ? store.skuCount : 0,
      currency: store.currency.trim() || 'USD',
      tags: store.tags.map((item) => item.trim()).filter(Boolean),
      notes: store.notes?.trim() || '',
      updatedAt: new Date().toISOString(),
    });

    if (!normalized.storeName) {
      setError('请先填写店铺名称');
      return;
    }

    setStores((current) => {
      const exists = current.some((item) => item.id === normalized.id);
      if (exists) {
        return current.map((item) => (item.id === normalized.id ? normalized : item));
      }
      return [normalized, ...current];
    });
    setSelectedId(normalized.id);
    setShowStoreEditor(false);
    setEditingStore(null);
    setError('');
    setMessage('店铺信息已保存');
  }

  function removeStore(storeId: string) {
    const store = stores.find((item) => item.id === storeId);
    if (!store) return;
    setStores((current) => current.filter((item) => item.id !== storeId));
    setPendingDeleteStore(null);
    setShowStorePreview(false);
    setMessage('店铺已删除');
  }

  function toggleArchiveStore(store: EcommerceStoreRecord, archived: boolean) {
    patchStore(store.id, { archivedAt: archived ? new Date().toISOString() : '' });
    setSelectedId(store.id);
    setMessage(archived ? '店铺已归档' : '店铺已移出归档');
    setError('');
  }

  function upsertLog(log: EcommerceMaintenanceLog) {
    if (!selectedStore) return;
    const normalizedLog = {
      ...log,
      title: log.title.trim(),
      type: log.type.trim() || '日常维护',
      owner: log.owner.trim(),
      note: log.note?.trim() || '',
      date: log.date || todayInput(),
      nextFollowDate: log.nextFollowDate || '',
    };
    if (!normalizedLog.title) {
      setError('请先填写维护事项标题');
      return;
    }
    const exists = selectedStore.maintenanceLogs.some((item) => item.id === normalizedLog.id);
    patchStore(selectedStore.id, {
      maintenanceLogs: exists
        ? selectedStore.maintenanceLogs.map((item) => (item.id === normalizedLog.id ? normalizedLog : item))
        : [normalizedLog, ...selectedStore.maintenanceLogs],
    });
    setShowLogEditor(false);
    setEditingLog(null);
    setError('');
    setMessage('维护记录已保存');
  }

  function deleteLog(logId: string) {
    if (!selectedStore) return;
    patchStore(selectedStore.id, {
      maintenanceLogs: selectedStore.maintenanceLogs.filter((log) => log.id !== logId),
    });
    setMessage('维护记录已删除');
  }

  async function copyReport(store: EcommerceStoreRecord) {
    await navigator.clipboard.writeText(getStoreReport(store));
    setMessage('店铺摘要已复制');
  }

  async function copyField(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setMessage(`${label}已复制`);
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="🏬"
        title="跨境电商店铺管理"
        subtitle="集中维护平台店铺、主体法人、注册状态、运营指标、风险和维护记录"
        actions={
          <button
            onClick={() => {
              setEditingStore(createEmptyStore());
              setShowStoreEditor(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-700"
          >
            <Plus size={14} />
            新增店铺
          </button>
        }
      />

      <main className="flex-1 overflow-hidden p-4">
        <div className="h-full">
          <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="space-y-3 border-b border-gray-200 p-4 dark:border-gray-700">
              {(message || error) && (
                <div
                  className={`rounded-lg px-3 py-2 text-xs ${
                    error
                      ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                  }`}
                >
                  {error || message}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                <MetricCard label={viewMode === 'archived' ? '归档店铺' : '当前店铺'} value={visibleStores.length} icon={<Store size={15} />} />
                <MetricCard label="运营中" value={operatingCount} icon={<CheckCircle2 size={15} />} />
                <MetricCard label="风险/受限" value={riskCount} icon={<ShieldAlert size={15} />} />
                <MetricCard label="待维护" value={todoLogCount} icon={<Wrench size={15} />} />
                <MetricCard label="30天销售" value={formatMoney(totalSales, 'USD')} icon={<BarChart3 size={15} />} />
              </div>

              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-900">
                {[
                  { value: 'active', label: '当前店铺', count: activeStores.length },
                  { value: 'archived', label: '归档店铺', count: archivedStores.length },
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
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                      }`}
                    >
                      {item.label} {item.count}
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_150px_150px]">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索店铺、国家、主体、法人、负责人、标签..."
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
                  onChange={(event) => setStatusFilter(event.target.value as 'all' | EcommerceStoreStatus)}
                  className={inputClassName()}
                >
                  <option value="all">全部状态</option>
                  {Object.entries(STORE_STATUS_META).map(([value, meta]) => (
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
                          : 'border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/30 dark:hover:text-blue-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {filteredStores.length ? (
                <table className="min-w-[1220px] w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-100 text-xs font-semibold text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    <tr>
                      <th className="px-4 py-3">店铺</th>
                      <th className="px-3 py-3">国家</th>
                      <th className="px-3 py-3">主体 / 法人</th>
                      <th className="px-3 py-3">状态</th>
                      <th className="px-3 py-3">SKU数量</th>
                      <th className="px-3 py-3">联系人姓名 / 手机号码</th>
                      <th className="px-3 py-3">收款渠道</th>
                      <th className="px-3 py-3">回款时间</th>
                      <th className="px-4 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {filteredStores.map((store) => (
                      <tr
                        key={store.id}
                        className={`transition-colors hover:bg-blue-50/70 dark:hover:bg-blue-950/20 ${
                          selectedStore?.id === store.id ? 'bg-blue-50 dark:bg-blue-950/30' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Badge className={PLATFORM_META[store.platform].tone}>
                              {PLATFORM_META[store.platform].label}
                            </Badge>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                                {store.storeName}
                              </p>
                              <p className="truncate text-xs text-gray-500">
                                {store.storeId || '未填写店铺ID'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="max-w-[130px] truncate px-3 py-3 text-sm font-medium" title={store.country || ''}>
                          {store.country || '未填写'}
                        </td>
                        <td className="px-3 py-3">
                          <p className="max-w-[190px] truncate font-medium">{store.subjectName || '未填写'}</p>
                          <p className="text-xs text-gray-500">
                            {store.legalPerson || '法人未填写'}
                            {store.legalPersonPhone ? ` / ${store.legalPersonPhone}` : ''}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <Badge className={STORE_STATUS_META[store.storeStatus].tone}>
                            {STORE_STATUS_META[store.storeStatus].label}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 font-medium">{store.skuCount}</td>
                        <td className="px-3 py-3">
                          <p className="max-w-[190px] truncate font-medium">{store.contactName || '未填写'}</p>
                          <p className="text-xs text-gray-500">{store.contactPhone || '手机未填写'}</p>
                        </td>
                        <td className="max-w-[190px] truncate px-3 py-3 text-sm" title={store.receivingChannel === '其他' ? store.receivingChannelOther || '其他' : store.receivingChannel || ''}>
                          {store.receivingChannel === '其他' ? store.receivingChannelOther || '其他' : store.receivingChannel || '未设置'}
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-3 text-sm" title={store.receivingSettlementCycle || ''}>
                          {store.receivingSettlementCycle || '未设置'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <IconButton
                              title="查看"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedId(store.id);
                                setShowStorePreview(true);
                              }}
                            >
                              <Search size={14} />
                            </IconButton>
                            <IconButton
                              title="复制为新店铺"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingStore(cloneStoreForCreate(store));
                                setShowStoreEditor(true);
                              }}
                            >
                              <CopyPlus size={14} />
                            </IconButton>
                            <IconButton
                              title="编辑"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingStore(store);
                                setShowStoreEditor(true);
                              }}
                            >
                              <Pencil size={14} />
                            </IconButton>
                            <IconButton
                              title="复制摘要文本"
                              onClick={(event) => {
                                event.stopPropagation();
                                copyReport(store);
                              }}
                            >
                              <Copy size={14} />
                            </IconButton>
                            <IconButton
                              title={store.archivedAt ? '移出归档' : '归档'}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleArchiveStore(store, !store.archivedAt);
                              }}
                            >
                              {store.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                            </IconButton>
                            <IconButton
                              title="删除"
                              danger
                              onClick={(event) => {
                                event.stopPropagation();
                                setPendingDeleteStore(store);
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
                  title="暂无店铺数据"
                  description="点击右上角新增店铺，开始维护跨境平台店铺信息。"
                  action={
                    <button
                      onClick={() => {
                        setEditingStore(createEmptyStore());
                        setShowStoreEditor(true);
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                    >
                      <Plus size={15} />
                      新增店铺
                    </button>
                  }
                />
              )}
            </div>
          </section>
        </div>
      </main>

      {showStorePreview && selectedStore && (
        <StorePreviewModal
          store={selectedStore}
          onClose={() => setShowStorePreview(false)}
          onEdit={() => {
            setEditingStore(selectedStore);
            setShowStoreEditor(true);
          }}
          onDelete={() => setPendingDeleteStore(selectedStore)}
          onCopyReport={() => copyReport(selectedStore)}
          onCopyField={copyField}
          onToggleArchive={() => toggleArchiveStore(selectedStore, !selectedStore.archivedAt)}
          onOpenUrl={() => {
            if (selectedStore.storeUrl) {
              window.open(selectedStore.storeUrl, '_blank', 'noopener,noreferrer');
            }
          }}
          onAddLog={() => {
            setEditingLog(createEmptyLog());
            setShowLogEditor(true);
          }}
          onEditLog={(log) => {
            setEditingLog(log);
            setShowLogEditor(true);
          }}
          onDeleteLog={deleteLog}
        />
      )}

      {pendingDeleteStore && (
        <DeleteStoreConfirmModal
          store={pendingDeleteStore}
          onCancel={() => setPendingDeleteStore(null)}
          onConfirm={() => removeStore(pendingDeleteStore.id)}
        />
      )}

      {showStoreEditor && editingStore && (
        <StoreEditorModal
          store={editingStore}
          onClose={() => {
            setShowStoreEditor(false);
            setEditingStore(null);
          }}
          onSave={upsertStore}
        />
      )}

      {showLogEditor && editingLog && (
        <LogEditorModal
          log={editingLog}
          onClose={() => {
            setShowLogEditor(false);
            setEditingLog(null);
          }}
          onSave={upsertLog}
        />
      )}
    </div>
  );
}

function StorePreviewModal({
  store,
  onClose,
  onEdit,
  onDelete,
  onCopyReport,
  onCopyField,
  onToggleArchive,
  onOpenUrl,
  onAddLog,
  onEditLog,
  onDeleteLog,
}: {
  store: EcommerceStoreRecord;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopyReport: () => void;
  onCopyField: (label: string, value: string) => void;
  onToggleArchive: () => void;
  onOpenUrl: () => void;
  onAddLog: () => void;
  onEditLog: (log: EcommerceMaintenanceLog) => void;
  onDeleteLog: (logId: string) => void;
}) {
  return (
    <BaseModal title="店铺预览" onClose={onClose} width="max-w-6xl">
      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge className={PLATFORM_META[store.platform].tone}>{PLATFORM_META[store.platform].label}</Badge>
              <Badge className={STORE_STATUS_META[store.storeStatus].tone}>
                {STORE_STATUS_META[store.storeStatus].label}
              </Badge>
              {store.archivedAt ? (
                <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  已归档
                </Badge>
              ) : null}
            </div>
            <h2 className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">{store.storeName}</h2>
            <p className="mt-1 text-xs text-gray-500">{[store.country, store.storeId].filter(Boolean).join(' / ') || '未填写国家和店铺ID'}</p>
          </div>
          <div className="flex gap-1">
            {store.storeUrl && (
              <IconButton title="打开店铺链接" onClick={onOpenUrl}>
                <ExternalLink size={14} />
              </IconButton>
            )}
            <IconButton title="复制摘要" onClick={onCopyReport}>
              <Copy size={14} />
            </IconButton>
            <IconButton title="编辑" onClick={onEdit}>
              <Pencil size={14} />
            </IconButton>
            <IconButton title={store.archivedAt ? '移出归档' : '归档'} onClick={onToggleArchive}>
              {store.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            </IconButton>
            <IconButton title="删除" danger onClick={onDelete}>
              <Trash2 size={14} />
            </IconButton>
          </div>
        </div>
        </div>

        <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
          <DetailSection title="店铺基础" icon={<Store size={16} />}>
            <DetailGrid
              onCopy={onCopyField}
              items={[
                ['平台', PLATFORM_META[store.platform].label],
                ['国家', store.country],
                ['店铺名称', store.storeName],
                ['店铺ID', store.storeId],
                ['店铺链接', store.storeUrl],
                ['来源渠道', store.storeSourceChannel],
                ['店铺注册时间', formatDate(store.storeRegistrationDate)],
                ['店铺状态', STORE_STATUS_META[store.storeStatus].label],
                ['店铺SKU数量', store.skuCount],
                ['回款时间', store.receivingSettlementCycle],
                ['归档时间', store.archivedAt ? formatDate(store.archivedAt) : '未归档'],
              ]}
            />
          </DetailSection>

          <DetailSection title="主体与注册" icon={<Building2 size={16} />}>
            <DetailGrid
              onCopy={onCopyField}
              items={[
                ['店铺主体', store.subjectName],
                ['主体类型', store.subjectType],
                ['法人信息', store.legalPerson],
                ['法人身份证号码', store.legalPersonIdNo],
                ['法人手机', store.legalPersonPhone],
                ['注册号/信用代码', store.licenseNo],
                ['公章编号', store.officialSealNo],
                ['税号', store.taxId],
                ['主体注册时间', formatDate(store.registrationDate)],
                ['注册地址', store.registeredAddress],
              ]}
            />
          </DetailSection>

        <DetailSection title="账号与联系人" icon={<UserRound size={16} />}>
          <DetailGrid
            onCopy={onCopyField}
            items={[
              ['注册邮箱号', store.accountEmail],
              ['绑定手机', store.accountPhone],
              ['联系人姓名', store.contactName],
              ['联系人手机', store.contactPhone],
              ['运营负责人', store.manager],
              ['联系邮箱', store.contactEmail],
            ]}
          />
        </DetailSection>

        <DetailSection title="收款信息" icon={<BarChart3 size={16} />}>
          <DetailGrid
            onCopy={onCopyField}
            items={[
              ['收款渠道', store.receivingChannel === '其他' ? store.receivingChannelOther || '其他' : store.receivingChannel],
              ['收款账户名', store.receivingAccountName],
              ['收款账号/店铺ID', store.receivingAccountId],
              ['收款邮箱', store.receivingAccountEmail],
              ['收款币种', store.receivingCurrency],
              ['收款银行', store.receivingBankName],
              ['银行账号', store.receivingBankAccount],
              ['路由/Swift/IBAN', store.receivingRoutingInfo],
              ['收款备注', store.receivingNote],
            ]}
          />
        </DetailSection>

        <DetailSection title="运营概览" icon={<BarChart3 size={16} />}>
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="30天销售" value={formatMoney(store.last30dSales, store.currency)} />
            <MiniStat label="30天订单" value={store.last30dOrders} />
            <MiniStat label="广告花费" value={formatMoney(store.adSpend, store.currency)} />
            <MiniStat label="店铺评分" value={store.rating || '未填写'} />
            <MiniStat label="库存预警" value={store.inventoryAlerts} danger={store.inventoryAlerts > 0} />
            <MiniStat label="政策警告" value={store.policyWarnings} danger={store.policyWarnings > 0} />
          </div>
          <DetailGrid
            onCopy={onCopyField}
            items={[
              ['最近复核', formatDate(store.lastReviewDate)],
              ['下次年审', formatDate(store.nextAnnualReviewDate)],
            ]}
          />
        </DetailSection>

        <DetailSection
          title="维护记录"
          icon={<ClipboardList size={16} />}
          action={
            <button
              onClick={onAddLog}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs text-white hover:bg-blue-700"
            >
              <Plus size={13} />
              新增
            </button>
          }
        >
          {store.maintenanceLogs.length ? (
            <div className="space-y-2">
              {store.maintenanceLogs.map((log) => (
                <div key={log.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge className={LOG_STATUS_META[log.status].tone}>{LOG_STATUS_META[log.status].label}</Badge>
                        <span className="text-xs text-gray-500">{formatDate(log.date)}</span>
                        <span className="text-xs text-gray-500">{log.type}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{log.title}</p>
                        <CopyFieldButton
                          label="维护事项"
                          value={[
                            formatDate(log.date),
                            log.type,
                            log.title,
                            log.owner ? `负责人：${log.owner}` : '',
                            log.nextFollowDate ? `跟进：${formatDate(log.nextFollowDate)}` : '',
                            log.note || '',
                          ]
                            .filter(Boolean)
                            .join(' / ')}
                          onCopy={onCopyField}
                        />
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {log.owner ? `负责人：${log.owner}` : '负责人未填写'}
                        {log.nextFollowDate ? ` / 跟进：${formatDate(log.nextFollowDate)}` : ''}
                      </p>
                      {log.note && <p className="mt-2 text-xs leading-5 text-gray-600 dark:text-gray-300">{log.note}</p>}
                    </div>
                    <div className="flex gap-1">
                      <IconButton title="编辑维护记录" onClick={() => onEditLog(log)}>
                        <Pencil size={13} />
                      </IconButton>
                      <IconButton title="删除维护记录" danger onClick={() => onDeleteLog(log.id)}>
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-500 dark:bg-gray-900">暂无维护记录</p>
          )}
        </DetailSection>

        <AppealRecordsPreview records={store.appealRecords} onCopy={onCopyField} />

        <DetailSection title="标签与备注" icon={<FileText size={16} />}>
          <div className="flex flex-wrap gap-2">
            {store.tags.length ? (
              store.tags.map((tag) => (
                <Badge key={tag} className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {tag}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-gray-500">暂无标签</span>
            )}
          </div>
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm leading-6 text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            {store.notes || '暂无备注'}
          </p>
        </DetailSection>
        </div>
      </div>
    </BaseModal>
  );
}

function AppealRecordsPreview({
  records,
  onCopy,
}: {
  records: EcommerceAppealRecord[];
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <DetailSection title="申诉记录" icon={<ShieldAlert size={16} />}>
      {records.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-[820px] w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th className="px-2 py-2">暂停时间</th>
                <th className="px-2 py-2">暂停原因</th>
                <th className="px-2 py-2">申诉时间</th>
                <th className="px-2 py-2">申诉次数</th>
                <th className="px-2 py-2">申诉成本</th>
                <th className="px-2 py-2">申诉结果</th>
                <th className="px-2 py-2">恢复时间</th>
                <th className="px-2 py-2">备注</th>
                <th className="px-2 py-2 text-right">复制</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {records.map((record) => {
                const summary = [
                  `暂停时间：${formatDate(record.suspensionDate)}`,
                  `暂停原因：${record.suspensionReason || '未填写'}`,
                  `申诉时间：${formatDate(record.appealDate)}`,
                  `申诉次数：${record.appealCount}`,
                  `申诉成本：${record.appealCost}`,
                  `申诉结果：${record.appealResult || '未填写'}`,
                  `恢复时间：${formatDate(record.recoveryDate)}`,
                  `备注：${record.appealNote || '无'}`,
                ].join('；');
                return (
                  <tr key={record.id}>
                    <td className="px-2 py-2">{formatDate(record.suspensionDate)}</td>
                    <td className="max-w-[220px] truncate px-2 py-2" title={record.suspensionReason}>
                      {record.suspensionReason || '未填写'}
                    </td>
                    <td className="px-2 py-2">{formatDate(record.appealDate)}</td>
                    <td className="px-2 py-2">{record.appealCount}</td>
                    <td className="px-2 py-2">{record.appealCost}</td>
                    <td className="max-w-[180px] truncate px-2 py-2" title={record.appealResult}>
                      {record.appealResult || '未填写'}
                    </td>
                    <td className="px-2 py-2">{formatDate(record.recoveryDate)}</td>
                    <td className="max-w-[180px] truncate px-2 py-2" title={record.appealNote}>
                      {record.appealNote || '无'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <CopyFieldButton label="申诉记录" value={summary} onCopy={onCopy} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-500 dark:bg-gray-900">
          暂无申诉记录
        </p>
      )}
    </DetailSection>
  );
}

function DeleteStoreConfirmModal({
  store,
  onCancel,
  onConfirm,
}: {
  store: EcommerceStoreRecord;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <BaseModal title="确认删除店铺" onClose={onCancel} width="max-w-lg">
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200">
          确定删除「{store.storeName}」吗？此操作会同时删除该店铺的维护记录。
        </div>
        <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          平台：{PLATFORM_META[store.platform].label}
          {store.country ? ` / ${store.country}` : ''}
          {store.subjectName ? ` / ${store.subjectName}` : ''}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
          >
            确认删除
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

function StoreEditorModal({
  store,
  onClose,
  onSave,
}: {
  store: EcommerceStoreRecord;
  onClose: () => void;
  onSave: (store: EcommerceStoreRecord) => void;
}) {
  const [draft, setDraft] = useState<EcommerceStoreRecord>(() => normalizeStore(store));
  const [tagText, setTagText] = useState(store.tags.join('，'));

  function patch(updates: Partial<EcommerceStoreRecord>) {
    setDraft((current) => ({ ...current, ...updates }));
  }

  function updateAppealRecord(recordId: string, updates: Partial<EcommerceAppealRecord>) {
    setDraft((current) => ({
      ...current,
      appealRecords: current.appealRecords.map((record) =>
        record.id === recordId ? { ...record, ...updates } : record
      ),
    }));
  }

  function addAppealRecord() {
    setDraft((current) => ({
      ...current,
      appealRecords: [...current.appealRecords, createEmptyAppealRecord()],
    }));
  }

  function deleteAppealRecord(recordId: string) {
    setDraft((current) => ({
      ...current,
      appealRecords: current.appealRecords.filter((record) => record.id !== recordId),
    }));
  }

  return (
    <BaseModal title={store.storeName ? '编辑店铺' : '新增店铺'} onClose={onClose} width="max-w-5xl">
      <div className="max-h-[72vh] space-y-5 overflow-y-auto pr-1">
        <EditorSection title="店铺基础">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="平台">
              <select value={draft.platform} onChange={(event) => patch({ platform: event.target.value as EcommercePlatform })} className={inputClassName()}>
                {PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>{PLATFORM_META[platform].label}</option>
                ))}
              </select>
            </Field>
            <Field label="国家">
              <input value={draft.country} onChange={(event) => patch({ country: event.target.value })} placeholder="美国 / 英国 / 全球..." className={inputClassName()} />
            </Field>
            <Field label="店铺名称">
              <input value={draft.storeName} onChange={(event) => patch({ storeName: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="店铺ID">
              <input value={draft.storeId || ''} onChange={(event) => patch({ storeId: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="店铺链接">
              <input value={draft.storeUrl || ''} onChange={(event) => patch({ storeUrl: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="来源渠道">
              <input value={draft.storeSourceChannel || ''} onChange={(event) => patch({ storeSourceChannel: event.target.value })} placeholder="如自注册、服务商、收购、内部孵化..." className={inputClassName()} />
            </Field>
            <Field label="店铺注册时间">
              <input type="date" value={draft.storeRegistrationDate || ''} onChange={(event) => patch({ storeRegistrationDate: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="店铺SKU数量">
              <input type="number" value={draft.skuCount} onChange={(event) => patch({ skuCount: toNumber(event.target.value) })} className={inputClassName()} />
            </Field>
            <Field label="回款时间">
              <input
                list="payout-cycle-options"
                value={draft.receivingSettlementCycle || ''}
                onChange={(event) => patch({ receivingSettlementCycle: event.target.value })}
                placeholder="选择 T+N 或手动填写"
                className={inputClassName()}
              />
              <datalist id="payout-cycle-options">
                {PAYOUT_CYCLE_OPTIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>
            <Field label="币种">
              <input value={draft.currency} onChange={(event) => patch({ currency: event.target.value.toUpperCase() })} className={inputClassName()} />
            </Field>
            <Field label="店铺状态">
              <select value={draft.storeStatus} onChange={(event) => patch({ storeStatus: event.target.value as EcommerceStoreStatus })} className={inputClassName()}>
                {Object.entries(STORE_STATUS_META).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.label}</option>
                ))}
              </select>
            </Field>
            <Field label="标签">
              <input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="可用逗号分隔" className={inputClassName()} />
            </Field>
          </div>
        </EditorSection>

        <EditorSection title="主体与注册">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="店铺主体">
              <input value={draft.subjectName} onChange={(event) => patch({ subjectName: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="主体类型">
              <select value={draft.subjectType || ''} onChange={(event) => patch({ subjectType: event.target.value })} className={inputClassName()}>
                <option value="">未设置</option>
                {SUBJECT_TYPE_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="法人信息">
              <input value={draft.legalPerson} onChange={(event) => patch({ legalPerson: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="法人身份证号码">
              <input value={draft.legalPersonIdNo || ''} onChange={(event) => patch({ legalPersonIdNo: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="法人手机">
              <input value={draft.legalPersonPhone || ''} onChange={(event) => patch({ legalPersonPhone: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="注册号/信用代码">
              <input value={draft.licenseNo || ''} onChange={(event) => patch({ licenseNo: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="公章编号">
              <input value={draft.officialSealNo || ''} onChange={(event) => patch({ officialSealNo: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="税号">
              <input value={draft.taxId || ''} onChange={(event) => patch({ taxId: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="主体注册时间">
              <input type="date" value={draft.registrationDate || ''} onChange={(event) => patch({ registrationDate: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="注册地址" className="md:col-span-3">
              <input value={draft.registeredAddress || ''} onChange={(event) => patch({ registeredAddress: event.target.value })} className={inputClassName()} />
            </Field>
          </div>
        </EditorSection>

        <EditorSection title="账号与运营">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="注册邮箱号">
              <input value={draft.accountEmail || ''} onChange={(event) => patch({ accountEmail: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="绑定手机">
              <input value={draft.accountPhone || ''} onChange={(event) => patch({ accountPhone: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="联系人姓名">
              <input value={draft.contactName || ''} onChange={(event) => patch({ contactName: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="联系人手机">
              <input value={draft.contactPhone || ''} onChange={(event) => patch({ contactPhone: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="运营负责人">
              <input value={draft.manager || ''} onChange={(event) => patch({ manager: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="联系邮箱">
              <input value={draft.contactEmail || ''} onChange={(event) => patch({ contactEmail: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="30天销售额">
              <input type="number" value={draft.last30dSales} onChange={(event) => patch({ last30dSales: toNumber(event.target.value) })} className={inputClassName()} />
            </Field>
            <Field label="30天订单">
              <input type="number" value={draft.last30dOrders} onChange={(event) => patch({ last30dOrders: toNumber(event.target.value) })} className={inputClassName()} />
            </Field>
            <Field label="广告花费">
              <input type="number" value={draft.adSpend} onChange={(event) => patch({ adSpend: toNumber(event.target.value) })} className={inputClassName()} />
            </Field>
            <Field label="店铺评分">
              <input value={draft.rating || ''} onChange={(event) => patch({ rating: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="库存预警">
              <input type="number" value={draft.inventoryAlerts} onChange={(event) => patch({ inventoryAlerts: toNumber(event.target.value) })} className={inputClassName()} />
            </Field>
            <Field label="政策警告">
              <input type="number" value={draft.policyWarnings} onChange={(event) => patch({ policyWarnings: toNumber(event.target.value) })} className={inputClassName()} />
            </Field>
            <Field label="最近复核">
              <input type="date" value={draft.lastReviewDate || ''} onChange={(event) => patch({ lastReviewDate: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="下次年审">
              <input type="date" value={draft.nextAnnualReviewDate || ''} onChange={(event) => patch({ nextAnnualReviewDate: event.target.value })} className={inputClassName()} />
            </Field>
          </div>
        </EditorSection>

        <EditorSection title="收款信息">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="收款渠道">
              <select value={draft.receivingChannel || ''} onChange={(event) => patch({ receivingChannel: event.target.value })} className={inputClassName()}>
                <option value="">未设置</option>
                {RECEIVING_CHANNEL_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            {draft.receivingChannel === '其他' && (
              <Field label="其他渠道">
                <input value={draft.receivingChannelOther || ''} onChange={(event) => patch({ receivingChannelOther: event.target.value })} className={inputClassName()} />
              </Field>
            )}
            <Field label="收款账户名">
              <input value={draft.receivingAccountName || ''} onChange={(event) => patch({ receivingAccountName: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="收款账号/店铺ID">
              <input value={draft.receivingAccountId || ''} onChange={(event) => patch({ receivingAccountId: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="收款邮箱">
              <input value={draft.receivingAccountEmail || ''} onChange={(event) => patch({ receivingAccountEmail: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="收款币种">
              <input value={draft.receivingCurrency || ''} onChange={(event) => patch({ receivingCurrency: event.target.value.toUpperCase() })} placeholder="USD / EUR / GBP..." className={inputClassName()} />
            </Field>
            <Field label="收款银行">
              <input value={draft.receivingBankName || ''} onChange={(event) => patch({ receivingBankName: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="银行账号">
              <input value={draft.receivingBankAccount || ''} onChange={(event) => patch({ receivingBankAccount: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="路由/Swift/IBAN">
              <input value={draft.receivingRoutingInfo || ''} onChange={(event) => patch({ receivingRoutingInfo: event.target.value })} className={inputClassName()} />
            </Field>
            <Field label="收款备注" className="md:col-span-4">
              <textarea value={draft.receivingNote || ''} onChange={(event) => patch({ receivingNote: event.target.value })} rows={3} className={textareaClassName()} />
            </Field>
          </div>
        </EditorSection>

        <EditorSection
          title="申诉记录"
          action={
            <button
              type="button"
              onClick={addAppealRecord}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs text-white hover:bg-blue-700"
            >
              <Plus size={13} />
              新增记录
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <tr>
                  <th className="px-2 py-2">暂停时间</th>
                  <th className="px-2 py-2">暂停原因</th>
                  <th className="px-2 py-2">申诉时间</th>
                  <th className="px-2 py-2">申诉次数</th>
                  <th className="px-2 py-2">申诉成本</th>
                  <th className="px-2 py-2">申诉结果</th>
                  <th className="px-2 py-2">恢复时间</th>
                  <th className="px-2 py-2">备注</th>
                  <th className="px-2 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {draft.appealRecords.length ? (
                  draft.appealRecords.map((record) => (
                    <tr key={record.id}>
                      <td className="px-2 py-2">
                        <input type="date" value={record.suspensionDate} onChange={(event) => updateAppealRecord(record.id, { suspensionDate: event.target.value })} className={tableInputClassName()} />
                      </td>
                      <td className="px-2 py-2">
                        <input value={record.suspensionReason} onChange={(event) => updateAppealRecord(record.id, { suspensionReason: event.target.value })} className={tableInputClassName()} />
                      </td>
                      <td className="px-2 py-2">
                        <input type="date" value={record.appealDate} onChange={(event) => updateAppealRecord(record.id, { appealDate: event.target.value })} className={tableInputClassName()} />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min={0} value={record.appealCount} onChange={(event) => updateAppealRecord(record.id, { appealCount: toNumber(event.target.value) })} className={tableInputClassName()} />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min={0} value={record.appealCost} onChange={(event) => updateAppealRecord(record.id, { appealCost: toNumber(event.target.value) })} className={tableInputClassName()} />
                      </td>
                      <td className="px-2 py-2">
                        <input value={record.appealResult} onChange={(event) => updateAppealRecord(record.id, { appealResult: event.target.value })} className={tableInputClassName()} />
                      </td>
                      <td className="px-2 py-2">
                        <input type="date" value={record.recoveryDate} onChange={(event) => updateAppealRecord(record.id, { recoveryDate: event.target.value })} className={tableInputClassName()} />
                      </td>
                      <td className="px-2 py-2">
                        <input value={record.appealNote} onChange={(event) => updateAppealRecord(record.id, { appealNote: event.target.value })} className={tableInputClassName()} />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => deleteAppealRecord(record.id)}
                          className="rounded-lg px-2 py-1 text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-500">
                      暂无申诉记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </EditorSection>

        <EditorSection title="备注">
          <textarea value={draft.notes || ''} onChange={(event) => patch({ notes: event.target.value })} rows={4} className={textareaClassName()} />
        </EditorSection>
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
          取消
        </button>
        <button
          onClick={() =>
            onSave({
              ...draft,
              tags: tagText.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean),
            })
          }
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          保存
        </button>
      </div>
    </BaseModal>
  );
}

function LogEditorModal({
  log,
  onClose,
  onSave,
}: {
  log: EcommerceMaintenanceLog;
  onClose: () => void;
  onSave: (log: EcommerceMaintenanceLog) => void;
}) {
  const [draft, setDraft] = useState(log);
  const patch = (updates: Partial<EcommerceMaintenanceLog>) => setDraft((current) => ({ ...current, ...updates }));

  return (
    <BaseModal title={log.title ? '编辑维护记录' : '新增维护记录'} onClose={onClose} width="max-w-2xl">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="日期">
          <input type="date" value={draft.date} onChange={(event) => patch({ date: event.target.value })} className={inputClassName()} />
        </Field>
        <Field label="类型">
          <input value={draft.type} onChange={(event) => patch({ type: event.target.value })} className={inputClassName()} />
        </Field>
        <Field label="标题" className="md:col-span-2">
          <input value={draft.title} onChange={(event) => patch({ title: event.target.value })} className={inputClassName()} />
        </Field>
        <Field label="负责人">
          <input value={draft.owner} onChange={(event) => patch({ owner: event.target.value })} className={inputClassName()} />
        </Field>
        <Field label="状态">
          <select value={draft.status} onChange={(event) => patch({ status: event.target.value as EcommerceMaintenanceStatus })} className={inputClassName()}>
            {Object.entries(LOG_STATUS_META).map(([value, meta]) => (
              <option key={value} value={value}>{meta.label}</option>
            ))}
          </select>
        </Field>
        <Field label="下次跟进" className="md:col-span-2">
          <input type="date" value={draft.nextFollowDate || ''} onChange={(event) => patch({ nextFollowDate: event.target.value })} className={inputClassName()} />
        </Field>
        <Field label="说明" className="md:col-span-2">
          <textarea value={draft.note || ''} onChange={(event) => patch({ note: event.target.value })} rows={4} className={textareaClassName()} />
        </Field>
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
          取消
        </button>
        <button onClick={() => onSave(draft)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
          保存
        </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className={`w-full ${width} rounded-xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: ReactNode; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between text-gray-500">
        <span className="text-xs">{label}</span>
        {icon}
      </div>
      <div className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

function MiniStat({ label, value, danger }: { label: string; value: ReactNode; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold ${danger ? 'text-red-600 dark:text-red-300' : 'text-gray-900 dark:text-gray-100'}`}>{value}</p>
    </div>
  );
}

function DetailSection({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {icon}
          {title}
        </h3>
        {action}
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
          {onCopy ? (
            <CopyFieldButton label={label} value={String(value || '')} onCopy={onCopy} />
          ) : (
            <span />
          )}
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

function EditorSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h4>
        {action}
      </div>
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
      <Globe2 size={42} className="mb-3 text-gray-300" />
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

function tableInputClassName() {
  return 'w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
}
