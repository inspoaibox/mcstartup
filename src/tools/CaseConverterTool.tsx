import { useState, useEffect } from 'react';
import { Copy, Check, RotateCcw, Type } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

type ConversionMode =
  | 'lowercase'
  | 'uppercase'
  | 'capitalize'
  | 'capitalizeWords'
  | 'title'
  | 'sentence'
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'kebab';

interface ConversionOption {
  id: ConversionMode;
  name: string;
  description: string;
  example: string;
}

const conversionOptions: ConversionOption[] = [
  {
    id: 'lowercase',
    name: '全部小写',
    description: '所有字母转换为小写',
    example: 'hello world',
  },
  {
    id: 'uppercase',
    name: '全部大写',
    description: '所有字母转换为大写',
    example: 'HELLO WORLD',
  },
  {
    id: 'capitalize',
    name: '首字母大写',
    description: '第一个字母大写，其余小写',
    example: 'Hello world',
  },
  {
    id: 'capitalizeWords',
    name: '每个单词首字母大写',
    description: '所有单词首字母大写，其余小写',
    example: 'Hello World Test',
  },
  {
    id: 'title',
    name: '标题大小写',
    description: 'APA Style 标题格式，次要单词小写',
    example: 'Hello World and the Universe',
  },
  {
    id: 'sentence',
    name: '每句首字母大写',
    description: '句子开头字母大写（. ! ? : 后）',
    example: 'Hello world. This is a test.',
  },
  {
    id: 'camel',
    name: '驼峰命名',
    description: '首单词小写，其余单词首字母大写',
    example: 'helloWorldTest',
  },
  {
    id: 'pascal',
    name: '帕斯卡命名',
    description: '所有单词首字母大写，无空格',
    example: 'HelloWorldTest',
  },
  {
    id: 'snake',
    name: '蛇形命名',
    description: '全小写，下划线分隔',
    example: 'hello_world_test',
  },
  {
    id: 'kebab',
    name: '短横线命名',
    description: '全小写，短横线分隔',
    example: 'hello-world-test',
  },
];

// APA Style 标题中不大写的次要单词
const minorWords = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'for',
  'nor',
  'on',
  'at',
  'to',
  'by',
  'in',
  'of',
  'up',
  'as',
  'so',
  'yet',
  'off',
  'if',
  'per',
  'via',
  'out',
]);

// 常见的全大写缩写词
const acronyms = new Set([
  'API',
  'HTML',
  'CSS',
  'JS',
  'JSON',
  'XML',
  'HTTP',
  'HTTPS',
  'URL',
  'URI',
  'SQL',
  'PHP',
  'USA',
  'UK',
  'CEO',
  'CTO',
  'AI',
  'ML',
  'UI',
  'UX',
  'ID',
  'PDF',
  'PNG',
  'JPG',
  'GIF',
  'SVG',
]);

export default function CaseConverterTool() {
  const ready = useToolTheme();
  const [inputText, setInputText] = useState('');
  const [results, setResults] = useState<Record<ConversionMode, string>>({} as any);
  const [copied, setCopied] = useState<ConversionMode | null>(null);
  const [autoCopy, setAutoCopy] = useState(false);
  const [showInNewBox, setShowInNewBox] = useState(false);
  const [useAcronyms, setUseAcronyms] = useState(true);

  // 转换函数
  const convertText = (text: string, mode: ConversionMode): string => {
    if (!text) return '';

    switch (mode) {
      case 'lowercase':
        return text.toLowerCase();

      case 'uppercase':
        return text.toUpperCase();

      case 'capitalize':
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

      case 'capitalizeWords':
        return text
          .toLowerCase()
          .split(/\s+/)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

      case 'title':
        return text
          .toLowerCase()
          .split(/\s+/)
          .map((word, index, array) => {
            const lowerWord = word.toLowerCase();
            // 检查是否是缩写词
            if (useAcronyms && acronyms.has(word.toUpperCase())) {
              return word.toUpperCase();
            }
            // 第一个和最后一个单词总是大写
            if (index === 0 || index === array.length - 1) {
              return word.charAt(0).toUpperCase() + word.slice(1);
            }
            // 次要单词保持小写
            if (minorWords.has(lowerWord)) {
              return lowerWord;
            }
            // 其他单词首字母大写
            return word.charAt(0).toUpperCase() + word.slice(1);
          })
          .join(' ');

      case 'sentence':
        return text.toLowerCase().replace(/(^\w|[.!?:]\s+\w)/g, (match) => match.toUpperCase());

      case 'camel':
        return text
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
          .replace(/^[A-Z]/, (char) => char.toLowerCase());

      case 'pascal':
        return text
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
          .replace(/^[a-z]/, (char) => char.toUpperCase());

      case 'snake':
        return text
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');

      case 'kebab':
        return text
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

      default:
        return text;
    }
  };

  // 执行所有转换
  const handleConvert = () => {
    const newResults: Record<ConversionMode, string> = {} as any;
    conversionOptions.forEach((option) => {
      newResults[option.id] = convertText(inputText, option.id);
    });
    setResults(newResults);
  };

  // 自动转换
  useEffect(() => {
    if (inputText) {
      handleConvert();
    } else {
      setResults({} as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputText, useAcronyms]);

  // 复制结果
  const handleCopy = async (mode: ConversionMode) => {
    const text = results[mode];
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(mode);
    setTimeout(() => setCopied(null), 1500);

    // 自动复制时更新输入框
    if (autoCopy) {
      setInputText(text);
    }
  };

  // 清空
  const handleClear = () => {
    setInputText('');
    setResults({} as any);
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-purple-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <ToolHeader
        icon={<Type className="text-purple-500" size={18} />}
        title="英文大小写转换"
        subtitle="支持 9 种转换模式，APA Style 标题格式"
        closeMode="hide"
        actions={
            <button
              onClick={handleClear}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="清空"
            >
              <RotateCcw size={18} />
            </button>
        }
      />

      <div className="flex-1 flex gap-6 p-6 min-h-0">
        {/* 左侧：输入和选项 */}
        <div className="w-96 flex flex-col gap-4">
          {/* 输入框 */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">输入文本</label>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="输入需要转换的英文文本...&#10;&#10;例如：&#10;hello world&#10;HELLO WORLD&#10;Hello World"
              className="h-48 px-4 py-3 rounded-xl border-2 border-purple-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:border-purple-400 dark:focus:border-purple-500 transition-colors overflow-auto"
            />
          </div>

          {/* 选项 */}
          <div className="flex flex-col gap-3 p-4 bg-white dark:bg-gray-800 rounded-xl border-2 border-purple-200 dark:border-gray-600">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">转换选项</h3>

            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={autoCopy}
                onChange={(e) => setAutoCopy(e.target.checked)}
                className="rounded border-gray-300 text-purple-500 focus:ring-purple-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                自动复制结果
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={showInNewBox}
                onChange={(e) => setShowInNewBox(e.target.checked)}
                className="rounded border-gray-300 text-purple-500 focus:ring-purple-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                新文本框显示结果
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={useAcronyms}
                onChange={(e) => setUseAcronyms(e.target.checked)}
                className="rounded border-gray-300 text-purple-500 focus:ring-purple-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                识别缩写词（API、HTML 等）
              </span>
            </label>
          </div>

          {/* 说明 */}
          <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-xl border border-purple-200 dark:border-purple-800">
            <h4 className="text-xs font-medium text-purple-700 dark:text-purple-400 mb-2">提示</h4>
            <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <li>• 首字母大写：仅第一个字母大写</li>
              <li>• 标题大小写：使用 APA Style 格式</li>
              <li>• 每句首字母大写：在 . ! ? : 后生效</li>
              <li>• 驼峰/帕斯卡：适用于编程命名</li>
            </ul>
          </div>
        </div>

        {/* 右侧：转换结果 */}
        <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            转换结果（点击复制）
          </label>

          <div className="grid grid-cols-1 gap-3">
            {conversionOptions.map((option) => (
              <div
                key={option.id}
                className="group bg-white dark:bg-gray-800 rounded-xl border-2 border-purple-200 dark:border-gray-600 p-4 hover:border-purple-400 dark:hover:border-purple-500 transition-all cursor-pointer"
                onClick={() => handleCopy(option.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {option.name}
                      </h3>
                      {copied === option.id && (
                        <span className="flex items-center gap-1 text-xs text-green-500">
                          <Check size={12} />
                          已复制
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {option.description}
                    </p>
                  </div>
                  <button
                    className="p-1.5 rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy(option.id);
                    }}
                  >
                    <Copy size={14} />
                  </button>
                </div>

                {showInNewBox ? (
                  <textarea
                    value={results[option.id] || ''}
                    readOnly
                    className="w-full h-20 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm resize-none focus:outline-none overflow-auto"
                  />
                ) : (
                  <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm font-mono break-all">
                    {results[option.id] || (
                      <span className="text-gray-400 italic">{option.example}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 底部提示 */}
      <div className="flex-shrink-0 px-6 py-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-t border-purple-100 dark:border-gray-700">
        <div className="flex items-center justify-center gap-6 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
            <span>输入文本 → 自动转换 → 点击复制</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
            <span>支持编程命名规范：驼峰、帕斯卡、蛇形、短横线</span>
          </div>
        </div>
      </div>
    </div>
  );
}
