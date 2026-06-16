import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_VIZ_STATE } from './VizControls';

// The default vitest environment here is 'node' (no DOM), so provide a tiny
// in-memory localStorage rather than pulling in jsdom for one file.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

import {
  loadPresets,
  removePreset,
  savePresets,
  upsertPreset,
  type VizPreset,
} from './vizPresets';

const preset = (name: string): VizPreset => ({
  name,
  viz: { ...DEFAULT_VIZ_STATE },
  stage: 'radial',
});

describe('vizPresets persistence', () => {
  beforeEach(() => localStorage.clear());

  it('expected use: save then load round-trips', () => {
    savePresets([preset('Club'), preset('Chill')]);
    const loaded = loadPresets();
    expect(loaded.map((p) => p.name)).toEqual(['Club', 'Chill']);
    expect(loaded[0]!.stage).toBe('radial');
  });

  it('edge: corrupt storage yields an empty list, not a throw', () => {
    localStorage.setItem('spectr.viz.presets.v1', '{not json');
    expect(loadPresets()).toEqual([]);
  });

  it('upsert replaces by name and moves it to the front', () => {
    let list = [preset('A'), preset('B')];
    list = upsertPreset(list, { ...preset('B'), stage: 'spectro' });
    expect(list.map((p) => p.name)).toEqual(['B', 'A']);
    expect(list[0]!.stage).toBe('spectro');
  });

  it('remove drops the named preset', () => {
    const list = removePreset([preset('A'), preset('B')], 'A');
    expect(list.map((p) => p.name)).toEqual(['B']);
  });
});
