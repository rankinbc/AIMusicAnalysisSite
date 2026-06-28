# Handoff: Song Page Console

## Overview
The redesigned **song page** (`/_app/songs/$songId`) — a producer's focused **version‑management console** for one song: audition & A/B two versions by ear, see the mix‑score trend, manage versions, record a personal opinion, and route out to the heavy Listen/Report surfaces.

This implements `PRPs/song-page-console-redesign.md` (§1–§9) **plus** three UI additions made during design that need backend support (see **Backend / Data needs** below).

## About the design files
The file in this bundle — `SongPageConsole.dc.html` — is a **design reference**, not production code to copy. It's a SPECTR "Design Component": static markup + a small logic class, built **on top of the real shipped design system** (`window.SpectrUI.*`, the global utility classes, and the `tokens/` CSS variables from `spectr-frontend-v2/src/ui`).

The task is to **recreate it as real React** in the existing `frontend-spectr-v2` app, using its established patterns (TanStack Router, Radix, existing hooks, the `.card`/`.pill`/`.btn`/`.mono` utility classes, and the `var(--*)` tokens). Most styling maps 1:1 because the prototype already uses your design system. Read the `.dc.html` for exact markup, inline styles, and the view‑model logic — it is the source of truth for spacing/colors.

## Fidelity
**High‑fidelity.** Final colors, type, spacing, and interactions, all expressed in your real tokens/components. Recreate pixel‑for‑pixel using the codebase's components — don't re‑derive a new visual language.

## Code structure (matches redesign spec §5)
Decompose the 535‑line route into `src/features/song/`:

| File | Responsibility | Notes vs. spec |
|---|---|---|
| `SongHeader.tsx` | Cover, title, meta pills, tags, actions (Edit / ★ Publish / + Add version), Archive in `⋯` | unchanged from spec |
| `QuickPlayer.tsx` + `useQuickPlayer.ts` | Two decks A/B: version selector, WaveSurfer waveform + playhead, transport, one‑click audible switch, "Open in Listen ↗" | unchanged from spec |
| **`ComparePanel.tsx`** | **NEW** — lives **inside** QuickPlayer, directly under the two decks. Live A‑vs‑B metric deltas + personal score inputs + notes. Replaces the old modal CompareDialog. | **changed** — see note |
| `ScoreTrendCard.tsx` | Score‑over‑versions line chart (was `ProgressTimelineCard`) | **changed** — now a custom **grade‑free** chart, not `ui/ProgressTimeline` |
| `VersionList.tsx` / `VersionRow.tsx` / `VersionRowMenu.tsx` | The version spine: status, 2 inline actions, `⋯` menu | unchanged from spec |
| `song-helpers.ts` | per‑version score/status mapping, A/B slot defaults, sort, **A‑vs‑B metric delta calc**, **personal‑score delta/verdict** | extended |

> **Two deviations from the spec, both deliberate (approved in conversation):**
> 1. **No letter grades anywhere.** `GradePill` and `ui/ProgressTimeline` (both grade‑based) are **not used**. Quality is shown only as the numeric mix score (0–100). The trend chart is a custom SVG line with score gridlines (50/60/70/80/90), no A/B/C bands.
> 2. **Compare is inline, not a modal.** The old "Spot what changed" card + `CompareDialog` are gone. The two decks **are** the version pickers, so the compare panel always reflects whatever is loaded in A and B. "Compare any two versions" = load them into the decks.

## Screens / sections (top → bottom, single centered column, max‑width 960px)

### App chrome (thin sticky bar)
`BrandMark` (`SpectrUI.BrandMark`, size 26, glow) + "SPECTR" mono lockup, letter‑spacing .2em. Right: a violet `PRO` pill + avatar dot. `background: rgba(7,10,18,.72)` + `backdrop-filter: blur(8px)`, `border-bottom: 1px solid var(--border)`.

### 1. Identity header (`.card`, padding 22px)
- **Cover:** `SpectrUI.CoverArt` `size="fluid"` inside a fixed **152×152** box; prop `visual={{ template, primary, secondary }}` where primary/secondary are **oklch** objects (e.g. `{l:.74,c:.15,h:172}` emerald, `{l:.5,c:.16,h:280}` indigo). Template is one of aurora/eq/vinyl/skyline/cassette/boombox.
- **Title:** song name as `<h1>`, 30px / 800 / letter‑spacing −.02em.
- **Meta pill row** (`.pill`, wraps): genre (`.cyan`), version count (muted), `<span class="mono">87</span>/100`, visibility chip (`◐ private`, colored via `--vis`/`--vis-bd`/`--vis-dim` from `data-vis="private"` on the root), optional `◷ N saved` (only if a bookmark count exists — never a fabricated 0).
- **Tags:** small `.pill`s; public tags carry a tiny `pub` marker.
- **Actions (top‑right, wrap):** `Edit` (`.btn.ghost.sm`), `★ Publish` (`.btn.violet.sm`; toast "Analyze a version first…" when no analyzed version), `+ Add version` (`.btn.primary.sm`), `⋯` → Archive.

### 2. Quick‑player A/B  ← the hero interaction (`.card`, `overflow:visible`)
Header: `.label` "Quick audition · A / B" + hint "tap a deck to switch what you hear".

Two **decks** stacked (A defaults to current version, B to previous). Each deck row (flex, wraps):
- Left column (48px): the **deck letter** (cyan when live, muted when not) and a round **transport** button (38px; live = solid cyan w/ glow, idle = subtle).
- Version **dropdown** (`v5 final master ▾`) → menu lists every version to load into that deck.
- A **live indicator** on the audible deck: a glowing `.dot` (pulses while playing) + "LIVE"/"CUED".
- **Waveform** (full‑width, 46px): ~52 vertical bars; played portion brighter; a 2px **playhead** sweeps. Live deck = cyan bars + glow + equalizer bounce while playing; idle deck = grey bars, dimmed. Click‑to‑seek.
- Time readout `m:ss / m:ss` (mono).
- `Open in Listen ↗` (`.btn.ghost.sm`, violet arrow) → `/listen-rack/$versionId`.

**Key behavior:** only one deck is audible. Clicking the **other** deck's transport instantly switches what's audible (and the visual dominance); clicking the **live** deck toggles play/pause. This switch should feel instant/physical.

### 2b. Compare panel (NEW, inside the player card, under the decks)
Divider, then `.label` "What changed · A·v5 vs B·v4" + a verdict chip. A responsive grid (`auto-fit minmax(280px,1fr)`) of **6 metric tiles** comparing deck A's version to deck B's: **Mix score, Loudness (LUFS), Dynamics (LU), Bass energy, Air / highs, Stereo width** — each tile shows `A vs B` and the **Δ** (= A − B), colored green/red by whether A is "better" (higher‑is‑better for most; LUFS is closeness‑to‑−9). Then a violet **"Your score"** strip: two `0–100` number inputs (A and B), their delta, and a verdict ("▲ you rate A higher"). Then a **notes** textarea. Personal scores + notes persist (see backend).

### 3. Score trend (`.card`)
Header `.label` "Progress · mix score" + trend ("+25 pts · v2→v5"). A custom **SVG line + area** (cyan) of the scored versions oldest→newest, score labels above each point, `v# · date` below, current point emphasized, dashed score gridlines. **Click a point → loads that version into deck A and highlights its row.** Sparse (<2 scored): a calm placeholder line + "Scores appear here as you analyze versions".

### 4. Versions list (`.card`)
Header `.label` "Versions" + "N versions · newest first". Each row (flex, wraps; current row gets a cyan left accent + `--card-hover` tint):
- **Slot badge** (30px): cyan `A`/`B` when loaded in a deck, else muted positional letter `C/D/E`.
- **`v#` + label** (label editable inline), `current` chip, date.
- **Score** (mono, cyan) `87/100`, or `—` when unscored.
- **Status:** `✓ analyzed` (green), `⟳ analyzing N%` (spinner, cyan), `⚠ failed` (red).
- **Inline actions (exactly two):** `▶` (load into deck A) and `Report ↗` (analyzed only → `/songs/$songId/results/$jobId`). Failed rows show inline `↻ Retry`.
- **`⋯` menu (Radix dropdown):** Make current · Edit label · Reanalyze · Reanalyze with reference · Open in Listen · **Open in Room** *(disabled "soon")* · **Delete** (danger, separated). "Edit label" turns the label into an inline input + Save/Cancel (no modal).

### Global states (`screen` prop: populated | loading | empty | error)
- **Loading:** shimmer skeletons for header + 4 rows.
- **Empty:** centered card "No versions yet" + `+ Add version`.
- **Error:** "Song not found" + back‑to‑Library.

## Interactions & behavior
- A/B audible switch (above); seek by clicking a waveform; per‑deck version pick.
- Timeline point → load into deck A + highlight row.
- Row: ▶ load‑into‑A, Report, Retry, inline label edit, and the `⋯` actions (reuse existing hooks: `useSetCurrentVersion`, `usePatchVersion`, `useReanalyzeVersion`, `useDeleteVersion`, `ReanalyzeWithReferenceDialog`).
- Compare: editing a personal score or notes updates the verdict live; values keyed per version / per version‑pair.
- Stub actions (Open in Listen/Room, Share, Archive, Publish) surface a transient **toast**.
- **Responsive:** one layout that reflows via `flex-wrap` + `auto-fit` (header stacks, decks/compare/rows wrap) — there is no separate "mobile mode" flag.
- Audio caveats (spec §3.2): media stream is `/api/versions/{id}/audio?t=<jwt>`; token rotation can swap `src` and reset position — track position off the audio element's `timeupdate`. Playback must start from a user gesture.

## State (per the prototype's view‑model; adapt to hooks/query)
`versions[]` · `slotA`,`slotB` (deck version ids) · `audible` ('A'|'B') · `playing` · `posA`,`posB` (0–1) · `slotMenu`/`rowMenu`/`headerMenu` (open ids) · `editing`,`editValue` (inline label) · `highlight` (row id) · `personal{ versionId: 0–100 }` · `notes{ "<lowId>-<highId>": string }` · `toast`.

## Backend / Data needs (NEW work — not in the original spec)
1. **Per‑version measured metrics on the version DTO.** The compare panel needs, *per version*: `mixScore (0–100)`, `loudnessLufs`, `dynamicRangeLu`, `bass`, `air`, `stereoWidth`. These already exist in each `Analysis`; surface them on the per‑version `latestVersionResult` (`AnalysisSummaryDto`) via the same per‑version join the spec adds for the score. Frontend degrades gracefully if absent.
2. **Personal score — NEW, per user × per version.** Producer's own 0–100 rating, separate from the computed score. Store `version_user_ratings(user_id, version_id, score 0–100, updated_at)` unique (user,version). Endpoints: read (fold into song payload or `GET /songs/{id}/my-ratings`), upsert `PUT /versions/{id}/rating {score}`, clear `DELETE /versions/{id}/rating`.
3. **Compare notes — NEW, per user × per version‑pair.** Free text about the delta between two versions. Store `version_compare_notes(user_id, song_id, version_a_id, version_b_id, body, updated_at)` — **normalize the pair (store sorted)** so A↔B doesn't duplicate; unique (user,pair). Endpoints: read (per song or per pair), upsert `PUT`, `DELETE`.
4. **Grades retired (contract note, no endpoint):** this page shows only the numeric score; the `grade` field is unused here.

Already covered by the spec (don't double‑build): per‑version audio stream (§3.2); make‑current / reanalyze / reanalyze‑with‑reference / edit‑label / delete hooks (§5); saved/bookmark count via existing bookmarks (§3.6); disabled Room/Share stubs (§7).

## Design tokens (from `spectr-frontend-v2/src/ui` — use the real `var(--*)`)
- **Surfaces:** `--bg #070a12` `--bg-2` `--surface` `--card #0f1828` `--card-2` `--card-hover #141f34` `--border` `--border-2`
- **Accents:** `--cyan #00e5b0` (brand/"live") · `--violet #a78bfa` (premium/Listen, personal score) · `--green #34d399` (good) · `--red #f43f5e` (danger/fail) · `--orange` `--yellow` `--blue`; plus `--cyan-dim`/`--cyan-glow`, `--violet-dim`, `--panel-bg`
- **Text:** `--text #e2e8f4` `--text-2` `--muted #64748b` `--dim #1e293b`
- **Visibility:** `--vis` / `--vis-dim` / `--vis-bd` (resolve per `[data-vis=private|shared|public]`)
- **Radius:** `--radius 12` `--radius-sm 8` `--radius-lg 16` · **Fonts:** Syne (UI), JetBrains Mono (`.mono`, all numbers)
- **Utility classes:** `.card`/`.card-hd`/`.card-body(.tight)`, `.pill`+tone, `.dot`+tone, `.btn`+`.primary/.ghost/.sm/.violet`, `.label`, `.mono`

## Real components used vs. custom
- **From `SpectrUI` (reuse):** `BrandMark`, `CoverArt`. Pills/dots/labels/buttons/cards via the global utility classes.
- **NOT used (grade‑based):** `GradePill`, `ProgressTimeline`.
- **Custom for this page:** the A/B waveform + playhead (your WaveSurfer instances), the grade‑free score line chart, the compare metric tiles + personal‑score inputs + notes, the version rows + status + `⋯` menu, skeletons, toasts.

## Files
- `SongPageConsole.dc.html` — the full hi‑fi design reference (markup + inline styles + view‑model logic). Open it in the spectr‑frontend‑v2 design‑system project to see it live.
