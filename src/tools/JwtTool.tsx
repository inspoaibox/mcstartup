import { useState } from 'react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Copy, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    return decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
  } catch {
    return atob(padded);
  }
}

interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
}

function parseJwt(token: string): { parts: JwtParts } | { error: string } {
  const parts = token.trim().split('.');
  if (parts.length !== 3)
    return { error: 'JWT 格式错误，应包含 3 个部分（header.payload.signature）' };
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return { parts: { header, payload, signature: parts[2] } };
  } catch {
    return { error: '解析失败，请检查 JWT 格式' };
  }
}

function getExpStatus(payload: Record<string, unknown>) {
  const exp = payload.exp as number | undefined;
  if (!exp) return { status: 'unknown' as const, label: '无过期时间' };
  const now = Math.floor(Date.now() / 1000);
  if (now > exp)
    return {
      status: 'expired' as const,
      label: `已过期（${new Date(exp * 1000).toLocaleString('zh-CN')}）`,
    };
  const diff = exp - now;
  return {
    status: 'valid' as const,
    label: `有效（${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m 后过期）`,
  };
}

export default function JwtTool() {
  useToolTheme();
  const [input, setInput] = useState('');
  const [result, setResult] = useState<JwtParts | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  function handleCopy(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  function handleParse() {
    if (!input.trim()) {
      setError('请输入 JWT Token');
      return;
    }
    const res = parseJwt(input);
    if ('error' in res) {
      setError(res.error);
      setResult(null);
    } else {
      setResult(res.parts);
      setError('');
    }
  }

  const expStatus = result ? getExpStatus(result.payload) : null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="JWT 解析" icon="🔑" />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <div className="text-sm font-medium mb-2 text-gray-500 dark:text-gray-400">JWT Token</div>
          <textarea
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none font-mono resize-none bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500"
            rows={4}
            placeholder="粘贴 JWT Token..."
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError('');
            }}
          />
          {error && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-500">
              <AlertTriangle size={12} />
              {error}
            </div>
          )}
          <button
            onClick={handleParse}
            className="mt-3 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            解析
          </button>
        </div>

        {result && (
          <>
            {expStatus && (
              <div
                className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm ${
                  expStatus.status === 'valid'
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                    : expStatus.status === 'expired'
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                      : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'
                }`}
              >
                {expStatus.status === 'valid' ? <CheckCircle size={15} /> : <Clock size={15} />}
                {expStatus.label}
              </div>
            )}

            <JwtSection
              title="Header"
              titleColor="text-blue-500"
              data={result.header}
              copied={copied}
              onCopy={handleCopy}
              copyKey="header"
            />
            <JwtSection
              title="Payload"
              titleColor="text-purple-500"
              data={result.payload}
              copied={copied}
              onCopy={handleCopy}
              copyKey="payload"
              isPayload
            />

            <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-red-500">Signature</span>
                <button
                  onClick={() => handleCopy(result.signature, 'sig')}
                  className="text-gray-400 hover:text-blue-500"
                >
                  {copied === 'sig' ? (
                    <span className="text-green-500 text-xs">✓</span>
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
              </div>
              <div className="text-xs font-mono break-all px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700">
                {result.signature}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const TIME_FIELDS = ['iat', 'exp', 'nbf'];

function JwtSection({
  title,
  titleColor,
  data,
  copied,
  onCopy,
  copyKey,
  isPayload,
}: {
  title: string;
  titleColor: string;
  data: Record<string, unknown>;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
  copyKey: string;
  isPayload?: boolean;
}) {
  return (
    <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-medium ${titleColor}`}>{title}</span>
        <button
          onClick={() => onCopy(JSON.stringify(data, null, 2), copyKey)}
          className="text-gray-400 hover:text-blue-500"
        >
          {copied === copyKey ? (
            <span className="text-green-500 text-xs">✓</span>
          ) : (
            <Copy size={13} />
          )}
        </button>
      </div>
      <div className="space-y-2">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-700">
            <div className="text-[10px] text-gray-400 mb-0.5">{key}</div>
            <div className="text-sm font-mono break-all">{String(value)}</div>
            {isPayload && TIME_FIELDS.includes(key) && typeof value === 'number' && (
              <div className="text-[10px] text-blue-400 mt-0.5">
                {new Date(value * 1000).toLocaleString('zh-CN')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
