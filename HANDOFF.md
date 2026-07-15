# HANDOFF — 2026-07-15 (end of work-day session)

State snapshot for resuming on another machine. Read this first; delete when absorbed.

## Where things stand

**MVP is CODE-COMPLETE.** Master head (this handoff's commit) carries, all merged + CI green today or yesterday:

- **Epic 6 complete** (6-1..6-5, 2026-07-14): landing/pricing, trust pages (COPY STILL DRAFT — founder review is a BLOCKING launch item), anonymous instant analysis funnel, resume cards, PostHog funnel instrumentation.
- **Story 5-7** (2026-07-15, merge `a5018de`): partial-failure reporting + free retry + .als isolation.
  - `POST /api/jobs/{jobId}/retry` — entitlement-free re-run for degraded/failed analyses; eligibility 100% server-side; once-only via partial UNIQUE index on `analysis_jobs.retry_of_job_id`; new EF migration `20260715134927_Story57FreeRetry`.
  - DegradationBanner (frontend derives failed phases from `final_json.phases[]` — no server rollup).
  - Phase-8 .als parse now runs in a spawn subprocess (timeout + POSIX RLIMIT_AS); isolation failures are typed `als_isolation_*` phase failures, "skipped" stays reserved for no-als.
- **Coach Mix forward-port** (2026-07-15, merge `a338285`, parallel session): worker `coach_mix` package (LLM arbiter + mastering-engineer escalation), `RackPreset.CoachMeta` jsonb + migration `20260715140356_AddRackPresetCoachMeta`, SOLVE tier wired into `degraded.run_rule_engine_for_analysis`, FixRackPanel change-log UI. **Product decision (Brian): arbiter runs for ALL tiers incl. free; spend backstop = `llm_budget_*` feature flags.** Provenance: `PRPs/archive/2026-06-28_wire-solve-tier-into-pipeline.md`; `origin/ai-analysis-v2` deleted (fully harvested).
- **Story 5-10** (2026-07-15, merge `1ff2216`): keyboard layer (⌘K palette — built new, the 12.5 note that removed the fake one is satisfied; ⌘U global upload; `?` sheet; pure matrix in `src/lib/shortcuts.ts`), axe-core AA smoke in vitest/CI, report+Listen breakpoints 900→1024 (rail `<details>` accordion; Listen desktop-only notice + pause-all on shrink), focus ring on all interactives + new `lint:focus` CI gate (`scripts/check-focus-ring.mjs`), `/dev/kitchen-sink` (DEV-gated).

**Epic 5 is 9/10** — only 5-1 (polish) remains. Epics 8 (genre profiles) + 9 (affiliates) are post-MVP. Tracker: `PRPs/sprint-status.yaml` (source of truth, kept current). Per-story detail incl. full review records: `PRPs/stories/5-7-*.md`, `PRPs/stories/5-10-*.md`.

## What's next

1. **Brian's at-home launch-checklist evening** — `output/at-home-checklist/2026-07-13_epic-12-visual-checklist.md` (now carries 11-12, 6-1..6-5, 5-7, 5-10 sections). Plus ops items: VPS boot, DNS, Stripe live matrix, restore drill, and the **BLOCKING 6-2 trust-copy founder review** (DRAFT markers sit in the 3 trust route files AND the BFF shell strings).
2. Optional code, in rough priority: story 5-1 (last Epic 5 polish); coach-mix follow-ons (tier-from-job-row refactor, eq_conflict rulings advisory-only, scaffold/solvers dedup); 5-10 declared debt (axe for login/share/billing needs a router-mounting test harness; `check-focus-ring.mjs` is file-scoped, not selector-paired — known limit).

## Fresh-machine setup gotchas

- **DB migrations**: `cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff` — brings in BOTH `Story57FreeRetry` and `AddRackPresetCoachMeta`.
- **Python test venv** (py3.11, lock-constrained): `uv venv --python 3.11` at `%TEMP%\spectr-lock-venv`, then `uv pip install -e components/shared -e components/analysis -r components/worker/requirements.txt -c components/worker/requirements.lock.txt`.
- **Docker**: `JWT_KEY=devkey docker compose -f docker/docker-compose.yml up -d postgres redis` (JWT_KEY needed even for `down`). BFF integration tests SKIP (visibly) without Postgres.
- **Frontend gate order**: `npx vite build` FIRST (generates routeTree.gen.ts), then `npx tsc -b` (not --noEmit), `npm run lint`, `lint:css`, `lint:prices`, **`lint:focus` (new)**, `npx vitest run`.
- **Worker zombie gotcha**: killing a dramatiq parent leaves `--processes` children consuming queues with stale code. Before restarting: `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where CommandLine -match 'dramatiq' | Stop-Process -Force`.
- Test suite sizes at handoff (all green): BFF 393, frontend 848, worker 629, analysis 173, shared 27.
