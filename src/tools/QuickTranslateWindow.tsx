import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { Copy, Check, Volume2, Trash2, Clipboard, Languages, X, ChevronDown } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';

type TranslateProvider = 'baidu' | 'google' | 'bing' | 'tencent' | 'chatgpt' | 'gemini';

interface TranslateResult {
  translated_text: string;
  from_lang: string;
  to_lang: string;
}

const PROVIDER_NAMES: Record<TranslateProvider, string> = {
  baidu: '百度翻译',
  google: '谷歌翻译',
  bing: '必应翻译',
  tencent: '腾讯翻译',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
};

const LANGUAGES: Record<string, string> = {
  auto: '自动检测',
  zh: '中文',
  en: '英文',
  ja: '日文',
  ko: '韩文',
  fr: '法文',
  de: '德文',
  es: '西班牙文',
  ru: '俄文',
  ar: '阿拉伯文',
  pt: '葡萄牙文',
  it: '意大利文',
};

export default function QuickTranslateWindow() {
  const settings = useSettingsStore();
  const [inputText, setInputText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [fromLang, setFromLang] = useState(settings.translateFromLang || 'auto');
  const [toLang, setToLang] = useState(settings.translateToLang || 'zh');
  const [detectedLang, setDetectedLang] = useState('');
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentProvider = (settings.translateProvider || 'baidu') as TranslateProvider;
  const ensureLatestSettings = async () => {
    await useSettingsStore.getState().loadSettings();
    return useSettingsStore.getState();
  };

  // 监听重启事件
  useEffect(() => {
    const unlisten = listen('restart-quick-translate', async () => {
      console.log('Restart quick translate event received');
      const latestSettings = await ensureLatestSettings();
      setInputText('');
      setTranslatedText('');
      setDetectedLang('');
      setLoading(false);
      setFromLang(latestSettings.translateFromLang || 'auto');
      setToLang(latestSettings.translateToLang || 'zh');
      // 聚焦到输入框
      setTimeout(() => inputRef.current?.focus(), 100);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 初始化时聚焦输入框
  useEffect(() => {
    void ensureLatestSettings().then((latestSettings) => {
      setFromLang(latestSettings.translateFromLang || 'auto');
      setToLang(latestSettings.translateToLang || 'zh');
    });
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowProviderMenu(false);
      }
    };

    if (showProviderMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showProviderMenu]);

  // 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Enter: 翻译
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        handleTranslate();
      }
      // ESC: 关闭窗口
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inputText]);

  const handleTranslate = async () => {
    const text = inputText.trim();
    if (!text || loading) return;

    setLoading(true);
    setTranslatedText('');
    setDetectedLang('');

    try {
      const latestSettings = await ensureLatestSettings();
      const provider = (latestSettings.translateProvider || 'baidu') as TranslateProvider;

      // 检查 API 配置
      if (
        provider === 'baidu' &&
        (!latestSettings.translateBaiduAppId || !latestSettings.translateBaiduSecretKey)
      ) {
        setTranslatedText('错误：请先在软件设置中配置百度翻译的 App ID 和 Secret Key');
        setLoading(false);
        return;
      }

      if (provider === 'google' && !latestSettings.translateGoogleApiKey) {
        setTranslatedText('错误：请先在软件设置中配置谷歌翻译的 API Key');
        setLoading(false);
        return;
      }

      if (provider === 'bing' && !latestSettings.translateBingApiKey) {
        setTranslatedText('错误：请先在软件设置中配置必应翻译的 API Key');
        setLoading(false);
        return;
      }

      if (
        provider === 'tencent' &&
        (!latestSettings.translateTencentSecretId || !latestSettings.translateTencentSecretKey)
      ) {
        setTranslatedText('错误：请先在软件设置中配置腾讯翻译的 Secret ID 和 Secret Key');
        setLoading(false);
        return;
      }

      if (provider === 'chatgpt' && !latestSettings.translateOpenaiApiKey) {
        setTranslatedText('错误：请先在软件设置中配置 ChatGPT 的 API Key');
        setLoading(false);
        return;
      }

      if (provider === 'gemini' && !latestSettings.translateGeminiApiKey) {
        setTranslatedText('错误：请先在软件设置中配置 Gemini 的 API Key');
        setLoading(false);
        return;
      }

      const translateResult = await invoke<TranslateResult>('translate_text', {
        text,
        fromLang,
        toLang,
        provider,
        autoDetectLanguage: latestSettings.translateAutoDetectLanguage ?? true,
        config: {
          baiduAppId: latestSettings.translateBaiduAppId || '',
          baiduSecretKey: latestSettings.translateBaiduSecretKey || '',
          googleApiKey: latestSettings.translateGoogleApiKey || '',
          bingApiKey: latestSettings.translateBingApiKey || '',
          tencentSecretId: latestSettings.translateTencentSecretId || '',
          tencentSecretKey: latestSettings.translateTencentSecretKey || '',
          tencentRegion: latestSettings.translateTencentRegion || 'ap-guangzhou',
          openaiApiKey: latestSettings.translateOpenaiApiKey || '',
          openaiModel: latestSettings.translateOpenaiModel || 'gpt-4o',
          openaiBaseUrl: latestSettings.translateOpenaiBaseUrl || '',
          geminiApiKey: latestSettings.translateGeminiApiKey || '',
          geminiModel: latestSettings.translateGeminiModel || 'gemini-pro',
        },
      });

      setTranslatedText(translateResult.translated_text);
      setDetectedLang(translateResult.from_lang);
      if (fromLang !== 'auto') {
        setFromLang(translateResult.from_lang || fromLang);
      }
      setToLang(translateResult.to_lang || toLang);

      // 自动复制
      if (latestSettings.translateAutoCopy) {
        await navigator.clipboard.writeText(translateResult.translated_text);
      }
    } catch (err) {
      console.error('翻译错误:', err);
      setTranslatedText('翻译失败：' + String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setInputText('');
    setTranslatedText('');
    setDetectedLang('');
    inputRef.current?.focus();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInputText(text);
      inputRef.current?.focus();
    } catch (err) {
      console.error('粘贴失败:', err);
    }
  };

  const handleCopyOutput = async () => {
    if (!translatedText) return;
    await navigator.clipboard.writeText(translatedText);
    setCopiedOutput(true);
    setTimeout(() => setCopiedOutput(false), 1500);
  };

  const handleSpeak = () => {
    if (!translatedText) return;

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(translatedText);
    utterance.lang = toLang === 'zh' ? 'zh-CN' : toLang === 'en' ? 'en-US' : toLang;
    window.speechSynthesis.speak(utterance);
  };

  const handleClose = async () => {
    await appWindow.hide();
  };

  const handleProviderChange = (provider: TranslateProvider) => {
    settings.updateSettings({ translateProvider: provider });
    setShowProviderMenu(false);
  };

  return (
    <div className="w-full h-full bg-white dark:bg-gray-900 flex flex-col">
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3" data-tauri-drag-region>
          <Languages size={20} className="text-blue-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">快捷翻译</span>

          {/* Provider 选择 */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowProviderMenu(!showProviderMenu)}
              className="flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-2 py-1 rounded transition-colors"
            >
              <span className="text-gray-600 dark:text-gray-400">
                {PROVIDER_NAMES[currentProvider]}
              </span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>

            {showProviderMenu && (
              <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                {(
                  ['baidu', 'google', 'bing', 'tencent', 'chatgpt', 'gemini'] as TranslateProvider[]
                ).map((provider) => (
                  <button
                    key={provider}
                    onClick={() => handleProviderChange(provider)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                      currentProvider === provider
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <span className="flex-1 text-left">{PROVIDER_NAMES[provider]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 语言选择 */}
          <div className="flex items-center gap-1 text-xs">
            <select
              value={fromLang}
              onChange={(e) => setFromLang(e.target.value)}
              className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-1 rounded border-none outline-none text-xs"
            >
              {Object.entries(LANGUAGES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <span className="text-gray-400">→</span>
            <select
              value={toLang}
              onChange={(e) => setToLang(e.target.value)}
              className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-1 rounded border-none outline-none text-xs"
            >
              {Object.entries(LANGUAGES)
                .filter(([code]) => code !== 'auto')
                .map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleClose}
          className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 flex min-h-0">
        {/* 左侧：输入区域 */}
        <div className="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-700">
          <div className="flex-1 p-4 overflow-hidden">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="输入要翻译的文本..."
              className="w-full h-full resize-none border-none outline-none bg-transparent text-gray-800 dark:text-gray-200 text-sm leading-relaxed"
            />
          </div>

          {/* 底部工具栏 */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-700 gap-2">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
              {detectedLang && (
                <span className="whitespace-nowrap">
                  检测: {LANGUAGES[detectedLang] || detectedLang}
                </span>
              )}
              <span className="whitespace-nowrap">{inputText.length} 字符</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleClear}
                disabled={!inputText}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
              >
                <Trash2 size={12} />
                <span>清空</span>
              </button>
              <button
                onClick={handlePaste}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
              >
                <Clipboard size={12} />
                <span>粘贴</span>
              </button>
              <button
                onClick={handleTranslate}
                disabled={!inputText.trim() || loading}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-blue-500 hover:bg-blue-600 text-white whitespace-nowrap"
              >
                <Languages size={12} />
                <span>{loading ? '翻译中...' : '翻译'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 右侧：输出区域 */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 p-4 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-2">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                  <span className="text-xs text-gray-400">翻译中...</span>
                </div>
              </div>
            ) : translatedText ? (
              <div className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                {translatedText}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                翻译结果将显示在这里...
              </div>
            )}
          </div>

          {/* 底部工具栏 */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-700 gap-2">
            <div className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 whitespace-nowrap">
              {translatedText && `${translatedText.length} 字符`}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleCopyOutput}
                disabled={!translatedText || loading}
                className={`flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
                  copiedOutput
                    ? 'bg-green-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {copiedOutput ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedOutput ? '已复制' : '复制'}</span>
              </button>
              <button
                onClick={handleSpeak}
                disabled={!translatedText || loading}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
              >
                <Volume2 size={12} />
                <span>朗读</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
