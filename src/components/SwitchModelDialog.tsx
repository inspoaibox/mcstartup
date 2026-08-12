import { useState, useEffect } from 'react';
import { X, Sparkles } from 'lucide-react';

interface AIProvider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'google' | 'vertex' | 'azure' | 'custom' | 'sub2api';
  apiKey: string;
  baseUrl?: string;
  model: string;
  availableModels?: string[];
}

interface SwitchModelDialogProps {
  providers: AIProvider[];
  currentProviderId: string;
  currentModel: string;
  onClose: () => void;
  onSwitch: (providerId: string, model: string) => void;
}

export default function SwitchModelDialog({
  providers,
  currentProviderId,
  currentModel,
  onClose,
  onSwitch,
}: SwitchModelDialogProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<string>(currentProviderId);
  const [selectedModel, setSelectedModel] = useState<string>(currentModel);
  const [isSwitching, setIsSwitching] = useState(false);

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);

  // 当用户切换提供商时，更新模型选择
  const handleProviderChange = (providerId: string) => {
    setSelectedProviderId(providerId);
    const provider = providers.find((p) => p.id === providerId);
    if (provider) {
      const models = provider.availableModels || [];
      const newModel = models.length > 0 ? models[0] : provider.model || '';
      setSelectedModel(newModel);
    }
  };

  // 初始化模型选择
  useEffect(() => {
    if (selectedProvider) {
      const models = selectedProvider.availableModels || [];
      if (models.length > 0 && !models.includes(selectedModel)) {
        setSelectedModel(models[0]);
      }
    }
  }, [selectedProvider, selectedModel]);

  const handleSwitch = () => {
    if (!selectedProviderId || !selectedModel || isSwitching) {
      if (!selectedProviderId || !selectedModel) {
        alert('请选择提供商和模型');
      }
      return;
    }
    setIsSwitching(true);
    onSwitch(selectedProviderId, selectedModel);
  };

  const getProviderName = (type: string) => {
    switch (type) {
      case 'openai':
        return 'OpenAI';
      case 'anthropic':
        return 'Anthropic Claude';
      case 'google':
        return 'Google Gemini';
      case 'azure':
        return 'Azure OpenAI';
      case 'custom':
        return '自定义服务';
      case 'sub2api':
        return 'Sub2API';
      default:
        return 'OpenAI';
    }
  };

  const isChanged = selectedProviderId !== currentProviderId || selectedModel !== currentModel;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">切换模型</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* 当前模型 */}
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-xs text-blue-700 dark:text-blue-300 mb-1">当前使用</p>
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              {providers.find((p) => p.id === currentProviderId)?.name} - {currentModel}
            </p>
          </div>

          {/* 选择提供商 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              选择 AI 提供商 *
            </label>
            <select
              value={selectedProviderId}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} ({getProviderName(provider.type)})
                </option>
              ))}
            </select>
          </div>

          {/* 选择模型 */}
          {selectedProvider && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                选择模型 *
              </label>
              {selectedProvider.availableModels && selectedProvider.availableModels.length > 0 ? (
                <>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
                  >
                    {selectedProvider.availableModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    共 {selectedProvider.availableModels.length} 个可用模型
                  </p>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    placeholder="输入模型名称"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
                  />
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    该提供商未获取模型列表，请手动输入模型名称
                  </p>
                </>
              )}
            </div>
          )}

          {/* 提示信息 */}
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              💡 切换模型后，新的对话将使用新模型。历史消息保持不变。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSwitch}
            disabled={!selectedProviderId || !selectedModel || isSwitching || !isChanged}
            className="px-4 py-2 bg-[#0066ff] hover:bg-[#0052cc] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isSwitching ? '切换中...' : isChanged ? '切换模型' : '未更改'}
          </button>
        </div>
      </div>
    </div>
  );
}
