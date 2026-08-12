import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow, LogicalSize } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import ScreenshotOcrWindow from './ScreenshotOcrWindow';
import TranslateResultWindow from './TranslateResultWindow';
import TranslateOverlay from './TranslateOverlay';
import { useSettingsStore } from '../stores/settingsStore';
import {
  buildTranslateConfig,
  validateTranslateProvider,
  type TranslateProvider,
} from './translateProviderUtils';

interface OcrResult {
  text: string;
  confidence?: number;
  text_blocks?: Array<{
    text: string;
    location: {
      left: number;
      top: number;
      width: number;
      height: number;
    };
  }>;
}

interface TranslateResult {
  translated_text: string;
  from_lang: string;
  to_lang: string;
}

export default function ScreenshotTranslateCapture() {
  const [mode, setMode] = useState<'idle' | 'selecting' | 'result' | 'overlay'>('selecting');
  const [originalText, setOriginalText] = useState<string>('');
  const [translatedText, setTranslatedText] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [screenshotKey, setScreenshotKey] = useState(0);
  const [fromLang, setFromLang] = useState<string>('auto');
  const [toLang, setToLang] = useState<string>('zh');
  const [captureRect, setCaptureRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [textBlocks, setTextBlocks] = useState<OcrResult['text_blocks']>();
  const [translations, setTranslations] = useState<string[]>([]);
  const [settingsReady, setSettingsReady] = useState(false);
  const settings = useSettingsStore();

  const ensureLatestSettings = useCallback(async () => {
    await useSettingsStore.getState().loadSettings();
    return useSettingsStore.getState();
  }, []);

  useEffect(() => {
    let mounted = true;
    ensureLatestSettings()
      .then(() => {
        if (mounted) setSettingsReady(true);
      })
      .catch((error) => {
        console.error('加载截图翻译设置失败:', error);
        if (mounted) setSettingsReady(true);
      });
    return () => {
      mounted = false;
    };
  }, [ensureLatestSettings]);

  console.log('=== ScreenshotTranslateCapture rendered ===');
  console.log('Mode:', mode, 'ScreenshotKey:', screenshotKey);
  console.log('Translate Mode Setting:', settings.translateMode);
  console.log('Translate API Config:', {
    provider: settings.translateProvider,
    translateBaiduAppId: settings.translateBaiduAppId,
    translateBaiduAppIdLength: settings.translateBaiduAppId?.length || 0,
    translateBaiduSecretKey: settings.translateBaiduSecretKey ? '***' : 'empty',
    translateBaiduSecretKeyLength: settings.translateBaiduSecretKey?.length || 0,
  });

  // 显示结果窗口的公共函数（固定大小 700x450）
  const showResultWindow = async (shouldCenter: boolean = true) => {
    await appWindow.setFullscreen(false);
    await appWindow.setSize(new LogicalSize(700, 450));
    if (shouldCenter) {
      await appWindow.center();
    }
    await appWindow.show();
    await appWindow.setFocus();
  };

  // 显示覆盖层窗口（根据截图大小调整）
  const showOverlayWindow = async () => {
    await appWindow.setFullscreen(false);

    // 根据截图大小设置窗口大小，但限制最大尺寸
    const maxWidth = 1400;
    const maxHeight = 900;
    const windowWidth = Math.min(captureRect.width + 100, maxWidth);
    const windowHeight = Math.min(captureRect.height + 100, maxHeight);

    await appWindow.setSize(new LogicalSize(windowWidth, windowHeight));
    await appWindow.center();
    await appWindow.setDecorations(false);
    await appWindow.setAlwaysOnTop(true);
    await appWindow.show();
    await appWindow.setFocus();
  };

  // 监听重启截图事件（窗口复用时触发）
  useEffect(() => {
    const unlisten = listen('restart-screenshot-translate', async () => {
      console.log('Restart screenshot translate event received');
      const latestSettings = await ensureLatestSettings();
      console.log('Settings reloaded, translateMode:', latestSettings.translateMode);

      setSettingsReady(true);
      setMode('selecting');
      setOriginalText('');
      setTranslatedText('');
      setImagePreview('');
      setLoading(false);
      setTranslations([]);
      setTextBlocks(undefined);
      setFromLang(latestSettings.translateFromLang || 'auto');
      setToLang(latestSettings.translateToLang || 'zh');
      setScreenshotKey((prev) => prev + 1);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [ensureLatestSettings]);

  const performTranslate = async (
    text: string,
    forceProvider?: TranslateProvider,
    isProviderSwitch: boolean = false,
    isOverlayMode: boolean = false,
    forceFromLang?: string,
    forceToLang?: string
  ) => {
    setLoading(true);

    try {
      const currentSettings = await ensureLatestSettings();
      const provider = forceProvider || currentSettings.translateProvider || 'baidu';
      const actualFromLang = forceFromLang !== undefined ? forceFromLang : fromLang;
      const actualToLang = forceToLang !== undefined ? forceToLang : toLang;

      console.log('开始翻译，使用服务商:', provider, '语言:', actualFromLang, '→', actualToLang);

      const providerError = validateTranslateProvider(provider, currentSettings);
      if (providerError) {
        setTranslatedText(`错误：${providerError}`);
        setLoading(false);
        if (isOverlayMode) {
          await showOverlayWindow();
        } else {
          await showResultWindow(!isProviderSwitch);
        }
        return;
      }

      const translateResult = await invoke<TranslateResult>('translate_text', {
        text,
        fromLang: actualFromLang,
        toLang: actualToLang,
        provider,
        autoDetectLanguage: currentSettings.translateAutoDetectLanguage ?? true,
        config: buildTranslateConfig(currentSettings),
      });

      console.log('翻译结果:', translateResult);

      setTranslatedText(translateResult.translated_text);
      setFromLang(translateResult.from_lang);
      setToLang(translateResult.to_lang);

      // 自动复制
      if (currentSettings.translateAutoCopy) {
        await navigator.clipboard.writeText(translateResult.translated_text);
      }

      if (isOverlayMode) {
        await showOverlayWindow();
      } else {
        await showResultWindow(!isProviderSwitch);
      }
    } catch (err) {
      console.error('翻译错误:', err);
      setTranslatedText(
        '翻译失败：' +
          String(err) +
          '\n\n请检查：\n1. 网络连接是否正常\n2. API 密钥是否正确\n3. API 配额是否充足'
      );
      if (isOverlayMode) {
        await showOverlayWindow();
      } else {
        await showResultWindow(!isProviderSwitch);
      }
    } finally {
      setLoading(false);
    }
  };

  // 翻译多个文本块（用于覆盖模式）
  const performTranslateBlocks = async (
    blocks: NonNullable<OcrResult['text_blocks']>,
    forceProvider?: TranslateProvider,
    forceFromLang?: string,
    forceToLang?: string
  ) => {
    setLoading(true);

    try {
      const currentSettings = await ensureLatestSettings();
      const provider = forceProvider || currentSettings.translateProvider || 'baidu';
      const actualFromLang = forceFromLang !== undefined ? forceFromLang : fromLang;
      const actualToLang = forceToLang !== undefined ? forceToLang : toLang;

      console.log(
        '开始翻译文本块，使用服务商:',
        provider,
        '语言:',
        actualFromLang,
        '→',
        actualToLang,
        '文本块数量:',
        blocks.length
      );

      const providerError = validateTranslateProvider(provider, currentSettings);
      if (providerError) {
        setTranslatedText(`错误：${providerError}`);
        setLoading(false);
        await showOverlayWindow();
        return;
      }

      // 逐个翻译文本块
      const translatedBlocks: string[] = [];
      for (const block of blocks) {
        try {
          const translateResult = await invoke<TranslateResult>('translate_text', {
            text: block.text,
            fromLang: actualFromLang,
            toLang: actualToLang,
            provider,
            autoDetectLanguage: currentSettings.translateAutoDetectLanguage ?? true,
            config: buildTranslateConfig(currentSettings),
          });

          translatedBlocks.push(translateResult.translated_text);
          setFromLang(translateResult.from_lang);
          setToLang(translateResult.to_lang);
        } catch (err) {
          console.error('翻译文本块失败:', block.text, err);
          translatedBlocks.push(block.text); // 翻译失败时保留原文
        }
      }

      console.log('所有文本块翻译完成:', translatedBlocks);

      setTranslations(translatedBlocks);
      setTranslatedText(translatedBlocks.join('\n'));

      // 自动复制
      if (currentSettings.translateAutoCopy) {
        await navigator.clipboard.writeText(translatedBlocks.join('\n'));
      }
    } catch (err) {
      console.error('翻译错误:', err);
      setTranslatedText('翻译失败：' + String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCapture = async (
    x: number,
    y: number,
    width: number,
    height: number,
    fullScreenshotBase64: string
  ) => {
    console.log('截图区域:', { x, y, width, height });

    const translateMode = settings.translateMode || 'window';
    const isOverlayMode = translateMode === 'overlay';

    console.log('=== 翻译模式检查 ===');
    console.log('settings.translateMode:', settings.translateMode);
    console.log('translateMode:', translateMode);
    console.log('isOverlayMode:', isOverlayMode);

    await appWindow.hide();

    // 先不设置 mode，等数据准备好再设置
    setLoading(true);
    setOriginalText('');
    setTranslatedText('');
    setTranslations([]);
    setTextBlocks(undefined);
    setCaptureRect({ x, y, width, height });

    try {
      // 使用前端传来的全屏截图进行裁剪，而不是重新截图
      // 这样可以避免页面滚动导致的内容错位问题
      const capturedImageBase64 = await invoke<string>('crop_image_region', {
        imageBase64: fullScreenshotBase64,
        x,
        y,
        width,
        height,
      });

      console.log('裁剪成功，Base64长度:', capturedImageBase64.length);

      setImagePreview(`data:image/png;base64,${capturedImageBase64}`);

      // 2. OCR 识别文字（使用 OCR 设置中的配置）
      const ocrResult = await invoke<OcrResult>('ocr_recognize', {
        imageBase64: capturedImageBase64,
        provider: settings.ocrProvider || 'baidu',
        config: {
          baiduApiKey: settings.ocrBaiduApiKey || '',
          baiduSecretKey: settings.ocrBaiduSecretKey || '',
          baiduHighAccuracy: settings.ocrBaiduHighAccuracy ?? true,
          googleApiKey: settings.ocrGoogleApiKey || '',
          tencentSecretId: settings.ocrTencentSecretId || '',
          tencentSecretKey: settings.ocrTencentSecretKey || '',
          tencentRegion: settings.ocrTencentRegion || 'ap-guangzhou',
          aliyunAccessKeyId: settings.ocrAliyunAccessKeyId || '',
          aliyunAccessKeySecret: settings.ocrAliyunAccessKeySecret || '',
        },
      });

      console.log('OCR 识别结果:', ocrResult);
      console.log('OCR text_blocks:', ocrResult.text_blocks);
      console.log('text_blocks length:', ocrResult.text_blocks?.length || 0);

      if (!ocrResult.text || ocrResult.text.trim() === '') {
        setOriginalText('未识别到文字');
        setTranslatedText(
          '未识别到文字内容\n\n提示：\n1. 确保选择的区域包含清晰的文字\n2. 尝试重新截图'
        );
        setLoading(false);
        setMode(isOverlayMode ? 'overlay' : 'result');
        if (isOverlayMode) {
          await showOverlayWindow();
        } else {
          await showResultWindow();
        }
        return;
      }

      setOriginalText(ocrResult.text);
      setTextBlocks(ocrResult.text_blocks);

      console.log('=== 翻译模式判断 ===');
      console.log('isOverlayMode:', isOverlayMode);
      console.log('text_blocks exists:', !!ocrResult.text_blocks);
      console.log('text_blocks length:', ocrResult.text_blocks?.length || 0);

      // 3. 翻译文字
      if (isOverlayMode && ocrResult.text_blocks && ocrResult.text_blocks.length > 0) {
        console.log('进入覆盖模式分支');
        // 覆盖模式：逐个翻译文本块
        await performTranslateBlocks(ocrResult.text_blocks);
        // 翻译完成后再设置 mode 和显示窗口
        setMode('overlay');
        await showOverlayWindow();
      } else {
        console.log('进入窗口模式分支');
        // 窗口模式：翻译整段文本
        // performTranslate 内部会调用 showResultWindow()
        await performTranslate(ocrResult.text, undefined, false, false);
        // 翻译完成后再设置 mode
        setMode('result');
      }
    } catch (err) {
      console.error('截图翻译错误:', err);
      setOriginalText('');
      setTranslatedText('处理失败：' + String(err));
      setLoading(false);
      setMode(isOverlayMode ? 'overlay' : 'result');
      if (isOverlayMode) {
        await showOverlayWindow();
      } else {
        await showResultWindow();
      }
    }
  };

  const handleCancel = useCallback(async () => {
    console.log('handleCancel called');
    await appWindow.hide();
  }, []);

  const handleClose = useCallback(async () => {
    console.log('handleClose called');
    await appWindow.hide();
  }, []);

  const handleProviderChange = async (provider: TranslateProvider) => {
    console.log('切换翻译服务商到:', provider, '当前语言:', fromLang, '→', toLang);
    if (originalText) {
      // 传递当前的语言参数，确保使用正确的语言
      await performTranslate(originalText, provider, true, false, fromLang, toLang);
    }
  };

  const handleLanguageChange = async (newFromLang: string, newToLang: string) => {
    console.log('切换语言:', newFromLang, '→', newToLang);

    // 先更新状态
    setFromLang(newFromLang);
    setToLang(newToLang);

    // 如果有原文，使用新的语言参数重新翻译
    if (originalText) {
      setLoading(true);
      try {
        const currentSettings = await ensureLatestSettings();
        const provider = currentSettings.translateProvider || 'baidu';
        const translateResult = await invoke<TranslateResult>('translate_text', {
          text: originalText,
          fromLang: newFromLang, // 使用新的语言参数
          toLang: newToLang, // 使用新的语言参数
          provider,
          autoDetectLanguage: currentSettings.translateAutoDetectLanguage ?? true,
          config: buildTranslateConfig(currentSettings),
        });

        console.log('语言切换后翻译结果:', translateResult);
        setTranslatedText(translateResult.translated_text);

        // 自动复制
        if (settings.translateAutoCopy) {
          await navigator.clipboard.writeText(translateResult.translated_text);
        }
      } catch (error) {
        console.error('翻译失败:', error);
        setTranslatedText('翻译失败：' + String(error));
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRetranslate = async () => {
    if (originalText) {
      await performTranslate(originalText);
    }
  };

  if (mode === 'selecting') {
    console.log('Rendering ScreenshotOcrWindow with key:', screenshotKey);
    return (
      <>
        <ScreenshotOcrWindow
          key={screenshotKey}
          onCapture={handleCapture}
          onCancel={handleCancel}
          readyEventName="screenshot-translate-ready"
          backgroundEventName="screenshot-translate-bg-data"
        />
        {!settingsReady && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 text-white text-sm">
            正在加载翻译设置...
          </div>
        )}
      </>
    );
  }

  if (mode === 'overlay') {
    console.log('Rendering TranslateOverlay');
    return (
      <TranslateOverlay
        imagePreview={imagePreview}
        textBlocks={textBlocks}
        translations={translations}
        loading={loading}
        captureRect={captureRect}
        onClose={handleClose}
      />
    );
  }

  if (mode === 'result') {
    console.log('Rendering TranslateResultWindow');

    return (
      <div className="w-full h-full bg-white dark:bg-gray-900">
        <TranslateResultWindow
          originalText={originalText}
          translatedText={translatedText}
          loading={loading}
          imagePreview={imagePreview}
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

  console.log('Rendering null (mode:', mode, ')');
  return null;
}
