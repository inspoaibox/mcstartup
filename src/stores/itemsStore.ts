import { create } from 'zustand';
import { LaunchItem, PathCheckResult } from '../types';
import { invoke } from '@tauri-apps/api/tauri';

interface ItemsState {
  items: LaunchItem[];
  loading: boolean;
  error: string | null;
  pathValidity: Record<string, boolean>; // id -> valid

  // Actions
  loadItems: () => Promise<void>;
  addItem: (item: Omit<LaunchItem, 'id' | 'createdAt'>) => Promise<LaunchItem>;
  updateItem: (id: string, item: Partial<LaunchItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  launchItem: (id: string) => Promise<void>;
  launchItemWithProfile: (id: string, profileName: string) => Promise<void>;
  searchItems: (query: string) => LaunchItem[];
  validateAllPaths: () => Promise<void>;
  getRecentItems: (limit?: number) => LaunchItem[];
  getFrequentItems: (limit?: number) => LaunchItem[];
}

export const useItemsStore = create<ItemsState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  pathValidity: {},

  loadItems: async () => {
    set({ loading: true, error: null });
    try {
      const items = await invoke<LaunchItem[]>('get_all_items');
      set({ items, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  addItem: async (itemData) => {
    try {
      const cleanedData = {
        ...itemData,
        arguments: itemData.arguments?.trim() || undefined,
        workingDir: itemData.workingDir?.trim() || undefined,
        description: itemData.description?.trim() || undefined,
        groupId: itemData.groupId?.trim() || undefined,
        hotkey: itemData.hotkey?.trim() || undefined,
      };
      const newItem = await invoke<LaunchItem>('add_item', { item: cleanedData });
      set((state) => ({ items: [...state.items, newItem] }));
      return newItem;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateItem: async (id, itemData) => {
    try {
      const cleanedData = {
        ...itemData,
        arguments: itemData.arguments?.trim() || undefined,
        workingDir: itemData.workingDir?.trim() || undefined,
        description: itemData.description?.trim() || undefined,
        groupId: itemData.groupId?.trim() || undefined,
        hotkey: itemData.hotkey?.trim() || undefined,
      };
      // 后端接收 LaunchItemInput，自动保留 id/createdAt/lastUsed
      const updatedItem = await invoke<LaunchItem>('update_item', { id, item: cleanedData });
      set((state) => ({
        items: state.items.map((item) => (item.id === id ? updatedItem : item)),
      }));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteItem: async (id) => {
    try {
      await invoke('delete_item', { id });
      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
      }));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  launchItem: async (id) => {
    try {
      await invoke('launch_item', { id });
      const now = Math.floor(Date.now() / 1000);
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id
            ? { ...item, lastUsed: now, launchCount: (item.launchCount || 0) + 1 }
            : item
        ),
      }));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  launchItemWithProfile: async (id, profileName) => {
    try {
      await invoke('launch_item_with_profile', { id, profileName });
      const now = Math.floor(Date.now() / 1000);
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id
            ? { ...item, lastUsed: now, launchCount: (item.launchCount || 0) + 1 }
            : item
        ),
      }));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  searchItems: (query: string) => {
    const { items } = get();
    if (!query.trim()) return items;

    const lowerQuery = query.toLowerCase();
    const scored = items
      .map((item) => {
        let score = 0;
        const name = item.name.toLowerCase();
        const alias = item.alias.toLowerCase();
        const desc = item.description?.toLowerCase() || '';

        // 精确匹配别名得分最高
        if (alias === lowerQuery) score += 100;
        // 别名前缀匹配
        else if (alias.startsWith(lowerQuery)) score += 80;
        // 名称精确匹配
        else if (name === lowerQuery) score += 70;
        // 名称前缀匹配
        else if (name.startsWith(lowerQuery)) score += 60;
        // 别名包含
        else if (alias.includes(lowerQuery)) score += 40;
        // 名称包含
        else if (name.includes(lowerQuery)) score += 30;
        // 描述包含
        else if (desc.includes(lowerQuery)) score += 10;
        // 模糊匹配：检查查询字符是否按顺序出现在别名中
        else if (fuzzyMatch(lowerQuery, alias)) score += 20;
        else if (fuzzyMatch(lowerQuery, name)) score += 15;

        // 使用频率加分
        if (score > 0) {
          score += Math.min((item.launchCount || 0) * 0.5, 20);
        }

        return { item, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map((s) => s.item);
  },

  validateAllPaths: async () => {
    const { items } = get();
    const checkItems = items.map((item) => ({
      id: item.id,
      targetPath: item.targetPath,
      itemType: item.itemType || 'app',
    }));

    try {
      const results = await invoke<PathCheckResult[]>('validate_paths', { items: checkItems });
      const validity: Record<string, boolean> = {};
      for (const r of results) {
        validity[r.id] = r.valid;
      }
      set({ pathValidity: validity });
    } catch (error) {
      console.error('路径验证失败:', error);
    }
  },

  getRecentItems: (limit = 5) => {
    const { items } = get();
    return [...items]
      .filter((item) => item.lastUsed)
      .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
      .slice(0, limit);
  },

  getFrequentItems: (limit = 5) => {
    const { items } = get();
    return [...items]
      .filter((item) => (item.launchCount || 0) > 0)
      .sort((a, b) => (b.launchCount || 0) - (a.launchCount || 0))
      .slice(0, limit);
  },
}));

/** 模糊匹配：查询字符按顺序出现在目标中 */
function fuzzyMatch(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (query[qi] === target[ti]) qi++;
  }
  return qi === query.length;
}
