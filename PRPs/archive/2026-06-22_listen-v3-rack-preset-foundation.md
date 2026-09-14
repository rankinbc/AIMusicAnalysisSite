name: "Listen V3 · PRP-1 — Rack Preset & Draft Foundation + Apply-to-Rack Loop"
description: |
  First slice of the V3 Listen (Work/View/Room) build-out. Establishes server-side persistence for
  rack presets, autosaved rack drafts, and (promoted from localStorage) viz presets — plus the
  reusable apply-to-rack loop that turns a stored chain into live `useAudioGraph` state. Pure additive
  (all net-new tables); no sharing/social dependencies. Unblocks every later slice (suggestions,
  game plan, coach-generated presets) because they all reuse the chain shape + apply loop.

## Purpose
Give the Listen page durable, server-backed rack state and a single canonical "apply a chain to the
audio graph" path. Today rack state in `useAudioGraph` is in-memory and resets on reload; `vizPresets`
is localStorage-only; and `Verdict.fix.dsp_chain` is never actually applied to the rack. This PRP fixes
the foundation so the rest of the V3 model (reviewer suggestions, adopted presets, coach/analysis-
generated full-chain presets, the Game Plan apply loop) has something real to build on.

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md

---

## Goal
Persist three new concepts and wire the apply loop:
- **`rack_presets`** — a named, full-chain snapshot bound to its origin `song_version` (which also determines the
  **owner — no `user_id`**), with a first-class `source` (user|coach|analysis). Portable via **JSON export/import**.
- **`rack_drafts`** — one autosaved working chain per `song_version` (the owner's) so unsaved tweaks survive reload.
- **`viz_presets`** — the existing localStorage viz "looks" promoted to a per-user server table.
- **Apply loop** — a standalone `applyChainToGraph(graph, chain)` + `snapshotChainFromGraph(...)` pair that
  is the ONE way a stored/suggested/AI-generated chain becomes live `useAudioGraph` state.

End state: from the Listen page a user can Save the current rack as a named preset, recall it (it audibly
applies), autosave is transparent (reload restores the draft), presets export/import as JSON to reuse
elsewhere, and viz presets round-trip through the server instead of localStorage.

## Why
- **Unblocks the whole V3 model.** Decisions D1.2–D1.5, D2.3 (accept = fork-to-preset), D4.3 (non-owner
  save), D5.2 (Game Plan), and D1.3 (coach/analysis emit full-chain presets) all depend on a real
  `RackPreset` + a working apply loop. See `docs/archive/brainstorming/brainstorming-session-2026-06-25-listen-modes-datamodel.md`.
- **Closes an existing gap (Δ3 in the reconciliation):** `Verdict.fix.dsp_chain` is currently a flag-only
  "applied" with no engine wiring. The apply loop built here is the same path verdict fixes / coach presets
  will use — build it once, reuse everywhere.
- **No-risk first slice.** All net-new tables, no migration of the analysis-scoped sharing model (that's PRP-2).

## What
User-visible: Save preset / Presets recall in the rack's bottom module; transparent autosave; "copy to
version"; viz presets persist across devices. Technical: 3 EF Core tables (+ Python mirror), a
`RackPresetEndpoints.cs` resource group, frontend TanStack Query hooks, and the apply/snapshot helpers.

### Success Criteria
- [ ] `rack_presets`, `rack_drafts`, `viz_presets` tables created via EF migration (+ raw SQL for the
      `rack_drafts` UNIQUE(song_version_id) and any partial index), mirrored in `shared/aimusic_shared/models.py`.
- [ ] BFF endpoints: list/save/delete rack presets (+ JSON export/import); get/upsert rack draft; list/save/delete
      viz presets — IDOR-scoped via version ownership (rack) / user_id (viz), verified with a **tracked** query.
- [ ] `applyChainToGraph` applies order + per-module params + master bypass to a real `AudioGraphHandle`;
      `snapshotChainFromGraph` produces a `chain_json` that round-trips byte-stable.
- [ ] Recall of a saved preset audibly changes the rack; reload restores the autosaved draft; a preset exports to
      JSON and re-imports (manifest-validated, drift-tolerant) to apply/save elsewhere.
- [ ] `viz_presets` server hooks replace the localStorage path in `vizPresets.ts` (with a one-time import of
      any existing localStorage presets so users don't lose them).
- [ ] All validation gates pass (BFF build+test, frontend tsc/lint/build/vitest, shared pytest/ruff/mypy).

## All Needed Context

### Documentation & References
```yaml
# DECISIONS & RECONCILIATION (read first — they define the model + why)
- file: docs/archive/brainstorming/brainstorming-session-2026-06-25-listen-modes-datamodel.md
  why: Domain 1 decisions D1.2–D1.5 (preset binding, draft, source-first-class, viz scope), D2.3, D4.6 provenance.
- file: docs/archive/brainstorming/listen-v3-schema-reconciliation-2026-06-25.md
  why: Entity verdict table + Δ2 (dsp_chain is the change currency) + Δ3 (apply loop is the gap) + build discipline.

# DESIGN HANDOFF (the chain shape + the binding map the apply loop must hit)
- file: PRPs/design_handoffs/design_handoff_listen_rack/PORTING_GUIDE.md
  section: "§3 State → audio-graph binding map" and "§4 Presets ↔ versions"
  critical: useRackState shape is { order, mod }; savePreset/recallPreset must persist a rack snapshot;
            apply = setEffectParams per module + reorder + masterBypass.

# REAL ENGINE SURFACE (the apply loop binds to these — confirm signatures as-of-today)
- file: components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts
  why: AudioGraphHandle (lines ~76-116): setEffectParams<K>(id, patch), reorder(order), getOrder(),
       setMasterBypass(b), resetAll(); EffectParamMap (~45-59). The handle is MEMOIZED (see gotcha).
- file: components/frontend-spectr-v2/src/features/listen/audio/state.ts
  why: per-module state interfaces + DEFAULT_ORDER (~234-248) + EQ_BANDS_DEFAULT (~62). chain_json mirrors this.
- file: components/frontend-spectr-v2/src/features/listen/rackManifest.ts
  why: RACK_MANIFEST / ModuleDescriptor / EffectId — the set of valid module ids the apply loop must tolerate.
- file: components/frontend-spectr-v2/src/features/listen/vizPresets.ts
  why: existing localStorage VizPreset { name, viz, stage }, key 'spectr.viz.presets.v1', cap 12 — the thing we server-ize.

# BFF PATTERNS TO MIRROR (entities, context, endpoints, IDOR scoping, the AsNoTracking trap)
- file: components/bff/src/Spectr.Data/Entities/SessionNote.cs
  why: closest existing per-(version,user) table shape to copy for rack_drafts/rack_presets.
- file: components/bff/src/Spectr.Data/Entities/Analysis.cs
  why: JSONB column pattern (final_json), [Column] snake_case, share columns (do NOT touch here).
- file: components/bff/src/Spectr.Data/AppDbContext.cs
  why: DbSet registration + OnModelCreating index/constraint config + where raw-SQL partial indexes go.
- file: components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs
  why: resource-group endpoint pattern + the TRACKED version-ownership lookup (NOT AsNoTracking — see gotcha).
- file: components/shared/aimusic_shared/models.py
  why: lines 1-6 forbid Python-first columns; mirror the 3 new tables here AFTER the EF migration. Copy SongVersion/SessionNote style.
- file: components/frontend-spectr-v2/src/api/types.ts
  why: hand-mirror DTOs (VersionDto ~142, JobResultsDto ~598 for finalJson:unknown pattern). Add Rack/Viz preset DTOs.
- file: components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts
  why: also the home (or a sibling chainApply.ts) for applyChainToGraph/snapshotChainFromGraph.
```

### Current Codebase tree (relevant slice)
```bash
components/
  bff/src/
    Spectr.Data/Entities/{SongVersion,SessionNote,Analysis,...}.cs
    Spectr.Data/AppDbContext.cs
    Spectr.Data/Migrations/        # 28 migrations, EF Core 10 owns schema
    Spectr.Bff/Endpoints/{Version,Report,...}Endpoints.cs
    Spectr.Bff/DTOs/
  shared/aimusic_shared/models.py  # SQLAlchemy MIRROR of EF entities (EF-first!)
  frontend-spectr-v2/src/
    features/listen/{useAudioGraph.ts, audio/state.ts, rackManifest.ts, vizPresets.ts, PresetBar.tsx}
    routes/_app/listen.$versionId.tsx
    api/{types.ts, fetcher.ts}
```

### Desired tree (files added)
```bash
components/bff/src/
  Spectr.Data/Entities/RackPreset.cs        # rack_presets entity
  Spectr.Data/Entities/RackDraft.cs         # rack_drafts entity
  Spectr.Data/Entities/VizPreset.cs         # viz_presets entity
  Spectr.Data/Migrations/<ts>_AddRackPresets.cs   # ef migrations add (+ raw SQL for unique/partial idx)
  Spectr.Bff/Endpoints/RackPresetEndpoints.cs     # presets + draft + viz endpoints
  Spectr.Bff/DTOs/RackPresetDtos.cs               # record DTOs
components/shared/aimusic_shared/models.py        # +RackPreset/+RackDraft/+VizPreset (mirror)
components/frontend-spectr-v2/src/features/listen/
  chainApply.ts                              # applyChainToGraph + snapshotChainFromGraph (the loop) + tests
  useRackPresets.ts                          # TanStack Query hooks (list/save/delete + draft + JSON export/import)
  useVizPresetsServer.ts                     # server-backed viz preset hooks (replaces localStorage in vizPresets.ts)
```

### Known Gotchas & Library Quirks
```text
# CRITICAL (EF-first): add C# entity -> `dotnet ef migrations add` -> THEN mirror in shared/models.py.
#   shared/aimusic_shared/models.py:1-6 forbids Python-first columns. Worker reads the mirror.
# CRITICAL (AsNoTracking trap): the write-path version-ownership lookup must use a TRACKED query.
#   AsNoTracking() ANYWHERE in the query makes the WHOLE query no-tracking and SaveChanges silently no-ops.
#   (This is the exact latent bug in the legacy /stems endpoint — see CLAUDE.md stems section.)
# CRITICAL (apply loop / memoized handle): useAudioGraph returns a useMemo(()=>({...}),[]) handle whose
#   methods close over refs, not React state. applyChainToGraph must take the handle as an arg and call its
#   methods imperatively; do NOT capture React state inside the loop. Apply order: setEffectParams per id ->
#   reorder(order) -> setMasterBypass. EQ is special: setEffectParams('eq',{ enabled, bands }) (full band array, no per-band setter).
# CRITICAL (manifest drift): chain_json stores the FULL chain. On apply, ignore unknown module ids and
#   missing params (tolerate older/newer manifests) — never throw mid-apply. Pitch is NOT an insert; never
#   put it in order[] and never setEffectParams it (it's the separate buffer lane).
# GOTCHA (IDOR): rack_presets/rack_drafts have NO user_id — scope them by VERSION OWNERSHIP (song_version -> song ->
#   user == actor) via the tracked lookup. viz_presets ARE user-scoped (filter user_id == actor). Never fetch-all-then-filter in C#.
# GOTCHA (unique index): rack_drafts UNIQUE(song_version_id) — one owner-draft per version. EF can express a plain unique
#   index fluently; if you make it a partial/filtered index, append raw SQL to Up()/Down() (CLAUDE.md gotcha).
# GOTCHA (NuGet audit): build may fail on transitive CVEs unless <NuGetAuditMode>direct</NuGetAuditMode> (already set).
# GOTCHA (frontend): no localStorage for server state; TS strict + verbatimModuleSyntax => `import type`;
#   CSS Modules, no inline styles unless dynamic; fetcher.ts (no axios). Provide a ONE-TIME localStorage->server
#   import for existing viz presets so users don't lose them, then stop writing localStorage.
# SCOPE: this PRP does NOT generate coach/analysis presets — those source values are RESERVED (CHECK allows them; no
#   generator writes them yet). The plug point is a no-op IPresetGenerator (DI default returns nothing); a future PRP-8
#   swaps in the real impl (coach first — verdict.fix.dsp_chain -> chain_json -> source=coach row; analysis later).
#   No copied_from_id / server copy — JSON export/import is the portability path.
```

## Implementation Blueprint

### Data models

**chain_json shape (canonical — mirrors `audio/state.ts`; superset of `Verdict.fix.dsp_chain`):**
```jsonc
{
  "order": ["djfilter","eq","gate","comp","sat","bitcrusher","ms","pan","tremolo","delay","reverb","limiter","trim"],
  "modules": {
    "eq":   { "enabled": true,  "bands": [/* EqBand[] */] },
    "comp": { "enabled": false, "thresholdDb": -18, "ratio": 2, "attackMs": 3, "releaseMs": 250, "kneeDb": 30, "makeupDb": 0, "mix": 1 }
    // ...one entry per module id present
  },
  "masterBypass": false
}
```
> Keep it shape-compatible with the per-module interfaces in `audio/state.ts`. A `Verdict.fix.dsp_chain`
> (`{type,params}[]`) maps into `modules` by `type`→id; that adapter lands in PRP-3/5, not here, but the
> shape must not preclude it.

**EF Core entities (C# — snake_case [Column], UUID PK via gen_random_uuid()):**
```csharp
// RackPreset.cs  -> table rack_presets   (VERSION-SCOPED — owner derived via song_version -> song -> user; NO user_id)
//   id, song_version_id(FK song_versions, ORIGIN + OWNER ANCHOR), name(varchar120),
//   source(varchar16, CHECK in user|coach|analysis, default 'user'),   // coach|analysis = RESERVED generation seam (no generator yet)
//   chain_json(jsonb),
//   created_in_session_id(uuid? no FK yet — PRP-4), via_grant_id(uuid? no FK yet — PRP-4),   // credit-chain provenance (from_suggestion_id added by PRP-3)
//   created_at, updated_at.  Index (song_version_id).   // NO user_id, NO copied_from_id (JSON export/import replaces server copy)
// RackDraft.cs   -> table rack_drafts   (VERSION-SCOPED owner draft; NO user_id — non-owner tweaks stay client-local until they Suggest)
//   id, song_version_id(FK), chain_json(jsonb), updated_at.  UNIQUE(song_version_id).
// VizPreset.cs   -> table viz_presets   (per-USER "looks" — viz presets ARE user-scoped, unlike rack presets)
//   id, user_id(FK), name(varchar120), viz_json(jsonb { viz, stage }), created_at, updated_at. Index (user_id).
```

**Python mirror (shared/aimusic_shared/models.py — AFTER migration):** add `RackPreset`, `RackDraft`,
`VizPreset` classes copying the `SongVersion`/`SessionNote` mapping style (JSONB, FK CASCADE, snake_case).

### List of tasks (in order)
```yaml
Task 1 — CREATE EF entities:
  CREATE components/bff/src/Spectr.Data/Entities/RackPreset.cs (MIRROR SessionNote.cs style; JSONB + source CHECK; NO user_id, NO copied_from_id)
  CREATE components/bff/src/Spectr.Data/Entities/RackDraft.cs (NO user_id)
  CREATE components/bff/src/Spectr.Data/Entities/VizPreset.cs (user-scoped — keeps user_id)

Task 2 — REGISTER + configure in AppDbContext.cs:
  ADD DbSet<RackPreset>/<RackDraft>/<VizPreset>
  CONFIGURE in OnModelCreating: index (song_version_id) on rack_presets, UNIQUE(song_version_id) on rack_drafts,
            index (user_id) on viz_presets, CHECK source IN ('user','coach','analysis'), default 'user',
            now() defaults on *_at, FK song_version_id (rack_presets/rack_drafts) + user_id (viz_presets) ON DELETE CASCADE
            (rows must not orphan on version/user delete — the codebase DOES use cascade FKs, e.g. shared models.py:311). (NO user_id / copied_from_id on rack_presets/rack_drafts.)

Task 3 — MIGRATION:
  RUN dotnet ef migrations add AddRackPresets --project src/Spectr.Data --startup-project src/Spectr.Bff
  EDIT the migration: if any index is partial/filtered, append raw SQL to Up()/Down(); verify CHECK constraint emitted.
  RUN dotnet ef database update (local) to confirm it applies.

Task 4 — MIRROR in Python:
  MODIFY components/shared/aimusic_shared/models.py: add RackPreset/RackDraft/VizPreset (copy SongVersion style). EF-first done.

Task 5 — DTOs:
  CREATE components/bff/src/Spectr.Bff/DTOs/RackPresetDtos.cs (record types: RackPresetDto [NO userId/copiedFromId; source
         user|coach|analysis; + fromSuggestionId?/createdInSessionId?/viaGrantId?], SaveRackPresetRequest, RackDraftDto,
         UpsertRackDraftRequest, RackPresetExport { name, source, chain, schemaVersion } [export/import envelope],
         VizPresetDto, SaveVizPresetRequest). NO CopyRackPresetRequest.

Task 6 — ENDPOINTS + SEAM:
  CREATE components/bff/src/Spectr.Bff/Endpoints/RackPresetEndpoints.cs (group below). Register in Program.cs map list.
  PRESERVE the TRACKED version-ownership lookup pattern from VersionEndpoints.cs (NOT AsNoTracking).
  DECLARE a no-op IPresetGenerator interface + NoOpPresetGenerator default (DI), mirroring PRP-0's sink convention — the
  future-PRP-8 plug point for source=coach/analysis generation. NO generation logic in this slice.

Task 7 — FRONTEND apply loop (the keystone):
  CREATE components/frontend-spectr-v2/src/features/listen/chainApply.ts: applyChainToGraph(graph, chain) +
         snapshotChainFromGraph(graph, moduleState) + Chain type. Pure, no React. + chainApply.test.ts (vitest).
  ADD graph.getMasterBypass() to AudioGraphHandle (it has setMasterBypass but no getter) — else snapshot loses bypass state.

Task 8 — FRONTEND hooks + wiring:
  CREATE useRackPresets.ts (list/save/delete + useRackDraft debounced autosave via fetcher.ts + JSON export/import:
    export = download/copy chain_json; import = parse -> chainApply drift-validate -> applyChainToGraph and/or save).
  CREATE useVizPresetsServer.ts; MODIFY vizPresets.ts to one-time import localStorage -> server then stop writing it.
  WIRE Save/Presets recall into the rack bottom module (PresetBar.tsx / listen.$versionId.tsx) using applyChainToGraph.

Task 9 — TESTS + GATES: unit tests for chainApply (round-trip, unknown-id tolerance, eq-bands, pitch-excluded),
  BFF endpoint tests (version-ownership IDOR, draft upsert uniqueness on song_version_id, JSON import drift-tolerance),
  then run all validation gates.
```

### Per-task pseudocode (critical details only)
```text
# Task 6 — save preset endpoint (BFF, C#)
POST /api/versions/{versionId}/rack/presets  (body: SaveRackPresetRequest { name, chain })
  user = ctx.User.id
  # TRACKED lookup (NO AsNoTracking anywhere in this query) — version OWNERSHIP is the scope (no user_id on the preset)
  version = db.SongVersions.Include(v => v.Song)
               .FirstOrDefault(v => v.Id == versionId && v.Song.UserId == user)   // IDOR gate
  if version is null -> 404
  preset = new RackPreset { Id=NewGuid, SongVersionId=versionId, Name=req.Name, Source="user", ChainJson=req.Chain }
  db.RackPresets.Add(preset); db.SaveChanges()
  return 201 RackPresetDto(preset)

# GET /api/versions/{versionId}/rack/presets  — library list (owner's own saves + accepted forks)
  verify version ownership (tracked); return presets WHERE song_version_id==versionId AND source=='user'
  # source=coach|analysis rows (once a future generator exists) surface via their own audition flow, not the library.

# JSON export/import — NO server copy endpoint (copied_from_id dropped). Export = client downloads an ENVELOPE
#   { name, source, chain, schemaVersion } (NOT raw chain_json — needs the name to round-trip to a named preset).
#   Import = client parses + VALIDATES the envelope (reject malformed JSON / missing name|chain.order|chain.modules;
#   manifest drift tolerated by chainApply's skip-unknown on apply) -> applyChainToGraph and/or POST as a new preset (above).

# PUT /api/versions/{versionId}/rack/draft  — autosave upsert, UNIQUE(song_version_id)
  verify version ownership (tracked); upsert by (song_version_id); set chain_json + now(); 200

# Task 7 — apply loop (frontend, framework-agnostic)
function applyChainToGraph(graph: AudioGraphHandle, chain: Chain) {
  const known = new Set(VALID_EFFECT_IDS)                  // from rackManifest; tolerate drift
  for (const id of chain.order) {
    if (!known.has(id) || id === 'pitch') continue          // skip unknown + pitch (not an insert)
    const mod = chain.modules[id]; if (!mod) continue
    graph.setEffectParams(id, mod)                          // eq passes { enabled, bands }
  }
  graph.reorder(chain.order.filter(id => known.has(id) && id !== 'pitch'))
  graph.setMasterBypass(chain.masterBypass ?? false)
}
function snapshotChainFromGraph(graph, moduleState): Chain {  // inverse, for Save + autosave
  // NOTE: the handle has setMasterBypass but NO getter today — ADD graph.getMasterBypass() (Task 7), else bypass is silently lost on save.
  return { order: graph.getOrder(), modules: structuredClone(moduleState), masterBypass: graph.getMasterBypass() }
}
```

### Integration Points
```yaml
DATABASE:
  - migration: "AddRackPresets — rack_presets (no user_id), rack_drafts (+ UNIQUE(song_version_id)), viz_presets"
  - mirror: "shared/aimusic_shared/models.py after migration (EF-first)"
ROUTES:
  - add to: Spectr.Bff/Program.cs -> app.MapRackPresetEndpoints();
DI:
  - register the no-op IPresetGenerator (NoOpPresetGenerator) — the future-PRP-8 generation plug point (PRP-0 sink convention)
FRONTEND:
  - hooks via fetcher.ts (no axios); TanStack Query keys ['versions', versionId, 'rack', 'presets'|'draft'], ['viz','presets']
  - apply loop reused later by Verdict-fix/coach-preset apply (Δ3) — keep it dependency-free
CONFIG: none (no new env)
```

## Validation Loop

### Level 1: Syntax & Style
```bash
cd components/bff && dotnet format && dotnet build
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint   # --max-warnings 0
ruff check components/shared/ && mypy components/shared/aimusic_shared/ --ignore-missing-imports
```

### Level 2: Unit Tests
```bash
cd components/bff && dotnet test                       # endpoint version-ownership IDOR + draft-uniqueness(song_version_id)
cd components/frontend-spectr-v2 && npx vitest run     # chainApply round-trip, unknown-id tolerance, eq bands, pitch excluded
pytest -q components/shared/tests/                     # mirror model imports/maps
```
Key cases to author (one expected / one edge / one failure each):
- chainApply: applies a full chain (expected); ignores an unknown module id & pitch (edge); never throws on missing params (failure).
- snapshot↔apply round-trip is stable INCLUDING masterBypass (expected — requires graph.getMasterBypass()).
- BFF: cannot save a preset onto another user's version → 404 (failure/IDOR); JSON import validates the envelope + saves onto
  the current owned version (expected); malformed/empty import rejected (failure); second draft PUT updates the same row, not a 2nd (edge — uniqueness on song_version_id).

### Level 3: Integration
```bash
docker compose -f docker/docker-compose.yml up -d
cd components/bff/src/Spectr.Bff && dotnet run &
cd components/frontend-spectr-v2 && npm run dev &
# Manual: open /listen/$versionId -> tweak rack -> Save preset -> reload (draft restores) ->
#         recall preset (audible apply) -> export to JSON -> import onto another version (validates + applies).
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
```

## Final Validation Checklist
- [ ] EF migration applies + reverts cleanly; CHECK + UNIQUE(song_version_id) present; Python mirror imports.
- [ ] BFF build+test green; version-ownership IDOR + draft-uniqueness(song_version_id) + JSON import drift covered.
- [ ] Frontend tsc/lint/build/vitest green; chainApply tests cover drift + pitch + eq.
- [ ] Recall audibly applies; reload restores draft; export/import round-trips; viz presets migrated off localStorage (one-time import).
- [ ] No analysis-scoped sharing touched (that's PRP-2); coach/analysis source values reserved + no-op IPresetGenerator seam (generation = future PRP-8).
- [ ] README/types updated where features changed.

---

## Known Gaps / Must-Resolve (adversarial review 2026-06-25)
> **RESOLVED 2026-06-25 (design decision):** rack presets are **version-scoped, not user-owned** — owner derives via
> `song_version → song → user`, so `rack_presets`/`rack_drafts` carry **NO `user_id`** (viz presets stay user-scoped).
> That dissolves G1 + G2 outright. Presets are portable via **JSON export/import** (the `copied_from_id` self-FK + the
> server copy endpoint are dropped — cross-version reuse is rare and export/import covers it more generally).
- ✅ **G1 — coach/analysis preset ownership (was: unowned + non-nullable `user_id`). RESOLVED by dropping `user_id`
  entirely:** a `source=coach/analysis` preset is just a row on a version with no human author — no nullable column, no
  "system actor." `source` CHECK = `user|coach|analysis` (`coach|analysis` **reserved** — no generator yet); the plug point
  is a **no-op `IPresetGenerator`** (DI default), with real generation filed as **PRP-8** (coach first —
  `verdict.fix.dsp_chain → chain_json`; analysis later). Conscious trade-off: we ship 2 reserved-but-unreachable enum values
  (against the review's strict "no dead values" advice) as a deliberate forward-compat seam. NOTE: the `reviewer` value is
  also dropped — accepted suggestions fork as `source='user'` + `from_suggestion_id` (PRP-3), so a reviewer tag is redundant.
- ✅ **G2 — library-listing filter (was: unspecified). RESOLVED:** `GET …/rack/presets` is per-version, filter
  `song_version_id=… AND source='user'` (no `user_id`). `source=coach/analysis` rows surface via their own audition flow,
  never the owner's library list.
- ⚠ **G3 — localStorage→server viz import hand-waved.** Define: run-once trigger (first authed load), dedup by name,
  stop writing localStorage after import, server-wins on multi-device divergence. (viz presets keep `user_id`.)
- ⚠ **G4 — draft vs Room shared-chain boundary.** `RackDraft` is **solo, owner-only** (`UNIQUE(song_version_id)`); a
  non-owner's in-progress tweak stays **client-local until they submit a Suggestion**; Room edits write the session shared
  chain (PRP-4), never a personal draft. State this so the three never clobber each other (see PRP-4 G4).

## Anti-Patterns to Avoid
- Don't model in Python first — EF Core owns schema; mirror after (models.py:1-6).
- Don't use AsNoTracking() on the write-path ownership lookup (silent SaveChanges no-op).
- Don't capture React state inside applyChainToGraph — drive the memoized handle imperatively.
- Don't throw on unknown module ids / manifest drift — tolerate and skip.
- Don't put pitch in order[] or setEffectParams it — it's the separate buffer lane.
- Don't invent a second "change" format — keep chain_json compatible with audio/state.ts and Verdict.fix.dsp_chain.
- Don't keep writing viz presets to localStorage once the server path exists (import once, then stop).
- Don't add user_id to rack_presets/rack_drafts — they're version-scoped (ownership derives from song_version); viz_presets are the user-scoped exception.
- Don't build a server-side "copy to version" — JSON export/import is the portability path (copied_from_id dropped).
- Don't write source=coach/analysis rows here — reserved for the future IPresetGenerator (PRP-8); this slice ships storage + the no-op seam only.
