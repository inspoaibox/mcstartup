import { useEffect, useState, useMemo, useRef, createContext, useContext } from 'react';
import {
  useLocalRuntime,
  AssistantRuntimeProvider,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ActionBarPrimitive,
  ActionBarMorePrimitive,
  AttachmentPrimitive,
  BranchPickerPrimitive,
  SelectionToolbarPrimitive,
  ErrorPrimitive,
  AuiIf,
  useMessagePartText,
  ExportedMessageRepository,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import ChartBlock from './ChartBlock';
import type { ChatModelAdapter } from '@assistant-ui/react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  Settings,
  Brain,
  SendHorizonal,
  Square,
  Sparkles,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RotateCw,
  AtSign,
  User,
  X,
  Paperclip,
  FileText,
  ChevronLeft,
  ChevronRight,
  Pencil,
  MoreHorizontal,
  Quote,
  ArrowDown,
  Palette,
  Code,
  Trash2,
  Eye,
} from 'lucide-react';

import { useSettingsStore } from '../stores/settingsStore';
import { useMcpStore } from '../stores/mcpStore';
import * as aiChatApi from '../api/aiChatApi';
import { ask } from '@tauri-apps/api/dialog';
import { mcpApi } from '../api/mcpApi';
import type { McpToolDef } from '../types/mcp';
import type { ReadonlyJSONObject } from 'assistant-stream/utils';
import type { ChatThread } from '../types/aiChat';
import type { AppSettings } from '../types';
import SwitchModelDialog from './SwitchModelDialog';
import SetRoleDialog from './SetRoleDialog';
import MemoryPanel from './MemoryPanel';
import ToolCard from './ToolCard';

// ── 用户头像系统 ──────────────────────────────────────────────────────
const USER_AVATARS = [
  { emoji: '🐱', bg: 'from-orange-400 to-pink-500' },
  { emoji: '🐶', bg: 'from-yellow-400 to-orange-500' },
  { emoji: '🦊', bg: 'from-orange-500 to-red-500' },
  { emoji: '🐼', bg: 'from-gray-400 to-gray-600' },
  { emoji: '🐨', bg: 'from-blue-400 to-cyan-500' },
  { emoji: '🦁', bg: 'from-yellow-500 to-amber-600' },
  { emoji: '🐯', bg: 'from-orange-400 to-yellow-500' },
  { emoji: '🐸', bg: 'from-green-400 to-emerald-600' },
  { emoji: '🐧', bg: 'from-blue-500 to-indigo-600' },
  { emoji: '🦋', bg: 'from-purple-400 to-pink-500' },
  { emoji: '🦄', bg: 'from-pink-400 to-purple-500' },
  { emoji: '🐉', bg: 'from-emerald-500 to-teal-600' },
];

const AVATAR_STORAGE_KEY = 'ai_chat_user_avatars';

function getOrCreateAvatar(threadId: string): (typeof USER_AVATARS)[0] {
  try {
    const stored = JSON.parse(localStorage.getItem(AVATAR_STORAGE_KEY) || '{}');
    if (stored[threadId]) {
      return USER_AVATARS.find((a) => a.emoji === stored[threadId]) || USER_AVATARS[0];
    }
    const avatar = USER_AVATARS[Math.floor(Math.random() * USER_AVATARS.length)];
    stored[threadId] = avatar.emoji;
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(stored));
    return avatar;
  } catch {
    return USER_AVATARS[0];
  }
}

const UserAvatarContext = createContext<(typeof USER_AVATARS)[0]>(USER_AVATARS[0]);

interface ChatInterfaceProps {
  threadId: string;
  onTitleGenerated?: (title: string) => void;
  userId?: string;
  enableMemory?: boolean;
  onThreadUpdated?: () => void;
  onMessageDeleted?: () => void;
  rightPanel?: React.ReactNode;
}

export default function ChatInterface({
  threadId,
  onTitleGenerated,
  userId = 'default-user',
  enableMemory = true,
  onThreadUpdated,
  onMessageDeleted,
  rightPanel,
}: ChatInterfaceProps) {
  const { aiProviders } = useSettingsStore();
  const [isLoading, setIsLoading] = useState(true);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [showSwitchModel, setShowSwitchModel] = useState(false);
  const [showSetRole, setShowSetRole] = useState(false);
  const [relevantMemories, setRelevantMemories] = useState<string[]>([]);
  const relevantMemoriesRef = useRef<string[]>([]);
  // 用户头像（每个对话随机固定一个）
  const userAvatar = useMemo(() => getOrCreateAvatar(threadId), [threadId]);

  // 应用外观设置
  useApplyAppearance();

  // AI 参数状态
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [topP, setTopP] = useState(1.0);
  const [frequencyPenalty, setFrequencyPenalty] = useState(0.0);
  const [presencePenalty, setPresencePenalty] = useState(0.0);
  // 防止首次加载时把默认值误写入 DB
  const paramsInitialized = useRef(false);
  const persistParamsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载线程
  useEffect(() => {
    // 切换对话时重置参数初始化标记
    paramsInitialized.current = false;
    const loadThread = async () => {
      setIsLoading(true);
      try {
        const threadData = await aiChatApi.getThread(threadId);
        setThread(threadData);
        if (threadData) {
          setTemperature(threadData.temperature);
          setMaxTokens(threadData.max_tokens);
          setTopP(threadData.top_p);
          setFrequencyPenalty(threadData.frequency_penalty);
          setPresencePenalty(threadData.presence_penalty);
          // 标记参数已从 DB 加载，之后的变化才写回
          paramsInitialized.current = true;
        }
      } catch (error) {
        console.error('Failed to load thread:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadThread();
  }, [threadId]);

  // 参数变化时 debounce 写回 DB（500ms 内只写一次）
  useEffect(() => {
    if (!paramsInitialized.current || !thread) return;
    if (persistParamsTimer.current) clearTimeout(persistParamsTimer.current);
    persistParamsTimer.current = setTimeout(async () => {
      try {
        await aiChatApi.updateThreadParams({
          thread_id: threadId,
          temperature,
          max_tokens: maxTokens,
          top_p: topP,
          frequency_penalty: frequencyPenalty,
          presence_penalty: presencePenalty,
        });
      } catch (e) {
        console.error('Failed to persist AI params:', e);
      }
    }, 500);
    return () => {
      if (persistParamsTimer.current) clearTimeout(persistParamsTimer.current);
    };
  }, [temperature, maxTokens, topP, frequencyPenalty, presencePenalty]);

  // 获取默认 API 地址
  const getDefaultBaseUrl = (type: string) => {
    switch (type) {
      case 'openai':
        return 'https://api.openai.com/v1';
      case 'sub2api':
        return '';
      case 'anthropic':
        return 'https://api.anthropic.com/v1';
      case 'google':
        return 'https://generativelanguage.googleapis.com/v1beta';
      case 'vertex':
        return 'https://aiplatform.googleapis.com/v1';
      default:
        return '';
    }
  };

  // AI 适配器
  const modelAdapter = useMemo<ChatModelAdapter>(() => {
    // 类型定义 - 使用与 AppSettings 一致的类型
    type AIProvider = NonNullable<AppSettings['aiProviders']>[number];

    interface AIParams {
      temperature: number;
      max_tokens: number;
      top_p: number;
      frequency_penalty: number;
      presence_penalty: number;
    }

    // MCP 工具调用相关类型
    type StreamChunk =
      | { type: 'text'; text: string }
      | { type: 'tool_call'; id: string; name: string; args: unknown };

    // 将 McpToolDef 转换为各 provider 的工具格式
    function convertToolsForProvider(tools: McpToolDef[], providerType: string): unknown[] {
      if (!tools.length) return [];

      if (providerType === 'openai' || providerType === 'custom') {
        return tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }));
      } else if (providerType === 'anthropic') {
        return tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        }));
      } else if (providerType === 'google' || providerType === 'vertex') {
        return [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            })),
          },
        ];
      }
      return [];
    }

    function getProviderConnectionMode(provider: AIProvider): string {
      return provider.connectionMode || 'auto';
    }

    async function postOpenAiCompatible(
      provider: AIProvider,
      baseUrl: string,
      payload: Record<string, unknown>
    ) {
      const text = await invoke<string>('http_post_json', {
        url: `${baseUrl}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: payload,
        connectionMode: getProviderConnectionMode(provider),
        proxyUrl: provider.proxyUrl || null,
      });
      return JSON.parse(text);
    }

    function extractOpenAiMessageText(content: unknown): string {
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .map((part) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && 'text' in part) {
              return typeof (part as { text?: unknown }).text === 'string'
                ? (part as { text: string }).text
                : '';
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }
      return '';
    }

    // 流式 AI 调用辅助函数
    const callAIStream = async function* (
      provider: AIProvider,
      thread: ChatThread,
      messages: readonly unknown[],
      abortSignal: AbortSignal,
      params: AIParams,
      memories: string[],
      tools: McpToolDef[] = []
    ): AsyncGenerator<StreamChunk, void, unknown> {
      // 转换消息格式，支持多模态内容
      const apiMessages = messages.map((msg: unknown) => {
        const message = msg as {
          role: string;
          content: unknown;
          tool_call_id?: string;
          tool_calls?: unknown[];
          attachments?: Array<{ type: string; content?: Array<{ type: string; image?: string }> }>;
        };

        // tool 消息：content 是字符串，直接透传
        if (message.role === 'tool') {
          return { role: 'tool', tool_call_id: message.tool_call_id, content: message.content };
        }

        // assistant 消息（含 tool_calls）：content 可能是 null 或字符串
        if (message.role === 'assistant' && message.tool_calls) {
          return {
            role: 'assistant',
            content: message.content ?? null,
            tool_calls: message.tool_calls,
          };
        }

        // 普通消息：content 是数组
        const contentArr = Array.isArray(message.content)
          ? (message.content as Array<{ type: string; text?: string; image?: string }>)
          : [{ type: 'text', text: String(message.content ?? '') }];

        const textParts = contentArr.filter((c) => c.type === 'text');

        // 从 attachments 数组中提取图片
        const imageParts: Array<{ type: string; image?: string }> = [];
        if (message.attachments && message.attachments.length > 0) {
          for (const att of message.attachments) {
            if (att.type === 'image' && att.content) {
              const imageContent = att.content.find((c) => c.type === 'image');
              if (imageContent && imageContent.image) {
                imageParts.push(imageContent);
              }
            }
          }
        }

        // 如果有图片，使用多模态格式
        if (imageParts.length > 0 && message.role === 'user') {
          const contentArray: Array<{ type: string; text?: string; image_url?: { url: string } }> =
            [];

          // 添加文本部分
          if (textParts.length > 0) {
            contentArray.push({
              type: 'text',
              text: textParts.map((c) => c.text).join('\n'),
            });
          }

          // 添加图片部分
          for (const imagePart of imageParts) {
            contentArray.push({
              type: 'image_url',
              image_url: {
                url: imagePart.image || '', // base64 数据
              },
            });
          }

          return {
            role: message.role,
            content: contentArray,
          };
        }

        // 纯文本消息
        return {
          role: message.role,
          content: textParts.map((c) => c.text).join('\n'),
        };
      });

      // 构建系统消息内容
      let systemContent = thread.system_prompt || '你是一个有帮助的AI助手。';

      // 添加对话摘要上下文
      if (memories.length > 0 && memories[0]) {
        systemContent += `\n\n## 本对话历史背景（仅供参考，不改变你的角色设定）\n${memories[0]}\n\n请基于以上背景理解对话上下文，但始终遵守你的角色设定。`;
      }

      // 检查是否已有系统消息
      const systemMessageIndex = apiMessages.findIndex((m) => m.role === 'system');
      if (systemMessageIndex >= 0) {
        apiMessages[systemMessageIndex].content = systemContent;
      } else {
        apiMessages.unshift({
          role: 'system',
          content: systemContent,
        });
      }

      const baseUrl = provider.baseUrl || getDefaultBaseUrl(provider.type);

      if (
        provider.type === 'openai' ||
        provider.type === 'custom' ||
        provider.type === 'sub2api'
      ) {
        const data = await postOpenAiCompatible(provider, baseUrl, {
          model: thread.model,
          messages: apiMessages,
          stream: false,
          ...(tools.length > 0 && { tools: convertToolsForProvider(tools, provider.type) }),
          ...(tools.length > 0 &&
            thread.system_prompt?.includes('__artifact_mode__') && {
              tool_choice: 'required',
            }),
          ...params,
        });

        const message = data?.choices?.[0]?.message;
        const content = extractOpenAiMessageText(message?.content);
        if (content) {
          yield { type: 'text', text: content };
        }

        if (Array.isArray(message?.tool_calls)) {
          for (const toolCall of message.tool_calls) {
            const name = toolCall?.function?.name;
            if (!name) continue;
            let args: unknown = {};
            const rawArguments = toolCall?.function?.arguments;
            if (typeof rawArguments === 'string' && rawArguments.trim()) {
              try {
                args = JSON.parse(rawArguments);
              } catch {
                args = {};
              }
            } else if (rawArguments && typeof rawArguments === 'object') {
              args = rawArguments;
            }
            yield {
              type: 'tool_call',
              id: toolCall?.id || `tool-${Date.now()}-${name}`,
              name,
              args,
            };
          }
        }
      } else if (provider.type === 'anthropic') {
        // Anthropic Claude 带流式输出
        // 将 openai 格式的 messages 转换为 Anthropic 格式（展开 system 消息到 system 字段）
        const systemMsg = apiMessages.find((m) => m.role === 'system');
        const nonSystemMessages = apiMessages.filter((m) => m.role !== 'system');
        const response = await fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': provider.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'messages-2023-12-15',
          },
          body: JSON.stringify({
            model: thread.model,
            max_tokens: params.max_tokens,
            system: systemMsg ? systemMsg.content : undefined,
            messages: nonSystemMessages,
            stream: true,
            temperature: params.temperature,
            top_p: params.top_p,
            ...(tools.length > 0 && { tools: convertToolsForProvider(tools, 'anthropic') }),
          }),
          signal: abortSignal,
        });
        if (!response.ok) throw new Error(`Anthropic API error: ${await response.text()}`);
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('No response body');
        let currentToolUse: { id: string; name: string; inputStr: string } | null = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter((l) => l.trim());
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                const eventType = parsed.type;

                if (
                  eventType === 'content_block_start' &&
                  parsed.content_block?.type === 'tool_use'
                ) {
                  currentToolUse = {
                    id: parsed.content_block.id ?? '',
                    name: parsed.content_block.name ?? '',
                    inputStr: '',
                  };
                } else if (eventType === 'content_block_delta') {
                  if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
                    yield { type: 'text', text: parsed.delta.text };
                  } else if (parsed.delta?.type === 'input_json_delta' && currentToolUse) {
                    currentToolUse.inputStr += parsed.delta.partial_json ?? '';
                  }
                } else if (eventType === 'content_block_stop' && currentToolUse) {
                  let args: unknown = {};
                  try {
                    args = JSON.parse(currentToolUse.inputStr);
                  } catch {
                    args = {};
                  }
                  yield {
                    type: 'tool_call',
                    id: currentToolUse.id,
                    name: currentToolUse.name,
                    args,
                  };
                  currentToolUse = null;
                }
              } catch {
                /* ignore */
              }
            }
          }
        }
      } else if (provider.type === 'google') {
        // Google Gemini 带流式输出
        const systemMsg = apiMessages.find((m) => m.role === 'system');
        const contents = apiMessages
          .filter((m) => m.role !== 'system')
          .map((m) => {
            const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> =
              [];

            // 处理内容
            if (typeof m.content === 'string') {
              parts.push({ text: m.content });
            } else if (Array.isArray(m.content)) {
              for (const part of m.content) {
                if (part.type === 'text' && part.text) {
                  parts.push({ text: part.text });
                } else if (part.type === 'image_url' && part.image_url?.url) {
                  // 提取 base64 数据
                  const base64Match = part.image_url.url.match(/^data:image\/(\w+);base64,(.+)$/);
                  if (base64Match) {
                    parts.push({
                      inlineData: {
                        mimeType: `image/${base64Match[1]}`,
                        data: base64Match[2],
                      },
                    });
                  }
                }
              }
            }

            return {
              role: m.role === 'assistant' ? 'model' : 'user',
              parts,
            };
          });

        const response = await fetch(
          `${baseUrl}/models/${thread.model}:streamGenerateContent?alt=sse&key=${provider.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents,
              ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
              ...(tools.length > 0 && { tools: convertToolsForProvider(tools, 'google') }),
              // artifact 模式：始终强制调用工具
              ...(tools.length > 0 &&
                thread.system_prompt?.includes('__artifact_mode__') && {
                  tool_config: {
                    function_calling_config: { mode: 'ANY' },
                  },
                }),
              generationConfig: {
                temperature: params.temperature,
                topP: params.top_p,
                maxOutputTokens: params.max_tokens,
              },
            }),
            signal: abortSignal,
          }
        );
        if (!response.ok) throw new Error(`Google API error: ${await response.text()}`);
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('No response body');
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter((l) => l.trim());
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                const parts = parsed.candidates?.[0]?.content?.parts ?? [];
                for (const part of parts) {
                  if (part.text) {
                    yield { type: 'text', text: part.text };
                  } else if (part.functionCall) {
                    yield {
                      type: 'tool_call',
                      id: `gemini-${Date.now()}`,
                      name: part.functionCall.name,
                      args: part.functionCall.args ?? {},
                    };
                  }
                }
              } catch {
                /* ignore */
              }
            }
          }
        }
      } else if (provider.type === 'vertex') {
        // Google Vertex AI 带流式输出
        const systemMsg = apiMessages.find((m) => m.role === 'system');
        const contents = apiMessages
          .filter((m) => m.role !== 'system')
          .map((m) => {
            const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> =
              [];

            // 处理内容
            if (typeof m.content === 'string') {
              parts.push({ text: m.content });
            } else if (Array.isArray(m.content)) {
              for (const part of m.content) {
                if (part.type === 'text' && part.text) {
                  parts.push({ text: part.text });
                } else if (part.type === 'image_url' && part.image_url?.url) {
                  // 提取 base64 数据
                  const base64Match = part.image_url.url.match(/^data:image\/(\w+);base64,(.+)$/);
                  if (base64Match) {
                    parts.push({
                      inlineData: {
                        mimeType: `image/${base64Match[1]}`,
                        data: base64Match[2],
                      },
                    });
                  }
                }
              }
            }

            return {
              role: m.role === 'assistant' ? 'model' : 'user',
              parts,
            };
          });

        const response = await fetch(
          `${baseUrl}/publishers/google/models/${thread.model}:streamGenerateContent?alt=sse&key=${provider.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents,
              ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
              ...(tools.length > 0 && { tools: convertToolsForProvider(tools, 'vertex') }),
              generationConfig: {
                temperature: params.temperature,
                topP: params.top_p,
                maxOutputTokens: params.max_tokens,
                ...(params.frequency_penalty !== 0 && {
                  frequencyPenalty: params.frequency_penalty,
                }),
                ...(params.presence_penalty !== 0 && { presencePenalty: params.presence_penalty }),
              },
            }),
            signal: abortSignal,
          }
        );
        if (!response.ok) throw new Error(`Vertex AI error: ${await response.text()}`);
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('No response body');
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter((l) => l.trim());
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                const parts = parsed.candidates?.[0]?.content?.parts ?? [];
                for (const part of parts) {
                  if (part.text) {
                    yield { type: 'text', text: part.text };
                  } else if (part.functionCall) {
                    yield {
                      type: 'tool_call',
                      id: `vertex-${Date.now()}`,
                      name: part.functionCall.name,
                      args: part.functionCall.args ?? {},
                    };
                  }
                }
              } catch {
                /* ignore */
              }
            }
          }
        }
      } else {
        throw new Error(
          `不支持的 Provider 类型: ${provider.type}。请同时支持 openai / custom / anthropic / google。`
        );
      }
    };

    // 非流式 AI 调用（用于记忆提取）
    const callAI = async (
      provider: AIProvider,
      thread: ChatThread,
      messages: readonly unknown[],
      abortSignal: AbortSignal,
      params: AIParams,
      memories: string[],
      overrideSystemPrompt?: string
    ) => {
      // 转换消息格式
      const apiMessages = messages.map((msg: unknown) => {
        const message = msg as { role: string; content: Array<{ type: string; text?: string }> };
        const textParts = message.content.filter((c) => c.type === 'text');
        return {
          role: message.role,
          content: textParts.map((c) => c.text).join('\n'),
        };
      });

      // 构建系统消息：overrideSystemPrompt 用于压缩等内部任务，避免带入用户设置的角色
      let systemContent =
        overrideSystemPrompt ?? (thread.system_prompt || '你是一个有帮助的AI助手。');
      if (!overrideSystemPrompt && memories.length > 0) {
        systemContent += `\n\n## 本对话历史背景（仅供参考，不改变你的角色设定）\n${memories[0]}\n\n请基于以上背景理解对话上下文，但始终遵守你的角色设定。`;
      }

      const systemMessageIndex = apiMessages.findIndex((m) => m.role === 'system');
      if (systemMessageIndex >= 0) {
        apiMessages[systemMessageIndex].content = systemContent;
      } else {
        apiMessages.unshift({
          role: 'system',
          content: systemContent,
        });
      }

      const baseUrl = provider.baseUrl || getDefaultBaseUrl(provider.type);

      if (
        provider.type === 'openai' ||
        provider.type === 'custom' ||
        provider.type === 'sub2api'
      ) {
        const data = await postOpenAiCompatible(provider, baseUrl, {
          model: thread.model,
          messages: apiMessages,
          stream: false,
          ...params,
        });
        return extractOpenAiMessageText(data?.choices?.[0]?.message?.content);
      } else if (provider.type === 'anthropic') {
        const systemMsg = apiMessages.find((m) => m.role === 'system');
        const nonSystemMessages = apiMessages.filter((m) => m.role !== 'system');
        const response = await fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': provider.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: thread.model,
            max_tokens: params.max_tokens,
            system: systemMsg ? systemMsg.content : undefined,
            messages: nonSystemMessages,
            temperature: params.temperature,
            top_p: params.top_p,
          }),
          signal: abortSignal,
        });
        if (!response.ok) throw new Error(`Anthropic API error: ${await response.text()}`);
        const data = await response.json();
        return data.content[0].text;
      } else if (provider.type === 'google') {
        const systemMsg = apiMessages.find((m) => m.role === 'system');
        const contents = apiMessages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [
              { text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) },
            ],
          }));
        const response = await fetch(
          `${baseUrl}/models/${thread.model}:generateContent?key=${provider.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents,
              ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
              generationConfig: {
                temperature: params.temperature,
                topP: params.top_p,
                maxOutputTokens: params.max_tokens,
              },
            }),
            signal: abortSignal,
          }
        );
        if (!response.ok) throw new Error(`Google API error: ${await response.text()}`);
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      } else if (provider.type === 'vertex') {
        const systemMsg = apiMessages.find((m) => m.role === 'system');
        const contents = apiMessages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [
              { text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) },
            ],
          }));
        const response = await fetch(
          `${baseUrl}/publishers/google/models/${thread.model}:generateContent?key=${provider.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents,
              ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
              generationConfig: {
                temperature: params.temperature,
                topP: params.top_p,
                maxOutputTokens: params.max_tokens,
                ...(params.frequency_penalty !== 0 && {
                  frequencyPenalty: params.frequency_penalty,
                }),
                ...(params.presence_penalty !== 0 && { presencePenalty: params.presence_penalty }),
              },
            }),
            signal: abortSignal,
          }
        );
        if (!response.ok) throw new Error(`Vertex AI error: ${await response.text()}`);
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      }
      throw new Error(`不支持的 Provider 类型: ${provider.type}`);
    };

    return {
      async *run({ messages, abortSignal }) {
        try {
          if (!thread) throw new Error('Thread not loaded');
          const provider = aiProviders?.find((p) => p.id === thread.provider_id);
          if (!provider) throw new Error('Provider not found');

          const lastMessage = messages[messages.length - 1];
          if (lastMessage.role === 'user') {
            // 加载本对话的摘要注入上下文
            if (enableMemory) {
              try {
                const summaryData = await aiChatApi.getThreadSummary(threadId);
                if (summaryData?.summary) {
                  setRelevantMemories([summaryData.summary]);
                  relevantMemoriesRef.current = [summaryData.summary];
                } else {
                  setRelevantMemories([]);
                  relevantMemoriesRef.current = [];
                }
              } catch (error) {
                console.error('Failed to load thread summary:', error);
              }
            }
          }

          // 获取 MCP 工具列表
          let mcpTools: McpToolDef[] = [];
          try {
            mcpTools = await mcpApi.listTools();
          } catch (e) {
            console.warn('[MCP] Failed to list tools, proceeding without tools:', e);
          }

          // artifact 模式：把 render_html 工具定义注入到发给 AI 的工具列表
          // makeAssistantTool 只处理执行，工具定义仍需手动传给 AI
          if (thread.system_prompt?.includes('__artifact_mode__')) {
            const renderHtmlTool: McpToolDef = {
              name: 'render_html',
              description:
                'Render HTML code in the preview panel. Call this whenever the user asks for any visual output, page, component, game, animation, or interactive demo. The code must be a complete standalone HTML file.',
              inputSchema: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    description:
                      'Complete standalone HTML code including <!DOCTYPE html>, <head>, and <body>',
                  },
                },
                required: ['code'],
              },
              serverId: '__builtin__',
              serverName: '__builtin__',
              originalName: 'render_html',
            };
            // 放在最前面，确保 AI 优先看到这个工具
            mcpTools = [renderHtmlTool, ...mcpTools];
          }

          const aiParams = {
            temperature,
            max_tokens: maxTokens,
            top_p: topP,
            frequency_penalty: frequencyPenalty,
            presence_penalty: presencePenalty,
          };

          // 构建内存临时消息列表（用于多轮工具调用）
          const localMessages: unknown[] = [...messages];

          const MAX_TOOL_ROUNDS = 10;
          let toolRound = 0;
          let finalTextResponse = '';

          while (toolRound <= MAX_TOOL_ROUNDS) {
            const chunks: StreamChunk[] = [];
            let hasToolCall = false;
            let streamedText = '';

            for await (const chunk of callAIStream(
              provider,
              thread,
              localMessages,
              abortSignal,
              aiParams,
              relevantMemoriesRef.current,
              mcpTools
            )) {
              chunks.push(chunk);
              if (chunk.type === 'tool_call') {
                hasToolCall = true;
              }
              if (chunk.type === 'text') {
                streamedText += chunk.text;
                yield { content: [{ type: 'text' as const, text: streamedText }] };
              }
            }

            if (!hasToolCall || toolRound >= MAX_TOOL_ROUNDS) {
              finalTextResponse = streamedText;

              // artifact 模式兜底：AI 没有调用工具时，尝试从文本中提取 HTML 代码块
              if (thread.system_prompt?.includes('__artifact_mode__') && streamedText) {
                const htmlMatch =
                  streamedText.match(/```html\n([\s\S]*?)```/) ||
                  streamedText.match(/```\n(<!DOCTYPE[\s\S]*?)```/) ||
                  streamedText.match(/(<!DOCTYPE html[\s\S]*?<\/html>)/i);
                if (htmlMatch?.[1]?.trim()) {
                  const extractedCode = htmlMatch[1].trim();
                  window.dispatchEvent(
                    new CustomEvent('artifact-render', { detail: extractedCode })
                  );
                  // 补存 tool_call 消息到数据库，使历史可持久化（静默存储，不触发 UI 刷新）
                  try {
                    const fakeId = `fallback-${Date.now()}`;
                    await aiChatApi.addMessage({
                      thread_id: threadId,
                      role: 'tool_call',
                      content: JSON.stringify({
                        tool_call_id: fakeId,
                        tool_name: 'render_html',
                        args: { code: extractedCode },
                      }),
                    });
                    await aiChatApi.addMessage({
                      thread_id: threadId,
                      role: 'tool_result',
                      content: JSON.stringify({
                        tool_call_id: fakeId,
                        tool_name: 'render_html',
                        result: { success: true },
                        is_error: false,
                      }),
                    });
                  } catch (e) {
                    console.warn('补存 tool_call 失败:', e);
                  }
                }
              }

              break;
            }

            // 有工具调用：先收集文本部分
            const textBeforeTools = chunks
              .filter((c) => c.type === 'text')
              .map((c) => (c as { type: 'text'; text: string }).text)
              .join('');

            // 收集工具调用
            const toolCallsForHistory = chunks
              .filter((c) => c.type === 'tool_call')
              .map((c) => c as { type: 'tool_call'; id: string; name: string; args: unknown });

            // 构建 assistant 消息追加到 localMessages（OpenAI 格式）
            localMessages.push({
              role: 'assistant',
              content: textBeforeTools || null,
              tool_calls: toolCallsForHistory.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.args) },
              })),
            });

            // 执行每个工具调用
            for (const toolCall of toolCallsForHistory) {
              // yield tool-call content part（让 @assistant-ui/react 显示 ToolCard）
              yield {
                content: [
                  {
                    type: 'tool-call' as const,
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    args: toolCall.args as unknown as ReadonlyJSONObject,
                    argsText: JSON.stringify(toolCall.args),
                  },
                ],
              };

              // render_html 由 makeAssistantTool 处理，这里不需要特殊处理
              // 调用 MCP 工具
              let toolResult: unknown;
              let isError = false;
              try {
                toolResult = await mcpApi.callTool(toolCall.name, toolCall.args);
              } catch (e) {
                toolResult = { error: String(e) };
                isError = true;
              }

              // yield tool-result：更新同一个 tool-call part，填入 result
              yield {
                content: [
                  {
                    type: 'tool-call' as const,
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    args: toolCall.args as unknown as ReadonlyJSONObject,
                    argsText: JSON.stringify(toolCall.args),
                    result: toolResult,
                    isError,
                  },
                ],
              };

              // 追加 tool result 到 localMessages（OpenAI 格式）
              localMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
              });
            }

            toolRound++;
          }

          // 生成标题（第一轮对话时，基于用户消息内容）
          if (messages.length === 1 && onTitleGenerated) {
            const userContent = lastMessage.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('\n');
            const title = userContent.slice(0, 50) + (userContent.length > 50 ? '...' : '');
            await aiChatApi.updateThreadTitle({ thread_id: threadId, title });
            onTitleGenerated(title);
          }

          // 自动压缩对话历史（后台异步，每 20 条消息触发一次）
          const COMPRESS_EVERY = 20;
          const KEEP_RECENT = 10;

          if (enableMemory && finalTextResponse) {
            (async () => {
              try {
                const messageCount = await aiChatApi.getThreadMessageCount(threadId);
                const existingSummary = await aiChatApi.getThreadSummary(threadId);
                const lastCompressedCount = existingSummary?.message_count ?? 0;

                // 距上次压缩未满 COMPRESS_EVERY 条，跳过
                if (messageCount - lastCompressedCount < COMPRESS_EVERY) return;

                // 取需要压缩的消息（排除最近 KEEP_RECENT 条保持完整上下文）
                const allMessages = [...messages] as Array<{ role: string; content: unknown }>;
                const toCompress = allMessages.slice(0, -KEEP_RECENT);
                if (toCompress.length === 0) return;

                const msgText = toCompress
                  .map((m) => {
                    const c = m.content;
                    let text = '';
                    if (typeof c === 'string') text = c;
                    else if (Array.isArray(c))
                      text = c
                        .filter((p: { type: string }) => p.type === 'text')
                        .map((p: { text?: string }) => p.text ?? '')
                        .join('');
                    if (!text.trim()) return null;
                    return `${m.role === 'user' ? '用户' : 'AI'}: ${text}`;
                  })
                  .filter(Boolean)
                  .join('\n\n');

                if (!msgText.trim()) return;

                // 增量压缩：把旧摘要 + 新消息一起压缩
                const prevSummary = existingSummary?.summary ?? '';
                const compressPrompt = `你是一个对话摘要助手。请将以下对话压缩成结构化摘要，只保留对未来对话有用的信息。

${prevSummary ? `## 已有摘要\n${prevSummary}\n\n` : ''}## 新增对话
${msgText}

请输出 JSON 格式（直接输出 JSON，不要加其他文字）：
{
  "summary": "一段简洁的自然语言摘要（100字以内）",
  "key_points": {
    "目标": [],
    "偏好": [],
    "限制条件": [],
    "已完成的决定": [],
    "项目进度": []
  }
}

规则：不保存闲聊、情绪、无意义内容；只保存对未来有用的信息；key_points 中没有内容的字段省略。`;

                const compressResponse = await callAI(
                  provider,
                  thread,
                  [{ role: 'user', content: [{ type: 'text' as const, text: compressPrompt }] }],
                  new AbortController().signal,
                  {
                    temperature: 0.1,
                    max_tokens: 800,
                    top_p: 1.0,
                    frequency_penalty: 0,
                    presence_penalty: 0,
                  },
                  [],
                  '你是一个对话摘要助手，只负责提取和压缩对话内容，不扮演任何角色。'
                );

                if (!compressResponse?.trim()) return;

                const jsonMatch = compressResponse.match(/\{[\s\S]*\}/);
                if (!jsonMatch) return;

                let parsed: { summary?: string; key_points?: Record<string, string[]> };
                try {
                  parsed = JSON.parse(jsonMatch[0]);
                } catch {
                  return;
                }
                if (!parsed.summary) return;

                await aiChatApi.upsertThreadSummary({
                  thread_id: threadId,
                  summary: parsed.summary,
                  key_points: JSON.stringify(parsed.key_points ?? {}),
                  message_count: messageCount,
                  last_compressed_at: Math.floor(Date.now() / 1000),
                });

                // 立即更新当前注入的摘要
                setRelevantMemories([parsed.summary]);
                relevantMemoriesRef.current = [parsed.summary];
              } catch (err) {
                console.error('Background compression failed:', err);
              }
            })();
          }
        } catch (error) {
          // AbortError 是正常行为（用户切换对话/停止生成），不打印错误
          if (error instanceof Error && error.name === 'AbortError') {
            return;
          }
          console.error('AI call failed:', error);
          throw error;
        }
      },
    };
  }, [
    thread,
    aiProviders,
    threadId,
    onTitleGenerated,
    temperature,
    maxTokens,
    topP,
    frequencyPenalty,
    presencePenalty,
    userId,
    enableMemory,
  ]);

  const runtime = useLocalRuntime(modelAdapter, {
    adapters: {
      // ThreadHistoryAdapter：官方推荐的持久化方式
      history: {
        async load() {
          try {
            const messages = await aiChatApi.listMessages(threadId);
            // 用 ExportedMessageRepository.fromArray 转换，避免手动构造复杂类型
            const messageLikes = messages.map((msg) => {
              if (msg.role === 'tool_call') {
                // tool_call 消息只存参数，不单独渲染（tool_result 包含完整信息）
                // 但需要保留以便 ExportedMessageRepository 正确合并
                try {
                  const data = JSON.parse(msg.content);
                  return {
                    id: msg.id,
                    role: 'assistant' as const,
                    content: [
                      {
                        type: 'tool-call' as const,
                        toolCallId: data.tool_call_id,
                        toolName: data.tool_name,
                        argsText: JSON.stringify(data.args),
                      },
                    ],
                    createdAt: new Date(msg.created_at * 1000),
                  };
                } catch {
                  // 解析失败时跳过这条消息（返回空内容会导致空白气泡）
                  return null;
                }
              }
              if (msg.role === 'tool_result') {
                try {
                  const data = JSON.parse(msg.content);
                  return {
                    id: msg.id,
                    role: 'assistant' as const,
                    content: [
                      {
                        type: 'tool-call' as const,
                        toolCallId: data.tool_call_id,
                        toolName: data.tool_name,
                        argsText: '{}',
                        result: data.result,
                        isError: data.is_error,
                      },
                    ],
                    createdAt: new Date(msg.created_at * 1000),
                  };
                } catch {
                  return {
                    id: msg.id,
                    role: 'assistant' as const,
                    content: [] as [],
                    createdAt: new Date(msg.created_at * 1000),
                  };
                }
              }
              return {
                id: msg.id,
                role: msg.role as 'user' | 'assistant' | 'system',
                content: [{ type: 'text' as const, text: msg.content }],
                createdAt: new Date(msg.created_at * 1000),
              };
            });
            return ExportedMessageRepository.fromArray(
              messageLikes.filter(Boolean) as NonNullable<(typeof messageLikes)[0]>[]
            );
          } catch (error) {
            console.error('Failed to load thread history:', error);
            return { messages: [] };
          }
        },
        async append({ message }) {
          // 处理 tool-call content part
          const toolCallPart = message.content.find(
            (c: { type: string }) => c.type === 'tool-call'
          );
          if (toolCallPart) {
            const tc = toolCallPart as {
              type: string;
              toolCallId?: string;
              toolName?: string;
              args?: unknown;
              result?: unknown;
              isError?: boolean;
            };
            // 如果有 result，保存为 tool_result
            if (tc.result !== undefined) {
              await aiChatApi.addMessage({
                thread_id: threadId,
                role: 'tool_result',
                content: JSON.stringify({
                  tool_call_id: tc.toolCallId ?? '',
                  tool_name: tc.toolName ?? '',
                  result: tc.result ?? null,
                  is_error: tc.isError ?? false,
                }),
              });
            } else {
              // 否则保存为 tool_call
              await aiChatApi.addMessage({
                thread_id: threadId,
                role: 'tool_call',
                content: JSON.stringify({
                  tool_call_id: tc.toolCallId ?? '',
                  tool_name: tc.toolName ?? '',
                  args: tc.args ?? {},
                }),
              });
            }
            return;
          }

          // 原有文本消息处理逻辑
          const textContent = message.content
            .filter((c: { type: string }) => c.type === 'text')
            .map(
              (c: { type: string; text?: string }) =>
                (c as { type: string; text?: string }).text ?? ''
            )
            .join('\n');
          await aiChatApi.addMessage({
            thread_id: threadId,
            role: message.role as 'user' | 'assistant' | 'system',
            content: textContent || `[${message.role} message]`,
          });
        },
      },
      attachments: {
        accept: 'image/*,application/pdf,.txt,.doc,.docx',
        async add({ file }) {
          const isImage = file.type.startsWith('image/');

          // 如果是图片，立即转换为 base64
          if (isImage) {
            const base64 = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(file);
            });

            return {
              id: `${Date.now()}-${file.name}`,
              type: 'image' as const,
              name: file.name,
              contentType: file.type,
              file: file,
              content: [{ type: 'image' as const, image: base64 }],
              status: { type: 'requires-action' as const, reason: 'composer-send' as const },
            };
          }

          // 非图片文件
          return {
            id: `${Date.now()}-${file.name}`,
            type: 'document' as const,
            name: file.name,
            contentType: file.type,
            file: file,
            content: [{ type: 'text' as const, text: `[文件: ${file.name}]` }],
            status: { type: 'requires-action' as const, reason: 'composer-send' as const },
          };
        },
        async remove() {},
        async send(attachment) {
          // 确保 content 不为 undefined，必须是 ThreadUserMessagePart[]
          const content =
            attachment.content && attachment.content.length > 0
              ? attachment.content
              : [{ type: 'text' as const, text: `[文件: ${attachment.name}]` }];

          // 返回 CompleteAttachment，确保 content 类型正确
          return {
            id: attachment.id,
            type: attachment.type,
            name: attachment.name,
            contentType: attachment.contentType,
            file: attachment.file,
            content: content,
            status: { type: 'complete' as const },
          };
        },
      },
    },
  });

  const handleSwitchModel = async (providerId: string, model: string) => {
    try {
      await aiChatApi.updateThreadModel({
        thread_id: threadId,
        provider_id: providerId,
        model: model,
      });

      // 重新加载线程数据
      const threadData = await aiChatApi.getThread(threadId);
      setThread(threadData);
      setShowSwitchModel(false);

      // 通知父组件线程已更新
      if (onThreadUpdated) {
        onThreadUpdated();
      }

      alert(`已切换到 ${model}`);
    } catch (error) {
      console.error('Failed to switch model:', error);
      alert('切换模型失败：' + error);
    }
  };

  const handleSetRole = async (systemPrompt: string) => {
    try {
      await aiChatApi.updateThreadSystemPrompt({
        thread_id: threadId,
        system_prompt: systemPrompt,
      });

      // 重新加载线程数据
      const threadData = await aiChatApi.getThread(threadId);
      setThread(threadData);
      setShowSetRole(false);

      // 通知父组件线程已更新
      if (onThreadUpdated) {
        onThreadUpdated();
      }

      alert('角色设定已保存');
    } catch (error) {
      console.error('Failed to set role:', error);
      alert('保存角色失败：' + error);
    }
  };

  if (isLoading || !thread) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#f8f9fa] dark:bg-[#131314]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#0066ff]"></div>
          <p className="mt-2 text-sm text-[#70757a] dark:text-[#9aa0a6]">加载对话?..</p>
        </div>
      </div>
    );
  }

  const provider = aiProviders?.find((p) => p.id === thread.provider_id);
  if (!provider) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#f8f9fa] dark:bg-[#131314]">
        <p className="text-[#70757a] dark:text-[#9aa0a6]">提供商配置不存在</p>
      </div>
    );
  }

  return (
    <UserAvatarContext.Provider value={userAvatar}>
      <AssistantRuntimeProvider key={threadId} runtime={runtime}>
        <div className="flex h-full w-full overflow-hidden">
          <ThreadPrimitive.Root className="flex-1 min-w-0 flex h-full flex-col bg-[#f8f9fa] dark:bg-[#0d0e10] relative overflow-hidden">
            {/* 科技感背景：动态网?+ 渐变光晕 */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {/* 网格?*/}
              <div
                className="absolute inset-0 opacity-[0.03] dark:opacity-[0.06]"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(0,102,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,102,255,1) 1px, transparent 1px)',
                  backgroundSize: '40px 40px',
                }}
              />
              {/* 左上角光?*/}
              <div className="absolute -top-32 -left-32 size-96 rounded-full bg-blue-500/10 dark:bg-blue-500/8 blur-3xl" />
              {/* 右下角光?*/}
              <div className="absolute -bottom-32 -right-32 size-96 rounded-full bg-purple-500/10 dark:bg-purple-500/8 blur-3xl" />
            </div>
            {/* 欢迎界面 */}
            <ThreadPrimitive.Empty>
              {' '}
              <WelcomeScreen
                onShowSwitchModel={() => setShowSwitchModel(true)}
                onShowSetRole={() => setShowSetRole(true)}
                temperature={temperature}
                setTemperature={setTemperature}
                maxTokens={maxTokens}
                setMaxTokens={setMaxTokens}
                topP={topP}
                setTopP={setTopP}
                frequencyPenalty={frequencyPenalty}
                setFrequencyPenalty={setFrequencyPenalty}
                presencePenalty={presencePenalty}
                setPresencePenalty={setPresencePenalty}
                relevantMemories={relevantMemories}
                enableMemory={enableMemory}
                userId={userId}
                threadId={threadId}
              />
            </ThreadPrimitive.Empty>

            {/* 对话界面 */}
            <AuiIf condition={(s) => !s.thread.isEmpty}>
              <ThreadCallbackContext.Provider value={{ onThreadUpdated, onMessageDeleted }}>
                {/* 可滚动的消息区域 */}
                <ThreadPrimitive.Viewport className="relative flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-3 py-4">
                  <ThreadPrimitive.Messages
                    components={{
                      Message: GeminiMessage,
                      UserEditComposer: UserEditComposer,
                    }}
                  />
                  {/* 滚动到底部按?*/}
                  <ThreadPrimitive.ScrollToBottom className="absolute bottom-4 right-4 flex size-9 items-center justify-center rounded-full bg-white/90 dark:bg-white/10 backdrop-blur-sm border border-gray-200/80 dark:border-white/20 shadow-lg text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-500/20 hover:text-blue-500 hover:border-blue-300 dark:hover:border-blue-500/50 transition-all disabled:hidden">
                    <ArrowDown size={15} />
                  </ThreadPrimitive.ScrollToBottom>
                </ThreadPrimitive.Viewport>
              </ThreadCallbackContext.Provider>

              {/* 固定在底部的输入框 */}
              <div className="flex-shrink-0 pb-4 px-2.5">
                <GeminiComposer
                  onShowSwitchModel={() => setShowSwitchModel(true)}
                  onShowSetRole={() => setShowSetRole(true)}
                  temperature={temperature}
                  setTemperature={setTemperature}
                  maxTokens={maxTokens}
                  setMaxTokens={setMaxTokens}
                  topP={topP}
                  setTopP={setTopP}
                  frequencyPenalty={frequencyPenalty}
                  setFrequencyPenalty={setFrequencyPenalty}
                  presencePenalty={presencePenalty}
                  setPresencePenalty={setPresencePenalty}
                  relevantMemories={relevantMemories}
                  enableMemory={enableMemory}
                  userId={userId}
                  threadId={threadId}
                />
              </div>
            </AuiIf>

            {/* 文本选择工具?- 始终挂载，在 ThreadPrimitive.Root ?Viewport ?*/}
            <SelectionToolbarPrimitive.Root className="flex items-center gap-1 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2d2e2f] px-1.5 py-1 shadow-xl z-50">
              <SelectionToolbarPrimitive.Quote className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-[#444746] dark:text-[#c4c7c5] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer">
                <Quote size={12} />
                引用
              </SelectionToolbarPrimitive.Quote>
            </SelectionToolbarPrimitive.Root>
          </ThreadPrimitive.Root>
          {/* rightPanel 在 Provider 内部渲染，可以使用 useAuiState 等 hooks，放在对话区右侧 */}
          {rightPanel}
        </div>

        {/* 切换模型对话框 */}
        {showSwitchModel && aiProviders && aiProviders.length > 0 && (
          <SwitchModelDialog
            providers={aiProviders}
            currentProviderId={thread.provider_id}
            currentModel={thread.model}
            onClose={() => setShowSwitchModel(false)}
            onSwitch={handleSwitchModel}
          />
        )}

        {/* 设置角色对话?*/}
        {showSetRole && (
          <SetRoleDialog
            currentSystemPrompt={thread.system_prompt || ''}
            onClose={() => setShowSetRole(false)}
            onSave={handleSetRole}
          />
        )}
      </AssistantRuntimeProvider>
    </UserAvatarContext.Provider>
  );
}

// 欢迎屏幕组件
const WelcomeScreen = ({
  onShowSwitchModel,
  onShowSetRole,
  temperature,
  setTemperature,
  maxTokens,
  setMaxTokens,
  topP,
  setTopP,
  frequencyPenalty,
  setFrequencyPenalty,
  presencePenalty,
  setPresencePenalty,
  relevantMemories,
  enableMemory,
  userId,
  threadId,
}: {
  onShowSwitchModel?: () => void;
  onShowSetRole?: () => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  maxTokens: number;
  setMaxTokens: (tokens: number) => void;
  topP: number;
  setTopP: (topP: number) => void;
  frequencyPenalty: number;
  setFrequencyPenalty: (penalty: number) => void;
  presencePenalty: number;
  setPresencePenalty: (penalty: number) => void;
  relevantMemories: string[];
  enableMemory: boolean;
  userId?: string;
  threadId: string;
}) => {
  return (
    <div className="flex h-full flex-col">
      {/* 可滚动的欢迎内容区域 */}
      <div className="flex-1 overflow-y-auto flex flex-col justify-center px-2.5 py-8">
        <div className="w-full max-w-4xl mx-auto">
          {/* 标题区域 */}
          <div className="mb-10">
            {/* AI 头像 + 问?*/}
            <div className="mb-5 flex items-center gap-4">
              <div className="relative">
                {/* 外圈旋转光环 */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 blur-sm opacity-60 animate-pulse" />
                <div className="relative p-3.5 rounded-2xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 shadow-2xl">
                  <Sparkles className="size-7 text-white" />
                </div>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  你好，我是 AI 助手
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  随时准备为你提供帮助
                </p>
              </div>
            </div>

            {/* 主标?*/}
            <h1 className="text-5xl font-black leading-tight mb-3">
              <span className="bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 bg-clip-text text-transparent">
                今天想探索
              </span>
              <br />
              <span className="bg-gradient-to-r from-purple-600 via-pink-600 to-rose-500 bg-clip-text text-transparent">
                什么话题？
              </span>
            </h1>
            <p className="text-base text-gray-500 dark:text-gray-400">
              解答问题 · 创作内容 · 分析数据 · 编写代码
            </p>
          </div>

          {/* 建议卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            {/* 卡片 1 */}
            <ThreadPrimitive.Suggestion
              prompt="帮我想一个有创意的项目名称"
              className="group relative overflow-hidden cursor-pointer rounded-2xl p-4 border border-blue-200/60 dark:border-blue-800/40 bg-white/80 dark:bg-white/5 backdrop-blur-sm hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/10 transition-all duration-200 hover:-translate-y-0.5 text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 dark:from-blue-500/10 dark:to-cyan-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative flex items-start gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-md shadow-blue-500/30 shrink-0">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm mb-0.5">
                    创意灵感
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    帮我想一个有创意的项目名称
                  </p>
                </div>
                <ChevronRight
                  size={14}
                  className="text-gray-300 dark:text-gray-600 group-hover:text-blue-400 transition-colors shrink-0 mt-0.5"
                />
              </div>
            </ThreadPrimitive.Suggestion>

            {/* 卡片 2 */}
            <ThreadPrimitive.Suggestion
              prompt="解释一个复杂的概念"
              className="group relative overflow-hidden cursor-pointer rounded-2xl p-4 border border-purple-200/60 dark:border-purple-800/40 bg-white/80 dark:bg-white/5 backdrop-blur-sm hover:border-purple-400 dark:hover:border-purple-500 hover:shadow-lg hover:shadow-purple-500/10 transition-all duration-200 hover:-translate-y-0.5 text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 dark:from-purple-500/10 dark:to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative flex items-start gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-md shadow-purple-500/30 shrink-0">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                    />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm mb-0.5">
                    学习助手
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    解释一个复杂的概念
                  </p>
                </div>
                <ChevronRight
                  size={14}
                  className="text-gray-300 dark:text-gray-600 group-hover:text-purple-400 transition-colors shrink-0 mt-0.5"
                />
              </div>
            </ThreadPrimitive.Suggestion>

            {/* 卡片 3 */}
            <ThreadPrimitive.Suggestion
              prompt="帮我写一段代码或调试错误"
              className="group relative overflow-hidden cursor-pointer rounded-2xl p-4 border border-emerald-200/60 dark:border-emerald-800/40 bg-white/80 dark:bg-white/5 backdrop-blur-sm hover:border-emerald-400 dark:hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-200 hover:-translate-y-0.5 text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 dark:from-emerald-500/10 dark:to-teal-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative flex items-start gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/30 shrink-0">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                    />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm mb-0.5">
                    编程帮手
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    帮我写一段代码或调试错误
                  </p>
                </div>
                <ChevronRight
                  size={14}
                  className="text-gray-300 dark:text-gray-600 group-hover:text-emerald-400 transition-colors shrink-0 mt-0.5"
                />
              </div>
            </ThreadPrimitive.Suggestion>

            {/* 卡片 4 */}
            <ThreadPrimitive.Suggestion
              prompt="帮我写一篇文章或邮件"
              className="group relative overflow-hidden cursor-pointer rounded-2xl p-4 border border-orange-200/60 dark:border-orange-800/40 bg-white/80 dark:bg-white/5 backdrop-blur-sm hover:border-orange-400 dark:hover:border-orange-500 hover:shadow-lg hover:shadow-orange-500/10 transition-all duration-200 hover:-translate-y-0.5 text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-amber-500/5 dark:from-orange-500/10 dark:to-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative flex items-start gap-3">
                <div className="p-2 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/30 shrink-0">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
                    />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm mb-0.5">
                    内容创作
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    帮我写一篇文章或邮件
                  </p>
                </div>
                <ChevronRight
                  size={14}
                  className="text-gray-300 dark:text-gray-600 group-hover:text-orange-400 transition-colors shrink-0 mt-0.5"
                />
              </div>
            </ThreadPrimitive.Suggestion>
          </div>

          {/* 底部提示 */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 dark:text-gray-600">
            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>AI 可能会犯错，请核实重要信息</span>
          </div>
        </div>
      </div>

      {/* 固定在底部的输入框 */}
      <div className="flex-shrink-0 pb-4 px-2.5">
        <GeminiComposer
          onShowSwitchModel={onShowSwitchModel}
          onShowSetRole={onShowSetRole}
          temperature={temperature}
          setTemperature={setTemperature}
          maxTokens={maxTokens}
          setMaxTokens={setMaxTokens}
          topP={topP}
          setTopP={setTopP}
          frequencyPenalty={frequencyPenalty}
          setFrequencyPenalty={setFrequencyPenalty}
          presencePenalty={presencePenalty}
          setPresencePenalty={setPresencePenalty}
          relevantMemories={relevantMemories}
          enableMemory={enableMemory}
          userId={userId}
          threadId={threadId}
        />
      </div>
    </div>
  );
};

// Gemini 风格的 Composer
const GeminiComposer = ({
  onShowSwitchModel,
  onShowSetRole,
  temperature,
  setTemperature,
  maxTokens,
  setMaxTokens,
  topP,
  setTopP,
  frequencyPenalty,
  setFrequencyPenalty,
  presencePenalty,
  setPresencePenalty,
  relevantMemories,
  enableMemory,
  userId: _userId,
  threadId,
}: {
  onShowSwitchModel?: () => void;
  onShowSetRole?: () => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  maxTokens: number;
  setMaxTokens: (tokens: number) => void;
  topP: number;
  setTopP: (topP: number) => void;
  frequencyPenalty: number;
  setFrequencyPenalty: (penalty: number) => void;
  presencePenalty: number;
  setPresencePenalty: (penalty: number) => void;
  relevantMemories: string[];
  enableMemory: boolean;
  userId?: string;
  threadId: string;
}) => {
  // 统一面板状态：每次只能打开一个
  const [activePanel, setActivePanel] = useState<
    'params' | 'memory' | 'appearance' | 'tools' | null
  >(null);
  const togglePanel = (panel: 'params' | 'memory' | 'appearance' | 'tools') => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  // MCP 工具列表
  const { tools: mcpTools, refreshTools } = useMcpStore();
  const connectedTools = mcpTools;

  // mount 时主动拉一次工具列表，确保显示最新状态
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    refreshTools();
  }, []);

  // @ 触发工具选择
  const [atQuery, setAtQuery] = useState('');
  const [showAtMenu, setShowAtMenu] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const filteredTools = atQuery
    ? connectedTools.filter(
        (t) =>
          t.name.toLowerCase().includes(atQuery.toLowerCase()) ||
          t.description.toLowerCase().includes(atQuery.toLowerCase())
      )
    : connectedTools;

  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showAtMenu) {
      if (e.key === 'Escape') {
        setShowAtMenu(false);
        setAtQuery('');
      }
    }
  }

  function handleComposerInput(e: React.FormEvent<HTMLTextAreaElement>) {
    const val = (e.target as HTMLTextAreaElement).value;
    const lastAt = val.lastIndexOf('@');
    if (lastAt >= 0) {
      const afterAt = val.slice(lastAt + 1);
      // 只在 @ 后面没有空格时显示菜单
      if (!afterAt.includes(' ') && connectedTools.length > 0) {
        setAtQuery(afterAt);
        setShowAtMenu(true);
        return;
      }
    }
    setShowAtMenu(false);
    setAtQuery('');
  }

  function handleSelectTool(tool: McpToolDef) {
    // 将工具名插入到输入框
    const input = composerRef.current;
    if (input) {
      const val = input.value;
      const lastAt = val.lastIndexOf('@');

      let newVal: string;
      if (lastAt >= 0) {
        // 如果有 @ 符号，替换 @query 部分
        newVal = val.slice(0, lastAt) + `@${tool.name} `;
      } else {
        // 如果没有 @ 符号，直接在末尾添加
        const trimmedVal = val.trim();
        newVal = trimmedVal ? `${trimmedVal} @${tool.name} ` : `@${tool.name} `;
      }

      // 触发 React 受控更新
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      nativeInputValueSetter?.call(input, newVal);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();

      // 将光标移到末尾
      setTimeout(() => {
        input.selectionStart = input.selectionEnd = newVal.length;
      }, 0);
    }
    setShowAtMenu(false);
    setAtQuery('');

    // 关闭工具面板
    setActivePanel(null);
  }

  return (
    <div className="w-full">
      <ComposerPrimitive.AttachmentDropzone className="rounded-2xl transition-colors data-[dragging]:bg-blue-50/50 dark:data-[dragging]:bg-blue-900/10">
        <ComposerPrimitive.Root className="group/composer flex flex-col rounded-2xl bg-white/90 dark:bg-white/5 backdrop-blur-md p-3 border border-gray-200/80 dark:border-white/10 shadow-lg dark:shadow-black/30 hover:border-blue-300/80 dark:hover:border-blue-500/40 focus-within:border-blue-400 dark:focus-within:border-blue-500/60 focus-within:shadow-xl focus-within:shadow-blue-500/10 transition-all duration-200 overflow-hidden">
          {/* 相关记忆显示 */}
          {enableMemory && relevantMemories.length > 0 && (
            <div className="mb-2 px-3 py-2 rounded-xl border border-purple-200/60 dark:border-purple-800/30 bg-purple-50/80 dark:bg-purple-900/10">
              <div className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400 mb-1 font-medium">
                <Brain size={11} />
                <span>已注入对话摘要</span>
              </div>
              <div className="text-xs text-purple-700 dark:text-purple-300 opacity-80 line-clamp-2 leading-relaxed">
                {relevantMemories[0]}
              </div>
            </div>
          )}

          {/* 附件显示 */}
          <ComposerPrimitive.Attachments>
            {({ attachment }) => (
              <AttachmentPrimitive.Root className="mb-2 flex items-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-2">
                {attachment.type === 'image' ? (
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-lg">
                    {attachment.file && (
                      <img
                        src={URL.createObjectURL(attachment.file)}
                        alt={attachment.name}
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <FileText size={20} className="text-blue-600 dark:text-blue-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[#1f1f1f] dark:text-[#e3e3e3]">
                    <AttachmentPrimitive.Name />
                  </div>
                  {attachment.file && (
                    <div className="text-xs text-[#70757a] dark:text-[#9aa0a6]">
                      {(attachment.file.size / 1024).toFixed(1)} KB
                    </div>
                  )}
                </div>
                <AttachmentPrimitive.Remove className="flex size-8 shrink-0 items-center justify-center rounded-full text-[#444746] hover:bg-[#444746]/8 dark:text-[#c4c7c5] dark:hover:bg-[#c4c7c5]/8">
                  <X size={16} />
                </AttachmentPrimitive.Remove>
              </AttachmentPrimitive.Root>
            )}
          </ComposerPrimitive.Attachments>

          {/* 外观面板 */}
          {activePanel === 'appearance' && <AppearancePanel onClose={() => setActivePanel(null)} />}

          {/* 记忆面板 - 内嵌弹窗，自适应高度 + 滚动 */}
          {activePanel === 'memory' && enableMemory && (
            <div
              className="mb-2 rounded-2xl border border-purple-200/60 dark:border-purple-800/40 bg-white/95 dark:bg-[#1a1b1e]/95 backdrop-blur-sm shadow-lg overflow-hidden"
              style={{ height: '480px' }}
            >
              <div className="overflow-y-auto h-full">
                <MemoryPanel threadId={threadId} />
              </div>
            </div>
          )}

          {/* MCP 工具面板 — 按服务器分组，可折叠 */}
          {activePanel === 'tools' &&
            connectedTools.length > 0 &&
            (() => {
              // 按 serverName 分组
              const grouped = connectedTools.reduce<Record<string, McpToolDef[]>>((acc, t) => {
                const key = t.serverName || t.serverId || '未知服务器';
                if (!acc[key]) acc[key] = [];
                acc[key].push(t);
                return acc;
              }, {});
              const serverNames = Object.keys(grouped);

              return (
                <div
                  className="mb-2 rounded-2xl border border-cyan-200/60 dark:border-cyan-800/40 bg-white/95 dark:bg-[#1a1b1e]/95 backdrop-blur-sm shadow-lg overflow-hidden"
                  style={{ height: '480px' }}
                >
                  <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      MCP 工具（{connectedTools.length}）
                    </span>
                    <span className="text-xs text-gray-400">输入 @ 可快速选择</span>
                  </div>
                  <div className="overflow-y-auto h-full">
                    {serverNames.map((serverName) => (
                      <McpServerGroup
                        key={serverName}
                        serverName={serverName}
                        tools={grouped[serverName]}
                        onSelectTool={handleSelectTool}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}

          {/* 参数面板 */}
          {activePanel === 'params' && (
            <div className="mb-2 px-4 py-3 bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 dark:from-gray-800 dark:via-blue-900/20 dark:to-purple-900/20 rounded-2xl space-y-3 border-2 border-blue-200/50 dark:border-blue-800/30 shadow-inner">
              {/* Temperature */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[#444746] dark:text-[#c4c7c5]">
                    Temperature
                  </label>
                  <span className="text-xs text-[#70757a] dark:text-[#9aa0a6]">{temperature}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-[#0066ff]"
                />
                <p className="mt-0.5 text-[10px] text-[#70757a] dark:text-[#9aa0a6]">
                  控制输出的随机性。较高的值使输出更随机，较低的值使输出更确定。
                </p>
              </div>

              {/* Max Tokens */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[#444746] dark:text-[#c4c7c5]">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="32000"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value) || 4096)}
                    className="w-20 px-2 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-[#1f1f1f] dark:text-[#e3e3e3]"
                  />
                </div>
                <p className="text-[10px] text-[#70757a] dark:text-[#9aa0a6]">
                  生成的最大 token 数量。较大的值允许更长的响应。
                </p>
              </div>

              {/* Top P */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[#444746] dark:text-[#c4c7c5]">
                    Top P
                  </label>
                  <span className="text-xs text-[#70757a] dark:text-[#9aa0a6]">
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
                  className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-[#0066ff]"
                />
                <p className="mt-0.5 text-[10px] text-[#70757a] dark:text-[#9aa0a6]">
                  核采样参数。较低的值使输出更集中，较高的值使输出更多样化。
                </p>
              </div>

              {/* Frequency Penalty */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[#444746] dark:text-[#c4c7c5]">
                    Frequency Penalty
                  </label>
                  <span className="text-xs text-[#70757a] dark:text-[#9aa0a6]">
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
                  className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-[#0066ff]"
                />
                <p className="mt-0.5 text-[10px] text-[#70757a] dark:text-[#9aa0a6]">
                  降低重复词语的频率。较高的值会减少重复内容。
                </p>
              </div>

              {/* Presence Penalty */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[#444746] dark:text-[#c4c7c5]">
                    Presence Penalty
                  </label>
                  <span className="text-xs text-[#70757a] dark:text-[#9aa0a6]">
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
                  className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-[#0066ff]"
                />
                <p className="mt-0.5 text-[10px] text-[#70757a] dark:text-[#9aa0a6]">
                  鼓励讨论新话题。较高的值会增加话题多样性。
                </p>
              </div>
            </div>
          )}

          {/* 输入框 */}
          <div className="relative">
            <ComposerPrimitive.Input
              placeholder={
                connectedTools.length > 0
                  ? '输入消息，或用 @ 选择 MCP 工具...'
                  : '输入消息或粘贴图片...'
              }
              addAttachmentOnPaste
              className="block min-h-6 w-full resize-none bg-transparent px-3 py-2 text-[#1f1f1f] outline-none placeholder:text-[#70757a] dark:text-[#e3e3e3] dark:placeholder:text-[#9aa0a6]"
              onInput={handleComposerInput}
              onKeyDown={handleComposerKeyDown}
              ref={(el) => {
                composerRef.current = el;
              }}
            />
            {/* @ 工具选择菜单 */}
            {showAtMenu && filteredTools.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 w-full max-w-xs max-h-52 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1f20] shadow-xl z-50">
                <div className="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
                  MCP 工具 — 选择后 AI 将优先使用该工具
                </div>
                {filteredTools.map((tool) => (
                  <button
                    key={tool.name}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectTool(tool);
                    }}
                    className="w-full flex items-start gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                  >
                    <div className="mt-0.5 size-5 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold">
                        T
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                        {tool.name}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {tool.description || tool.serverName}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 按钮?*/}
          <div className="flex w-full items-center text-[#444746] dark:text-[#c4c7c5]">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <ComposerPrimitive.AddAttachment
                multiple
                className="flex size-10 items-center justify-center rounded-full transition-all hover:bg-[#444746]/8 dark:hover:bg-[#c4c7c5]/8"
              >
                <Paperclip size={20} />
              </ComposerPrimitive.AddAttachment>

              {/* 工具按钮组 */}
              <button
                type="button"
                onClick={() => togglePanel('params')}
                className={`flex h-10 items-center justify-center gap-1.5 rounded-full px-3 text-sm transition-all hover:scale-105 font-medium ${
                  activePanel === 'params'
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                    : 'hover:bg-blue-100 dark:hover:bg-blue-900/30'
                }`}
              >
                <Settings size={16} />
                <span>参数</span>
              </button>

              {enableMemory && (
                <button
                  type="button"
                  onClick={() => togglePanel('memory')}
                  className={`flex h-10 items-center justify-center gap-1.5 rounded-full px-3 text-sm transition-all hover:scale-105 font-medium ${
                    activePanel === 'memory'
                      ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                      : 'hover:bg-purple-100 dark:hover:bg-purple-900/30'
                  }`}
                >
                  <Brain size={16} />
                  <span>记忆</span>
                </button>
              )}

              {onShowSwitchModel && (
                <button
                  type="button"
                  onClick={onShowSwitchModel}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-full px-3 text-sm transition-all hover:bg-green-100 dark:hover:bg-green-900/30 hover:scale-105 font-medium"
                >
                  <AtSign size={16} />
                  <span>模型</span>
                </button>
              )}
              {onShowSetRole && (
                <button
                  type="button"
                  onClick={onShowSetRole}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-full px-3 text-sm transition-all hover:bg-orange-100 dark:hover:bg-orange-900/30 hover:scale-105 font-medium"
                >
                  <User size={16} />
                  <span>角色</span>
                </button>
              )}

              {/* 外观设置按钮 */}
              <button
                type="button"
                onClick={() => togglePanel('appearance')}
                className={`flex h-10 items-center justify-center gap-1.5 rounded-full px-3 text-sm transition-all hover:scale-105 font-medium ${
                  activePanel === 'appearance'
                    ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                    : 'hover:bg-indigo-100 dark:hover:bg-indigo-900/30'
                }`}
              >
                <Palette size={16} />
                <span>外观</span>
              </button>

              {/* MCP 工具按钮 — 有已连接工具时显示 */}
              {connectedTools.length > 0 && (
                <button
                  type="button"
                  onClick={() => togglePanel('tools')}
                  className={`flex h-10 items-center justify-center gap-1.5 rounded-full px-3 text-sm transition-all hover:scale-105 font-medium ${
                    activePanel === 'tools'
                      ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400'
                      : 'hover:bg-cyan-100 dark:hover:bg-cyan-900/30'
                  }`}
                  title="MCP 工具"
                >
                  <svg
                    className="size-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
                    />
                  </svg>
                  <span>工具 {connectedTools.length}</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* AI 处理中：显示停止按钮（带旋转动画圆环?*/}
              <AuiIf condition={(s) => s.thread.isRunning}>
                <ComposerPrimitive.Cancel className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-white dark:bg-[#2d2e2f] border-2 border-gray-200 dark:border-gray-600 text-[#444746] dark:text-[#c4c7c5] transition-all hover:border-red-400 hover:text-red-500 dark:hover:border-red-500 dark:hover:text-red-400 shadow-md group">
                  {/* 旋转圆环 */}
                  <svg className="absolute inset-0 size-full animate-spin" viewBox="0 0 40 40">
                    <circle
                      cx="20"
                      cy="20"
                      r="17"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeDasharray="60 48"
                      strokeLinecap="round"
                      className="text-blue-400 dark:text-blue-500 opacity-70"
                    />
                  </svg>
                  <Square size={12} fill="currentColor" className="relative z-10" />
                </ComposerPrimitive.Cancel>
              </AuiIf>

              {/* 空闲中：输入为空时灰色禁用，有内容时蓝色发?*/}
              <AuiIf condition={(s) => !s.thread.isRunning}>
                <ComposerPrimitive.Send className="flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-all duration-200 shadow-lg disabled:bg-gray-200 disabled:dark:bg-gray-700 disabled:text-gray-400 disabled:dark:text-gray-500 disabled:shadow-none disabled:scale-95 bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 hover:scale-110 hover:shadow-xl active:scale-95">
                  <SendHorizonal size={18} />
                </ComposerPrimitive.Send>
              </AuiIf>
            </div>
          </div>
        </ComposerPrimitive.Root>
      </ComposerPrimitive.AttachmentDropzone>
    </div>
  );
};

// ==================== 外观设置 ====================

const APPEARANCE_KEY = 'ai_chat_appearance';

interface AppearanceConfig {
  fontSize: number;
  bubbleRadius: number;
  userBubbleColor: string;
  aiBubbleColor: string;
  bgColor: string;
  lineHeight: number;
  paragraphSpacing: number;
  fontFamily: string;
}

const DEFAULT_APPEARANCE: AppearanceConfig = {
  fontSize: 14,
  bubbleRadius: 16,
  userBubbleColor: '#6366f1',
  aiBubbleColor: '#ffffff',
  bgColor: '',
  lineHeight: 1.2,
  paragraphSpacing: 0.5,
  fontFamily: 'system',
};

function loadAppearance(): AppearanceConfig {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    return raw ? { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) } : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

// ---- 全局单例 store，所有组件共享 ----
const appearanceStore = {
  cfg: loadAppearance(),
  listeners: new Set<() => void>(),
  update(patch: Partial<AppearanceConfig>) {
    this.cfg = { ...this.cfg, ...patch };
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(this.cfg));
    this.listeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
};

function useAppearance() {
  const [cfg, setCfg] = useState(() => appearanceStore.cfg);
  useEffect(() => {
    const unsub = appearanceStore.subscribe(() => setCfg({ ...appearanceStore.cfg }));
    return () => {
      unsub();
    };
  }, []);
  return { cfg, update: (patch: Partial<AppearanceConfig>) => appearanceStore.update(patch) };
}

// CSS 变量注入（在 ChatInterface 顶层调用一次即可）
function useApplyAppearance() {
  const { cfg } = useAppearance();
  useEffect(() => {
    const root = document.documentElement;
    const fontMap: Record<string, string> = {
      system: 'system-ui, -apple-system, sans-serif',
      serif: 'Georgia, "Times New Roman", serif',
      mono: '"Courier New", "Consolas", monospace',
    };
    root.style.setProperty('--chat-font-size', `${cfg.fontSize}px`);
    root.style.setProperty('--chat-line-height', `${cfg.lineHeight}`);
    root.style.setProperty('--chat-paragraph-spacing', `${cfg.paragraphSpacing}em`);
    root.style.setProperty('--chat-bubble-radius', `${cfg.bubbleRadius}px`);
    root.style.setProperty('--chat-user-bubble', cfg.userBubbleColor);
    // 深色模式下 AI 气泡使用深色背景，浅色模式使用用户设置的颜色
    const isDark = document.documentElement.classList.contains('dark');
    const aiBubble = isDark
      ? cfg.aiBubbleColor === '#ffffff'
        ? 'rgba(255,255,255,0.06)'
        : cfg.aiBubbleColor
      : cfg.aiBubbleColor || '#ffffff';
    root.style.setProperty('--chat-ai-bubble', aiBubble);
    root.style.setProperty('--chat-font-family', fontMap[cfg.fontFamily] || fontMap.system);
  }, [cfg]);

  // 单独监听主题切换，实时更新 AI 气泡颜色
  useEffect(() => {
    const updateBubbleColor = () => {
      const isDark = document.documentElement.classList.contains('dark');
      const current = appearanceStore.cfg.aiBubbleColor;
      const aiBubble = isDark
        ? current === '#ffffff'
          ? 'rgba(255,255,255,0.06)'
          : current
        : current || '#ffffff';
      document.documentElement.style.setProperty('--chat-ai-bubble', aiBubble);
    };
    const observer = new MutationObserver(updateBubbleColor);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
}

const FONT_FAMILIES: { value: string; label: string; style: string }[] = [
  { value: 'system', label: '系统默认', style: 'system-ui, sans-serif' },
  { value: 'serif', label: '衬线字体', style: 'Georgia, serif' },
  { value: 'mono', label: '等宽字体', style: '"Courier New", monospace' },
];

const AppearancePanel = ({ onClose }: { onClose: () => void }) => {
  const { cfg, update } = useAppearance();

  return (
    <div className="mb-2 rounded-2xl border border-indigo-200/60 dark:border-indigo-800/40 bg-white/95 dark:bg-[#1a1b1e]/95 backdrop-blur-sm shadow-lg overflow-hidden">
      {/* 标题?*/}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
          <Palette size={14} className="text-indigo-500" />
          外观设置
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
        {/* 字体大小 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">字体大小</label>
            <span className="text-xs text-gray-500">{cfg.fontSize}px</span>
          </div>
          <input
            type="range"
            min={12}
            max={20}
            step={1}
            value={cfg.fontSize}
            onChange={(e) => update({ fontSize: Number(e.target.value) })}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-indigo-500 bg-gray-200 dark:bg-gray-700"
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
            <span>小</span>
            <span>小</span>
          </div>
        </div>

        {/* 行高 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">行间距</label>
            <span className="text-xs text-gray-500">{cfg.lineHeight.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={0.8}
            max={2.0}
            step={0.1}
            value={cfg.lineHeight}
            onChange={(e) => update({ lineHeight: Number(e.target.value) })}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-indigo-500 bg-gray-200 dark:bg-gray-700"
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
            <span>紧凑</span>
            <span>宽松</span>
          </div>
        </div>

        {/* 段落间距 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">段落间距</label>
            <span className="text-xs text-gray-500">{cfg.paragraphSpacing.toFixed(1)}em</span>
          </div>
          <input
            type="range"
            min={0}
            max={2.0}
            step={0.1}
            value={cfg.paragraphSpacing}
            onChange={(e) => update({ paragraphSpacing: Number(e.target.value) })}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-indigo-500 bg-gray-200 dark:bg-gray-700"
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
            <span>无</span>
            <span>宽</span>
          </div>
        </div>

        {/* 气泡圆角 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">气泡圆角</label>
            <span className="text-xs text-gray-500">{cfg.bubbleRadius}px</span>
          </div>
          <input
            type="range"
            min={4}
            max={24}
            step={2}
            value={cfg.bubbleRadius}
            onChange={(e) => update({ bubbleRadius: Number(e.target.value) })}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-indigo-500 bg-gray-200 dark:bg-gray-700"
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
            <span>方形</span>
            <span>圆形</span>
          </div>
        </div>

        {/* 字体 */}
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1.5">
            字体
          </label>
          <div className="flex gap-1.5">
            {FONT_FAMILIES.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => update({ fontFamily: f.value })}
                className={`flex-1 py-1 text-[11px] rounded-lg border transition-all ${
                  cfg.fontFamily === f.value
                    ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                }`}
                style={{ fontFamily: f.style }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* 用户气泡颜色 */}
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1.5">
            我的消息颜色
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={cfg.userBubbleColor}
              onChange={(e) => update({ userBubbleColor: e.target.value })}
              className="w-8 h-8 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-700 p-0.5"
            />
            <div className="flex gap-1.5 flex-wrap">
              {[
                '#6366f1',
                '#3b82f6',
                '#10b981',
                '#f59e0b',
                '#ef4444',
                '#ec4899',
                '#8b5cf6',
                '#0ea5e9',
              ].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update({ userBubbleColor: c })}
                  className={`size-5 rounded-full transition-transform hover:scale-110 ${cfg.userBubbleColor === c ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* AI 气泡颜色 */}
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1.5">
            AI 消息背景
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={cfg.aiBubbleColor || '#ffffff'}
              onChange={(e) => update({ aiBubbleColor: e.target.value })}
              className="w-8 h-8 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-700 p-0.5"
            />
            <div className="flex gap-1.5 flex-wrap">
              {[
                '#ffffff',
                '#f8fafc',
                '#f0f9ff',
                '#f0fdf4',
                '#fefce8',
                '#fdf4ff',
                '#1e1f20',
                '#1a1b1e',
              ].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update({ aiBubbleColor: c })}
                  className={`size-5 rounded-full border border-gray-200 dark:border-gray-600 transition-transform hover:scale-110 ${cfg.aiBubbleColor === c ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 重置 */}
      <div className="px-4 pb-3 flex justify-end">
        <button
          type="button"
          onClick={() => update(DEFAULT_APPEARANCE)}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          恢复默认
        </button>
      </div>
    </div>
  );
};

// 段落文本组件：支持 Markdown 渲染，可切换查看原始格式
// showRaw 状态由父级 AssistantMessageContent 通过 context 传入
const RawModeContext = createContext<{ showRaw: boolean; toggleRaw: () => void }>({
  showRaw: false,
  toggleRaw: () => {},
});

const ThreadCallbackContext = createContext<{
  onThreadUpdated?: () => void;
  onMessageDeleted?: () => void;
}>({});

const ParagraphText = (_props: unknown) => {
  const { showRaw } = useContext(RawModeContext);

  const chartSyntaxHighlighter = useMemo(
    () =>
      ({
        language,
        code,
        components: { Pre, Code },
      }: {
        language: string;
        code: string;
        components: {
          Pre: React.ComponentType<React.HTMLAttributes<HTMLPreElement>>;
          Code: React.ComponentType<React.HTMLAttributes<HTMLElement>>;
        };
      }) => {
        if (language === 'chart') {
          return <ChartBlock code={code} />;
        }
        return (
          <Pre>
            <Code className={`language-${language}`}>{code}</Code>
          </Pre>
        );
      },
    []
  );

  const componentsByLanguage = useMemo(
    () => ({ chart: { SyntaxHighlighter: chartSyntaxHighlighter } }),
    [chartSyntaxHighlighter]
  );

  if (showRaw) {
    return <RawTextView />;
  }

  return (
    <MarkdownTextPrimitive
      className="chat-message-content prose prose-sm dark:prose-invert min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere]
        prose-p:my-1 prose-p:leading-relaxed
        prose-headings:font-semibold prose-headings:my-2
        prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
        prose-code:text-xs prose-code:bg-gray-100 prose-code:dark:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-code:break-words
        prose-pre:my-2 prose-pre:max-w-full prose-pre:rounded-lg prose-pre:bg-gray-100 prose-pre:dark:bg-gray-800 prose-pre:text-gray-800 prose-pre:dark:text-gray-200 prose-pre:p-3 prose-pre:overflow-x-auto prose-pre:text-xs
        prose-blockquote:border-l-2 prose-blockquote:border-gray-300 prose-blockquote:pl-3 prose-blockquote:text-gray-500
        prose-strong:font-semibold prose-strong:text-inherit
        prose-a:text-blue-500 prose-a:no-underline hover:prose-a:underline
        prose-table:text-sm prose-th:font-semibold prose-td:py-1"
      smooth={false}
      componentsByLanguage={componentsByLanguage}
    />
  );
};

// 原始文本视图（只在 text part 上下文里安全使用）
const RawTextView = () => {
  const { text } = useMessagePartText();
  return (
    <pre className="chat-message-content max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono text-xs leading-relaxed text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 overflow-x-auto">
      {text}
    </pre>
  );
};

// 用户消息纯文本组件（不渲染 Markdown）
const PlainText = () => {
  const { text } = useMessagePartText();
  const paragraphs = text.split(/\n\n+/);
  return (
    <>
      {paragraphs.map((para, i) => (
        <p
          key={i}
          className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
          style={{ marginBottom: i < paragraphs.length - 1 ? '0.5em' : 0 }}
        >
          {para}
        </p>
      ))}
    </>
  );
};

// 分支选择器组件
const BranchPicker = () => (
  <BranchPickerPrimitive.Root
    hideWhenSingleBranch
    className="inline-flex items-center gap-0.5 text-xs text-[#70757a] dark:text-[#9aa0a6]"
  >
    <BranchPickerPrimitive.Previous className="flex size-6 items-center justify-center rounded-full hover:bg-[#444746]/8 dark:hover:bg-[#c4c7c5]/8 disabled:opacity-30 transition-opacity">
      <ChevronLeft size={12} />
    </BranchPickerPrimitive.Previous>
    <span className="tabular-nums">
      <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
    </span>
    <BranchPickerPrimitive.Next className="flex size-6 items-center justify-center rounded-full hover:bg-[#444746]/8 dark:hover:bg-[#c4c7c5]/8 disabled:opacity-30 transition-opacity">
      <ChevronRight size={12} />
    </BranchPickerPrimitive.Next>
  </BranchPickerPrimitive.Root>
);

// 用户消息编辑 Composer
const UserEditComposer = () => (
  <div className="flex flex-col items-end gap-2 mb-4">
    <ComposerPrimitive.Root className="w-full max-w-[85%]">
      <div
        className="rounded-3xl px-4 py-3 shadow-lg"
        style={{
          background: 'linear-gradient(135deg, #d4e3fc 0%, #b8d4fb 50%, #a8c7fa 100%)',
          border: '1px solid rgba(66, 133, 244, 0.2)',
        }}
      >
        <ComposerPrimitive.Input
          autoFocus
          className="w-full resize-none bg-transparent text-[#1f1f1f] outline-none placeholder:text-[#70757a] min-h-[2rem]"
        />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <ComposerPrimitive.Cancel className="rounded-full px-3 py-1.5 text-xs font-medium text-[#444746] hover:bg-[#444746]/8 dark:text-[#c4c7c5] dark:hover:bg-[#c4c7c5]/8 transition-colors">
          取消
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send className="rounded-full bg-gradient-to-br from-blue-500 to-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:from-blue-600 hover:to-blue-700 transition-all">
          保存
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  </div>
);

// 用户头像组件
const UserAvatar = () => {
  const avatar = useContext(UserAvatarContext);
  return (
    <div
      className={`shrink-0 w-8 h-8 rounded-full bg-gradient-to-br ${avatar.bg} flex items-center justify-center shadow-md text-base select-none`}
    >
      {avatar.emoji}
    </div>
  );
};

// 用户消息操作栏（含删除）
const UserMessageActions = ({ messageId }: { messageId: string | null }) => {
  const { onMessageDeleted } = useContext(ThreadCallbackContext);

  const handleDelete = async () => {
    if (!messageId) return;
    const confirmed = await ask('确定删除这条消息？', { title: '删除消息' });
    if (!confirmed) return;
    try {
      await aiChatApi.deleteMessage(messageId);
      onMessageDeleted?.();
    } catch (e) {
      console.error('删除消息失败:', e);
    }
  };

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="always"
      autohideFloat="always"
      className="flex items-center gap-0.5 mb-1 data-[floating]:opacity-0 data-[floating]:group-hover/message:opacity-100 data-[floating]:transition-opacity"
    >
      <ActionBarPrimitive.Edit className="flex size-8 items-center justify-center rounded-full text-[#444746] hover:bg-[#444746]/8 dark:text-[#c4c7c5] dark:hover:bg-[#c4c7c5]/8">
        <Pencil size={13} />
      </ActionBarPrimitive.Edit>
      <ActionBarPrimitive.Copy className="flex size-8 items-center justify-center rounded-full text-[#444746] hover:bg-[#444746]/8 dark:text-[#c4c7c5] dark:hover:bg-[#c4c7c5]/8">
        <Copy size={13} />
      </ActionBarPrimitive.Copy>
      {messageId && (
        <button
          onClick={handleDelete}
          title="删除消息"
          className="flex size-8 items-center justify-center rounded-full text-[#444746] hover:bg-red-50 hover:text-red-500 dark:text-[#c4c7c5] dark:hover:bg-red-900/10 dark:hover:text-red-400 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      )}
    </ActionBarPrimitive.Root>
  );
};

// Gemini 风格的消息
const GeminiMessage = () => {
  const [msgId, setMsgId] = useState<string | null>(null);

  return (
    <MessagePrimitive.Root className="group/message relative mb-4 flex w-full min-w-0 flex-col overflow-hidden">
      {/* 用 AuiIf 在消息上下文内捕获消息 id，存入 state 供子组件使用 */}
      <AuiIf
        condition={(s) => {
          try {
            const id = (s.message as { id?: string }).id ?? null;
            if (id !== msgId) setTimeout(() => setMsgId(id), 0);
          } catch {
            /* 消息已被删除，忽略 */
          }
          return true;
        }}
      >
        <></>
      </AuiIf>
      {/* 用户消息 */}
      <AuiIf condition={(s) => s.message.role === 'user'}>
        <div className="flex w-full min-w-0 flex-col items-end gap-2">
          {/* 显示用户发送的附件 */}
          <MessagePrimitive.Attachments>
            {({ attachment }) => {
              if (attachment.type === 'image') {
                if (attachment.file) {
                  return (
                    <div className="relative max-w-xs overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
                      <img
                        src={URL.createObjectURL(attachment.file)}
                        alt={attachment.name}
                        className="w-full h-auto object-cover"
                      />
                    </div>
                  );
                }
                if (attachment.content) {
                  const contentArray = attachment.content as Array<{
                    type: string;
                    image?: string;
                  }>;
                  const imageContent = contentArray.find((c) => c.type === 'image');
                  if (imageContent && imageContent.image) {
                    return (
                      <div className="relative max-w-xs overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
                        <img
                          src={imageContent.image}
                          alt={attachment.name}
                          className="w-full h-auto object-cover"
                        />
                      </div>
                    );
                  }
                }
              }
              if (attachment.type === 'document' && attachment.file) {
                return (
                  <div className="flex items-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2">
                    <FileText size={16} className="text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-sm text-[#1f1f1f] dark:text-[#e3e3e3] truncate">
                      {attachment.name}
                    </span>
                  </div>
                );
              }
              return null;
            }}
          </MessagePrimitive.Attachments>

          {/* 消息气泡 + 操作栏 */}
          <div className="flex w-full min-w-0 items-end justify-end gap-2">
            {/* 操作栏（hover 显示） */}
            <UserMessageActions messageId={msgId} />

            {/* 消息气泡 */}
            <div
              className="chat-message-content relative min-w-0 max-w-[85%] overflow-hidden break-words [overflow-wrap:anywhere] px-4 py-3 shadow-md text-white"
              style={{
                background: 'var(--chat-user-bubble, #6366f1)',
                borderRadius: 'var(--chat-bubble-radius, 16px)',
                fontSize: 'var(--chat-font-size, 14px)',
                lineHeight: 'var(--chat-line-height, 1.6)',
                fontFamily: 'var(--chat-font-family, system-ui)',
              }}
            >
              <MessagePrimitive.Parts>
                {({ part }) => {
                  if (part.type === 'text') {
                    return (
                      <div className="min-w-0 max-w-full">
                        <PlainText />
                      </div>
                    );
                  }
                  return null;
                }}
              </MessagePrimitive.Parts>
            </div>

            {/* 用户头像 */}
            <UserAvatar />
          </div>

          {/* 分支选择?*/}
          <div className="flex justify-end pr-1">
            <BranchPicker />
          </div>
        </div>
      </AuiIf>

      {/* 助手消息 */}
      <AuiIf condition={(s) => s.message.role === 'assistant'}>
        <AssistantMessageContent messageId={msgId} />
      </AuiIf>
    </MessagePrimitive.Root>
  );
};

// ── Assistant 消息内容组件（持有原始格式切换状态）────────────────────────────
const AssistantMessageContent = ({ messageId }: { messageId: string | null }) => {
  const [showRaw, setShowRaw] = useState(false);
  const toggleRaw = () => setShowRaw((v) => !v);
  const renderHtmlCodeRef = useRef<string>('');

  const { onMessageDeleted } = useContext(ThreadCallbackContext);

  const handleDeleteMessage = async () => {
    if (!messageId) {
      alert('无法获取消息 ID');
      return;
    }
    const confirmed = await ask('确定删除这条消息？', { title: '删除消息' });
    if (!confirmed) return;
    try {
      await aiChatApi.deleteMessage(messageId);
      onMessageDeleted?.();
    } catch (e) {
      console.error('删除消息失败:', e);
    }
  };

  return (
    <RawModeContext.Provider value={{ showRaw, toggleRaw }}>
      <div className="flex min-w-0 items-start gap-3 overflow-hidden">
        {/* AI 头像 */}
        <div className="relative mt-1 shrink-0">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 blur-sm opacity-50" />
          <div className="relative p-2 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/30">
            <Sparkles className="size-4 text-white" />
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-hidden">
          {/* tool-call 渲染在气泡外（不受气泡样式影响） */}
          <AuiIf condition={(s) => s.message.content.some((c) => c.type === 'tool-call')}>
            <MessagePrimitive.Parts>
              {({ part }) => {
                if (part.type === 'tool-call') {
                  return (
                    part.toolUI ?? (
                      <ToolCard
                        toolName={part.toolName}
                        args={part.args}
                        result={part.result}
                        isError={part.isError}
                        isRunning={part.result === undefined && !part.isError}
                      />
                    )
                  );
                }
                return null;
              }}
            </MessagePrimitive.Parts>
          </AuiIf>

          {/* 文本气泡：只在有文本内容时显示 */}
          <AuiIf
            condition={(s) =>
              s.message.content.some(
                (c) => c.type === 'text' && (c as { text?: string }).text?.trim()
              ) || s.message.status?.type === 'running'
            }
          >
            <div
              className="chat-message-content min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] px-4 py-3 shadow-sm border border-gray-200/80 dark:border-white/10 text-[#1f1f1f] dark:text-[#e3e3e3]"
              style={{
                background: 'var(--chat-ai-bubble, rgba(255,255,255,0.9))',
                borderRadius: 'var(--chat-bubble-radius, 16px)',
                fontSize: 'var(--chat-font-size, 14px)',
                lineHeight: 'var(--chat-line-height, 1.2)',
                fontFamily: 'var(--chat-font-family, system-ui)',
              }}
            >
              {/* 等待第一个 token 时显示 loading 骨架 */}
              <AuiIf
                condition={(s) =>
                  s.message.status?.type === 'running' &&
                  s.message.content
                    .filter((c) => c.type === 'text')
                    .every((c) => !(c as { text?: string }).text)
                }
              >
                <div className="flex items-center gap-1.5 py-0.5">
                  <span className="size-2 rounded-full bg-[#0066ff]/60 animate-bounce [animation-delay:-0.3s]" />
                  <span className="size-2 rounded-full bg-[#0066ff]/60 animate-bounce [animation-delay:-0.15s]" />
                  <span className="size-2 rounded-full bg-[#0066ff]/60 animate-bounce" />
                </div>
              </AuiIf>
              {/* 只渲染 text parts，用独立组件包裹确保在正确的 part 上下文里 */}
              <MessagePrimitive.Parts components={{ Text: ParagraphText }} />
            </div>
          </AuiIf>

          {/* 错误显示 */}
          <MessagePrimitive.Error>
            <ErrorPrimitive.Root className="mt-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
              <div className="flex items-start gap-2">
                <svg
                  className="size-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <ErrorPrimitive.Message className="text-sm text-red-600 dark:text-red-400" />
              </div>
            </ErrorPrimitive.Root>
          </MessagePrimitive.Error>

          {/* 操作栏 + 分支选择器 */}
          <div className="mt-2 -ml-2 flex items-center justify-between">
            <ActionBarPrimitive.Root
              hideWhenRunning
              autohide="not-last"
              autohideFloat="single-branch"
              className="flex items-center gap-0.5 opacity-100"
            >
              <ActionBarPrimitive.FeedbackPositive className="flex size-8 items-center justify-center rounded-full text-[#444746] hover:bg-[#444746]/8 dark:text-[#c4c7c5] dark:hover:bg-[#c4c7c5]/8">
                <ThumbsUp size={14} />
              </ActionBarPrimitive.FeedbackPositive>
              <ActionBarPrimitive.FeedbackNegative className="flex size-8 items-center justify-center rounded-full text-[#444746] hover:bg-[#444746]/8 dark:text-[#c4c7c5] dark:hover:bg-[#c4c7c5]/8">
                <ThumbsDown size={14} />
              </ActionBarPrimitive.FeedbackNegative>
              <ActionBarPrimitive.Reload className="flex size-8 items-center justify-center rounded-full text-[#444746] hover:bg-[#444746]/8 dark:text-[#c4c7c5] dark:hover:bg-[#c4c7c5]/8">
                <RotateCw size={14} />
              </ActionBarPrimitive.Reload>
              <ActionBarPrimitive.Copy className="flex size-8 items-center justify-center rounded-full text-[#444746] hover:bg-[#444746]/8 dark:text-[#c4c7c5] dark:hover:bg-[#c4c7c5]/8">
                <Copy size={14} />
              </ActionBarPrimitive.Copy>
              {/* 切换原始格式按钮 */}
              <button
                onClick={toggleRaw}
                title={showRaw ? '查看渲染格式' : '查看原始格式'}
                className={`flex size-8 items-center justify-center rounded-full transition-colors ${
                  showRaw
                    ? 'text-[#0066ff] bg-[#0066ff]/10'
                    : 'text-[#444746] hover:bg-[#444746]/8 dark:text-[#c4c7c5] dark:hover:bg-[#c4c7c5]/8'
                }`}
              >
                <Code size={14} />
              </button>
              {/* render_html 预览按钮：仅在消息包含 render_html tool call 时显示 */}
              <AuiIf
                condition={(s) => {
                  const tc = s.message.content.find(
                    (c) =>
                      c.type === 'tool-call' &&
                      (c as { toolName?: string }).toolName === 'render_html'
                  ) as { args?: { code?: string }; argsText?: string } | undefined;
                  // args 可能是对象（实时生成）或 argsText 字符串（历史加载）
                  let code = tc?.args?.code;
                  if (!code && tc?.argsText) {
                    try {
                      code = JSON.parse(tc.argsText)?.code;
                    } catch {
                      /* ignore */
                    }
                  }
                  if (code) renderHtmlCodeRef.current = code;
                  return !!code;
                }}
              >
                <button
                  onClick={() => {
                    if (renderHtmlCodeRef.current) {
                      window.dispatchEvent(
                        new CustomEvent('artifact-render', { detail: renderHtmlCodeRef.current })
                      );
                    }
                  }}
                  title="预览代码"
                  className="flex size-8 items-center justify-center rounded-full text-[#444746] hover:bg-[#444746]/8 dark:text-[#c4c7c5] dark:hover:bg-[#c4c7c5]/8 transition-colors"
                >
                  <Eye size={14} />
                </button>
              </AuiIf>
              {/* 更多操作下拉菜单 */}
              <ActionBarMorePrimitive.Root>
                <ActionBarMorePrimitive.Trigger className="flex size-8 items-center justify-center rounded-full text-[#444746] hover:bg-[#444746]/8 dark:text-[#c4c7c5] dark:hover:bg-[#c4c7c5]/8">
                  <MoreHorizontal size={14} />
                </ActionBarMorePrimitive.Trigger>
                <ActionBarMorePrimitive.Content className="z-50 min-w-[120px] rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2d2e2f] p-1 shadow-xl">
                  <ActionBarPrimitive.Speak asChild>
                    <ActionBarMorePrimitive.Item className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#444746] dark:text-[#c4c7c5] hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
                      <Quote size={13} />
                      朗读
                    </ActionBarMorePrimitive.Item>
                  </ActionBarPrimitive.Speak>
                  {messageId && (
                    <>
                      <div className="my-1 border-t border-gray-100 dark:border-gray-700/50" />
                      <ActionBarMorePrimitive.Item
                        onClick={handleDeleteMessage}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 cursor-pointer"
                      >
                        <Trash2 size={13} />
                        删除消息
                      </ActionBarMorePrimitive.Item>
                    </>
                  )}
                </ActionBarMorePrimitive.Content>
              </ActionBarMorePrimitive.Root>
            </ActionBarPrimitive.Root>

            <BranchPicker />
          </div>
        </div>
      </div>
    </RawModeContext.Provider>
  );
};

// ── MCP 服务器工具分组组件（可折叠子级）────────────────────────────────────
const McpServerGroup = ({
  serverName,
  tools,
  onSelectTool,
}: {
  serverName: string;
  tools: McpToolDef[];
  onSelectTool: (tool: McpToolDef) => void;
}) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-b border-gray-50 dark:border-gray-800/50 last:border-0 overflow-hidden">
      {/* 服务器标题行 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
      >
        <span
          className={`text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
        >
          <ChevronRight size={12} />
        </span>
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex-1 min-w-0 truncate">
          {serverName}
        </span>
        <span className="text-xs text-gray-300 dark:text-gray-600 flex-shrink-0">
          {tools.length}
        </span>
      </button>

      {/* 工具列表 */}
      {expanded && (
        <div>
          {tools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              onClick={() => onSelectTool(tool)}
              className="w-full flex items-start gap-2 pl-8 pr-4 py-2 hover:bg-cyan-50 dark:hover:bg-cyan-900/10 transition-colors text-left"
            >
              <div className="mt-0.5 size-5 rounded bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center flex-shrink-0">
                <svg
                  className="size-3 text-cyan-600 dark:text-cyan-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
                  />
                </svg>
              </div>
              {/* min-w-0 是关键：让 flex 子元素可以收缩到比内容更小 */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                  {tool.originalName || tool.name}
                </p>
                {tool.description && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 line-clamp-2 break-words">
                    {tool.description}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
