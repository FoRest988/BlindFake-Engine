import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'client/src/engine'),
      '@game': resolve(__dirname, 'client/src/game'),
      '@editor': resolve(__dirname, 'client/src/editor'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
