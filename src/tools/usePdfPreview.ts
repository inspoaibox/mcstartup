import { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { readBinaryFile } from '@tauri-apps/api/fs';

// 配置 worker（pdfjs 5.x 用 workerSrc）
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface PdfPageInfo {
  index: number; // 0-based
  pageNum: number; // 1-based
  dataUrl: string; // canvas 渲染结果
  width: number;
  height: number;
}

export interface UsePdfPreviewResult {
  pages: PdfPageInfo[];
  pageCount: number;
  loading: boolean;
  error: string | null;
  loadPdf: (pathOrBytes: string | Uint8Array) => Promise<void>;
  clear: () => void;
}

export function usePdfPreview(thumbnailWidth = 160): UsePdfPreviewResult {
  const [pages, setPages] = useState<PdfPageInfo[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  const clear = useCallback(() => {
    if (docRef.current) {
      docRef.current.destroy();
      docRef.current = null;
    }
    setPages([]);
    setPageCount(0);
    setError(null);
  }, []);

  const loadPdf = useCallback(
    async (pathOrBytes: string | Uint8Array) => {
      clear();
      setLoading(true);
      setError(null);

      try {
        let data: Uint8Array;
        if (typeof pathOrBytes === 'string') {
          // 从文件路径读取
          const bytes = await readBinaryFile(pathOrBytes);
          data = new Uint8Array(bytes);
        } else {
          data = pathOrBytes;
        }

        const loadingTask = pdfjsLib.getDocument({ data, password: '' });
        const doc = await loadingTask.promise;
        docRef.current = doc;
        const count = doc.numPages;
        setPageCount(count);

        // 逐页渲染缩略图，用 2x 分辨率避免模糊
        const rendered: PdfPageInfo[] = [];
        for (let i = 1; i <= count; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          const pixelRatio = 2;
          const scale = (thumbnailWidth / viewport.width) * pixelRatio;
          const scaledViewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = scaledViewport.width;
          canvas.height = scaledViewport.height;
          const ctx = canvas.getContext('2d')!;

          await page.render({ canvasContext: ctx, viewport: scaledViewport, canvas }).promise;
          page.cleanup();

          rendered.push({
            index: i - 1,
            pageNum: i,
            dataUrl: canvas.toDataURL('image/jpeg', 0.92),
            width: scaledViewport.width / pixelRatio,
            height: scaledViewport.height / pixelRatio,
          });

          // 每渲染一页就更新，让用户看到进度
          setPages([...rendered]);
        }
      } catch (e: any) {
        setError(e.message || '无法加载 PDF');
      } finally {
        setLoading(false);
      }
    },
    [clear, thumbnailWidth]
  );

  useEffect(
    () => () => {
      docRef.current?.destroy();
    },
    []
  );

  return { pages, pageCount, loading, error, loadPdf, clear };
}
