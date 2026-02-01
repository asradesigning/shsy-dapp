
/*
 * SHSY-RB-2025-Team1
 * Server-side application configuration
 */

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: './dist',
    emptyOutDir: true,
    rollupOptions: {
      input: './build.js',
      output: {
        entryFileNames: 'build.js',
        format: 'cjs'
      }
    }
  }
});
