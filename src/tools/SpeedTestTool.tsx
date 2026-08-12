import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Clock,
  Download,
  Eraser,
  FileDown,
  Gauge,
  History,
  Play,
  Server,
  Settings2,
  ShieldCheck,
  Square,
  TrendingDown,
  TrendingUp,
  Upload,
  Zap,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { StatusMessage, ToolbarButton } from './systemToolUtils';

type TestPhase = 'idle' | 'latency' | 'download' | 'upload';

interface TestServer {
  id: string;
  name: string;
  engine: string;
  region: string;
  downloadUrl: string;
  uploadUrl: string;
  pingUrl: string;
  note: string;
}

interface TestProfile {
  id: string;
  name: string;
  latencyProbes: number;
  downloadSizes: number[];
  uploadSizes: number[];
  downloadStreams: number;
  uploadStreams: number;
  note: string;
}

interface SpeedSample {
  phase: 'download' | 'upload';
  at: number;
  speed: number;
}

interface SpeedTestResult {
  id: string;
  timestamp: string;
  serverId: string;
  serverName: string;
  profileId: string;
  profileName: string;
  downloadSpeed: number;
  uploadSpeed: number;
  downloadPeak: number;
  uploadPeak: number;
  latency: number;
  jitter: number;
  packetLoss: number;
  score: number;
  grade: string;
  samples: SpeedSample[];
}

interface RunningState {
  phase: TestPhase;
  message: string;
  phaseProgress: number;
  overallProgress: number;
  currentSpeed: number;
  samples: SpeedSample[];
}

const HISTORY_KEY = 'mcstartup:speed-test:history:v2';
const HISTORY_RETENTION_DAYS = 30;

const TEST_SERVERS: TestServer[] = [
  {
    id: 'cloudflare-balanced',
    name: 'Cloudflare 标准',
    engine: 'Cloudflare',
    region: '自动就近',
    downloadUrl: 'https://speed.cloudflare.com/__down',
    uploadUrl: 'https://speed.cloudflare.com/__up',
    pingUrl: 'https://speed.cloudflare.com/__down?bytes=0',
    note: '稳定通用，适合日常对比。',
  },
  {
    id: 'cloudflare-fast',
    name: 'Cloudflare 快速',
    engine: 'Cloudflare',
    region: '自动就近',
    downloadUrl: 'https://speed.cloudflare.com/__down',
    uploadUrl: 'https://speed.cloudflare.com/__up',
    pingUrl: 'https://speed.cloudflare.com/__down?bytes=0',
    note: '更少样本，适合快速判断是否异常。',
  },
  {
    id: 'cloudflare-deep',
    name: 'Cloudflare 深测',
    engine: 'Cloudflare',
    region: '自动就近',
    downloadUrl: 'https://speed.cloudflare.com/__down',
    uploadUrl: 'https://speed.cloudflare.com/__up',
    pingUrl: 'https://speed.cloudflare.com/__down?bytes=0',
    note: '更大样本和更多并发，适合高速网络。',
  },
];

const TEST_PROFILES: TestProfile[] = [
  {
    id: 'quick',
    name: '快速',
    latencyProbes: 6,
    downloadSizes: [750_000, 2_000_000, 5_000_000],
    uploadSizes: [250_000, 750_000, 1_500_000],
    downloadStreams: 2,
    uploadStreams: 1,
    note: '约 10-20 秒',
  },
  {
    id: 'balanced',
    name: '标准',
    latencyProbes: 10,
    downloadSizes: [1_000_000, 5_000_000, 15_000_000, 25_000_000],
    uploadSizes: [500_000, 1_500_000, 4_000_000],
    downloadStreams: 4,
    uploadStreams: 2,
    note: '约 20-40 秒',
  },
  {
    id: 'deep',
    name: '深度',
    latencyProbes: 14,
    downloadSizes: [5_000_000, 15_000_000, 35_000_000, 60_000_000],
    uploadSizes: [1_000_000, 4_000_000, 8_000_000],
    downloadStreams: 6,
    uploadStreams: 3,
    note: '约 40-80 秒',
  },
];

const EMPTY_RUNNING: RunningState = {
  phase: 'idle',
  message: '待测试',
  phaseProgress: 0,
  overallProgress: 0,
  currentSpeed: 0,
  samples: [],
};

function nowId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatMbps(value: number) {
  if (!Number.isFinite(value)) return '0.00';
  if (value >= 1000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function formatMs(value: number) {
  if (!Number.isFinite(value)) return '0.0';
  return value.toFixed(value >= 100 ? 0 : 1);
}

function formatLoss(value: number) {
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percent: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percent) - 1));
  return sorted[index];
}

function stableAverage(values: number[]) {
  if (values.length <= 2) return average(values);
  const sorted = [...values].sort((a, b) => a - b);
  const trim = values.length >= 5 ? 1 : 0;
  return average(sorted.slice(trim, sorted.length - trim));
}

function addCacheBuster(url: string, suffix: string) {
  return `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}-${suffix}`;
}

function phaseOverallProgress(phase: TestPhase, phaseProgress: number) {
  if (phase === 'latency') return phaseProgress * 0.2;
  if (phase === 'download') return 20 + phaseProgress * 0.45;
  if (phase === 'upload') return 65 + phaseProgress * 0.35;
  return 0;
}

function gradeForScore(score: number) {
  if (score >= 90) return '优秀';
  if (score >= 76) return '良好';
  if (score >= 60) return '可用';
  return '需关注';
}

function scoreResult(
  download: number,
  upload: number,
  latency: number,
  jitter: number,
  packetLoss: number
) {
  let score = 100;
  if (download < 100) score -= Math.min(24, (100 - download) * 0.16);
  if (upload < 30) score -= Math.min(18, (30 - upload) * 0.35);
  if (latency > 40) score -= Math.min(22, (latency - 40) * 0.35);
  if (jitter > 8) score -= Math.min(16, (jitter - 8) * 0.8);
  score -= Math.min(25, packetLoss * 4);
  return Math.round(Math.max(0, Math.min(100, score)));
}

function fillRandom(data: Uint8Array) {
  const chunk = 65_536;
  for (let offset = 0; offset < data.length; offset += chunk) {
    crypto.getRandomValues(data.subarray(offset, Math.min(offset + chunk, data.length)));
  }
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('测试已取消', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('测试已取消', 'AbortError'));
      },
      { once: true }
    );
  });
}

function loadHistory() {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw) as SpeedTestResult[];
    return pruneHistory(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
}

function pruneHistory(rows: SpeedTestResult[]) {
  const minTime = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return rows.filter((row) => new Date(row.timestamp).getTime() >= minTime).slice(0, 500);
}

function saveHistory(rows: SpeedTestResult[]) {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(pruneHistory(rows)));
}

function historyToCsv(rows: SpeedTestResult[]) {
  const header = [
    'time',
    'server',
    'profile',
    'download_mbps',
    'upload_mbps',
    'latency_ms',
    'jitter_ms',
    'packet_loss_percent',
    'score',
    'grade',
  ];
  const body = rows.map((row) =>
    [
      row.timestamp,
      row.serverName,
      row.profileName,
      row.downloadSpeed.toFixed(2),
      row.uploadSpeed.toFixed(2),
      row.latency.toFixed(1),
      row.jitter.toFixed(1),
      row.packetLoss.toFixed(1),
      String(row.score),
      row.grade,
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header.join(','), ...body].join('\n');
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildTrend(rows: SpeedTestResult[]) {
  return [...rows].reverse().slice(-18);
}

function metricDelta(rows: SpeedTestResult[], key: 'downloadSpeed' | 'uploadSpeed' | 'latency') {
  if (rows.length < 2) return null;
  return rows[0][key] - rows[1][key];
}

export default function SpeedTestTool() {
  const ready = useToolTheme();
  const testingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [serverId, setServerId] = useState(TEST_SERVERS[0].id);
  const [profileId, setProfileId] = useState(TEST_PROFILES[1].id);
  const [autoMinutes, setAutoMinutes] = useState(0);
  const [testing, setTesting] = useState(false);
  const [running, setRunning] = useState<RunningState>(EMPTY_RUNNING);
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const [history, setHistory] = useState<SpeedTestResult[]>([]);
  const [message, setMessage] = useState('参考 MySpeed 的思路，保留 30 天本地测速历史。');
  const [error, setError] = useState('');

  useEffect(() => {
    const rows = loadHistory();
    setHistory(rows);
    setResult(rows[0] || null);
  }, []);

  const server = TEST_SERVERS.find((item) => item.id === serverId) || TEST_SERVERS[0];
  const profile = TEST_PROFILES.find((item) => item.id === profileId) || TEST_PROFILES[1];

  const historyStats = useMemo(() => {
    const recent = history.slice(0, 30);
    return {
      count: history.length,
      avgDownload: average(recent.map((item) => item.downloadSpeed)),
      avgUpload: average(recent.map((item) => item.uploadSpeed)),
      avgLatency: average(recent.map((item) => item.latency)),
      bestDownload: Math.max(0, ...recent.map((item) => item.downloadSpeed)),
      worstLatency: Math.max(0, ...recent.map((item) => item.latency)),
      trend: buildTrend(history),
      downloadDelta: metricDelta(history, 'downloadSpeed'),
      uploadDelta: metricDelta(history, 'uploadSpeed'),
      latencyDelta: metricDelta(history, 'latency'),
    };
  }, [history]);

  const updateRunning = useCallback((patch: Partial<RunningState>) => {
    setRunning((current) => ({ ...current, ...patch }));
  }, []);

  const runLatencyTest = useCallback(
    async (signal: AbortSignal) => {
      const latencies: number[] = [];
      let failures = 0;
      for (let i = 0; i < profile.latencyProbes; i += 1) {
        if (signal.aborted) throw new DOMException('测试已取消', 'AbortError');
        const started = performance.now();
        try {
          const response = await fetch(addCacheBuster(server.pingUrl, `latency-${i}`), {
            cache: 'no-store',
            signal,
          });
          await response.arrayBuffer();
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          latencies.push(performance.now() - started);
        } catch (err) {
          if (signal.aborted) throw err;
          failures += 1;
        }
        const phaseProgress = ((i + 1) / profile.latencyProbes) * 100;
        updateRunning({
          phase: 'latency',
          phaseProgress,
          overallProgress: phaseOverallProgress('latency', phaseProgress),
          message: `延迟探测 ${i + 1}/${profile.latencyProbes}`,
        });
        await abortableDelay(90, signal);
      }

      if (!latencies.length) throw new Error('延迟测试失败：无法连接测速节点');
      const jitterValues = latencies
        .slice(1)
        .map((value, index) => Math.abs(value - latencies[index]));
      return {
        latency: stableAverage(latencies),
        jitter: average(jitterValues),
        packetLoss: (failures / profile.latencyProbes) * 100,
        p95: percentile(latencies, 0.95),
      };
    },
    [profile.latencyProbes, server.pingUrl, updateRunning]
  );

  const runDownloadBatch = useCallback(
    async (
      size: number,
      batchIndex: number,
      totalBatches: number,
      signal: AbortSignal
    ): Promise<{ averageSpeed: number; peakSpeed: number; samples: SpeedSample[] }> => {
      let received = 0;
      let lastReceived = 0;
      let lastTick = performance.now();
      let peakSpeed = 0;
      const samples: SpeedSample[] = [];
      const started = performance.now();

      const timer = window.setInterval(() => {
        const now = performance.now();
        const elapsed = Math.max(0.001, (now - lastTick) / 1000);
        const speed = ((received - lastReceived) * 8) / elapsed / 1_000_000;
        if (Number.isFinite(speed) && speed > 0) {
          peakSpeed = Math.max(peakSpeed, speed);
          const sample = { phase: 'download' as const, at: Date.now(), speed };
          samples.push(sample);
          setRunning((current) => ({
            ...current,
            currentSpeed: speed,
            samples: current.samples.concat(sample).slice(-80),
          }));
        }
        lastReceived = received;
        lastTick = now;
      }, 250);

      const tasks = Array.from({ length: profile.downloadStreams }, async (_, streamIndex) => {
        const url = addCacheBuster(
          `${server.downloadUrl}${server.downloadUrl.includes('?') ? '&' : '?'}bytes=${size}`,
          `down-${batchIndex}-${streamIndex}`
        );
        const response = await fetch(url, { cache: 'no-store', signal });
        if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error('下载响应无法读取');
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
        }
      });

      const settled = await Promise.allSettled(tasks);
      window.clearInterval(timer);
      if (signal.aborted) throw new DOMException('测试已取消', 'AbortError');
      if (settled.every((item) => item.status === 'rejected') || received === 0) {
        throw new Error('下载测试失败：节点无响应');
      }
      const elapsed = Math.max(0.001, (performance.now() - started) / 1000);
      const averageSpeed = (received * 8) / elapsed / 1_000_000;
      const phaseProgress = ((batchIndex + 1) / totalBatches) * 100;
      updateRunning({
        currentSpeed: averageSpeed,
        phaseProgress,
        overallProgress: phaseOverallProgress('download', phaseProgress),
        message: `下载样本 ${batchIndex + 1}/${totalBatches}`,
      });
      return { averageSpeed, peakSpeed: Math.max(peakSpeed, averageSpeed), samples };
    },
    [profile.downloadStreams, server.downloadUrl, updateRunning]
  );

  const runDownloadTest = useCallback(
    async (signal: AbortSignal) => {
      const speeds: number[] = [];
      const peaks: number[] = [];
      const samples: SpeedSample[] = [];
      for (let index = 0; index < profile.downloadSizes.length; index += 1) {
        const batch = await runDownloadBatch(
          profile.downloadSizes[index],
          index,
          profile.downloadSizes.length,
          signal
        );
        speeds.push(batch.averageSpeed);
        peaks.push(batch.peakSpeed);
        samples.push(...batch.samples);
        await abortableDelay(220, signal);
      }
      if (!speeds.length) throw new Error('下载测试失败：没有有效样本');
      return {
        speed: Math.max(stableAverage(speeds), percentile(speeds, 0.75)),
        peak: Math.max(...peaks),
        samples,
      };
    },
    [profile.downloadSizes, runDownloadBatch]
  );

  const runUploadBatch = useCallback(
    async (size: number, batchIndex: number, totalBatches: number, signal: AbortSignal) => {
      const payload = new Uint8Array(size);
      fillRandom(payload);
      const started = performance.now();

      const tasks = Array.from({ length: profile.uploadStreams }, async (_, streamIndex) => {
        const requestStarted = performance.now();
        try {
          const response = await fetch(
            addCacheBuster(server.uploadUrl, `up-${batchIndex}-${streamIndex}`),
            {
              method: 'POST',
              body: payload.slice(),
              cache: 'no-store',
              headers: { 'Content-Type': 'application/octet-stream' },
              signal,
            }
          );
          if (!response.ok && response.status !== 0) throw new Error(`HTTP ${response.status}`);
          return { ok: true, bytes: size, duration: (performance.now() - requestStarted) / 1000 };
        } catch (err) {
          if (signal.aborted) throw err;
          const duration = (performance.now() - requestStarted) / 1000;
          if (duration > 0.15) return { ok: true, bytes: size, duration };
          return { ok: false, bytes: 0, duration };
        }
      });

      const settled = await Promise.allSettled(tasks);
      if (signal.aborted) throw new DOMException('测试已取消', 'AbortError');
      const success = settled
        .filter(
          (
            item
          ): item is PromiseFulfilledResult<{ ok: boolean; bytes: number; duration: number }> =>
            item.status === 'fulfilled'
        )
        .map((item) => item.value)
        .filter((item) => item.ok);
      if (!success.length) throw new Error('上传测试失败：节点无响应');
      const bytes = success.reduce((sum, item) => sum + item.bytes, 0);
      const elapsed = Math.max(0.001, (performance.now() - started) / 1000);
      const aggregateSpeed = (bytes * 8) / elapsed / 1_000_000;
      const peakSpeed = Math.max(
        aggregateSpeed,
        ...success.map((item) => (item.bytes * 8) / Math.max(0.001, item.duration) / 1_000_000)
      );
      const sample = { phase: 'upload' as const, at: Date.now(), speed: aggregateSpeed };
      const phaseProgress = ((batchIndex + 1) / totalBatches) * 100;
      updateRunning({
        currentSpeed: aggregateSpeed,
        phaseProgress,
        overallProgress: phaseOverallProgress('upload', phaseProgress),
        message: `上传样本 ${batchIndex + 1}/${totalBatches}`,
      });
      setRunning((current) => ({
        ...current,
        samples: current.samples.concat(sample).slice(-80),
      }));
      return { averageSpeed: aggregateSpeed, peakSpeed, sample };
    },
    [profile.uploadStreams, server.uploadUrl, updateRunning]
  );

  const runUploadTest = useCallback(
    async (signal: AbortSignal) => {
      const speeds: number[] = [];
      const peaks: number[] = [];
      const samples: SpeedSample[] = [];
      for (let index = 0; index < profile.uploadSizes.length; index += 1) {
        const batch = await runUploadBatch(
          profile.uploadSizes[index],
          index,
          profile.uploadSizes.length,
          signal
        );
        speeds.push(batch.averageSpeed);
        peaks.push(batch.peakSpeed);
        samples.push(batch.sample);
        await abortableDelay(220, signal);
      }
      if (!speeds.length) throw new Error('上传测试失败：没有有效样本');
      return { speed: stableAverage(speeds), peak: Math.max(...peaks), samples };
    },
    [profile.uploadSizes, runUploadBatch]
  );

  const handleStartTest = useCallback(async () => {
    if (testingRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    testingRef.current = true;
    setTesting(true);
    setError('');
    setResult(null);
    setRunning({
      ...EMPTY_RUNNING,
      phase: 'latency',
      message: '准备测速',
    });
    setMessage(`正在使用 ${server.name} · ${profile.name} 配置测速`);

    try {
      updateRunning({ phase: 'latency', message: '延迟探测中' });
      const latency = await runLatencyTest(controller.signal);
      updateRunning({
        phase: 'download',
        phaseProgress: 0,
        currentSpeed: 0,
        message: '下载测速中',
      });
      const download = await runDownloadTest(controller.signal);
      updateRunning({ phase: 'upload', phaseProgress: 0, currentSpeed: 0, message: '上传测速中' });
      const upload = await runUploadTest(controller.signal);

      const score = scoreResult(
        download.speed,
        upload.speed,
        latency.latency,
        latency.jitter,
        latency.packetLoss
      );
      const record: SpeedTestResult = {
        id: nowId(),
        timestamp: new Date().toISOString(),
        serverId: server.id,
        serverName: server.name,
        profileId: profile.id,
        profileName: profile.name,
        downloadSpeed: download.speed,
        uploadSpeed: upload.speed,
        downloadPeak: download.peak,
        uploadPeak: upload.peak,
        latency: latency.latency,
        jitter: latency.jitter,
        packetLoss: latency.packetLoss,
        score,
        grade: gradeForScore(score),
        samples: [...download.samples, ...upload.samples].slice(-80),
      };

      setResult(record);
      setHistory((current) => {
        const next = pruneHistory([record, ...current]);
        saveHistory(next);
        return next;
      });
      setMessage(`测速完成：${record.grade} · 下载 ${formatMbps(record.downloadSpeed)} Mbps`);
      setRunning({ ...EMPTY_RUNNING, message: '测速完成' });
    } catch (err) {
      if (controller.signal.aborted) {
        setMessage('测速已停止');
      } else {
        setError(String(err));
      }
      setRunning({ ...EMPTY_RUNNING, message: '待测试' });
    } finally {
      abortRef.current = null;
      testingRef.current = false;
      setTesting(false);
    }
  }, [profile, runDownloadTest, runLatencyTest, runUploadTest, server, updateRunning]);

  useEffect(() => {
    if (!autoMinutes) return;
    const timer = window.setInterval(
      () => {
        if (!testingRef.current) void handleStartTest();
      },
      autoMinutes * 60 * 1000
    );
    return () => window.clearInterval(timer);
  }, [autoMinutes, handleStartTest]);

  const handleStopTest = () => {
    abortRef.current?.abort();
    testingRef.current = false;
    setTesting(false);
    setRunning({ ...EMPTY_RUNNING, message: '已停止' });
  };

  const clearHistory = () => {
    if (!history.length) return;
    if (!window.confirm('确定清空网速测试历史吗？')) return;
    setHistory([]);
    setResult(null);
    saveHistory([]);
    setMessage('已清空测速历史');
  };

  const exportCsv = () => {
    if (!history.length) return;
    downloadText(`speed-test-${Date.now()}.csv`, historyToCsv(history), 'text/csv;charset=utf-8');
  };

  if (!ready) return null;

  const activeResult = result || history[0] || null;
  const currentSamples = testing ? running.samples : activeResult?.samples || [];
  const downloadDelta = historyStats.downloadDelta;
  const uploadDelta = historyStats.uploadDelta;
  const latencyDelta = historyStats.latencyDelta;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="⚡"
        title="网速测试"
        subtitle="多样本并发测速、30 天历史、质量评分和趋势分析"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton onClick={testing ? handleStopTest : () => void handleStartTest()}>
              {testing ? <Square size={14} /> : <Play size={14} />}
              {testing ? '停止' : '开始测速'}
            </ToolbarButton>
            <ToolbarButton onClick={exportCsv} disabled={!history.length || testing}>
              <FileDown size={14} />
              导出
            </ToolbarButton>
            <ToolbarButton onClick={clearHistory} disabled={!history.length || testing} danger>
              <Eraser size={14} />
              清空
            </ToolbarButton>
          </div>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_320px] gap-3 p-4 max-2xl:grid-cols-[280px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <StatusMessage message={message} error={error} />

          <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Server size={15} />
              测速节点
            </div>
            <div className="mt-3 space-y-2">
              {TEST_SERVERS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    if (testing) return;
                    setServerId(item.id);
                    if (item.id.endsWith('fast')) setProfileId('quick');
                    if (item.id.endsWith('deep')) setProfileId('deep');
                  }}
                  disabled={testing}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50 ${
                    server.id === item.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{item.name}</span>
                    <span className="text-xs text-gray-500">{item.engine}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{item.note}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Settings2 size={15} />
              测试配置
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {TEST_PROFILES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setProfileId(item.id)}
                  disabled={testing}
                  className={`rounded-lg border px-2 py-2 text-xs disabled:opacity-50 ${
                    profile.id === item.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="font-semibold">{item.name}</div>
                  <div className="mt-1 text-gray-500">{item.note}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 text-xs text-gray-500">
              <InfoLine label="延迟探测" value={`${profile.latencyProbes} 次`} />
              <InfoLine label="下载并发" value={`${profile.downloadStreams} 路`} />
              <InfoLine label="上传并发" value={`${profile.uploadStreams} 路`} />
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock size={15} />
              周期测试
            </div>
            <select
              value={autoMinutes}
              onChange={(event) => setAutoMinutes(Number(event.target.value))}
              className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value={0}>关闭</option>
              <option value={15}>每 15 分钟</option>
              <option value={30}>每 30 分钟</option>
              <option value={60}>每 1 小时</option>
            </select>
            <div className="mt-2 text-xs text-gray-500">
              已保存 {historyStats.count} 条，保留 {HISTORY_RETENTION_DAYS} 天。
            </div>
          </section>
        </aside>

        <section className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <section className="grid gap-3 md:grid-cols-4">
            <MetricCard
              icon={<Download size={16} />}
              label="下载"
              value={activeResult ? formatMbps(activeResult.downloadSpeed) : '0.00'}
              unit="Mbps"
              delta={downloadDelta}
              positiveUp
            />
            <MetricCard
              icon={<Upload size={16} />}
              label="上传"
              value={activeResult ? formatMbps(activeResult.uploadSpeed) : '0.00'}
              unit="Mbps"
              delta={uploadDelta}
              positiveUp
            />
            <MetricCard
              icon={<Zap size={16} />}
              label="延迟"
              value={activeResult ? formatMs(activeResult.latency) : '0.0'}
              unit="ms"
              delta={latencyDelta}
            />
            <MetricCard
              icon={<ShieldCheck size={16} />}
              label="质量"
              value={activeResult ? String(activeResult.score) : '--'}
              unit={activeResult ? activeResult.grade : ''}
            />
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Gauge size={16} />
                  实时测速
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {server.name} · {profile.name} · {navigator.onLine ? '网络在线' : '网络离线'}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-3xl font-semibold">
                  {testing
                    ? formatMbps(running.currentSpeed)
                    : activeResult
                      ? formatMbps(activeResult.downloadSpeed)
                      : '0.00'}
                </div>
                <div className="text-xs text-gray-500">
                  {testing ? 'Mbps 当前速率' : 'Mbps 最近下载'}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[190px_minmax(0,1fr)]">
              <button
                onClick={testing ? handleStopTest : () => void handleStartTest()}
                className={`flex aspect-square max-h-44 min-h-36 w-full flex-col items-center justify-center rounded-lg border text-white shadow-sm transition ${
                  testing
                    ? 'border-red-500 bg-red-600 hover:bg-red-700'
                    : 'border-blue-600 bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {testing ? <Square size={32} /> : <Play size={34} />}
                <span className="mt-2 text-sm font-semibold">
                  {testing ? '停止测速' : '开始测速'}
                </span>
              </button>

              <div className="flex min-w-0 flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {testing ? running.message : activeResult ? '最近一次结果' : '尚无结果'}
                    </span>
                    <span>{Math.round(testing ? running.overallProgress : 0)}%</span>
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all"
                      style={{
                        width: `${testing ? running.overallProgress : activeResult ? 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>

                <LiveBars samples={currentSamples} testing={testing} />

                <div className="grid gap-2 text-xs text-gray-500 md:grid-cols-4">
                  <InfoPill
                    label="下载峰值"
                    value={activeResult ? `${formatMbps(activeResult.downloadPeak)} Mbps` : '-'}
                  />
                  <InfoPill
                    label="上传峰值"
                    value={activeResult ? `${formatMbps(activeResult.uploadPeak)} Mbps` : '-'}
                  />
                  <InfoPill
                    label="抖动"
                    value={activeResult ? `${formatMs(activeResult.jitter)} ms` : '-'}
                  />
                  <InfoPill
                    label="丢包"
                    value={activeResult ? formatLoss(activeResult.packetLoss) : '-'}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-1">
            <div className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <History size={15} />
                  30 天历史
                </div>
                <div className="text-xs text-gray-500">{history.length} 条</div>
              </div>
              <HistoryList rows={history} />
            </div>

            <div className="flex min-h-0 flex-col gap-3 overflow-auto 2xl:hidden">
              <StatsPanel stats={historyStats} />
            </div>
          </section>
        </section>

        <aside className="flex min-h-0 flex-col gap-3 overflow-auto max-2xl:hidden">
          <StatsPanel stats={historyStats} />
        </aside>
      </main>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  unit,
  delta,
  positiveUp,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  delta?: number | null;
  positiveUp?: boolean;
}) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta) && Math.abs(delta) >= 0.01;
  const good = hasDelta ? (positiveUp ? delta! >= 0 : delta! <= 0) : false;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="truncate text-2xl font-semibold">{value}</span>
        <span className="pb-1 text-xs text-gray-500">{unit}</span>
      </div>
      <div
        className={`mt-2 flex items-center gap-1 text-xs ${hasDelta ? (good ? 'text-green-600 dark:text-green-300' : 'text-amber-600 dark:text-amber-300') : 'text-gray-400'}`}
      >
        {hasDelta ? (
          delta! >= 0 ? (
            <TrendingUp size={13} />
          ) : (
            <TrendingDown size={13} />
          )
        ) : (
          <Activity size={13} />
        )}
        {hasDelta ? `${delta! >= 0 ? '+' : ''}${delta!.toFixed(1)} 较上次` : '等待对比'}
      </div>
    </div>
  );
}

function LiveBars({ samples, testing }: { samples: SpeedSample[]; testing: boolean }) {
  const rows = samples.slice(-42);
  const max = Math.max(1, ...rows.map((item) => item.speed));
  if (!rows.length) {
    return (
      <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-gray-200 text-xs text-gray-400 dark:border-gray-800">
        {testing ? '等待实时样本' : '暂无测速曲线'}
      </div>
    );
  }
  return (
    <div className="flex h-28 items-end gap-1 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800">
      {rows.map((sample, index) => (
        <div
          key={`${sample.at}-${index}`}
          title={`${sample.phase === 'download' ? '下载' : '上传'} ${formatMbps(sample.speed)} Mbps`}
          className={`min-w-1 flex-1 rounded-t ${sample.phase === 'download' ? 'bg-blue-500' : 'bg-green-500'}`}
          style={{ height: `${Math.max(8, (sample.speed / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function HistoryList({ rows }: { rows: SpeedTestResult[] }) {
  if (!rows.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        暂无测速历史
      </div>
    );
  }
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {rows.slice(0, 80).map((row) => (
        <article key={row.id} className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{row.grade}</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {row.serverName}
                </span>
                <span className="text-xs text-gray-500">{formatTime(row.timestamp)}</span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {row.profileName} · 分数 {row.score} · 丢包 {formatLoss(row.packetLoss)}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-right text-xs">
              <MiniStat label="下载" value={`${formatMbps(row.downloadSpeed)} Mbps`} />
              <MiniStat label="上传" value={`${formatMbps(row.uploadSpeed)} Mbps`} />
              <MiniStat label="延迟" value={`${formatMs(row.latency)} ms`} />
              <MiniStat label="抖动" value={`${formatMs(row.jitter)} ms`} />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function StatsPanel({
  stats,
}: {
  stats: {
    count: number;
    avgDownload: number;
    avgUpload: number;
    avgLatency: number;
    bestDownload: number;
    worstLatency: number;
    trend: SpeedTestResult[];
  };
}) {
  return (
    <>
      <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 size={15} />
          统计概览
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <InfoPill label="平均下载" value={`${formatMbps(stats.avgDownload)} Mbps`} />
          <InfoPill label="平均上传" value={`${formatMbps(stats.avgUpload)} Mbps`} />
          <InfoPill label="平均延迟" value={`${formatMs(stats.avgLatency)} ms`} />
          <InfoPill label="最佳下载" value={`${formatMbps(stats.bestDownload)} Mbps`} />
          <InfoPill label="最差延迟" value={`${formatMs(stats.worstLatency)} ms`} />
          <InfoPill label="样本数" value={`${stats.count} 条`} />
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Activity size={15} />
          趋势
        </div>
        <TrendChart rows={stats.trend} />
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
        <div className="font-semibold text-gray-700 dark:text-gray-200">质量判定</div>
        <div className="mt-2 space-y-2">
          <InfoLine label="优秀" value="90-100" />
          <InfoLine label="良好" value="76-89" />
          <InfoLine label="可用" value="60-75" />
          <InfoLine label="需关注" value="< 60" />
        </div>
      </section>
    </>
  );
}

function TrendChart({ rows }: { rows: SpeedTestResult[] }) {
  if (!rows.length) {
    return (
      <div className="mt-3 h-36 rounded-lg border border-dashed border-gray-200 dark:border-gray-800" />
    );
  }
  const max = Math.max(1, ...rows.map((row) => Math.max(row.downloadSpeed, row.uploadSpeed)));
  return (
    <div className="mt-3 space-y-3">
      <div className="flex h-36 items-end gap-1 rounded-lg border border-gray-200 px-2 py-2 dark:border-gray-800">
        {rows.map((row) => (
          <div key={row.id} className="flex min-w-2 flex-1 items-end gap-0.5">
            <div
              className="flex-1 rounded-t bg-blue-500"
              title={`下载 ${formatMbps(row.downloadSpeed)} Mbps`}
              style={{ height: `${Math.max(4, (row.downloadSpeed / max) * 100)}%` }}
            />
            <div
              className="flex-1 rounded-t bg-green-500"
              title={`上传 ${formatMbps(row.uploadSpeed)} Mbps`}
              style={{ height: `${Math.max(4, (row.uploadSpeed / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          下载
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          上传
        </span>
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="font-mono text-gray-700 dark:text-gray-200">{value}</span>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-950">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="truncate font-mono text-gray-700 dark:text-gray-200" title={value}>
        {value}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[78px] rounded bg-gray-50 px-2 py-1.5 dark:bg-gray-950">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="truncate font-mono">{value}</div>
    </div>
  );
}
