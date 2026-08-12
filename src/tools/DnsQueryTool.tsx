// DNS 查询工具
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Search, Copy, Check } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

interface DnsRecord {
  record_type: string;
  value: string;
  ttl: number | null;
}

interface DnsQueryResult {
  success: boolean;
  records: DnsRecord[];
  error: string | null;
}

export default function DnsQueryTool() {
  const ready = useToolTheme();
  const [domain, setDomain] = useState('');
  const [recordType, setRecordType] = useState('A');
  const [dnsServer, setDnsServer] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DnsQueryResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const dnsServers = [
    { name: '系统默认', value: '' },
    { name: 'Google DNS', value: '8.8.8.8' },
    { name: 'Cloudflare DNS', value: '1.1.1.1' },
    { name: '阿里 DNS', value: '223.5.5.5' },
    { name: '腾讯 DNS', value: '119.29.29.29' },
    { name: '114 DNS', value: '114.114.114.114' },
  ];

  const recordTypes = ['A', 'AAAA', 'MX', 'TXT'];

  const handleQuery = async () => {
    if (!domain.trim()) {
      setError('请输入域名');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await invoke<DnsQueryResult>('network_dns_query', {
        domain: domain.trim(),
        recordType,
        dnsServer: dnsServer || null,
      });
      setResult(result);
    } catch (error) {
      setResult({
        success: false,
        records: [],
        error: String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('复制失败:', e);
      setResult((current) =>
        current
          ? {
              ...current,
              error: '复制失败，请检查剪贴板权限',
            }
          : current
      );
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <ToolHeader icon="🔍" title="DNS 查询工具" />

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col p-6 gap-4 overflow-auto">
        {/* 查询表单 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              域名
            </label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如: www.baidu.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                记录类型
              </label>
              <select
                value={recordType}
                onChange={(e) => setRecordType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {recordTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                DNS 服务器
              </label>
              <select
                value={dnsServer}
                onChange={(e) => setDnsServer(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {dnsServers.map((server) => (
                  <option key={server.value} value={server.value}>
                    {server.name} {server.value && `(${server.value})`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleQuery}
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Search size={18} />
            {loading ? '查询中...' : '查询'}
          </button>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* 查询结果 */}
        {result && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              查询结果
            </h3>

            {result.error ? (
              <div className="text-red-600 dark:text-red-400 text-sm">{result.error}</div>
            ) : result.records.length === 0 ? (
              <div className="text-gray-500 dark:text-gray-400 text-sm">未找到记录</div>
            ) : (
              <div className="space-y-2">
                {result.records.map((record, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium rounded">
                          {record.record_type}
                        </span>
                        {record.ttl && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            TTL: {record.ttl}s
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-900 dark:text-gray-100 font-mono break-all">
                        {record.value}
                      </div>
                    </div>
                    <button
                      onClick={() => copyToClipboard(record.value)}
                      className="ml-3 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 说明 */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">
            记录类型说明
          </h4>
          <ul className="text-xs text-blue-800 dark:text-blue-400 space-y-1">
            <li>• A: IPv4 地址记录</li>
            <li>• AAAA: IPv6 地址记录</li>
            <li>• MX: 邮件交换记录</li>
            <li>• TXT: 文本记录（SPF、DKIM 等）</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
