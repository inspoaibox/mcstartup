import { useEffect, useRef, useState, useCallback } from 'react';
import { save, open } from '@tauri-apps/api/dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/api/fs';
import { X, Save, FolderOpen, Copy, Check, FileDown, Trash2, Code } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';
import { useSettingsStore } from '../stores/settingsStore';

// ─── postMessage 通信封装 ─────────────────────────────────────────

let requestIdCounter = 0;
function nextRequestId() {
  return `req_${++requestIdCounter}`;
}

// 获取 ueditor-host.html 的正确 URL
// 开发模式：http://127.0.0.1:1420/ueditor-host.html
// 生产模式：tauri://localhost/ueditor-host.html
function getHostUrl(): string {
  const loc = window.location;
  // 如果当前页面是 http(s)，说明是开发模式，直接用同源路径
  if (loc.protocol === 'http:' || loc.protocol === 'https:') {
    return `${loc.protocol}//${loc.host}/ueditor-host.html`;
  }
  // 生产模式：tauri://localhost 或 https://tauri.localhost
  return `${loc.protocol}//${loc.host}/ueditor-host.html`;
}

// ─── 主组件 ───────────────────────────────────────────────────────

export default function HtmlEditorTool() {
  const ready = useToolTheme();
  const theme = useSettingsStore((s) => s.theme);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [hostReady, setHostReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [sourceContent, setSourceContent] = useState('');
  const [fileName, setFileName] = useState('未命名文档');
  const [isDirty, setIsDirty] = useState(false);
  const pendingRequests = useRef<Map<string, (val: string) => void>>(new Map());

  // 向 iframe 发送消息
  const postToEditor = useCallback((msg: object) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*');
  }, []);


  const getHtml = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const id = nextRequestId();
      pendingRequests.current.set(id, resolve);
      postToEditor({ type: 'ueditor-get-html', requestId: id });
      setTimeout(() => {
        if (pendingRequests.current.has(id)) {
          pendingRequests.current.delete(id);
          resolve('');
        }
      }, 3000);
    });
  }, [postToEditor]);

  // 监听来自 iframe 的消息
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data?.type) return;

      switch (data.type) {
        case 'ueditor-host-ready':
          setHostReady(true);
          break;

        case 'ueditor-ready':
          setEditorReady(true);
          break;

        case 'ueditor-change':
          setIsDirty(true);
          break;

        case 'ueditor-content':
        case 'ueditor-html': {
          const cb = pendingRequests.current.get(data.requestId);
          if (cb) {
            pendingRequests.current.delete(data.requestId);
            cb(data.content ?? '');
          }
          break;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // host 就绪后初始化编辑器
  useEffect(() => {
    if (!hostReady) return;
    const resolvedTheme =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    postToEditor({ type: 'ueditor-init', theme: resolvedTheme });
  }, [hostReady, theme, postToEditor]);

  // 主题变化时同步
  useEffect(() => {
    if (!editorReady) return;
    const resolvedTheme =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    postToEditor({ type: 'ueditor-set-theme', theme: resolvedTheme });
  }, [theme, editorReady, postToEditor]);

  // ─── 操作 ─────────────────────────────────────────────────────

  const handleCopyHtml = async () => {
    const html = await getHtml();
    if (!html) return;
    await navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleViewSource = async () => {
    const html = await getHtml();
    setSourceContent(html);
    setShowSource(true);
  };

  const handleClear = () => {
    if (isDirty && !window.confirm('确定要清空内容吗？')) return;
    postToEditor({ type: 'ueditor-clear' });
    setFileName('未命名文档');
    setIsDirty(false);
  };

  const handleSave = async () => {
    const html = await getHtml();
    if (!html.trim()) return;

    const filePath = await save({
      defaultPath: fileName.endsWith('.html') ? fileName : `${fileName}.html`,
      filters: [
        { name: 'HTML 文件', extensions: ['html', 'htm'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (!filePath) return;

    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${fileName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
  </style>
</head>
<body>
${html}
</body>
</html>`;

    await writeTextFile(filePath, fullHtml);
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    setFileName(name);
    setIsDirty(false);
  };

  const handleOpen = async () => {
    if (isDirty && !window.confirm('当前内容未保存，确定要打开新文件吗？')) return;

    const filePath = await open({
      filters: [
        { name: 'HTML 文件', extensions: ['html', 'htm'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (!filePath || Array.isArray(filePath)) return;

    const content = await readTextFile(filePath);
    // 提取 body 内容
    const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1].trim() : content;

    postToEditor({ type: 'ueditor-set-content', content: bodyContent });
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    setFileName(name);
    setIsDirty(false);
  };

  const handleExportHtml = async () => {
    const html = await getHtml();
    if (!html.trim()) return;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.html') ? fileName : `${fileName}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-200/50 dark:border-gray-700/50">
      <ToolHeader
        icon="📝"
        title="HTML 编辑器"
        subtitle={`${fileName ? `${fileName}${isDirty ? ' · 未保存' : ''}` : ''}${!editorReady ? '加载中...' : ''}` || undefined}
        closeMode="hide"
        actions={
          <>
          <button
            onClick={handleOpen}
            title="打开文件"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <FolderOpen size={14} />
          </button>

          {/* 保存 */}
          <button
            onClick={handleSave}
            title="保存为 HTML 文件"
            className={`p-1.5 rounded-lg transition-colors ${
              isDirty
                ? 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <Save size={14} />
          </button>

          {/* 导出 HTML 片段 */}
          <button
            onClick={handleExportHtml}
            title="导出 HTML 片段"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <FileDown size={14} />
          </button>

          {/* 查看源码 */}
          <button
            onClick={handleViewSource}
            title="查看 HTML 源码"
            className={`p-1.5 rounded-lg transition-colors ${
              showSource
                ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <Code size={14} />
          </button>

          {/* 复制 HTML */}
          <button
            onClick={handleCopyHtml}
            title="复制 HTML 代码"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          </button>

          {/* 清空 */}
          <button
            onClick={handleClear}
            title="清空内容"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 size={14} />
          </button>
          </>
        }
      />

      {/* 编辑器主体 */}
      <div className="flex-1 flex min-h-0">
        {/* UEditor iframe */}
        <div className={`flex-1 min-h-0 ${showSource ? 'w-1/2' : 'w-full'}`}>
          <iframe
            ref={iframeRef}
            src={getHostUrl()}
            className="w-full h-full border-0"
            title="HTML Editor"
          />
        </div>

        {/* 源码预览面板 */}
        {showSource && (
          <div className="w-1/2 border-l border-gray-200 dark:border-gray-700 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                HTML 源码
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={async () => {
                    const html = await getHtml();
                    setSourceContent(html);
                  }}
                  className="text-xs text-gray-400 hover:text-blue-500 transition-colors px-1.5 py-0.5 rounded"
                >
                  刷新
                </button>
                <button
                  onClick={() => setShowSource(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-3 text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 whitespace-pre-wrap break-all">
              {sourceContent || <span className="text-gray-400">（空）</span>}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
