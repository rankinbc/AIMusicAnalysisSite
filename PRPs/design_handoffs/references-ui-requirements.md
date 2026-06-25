# References UI — Requirements (design handoff)

Hand this to Claude design to generate the **References** UI for the v2 frontend
(`components/frontend-spectr-v2/`). Scope is the producer's reference-track library
plus the new **reference profile** (collection) detail view, batch upload, and
per-reference analyze status. Backed by the design spec
`docs/superpowers/specs/2026-06-25-reference-profiles-design.md`.

**Stack constraints (hard):** React 19 + TypeScript strict. **CSS Modules +
`src/styles/{tokens.css,global.css}`** + global utility classes (`.card`, `.pill`
with tones, `.btn`/`.btn.primary`/`.btn.ghost`/`.btn.sm`, `.label`, `.mono`, `.dot`).
**No Tailwind, no styled-components, no shadcn/MUI/Chakra.** Radix Dialog for modals.
Sonner for toasts. No inline styles unless the value is dynamic (e.g. hue computed
from a number). Reduced-motion must be respected (`hooks/useReducedMotion.ts`).

---

## 1. Goal & where it lives

Producers save **reference tracks** (pro mixes in their genre), group them into
**reference profiles** (named collections), and use a profile as the comparison
target for their own analyses. This work designs:

- **A. The References section** (updated) — the library grid + sets bar + filters.
- **B. The Reference Profile detail view** (NEW) — the aggregate of a collection.
- **C. Batch upload + per-reference analyze status/retry** (updated card + dialog).

The References section already lives in the library (rendered by
`features/references/ReferenceLibrarySection.tsx`, mounted under the `/library`
route). Design B as a new view/panel reachable from a profile (set) chip.

---

## 2. Source of truth — reuse these

| Thing | File |
|---|---|
| References section (grid + sets bar + filters + dialogs) | `features/references/ReferenceLibrarySection.tsx` |
| Reference card (cover, status pill, metrics, collection chips, ⋮ menu) | `features/references/ReferenceCard.tsx` |
| Existing single-file upload dialog (to extend → batch) | `components/ReferenceUploadDialog.tsx` |
| Edit dialog | `features/references/ReferenceEditDialog.tsx` |
| **Profile picker** (already built — design must stay visually consistent) | `features/references/ReferenceProfileSelect.tsx` |
| Genre presets list | `features/references/genrePresets.ts` |
| Hue helpers (`hueVar`, set-chip dots) | `features/references/hue.ts` |
| Section styles | `features/references/references.module.css` |
| Dialog chrome classes (`dialogOverlay/Content/Title/Description`, `field`, `label`, `input`, `dialogActions`, `button`, `buttonPrimary`) | `styles/forms.module.css` |
| Cover-art gradient (used on cards) | `ui/CoverArt.tsx`, `ui/hueFromId.ts` |
| Pill, relative-time | `ui/Pill.tsx`, `ui/relativeTime.ts` |
| Multi-file drag-drop pattern to mirror | `components/StemsUploadDialog.tsx` (bulk-stem upload) |

The visual language is the existing dark producer UI: cover-art gradient tiles,
hue-tinted set chips with a `.dot`, `Pill` tones (`violet` = source, `green` =
analyzed, `yellow` = pending; add `red` = failed), `.mono` for numeric readouts.

---

## 3. What exists today (don't redesign from scratch — evolve it)

The **References section** (`ReferenceLibrarySection`) already renders:

- **Header**: "Reference tracks", a subtitle count (`N references · M analyzed · K
  sets`), and a **`+ Add reference`** button.
- **Sets bar**: an "all references" chip + one chip per collection
  (`ReferenceSetDto`: name + hue `.dot` + member count + a `×` delete affordance) +
  a **`+ New set`** button. Clicking a chip **filters** the grid to that set.
- **Status filters**: `all` / `analyzed` / `pending` pills with counts.
- **Grid** of `ReferenceCard`s.
- **NewSetDialog** (name + hue slider), edit dialog, delete confirms.

Each **ReferenceCard** shows: cover tile, a `violet` source Pill + a
`green` "analyzed" / `yellow` "pending" Pill, title, artist, a metric row
(`BPM · KEY · LUFS · TP · duration`, mono), member-collection chips, a ⋮ menu
(Edit · toggle collections · Delete), and a footer (`added <relative>` · `N uses`).

---

## 4. What's NEW in this work (design these)

1. **Batch / multi-file upload** — drop **many** reference tracks at once (mirror
   `StemsUploadDialog`), each becomes its own card. Analysis is an explicit action
   with an **"Analyze all"** affordance (no auto-analyze).
2. **Per-reference analyze status + retry** — references are `pending` /
   `analyzed` / **`failed`** (today only the first two exist). Failed cards show
   the reason + a **Retry** button.
3. **Reference Profile detail view** — open a collection to see its **aggregate
   profile**: the averaged metric curve + ranges, "X of Y analyzed", and member
   management. This is the centerpiece new screen.

---

## 5. Data shapes (what the backend provides — design must render these)

### `ReferenceDto` (one reference track) — existing + new fields
```ts
{
  id, title, artist, source, genre,
  bpm, detectedKey, durationSeconds,
  lufs, truePeakDb, dynamicRangeLu, stereoWidth, stereoCorrelation,
  bandLevels,                 // { sub_bass, bass, low_mid, mid, upper_mid, presence, air } dB
  analyzed,                   // bool (true iff analysisStatus === 'analyzed')
  analysisStatus,             // NEW: 'pending' | 'analyzed' | 'failed'
  analysisError,              // NEW: string | null (short reason when failed)
  usedCount, setIds, createdAt
}
```

### `ReferenceSetDto` (a profile, list view) — existing + new
```ts
{ id, name, hue, memberCount, analyzedCount /* NEW */, createdAt }
```

### Profile aggregate (`GET /reference-sets/{id}` → `profileJson`) — NEW
The profile is the **mean + std per metric** across the collection's *analyzed*
members. Render `std` as a tolerance band (`mean ± 2·std`). Example:
```jsonc
{
  "member_count": 5, "analyzed_count": 3, "track_count": 3,
  "feature_statistics": {
    "lufs":               { "mean": -8.2, "std": 1.1 },
    "true_peak":          { "mean": -0.9, "std": 0.5 },
    "dynamic_range":      { "mean":  8.4, "std": 1.0 },
    "stereo_width":       { "mean": 0.62, "std": 0.05 },
    "stereo_correlation": { "mean": 0.41, "std": 0.05 },
    "bpm":                { "mean": 138.0, "std": 2.0 },
    "band_sub_bass":      { "mean": -6.1, "std": 2.0 },
    "band_bass":          { "mean": -4.0, "std": 2.0 },
    "band_low_mid":       { "mean": -7.2, "std": 2.0 },
    "band_mid":           { "mean": -5.5, "std": 2.0 },
    "band_upper_mid":     { "mean": -6.8, "std": 2.0 },
    "band_presence":      { "mean": -9.1, "std": 2.0 },
    "band_air":           { "mean": -12.0, "std": 2.0 }
  }
}
```
A profile with `analyzed_count == 0` is **not ready** (no usable aggregate yet).

---

## 6. Screen A — References section (updated)

Keep the existing layout (header / sets bar / status filters / grid). Changes:

- **`+ Add reference` opens the batch dialog** (see §8), not the single-file one.
- **Status filter** gains a **`failed`** pill (with count) alongside all/analyzed/pending.
- **"Analyze all" affordance**: when ≥1 reference is `pending`, show an action
  (header button or a banner above the grid) to analyze all pending references in
  one click. Show progress feedback (e.g. "Analyzing 3…") and toast on completion.
- **Set chips become the entry to the profile detail view (§7).** Today a chip
  filters the grid; add a way to **open** the profile (e.g. a chip affordance, or
  clicking the name opens the detail while the chip body still filters — your call,
  but make "open profile" discoverable). The chip should also surface readiness,
  e.g. `analyzedCount/memberCount` when not all members are analyzed.

### ReferenceCard status states (update the status Pill + body)
| `analysisStatus` | Pill | Body |
|---|---|---|
| `analyzed` | `green` "analyzed" | metric row (`BPM · KEY · LUFS · TP · dur`) |
| `pending` | `yellow` "pending" | "analyzing in background…" OR "queued — Analyze" if never started |
| `failed` | **`red` "failed"** | short `analysisError` + a **Retry** button (`.btn.sm`) |

---

## 7. Screen B — Reference Profile detail view (NEW — the centerpiece)

Opening a collection shows its **aggregate profile**. Sections:

### 7a. Header
- Profile **name** + hue `.dot` (matches the set chip), member summary
  **`X of Y analyzed`**, and edit affordances (rename, recolor — reuse the
  `NewSetDialog` name + hue-slider pattern), plus a **Delete collection** action.
- A subtle "this profile is the comparison target your analyses can use" hint.

### 7b. Aggregate visualization (the hero)
Render `feature_statistics` as a **target the user can read at a glance**:
- A **band curve / EQ-style readout** across the 7 bands
  (`band_sub_bass … band_air`), each plotted at its `mean` with a shaded
  `mean ± 2·std` tolerance band. This is the profile's "tonal fingerprint".
- **Range readouts** (`.mono`) for the scalar metrics: **LUFS, True Peak, Dynamic
  Range, Stereo Width, Correlation, BPM** — each as `mean` with its `± 2·std`
  range (e.g. `LUFS −8.2  (−10.4 … −6.0)`). A tight band = a consistent profile;
  a wide band = varied references. Convey that distinction visually.
- Label it **"based on N tracks"** (`track_count`).

This must reuse the same metric vocabulary/units the analysis Reference tab uses,
because a user's analysis is compared against exactly this profile (see
`analysis-page-datapoints.md` Tab 5 / phase-6 gaps).

### 7c. Member list + management
- List the collection's reference tracks (compact rows or a small grid), each with
  its analyze status (`analyzed` / `pending` / `failed` + Retry).
- **Add members**: pick from the user's other reference tracks not already in the
  profile (a picker/search), and/or jump to batch upload.
- **Remove members** from the profile (the track stays in the library — only the
  grouping changes; mirror the existing collection-toggle semantics).
- Editing membership **re-aggregates** the profile (the numbers in 7b update).

### 7d. Detail-view states
| State | Render |
|---|---|
| **Ready** (`analyzed_count ≥ 1`) | Full aggregate (7b) + member list. |
| **Not ready** (`analyzed_count == 0`) | "This profile has no analyzed tracks yet." Show members + a prompt to **Analyze all** / add analyzed tracks. No curve. |
| **Partially analyzed** (`analyzed_count < member_count`) | Show the aggregate over analyzed members + a note: "based on N of M tracks — analyze the rest to refine." |
| **Empty** (no members) | Empty state + add-members / upload CTA. |

---

## 8. Batch upload dialog

Mirror `StemsUploadDialog`'s multi-file pattern, in the References visual language:
- **Drag-drop / file-pick of many audio files** (MP3/FLAC/WAV; up to 250 MB each).
- A **staged list**: one row per file with name, size, a local-blob play preview
  if cheap, an **editable title** (defaults to filename), and a remove-row `×`.
- Optional **assign to a collection** on upload (so a batch lands straight into a
  profile) and optional artist/genre fields (can be per-row or applied to all).
- Submit creates all references (status `pending`); then either auto-prompt or a
  prominent **"Analyze all just-uploaded"** action (no silent auto-analyze).
- Pending / progress / error states per row; toast summary on completion.

---

## 9. States & edge cases (checklist)

- Every screen needs **loading**, **empty**, and **error** treatments — not just
  the happy path (the section already has loading/empty/error; match them).
- **Reference statuses**: `pending` (queued or analyzing), `analyzed`, `failed`
  (reason + Retry). Don't render a failed reference as analyzed-with-zeros.
- **Profile readiness** drives the detail view (§7d) and the set chip
  (`analyzedCount/memberCount`).
- **Re-aggregation is implicit**: add/remove a member or (re)analyze one → the
  profile numbers change. Design for the values updating in place.
- A reference can belong to **multiple** profiles; removing it from one doesn't
  touch the others or the library.
- **Deleting a reference** removes it from every profile it was in (existing
  confirm copy already says this).
- Reduced-motion: any animated curve/preview stays calm.

---

## 10. Reuse / consistency (do, don't)

- **Do** reuse: `references.module.css` classes, `forms.module.css` dialog chrome,
  global `.card`/`.pill`/`.btn`/`.label`/`.mono`/`.dot`, `CoverArt`, `Pill` tones,
  `hueVar`/hue-slider, the `ReferenceProfileSelect` look for any picker.
- **Do** keep the set-chip + `.dot` hue identity consistent everywhere a profile
  appears (sets bar, detail header, member chips, the analysis Reference tab).
- **Don't** introduce a charting lib for 7b if a simple CSS/SVG bar+band reads
  well (Recharts is available if a real chart is warranted — match the analysis
  page's gap-bar style if you want continuity).
- **Don't** add Tailwind/inline styles (except dynamic hue) or new global layout state.

---

## 11. Out of scope (don't design)

- The **per-song profile picker on song create/edit** — already exists
  (`ReferenceProfileSelect`) and is owned by the new-song handoff. Don't redesign it.
- The **analysis results Reference tab** — covered by `analysis-page-*.md`
  (it consumes the same profile; only a minimal label update there).
- URL/streaming reference import; auto-analyze-on-upload; multiple profiles per song;
  any backend/endpoint design (this is UI only).

---

## 12. Acceptance criteria

- [ ] References section opens the **batch** upload; many files stage and upload at once.
- [ ] References show **pending / analyzed / failed**; failed cards show the reason + **Retry**.
- [ ] An **Analyze all** action analyzes all pending references in one click.
- [ ] A set chip **opens the Reference Profile detail view**.
- [ ] The detail view renders the **aggregate** (band curve + `±2·std` ranges + "based on N tracks").
- [ ] The detail view shows **X of Y analyzed** and has **not-ready / partial / empty** states.
- [ ] Members can be **added/removed**; the aggregate reflects the change in place.
- [ ] Everything uses CSS Modules + global utilities + Radix + Sonner (no Tailwind), and respects reduced-motion.
