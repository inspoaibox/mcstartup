import { useState } from 'react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Copy, Check } from 'lucide-react';
import { format } from 'sql-formatter';

type Dialect = 'sql' | 'mysql' | 'postgresql' | 'sqlite' | 'bigquery' | 'spark' | 'tsql';

const DIALECTS: { id: Dialect; label: string }[] = [
  { id: 'sql', label: 'SQL' },
  { id: 'mysql', label: 'MySQL' },
  { id: 'postgresql', label: 'PostgreSQL' },
  { id: 'sqlite', label: 'SQLite' },
  { id: 'bigquery', label: 'BigQuery' },
  { id: 'spark', label: 'Spark' },
  { id: 'tsql', label: 'T-SQL' },
];

const EXAMPLES: Record<string, string> = {
  select: `SELECT u.id,u.name,u.email,o.total FROM users u LEFT JOIN orders o ON u.id=o.user_id WHERE u.created_at>'2024-01-01' AND o.status='paid' ORDER BY o.total DESC LIMIT 10`,
  insert: `INSERT INTO users(name,email,age,created_at) VALUES('张三','zhangsan@example.com',25,NOW()),('李四','lisi@example.com',30,NOW())`,
  update: `UPDATE products SET price=price*0.9,updated_at=NOW() WHERE category_id IN(SELECT id FROM categories WHERE name='电子产品') AND stock>0`,
  create: `CREATE TABLE IF NOT EXISTS orders(id BIGINT PRIMARY KEY AUTO_INCREMENT,user_id INT NOT NULL,total DECIMAL(10,2) NOT NULL DEFAULT 0.00,status VARCHAR(20) NOT NULL DEFAULT 'pending',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id))`,
};

export default function SqlTool() {
  useToolTheme();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [dialect, setDialect] = useState<Dialect>('mysql');
  const [indentSize, setIndentSize] = useState(2);
  const [uppercase, setUppercase] = useState(true);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<'format' | 'minify'>('format');

  function doFormat() {
    if (!input.trim()) {
      setError('请输入 SQL');
      return;
    }
    try {
      const result = format(input, {
        language: dialect,
        tabWidth: indentSize,
        keywordCase: uppercase ? 'upper' : 'preserve',
        linesBetweenQueries: 2,
      });
      setOutput(result);
      setError('');
    } catch (e) {
      setError(`格式化失败: ${e instanceof Error ? e.message : String(e)}`);
      setOutput('');
    }
  }

  function doMinify() {
    if (!input.trim()) {
      setError('请输入 SQL');
      return;
    }
    try {
      // 压缩：去掉多余空白和换行
      const result = input
        .replace(/\s+/g, ' ')
        .replace(/\s*([,;()])\s*/g, '$1')
        .trim();
      setOutput(result);
      setError('');
    } catch (e) {
      setError(`压缩失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function copy() {
    navigator.clipboard.writeText(output).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const inputCls =
    'w-full h-full px-3 py-2 rounded-lg border text-sm font-mono outline-none resize-none bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:border-blue-500';

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="SQL 格式化" icon="🗄️" />
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* 参数栏 */}
        <div className="px-4 pt-3 pb-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 space-y-2">
          <div className="flex gap-3 items-center flex-wrap">
            {/* 模式 */}
            <div className="flex gap-1">
              {(['format', 'minify'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${mode === m ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                >
                  {m === 'format' ? '格式化' : '压缩'}
                </button>
              ))}
            </div>

            {mode === 'format' && (
              <>
                {/* 方言 */}
                <div className="flex gap-1 flex-wrap">
                  {DIALECTS.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setDialect(d.id)}
                      className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${dialect === d.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>

                {/* 选项 */}
                <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={uppercase}
                    onChange={(e) => setUppercase(e.target.checked)}
                    className="rounded"
                  />
                  关键字大写
                </label>
                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <span>缩进</span>
                  <select
                    value={indentSize}
                    onChange={(e) => setIndentSize(Number(e.target.value))}
                    className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs"
                  >
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                  </select>
                </div>
              </>
            )}

            {/* 示例 */}
            <div className="ml-auto flex gap-1">
              {Object.entries(EXAMPLES).map(([key, sql]) => (
                <button
                  key={key}
                  onClick={() => setInput(sql)}
                  className="px-2 py-1 text-[10px] rounded bg-gray-100 dark:bg-gray-700 text-gray-400 hover:text-blue-500 uppercase"
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 编辑区 */}
        <div className="flex-1 overflow-hidden flex gap-0">
          {/* 输入 */}
          <div className="flex-1 flex flex-col p-3 min-w-0">
            <div className="text-[10px] text-gray-400 mb-1.5 font-medium uppercase tracking-wide">
              输入
            </div>
            <textarea
              className={inputCls}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入 SQL 语句..."
              spellCheck={false}
            />
          </div>

          {/* 分隔线 + 按钮 */}
          <div className="flex flex-col items-center justify-center gap-2 px-2">
            <button
              onClick={mode === 'format' ? doFormat : doMinify}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg font-medium rotate-0 writing-mode-vertical"
            >
              {mode === 'format' ? '格式化 →' : '压缩 →'}
            </button>
          </div>

          {/* 输出 */}
          <div className="flex-1 flex flex-col p-3 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                输出
              </div>
              {output && (
                <button
                  onClick={copy}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-500"
                >
                  {copied ? (
                    <>
                      <Check size={11} className="text-green-500" /> 已复制
                    </>
                  ) : (
                    <>
                      <Copy size={11} /> 复制
                    </>
                  )}
                </button>
              )}
            </div>
            <textarea
              className={`${inputCls} ${error ? 'border-red-400 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : ''}`}
              value={error || output}
              readOnly
              placeholder="格式化结果..."
              spellCheck={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
