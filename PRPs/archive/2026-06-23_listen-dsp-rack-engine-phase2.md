# Listen DSP Rack Engine — Phase 2: Reorder + Handle API (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Listen-page insert chain runtime-reorderable and expose the generic handle API (`setEffectParams`, `reorder`, `getOrder`, `readEffectMeter`) the future rack UI binds to — without changing the sound or editing any consumer.

**Architecture:** The composer gains two stable boundary `GainNode`s (`chainIn`/`chainOut`) so reorder can rewire the units between them without moving the endpoints the hook connects to. `reorder(order)` validates the order is a permutation, ducks `chainOut.gain` to 0, rewires on a short timer (so the topology change lands inside the audio dip), then ramps back. The hook adds a `switch`-based `setEffectParams(id, patch)` dispatch plus `reorder`/`getOrder`/`readEffectMeter`, and the existing per-module setters become thin wrappers over the dispatch.

**Tech Stack:** TypeScript 5 (strict, `verbatimModuleSyntax`), React 19, Vite 6, Vitest, Web Audio API.

**Scope note:** Phase 2 of the `PRPs/listen-dsp-rack-engine-design.md` roadmap; design delta at `PRPs/listen-dsp-rack-engine-phase2-design.md`. Builds on the merged Phase 1 modular engine. Engine-only — no UI, no new effect modules. Phases 3-6 follow as separate plans.

## Global Constraints

- TypeScript strict + `verbatimModuleSyntax`: type-only imports MUST use `import type` (or inline `import { type X }`).
- No file over ~500 lines.
- Four gates must pass before every commit, run from `components/frontend-spectr-v2`:
  - `npx tsc --noEmit`
  - `npm run lint` (configured `--max-warnings 0`)
  - `npm run build`
  - `npx vitest run`
- Behavior-preserving: default chain order stays `DEFAULT_ORDER` (`['eq','comp','sat','ms']`); consumers (`PreviewTools.tsx`, route) are NOT edited; the public `AudioGraphHandle` only GAINS methods (no rename/removal/signature change of existing ones). At rest the chain sounds identical to Phase 1.
- Pure logic is unit-tested; live AudioNode wiring (composer rewire, duck, hook dispatch) is verified by `tsc`/build + a manual Listen-page check (jsdom has no AudioContext), same as Phase 1.
- All work in `components/frontend-spectr-v2/src/features/listen/`.

---

## File Structure

**Created:**
- `audio/dsp/chainLinks.ts` — `chainLinks(order)` + `isPermutation(order, known)`. Pure.
- `audio/dsp/chainLinks.test.ts` — tests.

**Modified:**
- `audio/composer.ts` — stable `chainIn`/`chainOut`, internal `wire(order)`, `reorder(order)` + duck, `getOrder()`; `InsertChain` shape changes `input`/`output` → `chainIn`/`chainOut`.
- `useAudioGraph.ts` — twice: (Task 2) update the 2 processed-lane wiring lines to the renamed endpoints; (Task 3) add `EffectParamMap`, the `applyEffectParams` dispatch, the new handle methods, convert old setters to wrappers, reset order in `resetAll`.

**Unchanged:** `EffectUnit.ts`, `audio/state.ts`, `audio/effects/*`, all consumers.

---

### Task 1: Chain-link math (`chainLinks` + `isPermutation`)

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen/audio/dsp/chainLinks.ts`
- Test: `components/frontend-spectr-v2/src/features/listen/audio/dsp/chainLinks.test.ts`

**Interfaces:**
- Consumes: `EffectId` from `../EffectUnit` (type only).
- Produces:
  - `type ChainEndpoint = EffectId | 'IN' | 'OUT'`.
  - `chainLinks(order: EffectId[]): Array<[ChainEndpoint, ChainEndpoint]>` — the ordered source→dest pairs to connect for a chain order. `'IN'`=chainIn, `'OUT'`=chainOut. `[]` → `[['IN','OUT']]`.
  - `isPermutation(order: readonly EffectId[], known: readonly EffectId[]): boolean` — true iff `order` is exactly the multiset of `known` (rejects missing, extra, duplicate).

- [ ] **Step 1: Write the failing test**

```ts
// chainLinks.test.ts
import { describe, expect, it } from 'vitest';
import { chainLinks, isPermutation } from './chainLinks';

describe('chainLinks', () => {
  it('connects IN straight to OUT when empty', () => {
    expect(chainLinks([])).toEqual([['IN', 'OUT']]);
  });
  it('wraps a single unit between IN and OUT', () => {
    expect(chainLinks(['eq'])).toEqual([
      ['IN', 'eq'],
      ['eq', 'OUT'],
    ]);
  });
  it('chains units in order with IN/OUT bookends', () => {
    expect(chainLinks(['eq', 'comp', 'sat', 'ms'])).toEqual([
      ['IN', 'eq'],
      ['eq', 'comp'],
      ['comp', 'sat'],
      ['sat', 'ms'],
      ['ms', 'OUT'],
    ]);
  });
});

describe('isPermutation', () => {
  const known = ['eq', 'comp', 'sat', 'ms'] as const;
  it('accepts the same set in any order', () => {
    expect(isPermutation(['ms', 'sat', 'comp', 'eq'], known)).toBe(true);
    expect(isPermutation(['eq', 'comp', 'sat', 'ms'], known)).toBe(true);
  });
  it('rejects a missing id', () => {
    expect(isPermutation(['eq', 'comp', 'sat'], known)).toBe(false);
  });
  it('rejects an extra id (wrong length)', () => {
    expect(isPermutation(['eq', 'comp', 'sat', 'ms', 'eq'], known)).toBe(false);
  });
  it('rejects a duplicate (right length, wrong multiset)', () => {
    expect(isPermutation(['eq', 'eq', 'sat', 'ms'], known)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen/audio/dsp/chainLinks.test.ts`
Expected: FAIL — cannot resolve `./chainLinks`.

- [ ] **Step 3: Write `chainLinks.ts`**

```ts
// chainLinks.ts
import type { EffectId } from '../EffectUnit';

export type ChainEndpoint = EffectId | 'IN' | 'OUT';

// Ordered source->dest links to connect for a given chain order.
// 'IN' = the chain's stable input node, 'OUT' = its stable output node.
export function chainLinks(order: EffectId[]): Array<[ChainEndpoint, ChainEndpoint]> {
  if (order.length === 0) return [['IN', 'OUT']];
  const links: Array<[ChainEndpoint, ChainEndpoint]> = [['IN', order[0]]];
  for (let i = 0; i < order.length - 1; i += 1) {
    links.push([order[i], order[i + 1]]);
  }
  links.push([order[order.length - 1], 'OUT']);
  return links;
}

// True iff `order` is exactly the multiset of `known` (rejects missing,
// extra, and duplicate ids). Used to validate a reorder before touching
// the audio graph.
export function isPermutation(
  order: readonly EffectId[],
  known: readonly EffectId[],
): boolean {
  if (order.length !== known.length) return false;
  const a = [...order].sort();
  const b = [...known].sort();
  return a.every((id, i) => id === b[i]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/listen/audio/dsp/chainLinks.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/listen/audio/dsp/chainLinks.ts src/features/listen/audio/dsp/chainLinks.test.ts
git commit -m "feat(listen): add chain-link math for reorderable insert chain"
```

---

### Task 2: Composer — stable endpoints + reorder + duck

**Files:**
- Modify: `components/frontend-spectr-v2/src/features/listen/audio/composer.ts` (full rewrite of the body)
- Modify: `components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts` (2 wiring lines only)

**Interfaces:**
- Consumes: the 4 `create*Unit` factories; `DEFAULT_ORDER` from `./state`; `chainLinks`, `isPermutation` from `./dsp/chainLinks`; `EffectId`, `EffectUnit` from `./EffectUnit`.
- Produces (NEW `InsertChain` shape):
  ```ts
  interface InsertChain {
    chainIn: AudioNode;                 // stable — hook connects masterIn here
    chainOut: AudioNode;                // stable — hook connects to masterProcessed
    units: Record<EffectId, EffectUnit<unknown>>;
    getOrder(): EffectId[];
    reorder(order: EffectId[]): void;   // validates, ducks, rewires
    dispose(): void;
  }
  ```
  `buildInsertChain(ctx)` returns this. (Replaces the old `input`/`output` fields with `chainIn`/`chainOut` + adds `getOrder`/`reorder`.)

AudioNode-wiring task → verified by `tsc`/lint/build, not unit-tested. The pure link/permutation math it relies on is tested in Task 1.

- [ ] **Step 1: Rewrite `composer.ts`**

```ts
// composer.ts
import { createCompressorUnit } from './effects/compressor';
import { createEqUnit } from './effects/eq';
import { createSaturatorUnit } from './effects/saturator';
import { createWidthUnit } from './effects/width';
import { DEFAULT_ORDER } from './state';
import { chainLinks, isPermutation, type ChainEndpoint } from './dsp/chainLinks';
import type { EffectId, EffectUnit } from './EffectUnit';

export interface InsertChain {
  chainIn: AudioNode;
  chainOut: AudioNode;
  units: Record<EffectId, EffectUnit<unknown>>;
  getOrder: () => EffectId[];
  reorder: (order: EffectId[]) => void;
  dispose: () => void;
}

// Duration of each side of the reorder duck (down, then up), in seconds.
const DUCK_SECONDS = 0.01;

export function buildInsertChain(ctx: AudioContext): InsertChain {
  const units: Record<EffectId, EffectUnit<unknown>> = {
    eq: createEqUnit(ctx) as EffectUnit<unknown>,
    comp: createCompressorUnit(ctx) as EffectUnit<unknown>,
    sat: createSaturatorUnit(ctx) as EffectUnit<unknown>,
    ms: createWidthUnit(ctx) as EffectUnit<unknown>,
  };
  const chainIn = ctx.createGain();
  const chainOut = ctx.createGain();
  let order: EffectId[] = [...DEFAULT_ORDER];

  // A link's source is a unit's OUTPUT (or chainIn); its dest is a unit's
  // INPUT (or chainOut). 'IN' is never a dest, 'OUT' never a source.
  const sourceNode = (e: ChainEndpoint): AudioNode =>
    e === 'IN' ? chainIn : units[e as EffectId].output;
  const destNode = (e: ChainEndpoint): AudioNode =>
    e === 'OUT' ? chainOut : units[e as EffectId].input;

  // Tear down the inter-unit links and rebuild them for `next`. We disconnect
  // chainIn and every unit OUTPUT (the only nodes that source a link); we never
  // disconnect chainOut (it feeds the hook's masterProcessed downstream) — its
  // incoming link is dropped when the previous last-unit output is disconnected.
  const wire = (next: EffectId[]) => {
    chainIn.disconnect();
    (Object.keys(units) as EffectId[]).forEach((id) => units[id].output.disconnect());
    for (const [from, to] of chainLinks(next)) {
      sourceNode(from).connect(destNode(to));
    }
  };

  wire(order); // initial connect in default order

  return {
    chainIn,
    chainOut,
    units,
    getOrder: () => [...order],
    reorder: (next: EffectId[]) => {
      if (!isPermutation(next, order)) {
        throw new Error(`reorder: [${next.join(',')}] is not a permutation of [${order.join(',')}]`);
      }
      const g = chainOut.gain;
      const t0 = ctx.currentTime;
      // Duck the chain output to silence over DUCK_SECONDS.
      g.cancelScheduledValues(t0);
      g.setValueAtTime(g.value, t0);
      g.linearRampToValueAtTime(0, t0 + DUCK_SECONDS);
      // Rewire once the dip has landed (JS runs synchronously, so the
      // disconnect/connect must be deferred to ~the bottom of the ramp to
      // hide the click), then ramp back up.
      window.setTimeout(() => {
        wire(next);
        order = [...next];
        const t1 = ctx.currentTime;
        g.cancelScheduledValues(t1);
        g.setValueAtTime(0, t1);
        g.linearRampToValueAtTime(1, t1 + DUCK_SECONDS);
      }, DUCK_SECONDS * 1000 + 2);
    },
    dispose: () => {
      chainIn.disconnect();
      chainOut.disconnect();
      Object.values(units).forEach((u) => u.dispose());
    },
  };
}
```

- [ ] **Step 2: Update the 2 wiring lines in `useAudioGraph.ts`**

Locate the processed-lane wiring inside `buildGraph` (added in Phase 1) and rename the endpoint references. It currently reads:

```ts
masterIn.connect(chain.input);
chain.output.connect(masterProcessed).connect(masterOut);
```

Change to:

```ts
masterIn.connect(chain.chainIn);
chain.chainOut.connect(masterProcessed).connect(masterOut);
```

Nothing else in `useAudioGraph.ts` references `chain.input`/`chain.output` (the apply* helpers use `chain.units`, cleanup uses `chain.dispose()`). Do not change anything else in this step.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (A failure here means a stray `chain.input`/`chain.output` reference remains — fix it to `chainIn`/`chainOut`.)

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: PASS (0 warnings; build succeeds — confirms the new composer + hook wiring type-check and bundle).

- [ ] **Step 5: Run the suite (no regressions)**

Run: `npx vitest run`
Expected: PASS — all existing tests + Task 1's `chainLinks` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/features/listen/audio/composer.ts src/features/listen/useAudioGraph.ts
git commit -m "feat(listen): stable chain endpoints + reorder with duck in composer"
```

---

### Task 3: Handle API — `setEffectParams` / `reorder` / `getOrder` / `readEffectMeter`

**Files:**
- Modify: `components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts`

**Interfaces:**
- Consumes: `InsertChain` (Task 2); `EffectId`, `EffectMeter` from `./audio/EffectUnit`; the existing state refs + `apply*` helpers; `DEFAULT_ORDER`, `EqBand`, `CompressorState`, `SaturationState`, `WidthState` from `./audio/state`.
- Produces (added to `AudioGraphHandle`):
  ```ts
  interface EffectParamMap {
    eq: { bands: EqBand[] };
    comp: CompressorState;
    sat: SaturationState;
    ms: WidthState;
  }
  setEffectParams<K extends EffectId>(id: K, patch: Partial<EffectParamMap[K]>): void;
  reorder(order: EffectId[]): void;
  getOrder(): EffectId[];
  readEffectMeter(id: EffectId): EffectMeter | null;
  ```
  The existing setters (`setCompressor`/`setSaturation`/`setWidth`) become wrappers over `setEffectParams`.

Integration task → verified by the full gate suite + a manual Listen-page check.

- [ ] **Step 1: Add the `EffectParamMap` type + extend the `AudioGraphHandle` interface**

Near the top of `useAudioGraph.ts` (after the imports / alongside the other exported types), add — and make sure `EffectId` and `EffectMeter` are imported from `./audio/EffectUnit`, and `EqBand`/`CompressorState`/`SaturationState`/`WidthState` are available (they are, via the existing imports from `./audio/state`):

```ts
import type { EffectId, EffectMeter } from './audio/EffectUnit';

export interface EffectParamMap {
  eq: { bands: EqBand[] };
  comp: CompressorState;
  sat: SaturationState;
  ms: WidthState;
}
```

Then add these members to the `AudioGraphHandle` interface (alongside the existing `setCompressor` etc.):

```ts
  setEffectParams: <K extends EffectId>(id: K, patch: Partial<EffectParamMap[K]>) => void;
  reorder: (order: EffectId[]) => void;
  getOrder: () => EffectId[];
  readEffectMeter: (id: EffectId) => EffectMeter | null;
```

- [ ] **Step 2: Add the `applyEffectParams` dispatch helper**

Add this function next to the existing `apply*` helpers (it reuses them, so define it AFTER `applyEq`/`applyCompressor`/`applySaturation`/`applyWidth`). It is the single place that maps an id + patch onto the right state ref + apply call:

```ts
const applyEffectParams = <K extends EffectId>(
  id: K,
  patch: Partial<EffectParamMap[K]>,
): void => {
  switch (id) {
    case 'eq': {
      const p = patch as Partial<EffectParamMap['eq']>;
      if (p.bands) eqStateRef.current = p.bands;
      applyEq(); // EQ always applies enabled:true (consumer pre-gates band gains)
      break;
    }
    case 'comp':
      Object.assign(compStateRef.current, patch);
      applyCompressor();
      break;
    case 'sat':
      Object.assign(satStateRef.current, patch);
      applySaturation();
      break;
    case 'ms':
      Object.assign(widthStateRef.current, patch);
      applyWidth();
      break;
  }
};
```

- [ ] **Step 3: Convert the existing setters to wrappers + add the new handle methods**

In the memoized handle object, change the three per-module setters to delegate, and add the four new methods. `setEqBand`/`setEqEnabled` keep their existing bodies (unchanged behavior). Replace:

```ts
    setCompressor: (patch) => {
      Object.assign(compStateRef.current, patch);
      applyCompressor();
    },
    setSaturation: (patch) => {
      Object.assign(satStateRef.current, patch);
      applySaturation();
    },
    setWidth: (patch) => {
      Object.assign(widthStateRef.current, patch);
      applyWidth();
    },
```

with:

```ts
    setCompressor: (patch) => applyEffectParams('comp', patch),
    setSaturation: (patch) => applyEffectParams('sat', patch),
    setWidth: (patch) => applyEffectParams('ms', patch),
    setEffectParams: (id, patch) => applyEffectParams(id, patch),
    reorder: (order) => nodesRef.current?.chain.reorder(order),
    getOrder: () => nodesRef.current?.chain.getOrder() ?? [...DEFAULT_ORDER],
    readEffectMeter: (id) => nodesRef.current?.chain.units[id]?.readMeter?.() ?? null,
```

- [ ] **Step 4: Reset the order in `resetAll`**

In the `resetAll` handle method, after the existing state-ref resets + `apply*` calls, also reset the chain order (no-op-safe — `reorder` validates and `DEFAULT_ORDER` is always a permutation of the current order):

```ts
      // existing: reset eq/comp/sat/width refs + applyEq/applyCompressor/applySaturation/applyWidth + applyMasterBypass
      nodesRef.current?.chain.reorder([...DEFAULT_ORDER]);
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (Watch for: `DEFAULT_ORDER` must be imported in `useAudioGraph.ts` — it is used in `getOrder`/`resetAll`; add `DEFAULT_ORDER` to the existing `./audio/state` import if not already present. `EffectId`/`EffectMeter` imported from `./audio/EffectUnit`.)

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: PASS, 0 warnings.

- [ ] **Step 7: Full suite**

Run: `npx vitest run`
Expected: PASS — no regressions (the new handle methods aren't called by any consumer yet, so existing behavior is unchanged).

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 9: Manual smoke test (deferred to controller — needs running app + BFF + browser)**

This cannot run in jsdom. On a running Listen page, confirm:
- All existing module controls (EQ/comp/sat/M-S/bypass/reset/pitch/loop/scope) behave exactly as before (the wrappers didn't change behavior).
- Via the dev console on the page's audio graph handle (or a temporary throwaway button): `graph.reorder(['ms','sat','comp','eq'])` reorders the chain with no dropout; `graph.getOrder()` reflects it; `graph.reorder(['eq','comp','sat'])` throws (not a permutation) and leaves audio intact; `graph.setEffectParams('comp', { ratio: 8, enabled: true })` compresses; `graph.readEffectMeter('comp')` returns a `{ reductionDb }` value.

Note in the report that manual verification is deferred.

- [ ] **Step 10: Commit**

```bash
git add src/features/listen/useAudioGraph.ts
git commit -m "feat(listen): generic setEffectParams + reorder/getOrder/readEffectMeter handle API"
```

---

## Self-Review

**1. Spec coverage (Phase 2 design):**
- Stable `chainIn`/`chainOut` endpoints + `rewire` → Task 2. ✓
- `reorder()` validates permutation + ducks + rewires on timer → Task 2 (uses Task 1 `isPermutation`/`chainLinks`). ✓
- `getOrder()` → Task 2. ✓
- Pure `chainLinks` + `isPermutation` + tests → Task 1. ✓
- `setEffectParams(id, patch)` dispatch; old setters as wrappers; EQ `enabled:true` rule preserved → Task 3. ✓
- `reorder`/`getOrder`/`readEffectMeter` handle methods → Task 3. ✓
- No `setEffectBypass` (enabled flag covers on/off) → not added, correct. ✓
- `resetAll` resets order → Task 3 Step 4. ✓
- Consumers untouched; handle only gains methods → Tasks 2-3 (no consumer edits). ✓
- Hook boundary wiring (masterIn→chainIn, chainOut→masterProcessed) stable across reorder → Task 2 Step 2. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step has complete code. Task 2/3 edits give exact old→new snippets rather than reproducing the large `useAudioGraph.ts` verbatim (transcription-risk tradeoff, called out).

**3. Type consistency:** `InsertChain` (now `chainIn`/`chainOut`/`getOrder`/`reorder`), `chainLinks`, `isPermutation`, `ChainEndpoint`, `EffectId`, `EffectMeter`, `EffectParamMap`, `applyEffectParams`, `DEFAULT_ORDER` — names match across producing/consuming tasks. Task 2 renames `InsertChain.input/output`→`chainIn/chainOut` AND updates the sole hook reference in the same task, so no task leaves a dangling reference. `setEffectParams` signature in the interface (Task 3 Step 1) matches the implementation (Task 3 Step 3) and `applyEffectParams` (Step 2).

**Gaps found:** none within Phase 2 scope.

---

## Risks / notes for the implementer

- **`window.setTimeout` in `reorder`** is required: the disconnect/connect is synchronous JS, so it must be deferred to the bottom of the duck ramp to land inside the audio dip. Don't "simplify" it to a synchronous rewire — that puts the click at full volume.
- **Rapid successive reorders** could overlap their timers. No caller exists yet in Phase 2 (the UI debounces later); leave as-is and note it.
- **Do not disconnect `chainOut`** in `wire()` — it feeds `masterProcessed` downstream of the chain; disconnecting it would sever the processed lane. Only `chainIn` + unit outputs are tear-down points.

## Next phases (separate plans)
- **P3** unhide existing params · **P4** new native modules · **P5** worklets · **P6** metering display wiring.
