import { useState } from 'react';
import { pinyin } from 'pinyin-pro';
import { Copy, RotateCcw } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

type Mode = 'tone' | 'num' | 'none' | 'initial';

const MODES: { key: Mode; label: string }[] = [
  { key: 'tone', label: '带声调' },
  { key: 'num', label: '数字声调' },
  { key: 'none', label: '无声调' },
  { key: 'initial', label: '首字母' },
];

export default function PinyinTool() {
  const ready = useToolTheme();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('tone');
  const [separator, setSeparator] = useState(' ');
  const [copied, setCopied] = useState(false);

  const convert = (text: string, m: Mode, sep: string): string => {
    if (!text.trim()) return '';
    if (m === 'initial') {
      return pinyin(text, { pattern: 'first', separator: sep, toneType: 'none' });
    }
    return pinyin(text, {
      toneType: m === 'tone' ? 'symbol' : m === 'num' ? 'num' : 'none',
      separator: sep,
    });
  };

  const result = convert(input, mode, separator);

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-200/50 dark:border-gray-700/50">
      <ToolHeader icon="🔤" title="文字转拼音" closeMode="hide" />

      <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
        {/* 模式选择 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">模式：</span>
          <div className="flex gap-1">
            {MODES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  mode === key
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-xs text-gray-500 dark:text-gray-400">分隔：</span>
            {[
              { val: ' ', label: '空格' },
              { val: '-', label: '横线' },
              { val: '', label: '无' },
            ].map(({ val, label }) => (
              <button
                key={label}
                onClick={() => setSeparator(val)}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  separator === val
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 输入框 */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          <label className="text-xs text-gray-500 dark:text-gray-400">输入汉字</label>
          <textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="在此输入汉字..."
            rows={5}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* 结果区 */}
        <div className="flex-1 flex flex-col gap-1 min-h-0">
          <div className="flex items-center justify-between flex-shrink-0">
            <label className="text-xs text-gray-500 dark:text-gray-400">拼音结果</label>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setInput('')}
                className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <RotateCcw size={11} />
                清空
              </button>
              <button
                onClick={handleCopy}
                disabled={!result}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  copied
                    ? 'bg-green-500 text-white'
                    : result
                      ? 'bg-blue-500 hover:bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                }`}
              >
                <Copy size={11} />
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-[120px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 overflow-auto break-all leading-relaxed">
            {result || (
              <span className="text-gray-300 dark:text-gray-600">拼音将显示在这里...</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
