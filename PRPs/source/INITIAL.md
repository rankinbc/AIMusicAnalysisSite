<!--
  INITIAL.md — feature intake for /generate-prp.

  Feature: on-demand per-specialist AI analysis (replaces auto-batch verdict run)
  Authored: 2026-05-17 from a design conversation
-->

## FEATURE

Replace the auto-running batch verdict pipeline with **on-demand per-specialist execution**. After the 7-phase analysis finishes for a job, the user lands on the ResultsPage and sees a grid of 26 specialist tiles plus a prominent "Run Summary" CTA. Each tile shows the specialist's name, last-run timestamp (if cached), and a Run / Re-run button. Clicking a tile fires off **one** Claude CLI specialist call, validates the result, appends/replaces it in the `analysis_results.verdicts_payload` JSONB cache (tagged by `specialist`), and renders the resulting `VerdictCard` inline next to the tile. The "Summary" tile runs the `priority_summary` specialist, which is the high-level synthesizer. The user controls cost and choice — nothing runs without an explicit click.

Behavior change summary:
- **Before:** open ResultsPage → `AIAnalysisModal` auto-streams the full pipeline (Triage → all routed specialists → validator → dedupe → ranker) for everyone who views the report. No user control.
- **After:** open ResultsPage → see specialist grid in idle state. Each click runs one specialist. Cached verdicts persist across page loads. User explicitly opts in per specialist.

The triage/ranker/dedupe pipeline still exists in the codebase but is no longer the default entry point — keep it available for power users / future "Run All" reinstatement, but not wired to any UI.

Where it lives: `components/api/app/verdict_pipeline/` (backend), `components/api/app/routers/verdicts.py` (route), `components/frontend-spectr/src/components/AIAnalysisModal.jsx` (frontend rewrite — likely renamed to `SpecialistsPanel.jsx`).

## COMPONENTS

### COMPONENT: api

**Pattern**: `api.md`

**Purpose**: New endpoint `POST /api/reports/{job_id}/verdicts/run/{specialist_slug}` that runs a single specialist on demand, validates, merges the result into the `verdicts_payload` JSONB cache (replacing prior verdicts tagged with the same `specialist`), and returns the new verdict(s) as JSON.

**Inputs**: reads `upload_jobs` + `analysis_results.final_json` (existing tables); reads specialist prompts from `components/api/prompts/experts/`

**Outputs**: writes `analysis_results.verdicts_payload`, `analysis_results.verdicts_generated_at`, `analysis_results.verdicts_prompt_version_set` (extends, doesn't replace)

**Notes**:
- Reuse existing `app/verdict_pipeline/specialists.py` machinery — extract `run_one_specialist(slug, focus, analysis, llm, ...)` from the iterator in `run_specialists()`. Don't duplicate the LLM-call / retry / hydrate-verdict logic.
- Reuse `app/verdict_pipeline/validator.py::validate_verdict` — same authority over `priority_score` and severity band.
- Cache replace semantics: when a specialist re-runs, all prior verdicts tagged `specialist == slug` in the cached payload get evicted before the new ones are merged in. Use the existing `Verdict.specialist` field.
- Concurrency: the global `asyncio.Semaphore(1)` around CLI calls in `app/llm/client.py` already prevents concurrent CLI calls; per-job locking is not required for v1.
- IDOR: gate via the same `_load_job_for_user` join used by the existing verdict routes; reject with 404 when the job does not belong to `current_user`.
- 404 for unknown `specialist_slug` (not in `SLUG_TO_FILENAME`).
- 410-style error if the analysis has no `final_json` (job not COMPLETE yet).
- Return shape: `{ verdicts: [...], specialist: "<slug>", prompt_version: "<slug>@<version>" }`. Validation failures returned as `{ error: { code, reason } }` with HTTP 422.
- Tests: happy path, unknown slug → 404, IDOR other-user → 404, replace-not-duplicate (run twice, cache should have only the latest set tagged with that slug), validation failure surfaces a 422.

### COMPONENT: frontend-spectr

**Pattern**: `dashboard.md` (with the project's "vanilla JSX, no TypeScript / Tailwind / shadcn" override — see CLAUDE.md)

**Purpose**: Rewrite `AIAnalysisModal.jsx` to render a 26-tile specialist grid + prominent "Run Summary" CTA, with each tile having its own Run / Re-run state. Drop the on-mount auto-streaming. Add `runSpecialist(jobId, slug)` to `api/verdicts.js`.

**Inputs**: none (calls `api` via REST)

**Outputs**: none (renders in browser)

**Notes**:
- File rename: `AIAnalysisModal.jsx` → `SpecialistsPanel.jsx` (and update the import alias `AIAnalysisPanel` at `ResultsPage.jsx:46`). Keep the panel mounted in the same place on ResultsPage.
- The grid has 26 specialist tiles + 1 large Summary tile at the top. Tile states:
  - **idle** — "Run" button
  - **running** — spinner + "Analyzing…" (~10–30 s per call)
  - **cached** — verdict card rendered inline; "Re-run" button visible
  - **error** — error message + "Try again" button
- On mount, call `GET /api/reports/{jobId}/verdicts` (existing endpoint) ONCE to load cached verdicts; group them by `specialist` and seed the tile state for any that already have cached content.
- Group the 26 specialists by category in the grid (Low-End / Frequency / Dynamics / Stereo / Loudness / Arrangement / Stems / Meta) for visual scanability. The grouping is a UI-only concern; backend remains a flat list. Categories can be hard-coded in a `SPECIALIST_CATEGORIES` constant in the JSX file.
- Use the existing `VerdictCard` rendering style (severity color, headline, summary, evidence, fix, why-it-matters, dismiss + feedback). Refactor it out of `AIAnalysisModal.jsx` into its own `VerdictCard.jsx` if practical, to avoid duplication.
- Delete or stub `streamVerdicts` from `api/verdicts.js` — no longer used. (Keep `dismissVerdict` and `giveFeedback` — they're still used on cached verdicts.)
- Delete dead `ExpertsPanel.jsx` (367 lines, not imported anywhere — pre-cutover legacy).
- CSS: add classes for the grid (`.specialists-grid`, `.specialist-tile`, `.specialist-tile--running`, etc.) to `index.css` using the existing color tokens (`--cyan`, `--surface`, `--card`, `--border`, `--muted`, `--text`, severity colors).
- Errors: surface `error.code === "validation_failure"` as "AI returned malformed output — try Re-run." Surface 5xx as "Specialist service is unavailable."

## SHARED DOCUMENTATION

- `CLAUDE.md` — section "verdict pipeline (v1.2)", in particular the gotchas:
  - `USE_CLAUDE_CLI=true` required (Anthropic API transport is a stub)
  - Sequential CLI calls under `asyncio.Semaphore(1)` (CLI is not concurrency-safe)
  - Specialist slugs are snake_case, prompt files are PascalCase — mapping in `prompt_loader.py::SLUG_TO_FILENAME`
  - Validator overwrites `priority_score` and may downgrade severity using a moderate-severity baseline
  - Verdict cache key includes every prompt's frontmatter `version:` — `analysis_results.verdicts_prompt_version_set`
- `components/api/app/verdict_pipeline/specialists.py` — current `run_specialists()` shape; extract `run_one_specialist` from it
- `components/api/app/verdict_pipeline/orchestrator.py` — full pipeline driver; reference for how validation errors are categorized
- `components/api/app/verdict_pipeline/validator.py` — `validate_verdict()` contract
- `components/shared/aimusic_shared/verdicts/models.py` — `Verdict` Pydantic model + `specialist` field
- `components/shared/aimusic_shared/verdicts/scoring.py` — authoritative `priority_score` formula (Python, not LLM)
- `components/api/prompts/experts/*.md` — 26 specialist prompts + `Triage.md` + `PriorityProblemSummary.md` (this is the "Summary" CTA target)
- `components/frontend-spectr/src/components/AIAnalysisModal.jsx` — current auto-stream UI; reuse `VerdictCard` rendering, drop streaming
- `components/frontend-spectr/src/api/verdicts.js` — existing `getVerdicts`, `dismissVerdict`, `giveFeedback`; add `runSpecialist`

## OTHER CONSIDERATIONS

- **Cost gating**: each specialist click triggers a real Claude CLI call (paid). The UI should make the "Run" action feel deliberate — small primary button, not a soft tap target. Don't auto-run on hover, focus, or mount.
- **Concurrency**: with 26 tiles, a user could fire many clicks in quick succession. The backend's `asyncio.Semaphore(1)` serializes them, but the UI must reflect queued state — disable a tile's Run button while ANY specialist is running for this job, or queue with a visual queue indicator.
- **Cache invalidation**: the existing `verdicts_prompt_version_set` cache key assumed all prompts were run together. With on-demand, the set grows incrementally. Decision: track the version of each specialist's run inside the `Verdict` itself (it already has `prompt_version`) and use that for per-specialist invalidation. The set field becomes "set of versions for specialists that have ever been run."
- **Prior batch payloads**: jobs that ran the batch pipeline already have `verdicts_payload` populated with many specialists. The new endpoint should *append* to that — never wipe pre-existing verdicts from other specialists. Test this explicitly.
- **No retroactive auto-run**: jobs that completed before this feature shipped will simply show all tiles in idle state. No back-fill job. Tested by ensuring the GET-and-seed-tiles flow tolerates an empty / missing payload.
- **Don't delete the orchestrator / Triage / dedupe / ranker modules**: they're still useful for future "Run All" reinstatement. Just disconnect them from the default UI.
- **Validation failures from prior HANDOFF still apply**: most live-CLI specialist runs fail validation due to (a) DSP param mismatches, (b) summary >300 chars, (c) `phases[N].data...` array notation vs the validator's `phaseN.field` syntax. This PRP does NOT fix those — it's a UX restructure. But the new endpoint surfaces validation failures more visibly (per-tile error state), so prompt-iteration becomes easier. Worth a follow-up PRP.
- **Backwards compatibility**: the existing `GET /api/reports/{job_id}/verdicts` and `GET .../verdicts/stream` and the dismiss/feedback endpoints stay. Only the auto-stream-on-mount behavior in the frontend changes.
- **No DB migration**: cache reuses existing columns. Migration 011 is NOT needed.
- **Profile/auth refresh**: the Profile-page-logout bug (fixed in commit `d7520ab` — trailing slash on `/jobs/`) is unrelated to this work but worth noting since the verdict UI also lives behind auth; the same auth-refresh patterns apply.
