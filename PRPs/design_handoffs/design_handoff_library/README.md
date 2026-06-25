# Handoff: Library redesign + song visibility

Interactive design reference for the **Songs** library. Replaces the grade-centric
cards with a cover-led layout, adds **per-song visibility** (Private / Shared /
Public) as a first-class control, and surfaces version history as a quiet,
display-only sequence strip. Grades, scores and the old "version arc" are gone.

**Entry:** `Library Redesign.html` · React + Babel (pinned), self-contained.
Maps to `features/library/SongsLibrarySection.tsx`.

## Files
- `Library Redesign.html` — entry shell + bundler thumbnail
- `styles.css` — ported SPECTR tokens / global chrome + all redesign styles
- `js/data.jsx` — mock library (SongDto-shaped + `visibility`) and `VIS_META`
- `js/library.jsx` — card, list row, badge, version strip, kebab menu, dialogs, filters
- `js/visuals.jsx` — shared cover renderers (copied from the New Song modal handoff)
- `js/tweaks-panel.jsx`, `js/app.jsx` — stage, toast, Tweaks

## The redesign
- **Cover-led card.** The song's cover art is the hero. It is clipped to the
  card's rounded box and sits on the bottom layer — overlay chrome (visibility
  badge, version pill, hover play + waveform) floats above it and never bleeds.
- **Visibility badge** (top-left of cover). Color-coded: Private = slate, Shared
  = cyan, Public = violet. The whole card themes off `data-vis`.
- **Version-sequence strip** — one marker per version, latest accented, hover for
  date/label. **Display-only**: not interactive, no per-marker nav. The dashed
  rail is a placeholder for a future "progress over versions" connector.
- **Analysis Results** button (was "Report") — only shown when the latest version
  has a result; gated, never a dead control.
- **Footer meta** — relative updated-at + version count.

## Visibility — set it anywhere
- **Kebab → Visibility ▸** submenu (radio, with one-line "who can see it" hints).
- **Edit dialog** — segmented Private/Shared/Public control.
- **Filter pills** — All / Private / Shared / Public / Archived, counts in sync
  with the active tag filter.
- Every change fires a color-matched toast. State is local mock state.

## Tag filtering
- A **tags** refine-row under the visibility pills. Each chip toggles; chips show
  how many active songs carry the tag. Multiple tags = union (any-match).
- Card tags are **clickable** — they toggle the same filter and reflect the
  active state. `clear (n)` resets.
- Pill counts recompute against the active tag filter so numbers always match the
  grid. Public tags get a subtle cyan tint (mirrors `Tag.isPublic`).

## Kebab menu
`Open · Edit · Visibility ▸ · Add version · — · Archive/Unarchive · Delete`
- **Portaled to `<body>`** with fixed coords from the trigger, so the card's
  `overflow: hidden` can never clip it. Flips upward near the viewport bottom;
  the Visibility submenu flips sides near an edge. Closes on outside-click, Esc,
  or scroll.
- **Delete** is destructive → confirm dialog (counts versions, points to Archive
  as the non-destructive alternative). Archive is reversible (toggles to Unarchive).

## Tweaks (prototype-only — do not ship)
Exploration knobs for choices worth a designer's eye:
- **Layout** grid / list · **Card width** density
- **Visibility badge** icon / label / marker (geometric dot·ring·square)
- **Version strip** dots / ticks / off
- **Description peek** on / off

## Mock data coverage
`data.jsx` spans every state the card must handle: all three visibility values,
1→6 versions, analysis present / absent (Analysis Results gate), empty
description / genre / tags (peek + chip omitted), and archived rows.

## Out of scope / decisions for review
- Version-strip **delta-connectors** (color between markers) — placeholder only.
- Tag match is **union**; switch to intersection if "must have all" is preferred.
- Delete uses a confirm dialog rather than soft-delete + undo toast — pick one.
- Card tags clickable-to-filter is a proposed interaction, easy to drop.
