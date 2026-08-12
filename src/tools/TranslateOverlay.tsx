import { useEffect, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

interface TextBlock {
  text: string;
  location: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

interface TranslateOverlayProps {
  imagePreview: string;
  textBlocks?: TextBlock[];
  translations?: string[];
  loading?: boolean;
  captureRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  onClose: () => void;
}

export default function TranslateOverlay({
  imagePreview,
  textBlocks,
  translations,
  loading = false,
  captureRect,
  onClose,
}: TranslateOverlayProps) {
  const settings = useSettingsStore();
  const [opacity, setOpacity] = useState(settings.translateOverlayOpacity || 0.9);
  const [fontSize, setFontSize] = useState(settings.translateOverlayFontSize || 16);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      // 调整透明度
      if (e.key === '+' || e.key === '=') {
        setOpacity((prev) => Math.min(1, prev + 0.1));
      }
      if (e.key === '-' || e.key === '_') {
        setOpacity((prev) => Math.max(0.1, prev - 0.1));
      }
      // 调整字体大小
      if (e.key === 'ArrowUp') {
        setFontSize((prev) => Math.min(48, prev + 2));
      }
      if (e.key === 'ArrowDown') {
        setFontSize((prev) => Math.max(10, prev - 2));
      }
      // 切换显示原文/译文
      if (e.key === 'Tab') {
        e.preventDefault();
        setShowOriginal((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="w-full h-full bg-gray-900 flex items-center justify-center p-4">
      {/* 截图容器 - 按原始大小显示 */}
      <div
        className="relative"
        style={{
          width: `${captureRect.width}px`,
          height: `${captureRect.height}px`,
        }}
      >
        {/* 显示截图 - 原始大小 */}
        <img
          src={imagePreview}
          alt="截图"
          className="w-full h-full"
          style={{ width: `${captureRect.width}px`, height: `${captureRect.height}px` }}
        />

        {/* 文本覆盖层 - 在截图上对应位置显示翻译 */}
        {!loading &&
          textBlocks &&
          translations &&
          textBlocks.length > 0 &&
          textBlocks.length === translations.length && (
            <div className="absolute inset-0">
              {textBlocks.map((block, index) => (
                <div
                  key={index}
                  className="absolute flex items-center justify-center p-1 transition-all"
                  style={{
                    // 直接使用像素坐标
                    left: `${block.location.left}px`,
                    top: `${block.location.top}px`,
                    width: `${block.location.width}px`,
                    height: `${block.location.height}px`,
                    backgroundColor: `rgba(255, 255, 255, ${opacity})`,
                    fontSize: `${fontSize}px`,
                    lineHeight: '1.2',
                  }}
                >
                  <div
                    className="text-center text-gray-900 overflow-hidden"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      wordBreak: 'break-word',
                    }}
                  >
                    {showOriginal ? block.text : translations[index]}
                  </div>
                </div>
              ))}
            </div>
          )}

        {/* 加载中显示 */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              <div className="text-gray-900">翻译中...</div>
            </div>
          </div>
        )}

        {/* 控制提示 - 固定在右下角 */}
        <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-3 py-2 rounded space-y-1">
          <div>ESC: 关闭</div>
          <div>+/-: 调整透明度 ({Math.round(opacity * 100)}%)</div>
          <div>↑/↓: 调整字体 ({fontSize}px)</div>
          <div>Tab: 切换原文/译文</div>
        </div>
      </div>
    </div>
  );
}
