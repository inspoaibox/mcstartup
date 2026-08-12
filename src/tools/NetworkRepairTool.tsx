import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  Globe2,
  Loader2,
  Network,
  RefreshCw,
  RotateCcw,
  Router,
  ShieldAlert,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { StatusMessage, ToolbarButton } from './systemToolUtils';

interface NetworkRepairAdapter {
  interfaceIndex: number;
  name: string;
  description: string;
  status: string;
  macAddress: string;
  linkSpeed: string;
  ipAddresses: string[];
  gateways: string[];
  dnsServers: string[];
}

interface NetworkRepairCheck {
  id: string;
  label: string;
  target: string;
  status: 'ok' | 'warn' | 'fail' | 'unknown' | string;
  detail: string;
  latencyMs?: number;
}

interface NetworkRepairProxyInfo {
  winhttp: string;
  userProxyEnabled: boolean;
  userProxyServer: string;
}

interface NetworkRepairHostsInfo {
  path: string;
  writable: boolean;
  customEntries: number;
  suspiciousEntries: string[];
}

interface NetworkRepairSnapshot {
  generatedAt: string;
  isAdmin: boolean;
  adapters: NetworkRepairAdapter[];
  checks: NetworkRepairCheck[];
  proxy: NetworkRepairProxyInfo;
  hosts: NetworkRepairHostsInfo;
  suggestions: string[];
}

interface NetworkRepairActionResult {
  success: boolean;
  needsReboot: boolean;
  message: string;
  output: string;
  snapshot: NetworkRepairSnapshot;
}

interface RepairAction {
  id: string;
  label: string;
  description: string;
  icon: typeof Wrench;
  tone: 'blue' | 'green' | 'amber' | 'red';
  confirm?: string;
  needsAdapter?: boolean;
  dnsPreset?: string;
}

const EMPTY_SNAPSHOT: NetworkRepairSnapshot = {
  generatedAt: '',
  isAdmin: false,
  adapters: [],
  checks: [],
  proxy: {
    winhttp: '',
    userProxyEnabled: false,
    userProxyServer: '',
  },
  hosts: {
    path: '',
    writable: false,
    customEntries: 0,
    suspiciousEntries: [],
  },
  suggestions: [],
};

const REPAIR_ACTIONS: RepairAction[] = [
  {
    id: 'flush-dns',
    label: '刷新 DNS 缓存',
    description: '清理本机 DNS 缓存，适合域名解析错乱或刚改过 DNS。',
    icon: RefreshCw,
    tone: 'green',
  },
  {
    id: 'reset-proxy',
    label: '重置系统代理',
    description: '关闭用户代理并重置 WinHTTP 代理，适合代理/VPN 残留导致无法联网。',
    icon: Globe2,
    tone: 'green',
    confirm: '确定重置系统代理吗？如果你正在使用代理或 VPN，可能需要之后重新开启。',
  },
  {
    id: 'release-renew',
    label: '释放 / 续租 IP',
    description: '重新向路由器获取 IP，执行时网络会短暂断开。',
    icon: Router,
    tone: 'blue',
    confirm: '确定释放并重新获取 IP 吗？当前网络连接会短暂中断。',
  },
  {
    id: 'dns-auto',
    label: 'DNS 自动获取',
    description: '将选中网卡或所有已连接网卡恢复为 DHCP 自动 DNS。',
    icon: Network,
    tone: 'blue',
    needsAdapter: true,
    confirm: '确定将 DNS 恢复为自动获取吗？',
  },
  {
    id: 'dns-preset',
    label: '阿里 DNS',
    description: '设置为 223.5.5.5 / 223.6.6.6。',
    icon: Globe2,
    tone: 'blue',
    needsAdapter: true,
    dnsPreset: 'alidns',
    confirm: '确定将 DNS 设置为阿里 DNS 吗？',
  },
  {
    id: 'dns-preset',
    label: 'DNSPod',
    description: '设置为 119.29.29.29 / 182.254.116.116。',
    icon: Globe2,
    tone: 'blue',
    needsAdapter: true,
    dnsPreset: 'dnspod',
    confirm: '确定将 DNS 设置为 DNSPod 吗？',
  },
  {
    id: 'winsock-reset',
    label: '重置 Winsock',
    description: '修复套接字目录异常，执行后通常需要重启。',
    icon: RotateCcw,
    tone: 'amber',
    confirm: '确定重置 Winsock 吗？执行后建议重启电脑。',
  },
  {
    id: 'tcpip-reset',
    label: '重置 TCP/IP',
    description: '重置 TCP/IP 协议栈，适合协议栈损坏或网关异常。',
    icon: RotateCcw,
    tone: 'amber',
    confirm: '确定重置 TCP/IP 协议栈吗？执行后建议重启电脑。',
  },
  {
    id: 'hosts-reset',
    label: '恢复 Hosts',
    description: '备份当前 Hosts 后恢复默认内容，需要管理员权限。',
    icon: FileWarning,
    tone: 'red',
    confirm: '确定恢复默认 Hosts 吗？工具会先备份当前 Hosts。',
  },
  {
    id: 'restart-adapter',
    label: '重启网卡',
    description: '重启选中网卡或所有已连接网卡，网络会短暂断开。',
    icon: ShieldAlert,
    tone: 'red',
    needsAdapter: true,
    confirm: '确定重启网卡吗？网络连接会短暂中断。',
  },
];

function statusTone(status: string) {
  if (status === 'ok') return 'text-green-600 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-900/20 dark:border-green-900/50';
  if (status === 'warn') return 'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-900/50';
  if (status === 'fail') return 'text-red-600 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-900/20 dark:border-red-900/50';
  return 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-300 dark:bg-gray-900 dark:border-gray-800';
}

function actionTone(tone: RepairAction['tone']) {
  if (tone === 'green') return 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200 dark:hover:bg-green-900/30';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200 dark:hover:bg-amber-900/30';
  if (tone === 'red') return 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200 dark:hover:bg-red-900/30';
  return 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200 dark:hover:bg-blue-900/30';
}

function healthLabel(snapshot: NetworkRepairSnapshot) {
  const failCount = snapshot.checks.filter((item) => item.status === 'fail').length;
  const warnCount = snapshot.checks.filter((item) => item.status === 'warn').length;
  if (!snapshot.generatedAt) return { text: '未诊断', className: 'text-gray-500' };
  if (failCount > 0) return { text: `${failCount} 项异常`, className: 'text-red-600 dark:text-red-300' };
  if (warnCount > 0) return { text: `${warnCount} 项警告`, className: 'text-amber-600 dark:text-amber-300' };
  return { text: '基础网络正常', className: 'text-green-600 dark:text-green-300' };
}

function shortOutput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}\n...` : trimmed;
}

export default function NetworkRepairTool() {
  const ready = useToolTheme();
  const [snapshot, setSnapshot] = useState<NetworkRepairSnapshot>(EMPTY_SNAPSHOT);
  const [selectedIndex, setSelectedIndex] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [runningAction, setRunningAction] = useState('');
  const [message, setMessage] = useState('点击一键诊断读取当前网络状态。');
  const [error, setError] = useState('');
  const [lastOutput, setLastOutput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await invoke<NetworkRepairSnapshot>('system_network_repair_snapshot');
      setSnapshot(result);
      setSelectedIndex((current) => {
        if (current === 'all') return current;
        return result.adapters.some((item) => item.interfaceIndex === current) ? current : 'all';
      });
      setMessage(`诊断完成：${result.generatedAt}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeAdapters = useMemo(
    () => snapshot.adapters.filter((item) => ['up', 'connected', '已连接'].includes(item.status.toLowerCase())),
    [snapshot.adapters],
  );
  const selectedAdapter =
    selectedIndex === 'all' ? null : snapshot.adapters.find((item) => item.interfaceIndex === selectedIndex) ?? null;
  const health = healthLabel(snapshot);
  const proxyActive = snapshot.proxy.userProxyEnabled || /proxy server|代理服务器/i.test(snapshot.proxy.winhttp);

  const runAction = async (action: RepairAction) => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setRunningAction(`${action.id}-${action.dnsPreset || ''}`);
    setError('');
    setMessage('');
    setLastOutput('');
    try {
      const result = await invoke<NetworkRepairActionResult>('system_network_repair_action', {
        request: {
          action: action.id,
          dnsPreset: action.dnsPreset,
          interfaceIndex: action.needsAdapter && selectedIndex !== 'all' ? selectedIndex : null,
        },
      });
      setSnapshot(result.snapshot);
      setLastOutput(shortOutput(result.output));
      setMessage(result.needsReboot ? `${result.message}。建议重启电脑。` : result.message);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunningAction('');
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <ToolHeader
        icon="🛟"
        title="断网急救箱"
        subtitle="诊断网卡、网关、DNS、代理和 Hosts，按项修复 Windows 网络异常"
        actions={
          <>
            <ToolbarButton onClick={() => void load()} disabled={loading || Boolean(runningAction)}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              一键诊断
            </ToolbarButton>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <aside className="flex min-h-0 flex-col gap-4 overflow-auto">
          <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <StatusMessage message={message} error={error} />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                <div className="text-xs text-slate-500">网络状态</div>
                <div className={`mt-1 text-lg font-semibold ${health.className}`}>{health.text}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                <div className="text-xs text-slate-500">管理员</div>
                <div className="mt-1 text-lg font-semibold">{snapshot.isAdmin ? '已提升' : '普通权限'}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                <div className="text-xs text-slate-500">已连接网卡</div>
                <div className="mt-1 text-lg font-semibold">{activeAdapters.length}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                <div className="text-xs text-slate-500">Hosts 项</div>
                <div className="mt-1 text-lg font-semibold">{snapshot.hosts.customEntries}</div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Network size={16} />
                修复目标
              </div>
              <select
                value={selectedIndex}
                onChange={(event) =>
                  setSelectedIndex(event.target.value === 'all' ? 'all' : Number(event.target.value))
                }
                className="h-8 max-w-[180px] rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="all">所有已连接网卡</option>
                {snapshot.adapters.map((item) => (
                  <option key={item.interfaceIndex} value={item.interfaceIndex}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 space-y-2">
              {snapshot.adapters.map((item) => (
                <button
                  key={item.interfaceIndex}
                  onClick={() => setSelectedIndex(item.interfaceIndex)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedIndex === item.interfaceIndex
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{item.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {item.status || '未知'}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">{item.description || item.macAddress || '-'}</div>
                  <div className="mt-2 grid gap-1 font-mono text-[11px] text-slate-500">
                    <span>IP {item.ipAddresses.length ? item.ipAddresses.join(', ') : '-'}</span>
                    <span>网关 {item.gateways.length ? item.gateways.join(', ') : '-'}</span>
                    <span>DNS {item.dnsServers.length ? item.dnsServers.join(', ') : '自动获取'}</span>
                  </div>
                </button>
              ))}
              {snapshot.adapters.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400 dark:border-slate-800">
                  未读取到网络适配器
                </div>
              )}
            </div>
          </section>
        </aside>

        <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-4 overflow-hidden">
          <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
            {snapshot.checks.map((item) => {
              const Icon = item.status === 'ok' ? CheckCircle2 : item.status === 'fail' ? XCircle : AlertTriangle;
              return (
                <div key={item.id} className={`rounded-lg border p-3 ${statusTone(item.status)}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Icon size={16} />
                      {item.label}
                    </div>
                    {typeof item.latencyMs === 'number' && <span className="text-[11px] opacity-75">{item.latencyMs}ms</span>}
                  </div>
                  <div className="mt-2 truncate font-mono text-xs opacity-80">{item.target}</div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 opacity-90">{item.detail}</div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4 max-xl:grid-cols-1">
            <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Wrench size={16} />
                修复操作
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 max-md:grid-cols-1">
                {REPAIR_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  const key = `${action.id}-${action.dnsPreset || ''}`;
                  return (
                    <button
                      key={`${action.id}-${action.label}`}
                      onClick={() => void runAction(action)}
                      disabled={Boolean(runningAction) || loading}
                      className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${actionTone(action.tone)}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          {runningAction === key ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
                          {action.label}
                        </div>
                        {action.needsAdapter && (
                          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] dark:bg-slate-950/40">
                            {selectedAdapter?.name || '全部'}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-xs leading-5 opacity-85">{action.description}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle size={16} />
                诊断建议
              </div>
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {snapshot.suggestions.map((item) => (
                  <div key={item} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-950">
                    {item}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_360px] gap-4 overflow-hidden max-xl:grid-cols-1">
            <section className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <TerminalSquare size={16} />
                执行日志
              </div>
              <pre className="mt-3 min-h-48 whitespace-pre-wrap rounded-lg bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100">
                {lastOutput || '等待执行修复操作...'}
              </pre>
            </section>

            <aside className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-sm font-semibold">代理 / Hosts</div>
              <div className="mt-3 space-y-3 text-sm">
                <div className={`rounded-lg border p-3 ${proxyActive ? statusTone('warn') : statusTone('ok')}`}>
                  <div className="font-semibold">系统代理</div>
                  <div className="mt-2 text-xs leading-5">
                    <div>用户代理：{snapshot.proxy.userProxyEnabled ? snapshot.proxy.userProxyServer || '已启用' : '未启用'}</div>
                    <div className="mt-1 line-clamp-4 whitespace-pre-wrap font-mono opacity-80">{snapshot.proxy.winhttp || '-'}</div>
                  </div>
                </div>
                <div className={`rounded-lg border p-3 ${snapshot.hosts.suspiciousEntries.length ? statusTone('warn') : statusTone('ok')}`}>
                  <div className="font-semibold">Hosts</div>
                  <div className="mt-2 break-all font-mono text-xs opacity-80">{snapshot.hosts.path || '-'}</div>
                  <div className="mt-2 text-xs">自定义项 {snapshot.hosts.customEntries} · {snapshot.hosts.writable ? '可直接写入' : '需要管理员'}</div>
                  {snapshot.hosts.suspiciousEntries.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {snapshot.hosts.suspiciousEntries.map((item) => (
                        <div key={item} className="truncate rounded bg-white/60 px-2 py-1 font-mono text-[11px] dark:bg-slate-950/50">
                          {item}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
