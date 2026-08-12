import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { writeText } from '@tauri-apps/api/clipboard';
import { appWindow, LogicalSize, WebviewWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import ScreenshotOcrWindow from './ScreenshotOcrWindow';
import OcrResultWindow from './OcrResultWindow';
import { useSettingsStore } from '../stores/settingsStore';

type OcrProvider = 'baidu' | 'google' | 'tencent' | 'aliyun' | 'wechat' | 'paddle' | 'wps';
type RecognitionType = 'text' | 'table' | 'qrcode';

interface OcrResult {
  text: string;
  confidence?: number;
  text_blocks?: OcrTextBlock[];
}

interface OcrTextBlock {
  text: string;
  location: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

interface TableResult {
  html: string;
  markdown: string;
  rows?: string[][];
}

async function copyTextSafely(text: string) {
  if (!text) return;
  try {
    await writeText(text);
  } catch (tauriError) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (browserError) {
      console.warn('自动复制 OCR 结果失败:', tauriError, browserError);
    }
  }
}

export default function ScreenshotOcrCapture() {
  const [mode, setMode] = useState<'idle' | 'selecting' | 'result'>('selecting');
  const [result, setResult] = useState<string>('');
  const [textBlocks, setTextBlocks] = useState<OcrTextBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [imageBase64, setImageBase64] = useState<string>(''); // 保存截图数据
  const [imagePreview, setImagePreview] = useState<string>(''); // 保存截图预览 URL
  const [screenshotKey, setScreenshotKey] = useState(0); // 用于强制重新渲染 ScreenshotOcrWindow
  const [settingsReady, setSettingsReady] = useState(false);
  console.log('ScreenshotOcrCapture rendered, mode:', mode, 'screenshotKey:', screenshotKey);

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
        console.error('加载 OCR 设置失败:', error);
        if (mounted) setSettingsReady(true);
      });

    return () => {
      mounted = false;
    };
  }, [ensureLatestSettings]);

  // 显示结果窗口的公共函数（固定大小 800x600）
  const showResultWindow = async (shouldCenter: boolean = true) => {
    await appWindow.setFullscreen(false);
    await appWindow.setSize(new LogicalSize(800, 600));
    if (shouldCenter) {
      await appWindow.center();
    }
    await appWindow.show();
    await appWindow.setFocus();
  };

  // 监听重启截图事件（窗口复用时触发）
  useEffect(() => {
    const unlisten = listen('restart-screenshot', () => {
      console.log('Restart screenshot event received');
      void ensureLatestSettings().finally(() => {
        setSettingsReady(true);
        // 重置状态，重新开始截图流程
        setMode('selecting');
        setResult('');
        setTextBlocks([]);
        setImageBase64('');
        setImagePreview('');
        setLoading(false);
        // 增加 key 值，强制重新挂载 ScreenshotOcrWindow 组件
        setScreenshotKey((prev) => prev + 1);
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [ensureLatestSettings]);

  const performOcr = async (
    base64Image: string,
    forceProvider?: OcrProvider,
    isProviderSwitch: boolean = false
  ) => {
    setLoading(true);

    try {
      const currentSettings = await ensureLatestSettings();
      // 使用传入的 provider 或从 settings 读取
      const provider = forceProvider || currentSettings.ocrProvider || 'baidu';

      console.log('开始 OCR 识别，使用服务商:', provider, '(强制指定:', forceProvider, ')');

      // 检查 API 配置
      if (
        provider === 'baidu' &&
        (!currentSettings.ocrBaiduApiKey || !currentSettings.ocrBaiduSecretKey)
      ) {
        setResult('错误：请先在软件设置中配置百度 OCR 的 API Key 和 Secret Key');
        setTextBlocks([]);
        setLoading(false);
        await showResultWindow(!isProviderSwitch);
        return;
      }

      if (provider === 'google' && !currentSettings.ocrGoogleApiKey) {
        setResult('错误：请先在软件设置中配置 Google Cloud Vision 的 API Key');
        setTextBlocks([]);
        setLoading(false);
        await showResultWindow(!isProviderSwitch);
        return;
      }

      if (
        provider === 'tencent' &&
        (!currentSettings.ocrTencentSecretId || !currentSettings.ocrTencentSecretKey)
      ) {
        setResult('错误：请先在软件设置中配置腾讯云 OCR 的 Secret ID 和 Secret Key');
        setTextBlocks([]);
        setLoading(false);
        await showResultWindow(!isProviderSwitch);
        return;
      }

      console.log('开始 OCR 识别，使用服务商:', provider, '(强制指定:', forceProvider, ')');

      const ocrResult = await invoke<OcrResult>('ocr_recognize', {
        imageBase64: base64Image,
        provider,
        config: {
          baiduApiKey: currentSettings.ocrBaiduApiKey || '',
          baiduSecretKey: currentSettings.ocrBaiduSecretKey || '',
          baiduHighAccuracy: currentSettings.ocrBaiduHighAccuracy !== false,
          googleApiKey: currentSettings.ocrGoogleApiKey || '',
          tencentSecretId: currentSettings.ocrTencentSecretId || '',
          tencentSecretKey: currentSettings.ocrTencentSecretKey || '',
          tencentRegion: currentSettings.ocrTencentRegion || 'ap-guangzhou',
          aliyunAccessKeyId: currentSettings.ocrAliyunAccessKeyId || '',
          aliyunAccessKeySecret: currentSettings.ocrAliyunAccessKeySecret || '',
        },
      });

      console.log('OCR 识别结果:', ocrResult);

      if (!ocrResult.text || ocrResult.text.trim() === '') {
        setResult(
          '未识别到文字内容\n\n提示：\n1. 确保选择的区域包含清晰的文字\n2. 检查 OCR 服务商配置是否正确\n3. 尝试切换其他 OCR 服务商'
        );
        setTextBlocks([]);
      } else {
        setResult(ocrResult.text);
        setTextBlocks(ocrResult.text_blocks || []);

        // 自动复制
        if (currentSettings.ocrCopyAfterRecognize !== false) {
          await copyTextSafely(ocrResult.text);
        }
      }

      // 调整窗口大小并显示结果（固定大小 600x400）
      // 切换服务商时不居中，保持窗口位置
      await showResultWindow(!isProviderSwitch);
    } catch (err) {
      console.error('OCR 识别错误:', err);
      const provider = forceProvider || useSettingsStore.getState().ocrProvider || 'baidu';
      const hints =
        provider === 'wechat'
          ? '\n\n请检查：\n1. 软件资源目录是否包含 resources/wechat-ocr\n2. 内置 wxocr.dll 和模型文件是否完整\n3. 内置 wcocr.dll 桥接库是否存在'
          : provider === 'paddle'
            ? '\n\n请检查：\n1. 软件资源目录是否包含 resources/paddle-ocr\n2. 内置 PaddleOCR ONNX 模型文件是否完整\n3. 打包安装包是否包含 resources/paddle-ocr/**/*'
            : provider === 'wps'
              ? '\n\n请检查：\n1. 软件资源目录是否包含 resources/wps-ocr\n2. 内置 WPS OCR TFLite 模型、字典和 tensorflowlite_c.dll 是否完整\n3. 打包安装包是否包含 resources/wps-ocr/**/*'
              : '\n\n请检查：\n1. 网络连接是否正常\n2. API 密钥是否正确\n3. API 配额是否充足';
      setResult('识别失败：' + String(err) + hints);
      setTextBlocks([]);
      await showResultWindow(!isProviderSwitch);
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

    // 先隐藏截图窗口
    await appWindow.hide();

    setMode('result');
    setLoading(true);
    setResult('');
    setTextBlocks([]);

    try {
      // 使用前端传来的全屏截图进行裁剪
      const capturedImageBase64 = await invoke<string>('crop_image_region', {
        imageBase64: fullScreenshotBase64,
        x,
        y,
        width,
        height,
      });

      console.log('裁剪成功，Base64长度:', capturedImageBase64.length);

      // 保存截图数据和预览
      setImageBase64(capturedImageBase64);
      setImagePreview(`data:image/png;base64,${capturedImageBase64}`);

      // 检查 URL 参数，判断是否为纯截图模式
      const params = new URLSearchParams(window.location.search);
      const isScreenshotMode = params.get('mode') === 'screenshot';

      if (isScreenshotMode) {
        // 纯截图模式：直接打开截图结果窗口
        console.log('截图模式：跳过 OCR，直接显示结果');
        console.log('截图数据长度:', capturedImageBase64.length);
        console.log('截图数据前100字符:', capturedImageBase64.substring(0, 100));

        // 先检查并关闭可能存在的旧结果窗口
        try {
          const existingWindow = WebviewWindow.getByLabel('screenshot-result');
          if (existingWindow) {
            console.log('关闭已存在的截图结果窗口');
            await existingWindow.close();
            // 等待窗口完全关闭
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (e) {
          console.log('检查旧窗口时出错:', e);
        }

        // 创建截图结果窗口
        try {
          console.log('开始创建截图结果窗口，Base64长度:', capturedImageBase64.length);

          // 直接通过 URL 传递数据
          const resultWindow = new WebviewWindow('screenshot-result', {
            url: `index.html#/screenshot-result?screenshot=${encodeURIComponent(capturedImageBase64)}`,
            title: '截图完成',
            width: 600,
            height: 500,
            center: true,
            resizable: true,
            alwaysOnTop: true,
            decorations: false,
            visible: false,
          });

          console.log('截图结果窗口已创建');

          resultWindow.once('tauri://created', async () => {
            console.log('截图结果窗口创建成功，显示窗口');
            await resultWindow.show();
            await appWindow.close();
          });

          resultWindow.once('tauri://error', async (e) => {
            console.error('截图结果窗口创建失败:', e);
            await appWindow.close();
          });
        } catch (e) {
          console.error('创建截图结果窗口时出错:', e);
          await appWindow.close();
        }
      } else {
        // OCR 模式：智能识别（先检测是否有二维码）
        console.log('开始智能识别：检测图片类型...');

        try {
          // 快速检测是否包含二维码（< 50ms）
          const hasQR = await invoke<boolean>('has_qrcode', {
            imageBase64: capturedImageBase64,
          });

          if (hasQR) {
            console.log('检测到二维码，使用二维码识别');
            await performQRCodeRecognize(capturedImageBase64);
          } else {
            console.log('未检测到二维码，使用文字识别');
            await performOcr(capturedImageBase64);
          }
        } catch (err) {
          console.error('智能识别检测失败，回退到文字识别:', err);
          await performOcr(capturedImageBase64);
        }
      }
    } catch (err) {
      console.error('裁剪图片错误:', err);
      setResult('裁剪图片失败：' + String(err));
      setTextBlocks([]);
      await showResultWindow();
      setLoading(false);
    }
  };

  const performQRCodeRecognize = async (base64Image: string) => {
    setLoading(true);
    try {
      const currentSettings = await ensureLatestSettings();
      console.log('开始二维码识别');
      const qrText = await invoke<string>('recognize_qrcode', {
        imageBase64: base64Image,
      });
      console.log('二维码识别结果:', qrText);
      setResult(qrText);
      setTextBlocks([]);

      // 自动复制
      if (currentSettings.ocrCopyAfterRecognize !== false) {
        await copyTextSafely(qrText);
      }
      await showResultWindow();
    } catch (err) {
      console.error('二维码识别错误:', err);
      setResult('二维码识别失败：' + String(err) + '\n\n请确保图片中包含清晰的二维码');
      setTextBlocks([]);
      await showResultWindow();
    } finally {
      setLoading(false);
    }
  };

  const performTableRecognize = async (base64Image: string) => {
    setLoading(true);
    try {
      const currentSettings = await ensureLatestSettings();
      console.log('开始表格识别');
      const tableResult = await invoke<TableResult>('recognize_table', {
        imageBase64: base64Image,
        provider: currentSettings.ocrProvider || 'baidu',
        config: {
          baiduApiKey: currentSettings.ocrBaiduApiKey || '',
          baiduSecretKey: currentSettings.ocrBaiduSecretKey || '',
          baiduHighAccuracy: currentSettings.ocrBaiduHighAccuracy ?? true,
          googleApiKey: currentSettings.ocrGoogleApiKey || '',
          tencentSecretId: currentSettings.ocrTencentSecretId || '',
          tencentSecretKey: currentSettings.ocrTencentSecretKey || '',
          tencentRegion: currentSettings.ocrTencentRegion || 'ap-guangzhou',
          aliyunAccessKeyId: currentSettings.ocrAliyunAccessKeyId || '',
          aliyunAccessKeySecret: currentSettings.ocrAliyunAccessKeySecret || '',
        },
      });

      console.log('表格识别结果:', tableResult);
      // 显示 Markdown 格式的表格
      setResult(tableResult.markdown);
      setTextBlocks([]);

      // 自动复制
      if (currentSettings.ocrCopyAfterRecognize !== false) {
        await copyTextSafely(tableResult.markdown);
      }
      await showResultWindow();
    } catch (err) {
      console.error('表格识别错误:', err);
      setResult('表格识别失败：' + String(err));
      setTextBlocks([]);
      await showResultWindow();
    } finally {
      setLoading(false);
    }
  };

  const handleRecognitionTypeChange = async (type: RecognitionType) => {
    if (!imageBase64) return;

    console.log('切换识别类型到:', type);

    if (type === 'qrcode') {
      await performQRCodeRecognize(imageBase64);
    } else if (type === 'table') {
      await performTableRecognize(imageBase64);
    } else {
      // 文字识别，使用当前服务商重新识别
      await performOcr(imageBase64, undefined, true);
    }
  };

  const handleTextChange = (newText: string) => {
    // 更新结果文本
    setResult(newText);
  };

  const handleCancel = useCallback(async () => {
    // 隐藏窗口而不是关闭（保持窗口存在以便下次快速复用）
    console.log('handleCancel called');
    await appWindow.hide();
  }, []);

  const handleClose = useCallback(async () => {
    // 隐藏窗口而不是关闭（保持窗口存在以便下次快速复用）
    console.log('handleClose called');
    await appWindow.hide();
  }, []);

  const handleProviderChange = async (provider: OcrProvider) => {
    // 切换服务商并重新识别
    console.log('切换 OCR 服务商到:', provider);
    if (imageBase64) {
      // 直接传入 provider，不依赖 settings 的更新
      // 第三个参数 true 表示这是切换服务商操作，不需要居中窗口
      await performOcr(imageBase64, provider, true);
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
          readyEventName="screenshot-ocr-ready"
          backgroundEventName="screenshot-ocr-bg-data"
        />
        {!settingsReady && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 text-white text-sm">
            正在加载 OCR 设置...
          </div>
        )}
      </>
    );
  }

  if (mode === 'result') {
    console.log('Rendering OcrResultWindow');

    return (
      <div className="w-full h-full bg-white dark:bg-gray-900">
        <OcrResultWindow
          text={result}
          loading={loading}
          imagePreview={imagePreview}
          textBlocks={textBlocks}
          onClose={handleClose}
          onProviderChange={handleProviderChange}
          onTextChange={handleTextChange}
          onRecognitionTypeChange={handleRecognitionTypeChange}
        />
      </div>
    );
  }

  console.log('Rendering null (mode:', mode, ')');
  return null;
}
