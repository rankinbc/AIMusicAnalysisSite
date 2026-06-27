# Listen "Plan" tab — per-fix apply (Add → checkbox → hear it)

**Status:** design / spec
**Date:** 2026-06-27
**Owner area:** `components/frontend-spectr-v2` (frontend-only; backend is verify-not-build)
**Related:** `PRPs/solve-deterministic-fix-rack.md` (the solver), `PRPs/results-redesign-integration-plan.md`, `PRPs/listen-v3-game-plan-comparison.md`

---

## 1. Goal

On the **Results** page a user "**Adds**" the fixes they want. On the **Listen** page's **"Plan"** tab, each Added fix appears as a **checkbox**. Checking it applies *just that one fix's* DSP change to the live rack (could be a single EQ band, or an EQ band + a compressor); unchecking cleanly reverts it. This lets the user **A/B each fix in isolation** against their own track.

This is distinct from **Coach Mix** (the "automix"): Coach Mix solves *all* problems at once into *one* whole-rack configuration. That already exists (`generate_fix_rack` → `RackPreset(source='analysis').chain_json`) and is **not changed** by this work.

### The determination already exists

We do **not** need to build a solver. `components/worker/app/solve_lib/` already turns each verdict into a concrete, range-validated `Fix` with a `dsp_chain` of numeric DSP ops, persisted on `verdicts.fix` (JSONB), and that `fix.dsp_chain` **already reaches the frontend** on `VerdictDto.fix` (it is what populates `Move.steps` today). The only missing pieces are on the Listen side: surface the Added fixes, convert each fix's `dsp_chain` into a rack patch, and apply/revert it per checkbox.

---

## 2. Scope

### In scope
- A **fix → rack-patch** converter on the frontend (`dsp_chain` → Listen `ModuleState` patch).
- **Per-fix apply/revert** on the Listen rack, with clean toggling and stacking (two EQ fixes land on *different* bands; unchecking one keeps the other).
- The **Plan tab** re-built from the real Added fixes (replacing mock `PLAN_ITEMS`).
- **Handoff** of the Added fixes from Results → Listen, persisted so it survives reload / direct navigation.
- **Results-side split**: applyable fixes get "Add to Listen"; prose fixes do not (they belong to the game plan).

### Out of scope
- Coach Mix / whole-rack automix (already shipped).
- The DAW **game plan** itself (prose fixes route there, but its rendering is separate existing work — we only make sure prose fixes are *excluded* from the Plan-tab checkbox list).
- Any new backend solver work. (One **verification** task in §8, not a build.)
- Persisting applied-checkbox state to the *backend* (we use browser storage — see §5).

---

## 3. The applyability rule (decides what becomes a checkbox)

A fix is **applyable** (→ becomes a Plan-tab checkbox) **iff** it carries a concrete `dsp_chain` that maps to at least one master-rack module. Concretely:

- `Move.hasParams === true` (i.e. `verdict.fix.dsp_chain` is non-empty), **and**
- at least one op in the chain maps to a rack module via the converter in §4 (ops that don't — per-stem, sidechain — are dropped; if *none* map, the fix is not applyable).

Everything else — rule-engine/prose fixes (`hasParams === false`, `steps: []`), and fixes whose every op is non-master-rack — is **not** a checkbox. Those are **DAW game-plan** items. No greyed-out rows on the Plan tab.

---

## 4. Converter: `fix.dsp_chain` → Listen rack patch

New module: `src/features/listen-rack/fixToRackPatch.ts`.

```ts
export interface FixOp { type: string; params: Record<string, unknown>; }

/** A fix's ops compiled to the modules/params it touches. EQ ops are returned
 *  as loose bands (no slot yet) — band-slot allocation happens at apply time
 *  in the rack overlay (§5), because it depends on live rack state. */
export interface FixPatch {
  /** Non-EQ module patches, keyed by rack module id (limiter, comp, ms, trim…). */
  modules: Record<string, Partial<ModuleState>>;
  /** EQ bands this fix wants added (peaking/shelf/pass). Slotted at apply time. */
  eqBands: EqBand[];
  /** Ops we could not express as a master-rack module (sidechain, per-stem). */
  leftover: FixOp[];
}

export function fixToRackPatch(ops: FixOp[]): FixPatch;
```

**Op → rack mapping (mirror of `worker/app/solve_lib/preset_compiler.py` — snake_case → camelCase):**

| solver op `type` | rack module | param mapping |
|---|---|---|
| `peaking_eq` | `eq` (band) | `{ type:'peaking', freq:frequency_hz, gainDb:gain_db, q, enabled:true }` |
| `high_shelf` | `eq` (band) | `{ type:'highshelf', freq:frequency_hz, gainDb:gain_db, q, enabled:true }` |
| `low_shelf` | `eq` (band) | `{ type:'lowshelf', freq:frequency_hz, gainDb:gain_db, q, enabled:true }` |
| `high_pass` | `eq` (band) | `{ type:'highpass', freq:frequency_hz, q, enabled:true }` |
| `low_pass` | `eq` (band) | `{ type:'lowpass', freq:frequency_hz, q, enabled:true }` |
| `limiter` | `limiter` | `{ ceilingDb:ceiling_db, releaseMs:release_ms, lookaheadMs:lookahead_ms, enabled:true }` |
| `compressor` | `comp` | `{ thresholdDb:threshold_db, ratio, attackMs:attack_ms, releaseMs:release_ms, kneeDb:knee_db, makeupDb:makeup_gain_db, enabled:true }` |
| `gain` | `trim` | `{ gainDb:gain_db, enabled:true }` |
| `stereo_width` | `ms` | `{ width: width_pct/100, monoMakerHz: mono_below_hz ?? 0, enabled:true }` |
| anything else | — | → `leftover` |

Notes:
- EQ band `type` strings must match what `pushEqBands`/the EQ renderer expect (`EqBand.type` is currently `'peaking'` in defaults — confirm the pass/shelf strings the binding accepts during implementation; if the binding only supports `peaking`, map shelves to `peaking` and note the fidelity loss).
- `ms.width` is a **ratio (0–2)**, not a percent — divide `width_pct` by 100 (matches `MODULE_DEFAULTS.ms.width = 1`).
- Only `target.type ∈ {master, bus}` ops are eligible; per-stem targets → `leftover`.
- **DRY guard:** add a header comment in both `fixToRackPatch.ts` and `preset_compiler.py` pointing at each other so the mapping tables don't silently drift. (We accept the duplication because per-fix apply needs live rack state for band slotting; a future option is a backend per-fix compiled patch on the DTO — see §10.)

---

## 5. Apply / revert model (recompute-from-base)

The existing `rackState.applyCoach(patch)` only *merges* — it can't un-apply, and an EQ patch replaces the whole `bands` array. So per-fix toggling needs an overlay layer, not raw `applyCoach`.

**Approach — recompute the rack from a fix-free base on every checkbox change:**

New hook: `src/features/listen-rack/useFixOverlay.ts`, sitting alongside `useRackState`.

State:
- `appliedFixIds: string[]` — ordered list of currently-checked fix ids (order = the order they were added/checked, stable).
- the available fixes come from the handoff (§6).

On any toggle:
1. Start from the **base rack** = `MODULE_DEFAULTS` (or the user's manually-saved rack baseline — see decision below).
2. For each fix id in `appliedFixIds` order, run `fixToRackPatch(fix.ops)` and fold it in:
   - non-EQ modules: shallow-merge the partial into the module (last writer wins per param — acceptable; deterministic by order).
   - EQ bands: **allocate sequentially** — append each fix's bands to the running `eq.bands` set, claiming the next free (disabled/default) band slots; record nothing extra (re-derived each recompute). Enable `eq` if any band was added. (8 band slots exist; if exceeded, stack onto the nearest-frequency band and `log`/note the cap.)
3. Push the fully recomputed rack to state + audio graph **once** via a new `applyFullOverlay(mod)` (wraps `pushFullRack`), so toggling is atomic and audible.

This makes toggles trivially correct: check → recompute includes it; uncheck → recompute omits it; no inverse-patch bookkeeping.

**Base-rack decision (v1):** the overlay's base is the **module defaults**, i.e. while any fix is applied the rack is "defaults + checked fixes". The Plan tab's fixes *own the rack* while in use. Manual knob edits made while fixes are checked are not merged in v1 (documented in the tab's helper text: "Applying fixes drives the rack from a clean baseline"). A future v2 can snapshot a user baseline; not needed to ship.

**Edge:** if the user has the rack mid-recompute and unchecks the *last* fix, recompute returns to defaults (rack reset to neutral). That's the correct "remove all fixes" behavior.

---

## 6. Handoff: Results → Listen

Today `ReportView.tsx` writes `sessionStorage["coachMix:${versionId}"]` with **lossy** `dsp: [{type, detail:"freq=120, gain=-3"}]`. Change:

- **Carry structured ops.** `Move` must retain the raw chain. Add `Move.ops?: FixOp[]` populated in `verdictToMove` directly from `v.fix?.dsp_chain` (the existing lossy `steps` stays for display). Rule-engine moves keep `ops: []`.
- **Filter to applyable fixes** at write time (per §3): only moves where `fixToRackPatch(m.ops).modules`/`eqBands` is non-empty are written to the handoff. (Import the converter on the Results side, or gate on `hasParams` + non-empty `ops` and let Listen drop any that fail to map.)
- New handoff item shape:
  ```ts
  { fixId, verdictId, title, scope, sev, specialist, ops: FixOp[] }
  ```
- **Storage:** switch the key to **localStorage** `listenFixes:${versionId}` so it survives reload and direct navigation to `/listen-rack/$versionId`. (sessionStorage is per-tab and lost on close — the user explicitly wants this to persist across the page hop and reloads.) Keep writing on every change to `committedIds` (the Added set), as today.
- **Applied-checkbox state** also persists: localStorage `listenApplied:${versionId}` = `string[]` of applied fix ids, read on mount, written on every toggle. (So a reload of Listen keeps both the list *and* which are applied.)

Keep the existing `coachMix:${versionId}` write only if something else consumes it; otherwise rename/retire it (grep first — Coach Mix modal may read it).

---

## 7. Plan-tab UI

Replace `PlanPanel`'s mock `PLAN_ITEMS` (`rail.tsx` ~518–541) with the real Added fixes:

- Read `listenFixes:${versionId}` + `listenApplied:${versionId}` (via a small `useListenFixes(versionId)` hook).
- Each row: **checkbox** + severity dot/color + title + scope; expanded, show the rack modules it touches (reuse the `RackModules` visual from results, or a compact inline list of module names from `fixToRackPatch`).
- Checkbox `onChange` → `useFixOverlay.toggle(fixId)` (recompute + push to rack) and persist applied set.
- **Empty state** when no applyable fixes were Added: "Add fixes on the Results page to apply them here." (Mirrors the existing empty-state styling.)
- Header line shows count + a one-liner: "Check a fix to apply it to the rack — uncheck to compare."
- Keep the tab id `plan` and its place in `railTabsFor` (solo/view modes already include `plan`). No new tab.

---

## 8. Backend verification (NOT a build)

One thing to confirm before relying on `dsp_chain` per fix:

- **Does the per-specialist write path populate `verdicts.fix`?** The solver definitely runs in `generate_fix_rack` (whole-rack). Confirm `verdict_actor` / `run_specialist` (and the rule-engine `degraded` path) **also** attach `Fix` to each individual verdict via `solve_lib/router.merge` so `VerdictDto.fix.dsp_chain` is non-null for applyable findings. If it does **not**, file a small backend follow-up to call `router.merge` (or the per-verdict solver) on the verdict write path. Until then, the Plan tab simply shows fewer/zero applyable fixes — it degrades safely, never breaks.

(Trace: `components/worker/app/verdict_lib/` + `solve_lib/router.py::merge`; `aimusic_shared.models.Verdict.fix`; BFF `VerdictDto.fix` → frontend `VerdictDto.fix.dsp_chain`.)

---

## 9. Testing

Frontend (`vitest`), all four gates must pass (`tsc --noEmit`, `lint --max-warnings 0`, `build`, `vitest run`):

- `fixToRackPatch`:
  - peaking_eq → one eq band, correct camelCase + enabled.
  - limiter/compressor/gain/stereo_width → correct module + param mapping (incl. `width_pct/100`).
  - unknown/sidechain/per-stem op → `leftover`, not a module.
  - empty / `fix:null` → empty patch (not applyable).
- `useFixOverlay` recompute:
  - apply A (EQ) then B (EQ) → two distinct bands; uncheck A → only B's band remains.
  - apply A (EQ) + B (limiter) → both modules set; uncheck B → eq stays, limiter back to default/off.
  - uncheck last fix → rack returns to defaults.
- Handoff round-trip: a committed applyable move serializes `ops` and reloads into a Plan checkbox; a prose move does **not** appear.
- Plan tab: empty state with no fixes; checkbox toggle calls overlay + persists applied set; reload restores applied set.

Update any existing `PLAN_ITEMS`-based tests / fixtures that assumed the mock plan.

---

## 10. Risks & future options

- **Mapping drift** between `fixToRackPatch.ts` and `preset_compiler.py` — mitigated by cross-reference comments + tests; the clean long-term fix is **(option A)** a backend per-fix compiled patch exposed on `VerdictDto.fix.rack_patch`, removing the TS duplicate. Deferred.
- **EQ band exhaustion** (>8 bands across many checked fixes) — cap + nearest-band stack + `log`; rare in practice (most analyses surface a handful of applyable fixes).
- **Shelf/pass band-type fidelity** — depends on what `pushEqBands` supports; fall back to `peaking` with a noted loss if needed.
- **Manual edits while fixes applied** — v1 defines fixes as owning the rack from a clean baseline; v2 could merge a user snapshot.

---

## 11. Implementation checklist

1. `Move.ops?: FixOp[]` + populate in `verdictToMove` from `v.fix.dsp_chain`.
2. `fixToRackPatch.ts` + unit tests (mirror `preset_compiler.py`; cross-ref comments).
3. `useFixOverlay.ts` (recompute-from-base, band allocation, `applyFullOverlay` via `pushFullRack`) + tests.
4. Handoff: write `listenFixes:${versionId}` (structured, filtered to applyable) + `listenApplied:${versionId}` in `ReportView.tsx`; retire/rename `coachMix:` if unused.
5. Results "Add" split: only applyable moves get "Add to Listen"; prose → game plan (exclude from handoff).
6. `useListenFixes(versionId)` hook + rebuilt `PlanPanel` (checkboxes, empty state) in `rail.tsx`.
7. Backend verification (§8); file follow-up if `verdicts.fix` isn't populated per-verdict.
8. Gates green; update mock-plan tests.
