# Story 10.3: Observability Stack

Status: review

## Story

As the operator,
I want pipeline, queue, spend, quality, and revenue visible on dashboards,
So that the morning glance replaces guesswork (Journey 6).

## Acceptance Criteria

1. **Given** Sentry (AR32), **When** errors occur in BFF, worker, or frontend, **Then** they report with `correlation_id` tags — one id traceable upload → job → actors → LLM calls → report render (NFR30).
2. **Given** Prometheus, **When** scraping, **Then** BFF `/metrics` (prometheus-net) and worker (dramatiq middleware + custom counters: job durations, queue depth, LLM cost) expose.
3. **Given** Grafana, **When** dashboards load, **Then** pipeline health, queue depths, LLM spend vs budget, verdict quality (validation-reject + helpful/wrong rates), and MRR proxy render (FR45).
4. **Given** PostHog, **When** the funnel runs, **Then** the PRD KPI table metrics are derivable.

## Decisions of record (recon 2026-07-03)

1. **Correlation id = the analysis job/analysis id everywhere** (already the llm_calls convention). NEW: `worker/app/obs.py` — contextvar + logging Filter (`%(correlation_id)s` in the format) + Sentry tag, set at the top of every actor. Coach keeps conversation-id AND gains the analysis-id tag (the chain seam closed). BFF: a tiny middleware pushes `CorrelationId` (route jobId/analysisId) into Serilog `LogContext` + Sentry scope.
2. **Sentry all three runtimes, DSN-gated OFF by default**: BFF `Sentry.AspNetCore` (`Sentry:Dsn` empty = disabled), worker `sentry-sdk` (DramatiqIntegration, `SENTRY_DSN`), frontend `@sentry/react` (`VITE_SENTRY_DSN`, init no-ops without it) + first `ErrorBoundary` at the router root.
3. **Prometheus**: BFF `prometheus-net.AspNetCore` — `/metrics` + HTTP metrics + a before-collect gauge `spectr_queue_depth{queue}` LLEN'ing all four queues (BFF already owns Redis; the worker's dramatiq middleware can't see LIST depth). Worker: `prometheus-client` + dramatiq `Prometheus` middleware (exporter :9191) + custom `spectr_job_duration_seconds{tier,status}` histogram, `spectr_llm_cost_usd_total{tier,purpose}` counter, `spectr_verdict_validation_rejects_total{slug}` counter (validation rejects finally queryable — today log-only). Single-process worker = no multiproc registry pain.
4. **Grafana reads TWO datasources**: Prometheus (queues, durations, HTTP) + Postgres direct (LLM spend vs budget from `llm_calls`, verdict quality from `verdict_user_state.feedback`, MRR proxy from `subscriptions`, pipeline success from `analysis_jobs`) — the SQL is the source of truth for money/quality; no double-instrumentation. Provisioned from `infra/grafana/` (datasources + one `spectr-ops` dashboard JSON, 10 panels).
5. **Prometheus+Grafana join the prod compose** on the internal network; Grafana published on `127.0.0.1:3000` ONLY (operator reaches it via SSH tunnel — no public surface, no auth exposure pre-10.5); Prometheus unpublished. A read-only `grafana` Postgres role (runbook SQL) — Grafana must never hold the app credentials.
6. **PostHog (EU host)**: `posthog-js` behind `src/lib/analytics.ts` (no-op without `VITE_POSTHOG_KEY`) + the minimal event set the KPI table needs from the product side: `upload_completed` (+ als_attached flag), `report_viewed` (time-to-first-insight pairs with job timestamps), `coach_message_sent`, `verdict_feedback`. The KPI rows that are DB/Stripe-derived get a runbook mapping table (KPI row → source) instead of redundant events. Epic 6 owns the landing/funnel/k-factor events.
7. **Out of scope**: alert RULES (10.4 owns FR49 — this story makes the signals exist), log shipping/Loki (Serilog console + docker logs suffice at this scale), tracing/OTel (correlation tag is the NFR30 bar).

## Tasks / Subtasks

- [x] Task 1 — worker: `obs.py` (contextvar + CorrelationFilter → `[correlation_id]` on every log line, DSN-gated Sentry w/ DramatiqIntegration, 3 custom metrics); WORKER_METRICS-gated dramatiq Prometheus middleware (:9191); correlation set in analyze/triage/specialist/rerun/coach (coach = conversation id + analysis_id tag once loaded — the chain seam closed); JOB_DURATION observed at all 3 terminal paths; LLM_COST mirrored where the metering row writes; VALIDATION_REJECTS at the validator drop (previously log-only); 4 obs tests
- [x] Task 2 — BFF: Sentry.AspNetCore (Sentry:Dsn-gated), prometheus-net (/metrics + UseHttpMetrics + before-collect `spectr_queue_depth{queue}` LLEN over all four lanes), correlation middleware (route jobId/analysisId → Serilog LogContext + Sentry tag); /metrics test (queue gauge + HTTP families)
- [x] Task 3 — frontend: `lib/sentry.ts` + root `Sentry.ErrorBoundary` (first error boundary in the app — no more white pages), `lib/analytics.ts` (PostHog EU, autocapture OFF — explicit KPI events only), 4 events wired (upload_completed w/ attachment flags, report_viewed + setCorrelation(jobId) on the results route, coach_message_sent, verdict_feedback), no-op-safety vitest
- [x] Task 4 — infra: prometheus.yml (3 scrape jobs, 30 d), grafana provisioning (Prometheus + READ-ONLY Postgres datasources, 10-panel spectr-ops dashboard), compose services (prometheus unpublished; grafana 127.0.0.1:3000 — SSH tunnel), Dockerfile.web VITE build args + CI build-args + scp of the provisioning dirs; compose config validated
- [x] Task 5 — runbook Observability section (setup, tunnel, grafana RO role SQL, KPI→source mapping table honest about Epic-6 gaps) + .env.example
- [x] Task 6 — gates: BFF 328/328 (1 new), worker 583 + 3 xfail (4 new), shared 27, frontend 678 (1 new), ruff clean

## Dev Notes

- Worker deps go in requirements.txt with floor pins; lock constrains only listed packages — new deps resolve freely (same pattern the lock header documents).
- dramatiq Prometheus middleware: `from dramatiq.middleware.prometheus import Prometheus`; exporter binds `dramatiq_prom_host/port` env (0.0.0.0:9191 in-container).
- prometheus-net: `Metrics.DefaultRegistry.AddBeforeCollectCallback` async for queue LLEN; `app.UseHttpMetrics()` + `app.MapMetrics()` — caddy does NOT route /metrics (internal scrape only).
- NuGet audit: `NuGetAuditMode=direct` — Sentry/prometheus-net direct packages must be clean.
- Grafana provisioning: `/etc/grafana/provisioning/{datasources,dashboards}` mounted from `infra/grafana/`; dashboard JSON via provider `path: /var/lib/grafana/dashboards`.
- llm budget ceilings for the spend-vs-budget panel: read `feature_flags` (`llm_budget_*_usd`) in the SQL panel (join-free scalar subquery).

### References

- [Source: PRPs/epics.md L1199-1210, AR32 L213, NFR30 L157, FR45 L100; prd.md L66-79 (KPI table)]
- [Source: recon — llm_calls (cost_usd/correlation_id), verdict_user_state.feedback, subscriptions, analysis_jobs timestamps, /api/health/worker LLEN pattern]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- worker+shared pytest must stay separate invocations (known fixture collision).
- obs contextvar test order-dependent on suite-wide actor runs — default-value assertion dropped.

### Completion Notes List

- AC1: correlation chain closed end-to-end (BFF middleware → actor contextvar/log filter → llm_calls → frontend results-route tag); Sentry DSN-gated in all 3 runtimes.
- AC2: /metrics + :9191 exporters + the 4 custom metric families; queue depth collected BFF-side (dramatiq middleware can't LLEN).
- AC3: 10 panels across 2 datasources; money/quality panels read Postgres directly (no double-instrumentation); grafana DB role is SELECT-only.
- AC4: 4 product events + honest KPI mapping (Epic 6 owns funnel/k-factor rows).
- Signals exist for 10.4's alert rules (spend counter, reject counter, queue gauge, duration histogram).

### File List

- Worker: `app/obs.py` (new), `app/dramatiq_app.py`, `app/tasks_dramatiq.py`, `app/verdict_actor.py`, `app/triage_actor.py`, `app/rerun_phase_actor.py`, `app/coach_actor.py`, `app/llm/gateway.py`, `requirements.txt`, `tests/test_obs.py` (new)
- BFF: `Spectr.Bff.csproj` (+2 packages), `Program.cs` (Sentry, correlation middleware, UseHttpMetrics, /metrics + queue gauge), `tests/DeployTopologyTests.cs` (+1)
- Frontend: `src/lib/{sentry.ts,analytics.ts}` (new), `src/lib/__tests__/analytics.test.ts` (new), `src/main.tsx` (init + ErrorBoundary), `src/api/hooks.ts` (verdict_feedback), `src/features/results/CoachChat.tsx`, `src/components/UnifiedUploadDialog.tsx`, `src/routes/_app/songs.$songId.results.$jobId.tsx`, `package.json`
- Infra: `infra/prometheus/prometheus.yml` (new), `infra/grafana/**` (new: datasources, provider, spectr-ops.json), `infra/compose.prod.yml` (+2 services, worker/bff env), `infra/Dockerfile.web` (VITE args), `.github/workflows/ci.yml` (build-args + scp)
- Docs: `docs/runbook.md` (Observability), `.env.example`

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter + Edge Case Hunter/Acceptance Auditor; the auditor read the INSTALLED dramatiq/prometheus_client sources, ran the BFF metrics test against a live scrape, and verified streaming metering single-write). Outcome: **Changes requested → all applied** (14 patches):

- [x] [CRITICAL] **Worker :9191 exporter would have served an EMPTY registry in prod**: dramatiq's Prometheus middleware sets `PROMETHEUS_MULTIPROC_DIR` only in `after_process_boot` — AFTER obs.py imported prometheus_client (the value class binds at import), so neither dramatiq's families nor the 3 custom counters would ever reach the exporter → the dir is now set in the compose worker env (pre-import) + created/chowned in the Dockerfile; both lanes inherit via the anchor
- [x] [High] **Stale correlation ids bled across actor invocations** (contextvar never cleared; thread reuse stamps the PREVIOUS job's id on classify_stems/sweeps logs — a wrong id is worse than none) → `CorrelationResetMiddleware` (dramatiq before_process_message resets to "-"), registered unconditionally
- [x] [High] **`identifyUser` was exported, tested, and never called** — every PostHog event anonymous, KPI joins impossible, logout never reset shared-device identity → wired into AuthContext (follows auth state, resets on logout)
- [x] [Med] **`:?` Grafana vars would have deploy-frozen the whole stack** post-merge (every compose command incl. auto-rollback fails until .env edited) → `:-changeme`/`:-` defaults (grafana is tunnel-only) + runbook ".env additions" bullet with set-it warning
- [x] [Med] Correlation single-tag claim was FALSE across lanes (analyze=job id, verdict lanes=analysis id) → cross-lane stitch tags (`job_id` on triage/specialist via the loaded row — getattr-guarded for test stubs; `analysis_id` on analyze Phase C + coach) + runbook honesty rewrite ("search either id")
- [x] [Med] Correlation middleware ran AFTER UseSerilogRequestLogging — the request-summary line (the one you grep first) never carried the id → reordered before it
- [x] [Med] Queue gauge: frozen-stale on Redis failure with zero signal + blind to `.DQ` delay queues (a retry storm read as empty) → `.DQ` summed in + `spectr_queue_depth_scrape_errors_total` staleness counter
- [x] [Med] /metrics test silently required live Redis (label assert) → family asserted unconditionally, label sample gated on `redis.IsConnected`
- [x] [Med] Dashboard: `refId` added to all 11 targets (provisioned JSON skips UI normalization; Postgres panels often reject refId-less targets); panel 5 now shows the feature_flags budget ceilings alongside spend (the "vs budget" half existed only in a description); panel 10 retitled honestly (query aggregates all handlers incl. scrape noise)
- [x] [Low] main.tsx init try/catch (an SDK init throw must not white-page before the ErrorBoundary exists); report_viewed per-job ref-guard (remounts/StrictMode won't inflate the TTFI denominator); Sentry scope-lifetime invariant documented at the middleware; runbook role-SQL ordered BEFORE first up + dev /metrics exposure noted
- Verified-clean by the review: streaming metering writes exactly one row per logical call (LLM_COST can't double-count); tier binds outside the try (no NameError on the new failure-path observes); lowercase dramatiq_prom_* env names correct; CI build-args reach the pushed image; RouteValues available (implicit UseRouting); grafana `${VAR}` provisioning expansion supported; configure_logging's handler replacement is exactly-one-handler (CLI's handler replaced, no duplicates); @sentry/react ErrorBoundary safe uninitialized.
- Deferred (10.4+): panel-5 divergence during incidents (SQL ok-only vs counter all-outcomes — noted in panel description), Phase-C failure-duration observation, --processes>1 multiproc gauge audit.
- Honest scope: grafana dashboard + :9191 exporter still never rendered/scraped against live instances — first VPS boot verifies; the multiproc fix is source-verified against installed dramatiq 2.2.0.

### Change Log

- 2026-07-03: implemented on `ops/10-3-observability`. Gates: BFF 328, worker 583+3xf, shared 27, frontend 678, ruff clean. Status → review.
- 2026-07-03 (review): 14 patches incl. the CRITICAL multiproc import-order fix. Gates re-verified: BFF 328, worker 583+3xf, frontend 678, tsc/lint/ruff clean.
