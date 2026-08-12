import { useState } from 'react';
import { Copy, Check, RotateCcw, Sparkles, Download } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';

type OutputFormat = 'lines' | 'comma' | 'semicolon' | 'space' | 'sql' | 'json';

interface DeduplicateOptions {
  removeDuplicates: boolean;
  trimSpaces: boolean;
  removeEmptyLines: boolean;
  ignoreCase: boolean;
  removeEmoji: boolean;
  removeSpecialChars: boolean;
  removeHtml: boolean;
  sortResult: boolean;
}

export default function TextDeduplicateTool() {
  const ready = useToolTheme();
  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [copied, setCopied] = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('lines');
  const [detectedSeparator, setDetectedSeparator] = useState('');
  const [stats, setStats] = useState({ original: 0, unique: 0, removed: 0 });

  const [options, setOptions] = useState<DeduplicateOptions>({
    removeDuplicates: true,
    trimSpaces: true,
    removeEmptyLines: true,
    ignoreCase: false,
    removeEmoji: false,
    removeSpecialChars: false,
    removeHtml: false,
    sortResult: false,
  });

  // 自动识别分隔符
  const detectSeparator = (text: string): string => {
    const separators = [
      { char: '\n', name: '换行', regex: /\n/g },
      { char: '，', name: '中文逗号', regex: /，/g },
      { char: ',', name: '英文逗号', regex: /,/g },
      { char: '、', name: '顿号', regex: /、/g },
      { char: ';', name: '分号', regex: /;/g },
      { char: '；', name: '中文分号', regex: /；/g },
      { char: '\t', name: 'Tab', regex: /\t/g },
      { char: '|', name: '竖线', regex: /\|/g },
      { char: ' ', name: '空格', regex: / {2,}/g }, // 至少2个空格才算分隔符
    ];

    let maxCount = 0;
    let detectedSep = '';

    for (const sep of separators) {
      const matches = text.match(sep.regex);
      const count = matches ? matches.length : 0;
      if (count > maxCount) {
        maxCount = count;
        detectedSep = sep.name;
      }
    }

    return detectedSep || '换行';
  };

  // 拆分文本
  const splitText = (text: string): string[] => {
    // 先尝试多种分隔符拆分
    let items = text.split(/[\n，,、;；\t|]/);

    // 如果拆分结果太少，尝试用空格拆分
    if (items.length === 1) {
      items = text.split(/\s+/);
    }

    return items;
  };

  // 清洗文本
  const cleanText = (text: string, opts: DeduplicateOptions): string => {
    let result = text;

    // 去除 HTML 标签
    if (opts.removeHtml) {
      result = result.replace(/<[^>]+>/g, '');
      result = result.replace(/&nbsp;/g, ' ');
      result = result.replace(/&lt;/g, '<');
      result = result.replace(/&gt;/g, '>');
      result = result.replace(/&amp;/g, '&');
    }

    // 去除 Emoji
    if (opts.removeEmoji) {
      result = result.replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
        ''
      );
    }

    // 去除特殊符号
    if (opts.removeSpecialChars) {
      result = result.replace(/[★☆●○◆◇■□▲△▼▽※]/g, '');
    }

    // 去除不可见字符
    result = result.replace(/[\r\u200B-\u200D\uFEFF]/g, '');

    // 去除前后空格
    if (opts.trimSpaces) {
      result = result.trim();
    }

    return result;
  };

  // 去重处理
  const handleDeduplicate = () => {
    if (!inputText.trim()) {
      setOutputText('');
      setStats({ original: 0, unique: 0, removed: 0 });
      return;
    }

    // 检测分隔符
    const separator = detectSeparator(inputText);
    setDetectedSeparator(separator);

    // 拆分文本
    let items = splitText(inputText);

    // 统计原始数量
    const originalCount = items.length;

    // 清洗每个项目
    items = items.map((item) => cleanText(item, options));

    // 去除空行
    if (options.removeEmptyLines) {
      items = items.filter((item) => item.length > 0);
    }

    // 去重
    if (options.removeDuplicates) {
      const seen = new Set<string>();
      const uniqueItems: string[] = [];

      for (const item of items) {
        const key = options.ignoreCase ? item.toLowerCase() : item;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueItems.push(item);
        }
      }

      items = uniqueItems;
    }

    // 排序
    if (options.sortResult) {
      items.sort((a, b) => {
        if (options.ignoreCase) {
          return a.toLowerCase().localeCompare(b.toLowerCase(), 'zh-CN');
        }
        return a.localeCompare(b, 'zh-CN');
      });
    }

    // 统计
    const uniqueCount = items.length;
    const removedCount = originalCount - uniqueCount;
    setStats({ original: originalCount, unique: uniqueCount, removed: removedCount });

    // 格式化输出
    const formatted = formatOutput(items, outputFormat);
    setOutputText(formatted);
  };

  // 格式化输出
  const formatOutput = (items: string[], format: OutputFormat): string => {
    switch (format) {
      case 'lines':
        return items.join('\n');
      case 'comma':
        return items.join(',');
      case 'semicolon':
        return items.join('、');
      case 'space':
        return items.join(' ');
      case 'sql':
        return `(${items.map((item) => `'${item.replace(/'/g, "''")}'`).join(',')})`;
      case 'json':
        return JSON.stringify(items, null, 2);
      default:
        return items.join('\n');
    }
  };

  // 切换输出格式
  const handleFormatChange = (format: OutputFormat) => {
    setOutputFormat(format);
    if (outputText) {
      // 重新格式化当前结果
      const items = outputText.split('\n').filter((item) => item.trim());
      const formatted = formatOutput(items, format);
      setOutputText(formatted);
    }
  };

  // 复制结果
  const handleCopy = async () => {
    if (!outputText) return;
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // 导出 TXT
  const handleExport = async () => {
    if (!outputText) return;

    const filePath = await save({
      defaultPath: `去重结果_${new Date().getTime()}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });

    if (filePath) {
      await writeTextFile(filePath, outputText);
    }
  };

  // 清空
  const handleClear = () => {
    setInputText('');
    setOutputText('');
    setDetectedSeparator('');
    setStats({ original: 0, unique: 0, removed: 0 });
  };

  const toggleOption = (key: keyof DeduplicateOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <ToolHeader
        icon={<Sparkles className="text-blue-500" size={18} />}
        title="文本去重工具"
        subtitle="智能识别分隔符，一键去重清洗"
        closeMode="hide"
        actions={
          <>
            <button
              onClick={handleDeduplicate}
              disabled={!inputText}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                inputText
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white shadow-lg hover:shadow-xl'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Sparkles size={16} />
              去重
            </button>
            <button
              onClick={handleClear}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="清空"
            >
              <RotateCcw size={18} />
            </button>
          </>
        }
      />

      <div className="flex-1 flex gap-4 p-6 min-h-0">
        {/* 左侧：输入 */}
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">输入文本</label>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {detectedSeparator && (
                <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
                  检测到：{detectedSeparator}
                </span>
              )}
              <span>{inputText.length} 字符</span>
            </div>
          </div>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="粘贴需要去重的文本...&#10;&#10;支持自动识别：&#10;• 换行、空格、Tab&#10;• 中文逗号（，）、英文逗号（,）&#10;• 顿号（、）、分号（;）&#10;• 竖线（|）"
            className="flex-1 px-4 py-3 rounded-xl border-2 border-blue-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors overflow-auto font-mono text-sm"
          />
        </div>

        {/* 中间：选项 */}
        <div className="w-56 flex flex-col gap-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">处理选项</label>
          <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border-2 border-blue-200 dark:border-gray-600 p-4 overflow-y-auto">
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.removeDuplicates}
                  onChange={() => toggleOption('removeDuplicates')}
                  className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  去除重复
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.trimSpaces}
                  onChange={() => toggleOption('trimSpaces')}
                  className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  去除首尾空格
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.removeEmptyLines}
                  onChange={() => toggleOption('removeEmptyLines')}
                  className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  去除空行
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.ignoreCase}
                  onChange={() => toggleOption('ignoreCase')}
                  className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  忽略大小写
                </span>
              </label>

              <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>

              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.removeEmoji}
                  onChange={() => toggleOption('removeEmoji')}
                  className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  去除 Emoji
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.removeSpecialChars}
                  onChange={() => toggleOption('removeSpecialChars')}
                  className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  去除特殊符号
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.removeHtml}
                  onChange={() => toggleOption('removeHtml')}
                  className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  去除 HTML 标签
                </span>
              </label>

              <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>

              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.sortResult}
                  onChange={() => toggleOption('sortResult')}
                  className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  结果排序
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* 右侧：输出 */}
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">去重结果</label>
            <div className="flex items-center gap-2">
              {stats.original > 0 && (
                <span className="text-xs text-gray-500">
                  {stats.original} → {stats.unique}
                  {stats.removed > 0 && (
                    <span className="text-red-500 ml-1">(-{stats.removed})</span>
                  )}
                </span>
              )}
              <button
                onClick={handleCopy}
                disabled={!outputText}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  copied
                    ? 'bg-green-500 text-white'
                    : outputText
                      ? 'bg-blue-500 hover:bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                }`}
              >
                {copied ? (
                  <>
                    <Check size={14} />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    复制
                  </>
                )}
              </button>
              <button
                onClick={handleExport}
                disabled={!outputText}
                className={`p-1.5 rounded-lg transition-colors ${
                  outputText
                    ? 'text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                    : 'text-gray-400 cursor-not-allowed'
                }`}
                title="导出 TXT"
              >
                <Download size={16} />
              </button>
            </div>
          </div>

          {/* 输出格式选择 */}
          <div className="flex gap-2 flex-wrap">
            {[
              { value: 'lines', label: '一行一个' },
              { value: 'comma', label: '逗号' },
              { value: 'semicolon', label: '顿号' },
              { value: 'space', label: '空格' },
              { value: 'sql', label: 'SQL IN' },
              { value: 'json', label: 'JSON' },
            ].map((format) => (
              <button
                key={format.value}
                onClick={() => handleFormatChange(format.value as OutputFormat)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  outputFormat === format.value
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {format.label}
              </button>
            ))}
          </div>

          <textarea
            value={outputText}
            readOnly
            placeholder="去重后的文本将显示在这里..."
            className="flex-1 px-4 py-3 rounded-xl border-2 border-blue-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none overflow-auto font-mono text-sm"
          />
        </div>
      </div>

      {/* 底部提示 */}
      <div className="flex-shrink-0 px-6 py-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-t border-blue-100 dark:border-gray-700">
        <div className="flex items-center justify-center gap-6 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            <span>粘贴文本 → 点击去重 → 复制结果</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
            <span>支持：名单、手机号、编号、SKU、地址等</span>
          </div>
        </div>
      </div>
    </div>
  );
}
