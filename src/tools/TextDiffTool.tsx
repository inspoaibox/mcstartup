// 文本比较工具
import { useState } from 'react';
import { Copy, Check, RotateCcw, ArrowRightLeft, Eye } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

type CompareMode = 'char' | 'word' | 'line' | 'paragraph' | 'css' | 'code';

interface DiffResult {
  type: 'equal' | 'insert' | 'delete' | 'modify';
  leftContent: string;
  rightContent: string;
  leftLineNum?: number;
  rightLineNum?: number;
}

const COMPARE_MODES = [
  { id: 'char' as CompareMode, name: '字符比较', description: '逐字符对比' },
  { id: 'word' as CompareMode, name: '单词比较', description: '按单词对比' },
  { id: 'line' as CompareMode, name: '行比较', description: '逐行对比' },
  { id: 'paragraph' as CompareMode, name: '段落比较', description: '按段落对比' },
  { id: 'css' as CompareMode, name: 'CSS 比较', description: 'CSS 语法对比' },
  { id: 'code' as CompareMode, name: '代码比较', description: '代码结构对比' },
];

export default function TextDiffTool() {
  const ready = useToolTheme();
  const [leftText, setLeftText] = useState('');
  const [rightText, setRightText] = useState('');
  const [compareMode, setCompareMode] = useState<CompareMode>('line');
  const [diffResults, setDiffResults] = useState<DiffResult[]>([]);
  const [showDiff, setShowDiff] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [copied, setCopied] = useState(false);

  // 字符级别比较（最小粒度）
  const compareChars = (left: string, right: string): DiffResult[] => {
    const results: DiffResult[] = [];
    const maxLen = Math.max(left.length, right.length);

    let i = 0;
    while (i < maxLen) {
      if (i >= left.length) {
        // 右侧多余
        results.push({
          type: 'insert',
          leftContent: '',
          rightContent: right[i],
        });
      } else if (i >= right.length) {
        // 左侧多余
        results.push({
          type: 'delete',
          leftContent: left[i],
          rightContent: '',
        });
      } else if (left[i] === right[i]) {
        // 相同
        results.push({
          type: 'equal',
          leftContent: left[i],
          rightContent: right[i],
        });
      } else {
        // 不同
        results.push({
          type: 'modify',
          leftContent: left[i],
          rightContent: right[i],
        });
      }
      i++;
    }

    return results;
  };

  // 单词级别比较
  const compareWords = (left: string, right: string): DiffResult[] => {
    const leftWords = left.split(/\s+/).filter((w) => w);
    const rightWords = right.split(/\s+/).filter((w) => w);
    const results: DiffResult[] = [];

    const maxLen = Math.max(leftWords.length, rightWords.length);
    for (let i = 0; i < maxLen; i++) {
      const leftWord = leftWords[i] || '';
      const rightWord = rightWords[i] || '';

      if (!leftWord && rightWord) {
        results.push({ type: 'insert', leftContent: '', rightContent: rightWord });
      } else if (leftWord && !rightWord) {
        results.push({ type: 'delete', leftContent: leftWord, rightContent: '' });
      } else if (leftWord === rightWord) {
        results.push({ type: 'equal', leftContent: leftWord, rightContent: rightWord });
      } else {
        results.push({ type: 'modify', leftContent: leftWord, rightContent: rightWord });
      }
    }

    return results;
  };

  // 行级别比较
  const compareLines = (left: string, right: string): DiffResult[] => {
    const leftLines = left.split('\n');
    const rightLines = right.split('\n');
    const results: DiffResult[] = [];

    const maxLen = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < maxLen; i++) {
      const leftLine = leftLines[i] !== undefined ? leftLines[i] : null;
      const rightLine = rightLines[i] !== undefined ? rightLines[i] : null;

      if (leftLine === null && rightLine !== null) {
        results.push({
          type: 'insert',
          leftContent: '',
          rightContent: rightLine,
          leftLineNum: undefined,
          rightLineNum: i + 1,
        });
      } else if (leftLine !== null && rightLine === null) {
        results.push({
          type: 'delete',
          leftContent: leftLine,
          rightContent: '',
          leftLineNum: i + 1,
          rightLineNum: undefined,
        });
      } else if (leftLine === rightLine) {
        results.push({
          type: 'equal',
          leftContent: leftLine!,
          rightContent: rightLine!,
          leftLineNum: i + 1,
          rightLineNum: i + 1,
        });
      } else {
        results.push({
          type: 'modify',
          leftContent: leftLine!,
          rightContent: rightLine!,
          leftLineNum: i + 1,
          rightLineNum: i + 1,
        });
      }
    }

    return results;
  };

  // 段落级别比较
  const compareParagraphs = (left: string, right: string): DiffResult[] => {
    const leftParas = left.split(/\n\s*\n/).filter((p) => p.trim());
    const rightParas = right.split(/\n\s*\n/).filter((p) => p.trim());
    const results: DiffResult[] = [];

    const maxLen = Math.max(leftParas.length, rightParas.length);
    for (let i = 0; i < maxLen; i++) {
      const leftPara = leftParas[i] || '';
      const rightPara = rightParas[i] || '';

      if (!leftPara && rightPara) {
        results.push({ type: 'insert', leftContent: '', rightContent: rightPara });
      } else if (leftPara && !rightPara) {
        results.push({ type: 'delete', leftContent: leftPara, rightContent: '' });
      } else if (leftPara === rightPara) {
        results.push({ type: 'equal', leftContent: leftPara, rightContent: rightPara });
      } else {
        results.push({ type: 'modify', leftContent: leftPara, rightContent: rightPara });
      }
    }

    return results;
  };

  // CSS 比较（按规则）
  const compareCss = (left: string, right: string): DiffResult[] => {
    // 简化版：按 CSS 规则块分割
    const cssRuleRegex = /([^{]+)\{([^}]+)\}/g;

    const extractRules = (css: string) => {
      const rules: { selector: string; properties: string }[] = [];
      let match;
      while ((match = cssRuleRegex.exec(css)) !== null) {
        rules.push({
          selector: match[1].trim(),
          properties: match[2].trim(),
        });
      }
      return rules;
    };

    const leftRules = extractRules(left);
    const rightRules = extractRules(right);
    const results: DiffResult[] = [];

    const maxLen = Math.max(leftRules.length, rightRules.length);
    for (let i = 0; i < maxLen; i++) {
      const leftRule = leftRules[i];
      const rightRule = rightRules[i];

      if (!leftRule && rightRule) {
        results.push({
          type: 'insert',
          leftContent: '',
          rightContent: `${rightRule.selector} { ${rightRule.properties} }`,
        });
      } else if (leftRule && !rightRule) {
        results.push({
          type: 'delete',
          leftContent: `${leftRule.selector} { ${leftRule.properties} }`,
          rightContent: '',
        });
      } else if (
        leftRule.selector === rightRule.selector &&
        leftRule.properties === rightRule.properties
      ) {
        results.push({
          type: 'equal',
          leftContent: `${leftRule.selector} { ${leftRule.properties} }`,
          rightContent: `${rightRule.selector} { ${rightRule.properties} }`,
        });
      } else {
        results.push({
          type: 'modify',
          leftContent: `${leftRule.selector} { ${leftRule.properties} }`,
          rightContent: `${rightRule.selector} { ${rightRule.properties} }`,
        });
      }
    }

    return results;
  };

  // 代码比较（按函数/块）
  const compareCode = (left: string, right: string): DiffResult[] => {
    // 简化版：按代码块分割（花括号）
    const blockRegex = /([^{]*\{[^}]*\})/g;

    const extractBlocks = (code: string) => {
      const blocks: string[] = [];
      let match;
      while ((match = blockRegex.exec(code)) !== null) {
        blocks.push(match[1].trim());
      }
      return blocks;
    };

    const leftBlocks = extractBlocks(left);
    const rightBlocks = extractBlocks(right);
    const results: DiffResult[] = [];

    const maxLen = Math.max(leftBlocks.length, rightBlocks.length);
    for (let i = 0; i < maxLen; i++) {
      const leftBlock = leftBlocks[i] || '';
      const rightBlock = rightBlocks[i] || '';

      if (!leftBlock && rightBlock) {
        results.push({ type: 'insert', leftContent: '', rightContent: rightBlock });
      } else if (leftBlock && !rightBlock) {
        results.push({ type: 'delete', leftContent: leftBlock, rightContent: '' });
      } else if (leftBlock === rightBlock) {
        results.push({ type: 'equal', leftContent: leftBlock, rightContent: rightBlock });
      } else {
        results.push({ type: 'modify', leftContent: leftBlock, rightContent: rightBlock });
      }
    }

    return results;
  };

  // 执行比较
  const handleCompare = () => {
    let left = leftText;
    let right = rightText;

    // 预处理
    if (ignoreWhitespace) {
      left = left.replace(/\s+/g, ' ').trim();
      right = right.replace(/\s+/g, ' ').trim();
    }

    if (ignoreCase) {
      left = left.toLowerCase();
      right = right.toLowerCase();
    }

    let results: DiffResult[] = [];

    switch (compareMode) {
      case 'char':
        results = compareChars(left, right);
        break;
      case 'word':
        results = compareWords(left, right);
        break;
      case 'line':
        results = compareLines(left, right);
        break;
      case 'paragraph':
        results = compareParagraphs(left, right);
        break;
      case 'css':
        results = compareCss(left, right);
        break;
      case 'code':
        results = compareCode(left, right);
        break;
    }

    setDiffResults(results);
    setShowDiff(true);
  };

  // 交换左右文本
  const handleSwap = () => {
    const temp = leftText;
    setLeftText(rightText);
    setRightText(temp);
  };

  // 清空
  const handleClear = () => {
    setLeftText('');
    setRightText('');
    setDiffResults([]);
    setShowDiff(false);
  };

  // 复制差异报告
  const handleCopyReport = () => {
    const report = diffResults
      .map((diff) => {
        if (diff.type === 'equal') return null;
        if (diff.type === 'insert') return `+ ${diff.rightContent}`;
        if (diff.type === 'delete') return `- ${diff.leftContent}`;
        return `~ ${diff.leftContent} → ${diff.rightContent}`;
      })
      .filter(Boolean)
      .join('\n');

    navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // 统计
  const stats = {
    total: diffResults.length,
    equal: diffResults.filter((d) => d.type === 'equal').length,
    insert: diffResults.filter((d) => d.type === 'insert').length,
    delete: diffResults.filter((d) => d.type === 'delete').length,
    modify: diffResults.filter((d) => d.type === 'modify').length,
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* Header */}
      <ToolHeader icon="🔍" title="文本比较" subtitle="支持多种比较模式" />

      {/* 比较模式选择 */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">比较模式</label>
          <div className="flex gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                checked={ignoreWhitespace}
                onChange={(e) => setIgnoreWhitespace(e.target.checked)}
                className="w-4 h-4"
              />
              忽略空白
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                checked={ignoreCase}
                onChange={(e) => setIgnoreCase(e.target.checked)}
                className="w-4 h-4"
              />
              忽略大小写
            </label>
          </div>
        </div>
        <div className="grid grid-cols-6 gap-2">
          {COMPARE_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setCompareMode(mode.id)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                compareMode === mode.id
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
              title={mode.description}
            >
              {mode.name}
            </button>
          ))}
        </div>
      </div>

      {/* 输入区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧文本 */}
        <div className="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-800">
          <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">原始文本</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {leftText.split('\n').length} 行 · {leftText.length} 字符
            </span>
          </div>
          <textarea
            value={leftText}
            onChange={(e) => setLeftText(e.target.value)}
            placeholder="粘贴或输入原始文本..."
            className="flex-1 px-4 py-3 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono text-sm resize-none focus:outline-none"
          />
        </div>

        {/* 中间操作栏 */}
        <div className="w-16 flex flex-col items-center justify-center gap-4 bg-gray-50 dark:bg-gray-800">
          <button
            onClick={handleCompare}
            disabled={!leftText || !rightText}
            className="p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="开始对比"
          >
            <Eye size={20} />
          </button>
          <button
            onClick={handleSwap}
            className="p-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            title="交换左右"
          >
            <ArrowRightLeft size={20} />
          </button>
          <button
            onClick={handleClear}
            className="p-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            title="清空"
          >
            <RotateCcw size={20} />
          </button>
        </div>

        {/* 右侧文本 */}
        <div className="flex-1 flex flex-col">
          <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">对比文本</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {rightText.split('\n').length} 行 · {rightText.length} 字符
            </span>
          </div>
          <textarea
            value={rightText}
            onChange={(e) => setRightText(e.target.value)}
            placeholder="粘贴或输入对比文本..."
            className="flex-1 px-4 py-3 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-mono text-sm resize-none focus:outline-none"
          />
        </div>
      </div>

      {/* 差异结果 */}
      {showDiff && (
        <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
          {/* 统计信息 */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div className="flex gap-4 text-xs">
              <span className="text-gray-600 dark:text-gray-400">
                总计: <strong>{stats.total}</strong>
              </span>
              <span className="text-green-600 dark:text-green-400">
                相同: <strong>{stats.equal}</strong>
              </span>
              <span className="text-blue-600 dark:text-blue-400">
                新增: <strong>{stats.insert}</strong>
              </span>
              <span className="text-red-600 dark:text-red-400">
                删除: <strong>{stats.delete}</strong>
              </span>
              <span className="text-orange-600 dark:text-orange-400">
                修改: <strong>{stats.modify}</strong>
              </span>
            </div>
            <button
              onClick={handleCopyReport}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                copied
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? '已复制' : '复制报告'}
            </button>
          </div>

          {/* 差异列表 */}
          <div className="max-h-80 overflow-y-auto p-4 space-y-2">
            {diffResults
              .filter((diff) => diff.type !== 'equal')
              .slice(0, 100)
              .map((diff, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg text-sm font-mono ${
                    diff.type === 'insert'
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500'
                      : diff.type === 'delete'
                        ? 'bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500'
                        : 'bg-orange-50 dark:bg-orange-900/20 border-l-4 border-orange-500'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`text-xs font-bold ${
                        diff.type === 'insert'
                          ? 'text-blue-600 dark:text-blue-400'
                          : diff.type === 'delete'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-orange-600 dark:text-orange-400'
                      }`}
                    >
                      {diff.type === 'insert' ? '+' : diff.type === 'delete' ? '-' : '~'}
                    </span>
                    <div className="flex-1">
                      {diff.type === 'modify' ? (
                        <>
                          <div className="text-red-600 dark:text-red-400 line-through">
                            {diff.leftContent}
                          </div>
                          <div className="text-green-600 dark:text-green-400 mt-1">
                            {diff.rightContent}
                          </div>
                        </>
                      ) : (
                        <div
                          className={
                            diff.type === 'insert'
                              ? 'text-blue-700 dark:text-blue-300'
                              : 'text-red-700 dark:text-red-300'
                          }
                        >
                          {diff.leftContent || diff.rightContent}
                        </div>
                      )}
                    </div>
                    {(diff.leftLineNum || diff.rightLineNum) && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        行 {diff.leftLineNum || diff.rightLineNum}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            {diffResults.filter((d) => d.type !== 'equal').length > 100 && (
              <div className="text-center text-xs text-gray-500 dark:text-gray-400 py-2">
                还有 {diffResults.filter((d) => d.type !== 'equal').length - 100} 处差异未显示...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
