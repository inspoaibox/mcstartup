import { Loader, Check } from 'lucide-react';
import type { PdfPageInfo } from './usePdfPreview';

interface PdfPageGridProps {
  pages: PdfPageInfo[];
  loading: boolean;
  selected?: Set<number>;
  onToggle?: (index: number) => void;
  // 每页 hover 时显示的快捷操作按钮
  pageActions?: (page: PdfPageInfo) => {
    icon: React.ReactNode;
    label: string;
    onClick: (e: React.MouseEvent) => void;
    danger?: boolean;
  }[];
  renderBadge?: (page: PdfPageInfo) => React.ReactNode;
  accentColor?: string;
  showPageNum?: boolean;
  // 选中时的遮罩颜色
  selectedOverlay?: string;
}

export default function PdfPageGrid({
  pages,
  loading,
  selected,
  onToggle,
  pageActions,
  renderBadge,
  accentColor = 'border-red-500 ring-2 ring-red-400',
  showPageNum = true,
  selectedOverlay = 'bg-red-500/15',
}: PdfPageGridProps) {
  if (loading && pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
        <Loader size={24} className="animate-spin" />
        <span className="text-sm">正在渲染预览...</span>
      </div>
    );
  }

  return (
    <div className="relative">
      {loading && pages.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <Loader size={12} className="animate-spin" />
          <span>渲染中 {pages.length} 页...</span>
        </div>
      )}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}
      >
        {pages.map((page) => {
          const isSelected = selected?.has(page.index) ?? false;
          const actions = pageActions?.(page) ?? [];

          return (
            <div
              key={page.index}
              onClick={() => onToggle?.(page.index)}
              className={`relative flex flex-col rounded-lg border-2 overflow-hidden transition-all group
                ${onToggle ? 'cursor-pointer' : ''}
                ${
                  isSelected
                    ? accentColor + ' shadow-md'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 bg-white dark:bg-gray-800'
                }
              `}
            >
              {/* 缩略图 */}
              <div className="relative w-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <img
                  src={page.dataUrl}
                  alt={`第 ${page.pageNum} 页`}
                  className="w-full h-auto object-contain"
                  style={{ maxHeight: 150, display: 'block' }}
                  draggable={false}
                />

                {/* 选中遮罩 */}
                {isSelected && (
                  <div className={`absolute inset-0 ${selectedOverlay} pointer-events-none`} />
                )}

                {/* hover 时的操作按钮层 */}
                {actions.length > 0 && (
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto">
                    {actions.map((action, i) => (
                      <button
                        key={i}
                        onClick={(e) => {
                          // 不 stopPropagation，让事件冒泡到外层 div 触发 onToggle
                          // action.onClick 只用于需要独立处理的场景（如旋转角度切换）
                          action.onClick(e);
                        }}
                        title={action.label}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-lg
                          ${
                            action.danger
                              ? 'bg-red-500 hover:bg-red-600 text-white'
                              : 'bg-white hover:bg-gray-100 text-gray-700'
                          }`}
                      >
                        {action.icon}
                      </button>
                    ))}
                  </div>
                )}

                {/* 右上角徽章 */}
                {renderBadge && (
                  <div className="absolute top-1 right-1 pointer-events-none">
                    {renderBadge(page)}
                  </div>
                )}

                {/* 选中勾（左上角） */}
                {isSelected && (
                  <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center shadow pointer-events-none">
                    <Check size={11} strokeWidth={3} className="text-white" />
                  </div>
                )}
              </div>

              {/* 页码 */}
              {showPageNum && (
                <div
                  className={`text-[11px] font-medium text-center py-1 flex-shrink-0
                  ${isSelected ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20' : 'text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800'}
                `}
                >
                  第 {page.pageNum} 页
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
