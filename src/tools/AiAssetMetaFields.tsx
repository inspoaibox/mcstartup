import { CalendarCheck, ClipboardList, Link2, Star } from 'lucide-react';
import type { AssetMeta, AssetStatus } from '../stores/toolDataStore';
import {
  ASSET_STATUS_OPTIONS,
  formatAssetDate,
  getAssetStatusOption,
  normalizeAssetMeta,
} from './aiAssetUtils';

interface AiAssetMetaFieldsProps {
  meta: AssetMeta;
  onChange: (meta: AssetMeta) => void;
}

export function AiAssetMetaFields({ meta, onChange }: AiAssetMetaFieldsProps) {
  const normalized = normalizeAssetMeta(meta);
  const patchMeta = (updates: AssetMeta) => onChange({ ...normalized, ...updates });

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        <ClipboardList size={15} />
        资产信息
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            来源名称
          </label>
          <input
            type="text"
            value={normalized.sourceName || ''}
            onChange={(e) => patchMeta({ sourceName: e.target.value })}
            placeholder="网站、作者或频道"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            <span className="flex items-center gap-1">
              <Link2 size={14} />
              来源链接
            </span>
          </label>
          <input
            type="url"
            value={normalized.sourceUrl || ''}
            onChange={(e) => patchMeta({ sourceUrl: e.target.value })}
            placeholder="https://..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            状态
          </label>
          <select
            value={normalized.status}
            onChange={(e) => patchMeta({ status: e.target.value as AssetStatus })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ASSET_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            <span className="flex items-center gap-1">
              <Star size={14} />
              评分
            </span>
          </label>
          <select
            value={normalized.rating || 0}
            onChange={(e) => patchMeta({ rating: Number(e.target.value) })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={0}>未评分</option>
            {[1, 2, 3, 4, 5].map((rating) => (
              <option key={rating} value={rating}>
                {'★'.repeat(rating)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            <span className="flex items-center gap-1">
              <CalendarCheck size={14} />
              验证日期
            </span>
          </label>
          <input
            type="date"
            value={normalized.lastVerified?.slice(0, 10) || ''}
            onChange={(e) => patchMeta({ lastVerified: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          收藏理由
        </label>
        <textarea
          value={normalized.collectReason || ''}
          onChange={(e) => patchMeta({ collectReason: e.target.value })}
          placeholder="为什么值得收藏、适合什么场景"
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {(normalized.usageCount || 0) > 0 && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          已复制使用 {normalized.usageCount} 次
        </div>
      )}
    </div>
  );
}

export function AiAssetMetaSummary({ meta }: { meta?: AssetMeta }) {
  const normalized = normalizeAssetMeta(meta);
  const status = getAssetStatusOption(normalized.status);
  const rating = normalized.rating || 0;
  const usageCount = normalized.usageCount || 0;

  if (!meta && status.value === 'active' && rating === 0 && usageCount === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs mb-2">
      <span className={`px-2 py-0.5 rounded ${status.badgeClass}`}>{status.label}</span>
      {rating > 0 && (
        <span className="px-2 py-0.5 rounded bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
          {'★'.repeat(rating)}
        </span>
      )}
      {usageCount > 0 && (
        <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">
          {usageCount} 次
        </span>
      )}
      {normalized.lastVerified && (
        <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          {formatAssetDate(normalized.lastVerified)}
        </span>
      )}
    </div>
  );
}
