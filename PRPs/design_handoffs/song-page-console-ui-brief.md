# Song Page Console — UI Design Brief (for Claude Design)

**Project:** spectr-frontend-v2 (your synced SPECTR design system)
**Screen:** the page a producer lands on after clicking a song in their Library
**Companion engineering spec:** `PRPs/song-page-console-redesign.md` (data + build
detail — you don't need it; this brief is self-contained for design)

---

## 0. Read first — the design system you're building with

This screen is built from the **real shipped SPECTR components** in your project
(`window.SpectrUI.*`) on the app's **dark theme**. Before laying anything out:

- Mount on the dark surface: `background: var(--bg)`, `color: var(--text)`. Never put
  these components on a white background — they wash out.
- Style with the global utility classes + tokens, **not** Tailwind: `.card` /
  `.card-hd` / `.card-body`, `.pill` (+ tones `.cyan .violet .orange .red .green
  .yellow`), `.dot`, `.btn` (+ `.primary .ghost .sm .violet`), `.label` (uppercase mono
  eyebrow), `.mono` (use for **all numbers**).
- Tokens: surfaces `--bg --bg-2 --surface --card --card-hover --border`; accents
  `--cyan` (brand) `--violet --orange --red --green --yellow`; text `--text --text-2
  --muted --dim`; grades `--grade-a…--grade-f`; radii `--radius*`, spacing `--space-1…6`.
- Components in play: **CoverArt**, **GradePill**, **Pill**, **Dot**,
  **ProgressTimeline**, **Label**, **BrandMark** (already in the app chrome).

Read each component's `.prompt.md` + `.d.ts` for exact props before using it.

---

## 1. What this screen is

A producer's **workbench for one song**. A song is a container of **versions** (v1,
v2, …) — successive bounces of the same track as they iterate. This page is where they:

- **audition** versions and A/B two of them by ear,
- **see progress** — how the mix score moved across versions,
- **manage** versions (set the current one, rename, re-analyze, delete),
- **route out** to the deep surfaces (full Listen rack, the analysis Report).

It is a **focused management console**, calm and information-dense — not a social feed
and not a player-first hero page. The emotional tone: *"mission control for my track."*
Confident, legible, a little technical (mono numerals, measured values), never loud.

**Not on this screen** (designed elsewhere — do not invent them): emoji reactions on a
waveform, comment threads, heat maps, live listening-room presence/chat, any DSP
controls. Those live on the Listen/Room surfaces. Here, social is **read-only counts +
links out**, nothing interactive.

---

## 2. Layout — single-column stacked

One centered column (max ~960px), sections stacked top-to-bottom as `.card`s with clear
vertical rhythm. A `← Library` back link sits above everything.

```
← Library

┌ IDENTITY HEADER ──────────────────────────────────────────┐
│  [cover]  Midnight Drive                    [Edit] [★ Publish] │
│  ▒▒▒▒▒▒▒  house · 4 versions · ◐ private    [+ Add version] (⋯)│
│  ▒▒▒▒▒▒▒  grade A · 87/100                                    │
│           #latenight  #wip                                    │
├ QUICK-PLAYER  (A / B audition) ───────────────────────────┤
│  A  [v4 final master ▾]   ▶ ──●──────────────  Open in Listen↗│
│  B  [v3 louder bass  ▾]   ▶ ──────●──────────  Open in Listen↗│
├ PROGRESS TIMELINE ────────────────────────────────────────┤
│  62 ─── 71 ───── 80 ──── 87        (score across versions)   │
├ VERSIONS ─────────────────────────────────────────────────┤
│  A  ◆A  v4 final master   87/100  current ✓   [▶] [Report↗] ⋯│
│  B  ◆B  v3 louder bass    80/100          ✓   [▶] [Report↗] ⋯│
│  C  v2  v2 rough cut      71/100          ⟳   [▶]           ⋯│
│  D  v1  v1 demo             —             ⚠   [▶] [Retry]   ⋯│
├ COMPARE ──────────────────────────────────────────────────┤
│  Spot what changed:  [v1 → current]  [Last two]  [Pick two…] │
└────────────────────────────────────────────────────────────┘
```

On narrow/mobile: the header stacks (cover on top), the two quick-player slots stack,
version rows reflow to two lines (label + score on line 1, status + actions on line 2),
compare buttons wrap.

---

## 3. Sections

### 3.1 Identity header
**Purpose:** instantly say *which song, how good, how shared.*

- **Cover:** `CoverArt` (square, sized as a hero thumbnail ~140–180px). It renders the
  song's visual template.
- **Title block:** song name as the page `<h1>`. Below it an overline row of `Pill`s:
  genre (`.cyan`), current score (`<span class="mono">87</span>/100`), current grade
  (`.green`, e.g. "grade A"), and a **visibility chip** — `◐ private` / `🔗 link` /
  `● public`. Then a tag row (small pills; public tags carry a tiny `pub` marker).
- **Actions (top-right):** `Edit` (`.btn .ghost .sm`), `★ Publish` (`.btn .violet .sm`,
  appears **disabled** until the song has at least one analyzed version), `+ Add version`
  (`.btn .primary`). A `⋯` overflow holds **Archive** (destructive-ish, de-emphasized).
- **States:** if no version is analyzed yet, the grade/score pills are absent and Publish
  is disabled.

### 3.2 Quick-player (A / B) — the new centerpiece interaction
**Purpose:** audition and A/B two versions *by ear, instantly*, without opening the heavy
Listen page.

- **Two slots, A and B**, stacked. Each slot = a **version dropdown** + a **waveform with
  a playhead** + a small play/pause + scrub. Slot A defaults to the current version, slot
  B to the previous one.
- **The key behavior:** only one slot plays at a time; **clicking the other slot's play
  instantly switches the audible track** so you can flip A↔B and hear the difference. Make
  the **currently-audible slot visually dominant** (brighter waveform, a `Dot` "live"
  indicator, the other dimmed). This A/B switch is the emotional core of the screen —
  design it to feel immediate and tactile.
- Each slot has `Open in Listen ↗` (`.btn .ghost .sm`) → the full DSP rack.
- No EQ/effects/meters here. Raw waveform + transport only.
- **Empty state:** if the song has only one version, show a single slot and a muted hint
  ("Add another version to A/B compare"). If zero versions, hide the player entirely.

### 3.3 Progress timeline
**Purpose:** the satisfying "I'm getting better" arc.

- Use the **`ProgressTimeline`** component, fed real per-version scores. Show the score
  trend across versions; hovering a point reveals version label + grade + date.
- Clicking a point loads that version into player slot A and highlights its row.
- **Empty/sparse:** with <2 scored versions, render a calm placeholder line + "Scores
  appear here as you analyze versions" rather than a broken chart.

### 3.4 Versions list — the spine
**Purpose:** the canonical list of every bounce, scannable, with **exactly two inline
actions** and everything else tucked away.

- **Row anatomy (left→right):** an A/B/C/D slot letter (ties the row to the quick-player
  /compare), a `GradePill` (or a muted `v#` chip when unscored), the version **label**
  (fallback "Version N"), the **score** (`mono`, cyan), the **date** (muted), a `current`
  chip on the active version, and a **status indicator**:
  - `✓` analyzed — calm/green
  - `⟳` analyzing — animated, with optional progress
  - `⚠` failed — `--red`
- **Inline actions (only two):** `▶` (load into the quick-player) and `Report ↗` (only
  when analyzed). On a **failed** row, replace Report with an inline `Retry`.
- **Everything else → a `⋯` context menu** (Radix dropdown): **Make current · Edit label ·
  Reanalyze · Reanalyze with reference · Open in Listen · Open in Room** *(show but
  disabled — "coming soon")* **· Delete** (danger styling, separated at the bottom).
- Rows are sorted newest-first. The **current** version reads as subtly elevated
  (`--card-hover` or a left accent border in `--cyan`).
- **Inline label editing:** picking "Edit label" turns the label into a compact inline
  input + save/cancel (no modal).

### 3.5 Compare
**Purpose:** quantify what changed between two versions.

- A compact `.card` titled "Spot what changed" with a short sub-line ("Pick any two
  versions to see the delta on mix score, loudness, dynamics, bass, air, and stereo
  width.") and three quick-pick buttons: **v1 → current**, **Last two**, **Pick two…**.
- These open a comparison dialog (already exists — you only design the entry card + the
  dialog's look if you want to propose one). Disable the presets when there are <2
  versions.

### 3.6 (Folded into the header) Activity / visibility
There is **no separate social panel**. Visibility lives as the header chip. If a
**saved/bookmark count** is available for the current version, it may appear as a small
muted `Pill` near the header (`◷ 2 saved`) — but **never invent counts**; if there's no
data, show nothing. `Open in Room` / `Share` are stubs (disabled) until those ship.

---

## 4. Global states

- **Loading:** skeletons for the header (cover block + title lines) and 3–4 version rows.
  Keep the dark surface; shimmer in `--bg-2`/`--surface`.
- **Empty (no versions):** a centered, friendly `.card` — "No versions yet. Upload one to
  start analysis." + a primary `+ Add version`.
- **Error (song not found):** `← Library` + a calm "Song not found." message.

---

## 5. Hierarchy & feel — what to optimize

1. **The A/B quick-player is the hero interaction.** It should pull the eye first after
   identity, and the audible-slot switch should feel instant and physical.
2. **Numbers are sacred** — every score, LUFS, dBTP, BPM in `.mono`. Producers trust
   tabular, measured values.
3. **Two actions per row, max.** The whole redesign exists to kill today's "seven buttons
   crammed in a row." Inline = Play + Report; the `⋯` menu absorbs the rest.
4. **Calm, not loud.** This is mission control, not a marketing page. Generous spacing,
   restrained accent use (cyan for "live/active", violet for premium/Listen, green for
   good grades, red only for danger/failure).
5. **Progress should feel rewarding** — the timeline's upward arc is a small dopamine hit;
   make it legible and a touch celebratory without being gaudy.

## 6. Deliverables wanted from you

- A high-fidelity layout of the **full screen** (desktop) in the SPECTR dark theme using
  the real components.
- The **quick-player A/B** treatment, including the audible-vs-dimmed slot states.
- A **version row** in all four states (analyzed / analyzing / failed / unscored) and its
  open `⋯` menu.
- The **mobile/narrow** reflow.
- Empty + loading states.

Stay within the component + token vocabulary above; if you need a primitive that doesn't
exist, note it rather than introducing a foreign style (no Tailwind, no shadcn).
