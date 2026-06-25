name: "Listen V3 · PRP-5 — Game Plan, Version Comparison & Outcome Telemetry"
description: |
  The keystone that turns Listen-page activity into the next version. A per-version GamePlan is the unified drain
  for every change source defined across this epic — coach, reviewer suggestion, analysis verdict, adopted preset,
  Room recap — into one curated, status-tracked change-set the user takes back to their DAW. VersionComparison
  (v↔v) fills the existing DeltaCard placeholder and closes the v(n)→v(n+1) loop. Owner-only (Work-mode surface, X.2).
  Reuses the dsp_chain currency; no new worker actor. Depends on PRP-1 (Chain), PRP-3 (Suggestion/accept), PRP-4 (recap).

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md · 6. One change currency (dsp_chain), one drain (GamePlan).

---

## Goal
- **`game_plans`** — per-version (1:1), `{ song_version_id, status }`. "What this mix needs," informing v(n+1).
- **`game_plan_items`** — the unified drain: `{ game_plan_id, source ∈ {coach,reviewer,analysis,adopted_preset,recap},
  ref_type, ref_id, title, detail, target_change (dsp_chain/Chain), status ∈ {open,applied,dismissed} }`. Seeded from
  analysis verdicts; accumulates via drain hooks on accept-suggestion / adopt-preset / recap-publish; user-curatable.
- **`version_comparisons`** — derived v↔v artifact `{ from_version_id, to_version_id, metric_deltas, plan_adherence }`
  → powers the existing `DeltaCard` placeholder (sibling to `compare_cache`, which is v↔reference). `metric_deltas` is the
  objective diff (factual); `plan_adherence` for v1 = which plan items the owner MARKED applied (NO metric inference — #3 (a)).
- **Owner-only** access (Work-mode surface, X.2). No new worker actor (BFF computes + caches the comparison on demand).

## Why
- **It's the user's actual goal.** From the brainstorm: "the data on what presets were adopted ends up part of the
  user's game plan — the changes to make in their DAW to create the next version." D5.1/D5.2/D5.3/D5.5.
- **Unifies everything built so far.** Coach (source=coach), reviewer suggestions (PRP-3), analysis verdicts (the
  prototype `PLAN_ITEMS`), adopted presets (PRP-1/3 fork), and Room recaps (PRP-4) all converge into ONE list.
- **Fills a real placeholder.** The v2 frontend already ships a `DeltaCard` placeholder for v↔v comparison — this is its data.

## What
The owner sees a curated Game Plan per version (seeded from analysis, grown by what they adopt), marks items
applied/dismissed, and on the next version sees a DeltaCard showing metric movement + which planned changes landed.
Technical: 3 tables (+ Python mirror), drain-hook inserts into PRP-3/4 flows, `GamePlanEndpoints.cs` +
`ComparisonEndpoints.cs`, frontend hooks + DeltaCard wiring. No new dramatiq actor. (No `apply_outcomes` in v1.)

### Success Criteria
- [ ] `game_plans` (1:1 version) + `game_plan_items` + `version_comparisons` via EF migration; Python mirror. (No `apply_outcomes` in v1.)
- [ ] `GET /versions/{id}/plan` lazily creates the plan and seeds `source=analysis` items from the version's verdicts
      IDEMPOTENTLY (each GET adds verdicts not already represented by `ref_id` — catches up on-demand/rerun verdicts; no dup; G2).
- [ ] **Drain hooks**: accepting a Suggestion (PRP-3) inserts a `game_plan_item(source=reviewer)`; adopting/forking a
      preset inserts `source=adopted_preset`; recap-publish (PRP-4) inserts `source=recap` — all in the same tx as the source action.
- [ ] `target_change` reuses the `dsp_chain`/`Chain` shape (no parallel change format).
- [ ] `GET /versions/{id}/comparison?from={fromVersionId}` computes + caches a `VersionComparison`: objective
      `metric_deltas` + `plan_adherence` = items the owner marked applied (no metric inference) → DeltaCard. Cached like `compare_cache`.
- [ ] All plan/comparison routes owner-gated (Work-mode, X.2). All validation gates pass.

## All Needed Context
```yaml
# DECISIONS + RECONCILIATION
- file: _bmad-output/brainstorming/brainstorming-session-2026-06-25-listen-modes-datamodel.md
  why: D5.1 (per-version plan), D5.2 (unified GamePlanItem drain + sources), D5.3 (VersionComparison→DeltaCard), D5.5 (outcome telemetry), X.2 (owner-only).
- file: _bmad-output/brainstorming/listen-v3-schema-reconciliation-2026-06-25.md
  why: Δ2 (dsp_chain is the change currency), the GamePlanItem 'source=analysis' seed = prototype PLAN_ITEMS, compare_cache is v↔reference (VersionComparison is the v↔v sibling).

# EXISTING SURFACES TO REUSE / SIBLING
- file: components/bff/src/Spectr.Data/Entities/CompareCache.cs
  why: the existing v↔REFERENCE compare (match_score, sub_scores, delta_metrics, suggestions, unique(track_version_id,reference_id),
       computed+cached). version_comparisons is the v↔v SIBLING — mirror its cache pattern, different key.
- file: components/bff/src/Spectr.Data/Entities/Verdict.cs
  why: Verdict.fix (jsonb) incl. fix.dsp_chain ({type,params}[]) — the change shape target_change aligns with; analysis-source plan items derive from verdicts.
- file: components/bff/src/Spectr.Data/Entities/VerdictUserState.cs
  why: the existing `applied` ("marked applied in DAW") + per-user overlay — the closest existing 'plan adherence' signal; reuse the idea, not the table.
- file: components/bff/src/Spectr.Data/Entities/Analysis.cs
  why: final_json holds the metrics version_comparisons diffs (loudness/spectrum/stereo/etc.).
- file: components/frontend-spectr-v2/src/...  (DeltaCard placeholder in song-detail)
  why: the placeholder this PRP fills; grep 'DeltaCard'. Wire useVersionComparison into it.
- file: components/bff/src/Spectr.Bff/Endpoints/CompareEndpoints.cs
  why: the compute-and-cache endpoint pattern for the existing compare; mirror for the v↔v comparison.

# DEPENDENCIES (drain hooks land in these flows)
- file: PRPs/listen-v3-view-feedback-suggestions.md
  why: POST /suggestions/{id}/accept — EXTEND to also insert game_plan_item(source=reviewer, target_change=suggestion.chain).
- file: PRPs/listen-v3-rack-preset-foundation.md
  why: Chain shape for target_change; adopt/fork → game_plan_item(source=adopted_preset).
- file: PRPs/listen-v3-room-sessions.md
  why: recap publish → game_plan_item(source=recap) alongside the Comment rows.
- file: components/bff/src/Spectr.Bff/Services/AccessService.cs
  why: owner gate (X.2) — plan/comparison are owner-only.
- file: components/shared/aimusic_shared/models.py
  why: mirror the 3 new tables AFTER the migration (EF-first).
```

### Desired tree (files added)
```bash
components/bff/src/
  Spectr.Data/Entities/{GamePlan,GamePlanItem,VersionComparison}.cs   # NEW (no ApplyOutcome in v1)
  Spectr.Data/Migrations/<ts>_AddGamePlan.cs
  Spectr.Bff/Services/GamePlanService.cs        # seed-from-verdicts (idempotent, by seed_key) + drain-hook insert (called by PRP-3 accept etc.)
  Spectr.Bff/Services/VersionCompareService.cs  # compute v↔v metric deltas + plan adherence (applied-marks) from two final_json, cache
  Spectr.Bff/Endpoints/GamePlanEndpoints.cs     # plan + items
  Spectr.Bff/Endpoints/ComparisonEndpoints.cs   # GET /versions/{id}/comparison
  Spectr.Bff/DTOs/GamePlanDtos.cs
components/shared/aimusic_shared/models.py
components/frontend-spectr-v2/src/features/...
  useGamePlan.ts      # plan + items (add/patch/delete)
  useVersionComparison.ts   # DeltaCard data
```

### Data models (C#)
```csharp
// GamePlan.cs -> game_plans  (PK song_version_id, 1:1 like share_settings)
//   song_version_id (uuid PK FK), status (varchar12 CHECK open|in_progress|done, default 'open'), created_at, updated_at.
// GamePlanItem.cs -> game_plan_items
//   id (uuid PK), game_plan_id (uuid FK = song_version_id), source (varchar16 CHECK coach|reviewer|analysis|adopted_preset|recap),
//   ref_type (varchar24), ref_id (varchar40?),       // polymorphic provenance — STRING (holds ULID verdict ids 'vrd_…' AND uuid ids); NO FK (soft pointer, so dismissed/applied items survive a verdict cascade-delete)
//   seed_key (varchar200?),                          // dedup key for source=analysis = specialist_slug + ':' + headline (verdict ids are NOT stable across specialist re-runs — G2)
//   title (varchar200), detail (text?), target_change (jsonb?),   // dsp_chain/Chain (Δ2) — title/detail/target_change COPIED at seed time so a vanished verdict leaves a self-contained item
//   status (varchar10 CHECK open|applied|dismissed, default 'open'), created_at, applied_at (timestamptz?).
//   Index (game_plan_id),(game_plan_id, status); UNIQUE(game_plan_id, seed_key) WHERE source='analysis' (raw SQL — idempotent re-seed under concurrent GETs).
// VersionComparison.cs -> version_comparisons   (sibling of compare_cache, v↔v)
//   id (uuid PK), from_version_id (uuid FK song_versions), to_version_id (uuid FK song_versions),
//   metric_deltas (jsonb), plan_adherence (jsonb), computed_at.  UNIQUE(from_version_id, to_version_id).
//   plan_adherence (v1) = { itemId: appliedBool } from the owner's marks — NOT metric inference (#3 (a)).
// (apply_outcomes table DEFERRED — the item's own applied/dismissed status is the v1 signal; revisit kept/reverted telemetry later.)
```

### How the drain works (the key behavior)
```text
SEED (source=analysis): GET /versions/{id}/plan lazily creates game_plans[versionId] and seeds game_plan_items from the
  version's verdicts IDEMPOTENTLY ON EACH GET — for each current verdict, seed_key = specialist_slug + ':' + headline, then
  INSERT … ON CONFLICT (game_plan_id, seed_key) WHERE source='analysis' DO NOTHING an open item (title=verdict.headline,
  detail=verdict.summary, target_change=verdict.fix.dsp_chain, ref_type='verdict', ref_id=verdict.id [STRING — ULID],
  seed_key, status='open'). DEDUP IS BY CONTENT KEY, NOT verdict id — ids are ULIDs that change on every specialist re-run (G2).
  Catches up on-demand specialists + per-phase-rerun-unlocked verdicts; the UNIQUE(game_plan_id, seed_key) makes it safe under
  concurrent GETs; dismissed/applied items keep their seed_key so those verdicts are skipped (decisions respected). Each item
  COPIES title/detail/target_change at seed time, so a vanished verdict (full re-analyze cascade-deletes verdicts) leaves a
  harmless self-contained item — ref_id has NO FK. Dismissable.
DRAIN HOOKS (other sources) — each fires IN THE SAME TX as the source action (via GamePlanService):
  • PRP-3 accept Suggestion  -> item(source='reviewer', ref='suggestion', target_change=suggestion.chain)
  • adopt/fork a preset      -> item(source='adopted_preset', ref='rack_preset', target_change=preset.chain)
  • PRP-4 recap publish      -> item(source='recap', ref='session') alongside the Comment rows
  • coach apply (a fix/preset)-> item(source='coach', ref='coach_message'/'verdict')
USER CURATION: POST /plan/items (manual add) · PATCH /plan/items/{id} {status:applied|dismissed} · DELETE.
COMPARISON: GET /versions/{id}/comparison?from={fromId} -> VersionCompareService diffs from.final_json vs to.final_json
  (loudness/spectrum/stereo/dynamics metrics) for the objective metric_deltas. plan_adherence (v1) = simply WHICH plan
  items the owner MARKED applied — NO change-type→metric inference (#3 (a); the map is fragile — one tweak moves several
  metrics, attribution is ambiguous — so it's deferred). The DeltaCard shows objective deltas + the applied checklist side
  by side, never claiming a metric "proves" a specific change landed. Cache the row (unique from→to), recompute if either analysis changes.
```

### Tasks
```yaml
Task 1 — ENTITIES: GamePlan/GamePlanItem/VersionComparison.cs.  (No ApplyOutcome in v1.)
Task 2 — CONTEXT: DbSets + CHECKs + unique(song_version_id), unique(from,to) + indexes; ref_id is varchar40 with NO FK (soft
         provenance); partial UNIQUE(game_plan_id, seed_key) WHERE source='analysis' (raw SQL); game_plan_id + version FKs ON DELETE CASCADE.
Task 3 — MIGRATION: ef migrations add AddGamePlan; run update.
Task 4 — MIRROR: shared/models.py.
Task 5 — SERVICES: GamePlanService (seed-from-verdicts + InsertDrainItem) ; VersionCompareService (metric_deltas diff + adherence=applied-marks + cache).
Task 6 — DRAIN HOOKS: call GamePlanService.InsertDrainItem from PRP-3 accept, the preset-adopt path, PRP-4 recap-publish (same tx).
Task 7 — DTOs + ENDPOINTS: GamePlanEndpoints (plan/items) + ComparisonEndpoints; owner-gate via AccessService; register in Program.cs.
Task 8 — FRONTEND: useGamePlan + useVersionComparison; wire useVersionComparison into the EXISTING DeltaCard element in
         songs.$songId.tsx (it already calls openCompare — it is a LIVE element, not an empty placeholder; adjust scope accordingly) + a Plan panel.
Task 9 — TESTS + GATES.
```

### Endpoints
```text
GET    /api/versions/{id}/plan                 owner  -> { plan, items[] }  (lazy-create + seed analysis items)
POST   /api/versions/{id}/plan/items           owner  body { source, refType, refId?, title, detail?, targetChange? }
PATCH  /api/plan/items/{itemId}                owner  body { status }   (applied/dismissed; set applied_at)
DELETE /api/plan/items/{itemId}                owner
GET    /api/versions/{id}/comparison?from={f}  owner  -> VersionComparison (compute+cache)  [DeltaCard]
# (POST /outcomes + apply_outcomes DEFERRED — v1 adherence = the plan item's own applied/dismissed status.)
```

### Integration Points
```yaml
DATABASE: AddGamePlan (3 tables: game_plans, game_plan_items, version_comparisons); mirror in shared/models.py
SERVICES: GamePlanService (drain) called by PRP-3 accept + preset-adopt + PRP-4 recap-publish; VersionCompareService (cached compute)
ROUTES: Program.cs api.MapGamePlanEndpoints(); api.MapComparisonEndpoints();
FRONTEND: wire DeltaCard placeholder -> useVersionComparison; Plan panel -> useGamePlan
REUSE: dsp_chain/Chain (Δ2) for target_change; AccessService owner gate (X.2); compare_cache caching pattern
```

## Validation Loop
### Level 1
```bash
cd components/bff && dotnet format && dotnet build
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint
ruff check components/shared/ && mypy components/shared/aimusic_shared/ --ignore-missing-imports
```
### Level 2
```bash
cd components/bff && dotnet test
cd components/frontend-spectr-v2 && npx vitest run
pytest -q components/shared/tests/
```
Author (expected / edge / failure):
- Plan lazy-create + seed: first GET creates plan + seeds analysis items from verdicts (expected); empty when no verdicts (edge);
  a 2nd GET after a new specialist runs adds only the new verdict, no duplicates (edge — idempotent additive seed, G2).
- Drain: accepting a Suggestion inserts exactly one item(source=reviewer) in the same tx (expected); rolled back if accept fails (failure).
- target_change carries the suggestion's chain unchanged (expected — no parallel format).
- Comparison: diff two final_json → metric_deltas; an item marked applied whose metric moved as expected → adherence true (expected);
  a non-owner requesting the plan/comparison → 403 (failure, X.2).
- Adherence: an item the owner marked applied shows in plan_adherence; metric_deltas computed independently (expected — no inference).
### Level 3
```bash
docker compose -f docker/docker-compose.yml up -d
cd components/bff/src/Spectr.Bff && dotnet run &
# owner opens plan (seeded from analysis) -> accepts a reviewer suggestion (item drains in) -> marks it applied ->
# uploads v(n+1) -> DeltaCard shows metric deltas + that the item landed.
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
```

## Final Validation Checklist
- [ ] 3 tables migrate/revert; unique(song_version_id) + unique(from,to); Python mirror imports.
- [ ] Plan seeds from verdicts idempotently (additive by ref_id, G2); drain hooks insert items transactionally from accept/adopt/recap.
- [ ] target_change == dsp_chain/Chain (one currency); comparison fills DeltaCard; adherence = user-applied marks only (no metric inference, #3 (a)).
- [ ] All routes owner-gated (X.2); frontend gates green; DeltaCard wired.

---

## Known Gaps / Must-Resolve (adversarial review 2026-06-25)
- ✅ **G1 — "plan adherence" mapping (was: undefined). RESOLVED #3 (a):** v1 adherence = which plan items the owner MARKED
  applied. Keep the objective `metric_deltas`; DROP the change-type→metric inference (fragile — one tweak moves several
  metrics, attribution ambiguous). The DeltaCard shows objective deltas + the applied checklist, never claiming a metric
  "proves" a change landed. The change→metric map can be added later behind the same `metric_deltas` if ever wanted.
- ✅ **G4 — `apply_outcomes` reader (was: reader-less schema). RESOLVED:** the table is DROPPED from v1 — the plan item's own
  `applied/dismissed` status is the adherence signal. Revisit a kept/reverted telemetry log when a real consumer exists.
- ✅ **G2 — re-seed. RESOLVED — lazy idempotent additive seed, dedup by CONTENT KEY (corrected post-adversarial-review):**
  re-running the same audio through the same pipeline is deterministic, so there's nothing to "supersede" — a version's
  verdicts grow ADDITIVELY (on-demand specialists accumulate; per-phase rerun unlocks stem-clash/reference verdicts). So on
  each `GET /plan`, insert an open item for any current verdict whose **`seed_key = specialist_slug + ':' + headline`** isn't
  already a `source=analysis` item. **Dedup is by content key, NOT verdict id** — the review confirmed in code: (a) verdict ids
  are ULID strings (`vrd_…`, `MaxLength(40)`), so `ref_id` is string-typed not uuid; (b) `run_specialist` mints a NEW id with no
  upsert on every re-run, so dedup-by-id would duplicate on a normal specialist re-run. `UNIQUE(game_plan_id, seed_key) WHERE
  source='analysis'` makes the insert idempotent under concurrent GETs. `ref_id` is a **no-FK soft pointer** (so a
  dismissed/applied item survives the verdict cascade-delete on full re-analyze, keeping its seed_key → still skipped). Items
  copy title/detail/target_change at seed time → a vanished verdict leaves a harmless self-contained item. Residual edge: a
  prompt rewrite that changes a headline re-seeds the same finding once under the new key — acceptable; normalize the headline
  or switch to (slug, category) later if it bites.
- ⚠ **G3 — drain seam.** Consume the `IGamePlanSink` interface declared in PRP-3 G1 (no-op until this PRP); don't make PRP-3 depend on this code.

## Anti-Patterns to Avoid
- Don't invent a second change format — target_change is dsp_chain/Chain.
- Don't INFER applied items from metrics — v1 adherence = the owner's applied marks only; metric_deltas are shown but never attributed to a specific change (#3 (a)).
- Don't build apply_outcomes in v1 — adherence = the plan item's own applied/dismissed status (revisit kept/reverted telemetry later).
- Don't generalize compare_cache destructively — version_comparisons is a sibling (v↔v), leave v↔reference intact.
- Don't expose the plan to non-owners — Work-mode, owner-only (X.2).
- Don't add a worker actor — BFF computes + caches the comparison on demand (no heavy ML).
- Don't model in Python first; don't AsNoTracking write lookups.
