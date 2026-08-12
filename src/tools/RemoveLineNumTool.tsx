import { useState, useMemo } from 'react';
import { Copy, RotateCcw, Check, AlertCircle } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

// ─── 预设行号格式 ─────────────────────────────────────────────────

interface Preset {
  label: string;
  pattern: string;
  example: string;
}

const PRESETS: Preset[] = [
  { label: '数字.', pattern: '^\\d+\\.\\s*', example: '1. 文本' },
  { label: '数字-', pattern: '^\\d+\\-\\s*', example: '2- 文本' },
  { label: '(数字)', pattern: '^\\(\\d+\\)\\s*', example: '(3) 文本' },
  { label: '[数字]', pattern: '^\\[\\d+\\]\\s*', example: '[4] 文本' },
  { label: '数字、', pattern: '^\\d+、\\s*', example: '5、文本' },
  { label: '数字)', pattern: '^\\d+\\)\\s*', example: '6) 文本' },
  { label: '数字：', pattern: '^\\d+：\\s*', example: '7：文本' },
  { label: '数字:', pattern: '^\\d+:\\s*', example: '8: 文本' },
];

// 自动检测文本中使用的行号格式
function autoDetect(text: string): string[] {
  const detected: string[] = [];
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return detected;
  for (const preset of PRESETS) {
    const re = new RegExp(preset.pattern);
    const matchCount = lines.filter((l) => re.test(l)).length;
    if (matchCount > lines.length * 0.3) {
      // 超过30%的行匹配则认为是该格式
      detected.push(preset.pattern);
    }
  }
  return detected;
}

export default function RemoveLineNumTool() {
  const ready = useToolTheme();

  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'auto' | 'preset' | 'custom'>('auto');
  const [selectedPresets, setSelectedPresets] = useState<string[]>([]);
  const [customPattern, setCustomPattern] = useState('');
  const [regexError, setRegexError] = useState('');
  const [keepEmpty, setKeepEmpty] = useState(true);
  const [copied, setCopied] = useState(false);

  // 自动检测到的格式
  const autoDetected = useMemo(() => autoDetect(input), [input]);

  // 构建最终使用的正则
  const activePatterns = useMemo((): string[] => {
    if (mode === 'auto') return autoDetected;
    if (mode === 'preset') return selectedPresets;
    return customPattern ? [customPattern] : [];
  }, [mode, autoDetected, selectedPresets, customPattern]);

  const result = useMemo(() => {
    if (!input.trim()) return '';
    if (activePatterns.length === 0) return input;

    try {
      // 合并所有模式为一个正则
      const combined = activePatterns.map((p) => `(?:${p})`).join('|');
      const re = new RegExp(combined);
      setRegexError('');

      return input
        .split('\n')
        .map((line) => {
          const trimmed = line.replace(re, '');
          return trimmed;
        })
        .filter((line) => keepEmpty || line.trim() !== '')
        .join('\n');
    } catch (e) {
      setRegexError(String(e));
      return input;
    }
  }, [input, activePatterns, keepEmpty]);

  const removedCount = useMemo(() => {
    if (!input || !result) return 0;
    const inputLines = input.split('\n').filter((l) => l.trim());
    const resultLines = result.split('\n').filter((l) => l.trim());
    return inputLines.length - resultLines.length;
  }, [input, result]);

  const handleCopy = () => {
    if (!result.trim()) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const togglePreset = (pattern: string) => {
    setSelectedPresets((prev) =>
      prev.includes(pattern) ? prev.filter((p) => p !== pattern) : [...prev, pattern]
    );
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-200/50 dark:border-gray-700/50">
      <ToolHeader
        icon="🔢"
        title="去行号工具"
        subtitle={autoDetected.length > 0 && mode === 'auto' ? `自动检测到 ${autoDetected.length} 种格式` : undefined}
        closeMode="hide"
      />

      <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden min-h-0">
        {/* 模式选择 */}
        <div className="flex-shrink-0 space-y-2">
          <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
            {(['auto', 'preset', 'custom'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${mode === m ? 'bg-white dark:bg-gray-700 text-blue-600 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
              >
                {m === 'auto' ? '🤖 自动检测' : m === 'preset' ? '📋 预设格式' : '✏️ 自定义正则'}
              </button>
            ))}
          </div>

          {/* 自动模式说明 */}
          {mode === 'auto' && (
            <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
              {input.trim() ? (
                autoDetected.length > 0 ? (
                  <span className="text-green-600 dark:text-green-400">
                    ✓ 检测到行号格式：
                    {autoDetected
                      .map((p) => PRESETS.find((pr) => pr.pattern === p)?.label ?? p)
                      .join('、')}
                  </span>
                ) : (
                  <span className="text-amber-500">
                    未检测到已知行号格式，请切换到预设或自定义模式
                  </span>
                )
              ) : (
                '粘贴文本后自动检测行号格式'
              )}
            </div>
          )}

          {/* 预设格式选择 */}
          {mode === 'preset' && (
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.pattern}
                  onClick={() => togglePreset(p.pattern)}
                  title={`示例：${p.example}`}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    selectedPresets.includes(p.pattern)
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {p.label}
                  <span className="ml-1 opacity-60 text-[10px]">{p.example}</span>
                </button>
              ))}
            </div>
          )}

          {/* 自定义正则 */}
          {mode === 'custom' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm font-mono">/</span>
                <input
                  type="text"
                  value={customPattern}
                  onChange={(e) => setCustomPattern(e.target.value)}
                  placeholder="如：^\d+\.\s* 或 ^\(\d+\)\s*"
                  className={`flex-1 px-2.5 py-1.5 text-sm border rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono ${regexError ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'}`}
                />
                <span className="text-gray-400 text-sm font-mono">/m</span>
              </div>
              {regexError && (
                <div className="flex items-center gap-1.5 text-xs text-red-500">
                  <AlertCircle size={12} />
                  {regexError}
                </div>
              )}
              {/* 快速填入预设 */}
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-gray-400 self-center">快速填入：</span>
                {PRESETS.map((p) => (
                  <button
                    key={p.pattern}
                    onClick={() => setCustomPattern(p.pattern)}
                    className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 rounded transition-colors font-mono"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 选项 */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={keepEmpty}
                onChange={(e) => setKeepEmpty(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-blue-500"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">保留空行</span>
            </label>
            {result && result !== input && (
              <span className="text-xs text-green-600 dark:text-green-400">
                ✓ 已处理 {result.split('\n').filter((l) => l.trim()).length} 行
                {removedCount > 0 && `，移除 ${removedCount} 个行号`}
              </span>
            )}
          </div>
        </div>

        {/* 双栏编辑区 */}
        <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
          <div className="flex flex-col gap-1 min-h-0">
            <div className="flex items-center justify-between flex-shrink-0">
              <label className="text-xs text-gray-500 dark:text-gray-400">输入文本（含行号）</label>
              <button
                onClick={() => setInput('')}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <RotateCcw size={10} />
                清空
              </button>
            </div>
            <textarea
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={'1. 苹果\n2. 香蕉\n3. 橙子\n或\n(1) 苹果\n[2] 香蕉\n1、橙子'}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
          </div>
          <div className="flex flex-col gap-1 min-h-0">
            <div className="flex items-center justify-between flex-shrink-0">
              <label className="text-xs text-gray-500 dark:text-gray-400">去除行号后</label>
              <button
                onClick={handleCopy}
                disabled={!result.trim()}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${copied ? 'bg-green-500 text-white' : result.trim() ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'}`}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <div className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 overflow-auto font-mono whitespace-pre-wrap break-all">
              {result || (
                <span className="text-gray-300 dark:text-gray-600">结果将在这里显示...</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
