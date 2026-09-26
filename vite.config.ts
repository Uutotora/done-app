import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain ESM module shared with the production server
import { planeProxy } from './server/planeProxy.mjs';
// @ts-expect-error shared Node server module
import { createAuthApi } from './server/auth.mjs';

function planeProxyPlugin(): Plugin {
  return {
    name: 'done-plane-proxy',
    configureServer(server) {
      const api = createAuthApi();
      server.middlewares.use(api.handler);
      server.httpServer?.once('close', () => api.close());
      server.middlewares.use('/api/plane', planeProxy);
    },
    configurePreviewServer(server) {
      const api = createAuthApi();
      server.middlewares.use(api.handler);
      server.httpServer?.once('close', () => api.close());
      server.middlewares.use('/api/plane', planeProxy);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), planeProxyPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/@blocknote|@mantine|prosemirror|@tiptap|yjs|y-prosemirror|lib0/.test(id)) return 'editor';
          if (id.includes('@xyflow')) return 'flow';
          if (id.includes('mammoth')) return 'mammoth';
          if (id.includes('@anthropic-ai')) return 'ai';
          return undefined;
        },
      },
    },
  },
});
