import { invoke } from '@tauri-apps/api/tauri';
import type {
  ChatThread,
  ChatMessage,
  CreateThreadRequest,
  AddMessageRequest,
  UpdateThreadTitleRequest,
} from '../types/aiChat';

// ==================== 线程管理 ====================

export async function listThreads(): Promise<ChatThread[]> {
  return await invoke('ai_chat_list_threads');
}

export async function getThread(threadId: string): Promise<ChatThread | null> {
  const result = await invoke<ChatThread | null>('ai_chat_get_thread', { threadId });
  console.log('[aiChatApi] getThread result:', result);
  return result;
}

export async function createThread(request: CreateThreadRequest): Promise<ChatThread> {
  console.log('[aiChatApi] createThread request:', request);
  const result = await invoke<ChatThread>('ai_chat_create_thread', { request });
  console.log('[aiChatApi] createThread result:', result);
  return result;
}

export async function updateThreadTitle(request: UpdateThreadTitleRequest): Promise<void> {
  return await invoke('ai_chat_update_thread_title', { request });
}

export async function updateThreadModel(request: {
  thread_id: string;
  provider_id: string;
  model: string;
}): Promise<void> {
  return await invoke('ai_chat_update_thread_model', { request });
}

export async function updateThreadSystemPrompt(request: {
  thread_id: string;
  system_prompt: string;
}): Promise<void> {
  return await invoke('ai_chat_update_thread_system_prompt', { request });
}

export async function updateThreadParams(request: {
  thread_id: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
}): Promise<void> {
  return await invoke('ai_chat_update_thread_params', { request });
}

export async function archiveThread(threadId: string): Promise<void> {
  return await invoke('ai_chat_archive_thread', { threadId });
}

export async function unarchiveThread(threadId: string): Promise<void> {
  return await invoke('ai_chat_unarchive_thread', { threadId });
}

export async function deleteThread(threadId: string): Promise<void> {
  return await invoke('ai_chat_delete_thread', { threadId });
}

// ==================== 消息管理 ====================

export async function listMessages(threadId: string): Promise<ChatMessage[]> {
  return await invoke('ai_chat_list_messages', { threadId });
}

export async function addMessage(request: AddMessageRequest): Promise<ChatMessage> {
  return await invoke('ai_chat_add_message', { request });
}

export async function deleteMessage(messageId: string): Promise<void> {
  return await invoke('ai_chat_delete_message', { messageId });
}

export async function clearThreadMessages(threadId: string): Promise<void> {
  return await invoke('ai_chat_clear_thread_messages', { threadId });
}

// ==================== 统计 ====================

export async function getThreadMessageCount(threadId: string): Promise<number> {
  return await invoke('ai_chat_get_thread_message_count', { threadId });
}

export async function getTotalThreads(): Promise<number> {
  return await invoke('ai_chat_get_total_threads');
}

// ==================== 记忆管理 ====================

export async function addMemory(request: {
  user_id: string;
  memory: string;
  category: 'preference' | 'fact' | 'context' | 'history';
}): Promise<any> {
  return await invoke('ai_chat_add_memory', { request });
}

export async function listMemories(userId: string): Promise<any[]> {
  return await invoke('ai_chat_list_memories', { userId });
}

export async function searchMemories(request: {
  user_id: string;
  query: string;
  limit?: number;
}): Promise<any[]> {
  return await invoke('ai_chat_search_memories', { request });
}

export async function updateMemory(request: { memory_id: string; memory: string }): Promise<void> {
  return await invoke('ai_chat_update_memory', { request });
}

export async function deleteMemory(memoryId: string): Promise<void> {
  return await invoke('ai_chat_delete_memory', { memoryId });
}

export async function getMemoriesByCategory(userId: string, category: string): Promise<any[]> {
  return await invoke('ai_chat_get_memories_by_category', { userId, category });
}

export async function extractMemories(request: {
  user_id: string;
  messages: string[];
}): Promise<string[]> {
  return await invoke('ai_chat_extract_memories', { request });
}

// ==================== 对话摘要管理 ====================

export interface ThreadSummaryData {
  thread_id: string;
  summary: string;
  key_points: string; // JSON 字符串
  message_count: number;
  last_compressed_at: number;
  updated_at: number;
}

export async function getThreadSummary(threadId: string): Promise<ThreadSummaryData | null> {
  return await invoke('ai_chat_get_thread_summary', { threadId });
}

export async function upsertThreadSummary(request: {
  thread_id: string;
  summary: string;
  key_points: string;
  message_count: number;
  last_compressed_at: number;
}): Promise<void> {
  return await invoke('ai_chat_upsert_thread_summary', { request });
}

export async function deleteThreadSummary(threadId: string): Promise<void> {
  return await invoke('ai_chat_delete_thread_summary', { threadId });
}
