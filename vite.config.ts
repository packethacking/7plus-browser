/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the built site works from any subfolder or
  // file:// — not just the document root.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
