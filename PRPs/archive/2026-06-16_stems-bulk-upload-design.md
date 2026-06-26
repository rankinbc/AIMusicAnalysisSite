# Design: Bulk stem upload with audio-content auto-classification

**Date:** 2026-06-15
**Status:** Draft — awaiting review
**Component scope:** `frontend-spectr-v2`, `bff`, `shared` + DB migration, `worker`, `analysis`

---

## Problem

Today's stems upload (`StemsUploadDialog.tsx` + `POST /api/versions/{id}/stems`) is
**one file input per role** (10 fixed roles), keyed server-side as a
`{role: path}` dictionary. Uploading a real session's stems one-by-one is a
"huge pain." Producers want to drag a whole folder of stems (up to ~100) onto a
single spot and have the app figure out what each one is.

## Goal

1. **Multi-file drag-and-drop** of up to **100** stems onto a single drop zone.
2. The app **auto-identifies each stem's role from its audio content** (not just
   filename), prioritizing the important roles (kick, bass, drums, snare, hats,
   vocals, lead, pad, fx).
3. The user **confirms by listening** — each stem is previewable in the browser,
   with its detected role shown and editable — then commits.
4. Analysis runs on the confirmed set.

## Non-goals

- Pretrained neural-net classification (rejected: conflicts with the pinned
  `numpy<2` / torch stack; heavy weights). We use a strong DSP-feature classifier.
- Stem separation / Demucs at request time (unchanged; still off by default).
- Changing the no-stems flow (uploading a mix without stems stays identical).

---

## User flow

1. User opens **Upload stems** on a version → new dialog with a single drop zone.
2. Drops/selects up to 100 `.wav`/`.flac` files. A list row appears per file
   immediately (filename, size, local ▶ preview via object URL).
3. Files upload to a **staging area** for the version. As each finishes, the
   server classifies it by audio content and returns `{role, confidence, evidence}`.
4. The list updates: each row shows **detected role** (confidence pill) + an
   **editable role dropdown**. Low-confidence rows are visually flagged for review.
   Preview can stream from the server copy once uploaded (or keep the local blob).
5. User listens, corrects any wrong guesses, optionally toggles
   **"analyze every stem individually"** (default off = grouped by role).
6. **Confirm** → server persists the confirmed stem list + role assignments and
   dispatches re-analysis. Dialog closes, navigates to the results job.

---

## Architecture & component changes

### analysis (`audio_analysis.stems`)

**Dedicated classifier, separate from the music-analysis pipeline.** Stem
categorization is its own concern with a different lifecycle (interactive,
upload-time, must feel fast) than the heavy 7-phase `run_pipeline` (background,
minutes). It lives as a **self-contained, import-light module inside
`audio_analysis.stems`** — NOT a new top-level component — with its own clean
public API and a standalone CLI. It must NOT import demucs/torchopenl3/allin1;
librosa/numpy features only. `run_pipeline` never classifies — it only ever
consumes *confirmed* roles.

- **Public entry:** `classify_stems(paths: list[Path]) -> list[StemProposal]`
  (where `StemProposal` ≈ existing `RoleProposal` + file ref). Pure, fast,
  deterministic, no heavy model loads.
- **Tuning CLI:** `python -m audio_analysis.stems.classify <dir>` — prints each
  file's guessed role + confidence + evidence so the feature classifier can be
  iterated against real stems. This is the primary tuning/debug tool and is fully
  decoupled from `run_pipeline`.
- **Upgrade the classifier** from the current 4-way `_spectral_classify`
  (bass/hats/vocals/other, no kick) into a **feature-based model** over:
  sub/bass band energy, spectral centroid, zero-crossing rate, percussive vs
  harmonic ratio (HPSS), crest factor, transient/onset density. Maps to
  kick / snare / hats / drums / bass / vocals / lead / pad / fx / other with a
  confidence score and human-readable `evidence`.
- **`detect_role` / `propose_mapping` must load audio** (today `propose_mapping`
  calls `detect_role(f)` with no audio → filename-only). Decode each stem
  (downmix, short window or full) and pass to the classifier; filename match stays
  as a high-confidence fast path.
- **Drop the unique-role constraint**: `validate_confirmed_mapping` currently
  raises on duplicate roles. New model allows many stems per role.
- **Two analysis modes** in the per-stem analyzer:
  - *Grouped (default):* stems sharing a confirmed role are summed into a role bus,
    then analyzed per role exactly like today (reuses `analyzer`, clash matrix,
    balance, reference-delta — all stay role-keyed). Clash detection runs across
    role groups, not all files.
  - *Per-stem (opt-in):* each stem analyzed individually; pairwise clash across all
    stems. Guard cost (cap pairs / time) and emit a `log` if truncated.

### shared + DB migration
- Persist the **raw stem list** (not just role→path) so per-stem mode and the
  confirm UI have full fidelity. Proposed shape in `song_versions.stem_paths_raw`
  (jsonb, already exists): list of
  `{ id, original_filename, path, detected_role, confidence, confirmed_role }`.
- Keep `song_versions.stem_paths` as the **role→[paths] groups** consumed by the
  grouped analyzer (widen value from string to string[]).
- Add a per-version **analysis mode** flag (grouped | per_stem) — column on
  `song_versions` or carried on the re-analysis `AnalysisJob`. Add the column in
  `shared/aimusic_shared/models.py` first, then EF Core migration (BFF owns
  canonical schema) — mirror in the SQLAlchemy model.

### bff
- **Staging upload endpoint** accepting up to 100 files (multipart), raise
  `RequestSizeLimit` accordingly; writes to `audio/stems/{versionId}/staging/...`.
- **Classify endpoint/step** returning per-file proposals (calls into the analysis
  classifier — via a worker task or a thin in-process call; decide in PRP).
- **Confirm endpoint** taking the confirmed list + mode → persists `stem_paths_raw`
  + `stem_paths` groups, dispatches `analyze_audio_job`.
- **Per-stem audio streaming** for preview (Range-enabled, same JWT-via-`?t=`
  pattern as the existing version audio route).
- Validation: count ≤100, per-file ≤250 MB, magic-byte audio check, role enum.

### worker
- Classification path (if classification runs in the worker): a fast actor over
  the staged files returning proposals; or reuse `analyze_audio_job` for the final
  run. Honor the grouped/per-stem mode. concurrency=1 constraint respected.

### frontend-spectr-v2
- **Rewrite `StemsUploadDialog`**: single drop zone (`react-dropzone`-style via
  native DnD; no new heavy dep unless justified), a results **table** (filename,
  ▶ preview, detected-role pill + confidence, editable role `<select>`, remove),
  a "analyze each stem individually" toggle, progress per file, Confirm.
- Audio preview: local `URL.createObjectURL` pre-upload; server stream post-upload.
- New hooks in `api/hooks.ts` (`useStageStems`, `useClassifyStems`,
  `useConfirmStems`) + types mirrored from the BFF DTOs.

---

## API (proposed)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/versions/{id}/stems/stage` | Upload N files to staging; returns staged ids |
| `POST` | `/api/versions/{id}/stems/classify` | Classify staged files; returns `[{id, role, confidence, evidence}]` |
| `POST` | `/api/versions/{id}/stems/confirm` | Confirm list + mode; persists + dispatches re-analysis |
| `GET`  | `/api/versions/{id}/stems/{stemId}/audio` | Range-enabled preview stream |

(Exact shapes finalized in the PRP. May collapse stage+classify into one call.)

---

## Testing

- **analysis:** classifier unit tests on synthetic stems with known character
  (the repo already has `tests/stems/conftest.py::synth_stem_files`); assert kick
  vs bass vs hats separation + confidence. Grouped vs per-stem analyzer tests.
- **shared:** model/migration round-trip for new columns.
- **bff:** stage/classify/confirm endpoint tests (auth, limits, IDOR, role enum),
  preview Range request.
- **frontend:** dialog component tests (multi-drop, role edit, confirm payload),
  vitest. All four gates green.

---

## Reuse vs. new

| Reuse | Build new |
|---|---|
| `types.py` (RoleProposal, StemMappingProposal, ConfirmedMapping, StemMetrics) | Feature-based classifier (major upgrade to `_spectral_classify`) |
| `matcher.propose_mapping` (wire audio in) | Multi-file staging/classify/confirm endpoints |
| `analyzer` role-keyed metrics (grouped mode) | Many-stems data model + DB migration |
| `stem_paths` / `stem_paths_raw` columns | New drag-drop dialog + preview UI |
| Existing version-audio streaming pattern | Per-stem audio streaming route |

## Risks / open questions

- Classifier accuracy on real material — needs a tuning pass against a few real
  multitracks; confidence thresholds for the "flag for review" UI.
- Where classification runs (worker actor vs in-process BFF call) — latency vs
  architecture cleanliness; decide in PRP.
- 100-file multipart memory on the BFF — must stream to disk in chunks, never
  buffer all in memory.
- Storage growth from staging; need cleanup of abandoned staging dirs (the v1
  design had an hourly purge of stale `AWAITING_STEM_MAPPING` jobs — reuse idea).

## Out of scope (future)

- Drag a `.zip`/folder of stems.
- Auto-grouping suggestions (e.g. "these 6 are all drums → drum bus").
- Re-classify-on-rename.
