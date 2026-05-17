# PRP: v2 Slice 2.5 — Verdicts Panel (on-demand AI specialists)

**Status:** Draft
**Effort:** L (1–2 weeks, evenings)
**Phase:** v2 / Phase 2 / Slice 2.5
**Confidence (one-pass implementation):** 6/10

---

> **Why this slice?** Slice 2 turned the Results page into a real report. Slice 2.5 adds the killer feature: on-demand per-specialist AI analysis. The legacy v1 already has the prompts, scoring, validator, and a working `claude` CLI wrapper — we port them into a sync dramatiq actor, wire the 6 already-stubbed BFF endpoints, and slot a `VerdictsPanel` into the existing `ReportView` between the coach panel and the phase timeline. **No SSE, no Listen handoff, no "run all" bulk dispatch** — user clicks specialist tiles individually, frontend polls for results.

---

## Goal

After this PRP lands, the Results page renders a new "Verdicts" panel with 26 specialist tiles (grid). Each tile is clickable; clicking it dispatches a dramatiq message to the Python worker, which calls the `claude` CLI with the specialist's prompt + analysis context, parses the response into a `Verdict`, validates it, computes `priority_score`, and persists to the `verdicts` table. The frontend polls `/api/reports/{jobId}/verdicts/` every 3s while any tile is in `running` state. As verdicts complete, they render as `VerdictCard`s below the tile grid, sorted by `priority_score` descending. Users can dismiss / mark applied / send feedback on each verdict; those overlay onto subsequent reads.

## Success Criteria

- [ ] `POST /api/reports/{jobId}/verdicts/run/{specialist}` enqueues a dramatiq message `run_specialist(job_id, specialist_slug)` and returns `{ status: "queued" }`. 404 if the job doesn't exist or isn't owned by the caller. 409 if the specialist already has a verdict for this analysis (idempotency — caller must dismiss/delete first to re-run).
- [ ] `GET /api/reports/{jobId}/verdicts/` returns `{ verdicts: VerdictDto[], specialists: SpecialistStatus[] }` where `specialists` is a static list of 26 slugs each tagged with `status: 'idle' | 'running' | 'cached' | 'failed'`. `verdicts` includes the user_state overlay for the current user.
- [ ] `POST /api/verdicts/{verdictId}/dismiss` flips `verdict_user_state.dismissed = true` for the (verdict, current_user) pair (upsert). 204 NoContent.
- [ ] `POST /api/verdicts/{verdictId}/applied` flips `verdict_user_state.applied = true`. 204.
- [ ] `POST /api/verdicts/{verdictId}/feedback` accepts `{ feedback: "helpful" | "wrong" | "unclear" }` and persists. 204.
- [ ] Python worker dramatiq actor `run_specialist(job_id, specialist_slug)` does: load Analysis → flatten `final_json.phases[]` into `phase1/phase2/...` keys (legacy bug fix per project memory) → call `claude` CLI with specialist prompt → parse JSON response → hydrate + validate Verdict → compute priority_score → insert `Verdict` row.
- [ ] Failed specialist runs persist a `verdict_validation_failures`-style breadcrumb (or, simpler in v1: a `Verdict` row with `severity='minor'`, `headline='Specialist failed'`, `body=error_message` is fine for slice 2.5 — keeps the schema lean). Frontend renders the failed tile in `--sev-fail` color.
- [ ] Frontend `VerdictsPanel` slots into `ReportView` between `CoachPanel` and `PhaseTimeline` without modifying any other panel.
- [ ] Frontend `SpecialistTile` shows correct state (idle/running/cached/failed) based on the `/verdicts/` response. Click to run. While running, polling kicks in.
- [ ] Frontend `VerdictCard` renders severity badge, headline, summary, body (when present), metric line (when present), fix.steps as a numbered list, plus three buttons: Dismiss, Applied, Feedback. Dismissed verdicts visually faded; applied verdicts show a green check.
- [ ] Validation gates: `dotnet build`, `dotnet test`, `npm run type-check`, `npm run lint`, `npm run build`, `npm test` — all clean.
- [ ] Manual: click one specialist tile (e.g. `low_end`), wait 10–60 s, see a `VerdictCard` appear with real analysis content. Dismiss it; refresh; verdict stays dismissed (visually faded).

## All Needed Context

### Documentation & References

```yaml
- file: components/api/app/verdict_pipeline/prompt_loader.py
  why: SLUG_TO_FILENAME map (26 specialists), version-frontmatter parser. PORT verbatim into worker.

- file: components/api/app/verdict_pipeline/specialists.py
  why: run_one_specialist function — the async version. Slice 2.5 needs a SYNC variant for the dramatiq actor. Hydrate + retry logic is reusable as-is.

- file: components/api/app/verdict_pipeline/validator.py
  why: validate_verdict — checks evidence metric paths against analysis JSON, recomputes priority_score with the moderate-severity baseline trick (don't lose this — it's load-bearing per CLAUDE.md gotcha). Reuse as-is, port to worker module.

- file: components/api/app/verdict_pipeline/json_extraction.py
  why: extract_json_object — handles the LLM responding with code fences or trailing prose. Reuse.

- file: components/api/app/llm/client.py
  why: CliClient — async claude CLI wrapper. Slice 2.5 needs a SYNC variant for dramatiq.

- file: components/api/prompts/experts/
  why: 26 specialist prompt .md files. CRITICAL: the file location is hard-coded in prompt_loader.py as `parents[2] / "prompts" / "experts"` — i.e. relative to the verdict_pipeline package. When we copy to the worker, that path needs adjusting OR copy the prompts dir.

- file: components/shared/aimusic_shared/verdicts/models.py
  why: Verdict pydantic model. ALREADY MIRRORED in C# (Spectr.Data.Entities.Verdict) but the pydantic model is missing the v2 fields (impact, chart_type, preset_name, body, metric_line). Slice 2.5: populate the C# entity's new fields as null/derived. Don't extend the pydantic model.

- file: components/shared/aimusic_shared/verdicts/scoring.py
  why: compute_priority_score, severity_from_score. Reuse.

- file: components/shared/aimusic_shared/verdicts/ulid_helpers.py
  why: new_verdict_id, new_fix_id. Reuse for ID generation in the actor.

- file: components/bff/src/Spectr.Data/Entities/Verdict.cs
  why: Target schema. Note: `id: string` (ULID "vrd_..."), `analysis_id`, `specialist`, `prompt_version`, `model`, `severity`, `category`, `confidence`, `priority_score`, `impact`, `chart_type`, `headline`, `summary`, `body`, `metric_line`, `why_it_matters`, `preset_name`, `evidence` (jsonb), `fix` (jsonb), `sources` (jsonb), `created_at`.

- file: components/bff/src/Spectr.Data/Entities/VerdictUserState.cs
  why: Composite PK (verdict_id, user_id). Fields: dismissed, applied, user_modified_fix, feedback, timestamps.

- file: components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs
  why: 6 stubbed endpoints — slice 2.5 fills them in.

- file: components/worker/app/tasks_dramatiq.py
  why: Existing analyze_audio_job actor. Slice 2.5 adds a sibling run_specialist actor in this file (or a new file — see Desired tree).

- file: components/worker/app/db_sync.py
  why: SessionFactory. Reuse for the new actor.

- file: PRPs/archive/2026-05-17_v2-slice-1-auth-library.md
  why: Slice 1 reference — how the actor is structured, how the BFF dispatches via dramatiq.

- url: https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/cli-reference
  why: claude CLI flags. -p (prompt from stdin or arg), --system-prompt-file, --output-format text. Same flags the legacy CliClient uses.

- memory: project_verdict_pipeline_shape_bug.md
  why: KNOWN BUG. The worker writes final_json with `phases: [...]` list shape; the validator's metric paths use `phase1.lufs` style. Slice 2.5 fix: flatten the phases list into a dict before passing to validator.
```

### Specialist list (hardcoded — slice 2.5 doesn't ship triage routing)

The 26 specialists by slug (matches `SLUG_TO_FILENAME` in prompt_loader.py):
`low_end, frequency_balance, dynamics, stereo_phase, loudness, sections, trance_arrangement, stem_reference, harmonic, clarity, spatial, surround, playback, overall, gain_staging, stereo_field, frequency_collision, humanization, section_contrast, density, chord_harmony, device_chain, priority_summary, stem_balance, stem_stereo_width, stem_reference_delta`.

For slice 2.5, the **stem_*** specialists (3 of them) are visible but disabled because slice-1 uploads don't include stems. Show them in the grid greyed out. Same for `trance_arrangement` (genre-specific) — leave enabled; the prompt handles non-trance tracks gracefully.

### Current backend tree (relevant)

```
components/
├── bff/src/Spectr.Bff/
│   ├── Endpoints/VerdictEndpoints.cs   ← 6 stubs
│   └── DTOs/                            ← no verdict DTOs yet
├── worker/app/
│   ├── tasks_dramatiq.py                ← analyze_audio_job only
│   ├── dramatiq_app.py                  ← broker setup
│   └── db_sync.py                       ← sync session factory
├── api/                                  ← LEGACY (v1) — copy logic from
│   ├── app/verdict_pipeline/*.py        ← orchestrator, specialists, validator, etc.
│   ├── app/llm/client.py                ← CliClient (async)
│   └── prompts/experts/*.md             ← 26+ prompts
└── shared/aimusic_shared/verdicts/      ← models, scoring, ulid helpers (good as-is)
```

### Desired backend tree (delta)

```
components/
├── bff/src/Spectr.Bff/
│   ├── DTOs/
│   │   └── VerdictDtos.cs               ← NEW: VerdictDto, SpecialistStatus, RunSpecialistResponse, FeedbackRequest, SPECIALIST_SLUGS const
│   ├── Endpoints/VerdictEndpoints.cs    ← 6 stubs → real handlers
│   └── Services/DramatiqTasks.cs        ← + RunSpecialist constant
└── worker/
    ├── app/
    │   ├── verdict_actor.py             ← NEW: run_specialist dramatiq actor
    │   ├── verdict_lib/                 ← NEW package — local copy of v1 verdict_pipeline
    │   │   ├── __init__.py
    │   │   ├── prompt_loader.py         ← copied, PROMPTS_DIR adjusted
    │   │   ├── json_extraction.py       ← copied
    │   │   ├── validator.py             ← copied
    │   │   ├── llm_client_sync.py       ← NEW: sync version of CliClient (subprocess.run, no asyncio)
    │   │   └── flatten_analysis.py      ← NEW: phases[] list → phase1/phase2/... dict adapter
    │   ├── dramatiq_app.py              ← + import verdict_actor
    │   └── tasks_dramatiq.py            ← unchanged (analyze_audio_job stays)
    └── prompts/experts/*.md             ← NEW: copy from components/api/prompts/experts/
```

### Desired frontend tree (delta)

```
src/
├── features/results/
│   ├── ReportView.tsx                   ← + import VerdictsPanel + slot between CoachPanel and PhaseTimeline
│   ├── VerdictsPanel.tsx                ← NEW: orchestrates grid + cards + polling
│   ├── VerdictsPanel.module.css         ← NEW
│   ├── SpecialistTile.tsx               ← NEW: one tile (idle/running/cached/failed states)
│   ├── SpecialistTile.module.css        ← NEW
│   ├── VerdictCard.tsx                  ← NEW: one card (severity badge, content, action buttons)
│   ├── VerdictCard.module.css           ← NEW
│   ├── helpers/
│   │   ├── specialists.ts               ← NEW: SPECIALIST_CATALOG (slug → display name, category group)
│   │   └── severity.ts                  ← NEW: severityColor, severityLabel, severityIcon
│   └── __tests__/severity.test.ts       ← NEW
└── api/
    ├── types.ts                          ← + VerdictDto, VerdictUserState, SpecialistStatus, etc.
    └── hooks.ts                          ← + useVerdicts, useRunSpecialist, useDismissVerdict, useApplyVerdict, useFeedbackVerdict
```

### Known Gotchas

```text
# === Python worker / claude CLI ===

# CRITICAL: legacy CliClient is ASYNC (uses asyncio.to_thread + Semaphore).
# Dramatiq actors are SYNC. Don't wrap with asyncio.run() per call — instead
# write a sync variant llm_client_sync.py that uses subprocess.run directly.
# Concurrency-safe under dramatiq because each actor invocation gets its own
# worker process; no in-process semaphore needed.

# CRITICAL: PROMPTS_DIR in prompt_loader.py is `parents[2] / "prompts" / "experts"`
# (relative to verdict_pipeline package). When you copy to worker/app/verdict_lib/,
# the relative path no longer resolves. Fix: rewrite prompt_loader.py to use
# env var $VERDICT_PROMPTS_DIR with a default that resolves to
# components/worker/prompts/experts/. Copy the .md files into components/worker/prompts/experts/.

# CRITICAL: the validator's metric paths use "phase1.lufs", "phase4.clashes[0].severity"
# style. The pipeline writes final_json with `phases: [{phase: 1, name: "...", data: {...}}, ...]`
# — a LIST keyed by integer phase. flatten_analysis.py must produce
# {"phase1": <data dict>, "phase2": <data dict>, ...} so validator paths resolve.
# This is the bug in project_verdict_pipeline_shape_bug.md memory.

# CRITICAL: `claude` CLI exits non-zero when prompt content has shell-special chars.
# The legacy CliClient pipes user message via stdin (`-p` with no positional arg).
# Mirror this in llm_client_sync.py — DO NOT pass the user message as an argv arg
# even for short prompts; Windows arg limits AND escaping bite differently.

# CRITICAL: the Verdict pydantic model has `model_config = ConfigDict(extra="forbid")`.
# The hydrate step sets server-controlled fields (verdict_id, track_id, specialist,
# prompt_version, model, priority_score, sources, related_verdict_ids, user_state,
# created_at) and the LLM is responsible for the rest (severity, category, confidence,
# headline, summary, evidence, fix, why_it_matters). If the LLM emits extra keys,
# Pydantic raises ValidationError — caller logs and persists a fail-marker verdict.

# CRITICAL: the C# Verdict entity has columns the pydantic model doesn't:
# impact, chart_type, preset_name, body, metric_line. For slice 2.5, the actor
# populates these as:
#   body = summary (we don't have a richer body until prompts emit one)
#   metric_line = first evidence.label or None
#   impact, chart_type, preset_name = None
# The frontend renders body/metric_line/preset_name when present; null is fine.

# CRITICAL: the legacy hydrate step generates `verdict_id` starting with "vrd_"
# (per the pydantic validator). Keep that. The C# entity's id column is
# String(40); fits the ULID pattern.

# === BFF endpoints ===

# CRITICAL: VerdictEndpoints stubs already bind their path params for OpenAPI
# (Guid jobId, string verdictId, string specialist). Replace `NotImplementedResult.Stub()`
# with real handlers; don't change the route paths.

# CRITICAL: idempotency for run_specialist — the spec says 409 if a verdict
# already exists for (analysis_id, specialist). Use:
#   var exists = await db.Verdicts.AnyAsync(v => v.AnalysisId == aId && v.Specialist == slug);
# Slice 2.5 doesn't ship "re-run" — caller must dismiss first then run.
# Wait, dismiss leaves the verdict; "re-run" semantics aren't defined for slice 2.5.
# Decision: for slice 2.5, 409 means "specialist already has a verdict; UI shows
# the existing one." If user wants to retry, they can dismiss and we... still 409.
# Acceptable for slice 2.5 — re-run UX deferred to a later slice.

# CRITICAL: user_state overlay — the verdicts list query joins via LEFT JOIN
# to verdict_user_state on (verdict_id, current_user_id). EF Core fluent syntax:
#   var query = from v in db.Verdicts.AsNoTracking()
#               join us in db.VerdictUserStates.AsNoTracking()
#                   on new { vid = v.Id, uid = userId } equals new { vid = us.VerdictId, uid = us.UserId }
#                   into gj
#               from us in gj.DefaultIfEmpty()
#               where v.AnalysisId == aid
#               select new { v, us };
# OR write it as a denormalized projection. Either works.

# CRITICAL: enforce ownership at every endpoint — user_id check via either
# joining to analyses.user_id or verdicts.AnalysisId → Analysis → UserId.
# Simpler: include AnalysisId → Analysis.UserId comparison directly.

# === Frontend ===

# CRITICAL: useVerdicts hook polls with refetchInterval ONLY when at least one
# specialist is in `running` state. Otherwise the page would refetch every 3s
# forever. Implement: refetchInterval = data => data?.specialists.some(s => s.status === 'running') ? 3000 : false.

# CRITICAL: SpecialistTile click should optimistic-update the local list to
# `running` immediately (before the mutation resolves) so the user sees a state
# change. On mutation success/failure, refetch the verdicts list to settle.

# CRITICAL: VerdictsPanel must NOT modify ReportView's other panels. Only insert
# a new section between CoachPanel and PhaseTimeline. The orchestrator already
# has the slot in mind per slice-2 PRP's Self-review checklist.

# CRITICAL: For slice 2.5, NO SSE. Polling only. Don't import EventSource anywhere
# in this slice.

# === Schema ===

# CRITICAL: No schema migration in slice 2.5. The verdicts + verdict_user_state
# tables already exist from slice 1's Initial migration. Confirm before
# implementing.
```

## Implementation Blueprint

### DTOs (C#)

```csharp
namespace Spectr.Bff.DTOs;

public sealed record VerdictDto(
    string Id,
    Guid AnalysisId,
    string Specialist,
    string PromptVersion,
    string Model,
    string Severity,
    string Category,
    double Confidence,
    int PriorityScore,
    string? Impact,
    string? ChartType,
    string Headline,
    string? Summary,
    string? Body,
    string? MetricLine,
    string? WhyItMatters,
    string? PresetName,
    JsonElement Evidence,
    JsonElement? Fix,
    JsonElement Sources,
    DateTimeOffset CreatedAt,
    VerdictUserStateDto UserState);

public sealed record VerdictUserStateDto(
    bool Dismissed,
    bool Applied,
    string? Feedback);

public sealed record SpecialistStatus(string Slug, string Status); // "idle" | "running" | "cached" | "failed"

public sealed record VerdictsListResponse(
    IReadOnlyList<VerdictDto> Verdicts,
    IReadOnlyList<SpecialistStatus> Specialists);

public sealed record RunSpecialistResponse(string Status); // "queued" | "exists"

public sealed record FeedbackRequest(string Feedback); // "helpful" | "wrong" | "unclear"
```

`SPECIALIST_SLUGS` lives in `Spectr.Bff.Services.SpecialistCatalog` (a static class with a `Slugs` `IReadOnlyList<string>` field) — single source of truth on the C# side.

### Task list (in execution order)

```yaml
Task 1: BFF DTOs + specialist catalog.
  CREATE components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs (as above).
  CREATE components/bff/src/Spectr.Bff/Services/SpecialistCatalog.cs:
    - static class with Slugs IReadOnlyList<string> mirroring the 26 from prompt_loader.py.
  MODIFY components/bff/src/Spectr.Bff/Services/DramatiqTasks.cs:
    - add `public const string RunSpecialist = "run_specialist";`.

Task 2: BFF verdict endpoints — replace 6 stubs.
  MODIFY components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs:
    - GET /reports/{jobId}/verdicts/ → list with user_state overlay + computed
      specialist statuses (idle/cached/failed by joining db.Verdicts).
      "running" is NOT inferable from the DB — frontend tracks it locally
      between click and next poll. Backend reports `idle` for any specialist
      without a verdict.
    - POST /reports/{jobId}/verdicts/run/{specialist}:
      * Validate slug ∈ SpecialistCatalog.Slugs.
      * Look up Analysis by jobId, enforce UserId.
      * AnyAsync check: if a Verdict for (analysisId, specialist) exists → 409.
      * Enqueue dramatiq message: actor `run_specialist`, args [analysisId, slug, userId].
      * Return { status: "queued" }.
    - POST /verdicts/{verdictId}/dismiss → upsert verdict_user_state (Dismissed=true).
    - POST /verdicts/{verdictId}/applied → upsert (Applied=true).
    - POST /verdicts/{verdictId}/feedback → bind FeedbackRequest, validate enum,
      upsert (Feedback=req.Feedback).
    - Already-stubbed: /reports/{jobId}/verdicts/stream stays 501.

Task 3: Worker — copy prompts dir.
  Copy components/api/prompts/experts/*.md → components/worker/prompts/experts/.

Task 4: Worker verdict_lib package.
  CREATE components/worker/app/verdict_lib/__init__.py (empty).
  COPY components/api/app/verdict_pipeline/prompt_loader.py → components/worker/app/verdict_lib/prompt_loader.py:
    - REWRITE PROMPTS_DIR to use env var $VERDICT_PROMPTS_DIR with default
      `Path(__file__).resolve().parents[2] / "prompts" / "experts"`.
  COPY components/api/app/verdict_pipeline/json_extraction.py → components/worker/app/verdict_lib/json_extraction.py (unchanged).
  COPY components/api/app/verdict_pipeline/validator.py → components/worker/app/verdict_lib/validator.py (unchanged).
  CREATE components/worker/app/verdict_lib/llm_client_sync.py — sync version of CliClient using subprocess.run.
  CREATE components/worker/app/verdict_lib/flatten_analysis.py:
    def flatten(final_json: dict) -> dict:
        """Convert {phases: [{phase: 1, data: {...}}, ...]} → {phase1: {...}, phase2: {...}, ...}.
        Top-level keys (grade, coach_name, etc.) preserved."""
        out = {k: v for k, v in final_json.items() if k != "phases"}
        for p in final_json.get("phases", []) or []:
            n = p.get("phase")
            if n is not None:
                out[f"phase{n}"] = p.get("data") or {}
        return out

Task 5: Worker run_specialist actor.
  CREATE components/worker/app/verdict_actor.py:
    @dramatiq.actor(actor_name="run_specialist", queue_name="default", max_retries=1, time_limit=180_000)
    def run_specialist(analysis_id: str, slug: str, user_id: str):
        # 1. Load Analysis + flatten final_json
        # 2. Load prompt(slug)
        # 3. Call claude CLI (sync)
        # 4. Parse JSON, hydrate Verdict (re-use legacy hydrate_verdict logic, sync)
        # 5. Validate (re-use legacy validator)
        # 6. Map Verdict → DB row (aimusic_shared.models.Verdict)
        # 7. INSERT
        # On exception: persist a fail-marker Verdict row with severity='minor',
        #   headline='Specialist failed', body=str(error)[:2000], created_at=now.
    Wrap each phase in a separate `with SessionFactory.begin() as s` block —
    don't hold the session across the LLM call.
  MODIFY components/worker/app/dramatiq_app.py:
    - add `from . import verdict_actor`  (registers actor with broker).

Task 6: Migration confirmation (no actual changes).
  Verify verdicts + verdict_user_state tables exist from slice 1 migration.
  Verify Verdict entity's String(40) id column accepts "vrd_<ulid>" format.
  If not, fix entity (unlikely — slice 1 already designed this).

Task 7: Frontend types.
  MODIFY src/api/types.ts:
    - Add VerdictUserState, VerdictDto, SpecialistStatus, VerdictsListResponse,
      RunSpecialistResponse, FeedbackKind interfaces mirroring C# DTOs.

Task 8: Frontend hooks.
  MODIFY src/api/hooks.ts:
    - useVerdicts(jobId): polls /api/reports/{jobId}/verdicts/ every 3 s ONLY while a
      specialist is in 'running' state (locally tracked).
    - useRunSpecialist(jobId): mutation. Posts to /api/reports/{jobId}/verdicts/run/{slug}.
      On success: invalidate ['verdicts', jobId].
    - useDismissVerdict / useApplyVerdict / useFeedbackVerdict: mutations.
      Each invalidates ['verdicts', jobId].

Task 9: Frontend specialist catalog + severity helpers.
  CREATE src/features/results/helpers/specialists.ts:
    export const SPECIALIST_CATALOG: { slug: string; label: string; group: string; needsStems?: boolean }[] = [...]
    Map the 26 slugs to friendly labels and grouped categories
    (e.g. "Low End" / "Frequency Balance" → group: "Spectrum"; "Loudness" / "Dynamics" → "Loudness"; etc.)
    Mark stem_* with needsStems: true.
  CREATE src/features/results/helpers/severity.ts:
    export function severityColor(sev: string): string  // returns var(--sev-*)
    export function severityLabel(sev: string): string  // "CRITICAL" / "SEVERE" / etc.
    export const SEVERITY_RANK: Record<Severity, number>
  CREATE src/features/results/__tests__/severity.test.ts (vitest).

Task 10: Frontend SpecialistTile component.
  CREATE src/features/results/SpecialistTile.tsx + .module.css.
  Props: { slug, label, group, status, disabled, onRun }.
  Visuals:
    - panel-sized small tile (~140 px wide), label + group + status badge.
    - idle: outlined, hover → cyan border.
    - running: cyan glow border + spinning dot.
    - cached: green check icon + faint green border.
    - failed: red border + warning icon.
    - disabled (needsStems on stem-less upload): faded, cursor: not-allowed.

Task 11: Frontend VerdictCard component.
  CREATE src/features/results/VerdictCard.tsx + .module.css.
  Props: { verdict: VerdictDto, onDismiss, onApply, onFeedback }.
  Visuals:
    - Severity strip on left (4-px-wide color bar from severityColor).
    - Header: severity label + specialist + priority_score.
    - headline (16 px, bold).
    - summary (14 px, --text-2).
    - body (when present) as a small paragraph.
    - metric_line (when present) in mono.
    - fix.dsp_chain[] as a numbered list — each step shows "{op.type}: {key1=v1, key2=v2}".
    - Actions row: Dismiss, Applied (with checkmark if applied), Feedback dropdown (helpful/wrong/unclear).
    - Dismissed state: opacity 0.55, applied state: green badge.

Task 12: Frontend VerdictsPanel orchestrator.
  CREATE src/features/results/VerdictsPanel.tsx + .module.css.
  Props: { jobId: string, hasStems: boolean }.
    - Calls useVerdicts(jobId).
    - Tracks locally which slugs are in optimistic-running state (immediately on click).
    - Renders header "AI SPECIALISTS · {n}/26".
    - Grid of SpecialistTile (groups as section headings: Spectrum / Loudness / Dynamics / Stereo / Sections / Stems / Misc).
    - Below grid: list of VerdictCard sorted by priority_score desc.

Task 13: ReportView integration.
  MODIFY src/features/results/ReportView.tsx:
    - Import VerdictsPanel.
    - Slot between CoachPanel and PhaseTimeline.
    - Derive hasStems by checking phase4 data — for slice 2.5, just pass false
      (all uploads are stemless via the slice-1 path).
    - Pass jobId via results.jobId.

Task 14: BFF integration tests (smoke).
  CREATE components/bff/tests/Spectr.Bff.Tests/VerdictEndpointsTests.cs:
    - 401 when not authed.
    - 404 when job belongs to another user.
    - Validates slug membership (POST run with invalid slug → 400).
    - GET /verdicts/ returns empty list + 26 specialist statuses for a fresh analysis.

Task 15: Validation gates.
  Run all 5 levels.

Task 16: Manual smoke.
  Click `low_end` tile; wait; verify VerdictCard appears with real content.
  Click Dismiss; refresh; verify card stays dismissed.
```

### Per-task pseudocode

```csharp
// Task 2 — GET /reports/{jobId}/verdicts/
private static async Task<IResult> ListVerdicts(
    Guid jobId, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
{
    var userId = user.UserId();
    var analysisId = await db.Analyses.AsNoTracking()
        .Where(a => a.JobId == jobId && a.UserId == userId)
        .Select(a => (Guid?)a.Id)
        .FirstOrDefaultAsync(ct);
    if (analysisId is null) return Results.NotFound();

    var rows = await (
        from v in db.Verdicts.AsNoTracking()
        where v.AnalysisId == analysisId.Value
        join us in db.VerdictUserStates.AsNoTracking()
            on new { vid = v.Id, uid = userId }
            equals new { vid = us.VerdictId, uid = us.UserId } into gj
        from us in gj.DefaultIfEmpty()
        select new { v, us }
    ).ToListAsync(ct);

    var verdictDtos = rows.OrderByDescending(r => r.v.PriorityScore)
        .Select(r => ToDto(r.v, r.us))
        .ToList();

    var slugsCovered = rows.Select(r => r.v.Specialist).ToHashSet();
    var statuses = SpecialistCatalog.Slugs
        .Select(slug => new SpecialistStatus(slug, slugsCovered.Contains(slug) ? "cached" : "idle"))
        .ToList();
    // Note: "failed" status is derived from a fail-marker Verdict row with
    // severity='minor' + headline='Specialist failed' — that's still "cached"
    // in this projection. The frontend differentiates by reading the verdict's
    // own severity/headline. Trade-off documented; clean fix is a separate
    // verdict_validation_failures table (later slice).

    return Results.Ok(new VerdictsListResponse(verdictDtos, statuses));
}
```

```python
# Task 5 — run_specialist actor body sketch
@dramatiq.actor(actor_name="run_specialist", queue_name="default",
                max_retries=1, time_limit=180_000)
def run_specialist(analysis_id: str, slug: str, user_id: str):
    aid = uuid.UUID(analysis_id)
    logger.info("run_specialist start analysis=%s slug=%s", analysis_id, slug)

    # ── Phase A: load analysis + prompt
    with SessionFactory.begin() as s:
        analysis = s.get(Analysis, aid)
        if analysis is None:
            raise ValueError(f"analysis {analysis_id} not found")
        final_json = analysis.final_json  # JSONB → already a dict
        track_id = str(analysis.id)

    flattened = flatten(final_json)
    flattened["track_id"] = track_id

    try:
        prompt_version, prompt_body = load_prompt(slug)
    except KeyError:
        logger.warning("unknown specialist slug %s — persisting fail-marker", slug)
        _persist_fail_marker(aid, slug, "Unknown specialist slug")
        return

    # ── Phase B: claude CLI call (no DB tx)
    try:
        raw = llm_call_sync(system=prompt_body, user=_build_user_message(flattened, ""),
                            timeout_s=90)
        parsed = extract_json_object(raw)
    except Exception as e:
        logger.exception("specialist %s LLM call failed", slug)
        _persist_fail_marker(aid, slug, f"LLM call failed: {e}")
        return

    # ── Phase C: hydrate + validate
    verdicts = []
    for raw_v in parsed.get("verdicts") or []:
        try:
            v = hydrate_verdict_sync(raw_v, track_id=track_id, specialist_slug=slug,
                                     prompt_version=f"{slug}@{prompt_version}",
                                     model="claude-cli")
            result = validate_verdict(v, flattened)
            if result.ok and result.verdict is not None:
                verdicts.append(result.verdict)
        except Exception as e:
            logger.info("hydrate/validate failed for one verdict: %s", e)

    if not verdicts:
        _persist_fail_marker(aid, slug, "No verdicts emitted or all failed validation")
        return

    # ── Phase D: persist
    with SessionFactory.begin() as s:
        for v in verdicts:
            row = VerdictRow(
                id=v.verdict_id,
                analysis_id=aid,
                specialist=slug,
                prompt_version=v.prompt_version,
                model=v.model,
                severity=v.severity,
                category=v.category,
                confidence=v.confidence,
                priority_score=v.priority_score,
                impact=None,
                chart_type=None,
                headline=v.headline,
                summary=v.summary,
                body=v.summary,  # slice 2.5: body mirrors summary
                metric_line=(v.evidence[0].label if v.evidence else None),
                why_it_matters=v.why_it_matters,
                preset_name=None,
                evidence=[e.model_dump() for e in v.evidence],
                fix=(v.fix.model_dump() if v.fix else None),
                sources=v.sources,
                created_at=datetime.now(timezone.utc),
            )
            s.add(row)
```

### Integration points

```yaml
DRAMATIQ:
  - Actor name: "run_specialist"
  - Wire format: same envelope shape as analyze_audio_job (BFF DramatiqJobQueue is generic).
  - Args: [analysisId.ToString(), specialistSlug, userId.ToString()]  (3 strings).
  - The BFF passes them as object[] { ... }; the Python signature is run_specialist(analysis_id: str, slug: str, user_id: str).

POLLING:
  - useVerdicts refetches every 3 s WHILE locally-tracked "running" set is non-empty.
  - When a verdict appears for a running slug, the next poll's "cached" status
    drops it from running and stops polling (if nothing else is running).

NO SCHEMA CHANGES:
  - All tables exist from slice 1's Initial migration. Sanity-check before
    implementing.

CONFIG:
  - claude CLI must be on PATH for the worker.
  - VERDICT_PROMPTS_DIR env var optional — default resolves to components/worker/prompts/experts/.
  - ANTHROPIC_API_KEY is NOT needed for slice 2.5; the claude CLI handles its own
    auth via subscription/login.
```

## Validation Loop

### Level 1 — Build + lint

```bash
# BFF builds + tests
cd components/bff
dotnet build
dotnet test

# Worker imports clean
cd ../worker
python -c "from app import dramatiq_app, tasks_dramatiq, verdict_actor; from app.verdict_lib import prompt_loader, validator, llm_client_sync, flatten_analysis, json_extraction; print('ok')"

# Frontend
cd ../frontend-spectr-v2
npm run type-check
npm run lint
npm run build
npm test
```

### Level 2 — Wire smoke

```bash
# (BFF + worker + frontend already running)
TOKEN=...
JOB_ID=...  # from a completed slice-1 analysis

# List verdicts (empty, 26 specialists idle)
curl -sS http://localhost:5000/api/reports/$JOB_ID/verdicts/ \
  -H "Authorization: Bearer $TOKEN" | jq '.specialists | length'   # → 26
# → .verdicts is []

# Dispatch one specialist
curl -sS -X POST http://localhost:5000/api/reports/$JOB_ID/verdicts/run/low_end \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"
# → { "status": "queued" }

# Watch worker logs — should see specialist run, then a Verdict insert.
# Poll the GET endpoint after ~30 s — verdicts should include the new one.
```

### Level 3 — Browser smoke

- Refresh the Results page for the completed job.
- Verdicts panel renders below CoachPanel.
- Click `low_end` tile → status flips to running → 10–60 s later a VerdictCard appears.
- Click Dismiss → card fades. Refresh page → card stays faded.
- Click another tile (e.g. `loudness`) → second card appears.

## Anti-Patterns to Avoid

- **Don't** ship SSE. Polling is fine for slice 2.5.
- **Don't** ship a "Run all 26 specialists" bulk dispatch button. The cost (Anthropic API + worker time) is real; users should opt in per specialist.
- **Don't** add the LOCKED COACH_FINDINGS shape extension (impact, chart_type, preset_name on the pydantic model + new prompts). That's a separate slice (2.6 maybe) that requires re-running every prompt with new output shape.
- **Don't** try to fix the legacy validator's "phase1.lufs" path bug at the validator level. Fix it at the boundary via `flatten_analysis.py` so the validator stays untouched.
- **Don't** import the legacy `components/api/app/verdict_pipeline/` module directly into the worker. It assumes the FastAPI app context (async LLMClient + asyncio.Semaphore). Copy the small files we need into `worker/app/verdict_lib/`.
- **Don't** generate verdict_ids on the C# side. The Python actor owns them via `aimusic_shared.verdicts.ulid_helpers.new_verdict_id()`.
- **Don't** allow re-running a cached specialist in slice 2.5. 409 + "dismiss first" is the contract; richer "re-run" lands later.
- **Don't** add Anthropic API auth complexity. The claude CLI handles it. If the user's CLI isn't authed, the worker logs and persists a fail-marker — surfaced in the UI as a "failed" verdict.
- **Don't** use `asyncio.run()` inside the dramatiq actor. Use the sync llm_client_sync.py instead. asyncio.run() inside a sync actor body is technically fine but introduces event-loop overhead per call.
- **Don't** allow the actor to run on jobs the user doesn't own — BFF must enforce ownership BEFORE dispatching the message. The actor itself trusts what BFF passes.

## Self-review

- [ ] 26 specialists in SpecialistCatalog.Slugs match the 26 in `prompt_loader.SLUG_TO_FILENAME`.
- [ ] flatten_analysis.py turns `{phases: [...]}` into `{phase1: ..., phase2: ...}` correctly. Top-level keys (grade, coach_name, etc.) preserved.
- [ ] All 6 verdict endpoints handle ownership + 404 correctly.
- [ ] POST run/{specialist} validates the slug against SpecialistCatalog.
- [ ] Dismiss/Applied/Feedback endpoints upsert (insert-or-update via single SaveChanges).
- [ ] Frontend polls only while at least one tile is locally `running`.
- [ ] VerdictsPanel slots into ReportView without touching any other panel.
- [ ] No SSE imports anywhere in the frontend.
- [ ] CLAUDE.md `USE_CLAUDE_CLI=true` gotcha respected — sync subprocess wrapper, no concurrent CLI calls per worker process (dramatiq's per-process isolation handles this).
- [ ] No schema migrations.
- [ ] All validation gates pass.
