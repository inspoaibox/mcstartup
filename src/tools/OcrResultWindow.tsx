import { useState, useRef, useEffect } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import { Copy, Check, ChevronDown, X, Loader2, AlignLeft, QrCode } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { useToolTheme } from './useToolTheme';

type OcrProvider = 'baidu' | 'google' | 'tencent' | 'aliyun' | 'wechat' | 'paddle' | 'wps';
type RecognitionType = 'text' | 'table' | 'qrcode';

interface OcrResultWindowProps {
  text: string;
  loading?: boolean;
  imagePreview?: string;
  textBlocks?: OcrTextBlock[];
  onClose: () => void;
  onProviderChange?: (provider: OcrProvider) => void;
  onTextChange?: (newText: string) => void;
  onRecognitionTypeChange?: (type: RecognitionType) => void;
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

interface LayoutBlock extends OcrTextBlock {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerY: number;
}

const PROVIDER_NAMES: Record<OcrProvider, string> = {
  baidu: '百度 OCR',
  google: 'Google OCR',
  tencent: '腾讯 OCR',
  aliyun: '阿里云 OCR',
  wechat: '微信本机 OCR',
  paddle: 'PaddleOCR 本地',
  wps: 'WPS OCR 本地',
};

const PROVIDER_ICONS: Record<OcrProvider, string> = {
  baidu: '🔵',
  google: '🔴',
  tencent: '🟢',
  aliyun: '🟠',
  wechat: '⚫',
  paddle: '🟣',
  wps: 'W',
};

const PROVIDER_OPTIONS: OcrProvider[] = [
  'baidu',
  'google',
  'tencent',
  'aliyun',
  'wechat',
  'paddle',
  'wps',
];

function needsWordSeparator(left: string, right: string) {
  const last = left.trimEnd().slice(-1);
  const first = right.trimStart().slice(0, 1);
  return /[A-Za-z0-9]/.test(last) && /[A-Za-z0-9]/.test(first);
}

function normalizePlainTextLayout(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .filter(Boolean)
    .join('\n');
}

function median(values: number[]) {
  if (values.length === 0) return 10;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 10;
}

function formatTextBlocksByPosition(textBlocks: OcrTextBlock[]) {
  const blocks: LayoutBlock[] = textBlocks
    .filter((block) => block.text.trim() && block.location)
    .map((block) => {
      const left = Number(block.location.left) || 0;
      const top = Number(block.location.top) || 0;
      const width = Math.max(Number(block.location.width) || 0, 1);
      const height = Math.max(Number(block.location.height) || 0, 1);
      return {
        ...block,
        left,
        top,
        right: left + width,
        bottom: top + height,
        centerY: top + height / 2,
      };
    })
    .sort((a, b) => a.top - b.top || a.left - b.left);

  if (blocks.length === 0) return '';

  const rows: Array<{
    top: number;
    bottom: number;
    centerY: number;
    height: number;
    blocks: LayoutBlock[];
  }> = [];

  for (const block of blocks) {
    const row = rows.find((candidate) => {
      const overlap = Math.min(candidate.bottom, block.bottom) - Math.max(candidate.top, block.top);
      const overlapRatio = overlap / Math.max(1, Math.min(candidate.height, block.bottom - block.top));
      const centerDelta = Math.abs(candidate.centerY - block.centerY);
      return overlapRatio > 0.35 || centerDelta <= Math.max(candidate.height, block.bottom - block.top) * 0.65;
    });

    if (row) {
      row.blocks.push(block);
      row.top = Math.min(row.top, block.top);
      row.bottom = Math.max(row.bottom, block.bottom);
      row.height = Math.max(row.height, block.bottom - block.top);
      row.centerY = row.blocks.reduce((sum, item) => sum + item.centerY, 0) / row.blocks.length;
    } else {
      rows.push({
        top: block.top,
        bottom: block.bottom,
        centerY: block.centerY,
        height: block.bottom - block.top,
        blocks: [block],
      });
    }
  }

  const charWidth = Math.max(
    6,
    Math.min(
      18,
      median(
        blocks.map((block) => {
          const length = Math.max(Array.from(block.text.trim()).length, 1);
          return (block.right - block.left) / length;
        })
      )
    )
  );

  return rows
    .sort((a, b) => a.top - b.top)
    .map((row) => {
      let line = '';
      let previousRight: number | null = null;
      const rowBlocks = [...row.blocks].sort((a, b) => a.left - b.left);

      for (const block of rowBlocks) {
        const text = block.text.trim().replace(/[ \t]+/g, ' ');
        if (!text) continue;

        if (line && previousRight != null) {
          const gap = block.left - previousRight;
          if (gap > charWidth * 1.4) {
            const spaces = Math.max(1, Math.min(24, Math.round(gap / charWidth)));
            line += ' '.repeat(spaces);
          } else if (needsWordSeparator(line, text)) {
            line += ' ';
          }
        }

        line += text;
        previousRight = Math.max(previousRight ?? 0, block.right);
      }

      return line.trimEnd();
    })
    .filter(Boolean)
    .join('\n');
}

export default function OcrResultWindow({
  text,
  loading = false,
  imagePreview,
  textBlocks = [],
  onClose,
  onProviderChange,
  onTextChange,
  onRecognitionTypeChange,
}: OcrResultWindowProps) {
  const ready = useToolTheme();
  const settings = useSettingsStore();
  const [copied, setCopied] = useState(false);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [displayText, setDisplayText] = useState(text);
  const [layoutAligned, setLayoutAligned] = useState(false);
  const [alignApplied, setAlignApplied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const internalTextRef = useRef<string | null>(null);
  const alignTimerRef = useRef<number | null>(null);

  const currentProvider = (settings.ocrProvider || 'baidu') as OcrProvider;

  // 当 text 改变时更新 displayText
  useEffect(() => {
    setDisplayText(text);
    if (internalTextRef.current === text) {
      internalTextRef.current = null;
    } else {
      setLayoutAligned(false);
    }
  }, [text]);

  useEffect(() => {
    return () => {
      if (alignTimerRef.current != null) {
        window.clearTimeout(alignTimerRef.current);
      }
    };
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

  const handleCopy = async () => {
    if (!displayText) return;
    try {
      await writeText(displayText);
    } catch {
      await navigator.clipboard.writeText(displayText);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const commitTextChange = (newText: string) => {
    internalTextRef.current = newText;
    if (onTextChange) {
      onTextChange(newText);
    }
  };

  const flashAlignApplied = () => {
    setAlignApplied(true);
    if (alignTimerRef.current != null) {
      window.clearTimeout(alignTimerRef.current);
    }
    alignTimerRef.current = window.setTimeout(() => {
      setAlignApplied(false);
      alignTimerRef.current = null;
    }, 1200);
  };

  const handleSmartAlign = () => {
    if (!displayText) return;
    const positionText = textBlocks.length > 0 ? formatTextBlocksByPosition(textBlocks) : '';
    const newText = positionText || normalizePlainTextLayout(displayText) || displayText;
    setDisplayText(newText);
    setLayoutAligned(Boolean(positionText));
    commitTextChange(newText);
    flashAlignApplied();
  };

  const handleChineseFormat = () => {
    if (!displayText) return;
    // 中文排版：
    // 1. 删除空行
    // 2. 半角标点转全角（英文标点 → 中文标点）
    let formatted = displayText;

    // 删除空行
    formatted = formatted
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join('\n');

    // 半角转全角（英文标点转中文标点）
    formatted = formatted
      .replace(/,/g, '，')
      .replace(/\./g, '。')
      .replace(/!/g, '！')
      .replace(/\?/g, '？')
      .replace(/;/g, '；')
      .replace(/:/g, '：')
      .replace(/\(/g, '（')
      .replace(/\)/g, '）');

    setDisplayText(formatted);
    setLayoutAligned(false);
    commitTextChange(formatted);
  };

  const handleEnglishFormat = () => {
    if (!displayText) return;
    // 英文排版：
    // 1. 删除空行
    // 2. 全角标点转半角（中文标点 → 英文标点）
    let formatted = displayText;

    // 删除空行
    formatted = formatted
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join('\n');

    // 全角转半角（中文标点转英文标点）
    formatted = formatted
      .replace(/，/g, ',')
      .replace(/。/g, '.')
      .replace(/！/g, '!')
      .replace(/？/g, '?')
      .replace(/；/g, ';')
      .replace(/：/g, ':')
      .replace(/"/g, '"')
      .replace(/"/g, '"')
      .replace(/'/g, "'")
      .replace(/'/g, "'")
      .replace(/（/g, '(')
      .replace(/）/g, ')');

    setDisplayText(formatted);
    setLayoutAligned(false);
    commitTextChange(formatted);
  };

  const handleProviderSwitch = (provider: OcrProvider) => {
    settings.updateSettings({ ocrProvider: provider });
    setShowProviderMenu(false);
    if (onProviderChange) {
      onProviderChange(provider);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex w-full h-full bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
      {/* 左侧：图片预览 + 二维码识别按钮 */}
      {imagePreview && (
        <div className="w-48 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-2 flex flex-col gap-2">
          <div className="flex-1 flex items-center justify-center overflow-hidden rounded">
            <img
              src={imagePreview}
              alt="截图预览"
              className="max-w-full max-h-full object-contain"
            />
          </div>

          {/* 二维码识别按钮 */}
          <button
            onClick={() => {
              console.log('=== 二维码识别按钮被点击 ===');
              if (onRecognitionTypeChange) {
                console.log('调用 onRecognitionTypeChange(qrcode)');
                onRecognitionTypeChange('qrcode');
              } else {
                console.error('onRecognitionTypeChange 未定义！');
              }
            }}
            disabled={loading}
            className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              loading
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
            title="识别图片中的二维码"
          >
            <QrCode size={16} />
            <span>识别二维码</span>
          </button>
        </div>
      )}

      {/* 右侧：文本内容 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0"
          data-tauri-drag-region
        >
          <div className="flex items-center gap-2" data-tauri-drag-region>
            <span className="text-sm">🔍</span>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">OCR 识别</span>

            {/* Provider 切换菜单 */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowProviderMenu(!showProviderMenu)}
                disabled={loading}
                className="flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-0.5 rounded transition-colors"
              >
                <span>{PROVIDER_ICONS[currentProvider]}</span>
                <span className="text-gray-600 dark:text-gray-400">
                  {PROVIDER_NAMES[currentProvider]}
                </span>
                <ChevronDown size={10} className="text-gray-400" />
              </button>

              {/* 下拉菜单 */}
              {showProviderMenu && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                  {PROVIDER_OPTIONS.map((provider) => (
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
                      <span className="flex-1 text-left">{PROVIDER_NAMES[provider]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleChineseFormat}
              disabled={!displayText || loading}
              title="中文排版（转全角标点）"
              className={`p-1 rounded transition-colors ${
                displayText && !loading
                  ? 'text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                  : 'text-gray-300 cursor-not-allowed'
              }`}
            >
              <span className="text-xs font-medium">中</span>
            </button>
            <button
              onClick={handleEnglishFormat}
              disabled={!displayText || loading}
              title="英文排版（转半角标点）"
              className={`p-1 rounded transition-colors ${
                displayText && !loading
                  ? 'text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                  : 'text-gray-300 cursor-not-allowed'
              }`}
            >
              <span className="text-xs font-medium">En</span>
            </button>
            <button
              onClick={handleSmartAlign}
              disabled={!displayText || loading}
              title={textBlocks.length > 0 ? '按 OCR 坐标智能对齐' : '整理行空白'}
              className={`p-1 rounded transition-colors ${
                alignApplied || layoutAligned
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300'
                  : displayText && !loading
                  ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                  : 'text-gray-300 cursor-not-allowed'
              }`}
            >
              {alignApplied ? <Check size={12} /> : <AlignLeft size={12} />}
            </button>
            <button
              onClick={handleCopy}
              disabled={!displayText || loading}
              title="复制"
              className={`p-1 rounded transition-colors ${
                copied
                  ? 'bg-green-500 text-white'
                  : displayText && !loading
                    ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                    : 'text-gray-300 cursor-not-allowed'
              }`}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
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
        <div className="flex-1 p-3 overflow-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-2">
                <Loader2 size={24} className="animate-spin text-blue-500" />
                <span className="text-xs text-gray-400">识别中...</span>
              </div>
            </div>
          ) : displayText ? (
            <textarea
              value={displayText}
              onChange={(e) => {
                setDisplayText(e.target.value);
                setLayoutAligned(false);
                commitTextChange(e.target.value);
              }}
              className={`w-full h-full text-sm text-gray-800 dark:text-gray-200 bg-transparent border-none outline-none resize-none leading-relaxed p-0 overflow-auto ${
                layoutAligned ? 'font-mono' : ''
              }`}
              placeholder="识别结果将显示在这里..."
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
              <div className="text-2xl">🔍</div>
              <div className="text-xs text-gray-400">等待识别结果...</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
