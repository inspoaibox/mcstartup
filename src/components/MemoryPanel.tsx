import { useEffect, useState } from 'react';
import { Brain, Trash2, RefreshCw } from 'lucide-react';
import * as aiChatApi from '../api/aiChatApi';
import type { ThreadSummaryData } from '../api/aiChatApi';

interface MemoryPanelProps {
  threadId: string;
}

export default function MemoryPanel({ threadId }: MemoryPanelProps) {
  const [summary, setSummary] = useState<ThreadSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [keyPoints, setKeyPoints] = useState<Record<string, string[]>>({});

  useEffect(() => {
    load();
  }, [threadId]);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await aiChatApi.getThreadSummary(threadId);
      setSummary(data);
      if (data?.key_points) {
        try {
          setKeyPoints(JSON.parse(data.key_points));
        } catch {
          setKeyPoints({});
        }
      } else {
        setKeyPoints({});
      }
    } catch (e) {
      console.error('Failed to load thread summary:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('确定清除本对话的记忆摘要？')) return;
    await aiChatApi.deleteThreadSummary(threadId);
    setSummary(null);
    setKeyPoints({});
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
        <RefreshCw size={14} className="animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  if (!summary || !summary.summary) {
    return (
      <div className="px-4 py-6 text-center">
        <Brain size={28} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-400 dark:text-gray-500">暂无摘要</p>
        <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">每 20 条消息自动压缩一次</p>
      </div>
    );
  }

  const hasKeyPoints = Object.values(keyPoints).some((v) => v.length > 0);

  return (
    <div className="px-4 py-3 space-y-3">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-purple-600 dark:text-purple-400">
          <Brain size={13} />
          <span>对话摘要</span>
          <span className="text-gray-400 dark:text-gray-500 font-normal">
            · {summary.message_count} 条消息时压缩
          </span>
        </div>
        <button
          onClick={handleClear}
          className="text-gray-400 hover:text-red-500 transition-colors"
          title="清除摘要"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* 摘要文本 */}
      <div className="text-xs text-gray-700 dark:text-gray-300 bg-purple-50 dark:bg-purple-900/10 rounded-lg px-3 py-2 leading-relaxed border border-purple-100 dark:border-purple-800/30">
        {summary.summary}
      </div>

      {/* 结构化关键点 */}
      {hasKeyPoints && (
        <div className="space-y-1.5">
          {Object.entries(keyPoints).map(([key, values]) => {
            if (!values || values.length === 0) return null;
            return (
              <div key={key}>
                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                  {key}
                </span>
                <ul className="mt-0.5 space-y-0.5">
                  {values.map((v, i) => (
                    <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex gap-1.5">
                      <span className="text-purple-400 flex-shrink-0">·</span>
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
