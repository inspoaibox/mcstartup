import { create } from 'zustand';
import { AppSettings } from '../types';
import { invoke } from '@tauri-apps/api/tauri';

interface SettingsState extends AppSettings {
  loadSettings: () => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  theme: 'system',
  startMinimized: false,
  showInTray: true,
  closeToTray: true,
  autoStart: false,
  contextMenuEnabled: false,
  autoBackup: true,
  language: 'zh-CN',
  viewMode: 'grid',
  quickLaunchShortcut: 'Alt+Space',
  iconSize: 'medium',
  searchEngines: [],
  qweatherApiKey: '',
  qweatherApiHost: '',
  clipboardShortcut: 'Alt+C',
  clipboardMaxCount: 0,
  clipboardDurationDays: 0,
  clipboardEnabled: true,
  clipboardAutoPaste: 'double',
  clipboardPastePlain: false,
  clipboardAutoSort: true,
  clipboardSearchPosition: 'top',
  clipboardSearchAutoClear: false,
  toolboxShortcut: 'Alt+T',
  // OCR 默认设置
  ocrShortcut: 'Ctrl+Shift+A',
  ocrProvider: 'baidu',
  ocrBaiduApiKey: '',
  ocrBaiduSecretKey: '',
  ocrBaiduHighAccuracy: true,
  ocrGoogleApiKey: '',
  ocrTencentSecretId: '',
  ocrTencentSecretKey: '',
  ocrTencentRegion: 'ap-guangzhou',
  ocrAliyunAccessKeyId: '',
  ocrAliyunAccessKeySecret: '',
  ocrAutoRecognize: false,
  ocrCopyAfterRecognize: true,
  // 翻译默认设置
  translateShortcut: 'Alt+Shift+T',
  quickTranslateShortcut: 'Alt+Q',
  wordSelectionTranslateShortcut: 'Alt+W',
  translateProvider: 'baidu',
  translateMode: 'window',
  translateFromLang: 'auto',
  translateToLang: 'zh',
  translateBaiduAppId: '',
  translateBaiduSecretKey: '',
  translateGoogleApiKey: '',
  translateBingApiKey: '',
  translateTencentSecretId: '',
  translateTencentSecretKey: '',
  translateTencentRegion: 'ap-guangzhou',
  translateOpenaiApiKey: '',
  translateOpenaiModel: 'gpt-4o',
  translateOpenaiBaseUrl: '',
  translateOpenaiCompatibleProviders: [],
  translateOpenaiCompatibleProviderId: '',
  translateDeepseekApiKey: '',
  translateDeepseekModel: 'deepseek-v4-flash',
  translateDeepseekBaseUrl: 'https://api.deepseek.com',
  translateGeminiApiKey: '',
  translateGeminiModel: 'gemini-pro',
  translateAutoDetectLanguage: true,
  translateShowOriginalText: true,
  translateAutoCopy: false,
  translateOverlayOpacity: 0.9,
  translateOverlayFontSize: 16,
  // 截图默认设置
  screenshotFullscreenShortcut: 'Alt+A',
  screenshotRegionShortcut: 'Alt+Shift+A',
  // AI 聊天默认设置
  aiProviders: [],
  activeAiProviderId: '',
  defaultAiModel: '',

  loadSettings: async () => {
    try {
      const settings = await invoke<AppSettings>('load_settings');
      // 用 merge 而非覆盖，确保后端未返回的新字段保留 store 默认值
      set((prev) => ({ ...prev, ...settings }));
    } catch (error) {
      console.error('加载设置失败:', error);
    }
  },

  updateSettings: async (settings) => {
    const previousSettings = { ...get() };
    const newSettings = { ...previousSettings, ...settings };

    // 先乐观更新 UI
    set(settings);

    try {
      await invoke('save_settings', { settings: newSettings });

      // 应用设置
      if (settings.autoStart !== undefined) {
        await invoke('set_auto_start', { enabled: settings.autoStart });
      }
      if (settings.contextMenuEnabled !== undefined) {
        await invoke('set_context_menu', { enabled: settings.contextMenuEnabled });
      }
      if (settings.quickLaunchShortcut !== undefined) {
        await invoke('update_global_shortcut', {
          shortcut: settings.quickLaunchShortcut,
          oldShortcut: previousSettings.quickLaunchShortcut,
        });
      }
      if (settings.clipboardShortcut !== undefined) {
        await invoke('update_clipboard_shortcut', {
          shortcut: settings.clipboardShortcut,
          oldShortcut: previousSettings.clipboardShortcut,
        });
      }
      if (settings.toolboxShortcut !== undefined) {
        await invoke('update_toolbox_shortcut', {
          shortcut: settings.toolboxShortcut,
          oldShortcut: previousSettings.toolboxShortcut,
        });
      }
      if (settings.aiChatShortcut !== undefined) {
        await invoke('update_ai_chat_shortcut', {
          shortcut: settings.aiChatShortcut,
          oldShortcut: previousSettings.aiChatShortcut,
        });
      }
      if (settings.ocrShortcut !== undefined) {
        await invoke('update_ocr_screenshot_shortcut', {
          shortcut: settings.ocrShortcut,
          oldShortcut: previousSettings.ocrShortcut,
        });
      }
      if (settings.translateShortcut !== undefined) {
        await invoke('update_translate_screenshot_shortcut', {
          shortcut: settings.translateShortcut,
          oldShortcut: previousSettings.translateShortcut,
        });
      }
      if (settings.quickTranslateShortcut !== undefined) {
        await invoke('update_quick_translate_shortcut', {
          shortcut: settings.quickTranslateShortcut,
          oldShortcut: previousSettings.quickTranslateShortcut,
        });
      }
      if (settings.wordSelectionTranslateShortcut !== undefined) {
        await invoke('update_word_selection_translate_shortcut', {
          shortcut: settings.wordSelectionTranslateShortcut,
          oldShortcut: previousSettings.wordSelectionTranslateShortcut,
        });
      }
      if (settings.screenshotFullscreenShortcut !== undefined) {
        await invoke('update_screenshot_fullscreen_shortcut', {
          shortcut: settings.screenshotFullscreenShortcut,
          oldShortcut: previousSettings.screenshotFullscreenShortcut,
        });
      }
      if (settings.screenshotRegionShortcut !== undefined) {
        await invoke('update_screenshot_region_shortcut', {
          shortcut: settings.screenshotRegionShortcut,
          oldShortcut: previousSettings.screenshotRegionShortcut,
        });
      }
    } catch (error) {
      // 后端保存失败时回滚前端状态
      console.error('保存设置失败:', error);
      set(previousSettings);
      throw error;
    }
  },
}));
