import type { AppSettings, TranslateOpenaiCompatibleProvider } from '../types';

export type TranslateProvider =
  | 'baidu'
  | 'google'
  | 'bing'
  | 'tencent'
  | 'chatgpt'
  | 'openai-compatible'
  | 'deepseek'
  | 'gemini';

export const TRANSLATE_PROVIDER_ORDER: TranslateProvider[] = [
  'baidu',
  'google',
  'bing',
  'tencent',
  'chatgpt',
  'openai-compatible',
  'deepseek',
  'gemini',
];

export const TRANSLATE_PROVIDER_LABELS: Record<TranslateProvider, string> = {
  baidu: '百度翻译',
  google: 'Google',
  bing: '必应翻译',
  tencent: '腾讯翻译',
  chatgpt: 'ChatGPT',
  'openai-compatible': 'OpenAI 兼容 API',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
};

export function getActiveOpenaiCompatibleProvider(
  settings: Partial<AppSettings>
): TranslateOpenaiCompatibleProvider | null {
  const providers = settings.translateOpenaiCompatibleProviders || [];
  if (providers.length === 0) return null;
  const activeId = settings.translateOpenaiCompatibleProviderId || '';
  return providers.find((provider) => provider.id === activeId) || providers[0] || null;
}

export function translateProviderName(provider: string, settings?: Partial<AppSettings>) {
  if (provider === 'openai-compatible') {
    const active = settings ? getActiveOpenaiCompatibleProvider(settings) : null;
    return active?.name ? `OpenAI 兼容 · ${active.name}` : TRANSLATE_PROVIDER_LABELS[provider];
  }
  return TRANSLATE_PROVIDER_LABELS[provider as TranslateProvider] || provider || '默认服务商';
}

export function buildTranslateConfig(settings: Partial<AppSettings>) {
  const compatible = getActiveOpenaiCompatibleProvider(settings);
  return {
    baiduAppId: settings.translateBaiduAppId || '',
    baiduSecretKey: settings.translateBaiduSecretKey || '',
    googleApiKey: settings.translateGoogleApiKey || '',
    bingApiKey: settings.translateBingApiKey || '',
    tencentSecretId: settings.translateTencentSecretId || '',
    tencentSecretKey: settings.translateTencentSecretKey || '',
    tencentRegion: settings.translateTencentRegion || 'ap-guangzhou',
    openaiApiKey: settings.translateOpenaiApiKey || '',
    openaiModel: settings.translateOpenaiModel || 'gpt-4o',
    openaiBaseUrl: settings.translateOpenaiBaseUrl || '',
    openaiCompatibleName: compatible?.name || '',
    openaiCompatibleApiKey: compatible?.apiKey || '',
    openaiCompatibleModel: compatible?.model || '',
    openaiCompatibleBaseUrl: compatible?.baseUrl || '',
    deepseekApiKey: settings.translateDeepseekApiKey || '',
    deepseekModel: settings.translateDeepseekModel || 'deepseek-v4-flash',
    deepseekBaseUrl: settings.translateDeepseekBaseUrl || 'https://api.deepseek.com',
    geminiApiKey: settings.translateGeminiApiKey || '',
    geminiModel: settings.translateGeminiModel || 'gemini-pro',
  };
}

export function validateTranslateProvider(
  provider: TranslateProvider,
  settings: Partial<AppSettings>,
  suffix = ''
) {
  if (
    provider === 'baidu' &&
    (!settings.translateBaiduAppId || !settings.translateBaiduSecretKey)
  ) {
    return `请先在设置中配置百度翻译 App ID 和 Secret Key${suffix}`;
  }
  if (provider === 'google' && !settings.translateGoogleApiKey) {
    return `请先在设置中配置 Google 翻译 API Key${suffix}`;
  }
  if (provider === 'bing' && !settings.translateBingApiKey) {
    return `请先在设置中配置必应翻译 API Key${suffix}`;
  }
  if (
    provider === 'tencent' &&
    (!settings.translateTencentSecretId || !settings.translateTencentSecretKey)
  ) {
    return `请先在设置中配置腾讯翻译 Secret ID 和 Secret Key${suffix}`;
  }
  if (provider === 'chatgpt' && !settings.translateOpenaiApiKey) {
    return `请先在设置中配置 ChatGPT API Key${suffix}`;
  }
  if (provider === 'openai-compatible') {
    const compatible = getActiveOpenaiCompatibleProvider(settings);
    if (!compatible) return `请先在设置中添加 OpenAI 兼容 API 配置${suffix}`;
    if (!compatible.apiKey) return `请先填写 OpenAI 兼容 API 的 API Key${suffix}`;
    if (!compatible.model) return `请先填写 OpenAI 兼容 API 的模型名称${suffix}`;
    if (!compatible.baseUrl) return `请先填写 OpenAI 兼容 API 的 Base URL${suffix}`;
  }
  if (provider === 'deepseek' && !settings.translateDeepseekApiKey) {
    return `请先在设置中配置 DeepSeek API Key${suffix}`;
  }
  if (provider === 'gemini' && !settings.translateGeminiApiKey) {
    return `请先在设置中配置 Gemini API Key${suffix}`;
  }
  return null;
}
