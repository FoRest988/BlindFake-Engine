import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'client',
  publicDir: '../assets/public',
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'client/src/engine'),
      '@game': resolve(__dirname, 'client/src/game'),
      '@editor': resolve(__dirname, 'client/src/editor'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 3000,
    hmr: {
      overlay: true,
      timeout: 5000,
    },
    proxy: {
      '/api': 'http://localhost:4000',
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
});
