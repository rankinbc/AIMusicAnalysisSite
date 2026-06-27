name: "Analysis Results Page Redesign — Build PRP"
description: |
  Implementation blueprint for the Analysis Results page redesign in `components/frontend-spectr-v2`.
  Design source of truth: `PRPs/analysis-results-page-redesign.md` (spec) + `PRPs/design_handoffs/design_handoff_results_redesign/README.md` (Claude Design handoff).
  Data shapes: `PRPs/analysis-data-contract.md`. This PRP is the engineering plan; Claude Design owns visual polish against the handoff.

---

## Goal

Restructure the results page (`/songs/{songId}/results/{jobId}`) from its current artifact-leaking layout into a clean persistent frame + 7-tab body, and add the cross-page **Coach Mix** flow that carries selected fixes from the Actions tab to the Listen page.

**End state (Phase 1 of this PRP):**
- Persistent frame: track identity + input chips + a tiny always-on `<audio>` player + a single "N findings · M fixable" vital; persistent Uploads/Re-analyze sidebar (no History).
- Tabs: **Track Info · Analysis · Findings · Actions · AI Coach · Project(.als) · Debug**.
- Coach Mix producer side (Actions tab): per-fix selection → `sessionStorage` handoff + compiled rack; **"Sounds Good — Save to Game Plan"** persisting a `RackPreset` (`source='coach'`) on the version.
- Coach Mix consumer side (Listen Coach tab): checkboxes per rack-able fix (solo/pair), a **Coach Mix** button applying the full compiled rack, 👍/👎 per fix in `localStorage`.
- All prior-version artifacts removed (spec §12).

**Deferred to Phase 2 (specced, NOT in this PRP):** timed Room-style Coach announcements on Listen; the Specialist Team modal. **Deferred backend ask:** loudness/section time-series in `final_json`.

## Why

- The current page leaks stale internals (a wrong "8 of 12 phases" ring, "unlock +N specialists" upsell, raw worker phase names, genre `other`, a redundant Re-analyze card, a History panel for a 1-analysis-per-version model). It reads as unfinished.
- One concept per tab makes the report scannable and the fix path (Findings → Actions → hear it on Listen) coherent.
- Coach Mix turns static advice into an audible, applyable rack — the core product loop.

## What

User-visible behavior is fully described in the spec (`PRPs/analysis-results-page-redesign.md` §2–§9). This PRP covers the engineering to realize Phase 1.

### Success Criteria
- [ ] Tab bar renders `Track Info · Analysis · Findings · Actions · AI Coach · Debug` (+ `Project` only when `results.alsProject`). Active tab is a deep-linkable URL search param.
- [ ] Header shows track name + version + input chips + a tiny persistent player (plays `GET /api/versions/{id}/audio?t=<jwt>`, survives tab switches) + the "N findings · M fixable" vital. **No** grade/score/BPM/key in the header.
- [ ] Sidebar shows Uploads + Re-analyze only (no History). Re-analyze preserves the entitlement→`UpgradeSheet` flow.
- [ ] Track Info renders waveform/spectrogram, loudness & dynamics, tonal balance bars, stereo, tempo/key/duration/genre (genre `other`→"Uncategorized"), and StreamingReadiness as a small bottom section. Empty/not-applicable states never show raw zeros/`other`.
- [ ] Analysis renders collapsed per-phase explainer cards (friendly name · your value · what this means) with re-run (4/5/8) + retry (failed) preserved.
- [ ] Findings = today's Problems behavior, renamed everywhere (`problems`→`findings` tab key, label, badge), with a "See fix in Actions →" bridge.
- [ ] Actions: each rack-able fix has a selection checkbox; selection + compiled rack persist to `sessionStorage`; "Sounds Good — Save to Game Plan" POSTs a `RackPreset` with `source='coach'`.
- [ ] Listen Coach tab bottom section reads the `sessionStorage` handoff, renders a checkbox per rack-able fix (toggle applies/removes its `dsp_chain` on the live graph), a "Coach Mix" button applies the full compiled rack, and 👍/👎 persists to `localStorage`.
- [ ] Debug renders the pipeline diagram (nodes=phases, edges=dependency chain) + per-phase input/output JSON panels + full raw JSON (today's RawTab).
- [ ] All artifacts in spec §12 removed.
- [ ] All frontend gates green: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run`, `npm run lint:css`. BFF green if touched: `dotnet build && dotnet test`.

## All Needed Context

### Documentation & References
```yaml
- file: PRPs/analysis-results-page-redesign.md
  why: THE spec. Frame, all 7 tabs, Coach Mix storage contract (§8), phasing (§13).
- file: PRPs/design_handoffs/design_handoff_results_redesign/README.md
  why: File map (old→new tab table), constraints (do-NOT list), reuse pointers.
- file: PRPs/analysis-data-contract.md
  why: Every render shape. CRITICAL §"Shape notes" — phase5 nesting, band-key naming, empty/`other`/zeroed states.

- file: components/frontend-spectr-v2/src/features/results/ReportView.tsx
  why: The orchestrator being restructured. Already computes phases, moves (buildMoves), inputs, faultCount, dispatchReanalyze, the sessionStorage idiom (lines 90-105), UpgradeSheet wiring.
- file: components/frontend-spectr-v2/src/features/results/ResultsTabs.tsx + results-tab-keys.ts
  why: Tab strip + tab-key union. Rename problems→findings; add trackinfo + debug keys; reorder.
- file: components/frontend-spectr-v2/src/features/results/AnalysisTab.tsx
  why: Today's mega-tab to SPLIT. Source of Track-Info pieces (SpectrumTab bars, dial/stats, uploads) and Analysis pieces (phase-by-phase list). See task notes.
- file: components/frontend-spectr-v2/src/features/results/SpectrumTab.tsx
  why: The 7-band energy bars live inline here (BANDS array L28-37, normalize `(raw+60)/60` L64). Reuse for Track Info tonal balance. No standalone FrequencyBars exists.
- file: components/frontend-spectr-v2/src/features/results/StereoCard.tsx
  why: Track Info stereo card. Props {width, correlation, monoCompat} (L13-17).
- file: components/frontend-spectr-v2/src/features/results/StreamingReadiness.tsx
  why: Track Info bottom section. Props {lufs, truePeakDb, clippingDetected} (L16-20).
- file: components/frontend-spectr-v2/src/features/results/ProblemsTab.tsx + problems-helpers.ts
  why: Findings tab. faultCount lives here. Rename surface, keep behavior.
- file: components/frontend-spectr-v2/src/features/results/GamePlan.tsx + MoveCard.tsx + move-model.ts
  why: Actions tab. buildMoves(verdicts, top_fixes, coached_fixes). Add selection + save.
- file: components/frontend-spectr-v2/src/features/results/RawTab.tsx
  why: Debug seed (copy-to-clipboard pattern). Extend with diagram + per-phase I/O panels.
- file: components/frontend-spectr-v2/src/features/results/ProjectTab.tsx
  why: Conditional Project tab (gated on results.alsProject). Keep as-is.
- file: components/frontend-spectr-v2/src/api/types.ts
  why: JobResultsDto (L861-880: waveformImageUrl, spectrogramImageUrl, alsProject, versionId/Label/Number, analysisId); VerdictFix (L1252-1260: dsp_chain, section.start_seconds/end_seconds, ableton_hint).
- file: components/frontend-spectr-v2/src/api/hooks.ts
  why: useVerdicts, useJobResults, useVersionFiles, useReanalyzeVersion, useRunSpecialist, useRerunPhase, useEntitlements.

- file: components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts
  why: Listen DSP graph. compiledRack MUST match its param shape (EQ/comp/sat/M-S/pitch) — NO translation layer.
- file: components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx + data.ts + listenRack.css
  why: Listen rack UI (Coach Mix consumer host) + the `announce(message,label)` banner (Phase-2 reuse target).
- file: components/frontend-spectr-v2/src/features/listen/useStemEngine.ts
  why: The `?t=<jwt>` audio-URL build pattern for the tiny header player.

- file: components/bff/src/Spectr.Data/Entities/RackPreset.cs
  why: REUSE for Save-to-Game-Plan. Already version-scoped: SongVersionId, Name, ChainJson(jsonb), Source CHECK('user'|'coach'|'analysis'), timestamps. No UserId (ownership via version→song→user).
- file: components/bff/src/Spectr.Bff/Endpoints/RackPresetEndpoints.cs
  why: Existing POST /versions/{versionId}/rack/presets (ownership probe OwnsVersion L44-49; Add+SaveChanges L95-96; 201). Save-to-Game-Plan = POST with source='coach'. Confirm/extend a list-by-version GET for Game Plan display.
- file: components/bff/src/Spectr.Data/Migrations/20260625183324_AddRackPresets.cs
  why: Migration exemplar (CheckConstraint L51, unique index L83-86) IF a schema tweak is needed (likely none — reuse as-is).

- file: CLAUDE.md (→ frontend-spectr-v2 + bff sections)
  why: Stack rules + gotchas. Audio token leak, audio re-mount on token refresh, AsNoTracking write-path bug, EF partial-index raw SQL, no Tailwind/shadcn, CSS Modules + tokens only.
```

### Current vs Desired (results feature folder)
```bash
# CURRENT tabs (ReportView/ResultsTabs): actions · problems · analysis · project · files
# DESIRED tabs: trackinfo · analysis · findings · actions · coach · project(cond) · debug

# NEW files (under src/features/results/ unless noted):
TrackInfoTab.tsx (+ .module.css)        # visuals/loudness/tonal/stereo/stats/streaming
AnalysisTab.tsx                          # REWRITE → collapsed per-phase explainer cards
phase-explainer-copy.ts                  # static "what it measures / what this means" per phase
DebugTab.tsx (+ .module.css)             # pipeline diagram + per-phase I/O + raw json (absorbs RawTab)
coach-mix-storage.ts                     # sessionStorage/localStorage read/write helpers + CoachMixHandoff type
coach-mix-model.ts                       # compileRack(selectedFixes) → ListenRackState; isRackable(fix)
src/features/listen/CoachMixPanel.tsx (+ .module.css)  # Listen Coach-tab consumer UI

# RENAMED/MODIFIED:
ResultsTabs.tsx, results-tab-keys.ts     # rename problems→findings; add trackinfo/debug; reorder
ReportView.tsx                            # new frame (player + vital + sidebar); wire new tabs; drop History
ProblemsTab.tsx → FindingsTab.tsx        # rename; add "See fix in Actions →"
SongHeader.tsx                            # tiny player + Findings vital; remove grade/BPM/key
GamePlan.tsx / MoveCard.tsx               # selection checkbox + Save-to-Game-Plan
FilesTab.tsx                              # re-home staging into the sidebar
RawTab.tsx                               # folded into DebugTab (or kept as its sub-panel)
```

### Known Gotchas (cite, don't re-derive — all in CLAUDE.md unless noted)
```
- AUDIO TOKEN: <audio>.src can't carry headers — append ?t=<jwt> (see useStemEngine.ts). Token rotation on silent refresh re-mounts <audio> and resets currentTime; track position off the element's timeupdate. Keep the player mounted across tab switches (don't unmount on tab change).
- SESSIONSTORAGE IDIOM (ReportView.tsx:90-105): always `typeof sessionStorage !== 'undefined'` + try/catch. Match it for coach-mix-storage.ts. Same for localStorage.
- DATA CONTRACT SHAPE NOTES: phase5 real shape is {status, deltas, genre_context:{...}} (TS type is stale — render real shape). phase1.bands uses `upper_mid`; phase4.band_energy uses `high_mid`. Gate rich UI on actual fields, not just status==='ok' (ok-with-empty-data is normal). Map genre `other` → "Uncategorized".
- RACKPRESET REUSE: Save-to-Game-Plan is `source='coach'` on the EXISTING RackPreset/RackPresetEndpoints — do NOT invent a new table/endpoint. compiledRack → ChainJson must equal the Listen rack/useAudioGraph param shape.
- EF WRITE-PATH (CLAUDE.md): never AsNoTracking() in a write-path version lookup join — it silently drops SaveChanges. (Only relevant if the BFF endpoint is touched.)
- NO Tailwind/shadcn/MUI/styled-components. CSS Modules + tokens.css + global utilities (.card/.pill/.btn/.dot/.label/.mono). No inline styles except dynamic (color-from-severity).
- DEEP-LINK: active tab is owned by the route search param (songs.$songId.results.$jobId.tsx) — keep it.
```

## Implementation Blueprint

### Data models
```ts
// coach-mix-storage.ts — sessionStorage handoff (spec §8)
interface CoachMixSelectedFix {
  fixId: string; findingId: string; label: string;
  dspChain: VerdictDspOp[];                                  // rack-able only
  section?: { startSeconds: number; endSeconds?: number } | null;
}
interface CoachMixHandoff {
  versionId: string; jobId: string;
  selectedFixes: CoachMixSelectedFix[];
  compiledRack: ListenRackState;        // EXACT shape from features/listen (useAudioGraph)
  savedAt: string;
}
// keys: sessionStorage `coachMix:{versionId}` ; localStorage `coachMixFeedback:{versionId}:{fixId}` = 'up'|'down'
// Server: reuse RackPreset (source='coach', ChainJson = compiledRack)
```

### Tasks (ordered)
```yaml
Task 1 — Tab plumbing:
  MODIFY results-tab-keys.ts: union → 'trackinfo'|'analysis'|'findings'|'actions'|'coach'|'project'|'debug'.
  MODIFY ResultsTabs.tsx: new tab defs + order; rename problems→findings; add trackinfo/debug; Project stays conditional (hasProject); Findings badge = problemCount→findingCount; drop the "Game Plan" right-button if redundant.
  MODIFY ReportView.tsx tab switch to route to new components. Default tab = 'trackinfo'.

Task 2 — Frame (SongHeader + sidebar):
  MODIFY SongHeader.tsx: REMOVE grade/BPM/key. ADD a tiny persistent <audio> player (URL via ?t=<jwt> like useStemEngine; mount once, do not unmount on tab change). ADD the Findings vital "N findings · M fixable" (N=faultCount(verdicts), M=moves.length) → onClick goes to Findings tab, color by worst severity.
  CREATE the persistent sidebar in ReportView (desktop) / drawer (narrow): Uploads (FilesTab staging folded in) + Re-analyze (existing dispatchReanalyze + UpgradeSheet). REMOVE all History UI.

Task 3 — Track Info tab:
  CREATE TrackInfoTab.tsx: visuals row (waveformImageUrl/spectrogramImageUrl, placeholder if null) · loudness&dynamics card (phase1 lufs/rms/peak_dbfs/true_peak_db/derived crest/clipping) · tonal balance (reuse SpectrumTab band bars) · StereoCard · tempo/key/duration/genre row (map `other`→"Uncategorized") · StreamingReadiness as a SMALL bottom section. Per-card not-applicable states.

Task 4 — Analysis tab (REWRITE):
  REWRITE AnalysisTab.tsx → collapsed per-phase explainer cards over finalJson.phases[]. Each: friendly name + value inline + "what this means" (CREATE phase-explainer-copy.ts static map) + state(ok/skipped/failed) + re-run(4/5/8 via useRerunPhase)/retry(failed). Intro line "SPECTR runs N analyses" (N from phases length) + link to Debug. Move the old SpectrumTab/ReferenceTab/ArrangementTab/SongMap/dial/uploads/history OUT (to Track Info / sidebar / deleted).

Task 5 — Findings tab:
  RENAME ProblemsTab.tsx → FindingsTab.tsx; update imports/keys/labels/badges (problems→findings). Keep VerdictCard/EvidenceChips/CoachFilters/DegradationBanner. ADD "See fix in Actions →" per fixable finding (onGoToActions, scroll to move).

Task 6 — Actions tab (Coach Mix producer):
  CREATE coach-mix-model.ts: isRackable(fix)=!!fix.dsp_chain?.length; compileRack(selectedFixes)→ListenRackState (merge dsp_chain ops into the Listen rack param shape).
  CREATE coach-mix-storage.ts: read/write CoachMixHandoff (session) + feedback (local), matching the try/catch idiom.
  MODIFY GamePlan.tsx/MoveCard.tsx: selection checkbox on rack-able moves only; on change, write the sessionStorage handoff (selectedFixes + compiledRack). ADD "Sounds Good — Save to Game Plan" → POST RackPreset(source='coach', ChainJson=compiledRack) via a new hook useSaveCoachRack(versionId). Keep ExportBar/ExportModal + applied/dismiss.

Task 7 — Debug tab:
  CREATE DebugTab.tsx: pipeline diagram (nodes = finalJson.phases[]; edges = dependency chain from data-contract §1; color by status; click→I/O panel), per-phase input/output JSON (copyable, RawTab pattern), full raw json (absorb RawTab) + verdicts json.

Task 8 — Listen Coach-tab consumer:
  CREATE src/features/listen/CoachMixPanel.tsx: read sessionStorage `coachMix:{versionId}`; render a checkbox per rack-able fix (toggle = apply/remove that dsp_chain on the live useAudioGraph); "Coach Mix" button applies full compiledRack; 👍/👎 per fix → localStorage. Mount in the Listen Coach tab bottom section. ALIGN to useAudioGraph param API (no translation).

Task 9 — Backend (only if needed):
  VERIFY RackPresetEndpoints supports POST source='coach' + a GET list-by-version for Game Plan display. If the GET is missing, ADD it mirroring the existing handlers (ownership probe OwnsVersion; tracked lookup — NO AsNoTracking on write paths). No new table — RackPreset is sufficient.

Task 10 — Cleanup (spec §12):
  DELETE/disable: "X of 12 phases" ring, DepthBanner/DeepenZone upsell, raw worker-name leaks, "Re-analyze on changes" card, History panel. Grep for `DepthBanner`, `DeepenZone`, history strings and remove from the report view.

Task 11 — Tests:
  Unit (vitest): coach-mix-model (isRackable, compileRack happy/empty), coach-mix-storage (round-trip + try/catch fallback), findingsCount/vital derivation, phase-explainer mapping (friendly name + not-applicable state), tab-key union. Match existing __tests__ patterns (renderToStaticMarkup / pure-fn tests; no new test deps).
```

### Pseudocode (tricky bits only)
```ts
// Tiny header player (SongHeader) — reuse the token URL idiom, keep mounted
const audioUrl = useMemo(() => `/api/versions/${versionId}/audio?t=${accessToken}`, [versionId, accessToken]);
// <audio src={audioUrl} controls preload="metadata" crossOrigin="anonymous" />
// position via the element's timeupdate (token rotation resets currentTime — see gotcha)

// Coach Mix apply (CoachMixPanel) — toggle one fix vs full rack
function onToggleFix(fix, on) {
  const ops = fix.dspChain;            // rack-able guaranteed
  on ? graph.applyOps(ops) : graph.removeOps(ops);   // graph = useAudioGraph handle
}
function onCoachMix() { graph.applyRack(handoff.compiledRack); }   // reset to full

// Save to Game Plan (Actions) — REUSE RackPreset
useSaveCoachRack(versionId).mutate({ name: `Coach Mix — ${trackName}`, source: 'coach', chain: compiledRack });
```

### Integration Points
```yaml
ROUTE: src/routes/_app/songs.$songId.results.$jobId.tsx — keep tab as URL search param; add 'trackinfo'/'debug' to the validated union.
HOOKS: add useSaveCoachRack(versionId) (POST /api/versions/{id}/rack/presets, source='coach') in api/hooks.ts; reuse existing verdict/results/rerun/reanalyze hooks.
BFF: reuse RackPresetEndpoints (POST source='coach'); add GET list-by-version only if absent.
LISTEN: mount CoachMixPanel in the Listen Coach tab; depend on useAudioGraph handle.
```

## Validation Loop

### Level 1 — Syntax & Types (frontend)
```bash
cd components/frontend-spectr-v2
npx tsc --noEmit
npm run lint            # eslint --max-warnings 0 + check-no-google-fonts
npm run lint:css        # no raw hex in *.module.css (tokens only)
```

### Level 2 — Unit tests
```bash
cd components/frontend-spectr-v2 && npx vitest run
# New: coach-mix-model, coach-mix-storage, findings-vital, phase-explainer, tab-keys.
# Never mock to pass — assert real behavior.
```

### Level 3 — Build + (if BFF touched)
```bash
cd components/frontend-spectr-v2 && npm run build           # vite + tsc -b
# Only if Task 9 touched the BFF:
cd components/bff && dotnet build && dotnet test
```

### Level 4 — Manual smoke
```bash
# docker compose -f docker/docker-compose.yml up -d ; start bff + worker + frontend (CLAUDE.md gates)
# 1) open /songs/{id}/results/{job}: tabs render; player plays; vital shows N·M; no grade/BPM/key/History.
# 2) Actions: select 2 rack-able fixes → check sessionStorage coachMix:{versionId}; "Save to Game Plan" → 201 RackPreset(source=coach).
# 3) Listen Coach tab: checkboxes appear; toggling changes audio; "Coach Mix" applies full rack; 👍/👎 writes localStorage.
# 4) short-track / no-stems / no-als / no-reference → graceful not-applicable states (no raw `other`/zeros).
```

## Final Validation Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` + `npm run lint:css` clean
- [ ] `npx vitest run` all pass (incl. new tests)
- [ ] `npm run build` clean
- [ ] `dotnet build && dotnet test` clean (if BFF touched)
- [ ] Manual smoke (Level 4) all pass
- [ ] Spec §12 artifacts gone; spec §-by-§ success criteria met
- [ ] No new design language / no Tailwind / no new layout store / no new preset table

## Anti-Patterns to Avoid
- ❌ Inventing a new preset table/endpoint — reuse `RackPreset` (`source='coach'`).
- ❌ A translation layer between compiledRack and `useAudioGraph` — align shapes instead.
- ❌ Unmounting the header player on tab change (kills playback).
- ❌ Trusting `status==='ok'` for rich UI — gate on actual fields (ok-with-empty-data is normal).
- ❌ Rendering raw `other`/zeros/worker phase names — friendly copy + not-applicable states.
- ❌ `AsNoTracking()` anywhere in a write-path version lookup (silent SaveChanges drop).
- ❌ Building the Phase-2 timed announcements or Specialist Team modal here — out of scope.
- ❌ Adding test dependencies (jsdom/Testing Library) — match the existing renderToStaticMarkup / pure-fn test idiom.

## Confidence: 8/10
High: most surfaces already exist (reuse map in handoff §4), the backend is a reuse not a build, all shapes/paths are cited, gates are executable. Risk points (−2): (1) compiledRack ↔ `useAudioGraph` param alignment needs care (the one real seam); (2) splitting today's large `AnalysisTab` cleanly without regressing re-run/retry. Both are bounded and called out.
