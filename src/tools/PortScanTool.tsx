// 端口扫描与本机端口排查工具
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  FolderOpen,
  Monitor,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  Square,
  Trash2,
} from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

interface PortScanResult {
  port: number;
  open: boolean;
  service: string | null;
}

interface LocalPortInfo {
  protocol: string;
  local_address: string;
  port: number;
  pid: number;
  process_name: string | null;
  process_path: string | null;
  state: string | null;
  service: string | null;
}

type ToolMode = 'local' | 'remote';

const REMOTE_PRESETS = [
  { name: '常用端口', ports: '21,22,23,25,53,80,110,143,443,3306,3389,5432,6379,8080,27017' },
  { name: 'Web 服务', ports: '80,443,8000,8080,8443,8888,9000' },
  { name: '数据库', ports: '1433,3306,5432,6379,27017' },
  { name: '远程访问', ports: '22,23,3389,5900' },
  { name: '邮件服务', ports: '25,110,143,465,587,993,995' },
];

const LOCAL_PRESETS = [
  { name: '前端/Node', ports: '3000,3001,4200,5000,5173,8000,8080,8081,9000' },
  { name: '代理/调试', ports: '7890,7891,1080,10809,9222,9229' },
  { name: '数据库', ports: '1433,1521,3306,5432,6379,9200,27017' },
  { name: 'Docker/服务', ports: '2375,2376,5000,5672,9000,9001,15672' },
  { name: 'Web 常用', ports: '80,443,8080,8443' },
];

function parsePortList(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => Number.parseInt(item.trim(), 10))
        .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535)
    )
  ).sort((a, b) => a - b);
}

function isLocalHost(host: string) {
  const value = host.trim().toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '0.0.0.0';
}

export default function PortScanTool() {
  const ready = useToolTheme();
  const scanningRef = useRef(false);
  const [mode, setMode] = useState<ToolMode>('local');
  const [host, setHost] = useState('127.0.0.1');
  const [startPort, setStartPort] = useState(1);
  const [endPort, setEndPort] = useState(1000);
  const [timeoutMs, setTimeoutMs] = useState(1000);
  const [customPorts, setCustomPorts] = useState('');
  const [localFilter, setLocalFilter] = useState('');
  const [localPortFilter, setLocalPortFilter] = useState('');
  const [scanning, setScanning] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<PortScanResult[]>([]);
  const [localPorts, setLocalPorts] = useState<LocalPortInfo[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const getPortsToScan = () => {
    const directPorts = parsePortList(customPorts);

    if (directPorts.length > 0) {
      return directPorts;
    }

    if (startPort < 1 || endPort > 65535 || startPort > endPort) {
      throw new Error('端口范围无效（1-65535）');
    }

    return Array.from({ length: endPort - startPort + 1 }, (_, index) => startPort + index);
  };

  const filteredLocalPorts = useMemo(() => {
    const keyword = localFilter.trim().toLowerCase();
    const portFilter = new Set(parsePortList(localPortFilter));

    return localPorts.filter((item) => {
      if (portFilter.size > 0 && !portFilter.has(item.port)) return false;
      if (!keyword) return true;
      return [
        item.port.toString(),
        item.protocol,
        item.local_address,
        item.process_name || '',
        item.process_path || '',
        item.pid.toString(),
        item.service || '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [localFilter, localPortFilter, localPorts]);

  const loadLocalPorts = useCallback(async () => {
    setError('');
    setMessage('');
    setLoadingLocal(true);
    try {
      const rows = await invoke<LocalPortInfo[]>('network_list_local_ports');
      setLocalPorts(rows);
      setMessage(`已读取本机监听端口 ${rows.length} 条`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingLocal(false);
    }
  }, []);

  useEffect(() => {
    void loadLocalPorts();
  }, [loadLocalPorts]);

  const handleScan = async () => {
    setError('');
    setMessage('');
    if (!host.trim()) {
      setError('请输入主机地址');
      return;
    }

    let portsToScan: number[];
    try {
      portsToScan = getPortsToScan();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      return;
    }

    const portCount = portsToScan.length;
    if (portCount > 1000) {
      if (!confirm(`将扫描 ${portCount} 个端口，可能需要较长时间，是否继续？`)) {
        return;
      }
    }

    setScanning(true);
    scanningRef.current = true;
    setResults([]);
    setProgress(0);

    const scanResults: PortScanResult[] = [];
    const totalPorts = portsToScan.length;

    for (let index = 0; index < portsToScan.length; index++) {
      if (!scanningRef.current) break;
      const port = portsToScan[index];

      try {
        const result = await invoke<PortScanResult>('network_scan_port', {
          host: host.trim(),
          port,
          timeoutMs,
        });

        if (!scanningRef.current) break;

        if (result.open) {
          scanResults.push(result);
          setResults([...scanResults]);
        }

        setProgress(Math.round(((index + 1) / totalPorts) * 100));
      } catch (scanError) {
        console.error(`扫描端口 ${port} 失败:`, scanError);
      }
    }

    setScanning(false);
    scanningRef.current = false;
    setProgress(100);

    if (isLocalHost(host)) {
      void loadLocalPorts();
    }
  };

  const handleStop = () => {
    setScanning(false);
    scanningRef.current = false;
  };

  const loadPreset = (ports: string) => {
    const portList = parsePortList(ports);
    if (portList.length === 0) return;
    setStartPort(Math.min(...portList));
    setEndPort(Math.max(...portList));
    setCustomPorts(ports);
  };

  const loadLocalPreset = (ports: string) => {
    setLocalPortFilter(ports);
    setCustomPorts(ports);
  };

  const revealProcessPath = async (path: string | null) => {
    if (!path) {
      setError('该进程没有可用的程序路径，可能是系统进程或权限不足');
      return;
    }
    setError('');
    try {
      await invoke('network_reveal_process_path', { path });
    } catch (err) {
      setError(String(err));
    }
  };

  const killProcess = async (item: LocalPortInfo) => {
    const name = item.process_name || `PID ${item.pid}`;
    if (!confirm(`确定要结束 ${name} 吗？这会关闭占用端口 ${item.port} 的进程。`)) return;
    setError('');
    setMessage('');
    try {
      await invoke('network_kill_process', { pid: item.pid });
      setMessage(`已结束进程：${name}`);
      await loadLocalPorts();
    } catch (err) {
      setError(String(err));
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-gray-900">
      <ToolHeader icon="🔌" title="端口扫描与本机排查" />

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-5">
        <aside className="flex w-[380px] shrink-0 flex-col gap-4 overflow-y-auto pr-1">
          <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1 dark:bg-gray-900">
              <button
                onClick={() => setMode('local')}
                className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  mode === 'local'
                    ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-400'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                }`}
              >
                <Monitor size={16} />
                本机端口
              </button>
              <button
                onClick={() => setMode('remote')}
                className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  mode === 'remote'
                    ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-400'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                }`}
              >
                <Server size={16} />
                远程扫描
              </button>
            </div>
          </div>

          {mode === 'local' ? (
            <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  进程/端口搜索
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                  <input
                    type="text"
                    value={localFilter}
                    onChange={(e) => setLocalFilter(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    placeholder="node、vite、3000、PID..."
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  只看指定端口
                </label>
                <input
                  type="text"
                  value={localPortFilter}
                  onChange={(e) => setLocalPortFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  placeholder="例如：3000,5173,8080"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  常用排查
                </label>
                <div className="flex flex-wrap gap-2">
                  {LOCAL_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => loadLocalPreset(preset.ports)}
                      className="rounded bg-gray-100 px-3 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={loadLocalPorts}
                disabled={loadingLocal}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
              >
                <RefreshCw size={18} className={loadingLocal ? 'animate-spin' : ''} />
                {loadingLocal ? '读取中...' : '刷新本机端口'}
              </button>
            </div>
          ) : (
            <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  目标主机
                </label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !scanning && void handleScan()}
                  disabled={scanning}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  placeholder="域名或 IP 地址"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <NumberField
                  label="起始端口"
                  value={startPort}
                  min={1}
                  max={65535}
                  disabled={scanning}
                  onChange={(value) => {
                    setStartPort(value || 1);
                    setCustomPorts('');
                  }}
                />
                <NumberField
                  label="结束端口"
                  value={endPort}
                  min={1}
                  max={65535}
                  disabled={scanning}
                  onChange={(value) => {
                    setEndPort(value || 1000);
                    setCustomPorts('');
                  }}
                />
                <NumberField
                  label="超时(ms)"
                  value={timeoutMs}
                  min={100}
                  max={10000}
                  disabled={scanning}
                  onChange={(value) => setTimeoutMs(value || 1000)}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  指定端口（可选）
                </label>
                <input
                  type="text"
                  value={customPorts}
                  onChange={(e) => setCustomPorts(e.target.value)}
                  disabled={scanning}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  placeholder="例如：22,80,443,3306"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  快捷选择
                </label>
                <div className="flex flex-wrap gap-2">
                  {REMOTE_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => loadPreset(preset.ports)}
                      disabled={scanning}
                      className="rounded bg-gray-100 px-3 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              {scanning && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">扫描进度</span>
                    <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">{progress}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                    <div className="h-2 rounded-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              <button
                onClick={scanning ? handleStop : handleScan}
                className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
                  scanning ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                {scanning ? <Square size={18} /> : <Play size={18} />}
                {scanning ? '停止扫描' : '开始扫描'}
              </button>
            </div>
          )}

          {(error || message) && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                error
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
                  : 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
              }`}
            >
              {error || message}
            </div>
          )}

          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-yellow-900 dark:text-yellow-300">
              <ShieldAlert size={16} />
              使用提示
            </h4>
            <ul className="space-y-1 text-xs text-yellow-800 dark:text-yellow-400">
              <li>• 本机端口用于排查开发服务、代理、数据库等占用。</li>
              <li>• 结束进程会关闭对应程序，系统进程或权限不足时会失败。</li>
              <li>• 远程扫描仅用于您有权限访问的主机。</li>
            </ul>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {mode === 'local' ? '本机监听端口' : '开放端口'}
              </h3>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {mode === 'local'
                  ? `显示 ${filteredLocalPorts.length} / ${localPorts.length} 条`
                  : `发现 ${results.length} 个开放端口`}
              </p>
            </div>
            {mode === 'local' && (
              <button
                onClick={loadLocalPorts}
                disabled={loadingLocal}
                className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900"
              >
                <RefreshCw size={15} className={loadingLocal ? 'animate-spin' : ''} />
                刷新
              </button>
            )}
          </div>

          {mode === 'local' ? (
            <LocalPortTable
              rows={filteredLocalPorts}
              loading={loadingLocal}
              onReveal={revealProcessPath}
              onKill={killProcess}
            />
          ) : (
            <RemoteResultList results={results} scanning={scanning} />
          )}
        </main>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        disabled={disabled}
        min={min}
        max={max}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
      />
    </div>
  );
}

function LocalPortTable({
  rows,
  loading,
  onReveal,
  onKill,
}: {
  rows: LocalPortInfo[];
  loading: boolean;
  onReveal: (path: string | null) => void;
  onKill: (item: LocalPortInfo) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        正在读取本机端口...
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        点击“刷新本机端口”查看占用情况
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900 dark:text-gray-400">
          <tr>
            <th className="px-4 py-3">端口</th>
            <th className="px-4 py-3">协议</th>
            <th className="px-4 py-3">地址</th>
            <th className="px-4 py-3">进程</th>
            <th className="px-4 py-3">PID</th>
            <th className="px-4 py-3">服务</th>
            <th className="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((item) => (
            <tr key={`${item.protocol}-${item.local_address}-${item.port}-${item.pid}`} className="hover:bg-gray-50 dark:hover:bg-gray-900/60">
              <td className="px-4 py-3 font-mono font-semibold text-blue-600 dark:text-blue-400">{item.port}</td>
              <td className="px-4 py-3">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                  {item.protocol}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">{item.local_address}</td>
              <td className="max-w-[260px] px-4 py-3">
                <div className="truncate font-medium text-gray-900 dark:text-gray-100">{item.process_name || '未知进程'}</div>
                {item.process_path && (
                  <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400" title={item.process_path}>
                    {item.process_path}
                  </div>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">{item.pid}</td>
              <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">{item.service || item.state || '-'}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => onReveal(item.process_path)}
                    className="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                    title="打开程序位置"
                  >
                    <FolderOpen size={15} />
                  </button>
                  <button
                    onClick={() => onKill(item)}
                    disabled={item.pid === 0 || item.pid === 4}
                    className="rounded-md border border-red-200 p-1.5 text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900/60 dark:hover:bg-red-950/30"
                    title="结束进程"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RemoteResultList({ results, scanning }: { results: PortScanResult[]; scanning: boolean }) {
  if (results.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        {scanning ? '扫描中...' : '暂无结果'}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {results.map((result) => (
          <div
            key={result.port}
            className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20"
          >
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">端口 {result.port}</div>
                {result.service && <div className="text-xs text-gray-600 dark:text-gray-400">{result.service}</div>}
              </div>
            </div>
            <span className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
              开放
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
