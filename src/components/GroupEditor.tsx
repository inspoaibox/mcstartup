import { useState } from 'react';
import { useGroupsStore } from '../stores/groupsStore';
import { X } from 'lucide-react';

interface GroupEditorProps {
  onClose: () => void;
  groupId?: string;
}

const PRESET_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
];

export default function GroupEditor({ onClose, groupId }: GroupEditorProps) {
  const { addGroup, updateGroup, groups } = useGroupsStore();

  const existingGroup = groupId ? groups.find((g) => g.id === groupId) : null;

  const [formData, setFormData] = useState({
    name: existingGroup?.name || '',
    color: existingGroup?.color || PRESET_COLORS[0],
    order: existingGroup?.order || groups.length,
  });

  const [isComposing, setIsComposing] = useState(false);
  const [compositionValue, setCompositionValue] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isComposing) return;

    try {
      if (groupId && existingGroup) {
        await updateGroup(groupId, { ...existingGroup, ...formData, id: groupId });
      } else {
        await addGroup(formData);
      }
      onClose();
    } catch (error) {
      console.error('Failed to save group:', error);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!isComposing) {
      setFormData({ ...formData, name: value });
    }
    setCompositionValue(value);
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing(false);
    const value = (e.target as HTMLInputElement).value;
    setFormData({ ...formData, name: value });
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {groupId ? '编辑分组' : '新建分组'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                分组名称 *
              </label>
              <input
                type="text"
                required
                value={isComposing ? compositionValue : formData.name}
                onChange={handleNameChange}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="例如：开发工具、常用软件"
              />
            </div>

            {/* Color */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                颜色
              </label>
              <div className="grid grid-cols-8 gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setFormData({ ...formData, color })}
                    className={`w-8 h-8 rounded-lg transition-all ${
                      formData.color === color
                        ? 'ring-2 ring-offset-2 ring-primary-500 scale-110'
                        : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">自定义：</span>
                <input
                  type="color"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-12 h-8 rounded cursor-pointer"
                />
                <span className="text-sm font-mono text-gray-600 dark:text-gray-400">
                  {formData.color}
                </span>
              </div>
            </div>

            {/* Preview */}
            <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">预览：</p>
              <div className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-gray-800 rounded-lg">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: formData.color }} />
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {formData.name || '分组名称'}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              {groupId ? '更新' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
