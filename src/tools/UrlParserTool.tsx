// URL 解析工具
import { useState } from 'react';
import { Copy, Check, RotateCcw, Link, AlertCircle } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

interface ParsedUrl {
  original: string;
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  href: string;
  searchParams: Record<string, string>;
  pathSegments: string[];
  isValid: boolean;
  error?: string;
}

export default function UrlParserTool() {
  const ready = useToolTheme();
  const [inputUrl, setInputUrl] = useState('');
  const [parsedUrl, setParsedUrl] = useState<ParsedUrl | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // 解析 URL
  const handleParse = () => {
    if (!inputUrl.trim()) {
      setParsedUrl(null);
      return;
    }

    try {
      const url = new URL(inputUrl.trim());

      // 解析查询参数
      const searchParams: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        searchParams[key] = value;
      });

      // 解析路径段
      const pathSegments = url.pathname.split('/').filter((segment) => segment.length > 0);

      const parsed: ParsedUrl = {
        original: inputUrl.trim(),
        protocol: url.protocol,
        hostname: url.hostname,
        port:
          url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : ''),
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
        origin: url.origin,
        href: url.href,
        searchParams,
        pathSegments,
        isValid: true,
      };

      setParsedUrl(parsed);
    } catch (error) {
      setParsedUrl({
        original: inputUrl.trim(),
        protocol: '',
        hostname: '',
        port: '',
        pathname: '',
        search: '',
        hash: '',
        origin: '',
        href: '',
        searchParams: {},
        pathSegments: [],
        isValid: false,
        error: '无效的 URL 格式',
      });
    }
  };

  // 复制内容
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  // 清空
  const handleClear = () => {
    setInputUrl('');
    setParsedUrl(null);
  };

  // 示例 URL
  const examples = [
    'https://www.example.com:8080/path/to/page?name=value&foo=bar#section',
    'http://localhost:3000/api/users?page=1&limit=10',
    'https://github.com/user/repo/issues?q=is%3Aopen+is%3Aissue',
    'ftp://files.example.com:21/downloads/file.zip',
  ];

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* Header */}
      <ToolHeader icon="🔗" title="URL 解析" subtitle="解析 URL 各个组成部分" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* 输入区域 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            输入 URL
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleParse()}
              placeholder="https://www.example.com/path?query=value#hash"
              className="flex-1 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleParse}
              disabled={!inputUrl.trim()}
              className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Link size={18} />
              解析
            </button>
            <button
              onClick={handleClear}
              className="px-4 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              title="清空"
            >
              <RotateCcw size={18} />
            </button>
          </div>
        </div>

        {/* 示例 URL */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            示例 URL
          </label>
          <div className="grid grid-cols-2 gap-2">
            {examples.map((example, index) => (
              <button
                key={index}
                onClick={() => {
                  setInputUrl(example);
                  setTimeout(() => handleParse(), 100);
                }}
                className="px-3 py-2 text-left text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-mono truncate"
                title={example}
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        {/* 解析结果 */}
        {parsedUrl && (
          <div className="space-y-4">
            {!parsedUrl.isValid ? (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
                <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
                <div>
                  <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">解析失败</h3>
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">{parsedUrl.error}</p>
                  <p className="text-xs text-red-500 dark:text-red-500 mt-2">
                    请确保 URL 包含协议（如 http:// 或 https://）
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* 基本信息 */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-3">
                    基本信息
                  </h3>
                  <div className="space-y-2">
                    <ResultItem
                      label="完整 URL"
                      value={parsedUrl.href}
                      onCopy={() => handleCopy(parsedUrl.href, 'href')}
                      copied={copied === 'href'}
                    />
                    <ResultItem
                      label="源地址"
                      value={parsedUrl.origin}
                      onCopy={() => handleCopy(parsedUrl.origin, 'origin')}
                      copied={copied === 'origin'}
                    />
                    <ResultItem
                      label="协议"
                      value={parsedUrl.protocol}
                      onCopy={() => handleCopy(parsedUrl.protocol, 'protocol')}
                      copied={copied === 'protocol'}
                      badge={parsedUrl.protocol === 'https:' ? 'secure' : undefined}
                    />
                  </div>
                </div>

                {/* 主机信息 */}
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-green-800 dark:text-green-300 mb-3">
                    主机信息
                  </h3>
                  <div className="space-y-2">
                    <ResultItem
                      label="主机名"
                      value={parsedUrl.hostname}
                      onCopy={() => handleCopy(parsedUrl.hostname, 'hostname')}
                      copied={copied === 'hostname'}
                    />
                    <ResultItem
                      label="端口"
                      value={parsedUrl.port}
                      onCopy={() => handleCopy(parsedUrl.port, 'port')}
                      copied={copied === 'port'}
                      badge={
                        parsedUrl.port === '443' || parsedUrl.port === '80' ? 'default' : undefined
                      }
                    />
                  </div>
                </div>

                {/* 路径信息 */}
                <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-purple-800 dark:text-purple-300 mb-3">
                    路径信息
                  </h3>
                  <div className="space-y-2">
                    <ResultItem
                      label="路径"
                      value={parsedUrl.pathname || '/'}
                      onCopy={() => handleCopy(parsedUrl.pathname, 'pathname')}
                      copied={copied === 'pathname'}
                    />
                    {parsedUrl.pathSegments.length > 0 && (
                      <div className="mt-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">路径段：</span>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {parsedUrl.pathSegments.map((segment, index) => (
                            <span
                              key={index}
                              className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-xs font-mono"
                            >
                              {index + 1}. {segment}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 查询参数 */}
                {parsedUrl.search && (
                  <div className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-orange-800 dark:text-orange-300 mb-3">
                      查询参数
                    </h3>
                    <div className="space-y-2">
                      <ResultItem
                        label="原始查询字符串"
                        value={parsedUrl.search}
                        onCopy={() => handleCopy(parsedUrl.search, 'search')}
                        copied={copied === 'search'}
                      />
                      {Object.keys(parsedUrl.searchParams).length > 0 && (
                        <div className="mt-3 space-y-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            解析后的参数：
                          </span>
                          {Object.entries(parsedUrl.searchParams).map(([key, value]) => (
                            <div
                              key={key}
                              className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-orange-200 dark:border-orange-800"
                            >
                              <div className="flex-1 font-mono text-xs">
                                <span className="text-orange-600 dark:text-orange-400 font-semibold">
                                  {key}
                                </span>
                                <span className="text-gray-500 dark:text-gray-400 mx-2">=</span>
                                <span className="text-gray-700 dark:text-gray-300">{value}</span>
                              </div>
                              <button
                                onClick={() => handleCopy(`${key}=${value}`, `param-${key}`)}
                                className={`ml-2 p-1 rounded transition-colors ${
                                  copied === `param-${key}`
                                    ? 'text-green-500'
                                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                                }`}
                              >
                                {copied === `param-${key}` ? (
                                  <Check size={14} />
                                ) : (
                                  <Copy size={14} />
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 锚点 */}
                {parsedUrl.hash && (
                  <div className="bg-gradient-to-r from-cyan-50 to-sky-50 dark:from-cyan-900/20 dark:to-sky-900/20 border border-cyan-200 dark:border-cyan-800 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-cyan-800 dark:text-cyan-300 mb-3">
                      锚点/片段
                    </h3>
                    <ResultItem
                      label="Hash"
                      value={parsedUrl.hash}
                      onCopy={() => handleCopy(parsedUrl.hash, 'hash')}
                      copied={copied === 'hash'}
                    />
                  </div>
                )}

                {/* 请求方法说明 */}
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-300 mb-3">
                    💡 请求方法说明
                  </h3>
                  <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                    <p>
                      <strong className="text-gray-800 dark:text-gray-200">GET 请求：</strong>
                      通常用于获取资源，参数在 URL 中可见
                    </p>
                    <p>
                      <strong className="text-gray-800 dark:text-gray-200">POST 请求：</strong>
                      用于提交数据，参数在请求体中，URL 中不可见
                    </p>
                    <p className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                      <strong className="text-blue-700 dark:text-blue-300">当前 URL：</strong>
                      {parsedUrl.search
                        ? ' 包含查询参数，适合 GET 请求'
                        : ' 无查询参数，可能是 GET 或 POST 请求'}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 结果项组件
function ResultItem({
  label,
  value,
  onCopy,
  copied,
  badge,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  badge?: 'secure' | 'default';
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
          {badge === 'secure' && (
            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs rounded">
              安全
            </span>
          )}
          {badge === 'default' && (
            <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-xs rounded">
              默认
            </span>
          )}
        </div>
        <p className="text-sm font-mono text-gray-800 dark:text-gray-200 break-all">{value}</p>
      </div>
      <button
        onClick={onCopy}
        className={`ml-3 p-2 rounded-lg transition-colors flex-shrink-0 ${
          copied
            ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
        }`}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}
