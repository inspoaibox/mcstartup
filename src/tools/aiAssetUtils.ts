import type { AssetMeta, AssetStatus } from '../stores/toolDataStore';

export const ASSET_STATUS_OPTIONS: Array<{
  value: AssetStatus;
  label: string;
  badgeClass: string;
}> = [
  {
    value: 'active',
    label: '可用',
    badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  },
  {
    value: 'testing',
    label: '待验证',
    badgeClass: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  },
  {
    value: 'needs-review',
    label: '需复查',
    badgeClass: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
  },
  {
    value: 'archived',
    label: '归档',
    badgeClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  },
];

const TEMPLATE_VARIABLE_PATTERN = /\{([^{}\r\n]{1,40})\}/g;

export function normalizeAssetMeta(meta?: AssetMeta): AssetMeta {
  const rating = Number(meta?.rating ?? 0);
  const usageCount = Number(meta?.usageCount ?? 0);

  return {
    ...meta,
    status: meta?.status || 'active',
    rating: Number.isFinite(rating) ? Math.min(5, Math.max(0, Math.round(rating))) : 0,
    usageCount: Number.isFinite(usageCount) ? Math.max(0, Math.round(usageCount)) : 0,
  };
}

export function cleanAssetMeta(meta?: AssetMeta): AssetMeta | undefined {
  const normalized = normalizeAssetMeta(meta);
  const cleaned: AssetMeta = {
    status: normalized.status,
    rating: normalized.rating,
    usageCount: normalized.usageCount,
  };

  if (normalized.sourceName?.trim()) cleaned.sourceName = normalized.sourceName.trim();
  if (normalized.sourceUrl?.trim()) cleaned.sourceUrl = normalized.sourceUrl.trim();
  if (normalized.collectReason?.trim()) cleaned.collectReason = normalized.collectReason.trim();
  if (normalized.lastVerified?.trim()) cleaned.lastVerified = normalized.lastVerified.trim();

  const hasMeaningfulMeta =
    cleaned.sourceName ||
    cleaned.sourceUrl ||
    cleaned.collectReason ||
    cleaned.lastVerified ||
    (cleaned.rating || 0) > 0 ||
    (cleaned.usageCount || 0) > 0 ||
    cleaned.status !== 'active';

  return hasMeaningfulMeta ? cleaned : undefined;
}

export function incrementAssetUsage<T extends { meta?: AssetMeta; updateTime?: string }>(
  item: T
): T {
  const meta = normalizeAssetMeta(item.meta);

  return {
    ...item,
    meta: {
      ...meta,
      usageCount: (meta.usageCount || 0) + 1,
    },
    updateTime: new Date().toISOString(),
  };
}

export function getAssetStatusOption(status?: AssetStatus) {
  return ASSET_STATUS_OPTIONS.find((option) => option.value === status) || ASSET_STATUS_OPTIONS[0];
}

export function formatAssetDate(date?: string): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('zh-CN');
}

export function extractTemplateVariables(content: string): string[] {
  const variables = new Set<string>();
  let match: RegExpExecArray | null;

  TEMPLATE_VARIABLE_PATTERN.lastIndex = 0;
  while ((match = TEMPLATE_VARIABLE_PATTERN.exec(content)) !== null) {
    const name = match[1].trim();
    if (name && !/["':,]/.test(name)) variables.add(name);
  }

  return Array.from(variables);
}

export function promptForTemplateValues(content: string): string {
  const variables = extractTemplateVariables(content);
  if (variables.length === 0) return content;

  const values = new Map<string, string | null>();
  variables.forEach((variable) => {
    values.set(variable, window.prompt(`填写变量：${variable}`, ''));
  });

  TEMPLATE_VARIABLE_PATTERN.lastIndex = 0;
  return content.replace(TEMPLATE_VARIABLE_PATTERN, (placeholder, rawName: string) => {
    const name = rawName.trim();
    const value = values.get(name);
    return value ? value : placeholder;
  });
}
