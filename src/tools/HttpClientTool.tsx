import { useState } from 'react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Plus, Trash2, Copy, Send } from 'lucide-react';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
type BodyType = 'none' | 'json' | 'form' | 'text';

interface KVRow {
  key: string;
  value: string;
  enabled: boolean;
}

interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  time: number;
  size: number;
}

const METHOD_COLORS: Record<Method, string> = {
  GET: 'text-green-500',
  POST: 'text-blue-500',
  PUT: 'text-yellow-500',
  PATCH: 'text-orange-500',
  DELETE: 'text-red-500',
  HEAD: 'text-purple-500',
  OPTIONS: 'text-gray-500',
};

export default function HttpClientTool() {
  useToolTheme();
  const [method, setMethod] = useState<Method>('GET');
  const [url, setUrl] = useState('');
  const [params, setParams] = useState<KVRow[]>([{ key: '', value: '', enabled: true }]);
  const [headers, setHeaders] = useState<KVRow[]>([
    { key: 'Content-Type', value: 'application/json', enabled: true },
  ]);
  const [bodyType, setBodyType] = useState<BodyType>('none');
  const [bodyText, setBodyText] = useState('');
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'body'>('params');
  const [resTab, setResTab] = useState<'body' | 'headers'>('body');
  const [copied, setCopied] = useState(false);

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function buildUrl() {
    const active = params.filter((p) => p.enabled && p.key.trim());
    if (!active.length) return url;
    const qs = active
      .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join('&');
    return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
  }

  async function sendRequest() {
    if (!url.trim()) {
      setError('请输入请求 URL');
      return;
    }
    setLoading(true);
    setError('');
    setResponse(null);
    const start = Date.now();
    try {
      const reqHeaders: Record<string, string> = {};
      headers
        .filter((h) => h.enabled && h.key.trim())
        .forEach((h) => {
          reqHeaders[h.key] = h.value;
        });
      let body: string | undefined;
      if (bodyType === 'json' && bodyText.trim()) body = bodyText;
      else if (bodyType === 'text' && bodyText.trim()) body = bodyText;
      else if (bodyType === 'form' && bodyText.trim()) {
        body = bodyText;
        reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      }

      const res = await fetch(buildUrl(), {
        method,
        headers: reqHeaders,
        body: ['GET', 'HEAD'].includes(method) ? undefined : body,
      });
      const time = Date.now() - start;
      const text = await res.text();
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });
      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: text,
        time,
        size: new Blob([text]).size,
      });
    } catch (e) {
      setError(`请求失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function formatBody(text: string) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  const statusColor = response
    ? response.status < 300
      ? 'text-green-500'
      : response.status < 400
        ? 'text-yellow-500'
        : 'text-red-500'
    : '';

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="HTTP 请求" icon="🌐" />
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* URL 栏 */}
        <div className="flex gap-2">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as Method)}
            className={`px-3 py-2 rounded-lg border text-sm outline-none font-bold flex-shrink-0 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 ${METHOD_COLORS[method]}`}
          >
            {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as Method[]).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500"
            placeholder="https://api.example.com/endpoint"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendRequest()}
          />
          <button
            onClick={sendRequest}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg flex items-center gap-1.5 flex-shrink-0"
          >
            <Send size={14} />
            {loading ? '发送中...' : '发送'}
          </button>
        </div>

        {error && <div className="text-xs text-red-500 px-1">{error}</div>}

        {/* 请求配置 */}
        <div className="rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            {(['params', 'headers', 'body'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-4 py-2.5 text-sm transition-colors ${
                  activeTab === t
                    ? 'border-b-2 border-blue-500 text-blue-500'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                }`}
              >
                {t === 'params' ? 'Params' : t === 'headers' ? 'Headers' : 'Body'}
                {t === 'params' && params.filter((p) => p.enabled && p.key).length > 0 && (
                  <span className="ml-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 rounded-full">
                    {params.filter((p) => p.enabled && p.key).length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="p-3">
            {activeTab === 'params' && (
              <KVEditor rows={params} onChange={setParams} placeholder={['参数名', '参数值']} />
            )}
            {activeTab === 'headers' && (
              <KVEditor
                rows={headers}
                onChange={setHeaders}
                placeholder={['Header 名', 'Header 值']}
              />
            )}
            {activeTab === 'body' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {(['none', 'json', 'form', 'text'] as BodyType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setBodyType(t)}
                      className={`px-3 py-1 text-xs rounded-full transition-colors ${bodyType === t ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                    >
                      {t === 'none' ? 'None' : t.toUpperCase()}
                    </button>
                  ))}
                </div>
                {bodyType !== 'none' && (
                  <textarea
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none font-mono resize-none bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400"
                    rows={6}
                    placeholder={
                      bodyType === 'json'
                        ? '{"key": "value"}'
                        : bodyType === 'form'
                          ? 'key=value&key2=value2'
                          : '请求体内容...'
                    }
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* 响应 */}
        {response && (
          <div className="rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <span className={`text-sm font-bold ${statusColor}`}>
                  {response.status} {response.statusText}
                </span>
                <span className="text-xs text-gray-400">{response.time}ms</span>
                <span className="text-xs text-gray-400">
                  {(response.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <div className="flex items-center gap-2">
                {(['body', 'headers'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setResTab(t)}
                    className={`px-3 py-1 text-xs rounded-full transition-colors ${resTab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                  >
                    {t === 'body' ? 'Body' : 'Headers'}
                  </button>
                ))}
                <button
                  onClick={() =>
                    handleCopy(
                      resTab === 'body' ? response.body : JSON.stringify(response.headers, null, 2)
                    )
                  }
                  className="text-gray-400 hover:text-blue-500"
                >
                  {copied ? <span className="text-green-500 text-xs">✓</span> : <Copy size={13} />}
                </button>
              </div>
            </div>
            <div className="p-3">
              {resTab === 'body' ? (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-80 overflow-y-auto p-3 rounded-lg bg-gray-50 dark:bg-gray-700">
                  {formatBody(response.body)}
                </pre>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {Object.entries(response.headers).map(([k, v]) => (
                    <div
                      key={k}
                      className="flex gap-2 text-xs px-2 py-1 rounded bg-gray-50 dark:bg-gray-700"
                    >
                      <span className="text-blue-400 flex-shrink-0">{k}:</span>
                      <span className="font-mono break-all">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KVEditor({
  rows,
  onChange,
  placeholder,
}: {
  rows: KVRow[];
  onChange: (rows: KVRow[]) => void;
  placeholder: [string, string];
}) {
  function update(i: number, field: string, value: string | boolean) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => update(i, 'enabled', e.target.checked)}
            className="flex-shrink-0"
          />
          <input
            className="flex-1 px-2 py-1.5 rounded border text-xs outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400"
            placeholder={placeholder[0]}
            value={row.key}
            onChange={(e) => update(i, 'key', e.target.value)}
          />
          <input
            className="flex-1 px-2 py-1.5 rounded border text-xs outline-none bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400"
            placeholder={placeholder[1]}
            value={row.value}
            onChange={(e) => update(i, 'value', e.target.value)}
          />
          <button
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            className="text-gray-400 hover:text-red-500 flex-shrink-0"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...rows, { key: '', value: '', enabled: true }])}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 mt-1"
      >
        <Plus size={12} /> 添加
      </button>
    </div>
  );
}
