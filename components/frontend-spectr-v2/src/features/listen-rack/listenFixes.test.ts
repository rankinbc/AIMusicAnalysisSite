import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildListenFixes, readAppliedIds, readListenFixes, writeAppliedIds, writeListenFixes,
  type FixSource,
} from './listenFixes';

const src = (over: Partial<FixSource> = {}): FixSource => ({
  id: 'm1', verdictId: 'v1', title: 'Tame master', scope: 'Master bus', sev: 'crit',
  specialist: 'loudness', ops: [{ type: 'limiter', params: { ceiling_db: -1 } }], ...over,
});

describe('buildListenFixes', () => {
  // Story 12.4 (AC5): committed-but-unmappable fixes are KEPT and flagged —
  // never silently dropped (previously they were filtered out entirely).
  it('keeps every committed fix; unmappable ones are flagged notApplicable', () => {
    const sources = [
      src({ id: 'a' }),
      src({ id: 'b', ops: [] }),                       // committed but not applyable
      src({ id: 'c' }),                                // not committed
    ];
    const committed = new Set(['a', 'b']);
    const out = buildListenFixes(sources, (id) => committed.has(id));
    expect(out.map((f) => f.fixId)).toEqual(['a', 'b']);
    expect(out[0]).toMatchObject({ verdictId: 'v1', title: 'Tame master', sev: 'crit', notApplicable: false });
    expect(out[1]).toMatchObject({ fixId: 'b', notApplicable: true });
  });

  it('flags sidechain/multiband-only fixes notApplicable', () => {
    const out = buildListenFixes(
      [
        src({ id: 'sc', ops: [{ type: 'sidechain', params: {} }] }),
        src({ id: 'mb', ops: [{ type: 'multiband_compressor', params: {} }] }),
      ],
      () => true,
    );
    expect(out.map((f) => f.notApplicable)).toEqual([true, true]);
  });
});

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips fixes through localStorage', () => {
    const fixes = buildListenFixes([src({ id: 'a' })], () => true);
    writeListenFixes('ver1', fixes);
    expect(readListenFixes('ver1')).toEqual(fixes);
  });

  it('returns [] for a missing or corrupt entry', () => {
    expect(readListenFixes('nope')).toEqual([]);
    localStorage.setItem('listenFixes:bad', '{not json');
    expect(readListenFixes('bad')).toEqual([]);
  });

  it('round-trips applied ids', () => {
    writeAppliedIds('ver1', ['a', 'b']);
    expect(readAppliedIds('ver1')).toEqual(['a', 'b']);
    expect(readAppliedIds('missing')).toEqual([]);
  });
});
