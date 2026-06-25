# New Song Creation — Requirements (design handoff)

Hand this to Claude design to generate the UI for creating a song. Scope is the
**"New song" dialog/flow** plus the **song visual (cover art) picker** it introduces.
Editing an existing song reuses the same field set, so design the field group to be
shared between create and edit.

Source of truth for current behavior:
- Current form: `components/frontend-spectr-v2/src/components/NewSongDialog.tsx` (Name + Genre hint only)
- Edit form (must stay in sync): `components/frontend-spectr-v2/src/components/SongEditDialog.tsx`
- Card/cover renderer: `components/frontend-spectr-v2/src/ui/CoverArt.tsx`
- Current visual seed: `components/frontend-spectr-v2/src/ui/hueFromId.ts`
- Where cards render: `components/frontend-spectr-v2/src/features/library/SongsLibrarySection.tsx`
- Reference machinery to reuse: `components/frontend-spectr-v2/src/features/references/` (`ReferenceDto`, `ReferenceSetDto`)

---

## 1. Goal

A producer creates a song container (versions/analyses attach later). Creation must
be **fast** — only **Name** is required. Everything else is optional with smart
defaults. The song gets a distinctive, user-tweakable **visual** that shows on its
library card and detail header.

Today the card visual is auto-derived (a hue hashed from the song ID — see
`hueFromId` + `CoverArt`). This work makes the visual **chosen and persisted**, with
a **randomized default** so a user who skips it still gets a good-looking, varied card
(the look they already like — see screenshot reference / the Aurora template below).

---

## 2. Fields

| Field | Required | Default | Affects | Notes |
|---|---|---|---|---|
| **Name** | ✅ Yes | empty | — | Only required field. Max 200 chars. |
| **Description** | No | empty | metadata only (v1) | Free text, "notes to self". Max ~500 chars. Multi-line. Not fed to analysis/coach in v1. |
| **Genre hint** | No | empty | analysis | Already exists. Influences analysis (e.g. danceability is genre-aware). Free text or suggest-as-you-type; max 50 chars. |
| **Reference Profile** | No | none | analysis (phase 5/6 default) | Selects the default comparison target for this song's analyses. See §3. |
| **Visual** | No | random | cosmetic | Template + primary + secondary color, prefilled randomly. See §4. |

Layout guidance: Name + Visual preview are the hero of the dialog. Description,
Genre hint, and Reference Profile are secondary (can sit below or behind a
"More options" affordance, but all should be reachable without leaving the dialog).
Keep create lightweight — a user pressing Enter after typing a Name should succeed.

---

## 3. Reference Profile field

A single selector that picks the **default reference comparison** for every analysis
of this song (so the user doesn't re-pick it on each upload). Two source types in one
picker:

1. **My reference profiles** — the user's own reference **sets/collections** (existing
   `ReferenceSetDto`: name + hue + member count), built from their uploaded reference
   tracks (`ReferenceDto`). These already exist in the References section of the library.
2. **Genre presets** — a small set of built-in profiles (e.g. **Trance, Techno,
   Hip-Hop, House, Drum & Bass, Pop**). These map to the existing phase-6 genre
   profile concept (`profile_source`).

Requirements:
- Default = **None** (current behavior: analysis runs without a forced reference).
- The picker should visually distinguish the two groups ("My profiles" vs "Presets").
- Show the set's hue dot for user profiles (consistent with the References section chips).
- Empty state for "My profiles": a hint + link/CTA to add a reference track if the user
  has none yet.
- Selectable, clearable. One profile per song.

---

## 4. Visual (cover art) picker — **chosen scope: Template + 2 colors + shuffle**

The song's visual is composed of a **template** + a **primary color** + a **secondary
color**. Prefilled with a **random combination** on dialog open. No image upload in v1.

### 4a. Templates (2 in v1)
- **Aurora** (default look) — the current gradient style. Reuse the `CoverArt`
  aesthetic: layered radial gradients + linear base, derived from the two colors.
  This is the look users already like; keep it as the canonical/default template.
- **Vinyl** — a record/vinyl image treatment, tinted by the chosen colors (e.g. record
  on a colored backdrop, grooves catching the secondary color). New asset(s) required.

Design the template list to be **extensible** (more templates later), but only these two
ship in v1.

### 4b. Colors
- **Primary** and **Secondary** color, each user-pickable (color swatches and/or a
  hue control — match the existing hue-slider pattern in `NewSetDialog` /
  `references` if convenient).
- The two colors drive both templates (Aurora gradient stops; Vinyl tint).
- Today Aurora derives a second hue as `hue + 60`; the new model makes secondary
  **explicit** so users can pick complementary or contrasting pairs.

### 4c. Shuffle + random default
- On open, the visual is **already randomized** (template + both colors) so a card
  looks good with zero interaction.
- A **Shuffle** button re-randomizes template + colors in one click.
- Live **preview** of the card visual updates as template/colors change (show it at the
  size it appears on the library card so users see the real result).

### 4d. Persistence (so design accounts for the fields)
The visual must be **saved on the song** (not re-derived from ID anymore). The chosen
representation should capture: `template`, `primaryColor`, `secondaryColor`. (Backend
will add columns + DTO fields; this doc only requires the UI to collect and preview them.)
Existing songs with no stored visual must keep rendering (fall back to the current
`hueFromId`-derived Aurora look) — no broken cards.

---

## 5. States, validation, edge cases

- **Submit disabled** until Name is non-empty (trimmed). Enter submits.
- **Pending**: disable actions, show "Creating…" on the submit button (current pattern).
- **Error**: toast on failure (current pattern via Sonner). Dialog stays open with input intact.
- **Success**: toast `Created "<name>"`, close dialog, navigate/route per current `onCreated` behavior.
- **Cancel/close**: discards in-progress input (no draft persistence needed in v1).
- **Reference Profile = none** and **Genre hint empty** are valid (current default behavior).
- **Visual never invalid** — a random default always exists; user can't end up with no visual.
- Reduced-motion: any animated preview must respect the existing reduced-motion handling
  (`hooks/useReducedMotion.ts`) — Aurora/Vinyl previews should not animate distractingly.

---

## 6. Reuse / consistency

- Match the existing dialog chrome: Radix Dialog + `styles/forms.module.css` classes
  (`dialogOverlay`, `dialogContent`, `dialogTitle`, `field`, `label`, `input`, `dialogActions`,
  `button`, `buttonPrimary`).
- Match the existing visual language: `CoverArt` gradient math (oklch radial + linear),
  global utility classes (`.card`, `.pill`, `.btn`, `.label`, `.mono`), `tokens.css`.
- The **same field group** powers create (`NewSongDialog`) and edit (`SongEditDialog`),
  including the visual picker — design it as one reusable block.

---

## 7. Out of scope (v1 — do not design)

- Custom cover **image upload** / cropping.
- Additional templates beyond Aurora + Vinyl.
- Description feeding into analysis/coach.
- Multiple reference profiles per song.
- AI-generated cover art.

---

## 8. Acceptance criteria

- [ ] User can create a song with **only a Name**.
- [ ] Description, Genre hint, Reference Profile are optional and reachable in the dialog.
- [ ] Reference Profile picker lists **My profiles** (reference sets) and **Genre presets**, defaulting to none.
- [ ] Visual is **prefilled random** (template + primary + secondary) on open.
- [ ] User can change template (Aurora/Vinyl), both colors, and **Shuffle**, with a **live preview**.
- [ ] The chosen visual persists and renders on the library card + song header.
- [ ] Existing songs with no stored visual still render (fallback to hue-from-ID Aurora).
- [ ] Create and edit share the same field group + visual picker.
