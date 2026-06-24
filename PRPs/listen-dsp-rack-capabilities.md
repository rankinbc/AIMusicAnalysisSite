# Listen Page — DSP Rack Capability Manifest (UI Design Handoff)

Date: 2026-06-23
Audience: UI designer (human or Claude design) laying out the revamped Listen-page effects rack.
Companion engineering docs: `PRPs/listen-dsp-rack-engine-design.md` (architecture), `PRPs/listen-dsp-rack-engine.md` (build plan).

## What this document is

It enumerates the **complete target control surface** of the Listen page's effects rack after the revamp: every module, every adjustable parameter, its range, default, value formatting, and the interaction model around it. Design the UI to accommodate this whole surface.

> **STATUS (2026-06-24): the ENGINE IS COMPLETE.** All five build phases (1–5) are merged. **Every "Planned-Pn" tag below is now LIVE** — all 13 insert modules, every param, reorder, the worklets (gate/bitcrusher/limiter), and the comp/gate/limiter meter *data* are shipped and gate-green (`tsc -b`/lint/`vitest`/build). The only remaining engine work is Phase 6 (wiring meter *display*), which does NOT block UI design. Treat the whole control surface below as buildable today. The one thing not yet done is a manual browser smoke (`PRPs/listen-smoke-script.md`).

Each module/param was tagged with **Availability** during the build-out (**Live** = shipped, **Planned-Pn** = was pending at authoring time). Per the status above, **all are now Live.**

## Engine binding (the contract the UI wires to)

The engine is done and frozen; the UI drives it through the typed `AudioGraphHandle` in `features/listen/useAudioGraph.ts`. Two companion artifacts:
- **`features/listen/rackManifest.ts`** — machine-readable per-module/param descriptors (control kind, range, step, unit, default, enum options, tier). Map over it to render controls instead of reverse-engineering `state.ts`.
- **`PRPs/listen-smoke-script.md`** — a browser-console procedure to verify the engine actually works before/while building the UI.

Canonical handle usage:
- `graph.setEffectParams(id, patch)` — the generic, type-safe driver for ALL 13 modules (`patch` = `Partial<EffectParamMap[id]>`). `setCompressor/setSaturation/setWidth` are exact aliases — prefer `setEffectParams`.
- `graph.reorder(order)` / `graph.getOrder()` — runtime reorder (click-free; defaults to `DEFAULT_ORDER`).
- `graph.readEffectMeter(id)` — live meter: `comp` → `{reductionDb}`, `gate` → `{reductionDb, open}`, `limiter` → `{reductionDb}`; all others `null`.
- `graph.readFrame()` — spectrum / scope / short-LUFS / true-peak / correlation for the visualizers.
- `graph.setMasterBypass(b)`, `graph.resetAll()`, `graph.ensureContext()` (call from the play-button gesture — browser autoplay policy).
- Pitch lane: `enterPitchMode/exitPitchMode/setPitchDetune/pitch*` — pitch is NOT an insert effect (not in `EffectId`, not reorderable).

**EQ is the one exception to the uniform model.** `EffectParamMap['eq']` is `{ bands: EqBand[] }`, and the EQ unit is ALWAYS graph-enabled — there is no unit-level EQ bypass. Drive it with `setEffectParams('eq', { bands })` (full array; each `EqBand` has `type/freq/gainDb/q/enabled`). Represent "EQ off" by flattening every band gain to 0 dB (what the legacy `setEqEnabled(false)` does; note `setEqEnabled(true)` does NOT restore prior gains — the UI owns its band state and re-applies). Optional future engine cleanup: give EQ a real unit bypass like the other 12.

## Module tiering (primary use = a full mixed song)

The Listen page is mainly a **mastering / loudness preview** of a finished stereo mix, not a per-stem tool. Tier the UI accordingly — the engine keeps all modules; this is purely UI prominence:
- **Primary "mastering" rack (surface prominently):** EQ, Compressor, Saturator, M/S Width, **Limiter** (the core "-1 dBTP" loudness preview), Output Trim.
- **Secondary "creative / per-element" FX (tuck behind a disclosure):** DJ Filter, Delay, Reverb, Stereo Pan, Tremolo/Auto-pan, Gate, Bitcrusher. Less useful on a whole mix (reverb/delay/gate over a full kit muddies it) — keep them fully functional; they shine if a per-stem Listen view is ever added.

`rackManifest.ts` carries a `tier` per module (`MASTERING_IDS` / `CREATIVE_IDS`) so the layout can read it directly.

## Page context (fixed — not part of this revamp)

The rack lives on the Listen page below the player/visualizer. Surrounding elements already exist and are NOT changing: the cover/title header, the visualizer stage (spectrum/radial/spectrogram/laser), the transport (play, scrubber with section coloring, volume, timecode, add-note), and the right rail tabs (Meters, Issues, DJ stem deck, Notes). The rack is one card in the center column. Today it is an "Insert rack" with 8 module cards; the revamp expands it to ~14 effect modules plus rack-level reorder and metering.

---

## Interaction model (applies rack-wide)

These behaviors are uniform across modules — design them once, reuse everywhere.

| Concern | Behavior | Availability |
|---|---|---|
| **Per-module enable/bypass** | Every effect has an On/Off toggle. Off = true bypass (signal passes untouched). | Live |
| **Per-module focus/expand** | A module card shows a compact summary (1-3 key knobs). Selecting it reveals its full parameter set. Today only Pitch has an expanded panel; the revamp needs an expanded view for every module given the param counts below. | Live (pattern exists) |
| **Mix (dry/wet)** | Modules marked "has Mix" expose a 0-100% wet control (parallel blend). Others are full-wet when on. | mixed (see per-module) |
| **Reorder** | The insert chain is user-reorderable by drag. Any module can move to any position; nothing is locked. Reordering is live (brief ~10 ms audio dip masks it). Show the current signal order. | Planned-P2 |
| **Master bypass** | One rack-level toggle bypasses the entire chain (A/B the processed vs dry signal). | Live |
| **Reset** | Rack-level reset returns every module to defaults (transparent chain). | Live |
| **Active count** | Rack header shows how many modules are on + bypass state. | Live |
| **Metering** | Some modules emit live readouts (gain reduction, gate open/closed). Design meter affordances into those cards. See Metering section. | Planned-P6 (comp meter data Live) |
| **Worklet loading** | Gate, Bitcrusher, Limiter run on an AudioWorklet that registers asynchronously. Until ready (a few hundred ms after first audio), they should show a brief "loading/initializing" state, then become active. | Planned-P5 |

### Control-type + formatting conventions

Suggested widget per parameter kind (designer owns final aesthetics; these convey semantics):

- **Knob** — continuous bounded value (gain, frequency, time). Many are already rendered as rotary knobs with a value readout.
- **Bipolar knob** — value centered at 0 with a detent (pan, tilt, asymmetry, DJ-filter morph). Center = neutral.
- **Slider** — fine 1-D value where a knob is awkward (cents, mix).
- **Toggle** — boolean (enable, sync, ping-pong, mono).
- **Select / segmented** — enumerated choice (filter type, sat curve, reverb IR, LFO shape, oversample, delay division).
- **Meter** — read-only live display (GR, correlation, gate state).

Value formatting examples (keep consistent): `-3.0 dB`, `+6.0 dB`, `2.5:1`, `12 ms`, `250 ms`, `1.4 kHz` / `60 Hz`, `45 %`, `+3 st`, `-20 ¢`, `1/8`, `1.25×`, `-1.0 dBTP`.

---

## Signal chain (default order)

```
in → DJ Filter → EQ → Gate → Compressor → Saturator → Bitcrusher →
     Width → Pan → Tremolo → Delay → Reverb → Limiter → Output Trim → out
```

This is the **default** only — the user can reorder any module (P2). Pitch is NOT in this chain (see its note). The UI should render the chain order somewhere (the rack already shows a "Signal: …" readout) and let the user drag to reorder once P2 lands.

---

## Modules

Ranges are the engine's accepted range. Default = the neutral/transparent value. "Has Mix" = exposes a dry/wet blend.

### 1. EQ — 8-band parametric  ·  has Mix: no
Purpose: shape tone across 8 bands. Today the UI collapses to 3 macro knobs (Low/Mid/Hi); the revamp exposes all 8 bands + per-band controls, ideally with an interactive draggable curve.

| Param | Type | Range | Default | Format | Availability |
|---|---|---|---|---|---|
| Per-band type (×8) | Select | peaking / low-shelf / high-shelf / low-pass / high-pass / band-pass / notch / all-pass | peaking | — | Planned-P3 |
| Per-band frequency (×8) | Knob (log) | 20 – 20000 Hz | 60/170/350/700/1400/3500/7000/14000 | `1.4 kHz` | Planned-P3 |
| Per-band gain (×8) | Knob | −24 – +24 dB | 0 | `+3.0 dB` | Live (as 3 macros) / per-band Planned-P3 |
| Per-band Q (×8) | Knob | 0.1 – 18 | 1.4 | `1.4` | Planned-P3 |
| Per-band enable (×8) | Toggle | — | on | — | Planned-P3 |
| Module enable | Toggle | — | off | — | Live |

Design note: an interactive frequency-response curve (drag nodes to set freq/gain, scroll for Q) is the ideal primary control; the per-band table is the fallback/detailed view. A live spectrum behind the curve is a plus (spectrum data already exists).

### 2. Compressor  ·  has Mix: yes
Purpose: dynamic range control. Today exposes Threshold/Ratio/Attack; revamp adds the rest + a gain-reduction meter.

| Param | Type | Range | Default | Format | Availability |
|---|---|---|---|---|---|
| Threshold | Knob | −60 – 0 dB | 0 | `-18 dB` | Live |
| Ratio | Knob | 1 – 20 | 1 | `4:1` | Live |
| Attack | Knob | 0 – 250 ms | 3 | `3 ms` | Live |
| Release | Knob | 0 – 1000 ms | 250 | `250 ms` | Planned-P3 (wired, hidden) |
| Knee | Knob | 0 – 40 dB | 30 | `30 dB` | Planned-P3 (wired, hidden) |
| Makeup | Knob | −12 – +24 dB | 0 | `+6.0 dB` | Planned-P3 (wired, hidden) |
| Mix | Slider | 0 – 100 % | 100 % | `100 %` | Planned-P3 |
| Module enable | Toggle | — | off | — | Live |
| **Gain-reduction meter** | Meter | live dB (read-only) | — | `-4.2 dB GR` | Planned-P6 (data Live) |

Design note: a transfer curve (input→output with threshold/ratio/knee) + a moving GR meter are the signature compressor visuals.

### 3. Saturator  ·  has Mix: yes
Purpose: harmonic saturation / drive. Today exposes Drive/Mix; revamp adds curve selection, tone, asymmetry, oversample, trim.

| Param | Type | Range | Default | Format | Availability |
|---|---|---|---|---|---|
| Drive | Knob | 0 – 100 % | 0 | `45 %` | Live |
| Mix | Knob/Slider | 0 – 100 % | 0 | `50 %` | Live |
| Curve / algorithm | Select | tanh / soft-clip / hard-clip / arctan / sine-fold / tube | tanh | — | Planned-P3 |
| Oversample | Segmented | none / 2× / 4× | 2× | `2×` | Planned-P3 |
| Asymmetry | Bipolar knob | −1 – +1 | 0 | `+0.3` | Planned-P3 |
| Tone (tilt) | Bipolar knob | −1 – +1 | 0 | `+0.2` | Planned-P3 |
| Output trim | Knob | −24 – +12 dB | 0 | `-3.0 dB` | Planned-P3 |
| Module enable | Toggle | — | off | — | Live |

Design note: a waveshaper transfer-curve preview that updates with Drive/Curve/Asymmetry is the signature visual.

### 4. M/S Width  ·  has Mix: no
Purpose: stereo width via mid/side. Today one Width knob; revamp adds independent M/S gains + a bass-mono maker.

| Param | Type | Range | Default | Format | Availability |
|---|---|---|---|---|---|
| Width | Knob (center=1) | 0 – 2 | 1 | `1.25×` (Mono ← → Wide) | Live |
| Mid gain | Knob | −12 – +12 dB | 0 | `+1.0 dB` | Planned-P3 |
| Side gain | Knob | −12 – +12 dB | 0 | `-2.0 dB` | Planned-P3 |
| Mono-maker | Knob | 0 – 400 Hz (0 = off) | 0 | `120 Hz` / `Off` | Planned-P3 |
| Mono | Toggle | — | off | — | Planned-P3 |
| Module enable | Toggle | — | off | — | Live |

Design note: a correlation/width meter (goniometer) pairs naturally; the page already computes L/R correlation.

### 5. Pitch  ·  special (NOT in the insert chain, NOT reorderable)
Purpose: pitch shift. Has its own expanded panel today (large knob + interval buttons + cents slider).

| Param | Type | Range | Default | Format | Availability |
|---|---|---|---|---|---|
| Semitones | Knob / buttons | −12 – +12 | 0 | `+5 st` (`Perfect 4th`) | Live |
| Cents | Slider | −50 – +50 | 0 | `-20 ¢` | Live |
| Tempo | Knob | 0.5 – 2.0× | 1.0 | `1.25×` | Planned-P3 |
| Module enable | Toggle | — | off | — | Live |

Caveat the UI must convey: pitch and tempo are **coupled** (Web Audio detune scales playback rate). Moving semitones changes tempo; moving tempo changes pitch. Independent/formant-preserving pitch is a future worklet (not planned in these phases). The existing panel already states this — keep that messaging.

### 6. DJ Filter  ·  has Mix: no  ·  Availability: Planned-P4
Purpose: single-knob sweepable filter (DJ-style).

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Morph | Bipolar knob (center=bypass) | −1 (LP sweep) – +1 (HP sweep) | 0 | `LP 40 %` / `Off` / `HP 60 %` |
| Resonance | Knob | 0.1 – 20 | 0.7 | `0.7` |
| Module enable | Toggle | — | off | — |

### 7. Delay / Echo  ·  has Mix: yes  ·  Availability: Planned-P4
Purpose: echo with BPM sync + feedback filtering + ping-pong.

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Sync (to BPM) | Toggle | — | on | — |
| Division | Select | 1/4, 1/8, 1/8., 1/8T, 1/16 | 1/8 | `1/8` |
| Time (when unsynced) | Knob | 1 – 2000 ms | 250 | `250 ms` |
| Feedback | Knob | 0 – 95 % | 35 % | `35 %` |
| Tone (loop low-pass) | Knob | 200 – 18000 Hz | 8000 | `8.0 kHz` |
| Ping-pong | Toggle | — | off | — |
| Mix | Slider | 0 – 100 % | 0 | `30 %` |
| Module enable | Toggle | — | off | — |

Note: track BPM is known (from analysis), so synced divisions are real musical values.

### 8. Reverb  ·  has Mix: yes  ·  Availability: Planned-P4
Purpose: convolution reverb (synthesized impulse responses — no audio assets).

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Space / IR | Select | room / hall / plate / spring / ambience | hall | — |
| Decay | Knob | 0.2 – 8 s | 2.0 | `2.0 s` |
| Pre-delay | Knob | 0 – 200 ms | 20 | `20 ms` |
| Damping | Knob | 1000 – 18000 Hz | 8000 | `8.0 kHz` |
| Mix | Slider | 0 – 100 % | 0 | `25 %` |
| Module enable | Toggle | — | off | — |

### 9. Stereo Pan  ·  has Mix: no  ·  Availability: Planned-P4
| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Pan | Bipolar knob (center=0) | −1 (L) – +1 (R) | 0 | `L 20` / `C` / `R 35` |
| Module enable | Toggle | — | off | — |

### 10. Tremolo / Auto-pan  ·  has Mix: no  ·  Availability: Planned-P4
Purpose: LFO amplitude (tremolo) or pan (auto-pan) modulation.

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Mode | Segmented | tremolo / auto-pan | tremolo | — |
| Sync (to BPM) | Toggle | — | on | — |
| Division | Select | 1/4 … 1/16 | 1/8 | `1/8` |
| Rate (when unsynced) | Knob | 0.1 – 20 Hz | 5 | `5.0 Hz` |
| Depth | Knob | 0 – 100 % | 50 % | `50 %` |
| Shape | Select | sine / triangle / square | sine | — |
| Module enable | Toggle | — | off | — |

### 11. Gate  ·  has Mix: no  ·  Availability: Planned-P5 (worklet)
Purpose: noise gate / downward expansion.

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Threshold | Knob | −80 – 0 dB | −40 | `-40 dB` |
| Attack | Knob | 0 – 50 ms | 1 | `1 ms` |
| Hold | Knob | 0 – 500 ms | 10 | `10 ms` |
| Release | Knob | 0 – 1000 ms | 100 | `100 ms` |
| Floor (closed attenuation) | Knob | −80 – 0 dB | −80 | `-80 dB` |
| Module enable | Toggle | — | off | — |
| **Open/closed + GR meter** | Meter | live | — | `Open` / `-30 dB` |

Has a loading state (worklet init).

### 12. Bitcrusher  ·  has Mix: yes  ·  Availability: Planned-P5 (worklet)
| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Bit depth | Knob/stepped | 1 – 16 bits | 16 | `8 bits` |
| Downsample | Knob | 1 – 50× | 1 | `8×` |
| Mix | Slider | 0 – 100 % | 0 | `40 %` |
| Module enable | Toggle | — | off | — |

Has a loading state (worklet init).

### 13. Limiter  ·  has Mix: no  ·  Availability: Planned-P5 (worklet)
Purpose: true brickwall lookahead limiter (replaces today's stubbed "Limiter — Soon" card).

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Ceiling | Knob | −12 – 0 dBTP | −1.0 | `-1.0 dBTP` |
| Release | Knob | 1 – 500 ms | 50 | `50 ms` |
| Lookahead | Knob | 0 – 10 ms | 5 | `5 ms` |
| Module enable | Toggle | — | off | — |
| **Gain-reduction meter** | Meter | live dB | — | `-2.1 dB GR` |

Has a loading state (worklet init).

### 14. Output Trim  ·  Availability: Planned-P4
Purpose: chain-level make-up/trim (separate from the page's player volume).

| Param | Type | Range | Default | Format |
|---|---|---|---|---|
| Gain | Knob | −24 – +12 dB | 0 | `+2.0 dB` |
| (always on; defaults to last in chain, reorderable) | — | — | — | — |

---

## Rack-level controls (header / chrome)

| Control | Behavior | Availability |
|---|---|---|
| Master bypass | A/B entire processed chain vs dry. | Live |
| Reset | All modules → defaults. | Live |
| Active count | "N on · bypass off". | Live |
| Signal order readout | Shows current chain order. | Live (static) / reflects reorder Planned-P2 |
| Reorder handles | Drag modules to reorder the chain. | Planned-P2 |
| Presets (optional, not yet planned) | Save/recall rack states. Flag as a possible future need so the layout can host it. | Future |

## Metering outputs the UI can display

These live values are produced by the engine for display (read-only):

- **Compressor gain reduction** (dB) — data available now; display Planned-P6.
- **Gate** open/closed + reduction (dB) — Planned-P5/P6.
- **Limiter gain reduction** (dB) — Planned-P5/P6.
- Existing page meters (already live, for context): spectrum, L/R correlation (goniometer), short-term LUFS, true-peak, RMS — these live in the visualizer/right-rail, not the rack, but width/comp/limiter cards may want to echo correlation/peak.

---

## Counts for layout planning

- **~14 effect modules** in the insert rack (5 expanded existing + 8 new + Output Trim), plus the non-effect rack tools that exist today (Loop section A/B, Scope/goniometer) which the current rack also hosts.
- Param counts per expanded module range from **1** (Pan) to **~5 per band ×8 = up to 40 conceptual** (EQ — best served by an interactive curve, not 40 knobs).
- Every module needs: a **compact card** (summary + 1-3 key knobs + on/off) and an **expanded view** (all params). Plan for both states.
- The rack must host **drag-reorder** and **per-module metering** without the layout breaking.

## Hard caveats to surface in the UI

1. **Pitch couples tempo** (and vice-versa) — label it; true independent pitch/tempo is not in scope.
2. **Reorder is live** but masks a tiny audio dip; modules are all series inserts (Reverb/Delay are insert-style with their own Mix, not aux sends).
3. **Gate / Bitcrusher / Limiter** have a short post-load init state before they're usable.
4. Today's **"Limiter — Soon"** stub becomes a real module (P5); design it as active, not disabled.
