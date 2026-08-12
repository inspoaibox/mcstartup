import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TranslateSettings {
  // 默认翻译源
  translateProvider: 'baidu' | 'google' | 'bing' | 'tencent' | 'chatgpt' | 'gemini';

  // 默认语言
  translateFromLang: string; // 'auto'
  translateToLang: string; // 'zh'

  // 快捷键
  translateShortcut: string; // 'Alt+T'

  // 百度翻译配置
  translateBaiduAppId: string;
  translateBaiduSecretKey: string;

  // 谷歌翻译配置
  translateGoogleApiKey: string;

  // 必应翻译配置
  translateBingApiKey: string;

  // 腾讯翻译配置
  translateTencentSecretId: string;
  translateTencentSecretKey: string;
  translateTencentRegion: string;

  // ChatGPT 配置
  translateOpenaiApiKey: string;
  translateOpenaiModel: string;
  translateOpenaiBaseUrl: string;

  // Gemini 配置
  translateGeminiApiKey: string;
  translateGeminiModel: string;

  // 翻译选项
  translateAutoDetectLanguage: boolean; // 自动检测源语言
  translateShowOriginalText: boolean; // 显示原文
  translateAutoCopy: boolean; // 自动复制译文
}

interface TranslateSettingsStore extends TranslateSettings {
  updateSettings: (settings: Partial<TranslateSettings>) => void;
  resetSettings: () => void;
}

const defaultSettings: TranslateSettings = {
  translateProvider: 'baidu',
  translateFromLang: 'auto',
  translateToLang: 'zh',
  translateShortcut: 'Alt+T',

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

  translateGeminiApiKey: '',
  translateGeminiModel: 'gemini-pro',

  translateAutoDetectLanguage: true,
  translateShowOriginalText: true,
  translateAutoCopy: false,
};

export const useTranslateSettingsStore = create<TranslateSettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettings,
      updateSettings: (settings) => set((state) => ({ ...state, ...settings })),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'translate-settings',
    }
  )
);
