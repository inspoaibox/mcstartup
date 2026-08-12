import { useEffect, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { appWindow } from '@tauri-apps/api/window';

function applyTheme(theme: string) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
}

export function useToolTheme() {
  const { theme, loadSettings } = useSettingsStore();
  const [ready, setReady] = useState(false);

  // 挂载时加载设置，完成后标记 ready
  useEffect(() => {
    loadSettings().then(() => setReady(true));
  }, [loadSettings]);

  // 窗口获得焦点时重新加载（处理主窗口改变主题后重新打开的情况）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (focused) loadSettings();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      if (unlisten) unlisten();
    };
  }, [loadSettings]);

  // 设置加载完成后才应用主题
  useEffect(() => {
    if (!ready) return;
    applyTheme(theme);
  }, [theme, ready]);

  // 监听系统主题变化
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle('dark', e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return ready;
}
