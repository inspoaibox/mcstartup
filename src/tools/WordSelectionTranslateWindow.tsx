import { useState, useEffect, useRef } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import TranslateResultWindow from './TranslateResultWindow';
import { useToolTheme } from './useToolTheme';
import { useSettingsStore } from '../stores/settingsStore';
import { buildTranslateConfig, type TranslateProvider } from './translateProviderUtils';

interface TranslateResult {
  translated_text: string;
  from_lang: string;
  to_lang: string;
}

interface TranslateEvent {
  type: 'loading' | 'success' | 'error';
  request_id?: number;
  original_text?: string;
  translated_text?: string;
  from_lang?: string;
  to_lang?: string;
  copied_to_clipboard?: boolean;
  error?: string;
  error_code?: string;
}

export default function WordSelectionTranslateWindow() {
  const ready = useToolTheme();
  const settings = useSettingsStore();

  const [loading, setLoading] = useState(false);
  const [originalText, setOriginalText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [fromLang, setFromLang] = useState('auto');
  const [toLang, setToLang] = useState('zh');
  const latestRequestId = useRef(0);

  // 监听后端翻译事件
  useEffect(() => {
    const unlisten = listen<TranslateEvent>('word-selection-translate-event', (event) => {
      const payload = event.payload;
      const requestId = payload.request_id ?? 0;
      if (requestId < latestRequestId.current) return;
      latestRequestId.current = requestId;

      if (payload.type === 'loading') {
        setLoading(true);
        setOriginalText('');
        setTranslatedText('');
      } else if (payload.type === 'success') {
        setLoading(false);
        setOriginalText(payload.original_text || '');
        setTranslatedText(payload.translated_text || '');
        setFromLang(payload.from_lang || 'auto');
        setToLang(payload.to_lang || 'zh');
      } else if (payload.type === 'error') {
        setLoading(false);
        setTranslatedText(payload.error || '翻译失败');
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    emit('word-selection-translate-ready');
  }, []);

  // 和截图翻译完全一致的翻译函数
  const performTranslate = async (
    text: string,
    forceProvider?: TranslateProvider,
    forceFromLang?: string,
    forceToLang?: string
  ) => {
    setLoading(true);
    try {
      const provider = forceProvider || settings.translateProvider || 'baidu';
      const actualFromLang = forceFromLang !== undefined ? forceFromLang : fromLang;
      const actualToLang = forceToLang !== undefined ? forceToLang : toLang;

      const result = await invoke<TranslateResult>('translate_text', {
        text,
        fromLang: actualFromLang,
        toLang: actualToLang,
        provider,
        autoDetectLanguage: settings.translateAutoDetectLanguage ?? true,
        config: buildTranslateConfig(settings),
      });

      setTranslatedText(result.translated_text);
      setFromLang(result.from_lang);
      setToLang(result.to_lang);

      if (settings.translateAutoCopy) {
        await navigator.clipboard.writeText(result.translated_text);
      }
    } catch (err) {
      setTranslatedText('翻译失败：' + String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    await appWindow.hide();
  };

  const handleProviderChange = async (provider: TranslateProvider) => {
    if (originalText) {
      await performTranslate(originalText, provider, fromLang, toLang);
    }
  };

  const handleLanguageChange = async (newFromLang: string, newToLang: string) => {
    setFromLang(newFromLang);
    setToLang(newToLang);
    if (originalText) {
      await performTranslate(originalText, undefined, newFromLang, newToLang);
    }
  };

  const handleRetranslate = async () => {
    if (originalText) {
      await performTranslate(originalText);
    }
  };

  if (!ready) return null;

  return (
    <div className="w-full h-full bg-white dark:bg-gray-900">
      <TranslateResultWindow
        title="划词翻译"
        originalText={originalText}
        translatedText={translatedText}
        loading={loading}
        imagePreview=""
        fromLang={fromLang}
        toLang={toLang}
        onClose={handleClose}
        onProviderChange={handleProviderChange}
        onLanguageChange={handleLanguageChange}
        onRetranslate={handleRetranslate}
      />
    </div>
  );
}
