name: "Results Page v3 Port — redesigned Analysis Results into SPECTR v2 frontend"
description: |
  Frontend-only port of the redesigned Analysis Results page (design_handoff_results_v3)
  into components/frontend-spectr-v2/src/features/results/. Recreate the target layout/IA
  as real React using the app's patterns. NO backend/DTO/contract changes — final_json
  already carries every field. Every non-happy-path surface the current page owns is
  preserved. Fix Rack restructured to a "Send to Listen" card (Coach Mix as an auto preset in a
  Presets list, one shared rack renderer). Reference tab shows genre
  and reference comparisons together, by per-metric data availability. New data panels
  added from existing final_json paths.

## Purpose
Give an executing agent everything needed to rebuild the results page end-to-end as an
exact delta over today's implementation — no further research required.

## Core Principles
1. **Context is King** — this PRP inlines every file:symbol, data path, and gotcha.
2. **Validation Loops** — the four frontend gates (tsc / lint / build / vitest) are the contract.
3. **Additive-only honesty** — degradation and monetization surfaces are LOAD-BEARING; never drop them.
4. **Data honesty** — every visual maps to a real `schemas/final_json.contract.json` path or is not shipped.
5. **Global rules** — follow CLAUDE.md (TS strict, `import type`, CSS Modules, no Tailwind, fetcher, four gates).

---

## Goal

Replace the current results/report page — `components/frontend-spectr-v2/src/features/results/`
(orchestrated by `ReportView.tsx`) reached via route
`src/routes/_app/songs.$songId.results.$jobId.tsx` — with a redesigned version that matches
the `design_handoff_results_v3` layout/IA, while:

- **Preserving every non-happy-path surface** the current page has (route states, honest
  degradation, monetization gating, on-page triage + auto-run, GenreCorrectChip, TrackChip
  cross-links, Debug dev-only + prod coercion).
- **Restructuring the Fix Rack** area into a **"Send to Listen" card** (the revised design's model,
  approved): fixes queue from the findings list; the card is a **Presets list** where the compiled
  **Coach Mix appears as an `auto` preset row** (generated via a robot button). Clicking any preset opens
  a chain modal. A single extracted shared read-only **RackView / DeviceModule** renders the Coach Mix
  and every Presets row identically. No Rack/Presets sub-tabs, no By-fix/Compiled toggle — everything is a
  preset over one rack primitive.
- **Rebuilding the Reference tab** to show BOTH the genre comparison (phase 6) and the reference
  comparison (phase 5) together, laid out per-metric by data availability (no mode toggle).
- **Adding new data panels** that already exist in final_json: loudness-over-time strip + section
  overlay, structure overlay on the waveform, punch/dynamics, L/R channel balance, key detail,
  danceability, spatial height/depth, chords+swing (Project).
- **Relabeling mix translation** to headphones / speakers / mono.

This is a **FRONTEND-ONLY** port. No BFF endpoint, DTO, worker, or contract change. The BFF passes
`final_json` through verbatim as `JobResultsDto.finalJson` (`api/types.ts:896`); every new visual
binds to a path already present in `schemas/final_json.contract.json`.

## Why
- The current results page grew organically (101 files under `features/results/`); the redesign is a
  cleaner IA that surfaces measured data the pipeline already emits but the UI never showed
  (loudness timeline, transients, channel balance, key_estimate, spatial, danceability).
- The Fix Rack story today is split across three surfaces (`FixRackPanel`, `RackSidebar`,
  `CoachMixModal`) with two divergent read-only renderers (`FixRackPanel` module grid vs
  `RackModules`). Unifying to one shared RackView removes drift and makes Presets trivially consistent.
- The Reference story today shows only genre gaps (phase 6) OR nothing; phase-5 reference deltas and
  per-stem deltas are computed but never rendered. Showing both, per-metric, is the honest picture.
- Product philosophy (memory `spectr-coaching-product-philosophy`): additive-only, the score is not
  the product (analysis/suggestions/coaching is), audio-file-first, first-upload is the conversion
  moment. Every preserved surface below serves one of those constraints.

## What

User-visible behavior after the port:

- The route renders exactly the same set of states (in-progress storyline, failed + free retry,
  awaiting_stem_mapping, complete-but-report-loading/error, job-error) — unchanged.
- The complete report shows: a track header (identity + genre + GenreCorrectChip + input chips +
  findings vital + player), the coach surface (chat + specialists + triage + recommended fixes +
  fix rack), and folder tabs Findings / (Project) / (Reference) / Track Analysis / (Debug dev-only).
- Fix Rack area is a **"Send to Listen" card**: a Presets list (version-scoped saved racks) with the compiled Coach Mix as an `auto` preset row; a robot button generates the Coach Mix; clicking a preset opens its chain modal. Footer: Listen + DAW Plan.
- Reference tab shows "Compared to your genre" and "Compared to your reference" sections together.
- Track Analysis tab gains: loudness-over-time strip (with section overlay), a structure overlay on
  the waveform, a punch/dynamics card, an L/R channel-balance readout, a key-detail panel, a
  danceability readout, and a spatial height/depth card. Mix translation reads headphones/speakers/mono.
- Project tab gains a chords + swing panel (subject to the data-availability caveat in Risks).

### Success Criteria
- [ ] All four gates pass: `npx tsc --noEmit`, `npm run lint` (`--max-warnings 0`), `npm run build`, `npx vitest run`.
- [ ] No backend/DTO/contract/worker file changed (git diff confined to `components/frontend-spectr-v2/`).
- [ ] Every route-level state from the current route file still renders identically.
- [ ] Every degradation + monetization + triage + cross-link surface in the "Preserved surfaces" table still renders under the same conditions (covered by ported/retained tests).
- [ ] "Send to Listen" card: Coach Mix generates as an `auto` preset row, Presets list renders, preset-chain modal opens; Coach Mix row and every Presets row render through the same `RackView`.
- [ ] Reference tab renders genre + reference sections by per-metric availability; fabricated-percentile guard intact.
- [ ] Every new panel binds only to real `final_json.contract.json` paths; panels self-degrade to null/"—" on absent data.
- [ ] `?tab=debug` in a prod build coerces to `coach`; Debug tab absent from the tab bar in prod.

---

## All Needed Context

### Documentation & References
```yaml
# MUST READ — internal files (all absolute under repo root C:\Users\badmin\projects\AIMusicAnalysisSite)

# ── Data contract (authoritative field paths) ──
- file: schemas/final_json.contract.json
  why: The ONLY source of truth for which final_json paths exist. Every new visual must bind to a
       leaf_paths[] entry (or a documented dynamic_prefixes[] entry). If a path is not here, the data
       does not exist — do not invent it.

# ── Current results implementation (the delta baseline) ──
- file: components/frontend-spectr-v2/src/routes/_app/songs.$songId.results.$jobId.tsx
  why: ResultsPage — all route-level states. PRESERVE verbatim (see "Preserved surfaces").
- file: components/frontend-spectr-v2/src/features/results/ReportView.tsx  # 515 lines — orchestrator
  why: pickPhaseData<T>(fj,n) accessor (line 495), prod debug coercion (line 66), hasProject/hasReference
       derivation, phase8Failed (line 84), moves/verdicts wiring, Fix Rack lifecycle, UpgradeSheet gating.
- file: components/frontend-spectr-v2/src/features/results/results-tab-keys.ts        # tab key union + guard + default
- file: components/frontend-spectr-v2/src/features/results/results-tabs-model.ts       # buildResultsTabs(opts,isDev) — Debug dev-only
- file: components/frontend-spectr-v2/src/features/results/ResultsTabs.tsx
- file: components/frontend-spectr-v2/src/features/results/CoachTab.tsx                 # triage + auto-run + moves + fix-rack button
- file: components/frontend-spectr-v2/src/features/results/CoachChat.tsx               # coach-offline, caps, CoachGateInline paywall, creditsOn gate
- file: components/frontend-spectr-v2/src/features/results/CoachGateInline.tsx
- file: components/frontend-spectr-v2/src/features/results/CoachCapChip.tsx
- file: components/frontend-spectr-v2/src/features/results/DegradationBanner.tsx + helpers/failed-phases.ts
- file: components/frontend-spectr-v2/src/features/results/LlmDegradationNotice.tsx
- file: components/frontend-spectr-v2/src/features/results/ReferenceTab.tsx            # fabricated-percentile guard (lines 44-46)
- file: components/frontend-spectr-v2/src/features/results/TrackInfoTab.tsx            # LoudnessCard/StereoCard/TranslationCard/StreamingCard patterns
- file: components/frontend-spectr-v2/src/features/results/ProjectTab.tsx + ProjectUnlock.tsx
- file: components/frontend-spectr-v2/src/features/results/DebugTab.tsx
- file: components/frontend-spectr-v2/src/features/results/SongHeader.tsx + GenreCorrectChip.tsx
- file: components/frontend-spectr-v2/src/features/results/FindingsTab.tsx + TrackChip.tsx + track-highlight.ts
- file: components/frontend-spectr-v2/src/features/results/TriagePlanPanel.tsx + helpers/triage-plan.ts + helpers/analysisModalData.ts (splitRouting)
- file: components/frontend-spectr-v2/src/features/results/RackSidebar.tsx
- file: components/frontend-spectr-v2/src/features/results/FixRackPanel.tsx + fix-rack-helpers.ts + RackModules.tsx + useFixRackGeneration.ts + CoachMixModal.tsx
- file: components/frontend-spectr-v2/src/features/results/move-model.ts + MoveCard.tsx
- file: components/frontend-spectr-v2/src/features/results/problems-helpers.ts  # faultCount

# ── Rack primitive (the canonical Chain + manifest) ──
- file: components/frontend-spectr-v2/src/features/listen-rack/data.ts
  why: RACK_MANIFEST, MODULE_DEFAULTS, MANIFEST_BY_ID, MASTERING_IDS/CREATIVE_IDS, PITCH_MODULE,
       fmtVal(unit,value,opts) — the shared value formatter. This is the single source of module metadata.
- file: components/frontend-spectr-v2/src/features/listen-rack/chain.ts   # Chain = {order, modules, masterBypass}
- file: components/frontend-spectr-v2/src/features/listen-rack/rackLayouts.tsx  # InlineRack lives here (editor); RichModulePanel structure to mirror read-only
- file: components/frontend-spectr-v2/src/features/listen-rack/ui.tsx           # ModuleIcon, ParamControl, Switch, WorkletPill, BindTag
- file: components/frontend-spectr-v2/src/features/listen-rack/useRackPresets.ts # version-scoped preset hooks + asChain()
- file: components/frontend-spectr-v2/src/features/listen/chainApply.ts          # canonical apply loop + Chain shape (drift-tolerant)

# ── Rack preset DTOs (reference only — NO changes) ──
- file: components/bff/src/Spectr.Bff/DTOs/RackPresetDtos.cs        # RackPresetDto version-scoped (SongVersionId), Chain=JsonElement
- file: components/bff/src/Spectr.Bff/Endpoints/RackPresetEndpoints.cs  # GET/POST/DELETE /versions/{id}/rack/presets ; GET/PUT /draft

# ── Design reference (visual/IA target — recreate, do not port) ──
- file: C:\Users\badmin\Documents\design_handoff_results_v3\README.md
- dir:  C:\Users\badmin\Documents\design_handoff_results_v3\prototype\  # ar-app/frame/coach/actions/trackinfo/reference/project/data/ui/debug .jsx
  why: Layout, chip copy, card composition, signal-flow strip, goniometer, mini meters. The prototype is
       React.createElement globals loaded via Object.assign(window,…) with hardwired mock data — recreate
       as real ES modules. It is AHEAD of the target in some places and BEHIND in others (see Risks).

# ── Frontend conventions ──
- file: components/frontend-spectr-v2/src/api/types.ts   # JobResultsDto, FinalJson + Phase1..9 types, EntitlementsDto, RackPresetDto
- file: components/frontend-spectr-v2/src/styles/global.css  # utility classes .card/.card-hd/.card-body/.pill[.tone]/.dot/.btn/.label/.mono
- file: components/frontend-spectr-v2/CLAUDE.md  # stack rules (via project CLAUDE.md)
```

### Current results tree (features/results/, abbreviated to load-bearing files)
```
features/results/
  ReportView.tsx (515)              # orchestrator — CHANGED (recompose, keep all wiring)
  results-tab-keys.ts (27)          # KEEP
  results-tabs-model.ts (47)        # KEEP (buildResultsTabs — Debug dev-only)
  ResultsTabs.tsx (57)              # KEEP/light change
  SongHeader.tsx (139)              # CHANGED (add findings-vital / redesigned header card)
  GenreCorrectChip.tsx (78)         # KEEP verbatim
  CoachTab.tsx (248)                # CHANGED (host new SendToListenCard; keep triage+autorun+moves)
  CoachChat.tsx (636)               # KEEP verbatim (offline/caps/paywall/creditsOn)
  CoachGateInline.tsx, CoachCapChip.tsx  # KEEP
  DegradationBanner.tsx (84) + helpers/failed-phases.ts  # KEEP
  LlmDegradationNotice.tsx (46)     # KEEP
  FindingsTab.tsx (266)             # KEEP/light change (redesign FixBoard master-detail optional)
  TrackChip.tsx (21) + track-highlight.ts (39)  # KEEP
  TrackInfoTab.tsx (429)            # CHANGED (add new cards; relabel translation)
  ProjectTab.tsx (233) + ProjectUnlock.tsx (30)  # CHANGED (add chords/swing panel — see Risk)
  ReferenceTab.tsx (196)            # REWRITTEN (genre + reference sections, per-metric)
  DebugTab.tsx (126)                # KEEP
  TriagePlanPanel.tsx (106) + helpers/triage-plan.ts (24)  # KEEP
  RackSidebar.tsx (178)             # CHANGED or FOLDED into SendToListenCard
  FixRackPanel.tsx (211) + fix-rack-helpers.ts (58)  # CHANGED (Coach Mix / preset chain renders via shared RackView)
  RackModules.tsx (80)              # KEEP (move-step renderer; distinct from RackView)
  useFixRackGeneration.ts (55)      # KEEP verbatim (drives the robot Coach-Mix generate button)
  CoachMixModal.tsx (56)            # KEEP or fold into the preset-chain modal
  move-model.ts (363) + MoveCard.tsx (192)  # KEEP
  problems-helpers.ts (83)          # KEEP (faultCount)
  helpers/{format,grade,severity,streaming,specialists,analysisModalData}.ts  # KEEP
  StreamingCard.tsx, ResultsPlayer.tsx, GradeHero.tsx, EvidenceChips.tsx, DepthBanner.tsx  # KEEP
  __tests__/*  # KEEP + EXTEND
```

### Desired new/changed files (responsibility)
```
features/results/
  # ── NEW shared rack primitive (decision 2) ──
  RackView.tsx                      # NEW — shared READ-ONLY chain renderer: signal-flow strip + grid of DeviceModule.
                                    #   Props: { chain: unknown; title?; footer?: ReactNode }. Narrows via readFixChain.
  DeviceModule.tsx                  # NEW — one read-only device card (glyph/accent/label + param rows).
                                    #   Driven by MANIFEST_BY_ID + moduleParams (fix-rack-helpers) + fmtVal (listen-rack/data).
  rack-view-helpers.ts             # NEW — pure: signalFlowNodes(chain), unify moduleParams+fmtVal formatting. Unit-tested.

  # ── NEW "Send to Listen" card (decision 2 — revised design's model) ──
  SendToListenCard.tsx             # NEW — the fix-rack surface. Header: "Send to Listen" + ⓘ tooltip + "<N> fixes queued"
                                    #   readout + a robot Coach-Mix generate button (spinner while compiling; disabled at 0 fixes).
                                    #   Body: a Presets list. Once generated, Coach Mix appears as an `auto` preset row
                                    #     (glyph, name, "<N> devices", per-row Listen button). User presets listed alongside.
                                    #   Clicking any preset row → PresetChainModal (<RackView chain={preset.chain}/>).
                                    #   Empty state points at the robot. Footer: queued-count note + DAW Plan + Listen (disabled at 0).
                                    #   Uses useFixRackGeneration + useRackPresets. Fixes are queued from the findings list (not here).
  PresetChainModal.tsx             # NEW (or fold CoachMixModal) — modal showing one preset/Coach-Mix chain via <RackView>.
  send-to-listen-model.ts          # NEW — pure: preset-list derivation (Coach Mix as auto row + user presets), empty-copy,
                                    #   queued-count. Unit-tested.

  # ── NEW data panels (decision 4/5) — all bind to existing final_json paths ──
  panels/LoudnessTimelineStrip.tsx # NEW — Recharts area/line over phase1.loudness_timeline.short_term.{t,lufs}[]
                                    #   with section overlay from phase1.structure.segments[]. Self-degrades if timeline absent.
  panels/StructureOverlay.tsx      # NEW — proportional section bar over the waveform image (phase1.structure.segments[]).
  panels/PunchDynamicsCard.tsx     # NEW — phase1.crest_factor, phase1.transients.*, phase1.loudness_range_lu
  panels/ChannelBalanceCard.tsx    # NEW — phase1.channel_balance.{balance_db,l_rms_db,r_rms_db}
  panels/KeyDetailCard.tsx         # NEW — phase1.key_estimate.{key,mode,confidence,second_key,second_mode,profile_corrs}
  panels/DanceabilityCard.tsx      # NEW — top-level danceability_score
  panels/SpatialCard.tsx           # NEW — phase9.spatial.{height_score,depth_score,width_consistency,analysis[]}
  panels/ChordsSwingCard.tsx       # NEW — Project: phase8.midi_analysis[] (chords + swing_ratio) — SEE RISK R1
  panels/*.module.css              # NEW — CSS Modules per panel

  # ── Reference rebuild (decision 3) ──
  ReferenceTab.tsx                 # REWRITTEN — two sections + genre range bar with ◇ ref overlay
  reference-model.ts               # NEW — pure: which metrics get percentile/range (bpm, stereo_width,
                                    #   stereo_correlation + overall phase6.percentile), merge with phase5 deltas +
                                    #   per_stem_reference_deltas, decide section visibility. Unit-tested.
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL: phase data is accessed as fj.phases[].find(p => p.phase === n).data — via
//   ReportView.pickPhaseData<T>(fj, n) (ReportView.tsx:495) and analysisModalData.phaseData().
//   The contract's dot-paths ("phase1.bpm") = pickPhaseData<Phase1Data>(fj,1)?.bpm. FinalJson itself
//   has NO direct phase1/phase2 keys — do not read fj.phase1. Reuse pickPhaseData; don't reinvent.

// CRITICAL: JobResultsDto.finalJson is `unknown`. Guard with isFinalJson(x) before use (api/types.ts:1225).
//   Pipeline failures can leave finalJson non-object → render an empty shell, never throw.

// CRITICAL (TS strict + verbatimModuleSyntax): every type-only import MUST be `import type`.
//   All new panel props/models are type-only imports.

// CRITICAL: Chain is `unknown` on the wire (RackPresetDto.chain, FixRackDto.chain mirror JsonElement).
//   NEVER read it directly — narrow via readFixChain(chain) (fix-rack-helpers.ts:17) or asChain
//   (useRackPresets.ts). RackView must accept `unknown` and narrow internally.

// CRITICAL: RACK_MANIFEST is the SINGLE source of module metadata (listen-rack/data.ts). Do not
//   duplicate the module list. fix-rack-helpers.ts already exposes MANIFEST = new Map(RACK_MANIFEST…).
//   Prefer listen-rack/data.ts fmtVal() over moduleParams' ad-hoc formatter for unit correctness
//   (percent ×100, ratio n:1, dBTP, kHz rollover), but KEEP moduleParams' special EQ-enabled-bands branch.

// CRITICAL: two read-only renderers exist and are DIFFERENT — do not merge blindly.
//   (a) FixRackPanel module grid: manifest-backed Chain → RackView SHOULD replace this.
//   (b) RackModules.tsx: renders a verdict Move's free-text MoveStep[] via a loose OP_META table.
//       This is NOT a Chain and stays as-is; RackView does not cover it.

// CRITICAL: Rack presets are VERSION-scoped (RackPresetDto.songVersionId; ownership via song→user join).
//   Use useRackPresets(versionId) from listen-rack. NO cross-track preset work — out of scope.

// CRITICAL: credits_enabled kill switch. `const creditsOn = entitlements?.creditsEnabled !== false`
//   (CoachChat.tsx:100). When false, ALL tier/paywall/cap UI hides (CoachCapChip row dropped, coach
//   unlimited). Any new monetization surface in SendToListenCard/Presets must respect creditsOn.

// CRITICAL: Debug tab is triple-gated — dev-only tab registry (results-tabs-model.ts:44 isDev),
//   prod ?tab=debug → coach coercion (ReportView.tsx:66), and DEV runtime mount gate (ReportView.tsx:383).
//   Preserve all three.

// CRITICAL: fabricated-percentile guard (ReferenceTab.tsx:44) — percentile is phase6.percentile or null,
//   NEVER derived from overall_score. The reference rewrite must keep this. Also note
//   AnalysisCompleteModal.deriveFindings DOES synthesize a "above the pack" win when phase6.percentile
//   exists — that is a modal, distinct from the tab; leave it.

// CRITICAL: waveform/spectrogram are SERVER-RENDERED PNGs (JobResultsDto.waveformImageUrl /
//   spectrogramImageUrl, token appended as ?t=<jwt>). StructureOverlay must overlay a proportional
//   bar aligned to phase1.duration_seconds, NOT assume a WaveSurfer canvas (there isn't one here).

// CRITICAL: the frontend Phase5Data / Phase6Data types in api/types.ts are STALE vs the contract.
//   Phase5Data has `checks` but the contract has phase5.status, phase5.genre_context.*,
//   phase5.deltas (dynamic), phase5.per_stem_reference_deltas[]. Phase1Data lacks loudness_timeline,
//   channel_balance, key_estimate. You MUST extend these interfaces (see Data models below).

// CRITICAL: never re-fetch or re-derive coach caps arithmetic — server (CoachCapsDto) is the source
//   of truth (CoachChat handles it). Do not touch caps logic; only re-parent CoachChat into the new shell.

// GOTCHA: sub-agent found the design first tab's id is `coach` but its label is "Findings" in the
//   prototype. Keep our clean mapping: tab id `coach` → label "AI Coach"; `findings` → "Findings".
//   Do NOT rename tab keys (route validateSearch + many deep-links depend on results-tab-keys.ts).
```

---

## Implementation Blueprint

### Data models and structure (api/types.ts extensions — additive, all optional)

```ts
// EXTEND Phase1Data (api/types.ts ~line 932) — ADD (do not remove existing fields):
export interface Phase1LoudnessTimeline {
  momentary?: { t?: number[]; lufs?: number[] };
  short_term?: { t?: number[]; lufs?: number[] };
}
export interface Phase1ChannelBalance { balance_db?: number; l_rms_db?: number; r_rms_db?: number; }
export interface Phase1KeyEstimate {
  key?: string; mode?: string; confidence?: number;
  second_key?: string; second_mode?: string; profile_corrs?: number[];
}
// add to Phase1Data: loudness_timeline?: Phase1LoudnessTimeline; channel_balance?: Phase1ChannelBalance; key_estimate?: Phase1KeyEstimate;

// EXTEND Phase5Data (api/types.ts ~line 1036) — reconcile with contract:
export interface Phase5PerStemDelta {
  role?: string; metric?: string; delta?: number; interpretation?: string;
  reference_value?: number; user_value?: number; severity_tier?: string;
}
// add to Phase5Data: status?: string; genre_context?: { genre?: string; preset_name?: string };
//   deltas?: Record<string, { delta?: number; user_value?: number; reference_value?: number; interpretation?: string }>;
//   per_stem_reference_deltas?: Phase5PerStemDelta[]; stem_reference_comparison?: unknown;

// Phase9Spatial already has height_score/depth_score/width_consistency/analysis — no change needed.
// danceability_score already on FinalJson (line 1215) — no change needed.
// phase8: per-track chord/swing is emitted at phase8.midi_analysis[] (verified in phase8_als.py:130,
//   though absent from the stale contract snapshot). Add a Phase8MidiAnalysis type: { track_name, chord_count,
//   swing_ratio, humanization_score, note_density_per_bar, chords: {time, chord_name, pitches, duration}[] }.
//   See RISK R1. (total_chord_count is a scalar summary only.)
```

### Shared RackView / DeviceModule extraction plan (decision 2)

```
GOAL: one read-only renderer used by (a) the Coach Mix `auto` preset row and (b) every user Presets row
      (and the preset-chain modal), so they are pixel-identical, sourced from the manifest.

SOURCE of truth:
  - module metadata  → RACK_MANIFEST / MANIFEST_BY_ID (listen-rack/data.ts)
  - param display    → moduleParams(id, state) (fix-rack-helpers.ts:38) — KEEP its EQ-band branch;
                       for non-eq params, format via fmtVal(unit, value) (listen-rack/data.ts:270) for unit correctness.
  - narrowing        → readFixChain(chain) (fix-rack-helpers.ts:17) — accepts `unknown`.
  - accent/glyph     → MANIFEST_BY_ID[id].accent / .glyph.

RackView.tsx:
  props { chain: unknown; title?: string; footer?: React.ReactNode }
  const c = readFixChain(chain); if (!c) return honest "empty rack" state.
  const ids = enabledModuleIds(chain)  // signal-chain order, enabled only
  render: signal-flow strip  "in › [DeviceModule glyph/label per id] › out"  (rack-view-helpers.signalFlowNodes)
          grid of <DeviceModule id={id} state={c.modules[id]} /> for each id
          optional footer (Coach Mix row passes coachMeta.change_log; user preset rows pass Load/Delete actions)

DeviceModule.tsx:
  props { id: string; state: ModuleState }
  man = MANIFEST_BY_ID.get(id); rows = moduleParams(id, state)
  render .mod card with --ac accent, header (glyph, label, on-dot), rows label / mono val.
  This is lifted verbatim from FixRackPanel.tsx module grid (lines 103-121).

CONSUMERS after extraction:
  - Coach Mix `auto` preset row / PresetChainModal → <RackView chain={fixRackData.chain} footer={<CoachMetaFooter meta={coachMeta}/>} />
  - User Presets rows → <RackView chain={preset.chain} footer={<PresetRowActions .../>} />
  - FixRackPanel.tsx module grid → replaced by <RackView>. (RackModules.tsx move-step renderer is UNTOUCHED.)
```

### Reference tab rebuild (decision 3)

```
NO mode toggle. Two labeled sections rendered together when their data exists.

reference-model.ts (pure, unit-tested):
  GENRE_PERCENTILE_METRICS = ['bpm', 'stereo_width', 'stereo_correlation'] as const
    // ONLY these 3 phase6.gaps metrics carry a valid percentile/range. + overall phase6.percentile.
  buildReferenceModel(phase2Genre, phase6, phase5) => {
     genre: {
        show: boolean,                 // phase6 present AND genre confident (honest "can't place you" otherwise)
        percentile: number|null,       // phase6.percentile rounded, or null (KEEP fabricated-percentile guard)
        rows: GenreRow[]               // one per GENRE_PERCENTILE_METRICS present in phase6.gaps
                                       //   { metric, you, mean, acceptable_range, percentile, refValue?|null, out }
                                       //   refValue = matching phase5.deltas value when present → renders ◇ marker on the bar
     },
     reference: {
        show: boolean,                 // ONLY when a reference is attached (phase5.status ok / deltas present)
        deltas: RefDeltaRow[],         // plain deltas from phase5.deltas.* (label, user, reference, delta, interpretation)
        perStem: Phase5PerStemDelta[]  // phase5.per_stem_reference_deltas[] when stems exist
     }
  }

ReferenceTab.tsx render:
  - "Compared to your genre"      → GenreRow bars (range bar + you-dot + mean tick + ◇ ref overlay for the 3 shared metrics)
                                     honest "Genre percentile isn't available / can't place you on low confidence" states.
  - "Compared to your reference"  → RefDeltaRow list + per-stem delta rows.
  - DROPPED: RefBandCurve (per-band genre curve) — the per-band mean±σ curve data does not exist. OUT OF SCOPE.
```

### List of tasks (in order)

```yaml
Task 1 — Types (foundation, no UI):
MODIFY components/frontend-spectr-v2/src/api/types.ts:
  - ADD Phase1LoudnessTimeline, Phase1ChannelBalance, Phase1KeyEstimate; wire into Phase1Data.
  - ADD Phase5PerStemDelta; reconcile Phase5Data with contract (status, genre_context, deltas, per_stem_reference_deltas).
  - ADD Phase8MidiAnalysis { track_name, chord_count, swing_ratio, humanization_score, note_density_per_bar,
    chords: {time, chord_name, pitches, duration}[] }; wire phase8.midi_analysis?: Phase8MidiAnalysis[] into Phase8Data — see Risk R1.
  - Run `npx tsc --noEmit` — expect 0 errors (all additive/optional).

Task 2 — Shared RackView / DeviceModule (decision 2 primitive):
CREATE features/results/rack-view-helpers.ts:
  - signalFlowNodes(chain): {id,label,glyph,accent}[] from enabledModuleIds + MANIFEST_BY_ID.
  - deviceRows(id, state): reuse moduleParams; for non-eq numeric params prefer fmtVal for units. Pure.
CREATE features/results/DeviceModule.tsx  (lift FixRackPanel.tsx:103-121 module card).
CREATE features/results/RackView.tsx  (signal-flow strip + DeviceModule grid + optional footer; accepts unknown chain).
CREATE features/results/RackView.module.css (port .mod / .chainbar styles from FixRackPanel.module.css).
UNIT TEST rack-view-helpers (expected: full chain; edge: eq-only enabled bands; failure: malformed/empty chain → []).

Task 3 — SendToListenCard (decision 2 surface — revised design's "Send to Listen" model):
CREATE features/results/send-to-listen-model.ts:
  - presetRows(fixRackData, presets): Coach Mix as an `auto` preset row (when generated) + user presets → row models.
  - queuedCount(committedIds); presetsEmptyCopy = "Save a rack to reuse it on this version."
CREATE features/results/SendToListenCard.tsx:
  - Header: "Send to Listen" + ⓘ tooltip + "<N> fixes queued" readout + robot Coach-Mix generate button
    (useFixRackGeneration(jobId): idle→robot generate; generating→spinner; error/timeout→Retry, preserving FixRackPanel
    honesty branches; coachMeta.degraded → "used the rule-based master"). Fixes are queued from the findings list, NOT here.
  - Body: Presets list. Coach Mix `auto` row appears once ready (glyph, name, "<N> devices", per-row Listen);
    user presets via useRackPresets(versionId) listed alongside; each row → PresetChainModal (<RackView chain={p.chain}>).
    Empty state points at the robot. Save-current-rack action (POST via useSaveRackPreset). Respect creditsOn.
  - Footer: queued-count note + DAW Plan (ExportModal) + Listen (→ /listen-rack/$versionId ?fixPreset=…, disabled at 0).
CREATE features/results/PresetChainModal.tsx (or fold CoachMixModal): <RackView> for one preset/Coach-Mix chain.
UNIT TEST send-to-listen-model (expected: Coach Mix auto row + user presets; edge: empty presets copy; failure: no versionId → presets disabled).

Task 4 — Wire SendToListenCard into the coach surface:
MODIFY features/results/CoachTab.tsx:
  - Replace the inline "Generate Fix Rack" button + RackSidebar coupling with <SendToListenCard …>.
  - PRESERVE: TriagePlanPanel mount, auto-run effect (lines 112-142), DepthBanner, "Recommended fixes" MoveCard list,
    SpecialistTeamModal. Do NOT touch CoachChat.
MODIFY features/results/ReportView.tsx:
  - Recompose layout to the redesign hero (header card + coach card) but keep ALL wiring: pickPhaseData,
    prod debug coercion (line 66), hasProject/hasReference/phase8Failed, moves/verdicts, UpgradeSheet gating,
    writeListenFixes, add-inputs routing, all dialogs, AnalysisCompleteModal.
  - Route the Coach Mix + Presets through SendToListenCard; RackSidebar either folds in or stays as the desktop rail.

Task 5 — Track Analysis new panels (decision 4/5):
CREATE features/results/panels/LoudnessTimelineStrip.tsx (+ .module.css) — Recharts over phase1.loudness_timeline.short_term,
  section overlay from phase1.structure.segments (guard structure.available/deferred). Self-degrade to null if timeline absent.
CREATE features/results/panels/StructureOverlay.tsx — proportional section bar aligned to phase1.duration_seconds over the waveform PNG.
CREATE features/results/panels/PunchDynamicsCard.tsx — crest_factor, transients.*, loudness_range_lu.
CREATE features/results/panels/ChannelBalanceCard.tsx — channel_balance.{balance_db,l_rms_db,r_rms_db}.
CREATE features/results/panels/KeyDetailCard.tsx — key_estimate.* (primary + second key + confidence + profile_corrs sparkline).
CREATE features/results/panels/DanceabilityCard.tsx — top-level danceability_score.
CREATE features/results/panels/SpatialCard.tsx — phase9.spatial.{height_score,depth_score,width_consistency,analysis[]}.
MODIFY features/results/TrackInfoTab.tsx — mount new cards; RELABEL TranslationCard rows to headphones/speakers/mono
  (headphones=phase9.playback.headphone_score, speakers=phase9.playback.speaker_score, mono=phase9.surround.mono_compatibility).
  Every card self-degrades to null/"—" on missing data (mirror existing LoudnessCard/StereoCard pattern).

Task 6 — Reference tab rewrite (decision 3):
CREATE features/results/reference-model.ts (buildReferenceModel + GENRE_PERCENTILE_METRICS). Pure.
REWRITE features/results/ReferenceTab.tsx — two sections (genre + reference), ◇ ref overlay on the 3 shared metrics,
  KEEP fabricated-percentile guard + honest "can't place you" state. DROP per-band genre curve.
UNIT TEST reference-model (expected: both sections; edge: genre-only / reference-only; failure: low genre confidence → genre.show=false, percentile null).

Task 7 — Project chords/swing (decision 4, see Risk R1):
CREATE features/results/panels/ChordsSwingCard.tsx — bind to phase8.midi_analysis[] (per-track chord_name progression +
  swing_ratio + humanization_score). This data IS emitted on real .als analyses (phase8_als.py:130).
  Degrade to an honest "chord/groove detail not available" state when the array is empty/absent (mix-only or phase8 skipped) —
  fallback, not default. Never synthesize from the scalar total_chord_count. MODIFY ProjectTab.tsx to mount it.
  Confirm the exact shape against a live .als analysis before building the rich UI.

Task 8 — Tests + gates:
  - Port/retain every existing __tests__ file for a preserved surface (DegradationBanner, LlmDegradationNotice, CoachGateInline,
    CoachCapChip, GenreCorrectChip, ReferenceTab, ProjectUnlock, triage-plan-panel, results-tabs, move-model, track-highlight, FixRackPanel).
  - Add new tests for RackView/rack-view-helpers, send-to-listen-model, reference-model, and each panel's degrade-to-null path.
  - Run all four gates; fix to green.
```

### Per-task pseudocode (critical details only)

```tsx
// Task 2 — RackView (accepts opaque chain, never throws)
export function RackView({ chain, title, footer }: { chain: unknown; title?: string; footer?: React.ReactNode }) {
  const c = readFixChain(chain);                     // fix-rack-helpers.ts — null when malformed
  if (!c) return <div className="card"><p className="mono">Empty rack.</p></div>;
  const ids = enabledModuleIds(chain);               // signal order, enabled only
  const nodes = signalFlowNodes(chain);              // rack-view-helpers
  return (
    <div className="card">
      {title && <div className="card-hd">{title}</div>}
      <div className={s.chainbar}>in {nodes.map(n => <span style={{ '--ac': n.accent }}>{n.glyph} {n.label}</span>)} out</div>
      <div className={s.grid}>{ids.map(id => <DeviceModule key={id} id={id} state={c.modules[id]!} />)}</div>
      {footer}
    </div>
  );
}

// Task 5 — LoudnessTimelineStrip (degrade honestly)
const tl = phase1?.loudness_timeline?.short_term;
if (!tl?.t?.length || !tl?.lufs?.length) return null;         // no timeline → no card, never a flat/fake line
const data = tl.t.map((t, i) => ({ t, lufs: tl.lufs![i] }));
const segs = phase1?.structure?.available ? phase1.structure.segments ?? [] : [];
// Recharts AreaChart of lufs vs t; ReferenceArea per seg [start,end] labeled seg.label.

// Task 6 — reference-model (keep the guard)
const percentile = phase6?.percentile != null ? Math.round(phase6.percentile) : null;   // never from overall_score
const genreShow = Boolean(phase6?.gaps && Object.keys(phase6.gaps).length) && genreConfident;
// for each m of GENRE_PERCENTILE_METRICS present in phase6.gaps: build a range-bar row;
//   refValue = phase5?.deltas?.[m]?.reference_value ?? null  → renders the ◇ marker only when present.
```

### Integration Points
```yaml
ROUTES:
  - UNCHANGED: routes/_app/songs.$songId.results.$jobId.tsx (validateSearch + all render states preserved).
  - tab keys UNCHANGED (results-tab-keys.ts) — deep-links depend on them.
STATE:
  - versionId from JobResultsDto.versionId → useRackPresets(versionId) (version-scoped, existing hook).
  - No new global/layout state; SendToListenCard owns its local state (preset-list/modal-open).
API (frontend hooks only — all pre-existing, NO new endpoints):
  - useFixRackGeneration(jobId), useRackPresets/useSaveRackPreset/useDeleteRackPreset(versionId),
    useVerdicts/useRunSpecialist(jobId), useEntitlements(), useVersionFiles(versionId).
STYLES:
  - CSS Modules per new component + global utility classes (.card/.pill/.btn/.mono). No Tailwind, no inline styles unless dynamic (accent color).
```

### Preserved surfaces (MUST still render under the same conditions)
| Surface | Current file:symbol | Preservation |
|---|---|---|
| Route: in-progress storyline | route:ResultsPage fallback + ProgressStoryline | verbatim |
| Route: failed + free retry | route lines 125-153, useFreeRetry | verbatim |
| Route: awaiting_stem_mapping | route lines 158-175 | verbatim |
| Route: complete-but-report loading/error | route lines 105-123 | verbatim |
| Route: job-status load error | route lines 94-103 | verbatim |
| Partial-phase banner | DegradationBanner + failed-phases | verbatim, mounted in ReportView |
| LLM-degradation notice | LlmDegradationNotice, gated on verdictsData.degradation | verbatim (sibling of banner; both may show) |
| Coach-offline card | CoachChat COACH_OFFLINE_COPY/OFFLINE_CODES | CoachChat kept verbatim |
| Fabricated-percentile guard | ReferenceTab:44 | re-implemented in reference-model, guard intact |
| phase8 skipped/failed fallbacks | ReportView project-skip-note + ProjectTab banner | verbatim |
| ProjectUnlock upsell | ProjectUnlock, gated ReportView:366 | verbatim |
| Coach caps + CoachCapChip | CoachChat caps + CoachCapChip | verbatim (server is source of truth) |
| CoachGateInline paywall | CoachGateInline, gated CoachChat:551 | verbatim |
| UpgradeSheet | opened on entitlement_exhausted (ReportView:235) | verbatim |
| Hidden when creditsEnabled===false | CoachChat creditsOn:100; extend to any new monetization in SendToListenCard | preserved + extended |
| On-page TriagePlanPanel + auto-run | CoachTab:112-142 + TriagePlanPanel | verbatim (CoachTab keeps them) |
| GenreCorrectChip | GenreCorrectChip (SongHeader host) | verbatim |
| TrackChip cross-links | FindingsTab.withTrackChips → onTrackActivate → project tab | verbatim |
| Debug dev-only + prod coercion | tabs-model:44 + ReportView:66 + :383 | all three gates preserved |

### Data-path mapping table (visual → final_json path; accessor `pickPhaseData<T>(fj,n)`)
| Visual / panel | final_json path (contract) | phase accessor |
|---|---|---|
| Loudness-over-time strip | `phase1.loudness_timeline.short_term.{t,lufs}[]` (+ `momentary.*`) | phase1 |
| Section overlay (strip + waveform) | `phase1.structure.segments[].{start,end,label}` (guard `structure.available/deferred`) | phase1 |
| Punch/dynamics card | `phase1.crest_factor`, `phase1.transients.{avg_transient_strength,transient_count,transients_per_second}`, `phase1.loudness_range_lu` | phase1 |
| L/R channel balance | `phase1.channel_balance.{balance_db,l_rms_db,r_rms_db}` | phase1 |
| Key detail | `phase1.key_estimate.{key,mode,confidence,second_key,second_mode,profile_corrs[]}` (+ `phase1.detected_key`, `phase1.key_detection_confidence`) | phase1 |
| Danceability | `danceability_score` (top-level) | fj root |
| Spatial height/depth | `phase9.spatial.{height_score,depth_score,width_consistency,analysis[]}` | phase9 |
| Mix translation — headphones | `phase9.playback.headphone_score` (+ `bass_translation`, `crossfeed_safe`) | phase9 |
| Mix translation — speakers | `phase9.playback.speaker_score` | phase9 |
| Mix translation — mono | `phase9.surround.mono_compatibility` (+ `phase9.surround.phase_score`, `is_atmos_ready`) | phase9 |
| Loudness card (existing) | `phase1.{lufs,true_peak_db,peak_dbfs,loudness_range_lu,clipping_detected,clipped_sample_count}` | phase1 |
| Tonal balance (existing) | `phase1.bands.*` | phase1 |
| Stereo card (existing) | `phase1.{stereo_width,stereo_correlation,mono_compatibility}` | phase1 |
| Reference — genre section | `phase6.percentile`, `phase6.gaps.{bpm,stereo_width,stereo_correlation}` (percentile/range valid for these ONLY) | phase6 |
| Reference — reference section | `phase5.status`, `phase5.deltas.*` (dynamic), `phase5.genre_context.*` | phase5 |
| Reference — per-stem deltas | `phase5.per_stem_reference_deltas[].{role,metric,delta,interpretation,reference_value,user_value,severity_tier}` | phase5 |
| Findings badge / vital | verdicts (`faultCount`) — not final_json | problems-helpers |
| Project health | `phase8.{health_score,grade,tempo,time_signature,total_devices,disabled_devices,clutter_pct}` | phase8 |
| Project arrangement | `phase8.arrangement.sections[].*` | phase8 |
| Project MIDI health | `phase8.midi.{total_clips,total_notes,empty_clips,short_clips,duplicate_clips,issues[]}` | phase8 |
| Project chords/swing | `phase8.midi_analysis[].{chords[].chord_name, swing_ratio, humanization_score}` (emitted, absent from stale contract — SEE RISK R1) | phase8 |
| Fix Rack Compiled | `FixRackDto.chain` (opaque → readFixChain) | fix-rack hook |
| Presets rows | `RackPresetDto.chain` (version-scoped) | useRackPresets |

---

## Risks — where the design assumes data we may not have

- **R1 (MED) — Project chords/swing (contract snapshot is stale, data IS emitted).** The `final_json.contract.json`
  file has no `phase8.midi_analysis[]` leaf, but the pipeline **does emit it** — verified directly in
  `components/analysis/src/audio_analysis/phases/phase8_als.py:130`: `phase8.midi_analysis[]` is a list of
  `{ track_name, note_count, velocity_mean, velocity_std, humanization_score, note_density_per_bar, chord_count,
  chords[].{time, chord_name, pitches, duration} (capped 48/track), swing_ratio }`. The contract simply misses it
  because the generating sample fixtures had no rich MIDI; the older dynamic-prefix entry `phase8.per_track_analysis`
  is the same data under a prior name. **So the panel resolves to _present_, not absent, on any real .als analysis** —
  bind to `phase8.midi_analysis[]` (chords + swing_ratio + humanization_score). Task 7 must still degrade cleanly when
  the array is empty/absent (mix-only or phase8 skipped), but the honest "not available" state is the fallback, not the
  default. Do NOT synthesize anything from the scalar `phase8.total_chord_count` alone.
- **R2 (MED) — Structure overlay on the waveform.** The waveform is a static server-rendered PNG
  (`JobResultsDto.waveformImageUrl`), not a WaveSurfer canvas. Section markers must be a proportional
  overlay aligned to `phase1.duration_seconds`; time-accuracy is only as good as the PNG's fixed extent.
  Also `phase1.structure` is frequently `available:false` / `deferred:true` (allin1 Docker gating) —
  the overlay and the loudness-strip section bands MUST degrade to "no structure" cleanly.
- **R3 (MED) — Genre percentile scope.** Percentile/range is statistically valid ONLY for `bpm`,
  `stereo_width`, `stereo_correlation` (+ overall `phase6.percentile`). `phase6.gaps` may contain other
  keys; do NOT render range bars/percentiles for them. This is a deliberate honesty constraint (decision 3).
- **R4 (LOW) — Stale frontend phase types.** `Phase5Data`/`Phase1Data` in `api/types.ts` predate the
  contract. Task 1 must extend them or the new panels won't type-check. Purely additive/optional — no runtime risk.
- **R5 (LOW) — Loudness timeline density.** `loudness_timeline.short_term.t[]`/`lufs[]` can be long; use
  Recharts responsibly (no per-point DOM); the strip is decorative-analytic, not interactive.
- **R6 (LOW) — RackModules vs RackView divergence.** `RackModules.tsx` renders free-text `MoveStep[]`, not
  a Chain. RackView does not replace it. Keep both; don't force one to render the other's data.

---

## Validation Loop

### Level 1: Syntax & Style
```bash
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run lint      # --max-warnings 0
# Expected: 0 errors, 0 warnings. Fix root cause — never // eslint-disable to pass.
```

### Level 2: Unit Tests (vitest) — at least expected / edge / failure per new logic module
```ts
// rack-view-helpers.test.ts
//  expected: full enabled chain → signalFlowNodes in order with accents/glyphs
//  edge:     eq module with some bands disabled → only enabled bands become rows
//  failure:  malformed/empty chain → signalFlowNodes([]) returns [], RackView renders "Empty rack"

// send-to-listen-model.test.ts
//  expected: presetRows() returns Coach Mix `auto` row (when ready) + user presets
//  edge:     no presets → presetsEmptyCopy
//  failure:  versionId=null → presets list disabled (no crash)

// reference-model.test.ts
//  expected: phase6 (3 metrics) + phase5 deltas → both sections show, ◇ overlay for shared metrics
//  edge:     phase6 only (no reference attached) → reference.show=false, genre.show=true
//  edge:     reference only / low genre confidence → genre.show=false, percentile=null (guard holds)
//  failure:  phase6.percentile absent → percentile=null, honest "can't place you" (never overall_score)

// panels: each new panel test asserts degrade-to-null on absent data
//  LoudnessTimelineStrip: absent loudness_timeline → renders null
//  StructureOverlay: structure.available=false → renders "no structure" not a bar
//  ChannelBalance/KeyDetail/Punch/Spatial/Danceability: absent phase data → "—"/null, no throw

// Retain/port existing tests for preserved surfaces (DegradationBanner, LlmDegradationNotice, CoachGateInline,
//  CoachCapChip, GenreCorrectChip, ReferenceTab, ProjectUnlock, triage-plan-panel, results-tabs, move-model, track-highlight).
```
```bash
cd components/frontend-spectr-v2 && npx vitest run
```

### Level 3: Build (integration)
```bash
cd components/frontend-spectr-v2 && npm run build
# Expected: clean production build. Then start the stack per docs/STARTUP.md (./scripts/start-spectr.ps1)
# and eyeball: complete report, each route state, Send-to-Listen card (generate Coach Mix → auto preset row → chain modal), Reference two-section layout,
# new Track Analysis panels degrading cleanly on a mix-only analysis, ?tab=debug→coach in a prod build.
```

## Final validation Checklist
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean (`--max-warnings 0`)
- [ ] `npm run build` clean
- [ ] `npx vitest run` green (new + retained tests)
- [ ] git diff confined to `components/frontend-spectr-v2/` (no BFF/worker/contract change)
- [ ] All Preserved surfaces render under their conditions
- [ ] All new panels bind only to contract paths and degrade to null/"—" on absent data
- [ ] Coach Mix `auto` row and Presets rows render via the same `RackView`
- [ ] Reference tab shows genre + reference per-metric with fabricated-percentile guard intact

---

## Out of Scope (explicit)
- **No backend changes** — no BFF endpoint, DTO, worker, migration, or `schemas/final_json.contract.json` edit.
  final_json already carries every field.
- **No cross-track presets** — rack presets stay version-scoped (`RackPresetDto.songVersionId`); no library/global preset store.
- **No DAW-Plan "build-your-export" tool** (decision, approved) — the revised design expands DAW Plan into a format
  switch (Markdown/plain/**PDF**), detail level, order-by, section checkboxes, and live preview. Port only the EXISTING
  simple markdown export (current `ExportModal` + `moveToMarkdown`). The full builder — especially PDF (new dependency) —
  is a deferred follow-up, not part of this port.
- **No per-band genre curve** — the mean±σ 7-band reference curve (`RefBandCurve`) is dropped; that data doesn't exist.
- **No new pitch/tempo or DSP engine work** — RackView is READ-ONLY; it does not apply chains (that's Listen's `chainApply.ts`).
- **No coach caps / spend / entitlement logic changes** — CoachChat + CoachCapService untouched; only re-parented into the new shell.
- **No changes to the RackModules move-step renderer** — it stays for verdict Move steps.
- **Prototype chrome not built** — TopBar, standalone Player, Sidebar uploads panel in the design are scaffold; reuse existing app chrome.

---

## Anti-Patterns to Avoid
- Don't read `fj.phase1` directly — use `pickPhaseData<T>(fj, n)`.
- Don't read a Chain without `readFixChain`/`asChain` — it's `unknown` on the wire.
- Don't duplicate RACK_MANIFEST — RackView/DeviceModule consume `listen-rack/data.ts`.
- Don't invent a chord/swing panel from `total_chord_count`, or a percentile from `overall_score`.
- Don't render genre percentile/range bars for metrics outside `{bpm, stereo_width, stereo_correlation}`.
- Don't drop any Preserved surface to "simplify" — they are load-bearing honesty/monetization.
- Don't add Tailwind, styled-components, axios, or localStorage-for-auth.
- Don't skip a gate because "it should pass" — run all four.
