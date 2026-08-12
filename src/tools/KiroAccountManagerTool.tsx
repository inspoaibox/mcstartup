import { useEffect, useMemo, useRef, useState } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import { open as openExternal } from '@tauri-apps/api/shell';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  FolderOpen,
  KeyRound,
  Loader,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Tags,
  Trash2,
  Upload,
  UserRound,
  Bell,
  Square,
  Shield,
  Settings,
  RotateCcw,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

interface KiroAccount {
  id: string;
  email: string;
  userId?: string | null;
  loginProvider?: string | null;
  tags?: string[] | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: number | null;
  idcRegion?: string | null;
  issuerUrl?: string | null;
  clientId?: string | null;
  scopes?: string | null;
  loginHint?: string | null;
  planName?: string | null;
  planTier?: string | null;
  creditsTotal?: number | null;
  creditsUsed?: number | null;
  bonusTotal?: number | null;
  bonusUsed?: number | null;
  usageResetAt?: number | null;
  status?: string | null;
  statusReason?: string | null;
  quotaQueryLastError?: string | null;
  quotaQueryLastErrorAt?: number | null;
  usageUpdatedAt?: number | null;
  authRaw?: unknown;
  profileRaw?: unknown;
  usageRaw?: unknown;
  createdAt: number;
  lastUsed: number;
}

interface KiroAccountSummary {
  id: string;
  email: string;
  tags?: string[] | null;
  planName?: string | null;
  createdAt: number;
  lastUsed: number;
}

interface KiroFastState {
  accounts: KiroAccountSummary[];
  currentAccountId?: string | null;
  indexPath: string;
  accountsDir: string;
  pendingOauth?: KiroOAuthStartResponse | null;
  backgroundRefresh?: KiroBackgroundRefreshSettings | null;
  backgroundStatus?: KiroBackgroundRefreshStatus | null;
  toolSettings?: KiroToolSettings | null;
}

interface KiroState {
  accounts: KiroAccount[];
  currentAccountId?: string | null;
  indexPath: string;
  accountsDir: string;
  localAuthPath: string;
  localProfilePath: string;
  localStateDbPath: string;
  kiroExePath?: string | null;
  pendingOauth?: KiroOAuthStartResponse | null;
  backgroundRefresh?: KiroBackgroundRefreshSettings | null;
  backgroundStatus?: KiroBackgroundRefreshStatus | null;
  toolSettings?: KiroToolSettings | null;
}

interface KiroLocalStatus {
  authPath: string;
  profilePath: string;
  stateDbPath: string;
  authExists: boolean;
  profileExists: boolean;
  stateDbExists: boolean;
  kiroExePath?: string | null;
  kiroExeSource?: string | null;
  manualKiroExePath?: string | null;
}

interface KiroOAuthStartResponse {
  loginId: string;
  verificationUri: string;
  verificationUriComplete?: string | null;
  callbackUrl?: string | null;
  expiresIn: number;
  intervalSeconds: number;
}

interface KiroRefreshAllResult {
  successCount: number;
  failedCount: number;
  errors: string[];
  startedAt?: number | null;
  finishedAt?: number | null;
}

interface KiroBackgroundRefreshSettings {
  enabled: boolean;
  intervalMinutes: number;
  notifyOnChange: boolean;
}

interface KiroToolSettings {
  manualKiroExePath?: string | null;
  encryptAccounts: boolean;
  exportIncludeSensitiveDefault: boolean;
}

interface KiroBackgroundRefreshHistoryItem {
  startedAt: number;
  finishedAt: number;
  successCount: number;
  failedCount: number;
  errors: string[];
}

interface KiroBackgroundRefreshStatus {
  lastStartedAt?: number | null;
  lastFinishedAt?: number | null;
  nextRunAt?: number | null;
  lastSuccessCount: number;
  lastFailedCount: number;
  lastErrors: string[];
  history: KiroBackgroundRefreshHistoryItem[];
}

interface KiroInstanceInfo {
  accountId: string;
  accountEmail: string;
  instanceDir: string;
  homeDir: string;
  userDataDir: string;
  identityPath: string;
  identityReady: boolean;
  machineId?: string | null;
  serviceMachineId?: string | null;
  createdAt: number;
  updatedAt: number;
  lastStartedAt?: number | null;
  running: boolean;
  pid?: number | null;
}

interface KiroLocalBackupInfo {
  id: string;
  backupDir: string;
  createdAt: number;
  authExists: boolean;
  profileExists: boolean;
  stateDbExists: boolean;
}

type ImportMode = 'json' | 'token';

function accountTags(account?: KiroAccount | null): string[] {
  return Array.isArray(account?.tags) ? account!.tags!.filter(Boolean) : [];
}

function accountToken(account?: KiroAccount | null): string {
  return typeof account?.accessToken === 'string' ? account.accessToken : '';
}

function accountFromSummary(summary: KiroAccountSummary): KiroAccount {
  return {
    id: summary.id,
    email: summary.email,
    tags: Array.isArray(summary.tags) ? summary.tags.filter(Boolean) : [],
    accessToken: '',
    planName: summary.planName,
    createdAt: summary.createdAt,
    lastUsed: summary.lastUsed,
  };
}

function mergeSummaryAccounts(
  summaries: KiroAccountSummary[],
  existingAccounts: KiroAccount[] = []
): KiroAccount[] {
  const existingById = new Map(existingAccounts.map((account) => [account.id, account]));
  return summaries.map((summary) => {
    const existing = existingById.get(summary.id);
    if (!existing) return accountFromSummary(summary);
    return {
      ...existing,
      email: summary.email || existing.email,
      tags: Array.isArray(summary.tags) ? summary.tags.filter(Boolean) : accountTags(existing),
      planName: summary.planName ?? existing.planName,
      createdAt: summary.createdAt || existing.createdAt,
      lastUsed: summary.lastUsed || existing.lastUsed,
    };
  });
}

function chooseSelectedId(
  currentId: string | null,
  accounts: KiroAccount[],
  currentAccountId?: string | null
): string | null {
  if (currentId && accounts.some((account) => account.id === currentId)) return currentId;
  return currentAccountId || accounts[0]?.id || null;
}

function maskToken(token: string): string {
  if (!token) return '-';
  if (token.length <= 14) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 7)}...${token.slice(-6)}`;
}

function formatTime(timestamp?: number | null): string {
  if (!timestamp) return '-';
  const seconds = timestamp > 10_000_000_000 ? Math.floor(timestamp / 1000) : timestamp;
  return new Date(seconds * 1000).toLocaleString();
}

function formatResetTime(timestamp?: number | null): string {
  if (!timestamp) return '周期时间未知';
  const seconds = timestamp > 10_000_000_000 ? Math.floor(timestamp / 1000) : timestamp;
  const target = new Date(seconds * 1000);
  if (Number.isNaN(target.getTime())) return '周期时间未知';
  const now = Date.now();
  const diffMs = target.getTime() - now;
  if (diffMs <= 0) return `已结束 (${target.toLocaleString()})`;
  const totalMinutes = Math.max(1, Math.floor(diffMs / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const relative =
    days > 0
      ? `${days}天${hours ? `${hours}小时` : ''}`
      : hours > 0
        ? `${hours}小时${minutes ? `${minutes}分钟` : ''}`
        : `${minutes}分钟`;
  return `${relative}后 (${target.toLocaleString()})`;
}

function percent(used?: number | null, total?: number | null): number | null {
  if (!total || total <= 0 || used == null) return null;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

function normalizeTagInput(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return 'null';
  }
}

function statusLabel(status?: string | null, reason?: string | null): string {
  if (!status) return '-';
  const labels: Record<string, string> = {
    normal: '正常',
    banned: '受限',
    error: '异常',
  };
  const label = labels[status] || status;
  return reason ? `${label}：${reason}` : label;
}

export default function KiroAccountManagerTool() {
  const ready = useToolTheme();
  const [state, setState] = useState<KiroState | null>(null);
  const [localStatus, setLocalStatus] = useState<KiroLocalStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('json');
  const [jsonInput, setJsonInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [tokenEmail, setTokenEmail] = useState('');
  const [tokenProvider, setTokenProvider] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [oauthSession, setOauthSession] = useState<KiroOAuthStartResponse | null>(null);
  const [callbackInput, setCallbackInput] = useState('');
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const [backgroundInterval, setBackgroundInterval] = useState(30);
  const [backgroundNotify, setBackgroundNotify] = useState(true);
  const [manualKiroPath, setManualKiroPath] = useState('');
  const [encryptAccounts, setEncryptAccounts] = useState(true);
  const [exportSensitive, setExportSensitive] = useState(false);
  const [instances, setInstances] = useState<KiroInstanceInfo[]>([]);
  const [localBackups, setLocalBackups] = useState<KiroLocalBackupInfo[]>([]);
  const [backgroundStatus, setBackgroundStatus] = useState<KiroBackgroundRefreshStatus | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KiroAccount | null>(null);
  const refreshSeq = useRef(0);
  const stateRef = useRef<KiroState | null>(null);

  const selectedAccount = useMemo(
    () => (state?.accounts || []).find((account) => account.id === selectedId) || state?.accounts?.[0] || null,
    [selectedId, state?.accounts]
  );

  function applyBackgroundSettings(settings?: KiroBackgroundRefreshSettings | null) {
    if (!settings) return;
    setBackgroundEnabled(settings.enabled);
    setBackgroundInterval(settings.intervalMinutes);
    setBackgroundNotify(settings.notifyOnChange);
  }

  function applyToolSettings(settings?: KiroToolSettings | null) {
    if (!settings) return;
    setManualKiroPath(settings.manualKiroExePath || '');
    setEncryptAccounts(settings.encryptAccounts);
    setExportSensitive(settings.exportIncludeSensitiveDefault);
  }

  function updateState(nextState: KiroState | ((current: KiroState | null) => KiroState)) {
    setState((current) => {
      const next = typeof nextState === 'function' ? nextState(current) : nextState;
      stateRef.current = next;
      return next;
    });
  }

  async function hydrateFullState(seq: number, currentAccountId?: string | null) {
    const [
      accountsResult,
      localStatusResult,
      instancesResult,
      backupsResult,
      backgroundStatusResult,
    ] = await Promise.allSettled([
        invoke<KiroAccount[]>('kiro_account_tool_list_accounts'),
        invoke<KiroLocalStatus>('kiro_account_tool_local_status'),
        invoke<KiroInstanceInfo[]>('kiro_account_tool_list_instances'),
        invoke<KiroLocalBackupInfo[]>('kiro_account_tool_list_local_backups'),
        invoke<KiroBackgroundRefreshStatus>('kiro_account_tool_get_background_status'),
      ]);
    if (seq !== refreshSeq.current) return;

    const errors: string[] = [];
    if (accountsResult.status === 'fulfilled') {
      const accounts = accountsResult.value;
      updateState((current) => ({
        accounts,
        currentAccountId,
        indexPath: current?.indexPath || '',
        accountsDir: current?.accountsDir || '',
        localAuthPath: current?.localAuthPath || '',
        localProfilePath: current?.localProfilePath || '',
        localStateDbPath: current?.localStateDbPath || '',
        kiroExePath: current?.kiroExePath || null,
        pendingOauth: current?.pendingOauth || null,
        backgroundRefresh: current?.backgroundRefresh || null,
        backgroundStatus: current?.backgroundStatus || null,
        toolSettings: current?.toolSettings || null,
      }));
      setSelectedId((current) => chooseSelectedId(current, accounts, currentAccountId));
    } else {
      errors.push(String(accountsResult.reason));
    }

    if (localStatusResult.status === 'fulfilled') {
      const nextLocalStatus = localStatusResult.value;
      setLocalStatus(nextLocalStatus);
      updateState((current) => ({
        accounts: current?.accounts || [],
        currentAccountId: current?.currentAccountId,
        indexPath: current?.indexPath || '',
        accountsDir: current?.accountsDir || '',
        localAuthPath: nextLocalStatus.authPath,
        localProfilePath: nextLocalStatus.profilePath,
        localStateDbPath: nextLocalStatus.stateDbPath,
        kiroExePath: nextLocalStatus.kiroExePath,
        pendingOauth: current?.pendingOauth || null,
        backgroundRefresh: current?.backgroundRefresh || null,
        backgroundStatus: current?.backgroundStatus || null,
        toolSettings: current?.toolSettings || null,
      }));
    } else {
      errors.push(String(localStatusResult.reason));
    }

    if (instancesResult.status === 'fulfilled') {
      setInstances(instancesResult.value);
    } else {
      errors.push(String(instancesResult.reason));
    }

    if (backupsResult.status === 'fulfilled') {
      setLocalBackups(backupsResult.value);
    } else {
      errors.push(String(backupsResult.reason));
    }

    if (backgroundStatusResult.status === 'fulfilled') {
      setBackgroundStatus(backgroundStatusResult.value);
      updateState((current) => ({
        accounts: current?.accounts || [],
        currentAccountId: current?.currentAccountId,
        indexPath: current?.indexPath || '',
        accountsDir: current?.accountsDir || '',
        localAuthPath: current?.localAuthPath || '',
        localProfilePath: current?.localProfilePath || '',
        localStateDbPath: current?.localStateDbPath || '',
        kiroExePath: current?.kiroExePath || null,
        pendingOauth: current?.pendingOauth || null,
        backgroundRefresh: current?.backgroundRefresh || null,
        backgroundStatus: backgroundStatusResult.value,
        toolSettings: current?.toolSettings || null,
      }));
    } else {
      errors.push(String(backgroundStatusResult.reason));
    }

    if (errors.length) setError(errors.join('\n'));
  }

  async function refresh(waitForDetails = false) {
    const seq = refreshSeq.current + 1;
    refreshSeq.current = seq;
    setLoading(true);
    setError(null);
    try {
      const fastState = await invoke<KiroFastState>('kiro_account_tool_get_fast_state');
      if (seq !== refreshSeq.current) return;
      const fastAccounts = mergeSummaryAccounts(fastState.accounts || [], stateRef.current?.accounts || []);
      updateState((current) => {
        return {
          accounts: fastAccounts,
          currentAccountId: fastState.currentAccountId,
          indexPath: fastState.indexPath,
          accountsDir: fastState.accountsDir,
          localAuthPath: current?.localAuthPath || '',
          localProfilePath: current?.localProfilePath || '',
          localStateDbPath: current?.localStateDbPath || '',
          kiroExePath: current?.kiroExePath || null,
          pendingOauth: fastState.pendingOauth || null,
          backgroundRefresh: fastState.backgroundRefresh || null,
          backgroundStatus: fastState.backgroundStatus || null,
          toolSettings: fastState.toolSettings || null,
        };
      });
      setOauthSession((current) => current || fastState.pendingOauth || null);
      applyBackgroundSettings(fastState.backgroundRefresh);
      applyToolSettings(fastState.toolSettings);
      setBackgroundStatus(fastState.backgroundStatus || null);
      setSelectedId((current) => chooseSelectedId(current, fastAccounts, fastState.currentAccountId));
      setLoading(false);
      const detailsPromise = hydrateFullState(seq, fastState.currentAccountId);
      if (waitForDetails) await detailsPromise;
    } catch (err) {
      setError(String(err));
      setLoading(false);
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('kiro-account-refresh-updated', () => {
      void refresh();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<KiroBackgroundRefreshStatus>('kiro-account-refresh-status-updated', (event) => {
      setBackgroundStatus(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (selectedAccount) {
      setTagDraft(accountTags(selectedAccount).join(', '));
    } else {
      setTagDraft('');
    }
  }, [selectedAccount?.id]);

  async function runAction<T>(key: string, action: () => Promise<T>, success?: string) {
    setBusy(key);
    setError(null);
    setStatus(null);
    try {
      const result = await action();
      setStatus(success || (typeof result === 'string' ? result : '操作完成'));
      await refresh(true);
      return result;
    } catch (err) {
      setError(String(err));
      await refresh(true);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function importLocal() {
    await runAction('import-local', () => invoke('kiro_account_tool_import_local'), '已从本机 Kiro 导入账号');
  }

  async function importJson() {
    if (!jsonInput.trim()) {
      setError('请先粘贴 Kiro 账号 JSON。');
      return;
    }
    await runAction(
      'import-json',
      () => invoke('kiro_account_tool_import_json', { jsonContent: jsonInput }),
      'JSON 账号已导入'
    );
    setJsonInput('');
  }

  async function addToken() {
    if (!tokenInput.trim()) {
      setError('请先输入 Access Token。');
      return;
    }
    await runAction(
      'add-token',
      () =>
        invoke('kiro_account_tool_add_token', {
          input: {
            email: tokenEmail,
            loginProvider: tokenProvider,
            accessToken: tokenInput,
            tags: [],
          },
        }),
      'Access Token 已保存'
    );
    setTokenInput('');
    setTokenEmail('');
    setTokenProvider('');
  }

  async function exportAccounts() {
    const exported = await runAction<string>('export', () =>
      invoke<string>('kiro_account_tool_export_safe', {
        options: {
          includeSensitive: exportSensitive,
          accountIds: selectedAccount ? [selectedAccount.id] : [],
        },
      })
    );
    if (exported) {
      try {
        await writeText(exported);
      } catch {
        await navigator.clipboard.writeText(exported);
      }
      setStatus('账号 JSON 已复制到剪贴板');
    }
  }

  async function startOAuthLogin() {
    setBusy('oauth');
    setError(null);
    setStatus('正在打开 Kiro OAuth 授权页，完成登录后会自动导入账号。');
    setCallbackInput('');
    try {
      const session = await invoke<KiroOAuthStartResponse>('kiro_account_tool_oauth_start');
      setOauthSession(session);
      await openExternal(session.verificationUriComplete || session.verificationUri);
      await invoke<KiroAccount>('kiro_account_tool_oauth_complete', { loginId: session.loginId });
      setStatus('OAuth 登录完成，账号已保存并尝试刷新远程配额');
      setOauthSession(null);
      await refresh(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function submitOAuthCallback() {
    if (!oauthSession || !callbackInput.trim()) return;
    await runAction(
      'oauth-callback',
      () =>
        invoke('kiro_account_tool_oauth_submit_callback_url', {
          loginId: oauthSession.loginId,
          callbackUrl: callbackInput,
        }),
      '已提交 OAuth 回调链接，正在等待完成登录'
    );
  }

  async function cancelOAuthLogin() {
    if (!oauthSession) return;
    await runAction(
      'oauth-cancel',
      () => invoke('kiro_account_tool_oauth_cancel', { loginId: oauthSession.loginId }),
      'OAuth 登录已取消'
    );
    setOauthSession(null);
    setCallbackInput('');
  }

  async function refreshSelectedQuota() {
    if (!selectedAccount) return;
    await runAction(
      'refresh-quota',
      () => invoke('kiro_account_tool_refresh_account', { accountId: selectedAccount.id }),
      '远程配额已刷新'
    );
  }

  async function launchIsolatedKiro() {
    if (!selectedAccount) return;
    await runAction(
      'launch-isolated',
      () => invoke<string>('kiro_account_tool_launch_isolated', { accountId: selectedAccount.id }),
      '已启动隔离 Kiro 实例'
    );
  }

  async function saveBackgroundRefresh() {
    await runAction(
      'background-refresh',
      () =>
        invoke('kiro_account_tool_set_background_refresh', {
          settings: {
            enabled: backgroundEnabled,
            intervalMinutes: backgroundInterval,
            notifyOnChange: backgroundNotify,
          },
        }),
      backgroundEnabled ? '后台配额刷新已开启' : '后台配额刷新已关闭'
    );
  }

  async function saveToolSettings() {
    await runAction(
      'tool-settings',
      () =>
        invoke<KiroToolSettings>('kiro_account_tool_set_tool_settings', {
          settings: {
            manualKiroExePath: manualKiroPath,
            encryptAccounts,
            exportIncludeSensitiveDefault: exportSensitive,
          },
        }),
      'Kiro 工具设置已保存'
    );
  }

  async function stopInstance(accountId: string) {
    await runAction(
      `stop-instance-${accountId}`,
      () => invoke('kiro_account_tool_stop_instance', { accountId }),
      '隔离实例已停止'
    );
  }

  async function cleanInstance(accountId: string) {
    if (!confirm('清理此隔离实例的数据目录？')) return;
    await runAction(
      `clean-instance-${accountId}`,
      () => invoke('kiro_account_tool_clean_instance', { accountId, stopFirst: true }),
      '隔离实例已清理'
    );
  }

  async function restoreLocalBackup(backupId: string) {
    if (!confirm('恢复此 Kiro 本机状态备份？当前本机状态会先自动备份，恢复失败会回滚。')) return;
    await runAction(
      `restore-backup-${backupId}`,
      () => invoke<string>('kiro_account_tool_restore_local_backup', { backupId }),
      'Kiro 本机状态已恢复'
    );
  }

  async function refreshAllQuota() {
    const result = await runAction<KiroRefreshAllResult>(
      'refresh-all-quota',
      () => invoke<KiroRefreshAllResult>('kiro_account_tool_refresh_all'),
      '全部账号刷新完成'
    );
    if (result) {
      setStatus(`远程配额刷新完成：成功 ${result.successCount} 个，失败 ${result.failedCount} 个`);
      if (result.errors.length) setError(result.errors.slice(0, 3).join('\n'));
    }
  }

  async function refreshStaleQuota() {
    const result = await runAction<KiroRefreshAllResult>(
      'refresh-stale-quota',
      () => invoke<KiroRefreshAllResult>('kiro_account_tool_refresh_stale', { maxAgeSeconds: 6 * 60 * 60 }),
      '过期/陈旧账号刷新完成'
    );
    if (result) {
      setStatus(`过期/陈旧账号刷新完成：成功 ${result.successCount} 个，失败 ${result.failedCount} 个`);
      if (result.errors.length) setError(result.errors.slice(0, 3).join('\n'));
    }
  }

  async function saveTags() {
    if (!selectedAccount) return;
    await runAction(
      'tags',
      () =>
        invoke('kiro_account_tool_update_tags', {
          accountId: selectedAccount.id,
          tags: normalizeTagInput(tagDraft),
        }),
      '标签已保存'
    );
  }

  async function switchAccount(launch: boolean) {
    if (!selectedAccount) return;
    await runAction('switch', () =>
      invoke<string>('kiro_account_tool_switch', {
        accountId: selectedAccount.id,
        launch,
      })
    );
  }

  async function deleteAccount() {
    if (!deleteTarget) return;
    const account = deleteTarget;
    setDeleteTarget(null);
    await runAction(
      'delete',
      () => invoke('kiro_account_tool_delete', { accountId: account.id }),
      '账号已删除'
    );
  }

  async function launchKiro() {
    await runAction('launch', () => invoke('kiro_account_tool_launch'), '已发送 Kiro 启动命令');
  }

  if (!ready) return null;

  const promptUsed = percent(selectedAccount?.creditsUsed, selectedAccount?.creditsTotal);
  const bonusUsed = percent(selectedAccount?.bonusUsed, selectedAccount?.bonusTotal);

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="🧠"
        title="Kiro 账号管理"
        subtitle="本地保存、导入导出与切换 Kiro 登录快照"
        actions={
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            title="刷新"
          >
            <RefreshCw size={16} />
          </button>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] gap-4 p-4">
        <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-100 p-3 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">账号列表</h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {(state?.accounts || []).length} 个账号
                </p>
              </div>
              {loading && <Loader size={16} className="animate-spin text-gray-400" />}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {(state?.accounts || []).length ? (
              (state?.accounts || []).map((account) => {
                const tags = accountTags(account);
                const token = accountToken(account);
                return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => setSelectedId(account.id)}
                  className={`mb-2 w-full rounded-lg border p-3 text-left transition ${
                    selectedAccount?.id === account.id
                      ? 'border-teal-300 bg-teal-50 dark:border-teal-700 dark:bg-teal-950/30'
                      : 'border-gray-100 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{account.email || account.id}</span>
                    {state?.currentAccountId === account.id && (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700 dark:bg-green-900/40 dark:text-green-300">
                        当前
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                    {account.loginProvider || '未知来源'} · {maskToken(token)}
                  </div>
                  {tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
                );
              })
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-gray-500 dark:text-gray-400">
                <UserRound size={40} className="mb-3 text-gray-300 dark:text-gray-600" />
                暂无 Kiro 账号
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-0 space-y-4 overflow-auto">
          {(status || error) && (
            <section
              className={`rounded-lg border p-3 text-sm ${
                error
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                  : 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                <span className="break-all">{error || status}</span>
              </div>
            </section>
          )}

          <section className="grid gap-3 md:grid-cols-4">
            <button
              type="button"
              onClick={importLocal}
              disabled={!!busy}
              className="flex items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-60"
            >
              {busy === 'import-local' ? <Loader size={16} className="animate-spin" /> : <Upload size={16} />}
              从本机导入
            </button>
            <button
              type="button"
              onClick={() => void startOAuthLogin()}
              disabled={!!busy}
              className="flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-60"
            >
              {busy === 'oauth' ? <Loader size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              OAuth 登录
            </button>
            <button
              type="button"
              onClick={() => void refreshAllQuota()}
              disabled={!(state?.accounts || []).length || !!busy}
              className="flex items-center justify-center gap-2 rounded-lg bg-slate-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
            >
              {busy === 'refresh-all-quota' ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              刷新全部配额
            </button>
            <button
              type="button"
              onClick={() => void refreshStaleQuota()}
              disabled={!(state?.accounts || []).length || !!busy}
              className="flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {busy === 'refresh-stale-quota' ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              刷新需更新
            </button>
          </section>

          {oauthSession && (
            <section className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-800 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">OAuth 登录进行中</div>
                  <div className="mt-1 text-xs opacity-80">
                    回调地址：{oauthSession.callbackUrl || '-'}，有效期约 {Math.ceil(oauthSession.expiresIn / 60)} 分钟
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void cancelOAuthLogin()}
                  className="rounded-md border border-cyan-300 px-3 py-1.5 text-xs hover:bg-cyan-100 dark:border-cyan-800 dark:hover:bg-cyan-900/50"
                >
                  取消
                </button>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                <input
                  value={callbackInput}
                  onChange={(event) => setCallbackInput(event.target.value)}
                  className="rounded-lg border border-cyan-200 bg-white px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-400 dark:border-cyan-900 dark:bg-gray-900 dark:text-gray-100"
                  placeholder="自动回调失败时，粘贴 Kiro 跳转后的 /oauth/callback 链接"
                />
                <button
                  type="button"
                  onClick={() => void submitOAuthCallback()}
                  disabled={!callbackInput.trim() || busy === 'oauth-callback'}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-60"
                >
                  提交回调
                </button>
              </div>
            </section>
          )}

          <section className="grid gap-3 md:grid-cols-3">
            <button
              type="button"
              onClick={() => void switchAccount(false)}
              disabled={!selectedAccount || !!busy}
              className="flex items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-60"
            >
              <Save size={16} />
              切换到此账号
            </button>
            <button
              type="button"
              onClick={() => void launchIsolatedKiro()}
              disabled={!selectedAccount || !!busy}
              className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {busy === 'launch-isolated' ? <Loader size={16} className="animate-spin" /> : <Play size={16} />}
              隔离启动
            </button>
            <button
              type="button"
              onClick={() => void switchAccount(true)}
              disabled={!selectedAccount || !!busy}
              className="flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-60"
            >
              <Play size={16} />
              切换并启动
            </button>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              {selectedAccount ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">{selectedAccount.email || selectedAccount.id}</h2>
                      <p className="mt-1 break-all text-xs text-gray-500 dark:text-gray-400">
                        {selectedAccount.id}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void refreshSelectedQuota()}
                        className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        title="刷新远程配额"
                        disabled={busy === 'refresh-quota'}
                      >
                        {busy === 'refresh-quota' ? <Loader size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportAccounts()}
                        className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        title="复制导出 JSON"
                      >
                        <Copy size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => selectedAccount && setDeleteTarget(selectedAccount)}
                        disabled={!!busy}
                        className="rounded-lg border border-red-200 p-2 text-red-500 hover:bg-red-50 dark:border-red-900/60 dark:hover:bg-red-950/30"
                        title="删除"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <Info label="登录方式" value={selectedAccount.loginProvider || '-'} />
                    <Info label="计划" value={selectedAccount.planTier || selectedAccount.planName || '-'} />
                    <Info label="账号状态" value={statusLabel(selectedAccount.status, selectedAccount.statusReason)} />
                    <Info label="IDC 区域" value={selectedAccount.idcRegion || '-'} />
                    <Info label="Access Token" value={maskToken(accountToken(selectedAccount))} />
                    <Info label="过期时间" value={formatTime(selectedAccount.expiresAt)} />
                    <Info label="周期结束" value={formatResetTime(selectedAccount.usageResetAt)} />
                    <Info label="配额刷新" value={formatTime(selectedAccount.usageUpdatedAt)} />
                    <Info label="创建时间" value={formatTime(selectedAccount.createdAt)} />
                    <Info label="最后使用" value={formatTime(selectedAccount.lastUsed)} />
                  </div>

                  {(selectedAccount.quotaQueryLastError || selectedAccount.statusReason) && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                      {selectedAccount.quotaQueryLastError || selectedAccount.statusReason}
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <QuotaBar
                      label="Prompt Credits"
                      used={selectedAccount.creditsUsed}
                      total={selectedAccount.creditsTotal}
                      percent={promptUsed}
                    />
                    <QuotaBar
                      label="Add-on Credits"
                      used={selectedAccount.bonusUsed}
                      total={selectedAccount.bonusTotal}
                      percent={bonusUsed}
                    />
                  </div>

                  <label className="mt-4 block">
                    <span className="mb-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <Tags size={13} />
                      标签
                    </span>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <input
                        value={tagDraft}
                        onChange={(event) => setTagDraft(event.target.value)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 dark:border-gray-600 dark:bg-gray-700"
                        placeholder="多个标签用逗号分隔"
                      />
                      <button
                        type="button"
                        onClick={() => void saveTags()}
                        disabled={busy === 'tags'}
                        className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900"
                      >
                        保存
                      </button>
                    </div>
                  </label>

                  <details className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">
                      原始快照预览
                    </summary>
                    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-gray-500 dark:text-gray-400">
                      {stringifySafe({
                        authRaw: selectedAccount.authRaw,
                        profileRaw: selectedAccount.profileRaw,
                        usageRaw: selectedAccount.usageRaw,
                      })}
                    </pre>
                  </details>
                </>
              ) : (
                <div className="flex min-h-[360px] flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400">
                  <KeyRound size={48} className="mb-3 text-gray-300 dark:text-gray-600" />
                  先导入或新增一个 Kiro 账号
                </div>
              )}
            </div>

            <div className="space-y-4">
              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <h2 className="text-sm font-semibold">本机 Kiro 状态</h2>
                <div className="mt-3 space-y-2 text-xs">
                  <PathStatus label="授权文件" path={localStatus?.authPath} ok={!!localStatus?.authExists} />
                  <PathStatus label="Profile" path={localStatus?.profilePath} ok={!!localStatus?.profileExists} />
                  <PathStatus label="Usage DB" path={localStatus?.stateDbPath} ok={!!localStatus?.stateDbExists} />
                  <PathStatus
                    label={`Kiro 程序${localStatus?.kiroExeSource ? ` · ${localStatus.kiroExeSource}` : ''}`}
                    path={localStatus?.kiroExePath || ''}
                    ok={!!localStatus?.kiroExePath}
                  />
                </div>
                <div className="mt-3 space-y-2">
                  <input
                    value={manualKiroPath}
                    onChange={(event) => setManualKiroPath(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    placeholder="手动指定 Kiro.exe 路径"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-2 text-xs dark:bg-gray-900/40">
                      <input
                        type="checkbox"
                        checked={encryptAccounts}
                        onChange={(event) => setEncryptAccounts(event.target.checked)}
                        className="h-4 w-4 accent-teal-500"
                      />
                      加密账号文件
                    </label>
                    <label className="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-2 text-xs dark:bg-gray-900/40">
                      <input
                        type="checkbox"
                        checked={exportSensitive}
                        onChange={(event) => setExportSensitive(event.target.checked)}
                        className="h-4 w-4 accent-amber-500"
                      />
                      导出含密钥
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveToolSettings()}
                    disabled={busy === 'tool-settings'}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    {busy === 'tool-settings' ? <Loader size={15} className="animate-spin" /> : <Settings size={15} />}
                    保存工具设置
                  </button>
                </div>
                <button
                  type="button"
                  onClick={launchKiro}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <Play size={15} />
                  启动 Kiro
                </button>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Bell size={15} />
                  后台刷新
                </div>
                <label className="mt-3 flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-600 dark:text-gray-300">启用后台刷新</span>
                  <input
                    type="checkbox"
                    checked={backgroundEnabled}
                    onChange={(event) => setBackgroundEnabled(event.target.checked)}
                    className="h-4 w-4 accent-teal-500"
                  />
                </label>
                <label className="mt-3 block text-xs text-gray-500 dark:text-gray-400">
                  间隔分钟
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={backgroundInterval}
                    onChange={(event) => setBackgroundInterval(Math.max(5, Number(event.target.value) || 30))}
                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                </label>
                <label className="mt-3 flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-600 dark:text-gray-300">托盘提示刷新结果</span>
                  <input
                    type="checkbox"
                    checked={backgroundNotify}
                    onChange={(event) => setBackgroundNotify(event.target.checked)}
                    className="h-4 w-4 accent-teal-500"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void saveBackgroundRefresh()}
                  disabled={busy === 'background-refresh'}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  {busy === 'background-refresh' ? <Loader size={15} className="animate-spin" /> : <Save size={15} />}
                  保存后台刷新
                </button>
                <div className="mt-3 grid gap-2 text-xs">
                  <Info label="下次刷新" value={formatTime(backgroundStatus?.nextRunAt)} />
                  <Info
                    label="最近结果"
                    value={
                      backgroundStatus?.lastFinishedAt
                        ? `成功 ${backgroundStatus.lastSuccessCount} / 失败 ${backgroundStatus.lastFailedCount}`
                        : '-'
                    }
                  />
                </div>
                {(backgroundStatus?.history || []).length > 0 && (
                  <details className="mt-3 rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-900/40">
                    <summary className="cursor-pointer font-medium">刷新历史</summary>
                    <div className="mt-2 space-y-1">
                      {(backgroundStatus?.history || []).slice(0, 5).map((item) => (
                        <div key={`${item.startedAt}-${item.finishedAt}`} className="rounded bg-white p-2 dark:bg-gray-800">
                          <div>{formatTime(item.finishedAt)} · 成功 {item.successCount} / 失败 {item.failedCount}</div>
                          {item.errors?.length > 0 && (
                            <div className="mt-1 break-all text-amber-600 dark:text-amber-300">{item.errors[0]}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <RotateCcw size={15} />
                  本机状态备份
                </div>
                <div className="mt-3 space-y-2 text-xs">
                  {localBackups.length ? (
                    localBackups.slice(0, 5).map((backup) => (
                      <div key={backup.id} className="rounded-lg bg-gray-50 p-2 dark:bg-gray-900/40">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-700 dark:text-gray-200">{formatTime(backup.createdAt)}</span>
                          <button
                            type="button"
                            onClick={() => void restoreLocalBackup(backup.id)}
                            disabled={!!busy}
                            className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
                          >
                            <RotateCcw size={12} />
                            恢复
                          </button>
                        </div>
                        <div className="mt-1 text-gray-400">
                          授权 {backup.authExists ? '有' : '无'} · Profile {backup.profileExists ? '有' : '无'} · Usage {backup.stateDbExists ? '有' : '无'}
                        </div>
                        <div className="mt-1 break-all text-gray-400">{backup.backupDir}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg bg-gray-50 p-3 text-gray-400 dark:bg-gray-900/40">
                      暂无本机状态备份
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Shield size={15} />
                  隔离实例
                </div>
                <div className="mt-3 space-y-2 text-xs">
                  {instances.length ? (
                    instances.map((instance) => (
                      <div key={instance.accountId} className="rounded-lg bg-gray-50 p-2 dark:bg-gray-900/40">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium text-gray-700 dark:text-gray-200">{instance.accountEmail}</span>
                          <span className={instance.running ? 'text-green-600 dark:text-green-300' : 'text-gray-400'}>
                            {instance.running ? `运行中 ${instance.pid || ''}` : '已停止'}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-gray-500 dark:text-gray-400">实例身份</span>
                          <span className={instance.identityReady ? 'text-green-600 dark:text-green-300' : 'text-amber-600 dark:text-amber-300'}>
                            {instance.identityReady ? '稳定' : '待生成'}
                          </span>
                        </div>
                        <div className="mt-1 break-all text-gray-400">Machine: {instance.machineId || '-'}</div>
                        <div className="mt-1 break-all text-gray-400">Service: {instance.serviceMachineId || '-'}</div>
                        <div className="mt-1 break-all text-gray-400">{instance.userDataDir}</div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => void stopInstance(instance.accountId)}
                            disabled={!instance.running || !!busy}
                            className="flex items-center justify-center gap-1 rounded-md border border-gray-200 px-2 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
                          >
                            <Square size={12} />
                            停止
                          </button>
                          <button
                            type="button"
                            onClick={() => void cleanInstance(instance.accountId)}
                            disabled={!!busy}
                            className="flex items-center justify-center gap-1 rounded-md border border-red-200 px-2 py-1.5 text-red-500 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60"
                          >
                            <Trash2 size={12} />
                            清理
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg bg-gray-50 p-3 text-gray-400 dark:bg-gray-900/40">
                      暂无隔离实例
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="mb-3 flex rounded-lg bg-gray-100 p-1 text-sm dark:bg-gray-900">
                  <button
                    type="button"
                    onClick={() => setImportMode('json')}
                    className={`flex-1 rounded-md px-3 py-1.5 ${importMode === 'json' ? 'bg-white shadow-sm dark:bg-gray-700' : 'text-gray-500'}`}
                  >
                    JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode('token')}
                    className={`flex-1 rounded-md px-3 py-1.5 ${importMode === 'token' ? 'bg-white shadow-sm dark:bg-gray-700' : 'text-gray-500'}`}
                  >
                    Token
                  </button>
                </div>

                {importMode === 'json' ? (
                  <>
                    <textarea
                      value={jsonInput}
                      onChange={(event) => setJsonInput(event.target.value)}
                      className="h-36 w-full resize-none rounded-lg border border-gray-200 bg-white p-3 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400 dark:border-gray-600 dark:bg-gray-700"
                      placeholder="粘贴 Kiro 账号 JSON / accounts 数组 / cockpit-tools 导出结构"
                    />
                    <button
                      type="button"
                      onClick={importJson}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-3 py-2 text-sm text-white hover:bg-teal-600"
                    >
                      <Download size={15} />
                      导入 JSON
                    </button>
                  </>
                ) : (
                  <div className="space-y-2">
                    <input
                      value={tokenEmail}
                      onChange={(event) => setTokenEmail(event.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                      placeholder="邮箱或备注"
                    />
                    <input
                      value={tokenProvider}
                      onChange={(event) => setTokenProvider(event.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                      placeholder="登录来源，例如 Google / GitHub"
                    />
                    <textarea
                      value={tokenInput}
                      onChange={(event) => setTokenInput(event.target.value)}
                      className="h-28 w-full resize-none rounded-lg border border-gray-200 bg-white p-3 text-xs dark:border-gray-600 dark:bg-gray-700"
                      placeholder="Access Token"
                    />
                    <button
                      type="button"
                      onClick={addToken}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-3 py-2 text-sm text-white hover:bg-teal-600"
                    >
                      <KeyRound size={15} />
                      保存 Token
                    </button>
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                <div className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-200">
                  <FolderOpen size={14} />
                  管理目录
                </div>
                <p className="mt-2 break-all">{state?.accountsDir || '-'}</p>
              </section>
            </div>
          </section>
        </main>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-100 bg-white p-5 shadow-2xl dark:border-red-900/50 dark:bg-gray-800">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-50 p-2 text-red-500 dark:bg-red-950/40">
                <Trash2 size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">确认删除账号</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                  将删除 Kiro 账号：
                  <span className="font-medium text-gray-900 dark:text-white">
                    {deleteTarget.email || deleteTarget.id}
                  </span>
                </p>
                <p className="mt-1 break-all text-xs text-gray-400">{deleteTarget.id}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void deleteAccount()}
                disabled={busy === 'delete'}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {busy === 'delete' ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-gray-800 dark:text-gray-100">{value}</div>
    </div>
  );
}

function QuotaBar({
  label,
  used,
  total,
  percent,
}: {
  label: string;
  used?: number | null;
  total?: number | null;
  percent: number | null;
}) {
  return (
    <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-700">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {used ?? '-'} / {total ?? '-'}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        <div
          className="h-full rounded-full bg-teal-500"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
}

function PathStatus({ label, path, ok }: { label: string; path?: string | null; ok: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-900/40">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
        <span className={ok ? 'text-green-600 dark:text-green-300' : 'text-gray-400'}>
          {ok ? '已找到' : '未找到'}
        </span>
      </div>
      <div className="mt-1 break-all text-gray-400">{path || '-'}</div>
    </div>
  );
}
