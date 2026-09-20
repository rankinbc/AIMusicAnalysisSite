# Findings & Actions in the Listen stage — design spec

_Status: binding design authority for `PRPs/archive/2026-09-20_listen-findings-in-stage-plan.md` (executed 2026-09-20)._
_Written 2026-09-19 against `solo` @ `df23e65`. Every code claim below was
re-verified in the working tree; where the seed
(`PRPs/source/listen-findings-in-stage.md`) disagrees with the code, the code
wins and the disagreement is listed in §11._

---

## 1. The ask

> "Bring all the findings and actions into the Listen page. They could go in
> this box [the stage box, where the spectrum/visualizer renders] and the
> visuals would be in the background by default."

Concretely: on `/listen-rack/$versionId`, the stage box — today a 210 px
visualizer strip with a transport under it — becomes a **two-mode surface**.
Mode 1 is the existing visualizer. Mode 2 is the analysis board (Findings /
Actions) for the version that is playing, with the visualizer relegated to a
full-screen layer *behind* the whole page. Reading a finding, jumping to where
it happens, and hearing its fix on the live rack all happen without leaving
the page.

---

## 2. Decisions

Each decision carries its rationale. These are binding; the plan implements
them and nothing else.

### D1 — Scope is the board + the stage, nothing upstream or downstream

**Decision.** This spec covers the seed's Slice 1 (a live Findings/Actions
board fed by the playing version's verdicts, with per-fix apply) and Slice 2
(that board lives *inside* the stage box, visuals move to the background,
two-step stage height, perf). It does **not** add a Listen tab as an
intermediate step — the board goes straight into the stage.

**Rationale.** The product ask is specifically about the stage box. A tab
version would be thrown away in the same release and would create a third
place to reason about board state. Slices 0 and 3 are listed in §10.

### D2 — The Listen board never writes verdict state

**Decision.** No `applied`, `dismissed` or `feedback` mutation is reachable
from the Listen page. "Apply" on Listen means: toggle that one fix onto the
**live rack** through the existing per-fix engine
(`useFixOverlay` → `combineFixes` → `applyRackMod`), local to the session and
instantly A/B-able with the rack's master bypass. There is no new source of
truth for "applied".

**Rationale.** `ReportView.tsx:151-155` and `FixBoard.tsx:27-28` both carry
the same scar comment: the queue is localStorage-only *by design*, because a
single bulk action that wrote server `applied` "permanently marks every
finding applied (the 78-fixes-queued footgun)". A Listen page whose primary
verb is "apply" is exactly the surface that would re-create that bug at scale.
Read-only also means the board can never disagree with the report about what
the user has committed to.

**Consequence.** `onIgnore`, `onMarkApplied`, `onRate` are never passed on
Listen, and the affordances that call them do not render there (D9).

**Caveat (2026-09-19).** "Never writes verdict state" is exact; "read-only
toward the server" is not. Opening the board performs
`GET /reports/{jobId}/verdicts/`, which on a never-opened report lazily
dispatches the triage job — no verdict-state write, but not side-effect free.
See D12.

### D3 — The board shows findings for the playing version only, resolved by a new `latestJobId` on the version DTO

**Decision.** The board's `jobId` comes from a new
`VersionDto.latestJobId: Guid?` (`string | null` on the wire), populated by
`GET /api/versions/{id}` from the newest `analyses` row whose `version_id`
is that version. When it is `null` the board renders an empty state that links
to the song page. The song-level `song.latestResult.jobId` is **never** used
to source findings.

**Rationale, and why the alternatives lose.**

- `song.latestResult.jobId` (what the route already loads, `listen-rack.$versionId.tsx:58`)
  is the newest analysis **for the song**, which for any song with more than
  one analyzed version is a different version's report. The route already
  computes `statsSource.mismatch` from exactly this hazard
  (`listen-rack.$versionId.tsx:82-87`) and `ListenRackPage` never reads it.
  Findings with timestamps from another version's mix, over this version's
  audio, is worse than showing nothing.
- `VersionDto.latestResult` carries no job id: it is a `VersionMetricsDto`
  (`score, lufs, dynamicRangeLu, bass, air, stereoWidth` —
  `DTOs/VersionDtos.cs:3-9`). The seed is right about this.
- A pure-frontend resolution via `useJobs({ status: 'complete' })` +
  filter-by-`versionId` is possible (`JobSummaryDto` has `versionId`,
  `status`, `completedAt`) but is **not correct**: `GET /api/jobs` orders by
  `DispatchedAt desc`, takes `limit*2` rows and filters status *in memory*
  (`JobEndpoints.cs:174-206`), with no `versionId` filter at all. An older
  version of a prolific user's library silently falls off the page and the
  board goes empty for no visible reason.
- The BFF addition is genuinely cheap. `analyses` is documented as
  "one row per completed analysis (1:1 with successful AnalysisJob)"
  (`Entities/Analysis.cs:6`), so *a row exists ⇒ the analysis completed* — no
  status join is needed. `GET /api/versions/{id}` is one extra ordered
  `Analyses` lookup; `GET /api/songs/{id}` already batch-loads the same
  newest-analysis-per-version set (`SongEndpoints.cs:149-156`) and only throws
  the job id away.

`VersionDto.LatestJobId` is populated by `GET /api/versions/{id}` only; the
other two `VersionDto` construction sites (`SongEndpoints.ToVersionDto`,
`VersionEndpoints.PatchVersion`) leave it `null`. That is deliberate and must
be commented on the record — the Listen route reads the version through
`useVersion`, which hits exactly the endpoint that populates it.

### D4 — Click-to-seek renders only where a usable time range exists

**Decision.** A "jump to it" affordance renders on a finding/action detail
**only** when `timeRangeOf(verdict, duration)` returns non-null, i.e. a finite
`start_seconds` in `[0, duration)` from `verdict.where` or, failing that,
`verdict.fix.section`. Otherwise nothing renders — no disabled button, no
tooltip, no placeholder. No worker or prompt changes.

**Rationale.** This mirrors the pattern the codebase already uses for exactly
this problem: `EvRows` renders its spectrum deep-link chip only when
`r.frequency_range_hz && onShowSpectrum` (`FixBoardChips.tsx:108`). The data
is sparse today — no frontend code reads `fix.section` at all (verified by
grep across `src/`), and the seed measured `where.start_seconds` at 0 % and
`fix.section.start_seconds` at ~2.6 % of 740 local verdicts (that measurement
was **not** re-run in this session; the design does not depend on it because
the affordance is decided per row). Populating ranges is Slice 0 (§10); when
it lands, this surface lights up with no frontend change.

### D5 — Two-step stage height; the board scrolls inside the stage

**Decision.** `STAGE_HEIGHT = 210` (`ListenRackPage.tsx:52`) stays the
visualizer height, unchanged. The findings content gets its own height,
`clamp(210px, calc(100vh - 470px), 420px)`, applied in CSS on the board
wrapper. `overflow: hidden` on `.lr-stagecard` (`listen-rack-v2.css:26`)
stays — it clips the card's rounded corners and is harmless because the board
owns its own scroll regions. What must be re-based are the board's *own*
height rules, which assume a full page column:

**What actually shipped** (`findings/findings-stage.css`), after the first
build was measured in Chrome — `max-height: 100%` alone does not make a
*block* box scroll inside a flex column, so `.fb-list` grew to its full
content height (**4700 px in a 349 px box**) and `.fb-list { overflow: hidden }`
clipped it with no scrollbar. The list pane had to become a flex column of its
own before `flex: 1` on `.fb-scroll` meant anything. jsdom has no layout, so
only a browser shows this.

| rule | today (`redesign-v3-tabs.css`) | inside the stage (shipped) |
| --- | --- | --- |
| `.fb-list` | *(plain block)* | `display: flex; flex-direction: column; min-height: 0` |
| `.fb-scroll` | `max-height: min(64vh, 540px)` | `max-height: none; flex: 1; min-height: 0` |
| `.fb-detail` | `position: sticky; top:14px; max-height: calc(100vh - 28px)` | `position: static; max-height: none; min-height: 0` |
| `.fb-detail.empty` | `min-height: 220px` | `min-height: 0; padding: 20px` |
| `.fbd-scroll` | *(inherits)* | `flex: 1; min-height: 0` |
| `.fixboard` | `margin-top: 14px` | `margin: 0; width: 100%; flex: 1; min-height: 0; align-items: stretch` |

**Rationale.** 420 px is the smallest height at which the master-detail board
is usable (the detail panel's own empty state is 220 px). The `clamp` floor
keeps it from collapsing below today's stage; the `calc(100vh - 470px)` term
reserves the header, transport, tab strip and a readable tab body so the
transport and rack never leave the viewport on a 900 px-tall window. §9 gives
the exact check and the exact fallback if the reservation is wrong.

### D6 — Two prefs, per viewer, in localStorage, safe without it

**Decision.** Two values persist under one key, `listenStagePrefs`
(app-wide, not per version — it is a viewing preference, not track data):

- `content: 'findings' | 'visualizer'`
- `bgViz: boolean` — "the visualizer is playing full-screen behind the page"

Reads and writes are wrapped in `try/catch`; every accessor returns a usable
default on throw, and the page renders correctly with storage disabled.

**First-visit defaults:** `content: 'findings'`, `bgViz: true`. Under
`prefers-reduced-motion: reduce`, `bgViz` defaults to `false`.

**Rationale.** "Findings in the box, visuals in the background" is the product
default (P1/§1). Reduced-motion users get the board with no moving canvas
behind it, matching the existing photosensitivity handling in `VizStage`
(`viz.tsx:397-399, 433, 474`) rather than fighting it. Reduced motion only
changes the *default* — an explicit stored choice always wins, because a user
who turned the background on meant it.

**State model.** `content` and `bgViz` are independent and every combination
is legal and meaningful:

| `content` | `bgViz` | what renders |
| --- | --- | --- |
| `findings` | `true` | board in the box; visualizer portaled full-screen behind the page (**default**) |
| `findings` | `false` | board in the box; no visualizer rendering at all |
| `visualizer` | *(n/a)* | today's stage, in the box — see ruling L7 |

**Ruling L7 (2026-09-19, after the whole-feature review).** The original
model above let the persisted `bgViz` drive BOTH views, so a first visit
(`bgViz: true` by default) that clicked "Visualizer" got the frosted "playing
full-screen in the background" placeholder and no visualizer in the box. The
persisted pref means **"visuals behind the board"** — what the product owner
asked for — so it governs the **findings view only**.

In the **visualizer view** the visuals are IN THE BOX by default and the ⛶
placement control sends them to the background for **that session only**
(local `useState` inside `StageCardV2`, default `false`, never persisted) —
exactly the pre-feature behaviour, which is also what makes §9 item 14 ("the
visualizer view is unchanged") true.

`StageCardV2` therefore keeps its single stable `<VizStage>` call site and
passes `bgMode={showBoard ? true : vizBg}`,
`onBgModeChange={showBoard ? onBgVizChange : setVizBg}`,
`slot={showBoard ? 'none' : 'ghost'}`, rendered when `(!showBoard || bgViz)`.
A Findings(background) → Visualizer(in-box) switch is a legitimate remount;
node identity is only preserved where `bgMode` stays on across the switch.

### D7 — No `backdrop-filter` behind the board; the device-pixel cap stays

**Decision.**

1. While `content === 'findings'`, the stage card must compute
   `backdrop-filter: none`, and no descendant of the board may introduce one.
2. The background visualizer keeps its existing device-pixel cap,
   `Math.min(2, window.devicePixelRatio || 1)` — `viz.tsx:40` (StageCanvas),
   `viz.tsx:160` (LaserFan), `viz.tsx:237` (Fireworks), and
   `LightShow.tsx:34`. Nothing in this change may raise it.

**Rationale.** The cap exists (the seed left this open); the hazard is the
blur. `listen-rack-v2.css:386` declares
`.rdx .lr-glass .card { background:…; backdrop-filter: blur(9px) }`, and the
stage card is `className="card lr-stagecard"` (`StageCardV2.tsx:78`) — so the
stage box **already** runs a backdrop blur, and in background mode the thing
being blurred is a full-viewport canvas repainting every frame. A hover-heavy
scrolling list inside that region is the worst case the seed flagged. The
override is a one-rule fix and it is specificity-safe:
`.rdx .lr-glass .lr-stagecard[data-stage="findings"]` (0,4,0) beats
`.rdx .lr-glass .card` (0,3,0) regardless of import order.

**Verification** is mechanical, in the live task (§9): `getComputedStyle`
reports `backdropFilter === 'none'` on the stage card, `.fb-list`,
`.fb-scroll` and `.fb-detail`; and every canvas in the portaled stage
satisfies `canvas.width <= innerWidth * 2 && canvas.height <= innerHeight * 2`.

### D8 — A carried fix preset locks per-fix toggling until it is cleared

**Decision.** When the page is opened with `?fixPreset=<uuid>`:

- `carryPhase === 'pending'` → the board renders and reads normally; every
  apply control is disabled with the note **"Loading the carried fix rack…"**.
  `pending` is bounded: a preset GET that has not answered after
  `CARRY_TIMEOUT_MS` (15 s) flips to `failed` with the existing "could not
  load" toast, and a late answer is ignored — otherwise a hung request would
  hold per-fix toggling AND the draft restore/autosave forever (added
  2026-09-20).
- `carryPhase === 'applied'` → apply controls stay disabled with the note
  **"A fix preset is loaded — clear it to A/B single fixes."** plus a
  **Clear preset** button that calls the page's existing
  `onResetCarriedFixes`.
- `carryPhase === 'none' | 'failed'` → per-fix toggling is fully live.

The board is always fully readable; only the *apply* verb is gated.

**Rationale, and why the alternative is impossible.** The seed's other option
— decompose the carried preset back into per-fix toggles — cannot be built.
The preset is a `RackPresetDto.chain`, i.e. a single merged `Chain`. It is
produced by `combineFixes`, a weighted, order-independent merge
(`combineFixes.ts:201`) that nets EQ gains, caps boosts and drops conflicts;
per-fix provenance is destroyed by construction. `FixRackDto.coachMeta.change_log`
records `{ module, change, why }` — module-level, with no fix or verdict ids
— so there is nothing to invert. Any "decomposition" would be a guess that
double-applies whatever it guessed wrong.

The gate is also the rule the product **already states to the user**. The
Send-to-Listen tooltip reads: *"Queue fixes in the findings list — each
carries to Listen on its own so you can A/B one change at a time. Presets
(like Coach Mix) are full chains you audition as one."*
(`SendToListenCard.tsx:52-56`). One-at-a-time and audition-as-one are already
two modes; D8 just makes the mode visible on the page where it matters, and
the escape hatch already exists and is already tested — `onResetCarriedFixes`
(`ListenRackPage.tsx:277-292`) resets the rack, calls `clearFixOverlay`, and
strips `fixPreset` from the URL.

`carryPhase === 'failed'` enables toggling because the carry explicitly did
**not** touch the rack (`ListenRackPage.tsx:254-270` returns before
`applyRackMod` on every failure path).

### D9 — One `surface` prop, not a fork

**Decision.** `FixBoard`, `FindingDetail` and `ActionDetail` gain
`surface?: 'report' | 'listen'`, defaulting to `'report'`, and their four
server-write handlers (`onIgnore`, `onMarkApplied`, `onRate`, `onAskCoach`)
become optional. Every affordance that writes server state or refers to the
report's own geography renders only under `surface === 'report'`. Nothing is
forked, copied, or re-implemented.

**Copy that changes under `surface === 'listen'`** (exhaustive):

| where | report copy | listen copy |
| --- | --- | --- |
| `ActionDetail` footnote (`:154`) | `Add to apply live on the Listen page` | `Apply it to hear it on the rack now` |
| `ActionDetail` footnote (`:156`) | `Add to preview an approximation on Listen` | `Apply it to preview an approximation` |
| `ActionDetail` footnote (`:151`) | `Queued for Listen{· approximation}` | `Applied to the rack{· approximation}` |
| `ActionDetail` toggle (`:165`) | `Add to fix rack` / `Added` | `Apply live` / `Applied` |
| `ActionDetail` master chip tip (`:136`) | `…the Listen rack reproduces it exactly.` | `…the rack reproduces it exactly.` |
| `ActionDetail` device chip tip (`:141-144`) | `…so adding it auditions a master-bus approximation…` | `…so applying it auditions a master-bus approximation…` |
| `ActionDetail` note tip (`:321`) | `…apply it in your project; nothing gets queued to Listen.` | `…apply it in your project; there is nothing to put on the rack.` |
| `FixBoard` row title (`:446`) | `Queue this fix` / `Remove from Listen queue` | `Apply to the rack` / `Remove from the rack` |
| `FixBoard` findings-row tip (`:402`) | `A suggested fix is available — check to queue it` | `A suggested fix is available — check to hear it` |

**Affordances hidden under `surface === 'listen'`:** the per-row ignore icon
(`FixBoard.tsx:426-437`), Mark applied (`ActionDetail.tsx:244-252`), the
Rate-this-Suggestion block and its modal (`ActionDetail.tsx:254-293`), both
"Ask the coach" buttons (`FixBoard.tsx:416-425`, `FindingDetail.tsx:119-124`,
`ActionDetail.tsx:325-330`), and the fix-less row's **note checkbox**
(`FixBoard.tsx:404-415`). The first three are server writes (D2);
ask-the-coach is hidden because the Listen page has no coach thread to seed —
`CoachTabV2` links out to the report's coach (`CoachTabV2.tsx:111-124`); the
note checkbox belongs to the report's Actions tab (it writes
`findingNotes:{versionId}` and only surfaces rows *there*), so on Listen it
would be a control with no visible effect. Consequently the Listen board passes
an empty `checkedNoteIds` set, which in actions mode means only rows with a
live fix are listed — exactly the right list for a page whose verb is "apply".
Re-homing ask-the-coach is a §10 follow-up.

`onShowSpectrum` is simply **not passed** on Listen, so `EvRows` drops its
spectrum chip via its existing `&& onShowSpectrum` guard — no new code.

**`SendToListenCard`, `ActionsBar` and `ImprovementPlanTab` are not rendered
on Listen at all**, so their copy needs no change (P9 is satisfied by not
mounting them).

### D10 — Reuse; new code in one new folder; the page barely grows

**Decision.** All new code lives under
`components/frontend-spectr-v2/src/features/listen-rack/findings/`:
one container component, one state hook, pure helpers, one stylesheet, tests.
The board itself is the existing `FixBoard` and its children, styled by the
existing `features/results/redesign-v3-tabs.css` — the Listen page root is
already `<div className="rdx lr-shell">` (`ListenRackPage.tsx:521`), so the
whole `.rdx`-scoped board stylesheet applies with a single import.

**The import is safe, mechanically checked.** Zero rules in
`redesign-v3-tabs.css` can match using only class names that appear in
`features/listen-rack/*.tsx` markup (206 listen classes × 1131 tabs selectors
→ 0 fully-matchable rules). The import goes in `ListenRackPage.tsx`
immediately after `redesign-v3.css`, mirroring `ReportView.tsx:62-63`, so
`listen-rack-v2.css` still loads last and still wins ties.

**`ListenRackPage.tsx` is 635 lines — already over the ~500 limit.** P10's
escape clause applies: the plan's first task extracts two self-contained
blocks with no behaviour change, so the file is under ~500 *before* the
feature adds anything:

- `useFixCarryOver.ts` — the `?fixPreset=` carry-over and the draft
  restore/autosave that is sequenced by it (`ListenRackPage.tsx:196-292`,
  ~90 lines). These two are one concern: `resolveDraftRestore` takes
  `carryPhase` as an input (`useRackPresets.ts:158-171`), so splitting them
  apart would be the wrong seam.
- `useRackPresetActions.ts` — the server-preset list projection and the
  save / recall / export / import handlers plus the hidden file input
  (`ListenRackPage.tsx:184-194, 294-339`, ~55 lines).

**Final line counts as shipped** (2026-09-19, after the fix wave):

| file | lines | cap |
| --- | --- | --- |
| `ListenRackPage.tsx` | 512 | 515 (P10 escape clause; was 635) |
| `viz.tsx` | 592 | must not grow — holds the Fragment-shape fix (D6/L7) |
| `FixBoard.tsx` | 496 | 500 |
| `ActionDetail.tsx` | 476 | 480 |
| `StageCardV2.tsx` | 179 | — |
| `useFixOverlay.ts` | 145 | — |

Net: ~635 → ~490, then ~505 after this feature's ~15 lines. The feature's own
additions to the page are: one CSS import, one `useStagePrefs()` call, one
`useListenFindings()` call, six props on `StageCardV2`, one prop on
`CoachTabV2`, and a `songId` prop.

### D11 — Exactly one `useFixOverlay` instance per page (a bug this feature would otherwise introduce)

**Decision.** `useFixOverlay` is called **once**, inside `useListenFindings`,
which is called once from `ListenRackPage`. The resulting
`{ isApplied, toggle }` handle is passed both to the stage board and to
`CoachTabV2`, whose `RealFixes` stops calling `useFixOverlay` itself and
becomes a presentational list.

**Rationale.** `RealFixes` (`CoachTabV2.tsx:36-43`) mounts its own
`useFixOverlay` whenever the Coach tab is open. The stage board mounts one
whenever the stage shows findings. Both can be open at the same time. Each
instance holds its own `baselineRef` and `appliedIds`, each writes the same
`listenApplied:{versionId}` key, and each `recompute` rebuilds the whole rack
from *its* baseline (`useFixOverlay.ts:71-91`) — so a toggle in one silently
discards the other's contribution. One instance is the only correct answer.

`RealFixes` keeps `readListenFixes(versionId)` as its *display* list (the
report's queued subset); the shared hook is fed the **full** applyable move
list, so its `byId` map (`useFixOverlay.ts:67-69`) resolves every id either
panel can toggle. Applied ids outside the queue simply don't appear in the
Coach tab's list — which is correct, not lossy.

### D12 — The board needs only `useVerdicts`; no second results fetch

**Decision.** `useListenFindings` calls `useVerdicts(jobId, { enabled, optimisticRunning })`
and `buildMoves({ verdicts })` with `topFixes`/`coachedFixes` omitted.

**Rationale.** `FixBoard` derives every row from `verdicts`, and touches
`moves` only through `moveFor`, which is keyed on `move.verdictId`
(`FixBoard.tsx:85-88`). Rule-engine string moves carry `verdictId: null` and
`ops: []` (`move-model.ts:214-245`), so they are invisible to the board by
construction. Fetching `final_json` on Listen just to feed two arrays the
board cannot render would be a wasted request — and the only `final_json` the
route has is the *song's* latest, which D3 forbids using.

**Not side-effect free (correction to D2/D12).** Opening the board performs
`GET /reports/{jobId}/verdicts/`, and on a report that has never been opened
that endpoint lazily dispatches the triage job. It writes no verdict *user*
state — D2 holds — but "read-only toward the server" is not literally true:
standing on Listen can start an analysis-side job the viewer never asked for.

---

### Overlay safety (added 2026-09-19 — whole-feature review, F1/F2)

The fix overlay is shared by two surfaces whose rows come from two different
id spaces: the stage board's rows are built from the CURRENT analysis's moves
(`boardListenFixes(moves)`), while the Coach tab's rows are read from the
version's localStorage queue (`readListenFixes(versionId)`), which can outlive
the analysis that produced it. The rules that make that safe:

1. **An id the overlay cannot resolve is a complete no-op.** `toggle(id)`
   returns immediately when `!byId.has(id)` (unknown id, or a `notApplicable`
   fix): no `appliedIds` change, no storage write, no rack write. Before this,
   such an id fell into recompute's "nothing checked" branch and rebuilt the
   rack from nothing.
2. **The overlay never resets the rack to factory defaults.** With nothing
   resolvable checked it restores the captured baseline **only if one exists**.
   The legacy `composeRack([])` fallback survives only for a caller that passes
   no `getLiveMod` — no production caller does. A reset to defaults here was
   silently persisted by the ~1.2 s rack-draft autosave: data loss, not a
   cosmetic bug.
3. **The baseline is persisted per version** under `listenBaseline:{versionId}`,
   beside `listenApplied:{versionId}`. It is written the moment it is captured
   and cleared when the applied set empties, on `FIX_OVERLAY_CLEAR_EVENT` and
   inside `clearFixOverlay(versionId)`. Both halves are restored on mount and
   on every `versionId` change. Without it, the first un-apply after a reload
   hit the same defaults branch — the rack restored from the autosaved draft
   (which already contained the fix) was replaced by defaults.
4. **Applied ids with no stored baseline are dropped** (`[]` + rewritten), and
   the rack is left alone: we cannot undo what we cannot reconstruct, and the
   UI must not claim "applied" for something it cannot un-apply.
5. **Fixes are never re-applied on mount.** The draft-restore effect races the
   overlay with a chain that already contains whatever was applied when
   autosave last fired. Residual gap: if the tab closes inside the autosave
   debounce the draft may lack a fix the board lists as applied — toggling it
   off and on reconciles.
6. **The Coach tab obeys the same gate.** It shares the page's one overlay
   (D11), so the D8 carried-preset lock holds there, and a queued row whose id
   `!overlay.canToggle(fixId)` renders disabled ("from an earlier analysis —
   add it again from this version's report") and never reaches `toggle`.

---

## 3. Data flow

```
route  useVersion(versionId) ──► version.latestJobId          (D3)
        │
        ▼
ListenRackPage
  useStagePrefs()            ──► { content, setContent, bgViz, setBgViz }   (D6)
  useFixCarryOver({...})     ──► { fixesApplied, carryPhase, onResetCarriedFixes }
  useListenFindings({ versionId, latestJobId, rs })                         (D12)
        │   useVerdicts(jobId) → verdicts
        │   buildMoves({ verdicts }) → moves
        │   buildListenFixes(moves, () => true) → ListenFix[]
        │   useFixOverlay({ versionId, fixes, applyRackMod, getLiveMod })   (D11)
        ▼
  { status, jobId, verdicts, moves, appliedIds, overlay, retry }
        │                                   │
        ├──────────────► StageCardV2 ───────┤
        │                 └─ FindingsStage ─┴─► FixBoard surface="listen"
        └──────────────► CoachTabV2 ──► RealFixes (same overlay handle)
```

`Move.id === VerdictDto.id` for every AI move (`move-model.ts:186, 206`), and
`ListenFix.fixId === Move.id` (`listenFixes.ts:53`), so one id space runs from
the verdict through `committedIds` to the overlay. `buildListenFixes` already
accepts `Move` structurally via `FixSource` (`listenFixes.ts:29-39`) — the
seed's "~5-line adapter" is zero lines: `buildListenFixes(moves, () => true)`.

---

## 4. The stage surface

### 4.1 Layout

```
┌─ .lr-stagecard  (card, data-stage="findings"|"visualizer") ────────┐
│   content="visualizer" → <VizStage/> exactly as today               │
│   content="findings"   → .lr-findings-stage > <FindingsStage/>      │
│                          height per D5, 34px top padding            │
│ ┌ .lr-ovl (absolute, right:54, z3, pointer-events:none) ─────────┐ │
│ │ [Findings|Visualizer]  Section ⟨sp⟩                     Chain  │ │
│ └────────────────────────────────────────────────────────────────┘ │
│   ⛶/⤡  (absolute, top:12 right:12 — from VizStage in visualizer    │
│         mode, from StageCardV2 in findings mode)                    │
│ ┌ <TransportV2/> (play, scrub, note pins) — unchanged ───────────┐ │
│ └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

`.lr-ovl` and `TransportV2` are siblings of the stage content and keep today's
geometry exactly (`right: 54` still reserves the corner for the placement
button), so a content swap leaves the transport and the Section/Chain chips
where they are. The content switch is inserted as `.lr-ovl`'s **first child**,
so it is in the same band in both modes; it needs `pointer-events: auto`
because `.lr-ovl` disables them. The findings content carries `34px` of top
padding so the floating chip band never covers the first board row.

### 4.2 Controls

- **Content switch** — a two-button segmented control using the existing
  `.lr-seg` styling (`listen-rack-v2.css:179-182`) plus a `.lr-stage-seg` class
  for `pointer-events: auto`, `role="tablist"`, labels `Findings` and
  `Visualizer`. Rendered only when the page supplies a `findings` node, so the
  mock demo route (no `versionId`) is untouched.
- **Placement button** — the existing `⛶ / ⤡` button, unchanged in position,
  glyph, title and appearance. It is extracted verbatim from `viz.tsx` into
  `findings/StagePlacementButton.tsx` and rendered by `VizStage` (when
  `content === 'visualizer'`) or by `StageCardV2` (when
  `content === 'findings'`). Its styles stay **inline**: in background mode
  the whole stage is portaled to `document.body`, outside `.rdx`, so a scoped
  class cannot reach it. That is the "dynamic" exemption in CLAUDE.md and it
  must carry a comment saying so.
  Titles: on `visualizer`, today's `Play full-screen in the background` /
  `Exit background mode`. On `findings`,
  `Play the visualizer full-screen behind the page` /
  `Stop the background visualizer`.

### 4.3 `VizStage` changes

`bgMode` becomes controlled. `VizStage` is rendered from exactly one place
(`StageCardV2.tsx:79`), so this is a safe signature change:

- **new required props:** `bgMode: boolean`, `onBgModeChange: (v: boolean) => void`
- **new optional prop:** `slot?: 'ghost' | 'none'` (default `'ghost'`)
- `slot="none"` + `bgMode` → return only `createPortal(stage, document.body)`;
  no frosted ghost, because the board owns the box.
- the internal `useState`, the Escape-key effect and the ghost markup are
  otherwise unchanged; the Escape handler now calls `onBgModeChange(false)`.
- **shipped correction (L7):** the Escape handler binds only when
  `slot !== 'none'`. In the findings view the board owns the box, so a stray
  Escape would silently kill the background visualizer the viewer had asked
  for, with no visible control having been touched.

### 4.4 Board states

| state | render |
| --- | --- |
| `latestJobId == null` | `.lr-stage-msg` panel (the stage's own muted row — *not* `.fb-empty`, which is `FixBoard`'s internal empty state and never renders outside it): "This version hasn't been analyzed yet." + `<Link to="/songs/$songId">Open this song to analyze it</Link>` |
| verdicts loading | one muted `.mono` line: "Loading findings…" |
| verdicts error | "Couldn't load the findings for this version." + a **Retry** button calling `retry()` |
| verdicts empty | `FixBoard`'s own `.fb-empty` "No issues found" (`FixBoard.tsx:174-186`) |
| ready | `FixBoard` in the current board mode |

`songId` reaches the page as a new optional `ListenRackPageProps.songId`, fed
from `version.songId` in the route. It cannot come from `reportRef`, which is
`null` whenever the song has no analysis at all — precisely the case the empty
state exists for.

Board mode (`findings` / `actions`) is local `FindingsStage` state, default
`actions` (the Listen page's verb is "apply"), switched by `FixBoard`'s own
`onShowFix` / `onShowFinding` cross-links and by a small mode toggle in the
board header. It does not persist.

---

## 5. Apply semantics on Listen

`FindingsStage` passes:

- `committedIds` = the overlay's applied-id set
- `onToggleCommit = (move) => overlay.toggle(move.id)`, **wrapped by the D8
  gate**: when the gate is closed the handler is a no-op and the controls
  render disabled.

So a checked row on Listen means "this fix is on the rack right now", not
"queued". Unchecking restores the pre-fix baseline that `useFixOverlay`
captured from the live rack at first apply (`useFixOverlay.ts:76-84`), so
manual knob moves survive. Master bypass A/Bs the whole result. Fixes whose
ops map to no rack module are rendered by `RealFixes` today as disabled rows
(`notApplicable`); on the board they are ordinary rows whose apply control is
disabled with the tooltip "Not applicable on the rack — take it to your DAW",
using the same `isApplyable` result already stored on `ListenFix`.

---

## 6. Click-to-seek

```ts
export interface SeekTarget { start: number; end: number | null; label: string }
export function timeRangeOf(v: VerdictDto, durationSeconds: number): SeekTarget | null
```

- source order: `v.where` first, then `v.fix?.section`
- `start` must be a finite number, `>= 0`, and `< durationSeconds` when
  `durationSeconds > 0`; otherwise `null`
- `end` is kept only when finite, `> start`, and `<= durationSeconds`
- `label` is `lrTime(start)` or `lrTime(start)–lrTime(end)` using the
  transport's own formatter (`lrUtil.ts:9`), so the chip reads in the same
  clock as the scrubber

`FindingDetail` and `ActionDetail` gain `onSeekTo?: (seconds: number) => void`
and render the chip — `<Icon name="play" size={11}/> {label}` — only when both
the handler and a non-null `SeekTarget` exist, directly under the existing
`.fbd-meta` row. `FindingsStage` supplies `onSeekTo = seek` (the page's
existing `seek`, `ListenRackPage.tsx:468-474`) and computes the target from
the page's live `duration`.

---

## 7. Perf contract

1. `.rdx .lr-glass .lr-stagecard[data-stage="findings"]` sets
   `backdrop-filter: none; -webkit-backdrop-filter: none;` and an opaque-enough
   background built from tokens (`color-mix(in srgb, var(--surface-2) 88%, transparent)`).
2. No rule in `findings-stage.css` declares `backdrop-filter`.
3. The device-pixel cap of every visualizer canvas stays
   `Math.min(2, devicePixelRatio || 1)`.
4. The background visualizer only mounts when `bgViz === true`; with
   `content === 'findings'` and `bgViz === false`, no stage canvas exists at
   all and the rAF loop does not run (`VizStage`'s loop is gated on `playing`
   and the component is simply not rendered).

All four are checked in the live task (§9).

---

## 8. Files

**New**

| path | responsibility |
| --- | --- |
| `features/listen-rack/findings/FindingsStage.tsx` | the container: board mode, states, D8 gate, seek wiring |
| `features/listen-rack/findings/useListenFindings.ts` | verdicts → moves → listen fixes → the single fix overlay (D11, D12) |
| `features/listen-rack/findings/findings-helpers.ts` | `timeRangeOf`, `applyGate`, `boardListenFixes` (pure) |
| `features/listen-rack/findings/stage-prefs.ts` | `readStagePrefs` / `writeStagePrefs` / `useStagePrefs` (D6) |
| `features/listen-rack/findings/StagePlacementButton.tsx` | the ⛶/⤡ button, extracted verbatim from `viz.tsx` |
| `features/listen-rack/findings/findings-stage.css` | global `.rdx`-scoped stage/board overrides (D5, D7) |
| `features/listen-rack/useFixCarryOver.ts` | extracted carry-over + draft restore (D10) |
| `features/listen-rack/useRackPresetActions.ts` | extracted preset save/recall/export/import (D10) |

**Modified**

| path | change |
| --- | --- |
| `bff/src/Spectr.Bff/DTOs/VersionDtos.cs` | `+ Guid? LatestJobId = null` on `VersionDto` |
| `bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs` | `GetById` resolves and returns it |
| `frontend/src/api/types.ts` | `latestJobId?: string \| null` on `VersionDto` |
| `features/results/FixBoard.tsx` | `surface` prop; optional write handlers; `onSeekTo` passthrough |
| `features/results/FindingDetail.tsx` | `surface`, optional `onAskCoach`, `onSeekTo` |
| `features/results/ActionDetail.tsx` | `surface`, optional write handlers, `onSeekTo`, listen copy |
| `features/results/fix-board-helpers.ts` | `export type FixBoardSurface = 'report' \| 'listen'` |
| `features/listen-rack/viz.tsx` | controlled `bgMode`, `slot` prop, button extracted |
| `features/listen-rack/StageCardV2.tsx` | stage bar, `stageContent`, `findings` slot, placement button |
| `features/listen-rack/CoachTabV2.tsx` | `RealFixes` takes the shared overlay handle (D11) |
| `features/listen-rack/ListenRackPage.tsx` | extractions out; stage wiring + `songId` in |
| `routes/_app/listen-rack.$versionId.tsx` | passes `songId` |

**Never touched:** `features/results/AnalysisCompleteModal.tsx` and
`AnalysisCompleteModal.module.css` (another session's uncommitted work),
`routes/__tests__/no-social-surface.test.ts`,
`bff/tests/Spectr.Bff.Tests/NoSocialSurfaceTests.cs`.

---

## 9. Acceptance

**Automated (vitest + dotnet).**

1. `GET /api/versions/{id}` returns the version's **own** newest analysis's
   job id; a sibling version's analysis never leaks into it; no analysis → `null`.
2. `timeRangeOf` returns a target from `where`, falls back to `fix.section`,
   and returns `null` for missing / non-finite / negative / past-duration
   starts.
3. `readStagePrefs` returns the reduced-motion-aware default when storage is
   empty, when it holds garbage, and when `localStorage` throws.
4. `FixBoard surface="listen"` renders no Mark applied, no Rate, no ignore
   control, no Ask-the-coach, and shows "Apply live" instead of "Add to fix
   rack"; `surface` default still renders the report affordances.
5. `useListenFindings` → `status: 'no-analysis'` with a null job id;
   `'ready'` with verdicts; `'error'` + a working `retry` on failure; one
   `toggle` produces exactly one `applyRackMod` call.
6. `FindingsStage` with `carryPhase: 'applied'` disables apply and shows the
   Clear-preset button; with `'failed'` apply is live.
7. `StageCardV2` renders the board and no in-box `VizStage` under
   `stageContent="findings"`, and renders the ghost only under
   `visualizer` + `bgViz`.
8. The page mounts with findings in the box by default and persists a switch.

**Live (Playwright, `http://localhost:5174`, `showcase@spectr.test`, song
`515b2443-25ea-414e-b254-b69782546de3`, which has two analyzed versions).**

9. Open the **older** analyzed version's Listen page; its findings match that
   version's own report, not the newer one's.
10. At a 1440 × 900 viewport with the board open, the transport play button
    and the `.rtabs` strip are both inside the viewport.
    **If they are not, lower the D5 cap from `420px` to `360px`** and re-check;
    record which value shipped.
11. `getComputedStyle` reports `backdropFilter: 'none'` on the stage card,
    `.fb-list`, `.fb-scroll`, `.fb-detail`.
12. Every canvas under the portaled background stage satisfies
    `width <= innerWidth * 2 && height <= innerHeight * 2`.
13. Applying a fix audibly changes the rack (module count chip in the header
    moves) and unchecking restores it.
14. The visualizer view is pixel-unchanged from before the feature
    (screenshot comparison). **True again as of ruling L7 (D6):** picking
    "Visualizer" shows the visualizer IN THE BOX regardless of the persisted
    `bgViz`, and its ⛶ control backgrounds it for that session only. Between
    the first build and L7 this item was false — `bgViz` defaulting to `true`
    meant a first visit got the frosted ghost and no visualizer.

**Gates.** From `components/frontend-spectr-v2`: `npx tsc -b`,
`npm run lint`, `npm run build`, `npx vitest run` (baseline ≈ 930 tests, 0
failing). From `components/bff`: `dotnet build`, `dotnet test`
(baseline 365+, 0 failing).

---

## 10. Not in this spec

- **Slice 0 — worker/prompt work to populate time ranges.** Until it lands,
  D4 means the seek chip is rare. No frontend change is needed when it lands.
- **Slice 3 — Improvement Plan port, applied-state sync back to the report,
  deep-link focus into the Listen board, a shared `useFindingsBoard` between
  the two pages.**
- **Ask-the-coach from the Listen board.** Hidden by D9. A follow-up could
  deep-link to the report's coach with the question pre-seeded.
- **`statsSource.mismatch`.** The track header on Listen still takes bpm / key
  / duration from the *song's* latest analysis (`listen-rack.$versionId.tsx:64-87`)
  and the mismatch is still computed and still unread. This spec does not
  change it; the findings board has its own, correct source (D3).
- **Populating `LatestJobId` on `GET /api/songs/{id}`.** The data is already
  loaded there; wire it up when a consumer appears.
- **Mobile.** Listen remains desktop-only below 1024 px
  (`listen-rack-v2-extras.css`).

---

## 11. Where the seed was wrong or stale

Verified against the working tree; the code wins.

1. **`useVerdicts(jobId)`** — the real signature is
   `useVerdicts(jobId, { optimisticRunning: ReadonlySet<string>; enabled: boolean })`
   (`hooks.ts:615`). Callers must supply a stable empty set, as `ReportView`
   does with a ref (`ReportView.tsx:114-118`).
2. **"`const [bgMode] = useState(false)`"** — it is
   `const [bgMode, setBgMode] = useState(false)` (`viz.tsx:384`). The setter
   exists; what the seed was right about is that the state is local and
   unpersisted.
3. **"the Listen route already has `song.latestResult.jobId`"** — true, and it
   is exactly the value D3 forbids: it is the song's latest, not the playing
   version's. (The seed contradicts itself here between its "what exists" and
   "hard parts" sections.) `VersionDto.latestResult` having no job id is
   correct as written.
4. **"`.lr-stagecard { overflow:hidden }` must be scoped to the viz layer"** —
   it does not have to be, and should not be: it clips the card's corners and
   the board scrolls in its own regions. The real blocker the seed missed is
   `.rdx .lr-glass .card { backdrop-filter: blur(9px) }`
   (`listen-rack-v2.css:386`), which already applies to the stage card because
   its className is `card lr-stagecard`. See D7.
5. **"`.fb-detail { position:sticky }` is inert inside it"** — true but not
   the problem. The rules that actually break inside a 420 px box are
   `.fb-scroll { max-height: min(64vh,540px) }` and
   `.fb-detail { max-height: calc(100vh - 28px) }`. See D5's table.
6. **"`Move[] → ListenFix[]` is a ~5-line adapter"** — it is zero lines.
   `buildListenFixes(sources, isCommitted)` already exists and `Move`
   satisfies its `FixSource` shape structurally (`listenFixes.ts:28-39`).
7. **"Three sources of truth for 'applied'"** — under D2 + D8 there are two
   (server `userState.applied`, written only from the report; the live rack,
   driven only from Listen) and they never mix.
8. **Slice 1 "as a TAB first"** — dropped per D1.
9. **Slice 1's "mismatch banner"** — replaced by D3's hard rule: never show
   another version's findings, rather than label them.
10. **Missed entirely: the duplicate `useFixOverlay`.** `CoachTabV2`'s
    `RealFixes` already mounts one; adding a second on the stage is a
    correctness bug. See D11.
11. **Missed entirely: the board does not need `final_json`.** See D12.
12. **Effort estimates** ("~4.5–5.5 dev-days", "18–24 dev-days") are not
    carried forward; the plan is task-shaped, not day-shaped.
13. **Not re-verified in this session:** the seed's DB measurements
    (740 verdicts, `where.start_seconds` 0 %, `fix.section` 2.6 %). No
    database query was run. D4 is per-row and does not depend on them.
    Confirmed by grep, though: **no frontend code reads `fix.section` today**,
    and **no test exists for `FixBoard` / `FindingDetail` / `ActionDetail` /
    `FixBoardFilters`**.

---

## 12. Constraints inherited (CLAUDE.md + solo fork)

- TypeScript strict + `verbatimModuleSyntax` — `import type` for type-only imports.
- No new dependencies.
- CSS Modules + tokens for component styles; raw hex is banned in
  `*.module.css` (`scripts/check-css-tokens.mjs`). `findings-stage.css` is a
  plain global sheet (it must override `.rdx`-scoped global classes, which a
  module cannot do with deterministic specificity) and still uses tokens only.
- No `outline: none` without a `:focus`/`:focus-visible` replacement in the
  same file (`scripts/check-focus-ring.mjs`).
- No inline styles unless the value is dynamic. The one exemption is
  `StagePlacementButton` (§4.2), which must render outside `.rdx` in a portal.
- No file over ~500 lines. See D10 for `ListenRackPage.tsx`.
- Unit tests for new logic: expected use, edge case, failure case.
- Solo fork: nothing may imply other users. The banned-phrase guard
  (`routes/__tests__/no-social-surface.test.ts`) scans all of `src/`; note
  `/jobs? queued/i` — do not write "jobs queued" anywhere.
- Tests under `src/features/listen-rack/**` get jsdom automatically
  (`vitest.config.ts` `environmentMatchGlobs`); anything outside needs
  `// @vitest-environment jsdom` as its first line.
