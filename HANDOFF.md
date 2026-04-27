# Handoff — 2026-04-25 (post-/compact, ready for new-frontend session)

## What we were working on
Replaced the old prose-based "AI Mix Experts" panel with a structured-output verdict pipeline (rules → Triage → sequential Claude-CLI specialists → validator → dedupe → ranker → SSE-streamed `Verdict` cards). Backend, schemas, migrations, and the verdict UI itself are live on branch `restructure` / PR #1. Smoke testing surfaced that the *surrounding* frontend (auth, history, report pages) is broken — the user is pivoting to a new frontend.

## Completed last session
- All 33 plan tasks: migrations 006+007, 5 verdict endpoints, full pipeline modules, 7 React verdict components, hard cutover from experts → verdicts
- 80 API tests + 18 shared tests pass; frontend type-check + production build clean
- PR #1 open: https://github.com/rankinbc/AIMusicAnalysisSite/pull/1
- Live-CLI smoke fixed 4 real bugs (`fix_id` server injection; prompt category enumeration; Windows arg-length cap → stdin pipe; `/api` router-prefix vs vite-proxy double-strip)
- Saved feedback memory `feedback_zombie_uvicorn_processes.md` (how to kill orphaned uvicorn `--reload` spawn workers on Windows)

## Still pending
- **New frontend** — user's stated next direction. Needs scoping (see open questions).
- Specialist verdicts mostly fail validation under live CLI (DSP param mismatches, summary >300 chars, `phases[N].data...` array notation vs our `phaseN.field`). Real prompt-iteration work; defer until after frontend.
- HistoryPage crash: `jobs.map is not a function` at `HistoryPage.tsx:85` — `/api/jobs` response shape changed.
- Defensive nulls missing: `ReportPage.tsx:158` and `SharedReportPage.tsx:80` crash if `result.phases` is undefined.
- Auth refresh races: blank `/upload` after register; three `/auth/refresh 401`s on every page load. Look at `AuthContext` mount-time refresh + `ProtectedLayout` loader.
- Generic SSE errors: `useVerdictStream` shows "stream error" with no detail.

## Key decisions
- **Hard cutover, no feature flag** — old experts code deleted, except `routers/experts.py` shipped as empty stub because some external tool keeps re-adding the import.
- **Sequential specialists under `Semaphore(1)`** — Claude CLI is not concurrency-safe. Anthropic API path is a stub.
- **JSONB cache + sidecar `verdict_user_state` table** — verdicts payload is immutable per (analysis × prompt-version-set); per-user dismiss/feedback lives separately.
- **Validator authoritative on score + severity** — uses moderate-severity baseline (without it, category weights inflate any "critical" claim back into critical band, defeating the downgrade).

## Dead ends to avoid
- **Don't add `prefix="/api"` to FastAPI routers** — vite proxy strips `/api` before forwarding. Routes need to be declared without `/api`.
- **Don't pass long strings as subprocess args on Windows** (8191-char cap). Use `subprocess.run(..., input=text.encode())`.
- **Don't try to delete `routers/experts.py` or `services/expert_service.py` permanently** — an external tool keeps restoring them. Ship `experts.py` as an empty stub; ignore `expert_service.py` if it reappears (no longer wired in).
- **Don't trust `Get-Process`/`Stop-Process` for uvicorn `--reload` orphans on Windows.** Use `tasklist | grep python.exe` → `wmic process where "ProcessId=<pid>" get CommandLine` → `taskkill //F //PID <pid>` (Git Bash uses `//F`). See memory `feedback_zombie_uvicorn_processes.md`.
- **Don't use `pydantic-to-typescript`** under WSL/Windows — `json2ts` wrapper fails. Hand-mirror types in `frontend/src/types/verdicts.ts`.

## Project state
- Branch: `restructure` (39 commits ahead of `master`, all pushed)
- PR #1 open
- **External-tool drift since last handoff**: `main.py` re-added `from .routers import experts`, and `services/expert_service.py` reappeared. Neither hurts (router is empty stub; service is unimported), but if you commit, either revert main.py or accept the harmless import.
- Untracked: 13 `output/analysis_results/*.json` and 4 `data/uploads/*.als` (smoke artifacts), `.playwright-mcp/` cache.
- No long-running dev processes assumed alive (zombies were cleared at end of last session; restart fresh).
- Test users: `smoke-test@example.com` / `TestPassword123!` owns seeded job `11111111-1111-1111-1111-111111111111`.

## Recommended next action
**Discuss new-frontend scope before writing code.** Answer the 3 questions below, then either rebuild in-place under `components/frontend/` or scaffold `components/frontend-v2/`.

## Open questions for the user
1. **Scope**: total rewrite, or just fix the broken auth/history/report pages?
2. **Stack**: Greenfield React 19 + Vite + Tailwind again, or a different stack?
3. **Keep verdict UI components** (`VerdictsPanel`, `VerdictCard`, etc. in `components/frontend/src/features/verdicts/`)? They render correctly when underlying data + auth flow works — verified on `SharedReportPage` during smoke.
4. **Layout**: rebuild in-place under `components/frontend/` (gradual replace) or scaffold `components/frontend-v2/` alongside (safe parallel)?
5. **Visual style**: keep v1.1 dark mode + purple accents + studio theme, or redesign?
6. **Prompt-iteration polish** (DSP params, summary cap, metric path syntax) — before, after, or in parallel with the new frontend?
