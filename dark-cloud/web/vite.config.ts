import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** Emits /sw.js with the exact list of built shell files and a unique build id (cache version). */
function serviceWorker(): Plugin {
  return {
    name: 'dc-service-worker',
    apply: 'build',
    generateBundle(_o, bundle) {
      const files = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f) && !/exceljs/.test(f)).map((f) => '/' + f);
      const statics = ['/index.html', '/manifest.webmanifest', '/favicon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/brand/logo-light.png', '/brand/icon-192.png'];
      const id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
      const src = readFileSync(fileURLToPath(new URL('./sw/sw.template.js', import.meta.url)), 'utf8')
        .replaceAll('__BUILD_ID__', id).replace('__PRECACHE__', JSON.stringify([...statics, ...files]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: id }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  define: { __BUILD_ID__: JSON.stringify(new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)) },
  resolve: { alias: { '@dc/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  server: { fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 1200, rollupOptions: { output: { manualChunks: (id: string) => (id.includes('node_modules/@firebase') || id.includes('node_modules/firebase') ? 'firebase' : id.includes('node_modules/recharts') || id.includes('node_modules/d3-') ? 'charts' : id.includes('node_modules/exceljs') ? 'exceljs' : undefined) } } },
});
