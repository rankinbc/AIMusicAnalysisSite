import { describe, expect, it } from 'vitest';

import type { Chain } from './chain';
import {
  asChain, buildExportEnvelope, parseImportEnvelope, RACK_PRESET_SCHEMA_VERSION,
  resolveDraftRestore,
} from './useRackPresets';

const sampleChain: Chain = {
  order: ['eq', 'comp'],
  modules: { eq: { enabled: true }, comp: { enabled: false } } as Chain['modules'],
  masterBypass: true,
};

describe('asChain', () => {
  it('accepts a well-shaped chain', () => {
    const c = asChain(sampleChain);
    expect(c).not.toBeNull();
    expect(c!.order).toEqual(['eq', 'comp']);
    expect(c!.masterBypass).toBe(true);
  });

  it('coerces masterBypass to a strict boolean', () => {
    expect(asChain({ order: [], modules: {} })!.masterBypass).toBe(false);
    expect(asChain({ order: [], modules: {}, masterBypass: 'yes' })!.masterBypass).toBe(false);
  });

  it('drops non-string ids from order', () => {
    const c = asChain({ order: ['eq', 5, null, 'comp'], modules: {} });
    expect(c!.order).toEqual(['eq', 'comp']);
  });

  it('returns null when not shaped like a chain', () => {
    expect(asChain(null)).toBeNull();
    expect(asChain('nope')).toBeNull();
    expect(asChain({ modules: {} })).toBeNull(); // no order
    expect(asChain({ order: [] })).toBeNull(); // no modules
  });
});

describe('buildExportEnvelope', () => {
  it('wraps a chain with name + source + schema version', () => {
    const env = buildExportEnvelope('My Look', sampleChain);
    expect(env).toEqual({
      name: 'My Look',
      source: 'user',
      chain: sampleChain,
      schemaVersion: RACK_PRESET_SCHEMA_VERSION,
    });
  });
});

describe('parseImportEnvelope', () => {
  it('round-trips an exported envelope', () => {
    const text = JSON.stringify(buildExportEnvelope('Roundtrip', sampleChain));
    const { name, chain } = parseImportEnvelope(text);
    expect(name).toBe('Roundtrip');
    expect(chain.order).toEqual(['eq', 'comp']);
    expect(chain.masterBypass).toBe(true);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseImportEnvelope('{not json')).toThrow(/valid JSON/i);
  });

  it('rejects a missing name', () => {
    expect(() => parseImportEnvelope(JSON.stringify({ chain: sampleChain }))).toThrow(/name/i);
  });

  it('rejects a missing/invalid chain', () => {
    expect(() => parseImportEnvelope(JSON.stringify({ name: 'x', chain: { order: [] } })))
      .toThrow(/chain/i);
    expect(() => parseImportEnvelope(JSON.stringify({ name: 'x' }))).toThrow(/chain/i);
  });
});

// Wave-3 E6.6 — the draft-restore decision the ListenRackPage effect executes.
describe('resolveDraftRestore', () => {
  const base = {
    draftRestored: false,
    realAudio: true,
    carryPhase: 'none' as const,
    isError: false,
    isFetched: true,
  };

  it('waits when already restored or on the mock route', () => {
    expect(resolveDraftRestore({ ...base, draftRestored: true })).toBe('wait');
    expect(resolveDraftRestore({ ...base, realAudio: false })).toBe('wait');
  });

  it('parks everything while a fix-rack carry is pending — even a GET error', () => {
    expect(resolveDraftRestore({ ...base, carryPhase: 'pending' })).toBe('wait');
    expect(resolveDraftRestore({ ...base, carryPhase: 'pending', isError: true })).toBe('wait');
  });

  it('arms autosave without restoring once a carry applied', () => {
    expect(resolveDraftRestore({ ...base, carryPhase: 'applied' })).toBe('arm');
  });

  it('PAUSES on a draft GET error — autosave must stay disarmed (E6.6)', () => {
    expect(resolveDraftRestore({ ...base, isError: true })).toBe('pause');
    // A failed carry falls through to the normal path, where the GET error
    // still pauses (the saved draft is never sacrificed).
    expect(resolveDraftRestore({ ...base, carryPhase: 'failed', isError: true })).toBe('pause');
  });

  it('waits while the fetch is unsettled, restores once it lands', () => {
    expect(resolveDraftRestore({ ...base, isFetched: false })).toBe('wait');
    expect(resolveDraftRestore(base)).toBe('restore');
  });

  it('a successful refetch after an error resumes the restore (Retry path)', () => {
    expect(resolveDraftRestore({ ...base, isError: true })).toBe('pause');
    expect(resolveDraftRestore({ ...base, isError: false, isFetched: true })).toBe('restore');
  });
});
