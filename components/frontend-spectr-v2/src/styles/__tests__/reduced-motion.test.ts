import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES_DIR = fileURLToPath(new URL('..', import.meta.url));
const globalCss = readFileSync(join(STYLES_DIR, 'global.css'), 'utf-8');

// Story 1.7 / UX-DR44 / AC6 — every keyframe animation in global.css must
// freeze when the user has set prefers-reduced-motion: reduce. The blanket
// pattern (animation-duration: 0.001ms on every element) is the
// WCAG-recommended implementation; this test catches a regression that
// removes the @media block or weakens the override.

describe('global.css prefers-reduced-motion handling', () => {
  it('declares a @media (prefers-reduced-motion: reduce) block', () => {
    expect(globalCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it('collapses animation-duration to imperceptible inside the block', () => {
    // Match the keyword + the override on the same statement, !important
    // included so a weaker selector cannot defeat it.
    expect(globalCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-duration:\s*0\.001ms\s*!important/,
    );
  });

  it('also collapses transitions inside the block', () => {
    expect(globalCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition-duration:\s*0\.001ms\s*!important/,
    );
  });

  it('clamps animation-iteration-count to 1 inside the block', () => {
    expect(globalCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-iteration-count:\s*1\s*!important/,
    );
  });

  it('zeroes animation-delay so delayed animations do not pop in late', () => {
    expect(globalCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-delay:\s*0s\s*!important/,
    );
  });

  it('zeroes transition-delay so delayed transitions do not pop in late', () => {
    expect(globalCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition-delay:\s*0s\s*!important/,
    );
  });

  it('uses the universal selector so module-CSS animations are also frozen', () => {
    // A future narrowing of the selector (e.g. to a specific class)
    // would silently lose coverage for CSS-Modules animations. The `*`
    // universal selector is what guarantees blanket reach.
    expect(globalCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after/,
    );
  });
});
