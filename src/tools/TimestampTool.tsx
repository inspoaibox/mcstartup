import { useState, useEffect } from 'react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Copy, RefreshCw, ArrowLeftRight } from 'lucide-react';

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

const FORMATS = [
  { label: 'ISO 8601', fn: (d: Date) => d.toISOString() },
  { label: '本地时间', fn: (d: Date) => d.toLocaleString('zh-CN') },
  { label: 'UTC 时间', fn: (d: Date) => d.toUTCString() },
  { label: '日期', fn: (d: Date) => d.toLocaleDateString('zh-CN') },
  { label: '时间', fn: (d: Date) => d.toLocaleTimeString('zh-CN') },
  {
    label: 'YYYY-MM-DD HH:mm:ss',
    fn: (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    },
  },
];

// 时钟组件独立，避免每秒重渲染整个页面
function LiveClock({
  onCopy,
  copied,
}: {
  onCopy: (v: string, k: string) => void;
  copied: string | null;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const nowSec = Math.floor(now / 1000);
  const items = [
    { label: '秒级时间戳', value: String(nowSec) },
    { label: '毫秒级时间戳', value: String(now) },
    { label: 'ISO 8601', value: new Date(now).toISOString() },
    { label: '本地时间', value: new Date(now).toLocaleString('zh-CN') },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map(({ label, value }) => (
        <div
          key={label}
          className="rounded-lg px-3 py-2 flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-700"
        >
          <div>
            <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
            <div className="text-sm font-mono">{value}</div>
          </div>
          <button
            onClick={() => onCopy(value, label)}
            className="text-gray-400 hover:text-blue-500 flex-shrink-0"
          >
            {copied === label ? (
              <span className="text-green-500 text-xs">✓</span>
            ) : (
              <Copy size={13} />
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function TimestampTool() {
  useToolTheme();
  const [tsInput, setTsInput] = useState('');
  const [tsResult, setTsResult] = useState<Date | null>(null);
  const [tsError, setTsError] = useState('');
  const [dateInput, setDateInput] = useState('');
  const [dateResult, setDateResult] = useState<number | null>(null);
  const [dateError, setDateError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  function handleCopy(text: string, key: string) {
    copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  function parseTimestamp() {
    const raw = tsInput.trim();
    if (!raw) {
      setTsError('请输入时间戳');
      return;
    }
    let num = Number(raw);
    if (isNaN(num)) {
      setTsError('无效的时间戳');
      return;
    }
    if (raw.length <= 10) num *= 1000;
    const d = new Date(num);
    if (isNaN(d.getTime())) {
      setTsError('无效的时间戳');
      return;
    }
    setTsResult(d);
    setTsError('');
  }

  function parseDate() {
    const raw = dateInput.trim();
    if (!raw) {
      setDateError('请输入时间');
      return;
    }
    const d = new Date(raw);
    if (isNaN(d.getTime())) {
      setDateError('无效的时间格式');
      return;
    }
    setDateResult(d.getTime());
    setDateError('');
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="时间戳转换" icon="⏱️" />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 当前时间 - 独立组件，只有它每秒重渲染 */}
        <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">当前时间</span>
            <RefreshCw
              size={14}
              className="text-gray-400 animate-spin"
              style={{ animationDuration: '3s' }}
            />
          </div>
          <LiveClock onCopy={handleCopy} copied={copied} />
        </div>

        {/* 时间戳 → 时间 */}
        <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium">时间戳 → 时间</span>
            <ArrowLeftRight size={14} className="text-gray-400" />
          </div>
          <div className="flex gap-2 mb-3">
            <input
              className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500"
              placeholder="输入时间戳（秒或毫秒）"
              value={tsInput}
              onChange={(e) => setTsInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && parseTimestamp()}
            />
            <button
              onClick={parseTimestamp}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg flex-shrink-0"
            >
              转换
            </button>
          </div>
          {tsError && <p className="text-xs text-red-500 mb-2">{tsError}</p>}
          {tsResult && (
            <div className="grid grid-cols-2 gap-2">
              {FORMATS.map(({ label, fn }) => {
                const val = fn(tsResult);
                return (
                  <div
                    key={label}
                    className="rounded-lg px-3 py-2 flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-700"
                  >
                    <div>
                      <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
                      <div className="text-sm font-mono">{val}</div>
                    </div>
                    <button
                      onClick={() => handleCopy(val, `ts-${label}`)}
                      className="text-gray-400 hover:text-blue-500 flex-shrink-0"
                    >
                      {copied === `ts-${label}` ? (
                        <span className="text-green-500 text-xs">✓</span>
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 时间 → 时间戳 */}
        <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium">时间 → 时间戳</span>
            <ArrowLeftRight size={14} className="text-gray-400" />
          </div>
          <div className="flex gap-2 mb-3">
            <input
              className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500"
              placeholder="如：2024-01-01 12:00:00 或 2024-01-01T12:00:00Z"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && parseDate()}
            />
            <button
              onClick={parseDate}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg flex-shrink-0"
            >
              转换
            </button>
          </div>
          {dateError && <p className="text-xs text-red-500 mb-2">{dateError}</p>}
          {dateResult !== null && (
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: '秒级时间戳', value: String(Math.floor(dateResult / 1000)) },
                { label: '毫秒级时间戳', value: String(dateResult) },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-lg px-3 py-2 flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-700"
                >
                  <div>
                    <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
                    <div className="text-sm font-mono">{value}</div>
                  </div>
                  <button
                    onClick={() => handleCopy(value, `date-${label}`)}
                    className="text-gray-400 hover:text-blue-500 flex-shrink-0"
                  >
                    {copied === `date-${label}` ? (
                      <span className="text-green-500 text-xs">✓</span>
                    ) : (
                      <Copy size={13} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
