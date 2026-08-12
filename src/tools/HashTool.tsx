import { useState } from 'react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Copy, Upload } from 'lucide-react';

async function hashText(text: string, algo: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const buf = await crypto.subtle.digest(algo, data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashBuffer(buffer: ArrayBuffer, algo: string): Promise<string> {
  const buf = await crypto.subtle.digest(algo, buffer);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const ALGOS = [
  { id: 'SHA-1', label: 'SHA-1' },
  { id: 'SHA-256', label: 'SHA-256' },
  { id: 'SHA-384', label: 'SHA-384' },
  { id: 'SHA-512', label: 'SHA-512' },
];

export default function HashTool() {
  useToolTheme();
  const [input, setInput] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [tab, setTab] = useState<'text' | 'file'>('text');

  function handleCopy(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  async function computeText() {
    if (!input.trim()) return;
    setLoading(true);
    const res: Record<string, string> = {};
    for (const { id } of ALGOS) res[id] = await hashText(input, id);
    setResults(res);
    setLoading(false);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    const buffer = await file.arrayBuffer();
    const res: Record<string, string> = {};
    for (const { id } of ALGOS) res[id] = await hashBuffer(buffer, id);
    setResults(res);
    setLoading(false);
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="Hash 计算" icon="#️⃣" />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Tab */}
        <div className="flex rounded-lg p-1 gap-1 bg-gray-100 dark:bg-gray-800">
          {(['text', 'file'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setResults({});
                setFileName('');
              }}
              className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${
                tab === t
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {t === 'text' ? '文本哈希' : '文件哈希'}
            </button>
          ))}
        </div>

        {/* 输入区 */}
        <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          {tab === 'text' ? (
            <>
              <textarea
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none font-mono resize-none bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500"
                rows={4}
                placeholder="输入要计算哈希的文本..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button
                onClick={computeText}
                disabled={loading || !input.trim()}
                className="mt-3 w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
              >
                {loading ? '计算中...' : '计算哈希'}
              </button>
            </>
          ) : (
            <label className="flex flex-col items-center justify-center gap-3 py-8 rounded-lg border-2 border-dashed cursor-pointer transition-colors border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500">
              <Upload size={24} className="text-gray-400" />
              <div className="text-sm text-gray-400">{fileName || '点击或拖拽文件到此处'}</div>
              <input type="file" className="hidden" onChange={handleFile} />
            </label>
          )}
        </div>

        {/* 结果 */}
        {Object.keys(results).length > 0 && (
          <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <div className="text-sm font-medium mb-3 text-gray-500 dark:text-gray-400">
              计算结果
            </div>
            <div className="space-y-3">
              {ALGOS.map(({ id, label }) => (
                <div key={id}>
                  <div className="text-xs text-gray-400 mb-1">{label}</div>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-700">
                    <span className="flex-1 text-sm font-mono break-all">{results[id]}</span>
                    <button
                      onClick={() => handleCopy(results[id], id)}
                      className="text-gray-400 hover:text-blue-500 flex-shrink-0"
                    >
                      {copied === id ? (
                        <span className="text-green-500 text-xs">✓</span>
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 哈希对比 */}
        <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <div className="text-sm font-medium mb-3 text-gray-500 dark:text-gray-400">
            哈希对比验证
          </div>
          <HashCompare results={results} />
        </div>
      </div>
    </div>
  );
}

function HashCompare({ results }: { results: Record<string, string> }) {
  const [compareInput, setCompareInput] = useState('');
  const [algo, setAlgo] = useState('SHA-256');

  const target = results[algo]?.toLowerCase();
  const input = compareInput.trim().toLowerCase();
  const match = input && target ? input === target : null;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          value={algo}
          onChange={(e) => setAlgo(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm outline-none font-mono bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white flex-shrink-0"
        >
          {ALGOS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <input
          className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none font-mono bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400"
          placeholder="粘贴要对比的哈希值..."
          value={compareInput}
          onChange={(e) => setCompareInput(e.target.value)}
        />
      </div>
      {match !== null && (
        <div
          className={`text-sm font-medium px-3 py-2 rounded-lg ${
            match
              ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
              : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
          }`}
        >
          {match ? '✓ 哈希值匹配' : '✗ 哈希值不匹配'}
        </div>
      )}
    </div>
  );
}
