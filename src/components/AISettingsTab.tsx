// AI Settings Tab Component
import { useState, useRef, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  RefreshCw,
  Loader2,
  Search,
  ChevronDown,
} from 'lucide-react';

interface AIProvider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'google' | 'vertex' | 'azure' | 'custom' | 'sub2api';
  apiKey: string;
  baseUrl?: string;
  connectionMode?: 'auto' | 'direct' | 'system' | 'custom';
  proxyUrl?: string;
  model: string;
  availableModels?: string[]; // 可用的模型列表
}

interface AISettingsTabProps {
  localSettings: any;
  setLocalSettings: (settings: any) => void;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}' && serialized !== 'null') {
        return serialized;
      }
    } catch {
      // ignore JSON stringify failure and fall back below
    }
  }
  return fallback;
}

// ── 默认模型选择器（带搜索过滤） ──────────────────────────────────
interface ModelOption {
  value: string; // "providerId::modelName"
  label: string; // "渠道名 → 模型名"
  provider: string;
  model: string;
}

function DefaultModelPicker({
  providers,
  value,
  onChange,
}: {
  providers: AIProvider[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 构建所有选项
  const allOptions = useMemo<ModelOption[]>(() => {
    const opts: ModelOption[] = [];
    for (const p of providers) {
      const models =
        p.availableModels && p.availableModels.length > 0
          ? p.availableModels
          : [p.model].filter(Boolean);
      for (const m of models) {
        opts.push({
          value: `${p.id}::${m}`,
          label: `${p.name} → ${m}`,
          provider: p.name,
          model: m,
        });
      }
    }
    return opts;
  }, [providers]);

  // 过滤
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter(
      (o) => o.model.toLowerCase().includes(q) || o.provider.toLowerCase().includes(q)
    );
  }, [allOptions, search]);

  // 当前选中的显示文本
  const selectedLabel = value
    ? (allOptions.find((o) => o.value === value)?.label ?? value)
    : '-- 请选择默认模型 --';

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 打开时聚焦搜索框
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  return (
    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
      <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-1">默认模型</h4>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        用于快捷搜索（Alt+空格 输入 @）等场景的默认 AI 模型
        {allOptions.length > 0 && (
          <span className="ml-1 text-gray-400">（共 {allOptions.length} 个模型）</span>
        )}
      </p>

      <div ref={containerRef} className="relative">
        {/* 触发按钮 */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0066ff] hover:border-[#0066ff]/60 transition-colors"
        >
          <span className={value ? 'text-gray-900 dark:text-white' : 'text-gray-400'}>
            {selectedLabel}
          </span>
          <ChevronDown
            size={14}
            className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {/* 下拉面板 */}
        {open && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl overflow-hidden">
            {/* 搜索框 */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
              <Search size={13} className="text-gray-400 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索模型名称或渠道..."
                className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600">
                  <X size={12} />
                </button>
              )}
              <span className="text-xs text-gray-400 flex-shrink-0">{filtered.length} 个</span>
            </div>

            {/* 选项列表 */}
            <div className="max-h-60 overflow-y-auto">
              {/* 清空选项 */}
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                  setSearch('');
                }}
                className="w-full px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                -- 不设置默认模型 --
              </button>

              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-gray-400">没有匹配的模型</div>
              ) : (
                (() => {
                  // 按渠道分组
                  const groups: Record<string, ModelOption[]> = {};
                  for (const opt of filtered) {
                    if (!groups[opt.provider]) groups[opt.provider] = [];
                    groups[opt.provider].push(opt);
                  }
                  return Object.entries(groups).map(([providerName, opts]) => (
                    <div key={providerName}>
                      <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                        {providerName} · {opts.length} 个
                      </div>
                      {opts.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            onChange(opt.value);
                            setOpen(false);
                            setSearch('');
                          }}
                          className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center justify-between ${
                            value === opt.value
                              ? 'bg-[#0066ff]/10 text-[#0066ff] dark:text-blue-400'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                        >
                          <span className="truncate">{opt.model}</span>
                          {value === opt.value && (
                            <Check size={13} className="flex-shrink-0 ml-2" />
                          )}
                        </button>
                      ))}
                    </div>
                  ));
                })()
              )}
            </div>
          </div>
        )}
      </div>

      {/* 已选提示 */}
      {value && (
        <p className="mt-2 text-xs text-green-600 dark:text-green-400">✓ 已设置：{selectedLabel}</p>
      )}
    </div>
  );
}

export default function AISettingsTab({ localSettings, setLocalSettings }: AISettingsTabProps) {
  const providers: AIProvider[] = localSettings.aiProviders || [];
  const activeProviderId = localSettings.activeAiProviderId || '';

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<Partial<AIProvider>>({});
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleAddProvider = () => {
    const newProvider: AIProvider = {
      id: Date.now().toString(),
      name: '新提供商',
      type: 'openai',
      apiKey: '',
      connectionMode: 'auto',
      model: 'gpt-4o',
    };
    setEditingId(newProvider.id);
    setEditingProvider(newProvider);
  };

  const handleSaveProvider = () => {
    if (!editingProvider.name || !editingProvider.apiKey) {
      alert('请填写提供商名称和 API Key');
      return;
    }

    const newProviders = [...providers];
    const existingIndex = newProviders.findIndex((p) => p.id === editingId);

    const providerToSave: AIProvider = {
      id: editingProvider.id || editingId || Date.now().toString(),
      name: editingProvider.name,
      type: editingProvider.type || 'openai',
      apiKey: editingProvider.apiKey,
      baseUrl: editingProvider.baseUrl,
      connectionMode: editingProvider.connectionMode || 'auto',
      proxyUrl:
        editingProvider.connectionMode === 'custom'
          ? editingProvider.proxyUrl?.trim() || undefined
          : undefined,
      model: editingProvider.model || 'gpt-4o',
      availableModels: editingProvider.availableModels,
    };

    if (existingIndex >= 0) {
      newProviders[existingIndex] = providerToSave;
    } else {
      newProviders.push(providerToSave);
    }

    setLocalSettings({
      ...localSettings,
      aiProviders: newProviders,
      activeAiProviderId: localSettings.activeAiProviderId || providerToSave.id,
    });

    setEditingId(null);
    setEditingProvider({});
    setFetchError(null);
  };

  const handleDeleteProvider = (id: string) => {
    const newProviders = providers.filter((p) => p.id !== id);
    const newSettings: any = {
      ...localSettings,
      aiProviders: newProviders,
    };

    if (localSettings.activeAiProviderId === id) {
      newSettings.activeAiProviderId = newProviders[0]?.id || '';
    }

    setLocalSettings(newSettings);
    setDeletingId(null);
  };

  const handleSetActive = (id: string) => {
    setLocalSettings({
      ...localSettings,
      activeAiProviderId: id,
    });
  };

  const getDefaultModel = (type: string) => {
    switch (type) {
      case 'openai':
        return 'gpt-4o';
      case 'anthropic':
        return 'claude-3-5-sonnet-20241022';
      case 'google':
        return 'gemini-2.0-flash-exp';
      case 'vertex':
        return 'gemini-2.5-flash-lite';
      case 'sub2api':
        return 'gpt-5.4';
      default:
        return 'gpt-4o';
    }
  };

  const getDefaultModels = (type: string): string[] => {
    switch (type) {
      case 'openai':
        return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
      case 'anthropic':
        return [
          'claude-3-5-sonnet-20241022',
          'claude-3-opus-20240229',
          'claude-3-sonnet-20240229',
          'claude-3-haiku-20240307',
        ];
      case 'google':
        return ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'];
      case 'vertex':
        return [
          // Gemini 3 系列（最新预览版）
          'gemini-3.1-pro',
          'gemini-3.1-flash-lite',
          'gemini-3.1-flash-image',
          'gemini-3-flash',
          'gemini-3-pro-image',
          // Gemini 2.5 系列（正式版）
          'gemini-2.5-pro',
          'gemini-2.5-flash',
          'gemini-2.5-flash-image',
          'gemini-2.5-flash-lite',
          // Gemini 2.0 系列
          'gemini-2.0-flash',
          'gemini-2.0-flash-lite',
          // Gemini 1.5 系列
          'gemini-1.5-pro',
          'gemini-1.5-flash',
          'gemini-1.5-flash-8b',
          // Gemini 1.0 系列
          'gemini-1.0-pro',
        ];
      case 'sub2api':
        return ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-4o', 'gpt-4o-mini'];
      default:
        return [];
    }
  };

  const fetchAvailableModels = async () => {
    if (!editingProvider.apiKey || !editingProvider.type) {
      alert('请先填写 API Key 和选择提供商类型');
      return;
    }

    setIsFetchingModels(true);
    setFetchError(null);

    // 通用 HTTP GET，通过 Rust 后端发请求绕过 CORS
    const httpGet = async (url: string, apiKey: string) => {
      const text = await invoke<string>('http_get', {
        url,
        headers: { Authorization: `Bearer ${apiKey}` },
        connectionMode: editingProvider.connectionMode || 'auto',
        proxyUrl: editingProvider.proxyUrl || null,
      });
      return JSON.parse(text);
    };

    // 规范化 Base URL：去除末尾的斜杠
    const normalizeBaseUrl = (url: string): string => {
      return url.replace(/\/+$/, '');
    };

    try {
      let models: string[] = [];

      if (editingProvider.type === 'openai') {
        const baseUrl = normalizeBaseUrl(editingProvider.baseUrl || 'https://api.openai.com/v1');
        const data = await httpGet(`${baseUrl}/models`, editingProvider.apiKey);
        models = data.data.map((m: any) => m.id).sort();
      } else if (editingProvider.type === 'anthropic') {
        models = getDefaultModels('anthropic');
      } else if (editingProvider.type === 'google') {
        const text = await invoke<string>('http_get', {
          url: `https://generativelanguage.googleapis.com/v1beta/models?key=${editingProvider.apiKey}`,
          headers: {},
          connectionMode: editingProvider.connectionMode || 'auto',
          proxyUrl: editingProvider.proxyUrl || null,
        });
        const data = JSON.parse(text);
        models = data.models
          .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: any) => m.name.replace('models/', ''))
          .sort();
        if (models.length === 0) models = getDefaultModels('google');
      } else if (editingProvider.type === 'vertex') {
        models = getDefaultModels('vertex');
      } else if (editingProvider.type === 'azure') {
        models = getDefaultModels('openai');
      } else if (editingProvider.type === 'custom' || editingProvider.type === 'sub2api') {
        const baseUrl = editingProvider.baseUrl || '';
        if (!baseUrl) throw new Error('请先填写 API Base URL');
        const normalizedUrl = normalizeBaseUrl(baseUrl);
        const data = await httpGet(`${normalizedUrl}/models`, editingProvider.apiKey);
        models = data.data.map((m: any) => m.id).sort();
      }

      setEditingProvider({
        ...editingProvider,
        availableModels: models,
        model: models.includes(editingProvider.model || '')
          ? editingProvider.model
          : models.length > 0
            ? models[0]
            : editingProvider.model,
      });
    } catch (error: any) {
      console.error('Failed to fetch models:', error);

      // 改进错误提示
      let errorMessage = getErrorMessage(error, '获取模型列表失败');

      // 添加调试信息：显示实际请求的 URL
        const debugInfo = `\n\n[调试信息]\n请求的 URL: ${
        editingProvider.type === 'openai'
          ? `${normalizeBaseUrl(editingProvider.baseUrl || 'https://api.openai.com/v1')}/models`
          : editingProvider.type === 'custom' || editingProvider.type === 'sub2api'
            ? `${normalizeBaseUrl(editingProvider.baseUrl || '')}/models`
            : '(使用默认模型列表)'
      }`;

      // 检测常见错误并提供友好提示
      if (errorMessage.includes('HTML 页面')) {
        errorMessage =
          '❌ API 返回了网页而不是数据\n\n这通常意味着您访问的是管理后台，而不是 API 端点。\n\n常见原因：\n1. URL 指向了 Web 管理界面\n2. API 端点路径不正确\n3. 缺少 /api 或 /v1 路径\n\n建议：\n• 检查服务商文档，确认正确的 API Base URL\n• 尝试添加 /api/v1 或 /v1 路径\n• 联系服务提供商获取正确的 API 端点\n\n示例：\n✓ https://api.example.com/v1\n✓ https://apis.example.com/api/v1\n✗ https://apis.example.com (管理后台)\n\n提示：如果该服务不支持获取模型列表，可以跳过此步骤，直接保存配置' +
          debugInfo;
      } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        errorMessage =
          '❌ 访问被拒绝（403 Forbidden）\n\n可能的原因：\n1. API Key 没有访问权限\n2. API Key 配额已用完\n3. 该服务限制了访问范围\n4. IP 地址被限制\n\n建议：\n• 检查 API Key 是否有效\n• 确认 Key 的权限范围\n• 查看服务商的配额使用情况\n• 联系服务提供商确认访问限制\n\n提示：\n• 某些中转服务可能不支持获取模型列表\n• 可以跳过此步骤，手动输入模型名称';
      } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        errorMessage =
          '❌ 认证失败（401 Unauthorized）\n\n请检查：\n• API Key 是否正确复制（没有多余空格）\n• API Key 格式是否正确\n• API Key 是否已过期或被撤销\n\n提示：\n• 重新生成一个新的 API Key\n• 确认 Key 前缀是否正确（如 sk-）';
      } else if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
        errorMessage =
          '❌ 找不到 API 端点（404 Not Found）\n\n请检查：\n• Base URL 是否正确\n• 该服务是否支持 /models 端点\n• URL 路径是否完整（如：/v1）\n\n提示：\n• 某些中转服务可能不支持获取模型列表\n• 可以跳过此步骤，手动输入模型名称';
      } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        errorMessage =
          '❌ 请求超时\n\n可能的原因：\n• 网络连接不稳定\n• 服务器响应缓慢\n• 需要代理访问\n\n建议：\n• 检查网络连接\n• 稍后重试\n• 配置网络代理';
      } else if (errorMessage.includes('connection') || errorMessage.includes('network')) {
        errorMessage =
          '❌ 网络连接失败\n\n请检查：\n• 网络连接是否正常\n• 服务器地址是否可访问\n• 是否需要配置代理\n\n提示：\n• 尝试在浏览器中访问该地址\n• 检查防火墙设置';
      }

      setFetchError(errorMessage);
      setEditingProvider({
        ...editingProvider,
        availableModels: undefined,
      });
    } finally {
      setIsFetchingModels(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">AI 提供商配置</h3>
          <button
            onClick={handleAddProvider}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#0066ff] hover:bg-[#0052cc] text-white rounded-lg transition-colors"
          >
            <Plus size={16} />
            添加提供商
          </button>
        </div>

        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            你可以添加多个 AI 提供商配置，在新建对话时选择不同的模型。
          </p>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1.5">
            支持 OpenAI、Anthropic Claude、Google Gemini、Azure OpenAI 等。
          </p>
        </div>

        {/* 提供商列表 */}
        <div className="space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className={`p-4 border-2 rounded-lg transition-all ${
                activeProviderId === provider.id
                  ? 'border-[#0066ff] bg-blue-50 dark:bg-blue-900/10'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-gray-900 dark:text-white">{provider.name}</h4>
                    {activeProviderId === provider.id && (
                      <span className="px-2 py-0.5 text-xs bg-[#0066ff] text-white rounded">
                        使用中
                      </span>
                    )}
                  </div>
                  <div className="mt-1 space-y-0.5 text-sm text-gray-600 dark:text-gray-400">
                    <p>
                      类型：
                      {provider.type === 'openai' && 'OpenAI'}
                      {provider.type === 'anthropic' && 'Anthropic Claude'}
                      {provider.type === 'google' && 'Google Gemini'}
                      {provider.type === 'vertex' && 'Google Vertex AI'}
                      {provider.type === 'azure' && 'Azure OpenAI'}
                      {provider.type === 'custom' && '自定义服务'}
                      {provider.type === 'sub2api' && 'Sub2API'}
                    </p>
                    <p>模型：{provider.model || '未设置（新建对话时选择）'}</p>
                    {provider.availableModels && provider.availableModels.length > 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-500">
                        可用模型：{provider.availableModels.length} 个
                      </p>
                    )}
                    <p>API Key：{provider.apiKey ? '已配置 ✓' : '未配置'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {activeProviderId !== provider.id && (
                    <button
                      onClick={() => handleSetActive(provider.id)}
                      className="p-1.5 text-gray-600 hover:text-[#0066ff] dark:text-gray-400 dark:hover:text-[#0066ff] transition-colors"
                      title="设为默认"
                    >
                      <Check size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setEditingId(provider.id);
                      setEditingProvider({
                        ...provider,
                        // 确保 availableModels 被正确加载
                        availableModels: provider.availableModels || undefined,
                      });
                    }}
                    className="p-1.5 text-gray-600 hover:text-[#0066ff] dark:text-gray-400 dark:hover:text-[#0066ff] transition-colors"
                    title="编辑"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => setDeletingId(provider.id)}
                    className="p-1.5 text-gray-600 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors"
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {providers.length === 0 && !editingId && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <p className="text-sm">还没有配置任何 AI 提供商</p>
              <p className="text-xs mt-1">点击上方"添加提供商"按钮开始配置</p>
            </div>
          )}
        </div>

        {/* 默认模型选择（供快捷搜索等场景使用） */}
        {providers.length > 0 && (
          <DefaultModelPicker
            providers={providers}
            value={localSettings.defaultAiModel || ''}
            onChange={(v) => setLocalSettings({ ...localSettings, defaultAiModel: v })}
          />
        )}

        {/* 编辑/新增表单 */}
        {editingId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {providers.find((p) => p.id === editingId) ? '编辑提供商' : '添加提供商'}
                </h3>
                <button
                  onClick={() => {
                    setEditingId(null);
                    setEditingProvider({});
                    setFetchError(null);
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    配置名称 *
                  </label>
                  <input
                    type="text"
                    value={editingProvider.name || ''}
                    onChange={(e) =>
                      setEditingProvider({ ...editingProvider, name: e.target.value })
                    }
                    placeholder="例如：我的 OpenAI"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    提供商类型 *
                  </label>
                  <select
                    value={editingProvider.type || 'openai'}
                    onChange={(e) => {
                      const newType = e.target.value as any;
                        setEditingProvider({
                          ...editingProvider,
                          type: newType,
                          model: getDefaultModel(newType),
                          connectionMode: editingProvider.connectionMode || 'auto',
                        });
                      }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic Claude</option>
                    <option value="google">Google Gemini</option>
                    <option value="vertex">Google Vertex AI</option>
                    <option value="azure">Azure OpenAI</option>
                    <option value="custom">自定义服务</option>
                    <option value="sub2api">Sub2API</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    API Key *
                  </label>
                  <input
                    type="password"
                    value={editingProvider.apiKey || ''}
                    onChange={(e) =>
                      setEditingProvider({ ...editingProvider, apiKey: e.target.value })
                    }
                    placeholder={
                      editingProvider.type === 'anthropic'
                        ? 'sk-ant-...'
                        : editingProvider.type === 'google'
                          ? 'AIza...'
                          : 'sk-...'
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff] font-mono text-sm"
                  />
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {editingProvider.type === 'openai' && (
                      <>
                        在{' '}
                        <a
                          href="https://platform.openai.com/api-keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#0066ff] hover:underline"
                        >
                          platform.openai.com
                        </a>{' '}
                        获取
                      </>
                    )}
                    {editingProvider.type === 'anthropic' && (
                      <>
                        在{' '}
                        <a
                          href="https://console.anthropic.com/settings/keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#0066ff] hover:underline"
                        >
                          console.anthropic.com
                        </a>{' '}
                        获取
                      </>
                    )}
                    {editingProvider.type === 'google' && (
                      <>
                        在{' '}
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#0066ff] hover:underline"
                        >
                          aistudio.google.com
                        </a>{' '}
                        获取
                      </>
                    )}
                    {editingProvider.type === 'vertex' && (
                      <>
                        在{' '}
                        <a
                          href="https://console.cloud.google.com/vertex-ai"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#0066ff] hover:underline"
                        >
                          Google Cloud Console
                        </a>{' '}
                        获取
                      </>
                    )}
                    {editingProvider.type === 'sub2api' && (
                      <>填写你的 Sub2API 分发给你的 API Key</>
                    )}
                  </p>
                </div>

                  {(editingProvider.type === 'azure' ||
                    editingProvider.type === 'custom' ||
                    editingProvider.type === 'sub2api') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      {editingProvider.type === 'azure' ? 'Azure Endpoint' : 'API Base URL'}
                    </label>
                    <input
                      type="text"
                      value={editingProvider.baseUrl || ''}
                      onChange={(e) =>
                        setEditingProvider({ ...editingProvider, baseUrl: e.target.value })
                      }
                      placeholder={
                        editingProvider.type === 'azure'
                          ? 'https://your-resource.openai.azure.com'
                          : editingProvider.type === 'sub2api'
                            ? 'https://your-sub2api-domain/v1'
                            : 'https://api.example.com/v1'
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff] font-mono text-sm"
                    />
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                      ⚠️ 请确保 URL 末尾<strong>没有斜杠</strong>（例如：
                      <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                        /v1
                      </code>{' '}
                      而不是{' '}
                      <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">/v1/</code>
                      ）
                    </p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      {editingProvider.type === 'azure' ? '部署名称' : '获取可用模型'}
                    </label>
                    {editingProvider.type !== 'azure' && (
                      <button
                        type="button"
                        onClick={fetchAvailableModels}
                        disabled={isFetchingModels || !editingProvider.apiKey}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-[#0066ff] hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isFetchingModels ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            获取中...
                          </>
                        ) : (
                          <>
                            <RefreshCw size={12} />
                            获取所有模型
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    点击"获取所有模型"按钮自动获取该提供商的所有可用模型；如果服务不支持模型列表，也可以直接手动填写模型名称
                    {editingProvider.type === 'sub2api' &&
                      '。Sub2API 一般应填写到 /v1，例如 https://your-domain/v1'}
                  </p>

                  {editingProvider.type !== 'azure' && (
                    <div className="mb-3">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        当前模型
                      </label>
                      {editingProvider.availableModels &&
                      editingProvider.availableModels.length > 0 ? (
                        <>
                          <select
                            value={editingProvider.model || ''}
                            onChange={(e) =>
                              setEditingProvider({ ...editingProvider, model: e.target.value })
                            }
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
                          >
                            {editingProvider.availableModels.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                            已获取模型列表，可以直接选择默认使用的模型
                          </p>
                        </>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={editingProvider.model || ''}
                            onChange={(e) =>
                              setEditingProvider({ ...editingProvider, model: e.target.value })
                            }
                            placeholder={
                              editingProvider.type === 'anthropic'
                                ? '例如：claude-3-5-sonnet'
                                : editingProvider.type === 'google'
                                  ? '例如：gemini-2.0-flash'
                                  : editingProvider.type === 'sub2api'
                                    ? '例如：gpt-5.4'
                                  : '例如：gpt-4o-mini'
                            }
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
                          />
                          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                            如果服务不支持获取模型列表，直接手动填写模型名称即可
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      连接模式
                    </label>
                    <select
                      value={editingProvider.connectionMode || 'auto'}
                      onChange={(e) => {
                        const mode = e.target.value as AIProvider['connectionMode'];
                        setEditingProvider({
                          ...editingProvider,
                          connectionMode: mode,
                          proxyUrl: mode === 'custom' ? editingProvider.proxyUrl || '' : undefined,
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
                    >
                      <option value="auto">自动（推荐）</option>
                      <option value="direct">直连</option>
                      <option value="system">系统代理</option>
                      <option value="custom">自定义代理</option>
                    </select>
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                      自动模式会先尝试直连，失败后再回退到系统代理。
                    </p>
                  </div>

                  {(editingProvider.connectionMode || 'auto') === 'custom' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        代理地址
                      </label>
                      <input
                        type="text"
                        value={editingProvider.proxyUrl || ''}
                        onChange={(e) =>
                          setEditingProvider({ ...editingProvider, proxyUrl: e.target.value })
                        }
                        placeholder="例如：http://127.0.0.1:7890 或 socks5://127.0.0.1:7890"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff] font-mono text-sm"
                      />
                      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                        仅当前提供商使用此代理，不影响其他 AI 渠道。
                      </p>
                    </div>
                  )}

                  {fetchError && (
                    <div className="mb-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <div className="flex items-start gap-2">
                        <span className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5">
                          ⚠️
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-1">
                            获取模型列表失败
                          </p>
                          <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap font-sans">
                            {fetchError}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 如果有可用模型列表，显示模型数量 */}
                  {editingProvider.availableModels &&
                    editingProvider.availableModels.length > 0 && (
                      <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                        <p className="text-sm text-green-700 dark:text-green-300">
                          ✓ 已获取 {editingProvider.availableModels.length} 个可用模型
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                          在新建对话时可以从这些模型中选择
                        </p>
                      </div>
                    )}

                  {/* Azure 需要输入部署名称 */}
                  {editingProvider.type === 'azure' && (
                    <input
                      type="text"
                      value={editingProvider.model || ''}
                      onChange={(e) =>
                        setEditingProvider({ ...editingProvider, model: e.target.value })
                      }
                      placeholder="your-deployment-name"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066ff]"
                    />
                  )}
                </div>
              </div>

              <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setEditingId(null);
                    setEditingProvider({});
                    setFetchError(null);
                  }}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveProvider}
                  className="px-4 py-2 bg-[#0066ff] hover:bg-[#0052cc] text-white rounded-lg transition-colors"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 删除确认对话框 */}
      {deletingId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">确认删除</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                确定要删除提供商配置 "{providers.find((p) => p.id === deletingId)?.name}" 吗？
                <br />
                <span className="text-sm text-red-600 dark:text-red-400 mt-2 block">
                  此操作无法撤销！
                </span>
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeletingId(null)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => handleDeleteProvider(deletingId)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
