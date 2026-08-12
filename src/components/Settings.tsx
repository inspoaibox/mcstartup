import { useState, useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useItemsStore } from '../stores/itemsStore';
import { useGroupsStore } from '../stores/groupsStore';
import { useToolDataStore } from '../stores/toolDataStore';
import {
  X,
  Settings as SettingsIcon,
  Download,
  Upload,
  FolderOpen,
  Keyboard,
  Plus,
  Trash2,
  GripVertical,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { message as showMessage } from '@tauri-apps/api/dialog';
import { SearchEngine, TranslateOpenaiCompatibleProvider } from '../types';
import AISettingsTab from './AISettingsTab';
import McpSettingsPanel from './McpSettingsPanel';

/** 将 Tauri 快捷键格式转为用户友好的显示 */
function formatShortcutDisplay(shortcut: string): string {
  return shortcut
    .replace('CmdOrCtrl', 'Ctrl')
    .replace('CommandOrControl', 'Ctrl')
    .split('+')
    .map((part) => {
      switch (part) {
        case 'Space':
          return '空格';
        case 'ArrowUp':
          return '↑';
        case 'ArrowDown':
          return '↓';
        case 'ArrowLeft':
          return '←';
        case 'ArrowRight':
          return '→';
        default:
          return part;
      }
    })
    .join(' + ');
}

interface SettingsProps {
  onClose: () => void;
}

const BACKUP_LOCAL_STORAGE_KEYS = [
  'tool-categories',
  'text-prefix-history',
  'translate-settings',
  'ai_chat_pinned_threads',
  'ai_chat_user_avatars',
  'ai_chat_appearance',
];

interface ImportConfigResult {
  backupKind: string;
  version: number;
  frontend?: {
    localStorage?: Record<string, unknown>;
  };
  restoredToolData: boolean;
  restoredAiChat: boolean;
  notes?: string[];
}

interface ContextMenuStatus {
  installed: boolean;
  desktopBoxInstalled?: boolean;
  registryPath: string;
  command?: string | null;
  desktopBoxCommand?: string | null;
  missing: string[];
}

interface WechatOcrEnvironment {
  available: boolean;
  message: string;
  installDir: string;
  runtimeDir: string;
  ocrArchive: string;
  cachedDir: string;
  wxocrPath: string;
  bridgePath: string;
  missing: string[];
}

interface PaddleOcrEnvironment {
  available: boolean;
  message: string;
  runtimeDir: string;
  detModel: string;
  clsModel: string;
  recModel: string;
  missing: string[];
}

interface WpsOcrEnvironment {
  available: boolean;
  message: string;
  runtimeDir: string;
  installDir: string;
  detModel: string;
  clsModel: string;
  recModel: string;
  vocabPath: string;
  runtimeLibrary: string;
  missing: string[];
}

function collectFrontendBackupData() {
  const localStorageData: Record<string, unknown> = {};
  for (const key of BACKUP_LOCAL_STORAGE_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (raw == null) continue;
    try {
      localStorageData[key] = JSON.parse(raw);
    } catch {
      localStorageData[key] = raw;
    }
  }
  return { localStorage: localStorageData };
}

function restoreFrontendBackupData(frontend?: ImportConfigResult['frontend']) {
  const localStorageData = frontend?.localStorage;
  if (!localStorageData || typeof localStorageData !== 'object') return;

  for (const key of BACKUP_LOCAL_STORAGE_KEYS) {
    if (!(key in localStorageData)) continue;
    const value = localStorageData[key];
    if (typeof value === 'string') {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  }
}

export default function Settings({ onClose }: SettingsProps) {
  const {
    theme,
    closeToTray,
    autoStart,
    contextMenuEnabled,
    showInTray,
    quickLaunchShortcut,
    updateSettings,
    loadSettings,
  } = useSettingsStore();
  const { loadItems } = useItemsStore();
  const { loadGroups } = useGroupsStore();
  const { loadData: loadToolData } = useToolDataStore();

  const [localSettings, setLocalSettings] = useState({
    theme,
    closeToTray,
    autoStart,
    contextMenuEnabled,
    showInTray,
    quickLaunchShortcut: quickLaunchShortcut || 'Alt+Space',
    iconSize: useSettingsStore.getState().iconSize || 'medium',
    qweatherApiKey: useSettingsStore.getState().qweatherApiKey || '',
    qweatherApiHost: useSettingsStore.getState().qweatherApiHost || '',
    clipboardShortcut: useSettingsStore.getState().clipboardShortcut || 'Alt+C',
    toolboxShortcut: useSettingsStore.getState().toolboxShortcut || 'Alt+T',
    clipboardEnabled: useSettingsStore.getState().clipboardEnabled ?? true,
    clipboardMaxCount: useSettingsStore.getState().clipboardMaxCount ?? 0,
    clipboardDurationDays: useSettingsStore.getState().clipboardDurationDays ?? 0,
    clipboardAutoPaste: useSettingsStore.getState().clipboardAutoPaste ?? 'double',
    clipboardPastePlain: useSettingsStore.getState().clipboardPastePlain ?? false,
    clipboardAutoSort: useSettingsStore.getState().clipboardAutoSort ?? true,
    clipboardSearchPosition: useSettingsStore.getState().clipboardSearchPosition ?? 'top',
    clipboardSearchAutoClear: useSettingsStore.getState().clipboardSearchAutoClear ?? false,
    // OCR 设置
    ocrShortcut: useSettingsStore.getState().ocrShortcut || 'Ctrl+Shift+A',
    ocrProvider: useSettingsStore.getState().ocrProvider || 'baidu',
    ocrBaiduApiKey: useSettingsStore.getState().ocrBaiduApiKey || '',
    ocrBaiduSecretKey: useSettingsStore.getState().ocrBaiduSecretKey || '',
    ocrBaiduHighAccuracy: useSettingsStore.getState().ocrBaiduHighAccuracy ?? true,
    ocrGoogleApiKey: useSettingsStore.getState().ocrGoogleApiKey || '',
    ocrTencentSecretId: useSettingsStore.getState().ocrTencentSecretId || '',
    ocrTencentSecretKey: useSettingsStore.getState().ocrTencentSecretKey || '',
    ocrTencentRegion: useSettingsStore.getState().ocrTencentRegion || 'ap-guangzhou',
    ocrAliyunAccessKeyId: useSettingsStore.getState().ocrAliyunAccessKeyId || '',
    ocrAliyunAccessKeySecret: useSettingsStore.getState().ocrAliyunAccessKeySecret || '',
    ocrAutoRecognize: useSettingsStore.getState().ocrAutoRecognize ?? false,
    ocrCopyAfterRecognize: useSettingsStore.getState().ocrCopyAfterRecognize ?? true,
    // 翻译设置
    translateShortcut: useSettingsStore.getState().translateShortcut || 'Alt+Shift+T',
    quickTranslateShortcut: useSettingsStore.getState().quickTranslateShortcut || 'Alt+Q',
    wordSelectionTranslateShortcut:
      useSettingsStore.getState().wordSelectionTranslateShortcut || 'Alt+W',
    translateProvider: useSettingsStore.getState().translateProvider || 'baidu',
    translateMode: useSettingsStore.getState().translateMode || 'window',
    translateFromLang: useSettingsStore.getState().translateFromLang || 'auto',
    translateToLang: useSettingsStore.getState().translateToLang || 'zh',
    translateBaiduAppId: useSettingsStore.getState().translateBaiduAppId || '',
    translateBaiduSecretKey: useSettingsStore.getState().translateBaiduSecretKey || '',
    translateGoogleApiKey: useSettingsStore.getState().translateGoogleApiKey || '',
    translateBingApiKey: useSettingsStore.getState().translateBingApiKey || '',
    translateTencentSecretId: useSettingsStore.getState().translateTencentSecretId || '',
    translateTencentSecretKey: useSettingsStore.getState().translateTencentSecretKey || '',
    translateTencentRegion: useSettingsStore.getState().translateTencentRegion || 'ap-guangzhou',
    translateOpenaiApiKey: useSettingsStore.getState().translateOpenaiApiKey || '',
    translateOpenaiModel: useSettingsStore.getState().translateOpenaiModel || 'gpt-4o',
    translateOpenaiBaseUrl: useSettingsStore.getState().translateOpenaiBaseUrl || '',
    translateOpenaiCompatibleProviders:
      useSettingsStore.getState().translateOpenaiCompatibleProviders || [],
    translateOpenaiCompatibleProviderId:
      useSettingsStore.getState().translateOpenaiCompatibleProviderId || '',
    translateDeepseekApiKey: useSettingsStore.getState().translateDeepseekApiKey || '',
    translateDeepseekModel:
      useSettingsStore.getState().translateDeepseekModel || 'deepseek-v4-flash',
    translateDeepseekBaseUrl:
      useSettingsStore.getState().translateDeepseekBaseUrl || 'https://api.deepseek.com',
    translateGeminiApiKey: useSettingsStore.getState().translateGeminiApiKey || '',
    translateGeminiModel: useSettingsStore.getState().translateGeminiModel || 'gemini-pro',
    translateAutoDetectLanguage: useSettingsStore.getState().translateAutoDetectLanguage ?? true,
    translateShowOriginalText: useSettingsStore.getState().translateShowOriginalText ?? true,
    translateAutoCopy: useSettingsStore.getState().translateAutoCopy ?? false,
    translateOverlayOpacity: useSettingsStore.getState().translateOverlayOpacity ?? 0.9,
    translateOverlayFontSize: useSettingsStore.getState().translateOverlayFontSize ?? 16,
    // 截图设置
    screenshotFullscreenShortcut:
      useSettingsStore.getState().screenshotFullscreenShortcut || 'Alt+A',
    screenshotRegionShortcut: useSettingsStore.getState().screenshotRegionShortcut || 'Alt+Shift+A',
    // AI 聊天设置
    aiChatShortcut: useSettingsStore.getState().aiChatShortcut || 'Alt+G',
    aiProviders: useSettingsStore.getState().aiProviders || [],
    activeAiProviderId: useSettingsStore.getState().activeAiProviderId || '',
    defaultAiModel: useSettingsStore.getState().defaultAiModel || '',
  });
  const [searchEngines, setSearchEngines] = useState<SearchEngine[]>(
    useSettingsStore.getState().searchEngines || []
  );
  const [contextMenuStatus, setContextMenuStatus] = useState<ContextMenuStatus | null>(null);
  const [contextMenuStatusError, setContextMenuStatusError] = useState('');
  const [wechatOcrStatus, setWechatOcrStatus] = useState<WechatOcrEnvironment | null>(null);
  const [wechatOcrMessage, setWechatOcrMessage] = useState('');
  const [wechatOcrBusy, setWechatOcrBusy] = useState(false);
  const [paddleOcrStatus, setPaddleOcrStatus] = useState<PaddleOcrEnvironment | null>(null);
  const [paddleOcrMessage, setPaddleOcrMessage] = useState('');
  const [paddleOcrBusy, setPaddleOcrBusy] = useState(false);
  const [wpsOcrStatus, setWpsOcrStatus] = useState<WpsOcrEnvironment | null>(null);
  const [wpsOcrMessage, setWpsOcrMessage] = useState('');
  const [wpsOcrBusy, setWpsOcrBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<
    | 'general'
    | 'shortcut'
    | 'clipboard'
    | 'ocr'
    | 'translate'
    | 'search'
    | 'weather'
    | 'ai'
    | 'data'
  >('general');

  // 快速启动快捷键录入状态
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);
  // 剪贴板快捷键录入状态
  const [isRecordingClipboardShortcut, setIsRecordingClipboardShortcut] = useState(false);
  // 工具箱快捷键录入状态
  const [isRecordingToolboxShortcut, setIsRecordingToolboxShortcut] = useState(false);
  // AI聊天快捷键录入状态
  const [isRecordingAiChatShortcut, setIsRecordingAiChatShortcut] = useState(false);
  // OCR 快捷键录入状态
  const [isRecordingOcrShortcut, setIsRecordingOcrShortcut] = useState(false);
  // 翻译快捷键录入状态
  const [isRecordingTranslateShortcut, setIsRecordingTranslateShortcut] = useState(false);
  // 快捷翻译快捷键录入状态
  const [isRecordingQuickTranslateShortcut, setIsRecordingQuickTranslateShortcut] = useState(false);
  // 划词翻译快捷键录入状态
  const [isRecordingWordSelectionTranslateShortcut, setIsRecordingWordSelectionTranslateShortcut] =
    useState(false);
  // 截图快捷键录入状态
  const [isRecordingScreenshotFullscreenShortcut, setIsRecordingScreenshotFullscreenShortcut] =
    useState(false);
  const [isRecordingScreenshotRegionShortcut, setIsRecordingScreenshotRegionShortcut] =
    useState(false);
  const shortcutInputRef = useRef<HTMLButtonElement>(null);

  // 快捷键录入逻辑（通用）
  const handleShortcutKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (
        !isRecordingShortcut &&
        !isRecordingClipboardShortcut &&
        !isRecordingToolboxShortcut &&
        !isRecordingAiChatShortcut &&
        !isRecordingOcrShortcut &&
        !isRecordingTranslateShortcut &&
        !isRecordingQuickTranslateShortcut &&
        !isRecordingWordSelectionTranslateShortcut &&
        !isRecordingScreenshotFullscreenShortcut &&
        !isRecordingScreenshotRegionShortcut
      )
        return;
      e.preventDefault();
      e.stopPropagation();

      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('CmdOrCtrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');

      let key = e.key;
      if (key === ' ') key = 'Space';
      else if (key === 'Escape') {
        setIsRecordingShortcut(false);
        setIsRecordingClipboardShortcut(false);
        setIsRecordingToolboxShortcut(false);
        setIsRecordingAiChatShortcut(false);
        setIsRecordingOcrShortcut(false);
        setIsRecordingTranslateShortcut(false);
        setIsRecordingQuickTranslateShortcut(false);
        setIsRecordingWordSelectionTranslateShortcut(false);
        setIsRecordingScreenshotFullscreenShortcut(false);
        setIsRecordingScreenshotRegionShortcut(false);
        return;
      } else if (key.length === 1) key = key.toUpperCase();

      parts.push(key);
      if (!e.ctrlKey && !e.altKey && !e.shiftKey) return;

      // Windows 拦截 Alt+字母行数字键（Digit0-9），全局快捷键无法触发
      // 小键盘数字键（Numpad）不受影响
      // 检测到此情况时自动加 Shift，变为 Alt+Shift+数字
      const isAltDigitRow =
        e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        /^[0-9]$/.test(e.key) &&
        e.code.startsWith('Digit');
      const shortcut = isAltDigitRow ? `Alt+Shift+${key}` : parts.join('+');
      if (isRecordingShortcut) {
        setLocalSettings((prev) => ({ ...prev, quickLaunchShortcut: shortcut }));
        setIsRecordingShortcut(false);
      } else if (isRecordingClipboardShortcut) {
        setLocalSettings((prev) => ({ ...prev, clipboardShortcut: shortcut }));
        setIsRecordingClipboardShortcut(false);
      } else if (isRecordingToolboxShortcut) {
        setLocalSettings((prev) => ({ ...prev, toolboxShortcut: shortcut }));
        setIsRecordingToolboxShortcut(false);
      } else if (isRecordingAiChatShortcut) {
        setLocalSettings((prev) => ({ ...prev, aiChatShortcut: shortcut }));
        setIsRecordingAiChatShortcut(false);
      } else if (isRecordingOcrShortcut) {
        setLocalSettings((prev) => ({ ...prev, ocrShortcut: shortcut }));
        setIsRecordingOcrShortcut(false);
      } else if (isRecordingTranslateShortcut) {
        setLocalSettings((prev) => ({ ...prev, translateShortcut: shortcut }));
        setIsRecordingTranslateShortcut(false);
      } else if (isRecordingQuickTranslateShortcut) {
        setLocalSettings((prev) => ({ ...prev, quickTranslateShortcut: shortcut }));
        setIsRecordingQuickTranslateShortcut(false);
      } else if (isRecordingWordSelectionTranslateShortcut) {
        setLocalSettings((prev) => ({ ...prev, wordSelectionTranslateShortcut: shortcut }));
        setIsRecordingWordSelectionTranslateShortcut(false);
      } else if (isRecordingScreenshotFullscreenShortcut) {
        setLocalSettings((prev) => ({ ...prev, screenshotFullscreenShortcut: shortcut }));
        setIsRecordingScreenshotFullscreenShortcut(false);
      } else if (isRecordingScreenshotRegionShortcut) {
        setLocalSettings((prev) => ({ ...prev, screenshotRegionShortcut: shortcut }));
        setIsRecordingScreenshotRegionShortcut(false);
      }
    },
    [
      isRecordingShortcut,
      isRecordingClipboardShortcut,
      isRecordingToolboxShortcut,
      isRecordingAiChatShortcut,
      isRecordingOcrShortcut,
      isRecordingTranslateShortcut,
      isRecordingQuickTranslateShortcut,
      isRecordingWordSelectionTranslateShortcut,
      isRecordingScreenshotFullscreenShortcut,
      isRecordingScreenshotRegionShortcut,
    ]
  );

  useEffect(() => {
    // 无论是否在录入状态，都注册监听器（cleanup 由 return 统一处理）
    document.addEventListener('keydown', handleShortcutKeyDown, true);
    return () => document.removeEventListener('keydown', handleShortcutKeyDown, true);
  }, [handleShortcutKeyDown]);

  useEffect(() => {
    void invoke<ContextMenuStatus>('get_context_menu_status')
      .then((status) => {
        setContextMenuStatus(status);
        setContextMenuStatusError('');
      })
      .catch((error) => setContextMenuStatusError(String(error)));
  }, []);

  const detectWechatOcr = useCallback(async () => {
    setWechatOcrBusy(true);
    setWechatOcrMessage('正在检测内置微信 OCR...');
    try {
      const status = await invoke<WechatOcrEnvironment>('detect_wechat_ocr_environment', {});
      setWechatOcrStatus(status);
      setWechatOcrMessage(
        status.available
          ? '内置微信 OCR 已就绪。'
          : `内置微信 OCR 尚未就绪：${status.missing.join('；') || status.message}`
      );
    } catch (error) {
      setWechatOcrStatus(null);
      setWechatOcrMessage(String(error));
    } finally {
      setWechatOcrBusy(false);
    }
  }, []);

  const detectPaddleOcr = useCallback(async () => {
    setPaddleOcrBusy(true);
    setPaddleOcrMessage('正在检测内置 PaddleOCR...');
    try {
      const status = await invoke<PaddleOcrEnvironment>('detect_paddle_ocr_environment', {});
      setPaddleOcrStatus(status);
      setPaddleOcrMessage(
        status.available
          ? '内置 PaddleOCR 已就绪。'
          : `内置 PaddleOCR 尚未就绪：${status.missing.join('；') || status.message}`
      );
    } catch (error) {
      setPaddleOcrStatus(null);
      setPaddleOcrMessage(String(error));
    } finally {
      setPaddleOcrBusy(false);
    }
  }, []);

  const detectWpsOcr = useCallback(async () => {
    setWpsOcrBusy(true);
    setWpsOcrMessage('正在检测内置 WPS OCR...');
    try {
      const status = await invoke<WpsOcrEnvironment>('detect_wps_ocr_environment', {});
      setWpsOcrStatus(status);
      setWpsOcrMessage(
        status.available
          ? '内置 WPS OCR 已就绪。'
          : `内置 WPS OCR 尚未就绪：${status.missing.join('；') || status.message}`
      );
    } catch (error) {
      setWpsOcrStatus(null);
      setWpsOcrMessage(String(error));
    } finally {
      setWpsOcrBusy(false);
    }
  }, []);

  const createOpenaiCompatibleProvider = (): TranslateOpenaiCompatibleProvider => ({
    id: `openai-compatible-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: `兼容服务 ${localSettings.translateOpenaiCompatibleProviders.length + 1}`,
    apiKey: '',
    model: '',
    baseUrl: '',
  });

  const addOpenaiCompatibleProvider = () => {
    const provider = createOpenaiCompatibleProvider();
    setLocalSettings({
      ...localSettings,
      translateProvider: 'openai-compatible',
      translateOpenaiCompatibleProviderId: provider.id,
      translateOpenaiCompatibleProviders: [
        ...localSettings.translateOpenaiCompatibleProviders,
        provider,
      ],
    });
  };

  const updateOpenaiCompatibleProvider = (
    id: string,
    patch: Partial<TranslateOpenaiCompatibleProvider>
  ) => {
    setLocalSettings({
      ...localSettings,
      translateOpenaiCompatibleProviders: localSettings.translateOpenaiCompatibleProviders.map(
        (provider) => (provider.id === id ? { ...provider, ...patch } : provider)
      ),
    });
  };

  const deleteOpenaiCompatibleProvider = (id: string) => {
    const providers = localSettings.translateOpenaiCompatibleProviders.filter(
      (provider) => provider.id !== id
    );
    setLocalSettings({
      ...localSettings,
      translateOpenaiCompatibleProviders: providers,
      translateOpenaiCompatibleProviderId:
        localSettings.translateOpenaiCompatibleProviderId === id
          ? providers[0]?.id || ''
          : localSettings.translateOpenaiCompatibleProviderId,
    });
  };

  const handleSave = async () => {
    const shouldReportContextMenu =
      contextMenuStatus == null
        ? localSettings.contextMenuEnabled !== contextMenuEnabled
        : localSettings.contextMenuEnabled !== contextMenuStatus.installed;
    const normalizedOpenaiCompatibleProviders =
      localSettings.translateOpenaiCompatibleProviders.map((provider, index) => ({
        id: provider.id || `openai-compatible-${index + 1}`,
        name: provider.name.trim() || `兼容服务 ${index + 1}`,
        apiKey: provider.apiKey.trim(),
        model: provider.model.trim(),
        baseUrl: provider.baseUrl.trim().replace(/\/+$/, ''),
      }));
    const normalizedOpenaiCompatibleProviderId = normalizedOpenaiCompatibleProviders.some(
      (provider) => provider.id === localSettings.translateOpenaiCompatibleProviderId
    )
      ? localSettings.translateOpenaiCompatibleProviderId
      : normalizedOpenaiCompatibleProviders[0]?.id || '';
    const normalizedSettings = {
      ...localSettings,
      ocrBaiduApiKey: localSettings.ocrBaiduApiKey.trim(),
      ocrBaiduSecretKey: localSettings.ocrBaiduSecretKey.trim(),
      ocrGoogleApiKey: localSettings.ocrGoogleApiKey.trim(),
      ocrTencentSecretId: localSettings.ocrTencentSecretId.trim(),
      ocrTencentSecretKey: localSettings.ocrTencentSecretKey.trim(),
      ocrTencentRegion: localSettings.ocrTencentRegion.trim() || 'ap-guangzhou',
      ocrAliyunAccessKeyId: localSettings.ocrAliyunAccessKeyId.trim(),
      ocrAliyunAccessKeySecret: localSettings.ocrAliyunAccessKeySecret.trim(),
      translateBaiduAppId: localSettings.translateBaiduAppId.trim(),
      translateBaiduSecretKey: localSettings.translateBaiduSecretKey.trim(),
      translateGoogleApiKey: localSettings.translateGoogleApiKey.trim(),
      translateBingApiKey: localSettings.translateBingApiKey.trim(),
      translateTencentSecretId: localSettings.translateTencentSecretId.trim(),
      translateTencentSecretKey: localSettings.translateTencentSecretKey.trim(),
      translateTencentRegion: localSettings.translateTencentRegion.trim() || 'ap-guangzhou',
      translateOpenaiApiKey: localSettings.translateOpenaiApiKey.trim(),
      translateOpenaiBaseUrl: localSettings.translateOpenaiBaseUrl.trim(),
      translateOpenaiCompatibleProviders: normalizedOpenaiCompatibleProviders,
      translateOpenaiCompatibleProviderId: normalizedOpenaiCompatibleProviderId,
      translateDeepseekApiKey: localSettings.translateDeepseekApiKey.trim(),
      translateDeepseekModel: localSettings.translateDeepseekModel.trim() || 'deepseek-v4-flash',
      translateDeepseekBaseUrl:
        localSettings.translateDeepseekBaseUrl.trim() || 'https://api.deepseek.com',
      translateGeminiApiKey: localSettings.translateGeminiApiKey.trim(),
    };
    try {
      await updateSettings({ ...normalizedSettings, searchEngines });
      if (shouldReportContextMenu) {
        const status = await invoke<ContextMenuStatus>('get_context_menu_status');
        setContextMenuStatus(status);
        await showMessage(
          normalizedSettings.contextMenuEnabled
            ? `已添加文件/文件夹右键菜单。\n\n位置：${status.registryPath}\nWindows 11 可能需要在“显示更多选项”里查看。`
            : '已移除文件/文件夹右键菜单。',
          { title: '右键菜单', type: 'info' }
        );
      }
      onClose();
    } catch (error) {
      await showMessage(`保存失败：${error}`, { title: '错误', type: 'error' });
    }
  };

  const handleOpenDataDir = async () => {
    try {
      const dir = await invoke<string>('open_data_dir');
      await showMessage(`数据目录：\n${dir}`, { title: '数据目录', type: 'info' });
    } catch (error) {
      await showMessage(`打开失败：${error}`, { title: '错误', type: 'error' });
    }
  };

  const handleExport = async () => {
    try {
      const backupPath = await invoke<string>('export_config', {
        frontendData: collectFrontendBackupData(),
      });
      await showMessage(`完整备份已导出到：\n${backupPath}`, {
        title: '导出成功',
        type: 'info',
      });
    } catch (error) {
      await showMessage(`导出失败：${error}`, { title: '错误', type: 'error' });
    }
  };

  const handleImport = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (selected && typeof selected === 'string') {
        const result = await invoke<ImportConfigResult>('import_config', { path: selected });
        restoreFrontendBackupData(result.frontend);
        await Promise.all([loadItems(), loadGroups(), loadSettings(), loadToolData()]);
        await showMessage(
          [
            '配置导入成功，数据已重新加载。',
            '启动器项目会按便携配置恢复，项目快捷键会保留，开机启动状态不会迁移。',
            result.restoredToolData ? '已恢复工具箱数据。' : '旧版备份未包含工具箱数据。',
            result.restoredAiChat
              ? '已恢复 AI 聊天历史和用户记忆。'
              : '旧版备份未包含 AI 聊天数据。',
          ].join('\n'),
          {
            title: '导入成功',
            type: 'info',
          }
        );
      }
    } catch (error) {
      await showMessage(`导入失败：${error}`, { title: '错误', type: 'error' });
    }
  };

  const handleRestoreLatestBackup = async () => {
    try {
      const backups = await invoke<[string, string][]>('list_backups');
      const latestBackup = backups[0];

      if (!latestBackup) {
        await showMessage('未找到可用备份。', { title: '暂无备份', type: 'info' });
        return;
      }

      const [backupName, backupPath] = latestBackup;
      const confirmed = window.confirm(
        `将从最近一次自动备份恢复数据：\n\n${backupName}\n\n这会覆盖当前数据，是否继续？`
      );

      if (!confirmed) {
        return;
      }

      const result = await invoke<ImportConfigResult>('import_config', { path: backupPath });
      restoreFrontendBackupData(result.frontend);
      await Promise.all([loadItems(), loadGroups(), loadSettings(), loadToolData()]);
      await showMessage(`已从备份恢复：\n${backupName}`, {
        title: '恢复成功',
        type: 'info',
      });
    } catch (error) {
      await showMessage(`恢复备份失败：${error}`, { title: '错误', type: 'error' });
    }
  };

  const handleRecoverFromRegistry = async () => {
    try {
      const recoverable =
        await invoke<Array<{ name: string; alias: string }>>('recover_from_registry');
      if (recoverable.length === 0) {
        await showMessage('未发现可恢复的数据。\n\n所有注册表快捷方式都已在软件中记录。', {
          title: '无需恢复',
          type: 'info',
        });
        return;
      }
      const itemList = recoverable.map((i) => `• ${i.name}（${i.alias}）`).join('\n');
      const confirmed = window.confirm(
        `🔍 发现 ${recoverable.length} 个可恢复的项目：\n\n` +
          itemList +
          `\n\n是否将这些数据恢复到软件中？`
      );
      if (confirmed) {
        const count = await invoke<number>('save_recovered_items', { items: recoverable });
        await loadItems();
        await showMessage(`✅ 已成功恢复 ${count} 个项目！`, { title: '恢复成功', type: 'info' });
      }
    } catch (error) {
      await showMessage(`恢复失败：${error}`, { title: '错误', type: 'error' });
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <SettingsIcon size={24} className="text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">设置</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Tab 导航 - 固定不滚动 */}
        <div className="flex justify-center border-b border-gray-200 dark:border-gray-700 px-6 flex-shrink-0">
          <div className="flex gap-1 overflow-x-auto">
            {[
              { key: 'general', label: '外观 & 窗口' },
              { key: 'shortcut', label: '快捷键' },
              { key: 'clipboard', label: '剪贴板' },
              { key: 'ocr', label: 'OCR 识别' },
              { key: 'translate', label: '截图翻译' },
              { key: 'search', label: '搜索引擎' },
              { key: 'weather', label: '天气' },
              { key: 'ai', label: 'AI 聊天' },
              { key: 'data', label: '数据管理' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-[#0066ff] text-[#0066ff]'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 外观 & 窗口 */}
          {activeTab === 'general' && (
            <>
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">外观</h3>{' '}
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-gray-700 dark:text-gray-300">主题</span>
                    <select
                      value={localSettings.theme}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          theme: e.target.value as 'light' | 'dark' | 'system',
                        })
                      }
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                      <option value="system">跟随系统</option>
                    </select>
                  </label>

                  <label className="flex items-center justify-between">
                    <div>
                      <div className="text-gray-700 dark:text-gray-300">图标大小</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        项目列表中显示的图标尺寸
                      </div>
                    </div>
                    <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
                      {(['small', 'medium', 'large'] as const).map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setLocalSettings({ ...localSettings, iconSize: size })}
                          className={`px-3 py-1.5 rounded text-sm transition-colors ${
                            localSettings.iconSize === size
                              ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm font-medium'
                              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                          }`}
                        >
                          {size === 'small' ? '小' : size === 'medium' ? '中' : '大'}
                        </button>
                      ))}
                    </div>
                  </label>
                </div>
              </div>

              {/* 窗口行为 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">窗口行为</h3>
                <div className="space-y-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="text-gray-700 dark:text-gray-300">显示系统托盘图标</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        在系统托盘显示应用图标
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={localSettings.showInTray}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, showInTray: e.target.checked })
                      }
                      className="w-5 h-5 text-primary-600 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="text-gray-700 dark:text-gray-300">关闭时最小化到托盘</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        点击关闭按钮时隐藏到托盘而不是退出程序
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={localSettings.closeToTray}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, closeToTray: e.target.checked })
                      }
                      className="w-5 h-5 text-primary-600 rounded"
                      disabled={!localSettings.showInTray}
                    />
                  </label>
                </div>
              </div>

              {/* 系统集成 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">系统集成</h3>
                <div className="space-y-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="text-gray-700 dark:text-gray-300">开机自动启动</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        Windows 启动时自动运行 McStartUP
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={localSettings.autoStart}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, autoStart: e.target.checked })
                      }
                      className="w-5 h-5 text-primary-600 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <div className="text-gray-700 dark:text-gray-300">添加到右键菜单</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        在文件/文件夹右键添加启动项入口；桌面空白处始终提供桌面 Box 菜单
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={localSettings.contextMenuEnabled}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, contextMenuEnabled: e.target.checked })
                      }
                      className="w-5 h-5 text-primary-600 rounded"
                    />
                  </label>
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                    <div>
                      当前系统状态：
                      <span
                        className={
                          contextMenuStatus?.installed
                            ? 'font-medium text-green-600 dark:text-green-400'
                            : 'font-medium text-gray-600 dark:text-gray-300'
                        }
                      >
                        {contextMenuStatus?.installed ? '已添加' : '未添加'}
                      </span>
                      {contextMenuStatus != null &&
                        localSettings.contextMenuEnabled !== contextMenuStatus.installed &&
                        '（待保存应用）'}
                    </div>
                    <div>
                      桌面 Box 菜单：
                      <span
                        className={
                          contextMenuStatus?.desktopBoxInstalled
                            ? 'font-medium text-green-600 dark:text-green-400'
                            : 'font-medium text-red-600 dark:text-red-300'
                        }
                      >
                        {contextMenuStatus?.desktopBoxInstalled ? '已添加' : '未添加'}
                      </span>
                    </div>
                    <div>
                      写入位置：
                      {contextMenuStatus?.registryPath ||
                        'HKCU\\Software\\Classes\\*\\shell\\McStartUP；HKCU\\Software\\Classes\\Directory\\shell\\McStartUP；HKCU\\Software\\Classes\\CLSID\\{B9E1F7D5-6D89-4A1A-9E8B-6E4D3D03D5F4}；HKCU\\Software\\Classes\\Directory\\Background\\ShellEx\\ContextMenuHandlers\\McStartUPDesktopBox'}
                    </div>
                    <div>Windows 11 通常显示在“显示更多选项”里。</div>
                    {contextMenuStatusError && (
                      <div className="text-red-500 dark:text-red-300">
                        状态读取失败：{contextMenuStatusError}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 快捷键 */}
            </>
          )}
          {activeTab === 'shortcut' && (
            <>
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">快捷键</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-gray-700 dark:text-gray-300">快速启动面板</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        全局快捷键呼出搜索面板，输入别名快速启动
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        ref={shortcutInputRef}
                        onClick={() => setIsRecordingShortcut(true)}
                        className={`px-4 py-2 min-w-[140px] text-center border-2 rounded-lg font-mono text-sm transition-all ${
                          isRecordingShortcut
                            ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] animate-pulse'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                      >
                        {isRecordingShortcut ? (
                          <span className="flex items-center gap-2 justify-center">
                            <Keyboard size={14} />
                            按下快捷键...
                          </span>
                        ) : (
                          formatShortcutDisplay(localSettings.quickLaunchShortcut)
                        )}
                      </button>
                      {localSettings.quickLaunchShortcut !== 'Alt+Space' && (
                        <button
                          onClick={() =>
                            setLocalSettings((prev) => ({
                              ...prev,
                              quickLaunchShortcut: 'Alt+Space',
                            }))
                          }
                          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          title="恢复默认"
                        >
                          重置
                        </button>
                      )}
                    </div>
                  </div>
                  {isRecordingShortcut && (
                    <p className="text-xs text-[#0066ff]">
                      请按下组合键（需包含 Ctrl/Alt/Shift 修饰键），按 Esc 取消
                    </p>
                  )}
                </div>

                {/* 剪贴板快捷键 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        剪贴板历史快捷键
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        呼出剪贴板历史窗口
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsRecordingClipboardShortcut(true)}
                        className={`px-4 py-2 min-w-[140px] text-center border-2 rounded-lg font-mono text-sm transition-all ${
                          isRecordingClipboardShortcut
                            ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] animate-pulse'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                      >
                        {isRecordingClipboardShortcut ? (
                          <span className="flex items-center gap-2 justify-center">
                            <Keyboard size={14} />
                            按下快捷键...
                          </span>
                        ) : (
                          formatShortcutDisplay(localSettings.clipboardShortcut || 'Alt+C')
                        )}
                      </button>
                      {localSettings.clipboardShortcut !== 'Alt+C' && (
                        <button
                          onClick={() =>
                            setLocalSettings((p) => ({ ...p, clipboardShortcut: 'Alt+C' }))
                          }
                          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          重置
                        </button>
                      )}
                    </div>
                  </div>
                  {isRecordingClipboardShortcut && (
                    <p className="text-xs text-[#0066ff]">
                      请按下组合键（需包含 Ctrl/Alt/Shift 修饰键），按 Esc 取消
                    </p>
                  )}
                </div>

                {/* 工具箱快捷键 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        工具箱快捷键
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        呼出工具箱面板
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsRecordingToolboxShortcut(true)}
                        className={`px-4 py-2 min-w-[140px] text-center border-2 rounded-lg font-mono text-sm transition-all ${
                          isRecordingToolboxShortcut
                            ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] animate-pulse'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                      >
                        {isRecordingToolboxShortcut ? (
                          <span className="flex items-center gap-2 justify-center">
                            <Keyboard size={14} />
                            按下快捷键...
                          </span>
                        ) : (
                          formatShortcutDisplay(localSettings.toolboxShortcut || 'Alt+T')
                        )}
                      </button>
                      {localSettings.toolboxShortcut !== 'Alt+T' && (
                        <button
                          onClick={() =>
                            setLocalSettings((p) => ({ ...p, toolboxShortcut: 'Alt+T' }))
                          }
                          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          重置
                        </button>
                      )}
                    </div>
                  </div>
                  {isRecordingToolboxShortcut && (
                    <p className="text-xs text-[#0066ff]">
                      请按下组合键（需包含 Ctrl/Alt/Shift 修饰键），按 Esc 取消
                    </p>
                  )}
                </div>

                {/* AI聊天快捷键 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        AI聊天快捷键
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        呼出AI聊天面板
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsRecordingAiChatShortcut(true)}
                        className={`px-4 py-2 min-w-[140px] text-center border-2 rounded-lg font-mono text-sm transition-all ${
                          isRecordingAiChatShortcut
                            ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] animate-pulse'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                      >
                        {isRecordingAiChatShortcut ? (
                          <span className="flex items-center gap-2 justify-center">
                            <Keyboard size={14} />
                            按下快捷键...
                          </span>
                        ) : (
                          formatShortcutDisplay(localSettings.aiChatShortcut || 'Alt+G')
                        )}
                      </button>
                      {localSettings.aiChatShortcut !== 'Alt+G' && (
                        <button
                          onClick={() =>
                            setLocalSettings((p) => ({ ...p, aiChatShortcut: 'Alt+G' }))
                          }
                          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          重置
                        </button>
                      )}
                    </div>
                  </div>
                  {isRecordingAiChatShortcut && (
                    <p className="text-xs text-[#0066ff]">
                      请按下组合键（需包含 Ctrl/Alt/Shift 修饰键），按 Esc 取消
                    </p>
                  )}
                </div>

                {/* 划词翻译快捷键 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        划词翻译快捷键
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        选中文本后按快捷键快速翻译
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsRecordingWordSelectionTranslateShortcut(true)}
                        className={`px-4 py-2 min-w-[140px] text-center border-2 rounded-lg font-mono text-sm transition-all ${
                          isRecordingWordSelectionTranslateShortcut
                            ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] animate-pulse'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                      >
                        {isRecordingWordSelectionTranslateShortcut ? (
                          <span className="flex items-center gap-2 justify-center">
                            <Keyboard size={14} />
                            按下快捷键...
                          </span>
                        ) : (
                          formatShortcutDisplay(
                            localSettings.wordSelectionTranslateShortcut || 'Alt+W'
                          )
                        )}
                      </button>
                      {localSettings.wordSelectionTranslateShortcut !== 'Alt+W' && (
                        <button
                          onClick={() =>
                            setLocalSettings((p) => ({
                              ...p,
                              wordSelectionTranslateShortcut: 'Alt+W',
                            }))
                          }
                          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          重置
                        </button>
                      )}
                    </div>
                  </div>
                  {isRecordingWordSelectionTranslateShortcut && (
                    <p className="text-xs text-[#0066ff]">
                      请按下组合键（需包含 Ctrl/Alt/Shift 修饰键），按 Esc 取消
                    </p>
                  )}
                </div>

                {/* 全屏截图快捷键 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        全屏截图快捷键
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        直接截取全屏并显示结果
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsRecordingScreenshotFullscreenShortcut(true)}
                        className={`px-4 py-2 min-w-[140px] text-center border-2 rounded-lg font-mono text-sm transition-all ${
                          isRecordingScreenshotFullscreenShortcut
                            ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] animate-pulse'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                      >
                        {isRecordingScreenshotFullscreenShortcut ? (
                          <span className="flex items-center gap-2 justify-center">
                            <Keyboard size={14} />
                            按下快捷键...
                          </span>
                        ) : localSettings.screenshotFullscreenShortcut ? (
                          formatShortcutDisplay(localSettings.screenshotFullscreenShortcut)
                        ) : (
                          <span className="text-gray-400">未设置</span>
                        )}
                      </button>
                      {localSettings.screenshotFullscreenShortcut && (
                        <>
                          {localSettings.screenshotFullscreenShortcut !== 'Alt+A' && (
                            <button
                              onClick={() =>
                                setLocalSettings((p) => ({
                                  ...p,
                                  screenshotFullscreenShortcut: 'Alt+A',
                                }))
                              }
                              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                              重置
                            </button>
                          )}
                          <button
                            onClick={() =>
                              setLocalSettings((p) => ({ ...p, screenshotFullscreenShortcut: '' }))
                            }
                            className="text-xs text-red-400 hover:text-red-600"
                          >
                            清除
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {isRecordingScreenshotFullscreenShortcut && (
                    <p className="text-xs text-[#0066ff]">
                      请按下组合键（需包含 Ctrl/Alt/Shift 修饰键），按 Esc 取消
                    </p>
                  )}
                </div>

                {/* 区域截图快捷键 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        区域截图快捷键
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        框选屏幕区域进行截图
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsRecordingScreenshotRegionShortcut(true)}
                        className={`px-4 py-2 min-w-[140px] text-center border-2 rounded-lg font-mono text-sm transition-all ${
                          isRecordingScreenshotRegionShortcut
                            ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] animate-pulse'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                      >
                        {isRecordingScreenshotRegionShortcut ? (
                          <span className="flex items-center gap-2 justify-center">
                            <Keyboard size={14} />
                            按下快捷键...
                          </span>
                        ) : localSettings.screenshotRegionShortcut ? (
                          formatShortcutDisplay(localSettings.screenshotRegionShortcut)
                        ) : (
                          <span className="text-gray-400">未设置</span>
                        )}
                      </button>
                      {localSettings.screenshotRegionShortcut && (
                        <>
                          {localSettings.screenshotRegionShortcut !== 'Alt+Shift+A' && (
                            <button
                              onClick={() =>
                                setLocalSettings((p) => ({
                                  ...p,
                                  screenshotRegionShortcut: 'Alt+Shift+A',
                                }))
                              }
                              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                              重置
                            </button>
                          )}
                          <button
                            onClick={() =>
                              setLocalSettings((p) => ({ ...p, screenshotRegionShortcut: '' }))
                            }
                            className="text-xs text-red-400 hover:text-red-600"
                          >
                            清除
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {isRecordingScreenshotRegionShortcut && (
                    <p className="text-xs text-[#0066ff]">
                      请按下组合键（需包含 Ctrl/Alt/Shift 修饰键），按 Esc 取消
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* 剪贴板设置 */}
          {activeTab === 'clipboard' && (
            <>
              {/* 基本设置 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">剪贴板历史</h3>
                <div className="space-y-3">
                  <label className="flex items-center justify-between cursor-pointer p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        启用剪贴板监听
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        自动记录复制的内容（文本、图片、文件）
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={localSettings.clipboardEnabled ?? true}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, clipboardEnabled: e.target.checked })
                      }
                      className="w-5 h-5 text-[#0066ff] rounded"
                    />
                  </label>
                </div>
              </div>

              {/* 快捷键 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">快捷键</h3>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      呼出快捷键
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      全局快捷键，随时呼出剪贴板历史窗口
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsRecordingClipboardShortcut(true)}
                      className={`px-4 py-2 min-w-[140px] text-center border-2 rounded-lg font-mono text-sm transition-all ${
                        isRecordingClipboardShortcut
                          ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] animate-pulse'
                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                      }`}
                    >
                      {isRecordingClipboardShortcut ? (
                        <span className="flex items-center gap-2 justify-center">
                          <Keyboard size={14} />
                          按下快捷键...
                        </span>
                      ) : (
                        formatShortcutDisplay(localSettings.clipboardShortcut || 'Alt+C')
                      )}
                    </button>
                    {localSettings.clipboardShortcut !== 'Alt+C' && (
                      <button
                        onClick={() =>
                          setLocalSettings((prev) => ({ ...prev, clipboardShortcut: 'Alt+C' }))
                        }
                        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        重置
                      </button>
                    )}
                  </div>
                </div>
                {isRecordingClipboardShortcut && (
                  <p className="text-xs text-[#0066ff]">
                    请按下组合键（需包含 Ctrl/Alt/Shift 修饰键），按 Esc 取消
                  </p>
                )}
              </div>

              {/* 历史记录管理 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">历史记录管理</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        最大保存条数
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        超出后自动删除最旧的记录（0 = 不限制）
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={localSettings.clipboardMaxCount ?? 0}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          clipboardMaxCount: Math.max(0, parseInt(e.target.value) || 0),
                        })
                      }
                      className="w-24 px-3 py-1.5 text-sm text-center border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        保留天数
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        超过指定天数的记录自动删除（0 = 永久保留）
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={localSettings.clipboardDurationDays ?? 0}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            clipboardDurationDays: Math.max(0, parseInt(e.target.value) || 0),
                          })
                        }
                        className="w-24 px-3 py-1.5 text-sm text-center border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
                      />
                      <span className="text-sm text-gray-500 dark:text-gray-400">天</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 粘贴行为 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">粘贴行为</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        触发粘贴方式
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        点击历史记录时的粘贴触发方式
                      </div>
                    </div>
                    <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
                      {(['single', 'double'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() =>
                            setLocalSettings({ ...localSettings, clipboardAutoPaste: mode })
                          }
                          className={`px-3 py-1.5 rounded text-sm transition-colors ${
                            (localSettings.clipboardAutoPaste ?? 'double') === mode
                              ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm font-medium'
                              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                          }`}
                        >
                          {mode === 'single' ? '单击' : '双击'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center justify-between cursor-pointer p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        默认纯文本粘贴
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        粘贴时自动去除格式，只保留纯文本
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={localSettings.clipboardPastePlain ?? false}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          clipboardPastePlain: e.target.checked,
                        })
                      }
                      className="w-5 h-5 text-[#0066ff] rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        重复内容自动置顶
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        复制已有内容时，将其移到列表顶部
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={localSettings.clipboardAutoSort ?? true}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, clipboardAutoSort: e.target.checked })
                      }
                      className="w-5 h-5 text-[#0066ff] rounded"
                    />
                  </label>
                </div>
              </div>

              {/* 搜索框 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">搜索框</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        搜索框位置
                      </div>
                    </div>
                    <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
                      {(['top', 'bottom'] as const).map((pos) => (
                        <button
                          key={pos}
                          type="button"
                          onClick={() =>
                            setLocalSettings({ ...localSettings, clipboardSearchPosition: pos })
                          }
                          className={`px-3 py-1.5 rounded text-sm transition-colors ${
                            (localSettings.clipboardSearchPosition ?? 'top') === pos
                              ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm font-medium'
                              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                          }`}
                        >
                          {pos === 'top' ? '顶部' : '底部'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center justify-between cursor-pointer p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        窗口关闭时清空搜索
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        每次打开剪贴板窗口时自动清空搜索内容
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={localSettings.clipboardSearchAutoClear ?? false}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          clipboardSearchAutoClear: e.target.checked,
                        })
                      }
                      className="w-5 h-5 text-[#0066ff] rounded"
                    />
                  </label>
                </div>
              </div>

              {/* 清空历史 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">清空历史</h3>
                <div className="flex gap-3">
                  <button
                    onClick={async () => {
                      if (window.confirm('确定清空所有剪贴板历史？（收藏的记录将保留）')) {
                        await invoke('clipboard_clear', { keepFavorites: true });
                      }
                    }}
                    className="flex-1 px-4 py-2.5 border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg text-sm transition-colors"
                  >
                    清空（保留收藏）
                  </button>
                  <button
                    onClick={async () => {
                      if (window.confirm('确定清空全部剪贴板历史？此操作不可撤销！')) {
                        await invoke('clipboard_clear', { keepFavorites: false });
                      }
                    }}
                    className="flex-1 px-4 py-2.5 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm transition-colors"
                  >
                    清空全部
                  </button>
                </div>
              </div>
            </>
          )}

          {/* OCR 设置 */}
          {activeTab === 'ocr' && (
            <>
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">OCR 识别</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        截图识别快捷键
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        全局快捷键，按下后框选屏幕区域进行 OCR 识别
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsRecordingOcrShortcut(true)}
                        className={`px-4 py-2 min-w-[140px] text-center border-2 rounded-lg font-mono text-sm transition-all ${
                          isRecordingOcrShortcut
                            ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] animate-pulse'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                      >
                        {isRecordingOcrShortcut ? (
                          <span className="flex items-center gap-2 justify-center">
                            <Keyboard size={14} />
                            按下快捷键...
                          </span>
                        ) : (
                          formatShortcutDisplay(localSettings.ocrShortcut || 'Ctrl+Shift+A')
                        )}
                      </button>
                      {localSettings.ocrShortcut !== 'Ctrl+Shift+A' && (
                        <button
                          onClick={() =>
                            setLocalSettings((p) => ({ ...p, ocrShortcut: 'Ctrl+Shift+A' }))
                          }
                          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          重置
                        </button>
                      )}
                    </div>
                  </div>
                  {isRecordingOcrShortcut && (
                    <p className="text-xs text-[#0066ff]">
                      请按下组合键（需包含 Ctrl/Alt/Shift 修饰键），按 Esc 取消
                    </p>
                  )}
                </div>
              </div>

              {/* OCR 服务商 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">OCR 服务商</h3>
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300">默认服务商</span>
                    <select
                      value={localSettings.ocrProvider}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          ocrProvider: e.target.value as
                            | 'baidu'
                            | 'google'
                            | 'tencent'
                            | 'aliyun'
                            | 'wechat'
                            | 'paddle'
                            | 'wps',
                        })
                      }
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    >
                      <option value="baidu">百度 OCR</option>
                      <option value="google">Google Cloud Vision</option>
                      <option value="tencent">腾讯 OCR</option>
                      <option value="aliyun">阿里云 OCR</option>
                      <option value="wechat">微信本机 OCR</option>
                      <option value="paddle">PaddleOCR 本地</option>
                      <option value="wps">WPS OCR 本地</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* 百度 OCR 配置 */}
              {localSettings.ocrProvider === 'baidu' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    百度 OCR 配置
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        API Key
                      </label>
                      <input
                        type="text"
                        value={localSettings.ocrBaiduApiKey}
                        onChange={(e) =>
                          setLocalSettings({ ...localSettings, ocrBaiduApiKey: e.target.value })
                        }
                        placeholder="输入百度 OCR API Key"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        Secret Key
                      </label>
                      <input
                        type="password"
                        value={localSettings.ocrBaiduSecretKey}
                        onChange={(e) =>
                          setLocalSettings({ ...localSettings, ocrBaiduSecretKey: e.target.value })
                        }
                        placeholder="输入百度 OCR Secret Key"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={localSettings.ocrBaiduHighAccuracy}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            ocrBaiduHighAccuracy: e.target.checked,
                          })
                        }
                        className="w-4 h-4 text-[#0066ff] rounded"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        使用高精度版（识别更准确，但消耗更多配额）
                      </span>
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      💡 获取密钥：访问{' '}
                      <a
                        href="https://ai.baidu.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066ff] hover:underline"
                      >
                        ai.baidu.com
                      </a>{' '}
                      创建应用
                    </p>
                  </div>
                </div>
              )}

              {/* Google OCR 配置 */}
              {localSettings.ocrProvider === 'google' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    Google Cloud Vision 配置
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        API Key
                      </label>
                      <input
                        type="text"
                        value={localSettings.ocrGoogleApiKey}
                        onChange={(e) =>
                          setLocalSettings({ ...localSettings, ocrGoogleApiKey: e.target.value })
                        }
                        placeholder="输入 Google Cloud Vision API Key"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      💡 获取密钥：访问{' '}
                      <a
                        href="https://cloud.google.com/vision"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066ff] hover:underline"
                      >
                        cloud.google.com/vision
                      </a>{' '}
                      创建项目并启用 Vision API
                    </p>
                  </div>
                </div>
              )}

              {/* 腾讯 OCR 配置 */}
              {localSettings.ocrProvider === 'tencent' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    腾讯 OCR 配置
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        Secret ID
                      </label>
                      <input
                        type="text"
                        value={localSettings.ocrTencentSecretId}
                        onChange={(e) =>
                          setLocalSettings({ ...localSettings, ocrTencentSecretId: e.target.value })
                        }
                        placeholder="输入腾讯云 Secret ID"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        Secret Key
                      </label>
                      <input
                        type="password"
                        value={localSettings.ocrTencentSecretKey}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            ocrTencentSecretKey: e.target.value,
                          })
                        }
                        placeholder="输入腾讯云 Secret Key"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        地域
                      </label>
                      <input
                        type="text"
                        value={localSettings.ocrTencentRegion}
                        onChange={(e) =>
                          setLocalSettings({ ...localSettings, ocrTencentRegion: e.target.value })
                        }
                        placeholder="ap-guangzhou"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      💡 获取密钥：访问{' '}
                      <a
                        href="https://cloud.tencent.com/product/ocr"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066ff] hover:underline"
                      >
                        cloud.tencent.com/product/ocr
                      </a>{' '}
                      开通服务
                    </p>
                  </div>
                </div>
              )}

              {/* 阿里云 OCR 配置 */}
              {localSettings.ocrProvider === 'aliyun' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    阿里云 OCR 配置
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        Access Key ID
                      </label>
                      <input
                        type="text"
                        value={localSettings.ocrAliyunAccessKeyId}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            ocrAliyunAccessKeyId: e.target.value,
                          })
                        }
                        placeholder="请输入 Access Key ID"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        Access Key Secret
                      </label>
                      <input
                        type="password"
                        value={localSettings.ocrAliyunAccessKeySecret}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            ocrAliyunAccessKeySecret: e.target.value,
                          })
                        }
                        placeholder="请输入 Access Key Secret"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      💡 获取密钥：访问{' '}
                      <a
                        href="https://www.aliyun.com/product/ocr"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066ff] hover:underline"
                      >
                        www.aliyun.com/product/ocr
                      </a>{' '}
                      开通服务
                    </p>
                  </div>
                </div>
              )}

              {/* 微信本机 OCR 配置 */}
              {localSettings.ocrProvider === 'wechat' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    微信本机 OCR
                  </h3>
                  <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/60 dark:bg-blue-950/30">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          已内置离线 OCR 运行时
                        </p>
                        <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300">
                          无需安装微信客户端，也不需要选择微信目录或
                          wcocr.dll。识别时会直接使用软件资源目录里的 OCR 核心。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void detectWechatOcr()}
                        disabled={wechatOcrBusy}
                        className="shrink-0 px-3 py-2 text-sm rounded-lg bg-[#0066ff] text-white hover:bg-[#0052cc] disabled:opacity-50"
                      >
                        检测内置 OCR
                      </button>
                    </div>

                    {(wechatOcrMessage || wechatOcrStatus) && (
                      <div
                        className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                          wechatOcrStatus?.available
                            ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
                            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        }`}
                      >
                        <div>{wechatOcrMessage || wechatOcrStatus?.message}</div>
                        {wechatOcrStatus?.runtimeDir && (
                          <div className="mt-1 break-all">
                            内置运行目录：{wechatOcrStatus.runtimeDir}
                          </div>
                        )}
                        {wechatOcrStatus?.bridgePath && (
                          <div className="mt-1 break-all">
                            内置桥接库：{wechatOcrStatus.bridgePath}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* PaddleOCR 本地配置 */}
              {localSettings.ocrProvider === 'paddle' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    PaddleOCR 本地
                  </h3>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          已按内置离线模型接入
                        </p>
                        <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300">
                          全局 OCR 快捷键会直接加载软件资源目录里的 PaddleOCR ONNX
                          模型，支持文本行方向识别和本地文字识别。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void detectPaddleOcr()}
                        disabled={paddleOcrBusy}
                        className="shrink-0 px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        检测内置 OCR
                      </button>
                    </div>

                    {(paddleOcrMessage || paddleOcrStatus) && (
                      <div
                        className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                          paddleOcrStatus?.available
                            ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
                            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        }`}
                      >
                        <div>{paddleOcrMessage || paddleOcrStatus?.message}</div>
                        {paddleOcrStatus?.runtimeDir && (
                          <div className="mt-1 break-all">
                            内置模型目录：{paddleOcrStatus.runtimeDir}
                          </div>
                        )}
                        {paddleOcrStatus?.detModel && (
                          <div className="mt-1 break-all">检测模型：{paddleOcrStatus.detModel}</div>
                        )}
                        {paddleOcrStatus?.clsModel && (
                          <div className="mt-1 break-all">方向模型：{paddleOcrStatus.clsModel}</div>
                        )}
                        {paddleOcrStatus?.recModel && (
                          <div className="mt-1 break-all">识别模型：{paddleOcrStatus.recModel}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* WPS OCR 本地配置 */}
              {localSettings.ocrProvider === 'wps' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    WPS OCR 本地
                  </h3>
                  <div className="rounded-lg border border-sky-100 bg-sky-50/70 p-4 dark:border-sky-900/60 dark:bg-sky-950/30">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          已按独立 WPS OCR 运行时接入
                        </p>
                        <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300">
                          使用 resources/wps-ocr 内置模型和 TFLite 运行库，不调用
                          PaddleOCR，也不复用微信 OCR 桥接。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void detectWpsOcr()}
                        disabled={wpsOcrBusy}
                        className="shrink-0 px-3 py-2 text-sm rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                      >
                        检测内置 OCR
                      </button>
                    </div>

                    {(wpsOcrMessage || wpsOcrStatus) && (
                      <div
                        className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                          wpsOcrStatus?.available
                            ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
                            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        }`}
                      >
                        <div>{wpsOcrMessage || wpsOcrStatus?.message}</div>
                        {wpsOcrStatus?.runtimeDir && (
                          <div className="mt-1 break-all">
                            内置模型目录：{wpsOcrStatus.runtimeDir}
                          </div>
                        )}
                        {wpsOcrStatus?.installDir && (
                          <div className="mt-1 break-all">
                            WPS 原安装目录：{wpsOcrStatus.installDir}
                          </div>
                        )}
                        {wpsOcrStatus?.runtimeLibrary && (
                          <div className="mt-1 break-all">
                            运行库：{wpsOcrStatus.runtimeLibrary}
                          </div>
                        )}
                        {wpsOcrStatus?.detModel && (
                          <div className="mt-1 break-all">检测模型：{wpsOcrStatus.detModel}</div>
                        )}
                        {wpsOcrStatus?.clsModel && (
                          <div className="mt-1 break-all">方向模型：{wpsOcrStatus.clsModel}</div>
                        )}
                        {wpsOcrStatus?.recModel && (
                          <div className="mt-1 break-all">识别模型：{wpsOcrStatus.recModel}</div>
                        )}
                        {wpsOcrStatus?.vocabPath && (
                          <div className="mt-1 break-all">字典文件：{wpsOcrStatus.vocabPath}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 识别选项 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">识别选项</h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSettings.ocrCopyAfterRecognize}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          ocrCopyAfterRecognize: e.target.checked,
                        })
                      }
                      className="w-4 h-4 text-[#0066ff] rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      识别后自动复制到剪贴板
                    </span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* 翻译设置 */}
          {activeTab === 'translate' && (
            <>
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">截图翻译</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        截图翻译快捷键
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        全局快捷键，按下后框选屏幕区域进行 OCR 识别并翻译
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsRecordingTranslateShortcut(true)}
                        className={`px-4 py-2 min-w-[140px] text-center border-2 rounded-lg font-mono text-sm transition-all ${
                          isRecordingTranslateShortcut
                            ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] animate-pulse'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                      >
                        {isRecordingTranslateShortcut ? (
                          <span className="flex items-center gap-2 justify-center">
                            <Keyboard size={14} />
                            按下快捷键...
                          </span>
                        ) : (
                          formatShortcutDisplay(localSettings.translateShortcut || 'Alt+Shift+T')
                        )}
                      </button>
                      {localSettings.translateShortcut !== 'Alt+Shift+T' && (
                        <button
                          onClick={() =>
                            setLocalSettings((p) => ({ ...p, translateShortcut: 'Alt+Shift+T' }))
                          }
                          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          重置
                        </button>
                      )}
                    </div>
                  </div>
                  {isRecordingTranslateShortcut && (
                    <p className="text-xs text-[#0066ff]">
                      请按下组合键（需包含 Ctrl/Alt/Shift 修饰键），按 Esc 取消
                    </p>
                  )}

                  {/* 快捷翻译快捷键 */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        快捷翻译快捷键
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        全局快捷键，打开快捷翻译窗口进行手动输入翻译
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsRecordingQuickTranslateShortcut(true)}
                        className={`px-4 py-2 min-w-[140px] text-center border-2 rounded-lg font-mono text-sm transition-all ${
                          isRecordingQuickTranslateShortcut
                            ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] animate-pulse'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                      >
                        {isRecordingQuickTranslateShortcut ? (
                          <span className="flex items-center gap-2 justify-center">
                            <Keyboard size={14} />
                            按下快捷键...
                          </span>
                        ) : (
                          formatShortcutDisplay(localSettings.quickTranslateShortcut || 'Alt+Q')
                        )}
                      </button>
                      {localSettings.quickTranslateShortcut !== 'Alt+Q' && (
                        <button
                          onClick={() =>
                            setLocalSettings((p) => ({ ...p, quickTranslateShortcut: 'Alt+Q' }))
                          }
                          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          重置
                        </button>
                      )}
                    </div>
                  </div>
                  {isRecordingQuickTranslateShortcut && (
                    <p className="text-xs text-[#0066ff]">
                      请按下组合键（需包含 Ctrl/Alt/Shift 修饰键），按 Esc 取消
                    </p>
                  )}

                  {/* 翻译显示模式 */}
                  <label className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-gray-700 dark:text-gray-300">显示模式</span>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        选择翻译结果的显示方式
                      </div>
                    </div>
                    <select
                      value={localSettings.translateMode || 'window'}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          translateMode: e.target.value as 'window' | 'overlay',
                        })
                      }
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    >
                      <option value="window">窗口模式（显示原文和译文）</option>
                      <option value="overlay">覆盖模式（在原图上显示译文）</option>
                    </select>
                  </label>

                  {/* 覆盖模式设置 */}
                  {localSettings.translateMode === 'overlay' && (
                    <div className="ml-4 space-y-3 border-l-2 border-gray-200 dark:border-gray-700 pl-4">
                      <label className="flex items-center justify-between">
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          覆盖层透明度
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.1"
                            value={localSettings.translateOverlayOpacity || 0.9}
                            onChange={(e) =>
                              setLocalSettings({
                                ...localSettings,
                                translateOverlayOpacity: parseFloat(e.target.value),
                              })
                            }
                            className="w-32"
                          />
                          <span className="text-sm text-gray-600 dark:text-gray-400 w-12">
                            {((localSettings.translateOverlayOpacity || 0.9) * 100).toFixed(0)}%
                          </span>
                        </div>
                      </label>
                      <label className="flex items-center justify-between">
                        <span className="text-sm text-gray-700 dark:text-gray-300">字体大小</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="12"
                            max="32"
                            step="2"
                            value={localSettings.translateOverlayFontSize || 16}
                            onChange={(e) =>
                              setLocalSettings({
                                ...localSettings,
                                translateOverlayFontSize: parseInt(e.target.value),
                              })
                            }
                            className="w-32"
                          />
                          <span className="text-sm text-gray-600 dark:text-gray-400 w-12">
                            {localSettings.translateOverlayFontSize || 16}px
                          </span>
                        </div>
                      </label>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        💡 提示：覆盖模式下可使用 +/- 调整透明度，↑/↓ 调整字体大小
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 翻译服务商 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">翻译服务商</h3>
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300">默认服务商</span>
                    <select
                      value={localSettings.translateProvider}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          translateProvider: e.target.value as
                            | 'baidu'
                            | 'google'
                            | 'bing'
                            | 'tencent'
                            | 'chatgpt'
                            | 'openai-compatible'
                            | 'deepseek'
                            | 'gemini',
                        })
                      }
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    >
                      <option value="baidu">百度翻译</option>
                      <option value="google">Google Translate</option>
                      <option value="bing">Bing 翻译</option>
                      <option value="tencent">腾讯翻译</option>
                      <option value="chatgpt">ChatGPT</option>
                      <option value="openai-compatible">OpenAI 兼容 API</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="gemini">Gemini</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* 语言设置 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">语言设置</h3>
                <div className="space-y-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300">源语言</span>
                    <select
                      value={localSettings.translateFromLang}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, translateFromLang: e.target.value })
                      }
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    >
                      <option value="auto">自动检测</option>
                      <option value="zh">中文</option>
                      <option value="en">英语</option>
                      <option value="ja">日语</option>
                      <option value="ko">韩语</option>
                      <option value="fr">法语</option>
                      <option value="de">德语</option>
                      <option value="es">西班牙语</option>
                      <option value="ru">俄语</option>
                    </select>
                  </label>
                  <label className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300">目标语言</span>
                    <select
                      value={localSettings.translateToLang}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, translateToLang: e.target.value })
                      }
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    >
                      <option value="zh">中文</option>
                      <option value="en">英语</option>
                      <option value="ja">日语</option>
                      <option value="ko">韩语</option>
                      <option value="fr">法语</option>
                      <option value="de">德语</option>
                      <option value="es">西班牙语</option>
                      <option value="ru">俄语</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* 百度翻译配置 */}
              {localSettings.translateProvider === 'baidu' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    百度翻译配置
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        APP ID
                      </label>
                      <input
                        type="text"
                        value={localSettings.translateBaiduAppId}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateBaiduAppId: e.target.value,
                          })
                        }
                        placeholder="输入百度翻译 APP ID"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        密钥
                      </label>
                      <input
                        type="password"
                        value={localSettings.translateBaiduSecretKey}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateBaiduSecretKey: e.target.value,
                          })
                        }
                        placeholder="输入百度翻译密钥"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      💡 获取密钥：访问{' '}
                      <a
                        href="https://fanyi-api.baidu.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066ff] hover:underline"
                      >
                        fanyi-api.baidu.com
                      </a>{' '}
                      创建应用
                    </p>
                  </div>
                </div>
              )}

              {/* Google 翻译配置 */}
              {localSettings.translateProvider === 'google' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    Google Translate 配置
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        API Key
                      </label>
                      <input
                        type="text"
                        value={localSettings.translateGoogleApiKey}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateGoogleApiKey: e.target.value,
                          })
                        }
                        placeholder="输入 Google Translate API Key"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      💡 获取密钥：访问{' '}
                      <a
                        href="https://cloud.google.com/translate"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066ff] hover:underline"
                      >
                        cloud.google.com/translate
                      </a>{' '}
                      创建项目并启用 Translation API
                    </p>
                  </div>
                </div>
              )}

              {/* Bing 翻译配置 */}
              {localSettings.translateProvider === 'bing' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    Bing 翻译配置
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        API Key
                      </label>
                      <input
                        type="text"
                        value={localSettings.translateBingApiKey}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateBingApiKey: e.target.value,
                          })
                        }
                        placeholder="输入 Bing Translator API Key"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      💡 获取密钥：访问{' '}
                      <a
                        href="https://azure.microsoft.com/services/cognitive-services/translator/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066ff] hover:underline"
                      >
                        Azure Translator
                      </a>{' '}
                      创建资源
                    </p>
                  </div>
                </div>
              )}

              {/* 腾讯翻译配置 */}
              {localSettings.translateProvider === 'tencent' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    腾讯翻译配置
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        Secret ID
                      </label>
                      <input
                        type="text"
                        value={localSettings.translateTencentSecretId}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateTencentSecretId: e.target.value,
                          })
                        }
                        placeholder="输入腾讯云 Secret ID"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        Secret Key
                      </label>
                      <input
                        type="password"
                        value={localSettings.translateTencentSecretKey}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateTencentSecretKey: e.target.value,
                          })
                        }
                        placeholder="输入腾讯云 Secret Key"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        地域
                      </label>
                      <input
                        type="text"
                        value={localSettings.translateTencentRegion}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateTencentRegion: e.target.value,
                          })
                        }
                        placeholder="ap-guangzhou"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    {(localSettings.translateTencentSecretId.trim().match(/^\d+$/) ||
                      (localSettings.translateTencentSecretKey.trim().startsWith('AKID') &&
                        !localSettings.translateTencentSecretId.trim().startsWith('AKID'))) && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        腾讯翻译需要填写腾讯云 API 密钥里的 SecretId 和 SecretKey。SecretId 通常以
                        AKID 开头；纯数字 AppID 不能填在 Secret ID，这两个字段也不要互换。
                      </div>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      💡 获取密钥：访问{' '}
                      <a
                        href="https://cloud.tencent.com/product/tmt"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066ff] hover:underline"
                      >
                        cloud.tencent.com/product/tmt
                      </a>{' '}
                      开通服务
                    </p>
                  </div>
                </div>
              )}

              {/* ChatGPT 配置 */}
              {localSettings.translateProvider === 'chatgpt' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    ChatGPT 配置
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={localSettings.translateOpenaiApiKey}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateOpenaiApiKey: e.target.value,
                          })
                        }
                        placeholder="输入 OpenAI API Key"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        模型
                      </label>
                      <input
                        type="text"
                        value={localSettings.translateOpenaiModel}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateOpenaiModel: e.target.value,
                          })
                        }
                        placeholder="gpt-4o"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        Base URL（可选）
                      </label>
                      <input
                        type="text"
                        value={localSettings.translateOpenaiBaseUrl}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateOpenaiBaseUrl: e.target.value,
                          })
                        }
                        placeholder="https://api.openai.com/v1"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      💡 获取密钥：访问{' '}
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066ff] hover:underline"
                      >
                        platform.openai.com/api-keys
                      </a>
                    </p>
                  </div>
                </div>
              )}

              {/* OpenAI 兼容 API 配置 */}
              {localSettings.translateProvider === 'openai-compatible' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                      OpenAI 兼容 API 配置
                    </h3>
                    <button
                      type="button"
                      onClick={addOpenaiCompatibleProvider}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0066ff] px-3 py-2 text-sm font-medium text-white hover:bg-[#0052cc]"
                    >
                      <Plus size={16} />
                      新增配置
                    </button>
                  </div>
                  <div className="space-y-3">
                    {localSettings.translateOpenaiCompatibleProviders.length === 0 && (
                      <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        还没有 OpenAI 兼容 API 配置。添加后可填写不同服务商的 Base URL、模型和 API
                        Key。
                      </div>
                    )}
                    {localSettings.translateOpenaiCompatibleProviders.map((provider, index) => {
                      const active =
                        localSettings.translateOpenaiCompatibleProviderId === provider.id ||
                        (!localSettings.translateOpenaiCompatibleProviderId && index === 0);
                      return (
                        <div
                          key={provider.id}
                          className={`rounded-lg border p-3 ${
                            active
                              ? 'border-blue-300 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/20'
                              : 'border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                              <input
                                type="radio"
                                checked={active}
                                onChange={() =>
                                  setLocalSettings({
                                    ...localSettings,
                                    translateOpenaiCompatibleProviderId: provider.id,
                                  })
                                }
                                className="h-4 w-4 text-[#0066ff]"
                              />
                              当前使用
                            </label>
                            <button
                              type="button"
                              onClick={() => deleteOpenaiCompatibleProvider(provider.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
                            >
                              <Trash2 size={14} />
                              删除
                            </button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-sm text-gray-700 dark:text-gray-300">
                                名称
                              </label>
                              <input
                                type="text"
                                value={provider.name}
                                onChange={(e) =>
                                  updateOpenaiCompatibleProvider(provider.id, {
                                    name: e.target.value,
                                  })
                                }
                                placeholder="例如：硅基流动 / 月之暗面 / 自建网关"
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-sm text-gray-700 dark:text-gray-300">
                                模型
                              </label>
                              <input
                                type="text"
                                value={provider.model}
                                onChange={(e) =>
                                  updateOpenaiCompatibleProvider(provider.id, {
                                    model: e.target.value,
                                  })
                                }
                                placeholder="例如：qwen-plus / moonshot-v1-8k"
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className="mb-1 block text-sm text-gray-700 dark:text-gray-300">
                                Base URL
                              </label>
                              <input
                                type="text"
                                value={provider.baseUrl}
                                onChange={(e) =>
                                  updateOpenaiCompatibleProvider(provider.id, {
                                    baseUrl: e.target.value,
                                  })
                                }
                                placeholder="https://api.example.com/v1"
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className="mb-1 block text-sm text-gray-700 dark:text-gray-300">
                                API Key
                              </label>
                              <input
                                type="password"
                                value={provider.apiKey}
                                onChange={(e) =>
                                  updateOpenaiCompatibleProvider(provider.id, {
                                    apiKey: e.target.value,
                                  })
                                }
                                placeholder="输入 API Key"
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* DeepSeek 配置 */}
              {localSettings.translateProvider === 'deepseek' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    DeepSeek 配置
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={localSettings.translateDeepseekApiKey}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateDeepseekApiKey: e.target.value,
                          })
                        }
                        placeholder="输入 DeepSeek API Key"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        模型
                      </label>
                      <input
                        type="text"
                        value={localSettings.translateDeepseekModel}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateDeepseekModel: e.target.value,
                          })
                        }
                        placeholder="deepseek-v4-flash"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        Base URL
                      </label>
                      <input
                        type="text"
                        value={localSettings.translateDeepseekBaseUrl}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateDeepseekBaseUrl: e.target.value,
                          })
                        }
                        placeholder="https://api.deepseek.com"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      💡 获取密钥：访问{' '}
                      <a
                        href="https://platform.deepseek.com/api_keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066ff] hover:underline"
                      >
                        platform.deepseek.com/api_keys
                      </a>
                    </p>
                  </div>
                </div>
              )}

              {/* Gemini 配置 */}
              {localSettings.translateProvider === 'gemini' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">Gemini 配置</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={localSettings.translateGeminiApiKey}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateGeminiApiKey: e.target.value,
                          })
                        }
                        placeholder="输入 Google AI API Key"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                        模型
                      </label>
                      <input
                        type="text"
                        value={localSettings.translateGeminiModel}
                        onChange={(e) =>
                          setLocalSettings({
                            ...localSettings,
                            translateGeminiModel: e.target.value,
                          })
                        }
                        placeholder="gemini-pro"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      💡 获取密钥：访问{' '}
                      <a
                        href="https://makersuite.google.com/app/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#0066ff] hover:underline"
                      >
                        makersuite.google.com/app/apikey
                      </a>
                    </p>
                  </div>
                </div>
              )}

              {/* 翻译选项 */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">翻译选项</h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSettings.translateAutoDetectLanguage}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          translateAutoDetectLanguage: e.target.checked,
                        })
                      }
                      className="w-4 h-4 text-[#0066ff] rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">自动检测源语言</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSettings.translateShowOriginalText}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          translateShowOriginalText: e.target.checked,
                        })
                      }
                      className="w-4 h-4 text-[#0066ff] rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">显示原文</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSettings.translateAutoCopy}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          translateAutoCopy: e.target.checked,
                        })
                      }
                      className="w-4 h-4 text-[#0066ff] rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      翻译后自动复制到剪贴板
                    </span>
                  </label>
                </div>
              </div>
            </>
          )}

          {activeTab === 'search' && (
            <>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">搜索引擎</h3>
                  <button
                    type="button"
                    onClick={() =>
                      setSearchEngines([
                        ...searchEngines,
                        { name: '', prefix: '', url: 'https://{query}', enabled: true },
                      ])
                    }
                    className="flex items-center gap-1 text-sm text-[#0066ff] hover:underline"
                  >
                    <Plus size={14} />
                    添加
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  在 Alt+Space 搜索框输入{' '}
                  <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">
                    前缀 空格 关键词
                  </span>{' '}
                  快速搜索，如{' '}
                  <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">
                    g chrome
                  </span>
                </p>
                <div className="space-y-2">
                  {searchEngines.map((engine, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700"
                    >
                      <GripVertical size={14} className="text-gray-300 flex-shrink-0 cursor-grab" />
                      <input
                        type="checkbox"
                        checked={engine.enabled}
                        onChange={(e) => {
                          const updated = [...searchEngines];
                          updated[index] = { ...updated[index], enabled: e.target.checked };
                          setSearchEngines(updated);
                        }}
                        className="w-4 h-4 text-[#0066ff] rounded flex-shrink-0"
                      />
                      <input
                        type="text"
                        value={engine.name}
                        onChange={(e) => {
                          const updated = [...searchEngines];
                          updated[index] = { ...updated[index], name: e.target.value };
                          setSearchEngines(updated);
                        }}
                        placeholder="名称"
                        className="w-24 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0066ff]"
                      />
                      <input
                        type="text"
                        value={engine.prefix}
                        onChange={(e) => {
                          const updated = [...searchEngines];
                          updated[index] = {
                            ...updated[index],
                            prefix: e.target.value.toLowerCase().replace(/\s/g, ''),
                          };
                          setSearchEngines(updated);
                        }}
                        placeholder="前缀"
                        className="w-16 px-2 py-1 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0066ff]"
                      />
                      <input
                        type="text"
                        value={engine.url}
                        onChange={(e) => {
                          const updated = [...searchEngines];
                          updated[index] = { ...updated[index], url: e.target.value };
                          setSearchEngines(updated);
                        }}
                        placeholder="https://example.com/search?q={query}"
                        className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0066ff]"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setSearchEngines(searchEngines.filter((_, i) => i !== index))
                        }
                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {searchEngines.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">
                      暂无搜索引擎，点击"添加"新增
                    </p>
                  )}
                </div>
              </div>

              {/* 数据管理 */}
            </>
          )}
          {activeTab === 'weather' && (
            <>
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">和风天气</h3>
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      在 Alt+Space 搜索框输入{' '}
                      <span className="font-mono bg-blue-100 dark:bg-blue-900/40 px-1 rounded">
                        城市名 + 天气
                      </span>
                      （如：深圳天气）即可查看实时天气和 7 天预报。
                    </p>
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1.5">
                      需要先在{' '}
                      <a
                        href="https://dev.qweather.com"
                        className="underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        dev.qweather.com
                      </a>{' '}
                      注册并获取免费 API Key（每天 1000 次调用）。
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      API Host
                    </label>
                    <input
                      type="text"
                      value={localSettings.qweatherApiHost}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, qweatherApiHost: e.target.value })
                      }
                      placeholder="abcxyz.qweatherapi.com"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff] font-mono text-sm"
                    />
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                      在和风天气控制台 → 设置 中查看你的专属 API Host。
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={localSettings.qweatherApiKey}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, qweatherApiKey: e.target.value })
                      }
                      placeholder="请输入和风天气 API Key"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff] font-mono text-sm"
                    />
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                      API Key 和 API Host 仅存储在本地，不会上传到任何服务器。
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
          {activeTab === 'ai' && (
            <>
              <AISettingsTab localSettings={localSettings} setLocalSettings={setLocalSettings} />
              <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <McpSettingsPanel />
              </div>
            </>
          )}
          {activeTab === 'data' && (
            <>
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">数据管理</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <div className="flex-1">
                      <div className="text-gray-700 dark:text-gray-300 font-medium">数据目录</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        打开配置文件所在目录（%APPDATA%\McStartUP）
                      </div>
                    </div>
                    <button
                      onClick={handleOpenDataDir}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors ml-4"
                    >
                      <FolderOpen size={16} />
                      打开
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <div className="flex-1">
                      <div className="text-gray-700 dark:text-gray-300 font-medium">导出配置</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        备份便携启动器配置、全局设置、工具箱数据、AI 聊天历史和本地偏好到文件
                      </div>
                    </div>
                    <button
                      onClick={handleExport}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors ml-4"
                    >
                      <Download size={16} />
                      导出
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <div className="flex-1">
                      <div className="text-gray-700 dark:text-gray-300 font-medium">导入配置</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        从完整备份恢复数据；启动器不迁移每台电脑不同的开机启动状态
                      </div>
                    </div>
                    <button
                      onClick={handleImport}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors ml-4"
                    >
                      <Upload size={16} />
                      导入
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg">
                    <div className="flex-1">
                      <div className="text-violet-800 dark:text-violet-300 font-medium">
                        恢复最近备份
                      </div>
                      <div className="text-sm text-violet-700 dark:text-violet-400 mt-1">
                        使用最近一次完整备份或兼容旧备份恢复数据
                      </div>
                    </div>
                    <button
                      onClick={handleRestoreLatestBackup}
                      className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors ml-4 whitespace-nowrap"
                    >
                      <Download size={16} />
                      恢复备份
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <div className="flex-1">
                      <div className="text-amber-800 dark:text-amber-300 font-medium">
                        从注册表恢复数据
                      </div>
                      <div className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                        重装软件后数据丢失时，扫描系统里仍可用的快捷方式并回填到软件
                      </div>
                    </div>
                    <button
                      onClick={handleRecoverFromRegistry}
                      className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors ml-4 whitespace-nowrap"
                    >
                      <Upload size={16} />
                      扫描恢复
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <div className="flex-1">
                      <div className="text-blue-800 dark:text-blue-300 font-medium">
                        重新生成所有别名
                      </div>
                      <div className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                        重新生成所有 Win+R 快捷方式文件，修复别名失效或脚本错误问题
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await invoke('regenerate_all_aliases');
                          await showMessage('所有别名已重新生成！\n\nWin+R 快捷方式已更新。', {
                            title: '完成',
                            type: 'info',
                          });
                        } catch (error) {
                          await showMessage(`重新生成失败：${error}`, {
                            title: '错误',
                            type: 'error',
                          });
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors ml-4 whitespace-nowrap"
                    >
                      <Download size={16} />
                      重新生成
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
