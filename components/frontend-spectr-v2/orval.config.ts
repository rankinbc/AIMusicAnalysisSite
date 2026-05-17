import { defineConfig } from 'orval';

// Generates a typed API client + Zod schemas from the BFF's OpenAPI doc.
// Run after every BFF schema change:
//   pnpm gen-types     (or npm run gen-types)

export default defineConfig({
  spectr: {
    input: './openapi.json',
    output: {
      target: './src/api/generated/client.ts',
      schemas: './src/api/generated/schemas',
      mode: 'split',
      client: 'react-query',
      mock: false,
      override: {
        mutator: { path: './src/api/fetcher.ts', name: 'fetcher' },
      },
    },
  },
});
