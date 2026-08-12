import { useState, useMemo } from 'react';
import {
  Copy,
  RotateCcw,
  Check,
  History,
  Trash2,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';
import { useTextPrefixHistoryStore } from '../stores/textPrefixHistoryStore';

// ─── 序号生成 ─────────────────────────────────────────────────────

const CHINESE_NUMS = [
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '二十一',
  '二十二',
  '二十三',
  '二十四',
  '二十五',
  '二十六',
  '二十七',
  '二十八',
  '二十九',
  '三十',
];

function toRoman(n: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let r = '';
  for (let i = 0; i < vals.length; i++)
    while (n >= vals[i]) {
      r += syms[i];
      n -= vals[i];
    }
  return r;
}

function circleNum(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`;
}

type PrefixType = 'none' | 'number' | 'letter' | 'chinese' | 'roman' | 'circle' | 'custom';

function getIndex(i: number, type: PrefixType): string {
  switch (type) {
    case 'number':
      return String(i + 1);
    case 'letter':
      return String.fromCharCode(65 + (i % 26));
    case 'chinese':
      return CHINESE_NUMS[i] ?? String(i + 1);
    case 'roman':
      return toRoman(i + 1);
    case 'circle':
      return circleNum(i + 1);
    default:
      return '';
  }
}

const PREFIX_OPTIONS: { key: PrefixType; label: string; preview: string }[] = [
  { key: 'none', label: '无序号', preview: '' },
  { key: 'number', label: '数字', preview: '1.' },
  { key: 'letter', label: '字母', preview: 'A.' },
  { key: 'chinese', label: '中文', preview: '一、' },
  { key: 'roman', label: '罗马', preview: 'I.' },
  { key: 'circle', label: '圆圈', preview: '①' },
  { key: 'custom', label: '自定义', preview: '' },
];

// 规则标签显示
function getRuleLabel(r: {
  prefixType: string;
  customPrefix: string;
  suffix: string;
  separator: string;
  regexPattern?: string;
  regexReplace?: string;
}): string {
  const parts: string[] = [];
  if (r.regexPattern) {
    parts.push(`正则: /${r.regexPattern}/`);
  } else {
    const opt = PREFIX_OPTIONS.find((o) => o.key === r.prefixType);
    if (r.prefixType !== 'none') {
      const label = opt?.label ?? r.prefixType;
      const sep = r.separator ? `"${r.separator}"` : '';
      parts.push(`${label}${sep}`);
    }
    if (r.customPrefix) parts.push(`前缀:"${r.customPrefix}"`);
    if (r.suffix) parts.push(`后缀:"${r.suffix}"`);
  }
  return parts.length ? parts.join(' · ') : '无规则';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

// ─── 主组件 ───────────────────────────────────────────────────────

export default function TextPrefixTool() {
  const ready = useToolTheme();
  const { records, addRecord, deleteRecord, clearAll } = useTextPrefixHistoryStore();

  const [input, setInput] = useState('');
  const [prefixType, setPrefixType] = useState<PrefixType>('number');
  const [customPrefix, setCustomPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [separator, setSeparator] = useState('. ');
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [trimLines, setTrimLines] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(true); // 默认展开
  const [confirmClear, setConfirmClear] = useState(false);

  // 正则替换
  const [useRegex, setUseRegex] = useState(false);
  const [regexPattern, setRegexPattern] = useState('');
  const [regexReplace, setRegexReplace] = useState('');
  const [regexFlags, setRegexFlags] = useState('g');
  const [regexError, setRegexError] = useState('');

  const result = useMemo(() => {
    if (useRegex) {
      if (!regexPattern) return input;
      try {
        const re = new RegExp(regexPattern, regexFlags);
        setRegexError('');
        return input
          .split('\n')
          .map((line) => line.replace(re, regexReplace))
          .join('\n');
      } catch (e) {
        setRegexError(String(e));
        return input;
      }
    }
    const lines = input.split('\n');
    let idx = 0;
    return lines
      .map((line) => {
        const trimmed = trimLines ? line.trim() : line;
        if (skipEmpty && trimmed.trim() === '') return trimmed;
        let prefix = '';
        if (prefixType === 'custom') {
          prefix = customPrefix;
        } else if (prefixType !== 'none') {
          prefix = getIndex(idx, prefixType) + separator;
        }
        idx++;
        return prefix + trimmed + suffix;
      })
      .join('\n');
  }, [
    input,
    prefixType,
    customPrefix,
    suffix,
    separator,
    skipEmpty,
    trimLines,
    useRegex,
    regexPattern,
    regexReplace,
    regexFlags,
  ]);

  const lineCount = input.split('\n').filter((l) => !skipEmpty || l.trim()).length;

  const handleCopy = () => {
    if (!result.trim()) return;
    navigator.clipboard.writeText(result);
    addRecord({
      input,
      result,
      prefixType,
      customPrefix,
      suffix,
      separator,
      lineCount,
      regexPattern: useRegex ? regexPattern : undefined,
      regexReplace: useRegex ? regexReplace : undefined,
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleClear = () => {
    setInput('');
    setCustomPrefix('');
    setSuffix('');
  };

  const handleRestoreRecord = (r: (typeof records)[0]) => {
    setInput(r.input);
    if (r.regexPattern !== undefined) {
      setUseRegex(true);
      setRegexPattern(r.regexPattern ?? '');
      setRegexReplace(r.regexReplace ?? '');
    } else {
      setUseRegex(false);
      setPrefixType(r.prefixType as PrefixType);
      setCustomPrefix(r.customPrefix);
      setSuffix(r.suffix);
      setSeparator(r.separator);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-200/50 dark:border-gray-700/50">
      <ToolHeader
        icon="📝"
        title="批量添加前后缀"
        subtitle={lineCount > 0 ? `${lineCount} 行` : undefined}
        closeMode="hide"
        actions={
          <button
            onClick={() => setShowHistory(!showHistory)}
            title="历史记录"
            className={`p-1.5 rounded-lg transition-colors relative ${showHistory ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <History size={14} />
            {records.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-blue-500 text-white text-[9px] rounded-full flex items-center justify-center">
                {records.length > 9 ? '9+' : records.length}
              </span>
            )}
          </button>
        }
      />

      <div className="flex-1 flex min-h-0">
        {/* 主内容 */}
        <div
          className={`flex flex-col p-4 gap-3 overflow-hidden min-h-0 ${showHistory ? 'flex-1' : 'w-full'}`}
        >
          {/* 模式切换 */}
          <div className="flex-shrink-0 flex items-center gap-2">
            <div className="flex gap-1 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <button
                onClick={() => setUseRegex(false)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${!useRegex ? 'bg-white dark:bg-gray-700 text-blue-600 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
              >
                前后缀模式
              </button>
              <button
                onClick={() => setUseRegex(true)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${useRegex ? 'bg-white dark:bg-gray-700 text-blue-600 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
              >
                正则替换
              </button>
            </div>
          </div>

          {/* 前后缀模式 */}
          {!useRegex && (
            <>
              <div className="flex-shrink-0 space-y-1.5">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  前缀序号
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {PREFIX_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setPrefixType(opt.key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${prefixType === opt.key ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                    >
                      {opt.label}
                      {opt.preview && (
                        <span className="ml-1 opacity-60 font-normal text-[10px]">
                          {opt.preview}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-shrink-0 flex items-end gap-2 flex-wrap">
                {prefixType === 'custom' && (
                  <div className="flex-1 min-w-[100px]">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      自定义前缀
                    </label>
                    <input
                      type="text"
                      value={customPrefix}
                      onChange={(e) => setCustomPrefix(e.target.value)}
                      placeholder="如：- 或 > 或 【"
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
                {prefixType !== 'none' && prefixType !== 'custom' && (
                  <div className="w-24">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      序号分隔符
                    </label>
                    <input
                      type="text"
                      value={separator}
                      onChange={(e) => setSeparator(e.target.value)}
                      placeholder=". 或 、"
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
                <div className="w-28">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    行后缀
                  </label>
                  <input
                    type="text"
                    value={suffix}
                    onChange={(e) => setSuffix(e.target.value)}
                    placeholder="如：；或 ,"
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-center gap-3 pb-1.5">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipEmpty}
                      onChange={(e) => setSkipEmpty(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-blue-500"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      跳过空行
                    </span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={trimLines}
                      onChange={(e) => setTrimLines(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-blue-500"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      去除空格
                    </span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* 正则替换模式 */}
          {useRegex && (
            <div className="flex-shrink-0 space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    正则表达式
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 text-sm">/</span>
                    <input
                      type="text"
                      value={regexPattern}
                      onChange={(e) => setRegexPattern(e.target.value)}
                      placeholder="如：^\s+ 或 \d+"
                      className={`flex-1 px-2.5 py-1.5 text-sm border rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono ${regexError ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'}`}
                    />
                    <span className="text-gray-400 text-sm">/</span>
                    <input
                      type="text"
                      value={regexFlags}
                      onChange={(e) => setRegexFlags(e.target.value)}
                      placeholder="gim"
                      className="w-14 px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    替换为（支持 $1 $2 捕获组）
                  </label>
                  <input
                    type="text"
                    value={regexReplace}
                    onChange={(e) => setRegexReplace(e.target.value)}
                    placeholder="替换内容，留空则删除匹配"
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>
              {regexError && (
                <div className="flex items-center gap-1.5 text-xs text-red-500">
                  <AlertCircle size={12} />
                  <span>{regexError}</span>
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                {[
                  { label: '去首尾空格', pattern: '^\\s+|\\s+$', replace: '', flags: 'gm' },
                  { label: '去空行', pattern: '^\\s*$\\n?', replace: '', flags: 'gm' },
                  { label: '去重复空格', pattern: ' +', replace: ' ', flags: 'g' },
                  { label: '行首加#', pattern: '^(.+)$', replace: '# $1', flags: 'gm' },
                  { label: '提取数字', pattern: '[^\\d]', replace: '', flags: 'g' },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      setRegexPattern(preset.pattern);
                      setRegexReplace(preset.replace);
                      setRegexFlags(preset.flags);
                    }}
                    className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 rounded transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 双栏编辑区 */}
          <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
            <div className="flex flex-col gap-1 min-h-0">
              <div className="flex items-center justify-between flex-shrink-0">
                <label className="text-xs text-gray-500 dark:text-gray-400">
                  输入文本（每行一条）
                </label>
                <button
                  onClick={handleClear}
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
                placeholder={'苹果\n香蕉\n橙子\n...'}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
            <div className="flex flex-col gap-1 min-h-0">
              <div className="flex items-center justify-between flex-shrink-0">
                <label className="text-xs text-gray-500 dark:text-gray-400">处理结果</label>
                <button
                  onClick={handleCopy}
                  disabled={!result.trim()}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${copied ? 'bg-green-500 text-white' : result.trim() ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'}`}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? '已复制' : '复制并保存'}
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

        {/* 历史记录侧栏 */}
        {showHistory && (
          <div className="w-52 border-l border-gray-100 dark:border-gray-800 flex flex-col flex-shrink-0">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 dark:border-gray-800">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                历史记录
              </span>
              {records.length > 0 && (
                <button
                  onClick={() => {
                    if (confirmClear) {
                      clearAll();
                      setConfirmClear(false);
                    } else {
                      setConfirmClear(true);
                      setTimeout(() => setConfirmClear(false), 3000);
                    }
                  }}
                  className={`text-xs px-2 py-0.5 rounded transition-colors ${confirmClear ? 'bg-red-500 text-white' : 'text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'}`}
                >
                  {confirmClear ? '确认清空' : '清空'}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {records.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-400 dark:text-gray-600">
                  <History size={24} className="mb-1 opacity-40" />
                  <p className="text-xs">暂无历史记录</p>
                  <p className="text-xs opacity-60 mt-0.5">复制结果时自动保存</p>
                </div>
              ) : (
                records.map((r) => (
                  <div
                    key={r.id}
                    className="group border-b border-gray-50 dark:border-gray-800 last:border-0"
                  >
                    <button
                      onClick={() => handleRestoreRecord(r)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      {/* 时间 + 行数 */}
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] text-gray-400">{formatTime(r.createdAt)}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-blue-400">{r.lineCount}行</span>
                          <ChevronRight
                            size={10}
                            className="text-gray-300 group-hover:text-blue-400 transition-colors"
                          />
                        </div>
                      </div>
                      {/* 规则标签 */}
                      <div className="text-[10px] text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded mb-1 truncate">
                        {getRuleLabel(r)}
                      </div>
                      {/* 结果预览 */}
                      <p className="text-xs text-gray-600 dark:text-gray-400 truncate font-mono">
                        {r.result.split('\n')[0]}
                      </p>
                      {r.result.split('\n').length > 1 && (
                        <p className="text-[10px] text-gray-400 truncate font-mono">
                          {r.result.split('\n')[1]}
                        </p>
                      )}
                    </button>
                    <div className="flex justify-end px-2 pb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRecord(r.id);
                        }}
                        className="p-1 text-gray-300 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
