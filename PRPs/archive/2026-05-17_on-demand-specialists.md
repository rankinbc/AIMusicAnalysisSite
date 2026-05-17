# PRP: On-Demand Per-Specialist AI Analysis

**Status:** Draft
**Effort:** 4–6 hours
**Phase:** v1.3 — verdict UX restructure
**Confidence (one-pass implementation):** 8/10

---

## Goal

Replace the auto-running batch verdict pipeline with **on-demand per-specialist execution**. After the 7-phase analysis completes, the user opens the report and sees a grid of 26 specialist tiles + 1 prominent "Run Summary" CTA. Each tile has its own `Run / Re-run` button. Clicking runs **exactly one** Claude CLI specialist, validates the result, merges it into the existing `analysis_results.verdicts_payload` JSONB cache (replacing prior verdicts tagged with that same specialist), and renders the resulting `VerdictCard` inline next to the tile. Nothing runs without an explicit click — the user controls cost and choice.

## Why

- **Cost**: every specialist call is a paid Claude CLI invocation. The current panel auto-streams all routed specialists on user click, burning credits the user may not want.
- **Validation quality** (open issue from prior HANDOFF): most specialist outputs currently fail validation under the live CLI. Per-tile error surfacing makes prompt-iteration tractable — you can see exactly which specialists are broken.
- **Curated mental model**: "I want to know what's wrong with my low end" is a more natural producer workflow than "give me everything." On-demand maps to that mental model.
- **No new infrastructure**: reuses every backend module that already exists; this is a UX restructure, not a feature addition.

## What

### User-visible behavior

1. After analysis completes, user opens `ResultsPage`.
2. The "AI Analysis" panel (now `SpecialistsPanel`) renders below the score strip with:
   - A large "Run Summary" CTA at the top → runs `priority_summary` specialist.
   - A grouped grid of 26 specialist tiles below, in 8 category groups (Low-End, Frequency, Dynamics, Stereo & Width, Loudness, Arrangement, Reference, Production Detail). One specialist (`overall`) lives in a "Big Picture" group of its own.
   - Each tile: name, last-run timestamp (if cached), `Run` / `Re-run` button.
3. Click a tile's `Run` → tile flips to spinner + "Analyzing… (~10–30 s)". All OTHER tiles' Run buttons disable until this one resolves.
4. On success: tile flips to "cached" state showing the `VerdictCard` inline + a `Re-run` button.
5. On error: tile shows error message + `Try again`.
6. Cached verdicts persist across page loads — on mount, `GET /api/reports/{jobId}/verdicts` seeds the tile state for any already-cached specialists.

### Success Criteria

- [ ] `POST /api/reports/{job_id}/verdicts/run/{slug}` returns 200 with `{ specialist, prompt_version, verdicts: [...], validation_failures: [...] }` for a valid slug + completed job.
- [ ] Calling the endpoint twice for the same slug results in cache containing **only** the latest verdicts for that slug — earlier ones replaced, not duplicated.
- [ ] Verdicts from OTHER specialists (e.g., a prior batch run) remain in the cache untouched after a per-specialist run.
- [ ] Unknown slug → 404 with `{"detail": "unknown specialist"}`.
- [ ] Other user's job → 404 (IDOR-safe via existing `_load_job_for_user`).
- [ ] Job without `final_json` → 410 with `{"detail": "analysis not complete"}`.
- [ ] LLM emits malformed JSON or invalid verdict → 200 with `validation_failures: [...]` (the call ran; the output was bad).
- [ ] Frontend `SpecialistsPanel` no longer auto-streams on mount. Visible Run buttons trigger single-specialist calls.
- [ ] One-at-a-time concurrency: while ANY tile is `running`, all other Run buttons are disabled.
- [ ] Dead `ExpertsPanel.jsx` (367 lines, no importers) deleted.
- [ ] All existing verdict-pipeline tests still pass after the `run_one_specialist` extraction.
- [ ] Frontend `npm run build` clean.
- [ ] Specialist tiles whose prerequisites are missing (no stems / no ALS / no reference) render in a `disabled` state with a clear tooltip — clicking does not fire the API call and does not spend a CLI credit.

---

## Specialist input requirements

A handful of specialists need data beyond the standard 7-phase mix analysis. Those tiles are **disabled** in the UI when the prerequisite is missing on the job — saves the user from wasting a CLI credit on a call that would produce a "no relevant data" verdict.

| Specialist (slug) | Requires | Source in `final_json` |
|---|---|---|
| `stem_balance` | user-uploaded stems | `phase4.stems.status === "ok"` |
| `stem_stereo_width` | user-uploaded stems | `phase4.stems.status === "ok"` |
| `stem_reference_delta` | user-uploaded stems **AND** a reference track | `phase4.stems.status === "ok"` AND `phase5.reference_track` truthy |
| `device_chain` | `.als` project file uploaded | `phase8.status === "ok"` (NOT `"skipped"`) |

All other 22 specialists work on the mix-only metrics that Phases 1–7 produce from any audio file. They degrade gracefully (e.g., `stem_reference` makes weaker claims without a reference) but always have enough data to emit something useful.

**Implementation note:** the route itself stays lenient — it accepts any slug and runs it, so power users can override the UI gating via direct API calls. The tile-disabled behaviour is purely a UX cost-protection layer.

---

## All Needed Context

### Documentation & References

```yaml
# MUST READ before any code change
- file: CLAUDE.md
  section: "verdict pipeline (v1.2)" gotchas
  why: |
    - USE_CLAUDE_CLI=true required (Anthropic API transport is a stub)
    - CLI is NOT concurrency-safe — serialized by asyncio.Semaphore(1)
    - Slugs snake_case, prompt files PascalCase — see SLUG_TO_FILENAME
    - Validator overwrites priority_score and may downgrade severity (moderate-severity baseline)
    - verdicts_prompt_version_set caches the full set, comma-joined "<slug>@<version>"

- file: components/api/app/verdict_pipeline/specialists.py
  why: |
    run_specialists() is the iterator we're extracting from.
    Read lines 64-126 to understand the per-specialist body to factor out:
      1. load_prompt(slug) -> (version, system_body)
      2. _build_user_message(analysis, focus)
      3. Retry-once loop (llm.call -> extract_json_object)
      4. _hydrate_verdict on each raw verdict
      5. Yield (slug, Verdict | Exception)

- file: components/api/app/verdict_pipeline/validator.py
  why: |
    validate_verdict(verdict, analysis) -> ValidationResult.
    .ok / .verdict (validated, with overwritten priority_score) / .failure (ValidationFailure).
    THIS is the authority — never bypass it.

- file: components/api/app/routers/verdicts.py
  why: |
    Reuse _load_job_for_user (currently module-private). Move to a public
    `_load_job_for_user(db, job_id, user_id)` signature if needed by the new
    route — or just import it directly with `from .verdicts import _load_job_for_user`.
    The existing generate / get / stream / dismiss / feedback routes stay.
    Add the new POST run/{slug} route to this same file.

- file: components/shared/aimusic_shared/verdicts/models.py
  section: lines 158-180 (Verdict model)
  why: |
    `specialist: str` is the field we filter on for cache replace.
    `prompt_version: str` is "<slug>@<version>" — set by _hydrate_verdict.
    `model_dump(mode="json")` serializes for JSONB storage.

- file: components/api/tests/verdict_pipeline/conftest.py
  why: |
    MockLLMClient is the test double. Use .register(prompt_excerpt, track_id, response)
    to seed responses. The fixture `llm` returns one. Use existing analysis fixtures
    (clean_trance, muddy_hiphop, etc.) for `final_json`.

- file: components/api/tests/test_songs_router.py
  section: lines 22-54 (authed_client fixture)
  why: |
    Pattern for in-memory sqlite + ASGI client + dependency-overriding
    get_current_user and get_session. Reuse this exact pattern for the
    new test_run_specialist_route.py.

- file: components/api/tests/conftest.py
  why: |
    JSONB-on-SQLite compile shim is registered here.
    DO NOT re-register; just rely on it.

- file: components/api/prompts/experts/PriorityProblemSummary.md
  why: |
    The "Summary" CTA targets this prompt (slug: priority_summary).
    It's the high-level synthesizer — ranks problems across all categories.

- file: components/frontend-spectr/src/components/AIAnalysisModal.jsx
  why: |
    Current panel. The `VerdictCard` rendering helper (lines 70-305 approximately)
    will be extracted into its own file for reuse. The auto-stream pathway
    (handleGenerate, streamVerdicts) is REMOVED. The on-mount cache load
    (getVerdicts in useEffect line ~330) is KEPT and re-purposed to seed tile state.

- file: components/frontend-spectr/src/api/verdicts.js
  why: |
    Keep getVerdicts, dismissVerdict, giveFeedback as-is.
    Delete or stub streamVerdicts (no longer used).
    Add runSpecialist(jobId, slug) → POST /api/reports/{jobId}/verdicts/run/{slug}.

- file: components/frontend-spectr/src/index.css
  why: |
    Pattern for new CSS — append at end. Use existing color tokens
    (--cyan, --surface, --card, --border, --muted, --text, --red, --green,
    --yellow, --orange). Match the .modal / .song-card / .version-row
    classes added in the song library PRP execution for style consistency.
```

### Current backend tree (relevant slice)

```
components/api/
├── app/
│   ├── llm/
│   │   └── client.py                       # LLMClient ABC + CliClient (Semaphore(1) gated)
│   ├── routers/
│   │   ├── verdicts.py                     # extend here
│   │   └── auth.py                         # get_current_user
│   └── verdict_pipeline/
│       ├── orchestrator.py                 # run_pipeline (unchanged)
│       ├── specialists.py                  # REFACTOR: extract run_one_specialist
│       ├── validator.py                    # validate_verdict (unchanged)
│       ├── prompt_loader.py                # SLUG_TO_FILENAME source of truth
│       ├── rule_engine.py                  # (unchanged)
│       ├── triage.py                       # (unchanged)
│       ├── dedupe.py                       # (unchanged)
│       └── ranker.py                       # (unchanged)
├── prompts/experts/                        # 26 specialist .md files + Triage.md
└── tests/
    ├── conftest.py                         # JSONB-sqlite shim (do not touch)
    ├── test_songs_router.py                # authed_client fixture pattern
    └── verdict_pipeline/
        ├── conftest.py                     # MockLLMClient + analysis fixtures
        └── test_specialists.py             # existing specialist tests
```

### Desired backend tree

```
components/api/
├── app/
│   ├── routers/
│   │   └── verdicts.py                     # NEW route added
│   └── verdict_pipeline/
│       └── specialists.py                  # NEW run_one_specialist() helper
└── tests/
    ├── test_run_specialist_route.py        # NEW (route-level integration tests)
    └── verdict_pipeline/
        └── test_specialists.py             # ADD unit test for run_one_specialist
```

### Current frontend tree (relevant slice)

```
components/frontend-spectr/src/
├── api/
│   ├── client.js                           # apiRequest, getToken (unchanged)
│   └── verdicts.js                         # add runSpecialist, drop streamVerdicts
├── components/
│   ├── AIAnalysisModal.jsx                 # RENAME → SpecialistsPanel.jsx + REWRITE
│   ├── ExpertsPanel.jsx                    # DELETE (367 lines, no importers)
│   └── ResultsPage.jsx                     # update import to SpecialistsPanel
└── index.css                               # add .specialists-* CSS
```

### Desired frontend tree

```
components/frontend-spectr/src/
├── api/
│   └── verdicts.js                         # + runSpecialist; - streamVerdicts
├── components/
│   ├── SpecialistsPanel.jsx                # NEW (replaces AIAnalysisModal.jsx)
│   ├── VerdictCard.jsx                     # NEW (extracted from old AIAnalysisModal)
│   └── ResultsPage.jsx                     # MODIFIED import only
└── index.css                               # extended
```

### Known Gotchas

```python
# CRITICAL: validator.validate_verdict() returns ValidationResult with
# .ok, .verdict, .failure. NEVER trust the LLM's priority_score; the
# validator overwrites it. Never trust the LLM's severity; the validator
# may downgrade using a moderate-severity baseline (see scoring.py).

# CRITICAL: app.llm.client.CliClient has its own asyncio.Semaphore(1).
# Plus components/api/app/routers/verdicts.py has _GEN_SEMA.
# DON'T add a third concurrency lock — re-use CliClient's; the new route
# does NOT need its own semaphore.

# CRITICAL: SQLAlchemy 2.0 async — verdicts_payload is JSONB.
# When merging: `result.verdicts_payload = {"verdicts": merged}` triggers
# the proper write. Modifying in place (e.g. result.verdicts_payload["verdicts"].append(...))
# WON'T mark the column dirty and the change WILL NOT persist.

# CRITICAL: Verdict.model_dump(mode="json") for JSONB serialization.
# Without mode="json", datetimes become datetime objects which JSONB
# rejects.

# CRITICAL: prompt_loader.SLUG_TO_FILENAME is the authoritative slug list.
# Validate the path parameter against it; do NOT trust user input.

# CRITICAL: verdicts_prompt_version_set was designed for batch cache-validity
# checking. After a per-specialist run, the payload is no longer a "complete
# set" — clear this field (set to None) so the batch-generate endpoint
# treats the payload as stale and regenerates on next call.

# WINDOWS: uvicorn --reload spawns orphan processes that don't show up in
# Get-Process. If you need to restart: use the smoke-test pattern from
# the prior session (tasklist | grep python.exe → wmic CommandLine →
# taskkill //F //PID).
```

---

## Implementation Blueprint

### Data models

No schema changes. Reuse:
- `AnalysisResult.verdicts_payload` (JSONB, `{"verdicts": [...]}` shape)
- `AnalysisResult.verdicts_generated_at` (timestamp)
- `AnalysisResult.verdicts_prompt_version_set` (String, cleared on per-specialist writes)
- `aimusic_shared.verdicts.models.Verdict` — `specialist` field is the cache filter key.

### Task list (in execution order)

```yaml
Task 1 — extract run_one_specialist (backend, ~30 lines):
  MODIFY components/api/app/verdict_pipeline/specialists.py:
    - ADD `async def run_one_specialist(slug: str, focus: str, analysis: dict,
        *, llm: LLMClient, model_name: str = "claude-cli", timeout_s: int = 90,
      ) -> tuple[list[Verdict], list[Exception]]`
    - MOVE the body of the `for entry in ordered:` loop into the new helper,
      changing yields to list accumulation.
    - REWRITE run_specialists to delegate: for each plan entry, call
      run_one_specialist(slug, focus, analysis, llm=llm, ...) and yield
      each result.
    - PRESERVE all existing behaviour (retry, _hydrate_verdict, error handling).

Task 2 — unit test for run_one_specialist (backend, ~50 lines):
  CREATE in components/api/tests/verdict_pipeline/test_specialists.py:
    - test_run_one_specialist_happy_path
    - test_run_one_specialist_unknown_slug_raises (or returns empty + KeyError)
    - test_run_one_specialist_retries_on_bad_json
    - test_run_one_specialist_returns_validation_friendly_verdict
  USE MockLLMClient + clean_trance fixture.
  CONFIRM existing run_specialists tests still pass.

Task 3 — new route POST /verdicts/run/{slug} (backend, ~80 lines):
  MODIFY components/api/app/routers/verdicts.py:
    - IMPORT run_one_specialist, validate_verdict, SLUG_TO_FILENAME, load_prompt
    - ADD route per the contract below.
    - REUSE _load_job_for_user.
    - HANDLE: unknown slug → 404, no final_json → 410, IDOR → 404,
              LLM exception → 500, validation failure → 200 with failures list.
    - APPEND/REPLACE: load existing payload, filter OUT verdicts where
      `v.get("specialist") == slug`, append new ones, write back.
    - CLEAR `verdicts_prompt_version_set` to None (payload is no longer a full set).
    - UPDATE `verdicts_generated_at` to now.

Task 4 — route tests (backend, ~150 lines):
  CREATE components/api/tests/test_run_specialist_route.py:
    - Reuse the authed_client fixture pattern from test_songs_router.py
      (in-memory sqlite + ASGI client + dependency overrides).
    - Override the LLM dependency via app.dependency_overrides[_get_llm_client]
      → MockLLMClient.
    - Seed an UploadJob + AnalysisResult (status=COMPLETE, final_json={...}).
    - Tests:
      - test_happy_path_returns_verdicts
      - test_unknown_specialist_404
      - test_other_user_job_404
      - test_no_final_json_410
      - test_replace_not_duplicate (run twice, assert only latest verdicts kept)
      - test_preserves_other_specialists_verdicts (seed payload with other
        specialist verdicts, run one, assert other verdicts unchanged)
      - test_clears_prompt_version_set (assert field is None after per-specialist run)
      - test_validation_failure_returns_200_with_failures (mock LLM returns a
        verdict that the validator rejects)

Task 5 — frontend api client: runSpecialist (frontend, ~15 lines):
  MODIFY components/frontend-spectr/src/api/verdicts.js:
    - ADD `runSpecialist(jobId, slug)` — POST /api/reports/{jobId}/verdicts/run/{slug}
    - Returns parsed JSON; throws Error with .status on non-2xx.
    - DELETE the streamVerdicts function (or stub with a console.warn).
    - KEEP getVerdicts, dismissVerdict, giveFeedback unchanged.

Task 5b — adapter: surface available inputs (frontend, ~10 lines):
  MODIFY components/frontend-spectr/src/api/adapter.js:
    - In adaptResult(), derive an `inputs` object from raw.result.phases:
        const hasStems     = p4?.stems?.status === 'ok';
        const hasAls       = p8?.status === 'ok';  // phases[7] is Phase 8 ALS
        const hasReference = !!p5?.reference_track;
    - ADD `inputs: { hasStems, hasAls, hasReference }` to the returned object
      (right next to the existing `stems:` field).
    - This drives the per-tile gating in SpecialistsPanel without a backend roundtrip.

Task 6 — extract VerdictCard (frontend, ~150 lines):
  CREATE components/frontend-spectr/src/components/VerdictCard.jsx:
    - COPY the VerdictCard function + SEV_COLOR/SEV_BG helpers from
      AIAnalysisModal.jsx lines 1-305 (excluding the AIAnalysisPanel wrapper).
    - EXPORT default VerdictCard
    - PROPS unchanged: { verdict, isExpanded, onToggle, onDismiss, onFeedback, feedback }

Task 7 — SpecialistsPanel rewrite (frontend, ~280 lines):
  CREATE components/frontend-spectr/src/components/SpecialistsPanel.jsx:
    - Tile state: { slug, name, category, status: 'idle'|'running'|'cached'|'error'|'disabled',
                    verdicts: [], promptVersion: null, error: null, lastRunAt: null,
                    disabledReason: null }
    - SPECIALIST_CATEGORIES constant: 9 groups as listed below.
    - SPECIALIST_REQUIREMENTS constant:
        const SPECIALIST_REQUIREMENTS = {
          stem_balance:         ['stems'],
          stem_stereo_width:    ['stems'],
          stem_reference_delta: ['stems', 'reference'],
          device_chain:         ['als'],
        };
    - PROPS: { jobId, inputs }   // inputs = { hasStems, hasAls, hasReference }
    - On mount: compute initial tile status:
        for each slug: if any required input is missing → status: 'disabled',
        disabledReason: 'Upload stems to enable' (or 'Upload an .als project file to enable',
        or 'Upload stems and a reference track to enable'). Otherwise idle.
        Then getVerdicts(jobId) → for each grouped specialist with cached verdicts,
        upgrade tile to 'cached' (cached state wins over disabled — they have data already).
    - Top: large Run Summary CTA (runs slug='priority_summary'). Never gated.
    - Grid: 25 tiles grouped by category. Each tile renders header + status content.
    - Concurrency: `runningSlug` state — while set, ALL non-disabled Run buttons
      disabled.
    - On Run click: NO-OP if tile.status === 'disabled'. Otherwise set runningSlug,
      call runSpecialist, on success update tile state, on error set tile error.
    - Disabled tile rendering: greyed out, no Run button, small tooltip-style hint
      below header showing the disabledReason. Body shows empty/dim placeholder.
    - Dismiss + feedback: same pattern as old panel, call dismissVerdict /
      giveFeedback per verdict, optimistic local state.

Task 8 — wire SpecialistsPanel into ResultsPage (frontend, ~3 lines):
  MODIFY components/frontend-spectr/src/components/ResultsPage.jsx:
    - REPLACE `import AIAnalysisPanel from './AIAnalysisModal';`
      WITH    `import SpecialistsPanel from './SpecialistsPanel.jsx';`
    - REPLACE `<AIAnalysisPanel jobId={jobId} />`
      WITH    `<SpecialistsPanel jobId={jobId} inputs={data.inputs} />`
    - The `data.inputs` field comes from the adapter extension (Task 5b).

Task 9 — CSS for specialist grid (frontend, ~90 lines):
  MODIFY components/frontend-spectr/src/index.css:
    - APPEND .specialists-panel, .specialists-grid, .specialist-group,
      .specialist-tile, .specialist-tile--running/cached/error/disabled,
      .specialist-summary-cta, .specialist-tile-header, .specialist-tile-body,
      .specialist-tile-hint  (small italic line under header, for disabledReason)
    - .specialist-tile--disabled: opacity ~0.45, cursor: not-allowed; the Run
      button is OMITTED from the JSX in this state, not just visually hidden.
    - Use --cyan for primary CTAs, --surface/--card for backgrounds,
      severity colors from existing SEV_COLOR for cached states.
    - Grid: `display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px;`

Task 10 — delete dead code (frontend, 1 file):
  DELETE components/frontend-spectr/src/components/ExpertsPanel.jsx
    - 367 lines, no importers (verified via grep before).
    - `git rm` + commit alongside Task 7-9 or in its own commit.

Task 11 — file rename cleanup (frontend, 1 file):
  DELETE components/frontend-spectr/src/components/AIAnalysisModal.jsx
    - Once SpecialistsPanel.jsx is wired (Task 8 done), the old file is dead.
    - `git rm`.

Task 12 — full validation gates:
  Run all gates from "Validation Loop" below.
```

### Per-task pseudocode

#### Task 1 — `run_one_specialist`

```python
# components/api/app/verdict_pipeline/specialists.py
async def run_one_specialist(
    slug: str,
    focus: str,
    analysis: dict[str, Any],
    *,
    llm: LLMClient,
    model_name: str = "claude-cli",
    timeout_s: int = 90,
) -> tuple[list[Verdict], list[Exception]]:
    """Run one specialist by slug. Returns (verdicts, errors).
    Verdicts are hydrated but NOT yet validated — caller invokes validate_verdict."""
    track_id = analysis.get("track_id", "unknown-track")
    try:
        version, system_body = load_prompt(slug)
    except KeyError as e:
        return [], [e]

    user_msg = _build_user_message(analysis, focus)
    parsed: dict[str, Any] | None = None
    last_err: Exception | None = None
    for attempt in (1, 2):
        user = user_msg if attempt == 1 else user_msg + RETRY_SUFFIX
        try:
            raw_text = await llm.call(system=system_body, user=user, timeout_s=timeout_s)
            parsed = extract_json_object(raw_text)
            break
        except Exception as e:
            last_err = e
            continue
    if parsed is None:
        return [], [last_err or RuntimeError("specialist failed without exception")]

    verdicts: list[Verdict] = []
    errors: list[Exception] = []
    for raw_v in (parsed.get("verdicts") or []):
        try:
            verdicts.append(_hydrate_verdict(
                raw_v, track_id=track_id, specialist_slug=slug,
                prompt_version=f"{slug}@{version}", model=model_name,
            ))
        except Exception as e:
            errors.append(e)
    return verdicts, errors


# Refactored run_specialists delegates:
async def run_specialists(plan, analysis, *, llm, model_name="claude-cli", timeout_s=90):
    ordered = sorted(plan.specialists_to_run, key=lambda d: d.get("priority", 99))
    for entry in ordered:
        slug = entry["name"]
        focus = entry.get("focus", "")
        verdicts, errors = await run_one_specialist(
            slug, focus, analysis, llm=llm, model_name=model_name, timeout_s=timeout_s,
        )
        for v in verdicts:
            yield (slug, v)
        for e in errors:
            yield (slug, e)
```

#### Task 3 — new route

```python
# components/api/app/routers/verdicts.py — add at end of file

class _SpecialistRunResponse(BaseModel):
    specialist: str
    prompt_version: str
    verdicts: list[dict]
    validation_failures: list[dict]


@router.post("/reports/{job_id}/verdicts/run/{specialist_slug}",
             response_model=_SpecialistRunResponse)
async def run_specialist(
    job_id: uuid.UUID,
    specialist_slug: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(_get_llm_client),
) -> _SpecialistRunResponse:
    from app.verdict_pipeline.prompt_loader import SLUG_TO_FILENAME, load_prompt
    from app.verdict_pipeline.specialists import run_one_specialist
    from app.verdict_pipeline.validator import validate_verdict

    if specialist_slug not in SLUG_TO_FILENAME:
        raise HTTPException(status_code=404, detail="unknown specialist")

    _, result = await _load_job_for_user(db, job_id=job_id, user_id=user.id)
    if not result.final_json:
        raise HTTPException(status_code=410, detail="analysis not complete")

    version, _ = load_prompt(specialist_slug)
    prompt_version = f"{specialist_slug}@{version}"

    raw_verdicts, errors = await run_one_specialist(
        specialist_slug, focus="", analysis=result.final_json,
        llm=llm, timeout_s=settings.verdict_cli_timeout_s,
    )

    validated: list[Verdict] = []
    failures: list[dict] = []
    for v in raw_verdicts:
        vr = validate_verdict(v, result.final_json)
        if vr.ok and vr.verdict is not None:
            validated.append(vr.verdict)
        elif vr.failure is not None:
            failures.append({
                "specialist": vr.failure.specialist,
                "prompt_version": vr.failure.prompt_version,
                "reason": vr.failure.reason,
                "raw_excerpt": vr.failure.raw_excerpt,
            })

    for e in errors:
        failures.append({
            "specialist": specialist_slug,
            "prompt_version": prompt_version,
            "reason": f"specialist call failed: {e}",
            "raw_excerpt": "",
        })

    # Merge into JSONB cache — replace any prior verdicts for this slug.
    existing_payload = result.verdicts_payload or {"verdicts": []}
    kept = [v for v in existing_payload.get("verdicts", [])
            if v.get("specialist") != specialist_slug]
    new_dumped = [v.model_dump(mode="json") for v in validated]
    result.verdicts_payload = {"verdicts": kept + new_dumped}
    result.verdicts_generated_at = datetime.now(tz=timezone.utc)
    result.verdicts_prompt_version_set = None  # piecewise — batch cache key invalid
    result.verdicts_model = "claude-cli"
    await db.commit()

    return _SpecialistRunResponse(
        specialist=specialist_slug,
        prompt_version=prompt_version,
        verdicts=new_dumped,
        validation_failures=failures,
    )
```

#### Task 5 — `runSpecialist` client

```js
// components/frontend-spectr/src/api/verdicts.js — replace streamVerdicts with:

export async function runSpecialist(jobId, slug) {
  const res = await fetch(`${BASE}/reports/${jobId}/verdicts/run/${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  if (res.status === 404) throw Object.assign(new Error('Not found'), { status: 404 });
  if (res.status === 410) throw Object.assign(new Error('Analysis not complete'), { status: 410 });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`HTTP ${res.status}: ${body}`), { status: res.status });
  }
  return res.json();  // { specialist, prompt_version, verdicts, validation_failures }
}
```

#### Task 7 — `SpecialistsPanel` skeleton

```jsx
// components/frontend-spectr/src/components/SpecialistsPanel.jsx
import { useEffect, useState, useCallback } from 'react';
import { getVerdicts, runSpecialist, dismissVerdict, giveFeedback } from '../api/verdicts.js';
import VerdictCard from './VerdictCard.jsx';

const SPECIALIST_CATEGORIES = [
  { id: 'low-end',      label: 'Low End',           slugs: ['low_end', 'stem_balance'] },
  { id: 'frequency',    label: 'Frequency',         slugs: ['frequency_balance', 'frequency_collision', 'harmonic', 'chord_harmony'] },
  { id: 'dynamics',     label: 'Dynamics',          slugs: ['dynamics', 'humanization', 'density'] },
  { id: 'stereo',       label: 'Stereo & Width',    slugs: ['stereo_phase', 'stereo_field', 'spatial', 'stem_stereo_width'] },
  { id: 'loudness',     label: 'Loudness',          slugs: ['loudness', 'gain_staging', 'playback'] },
  { id: 'arrangement',  label: 'Arrangement',       slugs: ['sections', 'trance_arrangement', 'section_contrast'] },
  { id: 'reference',    label: 'Reference',         slugs: ['stem_reference', 'stem_reference_delta'] },
  { id: 'detail',       label: 'Production Detail', slugs: ['clarity', 'surround', 'device_chain'] },
  { id: 'overall',      label: 'Big Picture',       slugs: ['overall'] },
];

const SUMMARY_SLUG = 'priority_summary';

const SPECIALIST_REQUIREMENTS = {
  stem_balance:         ['stems'],
  stem_stereo_width:    ['stems'],
  stem_reference_delta: ['stems', 'reference'],
  device_chain:         ['als'],
};

const REQUIREMENT_LABELS = {
  stems:     'stems',
  als:       'an .als project file',
  reference: 'a reference track',
};

function missingReason(slug, inputs) {
  const reqs = SPECIALIST_REQUIREMENTS[slug] ?? [];
  const missing = reqs.filter(r =>
    (r === 'stems'     && !inputs?.hasStems)     ||
    (r === 'als'       && !inputs?.hasAls)       ||
    (r === 'reference' && !inputs?.hasReference)
  );
  if (!missing.length) return null;
  const list = missing.map(r => REQUIREMENT_LABELS[r]).join(' and ');
  return `Upload ${list} to enable.`;
}

const SPECIALIST_LABELS = {
  low_end: 'Low End', frequency_balance: 'Frequency Balance',
  dynamics: 'Dynamics', stereo_phase: 'Stereo & Phase',
  loudness: 'Loudness', sections: 'Sections',
  trance_arrangement: 'Trance Arrangement', stem_reference: 'Stem vs Reference',
  harmonic: 'Harmonic', clarity: 'Clarity',
  spatial: 'Spatial', surround: 'Surround Compat',
  playback: 'Playback Optimization', overall: 'Overall Score',
  gain_staging: 'Gain Staging', stereo_field: 'Stereo Field',
  frequency_collision: 'Frequency Collisions', humanization: 'Humanization',
  section_contrast: 'Section Contrast', density: 'Density/Busyness',
  chord_harmony: 'Chord Harmony', device_chain: 'Device Chain',
  priority_summary: 'Priority Summary',
  stem_balance: 'Stem Balance', stem_stereo_width: 'Stem Stereo Width',
  stem_reference_delta: 'Stem Reference Delta',
};

export default function SpecialistsPanel({ jobId, inputs }) {
  // tiles: { [slug]: { status, verdicts: [], lastRunAt, error, disabledReason } }
  const [tiles, setTiles] = useState(() => {
    const init = {};
    const allSlugs = [SUMMARY_SLUG, ...SPECIALIST_CATEGORIES.flatMap(c => c.slugs)];
    for (const slug of allSlugs) {
      const reason = missingReason(slug, inputs);
      init[slug] = reason
        ? { status: 'disabled', verdicts: [], disabledReason: reason }
        : { status: 'idle',     verdicts: [] };
    }
    return init;
  });
  const [runningSlug, setRunningSlug] = useState(null);
  const [dismissed, setDismissed] = useState(new Set());
  const [feedbacks, setFeedbacks] = useState({});
  const [expandedCards, setExpandedCards] = useState(new Set());

  // Seed from cached payload on mount
  useEffect(() => {
    let alive = true;
    getVerdicts(jobId).then(payload => {
      if (!alive || !payload?.verdicts?.length) return;
      const grouped = {};
      const fb = {}; const dis = new Set();
      for (const v of payload.verdicts) {
        (grouped[v.specialist] ??= []).push(v);
        if (v.user_state?.feedback) fb[v.verdict_id] = v.user_state.feedback;
        if (v.user_state?.dismissed) dis.add(v.verdict_id);
      }
      setTiles(prev => {
        const next = { ...prev };
        for (const [slug, vs] of Object.entries(grouped))
          if (next[slug]) next[slug] = { status: 'cached', verdicts: vs };
        return next;
      });
      setFeedbacks(fb); setDismissed(dis);
    }).catch(() => { /* idle */ });
    return () => { alive = false; };
  }, [jobId]);

  const handleRun = useCallback(async (slug) => {
    if (runningSlug) return;
    if (tiles[slug]?.status === 'disabled') return;  // safety: UI should already prevent
    setRunningSlug(slug);
    setTiles(prev => ({ ...prev, [slug]: { ...prev[slug], status: 'running', error: null }}));
    try {
      const r = await runSpecialist(jobId, slug);
      const had = (r.verdicts ?? []).length > 0;
      setTiles(prev => ({ ...prev, [slug]: {
        status: had ? 'cached' : 'error',
        verdicts: r.verdicts ?? [],
        lastRunAt: new Date().toISOString(),
        error: had ? null : (r.validation_failures?.[0]?.reason || 'No verdicts returned'),
      }}));
    } catch (e) {
      setTiles(prev => ({ ...prev, [slug]: {
        ...prev[slug], status: 'error', error: e.message || 'Run failed',
      }}));
    } finally {
      setRunningSlug(null);
    }
  }, [jobId, runningSlug, tiles]);

  // ... render: summary CTA + grouped grid; per-tile render based on status.
  //
  // Per-tile render pseudocode:
  //   if status === 'disabled': render with .specialist-tile--disabled class,
  //     no Run button, render disabledReason as a small italic line.
  //   if status === 'idle':     show Run button (disabled if runningSlug)
  //   if status === 'running':  spinner + "Analyzing… ~10–30 s"
  //   if status === 'cached':   render VerdictCard for each verdict + Re-run button
  //   if status === 'error':    error message + Try again button
}
```

### Integration points

```yaml
DATABASE:
  - migration: NONE — reuse existing analysis_results columns.
  - field semantics:
      verdicts_payload: still {"verdicts": [...]} — now built piecewise.
      verdicts_prompt_version_set: SET TO None on per-specialist writes
        (it was a batch cache-validity key; piecewise payloads don't fit).

ROUTES:
  - add to: components/api/app/routers/verdicts.py
  - pattern: 'POST /reports/{job_id}/verdicts/run/{specialist_slug}'

FRONTEND:
  - rename: AIAnalysisModal.jsx → SpecialistsPanel.jsx
  - extract: VerdictCard.jsx
  - delete: ExpertsPanel.jsx (dead, 367 lines)
  - update: ResultsPage.jsx import (line 46) and JSX (line 179)

CONFIG:
  - no new env vars; the existing USE_CLAUDE_CLI and verdict_cli_timeout_s
    settings are already in app/config.py.
```

---

## Validation Loop

### Level 1 — Syntax & style

```bash
ruff check components/api/ components/shared/ --fix
# Expected: clean (the 3 known pre-existing errors in validator.py,
# test_auth.py, worker/db.py are NOT introduced by this PRP and may remain).
```

### Level 2 — Unit + integration tests (backend)

```bash
# Verdict pipeline tests — confirm refactor didn't break anything
pytest -q components/api/tests/verdict_pipeline/ -v

# New route tests
pytest -q components/api/tests/test_run_specialist_route.py -v

# Aggregate API suite (skip the slow migration test)
pytest -q components/api/tests/ --ignore=components/api/tests/test_migration_010.py
# Expected: 126+ pass (the test_all_23_specialist_slugs_present pre-existing
# failure is unrelated; expect new tests added by this PRP)
```

### Level 3 — Frontend build

```bash
cd components/frontend-spectr && npm run build
# Expected: clean. Module count grows by 2-3 (VerdictCard + SpecialistsPanel
# add modules; ExpertsPanel + AIAnalysisModal removals subtract).
```

### Level 4 — Manual smoke (requires docker compose up + worker)

```bash
# 1. Bring up services
docker compose -f docker/docker-compose.yml up -d
cd components/api && python -m uvicorn app.main:app --port 8000 &
cd components/worker && python -m celery -A app.celery_app worker --pool=solo --concurrency=1 &
cd components/frontend-spectr && npm run dev &

# 2. Register + upload + analyze (use the smoke pattern from prior session)
EMAIL="prp-$(date +%s)@example.com"
TOKEN=$(curl -sS -X POST http://localhost:8000/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"TestPassword123!\"}" \
  | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Upload + wait for analysis to complete; capture JOB_ID
JOB_ID=$(curl -sS -X POST http://localhost:8000/uploads/ \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@data/uploads/<existing-mp3>;type=audio/mpeg" \
  | python -c "import sys,json; print(json.load(sys.stdin)['job_id'])")

# wait ~60s for the worker to process all 7 phases

# 3. Hit the new endpoint
curl -sS -X POST "http://localhost:8000/reports/$JOB_ID/verdicts/run/low_end" \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
# Expected: {"specialist": "low_end", "prompt_version": "low_end@X.Y.Z",
#            "verdicts": [...], "validation_failures": [...]}

# 4. Cache merge test
curl -sS "http://localhost:8000/reports/$JOB_ID/verdicts" \
  -H "Authorization: Bearer $TOKEN" | python -c "import sys,json; d=json.load(sys.stdin); print('verdict count:', len(d['verdicts'])); print('specialists:', sorted(set(v['specialist'] for v in d['verdicts'])))"
# Expected: at minimum {'low_end'} after one call

# Run a second specialist; assert both appear in the cache
curl -sS -X POST "http://localhost:8000/reports/$JOB_ID/verdicts/run/loudness" \
  -H "Authorization: Bearer $TOKEN" > /dev/null
curl -sS "http://localhost:8000/reports/$JOB_ID/verdicts" \
  -H "Authorization: Bearer $TOKEN" | python -c "import sys,json; print(sorted(set(v['specialist'] for v in json.load(sys.stdin)['verdicts'])))"
# Expected: ['loudness', 'low_end']

# Re-run low_end; cache should still have only ONE low_end set
curl -sS -X POST "http://localhost:8000/reports/$JOB_ID/verdicts/run/low_end" \
  -H "Authorization: Bearer $TOKEN" > /dev/null
curl -sS "http://localhost:8000/reports/$JOB_ID/verdicts" \
  -H "Authorization: Bearer $TOKEN" | python -c "import sys,json; d=json.load(sys.stdin); low=[v for v in d['verdicts'] if v['specialist']=='low_end']; print('low_end verdicts:', len(low))"
# Expected: same count as the first low_end run (not doubled)

# 5. Visual smoke in browser at http://localhost:5174
# - Sign in with the test user (or register fresh)
# - Open the ResultsPage for the analyzed job
# - Confirm the SpecialistsPanel renders with 27 tiles (1 Summary + 26)
# - Click "Run Summary" → spinner → verdict card appears in the Summary tile
# - Click "Run" on Low End → spinner → cached state with verdict card
# - Reload page → both tiles still show cached verdicts
# - Click "Re-run" → spinner, then updated card
# - Open profile page (the earlier d7520ab fix) — should NOT log you out

# 6. Prereq-gating smoke (no stems, no ALS upload):
# - On the ResultsPage for a plain-FLAC job, the 3 stem tiles + the
#   device_chain tile must render with greyed-out styling and NO Run button.
# - Each disabled tile shows a small italic line like:
#     "Upload stems to enable."
#     "Upload an .als project file to enable."
#     "Upload stems and a reference track to enable."
# - Clicking anywhere on a disabled tile must NOT fire a network request
#   (verify in browser devtools Network panel).
```

---

## Final Validation Checklist

- [ ] Backend unit + integration tests pass (`pytest -q components/api/tests/`)
- [ ] No new ruff errors introduced
- [ ] Frontend builds clean (`npm run build`)
- [ ] Manual: per-specialist run merges into cache, doesn't duplicate, doesn't wipe other specialists
- [ ] Manual: tile concurrency is enforced (only one Run button active at a time)
- [ ] Manual: cached verdicts seed on page reload
- [ ] No regressions: existing `/verdicts/generate`, `/verdicts/stream`, `/verdicts`, `/dismiss`, `/feedback` endpoints still work
- [ ] `ExpertsPanel.jsx` and `AIAnalysisModal.jsx` removed; no orphan imports
- [ ] No DB migration created (this PRP explicitly does not need one)
- [ ] Disabled tiles render greyed out with a clear "Upload X to enable" hint and no Run button (verified for stems-only and ALS-only specialists on a plain-FLAC job)

---

## Anti-Patterns to Avoid

- **Don't add a per-job semaphore on the new route.** `app.llm.client.CliClient` already has `asyncio.Semaphore(1)` to serialize CLI calls. The pipeline's `_GEN_SEMA` was for limiting concurrent batch *pipelines* — different concern. The new route can fire freely; the CLI lock handles serialization.
- **Don't modify `result.verdicts_payload` in place.** SQLAlchemy won't mark JSONB columns dirty on nested mutation. Always assign a NEW dict.
- **Don't trust the LLM's `priority_score` or `severity` field on the wire.** `validate_verdict()` overwrites both — that's the authority.
- **Don't write back `validated.append(verdict.model_dump())` — call `model_dump(mode="json")` explicitly** so datetimes serialize as ISO strings (JSONB can't store Python datetime).
- **Don't auto-fire `runSpecialist` on mount.** The whole point of this PRP is user-driven, cost-deliberate execution. Mount-time fetch is only the *cached* `getVerdicts` call.
- **Don't queue multiple Run clicks client-side.** Disable all Run buttons while `runningSlug` is set. If the user really wants two, they can wait — the CLI cost matters.
- **Don't delete `orchestrator.py`, `triage.py`, `dedupe.py`, `ranker.py`, or the existing `/verdicts/generate` and `/verdicts/stream` routes.** They're still useful for a future "Run All" reinstatement and currently serve the unauthenticated SSE pathway. Just don't wire the SpecialistsPanel to them.
- **Don't bump `verdicts_prompt_version_set` when running a single specialist.** That field is the BATCH cache-validity key. After a piecewise update, the payload is no longer a "complete set." Set the field to `None` so the batch endpoint treats the cache as stale and regenerates from scratch on next call.
- **Don't introduce a `STREAM mode` for the new endpoint.** A single specialist call is 10–30 s — fast enough that a plain POST/JSON response is the right UX. SSE adds complexity (the existing `streamVerdicts` is harder to test and already has known reconnection issues per prior HANDOFF).
- **Don't use `python-jose`, don't switch to wildcard CORS, don't import `Base` from anywhere except `aimusic_shared.models`.** See CLAUDE.md global gotchas.
- **Don't enforce prerequisite gating on the backend** by 422-ing requests for stem-only / ALS-only specialists when the inputs are missing. The route stays lenient so power users (and future "force run anyway" UI affordances) work. The tile-disabled state is purely a UX cost-protection layer in the frontend.
- **Don't auto-detect `has_stems` / `has_als` / `has_reference` inside SpecialistsPanel** by spelunking through `data.raw.phases[N]`. Surface those as `inputs: {hasStems, hasAls, hasReference}` in the adapter (Task 5b) so the panel takes a clean prop and stays decoupled from `final_json` schema shifts.

---

## Self-review

- [x] Spec coverage: backend route, helper extraction, cache semantics, frontend rewrite, CSS, tests, manual smoke
- [x] All file paths concrete and verified to exist (or are explicitly NEW)
- [x] Pseudocode is detail-dense but not full implementations — leaves room for adaptation
- [x] Anti-patterns capture the specific traps in this codebase (JSONB-dirty, validator authority, per-specialist version_set decision)
- [x] Validation gates are runnable from the project root, dependency-free beyond `docker compose up`
- [x] References real fixtures + the `authed_client` pattern from `test_songs_router.py`
- [x] No new DB migration — explicitly called out
- [x] Score: 8/10 (loss of a point because the validator pass-rate against the live CLI is poor and the implementer may hit failing verdicts during manual smoke — that's a separate follow-up PRP)

---
