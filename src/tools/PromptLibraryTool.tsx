import { useState } from 'react';
import { Search, Plus, Star, Copy, Edit2, Trash2, X, Tag } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import { useToolDataStore, type AssetMeta, type PromptItem } from '../stores/toolDataStore';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { AiAssetMetaFields, AiAssetMetaSummary } from './AiAssetMetaFields';
import ToolHeader from './ToolHeader';
import {
  cleanAssetMeta,
  extractTemplateVariables,
  incrementAssetUsage,
  promptForTemplateValues,
} from './aiAssetUtils';
import { useSyncedToolItems } from './useSyncedToolItems';

// 预设分类
const CATEGORIES = [
  '图片生成',
  'Logo设计',
  '视频生成',
  '文案写作',
  '代码开发',
  '电商运营',
  '短视频脚本',
  '角色扮演',
  '办公效率',
  '翻译润色',
  '营销推广',
  '自媒体内容',
] as const;

// 预设模型
const MODELS = [
  'ChatGPT',
  'Claude',
  'Gemini',
  'Midjourney',
  'Stable Diffusion',
  'DALL-E',
  'Runway',
  'Sora',
  'Copilot',
  '通用',
] as const;

const VISUAL_PROMPT_CATEGORIES = ['图片生成', 'Logo设计', '视频生成'];
const VISUAL_PROMPT_MODELS = ['Midjourney', 'Stable Diffusion', 'DALL-E', 'Runway', 'Sora'];

function parsePreviewImages(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  );
}

function resolvePreviewImageSrc(path: string): string {
  const trimmed = path.trim();
  if (/^(https?:|data:|blob:|asset:)/i.test(trimmed)) return trimmed;

  if (/^file:\/\//i.test(trimmed)) {
    const filePath = trimmed.replace(/^file:\/\//i, '').replace(/^\/([A-Za-z]:)/, '$1');
    return convertFileSrc(filePath);
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\\\')) {
    return convertFileSrc(trimmed);
  }

  return trimmed;
}

function isVisualPrompt(category: string, models: string[]): boolean {
  return (
    VISUAL_PROMPT_CATEGORIES.includes(category) ||
    models.some((model) => VISUAL_PROMPT_MODELS.includes(model))
  );
}

export default function PromptLibraryTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updatePromptLibraryItems } = useToolDataStore();
  const [prompts, setPrompts] = useSyncedToolItems<PromptItem>(
    loaded,
    loadData,
    data.promptLibrary?.items,
    updatePromptLibraryItems
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null);

  if (!ready) return null;

  // 筛选 prompts
  const filteredPrompts = prompts.filter((p) => {
    // 分类筛选
    if (selectedCategory === 'favorite' && !p.favorite) return false;
    if (
      selectedCategory !== 'all' &&
      selectedCategory !== 'favorite' &&
      p.category !== selectedCategory
    )
      return false;

    // 搜索筛选
    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase();
      return (
        p.title.toLowerCase().includes(keyword) ||
        p.content.toLowerCase().includes(keyword) ||
        p.tags.some((t) => t.toLowerCase().includes(keyword)) ||
        p.meta?.sourceName?.toLowerCase().includes(keyword) ||
        p.meta?.collectReason?.toLowerCase().includes(keyword)
      );
    }

    return true;
  });

  const handleAddNew = () => {
    setEditingPrompt(null);
    setShowEditor(true);
  };

  const handleEdit = (prompt: PromptItem) => {
    setEditingPrompt(prompt);
    setShowEditor(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个 Prompt 吗？')) {
      setPrompts(prompts.filter((p) => p.id !== id));
    }
  };

  const handleToggleFavorite = (id: string) => {
    setPrompts(prompts.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)));
  };

  const handleCopy = async (prompt: PromptItem) => {
    await navigator.clipboard.writeText(promptForTemplateValues(prompt.content));
    setPrompts(prompts.map((p) => (p.id === prompt.id ? incrementAssetUsage(p) : p)));
  };

  const handleSave = (prompt: PromptItem) => {
    if (editingPrompt) {
      // 编辑
      setPrompts(prompts.map((p) => (p.id === prompt.id ? prompt : p)));
    } else {
      // 新建
      setPrompts([...prompts, prompt]);
    }
    setShowEditor(false);
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <ToolHeader
        icon="🤖"
        title="AI Prompt 库"
        closeMode="hide"
        actions={
          <button
            onClick={handleAddNew}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors"
          >
            <Plus size={16} />
            新建
          </button>
        }
      />

      <div className="flex flex-1 min-h-0">
        {/* 左侧分类 */}
        <div className="w-48 border-r border-gray-200 dark:border-gray-700 p-3 space-y-1 overflow-y-auto">
          <CategoryButton
            active={selectedCategory === 'all'}
            onClick={() => setSelectedCategory('all')}
          >
            全部
          </CategoryButton>
          <CategoryButton
            active={selectedCategory === 'favorite'}
            onClick={() => setSelectedCategory('favorite')}
          >
            ⭐ 收藏
          </CategoryButton>
          <div className="h-px bg-gray-200 dark:bg-gray-700 my-2" />
          {CATEGORIES.map((cat) => (
            <CategoryButton
              key={cat}
              active={selectedCategory === cat}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </CategoryButton>
          ))}
        </div>

        {/* 右侧内容 */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 搜索栏 */}
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <Search size={16} className="text-gray-400" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索标题、标签、内容..."
                className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-300 outline-none"
              />
              {searchKeyword && (
                <button onClick={() => setSearchKeyword('')} className="text-gray-400">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Prompt 列表 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {filteredPrompts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <span className="text-4xl mb-2">📝</span>
                <p className="text-sm">暂无 Prompt</p>
                <button
                  onClick={handleAddNew}
                  className="mt-3 text-blue-500 hover:text-blue-600 text-sm"
                >
                  点击新建
                </button>
              </div>
            ) : (
              filteredPrompts.map((prompt) => (
                <PromptCard
                  key={prompt.id}
                  prompt={prompt}
                  onEdit={() => handleEdit(prompt)}
                  onDelete={() => handleDelete(prompt.id)}
                  onToggleFavorite={() => handleToggleFavorite(prompt.id)}
                  onCopy={() => handleCopy(prompt)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* 编辑器弹窗 */}
      {showEditor && (
        <PromptEditor
          prompt={editingPrompt}
          onClose={() => setShowEditor(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// 分类按钮
function CategoryButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-blue-500 text-white'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {children}
    </button>
  );
}

// Prompt 卡片
function PromptCard({
  prompt,
  onEdit,
  onDelete,
  onToggleFavorite,
  onCopy,
}: {
  prompt: PromptItem;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onCopy: () => void;
}) {
  const variables = extractTemplateVariables(prompt.content);
  const previewImages = prompt.previewImages || [];
  const firstPreviewImage = previewImages[0];

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:border-blue-400 dark:hover:border-blue-600 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-800 dark:text-white truncate">{prompt.title}</h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <span>{prompt.category}</span>
            <span>·</span>
            <span>{prompt.language === 'zh' ? '中文' : 'English'}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={onToggleFavorite}
            className="p-1 text-gray-400 hover:text-yellow-500 transition-colors"
          >
            <Star size={16} fill={prompt.favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={onCopy}
            className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
            title="复制"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={onEdit}
            className="p-1 text-gray-400 hover:text-green-500 transition-colors"
            title="编辑"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={onDelete}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
            title="删除"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <AiAssetMetaSummary meta={prompt.meta} />

      {firstPreviewImage && (
        <div className="mb-3 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 aspect-[16/9]">
          <img
            src={resolvePreviewImageSrc(firstPreviewImage)}
            alt={`${prompt.title} 预览图`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* Content */}
      <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3 mb-2">{prompt.content}</p>

      {variables.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {variables.slice(0, 6).map((variable) => (
            <span
              key={variable}
              className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-xs text-emerald-700 dark:text-emerald-300 rounded"
            >
              {'{'}
              {variable}
              {'}'}
            </span>
          ))}
          {variables.length > 6 && (
            <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-xs text-gray-500 rounded">
              +{variables.length - 6}
            </span>
          )}
        </div>
      )}

      {/* Tags */}
      {prompt.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {prompt.tags.map((tag, i) => (
            <span
              key={i}
              className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400 rounded"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Models */}
      <div className="flex flex-wrap gap-1">
        {prompt.models.map((model, i) => (
          <span
            key={i}
            className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-600 dark:text-blue-400 rounded"
          >
            {model}
          </span>
        ))}
      </div>
    </div>
  );
}

// Prompt 编辑器
function PromptEditor({
  prompt,
  onClose,
  onSave,
}: {
  prompt: PromptItem | null;
  onClose: () => void;
  onSave: (prompt: PromptItem) => void;
}) {
  const [title, setTitle] = useState(prompt?.title || '');
  const [category, setCategory] = useState(prompt?.category || '文案写作');
  const [content, setContent] = useState(prompt?.content || '');
  const [tags, setTags] = useState<string[]>(prompt?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [models, setModels] = useState<string[]>(prompt?.models || ['通用']);
  const [language, setLanguage] = useState<'zh' | 'en'>(prompt?.language || 'zh');
  const [previewText, setPreviewText] = useState((prompt?.previewImages || []).join('\n'));
  const [note, setNote] = useState(prompt?.note || '');
  const [meta, setMeta] = useState<AssetMeta>(prompt?.meta || {});
  const visualPrompt = isVisualPrompt(category, models);
  const previewImages = parsePreviewImages(previewText);

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleToggleModel = (model: string) => {
    if (models.includes(model)) {
      // 至少保留一个模型
      if (models.length > 1) {
        setModels(models.filter((m) => m !== model));
      }
    } else {
      setModels([...models, model]);
    }
  };

  const handleSave = () => {
    if (!title.trim() || !content.trim()) {
      alert('标题和内容不能为空');
      return;
    }

    const now = new Date().toISOString();
    const savedPrompt: PromptItem = {
      id: prompt?.id || `prompt_${Date.now()}`,
      title: title.trim(),
      category,
      tags,
      content: content.trim(),
      models,
      language,
      previewImages: previewImages.length > 0 ? previewImages : undefined,
      note: note.trim() || undefined,
      meta: cleanAssetMeta(meta),
      favorite: prompt?.favorite || false,
      createTime: prompt?.createTime || now,
      updateTime: now,
    };

    onSave(savedPrompt);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
            {prompt ? '编辑 Prompt' : '新建 Prompt'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              标题 *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入 Prompt 标题"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 分类和语言 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                分类 *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                语言
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          {/* 标签 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              标签
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="输入标签后按回车添加"
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg text-sm transition-colors"
              >
                <Tag size={16} />
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-blue-900 dark:hover:text-blue-100"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 适用模型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              适用模型 *
            </label>
            <div className="grid grid-cols-3 gap-2">
              {MODELS.map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => handleToggleModel(model)}
                  className={`px-3 py-2 rounded-lg text-xs transition-colors ${
                    models.includes(model)
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt 内容 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Prompt 内容 *
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="输入完整的 Prompt 内容..."
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 预览图 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              预览图链接
            </label>
            <textarea
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              placeholder="一行一个图片 URL，也可以填本地绝对路径"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {visualPrompt && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                图片、Logo、视频类 Prompt 建议保存 1-3 张代表性效果图，列表里会展示第一张。
              </p>
            )}
          </div>

          {previewImages.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {previewImages.slice(0, 3).map((image, index) => (
                <div
                  key={`${image}-${index}`}
                  className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 aspect-square"
                >
                  <img
                    src={resolvePreviewImageSrc(image)}
                    alt={`预览图 ${index + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          )}

          <AiAssetMetaFields meta={meta} onChange={setMeta} />

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              备注说明
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="使用说明或效果说明..."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
