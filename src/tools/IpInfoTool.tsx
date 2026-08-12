// IP 信息查询工具
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Search, Globe, MapPin, Wifi } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

interface IpInfo {
  ip: string;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  timezone: string | null;
  local_ip: string | null;
}

export default function IpInfoTool() {
  const ready = useToolTheme();
  const [ip, setIp] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IpInfo | null>(null);
  const [error, setError] = useState('');

  const handleQuery = async (queryIp?: string) => {
    setLoading(true);
    setError('');
    try {
      const trimmedQuery = typeof queryIp === 'string' ? queryIp.trim() : ip.trim();
      const result = await invoke<IpInfo>('network_get_ip_info', {
        ip: trimmedQuery || null,
      });
      setResult(result);
    } catch (err) {
      setError(String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const queryMyIp = () => {
    setIp('');
    void handleQuery('');
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <ToolHeader icon="🌐" title="IP 信息查询" />

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col p-6 gap-4 overflow-auto">
        {/* 查询表单 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              IP 地址（留空查询本机公网 IP）
            </label>
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如: 8.8.8.8"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => handleQuery()}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Search size={18} />
              {loading ? '查询中...' : '查询'}
            </button>
            <button
              onClick={queryMyIp}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Globe size={18} />
              查询我的 IP
            </button>
          </div>
        </div>

        {/* 错误信息 */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 p-4">
            <div className="text-red-600 dark:text-red-400 text-sm">{error}</div>
          </div>
        )}

        {/* 查询结果 */}
        {result && (
          <div className="space-y-4">
            {/* 本机 IP */}
            {result.local_ip && (
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wifi size={18} className="text-blue-500" />
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    本机 IP
                  </h3>
                </div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 font-mono">
                  {result.local_ip}
                </div>
              </div>
            )}

            {/* 公网 IP 信息 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-4">
                <Globe size={18} className="text-green-500" />
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  公网 IP 信息
                </h3>
              </div>

              <div className="space-y-3">
                <div className="flex items-start">
                  <div className="w-24 text-sm text-gray-600 dark:text-gray-400">IP 地址:</div>
                  <div className="flex-1 text-sm font-mono font-semibold text-gray-900 dark:text-gray-100">
                    {result.ip}
                  </div>
                </div>

                {result.country && (
                  <div className="flex items-start">
                    <div className="w-24 text-sm text-gray-600 dark:text-gray-400">国家:</div>
                    <div className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                      {result.country}
                    </div>
                  </div>
                )}

                {result.region && (
                  <div className="flex items-start">
                    <div className="w-24 text-sm text-gray-600 dark:text-gray-400">省份:</div>
                    <div className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                      {result.region}
                    </div>
                  </div>
                )}

                {result.city && (
                  <div className="flex items-start">
                    <div className="w-24 text-sm text-gray-600 dark:text-gray-400">城市:</div>
                    <div className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                      {result.city}
                    </div>
                  </div>
                )}

                {result.isp && (
                  <div className="flex items-start">
                    <div className="w-24 text-sm text-gray-600 dark:text-gray-400">运营商:</div>
                    <div className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                      {result.isp}
                    </div>
                  </div>
                )}

                {result.timezone && (
                  <div className="flex items-start">
                    <div className="w-24 text-sm text-gray-600 dark:text-gray-400">时区:</div>
                    <div className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                      {result.timezone}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 位置信息 */}
            {(result.country || result.region || result.city) && (
              <div className="bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-900/20 dark:to-green-900/20 rounded-lg border border-blue-200 dark:border-blue-800 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin size={18} className="text-blue-600 dark:text-blue-400" />
                  <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300">
                    地理位置
                  </h4>
                </div>
                <div className="text-lg font-medium text-blue-800 dark:text-blue-400">
                  {[result.country, result.region, result.city].filter(Boolean).join(' · ')}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 说明 */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">使用说明</h4>
          <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <li>• 留空查询：显示本机内网 IP 和公网 IP 信息</li>
            <li>• 输入 IP：查询指定 IP 的地理位置和运营商信息</li>
            <li>• 支持 IPv4 和 IPv6 地址查询</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
