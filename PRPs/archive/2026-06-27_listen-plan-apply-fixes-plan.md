# Listen "Plan" Tab — Per-Fix Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Listen page's "Plan" tab, render each fix the user "Added" on Results as a checkbox that applies/reverts that one fix's DSP settings on the live rack, so they can A/B each fix in isolation.

**Architecture:** Frontend-only wiring. The backend solver already produces concrete `dsp_chain` ops on `verdicts.fix`, already surfaced on `VerdictDto.fix` and `Move`. We (1) carry the structured ops on `Move`, (2) hand them off Results→Listen via localStorage, (3) convert a fix's ops to a Listen rack patch, and (4) apply/revert per checkbox by recomputing the rack from a fix-free baseline.

**Tech Stack:** React 19, TypeScript strict (`verbatimModuleSyntax` + `exactOptionalPropertyTypes`), Vite 6, Vitest + React Testing Library. No Tailwind; CSS Modules + global classes.

## Global Constraints

- **Working directory for all `npm`/`npx` commands:** `components/frontend-spectr-v2`. `git` commands run from the repo root.
- **Four gates must pass before each commit:** `npx tsc --noEmit`, `npm run lint` (eslint `--max-warnings 0`), `npm run build` (vite + `tsc -b`, stricter — catches `exactOptionalPropertyTypes`), `npx vitest run`.
- **`import type` is mandatory** for type-only imports (`verbatimModuleSyntax`).
- **`exactOptionalPropertyTypes`:** optional object props must be omitted, not set to `undefined`. Prefer required fields with explicit `null` over `?:` where a value always exists.
- **No raw hex in `*.module.css`** (lint rule). This task adds no new CSS modules; reuse existing global classes / inline dynamic styles like the surrounding `rail.tsx` code.
- **EQ band `type`** accepts exactly `'peaking' | 'lowshelf' | 'highshelf' | 'lowpass' | 'highpass'` (`src/features/listen/audio/state.ts:5-9`, mapped to BiquadFilter at `eq.ts:28`).
- **`ms.width` is a ratio 0–2** (`MODULE_DEFAULTS.ms.width = 1`), NOT a percent — divide solver `width_pct` by 100.
- **Solver param keys are snake_case** (`frequency_hz`, `gain_db`, `q`, `ceiling_db`, `release_ms`, `lookahead_ms`, `threshold_db`, `ratio`, `attack_ms`, `knee_db`, `makeup_gain_db`, `width_pct`, `mono_below_hz`).

---

### Task 1: Carry structured ops on the Move model

**Files:**
- Modify: `src/features/results/move-model.ts` (Move interface ~42-78; `verdictToMove` ~169-201; `ruleFixToMove` ~205-235)
- Test: `src/features/results/__tests__/move-model.test.ts`

**Interfaces:**
- Consumes: `VerdictDspOp` from `../../api/types` (`{ type: string; params: Record<string, unknown> }`) — already imported in `move-model.ts`.
- Produces: `Move.ops: VerdictDspOp[]` — the raw solver ops (empty for rule-engine moves). Consumed by Tasks 3 and 6.

- [ ] **Step 1: Write the failing test** — append to `src/features/results/__tests__/move-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ruleFixToMove, verdictToMove } from '../move-model';
import type { VerdictDto } from '../../../api/types';

function fakeVerdict(over: Partial<VerdictDto> = {}): VerdictDto {
  return {
    id: 'v1', specialist: 'loudness', category: 'loudness', headline: 'Too loud',
    severity: 'critical', confidence: 0.8, priorityScore: 70,
    summary: '', body: '', whyItMatters: '', metricLine: '', chartType: null,
    userState: { applied: false, dismissed: false },
    fix: { dsp_chain: [{ type: 'limiter', params: { ceiling_db: -1 } }] },
    ...over,
  } as unknown as VerdictDto;
}

describe('Move.ops', () => {
  it('carries the raw dsp_chain ops from the verdict fix', () => {
    const m = verdictToMove(fakeVerdict());
    expect(m.ops).toEqual([{ type: 'limiter', params: { ceiling_db: -1 } }]);
  });

  it('is an empty array when the verdict has no fix', () => {
    const m = verdictToMove(fakeVerdict({ fix: null }));
    expect(m.ops).toEqual([]);
  });

  it('is an empty array for rule-engine moves', () => {
    expect(ruleFixToMove('Master bus: lower the ceiling a touch', 0).ops).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `components/frontend-spectr-v2`): `npx vitest run src/features/results/__tests__/move-model.test.ts`
Expected: FAIL — `ops` does not exist on the returned object / type error.

- [ ] **Step 3: Add the field and populate it**

In the `Move` interface (`move-model.ts`), add after `steps: MoveStep[];` (keep the existing `steps` comment block):

```ts
  /** Raw solver DSP ops (`fix.dsp_chain`), structured — drives the Listen rack
   *  apply. Empty for rule-engine moves and verdicts without a fix. */
  ops: VerdictDspOp[];
```

In `verdictToMove`, change the first line and add `ops` to the returned object:

```ts
export function verdictToMove(v: VerdictDto): Move {
  const ops = v.fix?.dsp_chain ?? [];
  const steps = ops.map(opToStep);
```

…and in that function's returned object add (next to `steps`):

```ts
    ops,
```

In `ruleFixToMove`'s returned object, add next to `steps: [],`:

```ts
    ops: [],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/results/__tests__/move-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/frontend-spectr-v2/src/features/results/move-model.ts components/frontend-spectr-v2/src/features/results/__tests__/move-model.test.ts
git commit -m "feat(results): carry structured solver ops on Move"
```

---

### Task 2: Fix → rack-patch converter + rack recompose

**Files:**
- Create: `src/features/listen-rack/fixToRackPatch.ts`
- Test: `src/features/listen-rack/fixToRackPatch.test.ts`

**Interfaces:**
- Consumes: `VerdictDspOp` from `../../api/types`; `EqBand`, `ModuleState`, `MODULE_DEFAULTS` from `./data`.
- Produces:
  - `interface FixPatch { modules: Record<string, Partial<ModuleState>>; eqBands: EqBand[]; leftover: VerdictDspOp[] }`
  - `fixToRackPatch(ops: VerdictDspOp[]): FixPatch`
  - `isApplyable(ops: VerdictDspOp[]): boolean`
  - `composeRack(appliedOps: VerdictDspOp[][]): Record<string, ModuleState>`

- [ ] **Step 1: Write the failing test** — create `src/features/listen-rack/fixToRackPatch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EqBand } from './data';
import { composeRack, fixToRackPatch, isApplyable } from './fixToRackPatch';

describe('fixToRackPatch', () => {
  it('maps a peaking_eq op to an enabled eq band (camelCase)', () => {
    const { eqBands, modules } = fixToRackPatch([
      { type: 'peaking_eq', params: { frequency_hz: 300, gain_db: -2.5, q: 1 } },
    ]);
    expect(modules).toEqual({});
    expect(eqBands).toEqual([{ type: 'peaking', freq: 300, gainDb: -2.5, q: 1, enabled: true }]);
  });

  it('maps a limiter op to the limiter module', () => {
    expect(fixToRackPatch([{ type: 'limiter', params: { ceiling_db: -1, release_ms: 100, lookahead_ms: 2 } }]).modules)
      .toEqual({ limiter: { enabled: true, ceilingDb: -1, releaseMs: 100, lookaheadMs: 2 } });
  });

  it('maps stereo_width width_pct to a 0-2 ratio and mono maker', () => {
    expect(fixToRackPatch([{ type: 'stereo_width', params: { width_pct: 90, mono_below_hz: 120 } }]).modules)
      .toEqual({ ms: { enabled: true, width: 0.9, monoMakerHz: 120 } });
  });

  it('routes unknown / per-stem ops to leftover', () => {
    const op = { type: 'sidechain', params: {} };
    const out = fixToRackPatch([op]);
    expect(out.leftover).toEqual([op]);
    expect(out.modules).toEqual({});
    expect(out.eqBands).toEqual([]);
  });

  it('isApplyable is false for empty / non-rack chains', () => {
    expect(isApplyable([])).toBe(false);
    expect(isApplyable([{ type: 'sidechain', params: {} }])).toBe(false);
    expect(isApplyable([{ type: 'gain', params: { gain_db: -3 } }])).toBe(true);
  });
});

describe('composeRack', () => {
  const eqOp = (hz: number) => [{ type: 'peaking_eq', params: { frequency_hz: hz, gain_db: -2, q: 1 } }];

  it('returns defaults when no fixes applied', () => {
    const r = composeRack([]);
    expect(r.eq.enabled).toBe(false);
    expect(r.limiter.enabled).toBe(false);
  });

  it('places two EQ fixes on two distinct band slots and enables eq', () => {
    const r = composeRack([eqOp(120), eqOp(10000)]);
    const bands = r.eq.bands as EqBand[];
    expect(r.eq.enabled).toBe(true);
    expect(bands[0]).toMatchObject({ freq: 120, gainDb: -2 });
    expect(bands[1]).toMatchObject({ freq: 10000, gainDb: -2 });
  });

  it('applies module fixes and leaves untouched modules at defaults', () => {
    const r = composeRack([[{ type: 'limiter', params: { ceiling_db: -1 } }]]);
    expect(r.limiter).toMatchObject({ enabled: true, ceilingDb: -1 });
    expect(r.comp.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen-rack/fixToRackPatch.test.ts`
Expected: FAIL — module `./fixToRackPatch` not found.

- [ ] **Step 3: Implement the converter** — create `src/features/listen-rack/fixToRackPatch.ts`:

```ts
// Fix DSP chain → Listen rack patch. MIRROR of the backend's per-op mapping in
// `components/worker/app/solve_lib/preset_compiler.py` (snake_case → camelCase).
// If you change a mapping here, change it there too (and vice-versa) — they are
// intentionally duplicated because per-fix apply needs live rack state for EQ
// band-slot allocation, which the whole-rack backend compile does not expose.
import type { VerdictDspOp } from '../../api/types';
import { MODULE_DEFAULTS, type EqBand, type ModuleState } from './data';

export interface FixPatch {
  /** Non-EQ module patches, keyed by rack module id (limiter, comp, ms, trim…). */
  modules: Record<string, Partial<ModuleState>>;
  /** EQ bands this fix wants; slot allocation happens in composeRack. */
  eqBands: EqBand[];
  /** Ops not expressible as a master-rack module (sidechain, per-stem, unknown). */
  leftover: VerdictDspOp[];
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function fixToRackPatch(ops: VerdictDspOp[]): FixPatch {
  const modules: Record<string, Partial<ModuleState>> = {};
  const eqBands: EqBand[] = [];
  const leftover: VerdictDspOp[] = [];

  for (const op of ops) {
    const p = op.params ?? {};
    switch (op.type) {
      case 'peaking_eq':
        eqBands.push({ type: 'peaking', freq: num(p.frequency_hz, 1000), gainDb: num(p.gain_db, 0), q: num(p.q, 1), enabled: true });
        break;
      case 'high_shelf':
        eqBands.push({ type: 'highshelf', freq: num(p.frequency_hz, 10000), gainDb: num(p.gain_db, 0), q: num(p.q, 0.7), enabled: true });
        break;
      case 'low_shelf':
        eqBands.push({ type: 'lowshelf', freq: num(p.frequency_hz, 80), gainDb: num(p.gain_db, 0), q: num(p.q, 0.7), enabled: true });
        break;
      case 'high_pass':
        eqBands.push({ type: 'highpass', freq: num(p.frequency_hz, 30), gainDb: 0, q: num(p.q, 0.7), enabled: true });
        break;
      case 'low_pass':
        eqBands.push({ type: 'lowpass', freq: num(p.frequency_hz, 18000), gainDb: 0, q: num(p.q, 0.7), enabled: true });
        break;
      case 'limiter':
        modules.limiter = { enabled: true, ceilingDb: num(p.ceiling_db, -1), releaseMs: num(p.release_ms, 50), lookaheadMs: num(p.lookahead_ms, 5) };
        break;
      case 'compressor':
        modules.comp = { enabled: true, thresholdDb: num(p.threshold_db, 0), ratio: num(p.ratio, 1), attackMs: num(p.attack_ms, 3), releaseMs: num(p.release_ms, 250), kneeDb: num(p.knee_db, 30), makeupDb: num(p.makeup_gain_db, 0) };
        break;
      case 'gain':
        modules.trim = { enabled: true, gainDb: num(p.gain_db, 0) };
        break;
      case 'stereo_width':
        modules.ms = { enabled: true, width: num(p.width_pct, 100) / 100, monoMakerHz: num(p.mono_below_hz, 0) };
        break;
      default:
        leftover.push(op);
    }
  }
  return { modules, eqBands, leftover };
}

export function isApplyable(ops: VerdictDspOp[]): boolean {
  const patch = fixToRackPatch(ops);
  return Object.keys(patch.modules).length > 0 || patch.eqBands.length > 0;
}

function freshDefaults(): Record<string, ModuleState> {
  return JSON.parse(JSON.stringify(MODULE_DEFAULTS)) as Record<string, ModuleState>;
}

/** Recompute a full rack from neutral defaults + each applied fix's ops, in
 *  order. EQ bands from all fixes are allocated to sequential slots (slot i for
 *  the i-th band); overflow past the 8 slots stacks onto the last slot. */
export function composeRack(appliedOps: VerdictDspOp[][]): Record<string, ModuleState> {
  const base = freshDefaults();
  const collectedEq: EqBand[] = [];

  for (const ops of appliedOps) {
    const patch = fixToRackPatch(ops);
    for (const id of Object.keys(patch.modules)) {
      base[id] = { ...base[id], ...patch.modules[id] } as ModuleState;
    }
    collectedEq.push(...patch.eqBands);
  }

  if (collectedEq.length > 0) {
    const bands = (base.eq.bands as EqBand[]).map((b) => ({ ...b }));
    collectedEq.forEach((band, i) => {
      bands[Math.min(i, bands.length - 1)] = { ...band };
    });
    base.eq = { ...base.eq, bands, enabled: true };
  }
  return base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/listen-rack/fixToRackPatch.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Add the cross-reference comment to the backend**

In `components/worker/app/solve_lib/preset_compiler.py`, add near the top (module docstring or first comment):

```python
# NOTE: the frontend mirrors this op→rack-module mapping in
# components/frontend-spectr-v2/src/features/listen-rack/fixToRackPatch.ts
# for per-fix apply. Keep the two mappings in sync.
```

- [ ] **Step 6: Commit**

```bash
git add components/frontend-spectr-v2/src/features/listen-rack/fixToRackPatch.ts components/frontend-spectr-v2/src/features/listen-rack/fixToRackPatch.test.ts components/worker/app/solve_lib/preset_compiler.py
git commit -m "feat(listen): add fix dsp_chain -> rack patch converter + recompose"
```

---

### Task 3: Listen-fixes storage (handoff types, parse, build, persist)

**Files:**
- Create: `src/features/listen-rack/listenFixes.ts`
- Test: `src/features/listen-rack/listenFixes.test.ts`

**Interfaces:**
- Consumes: `VerdictDspOp` from `../../api/types`; `isApplyable` from `./fixToRackPatch`.
- Produces:
  - `interface ListenFix { fixId: string; verdictId: string | null; title: string; scope: string; sev: string; specialist: string | null; ops: VerdictDspOp[] }`
  - `interface FixSource { id: string; verdictId: string | null; title: string; scope: string; sev: string; specialist: string | null; ops: VerdictDspOp[] }` (structurally satisfied by `Move`)
  - `buildListenFixes(sources: FixSource[], isCommitted: (id: string) => boolean): ListenFix[]`
  - `writeListenFixes(versionId: string, fixes: ListenFix[]): void`
  - `readListenFixes(versionId: string): ListenFix[]`
  - `readAppliedIds(versionId: string): string[]`
  - `writeAppliedIds(versionId: string, ids: string[]): void`

- [ ] **Step 1: Write the failing test** — create `src/features/listen-rack/listenFixes.test.ts`:

```ts
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
  it('keeps only committed AND applyable fixes', () => {
    const sources = [
      src({ id: 'a' }),
      src({ id: 'b', ops: [] }),                       // committed but not applyable
      src({ id: 'c' }),                                // not committed
    ];
    const committed = new Set(['a', 'b']);
    const out = buildListenFixes(sources, (id) => committed.has(id));
    expect(out.map((f) => f.fixId)).toEqual(['a']);
    expect(out[0]).toMatchObject({ verdictId: 'v1', title: 'Tame master', sev: 'crit' });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen-rack/listenFixes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement storage** — create `src/features/listen-rack/listenFixes.ts`:

```ts
// Results → Listen handoff. The user's "Added" fixes are persisted to
// localStorage (per version) so the Listen "Plan" tab can list them as
// checkboxes — survives reload and direct navigation. Only applyable fixes
// (those whose dsp_chain maps to a rack module) are written; prose fixes belong
// to the DAW game plan, not the rack.
import type { VerdictDspOp } from '../../api/types';
import { isApplyable } from './fixToRackPatch';

export interface ListenFix {
  fixId: string;
  verdictId: string | null;
  title: string;
  scope: string;
  sev: string;
  specialist: string | null;
  ops: VerdictDspOp[];
}

/** Minimal shape the builder needs — `Move` satisfies it structurally. */
export interface FixSource {
  id: string;
  verdictId: string | null;
  title: string;
  scope: string;
  sev: string;
  specialist: string | null;
  ops: VerdictDspOp[];
}

const fixesKey = (versionId: string) => `listenFixes:${versionId}`;
const appliedKey = (versionId: string) => `listenApplied:${versionId}`;

export function buildListenFixes(
  sources: FixSource[],
  isCommitted: (id: string) => boolean,
): ListenFix[] {
  return sources
    .filter((s) => isCommitted(s.id) && isApplyable(s.ops))
    .map((s) => ({
      fixId: s.id,
      verdictId: s.verdictId,
      title: s.title,
      scope: s.scope,
      sev: s.sev,
      specialist: s.specialist,
      ops: s.ops,
    }));
}

export function writeListenFixes(versionId: string, fixes: ListenFix[]): void {
  try {
    localStorage.setItem(fixesKey(versionId), JSON.stringify({ fixes }));
  } catch {
    /* quota / unavailable — non-fatal */
  }
}

export function readListenFixes(versionId: string): ListenFix[] {
  try {
    const raw = localStorage.getItem(fixesKey(versionId));
    if (!raw) return [];
    const data = JSON.parse(raw) as { fixes?: unknown };
    return Array.isArray(data.fixes) ? (data.fixes as ListenFix[]) : [];
  } catch {
    return [];
  }
}

export function readAppliedIds(versionId: string): string[] {
  try {
    const raw = localStorage.getItem(appliedKey(versionId));
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? (data as string[]) : [];
  } catch {
    return [];
  }
}

export function writeAppliedIds(versionId: string, ids: string[]): void {
  try {
    localStorage.setItem(appliedKey(versionId), JSON.stringify(ids));
  } catch {
    /* non-fatal */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/listen-rack/listenFixes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/frontend-spectr-v2/src/features/listen-rack/listenFixes.ts components/frontend-spectr-v2/src/features/listen-rack/listenFixes.test.ts
git commit -m "feat(listen): add Results->Listen fix handoff storage"
```

---

### Task 4: `applyRackMod` on the rack state

**Files:**
- Modify: `src/features/listen-rack/rackState.ts` (`RackState` interface ~28-50; hook body ~65-126)
- Test: `src/features/listen-rack/rackState.test.ts` (create)

**Interfaces:**
- Consumes: `pushFullRack` from `./rackBindings` (already imported); `ModuleState` from `./data`.
- Produces: `RackState.applyRackMod(mod: Record<string, ModuleState>): void` — replaces the whole module map and (when a graph is present) pushes the full rack to the audio engine. Consumed by Task 5.

- [ ] **Step 1: Write the failing test** — create `src/features/listen-rack/rackState.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MODULE_DEFAULTS, type ModuleState } from './data';
import { useRackState } from './rackState';

describe('applyRackMod', () => {
  it('replaces the module map and pushes the full rack to the graph', () => {
    const graph = {
      setEffectParams: vi.fn(), reorder: vi.fn(), setMasterBypass: vi.fn(),
      resetAll: vi.fn(), readEffectMeter: vi.fn().mockReturnValue(null),
    };
    const { result } = renderHook(() => useRackState(graph));
    const next: Record<string, ModuleState> = JSON.parse(JSON.stringify(MODULE_DEFAULTS));
    next.limiter = { ...next.limiter, enabled: true, ceilingDb: -1 };

    act(() => result.current.applyRackMod(next));

    expect(result.current.mod.limiter).toMatchObject({ enabled: true, ceilingDb: -1 });
    expect(graph.reorder).toHaveBeenCalled();           // pushFullRack ran
    expect(graph.setEffectParams).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen-rack/rackState.test.ts`
Expected: FAIL — `applyRackMod` is not a function.

- [ ] **Step 3: Implement** — in `rackState.ts`:

Add to the `RackState` interface (after `applyCoach: (apply: RackPatch) => void;`):

```ts
  applyRackMod: (mod: Record<string, ModuleState>) => void;
```

Add the callback in the hook body (after the `applyCoach` definition ~104):

```ts
  const applyRackMod = useCallback((nextMod: Record<string, ModuleState>) => {
    if (graph) pushFullRack(graph, nextMod, order, masterBypass);
    setMod(nextMod);
  }, [graph, order, masterBypass]);
```

Add `applyRackMod` to the returned object (next to `applyCoach`):

```ts
    setParam, setEnabled, setEqBands, reset, applyCoach, applyRackMod, activeCount, presets, savePreset, recallPreset,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/listen-rack/rackState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/frontend-spectr-v2/src/features/listen-rack/rackState.ts components/frontend-spectr-v2/src/features/listen-rack/rackState.test.ts
git commit -m "feat(listen): add applyRackMod to push a full computed rack"
```

---

### Task 5: `useFixOverlay` hook (toggle → recompute → apply → persist)

**Files:**
- Create: `src/features/listen-rack/useFixOverlay.ts`
- Test: `src/features/listen-rack/useFixOverlay.test.tsx`

**Interfaces:**
- Consumes: `ListenFix`, `readAppliedIds`, `writeAppliedIds` from `./listenFixes`; `composeRack` from `./fixToRackPatch`; `RackState` from `./rackState`.
- Produces: `useFixOverlay(args: { versionId: string; fixes: ListenFix[]; applyRackMod: RackState['applyRackMod'] }): { appliedIds: string[]; isApplied: (id: string) => boolean; toggle: (id: string) => void }`

- [ ] **Step 1: Write the failing test** — create `src/features/listen-rack/useFixOverlay.test.tsx`:

```ts
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListenFix } from './listenFixes';
import { useFixOverlay } from './useFixOverlay';

const fix = (id: string, ops: ListenFix['ops']): ListenFix => ({
  fixId: id, verdictId: null, title: id, scope: '', sev: 'info', specialist: null, ops,
});
const eq = (hz: number) => [{ type: 'peaking_eq', params: { frequency_hz: hz, gain_db: -2, q: 1 } }];

describe('useFixOverlay', () => {
  beforeEach(() => localStorage.clear());

  it('toggles a fix on and off, recomputing the rack each time', () => {
    const applyRackMod = vi.fn();
    const fixes = [fix('a', eq(120)), fix('b', [{ type: 'limiter', params: { ceiling_db: -1 } }])];
    const { result } = renderHook(() => useFixOverlay({ versionId: 'v', fixes, applyRackMod }));

    act(() => result.current.toggle('a'));
    expect(result.current.isApplied('a')).toBe(true);
    expect(applyRackMod.mock.calls.at(-1)![0].eq.enabled).toBe(true);

    act(() => result.current.toggle('b'));
    let mod = applyRackMod.mock.calls.at(-1)![0];
    expect(mod.eq.enabled).toBe(true);
    expect(mod.limiter.enabled).toBe(true);

    act(() => result.current.toggle('a'));            // uncheck a; b stays
    mod = applyRackMod.mock.calls.at(-1)![0];
    expect(mod.eq.enabled).toBe(false);
    expect(mod.limiter.enabled).toBe(true);
    expect(result.current.isApplied('a')).toBe(false);
  });

  it('persists applied ids and restores them on mount', () => {
    const applyRackMod = vi.fn();
    const fixes = [fix('a', eq(120))];
    const first = renderHook(() => useFixOverlay({ versionId: 'v', fixes, applyRackMod }));
    act(() => first.result.current.toggle('a'));

    const second = renderHook(() => useFixOverlay({ versionId: 'v', fixes, applyRackMod }));
    expect(second.result.current.isApplied('a')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen-rack/useFixOverlay.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/features/listen-rack/useFixOverlay.ts`:

```ts
// Per-fix apply for the Listen "Plan" tab. Each Added fix is a checkbox; the set
// of checked fixes defines an overlay recomputed from a fix-free baseline on
// every toggle (composeRack), so toggling is clean and fixes stack (two EQ fixes
// land on different bands; unchecking one keeps the other). Applied ids persist
// to localStorage per version.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { composeRack } from './fixToRackPatch';
import { readAppliedIds, writeAppliedIds, type ListenFix } from './listenFixes';
import type { RackState } from './rackState';

interface UseFixOverlayArgs {
  versionId: string;
  fixes: ListenFix[];
  applyRackMod: RackState['applyRackMod'];
}

export function useFixOverlay({ versionId, fixes, applyRackMod }: UseFixOverlayArgs) {
  const [appliedIds, setAppliedIds] = useState<string[]>(() => readAppliedIds(versionId));

  // Re-read when switching versions.
  useEffect(() => {
    setAppliedIds(readAppliedIds(versionId));
  }, [versionId]);

  const byId = useMemo(() => new Map(fixes.map((f) => [f.fixId, f])), [fixes]);

  const recompute = useCallback((ids: string[]) => {
    const ops = ids.map((id) => byId.get(id)?.ops).filter((o): o is ListenFix['ops'] => Array.isArray(o));
    applyRackMod(composeRack(ops));
  }, [byId, applyRackMod]);

  const toggle = useCallback((id: string) => {
    setAppliedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeAppliedIds(versionId, next);
      recompute(next);
      return next;
    });
  }, [versionId, recompute]);

  const isApplied = useCallback((id: string) => appliedIds.includes(id), [appliedIds]);

  return { appliedIds, isApplied, toggle };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/listen-rack/useFixOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/frontend-spectr-v2/src/features/listen-rack/useFixOverlay.ts components/frontend-spectr-v2/src/features/listen-rack/useFixOverlay.test.tsx
git commit -m "feat(listen): add useFixOverlay for per-fix apply/revert"
```

---

### Task 6: Write the structured handoff from Results

**Files:**
- Modify: `src/features/results/ReportView.tsx` (handoff effect ~179-203)
- Test: covered by Task 3 (`buildListenFixes`) — no new test; verify gates.

**Interfaces:**
- Consumes: `buildListenFixes`, `writeListenFixes` from `../listen-rack/listenFixes`.
- Produces: writes `listenFixes:${versionId}` localStorage entry on every change to the committed set.

- [ ] **Step 1: Replace the handoff effect**

In `ReportView.tsx`, add to the imports (top of file, with the other feature imports):

```ts
import { buildListenFixes, writeListenFixes } from '../listen-rack/listenFixes';
```

Replace the entire handoff `useEffect` (currently ~179-203, the one writing `coachMix:${versionId}`) with:

```ts
  // Listen handoff — persist the user's Added + applyable fixes for the Listen
  // "Plan" tab. Only fixes whose dsp_chain maps to a rack module are written;
  // prose fixes belong to the DAW game plan. Producer side only.
  useEffect(() => {
    if (!versionId) return;
    writeListenFixes(versionId, buildListenFixes(moves, (id) => committedIds.has(id)));
  }, [committedIds, moves, versionId]);
```

(Note: `jobId` is no longer referenced by this effect; leave it in scope for the rest of the component — it is used elsewhere.)

- [ ] **Step 2: Run the type + lint gates**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS, no unused-variable errors. If `jobId` becomes unused anywhere, that is a separate pre-existing usage — confirm it is still referenced (it is, by the analysis-modal `seenKey`).

- [ ] **Step 3: Run the converter/storage tests + full results suite**

Run: `npx vitest run src/features/listen-rack/ src/features/results/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/frontend-spectr-v2/src/features/results/ReportView.tsx
git commit -m "feat(results): write structured per-fix handoff to Listen"
```

---

### Task 7: Rebuild the Plan tab from real fixes

**Files:**
- Modify: `src/features/listen-rack/ListenRackPage.tsx` (RightRail render ~690-693)
- Modify: `src/features/listen-rack/rail.tsx` (`PlanPanel` ~518-541; `RightRail` props/signature ~592-633)
- Test: `src/features/listen-rack/rail.plan.test.tsx` (create)

**Interfaces:**
- Consumes: `readListenFixes`, `type ListenFix` from `./listenFixes`; `useFixOverlay` from `./useFixOverlay`; `RackState` (already in scope in `rail.tsx`).
- Produces: a `PlanPanel` driven by `versionId` + the live rack state.

- [ ] **Step 1: Write the failing test** — create `src/features/listen-rack/rail.plan.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanPanel } from './rail';
import type { RackState } from './rackState';
import { writeListenFixes } from './listenFixes';

function fakeRs(): RackState {
  return { applyRackMod: vi.fn() } as unknown as RackState;
}

describe('PlanPanel', () => {
  beforeEach(() => localStorage.clear());

  it('shows the empty state when no fixes were added', () => {
    render(<PlanPanel rs={fakeRs()} versionId="v1" />);
    expect(screen.getByText(/add fixes on the results page/i)).toBeInTheDocument();
  });

  it('renders a checkbox per added fix', () => {
    writeListenFixes('v1', [
      { fixId: 'a', verdictId: null, title: 'Tame the master', scope: 'Master bus', sev: 'crit', specialist: 'loudness', ops: [{ type: 'limiter', params: { ceiling_db: -1 } }] },
    ]);
    render(<PlanPanel rs={fakeRs()} versionId="v1" />);
    expect(screen.getByText('Tame the master')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen-rack/rail.plan.test.tsx`
Expected: FAIL — `PlanPanel` is not exported / signature mismatch.

- [ ] **Step 3: Rewrite `PlanPanel`** in `rail.tsx`.

Add imports at the top of `rail.tsx` (with the other local imports):

```ts
import { readListenFixes, type ListenFix } from './listenFixes';
import { useFixOverlay } from './useFixOverlay';
```

Replace the `PlanPanel` function (currently ~518-541) with — and `export` it for the test:

```tsx
// ── PLAN tab — the user's Added fixes, each a checkbox that applies that one
// fix to the live rack (recompute-from-baseline; uncheck to compare). ────────
export function PlanPanel({ rs, versionId }: { rs: RackState; versionId?: string }) {
  const fixes: ListenFix[] = useMemo(
    () => (versionId ? readListenFixes(versionId) : []),
    [versionId],
  );
  const { isApplied, toggle } = useFixOverlay({
    versionId: versionId ?? '',
    fixes,
    applyRackMod: rs.applyRackMod,
  });

  if (fixes.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <PLabel accent="var(--cyan)">Your plan · from the analysis</PLabel>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.5 }}>
          Add fixes on the Results page to apply them here. Each one becomes a checkbox you can toggle to A/B against your track.
        </div>
      </div>
    );
  }

  const sevColor = (sev: string) =>
    sev === 'crit' ? 'var(--orange)' : sev === 'warn' ? 'var(--violet)' : 'var(--cyan)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PLabel accent="var(--cyan)">Your plan · {fixes.length} fixes</PLabel>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>
        Check a fix to apply it to the rack — uncheck to compare.
      </div>
      {fixes.map((f) => {
        const on = isApplied(f.fixId);
        const c = sevColor(f.sev);
        const modules = [...new Set(f.ops.map((o) => o.type))].join(' · ');
        return (
          <label
            key={f.fixId}
            style={{ display: 'flex', gap: 10, padding: 12, borderRadius: 9, cursor: 'pointer', background: on ? 'rgba(0,229,176,0.05)' : 'rgba(255,255,255,0.02)', border: `1px solid ${cssVar(c)}33`, borderLeft: `3px solid ${c}` }}
          >
            <input
              type="checkbox"
              checked={on}
              onChange={() => toggle(f.fixId)}
              style={{ marginTop: 2, accentColor: 'var(--cyan)' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              {f.scope && <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: c, fontWeight: 700 }}>{f.scope.toUpperCase()}</div>}
              <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2, lineHeight: 1.3 }}>{f.title}</div>
              {modules && <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 4 }}>{modules}</div>}
            </div>
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Thread `versionId` through `RightRail`.**

In `rail.tsx`, add `versionId` to the `RightRail` props destructure and type (the `RightRail` signature ~592):

```ts
export function RightRail({ mode, access, cap, rs, track, position, activeNote, onNoteClick, onSeek, onReact, feed, announce, myStatus, roomControl, onGrant, versionId }: {
```

…and in that same props type object add:

```ts
  versionId?: string;
```

Then change the `plan` render line (~625) from `<PlanPanel rs={rs} announce={announce} />` to:

```tsx
        {active === 'plan' && <PlanPanel rs={rs} {...(versionId ? { versionId } : {})} />}
```

- [ ] **Step 5: Pass `versionId` from the page.**

In `ListenRackPage.tsx`, the `RightRail` element (~690), add the prop:

```tsx
          <RightRail mode={mode} access={access} cap={cap} rs={rs} track={track} position={position}
            activeNote={activeNote} onNoteClick={(n) => { setActiveNote(n.id); seek(n.t); }} onSeek={seek}
            onReact={(e) => { setMyStatus(e); spawnReaction(e, 'maek'); }} feed={feed} announce={announce} myStatus={myStatus}
            roomControl={roomControl} onGrant={grantControl} {...(versionId ? { versionId } : {})} />
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/features/listen-rack/rail.plan.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/frontend-spectr-v2/src/features/listen-rack/rail.tsx components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx components/frontend-spectr-v2/src/features/listen-rack/rail.plan.test.tsx
git commit -m "feat(listen): rebuild Plan tab from real Added fixes with apply checkboxes"
```

---

### Task 8: Retire the mock `PLAN_ITEMS` fixture

**Files:**
- Modify: `src/features/listen-rack/data.ts` (`PlanItem` type + `PLAN_ITEMS` ~466; also the `PLAN_ITEMS`/`RackPatch`-shaped helpers if now unused)

**Interfaces:** none produced; this is cleanup. `PlanPanel` no longer reads `PLAN_ITEMS` after Task 7.

- [ ] **Step 1: Confirm there are no remaining consumers**

Run (in `components/frontend-spectr-v2`): `npx tsc --noEmit` then search:
- Search the codebase for `PLAN_ITEMS` and `PlanItem`. Expected after Task 7: the only references are the definitions in `data.ts`.

- [ ] **Step 2: Remove the unused fixture**

In `data.ts`, delete the `PLAN_ITEMS` array (~466-…) and the `PlanItem` interface it instantiates. Update the SWAP BOUNDARY comment (~10) to drop `PLAN_ITEMS` from the REPLACE list. Leave `COACH_SUGGESTIONS` / `RackPatch` and everything else intact.

- [ ] **Step 3: Run the type + lint gates**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS (no unused-export or dangling-reference errors). If `cssVar` or `PLabel` were only used by the old `PlanPanel`, they are still used by other panels — confirm no "unused" lint error; if one appears, it indicates a missed reference, fix it.

- [ ] **Step 4: Commit**

```bash
git add components/frontend-spectr-v2/src/features/listen-rack/data.ts
git commit -m "chore(listen): remove mock PLAN_ITEMS fixture"
```

---

### Task 9: Backend verification — is `verdicts.fix` populated per verdict?

**Files:**
- Investigate: `components/worker/app/verdict_lib/`, `components/worker/app/solve_lib/router.py` (`merge`), the verdict persistence path (`degraded._to_row`, `verdict_actor._persist_verdict`).
- Possibly create: `PRPs/listen-plan-apply-fixes-backend-followup.md` (only if a gap is found).

**Interfaces:** none. Output is a documented finding.

- [ ] **Step 1: Determine where `Fix` is attached to a verdict**

Search the worker for `router.merge`, `solve(`, and assignments to `verdict.fix` / `.fix =`. Establish whether the **individual** verdict write path (per-specialist `run_specialist` and the rule-engine `degraded` path) runs the solver so `verdicts.fix.dsp_chain` is populated — versus only the whole-rack `generate_fix_rack` actor (`fix_rack_actor.py`) computing it transiently.

- [ ] **Step 2: Confirm against the frontend contract**

Confirm `VerdictDto.fix.dsp_chain` is non-null for at least one applyable category in a real verdict payload (e.g. inspect a `verdicts_payload` JSON, or the BFF `VerdictDto` mapping in `bff/.../Endpoints/VerdictEndpoints.cs` / the verdict DTO). The Plan tab degrades safely either way (fewer/zero applyable fixes), so this is a confirmation, not a blocker.

- [ ] **Step 3: Record the outcome**

- If `verdicts.fix` IS populated per verdict: add one line to `PRPs/listen-plan-apply-fixes-spec.md` under §8 noting it is confirmed, with the file:line where `merge`/solve runs on the verdict write path.
- If it is NOT: create `PRPs/listen-plan-apply-fixes-backend-followup.md` describing the gap and the minimal change (call `solve_lib.router.merge` / the per-verdict solver on the verdict write path so `fix.dsp_chain` persists), with exact file:line targets. Do not implement it in this plan.

- [ ] **Step 4: Commit the documentation**

```bash
git add PRPs/listen-plan-apply-fixes-spec.md PRPs/listen-plan-apply-fixes-backend-followup.md
git commit -m "docs(listen): record verdict.fix population finding for per-fix apply"
```

(Stage only the files that actually changed.)

---

### Task 10: Full gate run + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Run all four gates**

Run (in `components/frontend-spectr-v2`):

```bash
npx tsc --noEmit
npm run lint
npm run build
npx vitest run
```

Expected: all green. `vitest` total should be the prior count plus the new `fixToRackPatch`, `listenFixes`, `rackState`, `useFixOverlay`, `rail.plan`, and `move-model` ops tests.

- [ ] **Step 2: Manual smoke (document, do not automate)**

With the BFF + worker + dev server running (`npm run dev`), on a version that has applyable AI verdicts:
1. On Results, "Add" two fixes that map to the rack (e.g. an EQ fix + a limiter fix).
2. Navigate to `/listen-rack/$versionId`, open the **Plan** tab → both appear as checkboxes; prose fixes do not.
3. Check the EQ fix → hear/see the EQ band engage; check the limiter → both active; uncheck the EQ → limiter stays, EQ reverts.
4. Reload the Listen page → the fix list and checked state persist.

- [ ] **Step 3: Final commit (if any docs/notes changed)**

```bash
git add -A
git commit -m "test(listen): verify per-fix apply gates green"
```

---

## Self-Review

**Spec coverage:**
- §1 determination already exists → Task 9 verifies; Tasks 2/5 consume it. ✓
- §3 applyability rule → `isApplyable` (Task 2), enforced in handoff (Task 3/6) and Plan list (Task 7). ✓
- §4 converter mapping table → Task 2 implements every row + leftover. ✓
- §5 recompute-from-base + EQ band allocation → `composeRack` (Task 2) + `useFixOverlay` (Task 5) + `applyRackMod` (Task 4). ✓
- §6 handoff (structured, localStorage, applyable-filtered, persisted applied state) → Tasks 3 + 6 + 5. ✓
- §7 Plan-tab UI (checkboxes, empty state, module list) → Task 7. ✓
- §8 backend verification → Task 9. ✓
- §9 testing list → Tasks 1–7 each carry the named tests; Task 10 runs all gates. ✓
- §10/§11 risks + checklist → mapping cross-ref comment (Task 2 Step 5), band-overflow cap (composeRack), mock-plan retirement (Task 8). ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". Every code step shows full code. ✓

**Type consistency:** `Move.ops: VerdictDspOp[]` (Task 1) flows to `FixSource.ops` (Task 3, structurally) → `composeRack(VerdictDspOp[][])` (Task 2) → `useFixOverlay` (Task 5). `applyRackMod(mod: Record<string, ModuleState>)` defined Task 4, consumed Tasks 5/7. `ListenFix` shape identical across Tasks 3/5/7. `PlanPanel({ rs, versionId })` consistent Tasks 7. ✓
