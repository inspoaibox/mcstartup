/**
 * ArtifactChatInterface — 代码高手模式（官方方式）
 *
 * 官方示例结构：
 * <AssistantRuntimeProvider>
 *   <Thread />          左侧对话
 *   <RenderHtmlTool />  注册工具（在 Provider 内）
 *   <ArtifactsView />   右侧预览（在 Provider 内，可用 useAuiState）
 * </AssistantRuntimeProvider>
 *
 * 我们通过 ChatInterface 的 rightPanel prop 把右侧面板注入到 Provider 内部。
 */
import { useState, useMemo, useEffect } from 'react';
import { Code, Eye, RefreshCw, Maximize2, Minimize2, Copy, Check } from 'lucide-react';
import { makeAssistantTool, useAuiState } from '@assistant-ui/react';
import type { ToolCallMessagePart } from '@assistant-ui/react';
import ChatInterface from './ChatInterface';

// 官方方式：makeAssistantTool 注册工具，放在 AssistantRuntimeProvider 内部
const RenderHtmlTool = makeAssistantTool<{ code: string }, { success: boolean; code: string }>({
  toolName: 'render_html',
  description:
    'Render HTML code in the preview panel. Call this whenever the user asks for any visual output, page, component, game, animation, or interactive demo. The code must be a complete standalone HTML file.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Complete standalone HTML code including <!DOCTYPE html>, <head>, and <body>',
      },
    },
    required: ['code'],
  } as Record<string, unknown>,
  // 返回代码，让 AI 在下一轮能看到历史版本，支持微调而非重新生成
  execute: async ({ code }) => ({ success: true, code }),
});

interface ArtifactsPanelProps {
  isPanelExpanded: boolean;
  setIsPanelExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
}

// 右侧预览面板：在 AssistantRuntimeProvider 内部，可以用 useAuiState
function ArtifactsPanel({ isPanelExpanded, setIsPanelExpanded }: ArtifactsPanelProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<'preview' | 'source'>('preview');
  const [copied, setCopied] = useState(false);

  // 官方方式：selector 返回稳定的 JSON 字符串，避免每次返回新对象导致无限重渲染
  const artifactCodesJson = useAuiState((s) => {
    const codes = s.thread.messages
      .flatMap((m) =>
        m.content.filter(
          (c): c is ToolCallMessagePart => c.type === 'tool-call' && c.toolName === 'render_html'
        )
      )
      .map((tc) => (tc.args as { code?: string })?.code ?? '')
      .filter(Boolean);
    return JSON.stringify(codes);
  });

  const artifacts = useMemo(() => {
    try {
      const codes: string[] = JSON.parse(artifactCodesJson);
      return codes.map((code, i) => ({ code, index: i + 1 }));
    } catch {
      return [];
    }
  }, [artifactCodesJson]);

  const currentIndex =
    activeIndex !== null && activeIndex < artifacts.length ? activeIndex : artifacts.length - 1;
  const artifactCode = artifacts[currentIndex]?.code ?? '';

  // 新 artifact 生成时自动切到最新
  useEffect(() => {
    if (artifacts.length > 0) {
      setActiveIndex(artifacts.length - 1);
      setTab('preview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifacts.length]);

  const handleCopy = async () => {
    if (!artifactCode) return;
    await navigator.clipboard.writeText(artifactCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isPanelExpanded) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === 'preview' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
            >
              <Eye size={13} />
              预览
            </button>
            <button
              onClick={() => setTab('source')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === 'source' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
            >
              <Code size={13} />
              源码
            </button>
          </div>
          <button
            onClick={() => setIsPanelExpanded(false)}
            className="flex size-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <Minimize2 size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {tab === 'preview' ? (
            <iframe
              key={`${currentIndex}-${artifactCode.length}`}
              className="w-full h-full border-0"
              title="Artifact Preview"
              srcDoc={artifactCode}
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          ) : (
            <pre className="h-full overflow-auto p-4 text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 leading-relaxed">
              {artifactCode}
            </pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-white dark:bg-gray-900 w-[50%] min-w-[400px] border-l border-gray-200 dark:border-gray-700 h-full">
      {/* 面板头部 */}
      <div className="flex flex-col border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
        {/* 历史版本 */}
        {artifacts.length > 0 && (
          <div className="flex items-center gap-1 px-3 pt-2 pb-1 overflow-x-auto">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 mr-1">历史</span>
            {artifacts.map((a, i) => (
              <button
                key={i}
                onClick={() => {
                  setActiveIndex(i);
                  setTab('preview');
                }}
                className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  currentIndex === i
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                v{a.index}
              </button>
            ))}
          </div>
        )}
        {/* 操作栏 */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === 'preview' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <Eye size={13} />
              预览
            </button>
            <button
              onClick={() => setTab('source')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === 'source' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <Code size={13} />
              源码
            </button>
          </div>
          <div className="flex items-center gap-1">
            {artifactCode && (
              <>
                <button
                  onClick={handleCopy}
                  title="复制代码"
                  className="flex size-7 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                </button>
                <button
                  onClick={() => {
                    setTab('source');
                    setTimeout(() => setTab('preview'), 50);
                  }}
                  title="刷新预览"
                  className="flex size-7 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <RefreshCw size={13} />
                </button>
              </>
            )}
            <button
              onClick={() => setIsPanelExpanded(true)}
              title="全屏预览"
              className="flex size-7 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <Maximize2 size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-hidden">
        {!artifactCode ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 flex items-center justify-center mb-4">
              <Code size={28} className="text-blue-500/60" />
            </div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
              等待生成代码
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              向 AI 描述你想要的页面或功能，代码将在这里实时预览
            </p>
          </div>
        ) : tab === 'preview' ? (
          <iframe
            key={`${currentIndex}-${artifactCode.length}`}
            className="w-full h-full border-0"
            title="Artifact Preview"
            srcDoc={artifactCode}
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        ) : (
          <pre className="h-full overflow-auto p-4 text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 leading-relaxed">
            {artifactCode}
          </pre>
        )}
      </div>
    </div>
  );
}

interface ArtifactChatInterfaceProps {
  threadId: string;
  onThreadUpdated?: () => void;
  onMessageDeleted?: () => void;
  onTitleGenerated?: (title: string) => void;
}

export default function ArtifactChatInterface({
  threadId,
  onThreadUpdated,
  onMessageDeleted,
  onTitleGenerated,
}: ArtifactChatInterfaceProps) {
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);

  // rightPanel 在 AssistantRuntimeProvider 内部渲染，可以用 useAuiState
  const rightPanel = (
    <>
      <RenderHtmlTool />
      <ArtifactsPanel isPanelExpanded={isPanelExpanded} setIsPanelExpanded={setIsPanelExpanded} />
    </>
  );

  return (
    <div className="flex h-full overflow-hidden">
      <ChatInterface
        key={threadId}
        threadId={threadId}
        userId="default-user"
        enableMemory={false}
        onThreadUpdated={onThreadUpdated}
        onMessageDeleted={onMessageDeleted}
        onTitleGenerated={onTitleGenerated}
        rightPanel={rightPanel}
      />
    </div>
  );
}
