import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Prevent esbuild from transpiling class fields to __publicField() calls,
  // which break inside AudioWorklet threads where the helper is unavailable.
  esbuild: { target: 'esnext' },
  optimizeDeps: { exclude: ['signalsmith-stretch'] },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
