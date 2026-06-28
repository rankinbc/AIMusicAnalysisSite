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
│ A v4 final  87/100  current  ✓   [▶] [Report ↗]   ⋯       │
│ B v3 bass   80/100            ✓   [▶] [Report ↗]   ⋯       │
│ C v2 rough  71/100            ⟳   [▶]              ⋯       │
│ D v1 demo     —              ⚠   [▶] [Retry]       ⋯       │
├ Compare ──────────────────────────────────────────────────┤
│ v_ → v_   [v1→current] [Last two] [Pick two…]             │
└───────────────────────────────────────────────────────────┘
```

---

## 3. Section specifications (display + interactions)

### 3.1 Identity header
- **Display:** `CoverArt` (visual template via `visualFromDto`), song name, genre
  `Pill`, current grade `GradePill` + score, version count, **visibility badge**
  (`◐ private` / `🔗 link` / `● public`, from `SongDto.visibility`; absent → private),
  tags (existing tag pills incl. `pub` marker).
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

### 3.3 Progress timeline — NOW REAL
- **Display:** reuse `src/ui/ProgressTimeline`, fed with **real per-version scores**
  (see §4). Hover → version label + grade + date.
- **Interactions:** click a point → select that version (loads into player slot A and
  highlights its row).

### 3.4 Versions list — the spine, de-cluttered
- **Display per row:** slot letter (A/B/C/D…), `GradePill` (or `v#` when unscored),
  label (or `Version N`), **real score/grade**, created date, `current` badge,
  **analysis status indicator**:
  - `✓` analyzed (has a completed `latestVersionResult`)
  - `⟳` analyzing (an in-flight job for that version) — optionally with progress
  - `⚠` failed (last job failed)
- **Interactions:**
  - **Inline (only two):** `▶` load into player (slot A), `Report ↗` (only when
    analyzed → `/songs/$songId/results/$jobId`).
  - **Failed rows:** inline `Retry`.
  - **`⋯` context menu (everything else):** Make current · Edit label · Reanalyze ·
    Reanalyze with reference · Open in Listen · **Open in Room** *(future — disabled
    stub)* · Delete (danger).
  - Sorting: descending by version number (current behavior).
- **Implementation notes:** the menu uses a Radix dropdown (Radix already in stack).
  Each action reuses existing hooks: `useSetCurrentVersion`, `usePatchVersion`,
  `useReanalyzeVersion`, `useDeleteVersion`, and `ReanalyzeWithReferenceDialog`.

### 3.5 Compare
- Keep the existing `CompareDialog` + quick presets (`v1 → current`, `Last two`,
  `Pick two…`). Behavior unchanged; restyled into the stack as a compact card.

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

**Change:**
1. `SongEndpoints.GetById` — batch-load each version's latest `Analysis` by
   `VersionId` (mirror the `ReportsEndpoints.List` join pattern).
2. `VersionDto` — add optional `latestVersionResult: AnalysisSummaryDto?`.
3. `ToVersionDto` mapping — populate it.
4. Frontend `api/types.ts` `VersionDto` — add the matching optional field.

Estimated ~30 lines in the BFF + 1 field on each side. This unlocks §3.3 and the real
scores in §3.4. The frontend should degrade gracefully if the field is absent
(fall back to today's latest-only behavior) so the two sides can ship independently.

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
| `CompareCard.tsx` | compare presets → `CompareDialog` |
| `ActivityStrip.tsx` | graceful read-only social strip |
| `song-helpers.ts` | pure logic: per-version score mapping, status derivation, A/B slot defaults, sort |

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
No new social schema. No changes to Listen/Room.

---

## 9. Testing

- **Unit (`song-helpers.ts`):** per-version score mapping, status derivation
  (analyzed/analyzing/failed/unscored), A/B default slot selection, version sort.
- **Component:** `VersionRow` renders correct status + inline actions; `VersionRowMenu`
  fires each action; analyzing/failed/Retry paths; `QuickPlayer` slot-switch makes the
  correct source audible.
- **Render:** per-version-score mapping with and without `latestVersionResult` (graceful
  fallback).
- **Gates:** `tsc --noEmit`, `npm run lint --max-warnings 0`, `npm run build`,
  `npx vitest run`. BFF: `dotnet build && dotnet test`.

---

## 10. Open dependencies / sequencing

1. BFF per-version DTO change (§4) — small; can land first or in parallel (frontend
   degrades gracefully without it).
2. Frontend feature-folder build (§5) consuming the new field.
3. Social seams (§7) remain stubs until the listening-room endpoints ship.
