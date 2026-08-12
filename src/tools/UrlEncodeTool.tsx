import { useState, useMemo } from 'react';
import { Copy, Check, RotateCcw, ArrowDown, ClipboardPaste, Lightbulb } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

type EncodeMode = 'encode' | 'decode';
type EncodeScope = 'minimal' | 'full';

const SAFE_CHARS = /[A-Za-z0-9\-_.~]/;

function minimalEncode(str: string): string {
  return Array.from(str)
    .map((ch) => {
      if (SAFE_CHARS.test(ch)) return ch;
      const bytes = new TextEncoder().encode(ch);
      return Array.from(bytes)
        .map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
        .join('');
    })
    .join('');
}

function fullEncode(str: string): string {
  return Array.from(str)
    .map((ch) => {
      if (ch === ' ') return '+';
      const bytes = new TextEncoder().encode(ch);
      return Array.from(bytes)
        .map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
        .join('');
    })
    .join('');
}

function smartDecode(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    try {
      return str
        .replace(/\+/g, ' ')
        .replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    } catch {
      return str;
    }
  }
}

function processText(text: string, mode: EncodeMode, scope: EncodeScope): string {
  if (!text.trim()) return '';
  const lines = text.split('\n');
  if (mode === 'encode') {
    return lines
      .map((line) => (scope === 'minimal' ? minimalEncode(line) : fullEncode(line)))
      .join('\n');
  } else {
    return lines.map((line) => smartDecode(line)).join('\n');
  }
}

const EXAMPLE_INPUT_ENCODE =
  'https://example.com/search?q=你好世界&lang=中文\n路径: /api/用户/列表';
const EXAMPLE_INPUT_DECODE =
  'https%3A%2F%2Fexample.com%2Fsearch%3Fq%3D%E4%BD%A0%E5%A5%BD%E4%B8%96%E7%95%8C%26lang%3D%E4%B8%AD%E6%96%87\n%E8%B7%AF%E5%BE%84%3A%20%2Fapi%2F%E7%94%A8%E6%88%B7%2F%E5%88%97%E8%A1%A8';

export default function UrlEncodeTool() {
  const ready = useToolTheme();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<EncodeMode>('encode');
  const [scope, setScope] = useState<EncodeScope>('minimal');
  const [copied, setCopied] = useState(false);

  const output = useMemo(() => processText(input, mode, scope), [input, mode, scope]);

  const handleCopy = () => {
    if (!output) return;
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
    } catch {}
  };

  const handleExample = () => {
    setInput(mode === 'encode' ? EXAMPLE_INPUT_ENCODE : EXAMPLE_INPUT_DECODE);
  };

  const handleClear = () => {
    setInput('');
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-200/50 dark:border-gray-700/50">
      <ToolHeader
        icon="🌐"
        title="URL 编解码"
        subtitle={input.trim() ? (mode === 'encode' ? '编码' : '解码') : undefined}
        closeMode="hide"
      />

      <div className="flex-1 flex flex-col p-4 gap-3 min-h-0 overflow-hidden">
        {/* Mode & scope controls */}
        <div className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            {/* Encode / Decode toggle */}
            <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <button
                onClick={() => setMode('encode')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'encode'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                URL 编码
              </button>
              <button
                onClick={() => setMode('decode')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'decode'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                URL 解码
              </button>
            </div>

            {/* Encode scope - only show in encode mode */}
            {mode === 'encode' && (
              <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
                <button
                  onClick={() => setScope('minimal')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    scope === 'minimal'
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  最小编码
                </button>
                <button
                  onClick={() => setScope('full')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    scope === 'full'
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  全编码
                </button>
              </div>
            )}
          </div>

          {mode === 'encode' && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {scope === 'minimal'
                ? '仅编码特殊字符（保留字母数字和 -_.~）'
                : '编码所有字符（空格转为 +）'}
            </span>
          )}
        </div>

        {/* Dual-pane editor */}
        <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
          {/* Input */}
          <div className="flex flex-col gap-1 min-h-0">
            <div className="flex items-center justify-between flex-shrink-0">
              <label className="text-xs text-gray-500 dark:text-gray-400">输入文本</label>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleClear}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  <RotateCcw size={10} />
                  清空
                </button>
                <button
                  onClick={handlePaste}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  <ClipboardPaste size={10} />
                  粘贴
                </button>
                <button
                  onClick={handleExample}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  <Lightbulb size={10} />
                  示例
                </button>
              </div>
            </div>
            <textarea
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="在此输入需要编码或解码的文本..."
              className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <span className="text-[11px] text-gray-400 dark:text-gray-500 text-right">
              字符数：{input.length}
            </span>
          </div>

          {/* Output */}
          <div className="flex flex-col gap-1 min-h-0">
            <div className="flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500 dark:text-gray-400">转换结果</label>
                <ArrowDown size={10} className="text-blue-400" />
              </div>
              <button
                onClick={handleCopy}
                disabled={!output}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  copied
                    ? 'bg-green-500 text-white'
                    : output
                      ? 'bg-blue-500 hover:bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                }`}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? '已复制' : '复制结果'}
              </button>
            </div>
            <textarea
              readOnly
              value={output}
              placeholder={
                mode === 'encode' ? '编码结果将在这里显示...' : '解码结果将在这里显示...'
              }
              className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 resize-none focus:outline-none font-mono"
            />
            <span className="text-[11px] text-gray-400 dark:text-gray-500 text-right">
              字符数：{output.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
