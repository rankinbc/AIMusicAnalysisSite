import { describe, expect, it } from 'vitest';

import type { FixRackDto, RackPresetDto } from '../../../api/types';
import { presetRows, queuedSummary } from '../send-to-listen-model';

const chain = (ids: string[]) => ({
  order: ids,
  modules: Object.fromEntries(ids.map((id) => [id, { enabled: true }])),
});

const fixRack = (over: Partial<FixRackDto> = {}): FixRackDto => ({
  presetId: 'cm-1',
  name: 'Coach Mix',
  chain: chain(['eq', 'limiter']),
  createdAt: '2026-07-24T00:00:00Z',
  ...over,
});

const userPreset = (id: string, ids: string[]): RackPresetDto => ({
  id,
  songVersionId: 'v1',
  name: `Preset ${id}`,
  source: 'user',
  chain: chain(ids),
  createdAt: '2026-07-24T00:00:00Z',
  updatedAt: '2026-07-24T00:00:00Z',
});

describe('presetRows', () => {
  it('expected: Coach Mix auto row first, then user presets', () => {
    const rows = presetRows(fixRack(), [userPreset('a', ['comp']), userPreset('b', ['reverb', 'limiter'])]);
    expect(rows.map((r) => r.key)).toEqual(['coach-mix', 'a', 'b']);
    expect(rows[0].auto).toBe(true);
    expect(rows[0].moduleCount).toBe(2);
    expect(rows[1].auto).toBe(false);
    expect(rows[2].moduleCount).toBe(2);
  });

  it('edge: no Coach Mix yet → only user presets, none auto', () => {
    const rows = presetRows(null, [userPreset('a', ['eq'])]);
    expect(rows).toHaveLength(1);
    expect(rows[0].auto).toBe(false);
  });

  it('failure: nothing generated and no presets → empty list', () => {
    expect(presetRows(null, [])).toEqual([]);
  });

  it('carries presetId for the Listen carry-over handle', () => {
    const rows = presetRows(fixRack({ presetId: undefined }), [userPreset('a', ['eq'])]);
    expect(rows[0].presetId).toBeUndefined(); // pre-12.4 cached rack
    expect(rows[1].presetId).toBe('a');
  });
});

describe('queuedSummary', () => {
  it('formats fixes + presets', () => {
    expect(queuedSummary(0, 0)).toBe('nothing queued');
    expect(queuedSummary(1, 0)).toBe('1 fix queued');
    expect(queuedSummary(3, 1)).toBe('3 fixes queued · 1 preset');
    expect(queuedSummary(2, 2)).toBe('2 fixes queued · 2 presets');
  });
});
