import { useState } from 'react';
import { appWindow, WebviewWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/shell';
import { X, Search, ExternalLink, Maximize2 } from 'lucide-react';
import {
  getAllTools,
  getToolsByCategory,
  searchTools,
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  type ToolDefinition,
  type ToolCategory,
} from './registry';

function openTool(tool: ToolDefinition) {
  if (tool.type === 'window' && tool.windowLabel) {
    invoke('show_tool_window', { label: tool.windowLabel }).catch(() => {
      // fallback: 直接用 tauri window API
      const w = WebviewWindow.getByLabel(tool.windowLabel!);
      if (w) {
        w.show();
        w.setFocus();
      }
    });
  } else if (tool.type === 'link' && tool.linkUrl) {
    open(tool.linkUrl);
  }
}

function ToolCard({ tool }: { tool: ToolDefinition }) {
  return (
    <button
      onClick={() => openTool(tool)}
      className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all group text-left w-full"
    >
      <div className="text-3xl">{tool.icon}</div>
      <div className="text-center">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {tool.name}
        </div>
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2">
          {tool.description}
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs text-gray-400">
        {tool.type === 'link' ? <ExternalLink size={10} /> : <Maximize2 size={10} />}
        <span>{tool.type === 'link' ? '在线工具' : '独立窗口'}</span>
      </div>
    </button>
  );
}

export default function ToolboxWindow() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<ToolCategory | 'all'>('all');

  const displayTools = search.trim()
    ? searchTools(search)
    : activeCategory === 'all'
      ? getAllTools()
      : getToolsByCategory(activeCategory);

  const usedCategories = ALL_CATEGORIES.filter((c) => getToolsByCategory(c).length > 0);

  return (
    <div
      className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-200/50 dark:border-gray-700/50"
      data-tauri-drag-region
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2" data-tauri-drag-region>
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <span className="text-lg">🧰</span>
          <span className="font-semibold text-gray-800 dark:text-gray-200">工具箱</span>
        </div>
        <button
          onClick={() => appWindow.hide()}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* 搜索框 */}
      <div className="px-5 pb-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-xl">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索工具..."
            className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 outline-none"
            autoFocus
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 分类 Tab（搜索时隐藏） */}
      {!search && (
        <div className="flex items-center gap-1 px-5 pb-3 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveCategory('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              activeCategory === 'all'
                ? 'bg-blue-500 text-white'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            全部
          </button>
          {usedCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {CATEGORY_LABELS[cat] || cat}
            </button>
          ))}
        </div>
      )}

      {/* 工具网格 */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {displayTools.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-600">
            <span className="text-3xl mb-2">🔍</span>
            <p className="text-sm">没有找到匹配的工具</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            {displayTools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
