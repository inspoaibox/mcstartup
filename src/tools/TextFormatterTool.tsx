import { useState } from 'react';
import { Copy, Check, RotateCcw, Wand2 } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

interface FormatOptions {
  removeHtml: boolean;
  removeLinks: boolean;
  removeEmptyLines: boolean;
  removeExtraSpaces: boolean;
  mergeLines: boolean;
  unifyPunctuation: boolean;
  punctuationStyle: 'chinese' | 'english';
  addParagraphSpacing: boolean;
  indentParagraphs: boolean;
}

export default function TextFormatterTool() {
  const ready = useToolTheme();
  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [copied, setCopied] = useState(false);
  const [options, setOptions] = useState<FormatOptions>({
    removeHtml: true,
    removeLinks: true,
    removeEmptyLines: true,
    removeExtraSpaces: true,
    mergeLines: false,
    unifyPunctuation: true,
    punctuationStyle: 'chinese',
    addParagraphSpacing: false,
    indentParagraphs: false,
  });

  const formatText = (text: string, opts: FormatOptions): string => {
    let result = text;

    // 1. 清除 HTML 标签和实体
    if (opts.removeHtml) {
      result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      result = result.replace(/<!--[\s\S]*?-->/g, '');
      result = result.replace(/<[^>]+>/g, '');
      result = result
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&ldquo;/g, '"')
        .replace(/&rdquo;/g, '"')
        .replace(/&lsquo;/g, '\u2018')
        .replace(/&rsquo;/g, '\u2019')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&hellip;/g, '…');
    }

    // 2. 移除链接
    if (opts.removeLinks) {
      result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      result = result.replace(/https?:\/\/[^\s]+/g, '');
    }

    // 3. 清除多余空格（在合并分行之前）
    if (opts.removeExtraSpaces) {
      // 清除行首行尾空格
      result = result.replace(/^[ \t]+|[ \t]+$/gm, '');
      // 清除多个连续空格
      result = result.replace(/[ \t]{2,}/g, ' ');
      // 清除中文之间的空格（但保留中英文之间的空格）
      result = result.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');
    }

    // 4. 合并分行（在处理空行之前）
    if (opts.mergeLines) {
      // 保护段落分隔符（双换行或更多）
      result = result.replace(/\n\s*\n+/g, '\n\n【PARAGRAPH_BREAK】\n\n');
      // 合并单换行为空格
      result = result.replace(/([^\n])\n([^\n])/g, '$1 $2');
      // 恢复段落分隔符
      result = result.replace(/\n\n【PARAGRAPH_BREAK】\n\n/g, '\n\n');
    }

    // 5. 处理空行（在合并分行之后，段落间距之前）
    if (opts.removeEmptyLines) {
      // 将所有多个连续空行统一为单个换行（段落紧凑）
      result = result.replace(/\n\s*\n+/g, '\n');
      result = result.trim();
    }

    // 6. 统一标点符号
    if (opts.unifyPunctuation) {
      if (opts.punctuationStyle === 'chinese') {
        result = result
          .replace(/,/g, '，')
          .replace(/\./g, '。')
          .replace(/!/g, '！')
          .replace(/\?/g, '？')
          .replace(/;/g, '；')
          .replace(/:/g, '：')
          .replace(/\(/g, '（')
          .replace(/\)/g, '）');
      } else {
        result = result
          .replace(/，/g, ',')
          .replace(/。/g, '.')
          .replace(/！/g, '!')
          .replace(/？/g, '?')
          .replace(/；/g, ';')
          .replace(/：/g, ':')
          .replace(/（/g, '(')
          .replace(/）/g, ')');
      }
    }

    // 7. 添加段落间距（在清除空行之后）
    if (opts.addParagraphSpacing) {
      // 先统一为单换行，再在句末添加双换行
      result = result.replace(/\n\s*\n+/g, '\n');
      result = result.replace(/([。！？])\n/g, '$1\n\n');
    }

    // 8. 首行缩进（最后执行，只给段落首行添加）
    if (opts.indentParagraphs) {
      // 分割成段落，只给每个段落的第一行添加缩进
      const paragraphs = result.split(/\n\n+/);
      result = paragraphs
        .map((para) => {
          const lines = para.split('\n');
          if (lines.length > 0 && lines[0].trim()) {
            lines[0] = '　　' + lines[0];
          }
          return lines.join('\n');
        })
        .join('\n\n');
    }

    return result;
  };

  const handleFormat = () => {
    const formatted = formatText(inputText, options);
    setOutputText(formatted);
  };

  const handleCopy = async () => {
    if (!outputText) return;
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleReset = () => {
    setInputText('');
    setOutputText('');
  };

  const handleQuickFormat = () => {
    const quickOptions: FormatOptions = {
      removeHtml: true,
      removeLinks: true,
      removeEmptyLines: true,
      removeExtraSpaces: true,
      mergeLines: false,
      unifyPunctuation: true,
      punctuationStyle: 'chinese',
      addParagraphSpacing: false,
      indentParagraphs: false,
    };
    const formatted = formatText(inputText, quickOptions);
    setOutputText(formatted);
  };

  const handleChineseFormat = () => {
    const chineseOptions: FormatOptions = {
      removeHtml: true,
      removeLinks: true,
      removeEmptyLines: true,
      removeExtraSpaces: true,
      mergeLines: false,
      unifyPunctuation: true,
      punctuationStyle: 'chinese',
      addParagraphSpacing: true,
      indentParagraphs: true,
    };
    const formatted = formatText(inputText, chineseOptions);
    setOutputText(formatted);
  };

  const handleEnglishFormat = () => {
    const englishOptions: FormatOptions = {
      removeHtml: true,
      removeLinks: true,
      removeEmptyLines: true,
      removeExtraSpaces: true,
      mergeLines: false,
      unifyPunctuation: true,
      punctuationStyle: 'english',
      addParagraphSpacing: false,
      indentParagraphs: false,
    };
    const formatted = formatText(inputText, englishOptions);
    setOutputText(formatted);
  };

  const toggleOption = (key: keyof FormatOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <ToolHeader
        icon={<Wand2 className="text-purple-500" size={18} />}
        title="一键排版"
        subtitle="清除干扰元素，转换为干净整洁的文章"
        closeMode="hide"
        actions={
          <>
            <button
              onClick={handleQuickFormat}
              disabled={!inputText}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                inputText
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg hover:shadow-xl'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Wand2 size={16} />
              一键排版
            </button>
            <button
              onClick={handleChineseFormat}
              disabled={!inputText}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                inputText
                  ? 'bg-blue-500 hover:bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
            >
              中文排版
            </button>
            <button
              onClick={handleEnglishFormat}
              disabled={!inputText}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                inputText
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
            >
              English
            </button>
            <button
              onClick={handleReset}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="重置"
            >
              <RotateCcw size={18} />
            </button>
          </>
        }
      />

      <div className="flex-1 flex gap-4 p-6 min-h-0">
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">原始文本</label>
            <span className="text-xs text-gray-400">{inputText.length} 字符</span>
          </div>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="粘贴需要排版的文章内容...&#10;&#10;支持：&#10;• 清除 HTML 标签、样式、脚本&#10;• 移除链接和广告&#10;• 统一标点符号（中文/英文）&#10;• 清理多余空格和空行&#10;• 智能段落格式化"
            className="flex-1 px-4 py-3 rounded-xl border-2 border-purple-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:border-purple-400 dark:focus:border-purple-500 transition-colors overflow-auto"
          />
        </div>

        <div className="w-64 flex flex-col gap-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">自定义选项</label>
          <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border-2 border-purple-200 dark:border-gray-600 p-4 overflow-y-auto">
            <div className="space-y-3">
              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.removeHtml}
                  onChange={() => toggleOption('removeHtml')}
                  className="mt-0.5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                    清除 HTML 标签
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    移除样式、脚本、注释
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.removeLinks}
                  onChange={() => toggleOption('removeLinks')}
                  className="mt-0.5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                    移除链接
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">保留链接文本</div>
                </div>
              </label>

              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.removeEmptyLines}
                  onChange={() => toggleOption('removeEmptyLines')}
                  className="mt-0.5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                    清除空行
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    段落紧凑，无空行间隔
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.removeExtraSpaces}
                  onChange={() => toggleOption('removeExtraSpaces')}
                  className="mt-0.5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                    清除多余空格
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">统一空格格式</div>
                </div>
              </label>

              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.mergeLines}
                  onChange={() => toggleOption('mergeLines')}
                  className="mt-0.5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                    合并分行
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    段落内换行合并为一行
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.unifyPunctuation}
                  onChange={() => toggleOption('unifyPunctuation')}
                  className="mt-0.5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                    统一标点符号
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {options.punctuationStyle === 'chinese' ? '转换为中文标点' : '转换为英文标点'}
                  </div>
                </div>
              </label>

              {options.unifyPunctuation && (
                <div className="ml-6 flex gap-2">
                  <button
                    onClick={() => setOptions((prev) => ({ ...prev, punctuationStyle: 'chinese' }))}
                    className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
                      options.punctuationStyle === 'chinese'
                        ? 'bg-purple-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    中文
                  </button>
                  <button
                    onClick={() => setOptions((prev) => ({ ...prev, punctuationStyle: 'english' }))}
                    className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
                      options.punctuationStyle === 'english'
                        ? 'bg-purple-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    English
                  </button>
                </div>
              )}

              <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>

              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.addParagraphSpacing}
                  onChange={() => toggleOption('addParagraphSpacing')}
                  className="mt-0.5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                    段落间距
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    句末（。！？）后添加空行
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={options.indentParagraphs}
                  onChange={() => toggleOption('indentParagraphs')}
                  className="mt-0.5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                    首行缩进
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    每个段落开头缩进两字符
                  </div>
                </div>
              </label>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleFormat}
                disabled={!inputText}
                className={`w-full py-2 rounded-lg font-medium transition-all ${
                  inputText
                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/50'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                }`}
              >
                应用自定义选项
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">排版结果</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{outputText.length} 字符</span>
              <button
                onClick={handleCopy}
                disabled={!outputText}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  copied
                    ? 'bg-green-500 text-white'
                    : outputText
                      ? 'bg-purple-500 hover:bg-purple-600 text-white'
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
            placeholder="排版后的文本将显示在这里..."
            className="flex-1 px-4 py-3 rounded-xl border-2 border-purple-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none overflow-auto"
          />
        </div>
      </div>

      <div className="flex-shrink-0 px-6 py-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-t border-purple-100 dark:border-gray-700">
        <div className="flex items-center justify-center gap-6 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
            <span>一键排版：智能清理</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            <span>中文排版：中文标点+段落格式</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span>English：英文标点</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-pink-500"></span>
            <span>自定义：完全控制</span>
          </div>
        </div>
      </div>
    </div>
  );
}
