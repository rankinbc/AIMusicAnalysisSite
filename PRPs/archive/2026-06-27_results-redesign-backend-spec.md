# Results page redesign — Backend data-gap spec

**Status:** spec (2026-06-26)
**Why:** The delivered results-page prototype (`PRPs/design_handoffs/design_handoff_results_redesign/`) shows five data items the **analysis pipeline does not produce today**. The frontend ships now against real data and degrades these regions (see `PRPs/results-redesign-integration-plan.md` §7); this spec defines the backend work to fill them so each region reaches full prototype fidelity.
**Scope:** Python pipeline (`components/analysis/src/audio_analysis/phases/`), worker emit, BFF DTOs/endpoints (`components/bff`), and the shared TS types (`frontend-spectr-v2/src/api/types.ts`). **No new user-facing endpoints are required for gaps 1–5** except where noted — these are *enrichments to existing phase `data` payloads* that already flow through `GET /jobs/{id}/results` → `finalJson.phases[]`.
**Inventory basis:** confirmed against `phase1_universal.py`, `phase4_stems.py`, `phase5_reference.py`, `phase6_gap.py`, `phase8_als.py`, `phase9_translation.py`, and `api/types.ts` (Phase1–9 DTOs) on 2026-06-26.

---

## Gap 1 — Per-band genre median (7 bands)

**UI needs it for:** Track Info → *Tonal balance* (each of the 7 bars shows the genre **median** + over/under tint); Reference → *Tonal fingerprint* hero (the `mean ± 2σ` shaded band).
**Produced today:** **No.** `phase1.bands` carries the 7 raw dB values (`sub_bass…air`). `phase6.gaps` only covers **3 scalar features** (`bpm`, `stereo_correlation`, `stereo_width`) — no per-band stats. Genre profiles are not consulted for tonal bands on the profile path.
**What to add:** per-band genre statistics — `{ mean, std }` (or `median` + acceptable range) for all 7 bands, from the genre profile used in phase 3/6.
**Where:** extend `phase6_gap.py` to emit band gaps alongside the scalar gaps, **or** add a `band_medians` block to phase 3 (genre scoring already loads the genre profile). Prefer **phase 6** so it shares the existing `Phase6Gap` shape:
```py
# phase6.gaps now also keyed by band:
gaps["low_mid"] = Phase6Gap(user_val=-8.9, genre_mean=-12.4, genre_std=1.6,
                            acceptable_range=(-14.0,-10.8), delta=3.5, percentile=88, in_range=False, ...)
```
**Contract changes:** none structurally — `Phase6Data.gaps` is already `Record<feature, Phase6Gap>`; bands become additional keys. FE reads `phase6.gaps[bandKey]` for the median/range. Requires a **genre-profile corpus with per-band stats** (provenance: `verdict_lib/config/genre-ref-values.md`); flag `suspected=true` where the corpus is still a placeholder.
**Acceptance:** for a trance track, `phase6.gaps` contains entries for all 7 band keys with `genre_mean`/`genre_std`/`acceptable_range`; FE renders median ticks + tints with no raw-hex.

---

## Gap 2 — Phase-6 scalar gaps for LUFS / true-peak / dynamic range

**UI needs it for:** Reference → *gap rows* (the prototype shows 6 metric rows: LUFS, True Peak, Dynamic Range, Stereo Width, Stereo Correlation, BPM).
**Produced today:** **Partial.** `phase6.gaps` produces **only** `bpm`, `stereo_correlation`, `stereo_width`. Missing: `lufs`, `true_peak`, `dynamic_range`.
**What to add:** extend the genre statistical profile + `phase6_gap.py` to compute gaps for `lufs`, `true_peak_db`, and `dynamic_range` (the inputs already exist on `phase1`: `lufs`, `true_peak_db`, and DR derivable from `loudness_range_lu`/`crest_factor`).
**Where:** `phase6_gap.py` — add the three features to the compared-feature set; source values from `phase1`.
**Contract changes:** none — additional keys in `Phase6Data.gaps`. FE already renders any `Phase6Gap`.
**Acceptance:** `phase6.gaps` includes `lufs`, `true_peak`, `dynamic_range` with `genre_mean/std`, `acceptable_range`, `percentile`, `in_range`; Reference gap rows render all 6 metrics.

---

## Gap 3 — Phase-5 per-metric reference-track A/B values (the `◇` overlay)

**UI needs it for:** Reference → the `◇ ref track` marker on each gap row **and** the `◇` points on the tonal-fingerprint curve (the single uploaded reference track folded into the profile comparison).
**Produced today:** **No.** `phase5_reference.py` emits `Phase5Data = { genre, preset_name, checks: Record<name, {status,message,value?}> }` — pass/fail checks, **not** a per-metric `user_val` vs `ref_val` comparison, and **no per-band ref levels**.
**What to add:** a structured per-metric delta block on phase 5 when a single reference **track** is attached:
```ts
// new on Phase5Data
referenceTrack?: {
  title: string; artist: string | null;
  metrics: Record<'lufs'|'true_peak'|'dynamic_range'|'stereo_width'|'stereo_corr'|'bpm',
                  { user_val: number; ref_val: number; delta: number }>;
  bands: Record<BandKey, { user_val: number; ref_val: number }>;  // 7 bands for the ◇ curve points
}
```
**Where:** `phase5_reference.py` — it already has the reference track's analysis (the curated/uploaded reference is analyzed via `run_reference_analyzer`); surface its scalars + band levels next to the user's. The `ReferenceDto` (BFF) already stores `lufs/truePeakDb/dynamicRangeLu/stereoWidth/stereoCorrelation/bpm/bandLevels` for saved references — phase 5 can read from the same source.
**Contract changes:** add `Phase5Data.referenceTrack` to `api/types.ts`. **Decision (from `reference-tab-design.md` §8):** the `◇` overlay reads **phase-5 `referenceTrack`** (this new block), not a re-derivation from `ReferenceDto`, so the comparison is computed once server-side.
**Acceptance:** with a reference track attached, `phase5.referenceTrack.metrics` + `.bands` are present; Reference tab renders `◇` on rows + curve. Profile-only (no track) leaves it absent → FE shows the profile-only state.

---

## Gap 4 — Phase-9 phone / laptop / club translation ratings

**UI needs it for:** Track Info → *Mix translation* (the prototype shows Phone / Laptop / Club ratings + a note).
**Produced today:** **No.** `phase9_translation.py` emits `playback.{headphone_score, speaker_score, bass_translation, crossfeed_safe}` + `spatial`/`surround` blocks — **device-class** scores, not the phone/laptop/club system ratings the prototype shows.
**What to add (pick one):**
- **(a) Minimal / no backend** — FE maps existing phase-9 scores to a 2-system read (Headphone, Speaker) and keeps the note; *drop* the 3-system phone/laptop/club framing. Lowest cost, slight deviation from prototype copy.
- **(b) Full fidelity** — add a `systems: { phone, laptop, club }` block to phase 9 deriving each rating (`good`/`great`/`weak`) from the existing translation features (bass translation, mono compatibility, loudness, top-end rolloff) + a `notes[]` line. Matches the prototype exactly.
**Recommendation:** **(b)** — it's a deterministic mapping over metrics phase 9 already computes; small, self-contained.
**Where:** `phase9_translation.py`. **Contract:** add `Phase9Data.systems` + `Phase9Data.notes` to `api/types.ts`.
**Acceptance:** `phase9.systems` has phone/laptop/club ratings + a note; Track Info renders the 3-system row. (If (a) is chosen instead, FE degrades per integration plan §7 — no backend change.)

---

## Gap 5 — Per-track ordered device chains + disabled flags (.als)

**UI needs it for:** Project → *Tracks* card (each track's device chain **in signal order**, disabled devices **struck-through**, audio/midi tag, device count).
**Produced today:** **No (chain order/flags).** Two sources, both insufficient:
- `Phase8Data.tracks[]` = `{ name, type, device_count, disabled_count, muted }` — counts only.
- `alsProject.tracks[]` (client-parsed `.als`) = `{ index, name, type, color, devices: string[] }` — device **names** but **unordered semantics + no enabled/disabled flag**.
**What to add:** an ordered, flagged device chain per track:
```ts
// alsProject.tracks[] (preferred — it's already the .als-derived map) OR Phase8Data.tracks[]
devices: { name: string; on: boolean }[]   // signal order; on=false → struck-through
```
**Where:** the `.als` parser that produces `AlsProjectJson` (BFF-side `.als` ingest) already walks each track's device list — preserve **order** and read each device's **enabled** attribute into `{ name, on }`. This is the single best place; `Phase8Data` can stay counts-only.
**Contract changes:** widen `AlsProjectTrack.devices` from `string[]` to `{ name: string; on: boolean }[]` in `api/types.ts` (and the BFF `AlsProjectJson` serializer). **Back-comaptibility:** keep accepting the old `string[]` shape in the FE (coerce `string → {name, on:true}`) so already-stored project maps still render.
**Acceptance:** `alsProject.tracks[].devices` carries ordered `{name,on}`; Project tab renders signal-order chains with struck-through disabled devices; old `string[]` maps still render (all `on:true`, no order guarantee).

---

## What is already fine (no backend work)

- **Coach Mix / Generate Coach Mix** — the prototype's `compileCoachMix` (solve selected fixes into ONE rack) **already exists server-side**: `POST /api/reports/{jobId}/fix-rack` → `generate_fix_rack` worker actor → `GET …/fix-rack` → `FixRackDto.chain` (byte-identical to the Listen rack). FE reuses `useGenerateFixRack`/`useFixRack`. **No change.**
- **Specialist Team** — `useVerdicts(jobId).specialists` + `routing_plan` + `useRunSpecialist` + `SPECIALIST_CATALOG` already provide run-state, gating, and the run action. **No change.**
- **Coach chat + caps** — `useCoachView` + the coach conversation endpoints + `CoachCapsDto` exist. **No change** (FE may add thin hooks, but the backend is done).
- **Arrangement markers** (Project tab) — `Phase8Data.arrangement.sections[]` (name/start_beat/end_beat/duration_bars) is **produced today**. **No change.**
- **Findings / verdicts, waveform/spectrogram images, streaming readiness, loudness/dynamics, stereo, frequency clashes** — all produced today (phase 1/4 + verdicts + image URLs). **No change.**

---

## Suggested sequencing & effort

| Gap | Region unblocked | Effort | Notes |
|---|---|---|---|
| 2 — phase-6 scalar gaps | Reference gap rows (3 more metrics) | **S** | inputs already on phase 1; extend feature set |
| 1 — per-band genre median | Track Info tonal + Reference band | **M** | needs per-band genre corpus (`suspected` flag where placeholder) |
| 5 — .als device chains | Project Tracks card | **M** | parser change + `AlsProjectTrack.devices` shape widen (back-compat) |
| 4 — phase-9 systems | Track Info translation | **S–M** | (b) full or (a) FE-only degrade |
| 3 — phase-5 ref-track A/B | Reference `◇` overlay + curve | **M–L** | richest; reads the analyzed reference track's metrics + bands |

Each gap is independent and ships behind the FE's graceful-degradation, so they can land in any order without blocking the results-page port. Gaps 1 + 2 share the phase-6/genre-profile change and are best done together.

## Validation
- Python: `pytest -q components/analysis/tests/` + `pytest -q components/worker/tests/`; `ruff check` + `mypy` per CLAUDE.md gates. Golden-snapshot the enriched `finalJson` so existing phase output stays byte-identical except the added keys.
- Types: regenerate / hand-edit `frontend-spectr-v2/src/api/types.ts`; `npx tsc --noEmit` green.
- Each gap: one expected-use + one absent-input (degrade) + one failure-case test.
