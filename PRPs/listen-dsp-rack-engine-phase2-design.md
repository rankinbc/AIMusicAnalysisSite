# Listen DSP Rack — Phase 2: Reorder + Handle API (Design Delta)

Date: 2026-06-23
Status: Design approved — pending implementation plan
Builds on: Phase 1 (merged, `master`). Parent design: `PRPs/listen-dsp-rack-engine-design.md`.
Scope: audio-engine layer only. No UI. Behavior-preserving (consumers untouched).

## Goal

Make the insert chain runtime-reorderable and expose the generic handle API the future rack UI binds to — without changing the sound or breaking existing consumers.

## Decisions (locked)

- **Generic `setEffectParams(id, patch)`** is the new primary param API; the existing per-module setters (`setCompressor`, `setSaturation`, `setWidth`, `setEqBand`, `setEqEnabled`) stay as thin wrappers over it. `PreviewTools.tsx` / the route are NOT edited this phase.
- **No `setEffectBypass`.** Per-module on/off is the `enabled` flag already in each module's state, set via `setEffectParams(id, { enabled })`. One on/off concept.
- **`readEffectMeter(id)` accessor ships in P2** (cheap passthrough to each unit's optional `readMeter()`); the worklet meter *data* (gate/limiter) still lands in P5/P6.

## Design

### 1. Composer: stable endpoints + dynamic rewiring

P1's composer wired units statically and exposed `chain.input = first unit`, `chain.output = last unit`. Reorder changes which unit is first/last, which would move those endpoints and break the hook's `masterIn → chain.input` / `chain.output → masterProcessed` connections.

Fix: the composer owns two **stable** `GainNode`s — `chainIn` and `chainOut` — whose identity never changes. Units wire *between* them:

```
chainIn → units[order[0]].input … units[order[n-1]].output → chainOut
```

New `InsertChain` shape:

```ts
interface InsertChain {
  chainIn: AudioNode;        // stable — hook connects masterIn here, once
  chainOut: AudioNode;       // stable — hook connects to masterProcessed, once
  units: Record<EffectId, EffectUnit<unknown>>;
  getOrder(): EffectId[];
  reorder(order: EffectId[]): void;   // validates + rewires + ducks
  dispose(): void;
}
```

- **`rewire(order)`** (internal): disconnect every current inter-unit link plus `chainIn→first` and `last→chainOut`, then reconnect following `order`. The set of connections to make for a given order is pure logic, extracted to `dsp/chainLinks.ts` and unit-tested.
- **`reorder(order)`**: validate `order` is a permutation of the known ids (reject otherwise — throw, callers guard); ramp `chainOut.gain` → 0 over ~10 ms (`linearRampToValueAtTime`), `rewire(order)`, ramp back to 1 over ~10 ms. The dip masks the reconnection click. `getOrder()` returns the current order.

Because `chainIn`/`chainOut` are stable, the hook's boundary wiring (`masterIn → chainIn`, `chainOut → masterProcessed`), the dry passthrough lane, the analyser taps, and the pitch BufferSource lane are all untouched by a reorder.

### 2. Pure logic — `dsp/chainLinks.ts`

```ts
// The ordered list of node-to-node links for a given chain order.
// 'IN' = chainIn, 'OUT' = chainOut; effect ids otherwise.
type Endpoint = EffectId | 'IN' | 'OUT';
function chainLinks(order: EffectId[]): Array<[Endpoint, Endpoint]>
// e.g. ['eq','comp'] -> [['IN','eq'], ['eq','comp'], ['comp','OUT']]
```

Plus `isPermutation(order, known)` for reorder validation. Both are pure and unit-tested; the composer maps the link list onto real `connect()` calls.

### 3. Handle API (generic param setter + reorder + meter)

The hook already holds per-module state refs (`eqStateRef`, `compStateRef`, `satStateRef`, `widthStateRef`). Keep those four refs as-is; `setEffectParams(id, patch)` is a `switch (id)` that merges the patch into the matching ref and calls that unit's `applyParams` (the same work the existing `apply*` helpers do). No state-ref restructuring — the dispatch is the only new indirection.

```ts
setEffectParams(id, patch): void   // merge patch into stateRef[id], call units[id].applyParams(stateRef[id])
reorder(order): void               // chain.reorder(order)
getOrder(): EffectId[]             // chain.getOrder()
readEffectMeter(id): EffectMeter | null   // units[id].readMeter?.() ?? null
```

Back-compat wrappers (unchanged external behavior):
- `setCompressor(patch)` → `setEffectParams('comp', patch)`
- `setSaturation(patch)` → `setEffectParams('sat', patch)`
- `setWidth(patch)` → `setEffectParams('ms', patch)`
- `setEqBand(i, gainDb)` → mutate `eqStateRef.bands[i]`, then `setEffectParams('eq', { bands, enabled: true })` (keeps the P1 EQ `enabled: true` rule — the consumer pre-gates band gains)
- `setEqEnabled(enabled)` → keep its existing zero-gains-when-off behavior, then re-apply via `setEffectParams('eq', …)`

`resetAll()` resets every state ref to defaults AND resets order to `DEFAULT_ORDER`.

EQ stays special-cased in the dispatch: `setEffectParams('eq', …)` applies the EQ unit with `enabled: true` per the P1 rule (the consumer pre-gates band gains), regardless of any `enabled` in the patch.

### 4. Behavior preservation

- Default order = `DEFAULT_ORDER` (`['eq','comp','sat','ms']`), so a freshly built chain sounds exactly as P1.
- Consumers keep calling the old setters (now wrappers) → identical behavior until something calls `reorder()`.
- `reorder()` has no caller yet (the UI wires it later); P2 only exposes + tests it.

## File changes

- `audio/dsp/chainLinks.ts` + `chainLinks.test.ts` — new pure logic + tests.
- `audio/composer.ts` — stable `chainIn`/`chainOut`, `rewire`, `reorder` + duck, `getOrder`, validation. `InsertChain` shape updated.
- `audio/state.ts` — unchanged (the four state refs stay; dispatch lives in the hook).
- `useAudioGraph.ts` — wire `masterIn→chainIn` / `chainOut→masterProcessed` (was `chain.input`/`chain.output`); add `setEffectParams`/`reorder`/`getOrder`/`readEffectMeter`; convert old setters to wrappers. Pitch lane / analysers / master bypass unchanged.
- `EffectUnit.ts`, `effects/*` — unchanged.

## Testing

- `chainLinks(order)` — correct link list for representative orders (identity, reversed, single-element). Pure, vitest.
- `isPermutation` — accepts permutations, rejects missing/extra/duplicate ids. Pure, vitest.
- State-merge dispatch (if extracted as a pure helper) — patch merges into the right id.
- Live AudioNode rewiring + duck ramp: tsc + build + manual (jsdom has no AudioContext), same constraint as P1. Manual check: reorder modules during playback, confirm no dropout and the new order takes effect.

## Risks

- **Reorder click** — the ~10 ms duck must be tuned by ear; start at 10 ms.
- **Reorder mid-rewire race** — `reorder` is synchronous (disconnect→reconnect in one call); no async window. The duck ramps are scheduled on the audio clock around the synchronous rewire.
- **Stale order vs units** — `reorder` validates the order is exactly the known id set before touching the graph; an invalid order throws and leaves the graph untouched.
- **Pitch lane** — feeds `masterIn`, which feeds `chainIn`; reorder only permutes between `chainIn` and `chainOut`, so pitch playback is unaffected.

## Out of scope (later phases)

Reorder UI / drag handles (UI track); unhiding the new params (P3); new modules (P4); worklets + their meter data (P5); meter display wiring (P6).
