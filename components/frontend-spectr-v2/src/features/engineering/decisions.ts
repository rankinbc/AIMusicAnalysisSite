// Task P4 (public-surfaces-polish, §3.1 rows 3a-3g + the addendum's approved
// 8th card). Every body sentence below was checked against the cited source
// before it was written; nothing here is invented. Two claims the addendum
// flagged as unprovable are deliberately absent: "starve" (prod's
// worker-free pool actually shares analysis-paid/analysis-free/maintenance —
// infra/compose.prod.yml) and "SHA-pinned" (only the Trivy action is; the
// secrets scanner is checksum-verified, not SHA-pinned).
export interface Decision {
  id: string;
  title: string;
  body: string;
}

export const DECISIONS: readonly Decision[] = [
  {
    // README.md "Engineering notes" — "The language split is the
    // architecture." bullet.
    id: 'language-split',
    title: 'The language split is the architecture',
    body: "Everything user-facing and transactional — auth, entitlements, uploads, billing, audio streaming — lives in one .NET service. Everything compute-heavy — DSP, ML models, LLM calls — lives in a Python worker. The seam between them is a job queue, not HTTP.",
  },
  {
    // README.md "Coach chat has its own worker pool." bullet; queue names at
    // components/bff/src/Spectr.Bff/Program.cs (the four-queue foreach); the
    // single-VM trade-off at infra/compose.prod.yml (worker-paid keeps only
    // `coach`, worker-free drains `analysis-paid analysis-free maintenance`).
    id: 'coach-worker-pool',
    title: 'Coach chat has its own worker pool',
    body: 'Four named queues, tier-routed at dispatch. In production the coach queue runs in its own worker process, so a chat reply never sits behind a multi-minute analysis. On the current single-VM deployment the analysis lanes share one pool.',
  },
  {
    // components/worker/app/verdict_lib/rule_engine.py (module docstring:
    // "LIVE on EVERY completed analysis"); components/shared/aimusic_shared
    // /verdicts/scoring.py (compute_priority_score / severity_from_score
    // recompute the score from a fixed formula).
    id: 'rules-first',
    title: 'Rules first, model second',
    body: "A deterministic, genre-relative rule engine runs on every analysis. AI specialist verdicts are schema-validated, and their priority score is recomputed by a fixed formula — a model's own severity claim is never taken at face value.",
  },
  {
    // components/worker/app/llm/budget.py (_tier_ceiling / _global_ceiling,
    // per-tier + operator-global, None-checked so 0 can hard-stop a tier);
    // infra/compose.prod.yml (LLM_BUDGET_GLOBAL_USD / LLM_BUDGET_PRO_USD);
    // src/features/results/LlmDegradationNotice.tsx (copyFor()).
    id: 'spend-capped-twice',
    title: 'AI spend is capped twice',
    body: 'A per-plan monthly ceiling and a separate operator-wide ceiling both have to clear before a specialist call runs. When either trips, the report falls back to rule-based findings only — and the UI says so.',
  },
  {
    // components/worker/app/tasks_dramatiq.py (analyze_audio_job docstring:
    // Phase A mark PROCESSING + commit; Phase B run pipeline, no session
    // open; Phase C persist + commit).
    id: 'no-held-transaction',
    title: 'Long jobs never hold a transaction',
    body: 'Analysis runs in three phases: claim the job and commit, run the pipeline with no database session open, then write results in a fresh session. A phase that takes minutes never blocks anything else waiting on the database.',
  },
  {
    // src/features/listen/useAudioGraph.ts (per-unit dry/wet bypass comment
    // — a unit "off" is a parameter change, the master-bypass lane lives
    // outside the insert chain; the pitch tool is the one exception and is
    // called out separately under Known limits, not claimed here);
    // src/features/listen-rack/useFixOverlay.ts (baseline captured from the
    // live rack at first apply; unchecking restores it).
    id: 'fixes-auditioned',
    title: 'Fixes are auditioned, never imposed',
    body: "The EQ, compressor, saturation and width stage are always connected in the Listen rack — turning a fix on changes a parameter, not the signal path, so there's no gap when you A/B it against the dry mix. Un-applying a fix restores the rack exactly as you had it, never factory defaults.",
  },
  {
    // src/routes/__tests__/no-social-surface.test.ts (route-file allowlist +
    // banned-phrase scan); components/bff/tests/Spectr.Bff.Tests/
    // NoSocialSurfaceTests.cs (banned route-fragment scan).
    id: 'removed-stays-removed',
    title: 'Removed features stay removed',
    body: 'Two guard-test suites — one in the frontend, one in the BFF — fail the build if a route, phrase, or UI surface that was deliberately removed reappears.',
  },
  {
    // Addendum-approved 8th card (new since the plan was written).
    // components/bff/src/Spectr.Bff/Auth/GuestGuard.cs (default-deny filter:
    // an endpoint is closed to a guest unless explicitly marked);
    // components/bff/tests/Spectr.Bff.Tests/GuestGuardInventoryTests.cs
    // (frozen marker inventory — fails the build on an unreviewed change);
    // components/worker/app/llm/lane.py (guest calls resolve to their own
    // budget lane); components/bff/src/Spectr.Bff/Services/GuestLimits.cs
    // (every limit is a fail-closed check); components/bff/src/Spectr.Bff/
    // Services/RetentionSweepScheduler.cs (nightly pass purges guest rows
    // once their TTL — default 24h, GuestLimits.cs — has passed).
    id: 'guest-isolation',
    title: 'The one-click demo gives every visitor their own isolated account',
    body: 'A default-deny endpoint filter means a new API route is closed to demo visitors until someone opens it on purpose, and a frozen inventory test fails the build if that opened-route list changes without review. Demo AI usage draws from its own spend lane so it can never use up the budget real accounts depend on, every demo limit fails closed, and demo data is purged automatically once its retention window passes.',
  },
] as const;
