import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { AlertTriangle, CheckCircle2, FolderOpen, Play, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

interface HostsFile {
  path: string;
  content: string;
  writable: boolean;
  requiresAdmin: boolean;
}

interface HostsResolveResult {
  domain: string;
  hostsIp: string;
  dnsIps: string[];
  raw: string;
}

interface HostsScheme {
  id: string;
  name: string;
  content: string;
  createdAt: string;
}

interface HostsIssue {
  line: number;
  message: string;
  severity: 'error' | 'warning';
}

const SCHEME_KEY = 'mcstartup.hostsEditor.schemes';

function loadSchemes(): HostsScheme[] {
  try {
    return JSON.parse(localStorage.getItem(SCHEME_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveSchemes(rows: HostsScheme[]) {
  localStorage.setItem(SCHEME_KEY, JSON.stringify(rows));
}

function isIpAddress(value: string) {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return value.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
  }
  return /^[0-9a-f:]+$/i.test(value) && value.includes(':');
}

function isDomain(value: string) {
  const domain = value.trim().replace(/\.+$/, '');
  if (!domain || domain.length > 253 || domain.includes(' ')) return false;
  return domain.split('.').every((part) => part.length > 0 && part.length <= 63 && /^[a-z0-9-]+$/i.test(part));
}

function analyzeHosts(content: string) {
  const issues: HostsIssue[] = [];
  const domainLines = new Map<string, number[]>();
  const groups = new Map<string, number>();
  let group = '默认';

  content.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/^#\s*@?group\s+(.+)$/i) || trimmed.match(/^#\s*\[(.+)]\s*$/);
      if (match?.[1]) group = match[1].trim();
      return;
    }

    const body = line.split('#')[0].trim();
    const parts = body.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      issues.push({ line: lineNumber, severity: 'warning', message: '缺少域名，Hosts 记录通常需要 IP + 域名' });
      return;
    }
    if (!isIpAddress(parts[0])) {
      issues.push({ line: lineNumber, severity: 'error', message: `IP 地址格式异常：${parts[0]}` });
    }
    for (const domain of parts.slice(1)) {
      if (!isDomain(domain)) {
        issues.push({ line: lineNumber, severity: 'error', message: `域名格式异常：${domain}` });
        continue;
      }
      const key = domain.toLowerCase().replace(/\.+$/, '');
      domainLines.set(key, [...(domainLines.get(key) || []), lineNumber]);
    }
    groups.set(group, (groups.get(group) || 0) + parts.length - 1);
  });

  for (const [domain, lines] of domainLines) {
    if (lines.length > 1) {
      issues.push({ line: lines[0], severity: 'warning', message: `域名 ${domain} 重复出现在第 ${lines.join('、')} 行` });
    }
  }

  return {
    issues: issues.sort((a, b) => a.line - b.line),
    groups: [...groups.entries()].map(([name, count]) => ({ name, count })),
    domainCount: domainLines.size,
  };
}

export default function HostsEditorTool() {
  const ready = useToolTheme();
  const [file, setFile] = useState<HostsFile | null>(null);
  const [content, setContent] = useState('');
  const [schemes, setSchemes] = useState<HostsScheme[]>(loadSchemes);
  const [resolveDomain, setResolveDomain] = useState('');
  const [resolveResult, setResolveResult] = useState<HostsResolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const changed = useMemo(() => file !== null && file.content !== content, [content, file]);
  const analysis = useMemo(() => analyzeHosts(content), [content]);
  const hasErrors = analysis.issues.some((item) => item.severity === 'error');

  const loadHosts = useCallback(async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await invoke<HostsFile>('system_hosts_read');
      setFile(result);
      setContent(result.content);
      setMessage(result.requiresAdmin ? 'Hosts 文件需要管理员权限保存' : 'Hosts 文件可直接保存');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHosts();
  }, [loadHosts]);

  const saveHosts = async (admin = false) => {
    if (hasErrors && !window.confirm('当前 Hosts 存在语法错误，仍要保存吗？')) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await invoke<HostsFile>(admin ? 'system_hosts_save_admin' : 'system_hosts_save', { content });
      setFile(result);
      setContent(result.content);
      setMessage(admin ? '已通过管理员权限保存 Hosts' : 'Hosts 已保存');
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveScheme = () => {
    const name = window.prompt('方案名称', `Hosts 方案 ${schemes.length + 1}`)?.trim();
    if (!name) return;
    const next = [{ id: crypto.randomUUID(), name, content, createdAt: new Date().toLocaleString() }, ...schemes].slice(0, 20);
    setSchemes(next);
    saveSchemes(next);
    setMessage(`已保存方案：${name}`);
  };

  const applyScheme = (scheme: HostsScheme) => {
    if (changed && !window.confirm('当前内容未保存，确定切换方案吗？')) return;
    setContent(scheme.content);
    setMessage(`已切换到方案：${scheme.name}，保存后才会写入系统 Hosts`);
  };

  const removeScheme = (id: string) => {
    const next = schemes.filter((item) => item.id !== id);
    setSchemes(next);
    saveSchemes(next);
  };

  const addGroup = () => {
    const name = window.prompt('分组名称', '开发环境')?.trim();
    if (!name) return;
    setContent((current) => `${current.trimEnd()}\r\n\r\n# @group ${name}\r\n`);
  };

  const testResolve = async () => {
    setError('');
    setResolveResult(null);
    try {
      const result = await invoke<HostsResolveResult>('system_hosts_resolve', { domain: resolveDomain });
      setResolveResult(result);
    } catch (err) {
      setError(String(err));
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🧩"
        title="Hosts 编辑"
        subtitle={file?.path || 'Windows Hosts 文件'}
        actions={
          <>
            <button
              onClick={() => void invoke('system_hosts_open_dir')}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <FolderOpen size={14} />
              目录
            </button>
            <button
              onClick={() => void loadHosts()}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <aside className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          {(message || error) && (
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                error
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                  : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
              }`}
            >
              {error || message}
            </div>
          )}

          <section className="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">语法校验</div>
              <span className={`text-xs ${hasErrors ? 'text-red-600' : 'text-green-600'}`}>
                {analysis.issues.length ? `${analysis.issues.length} 条提示` : '正常'}
              </span>
            </div>
            <div className="mt-2 text-xs text-gray-500">域名 {analysis.domainCount} 个</div>
            <div className="mt-3 max-h-44 space-y-2 overflow-auto">
              {analysis.issues.map((issue, index) => (
                <div key={`${issue.line}-${index}`} className="flex gap-2 text-xs leading-5">
                  {issue.severity === 'error' ? (
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />
                  ) : (
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                  )}
                  <span>
                    第 {issue.line} 行：{issue.message}
                  </span>
                </div>
              ))}
              {analysis.issues.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-green-600">
                  <CheckCircle2 size={14} />
                  未发现语法错误或重复域名
                </div>
              )}
            </div>
          </section>

          <section className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">分组</div>
              <button onClick={addGroup} className="inline-flex h-7 items-center gap-1 rounded-lg border border-gray-200 px-2 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                <Plus size={13} />
                新增
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {analysis.groups.map((group) => (
                <span key={group.name} className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
                  {group.name} · {group.count}
                </span>
              ))}
            </div>
          </section>

          <section className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Hosts 方案</div>
              <button onClick={saveScheme} className="inline-flex h-7 items-center gap-1 rounded-lg border border-gray-200 px-2 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                <Save size={13} />
                保存方案
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {schemes.map((scheme) => (
                <div key={scheme.id} className="rounded-lg bg-gray-50 p-2 dark:bg-gray-950">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{scheme.name}</div>
                      <div className="text-xs text-gray-500">{scheme.createdAt}</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => applyScheme(scheme)} className="h-7 rounded-lg bg-blue-600 px-2 text-xs font-medium text-white">
                        切换
                      </button>
                      <button onClick={() => removeScheme(scheme.id)} className="h-7 rounded-lg border border-red-200 px-2 text-red-600 hover:bg-red-50 dark:border-red-900/50">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {schemes.length === 0 && <div className="text-xs text-gray-400">暂无方案，可把当前内容保存为方案。</div>}
            </div>
          </section>

          <section className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="text-sm font-semibold">域名解析测试</div>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <input
                value={resolveDomain}
                onChange={(event) => setResolveDomain(event.target.value)}
                placeholder="example.com"
                className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              />
              <button onClick={() => void testResolve()} className="inline-flex h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white">
                <Play size={13} />
                测试
              </button>
            </div>
            {resolveResult && (
              <div className="mt-2 rounded-lg bg-gray-50 p-2 text-xs leading-5 dark:bg-gray-950">
                <div>Hosts：{resolveResult.hostsIp || '未命中'}</div>
                <div>DNS：{resolveResult.dnsIps.join(', ') || '无结果'}</div>
              </div>
            )}
          </section>
        </aside>

        <section className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-lg border border-gray-200 bg-white p-4 font-mono text-sm leading-6 outline-none focus:border-blue-500 dark:border-gray-800 dark:bg-gray-950"
            placeholder="127.0.0.1 localhost"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {changed ? '内容已修改，保存后生效' : '当前内容未修改'}
              {hasErrors ? ' · 存在语法错误' : ''}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void saveHosts(false)}
                disabled={saving || !changed}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Save size={16} />
                保存
              </button>
              <button
                onClick={() => void saveHosts(true)}
                disabled={saving || !changed}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-black disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
              >
                <ShieldCheck size={16} />
                管理员保存
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
