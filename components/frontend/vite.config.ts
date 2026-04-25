import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// TODO: /execute-prp may extend this config (e.g., chunk splitting, env-specific settings)
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // All /api/* requests forwarded to FastAPI during development
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // SSE endpoint forwarded separately (no buffering)
      '/jobs': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
