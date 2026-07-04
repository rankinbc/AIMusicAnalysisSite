# Story 10.7: Measurement Conformance Harness

Status: done

## Story

As the operator,
I want LUFS/true-peak proven against reference signals,
So that no published number can be wrong (measurement credibility is the product's authority).

## Acceptance Criteria

1. **Given** ITU-R BS.1770-4 test vectors, **When** the harness measures LUFS, **Then** results land within the documented ±0.1 LU tolerance.
2. **Given** true peak, **When** 4× oversampled dBTP measures the reference signals, **Then** conformance is documented before any number is marketed as authoritative (PRD domain requirement).
3. **Given** CI, **When** the harness is wired in, **Then** measurement regressions fail the build.

## Decisions of record (recon 2026-07-03)

1. **Test the PRODUCTION code path, not pyloudnorm**: the inline LUFS/dBTP blocks in `phase1_universal.analyze()` extract into module functions `integrated_lufs(y, sr)` / `true_peak_dbtp(y, sr)` that `analyze()` calls — the harness measures exactly what ships.
2. **The extraction exposes a REAL conformance bug and this story fixes it**: dBTP was measured on the L/R MONO DOWNMIX — BS.1770-4 defines true peak as the max across channels of the oversampled signal. Downmixing under-reads any stereo content (out-of-phase material can null entirely). `true_peak_dbtp` oversamples EACH channel and takes the max. (Golden snapshots use dual-mono synthetic signals — value-identical; any diff is a legitimate measurement fix, documented.)
3. **Vectors are SYNTHESIZED in-code** (EBU Tech 3341's tone cases are analytically defined; no downloads, no binary fixtures in git): Case 1 (1 kHz stereo −23 dBFS → −23.0 LUFS), Case 2 (−33 dBFS → −33.0), Case 3-style gating (−36/−23/−36 segments → −23.0 — proves the relative gate), silence (→ −70 floor sentinel). True peak: fs/4 sine at −6 dBFS with 45° sampling phase (sample peak reads −9.0; a conformant 4× meter reads −6.0 within the EBU window), 0 dBTP full-scale case, and a documented near-Nyquist caveat case (4× oversampling under-reads the worst near-Nyquist inter-sample peaks — DOCUMENTED as a limit, not asserted).
4. **Tolerances = the published compliance windows**: LUFS ±0.1 LU (AC1's own number); dBTP −0.4/+0.2 dB (EBU Tech 3341 true-peak acceptance).
5. **AC3 is free**: the file lives in `components/analysis/tests/conformance/` — CI's analysis step collects it; red = build fails = deploy blocked (needs-chain verified in 10.1).
6. **Conformance statement lives in `components/analysis/README.md`** (the component's measurement doc) + a runbook pointer; states what IS conformant (integrated LUFS tone+gating cases, dBTP tone cases), the 4×@44.1 kHz near-Nyquist limit, and that momentary/short-term/LRA are structurally tested but not conformance-asserted (follow-up if marketing ever quotes LRA).
7. **Out of scope**: EBU downloadable WAV set (analytic equivalents suffice for the tone cases), 5.1 channel weights (stereo product), pyloudnorm-internal gating edge cases, LRA conformance (Tech 3342 needs programme material).

## Tasks / Subtasks

- [x] Task 1 — `integrated_lufs` (finite-guard: silence → −70.0 sentinel, −inf never escapes) + `true_peak_dbtp` (per-CHANNEL 4× oversample max — the downmix conformance fix); analyze() delegates; golden snapshots UNAFFECTED (dual-mono synthetic signals — verified, 167/167)
- [x] Task 2 — 8 vectors: Tech 3341 cases 1/2 (±0.1 LU ✓), case-3-style gating (±0.1 LU ✓), silence sentinel, fs/4 45°-phase inter-sample peak (sample peak −9.03; meter recovers −6.0 within −0.4/+0.2 ✓), full-scale 997 Hz (✓), out-of-phase stereo (the pre-10.7 bug: downmix nulls — per-channel meter reads −6.0 ✓), near-Nyquist pinned
- [x] Task 3 — README § Measurement conformance (asserted set + documented limits) + runbook pointer ("never market a number without vectors")
- [x] Task 4 — analysis 167/167 (8 new), worker 583 sanity, ruff clean on touched paths (pre-existing test-dir lint is outside CI's src-only gate)

## Dev Notes

- −23 dBFS sine amplitude = 10^(−23/20) ≈ 0.070795; 1 kHz K-weighting ≈ 0 dB by design (tech3341 defines the tone cases to land exactly on the dBFS number).
- fs/4 (11 025 Hz) sine with φ=π/4: samples hit A·cos(π/4) — sample peak −3.01 dB below true; 4× polyphase reconstruction recovers ≈A.
- resample_poly default Kaiser window is adequate for fs/4; near Nyquist (e.g. 0.45·fs) it isn't — that's the documented limit.
- Silence vector: pyloudnorm returns −inf for digital silence; production wraps with the −70.0 fallback — assert the SENTINEL (the shipped behavior), not −inf.
- Keep vectors ≥ 5 s (gating needs blocks); Case 3 = 10 s/20 s/10 s segments (shorter than EBU's 60 s middle — the gate math is identical, CI stays fast).

### References

- [Source: PRPs/epics.md L1250-1260; prd domain requirement (measurement credibility)]
- [Source: recon — phase1_universal.py L295-300 (LUFS call + axis transpose), L337-346 (scipy resample_poly 4× on MONO downmix), tests/conftest autouse docker mock, ci.yml python job L129-130, no vectors in repo]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- Near-Nyquist behavior measured (not assumed): 0.45·fs @ −6 dBFS reads −4.5 dBTP — the resampler's transition ripple OVER-reads (+1.5 dB), not under-reads as the story draft guessed. Conservative direction for streaming warnings; documented + loosely pinned.

### Completion Notes List

- AC1: ±0.1 LU proven on the production path (tone + gating cases).
- AC2: dBTP proven within the EBU window on the production path — including the per-channel FIX (the mono-downmix meter under-read stereo; out-of-phase content nulled entirely). Documented limits in the README.
- AC3: file under components/analysis/tests/ = auto-collected by CI's analysis step; red blocks the deploy job (10.1 needs-chain).
- The measurement-credibility claim now has teeth: the meters that ship are the meters that are proven.

### File List

- `components/analysis/src/audio_analysis/phases/phase1_universal.py` (integrated_lufs + true_peak_dbtp extraction, per-channel dBTP fix)
- `components/analysis/tests/conformance/{__init__.py,test_bs1770_conformance.py}` (new, 8)
- `components/analysis/README.md` (§ Measurement conformance), `docs/runbook.md` (pointer)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (combined adversarial DSP pass; every number re-measured empirically in the lock venv — margins, gate arithmetic, fallback values, old-vs-new dual-mono bit-identity). Outcome: **Approve with required changes → applied** (patches):

- [x] [High] **Case-3 gating margin was 0.003 LU — 3% of tolerance on a DEPLOY-BLOCKING test** (boundary-block dilution scales with middle-segment length) → 10/40/10 segments (~10× margin, CI ~3 s)
- [x] [High] **The near-Nyquist test's "dropping the oversampler still fails here" claim was FALSE** (the sample-peak fallback reads −6.05 for that vector — inside the old window) → lower bound tightened to −5.5; the fallback now genuinely falls out
- [x] [High] **The silence sentinel was a SECOND undisclosed behavior fix**: pyloudnorm returns −inf WITHOUT raising — the old except-only wrapper let `-Infinity` (invalid JSON) head into final_json/jsonb → reframed honestly in the test comment + README; and the SAME live bug in `stems/analyzer.py` (silent stem → −inf → jsonb) fixed in-story with the identical finite-guard
- [x] [Med] Blast radius documented (README): pre-10.7 analyses carry downmix-measured true peaks — cross-boundary version comparisons show phantom regressions; wide mixes may now legitimately trip −1.0 dBTP rules (consumers: rule engine true_peak_overshoot/loudness_war, StreamingReadiness, CompareDialog)
- [x] [Med] `true_peak_dbtp` docstring had the WRONG SIGN (kept the draft's "under-reads" guess; measured behavior is OVER-read +1.5 dB at 0.45·fs) → corrected; −70 floor semantics documented (any content below the absolute gate, not just silence — a −80 dBFS tone reads −70.0)
- [x] [Low] Silent sample-peak fallback now logs a warning (a runtime-only scipy failure was an invisible up-to-3 dB under-read); story's −9.03 nit → measured −9.01
- Noted for follow-up: `reference_analyzer_actor` falsy `true_peak_db or peak_dbfs` treats exact-0.0 dBTP as missing (adjacent nit, separate lane).
- Verified by the reviewer: 167/167 + 8/8 re-run; dual-mono old==new to 9 decimals; hard-panned −6 dBFS old −12.0 → new −6.0; gate arithmetic (−36 flank clears the relative gate by 0.24 LU at 50/50 — hence the F1 fix); fs/4 margin +0.115 of +0.2; 997 Hz reads +0.0055 dBTP (positive dBTP now legitimately possible).

### Change Log

- 2026-07-03: implemented on `ops/10-7-conformance`. Gates: analysis 167/167, worker 583+3xf, ruff clean. Status → review.
- 2026-07-03 (review): patches applied (gating margin, honest guards, stems −inf fix, blast-radius docs). Analysis 167/167 re-verified.
