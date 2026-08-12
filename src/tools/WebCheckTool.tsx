import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  Activity,
  AlertTriangle,
  Cookie,
  ExternalLink,
  Globe2,
  Link2,
  Lock,
  Play,
  Radar,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { StatusMessage, ToolbarButton } from './systemToolUtils';

interface WebCheckHeader {
  name: string;
  value: string;
}

interface WebCheckCookie {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string | null;
}

interface WebCheckSecurityHeader {
  name: string;
  present: boolean;
  value?: string | null;
  severity: string;
  note: string;
}

interface WebCheckDnsGroup {
  recordType: string;
  values: string[];
}

interface WebCheckRedirect {
  from: string;
  to: string;
  status: number;
}

interface WebCheckPort {
  port: number;
  service?: string | null;
}

interface WebCheckProbe {
  url: string;
  status?: number | null;
  exists: boolean;
  size: number;
}

interface WebCheckTechnology {
  name: string;
  evidence: string;
}

interface WebCheckLinks {
  total: number;
  internal: number;
  external: number;
  samples: string[];
}

interface WebCheckResult {
  input: string;
  normalizedUrl: string;
  host: string;
  scheme: string;
  status?: number | null;
  statusText: string;
  finalUrl: string;
  responseTimeMs: number;
  bodySize: number;
  pageTitle?: string | null;
  description?: string | null;
  canonical?: string | null;
  server?: string | null;
  poweredBy?: string | null;
  ipAddresses: string[];
  dns: WebCheckDnsGroup[];
  redirects: WebCheckRedirect[];
  headers: WebCheckHeader[];
  cookies: WebCheckCookie[];
  securityHeaders: WebCheckSecurityHeader[];
  openPorts: WebCheckPort[];
  links: WebCheckLinks;
  technologies: WebCheckTechnology[];
  robotsTxt: WebCheckProbe;
  sitemap: WebCheckProbe;
  score: number;
  warnings: string[];
}

type ViewTab = 'overview' | 'security' | 'network' | 'page' | 'headers';

const TABS: Array<[ViewTab, string]> = [
  ['overview', '概览'],
  ['security', '安全'],
  ['network', '网络'],
  ['page', '页面'],
  ['headers', 'Headers'],
];

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function scoreTone(score: number) {
  if (score >= 80) return 'text-green-600 dark:text-green-300';
  if (score >= 55) return 'text-amber-600 dark:text-amber-300';
  return 'text-red-600 dark:text-red-300';
}

export default function WebCheckTool() {
  const ready = useToolTheme();
  const [url, setUrl] = useState('https://example.com');
  const [scanPorts, setScanPorts] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('输入网站地址后开始体检。');
  const [error, setError] = useState('');
  const [result, setResult] = useState<WebCheckResult | null>(null);
  const [tab, setTab] = useState<ViewTab>('overview');

  const missingSecurity = useMemo(
    () => result?.securityHeaders.filter((item) => !item.present) || [],
    [result]
  );

  const runCheck = async () => {
    const input = url.trim();
    if (!input) {
      setError('请输入网站 URL');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('正在检测网站、DNS、安全头和页面结构...');
    try {
      const data = await invoke<WebCheckResult>('web_check_scan', {
        input,
        scanPorts,
      });
      setResult(data);
      setMessage(`检测完成：${data.host}`);
      setTab('overview');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🩺"
        title="Web Check 网站体检"
        subtitle="参考 web-check 的网站 OSINT 流程，聚合 HTTP、DNS、安全头、Cookie、端口和页面信号"
        actions={
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={runCheck} disabled={loading}>
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
              {loading ? '检测中' : '开始检测'}
            </ToolbarButton>
          </div>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[330px_minmax(0,1fr)] gap-3 p-4 max-lg:grid-cols-1">
        <aside className="flex min-h-0 flex-col gap-3 overflow-auto">
          <StatusMessage message={message} error={error} />

          <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Globe2 size={15} />
              检测目标
            </div>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runCheck();
              }}
              className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              placeholder="https://example.com"
            />
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={scanPorts}
                onChange={(event) => setScanPorts(event.target.checked)}
              />
              扫描常见 Web/服务端口
            </label>
          </section>

          {result && (
            <>
              <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-gray-500">综合得分</div>
                    <div className={`mt-1 text-4xl font-semibold ${scoreTone(result.score)}`}>
                      {result.score}
                    </div>
                  </div>
                  <ShieldCheck size={38} className={scoreTone(result.score)} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <MiniMetric label="状态码" value={result.status ? String(result.status) : '-'} />
                  <MiniMetric label="耗时" value={`${result.responseTimeMs} ms`} />
                  <MiniMetric label="页面大小" value={formatBytes(result.bodySize)} />
                  <MiniMetric label="风险项" value={String(result.warnings.length)} />
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle size={15} />
                  风险摘要
                </div>
                <div className="mt-3 space-y-2">
                  {result.warnings.length ? (
                    result.warnings.slice(0, 8).map((warning) => (
                      <div
                        key={warning}
                        className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
                      >
                        {warning}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-200">
                      暂未发现明显风险。
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </aside>

        <section className="flex min-h-0 flex-col gap-3 overflow-hidden">
          {result ? (
            <>
              <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Activity size={15} />
                      {result.host}
                    </div>
                    <div className="mt-1 truncate text-xs text-gray-500" title={result.finalUrl}>
                      {result.finalUrl}
                    </div>
                  </div>
                  <a
                    href={result.finalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <ExternalLink size={14} />
                    打开
                  </a>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {TABS.map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      className={`rounded-lg border px-3 py-1.5 text-xs ${
                        tab === key
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                {tab === 'overview' && <OverviewPanel result={result} />}
                {tab === 'security' && (
                  <SecurityPanel result={result} missingSecurity={missingSecurity} />
                )}
                {tab === 'network' && <NetworkPanel result={result} />}
                {tab === 'page' && <PagePanel result={result} />}
                {tab === 'headers' && <HeadersPanel result={result} />}
              </section>
            </>
          ) : (
            <section className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white text-gray-400 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-center">
                <Radar size={42} className="mx-auto" />
                <div className="mt-3 text-sm">等待检测网站</div>
              </div>
            </section>
          )}
        </section>
      </main>
    </div>
  );
}

function OverviewPanel({ result }: { result: WebCheckResult }) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <InfoCard title="页面信息" icon={<Globe2 size={15} />}>
        <InfoRow label="标题" value={result.pageTitle || '-'} />
        <InfoRow label="描述" value={result.description || '-'} />
        <InfoRow label="Canonical" value={result.canonical || '-'} />
        <InfoRow label="Server" value={result.server || '-'} />
        <InfoRow label="X-Powered-By" value={result.poweredBy || '-'} />
      </InfoCard>
      <InfoCard title="重定向链" icon={<RefreshCw size={15} />}>
        {result.redirects.length ? (
          <div className="space-y-2">
            {result.redirects.map((item) => (
              <div
                key={`${item.status}-${item.from}`}
                className="rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-950"
              >
                <div className="font-mono text-amber-600 dark:text-amber-300">{item.status}</div>
                <div className="truncate" title={item.from}>
                  {item.from}
                </div>
                <div className="truncate text-gray-500" title={item.to}>
                  {item.to}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine text="没有重定向" />
        )}
      </InfoCard>
      <InfoCard title="技术栈" icon={<Server size={15} />}>
        <TagList items={result.technologies.map((item) => `${item.name} · ${item.evidence}`)} />
      </InfoCard>
      <InfoCard title="站点文件" icon={<Link2 size={15} />}>
        <InfoRow
          label="robots.txt"
          value={`${result.robotsTxt.exists ? '存在' : '未发现'} · ${result.robotsTxt.status || '-'}`}
        />
        <InfoRow
          label="sitemap.xml"
          value={`${result.sitemap.exists ? '存在' : '未发现'} · ${result.sitemap.status || '-'}`}
        />
      </InfoCard>
    </div>
  );
}

function SecurityPanel({
  result,
  missingSecurity,
}: {
  result: WebCheckResult;
  missingSecurity: WebCheckSecurityHeader[];
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <InfoCard title="安全响应头" icon={<Lock size={15} />}>
        <div className="space-y-2">
          {result.securityHeaders.map((item) => (
            <div key={item.name} className="rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-950">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono">{item.name}</span>
                <span
                  className={
                    item.present
                      ? 'text-green-600 dark:text-green-300'
                      : 'text-red-600 dark:text-red-300'
                  }
                >
                  {item.present ? '存在' : '缺失'}
                </span>
              </div>
              <div className="mt-1 truncate text-gray-500" title={item.value || item.note}>
                {item.value || item.note}
              </div>
            </div>
          ))}
        </div>
      </InfoCard>
      <InfoCard title="Cookie" icon={<Cookie size={15} />}>
        {result.cookies.length ? (
          <div className="space-y-2">
            {result.cookies.map((item) => (
              <div key={item.name} className="rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-950">
                <div className="font-mono">{item.name}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-gray-500">
                  <span>Secure: {item.secure ? '是' : '否'}</span>
                  <span>HttpOnly: {item.httpOnly ? '是' : '否'}</span>
                  <span>SameSite: {item.sameSite || '-'}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine text="响应未设置 Cookie" />
        )}
      </InfoCard>
      <InfoCard title="缺失项" icon={<AlertTriangle size={15} />}>
        <TagList items={missingSecurity.map((item) => item.name)} />
      </InfoCard>
    </div>
  );
}

function NetworkPanel({ result }: { result: WebCheckResult }) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <InfoCard title="IP 地址" icon={<Globe2 size={15} />}>
        <TagList items={result.ipAddresses} />
      </InfoCard>
      <InfoCard title="开放端口" icon={<Server size={15} />}>
        <TagList
          items={result.openPorts.map(
            (item) => `${item.port}${item.service ? ` · ${item.service}` : ''}`
          )}
        />
      </InfoCard>
      <InfoCard title="DNS 记录" icon={<Radar size={15} />}>
        <div className="space-y-3">
          {result.dns.map((group) => (
            <div key={group.recordType}>
              <div className="mb-1 text-xs font-semibold">{group.recordType}</div>
              <TagList items={group.values.slice(0, 12)} />
            </div>
          ))}
          {!result.dns.length && <EmptyLine text="没有读取到 DNS 记录" />}
        </div>
      </InfoCard>
    </div>
  );
}

function PagePanel({ result }: { result: WebCheckResult }) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <InfoCard title="链接统计" icon={<Link2 size={15} />}>
        <InfoRow label="总链接" value={String(result.links.total)} />
        <InfoRow label="站内链接" value={String(result.links.internal)} />
        <InfoRow label="外部链接" value={String(result.links.external)} />
      </InfoCard>
      <InfoCard title="链接样本" icon={<ExternalLink size={15} />}>
        <TagList items={result.links.samples} />
      </InfoCard>
    </div>
  );
}

function HeadersPanel({ result }: { result: WebCheckResult }) {
  return (
    <div className="space-y-2">
      {result.headers.map((header) => (
        <div
          key={`${header.name}-${header.value}`}
          className="grid gap-2 rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-950 md:grid-cols-[220px_minmax(0,1fr)]"
        >
          <div className="font-mono text-blue-600 dark:text-blue-300">{header.name}</div>
          <div className="break-all font-mono text-gray-600 dark:text-gray-300">{header.value}</div>
        </div>
      ))}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-1.5 dark:bg-gray-950">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="truncate font-mono">{value}</div>
    </div>
  );
}

function InfoCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 border-t border-gray-100 py-2 text-xs first:border-t-0 dark:border-gray-800 md:grid-cols-[120px_minmax(0,1fr)]">
      <div className="text-gray-500">{label}</div>
      <div className="break-words font-mono">{value}</div>
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (!items.length) return <EmptyLine text="暂无数据" />;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="max-w-full truncate rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          title={item}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400 dark:bg-gray-950">
      {text}
    </div>
  );
}
