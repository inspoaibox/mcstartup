export type BillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';

export interface SubscriptionCategory {
  id: string;
  name: string;
  color: string;
}

export interface SubscriptionItem {
  id: string;
  name: string;
  categoryId: string;
  amount: number;
  currency: string;
  billingCycle: BillingCycle;
  customDays: number;
  nextPaymentDate: string;
  startDate: string;
  status: SubscriptionStatus;
  paymentMethod: string;
  owner: string;
  website: string;
  notes: string;
  reminderDays: number;
  cancellationDays: number;
  logoText: string;
}

export interface SubscriptionSettings {
  baseCurrency: string;
  exchangeRates: Record<string, number>;
  budgetMonthly: number;
}

export interface SubscriptionStore {
  items: SubscriptionItem[];
  categories: SubscriptionCategory[];
  settings: SubscriptionSettings;
}

export interface SubscriptionManagerToolData extends SubscriptionStore {
  version: string;
  lastModified: string;
}

export const LEGACY_STORAGE_KEY = 'mcstartup:subscription-manager:v1';
export const EDITOR_REQUEST_KEY = 'mcstartup:subscription-manager:editor-request:v1';
export const SUBSCRIPTION_MANAGER_VERSION = 'mcheng-subscription-manager-v1';
export const TODAY = new Date();
const ONE_DAY = 24 * 60 * 60 * 1000;

export const CURRENCIES = ['CNY', 'USD', 'EUR', 'HKD', 'JPY', 'GBP'];

export const DEFAULT_CATEGORIES: SubscriptionCategory[] = [
  { id: 'streaming', name: '影音娱乐', color: '#2563eb' },
  { id: 'software', name: '软件工具', color: '#16a34a' },
  { id: 'cloud', name: '云服务', color: '#9333ea' },
  { id: 'learning', name: '学习成长', color: '#d97706' },
  { id: 'life', name: '生活会员', color: '#dc2626' },
  { id: 'finance', name: '财务服务', color: '#0891b2' },
  { id: 'other', name: '其他', color: '#64748b' },
];

export const DEFAULT_SETTINGS: SubscriptionSettings = {
  baseCurrency: 'CNY',
  exchangeRates: {
    CNY: 1,
    USD: 0,
    EUR: 0,
    HKD: 0,
    JPY: 0,
    GBP: 0,
  },
  budgetMonthly: 0,
};

export const EMPTY_ITEM: SubscriptionItem = {
  id: '',
  name: '',
  categoryId: 'software',
  amount: 0,
  currency: 'CNY',
  billingCycle: 'monthly',
  customDays: 30,
  nextPaymentDate: toDateInput(TODAY),
  startDate: toDateInput(TODAY),
  status: 'active',
  paymentMethod: '',
  owner: '',
  website: '',
  notes: '',
  reminderDays: 7,
  cancellationDays: 3,
  logoText: '',
};

export const DEFAULT_SUBSCRIPTION_STORE: SubscriptionStore = {
  items: [],
  categories: DEFAULT_CATEGORIES,
  settings: DEFAULT_SETTINGS,
};

export function normalizeSubscriptionStore(source?: Partial<SubscriptionStore>): SubscriptionStore {
  return {
    items: Array.isArray(source?.items) ? source.items : [],
    categories: Array.isArray(source?.categories) ? source.categories : DEFAULT_CATEGORIES,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(source?.settings || {}),
      exchangeRates: {
        ...DEFAULT_SETTINGS.exchangeRates,
        ...(source?.settings?.exchangeRates || {}),
      },
    },
  };
}

export function normalizeSubscriptionManagerData(
  source?: Partial<SubscriptionManagerToolData>
): SubscriptionManagerToolData {
  return {
    version: source?.version || SUBSCRIPTION_MANAGER_VERSION,
    ...normalizeSubscriptionStore(source),
    lastModified: source?.lastModified || new Date().toISOString(),
  };
}

export function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function daysBetween(from: Date, to: Date) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.ceil((end - start) / ONE_DAY);
}

export function cycleDays(item: Pick<SubscriptionItem, 'billingCycle' | 'customDays'>) {
  if (item.billingCycle === 'weekly') return 7;
  if (item.billingCycle === 'monthly') return 30.4375;
  if (item.billingCycle === 'quarterly') return 91.3125;
  if (item.billingCycle === 'yearly') return 365;
  return Math.max(1, item.customDays || 30);
}

export function addCycle(date: Date, item: Pick<SubscriptionItem, 'billingCycle' | 'customDays'>) {
  const next = new Date(date);
  if (item.billingCycle === 'weekly') next.setDate(next.getDate() + 7);
  else if (item.billingCycle === 'monthly') next.setMonth(next.getMonth() + 1);
  else if (item.billingCycle === 'quarterly') next.setMonth(next.getMonth() + 3);
  else if (item.billingCycle === 'yearly') next.setFullYear(next.getFullYear() + 1);
  else next.setDate(next.getDate() + Math.max(1, item.customDays || 30));
  return next;
}

export function normalizedNextDate(item: SubscriptionItem) {
  let next = parseDate(item.nextPaymentDate);
  let guard = 0;
  while (daysBetween(TODAY, next) < 0 && guard < 500) {
    next = addCycle(next, item);
    guard += 1;
  }
  return next;
}

export function cycleLabel(value: BillingCycle, customDays: number) {
  if (value === 'weekly') return '每周';
  if (value === 'monthly') return '每月';
  if (value === 'quarterly') return '每季度';
  if (value === 'yearly') return '每年';
  return `每 ${Math.max(1, customDays || 30)} 天`;
}

export function statusLabel(value: SubscriptionStatus) {
  if (value === 'active') return '启用';
  if (value === 'paused') return '暂停';
  return '已取消';
}

export function uid() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function itemInitial(item: SubscriptionItem) {
  return (item.logoText || item.name || '?').trim().slice(0, 2).toUpperCase();
}

export function clampNumber(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function monthlyNative(item: SubscriptionItem) {
  return item.amount * (30.4375 / cycleDays(item));
}

export function yearlyNative(item: SubscriptionItem) {
  return item.amount * (365 / cycleDays(item));
}

export function convertAmount(
  amount: number,
  currency: string,
  settings: SubscriptionSettings
): { value: number; converted: boolean } {
  if (currency === settings.baseCurrency) return { value: amount, converted: true };
  const rate = settings.exchangeRates[currency] || 0;
  if (rate <= 0) return { value: 0, converted: false };
  return { value: amount * rate, converted: true };
}

export function money(value: number, currency: string) {
  const prefix = currency === 'CNY' ? '¥' : `${currency} `;
  return `${prefix}${value.toFixed(value >= 1000 ? 0 : 2)}`;
}

export function loadLegacyStore(): SubscriptionStore | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SubscriptionStore>;
    return normalizeSubscriptionStore(parsed);
  } catch {
    return null;
  }
}

export function clearLegacyStore() {
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function csvValue(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function exportCsv(items: SubscriptionItem[], categories: SubscriptionCategory[]) {
  const categoryById = Object.fromEntries(categories.map((item) => [item.id, item.name]));
  const header = [
    'name',
    'category',
    'amount',
    'currency',
    'cycle',
    'nextPaymentDate',
    'status',
    'paymentMethod',
    'owner',
    'website',
  ];
  const rows = items.map((item) =>
    [
      item.name,
      categoryById[item.categoryId] || item.categoryId,
      item.amount,
      item.currency,
      cycleLabel(item.billingCycle, item.customDays),
      item.nextPaymentDate,
      statusLabel(item.status),
      item.paymentMethod,
      item.owner,
      item.website,
    ]
      .map(csvValue)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
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
