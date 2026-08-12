import { Suspense, lazy, useEffect, useState } from 'react';
import { useSettingsStore } from './stores/settingsStore';
import MainLayout from './components/MainLayout';
import QuickLauncherWindow from './components/QuickLauncherWindow';
import ClipboardWindow from './components/ClipboardWindow';
import DesktopBoxWindow from './components/DesktopBoxWindow';
import ToolboxWindow from './tools/ToolboxWindow';
import CalculatorTool from './tools/CalculatorTool';
import PinyinTool from './tools/PinyinTool';
import TextPrefixTool from './tools/TextPrefixTool';
import RemoveLineNumTool from './tools/RemoveLineNumTool';
import UrlExtractorTool from './tools/UrlExtractorTool';
import UrlEncodeTool from './tools/UrlEncodeTool';
import UrlParserTool from './tools/UrlParserTool';
import Base64Tool from './tools/Base64Tool';
import JsonTool from './tools/JsonTool';
import RegexTool from './tools/RegexTool';
import RandomGeneratorTool from './tools/RandomGeneratorTool';
import UnitConverter from './tools/UnitConverter';
import QRCodeGenerator from './tools/QRCodeGenerator';
import WechatMemeTool from './tools/WechatMemeTool';
import CssTool from './tools/CssTool';
import PingTool from './tools/PingTool';
import SpeedTestTool from './tools/SpeedTestTool';
import DnsQueryTool from './tools/DnsQueryTool';
import IpInfoTool from './tools/IpInfoTool';
import PortScanTool from './tools/PortScanTool';
import TracerouteTool from './tools/TracerouteTool';
import LineProcessorTool from './tools/LineProcessorTool';
import TextFormatterTool from './tools/TextFormatterTool';
import TextDeduplicateTool from './tools/TextDeduplicateTool';
import CaseConverterTool from './tools/CaseConverterTool';
import TimestampTool from './tools/TimestampTool';
import HashTool from './tools/HashTool';
import JwtTool from './tools/JwtTool';
import HttpClientTool from './tools/HttpClientTool';
import CronTool from './tools/CronTool';
import SqlTool from './tools/SqlTool';
import CodeFormatterTool from './tools/CodeFormatterTool';
import GitHubStoreTool from './tools/GitHubStoreTool';
import WebCheckTool from './tools/WebCheckTool';
import DatabaseManagerTool from './tools/DatabaseManagerTool';
import ImageCompressTool from './tools/ImageCompressTool';
import ImageBatchProcessTool from './tools/ImageBatchProcessTool';
import ImageCropTool from './tools/ImageCropTool';
import ImageResizeTool from './tools/ImageResizeTool';
import ImageTransformTool from './tools/ImageTransformTool';
import ImageFilterTool from './tools/ImageFilterTool';
import ImageWatermarkTool from './tools/ImageWatermarkTool';
import ImageExifTool from './tools/ImageExifTool';
import ImageConvertTool from './tools/ImageConvertTool';
import ImageIcoGeneratorTool from './tools/ImageIcoGeneratorTool';
import ImageBgRemoveTool from './tools/ImageBgRemoveTool';
import ImageAiUpscaleTool from './tools/ImageAiUpscaleTool';
import ImageWatermarkRemoveTool from './tools/ImageWatermarkRemoveTool';
import ImageMagicEraserTool from './tools/ImageMagicEraserTool';
import VideoPlayerTool from './tools/VideoPlayerTool';
import MusicPlayerTool from './tools/MusicPlayerTool';
import VideoConvertTool from './tools/VideoConvertTool';
import AudioConvertTool from './tools/AudioConvertTool';
import VideoCompressTool from './tools/VideoCompressTool';
import AudioCompressTool from './tools/AudioCompressTool';
import VideoSplitTool from './tools/VideoSplitTool';
import VideoWatermarkRemoveTool from './tools/VideoWatermarkRemoveTool';
import LocalSpeechToTextTool from './tools/LocalSpeechToTextTool';
import LocalTextToSpeechTool from './tools/LocalTextToSpeechTool';
import LocalSpeechDenoiseTool from './tools/LocalSpeechDenoiseTool';
import LocalVocalSeparationTool from './tools/LocalVocalSeparationTool';
import DownloadManagerTool from './tools/DownloadManagerTool';
import VideoDownloaderTool from './tools/VideoDownloaderTool';
import TikHubDownloaderTool from './tools/TikHubDownloaderTool';
import DouyinDownloaderTool from './tools/DouyinDownloaderTool';
import WxChannelsDownloaderTool from './tools/WxChannelsDownloaderTool';
import PasswordManagerTool from './tools/PasswordManagerTool';
import ArchiveManagerTool from './tools/ArchiveManagerTool';
import ScreenRecordingTool from './tools/ScreenRecordingTool';
import GifRecorderTool from './tools/GifRecorderTool';
import ScreenRecordingRegionPicker from './tools/ScreenRecordingRegionPicker';
import ScreenRecordingController from './tools/ScreenRecordingController';
import AutoClickerPointPicker from './tools/AutoClickerPointPicker';
import PdfMergeTool from './tools/PdfMergeTool';
import PdfSplitTool from './tools/PdfSplitTool';
import PdfRotateTool from './tools/PdfRotateTool';
import PdfEncryptTool from './tools/PdfEncryptTool';
import PdfWatermarkTool from './tools/PdfWatermarkTool';
import PdfCompressTool from './tools/PdfCompressTool';
import PdfToImageTool from './tools/PdfToImageTool';
import ImageToPdfTool from './tools/ImageToPdfTool';
import PdfDeletePagesTool from './tools/PdfDeletePagesTool';
import PdfTranslateTool from './tools/PdfTranslateTool';
import PdfWordOcrTool from './tools/PdfWordOcrTool';
import TencentTableOcrTool from './tools/TencentTableOcrTool';
import TencentBankCardOcrTool from './tools/TencentBankCardOcrTool';
import TencentGeneralInvoiceOcrTool from './tools/TencentGeneralInvoiceOcrTool';
import ExcelMergeTool from './tools/ExcelMergeTool';
import ExcelSplitTool from './tools/ExcelSplitTool';
import ExcelDiffTool from './tools/ExcelDiffTool';
import ExcelConvertTool from './tools/ExcelConvertTool';
import ExcelRemoveEmptyTool from './tools/ExcelRemoveEmptyTool';
import ExcelPreviewTool from './tools/ExcelPreviewTool';
import ExcelFormulaToValueTool from './tools/ExcelFormulaToValueTool';
import ExcelRemoveDuplicatesTool from './tools/ExcelRemoveDuplicatesTool';
import MdWordConvertTool from './tools/MdWordConvertTool';
import FileToMarkdownTool from './tools/FileToMarkdownTool';
import MdPptConvertTool from './tools/MdPptConvertTool';
import EpubGeneratorTool from './tools/EpubGeneratorTool';
import WordFormatTool from './tools/WordFormatTool';
import WordDuplicateCheckTool from './tools/WordDuplicateCheckTool';
import WordSemanticCompareTool from './tools/WordSemanticCompareTool';
import WordSemanticSearchTool from './tools/WordSemanticSearchTool';
import SoftwareCopyrightTool from './tools/SoftwareCopyrightTool';
import DrawStampTool from './tools/DrawStampTool';
import ChineseConverterTool from './tools/ChineseConverterTool';
import TextBatchReplaceTool from './tools/TextBatchReplaceTool';
import TextDiffTool from './tools/TextDiffTool';
import ScreenshotOcrCapture from './tools/ScreenshotOcrCapture';
import ScreenshotTranslateCapture from './tools/ScreenshotTranslateCapture';
import QuickTranslateWindow from './tools/QuickTranslateWindow';
import WordSelectionTranslateWindow from './tools/WordSelectionTranslateWindow';
import HtmlEditorTool from './tools/HtmlEditorTool';
import MdEditorTool from './tools/MdEditorTool';
import TodoTool from './tools/TodoTool';
import ProjectManagerTool from './tools/ProjectManagerTool';
import EcommerceStoreManagerTool from './tools/EcommerceStoreManagerTool';
import EcommerceAppealLedgerTool from './tools/EcommerceAppealLedgerTool';
import EsimManagerTool from './tools/EsimManagerTool';
import SubscriptionManagerTool from './tools/SubscriptionManagerTool';
import SubscriptionEditorTool from './tools/SubscriptionEditorTool';
import RssReaderTool from './tools/RssReaderTool';
import ResumeGeneratorTool from './tools/ResumeGeneratorTool';
import WebsiteBookmarksTool from './tools/WebsiteBookmarksTool';
import FileRenameTool from './tools/FileRenameTool';
import AutoClickerTool from './tools/AutoClickerTool';
import HostsEditorTool from './tools/HostsEditorTool';
import ShutdownSchedulerTool from './tools/ShutdownSchedulerTool';
import StartupManagerTool from './tools/StartupManagerTool';
import FileUnlockTool from './tools/FileUnlockTool';
import ForceDeleteTool from './tools/ForceDeleteTool';
import LargeFilesTool from './tools/LargeFilesTool';
import JunkCleanerTool from './tools/JunkCleanerTool';
import DnsSwitchTool from './tools/DnsSwitchTool';
import NetworkRepairTool from './tools/NetworkRepairTool';
import EnvironmentVariablesTool from './tools/EnvironmentVariablesTool';
import ContextMenuManagerTool from './tools/ContextMenuManagerTool';
import ServicesManagerTool from './tools/ServicesManagerTool';
import ScheduledTasksTool from './tools/ScheduledTasksTool';
import InstalledAppsTool from './tools/InstalledAppsTool';
import SystemInfoTool from './tools/SystemInfoTool';
import WindowsUpdateTool from './tools/WindowsUpdateTool';
import WslDashboardTool from './tools/WslDashboardTool';
import DriverManagerTool from './tools/DriverManagerTool';
import PrinterManagerTool from './tools/PrinterManagerTool';
import SystemMonitorTool from './tools/SystemMonitorTool';
import DateCalculatorTool from './tools/DateCalculatorTool';
import ColorAssistantTool from './tools/ColorAssistantTool';
import PromptLibraryTool from './tools/PromptLibraryTool';
import SkillsLibraryTool from './tools/SkillsLibraryTool';
import McpLibraryTool from './tools/McpLibraryTool';
import KiroAccountManagerTool from './tools/KiroAccountManagerTool';
import ScreenshotRegion from './tools/ScreenshotRegion';
import ScreenshotResultWindow from './tools/ScreenshotResultWindow';
import { appWindow } from '@tauri-apps/api/window';

const MindMapTool = lazy(() => import('./tools/MindMapTool'));
const FlowchartTool = lazy(() => import('./tools/FlowchartTool'));
const WhiteboardTool = lazy(() => import('./tools/WhiteboardTool'));

function applyTheme(theme: string) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}

function App() {
  const { theme } = useSettingsStore();
  const [windowLabel, setWindowLabel] = useState<string>(() => appWindow.label || '');

  useEffect(() => {
    console.log('[App] Setting window label:', appWindow.label);
    setWindowLabel(appWindow.label);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // quicklauncher 窗口：监听 settings 加载完成后重新应用主题
  useEffect(() => {
    if (windowLabel !== 'quicklauncher') return;
    // loadSettings 完成后 theme 会更新，这里确保立即应用
    applyTheme(theme);
  }, [theme, windowLabel]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const currentTheme = useSettingsStore.getState().theme;
      if (currentTheme === 'system') {
        applyTheme('system');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // quicklauncher 窗口只渲染搜索面板
  if (windowLabel === 'quicklauncher') {
    return <QuickLauncherWindow />;
  }

  // clipboard 窗口渲染剪贴板历史
  if (windowLabel === 'clipboard') {
    return <ClipboardWindow />;
  }

  if (windowLabel.startsWith('desktop-box-')) {
    return <DesktopBoxWindow />;
  }

  if (windowLabel === 'toolbox') {
    return <ToolboxWindow />;
  }

  if (windowLabel === 'tool-date-calculator') {
    return <DateCalculatorTool />;
  }

  if (windowLabel === 'tool-todo') {
    return <TodoTool />;
  }

  if (windowLabel === 'tool-project-manager') {
    return <ProjectManagerTool />;
  }

  if (windowLabel === 'tool-ecommerce-store-manager') {
    return <EcommerceStoreManagerTool />;
  }

  if (windowLabel === 'tool-ecommerce-appeal-ledger') {
    return <EcommerceAppealLedgerTool />;
  }

  if (windowLabel === 'tool-esim-manager') {
    return <EsimManagerTool />;
  }

  if (windowLabel === 'tool-subscription-manager') {
    return <SubscriptionManagerTool />;
  }

  if (windowLabel === 'tool-subscription-editor') {
    return <SubscriptionEditorTool />;
  }

  if (windowLabel === 'tool-rss-reader') {
    return <RssReaderTool />;
  }

  if (windowLabel === 'tool-resume-generator') {
    return <ResumeGeneratorTool />;
  }

  if (windowLabel === 'tool-website-bookmarks') {
    return <WebsiteBookmarksTool />;
  }

  if (windowLabel === 'tool-file-rename') {
    return <FileRenameTool />;
  }

  if (windowLabel === 'tool-auto-clicker') {
    return <AutoClickerTool />;
  }

  if (windowLabel === 'tool-password-manager') {
    return <PasswordManagerTool />;
  }

  if (windowLabel === 'tool-archive-manager') {
    return <ArchiveManagerTool />;
  }

  if (windowLabel === 'tool-hosts-editor') {
    return <HostsEditorTool />;
  }

  if (windowLabel === 'tool-shutdown-scheduler') {
    return <ShutdownSchedulerTool />;
  }

  if (windowLabel === 'tool-startup-manager') {
    return <StartupManagerTool />;
  }

  if (windowLabel === 'tool-file-unlocker') {
    return <FileUnlockTool />;
  }

  if (windowLabel === 'tool-force-delete') {
    return <ForceDeleteTool />;
  }

  if (windowLabel === 'tool-large-files') {
    return <LargeFilesTool />;
  }

  if (windowLabel === 'tool-junk-cleaner') {
    return <JunkCleanerTool />;
  }

  if (windowLabel === 'tool-dns-switch') {
    return <DnsSwitchTool />;
  }

  if (windowLabel === 'tool-network-repair') {
    return <NetworkRepairTool />;
  }

  if (windowLabel === 'tool-environment-variables') {
    return <EnvironmentVariablesTool />;
  }

  if (windowLabel === 'tool-context-menu-manager') {
    return <ContextMenuManagerTool />;
  }

  if (windowLabel === 'tool-services-manager') {
    return <ServicesManagerTool />;
  }

  if (windowLabel === 'tool-scheduled-tasks') {
    return <ScheduledTasksTool />;
  }

  if (windowLabel === 'tool-installed-apps') {
    return <InstalledAppsTool />;
  }

  if (windowLabel === 'tool-system-info') {
    return <SystemInfoTool />;
  }

  if (windowLabel === 'tool-windows-update') {
    return <WindowsUpdateTool />;
  }

  if (windowLabel === 'tool-wsl-dashboard') {
    return <WslDashboardTool />;
  }

  if (windowLabel === 'tool-driver-manager') {
    return <DriverManagerTool />;
  }

  if (windowLabel === 'tool-printer-manager') {
    return <PrinterManagerTool />;
  }

  if (windowLabel === 'tool-system-monitor') {
    return <SystemMonitorTool />;
  }

  if (windowLabel === 'tool-mind-map') {
    return (
      <Suspense fallback={null}>
        <MindMapTool />
      </Suspense>
    );
  }

  if (windowLabel === 'tool-flowchart') {
    return (
      <Suspense fallback={null}>
        <FlowchartTool />
      </Suspense>
    );
  }

  if (windowLabel === 'tool-whiteboard') {
    return (
      <Suspense fallback={null}>
        <WhiteboardTool />
      </Suspense>
    );
  }

  if (windowLabel === 'tool-calculator') {
    return <CalculatorTool />;
  }

  if (windowLabel === 'tool-pinyin') {
    return <PinyinTool />;
  }

  if (windowLabel === 'tool-text-prefix') {
    return <TextPrefixTool />;
  }

  if (windowLabel === 'tool-remove-linenum') {
    return <RemoveLineNumTool />;
  }

  if (windowLabel === 'tool-url-extractor') {
    return <UrlExtractorTool />;
  }

  if (windowLabel === 'tool-url-encode') {
    return <UrlEncodeTool />;
  }

  if (windowLabel === 'tool-url-parser') {
    return <UrlParserTool />;
  }

  if (windowLabel === 'tool-base64') {
    return <Base64Tool />;
  }

  if (windowLabel === 'tool-json') {
    return <JsonTool />;
  }

  if (windowLabel === 'tool-regex') {
    return <RegexTool />;
  }

  if (windowLabel === 'tool-random') {
    return <RandomGeneratorTool />;
  }

  if (windowLabel === 'tool-timestamp') {
    return <TimestampTool />;
  }

  if (windowLabel === 'tool-hash') {
    return <HashTool />;
  }

  if (windowLabel === 'tool-jwt') {
    return <JwtTool />;
  }

  if (windowLabel === 'tool-http-client') {
    return <HttpClientTool />;
  }

  if (windowLabel === 'tool-cron') {
    return <CronTool />;
  }

  if (windowLabel === 'tool-sql') {
    return <SqlTool />;
  }

  if (windowLabel === 'tool-code-formatter') {
    return <CodeFormatterTool />;
  }

  if (windowLabel === 'tool-github-store') {
    return <GitHubStoreTool />;
  }

  if (windowLabel === 'tool-web-check') {
    return <WebCheckTool />;
  }

  if (windowLabel === 'tool-database-manager') {
    return <DatabaseManagerTool />;
  }

  if (windowLabel === 'tool-image-compress') {
    return <ImageCompressTool />;
  }

  if (windowLabel === 'tool-image-batch-process') {
    return <ImageBatchProcessTool />;
  }

  if (windowLabel === 'tool-image-crop') {
    return <ImageCropTool />;
  }

  if (windowLabel === 'tool-image-resize') {
    return <ImageResizeTool />;
  }

  if (windowLabel === 'tool-image-transform') {
    return <ImageTransformTool />;
  }

  if (windowLabel === 'tool-image-filter') {
    return <ImageFilterTool />;
  }

  if (windowLabel === 'tool-image-watermark') {
    return <ImageWatermarkTool />;
  }

  if (windowLabel === 'tool-image-exif') {
    return <ImageExifTool />;
  }

  if (windowLabel === 'tool-image-convert') {
    return <ImageConvertTool />;
  }

  if (windowLabel === 'tool-image-ico-generator') {
    return <ImageIcoGeneratorTool />;
  }

  if (windowLabel === 'tool-image-bg-remove') {
    return <ImageBgRemoveTool />;
  }

  if (windowLabel === 'tool-image-ai-upscale') {
    return <ImageAiUpscaleTool />;
  }

  if (windowLabel === 'tool-image-watermark-remove') {
    return <ImageWatermarkRemoveTool />;
  }

  if (windowLabel === 'tool-image-magic-eraser') {
    return <ImageMagicEraserTool />;
  }

  if (windowLabel === 'tool-video-convert') {
    return <VideoConvertTool />;
  }

  if (windowLabel === 'tool-video-player') {
    return <VideoPlayerTool />;
  }

  if (windowLabel === 'tool-music-player') {
    return <MusicPlayerTool />;
  }

  if (windowLabel === 'tool-audio-convert') {
    return <AudioConvertTool />;
  }

  if (windowLabel === 'tool-video-compress') {
    return <VideoCompressTool />;
  }

  if (windowLabel === 'tool-audio-compress') {
    return <AudioCompressTool />;
  }

  if (windowLabel === 'tool-video-split') {
    return <VideoSplitTool />;
  }

  if (windowLabel === 'tool-video-watermark-remove') {
    return <VideoWatermarkRemoveTool />;
  }

  if (windowLabel === 'tool-local-speech-to-text') {
    return <LocalSpeechToTextTool />;
  }

  if (windowLabel === 'tool-local-text-to-speech') {
    return <LocalTextToSpeechTool />;
  }

  if (windowLabel === 'tool-local-speech-denoise') {
    return <LocalSpeechDenoiseTool />;
  }

  if (windowLabel === 'tool-local-vocal-separation') {
    return <LocalVocalSeparationTool />;
  }

  if (windowLabel === 'tool-download-manager') {
    return <DownloadManagerTool />;
  }

  if (windowLabel === 'tool-video-downloader') {
    return <VideoDownloaderTool />;
  }

  if (windowLabel === 'tool-tikhub-downloader') {
    return <TikHubDownloaderTool />;
  }

  if (windowLabel === 'tool-douyin-downloader') {
    return <DouyinDownloaderTool />;
  }

  if (windowLabel === 'tool-wx-channels-downloader') {
    return <WxChannelsDownloaderTool />;
  }

  if (windowLabel === 'tool-screen-recording') {
    return <ScreenRecordingTool />;
  }

  if (windowLabel === 'tool-gif-recorder') {
    return <GifRecorderTool />;
  }

  if (windowLabel === 'tool-pdf-merge') return <PdfMergeTool />;
  if (windowLabel === 'tool-pdf-split') return <PdfSplitTool />;
  if (windowLabel === 'tool-pdf-rotate') return <PdfRotateTool />;
  if (windowLabel === 'tool-pdf-encrypt') return <PdfEncryptTool />;
  if (windowLabel === 'tool-pdf-watermark') return <PdfWatermarkTool />;
  if (windowLabel === 'tool-pdf-compress') return <PdfCompressTool />;
  if (windowLabel === 'tool-pdf-to-image') return <PdfToImageTool />;
  if (windowLabel === 'tool-image-to-pdf') return <ImageToPdfTool />;
  if (windowLabel === 'tool-pdf-delete-pages') return <PdfDeletePagesTool />;
  if (windowLabel === 'tool-pdf-translate') return <PdfTranslateTool />;
  if (windowLabel === 'tool-pdf-word-ocr') return <PdfWordOcrTool />;
  if (windowLabel === 'tool-tencent-table-ocr') return <TencentTableOcrTool />;
  if (windowLabel === 'tool-tencent-bank-card-ocr') return <TencentBankCardOcrTool />;
  if (windowLabel === 'tool-tencent-general-invoice-ocr') return <TencentGeneralInvoiceOcrTool />;
  if (windowLabel === 'tool-excel-merge') return <ExcelMergeTool />;
  if (windowLabel === 'tool-excel-split') return <ExcelSplitTool />;
  if (windowLabel === 'tool-excel-diff') return <ExcelDiffTool />;
  if (windowLabel === 'tool-excel-convert') return <ExcelConvertTool />;
  if (windowLabel === 'tool-excel-remove-empty') return <ExcelRemoveEmptyTool />;
  if (windowLabel === 'tool-excel-preview') return <ExcelPreviewTool />;
  if (windowLabel === 'tool-excel-formula-to-value') return <ExcelFormulaToValueTool />;
  if (windowLabel === 'tool-excel-remove-duplicates') return <ExcelRemoveDuplicatesTool />;
  if (windowLabel === 'tool-md-word-convert') return <MdWordConvertTool />;
  if (windowLabel === 'tool-file-to-markdown') return <FileToMarkdownTool />;
  if (windowLabel === 'tool-md-ppt-convert') return <MdPptConvertTool />;
  if (windowLabel === 'tool-epub-generator') return <EpubGeneratorTool />;
  if (windowLabel === 'tool-draw-stamp') return <DrawStampTool />;
  if (windowLabel === 'tool-word-format') return <WordFormatTool />;
  if (windowLabel === 'tool-word-duplicate-check') return <WordDuplicateCheckTool />;
  if (windowLabel === 'tool-word-semantic-compare') return <WordSemanticCompareTool />;
  if (windowLabel === 'tool-word-semantic-search') return <WordSemanticSearchTool />;
  if (windowLabel === 'tool-software-copyright') return <SoftwareCopyrightTool />;

  if (windowLabel === 'tool-unit-converter') {
    return <UnitConverter />;
  }

  if (windowLabel === 'tool-qrcode') {
    return <QRCodeGenerator />;
  }

  if (windowLabel === 'tool-wechat-meme') {
    return <WechatMemeTool />;
  }

  if (windowLabel === 'tool-css') {
    return <CssTool />;
  }

  if (windowLabel === 'tool-speed-test') {
    return <SpeedTestTool />;
  }

  if (windowLabel === 'tool-ping') {
    return <PingTool />;
  }

  if (windowLabel === 'tool-dns-query') {
    return <DnsQueryTool />;
  }

  if (windowLabel === 'tool-ip-info') {
    return <IpInfoTool />;
  }

  if (windowLabel === 'tool-port-scan') {
    return <PortScanTool />;
  }

  if (windowLabel === 'tool-traceroute') {
    return <TracerouteTool />;
  }

  if (windowLabel === 'tool-line-processor') {
    return <LineProcessorTool />;
  }

  if (windowLabel === 'tool-text-formatter') {
    return <TextFormatterTool />;
  }

  if (windowLabel === 'tool-text-deduplicate') {
    return <TextDeduplicateTool />;
  }

  if (windowLabel === 'tool-case-converter') {
    return <CaseConverterTool />;
  }

  if (windowLabel === 'tool-chinese-converter') {
    return <ChineseConverterTool />;
  }

  if (windowLabel === 'tool-text-batch-replace') {
    return <TextBatchReplaceTool />;
  }

  if (windowLabel === 'tool-text-diff') {
    return <TextDiffTool />;
  }

  if (windowLabel === 'screenshot-ocr') {
    return <ScreenshotOcrCapture />;
  }

  if (windowLabel === 'screenshot-translate') {
    return <ScreenshotTranslateCapture />;
  }

  if (windowLabel === 'quick-translate') {
    return <QuickTranslateWindow />;
  }

  if (windowLabel === 'word-selection-translate') {
    return <WordSelectionTranslateWindow />;
  }

  if (windowLabel === 'tool-html-editor') {
    return <HtmlEditorTool />;
  }

  if (windowLabel === 'tool-md-editor') {
    return <MdEditorTool />;
  }

  if (windowLabel === 'tool-color-assistant') {
    return <ColorAssistantTool />;
  }

  if (windowLabel === 'tool-prompt-library') {
    return <PromptLibraryTool />;
  }

  if (windowLabel === 'tool-skills-library') {
    return <SkillsLibraryTool />;
  }

  if (windowLabel === 'tool-mcp-library') {
    return <McpLibraryTool />;
  }

  if (windowLabel === 'tool-kiro-account-manager') {
    return <KiroAccountManagerTool />;
  }

  if (windowLabel === 'tool-screenshot') {
    // 工具箱内的截图工具（保留，但用轻量版）
    return <ScreenshotRegion />;
  }

  if (windowLabel === 'screenshot-region') {
    return <ScreenshotRegion />;
  }

  if (windowLabel === 'screenshot-result') {
    return <ScreenshotResultWindow />;
  }

  if (windowLabel === 'screen-recording-region-picker') {
    return <ScreenRecordingRegionPicker />;
  }

  if (windowLabel === 'screen-recording-controller') {
    return <ScreenRecordingController />;
  }

  if (windowLabel === 'auto-clicker-point-picker') {
    return <AutoClickerPointPicker />;
  }

  // 主窗口渲染完整布局
  return <MainLayout />;
}

export default App;
