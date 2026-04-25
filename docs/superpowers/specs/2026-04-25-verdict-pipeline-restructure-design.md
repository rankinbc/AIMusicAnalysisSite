# Verdict Pipeline Restructure — Design Spec

**Date:** 2026-04-25
**Author:** brankin92 (with Claude as scribe)
**Scope:** Replace the prose-based "AI Mix Experts" panel with a structured-output verdict pipeline. Single PRP covering Phases 1–3 of the source spec (schema + plumbing, single-specialist E2E, full specialist set + streaming + validation). DSP A/B rendering, tier gating, and feedback-loop analytics are explicitly **out of scope** and deferred.

## 0. Source Documents

- The product spec pasted into the brainstorm (the "LLM Verdict Pipeline (Web Product Spec)" — referred to below as **the spec**). Source of truth for verdict schema, severity model, evidence rules, and the 6-phase rollout.
- `CLAUDE.md` — project rules, structure, gotchas.
- `docs/ai-mix-experts.md` — the existing prose pipeline being replaced.
- `HANDOFF.md` — current operational state of the running app.

## 1. What This Restructure Is And Isn't

**Is:** Replacing the prose specialist output with a structured `Verdict` schema, adding a deterministic rule engine that runs before the LLM, adding a validator + dedupe + ranker stage, and rebuilding the frontend report panel as verdict cards instead of streaming markdown.

**Isn't:**
- Touching the 7-phase deterministic analyzer (`components/analysis`). It produces `analysis.json` exactly as today.
- Touching auth, uploads, the Celery worker for analysis, history, sharing, ALS analysis, the genre profiles router, or the deterministic sections of the report page (frequency chart, stems table, score, etc.).
- Building DSP/Pedalboard audio rendering or the A/B player. (Spec Section 7 + Section 9.2 — deferred.)
- Building tier gating (Free/Pro/Studio). (Spec Section 4 — deferred.)
- Building the feedback analytics dashboard or RLHF data pipeline. (Spec Section 13 Phase 5 — deferred. The DB columns to capture feedback are added now; the dashboard is a follow-up.)
- Migrating the LLM transport away from the `claude` CLI to the Anthropic API. (Deferred — see Decision 6 below.)

## 2. Locked Decisions From The Brainstorm

1. **Scope = Spec Phases 1–3** (full LLM pipeline, no DSP renderer, no tier gating, no feedback analytics).
2. **Hard cutover** for the existing experts panel — `features/experts/`, `expert_service.py`, and `routers/experts.py` are deleted as part of this PRP. No feature flag, no parallel mode.
3. **Rules emit, specialists augment.** The rule engine and specialists may both produce verdicts in any category; the dedupe stage merges overlapping verdicts and unions their `sources[]`.
4. **Verdict storage = hybrid.** Immutable verdict payloads as JSONB on `analysis_results.verdicts_payload` (cache key: `analysis_hash + prompt_version_set + model`). User state in a separate `verdict_user_state` table. Public share endpoint serves payload only; authenticated user gets state overlay.
5. **Streaming = per-specialist SSE.** One `event: verdict` per completed Verdict. Skeletons are replaced atomically as cards arrive. No partial-JSON parsing on the frontend.
6. **Claude CLI only for v1.** `LLMClient` ABC + `CliClient` impl. Specialists run **sequentially** (CLI cannot reliably parallel). No prompt caching. JSON is parsed from raw text output and validated; one retry on bad JSON. `ApiClient` is a stub for follow-up work.

## 3. End-to-End Pipeline

```
[components/analysis 7-phase pipeline]   ← unchanged
            │
            ▼
       analysis.json
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  verdict_pipeline (new — components/api/app/verdict_pipeline)   │
│                                                                 │
│   1. rule_engine.evaluate(analysis_json)                        │
│        → list[Verdict]   sources=["rule_engine"]                │
│        SSE: event: rule-verdict                                 │
│                                                                 │
│   2. triage.route(analysis_json, rule_verdicts)                 │
│        → SpecialistRoutingPlan                                  │
│        SSE: event: routing-plan                                 │
│                                                                 │
│   3. specialists.run_sequential(plan, analysis_json)            │
│        → list[Verdict]   sources=[<specialist_name>]            │
│        SSE: event: verdict   (one per completed specialist)     │
│        (sequential; CLI cannot reliably run in parallel)        │
│                                                                 │
│   4. validator.validate_each(rule + specialist verdicts)        │
│        → list[Verdict]                                          │
│        Rejects verdicts with: invalid schema, fabricated        │
│        metric paths, out-of-range DSP params, severity-band     │
│        mismatch (downgrades to score-band).                     │
│                                                                 │
│   5. dedupe.merge(validated)                                    │
│        Overlapping verdicts (same category + same primary       │
│        evidence metric) merge into one with sources[] union.    │
│                                                                 │
│   6. ranker.sort_by_priority(merged)                            │
│        priority_score = base × category_weight × scope_weight   │
│        Computed in Python — never trusted from LLM.             │
│        SSE: event: complete   data: {verdict_count, …}          │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
   Persist: analysis_results.verdicts_payload (JSONB, immutable)
   Cache key: sha256(analysis_json_canonical + prompt_version_set + model)
```

**Latency expectation under CLI mode:** rule verdicts in <1s; routing plan in 5–15s; first specialist verdict in 15–45s after that; full set in 2–5 min depending on specialist count. The spec's "~30s for full set" target is API-mode only and not in scope here.

## 4. Component Boundaries

Each unit has one purpose and a small interface. Each is independently testable.

| Module | Purpose | Knows about | Doesn't know about |
|---|---|---|---|
| `verdict_pipeline.rule_engine` | Run deterministic rules over analysis_json, emit verdicts | Verdict schema, analysis_json shape | LLMs, HTTP, DB |
| `verdict_pipeline.triage` | Call LLM with Triage prompt, parse routing plan | LLMClient, RoutingPlan schema, prompt loader | DB, SSE |
| `verdict_pipeline.specialists` | Call LLM per routed specialist, parse verdicts, yield as completed | LLMClient, Verdict schema, prompt loader | DB, ranking |
| `verdict_pipeline.validator` | Schema + metric-path + range + severity checks | Verdict schema, analysis_json (for path resolution) | LLMs, ordering |
| `verdict_pipeline.dedupe` | Merge overlapping verdicts | Verdict schema | LLMs, DB |
| `verdict_pipeline.ranker` | Compute `priority_score` (Python, deterministic) and sort | Verdict schema, priority formula | LLMs, DB |
| `verdict_pipeline.orchestrator` | Run all stages in order, emit SSE events | Every stage, the SSE channel | Specifics of each stage's logic |
| `llm.client` | `LLMClient` ABC + `CliClient` impl (subprocess wrapper) | `claude` CLI invocation, retry/timeout | Verdict pipeline stages |
| `routers/verdicts` | HTTP layer: kick off generation, stream, fetch, feedback | Orchestrator, DB, SSE plumbing | Verdict internals |
| `frontend/features/verdicts` | Render verdict cards, manage SSE, show skeletons | Verdict TS types (generated from Pydantic), SSE event names | Pipeline internals, persistence |

## 5. Verdict & Fix Schema

Implemented as Pydantic v2 models in `components/shared/aimusic_shared/verdicts/`. Both `api` and `worker` import from here (single source of truth).

```python
# components/shared/aimusic_shared/verdicts/models.py

Severity = Literal["critical", "severe", "moderate", "minor", "win"]
Category = Literal[
    "low_end", "frequency_balance", "dynamics", "stereo_phase", "loudness",
    "sections", "trance_arrangement", "stem_reference", "harmonic", "clarity",
    "spatial", "surround", "playback", "overall", "gain_staging",
    "stereo_field", "frequency_collision", "humanization", "section_contrast",
    "density", "chord_harmony", "device_chain", "priority_summary",
    "clipping", "mono_compatibility",  # rule-engine categories
]

class Evidence(BaseModel):
    metric: str               # dotted path into analysis.json, validated to exist
    value: float | None = None
    expected_range: tuple[float, float] | None = None
    delta_pct: float | None = None
    label: str                # human-readable, shown on chip
    frequency_range_hz: tuple[float, float] | None = None
    stems: list[str] | None = None

class DspOp(BaseModel):
    type: Literal[
        "peaking_eq", "low_shelf", "high_shelf", "high_pass", "low_pass",
        "compressor", "multiband_compressor", "limiter", "gain",
        "stereo_width", "sidechain"
    ]
    params: dict[str, Any]
    # validators per-type: gain ∈ [-24,24], freq ∈ [20,22000],
    # q ∈ [0.1,18], ratio ∈ [1,20], threshold_db ∈ [-60,0],
    # attack_ms ∈ [0.1, 1000], release_ms ∈ [1, 5000],
    # ceiling_db ∈ [-6, 0], width_pct ∈ [0, 200]

class Fix(BaseModel):
    fix_id: str               # ulid: "fix_01HX..."
    target: dict              # {"type": "stem"|"master"|"bus", "name": str}
    section: dict | None      # {"start_seconds", "end_seconds", "section_type"}
    dsp_chain: list[DspOp]
    sidechain: dict | None
    expected_outcome: str
    ableton_hint: dict | None # {"device", "band", "preset_name"}

class UserState(BaseModel):
    dismissed: bool = False
    applied: bool = False
    user_modified_fix: dict | None = None
    feedback: Literal["helpful", "wrong", "unclear"] | None = None

class Verdict(BaseModel):
    verdict_id: str           # ulid: "vrd_01HX..."
    track_id: str
    specialist: str           # "rule_engine" | "low_end" | "loudness" | ...
    prompt_version: str       # "low_end@2.1.0" — frozen at generation time
    model: str                # "claude-sonnet-4-6" | "claude-cli"
    severity: Severity
    category: Category
    confidence: float = Field(ge=0.0, le=1.0)
    priority_score: int       # computed in Python; LLM proposals are ignored
    headline: str
    summary: str
    evidence: list[Evidence]
    fix: Fix | None
    why_it_matters: str
    related_verdict_ids: list[str] = []
    sources: list[str]        # set of producing specialists/rules after dedupe
    user_state: UserState = UserState()
    created_at: datetime

class SpecialistRoutingPlan(BaseModel):
    specialists_to_run: list[dict]  # [{"name", "priority", "focus"}]
    skip: list[str]
    rationale: str
    estimated_total_tokens: int
```

ID generation: ULIDs via `python-ulid`. Prefixes: `vrd_` for Verdict, `fix_` for Fix.

TypeScript types are generated from these Pydantic models via `datamodel-code-generator` → `components/frontend/src/types/verdicts.ts` as part of the validation gate.

## 6. Priority Score Formula

Computed in Python at the **end of the validator stage** (before dedupe). Deterministic.

```
priority_score = round(base_severity_weight × category_weight × scope_multiplier)
```

| Term | Values |
|---|---|
| `base_severity_weight` | critical=200, severe=120, moderate=70, minor=30, win=20 |
| `category_weight` | clipping=1.5, loudness=1.4, mono_compatibility=1.4, low_end=1.3, frequency_balance=1.2, others=1.0 |
| `scope_multiplier` | full-track=1.0, multi-section=0.9, single-section=0.7, single-stem=0.6 |

Severity-to-band cross-check: if a verdict claims `severity="critical"` but the computed `priority_score < 200`, the validator downgrades severity to whichever band the score lands in. The reverse (low severity, high score) is left alone — under-claiming is acceptable, over-claiming is not.

## 7. Rule Engine — v1 Rule Set

Each rule is a function `(analysis_json: dict) -> Verdict | None` registered in a list. Order doesn't matter (rules don't depend on each other). v1 ships with these rules; the registration pattern makes adding more trivial.

| Rule | Trigger | Severity | Category |
|---|---|---|---|
| `clipping_detected` | `phase1.clipping_detected == true` | critical | clipping |
| `true_peak_over_minus_1` | `phase1.true_peak_db > -1.0` | severe | loudness |
| `mono_incompatible` | `phase1.mono_compatibility < 0.7` | severe | mono_compatibility |
| `loudness_too_high_for_streaming` | `phase1.integrated_lufs > -8` | moderate | loudness |
| `loudness_too_low_for_streaming` | `phase1.integrated_lufs < -20` | moderate | loudness |
| `low_mid_mud_trance` | `phase3.low_mid_energy > 0.20` AND `genre == "trance"` | moderate | low_end |
| `low_mid_mud_generic` | `phase3.low_mid_energy > 0.25` (any genre) | moderate | low_end |
| `excessive_dynamic_range` | `phase1.crest_factor > 22 dB` | minor | dynamics |
| `tiny_dynamic_range` | `phase1.crest_factor < 4 dB` | severe | dynamics |
| `stereo_correlation_negative` | `phase2.stereo_correlation < -0.1` | severe | stereo_phase |
| `key_detection_low_confidence` | `phase1.key_detection_confidence < 0.5` | minor | harmonic |

Each rule populates `evidence[]` with the actual measured values from `analysis.json` and a templated `headline`/`summary`/`why_it_matters`. No LLM call. Cost = ~0. Latency = single-digit milliseconds for the entire rule set.

## 8. Triage — Structured Output

The `Triage.md` prompt (already in `components/api/prompts/experts/Triage.md`) gets a "Required Output" section appended:

```
## Required Output

Respond ONLY with JSON matching this schema. No prose, no code fences.

{
  "specialists_to_run": [
    { "name": "<specialist_name>", "priority": <int 1-10>, "focus": "<short focus>" }
  ],
  "skip": ["<specialist_name>", ...],
  "rationale": "<one sentence>",
  "estimated_total_tokens": <int>
}

Valid `name` values: low_end, frequency_balance, dynamics, stereo_phase,
loudness, sections, trance_arrangement, stem_reference, harmonic, clarity,
spatial, surround, playback, overall, gain_staging, stereo_field,
frequency_collision, humanization, section_contrast, density, chord_harmony,
device_chain, priority_summary.
```

The triage call receives `analysis.json + rule_verdicts` so it can route around already-flagged categories or escalate them. Triage's `priority` value drives **execution order** in CLI mode (Decision 6), not parallel batching.

## 9. Specialist Prompt Modifications

All 24 prompts in `components/api/prompts/experts/*.md` get the same "Required Output" footer appended:

```
## Required Output

Respond ONLY with JSON matching this schema. No prose, no code fences.

{
  "specialist": "<this specialist's slug, e.g. low_end>",
  "verdicts": [
    {
      "severity": "critical" | "severe" | "moderate" | "minor" | "win",
      "category": "<one of the documented categories>",
      "confidence": <float 0-1>,
      "headline": "<≤80 chars>",
      "summary": "<≤300 chars>",
      "evidence": [
        {
          "metric": "<dotted path in analysis.json — must exist>",
          "value": <number or null>,
          "expected_range": [<lo>, <hi>] or null,
          "label": "<human-readable, ≤60 chars>",
          "frequency_range_hz": [<lo>, <hi>] or null,
          "stems": [<stem names>] or null
        }
      ],
      "fix": {
        "target": { "type": "stem"|"master"|"bus", "name": "<name>" },
        "section": { "start_seconds": <num>, "end_seconds": <num>,
                     "section_type": "<intro|build|drop|breakdown|outro|null>" } or null,
        "dsp_chain": [
          { "type": "<one of the allowed DSP types>",
            "params": { ... } }
        ],
        "sidechain": { "source_stem": "<stem>", "depth_db": <num>,
                       "release_ms": <num> } or null,
        "expected_outcome": "<one sentence>",
        "ableton_hint": { "device": "<name>", "band": <int>,
                          "preset_name": "<name>" } or null
      } or null,
      "why_it_matters": "<≤200 chars>"
    }
  ]
}

Reference exact metric values from the analysis JSON in `evidence[]`.
Never invent metric paths or values. Allowed DSP types and their params:
peaking_eq{frequency_hz, gain_db, q}, low_shelf{frequency_hz, gain_db},
high_shelf{frequency_hz, gain_db}, high_pass{frequency_hz, slope_db},
low_pass{frequency_hz, slope_db},
compressor{threshold_db, ratio, attack_ms, release_ms, knee_db},
multiband_compressor{bands: [...]},
limiter{ceiling_db, release_ms}, gain{gain_db},
stereo_width{width_pct},
sidechain{source_stem, depth_db, release_ms}.
Param ranges: gain_db ∈ [-24, 24], frequency_hz ∈ [20, 22000],
q ∈ [0.1, 18], ratio ∈ [1, 20], threshold_db ∈ [-60, 0].
```

`prompt_version` is read from a leading frontmatter block on each `.md` file (e.g. `version: 2.1.0`). Bumping a specialist prompt = bumping its version = invalidating cache for that specialist. Initial version: `1.0.0` for all specialists.

## 10. Validator

Per-verdict pipeline:

1. **Pydantic parse** — rejects malformed.
2. **Metric-path resolution** — each `evidence[].metric` is resolved against the actual `analysis.json` via a dotted-path resolver. If the path doesn't resolve OR resolves to a value materially different from `evidence[].value` (>10% delta on numeric, ≠ on categorical), the whole verdict is rejected.
3. **DSP-param ranges** — the per-DSP-type validators on `DspOp` enforce the ranges in Section 9. Out-of-range = reject the verdict (not just the op).
4. **Section sanity** — `fix.section.end_seconds <= analysis.json.phase1.duration_seconds` and `start < end`. Bad section = reject verdict.
5. **Severity ↔ priority-score band** — recompute `priority_score` in Python (Section 6). If LLM-claimed severity exceeds the score band, downgrade severity. (Score is overwritten unconditionally — Python wins.)

Failed verdicts are written to `verdict_validation_failures(specialist, prompt_version, reason, raw_output_excerpt, created_at)` for prompt-regression tracking. They are **never** shown to the user.

If the LLM returns invalid JSON entirely, retry once with a stricter prompt suffix (`"Your previous response was not valid JSON. Respond with ONLY the JSON object."`). Second failure → log, skip this specialist, emit `event: error` for that specialist over SSE, continue pipeline.

## 11. Dedupe

After validation, walk all verdicts and merge overlaps. Two verdicts merge if they share **both** `category` AND a primary evidence metric path (the first metric in `evidence[]`).

Merge rules:
- Take the higher `severity` and `priority_score`.
- Take the higher `confidence`.
- Take the longer `headline` and `summary` (proxy for richer detail) — or the rule-engine version if one source is the rule engine, since rule headlines are templated and stable.
- Union `evidence[]` (dedupe by `metric` path).
- Take the rule-engine `fix` if present, else the highest-confidence specialist's fix.
- Union `sources[]`.
- Union `related_verdict_ids[]`.

Rule-engine verdicts always merge into specialist verdicts (not the reverse) — meaning the merged verdict carries the rule engine's authoritative metric reference plus the specialist's interpretive richness.

## 12. Ranker

Pure function: `(list[Verdict]) → list[Verdict]` sorted by `priority_score` desc, then `severity` desc, then `confidence` desc, then `verdict_id` asc (stable sort tiebreaker).

The summary card at the top of the report (the spec's Section 9.6) is built from the top 3 verdicts in this ordering — no separate LLM call for v1 (the spec's "OverallScore synthesis" specialist runs as one of the 24 and produces its own verdicts which enter the same ranking).

## 13. LLM Client (CLI)

`components/api/app/llm/client.py`:

```python
class LLMClient(Protocol):
    async def call(self, system: str, user: str, *, max_tokens: int = 4096,
                   timeout_s: int = 90) -> str: ...

class CliClient:
    """Wraps `claude` CLI via subprocess.

    - Writes system + user to a tempfile, invokes `claude --print --output-format text`.
    - Reads stdout, returns raw text.
    - Timeout enforced via asyncio.wait_for; on timeout, kills the subprocess.
    - Retry policy lives in caller (validator), not here.
    - Concurrency: a single asyncio.Semaphore(1) ensures only one CLI call at a time
      per process — CLI is not concurrency-safe for our use case.
    """
```

`ApiClient` is a stub that raises `NotImplementedError`. Adding it later is additive; no caller changes.

## 14. API Endpoints

All scoped to authenticated user via existing JWT middleware unless noted.

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/api/reports/{job_id}/verdicts/generate` | Idempotent: if `verdicts_payload` exists for current `(analysis_hash, prompt_version_set)`, return 200 with cached payload. Else, kick off pipeline in BackgroundTasks, return 202 with `generation_id`. |
| `GET` | `/api/reports/{job_id}/verdicts/stream` | SSE. Auth via `?token=` query param (existing pattern, see HANDOFF). Events: `event: rule-verdict`, `event: routing-plan`, `event: verdict`, `event: error`, `event: complete`. Closes after `complete` or on error. |
| `GET` | `/api/reports/{job_id}/verdicts` | Returns full ranked list from `verdicts_payload`. 404 if not yet generated. |
| `POST` | `/api/verdicts/{verdict_id}/dismiss` | Upsert into `verdict_user_state` with `dismissed=true`. |
| `POST` | `/api/verdicts/{verdict_id}/feedback` | Body: `{"feedback": "helpful"\|"wrong"\|"unclear"}`. Upsert into `verdict_user_state`. |
| `GET` | `/api/reports/share/{token}` | Existing endpoint, extended to include `verdicts_payload` field (no `user_state`). Anonymous. |

The pipeline runs in the **API process** via `BackgroundTasks`, not the Celery worker. Justification: it's LLM-bound (no GPU, no heavy compute), the user is on the page waiting, and the worker queue is reserved for analysis runs. A semaphore limits concurrent generations per process to avoid CLI thrash.

## 15. Database Migrations

Two migrations in this PRP:

**Migration `00X_verdicts_payload`:**
```sql
ALTER TABLE analysis_results
  ADD COLUMN verdicts_payload JSONB,
  ADD COLUMN verdicts_generated_at TIMESTAMP,
  ADD COLUMN verdicts_prompt_version_set TEXT,  -- e.g. "triage@1.0.0,low_end@1.0.0,..."
  ADD COLUMN verdicts_model TEXT;               -- "claude-cli" for v1

CREATE INDEX idx_analysis_results_verdicts_generated
  ON analysis_results(verdicts_generated_at)
  WHERE verdicts_payload IS NOT NULL;

CREATE TABLE verdict_validation_failures (
  id BIGSERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES upload_jobs(id) ON DELETE CASCADE,
  specialist TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  reason TEXT NOT NULL,
  raw_output_excerpt TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_verdict_failures_specialist
  ON verdict_validation_failures(specialist, created_at DESC);
```

**Migration `00X+1_verdict_user_state`:**
```sql
CREATE TABLE verdict_user_state (
  verdict_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES upload_jobs(id) ON DELETE CASCADE,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  user_modified_fix JSONB,
  feedback TEXT CHECK (feedback IN ('helpful', 'wrong', 'unclear')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (verdict_id, user_id)
);

CREATE INDEX idx_verdict_user_state_user_job ON verdict_user_state(user_id, job_id);
```

`verdict_id` is **not** a foreign key — verdict payloads live in JSONB, not a relational table. The pair `(verdict_id, user_id)` is the primary key; orphaned state rows (verdicts regenerated with new IDs) are cleaned up by a periodic job (out of scope; v1 just leaves them).

## 16. Frontend Restructure

**Delete:**
- `components/frontend/src/features/experts/` (whole directory: `useExpertAnalysis.ts`, `ExpertsPanel.tsx`, `TriageView.tsx`, `SpecialistCard.tsx`, `ExpertOutput.tsx`)
- The "AI Mix Experts" panel mount on `ReportPage.tsx`

**Add:**
```
components/frontend/src/features/verdicts/
  useVerdictStream.ts       # SSE hook, returns { ruleVerdicts, routingPlan,
                            #   specialistVerdicts, status, error }
  VerdictsPanel.tsx         # Top-level container — replaces <ExpertsPanel/>
  SummaryCard.tsx           # Top-of-page summary (top-3 verdicts)
  VerdictList.tsx           # Filter chips + ordered list of cards
  VerdictCard.tsx           # Single card — severity badge, headline, summary,
                            #   evidence chips, fix bullets, dismiss + feedback
  EvidenceChips.tsx         # Renders evidence[] as compact chips with hover tooltip
  FixSummary.tsx            # Human-readable rendering of dsp_chain
                            #   ("Cut 4dB at 250Hz, Q=1.2; sidechain bass→kick…")
  SeverityBadge.tsx         # Color-coded severity badge (critical → win)
  VerdictSkeleton.tsx       # Shimmer placeholder while specialist still running
  feedbackClient.ts         # POST dismiss / feedback endpoints
```

**Severity color palette** (matches spec Section 9.4, added to Tailwind safelist):
- critical: `border-red-600 bg-red-50` + pulse
- severe: `border-orange-600 bg-orange-50`
- moderate: `border-yellow-600 bg-yellow-50`
- minor: `border-blue-600 bg-blue-50`
- win: `border-green-600 bg-green-50`

**TypeScript types** are auto-generated from Pydantic via `datamodel-code-generator`, written to `components/frontend/src/types/verdicts.ts`. Generation runs as part of `npm run type-check` (validation gate).

**Do NOT in v1:** A/B audio player, "Apply fix" OSC integration, "Tweak" pre-filled EQ UI, "Re-render". The card shows the fix as text only with a `[Copy settings]` button that copies the dsp_chain as a human-readable bullet list.

**Affected pages:**
- `pages/ReportPage.tsx` — swap `<ExpertsPanel/>` for `<VerdictsPanel/>` and add `<SummaryCard/>` above the existing report sections.
- `pages/SharedReportPage.tsx` — same swap. `useVerdictStream` falls back to `GET /verdicts` (no SSE) for the public share view.

## 17. Configuration

New env vars (all in `components/api/.env`):

| Var | Default | Purpose |
|---|---|---|
| `VERDICT_PIPELINE_ENABLED` | `true` | Master switch (kept for ops, not user-facing) |
| `VERDICT_CLI_TIMEOUT_S` | `90` | Per-specialist subprocess timeout |
| `VERDICT_MAX_CONCURRENT_GENERATIONS` | `2` | Per-process semaphore on `/verdicts/generate` |
| `VERDICT_PROMPT_DIR` | `prompts/experts` | Where to load `.md` files from |

Existing env vars unchanged. `USE_CLAUDE_CLI` is read by `CliClient` and asserted `=true` at startup; if `false`, the API logs and disables verdict generation (returns 503 from the generate endpoint with a clear message).

## 18. Testing Strategy

Per CLAUDE.md "Validation gates" + the spec Section 14.

### Schema tests — `components/shared/tests/test_verdict_schema.py`
- Pydantic validators reject DSP gain > 24 dB, frequency > 22000 Hz, q < 0.1, etc.
- Unknown DSP types rejected.
- Severity literal accepts only the five values.
- ULID format on `verdict_id`/`fix_id`.

### Unit tests — `components/api/tests/verdict_pipeline/`

Per-stage:
- `test_rule_engine.py` — every rule in Section 7 with at least one trigger case + one no-trigger case + one boundary case.
- `test_validator.py` — fabricated metric path rejected; out-of-range DSP rejected; severity downgrade applied; LLM-supplied `priority_score` overwritten.
- `test_dedupe.py` — overlapping verdicts merge; non-overlapping don't; sources unioned; rule-engine evidence preserved on merge.
- `test_ranker.py` — sort order on mixed severity/score/confidence.

### Pipeline integration — `components/api/tests/verdict_pipeline/test_orchestrator.py`
- Fixture `analysis.json` files in `tests/fixtures/analyses/` (3–5 representative tracks: clean trance, muddy hip-hop, clipped pop, mono-broken indie, dynamic-range-tiny EDM master).
- LLMClient is mocked — `MockLLMClient` reads canned responses from `tests/fixtures/llm_responses/<specialist>.json`.
- Assert: rule verdicts emitted first, routing plan second, specialist verdicts third, all valid against schema, ranked, persisted to JSONB.
- Property-based assertions (use `hypothesis` for verdict-shape invariants).

### Live-LLM smoke — `components/api/tests/verdict_pipeline/test_cli_client_live.py`
- Marked `@pytest.mark.live_llm` (skipped by default).
- Runs the real `claude` CLI on one fixture analysis, asserts at least one valid Verdict comes back. Catches CLI version drift.

### Frontend tests — `components/frontend/src/features/verdicts/__tests__/`
- `VerdictCard.test.tsx` — renders all five severities with correct colors, evidence chips, dismiss button.
- `useVerdictStream.test.ts` — handles all SSE event types in order; cleanup on unmount.
- `VerdictsPanel.test.tsx` — skeleton-to-card transition.

### Validation gates (added to CLAUDE.md)
```bash
ruff check components/api/app/verdict_pipeline/ components/api/app/llm/
mypy components/api/app/verdict_pipeline/ components/api/app/llm/ --ignore-missing-imports
pytest -q components/shared/tests/test_verdict_schema.py
pytest -q components/api/tests/verdict_pipeline/
cd components/frontend && npm run type-check && npm run test
```

## 19. Cutover Checklist

These happen in the same PRP, ordered as plan tasks:

1. Add Verdict/Fix Pydantic models to `components/shared`. Generate TS types.
2. Migrations applied (`alembic upgrade head`).
3. `LLMClient` ABC + `CliClient` impl + tests.
4. Rule engine + tests.
5. Triage prompt + structured-output append + parser + tests.
6. Specialist prompts: append structured-output footer to all 24 `.md` files. Bump versions to `1.0.0`.
7. Specialist runner (sequential) + tests.
8. Validator + dedupe + ranker + tests.
9. Orchestrator + SSE plumbing + tests.
10. `routers/verdicts.py` + integration tests.
11. Frontend: `features/verdicts/` built + tested.
12. Wire `VerdictsPanel` into `ReportPage` and `SharedReportPage`.
13. **Delete** `features/experts/`, `routers/experts.py`, `services/expert_service.py`, related frontend tests.
14. Update `docs/ai-mix-experts.md` → archive to `docs/archive/` and add `docs/ai-mix-verdicts.md` describing the new pipeline.
15. Update `CLAUDE.md` validation gates section.
16. Run full validation gate suite. Smoke test end-to-end on a real analysis.

## 20. Risks And Open Questions

**Risk: CLI JSON reliability.** The CLI doesn't have native structured output. Even with strict prompts, ~5–15% of responses may need the retry. The validator + retry loop is load-bearing. Mitigation: log every retry to `verdict_validation_failures` and review weekly during early use.

**Risk: Sequential latency.** Full specialist set in 2–5 min may feel slow. The SSE per-card stream means the user sees verdicts arriving steadily, not staring at a spinner. Acceptable for v1.

**Risk: Prompt drift between Triage routing and specialist categories.** Triage names a specialist; specialist's prompt may not fully cover the focus Triage gave. Mitigation: Triage's `focus` field is included in the per-specialist user message ("Focus on: <focus>") so the specialist is steered.

**Risk: Metric-path resolver false positives.** Specialists may legitimately reference computed/derived metrics not in the raw analysis.json. Mitigation: maintain an allow-list of "derived metric paths" (e.g., `derived.kick_bass_clash_severity`) computed by the rule engine and attached to the analysis_json before specialists run.

**Open: should rule-engine verdicts emit even if the user has dismissed them previously?** Yes — verdict generation is a fresh artifact; user dismissal is per-(verdict_id, user_id). New generation = new verdict_ids (fresh ULIDs). Old dismissals don't carry over. The cache key (`analysis_hash + prompt_version_set + model`) means same inputs → same payload, but state is independent.

**Open: how do we surface validation failures to the user?** v1 answer: silently. The `verdict_validation_failures` table is for ops, not the user. If the entire pipeline yields zero verdicts (catastrophic prompt failure), the UI shows "Verdict generation produced no results — please retry" with a regenerate button.

## 21. Out Of Scope (Explicit Deferral List)

Listed here so a future reader knows these were considered and deferred, not forgotten:

- Pedalboard/DSP audio rendering server-side
- A/B player UI with volume matching
- "Apply fix" via OSC to Ableton
- "Tweak" pre-filled EQ/compressor UI
- "Re-render" round-trip with user-modified DSP params
- Tier gating (Free/Pro/Studio)
- Anthropic API (paid) transport — stays as a CLIstub
- Prompt caching via the API
- Parallel specialist execution
- Token-level streaming with partial-JSON parsing
- Feedback analytics dashboard
- RLHF data export pipeline
- Cross-track / cross-version verdict comparison ("you fixed this in v2")
- Stem-isolated render mode
- Reference embeddings / cross-track style comparison via verdict pipeline
- A/B prompt-variant testing infrastructure

These all become individual follow-up PRPs after v1 of the verdict pipeline ships.

---

**End of design spec.** Next step: invoke `superpowers:writing-plans` to convert this into a concrete implementation plan.
