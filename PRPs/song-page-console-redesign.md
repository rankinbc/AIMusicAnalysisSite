# Song Page Console Redesign — Design Spec

**Status:** design approved (2026-06-27); awaiting implementation plan
**Surface:** `frontend-spectr-v2` route `/_app/songs/$songId` (the page reached by
clicking a song in the Library)
**Companion build plan:** `song-page-console-redesign-build.md` (to be written via
writing-plans)

---

## 1. Problem & role

Today's song page (`routes/_app/songs.$songId.tsx`, a 535-line monolith) is a
functional but cluttered version manager:

- Every version row crams **7 actions** (Listen, Make current, Report, Edit label,
  Reanalyze, Reference, Delete) — action overload.
- The "Progress timeline" and per-version scores are a **sketch**: only the *latest*
  version shows a score because the BFF song payload exposes a single `latestResult`.
- There is **no way to audition / A-B versions** without routing to the now-heavy
  Listen page (full DSP rack + rooms).
- Inline subcomponents (`MakeCurrentButton`, `ReanalyzeButton`, `EditVersionLabelButton`,
  `DeleteVersionDialog`) live in the route file — no feature folder.

**Decided role (locked):** the song page is a **focused version-management console**.
It is where a producer **auditions, compares, manages, and routes** versions. It is
NOT a social surface — reacting/commenting/heatmaps/live rooms live on the
Listen/View/Room version surfaces. Social appears here only as **read-only counts +
links out**, and only where the BFF actually provides data (no fabricated zeros).

This scope decision was made deliberately over two richer alternatives (embed live
social on the song page / make it a primary listening surface) to avoid two sources
of truth for version-level social.

**Scoring model (locked):** SPECTR does **not** use letter grades anywhere in this
design — the only AI number is the **mix score (0–100)**. In addition, the producer
can assign their **own personal score (0–100) per version** and write **free-text notes
on the delta** between any two versions. The personal score captures artistic judgment
the AI number can't, and overlays the AI score on the progress timeline so the producer
sees their own improvement arc. Drop `GradePill` / `grade` from this screen entirely.

---

## 2. Information architecture — single-column stacked

One scannable vertical column (collapses gracefully on narrow viewports):

```
← Library
┌ Identity header ─────────────────────────────────────────┐
│ cover · name · genre · grade/score · visibility · tags    │
│ [Edit] [★ Publish] [+ Add version]            (Archive ⋯) │
├ Quick-player (A/B) ───────────────────────────────────────┤
│ [slot A: version ▾  ▶ ──●── waveform]  Open in Listen ↗   │
│ [slot B: version ▾  ▶ ──●── waveform]  Open in Listen ↗   │
├ Progress timeline ────────────────────────────────────────┤
│ real score-over-versions  62 → 71 → 80 → 87               │
├ Versions list ────────────────────────────────────────────┤
│ A v4 final  87/100  you 90  current ✓  [▶] [Report ↗]  ⋯  │
│ B v3 bass   80/100  you 78          ✓  [▶] [Report ↗]  ⋯  │
│ C v2 rough  71/100  you —           ⟳  [▶]             ⋯  │
│ D v1 demo     —     you 60          ⚠  [▶] [Retry]     ⋯  │
├ Compare (any two versions) ───────────────────────────────┤
│ pick A ▾  vs  pick B ▾   [v1→current] [Last two]          │
│ deltas: score +7 · LUFS −0.4 · width +6%   …             │
│ your notes: "fuller low end, vox still harsh"  · you: 90  │
└───────────────────────────────────────────────────────────┘
```

---

## 3. Section specifications (display + interactions)

### 3.1 Identity header
- **Display:** `CoverArt` (visual template via `visualFromDto`), song name, genre
  `Pill`, current **mix score (0–100)** as a `Pill` (NO letter grade), version count,
  **visibility badge** (`◐ private` / `🔗 link` / `● public`, from `SongDto.visibility`;
  absent → private), tags (existing tag pills incl. `pub` marker).
- **Interactions:**
  - `Edit` → existing `SongEditDialog`.
  - `★ Publish` → existing `SharePublishDialog`; disabled with a toast when no
    `latestResult` exists ("Analyze a version first…").
  - `+ Add version` → existing `UnifiedUploadDialog` (passes `defaultGenre`).
  - `Archive` → moved INTO a header `⋯` menu (de-clutter); existing
    `ConfirmDialog` + `useArchiveSong`, navigates to `/library` on success.
  - `← Library` back link.

### 3.2 Quick-player (A/B) — NEW
- **Display:** two slots **A** and **B**. Each: a version selector (defaults A =
  current version, B = previous version when present), a **WaveSurfer** waveform, and
  a play/pause + scrub transport. The audible slot is visually highlighted.
- **Interactions:**
  - Choose a version per slot.
  - Play/pause, scrub.
  - **One click makes the other slot audible** for instant A/B-by-ear. Only one slot
    plays at a time; switching keeps relative position where sensible.
  - `Open in Listen ↗` per slot → `/listen-rack/$versionId` for the full DSP rack.
- **Implementation notes:**
  - Raw audio only — **no DSP graph, no rooms**. Do NOT reuse the heavy
    `features/listen/useAudioGraph.ts`; use a lightweight WaveSurfer instance per slot.
  - Audio source = existing Range-enabled `/api/versions/{id}/audio?t=<jwt>` stream
    (same access pattern the Listen page uses; token via query param because media
    elements can't set headers).
  - Token-rotation caveat (see CLAUDE.md): the `?t=` URL embeds the access token, so a
    silent refresh can swap `src` and reset position — track position off the audio
    element's `timeupdate`, not React state assumptions.
  - AudioContext / playback must start from a user gesture (autoplay policy).

### 3.3 Progress timeline — NOW REAL, DUAL-SERIES
- **Display:** reuse `src/ui/ProgressTimeline`, fed with **real per-version mix scores**
  (see §4), and **overlay the producer's personal score** as a second series so the AI
  arc and the personal arc sit on one 0–100 axis. Hover → version label + mix score +
  personal score + date. No letter grades.
- **Interactions:** click a point → select that version (loads into player slot A and
  highlights its row).
- **Implementation note:** `ui/ProgressTimeline`'s `TimelineVersion` currently carries a
  `grade` field used for coloring; for this screen ignore grade and add an optional
  `personalScore` to drive the second series (small prop extension, back-compatible).

### 3.4 Versions list — the spine, de-cluttered
- **Display per row:** slot letter (A/B/C/D…), `v#` chip, label (or `Version N`), the
  **AI mix score** (`mono`, cyan, e.g. `87/100`, or `—` when unscored), the **personal
  score** (`mono`, muted, e.g. `you 90`, or `you —` when unset), created date, `current`
  badge, a small **gameplan indicator** when one is attached (see §3.7), and an
  **analysis status indicator**:
  - `✓` analyzed (has a completed `latestVersionResult`)
  - `⟳` analyzing (an in-flight job for that version) — optionally with progress
  - `⚠` failed (last job failed)
  - No letter grades anywhere.
- **Interactions:**
  - **Inline (only two):** `▶` load into player (slot A), `Report ↗` (only when
    analyzed → `/songs/$songId/results/$jobId`).
  - **Failed rows:** inline `Retry`.
  - **`⋯` context menu (everything else):** Make current · Edit label · **View game plan**
    *(only when one is attached — see §3.7)* · Reanalyze · Reanalyze with reference ·
    Open in Listen · **Open in Room** *(future — disabled stub)* · Delete (danger).
  - Sorting: descending by version number (current behavior).
- **Implementation notes:** the menu uses a Radix dropdown (Radix already in stack).
  Each action reuses existing hooks: `useSetCurrentVersion`, `usePatchVersion`,
  `useReanalyzeVersion`, `useDeleteVersion`, and `ReanalyzeWithReferenceDialog`.

### 3.5 Compare — any two versions, with a personal verdict
- **Pick any two versions** (A vs B), via two selectors plus quick presets
  (`v1 → current`, `Last two`). Reuse/extend the existing `CompareDialog` for the metric
  deltas (mix score, loudness, dynamics, bass energy, air, stereo width).
- **Personal verdict (new):**
  - **Delta notes** — a free-text field attached to the *(versionA, versionB)* pair, where
    the producer records what changed in their own words ("fuller low end, vox still
    harsh"). Persisted; reappears when that pair is compared again.
  - **Personal score (0–100)** — set/adjust the producer's own score for the version
    being judged (default target = the newer of the two). This is the SAME per-version
    personal score shown on rows and the timeline — the compare view is just the most
    convenient place to set it. Editable inline (number input / slider), `mono`.
  - Both are optional; absent → muted "add your notes" / "rate this version" affordances.
  - Show the AI delta and the personal score side by side so "the AI says +7, I say it's
    a 90" reads at a glance.

### 3.7 Game plan (per-version, read-from-Results)
- **Context:** a **game plan** is an actionable change-set a producer can save from the
  **Results page** for a specific version (the "Actions" surface). It is optional and
  version-scoped. The song page does not create or edit game plans — it **surfaces and
  opens** any that exist.
- **Display:** a version with a saved game plan shows a small indicator on its row (e.g.
  a `Pill`/`Dot` "plan" marker). 
- **Interactions:** `View game plan` (row `⋯` menu, shown only when one exists) opens a
  read view of that version's saved plan (its items / moves). From there, the producer
  can route into the Listen "Plan" tab to apply it, or back to the Report. If no game
  plan exists for a version, the affordance is absent (not disabled).
- **Implementation note:** game-plan persistence already exists on the Results/Listen
  side (the Plan-tab apply work). The song page only needs a **read** path: "does this
  version have a saved game plan, and fetch it." Confirm the existing endpoint/shape
  during planning; if a per-version "has plan" flag isn't cheaply available, add it to
  the per-version payload alongside §4.

### 3.6 Activity / visibility strip — minimal social, graceful
- **Display:** for the current version, render only what the BFF provides:
  - visibility (mirrors header badge),
  - **saved/bookmark count** if available (bookmarks are shipped — `useBookmarks`),
  - comment / reaction counts ONLY once those endpoints exist (do not render
    placeholder zeros for unshipped data).
- **Interactions:** `Open in Room ↗` and `Share / invite ↗` route to the version
  surfaces — **disabled stubs** until those features ship.

---

## 4. Data dependency (BFF — small, NO migration)

Per-version analysis data **already exists**: `Analysis.VersionId` is an FK on the
`analyses` table, and `ReportsEndpoints.List` already queries per-version. The
song-detail endpoint simply doesn't use it (it groups by `SongId` and takes the
newest single row).

**Change A — per-version AI score (small, NO migration):**
1. `SongEndpoints.GetById` — batch-load each version's latest `Analysis` by
   `VersionId` (mirror the `ReportsEndpoints.List` join pattern).
2. `VersionDto` — add optional `latestVersionResult: AnalysisSummaryDto?`.
3. `ToVersionDto` mapping — populate it.
4. Frontend `api/types.ts` `VersionDto` — add the matching optional field.

Estimated ~30 lines in the BFF + 1 field on each side. Unlocks §3.3 + real row scores.
The frontend degrades gracefully if absent (falls back to latest-only) so the two sides
ship independently.

**Change B — personal score + delta notes (NEW; needs a small migration):**
- **Personal score:** add a nullable `personal_score` (int 0–100) — simplest home is a
  column on `song_versions` (songs are single-owner, so no per-user fan-out needed).
  Surface it on `VersionDto` as `personalScore: number | null`. Add a write endpoint,
  e.g. `PUT /api/versions/{id}/personal-score`.
- **Delta notes:** a small new table keyed by *(user/song, versionAId, versionBId)* →
  `notes` text + timestamps (normalize the pair order so A↔B is symmetric). Endpoints:
  `GET /api/songs/{id}/compare-notes?a=&b=` and `PUT` the same. Keep it its own table
  (not on a version) because notes describe a *pair*, not a single version.
- New frontend hooks: `useSetPersonalScore(versionId)`, `useCompareNotes(songId, a, b)` +
  `useSaveCompareNotes`.

**Change C — game-plan read path (§3.7):**
- Need a per-version "has a saved game plan" signal + a fetch for its content. Reuse the
  existing Results/Listen game-plan persistence. If a cheap `hasGamePlan: boolean` (or
  `gamePlanId`) isn't already exposed per version, add it to `VersionDto`. The song page
  is **read-only** here — no create/edit.

---

## 5. Code structure (decompose the monolith)

Create `src/features/song/` and reduce the route file to a thin composition shell:

| File | Responsibility |
|---|---|
| `SongHeader.tsx` | identity + header actions (incl. Archive in `⋯`) |
| `QuickPlayer.tsx` + `useQuickPlayer.ts` | A/B slots, WaveSurfer, transport |
| `ProgressTimelineCard.tsx` | wraps `ui/ProgressTimeline` with real scores |
| `VersionList.tsx` | list container + sorting |
| `VersionRow.tsx` | one row: status, inline Play/Report |
| `VersionRowMenu.tsx` | the `⋯` context menu + its actions |
| `CompareCard.tsx` | pick-any-two + presets → `CompareDialog`; hosts delta notes + personal-score editor |
| `PersonalScoreField.tsx` | inline 0–100 personal-score input (reused by CompareCard + optionally rows) |
| `GamePlanViewModal.tsx` | read-only view of a version's saved game plan (opened from row `⋯`) |
| `ActivityStrip.tsx` | graceful read-only social strip |
| `song-helpers.ts` | pure logic: per-version score mapping, status derivation, A/B slot defaults, sort, compare-pair key normalization |

The inline `MakeCurrentButton` / `ReanalyzeButton` / `EditVersionLabelButton` /
`DeleteVersionDialog` move out of the route into the feature folder. Follow the
existing `features/results/` decomposition as the pattern. No file over ~300 lines.

---

## 6. States

- **Loading:** skeleton for header + list.
- **Empty:** no versions → upload prompt (existing copy).
- **Error:** song not found → back-to-Library + message (existing).
- **Per-version:** analyzing (⟳, polls job), failed (⚠ + Retry), unscored (`—`).

---

## 7. Social-future seams

Disabled-but-present affordances — `Open in Room`, `Share / invite`, comment/reaction
counts — wired behind capability checks so the planned listening-room endpoints light
them up **without a re-layout**. No fabricated data in the meantime.

---

## 8. Out of scope (YAGNI)

No inline reactions/comments/heatmaps, no live presence/chat, no DSP on this page, no
rooms UI, no per-version share-setting editor (those belong to the version surfaces).
No new social schema. No changes to Listen/Room. **No game-plan creation or editing** on
this page — game plans are authored on the Results page; the song page only reads/opens
them (§3.7). The only new persistence is the personal score + delta-notes (§4 Change B).

---

## 9. Testing

- **Unit (`song-helpers.ts`):** per-version score mapping, status derivation
  (analyzed/analyzing/failed/unscored), A/B default slot selection, version sort,
  compare-pair key normalization (A↔B symmetric).
- **Component:** `VersionRow` renders mix + personal score + gameplan indicator + status,
  and the two inline actions; `VersionRowMenu` fires each action incl. conditional
  "View game plan"; analyzing/failed/Retry paths; `QuickPlayer` slot-switch makes the
  correct source audible; `CompareCard` saves delta notes + personal score and shows AI
  delta vs personal score side by side; `GamePlanViewModal` renders a fetched plan.
- **Render:** per-version-score mapping with and without `latestVersionResult` and with
  and without `personalScore` (graceful fallback / muted "rate this" affordance).
- **Gates:** `tsc --noEmit`, `npm run lint --max-warnings 0`, `npm run build`,
  `npx vitest run`. BFF: `dotnet build && dotnet test`.

---

## 10. Open dependencies / sequencing

1. BFF per-version AI-score DTO change (§4 Change A) — small, no migration; can land
   first or in parallel (frontend degrades gracefully without it).
2. BFF personal-score + delta-notes (§4 Change B) — needs a small migration
   (`song_versions.personal_score` + a `version_compare_notes` table) and 2–3 endpoints.
3. Game-plan read path (§4 Change C) — confirm the existing Results/Listen game-plan
   endpoint/shape; add a per-version `hasGamePlan` signal if not already cheap.
4. Frontend feature-folder build (§5) consuming the new fields.
5. Social seams (§7) remain stubs until the listening-room endpoints ship.
