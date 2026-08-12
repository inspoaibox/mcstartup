import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Clipboard, Download, RefreshCw, ShieldCheck } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { StatusMessage, ToolbarButton } from './systemToolUtils';

interface SystemInfoItem {
  label: string;
  value: string;
}

interface SystemInfoSection {
  title: string;
  items: SystemInfoItem[];
}

function downloadText(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string) {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (ch) => map[ch] || ch);
}

function maskValue(sectionTitle: string, label: string, value: string) {
  if (!value) return value;
  if (
    /mac|序列号|部分密钥|当前用户|用户名|产品密钥/i.test(label) ||
    (sectionTitle === '电脑' && label === '名称')
  ) {
    return value.replace(/[A-Za-z0-9]/g, (ch, index) => (index < Math.max(2, value.length - 4) ? '*' : ch));
  }
  return value
    .replace(/([0-9A-F]{2}[:-]){5}[0-9A-F]{2}/gi, '**:**:**:**:**:**')
    .replace(/([A-Z0-9]{5}-){4}[A-Z0-9]{5}/gi, '*****-*****-*****-*****-*****');
}

export default function SystemInfoTool() {
  const ready = useToolTheme();
  const [sections, setSections] = useState<SystemInfoSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('点击刷新读取系统信息。');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await invoke<SystemInfoSection[]>('system_info_overview');
      setSections(rows);
      setMessage('系统信息已刷新');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const text = useMemo(
    () =>
      sections
        .map((section) => [`[${section.title}]`, ...section.items.map((item) => `${item.label}: ${item.value}`)].join('\n'))
        .join('\n\n'),
    [sections],
  );
  const maskedText = useMemo(
    () =>
      sections
        .map((section) =>
          [`[${section.title}]`, ...section.items.map((item) => `${item.label}: ${maskValue(section.title, item.label, item.value)}`)].join('\n'),
        )
        .join('\n\n'),
    [sections],
  );

  const markdown = useMemo(
    () =>
      sections
        .map((section) => [`## ${section.title}`, '', ...section.items.map((item) => `- **${item.label}**：${item.value || '-'}`)].join('\n'))
        .join('\n\n'),
    [sections],
  );

  const html = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><title>系统信息</title><style>body{font-family:system-ui,Segoe UI,sans-serif;line-height:1.6;padding:24px}section{margin-bottom:24px}dt{font-weight:600}dd{margin:0 0 8px 0;font-family:Consolas,monospace}</style></head><body>${sections
        .map(
          (section) =>
            `<section><h2>${escapeHtml(section.title)}</h2><dl>${section.items
              .map((item) => `<dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value || '-')}</dd>`)
              .join('')}</dl></section>`,
        )
        .join('')}</body></html>`,
    [sections],
  );

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setMessage('已复制系统信息');
  };

  const copyMasked = async () => {
    await navigator.clipboard.writeText(maskedText);
    setMessage('已复制脱敏系统信息');
  };

  const exportReport = (format: 'md' | 'html' | 'json') => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    if (format === 'md') downloadText(`system-info-${stamp}.md`, markdown, 'text/markdown;charset=utf-8');
    if (format === 'html') downloadText(`system-info-${stamp}.html`, html, 'text/html;charset=utf-8');
    if (format === 'json') downloadText(`system-info-${stamp}.json`, JSON.stringify(sections, null, 2), 'application/json;charset=utf-8');
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="💻"
        title="系统信息"
        subtitle="查看操作系统、硬件、磁盘和网络适配器概要，支持复制为文本"
        actions={
          <>
            <ToolbarButton onClick={() => void copy()} disabled={!text}>
              <Clipboard size={14} />
              复制
            </ToolbarButton>
            <ToolbarButton onClick={() => void copyMasked()} disabled={!text}>
              <ShieldCheck size={14} />
              脱敏复制
            </ToolbarButton>
            <ToolbarButton onClick={() => exportReport('md')} disabled={!text}>
              <Download size={14} />
              MD
            </ToolbarButton>
            <ToolbarButton onClick={() => exportReport('html')} disabled={!text}>
              <Download size={14} />
              HTML
            </ToolbarButton>
            <ToolbarButton onClick={() => exportReport('json')} disabled={!text}>
              <Download size={14} />
              JSON
            </ToolbarButton>
            <ToolbarButton onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </ToolbarButton>
          </>
        }
      />
      <main className="min-h-0 flex-1 overflow-auto p-4">
        <StatusMessage message={message} error={error} />
        <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
          {sections.map((section) => (
            <section key={section.title} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="text-sm font-semibold">{section.title}</h2>
              <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                {section.items.map((item) => (
                  <div key={`${section.title}-${item.label}`} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2 text-sm">
                    <span className="text-gray-500">{item.label}</span>
                    <span className="min-w-0 break-words font-mono text-xs">{item.value || '-'}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
