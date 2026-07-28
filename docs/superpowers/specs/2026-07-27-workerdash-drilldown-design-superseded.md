# workerdash drill-down (design addendum)

> **Superseded:** never implemented; a separate, more capable design shipped
> instead — see `2026-07-27-workerdash-operations-design.md` (the
> "Operations tab": full searchable run list, file serving, token/cost
> breakdown). Kept here in case the simpler modal-overlay approach below is
> ever worth revisiting.

Date: 2026-07-27
Status: approved (user: "yes" to the proposed design)
Extends: 2026-07-26-workerdash-design.md

## Purpose

Click any job or song in the dashboard to see everything about it, without
leaving the tool or psql.

## API

- `GET /api/jobs/<job_id>` → `{ok, job?, error?}` where `job` =
  - the full `analysis_jobs` row (all columns, timestamps as text)
  - `song` `{id, name}` + `version` `{id, label, version_number}` (null for
    anon/file-path jobs)
  - `analysis` summary or null: `{id, created_at, final_json_keys: [...],
    phase_durations, verdict_counts: {severity: n}}` — top-level key list
    only, NEVER deep-parses final_json (schema drift safety)
  - `retries`: `{retry_of: id|null, retried_by: [ids]}`
- `GET /api/songs/<song_id>` → `{ok, song?, error?}` where `song` =
  `{id, name, genre_hint, created_at, versions: [{id, label,
  version_number, is_current, jobs: [{id, status, error_code,
  dispatched_at, has_analysis}]}]}`
- Both 200 with `{ok: false, error: "not found"}` on unknown id (dashboard
  UX, not a REST purity exercise); `{ok: false, error}` on DB failure.

## UI

- Job UUIDs in "Running now" and rows in "Recent jobs" become clickable →
  fetch `/api/jobs/<id>`, render a detail overlay panel (fixed-position card,
  close button) with a key/value table of the job row, the analysis summary,
  verdict counts, retry lineage (clickable ids), and an **Open in SPECTR**
  link: `http://localhost:5174/songs/<song_id>/results/<job_id>` when
  complete with a song, else `http://localhost:5174/songs/<song_id>`.
- Song names in queue rows / recent rows become clickable → `/api/songs/<id>`
  → same overlay listing versions and their jobs; job ids clickable (chains
  into the job panel).
- `processing_jobs` / `recent_jobs` / queue-message context gain
  `song_id` / `version_id` fields so the links can be built.

## Non-goals

No editing from the panels, no final_json body rendering (the app's results
page owns that), no pagination.
