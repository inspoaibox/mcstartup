// Ping 测试工具 - 延迟/丢包/抖动分析
import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Play, Square, Trash2, Download } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

interface PingResult {
  timestamp: number;
  latency: number | null; // null 表示超时
  success: boolean;
  error?: string | null;
}

interface PingStats {
  sent: number;
  received: number;
  lost: number;
  lossRate: number;
  minLatency: number;
  maxLatency: number;
  avgLatency: number;
  jitter: number; // 抖动
}

export default function PingTool() {
  const ready = useToolTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isRunningRef = useRef(false);
  const [target, setTarget] = useState('www.baidu.com');
  const [intervalMs, setIntervalMs] = useState(1000);
  const [timeoutMs, setTimeoutMs] = useState(3000);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<PingResult[]>([]);
  const [lastError, setLastError] = useState('');
  const [stats, setStats] = useState<PingStats>({
    sent: 0,
    received: 0,
    lost: 0,
    lossRate: 0,
    minLatency: 0,
    maxLatency: 0,
    avgLatency: 0,
    jitter: 0,
  });
  const [presets] = useState([
    { name: '百度', host: 'www.baidu.com' },
    { name: '谷歌', host: 'www.google.com' },
    { name: '腾讯', host: 'www.qq.com' },
    { name: 'GitHub', host: 'github.com' },
    { name: 'Cloudflare', host: '1.1.1.1' },
    { name: '阿里云', host: 'www.aliyun.com' },
  ]);

  // 计算统计数据
  const calculateStats = (results: PingResult[]): PingStats => {
    const sent = results.length;
    const received = results.filter((r) => r.success).length;
    const lost = sent - received;
    const lossRate = sent > 0 ? (lost / sent) * 100 : 0;

    const latencies = results.filter((r) => r.latency !== null).map((r) => r.latency!);

    if (latencies.length === 0) {
      return {
        sent,
        received,
        lost,
        lossRate,
        minLatency: 0,
        maxLatency: 0,
        avgLatency: 0,
        jitter: 0,
      };
    }

    const minLatency = Math.min(...latencies);
    const maxLatency = Math.max(...latencies);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    // 计算抖动（相邻延迟差的平均值）
    let jitterSum = 0;
    for (let i = 1; i < latencies.length; i++) {
      jitterSum += Math.abs(latencies[i] - latencies[i - 1]);
    }
    const jitter = latencies.length > 1 ? jitterSum / (latencies.length - 1) : 0;

    return { sent, received, lost, lossRate, minLatency, maxLatency, avgLatency, jitter };
  };

  // 绘制图表
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    // 清空画布
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    if (results.length === 0) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', width / 2, height / 2);
      return;
    }

    // 获取最大延迟用于缩放
    const maxLatency = Math.max(...results.map((r) => r.latency || 0), 100);
    const yScale = chartHeight / maxLatency;

    // 绘制网格线
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      // Y轴标签
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(maxLatency - (maxLatency / 5) * i)}ms`, padding - 10, y + 4);
    }

    // 绘制折线
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const maxPoints = Math.floor(chartWidth / 5);
    const displayResults = results.slice(-maxPoints);

    displayResults.forEach((result, index) => {
      const x = padding + (chartWidth / (displayResults.length - 1 || 1)) * index;
      const y =
        result.success && result.latency !== null
          ? padding + chartHeight - result.latency * yScale
          : padding + chartHeight;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // 绘制数据点
    displayResults.forEach((result, index) => {
      const x = padding + (chartWidth / (displayResults.length - 1 || 1)) * index;
      const y =
        result.success && result.latency !== null
          ? padding + chartHeight - result.latency * yScale
          : padding + chartHeight;

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = result.success ? '#3b82f6' : '#ef4444';
      ctx.fill();
    });

    // X轴标签
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('时间', width / 2, height - 10);
  }, [results]);

  // 开始/停止测试
  useEffect(() => {
    isRunningRef.current = isRunning;

    if (!isRunning) return;

    let isMounted = true;

    const runPing = async () => {
      while (isMounted && isRunningRef.current) {
        try {
          const result = await invoke<{
            success: boolean;
            latency: number | null;
            error: string | null;
          }>('network_ping', {
            host: target,
            timeoutMs,
          });

          if (!isMounted || !isRunningRef.current) break;

          const pingResult: PingResult = {
            timestamp: Date.now(),
            latency: result.latency,
            success: result.success,
            error: result.error,
          };
          setLastError(result.success ? '' : result.error || '请求超时');

          setResults((prev) => {
            const newResults = [...prev, pingResult];
            return newResults.slice(-100);
          });
        } catch (error) {
          if (!isMounted || !isRunningRef.current) break;

          const pingResult: PingResult = {
            timestamp: Date.now(),
            latency: null,
            success: false,
            error: String(error),
          };
          setLastError(String(error));

          setResults((prev) => {
            const newResults = [...prev, pingResult];
            return newResults.slice(-100);
          });
        }

        // 等待指定间隔
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, intervalMs);
        });
      }
    };

    runPing();

    return () => {
      isMounted = false;
      isRunningRef.current = false;
    };
  }, [isRunning, target, timeoutMs, intervalMs]);

  // 更新统计数据
  useEffect(() => {
    setStats(calculateStats(results));
  }, [results]);

  // 绘制图表
  useEffect(() => {
    drawChart();
  }, [drawChart]);

  // 清空数据
  const handleClear = () => {
    setResults([]);
    setLastError('');
    setStats({
      sent: 0,
      received: 0,
      lost: 0,
      lossRate: 0,
      minLatency: 0,
      maxLatency: 0,
      avgLatency: 0,
      jitter: 0,
    });
  };

  // 导出数据
  const handleExport = () => {
    const data = results.map((r) => ({
      timestamp: new Date(r.timestamp).toISOString(),
      latency: r.latency,
      success: r.success,
      error: r.error || null,
    }));

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `ping-${target}-${Date.now()}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <ToolHeader icon="📡" title="Ping 测试工具" />

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col p-6 gap-4 overflow-hidden">
        {/* 控制区 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="grid grid-cols-2 gap-4">
            {/* 左侧：目标和控制 */}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  目标地址
                </label>
                <input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={isRunning}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  placeholder="域名或 IP 地址"
                />
              </div>

              {/* 快捷选择 */}
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.host}
                    onClick={() => setTarget(preset.host)}
                    disabled={isRunning}
                    className="px-3 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                    间隔 (ms)
                  </label>
                  <input
                    type="number"
                    value={intervalMs}
                    onChange={(e) => setIntervalMs(parseInt(e.target.value) || 1000)}
                    disabled={isRunning}
                    min="100"
                    max="10000"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                    超时 (ms)
                  </label>
                  <input
                    type="number"
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(parseInt(e.target.value) || 3000)}
                    disabled={isRunning}
                    min="1000"
                    max="30000"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* 右侧：统计数据 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                <div className="text-xs text-blue-600 dark:text-blue-400 mb-1">平均延迟</div>
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                  {stats.avgLatency.toFixed(1)}
                  <span className="text-sm ml-1">ms</span>
                </div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                <div className="text-xs text-green-600 dark:text-green-400 mb-1">最小延迟</div>
                <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                  {stats.minLatency.toFixed(1)}
                  <span className="text-sm ml-1">ms</span>
                </div>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                <div className="text-xs text-orange-600 dark:text-orange-400 mb-1">最大延迟</div>
                <div className="text-2xl font-bold text-orange-700 dark:text-orange-300">
                  {stats.maxLatency.toFixed(1)}
                  <span className="text-sm ml-1">ms</span>
                </div>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                <div className="text-xs text-red-600 dark:text-red-400 mb-1">丢包率</div>
                <div className="text-2xl font-bold text-red-700 dark:text-red-300">
                  {stats.lossRate.toFixed(1)}
                  <span className="text-sm ml-1">%</span>
                </div>
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setIsRunning(!isRunning)}
              className={`flex-1 px-4 py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors ${
                isRunning
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {isRunning ? <Square size={18} /> : <Play size={18} />}
              {isRunning ? '停止' : '开始'}
            </button>
            <button
              onClick={handleClear}
              disabled={isRunning}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium flex items-center gap-2 disabled:opacity-50"
            >
              <Trash2 size={18} />
              清空
            </button>
            <button
              onClick={handleExport}
              disabled={results.length === 0}
              className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors font-medium flex items-center gap-2 disabled:opacity-50"
            >
              <Download size={18} />
              导出
            </button>
          </div>
        </div>

        {lastError && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
            最近一次失败：{lastError}
          </div>
        )}

        {/* 图表区 */}
        <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 overflow-hidden">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            延迟趋势图
          </h3>
          <canvas ref={canvasRef} width={1000} height={300} className="w-full" />
        </div>

        {/* 详细信息 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-600 dark:text-gray-400">已发送:</span>
              <span className="ml-2 font-semibold text-gray-900 dark:text-gray-100">
                {stats.sent}
              </span>
            </div>
            <div>
              <span className="text-gray-600 dark:text-gray-400">已接收:</span>
              <span className="ml-2 font-semibold text-green-600 dark:text-green-400">
                {stats.received}
              </span>
            </div>
            <div>
              <span className="text-gray-600 dark:text-gray-400">丢失:</span>
              <span className="ml-2 font-semibold text-red-600 dark:text-red-400">
                {stats.lost}
              </span>
            </div>
            <div>
              <span className="text-gray-600 dark:text-gray-400">抖动:</span>
              <span className="ml-2 font-semibold text-orange-600 dark:text-orange-400">
                {stats.jitter.toFixed(1)} ms
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
