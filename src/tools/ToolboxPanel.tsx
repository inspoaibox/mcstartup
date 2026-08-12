import { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/shell';
import { Search, X, ExternalLink, Maximize2 } from 'lucide-react';
import { getAllTools, getToolsByCategoryId, searchTools, type ToolDefinition } from './registry';

function openTool(tool: ToolDefinition) {
  if (tool.type === 'window' && tool.windowLabel) {
    invoke('show_tool_window', { label: tool.windowLabel }).catch(console.error);
  } else if (tool.type === 'link' && tool.linkUrl) {
    open(tool.linkUrl);
  }
}

function ToolCard({ tool }: { tool: ToolDefinition }) {
  return (
    <button
      onClick={() => openTool(tool)}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all group w-full h-36"
    >
      {/* 图标 */}
      <div className="text-3xl flex-shrink-0">{tool.icon}</div>

      {/* 名称 */}
      <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors text-center leading-tight line-clamp-1 w-full">
        {tool.name}
      </div>

      {/* 描述 */}
      <div className="text-[11px] text-gray-400 dark:text-gray-500 text-center leading-relaxed line-clamp-2 w-full flex-1">
        {tool.description}
      </div>

      {/* 类型标签 */}
      <div className="flex items-center gap-1 text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0">
        {tool.type === 'link' ? <ExternalLink size={9} /> : <Maximize2 size={9} />}
        <span>{tool.type === 'link' ? '在线工具' : '独立窗口'}</span>
      </div>
    </button>
  );
}

interface ToolboxPanelProps {
  activeCategory: string;
}

export default function ToolboxPanel({ activeCategory }: ToolboxPanelProps) {
  const [search, setSearch] = useState('');

  const displayTools = search.trim()
    ? searchTools(search)
    : activeCategory === 'all'
      ? getAllTools()
      : getToolsByCategoryId(activeCategory);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* 搜索栏 */}
      <div className="px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-xl">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索工具..."
            className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 工具网格 */}
      <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
        {displayTools.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 text-gray-400 dark:text-gray-600">
            <span className="text-5xl mb-3">🔍</span>
            <p className="text-sm">没有找到匹配的工具</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {displayTools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
