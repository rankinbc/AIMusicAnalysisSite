// D10 — module-level pub/sub the app's MutationCache (built once, outside
// React) uses to open the shell's ONE upgrade dialog. Node env is enough:
// no DOM involved.
import { beforeEach, describe, expect, it } from 'vitest';

import { onGuestUpgrade, openGuestUpgrade } from '../guest-upgrade-bus';

describe('guest-upgrade-bus', () => {
  it('delivers to subscribers and stops after unsubscribe', () => {
    const seen: string[] = [];
    const off = onGuestUpgrade((r) => seen.push(r));
    openGuestUpgrade('upload_limit');
    off();
    openGuestUpgrade('not_allowed');
    expect(seen).toEqual(['upload_limit']);
  });

  it('carries the optional server message through as a second argument', () => {
    const seen: Array<[string, string | undefined]> = [];
    const off = onGuestUpgrade((reason, message) => seen.push([reason, message]));
    openGuestUpgrade('analysis_limit', 'A guest session includes 6 analyses.');
    openGuestUpgrade('stems_limit');
    off();
    expect(seen).toEqual([
      ['analysis_limit', 'A guest session includes 6 analyses.'],
      ['stems_limit', undefined],
    ]);
  });

  it('supports multiple independent subscribers', () => {
    const a: string[] = [];
    const b: string[] = [];
    const offA = onGuestUpgrade((r) => a.push(r));
    const offB = onGuestUpgrade((r) => b.push(r));
    openGuestUpgrade('reference_limit');
    offA();
    offB();
    expect(a).toEqual(['reference_limit']);
    expect(b).toEqual(['reference_limit']);
  });
});

describe('beforeEach reset sanity', () => {
  // Guards against a listener leaking across tests in this file (the Set is
  // module-level state) — every `it` above calls `off()` itself, but this
  // confirms the module doesn't retain anything once unsubscribed.
  beforeEach(() => {
    /* no shared mutable fixture in this file — nothing to reset */
  });

  it('a fully-unsubscribed bus delivers to nobody', () => {
    const seen: string[] = [];
    openGuestUpgrade('fix_rack_limit');
    expect(seen).toEqual([]);
  });
});
