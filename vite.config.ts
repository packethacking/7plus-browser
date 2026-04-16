/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // Inline JS+CSS into index.html so the build is one self-contained file.
  // This avoids any sibling-path resolution problems on hosts that serve
  // index.html without a trailing slash, rewrite URLs, or otherwise mangle
  // relative paths. The app is ~16 kB — inlining is fine.
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
