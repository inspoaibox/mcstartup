import { create } from 'zustand';
import { Group } from '../types';
import { invoke } from '@tauri-apps/api/tauri';

interface GroupsState {
  groups: Group[];
  loading: boolean;
  error: string | null;
  
  // Actions
  loadGroups: () => Promise<void>;
  addGroup: (group: Omit<Group, 'id'>) => Promise<Group>;
  updateGroup: (id: string, group: Group) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
}

export const useGroupsStore = create<GroupsState>((set) => ({
  groups: [],
  loading: false,
  error: null,

  loadGroups: async () => {
    set({ loading: true, error: null });
    try {
      const groups = await invoke<Group[]>('get_all_groups');
      set({ groups, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  addGroup: async (groupData) => {
    try {
      const newGroup = await invoke<Group>('add_group', { group: groupData });
      set((state) => ({ groups: [...state.groups, newGroup] }));
      return newGroup;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateGroup: async (id, groupData) => {
    try {
      const updatedGroup = await invoke<Group>('update_group', { id, group: groupData });
      set((state) => ({
        groups: state.groups.map((group) => (group.id === id ? updatedGroup : group)),
      }));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteGroup: async (id) => {
    try {
      await invoke('delete_group', { id });
      set((state) => ({
        groups: state.groups.filter((group) => group.id !== id),
      }));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
}));
