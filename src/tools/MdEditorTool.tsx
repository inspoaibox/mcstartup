import { useEffect, useRef, useState, useCallback } from 'react';
import { save, open } from '@tauri-apps/api/dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/api/fs';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import {
  Save,
  FolderOpen,
  Copy,
  Check,
  FileDown,
  Trash2,
  Code,
  Eye,
  Columns,
} from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';
import { useSettingsStore } from '../stores/settingsStore';

type EditorMode = 'wysiwyg' | 'split' | 'preview';

export default function MdEditorTool() {
  const ready = useToolTheme();
  const theme = useSettingsStore((s) => s.theme);

  const editorRef = useRef<HTMLDivElement>(null);
  const vditorRef = useRef<Vditor | null>(null);
  const [copied, setCopied] = useState(false);
  const [fileName, setFileName] = useState('未命名文档.md');
  const [isDirty, setIsDirty] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('split');
  const [charCount, setCharCount] = useState(0);

  const resolveTheme = useCallback(() => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'classic';
    }
    return theme === 'dark' ? 'dark' : 'classic';
  }, [theme]);

  // 初始化 Vditor
  useEffect(() => {
    if (!ready || !editorRef.current) return;

    const vd = new Vditor(editorRef.current, {
      // 完全本地化：指向 public/vditor 目录
      cdn: `${window.location.protocol}//${window.location.host}/vditor`,
      theme: resolveTheme() === 'dark' ? 'dark' : 'classic',
      mode: 'ir', // 即时渲染模式，预览更快
      lang: 'zh_CN',
      height: '100%',
      width: '100%',
      placeholder: '开始编写 Markdown...',
      icon: 'material',
      counter: { enable: true, type: 'text' },
      cache: { enable: false },
      preview: {
        delay: 0, // 设置为0，实时预览
        mode: 'both', // 默认显示编辑器和预览
        theme: { current: resolveTheme() === 'dark' ? 'dark' : 'light' },
        hljs: { lineNumber: true, style: resolveTheme() === 'dark' ? 'native' : 'github' },
        math: { engine: 'KaTeX' },
        markdown: {
          toc: true,
          autoSpace: true,
          fixTermTypo: true,
        },
      },
      toolbar: [
        'emoji',
        'headings',
        'bold',
        'italic',
        'strike',
        'link',
        '|',
        'list',
        'ordered-list',
        'check',
        'outdent',
        'indent',
        '|',
        'quote',
        'line',
        'code',
        'inline-code',
        'insert-before',
        'insert-after',
        '|',
        'upload',
        'table',
        '|',
        'undo',
        'redo',
        '|',
        'fullscreen',
        {
          name: 'more',
          toolbar: ['code-theme', 'content-theme', 'export', 'outline', 'devtools', 'info', 'help'],
        },
      ],
      toolbarConfig: { pin: true },
      outline: { enable: true, position: 'right' },
      input: (value: string) => {
        setIsDirty(true);
        setCharCount(value.length);
      },
      after: () => {
        // 编辑器就绪，默认显示分屏模式
        const val = vd.getValue();
        setCharCount(val.length);
        // 初始化时设置为分屏模式
        setEditorMode('split');
      },
    });

    vditorRef.current = vd;

    return () => {
      vd.destroy();
      vditorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // 主题切换
  useEffect(() => {
    if (!vditorRef.current) return;
    const t = resolveTheme();
    vditorRef.current.setTheme(
      t === 'dark' ? 'dark' : 'classic',
      t === 'dark' ? 'dark' : 'light',
      t === 'dark' ? 'native' : 'github'
    );
  }, [theme, resolveTheme]);

  // 编辑器模式切换
  useEffect(() => {
    if (!vditorRef.current) return;

    // 使用 DOM 操作切换预览模式
    const vditor = vditorRef.current;
    const container = vditor.vditor?.element;
    if (!container) return;

    // ir 模式使用 .vditor-ir，sv 模式使用 .vditor-sv
    const editorElement = container.querySelector('.vditor-ir') as HTMLElement;
    const previewElement = container.querySelector('.vditor-preview') as HTMLElement;

    if (!editorElement || !previewElement) return;

    if (editorMode === 'split') {
      // 分屏模式：显示编辑器和预览
      editorElement.style.display = 'block';
      editorElement.style.width = '50%';
      previewElement.style.display = 'block';
      previewElement.style.width = '50%';
    } else if (editorMode === 'preview') {
      // 仅预览模式
      editorElement.style.display = 'none';
      previewElement.style.display = 'block';
      previewElement.style.width = '100%';
    } else {
      // 所见即所得模式：隐藏预览
      editorElement.style.display = 'block';
      editorElement.style.width = '100%';
      previewElement.style.display = 'none';
    }
  }, [editorMode]);

  // ─── 操作 ─────────────────────────────────────────────────────

  const getMd = useCallback(() => vditorRef.current?.getValue() ?? '', []);
  const getHtml = useCallback(() => vditorRef.current?.getHTML() ?? '', []);

  const handleCopyMd = async () => {
    const md = getMd();
    if (!md.trim()) return;
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleModeToggle = (mode: EditorMode) => {
    setEditorMode(mode);
  };

  const handleClear = () => {
    if (isDirty && !window.confirm('确定要清空内容吗？')) return;
    vditorRef.current?.setValue('');
    setFileName('未命名文档.md');
    setIsDirty(false);
    setCharCount(0);
  };

  const handleSave = async () => {
    const md = getMd();
    if (!md.trim()) return;

    const filePath = await save({
      defaultPath: fileName,
      filters: [
        { name: 'Markdown 文件', extensions: ['md'] },
        { name: 'HTML 文件', extensions: ['html'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (!filePath) return;

    const isHtml = filePath.toLowerCase().endsWith('.html');
    const content = isHtml ? getHtml() : md;
    await writeTextFile(filePath, content);
    setFileName(filePath.split(/[\\/]/).pop() ?? filePath);
    setIsDirty(false);
  };

  const handleOpen = async () => {
    if (isDirty && !window.confirm('当前内容未保存，确定要打开新文件吗？')) return;

    const filePath = await open({
      filters: [
        { name: 'Markdown 文件', extensions: ['md', 'markdown', 'txt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (!filePath || Array.isArray(filePath)) return;

    const content = await readTextFile(filePath);
    vditorRef.current?.setValue(content);
    setFileName(filePath.split(/[\\/]/).pop() ?? filePath);
    setIsDirty(false);
    setCharCount(content.length);
  };

  const handleExportHtml = async () => {
    const html = getHtml();
    if (!html.trim()) return;

    const filePath = await save({
      defaultPath: fileName.replace(/\.md$/i, '.html'),
      filters: [{ name: 'HTML 文件', extensions: ['html'] }],
    });
    if (!filePath) return;

    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${fileName.replace(/\.md$/i, '')}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.8;color:#333}
pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow-x:auto}
code{background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:0.9em}
pre code{background:none;padding:0}
blockquote{border-left:4px solid #ddd;margin:0;padding:0 16px;color:#666}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ddd;padding:8px 12px}
th{background:#f6f8fa}
img{max-width:100%}
</style>
</head>
<body>
${html}
</body>
</html>`;
    await writeTextFile(filePath, fullHtml);
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-200/50 dark:border-gray-700/50">
      <ToolHeader
        icon="📄"
        title="Markdown 编辑器"
        subtitle={`${fileName}${isDirty ? ' · 未保存' : ''}${charCount > 0 ? ` · ${charCount} 字` : ''}`}
        closeMode="hide"
        actions={
          <>
          <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg mr-2">
            <button
              onClick={() => handleModeToggle('wysiwyg')}
              title="所见即所得"
              className={`p-1.5 rounded-md transition-colors ${
                editorMode === 'wysiwyg'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              <Code size={14} />
            </button>
            <button
              onClick={() => handleModeToggle('split')}
              title="左右分屏（源码 + 预览）"
              className={`p-1.5 rounded-md transition-colors ${
                editorMode === 'split'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              <Columns size={14} />
            </button>
            <button
              onClick={() => handleModeToggle('preview')}
              title="仅预览"
              className={`p-1.5 rounded-md transition-colors ${
                editorMode === 'preview'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              <Eye size={14} />
            </button>
          </div>

          <button
            onClick={handleOpen}
            title="打开文件"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <FolderOpen size={14} />
          </button>
          <button
            onClick={handleSave}
            title="保存"
            className={`p-1.5 rounded-lg transition-colors ${isDirty ? 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <Save size={14} />
          </button>
          <button
            onClick={handleExportHtml}
            title="导出 HTML"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <FileDown size={14} />
          </button>
          <button
            onClick={handleCopyMd}
            title="复制 Markdown"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          </button>
          <button
            onClick={handleClear}
            title="清空"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 size={14} />
          </button>
          </>
        }
      />

      {/* 编辑器主体 */}
      <div className="flex-1 min-h-0">
        <div ref={editorRef} className="h-full" />
      </div>
    </div>
  );
}
