import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  worker: {
    format: 'es',
  },
  define: {
    // Polyfill process.env for deps that use it (e.g. Babel helpers)
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV ?? 'development',
    ),
    global: 'globalThis',
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
