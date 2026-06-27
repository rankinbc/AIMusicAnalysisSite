import js from '@eslint/js';
import globals from 'globals';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/routeTree.gen.ts',
      'src/api/generated/**',
      // design-sync tool scratch dirs (not project source)
      '.ds-sync/**',
      'ds-bundle/**',
      '.design-sync/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        ...globals.browser,
        // React 19 auto-imports JSX runtime; `React` is referenced via the
        // global type namespace (e.g. React.CSSProperties), not as a runtime symbol.
        React: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // TypeScript already catches undefined symbols. no-undef gives false positives
      // on type-only references (BodyInit, RequestInit, etc.) and is the official
      // typescript-eslint guidance to disable.
      'no-undef': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Entry point / shared-context files don't follow the "components only"
    // export pattern; the Fast Refresh hint isn't actionable for them.
    files: ['src/main.tsx', 'src/auth/AuthContext.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Node lint/build scripts (AR39 enforcement lints live here).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
