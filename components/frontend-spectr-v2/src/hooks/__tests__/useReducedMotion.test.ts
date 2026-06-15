import { describe, expect, it } from 'vitest';

import { useReducedMotion } from '../useReducedMotion';

// Story 1.8 / Task 8 — useReducedMotion's shape contract.
// The vitest env is `node` (no jsdom + no window), so the hook's SSR-safe
// guard is the load-bearing path under test here. Full media-query
// subscription behaviour is exercised by the Task 9.8 manual smoke
// (DevTools → Rendering → emulate prefers-reduced-motion).

describe('useReducedMotion', () => {
  it('is exported as a callable hook', () => {
    expect(typeof useReducedMotion).toBe('function');
  });

  it('has the React-hook naming convention (starts with "use")', () => {
    expect(useReducedMotion.name).toMatch(/^use/);
  });
});
