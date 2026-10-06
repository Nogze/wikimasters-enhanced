import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The game client the extension runs on wiki-masters.com (build.mjs puts it in dist/client/).
// Loaded by the content script with import(chrome.runtime.getURL(…)), so every URL is relative to
// the module (base './') and the names are fixed for the loader.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: 'src/main.tsx',
      output: {
        format: 'es',
        entryFileNames: 'main.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (a) => (a.names?.some((n) => n.endsWith('.css')) ? 'client.css' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
});
