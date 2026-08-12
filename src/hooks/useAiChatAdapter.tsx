import { useCallback, useMemo } from 'react';
import * as aiChatApi from '../api/aiChatApi';

/**
 * 加载线程的历史消息
 */
export async function loadThreadMessages(threadId: string) {
  try {
    const messages = await aiChatApi.listMessages(threadId);
    return messages.map((msg) => ({
      id: msg.id,
      role: msg.role as 'user' | 'assistant' | 'system',
      content: [{ type: 'text' as const, text: msg.content }],
      createdAt: new Date(msg.created_at * 1000),
    }));
  } catch (error) {
    console.error('Failed to load thread messages:', error);
    return [];
  }
}

/**
 * 创建消息历史适配器
 * 用于持久化消息到数据库
 */
export function useAiChatHistoryAdapter(threadId: string) {
  const append = useCallback(
    async (params: { message: any; parentId: string | null }) => {
      try {
        // 保存消息到数据库
        await aiChatApi.addMessage({
          thread_id: threadId,
          role: params.message.role,
          content:
            typeof params.message.content === 'string'
              ? params.message.content
              : JSON.stringify(params.message.content),
        });
      } catch (error) {
        console.error('Failed to append message:', error);
      }
    },
    [threadId]
  );

  return useMemo(
    () => ({
      append,
    }),
    [append]
  );
}
