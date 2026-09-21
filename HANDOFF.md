# Handoff — 2026-09-21

Work happens in THIS worktree (`C:/Users/badmin/projects/spectr-solo`, branch `solo`). Never touch the main checkout `C:/Users/badmin/projects/AIMusicAnalysisSite` or `master`.

## What we were working on
Making spectrmix.com impressive to a first-time visitor who is a software hiring manager (no audio file, no audio vocabulary, ~90 seconds, often a phone). The owner approved a plan (`C:\Users\badmin\.claude\plans\glimmering-foraging-liskov.md`) with two workstreams, executed by subagent-driven development (one implementer at a time, fresh reviewer per task, ledgers with rulings):
- **D — guest demo sandbox** (`PRPs/guest-demo-sandbox.md` + `-plan.md`, tasks D1–D11): one click → an isolated, purgeable GUEST account seeded with a real analyzed track, fully live coach, one upload.
- **P — public surfaces polish** (`PRPs/public-surfaces-polish.md` + `-plan.md`, tasks P1–P10).

## Completed this session (implemented + reviewed + fixed, all pushed — `solo` @ `a3961cc`)
- P1 error/404 screens + guarded stale-chunk reload · P2 public `creditsEnabled`, Pricing hidden while credits are off · P5 plain-language sample report · P7 bundle diet (entry 726 → 362 KB raw, 230 → 114 KB gz, CI budget gate).
- D1 guest columns + flags · D2 worker: `audio/demo/` purge protection + separate guest LLM budget lane · D3 snapshot-driven `DemoSeeder` (seeded demo can never fire paid triage/specialists) · D4 admin snapshot exporter (atomic, leak-scanned, discloses exported free text) · D5 `POST /api/auth/demo` (fail-closed, device resume, bounded).
- D6 guest guard + quotas + coach cap and D7 guest purge: implemented, Opus-reviewed, fix rounds DONE.
- Earlier the same session: Concise coach mode, CoachChat split, findings-in-Listen-stage feature, rack-draft + `/analyze` stale-cache data-loss fixes, chat bubble line breaks.
- Gates at hand-off: BFF 518 passed / 0 failed / 0 skipped · frontend 162 files / 1049 tests · worker 683 passed + the 5 accepted env failures.

## Still pending (in order)
1. Scoped re-reviews (sonnet) of D6 (`0b63dfe`, `79b5e5a`, `267b6af`, `f324ed4`) and D7 (`e1bc819`, `d45e903`, `691ba9a`).
2. Frontend demo flow: D9 (`/demo` + `startDemo`) → D10 (guest shell) → D8 ("use our sample" on `/analyze`).
3. P3 (demo CTA, chrome link, footer — MUST fix the 390 px header wrap with 3+ nav items) → P4 (`/trust/how-its-built`) → P6 (link previews) → P8 (phone fixes) → P9 (hardening + quiet 401/404 on a logged-out landing) → P10 (public smoke in CI) → D11 (Playwright + deploy docs).
4. Whole-branch review on the most capable model → ONE fix wave → restart the stack → live pass (desktop + true 390 px, Lighthouse) → push → CI.

## Key decisions
- Per-visitor guest accounts, NOT a shared demo account — the solo spec forbids anything share-like and already blesses the per-user demo song.
- Owner choices: fully live coach for guests; guests may upload ONE track; present SPECTR as a product (no personal byline); engineering page links the GitHub repo; exactly two lines may be added to the FRONTEND no-social allowlist (`demo.tsx`, `trust.how-its-built.tsx`) — nothing else in either guard file.
- Safety nets I added (all live-tunable flags): `coach_guest_messages=20`, `llm_budget_guest_usd=5`, `guest_uploads_max=1`, `guest_fix_racks_max=2`, `guest_analyses_per_hour=10`, `guest_analyses_per_ip_hourly=2`; `demo_enabled` is seeded FALSE — prod never serves the sine-tone demo.
- Seeder rewrites `specialists_to_run` to specialists that already have a verdict (the results page auto-runs the rest = paid LLM calls per guest); purge never deletes device rows; exports write to a fresh per-export directory and go live last.
- All rulings with "cost if wrong" live in the ledgers (see below).

## Dead ends to avoid
- **Do NOT upload/re-analyze the 9-minute demo track (or any long track) locally**: allin1 structure detection (`docker run`, no `--memory` cap) took down the Docker/WSL VM three times. Recovery without reboot: `docker desktop restart` → launcher (`docs/STARTUP.md` #2d).
- Resuming an implementer for a multi-item fix round after a big task → it runs out of context. Use a FRESH implementer + a brief FILE, ≤ ~4 items, mandatory reading discipline (Grep + ≤60-line Read slices, filtered output, commit per item; the CONTEXT WARNING hook is advisory).
- BFF tests that use the REAL job queue race the live dev worker (that was the "flaky" anon test) — tests must use the recording `IJobQueue`.
- `features/results/redesign.css` is imported nowhere; generated `redesign-v3-tabs.css` is do-not-edit. Python heredocs mangle backslashes — use the Edit tool for C#/paths.

## Project state
- Branch: `solo`, pushed at `a3961cc`; this HANDOFF commit is local on top.
- Uncommitted: 2 files — `components/frontend-spectr-v2/src/features/results/AnalysisCompleteModal.tsx` / `.module.css` (ANOTHER session's work — never stage or edit).
- Ledgers — COPIES committed under `PRPs/handoff-ledgers/` (incl. `approved-plan.md`) so they travel between machines; on a new machine copy them back to `.superpowers/sdd/` (git-ignored working location). Originals: `.superpowers/sdd/first-impression-ledger.md` (controller: decisions, checkpoints, dispatch recipe), `.superpowers/sdd/guest-demo-sandbox-plan/progress.md`, `.superpowers/sdd/public-surfaces-polish-plan/progress.md`, plus `task-*-brief.md` files there.
- Running: dev stack from this worktree (BFF :5000, frontend :5174, coach + analysis workers, Docker Postgres/Redis). The shared Playwright browser is logged OUT on purpose. Several stale empty "SPECTR …" PowerShell windows can be closed.
- Local demo track (analyzed, NO arrangement data): song `a2fe6c31-e9ce-4f7d-95ed-3f0af4b938c4`, version `eb0ef7bb-e5da-42b1-a137-1fc7b9a0fc59`, job `eca86baf-1d85-4f29-9243-a3042a1968d0` in the local showcase account. Before exporting a snapshot it still needs verdicts/triage, a short coach conversation, a fix rack, and a clean title.

## Recommended next action
Read `.superpowers/sdd/first-impression-ledger.md` (last CHECKPOINT), then dispatch the two scoped re-reviews of D6 and D7 and, once clean, the D9 implementer (brief = `PRPs/guest-demo-sandbox-plan.md` lines 1–27 + 910–1025).

## Open questions for the user
- How to get arrangement/structure data for the 9-minute demo track: memory-capped retry (my recommendation, as a small separate fix) / GPU / a shorter edit / ship without it.
- Artist credit wording for Artifact303 (owner states he has permission to use "Magnetic Fields").
- Deploy prerequisites are unchanged (Cloudflare A record, R2/Resend/Anthropic/GHCR accounts, GitHub secrets); `npm audit` shows 33 pre-existing transitive vulnerabilities worth a look before launch.
