import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ToolCategory {
  id: string;
  name: string;
  color?: string;
  order: number;
}

// 内置分类（不可删除）
export const BUILTIN_CATEGORIES: ToolCategory[] = [
  { id: 'ai', name: '人工智能', color: '#a855f7', order: 0 },
  { id: 'efficiency', name: '效率工具', color: '#3b82f6', order: 1 },
  { id: 'text', name: '文本处理', color: '#8b5cf6', order: 2 },
  { id: 'network', name: '网络工具', color: '#10b981', order: 3 },
  { id: 'download', name: '下载工具', color: '#0ea5e9', order: 4 },
  { id: 'system', name: '系统工具', color: '#64748b', order: 5 },
  { id: 'dev', name: '开发工具', color: '#f59e0b', order: 6 },
  { id: 'image', name: '图片处理', color: '#ec4899', order: 7 },
  { id: 'media', name: '音频视频', color: '#f97316', order: 8 },
  { id: 'pdf', name: 'PDF 工具', color: '#ef4444', order: 9 },
  { id: 'office', name: '办公辅助', color: '#14b8a6', order: 10 },
  { id: 'other', name: '其他', color: '#6b7280', order: 99 },
];

interface ToolCategoryState {
  customCategories: ToolCategory[];
  addCategory: (name: string, color?: string) => ToolCategory;
  updateCategory: (id: string, name: string, color?: string) => void;
  deleteCategory: (id: string) => void;
  getAllCategories: () => ToolCategory[];
}

export const useToolCategoryStore = create<ToolCategoryState>()(
  persist(
    (set, get) => ({
      customCategories: [],

      addCategory: (name, color) => {
        const newCat: ToolCategory = {
          id: `custom-${Date.now()}`,
          name,
          color: color || '#6b7280',
          order: get().customCategories.length + 10,
        };
        set((s) => ({ customCategories: [...s.customCategories, newCat] }));
        return newCat;
      },

      updateCategory: (id, name, color) => {
        set((s) => ({
          customCategories: s.customCategories.map((c) =>
            c.id === id ? { ...c, name, color: color ?? c.color } : c
          ),
        }));
      },

      deleteCategory: (id) => {
        set((s) => ({
          customCategories: s.customCategories.filter((c) => c.id !== id),
        }));
      },

      getAllCategories: () => {
        return [...BUILTIN_CATEGORIES, ...get().customCategories].sort((a, b) => a.order - b.order);
      },
    }),
    { name: 'tool-categories' }
  )
);
