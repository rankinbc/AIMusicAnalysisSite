# Preset Compiler — Specification

The final stage. It takes the **merged, deduplicated fixes** coming out of the
router (Stage 4) and compiles them into a `rack-preset.json` the producer can load
directly. It does not analyze, diagnose, or invent fixes — it **translates** an
already-decided set of `fix` objects into your rack's module format, preserving the
preset's signal-chain order.

```
merged fixes ──▶ 1. FILTER ──▶ 2. TRANSLATE ──▶ 3. DEDUP/MERGE ──▶ 4. PRESERVE ORDER ──▶ rack-preset.json
(post-router)    (master/bus)   (type→module)    (per-module)       (slot in place)      + leftover advice
```

Input: a list of fixes, each with `target`, `dsp_chain[]`, optional `sidechain`,
and the metadata to explain itself. Plus a **base preset** (the user's current rack,
or a default) whose `order` array and module set define the target shape.

Output: a filled `rack-preset.json` (enabled modules with written params, others
left disabled) **plus** a list of fixes that couldn't be expressed as a master rack
(leftover advice — never silently dropped).

---

## Stage 1 — Filter to what a master rack can hold

A master-bus rack is the right home for **corrective, whole-mix** moves and the
wrong home for per-element moves. So:

- Keep fixes where `target.type` is `master` or `bus`.
- **Divert `target.type == "stem"` fixes to leftover advice** — applying a
  single-element fix to the whole mix is wrong. (The uploaded verdicts are almost
  all master-targeted, so this mostly passes through; the rule matters once stems
  exist.)
- **Divert any fix with a non-null `sidechain`** to leftover advice — the rack has
  no sidechain module, and sidechain is inherently per-element. Return it with its
  instruction intact, e.g. "per-stem sidechain: duck Bass to Kick — apply on the
  bass channel, not the master."

Everything that survives Stage 1 is expressible.

---

## Stage 2 — Translate each dsp_chain step to a module

Verified against the uploaded `rack-preset.json`. **Note the camelCase rename** —
the solver schema uses `snake_case`, the rack uses `camelCase`.

| `dsp_chain[].type` | Rack module | Param mapping (solver → rack) |
|---|---|---|
| `peaking_eq` | `eq` (a band) | `frequency_hz→freq`, `gain_db→gainDb`, `q→q`, band `type="peaking"` |
| `low_shelf` | `eq` (a band) | same, band `type="lowshelf"` |
| `high_shelf` | `eq` (a band) | same, band `type="highshelf"` |
| `high_pass` | `eq` (a band) or `djfilter` | `frequency_hz→freq`; band `type="highpass"`. Slope not representable per-band → see notes |
| `low_pass` | `eq` (a band) | `frequency_hz→freq`, band `type="lowpass"` |
| `compressor` | `comp` | `threshold_db→thresholdDb`, `ratio→ratio`, `attack_ms→attackMs`, `release_ms→releaseMs`, `knee_db→kneeDb`, `makeup_gain_db→makeupDb` |
| `limiter` | `limiter` | `ceiling_db→ceilingDb`, `release_ms→releaseMs`, `lookahead_ms→lookaheadMs` |
| `stereo_width` | `ms` | `width_pct→width` **as a ratio** (135% → `1.35`); set `monoMakerHz` if the fix implies mono-below-X |
| `gain` | `trim` | `gain_db→gainDb` |
| `multiband_compressor` | *(none)* | rack has no multiband → leftover advice |
| `sidechain` | *(none)* | → leftover advice (already filtered in Stage 1) |

For every module written: set `enabled = true`. Modules not touched by any fix keep
their base-preset `enabled` value (usually false).

### EQ band snapping (important)

The rack's `eq` has **8 fixed-frequency bands**: 60, 170, 350, 700, 1400, 3500,
7000, 14000 Hz. A fix asking for a cut at 300 Hz has no exact band. Two policies —
pick one and apply it consistently:

- **Snap (recommended):** route the fix to the nearest band (300 → 350) and write
  its `gainDb`/`q`. Preserves the preset's fixed structure; note the small frequency
  deviation in the change log.
- **Rewrite:** overwrite the nearest band's `freq` to the exact value (350 → 300).
  More accurate, but mutates the band grid.

Default to **snap**, and when two fixes snap to the same band, the larger-magnitude
`gainDb` wins (or sum them if same sign and the total stays in range — but cap at
`gain_db ∈ [-24,24]`).

### Slope caveat

The solver's `high_pass`/`low_pass` carry `slope_db`, but the rack's `eq` bands
don't expose slope. Either map a steep HP to the `djfilter` module, or accept the
EQ band's fixed slope and note it. Don't drop the fix — note the limitation.

---

## Stage 3 — Dedup and merge per module

**This is the stage that earns its keep**, and the uploaded verdicts show exactly
why: four specialists (dynamics, loudness, low_end, overall) each independently
proposed a **limiter** for the same 6-clipped-samples issue, with different
release/lookahead values. Naively compiling would write the limiter module four
times with conflicting params.

Rules:

- **One module instance, period.** All `limiter` fixes collapse into the single
  `limiter` module; all `comp` fixes into the single `comp`; all `eq` fixes into the
  one `eq` module's `bands[]` list (each at its own band — they don't conflict
  unless they snap to the same frequency).
- **When fixes conflict on the same module's scalar params** (the four limiters):
  this should already be resolved upstream by the router's merge step. If
  unresolved conflicts still arrive, pick by a deterministic rule — highest
  `confidence`, then highest `priorityScore` — and log the others as "also
  suggested." Never average silently into a value no specialist actually chose.
- **EQ is additive across bands**, not conflicting: a mud cut at 300 and a rumble
  HP at 30 are different bands and both apply. Only same-band collisions need the
  snap-resolution above.

Ideally the compiler receives already-merged fixes (the router did Stage 4), so
this stage is a safety net. But build it anyway — the uploaded data proves
duplicate fixes reach this point in practice.

---

## Stage 4 — Preserve the chain order

**Do not invent an order.** The base preset's `order` array already encodes a
correct signal chain:

```
djfilter → eq → gate → comp → sat → bitcrusher → ms → pan → tremolo → delay → reverb → limiter → trim
```

This is right: corrective EQ before the compressor (so you don't compress problems
you're about to remove), width (`ms`) late but before the limiter, limiter last as
the ceiling, trim after. The compiler **keeps this order** and only flips
`enabled` and writes params into the existing slots. It never reorders.

If the user supplies a custom `order`, honor it as-is — ordering is the user's
prerogative, and the compiler's job is to populate, not rearrange. (If a custom
order is audibly wrong — e.g. limiter before EQ — surface that as a note, don't
override it.)

---

## Output

```json
{
  "preset": { /* a valid rack-preset.json: same schemaVersion, same order,
                 modules enabled + param-filled per the fixes */ },
  "leftover_advice": [
    {
      "problem_id": "low_end.kick_bass_mask.0",
      "reason": "per-stem sidechain — not expressible as a master rack",
      "instruction": "Duck the bass to the kick: depth 6 dB, release 140 ms, on the bass channel."
    }
  ],
  "change_log": [
    { "module": "ms", "change": "width → 1.35 (was 1.0)", "from_fix": "...stereo_field...", "why": "widen the near-mono image" },
    { "module": "eq", "change": "band@350 gainDb -2.5 (snapped from 300 Hz)", "from_fix": "...low_end mud...", "why": "tame low-mid mud" },
    { "module": "limiter", "change": "ceilingDb -1, releaseMs 120 (merged 4 limiter fixes)", "why": "catch the 6 clipped samples" }
  ]
}
```

The `change_log` is not optional — the producer will load a preset where the MS
module is suddenly at 135% and the EQ has a 350 Hz dip, and they need to know why.
It's the coaching layer; without it the preset is a black box.

---

## What the compiler guarantees

- **Valid against the rack schema** — correct `schemaVersion`, `order`, and module
  param keys (camelCase, verified).
- **No duplicate modules** — the four-limiter collision can't reach the output.
- **No silent drops** — anything unmappable (sidechain, multiband, stem-targeted)
  comes back as leftover advice with its instruction.
- **Order preserved** — never reordered; user's custom order honored.
- **Explained** — every change carries a why.

---

## Edge cases

- **All fixes filtered out** (everything was stem/sidechain): return the base preset
  unchanged + all fixes as leftover advice. Honest "nothing to apply at the master"
  beats a no-op preset presented as a fix.
- **Fix targets a `bus` the rack doesn't model**: the rack is a single master/bus
  chain; treat `bus` like `master` unless you add multi-bus support, and note it.
- **EQ runs out of bands** (>8 distinct frequencies needed): snap collisions
  together; if still over 8, keep the highest-priority cuts and list the rest as
  leftover advice. Don't exceed the band count.
- **`width_pct` of 0** (mono): set `ms.width = 0` or `ms.mono = true` — both express
  it; prefer `mono = true` for a full mono-fold, `width = 0` for "collapse width."
- **A win verdict with `fix: null`**: skip — nothing to compile. Wins are
  observations, not preset changes.
