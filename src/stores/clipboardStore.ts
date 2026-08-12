import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/tauri';
import type { ClipboardItem, ClipboardGroup } from '../types';

interface ClipboardState {
  items: ClipboardItem[];
  group: ClipboardGroup;
  search: string;
  page: number;
  hasMore: boolean;
  loading: boolean;
  activeId: string | null;

  // actions
  setGroup: (group: ClipboardGroup) => void;
  setSearch: (search: string) => void;
  setActiveId: (id: string | null) => void;
  loadItems: (reset?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  reload: () => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  updateNote: (id: string, note: string | null) => Promise<void>;
  updateTextValue: (id: string, value: string) => Promise<void>;
  updateFavoriteShortcut: (id: string, shortcut: string | null) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  clearAll: (keepFavorites: boolean) => Promise<void>;
  copyItem: (id: string) => Promise<void>;
  pasteItem: (id: string, asPlain?: boolean) => Promise<void>;
}

const PAGE_SIZE = 20;

export const useClipboardStore = create<ClipboardState>((set, get) => ({
  items: [],
  group: 'all',
  search: '',
  page: 1,
  hasMore: true,
  loading: false,
  activeId: null,

  setGroup: (group) => {
    set({ group, page: 1, items: [], hasMore: true, activeId: null });
    get().loadItems(true);
  },

  setSearch: (search) => {
    set({ search, page: 1, items: [], hasMore: true, activeId: null });
    get().loadItems(true);
  },

  setActiveId: (id) => set({ activeId: id }),

  loadItems: async (reset = false) => {
    const state = get();
    if (state.loading) return;

    const page = reset ? 1 : state.page;
    set({ loading: true });

    try {
      const result = await invoke<ClipboardItem[]>('clipboard_query', {
        group: state.group,
        search: state.search,
        page,
        pageSize: PAGE_SIZE,
      });

      const items = reset ? result : [...state.items, ...result];
      set({
        items,
        page,
        hasMore: result.length === PAGE_SIZE,
        loading: false,
        activeId: reset && result.length > 0 ? result[0].id : state.activeId,
      });
    } catch (e) {
      console.error('clipboard_query error:', e);
      set({ loading: false });
    }
  },

  loadMore: async () => {
    const state = get();
    if (!state.hasMore || state.loading) return;
    set({ page: state.page + 1 });
    await get().loadItems(false);
  },

  reload: async () => {
    set({ page: 1, items: [], hasMore: true });
    await get().loadItems(true);
  },

  toggleFavorite: async (id) => {
    try {
      const newVal = await invoke<boolean>('clipboard_toggle_favorite', { id });
      set((state) => ({
        items: state.items.map((item) => (item.id === id ? { ...item, favorite: newVal } : item)),
      }));
    } catch (e) {
      console.error('toggle_favorite error:', e);
    }
  },

  togglePin: async (id) => {
    try {
      const newVal = await invoke<boolean>('clipboard_toggle_pin', { id });
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id ? { ...item, pinned: newVal, favorite: newVal ? true : item.favorite } : item
        ),
      }));
      await get().reload();
    } catch (e) {
      console.error('toggle_pin error:', e);
    }
  },

  updateNote: async (id, note) => {
    try {
      await invoke('clipboard_update_note', { id, note });
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id ? { ...item, note: note ?? undefined } : item
        ),
      }));
    } catch (e) {
      console.error('update_note error:', e);
    }
  },

  updateTextValue: async (id, value) => {
    try {
      await invoke('clipboard_update_text_value', { id, value });
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id
            ? {
                ...item,
                value,
                search: value,
                count: value.length,
              }
            : item
        ),
      }));
      await get().reload();
    } catch (e) {
      console.error('update_text_value error:', e);
    }
  },

  updateFavoriteShortcut: async (id, shortcut) => {
    try {
      await invoke('clipboard_update_favorite_shortcut', { id, shortcut });
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id ? { ...item, shortcut: shortcut || undefined } : item
        ),
      }));
    } catch (e) {
      console.error('update_favorite_shortcut error:', e);
      throw e;
    }
  },

  deleteItem: async (id) => {
    try {
      await invoke('clipboard_delete', { id });
      set((state) => {
        const items = state.items.filter((item) => item.id !== id);
        const activeId = state.activeId === id ? (items[0]?.id ?? null) : state.activeId;
        return { items, activeId };
      });
    } catch (e) {
      console.error('clipboard_delete error:', e);
    }
  },

  clearAll: async (keepFavorites) => {
    try {
      await invoke('clipboard_clear', { keepFavorites });
      await get().reload();
    } catch (e) {
      console.error('clipboard_clear error:', e);
    }
  },

  copyItem: async (id) => {
    try {
      await invoke('clipboard_copy_item', { id });
    } catch (e) {
      console.error('clipboard_copy_item error:', e);
    }
  },

  pasteItem: async (id, asPlain = false) => {
    try {
      await invoke('clipboard_paste_item', { id, asPlain });
    } catch (e) {
      console.error('clipboard_paste_item error:', e);
    }
  },
}));
