import { useState, useMemo } from 'react';
import { Copy, Check, RotateCcw, ClipboardPaste, Lightbulb, ArrowDown } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

type OperationType =
  | 'removeLineBreaks'
  | 'removeEmptyLines'
  | 'mergeEmptyLines'
  | 'addSeparator'
  | 'splitToLines';

// 删除所有换行符（合并为一行）
function removeLineBreaks(text: string, separator: string = ''): string {
  return text.replace(/\n/g, separator);
}

// 删除空行
function removeEmptyLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

// 合并连续空行为一个空行
function mergeEmptyLines(text: string): string {
  return text.replace(/\n\s*\n\s*\n+/g, '\n\n');
}

// 在每行之间添加分隔符
function addSeparator(text: string, separator: string): string {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  return lines.join('\n' + separator + '\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeSeparator(value: string): string {
  return value.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
}

// 将每行中由空格、常见符号或自定义内容隔开的数据拆成独立行
function splitToLines(text: string, separator: string): string {
  const customSeparator = decodeSeparator(separator).trim();
  const splitPattern = customSeparator
    ? new RegExp(escapeRegExp(customSeparator), 'g')
    : /[\s,，;；、|｜/\\]+/g;

  return text
    .split(splitPattern)
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n');
}

// 处理文本
function processText(text: string, operation: OperationType, separator: string): string {
  if (!text) return '';

  switch (operation) {
    case 'removeLineBreaks':
      return removeLineBreaks(text, separator);
    case 'removeEmptyLines':
      return removeEmptyLines(text);
    case 'mergeEmptyLines':
      return mergeEmptyLines(text);
    case 'addSeparator':
      return addSeparator(text, separator);
    case 'splitToLines':
      return splitToLines(text, separator);
    default:
      return text;
  }
}

const EXAMPLE_TEXT = `第一行内容

第二行内容


第三行内容
第四行内容

第五行内容`;

const SPLIT_EXAMPLE_TEXT = `苹果 香蕉,橙子；西瓜|葡萄
A001 / A002 / A003
自定义分隔内容可以用订单号END订单号END订单号`;

const OPERATIONS = [
  { key: 'removeLineBreaks' as OperationType, label: '删除换行', desc: '合并为一行' },
  { key: 'removeEmptyLines' as OperationType, label: '删除空行', desc: '删除所有空行' },
  { key: 'mergeEmptyLines' as OperationType, label: '合并空行', desc: '多个空行合并为一个' },
  { key: 'addSeparator' as OperationType, label: '添加分隔符', desc: '在每行之间添加' },
  { key: 'splitToLines' as OperationType, label: '拆分为行', desc: '一项一行' },
];

export default function LineProcessorTool() {
  const ready = useToolTheme();
  const [input, setInput] = useState('');
  const [operation, setOperation] = useState<OperationType>('removeLineBreaks');
  const [separator, setSeparator] = useState('');
  const [copied, setCopied] = useState(false);

  const output = useMemo(() => {
    try {
      return processText(input, operation, separator);
    } catch {
      return '处理出错';
    }
  }, [input, operation, separator]);

  const lineCount = input.split('\n').length;
  const outputLineCount = output.split('\n').length;

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
    setInput(operation === 'splitToLines' ? SPLIT_EXAMPLE_TEXT : EXAMPLE_TEXT);
  };

  const handleClear = () => {
    setInput('');
  };

  const needsSeparator =
    operation === 'removeLineBreaks' || operation === 'addSeparator' || operation === 'splitToLines';

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-200/50 dark:border-gray-700/50">
      <ToolHeader icon="📝" title="换行处理" subtitle={input ? `${lineCount} 行` : undefined} closeMode="hide" />

      <div className="flex-1 flex flex-col p-4 gap-3 min-h-0 overflow-hidden">
        {/* 操作选择 */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <label className="text-xs text-gray-500 dark:text-gray-400">选择操作</label>
          <div className="grid grid-cols-2 gap-2">
            {OPERATIONS.map((op) => (
              <button
                key={op.key}
                onClick={() => setOperation(op.key)}
                className={`flex flex-col items-start px-3 py-2 rounded-lg text-sm transition-colors ${
                  operation === op.key
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                <span className="font-medium">{op.label}</span>
                <span
                  className={`text-xs ${operation === op.key ? 'text-blue-100' : 'text-gray-400'}`}
                >
                  {op.desc}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 分隔符配置 */}
        {needsSeparator && (
          <div className="flex flex-col gap-1 flex-shrink-0">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              {operation === 'removeLineBreaks'
                ? '合并时的连接符（可选）'
                : operation === 'splitToLines'
                  ? '拆分分隔符（可选）'
                  : '分隔符内容'}
            </label>
            <input
              type="text"
              value={separator}
              onChange={(e) => setSeparator(e.target.value)}
              placeholder={
                operation === 'removeLineBreaks'
                  ? '留空直接合并，或输入空格、逗号等'
                  : operation === 'splitToLines'
                    ? '留空自动按空格、逗号、分号等拆分'
                  : '输入分隔符，如 ---'
              }
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* 操作说明 */}
        <div className="flex items-start gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex-shrink-0">
          <div className="text-blue-500 flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-xs text-blue-700 dark:text-blue-300">
            {operation === 'removeLineBreaks' && '将所有换行符删除，合并为一行'}
            {operation === 'removeEmptyLines' && '删除所有空白行，保留有内容的行'}
            {operation === 'mergeEmptyLines' && '将多个连续的空行合并为一个空行'}
            {operation === 'addSeparator' && '在每行之间插入分隔符内容'}
            {operation === 'splitToLines' && '将一行中的多个数据按分隔符拆开，每个数据独立成行'}
          </div>
        </div>

        {/* 双栏编辑器 */}
        <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
          {/* 输入 */}
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
              placeholder="在此输入需要处理的文本..."
              className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono leading-relaxed"
            />
            <span className="text-[11px] text-gray-400 dark:text-gray-500 text-right">
              {lineCount} 行 · {input.length} 字符
            </span>
          </div>

          {/* 输出 */}
          <div className="flex flex-col gap-1 min-h-0">
            <div className="flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500 dark:text-gray-400">处理结果</label>
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
              placeholder="处理结果将在这里显示..."
              className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 resize-none focus:outline-none font-mono leading-relaxed"
            />
            <span className="text-[11px] text-gray-400 dark:text-gray-500 text-right">
              {outputLineCount} 行 · {output.length} 字符
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
