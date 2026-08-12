import { useEffect, useState } from 'react';

export function useSyncedToolItems<T>(
  loaded: boolean,
  loadData: () => Promise<void>,
  storeItems: T[] | undefined,
  updateItems: (items: T[]) => void
) {
  const [items, setItems] = useState<T[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!loaded) {
      loadData();
    }
  }, [loaded, loadData]);

  useEffect(() => {
    if (loaded) {
      setItems(storeItems || []);
      setHydrated(true);
    }
  }, [loaded, storeItems]);

  useEffect(() => {
    if (loaded && hydrated) {
      updateItems(items);
    }
  }, [items, loaded, hydrated, updateItems]);

  return [items, setItems] as const;
}
