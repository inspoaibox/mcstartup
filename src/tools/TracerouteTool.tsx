import { useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  Activity,
  BarChart3,
  Clock,
  Copy,
  Download,
  MapPin,
  Play,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  Square,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { EmptyState, StatusMessage, ToolbarButton } from './systemToolUtils';

interface TracerouteHop {
  hop: number;
  ip: string | null;
  hostname: string | null;
  latencies: Array<number | null>;
  latency: number | null;
  bestLatency: number | null;
  worstLatency: number | null;
  jitter: number | null;
  packetLoss: number;
  timeout: boolean;
  rawLine: string;
}

interface TracerouteResult {
  target: string;
  resolvedIp: string | null;
  hops: TracerouteHop[];
  rawOutput: string;
  command: string;
  reached: boolean;
  totalHops: number;
  timeoutCount: number;
  avgLatency: number | null;
  maxLatency: number | null;
}

interface MtrHopStats {
  hop: number;
  ip: string | null;
  hostname: string | null;
  sent: number;
  received: number;
  loss: number;
  best: number | null;
  avg: number | null;
  worst: number | null;
  jitter: number | null;
  last: number | null;
}

const PRESETS = [
  { name: '百度', host: 'www.baidu.com' },
  { name: '腾讯', host: 'www.qq.com' },
  { name: 'GitHub', host: 'github.com' },
  { name: 'Cloudflare', host: '1.1.1.1' },
  { name: 'Google DNS', host: '8.8.8.8' },
  { name: 'OpenAI', host: 'api.openai.com' },
];

const EMPTY_RESULT: TracerouteResult = {
  target: '',
  resolvedIp: null,
  hops: [],
  rawOutput: '',
  command: '',
  reached: false,
  totalHops: 0,
  timeoutCount: 0,
  avgLatency: null,
  maxLatency: null,
};

function formatLatency(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function latencyColor(value: number | null) {
  if (value === null) return 'text-gray-400';
  if (value < 50) return 'text-green-600 dark:text-green-300';
  if (value < 120) return 'text-blue-600 dark:text-blue-300';
  if (value < 250) return 'text-amber-600 dark:text-amber-300';
  return 'text-red-600 dark:text-red-300';
}

function hopHealth(hop: TracerouteHop) {
  if (hop.timeout || hop.packetLoss >= 100) return '超时';
  if (hop.packetLoss > 0) return '丢包';
  if ((hop.jitter || 0) > 80) return '抖动';
  if ((hop.latency || 0) > 250) return '高延迟';
  return '正常';
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildMtrStats(rounds: TracerouteResult[]): MtrHopStats[] {
  const map = new Map<number, MtrHopStats & { samples: number[] }>();
  rounds.forEach((round) => {
    round.hops.forEach((hop) => {
      const row =
        map.get(hop.hop) ||
        ({
          hop: hop.hop,
          ip: hop.ip,
          hostname: hop.hostname,
          sent: 0,
          received: 0,
          loss: 0,
          best: null,
          avg: null,
          worst: null,
          jitter: null,
          last: null,
          samples: [],
        } as MtrHopStats & { samples: number[] });
      row.ip = hop.ip || row.ip;
      row.hostname = hop.hostname || row.hostname;
      row.sent += Math.max(hop.latencies.length, 1);
      const samples = hop.latencies.filter((value): value is number => value !== null);
      row.received += samples.length;
      row.samples.push(...samples);
      row.last = samples.at(-1) ?? row.last;
      map.set(hop.hop, row);
    });
  });
  return Array.from(map.values())
    .map((row) => {
      row.best = row.samples.length ? Math.min(...row.samples) : null;
      row.worst = row.samples.length ? Math.max(...row.samples) : null;
      row.avg = average(row.samples);
      row.jitter = row.best !== null && row.worst !== null ? row.worst - row.best : null;
      row.loss = row.sent > 0 ? ((row.sent - row.received) / row.sent) * 100 : 0;
      const clean: MtrHopStats = {
        hop: row.hop,
        ip: row.ip,
        hostname: row.hostname,
        sent: row.sent,
        received: row.received,
        loss: row.loss,
        best: row.best,
        avg: row.avg,
        worst: row.worst,
        jitter: row.jitter,
        last: row.last,
      };
      return clean;
    })
    .sort((a, b) => a.hop - b.hop);
}

export default function TracerouteTool() {
  const ready = useToolTheme();
  const tracingRef = useRef(false);
  const [target, setTarget] = useState('www.baidu.com');
  const [maxHops, setMaxHops] = useState(30);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [rounds, setRounds] = useState(3);
  const [mode, setMode] = useState<'single' | 'mtr'>('single');
  const [tab, setTab] = useState<'route' | 'mtr' | 'raw'>('route');
  const [tracing, setTracing] = useState(false);
  const [result, setResult] = useState<TracerouteResult>(EMPTY_RESULT);
  const [history, setHistory] = useState<TracerouteResult[]>([]);
  const [message, setMessage] = useState('输入域名或 IP 后开始追踪。');
  const [error, setError] = useState('');

  const mtrStats = useMemo(() => buildMtrStats(history), [history]);
  const maxDisplayLatency = Math.max(1, ...result.hops.map((hop) => hop.worstLatency || hop.latency || 0));

  const runTrace = async () => {
    return await invoke<TracerouteResult>('network_traceroute', {
      host: target.trim(),
      maxHops,
      timeoutMs,
    });
  };

  const handleStart = async () => {
    if (!target.trim()) {
      setError('请输入目标地址');
      return;
    }
    tracingRef.current = true;
    setTracing(true);
    setError('');
    setMessage(mode === 'mtr' ? 'MTR 追踪中...' : '路由追踪中...');
    setResult(EMPTY_RESULT);
    setHistory([]);
    try {
      const totalRounds = mode === 'mtr' ? Math.max(1, Math.min(rounds, 20)) : 1;
      const nextHistory: TracerouteResult[] = [];
      for (let index = 0; index < totalRounds; index += 1) {
        if (!tracingRef.current) break;
        setMessage(totalRounds > 1 ? `正在进行第 ${index + 1} / ${totalRounds} 轮追踪...` : '路由追踪中...');
        const next = await runTrace();
        if (!tracingRef.current) break;
        nextHistory.push(next);
        setResult(next);
        setHistory([...nextHistory]);
      }
      if (tracingRef.current && nextHistory.length > 0) {
        const last = nextHistory[nextHistory.length - 1];
        setMessage(`完成：${last.totalHops} 跳，${last.timeoutCount} 跳超时，目标 ${last.reached ? '已到达' : '未确认到达'}`);
        setTab(mode === 'mtr' ? 'mtr' : 'route');
      }
    } catch (err) {
      if (tracingRef.current) setError(String(err));
    } finally {
      setTracing(false);
      tracingRef.current = false;
    }
  };

  const handleStop = () => {
    tracingRef.current = false;
    setTracing(false);
    setMessage('已停止追踪。');
  };

  const copySummary = async () => {
    const lines = [
      `Target: ${result.target}${result.resolvedIp ? ` (${result.resolvedIp})` : ''}`,
      `Command: ${result.command}`,
      `Hops: ${result.totalHops}, Timeouts: ${result.timeoutCount}, Avg: ${formatLatency(result.avgLatency)}`,
      '',
      ...result.hops.map((hop) => {
        const probes = hop.latencies.map((value) => formatLatency(value)).join(' / ');
        return `${hop.hop}. ${hop.ip || '*'} ${probes} loss=${formatPercent(hop.packetLoss)} ${hop.rawLine}`;
      }),
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    setMessage('已复制路由摘要。');
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ result, history, mtrStats }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `traceroute-${result.target || target}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🗺️"
        title="Traceroute 路由追踪"
        subtitle="路由路径、每跳探测、丢包、抖动和 MTR 多轮统计"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton onClick={() => void copySummary()} disabled={!result.hops.length}>
              <Copy size={14} />
              复制
            </ToolbarButton>
            <ToolbarButton onClick={exportJson} disabled={!result.hops.length}>
              <Download size={14} />
              导出
            </ToolbarButton>
          </div>
        }
      />
      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <StatusMessage message={message} error={error} />

        <section className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Search size={16} />
              目标与参数
            </div>
            <div className="mt-3 space-y-3">
              <input
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && !tracing && void handleStart()}
                disabled={tracing}
                placeholder="域名或 IP 地址"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              />
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((item) => (
                  <button
                    key={item.host}
                    onClick={() => setTarget(item.host)}
                    disabled={tracing}
                    className="rounded-md bg-gray-100 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    {item.name}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="模式">
                  <select
                    value={mode}
                    onChange={(event) => setMode(event.target.value as 'single' | 'mtr')}
                    disabled={tracing}
                    className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                  >
                    <option value="single">单次追踪</option>
                    <option value="mtr">MTR 多轮</option>
                  </select>
                </Field>
                <Field label="MTR 轮数">
                  <input
                    type="number"
                    value={rounds}
                    onChange={(event) => setRounds(Math.min(Math.max(Number(event.target.value) || 3, 1), 20))}
                    disabled={tracing || mode !== 'mtr'}
                    className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                  />
                </Field>
                <Field label="最大跳数">
                  <input
                    type="number"
                    value={maxHops}
                    onChange={(event) => setMaxHops(Math.min(Math.max(Number(event.target.value) || 30, 1), 64))}
                    disabled={tracing}
                    className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                  />
                </Field>
                <Field label="超时 ms">
                  <input
                    type="number"
                    value={timeoutMs}
                    onChange={(event) => setTimeoutMs(Math.min(Math.max(Number(event.target.value) || 5000, 1000), 30000))}
                    disabled={tracing}
                    className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
                  />
                </Field>
              </div>
              <button
                onClick={tracing ? handleStop : () => void handleStart()}
                className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white ${
                  tracing ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {tracing ? <Square size={17} /> : <Play size={17} />}
                {tracing ? '停止追踪' : '开始追踪'}
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={<MapPin size={15} />} label="目标" value={result.resolvedIp || result.target || target} sub={result.command || '等待追踪'} />
            <Metric icon={<Activity size={15} />} label="跳数" value={`${result.totalHops || 0}`} sub={`${result.timeoutCount || 0} 跳超时`} />
            <Metric icon={<Clock size={15} />} label="平均延迟" value={formatLatency(result.avgLatency)} sub={`最高 ${formatLatency(result.maxLatency)}`} />
            <Metric icon={<ShieldAlert size={15} />} label="状态" value={result.reached ? '已到达' : result.hops.length ? '未确认' : '-'} sub={mode === 'mtr' ? `${history.length} 轮统计` : '单次追踪'} />
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-2">
          {[
            ['route', '路由明细'],
            ['mtr', 'MTR 统计'],
            ['raw', '原始输出'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key as 'route' | 'mtr' | 'raw')}
              className={`rounded-lg border px-3 py-2 text-sm ${
                tab === key
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                  : 'border-gray-200 bg-white hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
          {tracing && (
            <div className="ml-auto flex items-center gap-2 text-sm text-blue-600 dark:text-blue-300">
              <RotateCcw size={15} className="animate-spin" />
              追踪中
            </div>
          )}
        </section>

        <section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {tab === 'route' && <RouteTable hops={result.hops} maxLatency={maxDisplayLatency} />}
          {tab === 'mtr' && <MtrTable rows={mtrStats} />}
          {tab === 'raw' && <RawOutput result={result} />}
        </section>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function Metric({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-semibold" title={value}>
        {value}
      </div>
      <div className="mt-1 truncate text-xs text-gray-500" title={sub}>
        {sub}
      </div>
    </div>
  );
}

function RouteTable({ hops, maxLatency }: { hops: TracerouteHop[]; maxLatency: number }) {
  if (!hops.length) return <EmptyState icon={<Server size={32} />} text="点击开始追踪查看路由路径" />;
  return (
    <div className="h-full overflow-auto">
      <div className="grid min-w-[1220px] grid-cols-[70px_210px_210px_150px_120px_120px_120px_minmax(220px,1fr)] border-b border-gray-200 px-4 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
        <span>跳</span>
        <span>IP / 主机</span>
        <span>三次探测</span>
        <span>平均</span>
        <span>丢包</span>
        <span>抖动</span>
        <span>状态</span>
        <span>延迟分布</span>
      </div>
      {hops.map((hop) => (
        <div
          key={hop.hop}
          className="grid min-w-[1220px] grid-cols-[70px_210px_210px_150px_120px_120px_120px_minmax(220px,1fr)] items-center border-b border-gray-100 px-4 py-3 text-sm dark:border-gray-800"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
            {hop.hop}
          </span>
          <div className="min-w-0">
            <div className="truncate font-mono text-xs font-semibold" title={hop.ip || ''}>
              {hop.ip || '*'}
            </div>
            <div className="truncate text-xs text-gray-500" title={hop.hostname || hop.rawLine}>
              {hop.hostname || (hop.timeout ? '请求超时' : '-')}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {hop.latencies.length ? (
              hop.latencies.map((value, index) => (
                <span key={index} className={`rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-gray-800 ${latencyColor(value)}`}>
                  {formatLatency(value)}
                </span>
              ))
            ) : (
              <span className="text-gray-400">-</span>
            )}
          </div>
          <span className={`font-mono text-xs font-semibold ${latencyColor(hop.latency)}`}>{formatLatency(hop.latency)}</span>
          <span className={hop.packetLoss > 0 ? 'font-mono text-xs text-red-600 dark:text-red-300' : 'font-mono text-xs text-gray-500'}>
            {formatPercent(hop.packetLoss)}
          </span>
          <span className="font-mono text-xs">{formatLatency(hop.jitter)}</span>
          <span className={hopHealth(hop) === '正常' ? 'text-green-600 dark:text-green-300' : 'text-amber-600 dark:text-amber-300'}>{hopHealth(hop)}</span>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className="h-2 rounded-full bg-blue-500"
              style={{ width: `${Math.max(2, Math.min(100, ((hop.worstLatency || hop.latency || 0) / maxLatency) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MtrTable({ rows }: { rows: MtrHopStats[] }) {
  if (!rows.length) return <EmptyState icon={<BarChart3 size={32} />} text="使用 MTR 多轮模式后查看统计" />;
  return (
    <div className="h-full overflow-auto">
      <div className="grid min-w-[1120px] grid-cols-[70px_220px_100px_100px_120px_120px_120px_120px_minmax(180px,1fr)] border-b border-gray-200 px-4 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
        <span>跳</span>
        <span>IP / 主机</span>
        <span>发送</span>
        <span>接收</span>
        <span>丢包</span>
        <span>最佳</span>
        <span>平均</span>
        <span>最差</span>
        <span>抖动</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.hop}
          className="grid min-w-[1120px] grid-cols-[70px_220px_100px_100px_120px_120px_120px_120px_minmax(180px,1fr)] items-center border-b border-gray-100 px-4 py-3 text-sm dark:border-gray-800"
        >
          <span className="font-mono text-xs font-semibold">{row.hop}</span>
          <div className="min-w-0">
            <div className="truncate font-mono text-xs font-semibold">{row.ip || '*'}</div>
            <div className="truncate text-xs text-gray-500">{row.hostname || '-'}</div>
          </div>
          <span className="font-mono text-xs">{row.sent}</span>
          <span className="font-mono text-xs">{row.received}</span>
          <span className={row.loss > 0 ? 'font-mono text-xs text-red-600 dark:text-red-300' : 'font-mono text-xs text-gray-500'}>{formatPercent(row.loss)}</span>
          <span className="font-mono text-xs">{formatLatency(row.best)}</span>
          <span className={`font-mono text-xs font-semibold ${latencyColor(row.avg)}`}>{formatLatency(row.avg)}</span>
          <span className="font-mono text-xs">{formatLatency(row.worst)}</span>
          <span className="font-mono text-xs">{formatLatency(row.jitter)}</span>
        </div>
      ))}
    </div>
  );
}

function RawOutput({ result }: { result: TracerouteResult }) {
  if (!result.rawOutput) return <EmptyState icon={<Activity size={32} />} text="暂无原始输出" />;
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap p-4 font-mono text-xs text-gray-700 dark:text-gray-300">
      {result.rawOutput}
    </pre>
  );
}
