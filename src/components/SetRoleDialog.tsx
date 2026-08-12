import { useState } from 'react';
import { X, User } from 'lucide-react';
import { PRESET_ROLES } from '../constants/presetRoles';

interface SetRoleDialogProps {
  currentSystemPrompt: string;
  onClose: () => void;
  onSave: (systemPrompt: string) => void;
}

export default function SetRoleDialog({
  currentSystemPrompt,
  onClose,
  onSave,
}: SetRoleDialogProps) {
  const [systemPrompt, setSystemPrompt] = useState(currentSystemPrompt);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    if (isSaving) return;
    setIsSaving(true);
    onSave(systemPrompt);
  };

  const handleSelectPreset = (prompt: string) => {
    setSystemPrompt(prompt);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-green-500 to-teal-500 rounded-lg">
              <User className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">设置角色</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 预设角色 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              选择预设角色
            </label>
            <div className="grid grid-cols-3 gap-2">
              {PRESET_ROLES.map((role) => (
                <button
                  key={role.name}
                  onClick={() => handleSelectPreset(role.prompt)}
                  className={`p-3 text-left border rounded-lg transition-colors ${
                    systemPrompt === role.prompt
                      ? 'border-[#0066ff] bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  <div className="font-medium text-sm text-gray-900 dark:text-white mb-1">
                    {role.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{role.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 自定义角色 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              自定义角色设定
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="输入自定义的系统提示词，定义 AI 的角色和行为..."
              className="w-full h-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              💡 系统提示词会在每次对话开始时发送给
              AI，用于定义其角色和行为方式。留空则使用默认设置。
            </p>
          </div>

          {/* 提示信息 */}
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              ⚠️ 修改角色设定后，新的对话将使用新的角色。历史消息不受影响。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-[#0066ff] hover:bg-[#0052cc] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
