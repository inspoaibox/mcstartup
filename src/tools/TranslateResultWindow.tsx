import { useState, useRef, useEffect } from 'react';
import { Copy, Check, ChevronDown, X, Loader2, RefreshCw } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { useToolTheme } from './useToolTheme';
import {
  TRANSLATE_PROVIDER_LABELS,
  TRANSLATE_PROVIDER_ORDER,
  translateProviderName,
  type TranslateProvider,
} from './translateProviderUtils';

interface TranslateResultWindowProps {
  originalText: string;
  translatedText: string;
  loading?: boolean;
  imagePreview?: string;
  fromLang: string;
  toLang: string;
  title?: string; // 窗口标题，默认为"截图翻译"
  onClose: () => void;
  onProviderChange?: (provider: TranslateProvider) => void;
  onLanguageChange?: (fromLang: string, toLang: string) => void;
  onRetranslate?: () => void;
}

const PROVIDER_ICONS: Record<TranslateProvider, string> = {
  baidu: '🔵',
  google: '🔴',
  bing: '🟢',
  tencent: '🟡',
  chatgpt: '🤖',
  'openai-compatible': 'API',
  deepseek: 'DS',
  gemini: '✨',
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

export default function TranslateResultWindow({
  originalText,
  translatedText,
  loading = false,
  imagePreview,
  fromLang,
  toLang,
  title = '截图翻译',
  onClose,
  onProviderChange,
  onLanguageChange,
  onRetranslate,
}: TranslateResultWindowProps) {
  const ready = useToolTheme();
  const settings = useSettingsStore();
  const [copiedOriginal, setCopiedOriginal] = useState(false);
  const [copiedTranslated, setCopiedTranslated] = useState(false);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [displayTranslatedText, setDisplayTranslatedText] = useState(translatedText);
  const [localFromLang, setLocalFromLang] = useState(fromLang);
  const [localToLang, setLocalToLang] = useState(toLang);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentProvider = (settings.translateProvider || 'baidu') as TranslateProvider;
  const showOriginal = settings.translateShowOriginalText;
  const loadSettings = settings.loadSettings;

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setDisplayTranslatedText(translatedText);
  }, [translatedText]);

  useEffect(() => {
    setLocalFromLang(fromLang);
  }, [fromLang]);

  useEffect(() => {
    setLocalToLang(toLang);
  }, [toLang]);

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

  const handleCopyOriginal = async () => {
    if (!originalText) return;
    await navigator.clipboard.writeText(originalText);
    setCopiedOriginal(true);
    setTimeout(() => setCopiedOriginal(false), 1500);
  };

  const handleCopyTranslated = async () => {
    if (!displayTranslatedText) return;
    await navigator.clipboard.writeText(displayTranslatedText);
    setCopiedTranslated(true);
    setTimeout(() => setCopiedTranslated(false), 1500);
  };

  const handleProviderSwitch = async (provider: TranslateProvider) => {
    try {
      await settings.updateSettings({ translateProvider: provider });
      setShowProviderMenu(false);
      if (onProviderChange) {
        onProviderChange(provider);
      }
    } catch (error) {
      console.error('切换翻译服务商失败:', error);
    }
  };

  const handleFromLangChange = (newFromLang: string) => {
    setLocalFromLang(newFromLang);
    if (onLanguageChange) {
      onLanguageChange(newFromLang, localToLang);
    }
  };

  const handleToLangChange = (newToLang: string) => {
    setLocalToLang(newToLang);
    if (onLanguageChange) {
      onLanguageChange(localFromLang, newToLang);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex w-full h-full bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
      {/* 左侧：图片预览 */}
      {imagePreview && (
        <div className="w-48 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-2 flex items-center justify-center overflow-hidden">
          <img
            src={imagePreview}
            alt="截图预览"
            className="max-w-full max-h-full object-contain rounded"
          />
        </div>
      )}

      {/* 右侧：翻译内容 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0"
          data-tauri-drag-region
        >
          <div className="flex items-center gap-2 flex-wrap" data-tauri-drag-region>
            <span className="text-sm">🌐</span>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
              {title}
            </span>

            {/* Provider 切换菜单 */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowProviderMenu(!showProviderMenu)}
                className="flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-2 py-0.5 rounded transition-colors whitespace-nowrap"
              >
                <span>{PROVIDER_ICONS[currentProvider]}</span>
                <span className="text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  {translateProviderName(currentProvider, settings)}
                </span>
                <ChevronDown size={10} className="text-gray-400" />
              </button>

              {showProviderMenu && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                  {TRANSLATE_PROVIDER_ORDER.map((provider) => (
                    <button
                      key={provider}
                      onClick={() => handleProviderSwitch(provider)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                        currentProvider === provider
                          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                          : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      <span>{PROVIDER_ICONS[provider]}</span>
                      <span className="flex-1 text-left">
                        {provider === 'openai-compatible'
                          ? translateProviderName(provider, settings)
                          : TRANSLATE_PROVIDER_LABELS[provider]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 语言选择 */}
            <div className="flex items-center gap-1 text-xs whitespace-nowrap">
              <select
                value={localFromLang}
                onChange={(e) => handleFromLangChange(e.target.value)}
                className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded border-none outline-none text-xs whitespace-nowrap"
              >
                {Object.entries(LANGUAGES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
              <span className="text-gray-400 whitespace-nowrap">→</span>
              <select
                value={localToLang}
                onChange={(e) => handleToLangChange(e.target.value)}
                className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded border-none outline-none text-xs whitespace-nowrap"
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

          <div className="flex items-center gap-1">
            <button
              onClick={onRetranslate}
              disabled={loading}
              title="重新翻译"
              className={`p-1 rounded transition-colors ${
                loading
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20'
              }`}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              title="关闭"
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* 原文 */}
          {showOriginal && originalText && (
            <div className="border-b border-gray-100 dark:border-gray-800 p-3 bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">原文</span>
                <button
                  onClick={handleCopyOriginal}
                  disabled={!originalText}
                  title="复制原文"
                  className={`p-1 rounded transition-colors ${
                    copiedOriginal
                      ? 'bg-green-500 text-white'
                      : originalText
                        ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                        : 'text-gray-300 cursor-not-allowed'
                  }`}
                >
                  {copiedOriginal ? <Check size={10} /> : <Copy size={10} />}
                </button>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300 max-h-24 overflow-y-auto">
                {originalText}
              </div>
            </div>
          )}

          {/* 译文 */}
          <div className="flex-1 p-3 overflow-y-auto min-h-0">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 size={24} className="animate-spin text-blue-500" />
                  <span className="text-xs text-gray-400">翻译中...</span>
                </div>
              </div>
            ) : displayTranslatedText ? (
              <textarea
                value={displayTranslatedText}
                onChange={(e) => setDisplayTranslatedText(e.target.value)}
                className="w-full h-full text-sm text-gray-800 dark:text-gray-200 bg-transparent border-none outline-none resize-none leading-relaxed p-0"
                placeholder="翻译结果将显示在这里..."
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                <div className="text-2xl">🌐</div>
                <div className="text-xs text-gray-400">等待翻译结果...</div>
              </div>
            )}
          </div>
        </div>

        {/* 底部工具栏 */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="text-xs text-gray-400">
            {!loading && displayTranslatedText && `${displayTranslatedText.length} 字符`}
          </div>
          <button
            onClick={handleCopyTranslated}
            disabled={!displayTranslatedText || loading}
            className={`flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors ${
              copiedTranslated
                ? 'bg-green-500 text-white'
                : displayTranslatedText && !loading
                  ? 'bg-blue-500 hover:bg-blue-600 text-white'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {copiedTranslated ? (
              <>
                <Check size={12} />
                <span>已复制</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>复制译文</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
