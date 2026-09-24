import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'client/src/engine'),
      '@editor': resolve(__dirname, 'client/src/editor'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['client/src/**/*.ts', 'server/src/**/*.ts', 'shared/**/*.ts'],
      exclude: ['client/src/types/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
