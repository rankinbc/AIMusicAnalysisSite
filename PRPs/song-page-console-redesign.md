# Song Page Console Redesign — Design Spec

**Status:** design approved + **hi-fi design delivered** (2026-06-27); awaiting implementation plan
**Surface:** `frontend-spectr-v2` route `/_app/songs/$songId` (the page reached by
clicking a song in the Library)
**Design reference (source of truth for markup/styling/logic):**
`PRPs/design_handoffs/song-page-console/{README.md, SongPageConsole.dc.html}` — reconciled
into §3.3 / §3.5 / §5 below (inline `ComparePanel`, custom grade-free `ScoreTrendCard`).
The game-plan view (§3.7) is the one piece NOT in the delivered design — add it during build.
**Companion build plans (written 2026-06-28):**
`song-page-console-build-1-bff.md` (BFF: per-version metrics + rating + compare-notes) →
`song-page-console-build-2-frontend.md` (frontend: port the design into `features/song/`).
Build BFF first; the frontend degrades gracefully without it.

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
    `features/listen/useAudioGraph.ts`. **Native `<audio>` per deck** drives playback; the
    waveform is the delivered design's decorative bar visual + a `currentTime`-driven playhead
    (NOT WaveSurfer — it isn't used in the app today; real peaks via `Analysis.waveform_peaks_path`
    is a future enhancement).
  - Audio source = existing Range-enabled `/api/versions/{id}/audio?t=<jwt>` stream
    (same access pattern the Listen page uses; token via query param because media
    elements can't set headers).
  - Token-rotation caveat (see CLAUDE.md): the `?t=` URL embeds the access token, so a
    silent refresh can swap `src` and reset position — track position off the audio
    element's `timeupdate`, not React state assumptions.
  - AudioContext / playback must start from a user gesture (autoplay policy).

### 3.3 Score trend — custom grade-free chart (`ScoreTrendCard`)
**Reconciled to the delivered design** (`design_handoffs/song-page-console/`):
- **Display:** a **custom SVG line + area chart** of the **AI mix score** across scored
  versions (oldest→newest), with dashed score gridlines (e.g. 50/60/70/80/90), per-point
  score labels, `v# · date` under each point, and the current point emphasized. A header
  trend readout ("+25 pts · v2→v5"). **Do NOT use `ui/ProgressTimeline`** — it's
  grade-based; this is a single-series, grade-free chart.
- **Personal score is NOT overlaid here** (the earlier dual-series idea was dropped in the
  design). The personal score lives on version rows (§3.4) and in the compare panel (§3.5).
- **Interactions:** click a point → loads that version into **deck A** and highlights its
  row. Sparse (<2 scored versions) → calm placeholder line + "Scores appear here as you
  analyze versions".

### 3.4 Versions list — the spine, de-cluttered
- **Display per row** (per delivered design): a **slot badge** (cyan `A`/`B` when that
  version is loaded into a deck, else a muted positional letter `C/D/E…`), `v#` chip,
  label (or `Version N`), `current` chip, a **personal-score pill** (`★ 90`, violet) when
  the user has rated it, the created date, the **AI mix score** (`mono`, cyan, e.g.
  `87/100`, or `—` when unscored), a small **gameplan indicator** when one is attached
  (see §3.7 — **added on top of the delivered design**), and an **analysis status
  indicator**:
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

### 3.5 Compare — INLINE under the decks (`ComparePanel`), no modal
**Reconciled to the delivered design:** the compare is **not a modal and not a separate
card** — it lives **inside the Quick-player card, directly under the two decks**, and
always reflects whatever versions are loaded in deck A and deck B. "Compare any two
versions" = load them into the decks (the deck dropdowns are the pickers). The old "Spot
what changed" card + `CompareDialog` are **removed**.
- **6 metric tiles** comparing deck A's version to deck B's: **Mix score, Loudness (LUFS),
  Dynamics (LU), Bass energy, Air/highs, Stereo width.** Each tile shows `A vs B` and the
  **Δ (= A − B)**, colored green/red by whether A is "better" — higher-is-better for most;
  LUFS is closeness-to-target (≈ −9). Needs the per-version metrics from §4 Change A.
- **Personal verdict (new):**
  - **Two `0–100` personal-score inputs** (one for deck A's version, one for deck B's),
    their delta, and a live verdict ("▲ you rate A higher"). Violet styling. Persists
    per-version (§4 Change B). `mono`.
  - **Delta notes** — a textarea attached to the *(versionA, versionB)* pair, keyed by the
    **sorted** id pair so A↔B don't duplicate. Persists (§4 Change C); reappears when that
    pair is loaded again.
  - A "saved to this song" caption signals persistence.

### 3.7 Game plan (per-version, read-from-Results) — ADDED ON TOP OF THE DELIVERED DESIGN
> **The delivered design does NOT include this** (no row marker, no menu item, no modal).
> Layer it on during the build (decision 2026-06-27: "add it during build"). Match the
> delivered design's row + menu styling so it reads as native.
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
- **Implementation note (resolved 2026-06-28):** there is **no server-side per-version
  game plan** — the proper `game_plans` table is PRP-5 (`listen-v3-game-plan-comparison.md`,
  NOT started). What DOES exist: the Listen Plan tab persists per-version committed moves to
  **`localStorage`** under `listenFixes:{versionId}` (+ `listenApplied:{versionId}`), via
  `features/listen-rack/listenFixes.ts`. So the song page's marker + view is a **frontend,
  local-interim** feature: read `listenFixes:{versionId}`; show the marker when it's
  non-empty; the modal lists those moves with an "Apply in Listen" route. **Caveat:** this
  reflects only plans saved in THIS browser (localStorage, not the server). Swap the source
  to the `game_plans` GET endpoint when PRP-5 ships. **No BFF work** — lives entirely in
  Plan 2 (frontend).

### 3.6 Activity / visibility strip — minimal social, graceful
- **Display:** for the current version, render only what the BFF provides:
  - visibility (mirrors header badge),
  - **saved/bookmark count** if available (bookmarks are shipped — `useBookmarks`),
  - comment / reaction counts ONLY once those endpoints exist (do not render
    placeholder zeros for unshipped data).
- **Interactions:** `Open in Room ↗` and `Share / invite ↗` route to the version
  surfaces — **disabled stubs** until those features ship.

---

## 4. Data dependencies (BFF)

Backend report verified 2026-06-27. Three new build surfaces below; everything else on
this page maps to endpoints/hooks the rest of the spec already accounts for (per-version
audio stream §3.2; make-current / reanalyze / reanalyze-with-reference / edit-label /
delete via existing hooks §5; saved/bookmark count via existing bookmarks §3.6; Room/Share
disabled stubs §7 — do NOT rebuild these).

### Change A — per-version result **+ measured metrics** (small, NO migration)
Per-version analysis data **already exists**: `Analysis.VersionId` is an FK on the
`analyses` table, and `ReportsEndpoints.List` already queries per-version. The song-detail
endpoint just doesn't use it (it groups by `SongId` and takes the newest single row).

1. `SongEndpoints.GetById` — batch-load each version's latest `Analysis` by `VersionId`
   (mirror the `ReportsEndpoints.List` join pattern).
2. `VersionDto` — add optional `latestVersionResult` carrying **all six measured values the
   A/B "What changed" panel compares**, not just the score:
   **mix score (0–100), loudness (LUFS), dynamic range (LU), bass energy, air/highs,
   stereo width.** These already live in each analysis record — they just ride along on the
   same per-version join. If the existing `AnalysisSummaryDto` doesn't already carry all
   six, widen it (or add a `VersionResultDto`) — **without the metrics the deltas can't
   render.**
3. `ToVersionDto` mapping — populate it.
4. Frontend `api/types.ts` `VersionDto` — add the matching optional field with the six metrics.

Frontend degrades gracefully if absent (row scores fall back to latest-only; compare deltas
hidden) so the two sides ship independently.

### Change B — personal score: NEW user-owned data (per **user × version**)
Producers type their own 0–100 rating on a version — subjective, separate from the computed
score, and **per-user** (NOT a column on `song_versions` — songs become shareable, so two
users must be able to rate the same version independently).

- **Store:** `version_user_ratings(user_id, version_id, score 0–100, updated_at)`, **unique
  on (user_id, version_id)**.
- **Endpoints:** read — fold the caller's ratings into the song payload (or
  `GET /api/songs/{id}/my-ratings`); upsert `PUT /api/versions/{id}/rating {score}`; clear
  `DELETE /api/versions/{id}/rating`.
- **Surface:** the current user's rating rides on each `VersionDto` as
  `personalScore: number | null` (their own, not anyone else's).
- **Hooks:** `useSetPersonalScore(versionId)` (PUT) + `useClearPersonalScore(versionId)` (DELETE).

### Change C — compare notes: NEW user-owned data (per **user × version-pair**)
Free-text notes about the delta between two specific versions — **per-user**.

- **Store:** `version_compare_notes(user_id, song_id, version_a_id, version_b_id, body,
  updated_at)` — **normalize the pair (store sorted)** so A↔B order doesn't create
  duplicates; **unique on (user_id, normalized pair)**.
- **Endpoints:** read (per song or per pair); upsert `PUT`; `DELETE`.
- **Hooks:** `useCompareNotes(songId, a, b)` + `useSaveCompareNotes` + `useDeleteCompareNotes`.

Both B and C are **per-user and persist to the song** — the UI copy reads "saved to this song".

### Change D — data contract: grades retired for this surface (no endpoint)
Letter grades were dropped — **score (0–100) is the only quality signal on this page**. `grade`
is unused here and does **not** need to be computed or sent for this surface. (No code to
remove server-side necessarily; just: don't add grade to the new per-version payload.)

### Change E — game-plan read path (§3.7) — NO BFF WORK (resolved 2026-06-28)
- Investigation verdict: the per-version game plan is **not persisted server-side** (the
  `game_plans` table is PRP-5, not started). The Listen Plan tab already saves per-version
  moves to **`localStorage`** (`listenFixes:{versionId}`). The song-page marker + read view
  therefore read that localStorage directly — a **frontend, local-interim** feature in Plan 2.
- Future: when PRP-5 ships the `game_plans` table + `GET /api/versions/{id}/plan`, swap the
  frontend source from localStorage to the endpoint. No change needed in THIS BFF plan.

---

## 5. Code structure (decompose the monolith)

Create `src/features/song/` and reduce the route file to a thin composition shell.
**Component names match the delivered design** (`design_handoffs/song-page-console/README.md`):

| File | Responsibility |
|---|---|
| `SongHeader.tsx` | cover, title, meta pills, tags, actions (Edit / ★ Publish / + Add version), Archive in `⋯` |
| `QuickPlayer.tsx` + `useQuickPlayer.ts` | two A/B decks: version dropdown, WaveSurfer waveform + playhead, transport, one-click audible switch, "Open in Listen ↗" |
| `ComparePanel.tsx` | **inside `QuickPlayer`, under the decks** — live A-vs-B 6-metric tiles + personal-score inputs (A/B) + delta/verdict + notes textarea. Replaces the old modal `CompareDialog`. |
| `ScoreTrendCard.tsx` | custom **grade-free** SVG score-over-versions chart (NOT `ui/ProgressTimeline`); click-point → load into deck A |
| `VersionList.tsx` | list container + sorting (newest first) |
| `VersionRow.tsx` | one row: slot badge, label (+ inline edit), personal-score pill, score, status, inline Play/Report/Retry |
| `VersionRowMenu.tsx` | the `⋯` Radix menu + its actions (incl. the **added** "View game plan") |
| `GamePlanViewModal.tsx` | read-only view of a version's saved game plan (opened from row `⋯`) — **not in the delivered design; added per §3.7** |
| `ActivityStrip.tsx` | graceful read-only social strip (or folded into `SongHeader` per the design's `◷ N saved` pill) |
| `song-helpers.ts` | pure logic: per-version score/status mapping, A/B slot defaults, sort, **A-vs-B metric delta calc** (dir: high/target/neutral; LUFS target ≈ −9), **personal-score delta/verdict**, **note-pair key normalization** (sorted ids) |

The inline `MakeCurrentButton` / `ReanalyzeButton` / `EditVersionLabelButton` /
`DeleteVersionDialog` move out of the route into the feature folder. Follow the existing
`features/results/` decomposition as the pattern. **The `.dc.html` view-model is the
source of truth** for the metric-delta math, wave rendering, and interaction logic — port
it, adapting state to TanStack Query + the existing hooks. No file over ~300 lines.

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
them (§3.7). The only new persistence is the per-user personal score (§4 Change B) and
per-user compare notes (§4 Change C).

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

1. BFF per-version result + **6 measured metrics** on the DTO (§4 Change A) — small, no
   migration; can land first or in parallel (frontend degrades gracefully without it).
2. BFF personal score (§4 Change B) — migration for `version_user_ratings` (per user ×
   version, unique) + PUT/DELETE `/versions/{id}/rating` + fold ratings into the song payload.
3. BFF compare notes (§4 Change C) — migration for `version_compare_notes` (per user ×
   sorted pair, unique) + read/PUT/DELETE.
4. Data-contract note (§4 Change D) — no endpoint; just don't send `grade` on this surface.
5. Game-plan read path (§4 Change E) — confirm existing Results/Listen game-plan shape; add
   a per-version `hasGamePlan` signal if not already cheap. (Not in the backend report — verify.)
6. Frontend feature-folder build (§5) consuming the new fields/hooks.
7. Social seams (§7) remain stubs until the listening-room endpoints ship.
