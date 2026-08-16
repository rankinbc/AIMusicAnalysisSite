import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';

export default defineConfig({
  plugins: [
    // Generates src/routeTree.gen.ts from src/routes/**.
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
  ],
  server: {
    port: 5174,
    // Vite 6 rejects requests whose Host header it doesn't recognise, which is
    // exactly what a tunnel sends. scripts/share-demo.ps1 sets SPECTR_SHARE=1
    // to open the dev server to Cloudflare quick-tunnel hostnames; without the
    // flag the server stays localhost-only as before.
    ...(process.env.SPECTR_SHARE === '1'
      ? {
          allowedHosts: ['.trycloudflare.com' as const],
          // The tunnel terminates TLS on 443, so the HMR websocket must be told
          // to dial 443 rather than the local 5174 it would infer.
          hmr: { clientPort: 443, protocol: 'wss' as const },
        }
      : {}),
    proxy: {
      // BFF dev server runs on 5000; frontend hits /api/* and gets proxied there.
      // Note this is a SERVER-side hop, so a tunnelled visitor is same-origin
      // with the API and the BFF's localhost-only CORS allowlist never applies.
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
  },
});
