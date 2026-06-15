import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Read the CSS as a string at test time. Going through Node FS (not Vite's
// ?raw query) keeps the test resolver-free and survives vitest's node env.
const STYLES_DIR = fileURLToPath(new URL('..', import.meta.url));
const globalCss = readFileSync(join(STYLES_DIR, 'global.css'), 'utf-8');
const tokensCss = readFileSync(join(STYLES_DIR, 'tokens.css'), 'utf-8');

// Story 1.7 / UX-DR5 / AC5 — the ambient signature (dual radial gradients
// + 48 px grid overlay) must survive any future global-reset PR. A
// regression here loses the brand atmosphere.

describe('global.css ambient signature', () => {
  it('declares a body background with both radial gradients', () => {
    const radials = globalCss.match(/radial-gradient\(/g) ?? [];
    // Two radials (cyan top + violet bottom-right) — see global.css:20-28.
    expect(radials.length).toBeGreaterThanOrEqual(2);
  });

  it('declares the 48 px grid overlay via two perpendicular linear gradients', () => {
    const linears = globalCss.match(/linear-gradient\(/g) ?? [];
    expect(linears.length).toBeGreaterThanOrEqual(2);
    expect(globalCss).toContain('48px 48px');
  });

  it('attaches the background as fixed so it reads as ambient (not scroll-coupled)', () => {
    expect(globalCss).toMatch(/background-attachment:\s*fixed/);
  });
});

// Story 1.7 / UX-DR4 — sr-only utility class for screen-reader-only text.
// Used by GradePill to announce "Grade: A" instead of bare "A".

describe('global.css sr-only utility', () => {
  it('defines the visually-hidden pattern', () => {
    expect(globalCss).toMatch(/\.sr-only\s*\{/);
    // Legacy `clip` for old engines; `clip-path` is the CSS Masking L1
    // replacement that modern browsers honour. Both must be present so
    // the visually-hidden guarantee survives `clip` deprecation.
    expect(globalCss).toMatch(/clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
    expect(globalCss).toMatch(/clip-path:\s*inset\(50%\)/);
  });
});

// Story 1.7 / UX-DR1 — Syne + JetBrains Mono are self-hosted from /fonts/.
// If a future PR drops the @font-face declarations and falls back to
// system-ui, fidelity is lost silently. This test guards that.

describe('global.css self-hosted font declarations', () => {
  it('declares @font-face for Syne pointing at /fonts/', () => {
    expect(globalCss).toMatch(/@font-face[^}]*font-family:\s*'Syne'[^}]*\/fonts\//s);
  });

  it('declares @font-face for JetBrains Mono pointing at /fonts/', () => {
    expect(globalCss).toMatch(/@font-face[^}]*font-family:\s*'JetBrains Mono'[^}]*\/fonts\//s);
  });
});

// Story 1.7 / UX-DR3 — tokens-presence regression. A future find-and-replace
// that strips one of these names would break every downstream consumer
// silently. Catch it at the foundation layer.

describe('tokens.css token presence', () => {
  it.each([
    '--space-4-5',
    '--sev-warning',
    '--sev-info',
    '--sev-fixed',
    '--tier-free',
    '--tier-pro',
    '--tier-credits',
    '--paywall-overlay',
  ])('defines token %s', (name) => {
    expect(tokensCss).toContain(name);
  });

  it('keeps the four story-1.2 bridge tokens (decision: KEEP — see story 1.7 dev notes)', () => {
    expect(tokensCss).toContain('--accent-bright');
    expect(tokensCss).toContain('--ink-on-accent');
  });
});
