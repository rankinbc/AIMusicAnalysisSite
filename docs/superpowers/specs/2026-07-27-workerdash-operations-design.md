# workerdash — Operations tab (uploads, analysis runs, token cost) design

Date: 2026-07-27
Status: approved (brainstorm w/ user)

## Purpose

Extend the existing workerdash ops tool (standalone, localhost-only, no auth —
see `2026-07-26-workerdash-design.md`) with a management view over every
upload and song-analysis run: browse history, drill into a single run to see
every related file, its full JSON report, and how many tokens/dollars it
cost across triage, specialists, and coach Q&A.

This does not touch the BFF, frontend-spectr-v2, or the worker — read-mostly
additions to workerdash, same deployment model as before.

## Data model & the token-cost join

`llm_calls.correlation_id` is not a uniform FK; it depends on who wrote the
row (verified in `components/worker/app/*_actor.py`):

- `triage_actor`, `verdict_actor`, `fix_rack_actor` → `correlation_id` =
  `analyses.id` (as text) directly.
- `coach_actor` → `correlation_id` = `conversations.id` (as text);
  `conversations.analysis_id` links back to the analysis.

Computing a run's total cost therefore requires two grouped queries merged
in Python:

```sql
-- direct (triage / specialist / fix_rack)
SELECT correlation_id, sum(input_tokens), sum(output_tokens),
       sum(cost_usd), count(*)
FROM llm_calls WHERE correlation_id = ANY(%(analysis_ids)s)
GROUP BY correlation_id;

-- via coach conversations
SELECT c.analysis_id::text, sum(l.input_tokens), sum(l.output_tokens),
       sum(l.cost_usd), count(*)
FROM llm_calls l JOIN conversations c ON c.id::text = l.correlation_id
WHERE c.analysis_id = ANY(%(analysis_ids)s)
GROUP BY c.analysis_id;
```

`ops_db.llm_totals_by_analysis(conn, analysis_ids)` runs both and merges
into `{analysis_id: {input_tokens, output_tokens, cost_usd, call_count}}`.

**Known limitation, by design:** `verdicts` rows have no FK to a specific
`llm_calls` row, so a per-verdict exact cost isn't derivable. The per-call
breakdown table shows raw `llm_calls` rows (purpose, prompt_slug, model,
tokens, cost, outcome, timestamp); `prompt_slug` usually names the
specialist (e.g. `low_end`) which identifies what ran, but it's an
inference, not a hard link. Documented here so it isn't "discovered" later
as a bug.

## Placement & routing

New tab in the existing single page (`workerdash/app.py` `PAGE` constant):
`Live` (current queue/worker view, unchanged) and `Operations` (new). Client
-side tab switch, no separate Flask route for the page itself. The
Operations tab reads/writes a `?job=<id>` query param so a specific run's
detail view is directly linkable/bookmarkable; on load it checks the param
and opens that job's detail if present.

New modules:

- `workerdash/ops_db.py` — list/detail/token-total Postgres queries.
  Kept separate from `db.py` (which stays scoped to the live queue/job
  -mutation queries) so neither file's responsibility grows tangled.
- `workerdash/files.py` — resolves a stored `file_path` / S3 key to bytes
  and streams it. Mirrors the worker's `object_store.py` local-first
  -then-S3 behavior (same `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` /
  `S3_SECRET_KEY` / `S3_REGION` env vars, same "local root first, then
  presence check, then S3 fetch-to-temp" order) so it behaves identically
  against local-disk dev data or a real bucket. Does not import the
  worker's package (workerdash stays a standalone, independently
  installable component); the resolution algorithm is duplicated
  deliberately, matching the existing project convention of no
  cross-component imports between deployable units.

New API routes (added to `create_app()` in `app.py`, same host/origin
guard as every existing route):

- `GET /api/ops?search=&status=&since=&until=&page=` — paginated list.
- `GET /api/ops/<job_id>` — full detail payload for one run.
- `GET /api/ops/<job_id>/file/<slot>` — streams one related file.
- `GET /api/ops/<job_id>/json` — raw `final_json`, `Content-Disposition:
  attachment` for the "download raw JSON" link (the detail view also
  inlines a pretty-printed copy; this route exists so the link is a real,
  independently fetchable file, matching "links to every file").

## List query

One row per `analysis_jobs`, LEFT JOINed to `song_versions` → `songs` (so
anonymous / song-less jobs still show — labeled by their own `file_path`
per the `AnalysisJob` model's story-6.3 comment), LEFT JOINed to `analyses`
to get the `analyses.id` needed for the token-total lookup (a job with no
`analyses` row yet — still processing/failed pre-analysis — shows `0`
tokens, not an error).

Filters:
- `search` → `ILIKE` against `songs.name` and `song_versions.label`
  (anonymous jobs are excluded from search matches, included by default).
- `status` → exact match against `analysis_jobs.status`.
- `since` / `until` → range on `dispatched_at`.

Pagination: offset-based, 25/page (`LIMIT/OFFSET` + a separate `COUNT(*)`
for the page count — run volume doesn't justify a window-function
micro-optimization), newest `dispatched_at` first.

## Detail payload

`GET /api/ops/<job_id>` returns:

- Job: id, status, error_code/message, current_phase, dispatched/started/
  completed/failed timestamps, tier.
- Song/version: song name, version label/number, notes, `is_current`,
  `stem_analysis_mode`, `raw_audio_purged_at`.
- Analysis (if present): `id`, `pipeline_version`, `rule_engine_version`,
  `validator_version`, `phase_durations`, `degradation_notice`,
  `routing_plan`.
- Token totals: merged result from `llm_totals_by_analysis`, plus the raw
  `llm_calls` rows for the breakdown table (both direct and
  conversation-joined, unioned, ordered by `created_at`).
- Verdicts: all `verdicts` rows for the analysis (specialist, model,
  severity, category, headline, summary, created_at).
- Coach: `conversations` row (if any) + its `coach_messages`, ordered by
  turn, for a read-only transcript.
- Files: a fixed list of "slots" resolved from the version/analysis row,
  each with `{slot, label, available: bool, purged: bool}` — the frontend
  renders a link/button per available slot, a disabled control with a
  tooltip otherwise. Slots: `source`, `reference`, `als`, one per
  `stem_paths` key, `waveform_image`, `spectrogram_image`,
  `waveform_peaks`, `report_json`.

## File serving

`GET /api/ops/<job_id>/file/<slot>` looks up the slot's stored path/key
from the version/analysis row, calls `files.resolve_and_stream(path_or_key,
mimetype_hint)`:

1. Local root check (existing dev convention) → serve directly if present.
2. Else, if `S3_ENDPOINT` set → fetch to a temp file, stream, clean up
   after the response (mirrors `object_store.fetch_to_local` /
   `cleanup_local`).
3. Else → `404` with `{"ok": false, "error": "file not found"}` — the
   frontend already renders this as a disabled control, so a live 404 only
   happens on a stale link (file deleted after the page loaded).

Content-Type by slot: audio slots (`source`, `reference`, one per stem) →
sniffed from extension (`.wav`/`.mp3`/`.flac`); `als` → `application/
octet-stream` with `Content-Disposition: attachment` (binary Ableton
project, not previewable); images → `image/webp`; `waveform_peaks` /
`report_json` → `application/json`.

If `raw_audio_purged_at` is set on the version, the `source` slot is marked
`available: false, purged: true` up front — no failed fetch attempt.

## Frontend (detail view)

Plain `<pre>` block with `JSON.stringify(analysis.final_json, null, 2)` for
the report (no tree widget, per the earlier decision) — same minimal-JS
style as the existing page (no bundler, no framework). Token totals shown
as a summary line (total tokens, total $) above a breakdown `<table>` of
individual `llm_calls` rows. File slots rendered as a row of
buttons/links; audio slots use a native `<audio controls src=...>`, images
an `<img>`, JSON/peaks/als as a plain `<a download>` link.

## Error handling

Same defensive pattern as the existing `db_section()`: Postgres unreachable
→ the Operations tab shows an error string instead of crashing the page.
Every new query function degrades to returning an explicit `{"error":
...}` shape rather than raising past the route handler. A missing file at
serve-time (deleted after the list/detail payload was built) → `404` JSON,
rendered by the frontend as a toast, not a broken image/audio tag.

## Testing

`components/workerdash/tests/`, matching the existing pytest + stubbed-DB /
fakeredis style:

- `test_ops_db.py` — query-shape tests for `list_jobs`, `job_detail`, and
  `llm_totals_by_analysis` against a stubbed connection: expected-use
  (rows present), edge (job with no `analyses` row → zero totals, no
  error), anonymous job (no song/version → still listed).
- `test_files.py` — local-root resolution, S3 fallback (mocked client),
  missing-file → `404` shape; purged-source-audio short-circuit.
- `test_ops_routes.py` — smoke tests for `/api/ops`, `/api/ops/<id>`,
  `/api/ops/<id>/file/<slot>`, `/api/ops/<id>/json` against
  stubbed/fakeredis data, including the host/origin guard already covering
  every route.

## Housekeeping

Update `components/workerdash/README.md` and the project `CLAUDE.md`
workerdash entry to mention the Operations tab, per the existing
housekeeping convention from the 2026-07-26 design.

## Non-goals

No auth, no HTTPS, no editing/deleting runs or files from the dashboard,
no exact per-verdict cost attribution (see the known limitation above), no
export/reporting beyond the raw JSON download, no changes to the BFF,
frontend-spectr-v2, or worker code.
