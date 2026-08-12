import type { ReactNode } from 'react';

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

export function StatusMessage({ message, error }: { message?: string; error?: string }) {
  if (!message && !error) return null;
  return (
    <div
      className={`rounded-lg px-3 py-2 text-sm ${
        error
          ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
          : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
      }`}
    >
      {error || message}
    </div>
  );
}

export function ToolbarButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors disabled:opacity-50 ${
        danger
          ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20'
          : 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
      }`}
    >
      {children}
    </button>
  );
}

export function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center text-gray-400">
      {icon}
      <p className="mt-2 text-sm">{text}</p>
    </div>
  );
}
