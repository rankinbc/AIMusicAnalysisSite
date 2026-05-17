import { defineConfig } from 'vitest/config';

// Scoped to src/ so vitest doesn't try to load playwright specs as unit tests.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'playwright/**'],
    environment: 'node',
  },
});
