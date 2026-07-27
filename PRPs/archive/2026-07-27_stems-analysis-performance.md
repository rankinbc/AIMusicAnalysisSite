# PRP — Stems Analysis Performance (Phase 4 hot path)

> Motivation (measured 2026-07-27): a no-stems track analyzes in ~63 s end-to-end; the same pipeline with uploaded stems takes 6–11 min. USE_DEMUCS is False — this is all the "fast" spectral path. Live job durations: 321/387/547/648/671 s with stems vs 63 s without. All facts below were verified against source with file:line refs this session.

## Goal

Cut the per-stem analysis cost in `audio_analysis.stems.analyzer` by collapsing redundant full-track FFT work into one shared spectrum per signal, fixing dtype/algorithmic pathologies, and adding the observability (persisted per-phase durations + stems-loop progress) needed to prove it. Target: **phase 4 with stems on a real 5-min multi-stem track ≤ ~90 s** (from 5–10 min), with output values semantically unchanged (goldens regenerated deliberately, deltas reviewed).

## Why

- Every stems-bearing upload pays 6–11 min on a single-threaded worker (concurrency=1 by design), so batches back up for hours. This is the #1 wall-clock lever for the whole product — cheaper than, and prerequisite to, any multi-worker topology work.
- The UI sits frozen between 80–100% for the entire stems pass (no progress callback in the loop), which reads as "stuck" and has triggered manual worker restarts (one killed a 17-job batch on 2026-07-27).
- `analyses.phase_durations` exists as a column but is always written `{}` — we can't even see where time goes in prod.

## What

No behavior change visible to users except speed and smoother progress. Internals:

1. One rfft per analyzed signal (role bus or stem), everything derived from it.
2. float32 decode, float32 window, FFT length padded to a fast size.
3. `argpartition` instead of full `argsort` for dominant frequencies.
4. Parallel per-stem fetch in the worker's S3 path.
5. Persist real `phase_durations`; emit progress during the stems loop.
6. Regenerate golden snapshots deliberately; add a realistic-length perf guard.

### Success criteria

- [ ] Phase 4 with stems on the live smoke track drops ≥ 4× (log line `phase 4 (Stem Separation & Clash) done in …`).
- [ ] All stem metrics within tight tolerance of old values (band energies ±0.1 dB; dominant freqs same bins; LUFS/RMS/peak unchanged — loudness path untouched).
- [ ] `analyses.phase_durations` populated for new jobs (all phases, seconds).
- [ ] Progress advances during the stems loop (no 0.8→1.0 dead zone).
- [ ] Goldens regenerated in a dedicated commit with the numeric diff summarized in its message.
- [ ] New opt-in perf test with realistic-length stems; existing suites green.

## All Needed Context

### Files

```yaml
- file: components/analysis/src/audio_analysis/stems/analyzer.py      # THE hot file — all L-refs below
- file: components/analysis/src/audio_analysis/phases/phase4_stems.py # analyze() L41-54; _analyze_user_stems L73-115; progress emits L124-175 (spectral only)
- file: components/analysis/src/audio_analysis/phases/phase5_reference.py # _attach_stem_reference_deltas L194-248 — currently a no-op in prod (see gotcha G6)
- file: components/analysis/src/audio_analysis/pipeline.py            # per-phase timing t0 L72, logged L115-116 but never persisted; stem_mode defaults L54/200/273
- file: components/worker/app/tasks_dramatiq.py                       # per-stem resolve_local loop L285-296; phase_durations={} L397; progress cb L244-254
- file: components/worker/app/object_store.py                         # resolve_local L57-61; S3 branch L99-101 (serial download_file, one mkdtemp each)
- file: components/analysis/src/audio_analysis/stems/classify.py      # L56 sf.read(dtype="float32") — the pattern _load should have used
- file: components/analysis/tests/phases/test_phase4_with_stems.py
- file: components/analysis/tests/phases/test_phase5_with_stems.py
- file: components/analysis/tests/stems/test_analyzer.py              # + conftest.py: synthetic stems are 4 s — never see this cost
- file: components/analysis/tests/integration/test_phase_snapshots.py # golden pinning
- file: components/analysis/tests/integration/golden/phase4_with_stems.json
- file: components/analysis/tests/integration/test_performance.py     # STEM_PIPELINE_BUDGET_S=90.0, @pytest.mark.perf, 4×4s corpus — toothless today
```

### The verified hot spots (grouped mode; N stems, R roles ≤ 10; 5-min track ≈ 13.2 M samples/ch)

| # | What | Where | Cost |
|---|---|---|---|
| 1 | `_dominant_freqs`: full-length rfft + **full `np.argsort` of ~6.6 M floats to pick 3** | analyzer.py:86-90 | very high; argsort ≈ the FFT itself |
| 2 | **Three identical full-track rffts per role** — `_band_energy_db` (L41), `_band_energy_ratios` (L52, called again from analyze_grouped L257), `_dominant_freqs` (L87) all window+rfft the same mono signal | analyzer.py:41,52,87 ← :122,:124,:257 | high; 3× a 1–3 s FFT per role |
| 3 | `sf.read` without `dtype=` → **float64 decode (~211 MB/5-min stereo) + copy to float32**, per stem | analyzer.py:33-34 | high at N up to 100 |
| 4 | `np.hanning(len(mono))` is float64 → upcasts the whole signal, fresh ~106 MB alloc, 3× per role | analyzer.py:41,52,87 | medium (bandwidth) |
| 5 | Arbitrary-length rfft: non-smooth sample counts hit Bluestein — **10–50× spikes** | same lines | explains 6-vs-11-min spread on similar tracks |
| 6 | `librosa.feature.spectral_centroid` runs its own full STFT per role | analyzer.py:123 | medium; derivable from shared spectrum |
| 7 | Worker S3 path: up to 100 **serial** `download_file` calls, one mkdtemp each | tasks_dramatiq.py:285-296, object_store.py:57-61,99-101 | dominant when S3 configured; 0 on local disk |
| 8 | `per_stem` mode runs the FFT triple **per file** instead of per role (~N/R ≈ 10× multiplier); MAX_CLASH_PAIRS=600 caps only the cheap pair loop, not measurement | analyzer.py:269-317, :266 | multiplies everything above |
| 9 | `_sum_group` keeps all N padded stereo arrays alive before summing | analyzer.py:210-224 | memory pressure at high N |

**Explicitly NOT hot / NOT in scope:** grouped clash math (`_build_clash_from_ratios` L227-239 — dict arithmetic, ≤45 pairs); WAV conversion (stems are never converted — `to_wav` touches only main+reference tracks); pyloudnorm per role (seconds, correctness-sensitive — leave untouched, see G4); phase 5 (no-op in prod, see G6).

### Gotchas

```text
G1. Golden snapshots pin EXACT numeric output (test_phase_snapshots.py). float32 decode, float32
    window, and fast-length zero-padding all perturb values in the last decimal places. Plan for a
    deliberate golden regeneration with a reviewed diff — do NOT loosen the snapshot comparison to
    blanket tolerances to sneak changes through.
G2. numpy<2.0 hard pin (CLAUDE.md). scipy IS available (scipy.fft.next_fast_len, scipy.signal).
    Verify the installed scipy exposes next_fast_len before using; fallback: pad to next power of two.
G3. Zero-padding an rfft changes bin width → band-edge sums and dominant-frequency bin centers shift
    slightly. Compute band masks from the padded bin frequencies (np.fft.rfftfreq(n_fast, 1/sr)) —
    never reuse hardcoded bin indices. Dominant freqs must be reported from the padded freq axis.
G4. Do NOT touch the loudness path: pyloudnorm axis-order/float64 subtleties (CLAUDE.md gotcha) and
    LUFS values feed rules + reference deltas. integrated_loudness(mono) stays byte-identical.
G5. rerun_phase actor has time_limit=600_000 (10 min) — today an 11-min stems track CANNOT be
    phase-4-rerun (killed). The optimization fixes this implicitly; note it in the commit.
G6. Phase 5's stem path (analyze_grouped call at phase5_reference.py:231) is UNREACHABLE in prod
    (reference stems / cache dir never passed by tasks_dramatiq). Do not "optimize" it, but ALSO do
    not wire it up here — if it ever gets wired, it must reuse phase-4 results, not re-analyze
    (leave a comment at the call site).
G7. Worker .env pins OMP/MKL/NUMBA threads to 1 (OpenMP crash guard #8 in STARTUP.md). Do not add
    thread-based FFT parallelism inside the analysis package; the wins here are algorithmic.
    The S3 fetch ThreadPool (Task 4) is IO-bound network work in the WORKER, not numeric code — safe.
G8. The stems test fixtures are 4-second files (~75× shorter than prod) — every existing test passes
    regardless of these pathologies. That's WHY this shipped slow. The new perf test must use
    realistic lengths (≥120 s) to have teeth, and stay @pytest.mark.perf (opt-in) so CI stays fast.
G9. analyze() L176-190 + _build_clash_matrix L135-154 (re-loads every stem) serve the offline
    pre_demucs CLI only — out of scope; do not refactor them beyond what the shared helpers force.
```

## Implementation Blueprint

### Task 1 — Observability first (measure before optimizing)

1. `pipeline.py`: it already computes per-phase seconds (t0 at L72, logged L115-116). Collect them into a `phase_durations: dict[str|int, float]` on the result root (include failed phases with their elapsed time; key by phase number).
2. `tasks_dramatiq.py:397`: replace `phase_durations={}` with the dict from the pipeline result (guard `.get(..., {})` for older result shapes; `rerun_phase` merges its single phase's duration into the existing dict).
3. `phase4_stems.py:_analyze_user_stems`: thread the existing `progress_cb` down (analyze() already receives it for the spectral part) and emit per-role/per-stem ticks across the 0.8→1.0 window so the UI moves during the stems loop.
4. Baseline capture: run the pipeline once on a real stems-bearing upload from `data/uploads/` (pick via `song_versions.stem_paths`), log `phase 4 … done in`, and record the number in the final PR/commit message. A throwaway cProfile run (`python -m cProfile -s cumtime -m <driver>`) to confirm the hot-spot table is honest; driver script goes in the scratchpad, NOT the repo.

### Task 2 — The core: one spectrum per signal (`stems/analyzer.py`)

1. `_load` L32-37: `sf.read(file_path, always_2d=True, dtype="float32")` (mirror classify.py:56); drop the astype copy. Resample branch unchanged.
2. New private helper — the single source of spectral truth:
   ```python
   def _shared_spectrum(mono: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
       """One windowed rfft, fast length, float32 window. Returns (freqs, magnitude)."""
       n = len(mono)
       n_fast = scipy.fft.next_fast_len(n)          # G2 fallback: 1 << (n-1).bit_length()
       win = np.hanning(n).astype(np.float32)        # G4 of hot-spot table: no float64 upcast
       spec = np.abs(np.fft.rfft(mono * win, n=n_fast))
       return np.fft.rfftfreq(n_fast, 1.0 / sr), spec   # G3: freqs from PADDED length
   ```
3. Refactor to consume it: `_band_energy_db` and `_band_energy_ratios` become band-mask reductions over `(freqs, spec)`; `_dominant_freqs` becomes `np.argpartition(spec, -3)[-3:]` (then sort those 3, map through `freqs`); spectral centroid = `(freqs @ spec) / spec.sum()` replacing the librosa STFT call (L123) — document that this is the exact centroid of the same spectrum, not a framewise mean; golden regen covers the numeric shift.
4. `_measure_from_audio` L98-128 and `analyze_grouped` L242-262: compute `(freqs, spec)` ONCE per role bus and pass it into the three consumers (kill the second `_band_energy_ratios` computation at L257 — return ratios from the same call). Loudness/RMS/peak/width/pan lines untouched (G4).
5. `analyze_per_stem` L269-317: same shared-spectrum treatment per stem file. Keep MAX_CLASH_PAIRS logic as-is.
6. `_sum_group` L210-224: accumulate into one running buffer (`out[:len(a)] += a`) instead of materializing all padded arrays (hot-spot #9). Order-of-summation float differences are expected — covered by golden regen.

### Task 3 — Tests + golden regeneration

1. Extend `tests/stems/test_analyzer.py`: shared-spectrum equivalence test — build a synthetic signal with known tones, assert dominant freqs hit the tone bins, band energies match a brute-force rfft reference within 1e-4 dB, argpartition path returns the same top-3 as the old argsort path.
2. Regenerate `golden/phase4_with_stems.json` (+ `phase4_no_stems.json` only if the no-stems numbers moved — they should NOT; if they did, stop and find out why). Dedicated commit; summarize max deltas per metric in the commit body (expect ≤0.1 dB band energies, identical roles/keys/tiers).
3. Rewrite `test_performance.py`'s stems case with teeth: generate ≥120 s synthetic stems (same conftest generator, longer), assert phase-4 stems wall time under a budget derived from the new implementation (measure, then set budget ≈ 2× measured). Keep `@pytest.mark.perf`.
4. Run the phase4/phase5 suites + full analysis suite.

### Task 4 — Worker: parallel stem fetch (S3 path)

1. `tasks_dramatiq.py:285-296`: resolve stems with `concurrent.futures.ThreadPoolExecutor(max_workers=8)` mapping over stem keys (IO-bound, safe per G7). Local-disk `resolve_local` is a path join — unaffected. Preserve the existing cleanup contract (L349) — collect all temp dirs.
2. Failure semantics unchanged: any single stem resolve failure fails the job the same way it does today (don't half-analyze).

### Task 5 — Live verification

Re-run analysis on the SAME version used for the Task 1 baseline (`POST /api/versions/{id}/analyze` or UI). Compare: `phase 4 … done in` log line before/after (expect ≥4×), `analyses.phase_durations` populated, results page stems tab renders identically (roles, clash entries, tiers), progress bar moves through the stems segment.

## Validation Loop

```bash
# Analysis package (the heart of the change)
pytest -q components/analysis/tests/
pytest -q components/analysis/tests/ -m perf              # opt-in perf guard, run locally
ruff check components/analysis/src/
mypy components/analysis/src/ --ignore-missing-imports

# Worker (Task 1.2 + Task 4)
pytest -q components/worker/tests/
ruff check components/worker/
mypy components/worker/app/ --ignore-missing-imports       # NOTE: 12 pre-existing errors in
                                                            # retention/account-deletion/structure
                                                            # actors — do not fix here, do not add new ones

# Live (Task 5) — stack per docs/STARTUP.md, then re-analyze the baseline version and
# grep the worker window for:  phase 4 (Stem Separation & Clash) done in
```

## Anti-patterns

- Don't loosen golden snapshot comparisons to tolerances — regenerate deliberately and review the diff.
- Don't touch pyloudnorm/loudness code, band definitions, window TYPE (hann stays hann), or the clash formula — the rule engine's genre thresholds consume these numbers.
- Don't add numeric threading (OMP pins exist for crash safety — G7).
- Don't enable Demucs, don't wire phase-5 reference stems (G6), don't refactor the pre_demucs-only code paths (G9).
- Don't "fix" per_stem mode by silently switching it to grouped — it's a user-selectable mode.
- Don't put profiling drivers or timing artifacts in the repo — scratchpad / `output/analysis/` only.

---

**Confidence: 9/10.** The hot spots are verified at line level, the fixes are local and algorithmic, and the guard rails (goldens + new equivalence tests + live before/after on the same track) make regressions loud. Main risk is golden churn review discipline (G1) — budgeted for in Task 3.
