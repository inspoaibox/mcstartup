import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { AlertTriangle, Check, Globe2, RefreshCw, Search, Shield, Wifi } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { StatusMessage, ToolbarButton } from './systemToolUtils';
import { useToolDataStore, type DnsOriginalRecord } from '../stores/toolDataStore';

interface DnsAdapter {
  interfaceIndex: number;
  name: string;
  description: string;
  status: string;
  macAddress: string;
  dnsServers: string[];
}

interface PendingDnsChange {
  sourceName: string;
  servers: string[];
}

const DNS_PRESETS = [
  { name: '自动获取', servers: [] },
  { name: '阿里 DNS', servers: ['223.5.5.5', '223.6.6.6'] },
  { name: '腾讯 DNS', servers: ['119.29.29.29', '182.254.116.116'] },
  { name: 'Cloudflare', servers: ['1.1.1.1', '1.0.0.1'] },
  { name: 'Google', servers: ['8.8.8.8', '8.8.4.4'] },
  { name: 'AdGuard', servers: ['94.140.14.14', '94.140.15.15'] },
];

export default function DnsSwitchTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateDnsSwitchData } = useToolDataStore();
  const [items, setItems] = useState<DnsAdapter[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [customDns, setCustomDns] = useState('223.5.5.5, 223.6.6.6');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pendingChange, setPendingChange] = useState<PendingDnsChange | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await invoke<DnsAdapter[]>('system_dns_adapters');
      setItems(rows);
      setSelectedIndex((current) => current ?? rows[0]?.interfaceIndex ?? null);
      setMessage(`已读取 ${rows.length} 个网络适配器`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loaded) void loadData();
  }, [loadData, loaded]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) =>
      [item.name, item.description, item.status, item.macAddress, item.dnsServers.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }, [items, search]);

  const selected = items.find((item) => item.interfaceIndex === selectedIndex) ?? null;
  const originalKey = selected ? `${selected.interfaceIndex}|${selected.name}` : '';
  const originalRecord = originalKey ? data.dnsSwitch?.originals?.[originalKey] : undefined;

  const describeDns = (servers: string[]) => (servers.length ? servers.join(', ') : '自动获取 DNS');
  const sameDns = (a: string[], b: string[]) =>
    a.length === b.length && a.every((value, index) => value.trim().toLowerCase() === b[index]?.trim().toLowerCase());

  const rememberOriginalIfNeeded = (adapter: DnsAdapter) => {
    const key = `${adapter.interfaceIndex}|${adapter.name}`;
    const current = data.dnsSwitch?.originals || {};
    if (current[key]) return;
    const nextRecord: DnsOriginalRecord = {
      interfaceIndex: adapter.interfaceIndex,
      name: adapter.name,
      dnsServers: adapter.dnsServers,
      capturedAt: new Date().toISOString(),
    };
    updateDnsSwitchData({
      version: 'mcheng-dns-switch-v1',
      originals: {
        ...current,
        [key]: nextRecord,
      },
    });
  };

  const stageDns = (servers: string[], sourceName = '自定义 DNS') => {
    if (!selected) {
      setError('请选择网卡');
      return;
    }
    setError('');
    setMessage(`已选择「${sourceName}」，确认后才会修改系统 DNS`);
    setPendingChange({ servers, sourceName });
  };

  const stageCustomDns = () => {
    const servers = customDns.split(/[,\s]+/).filter(Boolean);
    stageDns(servers, '自定义 DNS');
  };

  const applyPendingDns = async () => {
    if (!selected) {
      setError('请选择网卡');
      return;
    }
    if (!pendingChange) {
      setError('请先选择一个 DNS 方案');
      return;
    }
    const { servers } = pendingChange;
    const targetDns = describeDns(servers);

    rememberOriginalIfNeeded(selected);
    setLoading(true);
    setError('');
    setMessage(`正在应用 DNS：${targetDns}`);
    try {
      const rows = await invoke<DnsAdapter[]>('system_dns_set', {
        request: { interfaceIndex: selected.interfaceIndex, servers },
      });
      setItems(rows);
      setPendingChange(null);
      setMessage(servers.length ? `已应用 DNS: ${servers.join(', ')}` : '已恢复自动获取 DNS');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const restoreOriginal = async () => {
    if (!selected) {
      setError('请选择网卡');
      return;
    }
    if (!originalRecord) {
      setError('当前网卡还没有记录原始 DNS。请先选择曾经通过本工具修改过的网卡。');
      return;
    }
    if (sameDns(selected.dnsServers, originalRecord.dnsServers)) {
      setMessage('当前 DNS 已经与记录的原始 DNS 一致');
      return;
    }
    stageDns(originalRecord.dnsServers, '恢复原始 DNS');
  };

  const flushDns = async () => {
    setError('');
    setMessage('');
    try {
      await invoke('system_dns_flush');
      setMessage('DNS 缓存已刷新');
    } catch (err) {
      setError(String(err));
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🌐"
        title="DNS 快速切换"
        subtitle="读取本机网卡，一键切换常用 DNS 或恢复自动获取"
        actions={
          <>
            <ToolbarButton onClick={() => void flushDns()}>刷新 DNS 缓存</ToolbarButton>
            <ToolbarButton onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </ToolbarButton>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-4 p-4 max-lg:grid-cols-1">
        <section className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <Search size={16} className="text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索网卡..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto">
            {filtered.map((item) => (
              <button
                key={item.interfaceIndex}
                onClick={() => {
                  setSelectedIndex(item.interfaceIndex);
                  setPendingChange(null);
                }}
                className={`w-full rounded-lg border p-3 text-left ${
                  selectedIndex === item.interfaceIndex
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{item.name}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {item.status || '未知'}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-gray-500">{item.description || item.macAddress}</p>
                <p className="mt-1 truncate font-mono text-xs text-gray-400">
                  {item.dnsServers.length ? item.dnsServers.join(', ') : '自动获取'}
                </p>
              </button>
            ))}
          </div>
        </section>

        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <StatusMessage message={message} error={error} />
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
            <div className="flex items-center gap-1.5 font-semibold">
              <Shield size={14} />
              需要确认和管理员权限
            </div>
            <p className="mt-1">
              应用 DNS 前会先弹出确认窗口；Windows 修改网卡 DNS 通常需要管理员权限，普通执行失败时会自动请求 UAC 授权。
            </p>
          </div>
          <div className="mt-4 rounded-lg bg-gray-50 p-4 dark:bg-gray-950">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Wifi size={16} />
              当前网卡
            </div>
            <div className="mt-3 grid gap-2 text-sm">
              <div>名称：{selected?.name || '-'}</div>
              <div>描述：{selected?.description || '-'}</div>
              <div>DNS：{selected?.dnsServers.length ? selected.dnsServers.join(', ') : '自动获取'}</div>
              <div>原始 DNS：{originalRecord ? describeDns(originalRecord.dnsServers) : '尚未记录'}</div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-900/20">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-200">
              <Check size={16} />
              待应用方案
            </div>
            {pendingChange ? (
              <div className="mt-3 space-y-2 text-sm text-blue-700 dark:text-blue-100">
                <div>来源：{pendingChange.sourceName}</div>
                <div>网卡：{selected?.name || '-'}</div>
                <div>当前：{selected ? describeDns(selected.dnsServers) : '-'}</div>
                <div>目标：{describeDns(pendingChange.servers)}</div>
                <div className="pt-1 text-xs text-blue-600 dark:text-blue-200">
                  只有点击“确认应用 DNS”才会修改系统网络配置；如果 Windows 要求管理员权限，届时才会弹出授权。
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    onClick={() => void applyPendingDns()}
                    disabled={loading}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Check size={16} />
                    确认应用 DNS
                  </button>
                  <button
                    onClick={() => {
                      setPendingChange(null);
                      setMessage('已取消待应用 DNS 方案');
                    }}
                    disabled={loading}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-blue-200 px-4 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:text-blue-100 dark:hover:bg-blue-900/30"
                  >
                    取消选择
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-blue-600 dark:text-blue-200">
                先选择下方 DNS 方案，这里会显示目标内容；确认后才会真正写入系统。
              </p>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <button
              onClick={() => void restoreOriginal()}
              disabled={!selected || !originalRecord || loading}
              className="rounded-lg border border-green-200 bg-green-50 p-4 text-left text-green-700 hover:bg-green-100 disabled:opacity-50 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200 dark:hover:bg-green-900/30"
            >
              <div className="flex items-center gap-2 font-semibold">
                <Shield size={16} />
                恢复原始 DNS
              </div>
              <p className="mt-2 font-mono text-xs">
                {originalRecord ? describeDns(originalRecord.dnsServers) : '首次修改前会自动记录'}
              </p>
            </button>
            {DNS_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => stageDns(preset.servers, preset.name)}
                className={`rounded-lg border p-4 text-left hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800 ${
                  pendingChange?.sourceName === preset.name
                    ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20'
                    : 'border-gray-200'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold">
                  <Globe2 size={16} />
                  {preset.name}
                </div>
                <p className="mt-2 font-mono text-xs text-gray-500">
                  {preset.servers.length ? preset.servers.join(' / ') : 'DHCP 自动获取'}
                </p>
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle size={15} className="text-amber-500" />
              自定义 DNS
            </div>
            <div className="mt-3 flex gap-2 max-sm:flex-col">
              <input
                value={customDns}
                onChange={(event) => setCustomDns(event.target.value)}
                placeholder="多个 DNS 用逗号分隔"
                className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
              />
              <button
                onClick={stageCustomDns}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Check size={16} />
                选择方案
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
