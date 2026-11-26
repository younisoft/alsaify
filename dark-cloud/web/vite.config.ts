import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@dc/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  server: { fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 1200, rollupOptions: { output: { manualChunks: (id: string) => (id.includes('node_modules/@firebase') || id.includes('node_modules/firebase') ? 'firebase' : id.includes('node_modules/recharts') || id.includes('node_modules/d3-') ? 'charts' : id.includes('node_modules/exceljs') ? 'exceljs' : undefined) } } },
});
