import { useState } from 'react';
import { Copy, Check, RotateCcw, Languages, ArrowRightLeft } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';
import { Converter } from 'opencc-js';

type ConversionMode = 'cn' | 'tw' | 'twp' | 'hk' | 'jp';

interface ConversionOption {
  id: ConversionMode;
  name: string;
  description: string;
  example: string;
}

const conversionOptions: ConversionOption[] = [
  {
    id: 'cn',
    name: '简体中文',
    description: '转换为中国大陆简体中文',
    example: '计算机、软件、网络',
  },
  {
    id: 'tw',
    name: '繁体中文（台湾）',
    description: '转换为台湾正体中文',
    example: '電腦、軟體、網路',
  },
  {
    id: 'twp',
    name: '繁体中文（台湾，常用词汇）',
    description: '台湾正体中文，使用台湾常用词汇',
    example: '電腦、軟體、網路',
  },
  {
    id: 'hk',
    name: '繁体中文（香港）',
    description: '转换为香港繁体中文',
    example: '電腦、軟件、網絡',
  },
  {
    id: 'jp',
    name: '日本新字体',
    description: '转换为日本新字体',
    example: '計算機、ソフトウェア、ネットワーク',
  },
];

export default function ChineseConverterTool() {
  const ready = useToolTheme();
  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [selectedMode, setSelectedMode] = useState<ConversionMode>('tw');
  const [copied, setCopied] = useState(false);
  const [detectedType, setDetectedType] = useState<'simplified' | 'traditional' | null>(null);

  // 检测文本类型（简体/繁体）
  const detectTextType = (text: string): 'simplified' | 'traditional' | null => {
    if (!text) return null;

    // 常见简体字
    const simplifiedChars = /[国际网络计算机软件开发设计实现应该这样]/;
    // 常见繁体字
    const traditionalChars = /[國際網絡計算機軟體開發設計實現應該這樣]/;

    const hasSimplified = simplifiedChars.test(text);
    const hasTraditional = traditionalChars.test(text);

    if (hasSimplified && !hasTraditional) return 'simplified';
    if (hasTraditional && !hasSimplified) return 'traditional';
    if (hasSimplified && hasTraditional) return 'simplified'; // 混合时默认简体

    return null;
  };

  // 执行转换
  const handleConvert = () => {
    if (!inputText.trim()) {
      setOutputText('');
      setDetectedType(null);
      return;
    }

    // 检测输入文本类型
    const detected = detectTextType(inputText);
    setDetectedType(detected);

    let converter;

    // 根据检测结果和目标模式选择转换器
    if (detected === 'simplified') {
      // 简体 → 繁体/简体
      switch (selectedMode) {
        case 'cn':
          // 简体 → 简体（无需转换）
          setOutputText(inputText);
          return;
        case 'tw':
          converter = Converter({ from: 'cn', to: 'tw' });
          break;
        case 'twp':
          converter = Converter({ from: 'cn', to: 'twp' });
          break;
        case 'hk':
          converter = Converter({ from: 'cn', to: 'hk' });
          break;
        case 'jp':
          converter = Converter({ from: 'cn', to: 'jp' });
          break;
      }
    } else {
      // 繁体 → 简体 或 繁体 → 繁体
      switch (selectedMode) {
        case 'cn': {
          // 繁体 → 简体
          converter = Converter({ from: 'tw', to: 'cn' });
          break;
        }
        case 'tw': {
          // 繁体 → 台湾繁体（先转简体，再转台湾）
          const toSimplified = Converter({ from: 'tw', to: 'cn' });
          const toTW = Converter({ from: 'cn', to: 'tw' });
          const simplified = toSimplified(inputText);
          const result = toTW(simplified);
          setOutputText(result);
          return;
        }
        case 'twp': {
          // 繁体 → 台湾繁体（带短语）
          const toSimplified2 = Converter({ from: 'tw', to: 'cn' });
          const toTWP = Converter({ from: 'cn', to: 'twp' });
          const simplified2 = toSimplified2(inputText);
          const result2 = toTWP(simplified2);
          setOutputText(result2);
          return;
        }
        case 'hk': {
          // 繁体 → 香港繁体
          const toSimplified3 = Converter({ from: 'tw', to: 'cn' });
          const toHK = Converter({ from: 'cn', to: 'hk' });
          const simplified3 = toSimplified3(inputText);
          const result3 = toHK(simplified3);
          setOutputText(result3);
          return;
        }
        case 'jp': {
          // 繁体 → 日本汉字
          const toSimplified4 = Converter({ from: 'tw', to: 'cn' });
          const toJP = Converter({ from: 'cn', to: 'jp' });
          const simplified4 = toSimplified4(inputText);
          const result4 = toJP(simplified4);
          setOutputText(result4);
          return;
        }
      }
    }

    const result = converter(inputText);
    setOutputText(result);
  };

  // 复制结果
  const handleCopy = async () => {
    if (!outputText) return;
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // 清空
  const handleClear = () => {
    setInputText('');
    setOutputText('');
    setDetectedType(null);
  };

  // 交换输入输出
  const handleSwap = () => {
    if (!outputText) return;
    setInputText(outputText);
    setOutputText('');
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <ToolHeader
        icon={<Languages className="text-red-500" size={18} />}
        title="简繁转换"
        subtitle="基于 OpenCC，支持大陆、台湾、香港、日本"
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
        {/* 左侧：输入 */}
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">输入文本</label>
            <div className="flex items-center gap-2">
              {detectedType && (
                <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-xs">
                  检测到：{detectedType === 'simplified' ? '简体' : '繁体'}
                </span>
              )}
              <span className="text-xs text-gray-500">{inputText.length} 字符</span>
            </div>
          </div>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="输入需要转换的中文文本...&#10;&#10;支持：&#10;• 简体中文 ↔ 繁体中文&#10;• 大陆、台湾、香港用词转换&#10;• 自动检测输入文本类型"
            className="flex-1 px-4 py-3 rounded-xl border-2 border-red-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:border-red-400 dark:focus:border-red-500 transition-colors overflow-auto"
          />
        </div>

        {/* 中间：转换选项 */}
        <div className="w-64 flex flex-col gap-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">转换目标</label>
          <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border-2 border-red-200 dark:border-gray-600 p-4 overflow-y-auto">
            <div className="space-y-2">
              {conversionOptions.map((option) => (
                <label
                  key={option.id}
                  className={`flex flex-col gap-1 p-3 rounded-lg cursor-pointer transition-all ${
                    selectedMode === option.id
                      ? 'bg-red-100 dark:bg-red-900/30 border-2 border-red-500'
                      : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:border-red-300 dark:hover:border-red-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="conversion-mode"
                      checked={selectedMode === option.id}
                      onChange={() => setSelectedMode(option.id)}
                      className="text-red-500 focus:ring-red-500"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {option.name}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 ml-6">
                    {option.description}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 ml-6 font-mono">
                    {option.example}
                  </p>
                </label>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleConvert}
                disabled={!inputText}
                className={`w-full py-2 rounded-lg font-medium transition-all ${
                  inputText
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                }`}
              >
                转换
              </button>
            </div>
          </div>
        </div>

        {/* 右侧：输出 */}
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">转换结果</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{outputText.length} 字符</span>
              <button
                onClick={handleSwap}
                disabled={!outputText}
                className={`p-1.5 rounded-lg transition-colors ${
                  outputText
                    ? 'text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30'
                    : 'text-gray-400 cursor-not-allowed'
                }`}
                title="交换输入输出"
              >
                <ArrowRightLeft size={16} />
              </button>
              <button
                onClick={handleCopy}
                disabled={!outputText}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  copied
                    ? 'bg-green-500 text-white'
                    : outputText
                      ? 'bg-red-500 hover:bg-red-600 text-white'
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
            </div>
          </div>
          <textarea
            value={outputText}
            readOnly
            placeholder="转换后的文本将显示在这里..."
            className="flex-1 px-4 py-3 rounded-xl border-2 border-red-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none overflow-auto"
          />
        </div>
      </div>

      {/* 底部提示 */}
      <div className="flex-shrink-0 px-6 py-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-t border-red-100 dark:border-gray-700">
        <div className="flex items-center justify-center gap-6 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            <span>快速转换：自动检测 → 智能转换</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
            <span>精确转换：选择目标 → 点击转换</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
            <span>基于 OpenCC 开源项目</span>
          </div>
        </div>
      </div>
    </div>
  );
}
