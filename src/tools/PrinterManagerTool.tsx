import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  Activity,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  FileScan,
  ListRestart,
  ListX,
  PauseCircle,
  PlayCircle,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Stethoscope,
  Trash2,
  Wrench,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { EmptyState, StatusMessage, ToolbarButton, formatBytes } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';

interface PrinterEntry {
  name: string;
  driverName: string;
  portName: string;
  shared: boolean;
  shareName: string;
  published: boolean;
  deviceType: string;
  printerStatus: string;
  printerStatusLabel: string;
  workOffline: boolean;
  default: boolean;
  network: boolean;
  local: boolean;
  location: string;
  comment: string;
  colorSupported: boolean;
  duplexingMode: string;
  paperSize: string;
  printQuality: string;
  jobsCount: number;
  paused: boolean;
  keepPrintedJobs: boolean;
}

interface PrinterJobEntry {
  printerName: string;
  id: number;
  documentName: string;
  userName: string;
  jobStatus: string;
  submittedTime: string;
  size: number;
  totalPages: number;
}

interface ScannerEntry {
  name: string;
  deviceId: string;
  manufacturer: string;
  service: string;
  status: string;
  pnpClass: string;
}

interface PrinterManagerSnapshot {
  printers: PrinterEntry[];
  jobs: PrinterJobEntry[];
  scanners: ScannerEntry[];
  defaultPrinter: string;
  printerCount: number;
  scannerCount: number;
  jobCount: number;
  generatedAt: string;
  message: string;
}

interface PrinterDiagnosticCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail' | string;
  detail: string;
}

interface PrinterDiagnosticResult {
  printerName: string;
  overallStatus: 'ok' | 'warn' | 'fail' | string;
  overallLabel: string;
  checks: PrinterDiagnosticCheck[];
}

const EMPTY_SNAPSHOT: PrinterManagerSnapshot = {
  printers: [],
  jobs: [],
  scanners: [],
  defaultPrinter: '',
  printerCount: 0,
  scannerCount: 0,
  jobCount: 0,
  generatedAt: '',
  message: '点击刷新读取当前电脑连接的打印机和扫描设备。',
};

const FILTERS = [
  ['all', '全部'],
  ['ready', '可用'],
  ['offline', '离线/异常'],
  ['network', '网络'],
  ['local', '本地'],
] as const;

type FilterKey = (typeof FILTERS)[number][0];

function printerMatches(item: PrinterEntry, keyword: string) {
  if (!keyword) return true;
  return [
    item.name,
    item.driverName,
    item.portName,
    item.location,
    item.comment,
    item.shareName,
    item.deviceType,
    item.printerStatus,
  ]
    .join(' ')
    .toLowerCase()
    .includes(keyword);
}

function isPrinterReady(item: PrinterEntry) {
  const status = item.printerStatus.toLowerCase();
  return !item.workOffline && !item.paused && ['0', '3', 'normal', 'idle'].includes(status);
}

function isPrinterProblem(item: PrinterEntry) {
  return !isPrinterReady(item);
}

function statusTone(item: PrinterEntry) {
  if (isPrinterReady(item)) return 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300';
  if (item.paused || item.workOffline || ['7', 'offline'].includes(item.printerStatus.toLowerCase())) {
    return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300';
  }
  return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300';
}

function printerStatusText(item: PrinterEntry) {
  if (item.paused) return '已暂停';
  if (item.workOffline) return '脱机使用';
  return item.printerStatusLabel;
}

function diagnosticTone(status: string) {
  if (status === 'ok') return 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300';
  if (status === 'warn') return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300';
  return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300';
}

export default function PrinterManagerTool() {
  const ready = useToolTheme();
  const [snapshot, setSnapshot] = useState<PrinterManagerSnapshot>(EMPTY_SNAPSHOT);
  const [selectedName, setSelectedName] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostic, setDiagnostic] = useState<PrinterDiagnosticResult | null>(null);
  const [message, setMessage] = useState(EMPTY_SNAPSHOT.message);
  const [error, setError] = useState('');

  const selected = useMemo(
    () => snapshot.printers.find((item) => item.name === selectedName) || snapshot.printers[0] || null,
    [selectedName, snapshot.printers]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setDiagnostic(null);
    try {
      const next = await invoke<PrinterManagerSnapshot>('system_printer_manager_snapshot');
      setSnapshot(next);
      setMessage(next.message);
      setSelectedName((current) => {
        if (current && next.printers.some((item) => item.name === current)) return current;
        return next.defaultPrinter || next.printers[0]?.name || '';
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredPrinters = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return snapshot.printers.filter((item) => {
      if (filter === 'ready' && !isPrinterReady(item)) return false;
      if (filter === 'offline' && !isPrinterProblem(item)) return false;
      if (filter === 'network' && !item.network) return false;
      if (filter === 'local' && !item.local) return false;
      return printerMatches(item, keyword);
    });
  }, [filter, search, snapshot.printers]);

  const selectedJobs = useMemo(
    () => snapshot.jobs.filter((item) => item.printerName === selected?.name),
    [selected?.name, snapshot.jobs]
  );

  useEffect(() => {
    setDiagnostic(null);
  }, [selected?.name]);

  const runPrinterAction = async (action: string, printerName = selected?.name) => {
    const globalActions = ['open-settings', 'open-scan', 'add-printer', 'open-troubleshooter', 'restart-spooler'];
    if (!printerName && !globalActions.includes(action)) return;
    setLoading(true);
    setError('');
    setDiagnostic(null);
    try {
      const next = await invoke<PrinterManagerSnapshot>('system_printer_action', {
        request: { action, printerName },
      });
      setSnapshot(next);
      setMessage(next.message);
      if (printerName && next.printers.some((item) => item.name === printerName)) {
        setSelectedName(printerName);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const removeSelectedPrinter = async () => {
    if (!selected) return;
    const detail = [
      `名称：${selected.name}`,
      selected.default ? '这台打印机当前是默认打印机。' : '',
      selected.jobsCount > 0 ? `当前还有 ${selected.jobsCount} 个打印任务。` : '',
      '删除后如需恢复，需要重新添加打印机或重新安装驱动。',
    ]
      .filter(Boolean)
      .join('\n');
    if (!window.confirm(`确定删除这台打印机吗？\n\n${detail}`)) return;
    await runPrinterAction('remove-printer', selected.name);
  };

  const runJobAction = async (job: PrinterJobEntry, action: string) => {
    if (action === 'remove' && !window.confirm(`确定取消打印任务“${job.documentName || job.id}”吗？`)) {
      return;
    }
    setLoading(true);
    setError('');
    setDiagnostic(null);
    try {
      const next = await invoke<PrinterManagerSnapshot>('system_print_job_action', {
        request: {
          action,
          printerName: job.printerName,
          jobId: job.id,
        },
      });
      setSnapshot(next);
      setMessage(next.message);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const clearSelectedQueue = async () => {
    if (!selected || selectedJobs.length === 0) return;
    if (!window.confirm(`确定清空“${selected.name}”的 ${selectedJobs.length} 个打印任务吗？`)) return;
    setLoading(true);
    setError('');
    setDiagnostic(null);
    try {
      const next = await invoke<PrinterManagerSnapshot>('system_print_job_action', {
        request: {
          action: 'clear-printer',
          printerName: selected.name,
          jobId: 0,
        },
      });
      setSnapshot(next);
      setMessage(next.message);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const diagnosePrinter = async () => {
    if (!selected?.name) return;
    setDiagnosing(true);
    setError('');
    try {
      const result = await invoke<PrinterDiagnosticResult>('system_printer_diagnose', {
        printerName: selected.name,
      });
      setDiagnostic(result);
      setMessage(`${result.printerName} 检测完成：${result.overallLabel}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setDiagnosing(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🖨️"
        title="打印机管理"
        subtitle="检测连接状态和真实可用性，管理打印队列、默认打印机、测试页、扫描设备和故障处理入口"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton onClick={() => void runPrinterAction('add-printer')} disabled={loading}>
              <Plus size={14} />
              添加打印机
            </ToolbarButton>
            <ToolbarButton onClick={() => void runPrinterAction('open-scan')} disabled={loading}>
              <FileScan size={14} />
              打开扫描
            </ToolbarButton>
            <ToolbarButton onClick={() => void runPrinterAction('open-settings')} disabled={loading}>
              <Settings size={14} />
              系统设置
            </ToolbarButton>
            <ToolbarButton onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              刷新
            </ToolbarButton>
          </div>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-3 p-4 max-lg:grid-cols-1">
        <aside className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <StatusMessage message={message} error={error} />
          <section className="grid grid-cols-3 gap-2">
            <MetricCard label="打印机" value={snapshot.printerCount} />
            <MetricCard label="队列" value={snapshot.jobCount} warn={snapshot.jobCount > 0} />
            <MetricCard label="扫描设备" value={snapshot.scannerCount} />
          </section>

          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
            <Search size={16} className="text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索打印机、驱动、端口..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>

          <div className="grid grid-cols-[0.9fr_0.9fr_1.25fr_0.9fr_0.9fr] gap-1">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`whitespace-nowrap rounded-lg border px-1.5 py-1.5 text-[11px] ${
                  filter === key
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'border-gray-200 bg-white hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <section className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {filteredPrinters.map((item) => {
              const active = selected?.name === item.name;
              return (
                <button
                  key={item.name}
                  onClick={() => setSelectedName(item.name)}
                  className={`w-full border-b border-gray-100 p-3 text-left transition-colors dark:border-gray-800 ${
                    active ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Printer size={16} className={active ? 'text-blue-600' : 'text-gray-400'} />
                        <span className="truncate text-sm font-semibold">{item.name}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-gray-500">{item.driverName || item.portName || '-'}</div>
                    </div>
                    {item.default && <CheckCircle size={16} className="shrink-0 text-green-500" />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] ${statusTone(item)}`}>
                      {printerStatusText(item)}
                    </span>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {item.network ? '网络' : '本地'}
                    </span>
                    {item.jobsCount > 0 && (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                        {item.jobsCount} 个任务
                      </span>
                    )}
                    {item.keepPrintedJobs && (
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                        保留任务
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            {filteredPrinters.length === 0 && (
              <EmptyState icon={<Printer size={32} />} text={snapshot.printers.length === 0 ? '未检测到打印机' : '没有匹配的打印机'} />
            )}
          </section>
        </aside>

        <section className="min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {selected ? (
            <div className="flex min-h-full flex-col">
              <div className="border-b border-gray-200 p-4 dark:border-gray-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-semibold">{selected.name}</h2>
                      {selected.default && (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-300">
                          默认
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone(selected)}`}>
                        {printerStatusText(selected)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">{selected.driverName || '未读取到驱动名称'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ToolbarButton
                      onClick={() => void runPrinterAction('set-default')}
                      disabled={loading || selected.default}
                    >
                      <CheckCircle size={14} />
                      设为默认
                    </ToolbarButton>
                    <ToolbarButton onClick={() => void runPrinterAction('test-page')} disabled={loading}>
                      <Printer size={14} />
                      打印测试页
                    </ToolbarButton>
                    <ToolbarButton onClick={() => void runPrinterAction('open-queue')} disabled={loading}>
                      <ExternalLink size={14} />
                      打开队列
                    </ToolbarButton>
                    <ToolbarButton onClick={() => void runPrinterAction('open-properties')} disabled={loading}>
                      <Settings size={14} />
                      属性
                    </ToolbarButton>
                    <ToolbarButton onClick={() => void runPrinterAction('open-preferences')} disabled={loading}>
                      <SlidersHorizontal size={14} />
                      首选项
                    </ToolbarButton>
                    <ToolbarButton onClick={() => void diagnosePrinter()} disabled={loading || diagnosing}>
                      <Stethoscope size={14} className={diagnosing ? 'animate-pulse' : ''} />
                      检测可用性
                    </ToolbarButton>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-3">
                  <InfoPanel title="设备信息">
                    <InfoRow label="端口" value={selected.portName} />
                    <InfoRow label="类型" value={selected.deviceType || (selected.network ? '网络打印机' : '本地打印机')} />
                    <InfoRow label="位置" value={selected.location} />
                    <InfoRow label="备注" value={selected.comment} />
                    <InfoRow label="共享" value={selected.shared ? selected.shareName || '已共享' : '未共享'} />
                    <InfoRow label="发布" value={selected.published ? '已发布' : '未发布'} />
                    <InfoRow label="队列暂停" value={selected.paused ? '已暂停' : '未暂停'} />
                    <InfoRow label="保留任务" value={selected.keepPrintedJobs ? '开启' : '关闭'} />
                  </InfoPanel>

                  <InfoPanel title="打印能力">
                    <InfoRow label="彩色" value={selected.colorSupported ? '支持' : '未读取到支持'} />
                    <InfoRow label="双面" value={selected.duplexingMode || '-'} />
                    <InfoRow label="纸张" value={selected.paperSize || '-'} />
                    <InfoRow label="质量" value={selected.printQuality || '-'} />
                  </InfoPanel>

                  <InfoPanel title={`打印队列 (${selectedJobs.length})`}>
                    {selectedJobs.length ? (
                      <div className="overflow-auto">
                        <div className="grid min-w-[760px] grid-cols-[70px_minmax(180px,1fr)_120px_110px_100px_120px] border-b border-gray-100 px-2 py-2 text-xs font-medium text-gray-500 dark:border-gray-800">
                          <span>ID</span>
                          <span>文档</span>
                          <span>用户</span>
                          <span>状态</span>
                          <span>大小</span>
                          <span>操作</span>
                        </div>
                        {selectedJobs.map((job) => (
                          <div key={`${job.printerName}-${job.id}`} className="grid min-w-[760px] grid-cols-[70px_minmax(180px,1fr)_120px_110px_100px_120px] items-center border-b border-gray-100 px-2 py-2 text-sm dark:border-gray-800">
                            <span className="font-mono text-xs text-gray-500">{job.id}</span>
                            <span className="truncate" title={job.documentName}>{job.documentName || '-'}</span>
                            <span className="truncate text-gray-500">{job.userName || '-'}</span>
                            <span className="truncate text-gray-500">{job.jobStatus || '-'}</span>
                            <span className="text-gray-500">{formatBytes(job.size)}</span>
                            <span className="flex gap-1">
                              <button
                                onClick={() => void runJobAction(job, 'restart')}
                                className="rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
                                title="重启任务"
                              >
                                <ListRestart size={15} />
                              </button>
                              <button
                                onClick={() => void runJobAction(job, 'remove')}
                                className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
                                title="取消任务"
                              >
                                <ListX size={15} />
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState icon={<CheckCircle size={32} />} text="当前打印队列为空" />
                    )}
                  </InfoPanel>

                  <InfoPanel title="可用性检测">
                    {diagnostic && diagnostic.printerName === selected.name ? (
                      <div className="space-y-3">
                        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${diagnosticTone(diagnostic.overallStatus)}`}>
                          {diagnostic.overallStatus === 'ok' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                          <span className="font-medium">{diagnostic.overallLabel}</span>
                        </div>
                        <div className="space-y-2">
                          {diagnostic.checks.map((check) => (
                            <div key={check.id} className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                              {check.status === 'ok' ? (
                                <CheckCircle size={16} className="mt-0.5 shrink-0 text-green-500" />
                              ) : (
                                <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${check.status === 'warn' ? 'text-amber-500' : 'text-red-500'}`} />
                              )}
                              <div className="min-w-0">
                                <div className="text-sm font-medium">{check.label}</div>
                                <div className="mt-0.5 break-words text-xs text-gray-500">{check.detail}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-800">
                        <div className="flex items-start gap-2">
                          <Activity size={16} className="mt-0.5 text-blue-500" />
                          <p>点击“检测可用性”后，会检查后台服务、Windows 状态、脱机模式、队列异常和网络端口连通性。</p>
                        </div>
                      </div>
                    )}
                  </InfoPanel>
                </div>

                <aside className="space-y-3">
                  <InfoPanel title="扫描设备">
                    {snapshot.scanners.length ? (
                      <div className="space-y-2">
                        {snapshot.scanners.map((item) => (
                          <div key={item.deviceId || item.name} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                            <div className="flex items-start gap-2">
                              <FileScan size={16} className="mt-0.5 text-blue-500" />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{item.name}</div>
                                <div className="mt-1 truncate text-xs text-gray-500">{item.manufacturer || item.pnpClass || '-'}</div>
                                <div className="mt-1 text-xs text-gray-400">{item.status || '状态未知'}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-800">
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={16} className="mt-0.5 text-amber-500" />
                          <p>未检测到独立扫描设备。部分一体机需要安装厂商驱动后才会暴露 WIA/TWAIN 扫描接口。</p>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => void runPrinterAction('open-scan')}
                      disabled={loading}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <FileScan size={15} />
                      打开 Windows 扫描
                    </button>
                  </InfoPanel>

                  <InfoPanel title="快照">
                    <InfoRow label="默认打印机" value={snapshot.defaultPrinter || '-'} />
                    <InfoRow label="生成时间" value={snapshot.generatedAt || '-'} />
                    <InfoRow label="可用打印机" value={String(snapshot.printers.filter(isPrinterReady).length)} />
                    <InfoRow label="异常/离线" value={String(snapshot.printers.filter(isPrinterProblem).length)} />
                  </InfoPanel>

                  <InfoPanel title="故障处理">
                    <div className="space-y-2">
                      <button
                        onClick={() => void runPrinterAction(selected.paused ? 'resume-printer' : 'pause-printer')}
                        disabled={loading}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                      >
                        {selected.paused ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
                        {selected.paused ? '恢复打印机' : '暂停打印机'}
                      </button>
                      {selected.workOffline && (
                        <button
                          onClick={() => void runPrinterAction('disable-offline')}
                          disabled={loading}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-900/50 dark:bg-gray-900 dark:text-amber-300 dark:hover:bg-amber-900/20"
                        >
                          <RefreshCw size={15} />
                          取消脱机使用
                        </button>
                      )}
                      <button
                        onClick={() => void runPrinterAction('open-queue')}
                        disabled={loading}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                      >
                        <ExternalLink size={15} />
                        打开当前队列
                      </button>
                      <button
                        onClick={() => void clearSelectedQueue()}
                        disabled={loading || selectedJobs.length === 0}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-900/20"
                      >
                        <ListX size={15} />
                        清空当前队列
                      </button>
                      <button
                        onClick={() => void runPrinterAction('restart-spooler')}
                        disabled={loading}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                      >
                        <Wrench size={15} />
                        重启打印后台服务
                      </button>
                      <button
                        onClick={() => void runPrinterAction('open-troubleshooter')}
                        disabled={loading}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                      >
                        <Settings size={15} />
                        打开疑难解答
                      </button>
                    </div>
                  </InfoPanel>

                  <InfoPanel title="高级管理">
                    <div className="space-y-2">
                      <button
                        onClick={() => void runPrinterAction('open-properties')}
                        disabled={loading}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                      >
                        <Settings size={15} />
                        打开打印机属性
                      </button>
                      <button
                        onClick={() => void runPrinterAction('open-preferences')}
                        disabled={loading}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                      >
                        <SlidersHorizontal size={15} />
                        打开打印首选项
                      </button>
                      <button
                        onClick={() => void removeSelectedPrinter()}
                        disabled={loading}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-900/20"
                      >
                        <Trash2 size={15} />
                        删除打印机
                      </button>
                    </div>
                  </InfoPanel>
                </aside>
              </div>
            </div>
          ) : (
            <EmptyState icon={<Printer size={40} />} text="未检测到打印机，请尝试添加打印机或刷新" />
          )}
        </section>
      </main>
    </div>
  );
}

function MetricCard({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${warn ? 'text-amber-600 dark:text-amber-300' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/50">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 border-b border-gray-100 py-2 text-sm last:border-b-0 dark:border-gray-800">
      <span className="text-gray-500">{label}</span>
      <span className="min-w-0 break-words">{value || '-'}</span>
    </div>
  );
}
