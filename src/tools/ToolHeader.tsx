import { X } from 'lucide-react';
import { appWindow } from '@tauri-apps/api/window';

interface ToolHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  closeMode?: 'auto' | 'close' | 'hide';
}

const RESIDENT_WINDOW_LABELS = new Set([
  'quicklauncher',
  'clipboard',
  'screenshot-ocr',
  'screenshot-translate',
  'quick-translate',
  'word-selection-translate',
]);

export default function ToolHeader({
  icon,
  title,
  subtitle,
  actions,
  closeMode = 'auto',
}: ToolHeaderProps) {
  const handleClose = async () => {
    if (closeMode === 'hide' || (closeMode === 'auto' && RESIDENT_WINDOW_LABELS.has(appWindow.label))) {
      await appWindow.hide();
      return;
    }
    await appWindow.close();
  };

  return (
    <div
      className="relative flex-shrink-0 border-b border-blue-200/80 bg-gradient-to-r from-slate-100 via-blue-50 to-cyan-50 px-4 py-2.5 shadow-sm dark:border-blue-900/60 dark:from-gray-950 dark:via-slate-900 dark:to-blue-950"
      data-tauri-drag-region
    >
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-blue-500 via-cyan-400 to-indigo-500" />
      <div className="flex items-center justify-between" data-tauri-drag-region>
        <div className="flex items-center gap-2.5" data-tauri-drag-region>
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200/70 bg-white/85 text-lg shadow-sm dark:border-blue-900/70 dark:bg-slate-900/80"
            data-tauri-drag-region
          >
            {icon}
          </span>
          <div data-tauri-drag-region>
            <h1
              className="text-sm font-semibold text-slate-800 dark:text-gray-100"
              data-tauri-drag-region
            >
              {title}
            </h1>
            {subtitle && (
              <p className="text-[10px] text-slate-500 dark:text-gray-400" data-tauri-drag-region>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <button
            onClick={() => {
              void handleClose();
            }}
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-400 dark:hover:bg-red-900/20"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
