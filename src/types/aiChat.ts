// AI Chat 相关类型定义

export interface ChatThread {
  id: string;
  title: string;
  provider_id: string;
  model: string; // 每个对话使用的具体模型
  status: 'regular' | 'archived';
  created_at: number;
  updated_at: number;
  // AI 参数配置
  temperature: number;
  max_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  // 角色设定
  system_prompt: string; // 系统提示词/角色设定
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool_call' | 'tool_result';
  content: string;
  created_at: number;
}

export interface CreateThreadRequest {
  title: string;
  provider_id: string;
  model: string; // 创建对话时指定模型
  // AI 参数配置
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  // 角色设定
  system_prompt?: string;
}

export interface AddMessageRequest {
  thread_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool_call' | 'tool_result';
  content: string;
}

export interface UpdateThreadTitleRequest {
  thread_id: string;
  title: string;
}

// Mem0 记忆相关类型
export interface UserMemory {
  id: string;
  user_id: string;
  memory: string;
  category: 'preference' | 'fact' | 'context' | 'history';
  created_at: number;
  updated_at: number;
  relevance_score: number;
}

export interface MemorySearchRequest {
  query: string;
  user_id: string;
  limit?: number;
}

export interface AddMemoryRequest {
  user_id: string;
  memory: string;
  category: 'preference' | 'fact' | 'context' | 'history';
}

export interface UpdateMemoryRequest {
  memory_id: string;
  memory: string;
}

export interface ExtractMemoriesRequest {
  user_id: string;
  messages: string[];
}
