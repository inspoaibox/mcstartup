import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Tauri desktop runs on modern embedded browser engines, and
    // transformers.js bundles rely on BigInt syntax unsupported by safari13.
    target: ['es2022', 'chrome100'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (!normalizedId.includes('/node_modules/')) return;

          if (normalizedId.includes('@tauri-apps')) return 'vendor-tauri';
          if (
            normalizedId.includes('react-markdown') ||
            normalizedId.includes('remark-') ||
            normalizedId.includes('rehype-') ||
            normalizedId.includes('micromark') ||
            normalizedId.includes('mdast-') ||
            normalizedId.includes('hast-') ||
            normalizedId.includes('unist-') ||
            normalizedId.includes('unified') ||
            normalizedId.includes('vfile') ||
            normalizedId.includes('marked') ||
            normalizedId.includes('markdown')
          ) {
            return 'vendor-markdown';
          }
          if (
            normalizedId.includes('@assistant-ui') ||
            normalizedId.includes('@ai-sdk') ||
            normalizedId.includes('/node_modules/ai/')
          ) {
            return 'vendor-ai';
          }
          if (
            normalizedId.includes('pdf-lib') ||
            normalizedId.includes('pdfjs-dist') ||
            normalizedId.includes('@pdf-lib/fontkit')
          ) {
            return 'vendor-pdf';
          }
          if (normalizedId.includes('vditor')) return 'vendor-editor';
          if (normalizedId.includes('recharts') || normalizedId.includes('/node_modules/d3')) {
            return 'vendor-charts';
          }
          if (normalizedId.includes('@huggingface/transformers')) return 'vendor-transformers';
          if (normalizedId.includes('lucide-react')) return 'vendor-icons';
          if (
            normalizedId.includes('/node_modules/react/') ||
            normalizedId.includes('/node_modules/react-dom/') ||
            normalizedId.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          if (normalizedId.includes('qrcode')) return 'vendor-qrcode';
          if (normalizedId.includes('opencc-js') || normalizedId.includes('pinyin-pro')) {
            return 'vendor-text-tools';
          }
          if (normalizedId.includes('sql-formatter')) return 'vendor-sql';
          if (
            normalizedId.includes('cron-parser') ||
            normalizedId.includes('cronstrue') ||
            normalizedId.includes('lunar-javascript')
          ) {
            return 'vendor-time-tools';
          }
          return;
        },
      },
    },
  },
});
