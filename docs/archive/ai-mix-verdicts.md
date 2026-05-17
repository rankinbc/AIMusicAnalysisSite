# AI Mix Verdicts

A structured-output pipeline that runs after a 7-phase analysis completes. Produces a ranked list of `Verdict` objects, each with severity, evidence, and an optional fix recommendation. Renders as verdict cards on the report page.

## Pipeline overview

1. **Rule engine** — deterministic rules over `analysis.json` produce `severity: rule_engine` verdicts (clipping, true peak, mono compatibility, loudness range, low-mid mud, dynamic range, stereo correlation, key confidence). No LLM cost.
2. **Triage** — Claude (CLI) reads the analysis + rule findings and returns a `SpecialistRoutingPlan` JSON object listing which specialists to run, in what order, with what focus.
3. **Specialists** — sequential execution (CLI cannot reliably run in parallel) of routed specialists. Each emits structured `Verdict` JSON.
4. **Validator** — rejects fabricated metric paths (`evidence[].metric` must resolve in `analysis.json`), out-of-range DSP params, mismatched section bounds; recomputes `priority_score` deterministically; downgrades severity if claimed > score band.
5. **Dedupe** — merges verdicts that share `(category, primary metric path)`. Sources are unioned.
6. **Ranker** — sorts by `priority_score` desc → severity desc → confidence desc → verdict_id asc.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `VERDICT_PIPELINE_ENABLED` | `true` | Master switch |
| `VERDICT_CLI_TIMEOUT_S` | `90` | Per-specialist timeout |
| `VERDICT_MAX_CONCURRENT_GENERATIONS` | `2` | Per-process semaphore |
| `USE_CLAUDE_CLI` | `true` (required for v1) | Anthropic API path is deferred |

## API endpoints

- `POST /api/reports/{job_id}/verdicts/generate` — kick off (or return cached payload)
- `GET /api/reports/{job_id}/verdicts/stream` — SSE per-event streaming
- `GET /api/reports/{job_id}/verdicts` — final ranked list
- `POST /api/verdicts/{verdict_id}/dismiss` — user dismissal
- `POST /api/verdicts/{verdict_id}/feedback` — `helpful` | `wrong` | `unclear`
- `GET /api/reports/share/{token}` — public share now includes `verdicts` field

## Schema

Source of truth: `components/shared/aimusic_shared/verdicts/models.py`. TypeScript types are hand-mirrored to `components/frontend/src/types/verdicts.ts` — keep in sync when categories or fields change. (The `npm run gen-types` script and `pydantic-to-typescript` tooling are checked in but currently fail under WSL/Windows path translation; rely on hand-mirroring for now.)

## Cache key

`(analysis_hash + comma-separated <slug>@<version> for every prompt + model)`. Bumping a prompt version invalidates cache for that specialist; bumping the model invalidates all.

## Out of scope (future PRPs)

- DSP A/B audio rendering (Pedalboard)
- Tier gating (Free/Pro/Studio)
- Anthropic API transport with prompt caching + parallel execution
- Feedback analytics dashboard / RLHF export
- Cross-track verdict comparison
