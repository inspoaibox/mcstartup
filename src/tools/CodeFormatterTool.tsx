import { useState } from 'react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Copy, Check } from 'lucide-react';

type Lang =
  | 'javascript'
  | 'typescript'
  | 'css'
  | 'scss'
  | 'less'
  | 'html'
  | 'json'
  | 'markdown'
  | 'yaml';

type PrettierPlugin = import('prettier').Plugin;

const LANGS: { id: Lang; label: string; parser: string }[] = [
  { id: 'javascript', label: 'JavaScript', parser: 'babel' },
  { id: 'typescript', label: 'TypeScript', parser: 'typescript' },
  { id: 'json', label: 'JSON', parser: 'json' },
  { id: 'css', label: 'CSS', parser: 'css' },
  { id: 'scss', label: 'SCSS', parser: 'scss' },
  { id: 'less', label: 'Less', parser: 'less' },
  { id: 'html', label: 'HTML', parser: 'html' },
  { id: 'markdown', label: 'Markdown', parser: 'markdown' },
  { id: 'yaml', label: 'YAML', parser: 'yaml' },
];

async function loadPrettierPlugins(lang: Lang): Promise<PrettierPlugin[]> {
  if (lang === 'javascript' || lang === 'json') {
    const [parserBabel, parserEstree] = await Promise.all([
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ]);
    return [parserBabel.default, parserEstree.default];
  }
  if (lang === 'typescript') {
    const [parserTypescript, parserEstree] = await Promise.all([
      import('prettier/plugins/typescript'),
      import('prettier/plugins/estree'),
    ]);
    return [parserTypescript.default, parserEstree.default];
  }
  if (lang === 'css' || lang === 'scss' || lang === 'less') {
    const parserCss = await import('prettier/plugins/postcss');
    return [parserCss.default];
  }
  if (lang === 'html') {
    const parserHtml = await import('prettier/plugins/html');
    return [parserHtml.default];
  }
  if (lang === 'markdown') {
    const parserMarkdown = await import('prettier/plugins/markdown');
    return [parserMarkdown.default];
  }
  const parserYaml = await import('prettier/plugins/yaml');
  return [parserYaml.default];
}

const EXAMPLES: Partial<Record<Lang, string>> = {
  javascript: `function hello(name){const greeting='Hello, '+name+'!';console.log(greeting);return greeting;}const result=hello('World');`,
  typescript: `interface User{id:number;name:string;email:string;}function getUser(id:number):Promise<User>{return fetch('/api/users/'+id).then(r=>r.json());}`,
  json: `{"name":"John","age":30,"address":{"city":"Beijing","zip":"100000"},"hobbies":["reading","coding"]}`,
  css: `.button{background:#3b82f6;color:#fff;padding:10px 20px;border-radius:5px;border:none;cursor:pointer;}.button:hover{background:#2563eb;}`,
  html: `<!DOCTYPE html><html><head><title>Test</title></head><body><div class="container"><h1>Hello</h1><p>World</p></div></body></html>`,
};

export default function CodeFormatterTool() {
  useToolTheme();
  const [lang, setLang] = useState<Lang>('javascript');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [printWidth, setPrintWidth] = useState(80);
  const [tabWidth, setTabWidth] = useState(2);
  const [useTabs, setUseTabs] = useState(false);
  const [singleQuote, setSingleQuote] = useState(true);
  const [semi, setSemi] = useState(true);

  const currentLang = LANGS.find((l) => l.id === lang)!;

  async function doFormat() {
    if (!input.trim()) {
      setError('请输入代码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [{ format }, plugins] = await Promise.all([
        import('prettier/standalone'),
        loadPrettierPlugins(lang),
      ]);
      const result = await format(input, {
        parser: currentLang.parser,
        plugins,
        printWidth,
        tabWidth,
        useTabs,
        singleQuote,
        semi,
        trailingComma: 'es5',
      });
      setOutput(result);
    } catch (e) {
      setError(`格式化失败: ${e instanceof Error ? e.message : String(e)}`);
      setOutput('');
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    navigator.clipboard.writeText(output).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function loadExample() {
    const ex = EXAMPLES[lang];
    if (ex) setInput(ex);
  }

  const inputCls =
    'w-full h-full px-3 py-2 rounded-lg border text-sm font-mono outline-none resize-none bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:border-blue-500';

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="代码格式化" icon="✨" />
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* 参数栏 */}
        <div className="px-4 pt-3 pb-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 space-y-2">
          {/* 语言选择 */}
          <div className="flex gap-1.5 flex-wrap">
            {LANGS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLang(l.id)}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${lang === l.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* 选项 */}
          <div className="flex gap-4 items-center flex-wrap text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-1.5">
              <span>行宽</span>
              <input
                type="number"
                min={40}
                max={200}
                value={printWidth}
                onChange={(e) => setPrintWidth(Number(e.target.value))}
                className="w-14 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-center"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span>缩进</span>
              <input
                type="number"
                min={1}
                max={8}
                value={tabWidth}
                onChange={(e) => setTabWidth(Number(e.target.value))}
                className="w-10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-center"
              />
            </div>
            {['javascript', 'typescript'].includes(lang) && (
              <>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={singleQuote}
                    onChange={(e) => setSingleQuote(e.target.checked)}
                    className="rounded"
                  />
                  单引号
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={semi}
                    onChange={(e) => setSemi(e.target.checked)}
                    className="rounded"
                  />
                  分号
                </label>
              </>
            )}
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={useTabs}
                onChange={(e) => setUseTabs(e.target.checked)}
                className="rounded"
              />
              Tab 缩进
            </label>
            {EXAMPLES[lang] && (
              <button onClick={loadExample} className="ml-auto text-blue-500 hover:underline">
                加载示例
              </button>
            )}
          </div>
        </div>

        {/* 编辑区 */}
        <div className="flex-1 overflow-hidden flex gap-0">
          <div className="flex-1 flex flex-col p-3 min-w-0">
            <div className="text-[10px] text-gray-400 mb-1.5 font-medium uppercase tracking-wide">
              输入
            </div>
            <textarea
              className={inputCls}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`输入 ${currentLang.label} 代码...`}
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col items-center justify-center gap-2 px-2">
            <button
              onClick={doFormat}
              disabled={loading}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded-lg font-medium"
            >
              {loading ? '...' : '格式化 →'}
            </button>
          </div>

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
