import { useEffect, useCallback } from 'react';

/** 把 File 转为 base64 data URL */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** 监听全局粘贴事件，提取图片 */
export function useClipboardPaste(onImage: (base64: string, file: File) => void) {
  const handler = useCallback(
    async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const b64 = await fileToBase64(file);
            onImage(b64, file);
            break;
          }
        }
      }
    },
    [onImage]
  );

  useEffect(() => {
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [handler]);
}

/** 把 base64 data URL 图片复制到系统剪贴板 */
export async function copyImageToClipboard(dataUrl: string): Promise<boolean> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}
