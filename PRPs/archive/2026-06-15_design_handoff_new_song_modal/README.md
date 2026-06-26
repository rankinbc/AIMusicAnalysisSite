# Handoff: New Song modal + cover-art visual picker

## Overview
Redesign of the **New Song** dialog (`NewSongDialog.tsx`) so a producer can create a
song fast (only **Name** required) while picking a distinctive, persisted **cover
visual** (template + two colors, prefilled random + Shuffle). Adds **Description**,
a **Reference Profile** selector, and the **visual picker**. The same field group is
designed to also power **edit** (`SongEditDialog.tsx`).

## About the design files
The files in this bundle are **design references built in HTML/React + inline styles**
— a working prototype of the intended look and behavior, **not production code to paste
in directly**. The task is to **recreate them in the existing `frontend-spectr-v2`
environment** using its established patterns: Radix Dialog, CSS Modules, the design
tokens in `src/styles/tokens.css`, the form primitives in `src/styles/forms.module.css`,
and the react-query hooks in `src/api/hooks.ts`.

Good news: the prototype was written against your real tokens and chrome, so most
values map 1:1. The renderer file (`js/visuals.jsx`) is close to drop-in React — it
mainly needs TypeScript types and a real asset path.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, interactions. Recreate pixel-close
using existing libraries/patterns. All colors come from `tokens.css` — no new tokens.

---

## Files in this bundle (design reference)
- `New Song Modal.html` — entry/prototype shell (React + Babel; mounts the app)
- `styles.css` — all styling. Mirrors `tokens.css` (`:root`), `global.css` (fonts/body),
  `forms.module.css` (dialog + inputs + buttons). The new stuff is the `.ns-grid`,
  `.cardp*` (preview), `.tmpl-*` (template picker), `.swatch*`, `.refsel-*`, `.toast*`.
- `js/modal.jsx` — the dialog: fields, two-column layout, validation, pending, the
  `VisualPicker` (thumbnails + shuffle + swatches) and `SecondaryFields`.
- `js/visuals.jsx` — **the cover renderers** (`AuroraVisual`, `VinylVisual`, `SpinVisual`,
  `EqVisual`, `SkylineVisual`, `RobotVisual`, `BoothVisual`, `CassetteVisual`,
  `BoomboxVisual`), the `PALETTE`, `randomVisual()`, and `CardPreview`.
- `js/refpicker.jsx` — the grouped **Reference Profile** dropdown (My profiles + presets).
- `js/app.jsx` — stage + toast + Tweaks (Tweaks are a prototype-only affordance; do not ship).
- `assets/coach.png` — the coach mascot used by the Robot + Booth templates.

---

## Target-codebase file plan
| New / changed file | What goes there |
|---|---|
| `src/components/SongFields.tsx` (new) | The shared field group (Name, Description, Genre hint, Reference Profile, Visual picker). Used by both create + edit. |
| `src/components/NewSongDialog.tsx` (edit) | Keep the Radix shell; render `<SongFields/>`; submit via `useCreateSong`. |
| `src/components/SongEditDialog.tsx` (edit) | Render the same `<SongFields/>` (initialized from `song`); submit via `usePatchSong`. Keep tags section. |
| `src/ui/SongVisualPicker.tsx` (new) | Template thumbnails + Shuffle + two swatch rows + live `CoverArt` preview. |
| `src/ui/SongVisualPicker.module.css` (new) | Picker styling (port `.tmpl-*`, `.swatch*` from `styles.css`). |
| `src/features/references/ReferenceProfileSelect.tsx` (new) | Grouped dropdown (port `js/refpicker.jsx`). Reuse `useReferenceSets()` for "My profiles"; built-in presets for genres. |
| `src/ui/CoverArt.tsx` (edit) | Accept an optional `visual={template, primary, secondary}`; render the chosen template; **fall back to the current `hueFromId`→Aurora look when absent**. Port the 9 template renderers from `js/visuals.jsx`. |
| `src/ui/songVisual.ts` (new) | `PALETTE`, `TEMPLATES`, `randomVisual()`, color helpers (`oklch`, `shade`, `mix`, `colorKey`). |
| `public/coach.png` | Copy `assets/coach.png` (ideally a higher-res export — see Assets). |

---

## Screens / Views

### New Song dialog
- **Purpose**: create a song container (versions/analyses attach later). Only Name required.
- **Layout**: Radix `dialogContent` (`forms.module.css`), widened. Header (title + one-line
  description) on top. Body is a 2-column grid (`.ns-grid`): **left = visual column**
  (`--visual-w` 280px), **right = fields column** (`1fr`). Footer = right-aligned actions
  with a left "Press ⏎ to create" hint. Collapses to one column < 560px.
  - Default width **700px** (`min(700px, 94vw)`); gap 24px; padding 24px.
- **Left column (visual)** top→bottom: live preview card → "Template" eyebrow + "⟳ Shuffle"
  link → **template thumbnail grid** (3 columns, 9 templates) → "Primary" swatch row →
  "Secondary" swatch row.
- **Right column (fields)** top→bottom: **Name** (large input, autofocus, `required`) →
  **Description** (textarea, 0/500 counter) → **Genre hint** (input + suggestion chips) →
  **Reference profile** (grouped select).

#### Components
- **Live preview card** (`.cardp`): a faithful library `SongCard` at card scale. Cover is
  `aspect-ratio: 2.1` with the chosen template; overlay shows a `new` pill (top-right) +
  decorative mini-wave + play affordance (bottom); body shows the live Name (or muted
  "Untitled song") + "— no analysis yet"; footer "just now / 0 v".
- **Template thumbnails** (`.tmpl-thumb`): each a mini live render of that template in the
  current colors + a mono label. Selected = 1px cyan ring + `--cyan-dim` halo
  (`box-shadow`, set instantly — **don't** transition box-shadow/position for the selected
  state). 3-col grid, 8px gap, thumb radius 9px, vis `aspect-ratio: 1.5`.
- **Swatch rows** (`.swatch`): 7-col grid of 14 colors; chip `aspect-ratio: 1`, radius 7px;
  selected = inset hairline + 2px panel-gap + 4px `currentColor` ring (instant).
- **Shuffle** (`.shuffle-link`): mono cyan link; re-randomizes template + both colors.
- **Inputs** = `forms.module.css` `.input`; **buttons** = `.button` / `.buttonPrimary`.
- **Reference Profile select**: see below.

### Reference Profile dropdown
- Trigger shows: hue **dot** (user set) / **diamond** (genre preset) + name + clear `×`, or
  placeholder "None — analyze without a reference".
- Panel (radius 8px, `--card-2`, shadow): `None` row, then group label **"My profiles"**
  (the user's `ReferenceSetDto`s — hue dot + name + member count; empty-state hint + "Add a
  reference track" CTA when none), then group label **"Genre presets"** (Trance, Techno,
  Hip-Hop, House, Drum & Bass, Pop — diamond marker). Single-select, clearable, default None.
- Closes on outside-click + Esc.

---

## Interactions & behavior
- **Validation**: submit disabled until `name.trim()` non-empty. **Enter submits**.
- **Pending**: disable actions; primary button shows spinner + "Creating…".
- **Success**: toast `Created "<name>"` (Sonner — you already use it), close, then current
  `onCreated` behavior (opens the upload dialog).
- **Error**: toast on failure; dialog stays open with input intact.
- **Cancel/close/overlay-click**: discard (no draft persistence v1).
- **Visual randomized on open** (template + both colors) and on Shuffle — a card looks good
  with zero interaction. **Visual is never invalid.**
- **Live preview** updates as Name/template/colors change.
- **Reduced motion**: previews are static (no looping animation). Honor
  `hooks/useReducedMotion.ts` / the global `prefers-reduced-motion` block; entrance
  animations animate transform/background only (never from `opacity:0`) so they never
  strand content invisible.

## State management
Shared field-group state (lift into `SongFields`, initialized empty for create / from
`song` for edit):
- `name: string`, `description: string`, `genreHint: string`
- `referenceProfile: { kind: 'set' | 'preset'; id: string; name: string; hue: number } | null`
- `visual: { template: TemplateId; primary: Color; secondary: Color }`
- `pending: boolean`

Data: `useReferenceSets()` for "My profiles". Create → `useCreateSong`; edit → `usePatchSong`.

---

## The visual model (persistence)
The visual is **chosen and saved on the song** (no longer derived from id).

- `template`: one of `aurora | vinyl | spin | eq | skyline | robot | booth | cassette | boombox`.
- `primary`, `secondary`: each an oklch color. In the prototype a Color is
  `{ l: number, c: number, h: number }` (this is what lets the palette include dark tones).
  **Recommended storage**: serialize each color (e.g. the `oklch(l c h)` string, or a small
  JSON `{l,c,h}`), or normalize to hex at the boundary — your call. Keep all three pieces.

### Backend (out of scope for the UI, but required to persist)
Add to the song model + DTOs:
- `description: text | null`
- `visual_template: text | null`, `visual_primary: text | null`, `visual_secondary: text | null`
- `reference_profile_kind: text | null` (`'set'|'preset'`) + `reference_profile_id: text | null`

Surface on `SongDto` and accept in `CreateSongRequest` / `PatchSongRequest`
(`src/api/types.ts`). **Backwards compatibility**: songs with no stored visual must keep
rendering — `CoverArt` falls back to `hueFromId(song.id)` → Aurora (today's look).

### CoverArt change
Extend `CoverArt` to take an optional `visual`. When present, render that template from the
two colors (port the matching `*Visual` from `js/visuals.jsx`). When absent, render today's
`hueFromId` Aurora. The Aurora renderer in the prototype is the **same gradient recipe you
already ship** (oklch radial + radial + linear), just with an explicit second color.

---

## Design tokens (all already in `tokens.css`)
- Surfaces: `--bg #070a12`, `--panel-bg #0e1727`, `--card #0f1828`, `--card-2 #11192a`,
  `--card-hover #141f34`, `--border rgba(255,255,255,.07)`, `--border-2 rgba(255,255,255,.12)`.
- Accent: `--cyan #00e5b0` (+ `--cyan-dim`, `--accent-bright-2 #1eedba`, `--ink-on-accent-2 #04221b`).
- Text: `--text #e2e8f4`, `--text-2 #c0cad8`, `--muted #64748b`.
- Radii `--radius 12 / --radius-sm 8`; spacing 4/8/12/16/20/24.
- Type: **Syne** (UI, ss01+ss02 on) + **JetBrains Mono** (`.mono`, labels, tnum). Self-hosted
  in `public/fonts/` already.
- Cover palette (new, prototype `PALETTE`, 14 oklch colors): vivid→deep→dark, e.g.
  rose `0.72 0.19 352`, emerald `0.74 0.15 172`, indigo `0.46 0.16 270`, midnight `0.34 0.10 250`,
  charcoal `0.30 0.03 250`. Swatch chip = `oklch(l c h)`.

## Assets
- `assets/coach.png` — the coach mascot (provided by the user). **102×96, no alpha.** Used by
  the **Robot** (hero portrait) and **Booth** (at the decks) templates. It's kept crisp at
  portrait scale with a radial edge-fade; the chosen colors theme the scene around it (the
  mascot itself stays on-brand cyan). Recommend exporting a **higher-resolution** version
  (e.g. 512px, ideally with transparent background) and placing it at `public/coach.png` for
  crisper covers and easier compositing in the Booth scene.
- No icon library needed — markers are CSS dots/diamonds; the "image" glyph in earlier
  drafts is gone.

## Notes / decisions to confirm with the team
- **Template set**: v1 of the requirements doc specified Aurora + Vinyl only and listed extra
  templates as out-of-scope; the user has since asked for the full set of nine. Confirm which
  ship.
- **Color storage format** (oklch string vs `{l,c,h}` vs hex) — pick one before backend work.
- **Tweaks panel** (`js/tweaks-panel.jsx`, `js/app.jsx`) is a prototype-only control for
  exploring layout variants (preview placement, width/density, all-visible vs. "More options").
  Don't ship it; just pick the defaults you like (left preview, all-visible, 700px).
