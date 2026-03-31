import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Fix @babel/types ReferenceError in browser — process.env is a Node.js global
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
