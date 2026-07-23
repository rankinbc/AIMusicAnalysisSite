# Architecture: analysis (`audio_analysis` package)

Component root: `C:\Users\badmin\projects\AIMusicAnalysisSite\components\analysis`
Source: `components/analysis/src/audio_analysis/` (src layout, hatchling build, installable via `pip install -e components/analysis`).

## Executive Summary

`audio_analysis` is the deterministic DSP core of SPECTR. Given one uploaded audio file (MP3/FLAC/WAV), it normalizes to 44100 Hz WAV and runs a sequence of analysis phases producing a single JSON-safe dict (`PipelineResult`). It measures: loudness (BS.1770-4 integrated LUFS, true peak dBTP, momentary/short-term/LRA, loudness timeline), 7-band frequency balance, stereo health (correlation, width, channel balance, mono compatibility), BPM, musical key (Krumhansl 24-key), clipping, transients, spectral descriptors, song structure (via allin1 in Docker), genre classification and genre-specific scoring, frequency clash detection, optional per-stem metrics, reference-track deltas, genre-profile gap analysis, arrangement scoring, mix translation (phone/headphone/mono survival), and optional Ableton `.als` project health/MIDI analysis. The dict also carries rollups: `overall_score`, `grade` (A-F), `top_fixes` (exactly 3), `danceability_score`, and coach text. The worker persists this dict as `analyses.final_json`.

The package contains no I/O to the database and no LLM calls — it is pure analysis, called by the dramatiq worker (`analyze_audio_job`, `rerun_phase`, structure-detection actors).

## Technology Stack

| Dependency | Constraint | Role |
|---|---|---|
| Python | >= 3.11 | runtime |
| librosa | >= 0.11, < 1.0 | decoding, STFT/mel, chroma, BPM, onsets |
| soundfile | (unpinned) | primary decode/encode path |
| scipy | (unpinned) | 4x polyphase oversampling for true peak |
| numpy | **< 2.0 (hard pin)** | librosa/numba/soundfile incompatibilities with 2.x — never loosen |
| pyloudnorm | (unpinned) | BS.1770-4 LUFS metering |
| scikit-learn | (unpinned) | feature helpers |
| rapidfuzz | >= 3.0 | stem filename/role fuzzy matching |
| Pillow | >= 10, < 12 | server-rendered spectrogram/waveform WebP (`viz.py`) |
| demucs / torch / torchaudio / torchopenl3 | optional `[ml]` extra | stem separation and embeddings — NOT required for the default pipeline |
| pytest, pytest-asyncio, ruff, mypy | `[dev]` extra | tooling |

Notes: `demucs` is loaded only via the singleton loader (`src/audio_analysis/models.py::get_model`) and only used when `USE_DEMUCS = True` (currently False) or by the offline pre-Demucs CLI. `torchopenl3` is wired in `get_model` but no live phase calls it (Phase 2 is rules-based; the README's "genre via torchopenl3" line predates the current code).

## Pipeline structure

### Entry points (`src/audio_analysis/pipeline.py`, re-exported from `__init__.py`)

- `run_pipeline(file_path, reference_path=None, als_file_path=None, genre_hint=None, progress_cb=None, stem_paths=None, reference_stem_paths=None, stem_mode="grouped", defer_structure=False) -> PipelineResult` — full run. Converts input to a temp 44100 Hz WAV first (`converters.to_wav`), loops `run_single_phase` over `PHASE_DEFS`, appends Phase 8 (ALS), then `finalize_result`. Temp WAV deleted in `finally`.
- `run_single_phase(phase_num, *, wav_path, phase_data, ...) -> PhaseResult` — one phase against an already-converted WAV; reads upstream data from the `phase_data` map, never mutates it. Per-phase try/except: a failed phase returns `status="failed"` with the error string, and the pipeline continues (partial-failure tolerance).
- `finalize_result(phase_data, phase_results, file_path) -> PipelineResult` — derives rollups; shared by full runs and re-runs so both stay consistent.
- `rerun_single_phase(phase_num, file_path, prior_result, ...) -> PipelineResult` — re-runs ONE phase, replaces it in the stored result, re-derives rollups. Every other phase preserved byte-for-byte; no dependent-phase cascade. Backs the BFF's `POST /api/reports/{jobId}/phases/{phase}/rerun` via the worker `rerun_phase` actor.
- `detect_structure_and_rescore(file_path, prior_result, *, use_gpu=None) -> PipelineResult` — background half of deferred structure detection: runs Docker allin1, patches the stored Phase-1 `structure` sub-dict, then re-runs Phase 7. Never raises for an unavailable detector — it always resolves the deferred state (to detected or to an honest `available: false`).

### Phase execution order

`PHASE_DEFS` runs 1, 2, 3, 4, 5, 6, 7, 9; Phase 8 (ALS) is appended after the loop. So the `phases` list in the output is ordered `[1, 2, 3, 4, 5, 6, 7, 9, 8]` — Phase 9 runs before Phase 8.

### Phases

| # | Module (`src/audio_analysis/phases/`) | Computes | Inputs | Approx. duration |
|---|---|---|---|---|
| 1 | `phase1_universal.py` | LUFS (gated, -70.0 silence sentinel), true peak dBTP (4x oversample, max across channels), peak dBFS, clipping count, RMS, crest factor, BPM, key + confidence + full 24-key `key_estimate`, 7 mel bands, stereo correlation/width/`channel_balance`, mono compatibility, `low_energy`/`sub_30_energy`, spectral centroid/contrast/flatness, transients, momentary/short-term max + LRA + `loudness_timeline`, `structure` | audio only | seconds of DSP over the full track; + the allin1 structure step unless `defer_structure=True` (see below) |
| 2 | `phase2_genre.py` | genre + confidence, purely rules-based on BPM ranges (dnb 160-180, trance 130-150, house 120-130, techno refinement via presence band); `genre_hint` short-circuits with confidence 1.0 | phase-1 output | < 1 s |
| 3 | `phase3_genre_specific.py` | per-genre rubric: `total_score` + sub_scores + notes (trance/house/techno/dnb scorers over bands, stereo width, BPM adherence) | phase-1 + genre | < 1 s |
| 4 | `phase4_stems.py` | spectral band-energy clash detection (low-end buildup, low-mid mud, high-mid harshness) via librosa STFT; when user stems exist, adds `stems` block from `audio_analysis.stems` (per-stem metrics, clash matrix, balance flags) | audio; optionally user stems | ~1-2 s spectral (module header); Demucs path preserved behind `USE_DEMUCS = False` (10-20 min CPU — do not enable without worker timeout >= 1800 s) |
| 5 | `phase5_reference.py` | deltas vs a reference track (LUFS, RMS, stereo correlation, per-band) with ok/minor/moderate/significant severities; `genre_context` preset checks (LUFS/BPM/correlation vs `genre_presets.py`); per-stem reference deltas when stems available | audio + optional reference (+ optional stems / reference stems / `_stems_cache` entry) | skipped-shape instantly without a reference; with one it re-runs FULL Phase 1 on the reference — including a second allin1 structure attempt — so cost roughly doubles Phase 1 |
| 6 | `phase6_gap.py` | percentile gaps vs a statistical genre profile (`data/reference_library/profiles/<genre>_profile.json`); fallback: mean of per-track Phase-1 JSONs in `data/reference_library/<genre>/` | phase-1 + genre + profile JSON on disk | < 1 s |
| 7 | `phase7_arrangement.py` | `ArrangementScorer` (`structure/arrangement_scorer.py`, 836 lines) over the Phase-1 structure via `structure/phase1_adapter.py`: overall score, grade, component/section scores, issues, suggestions; legacy `fixes`/`violations` keys; `arrangement_status` = `scored` / `pending` (deferred) / `unavailable` (detector not set up) | phase-1 structure + genre + bpm + duration | < 1 s (pure scoring) |
| 9 | `phase9_translation.py` | mix translation via vendored `analyzers/spatial_analyzer.py`: `spatial` (height/depth/width), `surround` (mono compatibility, phase coherence, Atmos readiness), `playback` (headphone/speaker scores, crossfeed safety, bass translation). Never downmixes; numpy scalars coerced to native for JSONB | audio only (stereo preserved) | seconds (three analyzer passes) |
| 8 | `phase8_als.py` | Ableton project health: `health_score`/grade, tempo, device/plugin inventory, per-track device lists, MIDI issues (empty/short/duplicate clips, quantization, humanization), arrangement markers, per-track `midi_analysis` (chords capped at 48, velocity, density, swing) | `.als` file only | `status="skipped"` (zero cost, no subprocess) when no `.als`; otherwise bounded by a 60 s wall-clock timeout |

Phase 8 isolation (story 5.7 / AR33): the parse runs in a **spawned** `multiprocessing` child (never fork — the dramatiq parent holds librosa/torch state). Wall-clock timeout `ALS_PARSE_TIMEOUT_S` (default 60 s) on all platforms; `RLIMIT_AS` cap `ALS_PARSE_RSS_MB` (default 1024 MB) on POSIX only. A gzip/XML bomb kills only the child; the parent maps it to a typed `status="failed"` with reasons like `als_isolation_timeout` / `als_isolation_crashed`, and the parent itself is exception-proof (`analyze_als` can never raise). Cleanup is terminate -> join -> kill -> join.

### Rollups (`finalize_result`)

- `overall_score`: `phase3.total_score`; fallback `50 * (ok_phases / 8)` when Phase 3 failed.
- `grade`: A >= 90, B >= 80, C >= 70, D >= 60, else F.
- `top_fixes`: exactly 3 — Phase-9 translation fixes first (cap 2, via `recommendations.translation_fixes`), then Phase-7 suggestions (cap 3), then Phase-4 clash descriptions, padded with a generic line.
- `danceability_score`: `scorers/danceability.py` (BPM 40% / onset density 40% / low-frequency energy 20%, genre-aware).
- `coach_name` / `coach_intro` / `coached_fixes`: template-based coaching voice from `coach.py` referencing measured values.

## Structure detection via Docker allin1 (`src/audio_analysis/structure/docker_allin1.py`)

allin1 (madmom/NATTEN) cannot build natively on the Windows/Python 3.13 worker host, so it runs inside the `allin1:latest` Linux container (build: `docker build -t allin1:latest docker/allin1`). `DockerAllin1.analyze` mounts the audio's parent dir read-only, bypasses the image entrypoint with an inline Python script that redirects allin1's stdout chatter to stderr, and parses the JSON result (bpm, beats, downbeats, labeled segments in seconds) defensively from the last JSON-looking stdout line.

- Env hooks: `ALLIN1_IMAGE` (default `allin1:latest`), `ALLIN1_USE_GPU` (adds `--gpus all`; prod pairs with a CUDA image, no code change), `ALLIN1_TIMEOUT` (default `DEFAULT_TIMEOUT_S = 1800`).
- Timing (code comments): GPU ~10-15 s; CPU ~60-90 s for short input, but allin1 runs Demucs source separation first, which is ~10-20 min CPU for a full-length 5-8 min track — the old 300 s timeout silently produced "not assessed", hence the generous 1800 s default.
- Failure taxonomy: `Allin1Unavailable` (Docker down / image missing — "not set up here", logged once per run) is distinct from `RuntimeError` (container ran but failed/timed out) so downstream says "not assessed" instead of punishing the track.
- Deferred flow: `run_pipeline(defer_structure=True)` makes Phase 1 emit the `_DEFERRED_STRUCTURE` placeholder (`{"available": False, "deferred": True, ...}`) and Phase 7 report `arrangement_status: "pending"` — the user sees a pending arrangement card while the main report is already complete. A background worker job then calls `detect_structure_and_rescore`, which fills in the structure (or the honest unavailable shape) and re-scores Phase 7 in place.

## Stems subsystem (`src/audio_analysis/stems/`)

Single import boundary: phases import only from `audio_analysis.stems.__init__` (`analyze`, `analyze_grouped`, `analyze_per_stem`, `classify_stems`, `compare`, `detect_role`, `propose_mapping`, `validate_confirmed_mapping`, plus the types).

- `classify.py` — `classify_stems(paths) -> [StemProposal]`, audio-content-based (not filename). **Import-light by contract**: librosa/soundfile/numpy only, never demucs/torch, so the worker's `classify_stems` actor is cheap at upload time over up to 100 stems. Analyzes at most the loudest 20 s window of each file (stem exports often start with silence). Tuning CLI: `python -m audio_analysis.stems.classify <dir-or-files...>`.
- `analyzer.py` — per-stem metrics (bands, LUFS, dynamic range, stereo width/pan, dominant frequencies), pairwise clash matrix (overlap severities: info >= 0.3, warning >= 0.5, critical >= 0.7) and balance flags. Two modes: **grouped** (default — stems sharing a role are summed into a role bus; output shape identical to the legacy one-file-per-role path) and **per_stem** (opt-in via `song_versions.stem_analysis_mode`; each stem individually, capped pairwise clash).
- `phase4_stems._coerce_groups` accepts both persisted `stem_paths` shapes — legacy `{role: "path"}` and current `{role: ["path", ...]}` — so old rows still analyze.
- `role_detector.py` / `matcher.py` — role heuristics and mapping proposals for the confirm UI (rapidfuzz filename matching against roles and `.als` track names).
- Failure containment: user-stem analysis failures produce `phase4.stems.status = "failed"` without failing Phase 4 itself.

## Reference library (`data/reference_library/` + `src/audio_analysis/reference_library/`)

Curated professional tracks by genre feed two phases: Phase 6 reads statistical profiles from `data/reference_library/profiles/<genre>_profile.json` (fallback: per-track Phase-1 JSONs under `data/reference_library/<genre>/`), and Phase 5's per-stem reference comparison reads pre-computed Demucs stem caches at `data/reference_library/_stems_cache/<track_id>.stems.json`. Caches are built **offline** by `python -m audio_analysis.reference_library.pre_demucs --library data/reference_library/ --out data/reference_library/_stems_cache/` (idempotent — skips caches newer than the source; lazy demucs import). Demucs is never run at request time on references; without a cache Phase 5 sets `stem_reference_comparison: "unavailable"` and falls back to full-mix deltas.

## Key gotchas that shape behavior

- **pyloudnorm axis order (silent bug)**: librosa yields `(channels, samples) float32`; pyloudnorm expects `(samples, channels) float64`. Every meter call transposes (`y.T.astype(float)`) — see `integrated_lufs` in `phase1_universal.py`. Getting this wrong yields silently wrong LUFS with no exception.
- **WAV conversion first**: `converters.to_wav` normalizes any input to 44100 Hz PCM_16 WAV before any phase (MP3 decode variance shifts beat/structure detection by ±70 ms). The temp file must be deleted by the caller in `finally` — `run_pipeline`/`rerun_single_phase` do this.
- **-70.0 LUFS floor sentinel**: content wholly below the BS.1770 gate (or pyloudnorm returning -inf) reads -70.0, which also prevents invalid `-Infinity` from reaching JSONB.
- **True peak is per-channel** (story 10.7 fix): dBTP was previously measured on the mono downmix, which under-reads wide mixes. Analyses stored before 10.7 carry the old measurement — cross-boundary version comparisons can show phantom true-peak regressions.
- **Singleton model loading**: heavy models load once per process via `models.get_model("demucs"|"openl3")` (double-checked locking; returns `None` when the optional dep is missing). Never load inside a per-call path.
- **`TORCH_HOME=data/models`**: keeps demucs/torchopenl3 weights under the project (see `.env.example`) instead of `~/.cache/torch`.
- **`USE_DEMUCS = False`** in `phase4_stems.py`: the fast spectral path is live; flipping to Demucs requires the dep installed and worker time limits >= 1800 s.
- **numpy < 2.0 pin** in `pyproject.toml` — do not loosen without testing librosa + numba + soundfile together.
- **Phase 9 must not downmix**: mono-compatibility/phase/crossfeed metrics only mean anything on the stereo array; a degenerate `(1, N)` is collapsed to 1-D so the analyzer's mono branch triggers correctly. Its output passes through `_to_native` because numpy scalars raise in Postgres JSONB serialization.

## Output contract

`schemas.py` defines two TypedDicts. `PhaseResult`: `{phase: int, name: str, status: "ok"|"failed"|"skipped", data: dict, error: str|None}`. `PipelineResult`: `{file_path, analysis_schema_version, phases: [PhaseResult...], overall_score, grade, top_fixes, danceability_score, coach_name, coach_intro, coached_fixes}`. `ANALYSIS_SCHEMA_VERSION = "2.1.0"` is stamped by `finalize_result` and bumped whenever the field set changes ("2.1.0" added the Tier-B phase-1 lifts: `key_estimate`, `loudness_timeline`, `channel_balance`, `sub_30_energy`), so downstream tooling (rule engine, recompute jobs) knows which lifted fields to expect.

The worker persists this dict verbatim as `analyses.final_json`. **Known issue**: `final_json` has drifted into multiple inconsistent shapes across historical prod rows, rule-engine fixtures, and specialist prompt documentation (tracked in `PRPs/` and the `final-json-schema-drift` memory note); the schema-version stamp plus `tests/test_schema_version.py` is the current guard, and a follow-up plans to stamp analyses rows with pipeline/rules/prompt code versions. Per-phase wall-clock timings are recorded separately by the worker into `analyses.phase_durations` (not by this package).

## Testing (`components/analysis/tests/`)

- **Golden snapshots**: `tests/integration/test_phase_snapshots.py` pins Phase 4 and Phase 5 output (with and without stems) against JSON goldens in `tests/integration/golden/` — floats rounded to 2 decimals, volatile keys stripped. Regenerate with `UPDATE_SNAPSHOTS=1`; the diff is reviewed by eye. These guarded the `run_single_phase`/`finalize_result` refactor byte-identical.
- **Measurement conformance**: `tests/conformance/test_bs1770_conformance.py` asserts EBU Tech 3341 vectors (1 kHz tone cases ±0.1 LU, relative-gate case, silence sentinel; fs/4 inter-sample-peak and 997 Hz true-peak cases within the EBU -0.4/+0.2 dB window) against the exact production meters — a metering regression fails CI.
- **Mock-heavy unit tests**: `tests/test_pipeline.py` patches heavy models and synthesizes sine WAVs in-memory (no GPU, no model downloads). `tests/test_rerun.py` covers merge-in-place + rollup re-derivation; `tests/test_deferred_structure.py` covers the `defer_structure` knob and `detect_structure_and_rescore`; `tests/test_schema_version.py` pins the version stamp.
- Focused suites: `tests/phases/` (phase-1 lifts, phase 6, phase 9, phases 4/5 with stems), `tests/structure/` (arrangement scorer, Docker wrapper), `tests/als/` (parser, phase 8, subprocess isolation via env-injected sleep/crash test seams), `tests/stems/` (classifier, role detector, matcher, analyzer, reference comparator), `tests/reference_library/`, and `tests/integration/test_performance.py`.

Run: `pytest -q components/analysis/tests/`.
