import { useState } from 'react';
import { X, Sparkles, ChevronDown } from 'lucide-react';
import { PRESET_ROLES } from '../constants/presetRoles';

interface AIProvider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'google' | 'vertex' | 'azure' | 'custom' | 'sub2api';
  apiKey: string;
  baseUrl?: string;
  model: string;
  availableModels?: string[];
}

interface NewConversationDialogProps {
  providers: AIProvider[];
  onClose: () => void;
  onCreate: (
    providerId: string,
    model: string,
    params: {
      title: string;
      system_prompt: string;
      temperature: number;
      max_tokens: number;
      top_p: number;
      frequency_penalty: number;
      presence_penalty: number;
    }
  ) => void;
}

export default function NewConversationDialog({
  providers,
  onClose,
  onCreate,
}: NewConversationDialogProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<string>(providers[0]?.id || '');
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (providers.length > 0) {
      const firstProvider = providers[0];
      const models = firstProvider.availableModels || [];
      return models.length > 0 ? models[0] : firstProvider.model || '';
    }
    return '';
  });
  const [title, setTitle] = useState('');
  const [selectedRoleLabel, setSelectedRoleLabel] = useState('默认助手');
  const [systemPrompt, setSystemPrompt] = useState(PRESET_ROLES[0].prompt);
  const [isCreating, setIsCreating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // AI 参数状态
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [topP, setTopP] = useState(1.0);
  const [frequencyPenalty, setFrequencyPenalty] = useState(0.0);
  const [presencePenalty, setPresencePenalty] = useState(0.0);

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);

  const handleProviderChange = (providerId: string) => {
    setSelectedProviderId(providerId);
    const provider = providers.find((p) => p.id === providerId);
    if (provider) {
      const models = provider.availableModels || [];
      setSelectedModel(models.length > 0 ? models[0] : provider.model || '');
    }
  };

  const handleRoleSelect = (label: string, prompt: string) => {
    setSelectedRoleLabel(label);
    if (label !== '自定义') {
      setSystemPrompt(prompt);
    }
  };

  const handleCreate = () => {
    if (!selectedProviderId || !selectedModel || isCreating) {
      if (!selectedProviderId || !selectedModel) alert('请选择提供商和模型');
      return;
    }
    setIsCreating(true);
    onCreate(selectedProviderId, selectedModel, {
      title: title.trim() || '新对话',
      system_prompt: systemPrompt.trim() || '你是一个有帮助的AI助手。',
      temperature,
      max_tokens: maxTokens,
      top_p: topP,
      frequency_penalty: frequencyPenalty,
      presence_penalty: presencePenalty,
    });
  };

  const getProviderName = (type: string) => {
    const map: Record<string, string> = {
      openai: 'OpenAI',
      anthropic: 'Anthropic Claude',
      google: 'Google Gemini',
      vertex: 'Google Vertex AI',
      azure: 'Azure OpenAI',
      custom: '自定义服务',
      sub2api: 'Sub2API',
    };
    return map[type] || 'OpenAI';
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">新建对话</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar">
          {/* 对话名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              对话名称
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="留空则自动生成"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff] text-sm"
            />
          </div>

          {/* 选择提供商 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              AI 提供商 <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedProviderId}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff] text-sm"
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                模型 <span className="text-red-500">*</span>
              </label>
              {selectedProvider.availableModels && selectedProvider.availableModels.length > 0 ? (
                <>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff] text-sm"
                  >
                    {selectedProvider.availableModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    共 {selectedProvider.availableModels.length} 个可用模型
                  </p>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    placeholder="输入模型名称，如 gpt-4o"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff] text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    未获取模型列表，请手动输入
                  </p>
                </>
              )}
            </div>
          )}

          {/* 角色设定 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              角色设定
            </label>
            {/* 预设角色快选 */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PRESET_ROLES.map((role) => (
                <button
                  key={role.name}
                  type="button"
                  onClick={() => handleRoleSelect(role.name, role.prompt)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                    selectedRoleLabel === role.name
                      ? 'bg-[#0066ff] text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {role.name}
                </button>
              ))}
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => {
                setSystemPrompt(e.target.value);
                setSelectedRoleLabel('');
              }}
              placeholder="输入系统提示词，定义 AI 的角色和行为..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff] text-sm resize-none"
            />
          </div>

          {/* 高级参数 */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <span>高级参数设置</span>
              <ChevronDown
                size={16}
                className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              />
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4">
                {/* Temperature */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Temperature
                    </label>
                    <span className="text-sm text-gray-500 dark:text-gray-400">{temperature}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-[#0066ff]"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    控制输出随机性，越高越随机
                  </p>
                </div>

                {/* Max Tokens */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Max Tokens
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="32000"
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(parseInt(e.target.value) || 4096)}
                      className="w-20 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">最大生成 token 数量</p>
                </div>

                {/* Top P */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Top P
                    </label>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {topP.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={topP}
                    onChange={(e) => setTopP(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-[#0066ff]"
                  />
                </div>

                {/* Frequency Penalty */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Frequency Penalty
                    </label>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {frequencyPenalty.toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={frequencyPenalty}
                    onChange={(e) => setFrequencyPenalty(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-[#0066ff]"
                  />
                </div>

                {/* Presence Penalty */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Presence Penalty
                    </label>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {presencePenalty.toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={presencePenalty}
                    onChange={(e) => setPresencePenalty(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-[#0066ff]"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!selectedProviderId || !selectedModel || isCreating}
            className="px-4 py-2 text-sm bg-[#0066ff] hover:bg-[#0052cc] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isCreating ? '创建中...' : '创建对话'}
          </button>
        </div>
      </div>
    </div>
  );
}
