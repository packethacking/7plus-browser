/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
