import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TextPrefixRecord {
  id: string;
  createdAt: number;
  input: string;
  result: string;
  prefixType: string;
  customPrefix: string;
  suffix: string;
  separator: string;
  lineCount: number;
  regexPattern?: string;
  regexReplace?: string;
}

interface TextPrefixHistoryState {
  records: TextPrefixRecord[];
  addRecord: (record: Omit<TextPrefixRecord, 'id' | 'createdAt'>) => void;
  deleteRecord: (id: string) => void;
  clearAll: () => void;
}

export const useTextPrefixHistoryStore = create<TextPrefixHistoryState>()(
  persist(
    (set) => ({
      records: [],
      addRecord: (record) =>
        set((s) => ({
          records: [
            { ...record, id: `${Date.now()}-${Math.random()}`, createdAt: Date.now() },
            ...s.records,
          ].slice(0, 50), // 最多保留 50 条
        })),
      deleteRecord: (id) => set((s) => ({ records: s.records.filter((r) => r.id !== id) })),
      clearAll: () => set({ records: [] }),
    }),
    { name: 'text-prefix-history' }
  )
);
