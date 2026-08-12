import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Folder,
  Globe,
  KeyRound,
  Lock,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Star,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { StatusMessage, ToolbarButton } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';
import {
  useToolDataStore,
  type PasswordManagerToolData,
  type PasswordManagerVaultEnvelope,
} from '../stores/toolDataStore';

type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

interface TotpSecretItem {
  id: string;
  label: string;
  issuer?: string;
  account?: string;
  secret: string;
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
}

interface PasswordEntry {
  id: string;
  groupId: string;
  title: string;
  username: string;
  password: string;
  urls: PasswordUrlItem[];
  notes: string;
  tags: string[];
  favorite: boolean;
  totpSecrets: TotpSecretItem[];
  createdAt: string;
  updatedAt: string;
}

interface PasswordGroup {
  id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

interface PasswordUrlItem {
  id: string;
  label: string;
  url: string;
}

interface PasswordVaultPlainData {
  schemaVersion: string;
  groups: PasswordGroup[];
  entries: PasswordEntry[];
}

type UnlockedState = {
  data: PasswordVaultPlainData;
  masterPassword: string;
};

type DetailMode = 'view' | 'edit';

type GroupMenuState = {
  groupId: string;
  x: number;
  y: number;
} | null;

const DEFAULT_SETTINGS: Omit<PasswordManagerToolData, 'lastModified'> = {
  version: 'mcheng-password-manager-v1',
  requireUnlockOnOpen: true,
  encryptedSave: true,
  autoLockMinutes: 5,
  clearClipboardSeconds: 30,
  vault: null,
};

const ALL_GROUP_ID = 'all';
const FAVORITES_FILTER_ID = 'favorites';
const DEFAULT_GROUP_ID = 'default';

function entryGroupIdFromFilter(filterId: string) {
  return filterId === ALL_GROUP_ID || filterId === FAVORITES_FILTER_ID ? DEFAULT_GROUP_ID : filterId;
}

const EMPTY_ENTRY: PasswordEntry = {
  id: '',
  groupId: DEFAULT_GROUP_ID,
  title: '',
  username: '',
  password: '',
  urls: [{ id: 'url-blank', label: '', url: '' }],
  notes: '',
  tags: [],
  favorite: false,
  totpSecrets: [],
  createdAt: '',
  updatedAt: '',
};

function createDefaultGroup(): PasswordGroup {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_GROUP_ID,
    name: '默认分组',
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function createEmptyVault(): PasswordVaultPlainData {
  return {
    schemaVersion: 'mcheng-password-vault-v1',
    groups: [createDefaultGroup()],
    entries: [],
  };
}

function randomId(prefix = 'pm') {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Base64(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toBase64(new Uint8Array(digest));
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number) {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: arrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptVault(data: PasswordVaultPlainData, password: string): Promise<PasswordManagerVaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 600_000;
  const key = await deriveAesKey(password, salt, iterations);
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, encoded);
  return {
    version: 'mcheng-password-vault-v1',
    storageMode: 'encrypted',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    ciphertext: toBase64(new Uint8Array(encrypted)),
    verifier: await sha256Base64(`mcheng-password-verifier:${password}`),
    updatedAt: new Date().toISOString(),
  };
}

async function decryptVault(envelope: PasswordManagerVaultEnvelope, password: string): Promise<PasswordVaultPlainData> {
  if (envelope.storageMode === 'plain') {
    return normalizeVaultPlainData(envelope.plainData);
  }
  if (!envelope.salt || !envelope.nonce || !envelope.ciphertext) {
    throw new Error('密码库数据不完整');
  }
  const key = await deriveAesKey(password, fromBase64(envelope.salt), envelope.iterations || 600_000);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.nonce) },
    key,
    fromBase64(envelope.ciphertext),
  );
  return normalizeVaultPlainData(JSON.parse(new TextDecoder().decode(decrypted)));
}

function plainVaultEnvelope(data: PasswordVaultPlainData): PasswordManagerVaultEnvelope {
  return {
    version: 'mcheng-password-vault-v1',
    storageMode: 'plain',
    kdf: 'PBKDF2-SHA256',
    iterations: 0,
    plainData: data,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeVaultPlainData(value: unknown): PasswordVaultPlainData {
  const data = (value || {}) as Partial<PasswordVaultPlainData>;
  const groups = normalizeGroups(data.groups);
  const groupIds = new Set(groups.map((group) => group.id));
  return {
    schemaVersion: data.schemaVersion || 'mcheng-password-vault-v1',
    groups,
    entries: Array.isArray(data.entries)
      ? data.entries.map((entry) => normalizeEntry(entry, groupIds))
      : [],
  };
}

function normalizeGroups(value: unknown): PasswordGroup[] {
  const now = new Date().toISOString();
  const source = Array.isArray(value) ? value : [];
  const normalized = source
    .map((item, index) => {
      const group = item as Partial<PasswordGroup>;
      return {
        id: group.id || randomId('group'),
        name: (group.name || '').trim(),
        order: Number.isFinite(group.order) ? Number(group.order) : index,
        createdAt: group.createdAt || now,
        updatedAt: group.updatedAt || now,
      };
    })
    .filter((group) => group.name);
  if (!normalized.some((group) => group.id === DEFAULT_GROUP_ID)) {
    normalized.unshift(createDefaultGroup());
  }
  return normalized.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

function normalizeEntry(value: Partial<PasswordEntry>, groupIds?: Set<string>): PasswordEntry {
  const now = new Date().toISOString();
  const groupId = value.groupId && groupIds?.has(value.groupId) ? value.groupId : DEFAULT_GROUP_ID;
  return {
    id: value.id || randomId(),
    groupId,
    title: value.title || '',
    username: value.username || '',
    password: value.password || '',
    urls: normalizeUrls(value.urls),
    notes: value.notes || '',
    tags: Array.isArray(value.tags) ? value.tags : [],
    favorite: Boolean(value.favorite),
    totpSecrets: Array.isArray(value.totpSecrets) ? value.totpSecrets.map(normalizeTotp) : [],
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
  };
}

function normalizeUrls(value: unknown): PasswordUrlItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ id: randomId('url'), label: '', url: '' }];
  }
  const urls = value
    .map((item) => {
      if (typeof item === 'string') {
        return { id: randomId('url'), label: '', url: item };
      }
      const next = item as Partial<PasswordUrlItem>;
      return {
        id: next.id || randomId('url'),
        label: next.label || '',
        url: next.url || '',
      };
    })
    .filter((item) => item.label.trim() || item.url.trim());
  return urls.length > 0 ? urls : [{ id: randomId('url'), label: '', url: '' }];
}

function normalizeTotp(value: Partial<TotpSecretItem>): TotpSecretItem {
  return {
    id: value.id || randomId('totp'),
    label: value.label || value.issuer || '验证码',
    issuer: value.issuer || '',
    account: value.account || '',
    secret: normalizeBase32(value.secret || ''),
    digits: value.digits || 6,
    period: value.period || 30,
    algorithm: value.algorithm || 'SHA-1',
  };
}

function normalizeBase32(value: string) {
  return value.replace(/[\s-]+/g, '').replace(/=+$/g, '').toUpperCase();
}

function validateTotpSecret(secret: string) {
  const clean = normalizeBase32(secret);
  if (!clean) throw new Error('TOTP 密钥不能为空');
  if (!/^[A-Z2-7]+$/.test(clean)) {
    throw new Error('TOTP 密钥必须是 Base32 格式，只能包含 A-Z 和 2-7');
  }
  if (base32Decode(clean).length === 0) {
    throw new Error('TOTP 密钥长度无效');
  }
}

function parseTotpInput(value: string): TotpSecretItem {
  const raw = value.trim();
  if (!raw) throw new Error('TOTP 密钥不能为空');
  if (!raw.toLowerCase().startsWith('otpauth://')) {
    validateTotpSecret(raw);
    return normalizeTotp({ secret: raw, label: '验证码' });
  }
  const parsed = new URL(raw);
  if (parsed.host !== 'totp') {
    throw new Error('当前仅支持 otpauth://totp 类型');
  }
  const labelText = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const issuer = parsed.searchParams.get('issuer') || labelText.split(':')[0] || '';
  const account = labelText.includes(':') ? labelText.split(':').slice(1).join(':') : labelText;
  const secret = parsed.searchParams.get('secret') || '';
  validateTotpSecret(secret);
  const algorithm = (parsed.searchParams.get('algorithm') || 'SHA-1').toUpperCase();
  return normalizeTotp({
    label: labelText || issuer || account || '验证码',
    issuer,
    account,
    secret,
    digits: Number(parsed.searchParams.get('digits')) || 6,
    period: Number(parsed.searchParams.get('period')) || 30,
    algorithm: algorithm === 'SHA-256' || algorithm === 'SHA-512' ? (algorithm as TotpAlgorithm) : 'SHA-1',
  });
}

function base32Decode(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = normalizeBase32(value);
  let bits = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(parseInt(bits.slice(offset, offset + 8), 2));
  }
  return new Uint8Array(bytes);
}

async function hmacDigest(algorithm: TotpAlgorithm, keyBytes: Uint8Array, message: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', arrayBuffer(keyBytes), { name: 'HMAC', hash: algorithm }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, arrayBuffer(message)));
}

async function generateTotp(secret: string, digits = 6, period = 30, algorithm: TotpAlgorithm = 'SHA-1', now = Date.now()) {
  const counter = Math.floor(now / 1000 / period);
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(4, counter, false);
  const keyBytes = base32Decode(secret);
  if (keyBytes.length === 0) throw new Error('TOTP 密钥无效');
  const hmac = await hmacDigest(algorithm, keyBytes, new Uint8Array(message));
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

function hostFromUrl(url: string) {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

function entryPrimaryUrl(entry: PasswordEntry) {
  return entry.urls.find((item) => item.url.trim())?.url || '';
}

function entryUrlSearchText(entry: PasswordEntry) {
  return entry.urls.map((item) => `${item.label} ${item.url}`).join(' ');
}

function passwordStrength(password: string) {
  let score = 0;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  if (score >= 5) return { label: '强', className: 'text-green-600 dark:text-green-300' };
  if (score >= 3) return { label: '中', className: 'text-amber-600 dark:text-amber-300' };
  return { label: '弱', className: 'text-red-600 dark:text-red-300' };
}

function generatePassword() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (byte) => charset[byte % charset.length]).join('');
}

export default function PasswordManagerTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updatePasswordManagerData } = useToolDataStore();
  const [settings, setSettings] = useState<Omit<PasswordManagerToolData, 'lastModified'>>(DEFAULT_SETTINGS);
  const [unlocked, setUnlocked] = useState<UnlockedState | null>(null);
  const [masterPassword, setMasterPassword] = useState('');
  const [newMasterPassword, setNewMasterPassword] = useState('');
  const [confirmMasterPassword, setConfirmMasterPassword] = useState('');
  const [query, setQuery] = useState('');
  const [activeGroupId, setActiveGroupId] = useState(ALL_GROUP_ID);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<DetailMode>('view');
  const [draft, setDraft] = useState<PasswordEntry>(EMPTY_ENTRY);
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [groupMenu, setGroupMenu] = useState<GroupMenuState>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [totpCodes, setTotpCodes] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(Date.now());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastActivityAt, setLastActivityAt] = useState(Date.now());
  const hydratedRef = useRef(false);
  const autoLockRef = useRef<number | null>(null);
  const clipboardTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!loaded) void loadData();
  }, [loaded, loadData]);

  useEffect(() => {
    if (!loaded || hydratedRef.current) return;
    hydratedRef.current = true;
    const next = {
      ...DEFAULT_SETTINGS,
      ...(data.passwordManager || {}),
    };
    setSettings(next);
    if (next.vault?.storageMode === 'plain' && !next.requireUnlockOnOpen) {
      const plain = normalizeVaultPlainData(next.vault.plainData);
      setUnlocked({ data: plain, masterPassword: '' });
      setSelectedId(plain.entries[0]?.id || null);
    }
  }, [data.passwordManager, loaded]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    if (autoLockRef.current) window.clearTimeout(autoLockRef.current);
    if (settings.autoLockMinutes > 0) {
      autoLockRef.current = window.setTimeout(() => lockVault(), settings.autoLockMinutes * 60 * 1000);
    }
    return () => {
      if (autoLockRef.current) window.clearTimeout(autoLockRef.current);
    };
  }, [unlocked, settings.autoLockMinutes, lastActivityAt]);

  useEffect(() => {
  const draftSecrets = detailMode === 'edit' ? draft.totpSecrets : [];
  const secrets = [...(unlocked?.data.entries.flatMap((entry) => entry.totpSecrets) || []), ...draftSecrets];
  if (secrets.length === 0) {
    setTotpCodes({});
    return;
    }
    let cancelled = false;
    Promise.all(
      secrets.map(async (item) => {
        try {
          const code = await generateTotp(item.secret, item.digits, item.period, item.algorithm, tick);
          return [item.id, code] as const;
        } catch {
          return [item.id, '错误'] as const;
        }
      }),
    ).then((pairs) => {
      if (!cancelled) setTotpCodes(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [detailMode, draft.totpSecrets, unlocked, tick]);

  const entries = unlocked?.data.entries || [];
  const vaultGroups = unlocked?.data.groups || [];
  const selectedEntry = entries.find((entry) => entry.id === selectedId) || null;
  const selectedEntryGroup = selectedEntry
    ? vaultGroups.find((group) => group.id === (selectedEntry.groupId || DEFAULT_GROUP_ID))
    : null;
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>(vaultGroups.map((group) => [group.id, 0]));
    entries.forEach((entry) => {
      counts.set(entry.groupId || DEFAULT_GROUP_ID, (counts.get(entry.groupId || DEFAULT_GROUP_ID) || 0) + 1);
    });
    return counts;
  }, [entries, vaultGroups]);
  const filteredEntries = useMemo(() => {
    const text = query.trim().toLowerCase();
    const base = entries.filter((entry) => {
      if (activeGroupId === ALL_GROUP_ID) return true;
      if (activeGroupId === FAVORITES_FILTER_ID) return entry.favorite;
      return entry.groupId === activeGroupId;
    });
    if (!text) return base;
    return base.filter((entry) =>
      [entry.title, entry.username, entry.notes, entry.tags.join(' '), entryUrlSearchText(entry)]
        .join(' ')
        .toLowerCase()
        .includes(text),
    );
  }, [activeGroupId, entries, query]);

  useEffect(() => {
    setDraft(
      selectedEntry
        ? {
            ...selectedEntry,
            urls: selectedEntry.urls.map((item) => ({ ...item })),
            groupId: selectedEntry.groupId || DEFAULT_GROUP_ID,
            tags: [...selectedEntry.tags],
            totpSecrets: selectedEntry.totpSecrets.map((item) => ({ ...item })),
          }
        : { ...EMPTY_ENTRY, groupId: entryGroupIdFromFilter(activeGroupId) },
    );
    setVisiblePassword(false);
  }, [activeGroupId, detailMode, selectedEntry?.id]);

  const persistSettings = (patch: Partial<Omit<PasswordManagerToolData, 'lastModified'>>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    updatePasswordManagerData(next);
  };

  const persistVault = async (plain: PasswordVaultPlainData, password = unlocked?.masterPassword || '') => {
    const vault = settings.encryptedSave ? await encryptVault(plain, password) : plainVaultEnvelope(plain);
    const next = { ...settings, vault };
    setSettings(next);
    updatePasswordManagerData(next);
  };

  const createVault = async () => {
    setError('');
    if (settings.encryptedSave || settings.requireUnlockOnOpen) {
      if (!newMasterPassword) {
        setError('请设置启动/加密密码');
        return;
      }
      if (newMasterPassword !== confirmMasterPassword) {
        setError('两次密码不一致');
        return;
      }
    }
    const plain = createEmptyVault();
    const password = settings.encryptedSave || settings.requireUnlockOnOpen ? newMasterPassword : '';
    const vault = settings.encryptedSave ? await encryptVault(plain, password) : plainVaultEnvelope(plain);
    const next = { ...settings, vault };
    setSettings(next);
    updatePasswordManagerData(next);
    setUnlocked({ data: plain, masterPassword: password });
    setNewMasterPassword('');
    setConfirmMasterPassword('');
    setMessage('密码库已创建');
  };

  const unlockVault = async () => {
    setError('');
    if (!settings.vault) {
      await createVault();
      return;
    }
    try {
      const plain = await decryptVault(settings.vault, masterPassword);
      setUnlocked({ data: plain, masterPassword });
      setSelectedId(plain.entries[0]?.id || null);
      setLastActivityAt(Date.now());
      setMasterPassword('');
      setMessage('密码库已解锁');
    } catch {
      setError('解锁失败，请检查密码');
    }
  };

  const lockVault = () => {
    setUnlocked(null);
    setSelectedId(null);
    setDraft(EMPTY_ENTRY);
    setVisiblePassword(false);
  };

  const saveDraft = async () => {
    if (!unlocked) return;
    const now = new Date().toISOString();
    const groupIds = new Set(unlocked.data.groups.map((group) => group.id));
    const entry = normalizeEntry({
      ...draft,
      id: draft.id || randomId(),
      groupId: groupIds.has(draft.groupId) ? draft.groupId : DEFAULT_GROUP_ID,
      title: draft.title.trim() || draft.username.trim() || hostFromUrl(draft.urls[0]?.url || '') || '未命名密码',
      urls: normalizeUrls(draft.urls),
      tags: draft.tags.map((item) => item.trim()).filter(Boolean),
      totpSecrets: draft.totpSecrets.map(normalizeTotp).filter((item) => item.secret),
      createdAt: draft.createdAt || now,
      updatedAt: now,
    }, groupIds);
    const exists = unlocked.data.entries.some((item) => item.id === entry.id);
    const nextData = {
      ...unlocked.data,
      entries: exists
        ? unlocked.data.entries.map((item) => (item.id === entry.id ? entry : item))
        : [entry, ...unlocked.data.entries],
    };
    setUnlocked({ ...unlocked, data: nextData });
    setSelectedId(entry.id);
    setDetailMode('view');
    await persistVault(nextData);
    setMessage('已保存');
  };

  const deleteEntry = async (id: string) => {
    if (!unlocked) return;
    const nextData = { ...unlocked.data, entries: unlocked.data.entries.filter((item) => item.id !== id) };
    setUnlocked({ ...unlocked, data: nextData });
    setSelectedId(nextData.entries[0]?.id || null);
    setDetailMode('view');
    await persistVault(nextData);
    setMessage('已删除');
  };

  const addEntry = () => {
    const now = new Date().toISOString();
    const entry = {
      ...EMPTY_ENTRY,
      id: randomId(),
      groupId: entryGroupIdFromFilter(activeGroupId),
      urls: [{ id: randomId('url'), label: '', url: '' }],
      createdAt: now,
      updatedAt: now,
    };
    setDraft(entry);
    setSelectedId(null);
    setDetailMode('edit');
    setVisiblePassword(false);
  };

  const addGroup = async () => {
    if (!unlocked) return;
    const name = newGroupName.trim();
    if (!name) return;
    if (unlocked.data.groups.some((group) => group.name === name)) {
      setError('分组名称已存在');
      return;
    }
    const now = new Date().toISOString();
    const nextGroup: PasswordGroup = {
      id: randomId('group'),
      name,
      order: unlocked.data.groups.length,
      createdAt: now,
      updatedAt: now,
    };
    const nextData = { ...unlocked.data, groups: [...unlocked.data.groups, nextGroup] };
    setUnlocked({ ...unlocked, data: nextData });
    setActiveGroupId(nextGroup.id);
    setNewGroupName('');
    await persistVault(nextData);
    setMessage('分组已创建');
  };

  const startRenameGroup = (group: PasswordGroup) => {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
    setGroupMenu(null);
  };

  const renameGroup = async () => {
    if (!unlocked || !editingGroupId) return;
    const name = editingGroupName.trim();
    if (!name) {
      setError('分组名称不能为空');
      return;
    }
    if (unlocked.data.groups.some((group) => group.id !== editingGroupId && group.name === name)) {
      setError('分组名称已存在');
      return;
    }
    const now = new Date().toISOString();
    const nextData = {
      ...unlocked.data,
      groups: unlocked.data.groups.map((group) =>
        group.id === editingGroupId ? { ...group, name, updatedAt: now } : group,
      ),
    };
    setUnlocked({ ...unlocked, data: nextData });
    setEditingGroupId(null);
    setEditingGroupName('');
    await persistVault(nextData);
    setMessage('分组已重命名');
  };

  const deleteGroup = async (groupId: string) => {
    if (!unlocked) return;
    if (groupId === DEFAULT_GROUP_ID) {
      setError('默认分组不能删除');
      return;
    }
    const group = unlocked.data.groups.find((item) => item.id === groupId);
    if (!group) return;
    const count = unlocked.data.entries.filter((entry) => entry.groupId === groupId).length;
    const ok = window.confirm(count > 0 ? `删除分组“${group.name}”？其中 ${count} 条密码会移到默认分组。` : `删除分组“${group.name}”？`);
    if (!ok) return;
    const nextData = {
      ...unlocked.data,
      groups: unlocked.data.groups.filter((item) => item.id !== groupId),
      entries: unlocked.data.entries.map((entry) =>
        entry.groupId === groupId ? { ...entry, groupId: DEFAULT_GROUP_ID, updatedAt: new Date().toISOString() } : entry,
      ),
    };
    setUnlocked({ ...unlocked, data: nextData });
    if (activeGroupId === groupId) setActiveGroupId(DEFAULT_GROUP_ID);
    setGroupMenu(null);
    setEditingGroupId(null);
    await persistVault(nextData);
    setMessage('分组已删除');
  };

  const openGroupMenu = (event: ReactMouseEvent, groupId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setGroupMenu({ groupId, x: event.clientX, y: event.clientY });
  };

  const copyText = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setMessage(`${label} 已复制`);
    if (clipboardTimerRef.current) window.clearTimeout(clipboardTimerRef.current);
    if (settings.clearClipboardSeconds > 0) {
      clipboardTimerRef.current = window.setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => undefined);
      }, settings.clearClipboardSeconds * 1000);
    }
  };

  const addTotp = (input: string) => {
    try {
      const item = parseTotpInput(input);
      setDraft((current) => ({ ...current, totpSecrets: [...current.totpSecrets, item] }));
      setMessage('TOTP 密钥已添加');
    } catch (err) {
      setError(String(err));
    }
  };

  const updateSettingAndReencrypt = async (patch: Partial<Omit<PasswordManagerToolData, 'lastModified'>>, password?: string) => {
    const next = { ...settings, ...patch };
    if (!unlocked) {
      persistSettings(patch);
      return;
    }
    if (next.encryptedSave && !(password || unlocked.masterPassword)) {
      setError('开启加密保存需要先设置加密密码');
      return;
    }
    const vault = next.encryptedSave
      ? await encryptVault(unlocked.data, password || unlocked.masterPassword)
      : plainVaultEnvelope(unlocked.data);
    const merged = { ...next, vault };
    setSettings(merged);
    setUnlocked({ ...unlocked, masterPassword: password || unlocked.masterPassword });
    updatePasswordManagerData(merged);
    setMessage('设置已保存');
  };

  if (!ready) return null;

  const vaultReady = Boolean(settings.vault);
  const needsUnlock = !unlocked;
  const strength = passwordStrength(draft.password);
  const menuGroup = groupMenu ? vaultGroups.find((group) => group.id === groupMenu.groupId) : null;

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100"
      onMouseDown={() => setLastActivityAt(Date.now())}
      onKeyDown={() => setLastActivityAt(Date.now())}
      onClick={() => setGroupMenu(null)}
    >
      <ToolHeader
        icon="🔐"
        title="密码管理器"
        subtitle="本地密码保险箱，支持多 TOTP、网址、备注和加密保存"
        actions={
          <>
            {unlocked && (
              <ToolbarButton onClick={lockVault}>
                <Lock size={14} />
                锁定
              </ToolbarButton>
            )}
            <ToolbarButton onClick={() => setShowSettings(true)}>
              <Settings size={14} />
              设置
            </ToolbarButton>
          </>
        }
      />

      <main className="min-h-0 flex-1 overflow-hidden p-4">
        <StatusMessage message={message} error={error} />
        {needsUnlock ? (
          <div className="mx-auto mt-12 max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-200">
                <Shield size={22} />
              </div>
              <div>
                <h2 className="text-lg font-semibold">{vaultReady ? '解锁密码库' : '创建密码库'}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">主密码不会保存，忘记后无法恢复加密数据。</p>
              </div>
            </div>

            {vaultReady ? (
              <div className="space-y-4">
                <input
                  type="password"
                  value={masterPassword}
                  onChange={(event) => setMasterPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void unlockVault();
                  }}
                  placeholder={settings.vault?.storageMode === 'plain' ? '明文库可直接解锁，也可留空' : '输入主密码'}
                  className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                />
                <button
                  onClick={() => void unlockVault()}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  <Unlock size={16} />
                  解锁
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <input
                  type="password"
                  value={newMasterPassword}
                  onChange={(event) => setNewMasterPassword(event.target.value)}
                  placeholder="设置启动/加密密码"
                  className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                />
                <input
                  type="password"
                  value={confirmMasterPassword}
                  onChange={(event) => setConfirmMasterPassword(event.target.value)}
                  placeholder="再次输入密码"
                  className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                />
                <button
                  onClick={() => void createVault()}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  <KeyRound size={16} />
                  创建密码库
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-[210px_300px_minmax(0,1fr)] overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 max-xl:grid-cols-[190px_280px_minmax(0,1fr)] max-lg:grid-cols-1">
            <aside className="min-h-0 border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950 max-lg:hidden">
              <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">保险库</div>
              </div>
              <div className="space-y-1 p-3">
                <button
                  onClick={() => setActiveGroupId(ALL_GROUP_ID)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm ${
                    activeGroupId === ALL_GROUP_ID
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-900'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Shield size={15} />
                    全部项目
                  </span>
                  <span>{entries.length}</span>
                </button>
                <button
                  onClick={() => setActiveGroupId(FAVORITES_FILTER_ID)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm ${
                    activeGroupId === FAVORITES_FILTER_ID
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-900'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Star size={15} />
                    收藏
                  </span>
                  <span>{entries.filter((entry) => entry.favorite).length}</span>
                </button>
              </div>

              <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">分组</div>
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={newGroupName}
                    onChange={(event) => setNewGroupName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void addGroup();
                    }}
                    placeholder="新建分组"
                    className="h-8 min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900"
                  />
                  <button
                    onClick={() => void addGroup()}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                    title="添加分组"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div className="min-h-0 space-y-1 overflow-auto px-3 pb-3">
                {vaultGroups.map((group) => (
                  <div key={group.id} className="group relative">
                    {editingGroupId === group.id ? (
                      <div className="flex gap-1 rounded-md bg-white p-1 dark:bg-gray-900">
                        <input
                          value={editingGroupName}
                          onChange={(event) => setEditingGroupName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void renameGroup();
                            if (event.key === 'Escape') {
                              setEditingGroupId(null);
                              setEditingGroupName('');
                            }
                          }}
                          autoFocus
                          className="h-8 min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                        />
                        <button onClick={() => void renameGroup()} className="h-8 rounded px-2 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/20">
                          保存
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setActiveGroupId(group.id)}
                        onContextMenu={(event) => openGroupMenu(event, group.id)}
                        className={`flex w-full items-center justify-between rounded-md px-3 py-2 pr-8 text-sm ${
                          activeGroupId === group.id
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-700 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-900'
                        }`}
                        title={`${group.name}，右键管理`}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <Folder size={15} className="shrink-0" />
                          <span className="truncate">{group.name}</span>
                        </span>
                        <span>{groupCounts.get(group.id) || 0}</span>
                      </button>
                    )}
                    {editingGroupId !== group.id && (
                      <button
                        onClick={(event) => openGroupMenu(event, group.id)}
                        className={`absolute right-1 top-1/2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md group-hover:inline-flex ${
                          activeGroupId === group.id ? 'text-white hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                        title="分组管理"
                      >
                        <MoreVertical size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </aside>

            <section className="min-h-0 overflow-hidden border-r border-gray-200 dark:border-gray-800">
              <div className="border-b border-gray-100 p-1.5 dark:border-gray-800">
                <div className="mb-2 hidden gap-2 overflow-x-auto max-lg:flex">
                  <button
                    onClick={() => setActiveGroupId(ALL_GROUP_ID)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                      activeGroupId === ALL_GROUP_ID ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    全部 {entries.length}
                  </button>
                  <button
                    onClick={() => setActiveGroupId(FAVORITES_FILTER_ID)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                      activeGroupId === FAVORITES_FILTER_ID ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    收藏 {entries.filter((entry) => entry.favorite).length}
                  </button>
                  {vaultGroups.map((group) => (
                    <button
                      key={group.id}
                      onClick={() => setActiveGroupId(group.id)}
                      onContextMenu={(event) => openGroupMenu(event, group.id)}
                      className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                        activeGroupId === group.id ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-200 text-gray-600'
                      }`}
                    >
                      {group.name} {groupCounts.get(group.id) || 0}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索名称、网址、标签..."
                      className="h-8 w-full rounded-md border border-gray-200 bg-white pl-8 pr-2 text-xs outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                    />
                  </div>
                  <button
                    onClick={addEntry}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
                    title="新增"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
              <div className="h-full min-h-0 overflow-auto">
                {filteredEntries.length === 0 ? (
                  <div className="flex h-56 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 text-gray-400 dark:border-gray-700">
                    <Lock size={32} />
                    <p className="mt-2 text-sm">暂无密码条目</p>
                  </div>
                ) : (
                  filteredEntries.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => {
                        setSelectedId(entry.id);
                        setDetailMode('view');
                      }}
                      className={`grid h-9 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-l-2 px-2 text-left transition ${
                        selectedId === entry.id
                          ? 'border-b-gray-100 border-l-blue-600 bg-blue-50 dark:border-b-gray-800 dark:bg-blue-900/20'
                          : 'border-b-gray-100 border-l-transparent bg-white hover:bg-gray-50 dark:border-b-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold">{entry.title}</span>
                        <span className="min-w-0 truncate text-xs text-gray-500">
                          {entry.username || hostFromUrl(entryPrimaryUrl(entry))}
                        </span>
                        {entry.favorite && <Star size={13} className="shrink-0 fill-amber-400 text-amber-400" />}
                      </div>
                      {entry.totpSecrets.length > 0 ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-green-50 px-1.5 text-[10px] leading-4 text-green-700 dark:bg-green-900/20 dark:text-green-200">
                          <Clock size={11} />
                          {entry.totpSecrets.length} 个 TOTP
                        </span>
                      ) : <span />}
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="min-h-0 overflow-auto bg-white p-3 dark:bg-gray-900">
              {detailMode === 'view' && selectedEntry ? (
                <EntryView
                  entry={selectedEntry}
                  groupName={selectedEntryGroup?.name || '默认分组'}
                  codes={totpCodes}
                  tick={tick}
                  onCopy={(value, label) => void copyText(value, label)}
                  onEdit={() => setDetailMode('edit')}
                  onDelete={() => void deleteEntry(selectedEntry.id)}
                />
              ) : (
                <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{draft.id ? '编辑密码' : '新增密码'}</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    密码和 TOTP 密钥只在解锁后进入内存，保存时按设置写入本地数据。
                  </p>
                </div>
                {draft.id && (
                  <button
                    onClick={() => void deleteEntry(draft.id)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 text-sm text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={15} />
                    删除
                  </button>
                )}
                {draft.id && (
                  <button
                    onClick={() => setDetailMode('view')}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    <X size={15} />
                    取消
                  </button>
                )}
              </div>

              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
                  <label>
                    <span className="text-sm font-semibold">名称</span>
                    <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950" />
                  </label>
                  <label>
                    <span className="text-sm font-semibold">用户名</span>
                    <input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950" />
                  </label>
                </div>

                <label>
                  <span className="text-sm font-semibold">分组</span>
                  <select
                    value={draft.groupId || DEFAULT_GROUP_ID}
                    onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}
                    className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                  >
                    {vaultGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">密码</span>
                    <span className={`text-xs ${strength.className}`}>强度：{strength.label}</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      type={visiblePassword ? 'text' : 'password'}
                      value={draft.password}
                      onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                    />
                    <button onClick={() => setVisiblePassword((value) => !value)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800" title={visiblePassword ? '隐藏' : '显示'}>
                      {visiblePassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    <button onClick={() => setDraft({ ...draft, password: generatePassword() })} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                      <RefreshCw size={15} />
                      生成
                    </button>
                    {draft.password && (
                      <button onClick={() => void copyText(draft.password, '密码')} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800" title="复制密码">
                        <Copy size={15} />
                      </button>
                    )}
                  </div>
                </label>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">网址</span>
                    <button
                      onClick={() => setDraft({ ...draft, urls: [...draft.urls, { id: randomId('url'), label: '', url: '' }] })}
                      className="text-xs text-blue-600 hover:underline dark:text-blue-300"
                    >
                      添加网址
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {draft.urls.map((item, index) => (
                      <div key={item.id || index} className="grid grid-cols-[160px_minmax(0,1fr)_40px] gap-2 max-md:grid-cols-[minmax(0,1fr)_40px]">
                        <input
                          value={item.label}
                          onChange={(event) => {
                            const urls = draft.urls.map((urlItem, itemIndex) =>
                              itemIndex === index ? { ...urlItem, label: event.target.value } : urlItem,
                            );
                            setDraft({ ...draft, urls });
                          }}
                          placeholder="备注名"
                          className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 max-md:col-span-2"
                        />
                        <div className="relative min-w-0">
                          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                          <input
                            value={item.url}
                            onChange={(event) => {
                              const urls = draft.urls.map((urlItem, itemIndex) =>
                                itemIndex === index ? { ...urlItem, url: event.target.value } : urlItem,
                              );
                              setDraft({ ...draft, urls });
                            }}
                            placeholder="https://example.com"
                            className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                          />
                        </div>
                        <button onClick={() => setDraft({ ...draft, urls: draft.urls.filter((_, itemIndex) => itemIndex !== index) })} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <TotpEditor
                  items={draft.totpSecrets}
                  codes={totpCodes}
                  tick={tick}
                  onAdd={addTotp}
                  onCopy={(value) => void copyText(value, 'TOTP 验证码')}
                  onRemove={(id) => setDraft({ ...draft, totpSecrets: draft.totpSecrets.filter((item) => item.id !== id) })}
                />

                <label>
                  <span className="text-sm font-semibold">标签</span>
                  <input
                    value={draft.tags.join(', ')}
                    onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })}
                    placeholder="工作, 个人, 服务器"
                    className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>

                <label>
                  <span className="text-sm font-semibold">备注</span>
                  <textarea
                    value={draft.notes}
                    onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                    className="mt-2 h-28 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>

                <div className="flex items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draft.favorite} onChange={(event) => setDraft({ ...draft, favorite: event.target.checked })} />
                    收藏
                  </label>
                  <button onClick={() => void saveDraft()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700">
                    <Check size={16} />
                    保存
                  </button>
                </div>
              </div>
                </>
              )}
            </section>
          </div>
        )}
      </main>

      {showSettings && (
        <SettingsDialog
          settings={settings}
          unlocked={Boolean(unlocked)}
          onClose={() => setShowSettings(false)}
          onSave={(patch, password) => void updateSettingAndReencrypt(patch, password)}
        />
      )}

      {groupMenu && menuGroup && (
        <div
          className="fixed z-50 w-40 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900"
          style={{ left: groupMenu.x, top: groupMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => startRenameGroup(menuGroup)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <Pencil size={14} />
            重命名
          </button>
          <button
            onClick={() => void deleteGroup(menuGroup.id)}
            disabled={menuGroup.id === DEFAULT_GROUP_ID}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-red-300 dark:hover:bg-red-900/20"
          >
            <Trash2 size={14} />
            删除分组
          </button>
        </div>
      )}
    </div>
  );
}

function EntryView({
  entry,
  groupName,
  codes,
  tick,
  onCopy,
  onEdit,
  onDelete,
}: {
  entry: PasswordEntry;
  groupName: string;
  codes: Record<string, string>;
  tick: number;
  onCopy: (value: string, label: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const passwordText = entry.password ? (showPassword ? entry.password : '••••••••••••') : '-';

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3 dark:border-gray-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold">{entry.title || '未命名密码'}</h2>
            {entry.favorite && <Star size={16} className="shrink-0 fill-amber-400 text-amber-400" />}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{groupName}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={onEdit}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-gray-200 px-2.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            <Pencil size={15} />
            编辑
          </button>
          <button
            onClick={onDelete}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-red-200 px-2.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20"
          >
            <Trash2 size={15} />
            删除
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <ReadonlyRow label="用户名" value={entry.username || '-'} copyValue={entry.username} onCopy={onCopy} />
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 dark:border-gray-800">
          <div className="text-xs text-gray-500">密码</div>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 break-all font-mono text-sm">{passwordText}</div>
            <button
              onClick={() => setShowPassword((value) => !value)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              title={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            {entry.password && (
              <button
                onClick={() => onCopy(entry.password, '密码')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                title="复制密码"
              >
                <Copy size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 dark:border-gray-800">
          <div className="text-xs text-gray-500">网址</div>
          <div className="space-y-1">
            {entry.urls.filter((item) => item.url.trim() || item.label.trim()).length === 0 ? (
              <div className="text-sm text-gray-400">-</div>
            ) : (
              entry.urls
                .filter((item) => item.url.trim() || item.label.trim())
                .map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded bg-gray-50 px-2 py-1.5 dark:bg-gray-950">
                    <Globe size={14} className="shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      {item.label && <div className="truncate text-xs text-gray-500">{item.label}</div>}
                      <div className="truncate text-sm">{item.url || '-'}</div>
                    </div>
                    {item.url && (
                      <button
                        onClick={() => onCopy(item.url, '网址')}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                        title="复制网址"
                      >
                        <Copy size={14} />
                      </button>
                    )}
                  </div>
                ))
            )}
          </div>
        </div>

        {entry.totpSecrets.length > 0 && (
          <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 dark:border-gray-800">
            <div className="text-xs text-gray-500">TOTP</div>
            <div className="space-y-1">
              {entry.totpSecrets.map((item) => {
                const remaining = item.period - (Math.floor(tick / 1000) % item.period);
                return (
                  <div key={item.id} className="grid gap-1 rounded bg-gray-50 px-2 py-1.5 dark:bg-gray-950">
                    <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{item.label}</div>
                      <div className="text-xs text-gray-500">{item.issuer || item.account || `${item.digits} 位 / ${item.period}s`}</div>
                    </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onCopy(codes[item.id] || '', 'TOTP 验证码')}
                          className="rounded-md bg-white px-2.5 py-1 font-mono text-base font-semibold tracking-widest text-blue-600 shadow-sm dark:bg-gray-900 dark:text-blue-300"
                        >
                          {codes[item.id] || '------'}
                        </button>
                        <span className="w-8 text-xs text-gray-400">{remaining}s</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="shrink-0">密钥</span>
                      <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono dark:bg-gray-900">{item.secret || '-'}</code>
                      {item.secret && (
                        <button
                          onClick={() => onCopy(item.secret, 'TOTP 密钥')}
                          className="inline-flex h-6 w-6 items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                          title="复制 TOTP 密钥"
                        >
                          <Copy size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {entry.tags.length > 0 && <ReadonlyRow label="标签" value={entry.tags.join(', ')} />}
        <ReadonlyRow label="备注" value={entry.notes || '-'} />
      </div>
    </div>
  );
}

function ReadonlyRow({
  label,
  value,
  copyValue,
  onCopy,
}: {
  label: string;
  value: string;
  copyValue?: string;
  onCopy?: (value: string, label: string) => void;
}) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-2 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 dark:border-gray-800">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-all text-sm">{value}</div>
        {copyValue && onCopy && (
          <button
            onClick={() => onCopy(copyValue, label)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            title={`复制${label}`}
          >
            <Copy size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function TotpEditor({
  items,
  codes,
  tick,
  onAdd,
  onCopy,
  onRemove,
}: {
  items: TotpSecretItem[];
  codes: Record<string, string>;
  tick: number;
  onAdd: (input: string) => void;
  onCopy: (value: string) => void;
  onRemove: (id: string) => void;
}) {
  const [input, setInput] = useState('');
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">TOTP 密钥</span>
        <span className="text-xs text-gray-400">支持多个 otpauth:// 或 secret</span>
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="粘贴 otpauth://totp/... 或 Base32 secret"
          className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
        />
        <button
          onClick={() => {
            onAdd(input);
            setInput('');
          }}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          <Plus size={15} />
          添加
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        {items.map((item) => {
          const remaining = item.period - (Math.floor(tick / 1000) % item.period);
          return (
            <div key={item.id} className="grid gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-950">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{item.label}</div>
                  <div className="text-xs text-gray-500">{item.issuer || item.account || `${item.digits} 位 / ${item.period}s`}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => onCopy(codes[item.id] || '')} className="rounded-md bg-white px-3 py-1 font-mono text-lg font-semibold tracking-widest text-blue-600 shadow-sm dark:bg-gray-900 dark:text-blue-300">
                    {codes[item.id] || '------'}
                  </button>
                  <span className="w-8 text-xs text-gray-400">{remaining}s</span>
                  <button onClick={() => onRemove(item.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="shrink-0">密钥</span>
                <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono dark:bg-gray-900">{item.secret || '-'}</code>
                {item.secret && (
                  <button onClick={() => onCopy(item.secret)} className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800" title="复制 TOTP 密钥">
                    <Copy size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingsDialog({
  settings,
  unlocked,
  onClose,
  onSave,
}: {
  settings: Omit<PasswordManagerToolData, 'lastModified'>;
  unlocked: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Omit<PasswordManagerToolData, 'lastModified'>>, password?: string) => void;
}) {
  const [local, setLocal] = useState(settings);
  const [password, setPassword] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h2 className="text-base font-semibold">密码管理器设置</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">安全设置会影响本地保存和后续同步数据。</p>
        </div>
        <div className="space-y-4 px-5 py-4">
          <label className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
            打开工具时要求解锁
            <input type="checkbox" checked={local.requireUnlockOnOpen} onChange={(event) => setLocal({ ...local, requireUnlockOnOpen: event.target.checked })} />
          </label>
          <label className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
            加密保存
            <input type="checkbox" checked={local.encryptedSave} onChange={(event) => setLocal({ ...local, encryptedSave: event.target.checked })} />
          </label>
          {!local.encryptedSave && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
              <AlertTriangle size={17} className="shrink-0" />
              明文保存会把密码和 TOTP 密钥直接写入本地数据文件，后续同步也会同步明文。
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="text-sm font-semibold">自动锁定</span>
              <select value={local.autoLockMinutes} onChange={(event) => setLocal({ ...local, autoLockMinutes: Number(event.target.value) })} className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950">
                <option value={1}>1 分钟</option>
                <option value={5}>5 分钟</option>
                <option value={15}>15 分钟</option>
                <option value={30}>30 分钟</option>
                <option value={0}>不自动锁定</option>
              </select>
            </label>
            <label>
              <span className="text-sm font-semibold">复制后清空剪贴板</span>
              <select value={local.clearClipboardSeconds} onChange={(event) => setLocal({ ...local, clearClipboardSeconds: Number(event.target.value) })} className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950">
                <option value={15}>15 秒</option>
                <option value={30}>30 秒</option>
                <option value={60}>60 秒</option>
                <option value={0}>不清空</option>
              </select>
            </label>
          </div>
          {local.encryptedSave && unlocked && (
            <label>
              <span className="text-sm font-semibold">更换/设置加密密码</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="留空则继续使用当前解锁密码" className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950" />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <button onClick={onClose} className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            取消
          </button>
          <button
            onClick={() => {
              onSave(local, password || undefined);
              onClose();
            }}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
          >
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
