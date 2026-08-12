// CSS 美化和压缩工具
import { useState } from 'react';
import { Copy, Check, Wand2, Minimize2 } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

export default function CssTool() {
  const ready = useToolTheme();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<'beautify' | 'minify'>('beautify');
  const [options, setOptions] = useState({
    sortProperties: true,
    removeComments: false,
    indentSize: 2,
  });

  // CSS 美化（使用 Prettier）
  const beautifyCSS = async () => {
    if (!input.trim()) {
      setError('请输入 CSS 代码');
      setOutput('');
      return;
    }
    try {
      setError('');
      const { format } = await import('prettier/standalone');
      const parserCss = await import('prettier/plugins/postcss');
      const result = await format(input, {
        parser: 'css',
        plugins: [parserCss.default],
        tabWidth: options.indentSize,
        printWidth: 80,
      });
      setOutput(result.trim());
    } catch (e) {
      setError(`美化失败: ${e instanceof Error ? e.message : String(e)}`);
      setOutput('');
    }
  };

  // CSS 压缩
  const minifyCSS = () => {
    if (!input.trim()) {
      setError('请输入 CSS 代码');
      setOutput('');
      return;
    }

    try {
      setError('');

      let minified = input;

      // 移除注释
      minified = minified.replace(/\/\*[\s\S]*?\*\//g, '');

      // 移除多余空白
      minified = minified.replace(/\s+/g, ' ');
      minified = minified.replace(/\s*{\s*/g, '{');
      minified = minified.replace(/\s*}\s*/g, '}');
      minified = minified.replace(/\s*;\s*/g, ';');
      minified = minified.replace(/\s*:\s*/g, ':');
      minified = minified.replace(/\s*,\s*/g, ',');

      // 移除最后一个分号
      minified = minified.replace(/;}/g, '}');

      // 移除首尾空白
      minified = minified.trim();

      setOutput(minified);
    } catch (e) {
      setError(`压缩失败: ${e instanceof Error ? e.message : String(e)}`);
      setOutput('');
    }
  };

  // 执行操作
  const handleProcess = async () => {
    if (mode === 'beautify') {
      await beautifyCSS();
    } else {
      minifyCSS();
    }
  };

  // 复制到剪贴板
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      alert('复制失败');
    }
  };

  // 清空
  const handleClear = () => {
    setInput('');
    setOutput('');
    setError('');
  };

  // 示例代码
  const loadExample = () => {
    setInput(
      `.button{background-color:#3b82f6;color:#fff;padding:10px 20px;border-radius:5px;border:none;cursor:pointer;transition:all 0.3s ease}.button:hover{background-color:#2563eb;transform:translateY(-2px);box-shadow:0 4px 6px rgba(0,0,0,0.1)}@media (max-width:768px){.button{padding:8px 16px;font-size:14px}}`
    );
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <ToolHeader icon="🎨" title="CSS 工具" />

      {/* 模式选择 */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
        <button
          onClick={() => setMode('beautify')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
            mode === 'beautify'
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-white dark:bg-gray-900'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          <Wand2 size={16} />
          美化
        </button>
        <button
          onClick={() => setMode('minify')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
            mode === 'minify'
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-white dark:bg-gray-900'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          <Minimize2 size={16} />
          压缩
        </button>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {/* 输入区域 */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">CSS 输入</label>
            <button
              onClick={loadExample}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              加载示例
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="输入 CSS 代码..."
          />
        </div>

        {/* 选项 */}
        {mode === 'beautify' && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.sortProperties}
                  onChange={(e) => setOptions({ ...options, sortProperties: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">排序属性</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.removeComments}
                  onChange={(e) => setOptions({ ...options, removeComments: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">移除注释</span>
              </label>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700 dark:text-gray-300">缩进:</span>
                <select
                  value={options.indentSize}
                  onChange={(e) => setOptions({ ...options, indentSize: parseInt(e.target.value) })}
                  className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                >
                  <option value="2">2 空格</option>
                  <option value="4">4 空格</option>
                  <option value="8">Tab</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={handleProcess}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium flex items-center gap-2"
          >
            {mode === 'beautify' ? <Wand2 size={18} /> : <Minimize2 size={18} />}
            {mode === 'beautify' ? '美化' : '压缩'}
          </button>
          <button
            onClick={handleClear}
            className="px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
          >
            清空
          </button>
        </div>

        {/* 输出区域 */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              输出结果
              {output && input && (
                <span className="ml-2 text-xs text-gray-500">
                  ({input.length} → {output.length} 字符,
                  {((1 - output.length / input.length) * 100).toFixed(1)}% 压缩率)
                </span>
              )}
            </label>
            {output && (
              <button
                onClick={copyToClipboard}
                className="flex items-center gap-1 px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? '已复制' : '复制'}
              </button>
            )}
          </div>
          <textarea
            value={error || output}
            readOnly
            className={`flex-1 px-3 py-2 border rounded-lg font-mono text-sm resize-none focus:outline-none ${
              error
                ? 'border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            }`}
            placeholder="结果将显示在这里..."
          />
        </div>
      </div>
    </div>
  );
}
