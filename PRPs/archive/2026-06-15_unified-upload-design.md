# Design: Unified "New track" upload (mix + stems + als + reference, one analysis)

**Date:** 2026-06-16
**Status:** Draft — awaiting review
**Component scope:** `frontend-spectr-v2`, `bff` (small). No DB migration, no worker/analysis changes.

---

## Problem

Uploading a track and its assets is piecemeal: upload the mix (`POST /versions/`),
then separately add stems, then `.als`, then a reference — and **each upload fires its
own `analyze_audio_job`**, so a track with stems + als is analyzed 2–3 times. Producers
want to "provide everything at once" and have it analyzed once.

## Goal

One **"New track"** dialog: the song/mix is the only required file; **stems, `.als`, and
reference are optional**. Submitting runs the 7-phase analysis **exactly once** with
everything attached.

## Decisions (from brainstorming)

- **Only the mix is required**; stems / als / reference are optional.
- **Stem review is optional**: default = analyze immediately using auto-detected roles;
  a **"Review stem roles before analyzing"** checkbox routes through the
  confirm-by-listening screen we already built.
- **Reference = library only**: an uploaded reference becomes a `ReferenceTrack`
  (for the Compare page); it does NOT change this track's analysis (no per-version
  `reference_path` wiring this pass).
- **Approach A**: defer the analysis dispatch and have one dialog orchestrate the
  existing endpoints — NOT one giant multipart request (fragile, no per-file progress).

## Non-goals

- Wiring per-version `reference_path` into the v2 pipeline/report.
- Zip/folder drop. Changing the analysis pipeline, worker, or DB schema.
- Removing the standalone add-stems / add-als / add-reference dialogs (kept for adding
  to an already-analyzed version).

---

## Flow (frontend orchestrates; backend analyzes once)

1. **Mix** → `POST /versions/` with `analyze=false` → `{songId, versionId}` (no job yet).
2. **`.als`** (if present) → `POST /versions/{id}/als` with `analyze=false` (attach only).
3. **Reference** (if present) → existing `POST /references/` (+ `analyze`), independent of
   this track's analysis (its own background reference-analyzer, unchanged).
4. **Stems** (if present) → `POST .../stems/stage` then `POST .../stems/classify`:
   - review **on** → poll proposals → user confirms roles → `POST .../stems/confirm`
     (already dispatches the single analysis; carries grouped/per_stem mode).
   - review **off** → poll until classified → auto-build confirm payload from
     `detectedRole` → `POST .../stems/confirm` (single dispatch).
5. **No stems** → `POST /versions/{id}/analyze` (single dispatch).

Net: **exactly one `analyze_audio_job`** per upload. If a step fails after the version is
created, the version persists (user can retry from the song page) — surface a toast.

---

## Backend changes (bff — small)

- `POST /versions/` (`UploadVersion`): add optional form field `analyze` (bool, default
  **true** for backward compatibility). When `false`, create song+version but DO NOT
  enqueue `analyze_audio_job`. Response unchanged (`{songId, versionId, jobId?}` —
  `jobId` null/empty when deferred).
- `POST /versions/{id}/als` (`UploadAls`): same `analyze` flag (default true; attach
  without enqueue when false).
- Reuse `POST /versions/{id}/analyze` (exists) as the single trigger for the
  no-stems / no-review path.
- Reuse `stems/stage` + `stems/classify` + `stems/confirm` (built; confirm already
  dispatches exactly one job).
- Reference endpoints: unchanged.

DTO note: `UploadResponse` already carries `JobId` — make it nullable / `Guid?` (or
return `Guid.Empty` and have the client treat empty as "deferred"). Prefer `Guid?`.

## Frontend changes (frontend-spectr-v2)

- **New `UnifiedUploadDialog.tsx`** (supersedes `UploadVersionDialog` for new uploads):
  - Required mix file picker; optional: stems drop-zone (reuse the staging/classify/
    confirm UI + hooks from `StemsUploadDialog`), `.als` picker, reference fields
    (title/artist/genre + file), genre hint, optional song target (new song vs add
    version to existing — `song_id`).
  - "Review stem roles before analyzing" checkbox.
  - Orchestration helper (pure, unit-testable) that sequences the calls above and picks
    the single dispatch path based on (hasStems, review).
- Reuse hooks: `useFileUpload` (mix, with `analyze=false`), `useUploadAls`,
  `useUploadReference`/`useAnalyzeReference`, `useStemStaging`/`useClassifyStems`/
  `useStemProposals`/`useConfirmStems`, plus `useReanalyze` (or add a thin
  `analyze=false` option to `useFileUpload`).
- Entry points: library "**+ New track**" and song detail "**+ Add version**" open the
  unified dialog. Keep `StemsUploadDialog`/`AlsUploadDialog`/`ReferenceUploadDialog`
  for adding to an existing analyzed version.
- `useFileUpload`/`useUploadAls` need an `analyze` arg threaded into the form data.

## Testing

- **bff:** `UploadVersion` / `UploadAls` with `analyze=false` create the row but enqueue
  no job; with default they still enqueue (existing behavior). `dotnet test` green.
- **e2e (backend script):** unified sequence (mix `analyze=false` → als `analyze=false`
  → stems stage/classify/confirm) results in **exactly one** AnalysisJob for the version;
  stems classified; both review-on and review-off paths.
- **frontend:** orchestration-helper unit tests (dispatch path selection: no-stems →
  `/analyze`; stems+review → confirm; stems+no-review → auto-confirm). Dialog
  function-shape test. All four gates green.

## Risks / edge cases

- Partial failure mid-sequence (mix ok, stems fail): version exists un-analyzed — toast
  + let the user retry from the song page. Don't leave a silently-pending job.
- Don't double-dispatch: ensure exactly one of {confirm, /analyze} fires.
- `analyze=false` default must stay `true` so existing callers/tests are unaffected.

## Reuse vs. new

| Reuse | Build new |
|---|---|
| stems stage/classify/confirm endpoints + hooks + review UI | `UnifiedUploadDialog` + orchestration helper |
| `POST /versions/{id}/analyze`, reference endpoints | `analyze` flag on UploadVersion/UploadAls |
| `useFileUpload`, `useUploadAls`, reference hooks | `analyze` arg threaded through mix/als upload |
