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
  --muted --dim`; radii `--radius*`, spacing `--space-1…6`.
- Components in play: **CoverArt**, **Pill**, **Dot**, **ProgressTimeline**, **Label**,
  **BrandMark** (already in the app chrome).
- **Do NOT use `GradePill` or any letter grade (A–F).** SPECTR does not use letter grades.
  The only AI number is the **mix score, 0–100**, shown as a `mono` value / `Pill`.

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
│  ▒▒▒▒▒▒▒  87/100  (mix score — no letter grade)              │
│           #latenight  #wip                                    │
├ QUICK-PLAYER  (A / B audition) ───────────────────────────┤
│  A  [v4 final master ▾]   ▶ ──●──────────────  Open in Listen↗│
│  B  [v3 louder bass  ▾]   ▶ ──────●──────────  Open in Listen↗│
├ PROGRESS TIMELINE  (AI score + your score) ───────────────┤
│  ai   62 ─── 71 ───── 80 ──── 87                            │
│  you  60 ······ 78 ········· 90   (overlaid, one 0–100 axis)│
├ VERSIONS ─────────────────────────────────────────────────┤
│  A  v4  final master  87/100  you 90  current ✓ ◷plan [▶][Report↗]⋯│
│  B  v3  louder bass   80/100  you 78          ✓        [▶][Report↗]⋯│
│  C  v2  rough cut     71/100  you —           ⟳        [▶]         ⋯│
│  D  v1  demo            —      you 60          ⚠        [▶][Retry]  ⋯│
├ COMPARE  (any two versions + your verdict) ───────────────┤
│  pick A ▾  vs  pick B ▾    [v1→current] [Last two]          │
│  AI deltas:  score +7 · LUFS −0.4 · width +6% · air +2dB …  │
│  ✎ your notes: "fuller low end, vox still harsh"            │
│  your score for v4:  [ 90 ]/100                             │
└────────────────────────────────────────────────────────────┘
```

On narrow/mobile: the header stacks (cover on top), the two quick-player slots stack,
version rows reflow to two lines (label + both scores on line 1, status + actions on
line 2), the compare verdict (notes + score) stacks under the deltas.

---

## 3. Sections

### 3.1 Identity header
**Purpose:** instantly say *which song, how good, how shared.*

- **Cover:** `CoverArt` (square, sized as a hero thumbnail ~140–180px). It renders the
  song's visual template.
- **Title block:** song name as the page `<h1>`. Below it an overline row of `Pill`s:
  genre (`.cyan`), current **mix score** (`<span class="mono">87</span>/100` — **no
  letter grade**), and a **visibility chip** — `◐ private` / `🔗 link` / `● public`. Then
  a tag row (small pills; public tags carry a tiny `pub` marker).
- **Actions (top-right):** `Edit` (`.btn .ghost .sm`), `★ Publish` (`.btn .violet .sm`,
  appears **disabled** until the song has at least one analyzed version), `+ Add version`
  (`.btn .primary`). A `⋯` overflow holds **Archive** (destructive-ish, de-emphasized).
- **States:** if no version is analyzed yet, the score pill is absent and Publish is
  disabled.

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

### 3.3 Progress timeline — two overlaid series
**Purpose:** the satisfying "I'm getting better" arc — *and* a way to see whether the
producer's own taste agrees with the AI.

- Use the **`ProgressTimeline`** component, showing **two overlaid series on one 0–100
  axis**: the **AI mix score** (brand `--cyan`, primary) and the producer's **personal
  score** (a second, quieter color — e.g. `--violet` or `--muted` dashed). A small legend
  (`ai` / `you`) distinguishes them.
- Hovering a point reveals version label + AI score + personal score + date. **No letter
  grades.** Where a version has no personal score yet, that series simply skips the point.
- Clicking a point loads that version into player slot A and highlights its row.
- **Empty/sparse:** with <2 scored versions, render a calm placeholder line + "Scores
  appear here as you analyze versions" rather than a broken chart.

### 3.4 Versions list — the spine
**Purpose:** the canonical list of every bounce, scannable, with **exactly two inline
actions** and everything else tucked away.

- **Row anatomy (left→right):** an A/B/C/D slot letter (ties the row to the quick-player
  /compare), a muted `v#` chip, the version **label** (fallback "Version N"), the **AI mix
  score** (`mono`, cyan, e.g. `87/100`, or `—` unscored), the **personal score** (`mono`,
  muted, e.g. `you 90`, or `you —` when unset — **no letter grades**), the **date**
  (muted), a `current` chip on the active version, a small **game-plan marker** when a
  plan is attached (e.g. a `◷ plan` `Pill` / `Dot` — see §3.7), and a **status
  indicator**:
  - `✓` analyzed — calm/green
  - `⟳` analyzing — animated, with optional progress
  - `⚠` failed — `--red`
- **Inline actions (only two):** `▶` (load into the quick-player) and `Report ↗` (only
  when analyzed). On a **failed** row, replace Report with an inline `Retry`.
- **Everything else → a `⋯` context menu** (Radix dropdown): **Make current · Edit label ·
  View game plan** *(only when one is attached)* **· Reanalyze · Reanalyze with reference ·
  Open in Listen · Open in Room** *(show but disabled — "coming soon")* **· Delete** (danger
  styling, separated at the bottom).
- Rows are sorted newest-first. The **current** version reads as subtly elevated
  (`--card-hover` or a left accent border in `--cyan`).
- **Inline label editing:** picking "Edit label" turns the label into a compact inline
  input + save/cancel (no modal).

### 3.5 Compare — any two versions + your personal verdict
**Purpose:** quantify what changed between two versions AND let the producer record their
own judgment, since the AI number doesn't capture artistic intent.

- A `.card` titled "Spot what changed". Two **version pickers** ("pick A ▾ vs pick B ▾")
  let the producer compare **any two versions**, plus quick-pick shortcuts **v1 → current**
  and **Last two**.
- **AI deltas** (read-only): the metric changes from A→B — mix score, loudness (LUFS),
  dynamics, bass energy, air, stereo width — shown as signed `mono` values with up/down
  tone (green = improved, muted/red = regressed). This is the existing comparison data.
- **Your verdict (NEW — the important part):**
  - **Delta notes:** a free-text field ("✎ your notes") where the producer types what
    changed in their own words — "fuller low end, vox still harsh". Persisted per *pair*;
    it reappears when that same A/B pair is compared again. Design it as an always-present,
    low-friction inline field (not buried behind a button).
  - **Personal score (0–100):** an inline editor (`mono` number input or slider) for the
    producer's own score of the **newer** version. This is the SAME score shown on its row
    and the timeline — the compare view is just the handiest place to set it. Show it
    right next to the AI delta so "AI says +7 · I say 90" reads at a glance.
  - Both optional; when unset, show muted prompts ("add your notes", "rate this version").
- Disable the pickers/shortcuts when there are <2 versions.

### 3.6 Game plan (per-version, opened from Results work)
**Purpose:** if the producer saved an actionable **game plan** for a version on the
Results page, let them pull it back up from here.

- A game plan is an optional, version-scoped change-set (the "what I'll fix next" list).
  **This page never creates or edits one** — it only **surfaces and opens** existing plans.
- **Marker:** a version with a saved plan shows a small `◷ plan` `Pill`/`Dot` on its row.
- **Open:** `View game plan` (in the row `⋯` menu, present only when a plan exists) opens a
  **read-only modal** listing the plan's items/moves, with routes onward — "Apply in
  Listen" (the Plan tab) and "Back to Report". Design this modal in the dark-theme card
  style; it's a calm checklist, not an editor.
- If a version has no plan, there's no marker and no menu item (absent, not disabled).

### 3.8 (Folded into the header) Activity / visibility
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
2. **Numbers are sacred** — every score (AI *and* personal), LUFS, dBTP, BPM in `.mono`.
   Producers trust tabular, measured values. **No letter grades anywhere** — the AI number
   is 0–100, and the producer's personal score sits beside it as their own 0–100.
3. **Two actions per row, max.** The whole redesign exists to kill today's "seven buttons
   crammed in a row." Inline = Play + Report; the `⋯` menu absorbs the rest.
4. **Calm, not loud.** This is mission control, not a marketing page. Generous spacing,
   restrained accent use (cyan for "live/active" + the AI score, violet for premium/Listen
   + the personal score, green for improvement deltas, red only for danger/failure).
5. **Progress should feel rewarding** — the timeline's upward arc is a small dopamine hit;
   the AI-vs-you overlay adds a "does my taste agree?" beat. Legible, a touch celebratory,
   never gaudy.

## 6. Deliverables wanted from you

- A high-fidelity layout of the **full screen** (desktop) in the SPECTR dark theme using
  the real components.
- The **quick-player A/B** treatment, including the audible-vs-dimmed slot states.
- A **version row** in all four states (analyzed / analyzing / failed / unscored), showing
  both the AI mix score and the personal score and a game-plan marker, plus its open `⋯`
  menu (with the conditional "View game plan" item).
- The **Compare card** with AI deltas alongside the **personal verdict** (delta notes +
  inline personal-score editor).
- The **progress timeline** with the AI + personal score overlay (two series + legend).
- The **game-plan view modal** (read-only checklist of plan items + onward routes).
- The **mobile/narrow** reflow.
- Empty + loading states.

Stay within the component + token vocabulary above; if you need a primitive that doesn't
exist, note it rather than introducing a foreign style (no Tailwind, no shadcn).
