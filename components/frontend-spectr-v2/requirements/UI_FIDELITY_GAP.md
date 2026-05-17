# UI Fidelity Gap — Mockup vs Current

This audit compares the SPECTR frontend's current state (slices 1 + 2 + 2.5 + the recent polish pass) against the reference mockups in `requirements/claude-design-ui-files/`. The wiring, routing, auth, and data layer are all correct; the gap is almost entirely visual. The current build looks like a "minimal admin panel" using the right palette, while the mockup is a producer-facing **musical product** with dense, atmospheric, multi-column layouts, animated pipeline dots, pulsing AI accents, persistent mini-player, and an information hierarchy organised around a "Verdict Hero" + tabbed sub-views. Severity scale is documented at the bottom.

---

## Design tokens

Comparing `requirements/claude-design-ui-files/styles.css` against `src/styles/tokens.css` + `src/styles/global.css`.

| Token / concern | Mockup value | Current value | Gap notes | Severity |
|---|---|---|---|---|
| Color palette | All `--bg`, `--bg-2`, `--surface`, `--card`, `--card-2`, `--card-hover`, `--border`, `--border-2`, cyan/violet/orange/red/green/yellow/blue, text/text-2/muted/dim | Same names + same hex values | **Matches.** ✓ | — |
| `--radius` / `--radius-sm` / `--radius-lg` | 12 / 8 / 16 | 12 / 8 / 16 | **Matches.** ✓ | — |
| Spacing scale | mockup uses raw pixel values inline (8/10/14/16/18/20/22/24) | `--space-1..6` = 4/8/12/16/20/24 | Current uses tokens (good), but the **18/22 step is missing** — mockup uses 18 and 22 frequently for card padding and hero gaps. Add `--space-4-5: 18px` or simply use `calc()` / inline where needed. | [medium] |
| Font stack | `'Syne', sans-serif` (no system fallback in mockup) | `'Syne', system-ui, sans-serif` | **Matches** functionally — system-ui fallback is an improvement. But **Syne font is never @import-ed anywhere** in current build. The mockup's `index.html` loads it via Google Fonts; we need to add the same `<link>` or self-host. Without it, the entire UI renders in system sans which is the single biggest "looks wrong" signal. | [blocker] |
| Mono font | `'JetBrains Mono', monospace` with `font-feature-settings: "tnum" on` | Same — applied via `.mono` class | **Matches** but again **JetBrains Mono is not loaded** anywhere. | [blocker] |
| Font feature settings | `"ss01" on, "ss02" on` (Syne stylistic alternates) | Same | **Matches** ✓ (but moot if Syne isn't loaded) | — |
| Body background | Two radial gradients (cyan top, violet bottom-right) + 48px grid overlay | Identical, in global.css | **Matches** ✓ | — |
| `--cyan-dim` usage | `rgba(0,229,176,0.10)` — used for hover/glow accents | Same | **Matches** ✓ | — |
| `--cyan-glow` | `rgba(0,229,176,0.25)` | Same | **Matches** ✓ | — |
| Severity colors | Inline: critical=red, warning=orange, info=cyan, fixed=green; impact: high=orange, med=yellow, low=muted | `--sev-*` tokens present | **Matches** semantically. Worth aliasing the verdict-card colors (`critical`/`warning`/`info`/`fixed`) explicitly. | [low] |
| Animations | `@keyframes fadeUp / fadeIn / fillW / fillH / pulse / pulseGlow` + utility classes `.fade-up`, `.fill-w` etc. | None of these exist in current global.css or tokens.css | **Missing.** Mockup uses `.fill-h` for bar growth, `.fade-up` for cards, `pulseGlow` for AI Coach status dot. Need to port these keyframes + utility classes into global.css. | [high] |
| Utility primitives | `.card`, `.card-hd`, `.card-body`, `.label`, `.pill`, `.dot`, `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.sm` — all defined in styles.css and used everywhere in mockup as `className="card"` | None of these exist; current uses CSS Modules everywhere with per-component class names | **Architectural gap.** Mockup is built on a handful of global utility classes. Current is pure CSS Modules. Both can coexist — recommend porting the eight utility classes (`.card`, `.card-hd`, `.card-body`, `.label`, `.pill`, `.pill.cyan/violet/orange/red/green/yellow`, `.dot`, `.btn` variants) into global.css so any component can opt in. | [high] |
| Custom scrollbar | 6px width, semi-opaque thumb | Present in global.css | **Matches** ✓ | — |
| Brand logo mark | `.brand .mark` — 22px square cyan-outlined box with inner glow + SVG inside | Not present in app shell | **Missing.** Current renders text "SPECTR" only; mockup pairs wordmark with a glowing mark icon. | [high] |
| Tweaks panel CSS vars | `--twk-bg`, `--twk-border` | Not present | Tweaks panel deferred per page-audit; **skip** (out of scope). | — |

**Net token verdict:** colors and radii are bit-for-bit. The **load-bearing gaps are:** fonts not loaded, animation keyframes not ported, and the seven utility classes (`.card`, `.pill`, `.btn` etc.) not extracted to global.css. Without those three, the whole UI reads as "tokens defined but design system missing."

---

## App shell (`_app.tsx` + topnav + mini-player)

### Mockup
Source: `requirements/claude-design-ui-files/app.jsx:180-237` and `uploads/draw-0c414a00-…png` / `uploads/draw-a211fdf8-…png`.

- 56px sticky topnav with `backdrop-filter: blur(14px)` and translucent bg `rgba(7,10,18,0.88)`
- Left: brand block = **glowing cyan-outlined square mark** + "SPECTR" wordmark + tiny mono caption "AI MUSIC ANALYSIS" stacked below it (two-line brand)
- Center-left: pill-style tab group with `Report / Listen / Library / Discover` — segmented control look, active tab gets `--card-hover` background and an inset 1px border
- Right cluster: 240px search input (mono font, ⌘K kbd hint inside), bell icon button, **`+ Upload` primary cyan button**, then circular gradient avatar (cyan→violet) with initial "M"
- **Persistent MiniPlayer fixed to bottom of viewport** (`position: fixed; bottom: 0`): play button (round cyan), cover art thumb, track title + BPM/key/genre mono line, **120-bar tiny waveform** showing playback progress, "0:48 / 4:28" timecode, "EQ" button, "Open ↗" primary button
- Background grid + radial-gradient ambience is visible through both bars

### Current
Source: `src/routes/_app.tsx`, `src/routes/_app/_appLayout.module.css`.

- Sticky topnav at top, `backdrop-filter: blur(8px)`, `rgba(7,10,18,0.85)` bg — close to mockup but not identical
- Left: text-only "SPECTR" wordmark + two links `Library` and `Profile` rendered as underlined hover-cyan links (not pill tabs)
- Right: user's email in mono + a "Sign out" button using the standard `f.button` style
- **No search input, no notification bell, no `+ Upload` CTA, no avatar.**
- **No MiniPlayer at all.**
- No brand mark icon.

### Gap items
- **[blocker]** Replace the right-side cluster (`email + Sign out`) with the mockup's full nav-right cluster: search input → notification bell → primary "+ Upload" button → avatar. Sign-out moves into an avatar dropdown menu (or `/profile` page) — it should not be a top-bar button. Source: `app.jsx:203-234`.
- **[blocker]** Add the brand mark icon next to "SPECTR" — 22px cyan-outlined rounded square with a glowing inner stroke and a small SVG mark inside. Stack a tiny mono caption "AI MUSIC ANALYSIS" under the wordmark. Source: `app.jsx:183-194`.
- **[high]** Convert the `Library`/`Profile` text links into a pill-style segmented control matching `.nav-tabs` (`app.jsx:196-201`). Tabs should be: `Report` (currently routes to active job results), `Listen`, `Library`, `Discover`. `Profile` does **not** belong in the tab row — it's behind the avatar.
- **[high]** Implement a MiniPlayer component fixed to bottom of viewport inside `_app.tsx`, below `<Outlet/>`. Hide on `/_public/*` routes. Initial scope: play/pause button, cover thumbnail, track title + meta line, 120-bar waveform, timecode, EQ + Open buttons. Audio playback itself is deferred to the Listen slice — the visual shell should ship now with stub data and disabled controls. Source: `app.jsx:240-288`.
- **[medium]** Topnav backdrop-filter blur should be 14px (mockup) vs. current 8px — increases the depth feel.
- **[medium]** Active-tab underline (current uses a 2px cyan underline `::after`) should be replaced by the mockup's segmented-control style (no underline; instead, `background: var(--card-hover); box-shadow: inset 0 0 0 1px var(--border)`).
- **[low]** Topnav height should be exactly 56px (mockup) — current uses padding without an explicit height.

---

## Login + Register pages

### Mockup
The mockup files do **not** ship a dedicated login/register design. Inference from the rest of the mockup's tokens:
- Card surface: `var(--panel-bg)`, `1px solid var(--panel-border)`, `var(--radius-lg)` (16px)
- Centered narrow column (max ~380px)
- Large "SPECTR" brand wordmark above the card with a soft cyan glow shadow
- Form fields use `.input`-equivalent: 10–12px vertical padding, 1px border, focus border in cyan
- Primary submit button: full-width `.btn.primary` (cyan with deep cyan glow shadow)
- Mono footer link in `var(--muted)` with the "Create one" target in cyan

### Current
Source: `src/routes/_public/login.tsx`, `register.tsx`, `_publicLayout.module.css`, `auth.module.css`.

- Centered column, 380px max-width, gap-5 between brand and card — already close to spec
- "SPECTR" wordmark with cyan glow text-shadow (matches the mockup's brand vibe)
- Card with `panel-bg` and `panel-border` — already correct
- Form labels + inputs come from `forms.module.css` — clean, but lack the mono kbd-hint accents and the focus state could be more pronounced
- Submit button full-width and primary — matches

### Gap items
- **[medium]** Brand wordmark above the card should be paired with the brand mark icon (same one as the topnav) — currently is text-only with cyan glow. Source: `app.jsx:183-194`.
- **[medium]** The form's `.input` focus state should add a subtle cyan glow shadow (`box-shadow: 0 0 0 3px var(--cyan-dim)`) in addition to the border color change — adds polish without being noisy. Mockup styles.css has no input definition but other primitives use this shadow pattern.
- **[low]** Footer "No account? Create one" — increase font-size to 13px (currently 12px) and add a small `→` arrow chevron after "Create one" for visual affordance. (Not in mockup — but consistent with mockup's link patterns elsewhere.)
- **[low]** Add a mono "ACCESS" or "WELCOME BACK" overline above the page title in `var(--muted)` letter-spaced 0.16em — matches the mockup's pervasive "label" pattern used on every other surface.

---

## Library page

### Mockup
Source: `requirements/claude-design-ui-files/library.jsx:14-289`.

- Page header: large bold title "Your library" (24px, 800 weight, -0.01em tracking) + mono subtitle line `{n} songs · {n} versions · last edit today`
- **Filter pill row** next to the title: `[all] [A grade] [B grade] [Needs work] [In progress] [Archived]` — active pill gets `var(--cyan-dim)` background and cyan text
- Right side of header: sort dropdown (mono `<select>`), `[grid|list]` view toggle, and primary `+ New song` button
- **Grid view (default):** `repeat(auto-fill, minmax(300px, 1fr))` card grid with 16px gap
- **Library card** (`library.jsx:85-165`): vertically stacked
  - Top: aspect-ratio 2.1 cover-art block with a colored gradient ("hue" field drives the color), overlaid with a `GradePill` top-left, version-count pill top-right, a 24-bar mini-waveform bottom-left, and a circular cyan play button bottom-right
  - Middle: track name + tiny mono `v{N}` badge on right + meta line `{genre} · {bpm} BPM · {key}`
  - **VersionArc:** mini sparkline SVG showing the iteration history v1 → v_latest with grade-colored dots on the path + delta callout (e.g., `↑ +20 pts`). Bottom row shows `[A] [B+] [A-]` grade chips per version.
  - Footer: edit-date + play count + `v{N-1}↔v{N}` mono comparison badge
- **List view:** 5-column grid row: cover thumb / title+versions / genre+BPM+key / VersionStrip (grade chips) / GradePill

### Current
Source: `src/routes/_app/library.tsx`, `library.module.css`.

- Single-column list of rows in a `<ul>`
- Each row: bold song name (links to `/songs/$id`) + mono meta line `{N} versions · grade X · genre` + a "Upload version" primary button on the right
- Header: title "Library" + subtitle "Your tracks and their analyses" + two right-aligned buttons: `New song`, `Upload track`
- No filter pills, no sort, no view toggle, no grid view at all
- No cover art, no version sparkline, no per-version grade chips, no genre/BPM/key meta

### Gap items
- **[blocker]** Build the grid card view as the **default** (`library.jsx:67-78`). Use `repeat(auto-fill, minmax(300px, 1fr))`, gap 16px. Each card stacks cover / title / VersionArc / footer.
- **[blocker]** Implement the cover-art block: 2.1 aspect ratio, gradient driven by a `hue` value derived from the song name or a stored `cover_hue` column (deferred backend field — for now hash `song.id` to a hue 0..359). Overlay GradePill top-left, version count top-right, mini-waveform bottom-left, play CTA bottom-right.
- **[blocker]** Implement `VersionArc` (`library.jsx:169-240`): SVG sparkline of version scores with grade-colored dots, delta callout, and a per-version grade-chip strip below.
- **[high]** Add the filter pill row: `[all] [A grade] [B grade] [Needs work] [In progress] [Archived]` (`library.jsx:29-36`). Active state uses `var(--cyan-dim)`. Filter logic is client-side over the songs list — no API changes.
- **[high]** Add the right-side header cluster: sort `<select>` + grid/list view toggle + primary `+ New song` button (`library.jsx:37-63`). Drop the duplicate "Upload track" button (Upload now lives in the topnav as `+ Upload`).
- **[medium]** Empty state: replace the dashed-border placeholder with a cover-art-shaped empty card that pulses gently. Use the same grid layout so the empty state previews what a card will look like once they upload.
- **[medium]** List view alternate layout (`library.jsx:74-77`, `LibraryRow:242-272`): 5-column grid row with cover thumb 48px + title block + genre/BPM/key + VersionStrip + GradePill. Defer the toggle UI to phase 2 if needed — the grid view is the priority.
- **[low]** Header title font-size should be 24px, not 32px (current). Subtitle should be mono. Source: `library.jsx:22-26`.

---

## Song detail page

### Mockup
Source: `requirements/claude-design-ui-files/library.jsx:293-680`.

- Back link: `← Library` small ghost button
- **Hero block:** large square cover art (`size="lg"`) + flex column with mono overline "SONG · N VERSIONS" + 36px-bold song name + pill row (genre / BPM / key / play count / score delta) + right-side action cluster (`↺ Re-analyze v3`, `★ Publish to Discover` in violet, `+ Add version` primary)
- **ProgressTimeline card** (`library.jsx:347-445`): full-width version sparkline — 200px tall, 1300px wide internal viewBox, with horizontal grade-band guides (A/A-/B/C/D dashed lines), filled area under the line, per-version dots with score label above, version label below, date below that, and current/selected/compare ring overlays
- **Two-column layout below the timeline:**
  - Left: VersionListCard — collapsible per-version rows, each with GradePill + version number + label + CURRENT pill + score + delta-from-previous + date + `⇄ Compare` / `Open` buttons
  - Right (380px sticky): DeltaCard — when no compare selected, shows a "Compare two versions" CTA panel with quick-suggestion buttons; when active, shows a side-by-side `v{a} → v{b}` diff with 6 metrics (mix score, LUFS, dyn range, bass, air, width) and a colored verdict block

### Current
Source: `src/routes/_app/songs.$songId.tsx`, `songDetail.module.css`.

- Back link: `← Library` (matches)
- Header: title (32px) + "Upload new version" primary button on right
- Meta line: `{N} versions · {genre}`
- Versions list: simple 4-column table-like grid (Version / Label / Created / Results) with rows per version. Latest version has a "View results" link.

### Gap items
- **[blocker]** Replace the simple table with the full mockup hero + timeline + two-column structure.
- **[blocker]** Implement the ProgressTimeline component (`library.jsx:347-445`) — version sparkline with grade bands, dots, and labels. Even a static SVG with no shift-click compare interaction is a big visual win.
- **[high]** Hero block: add cover art square (lg size), the "SONG · N VERSIONS" mono overline, larger song name (36px not 32px), and the action cluster (`↺ Re-analyze`, `Publish`, `+ Add version`). Publish button uses violet color scheme.
- **[high]** Pill row of metadata under the song name: genre / BPM / key / play count / score-delta-across-versions. All come from the song's latest analysis result.
- **[high]** VersionListCard (`library.jsx:449-530`): each version row needs a GradePill on the left, label-or-(unlabeled) italic placeholder, CURRENT pill if applicable, score + score-delta-from-previous in mono, and Compare / Open buttons. Currently rows are a 4-column grid with no grade info.
- **[medium]** DeltaCard placeholder on the right (`library.jsx:534-596`): a 380px sticky card with a "Compare two versions" CTA, quick-suggestion buttons ("First → current", "Last two"). Even without the compare-mode logic wired up, the empty-state version is a big visual upgrade. Compare mode itself can ship later.
- **[medium]** Cover art needs the same hue-driven gradient component as the Library page. Build once, reuse here.
- **[low]** Page max-width currently 1080px → mockup uses 1360px. Same on Library page.

---

## Results page

Source mockups: `requirements/claude-design-ui-files/results.jsx` (1474 lines) + `coach.jsx` (1354 lines, defines `AICoachTab` which `results.jsx:18` references). Visual reference: `uploads/draw-0c414a00-…png` (full Coach tab view) and `uploads/pasted-1778996751269-0.png` (CoachHero zoom).

The Results page is the biggest gap and the highest-impact area. Currently it's a vertical stack of seven sub-components (GradeHero → MetadataBar → StreamingReadiness → 2-col Frequency+Stereo → CoachPanel → VerdictsPanel → PhaseTimeline). Mockup is a **header + 5-tab interface** with totally different content per tab. We need a structural redesign.

### Hero card

#### Mockup
Source: `results.jsx:63-106` (`VerdictHero`).

- Single full-width `.card` with `display: grid; gridTemplateColumns: 340px 1fr`
- **Left column (340px):** vertical-flex with `GradePill` (lg size, ~80px) on the left, then a column with mono overline "VERDICT" + large colored verdict text ("Almost there" / "Release-ready" / "Major issues" etc.) + score + percentile mono line. Background: `radial-gradient(ellipse 90% 80% at 10% 50%, ${gradeColor}10, transparent 65%)`
- **Right column:** track name (18px, 700, -0.01em) + pill row (genre cyan / BPM mono / key / format) + a 4-column metric grid: Loudness, True Peak, Dyn Range, Dance — each metric is label/value/unit/sub stacked (`HeroMetric`, `results.jsx:280-290`).

#### Current
Source: `src/features/results/GradeHero.tsx`, `ReportView.tsx`.

- Standalone `.hero` panel — vertical-flex centered, just a huge grade letter (112px), score below, "DANCE" chip
- Then a separate `MetadataBar` panel below (6 cells: BPM / Key / Genre / LUFS / True Peak / Mono Compat)
- Title + back-link live in a different section above the hero

#### Gap items
- **[blocker]** Merge GradeHero + MetadataBar + title into the single `VerdictHero` card structure: 340px left column (grade + verdict text + score+pct) and 1fr right column (track name + pill row + 4-metric grid). Source: `results.jsx:63-106`.
- **[blocker]** Add the **verdict text** — "Almost there" / "Release-ready" / "Major issues" / "Start over" — driven by the grade letter (A→Release-ready, B→Almost there, C→Work needed, D→Major issues, F→Start over). The grade letter alone communicates nothing without the verdict label. Source: `results.jsx:64`.
- **[high]** Score + percentile line under the verdict text: `{score}/100 · {percentile}th pct in {genre}` in mono. Source: `results.jsx:81-83`.
- **[high]** Right-column metric grid: 4 cells (Loudness, True Peak, Dyn Range, Dance) — each cell is the `HeroMetric` pattern: tiny mono uppercase label / large colored mono value / unit / tone-colored subtitle line ("2.8 LU over Spotify", "safe (-1 ceiling)", etc.). Source: `results.jsx:280-290`.
- **[high]** Replace the standalone giant 112px grade letter with a `GradePill` component (mockup uses `size="lg"` here — around 80px square with rounded background tinted by grade color). The 112px text-only letter currently overwhelms everything else on the page.
- **[medium]** The radial-gradient backdrop on the left column (`background: radial-gradient(ellipse 90% 80% at 10% 50%, ${gradeColor}10, ...)`) gives the grade context — without it the card reads as flat.
- **[medium]** Pill row: genre needs the `.pill cyan` style; BPM / key / format are neutral pills with mono text inside.

### Tabs row

#### Mockup
Source: `results.jsx:294-353` (`ResultsTabs`).

- Below the hero, a horizontal tab strip with bottom border separator
- Five tabs: `AI Coach` (with pulsing cyan dot prefix + count badge), `Analysis` (badge `{done}/{total}`), `Spectrum`, `Reference` (badge with out-of-range count), `Arrangement` (badge `!`)
- Active tab: white text + 2px cyan bottom border that overlaps the strip's bottom border (`marginBottom: -1`)
- Inactive tabs: `var(--muted)` text + transparent bottom border
- Right side: `⇣ Export PDF` ghost button and `↺ Re-analyze` primary cyan button
- Badge styling: tiny mono pill with severity-tinted background, only visible when value > 0

#### Current
- **Tabs do not exist.** All content is rendered in a single vertical stack.

#### Gap items
- **[blocker]** Build the tab strip with all 5 tabs. AI Coach is the default. Each tab swaps the body content. Source: `results.jsx:294-353`.
- **[blocker]** Wire each tab to its content: AI Coach → CoachChat + filter pills + featured verdict cards + AllSpecialistsRoster (from `coach.jsx`); Analysis → pipeline timeline + unlock zones + side rail; Spectrum → big frequency chart + stem clashes table; Reference → genre profile gap rows; Arrangement → sections bar + issue list.
- **[high]** AI Coach tab is the **featured** state — pulsing cyan dot left of its label, indicating it's the default attention surface.
- **[high]** Per-tab count badges with severity tinting (cyan for AI Coach count, violet for Analysis progress, orange for Reference out-of-range, orange `!` for Arrangement). All badges follow the same mono pill pattern.
- **[medium]** Right-aligned `Export PDF` + `Re-analyze` action buttons. Export PDF can be a stub button for now.
- **[low]** Tab transition: text color change is 150ms cubic ease; no need to animate the bottom border.

### AI Coach chat block

#### Mockup
Source: `coach.jsx:213-426` (`CoachChat`).

- Featured card at the top of the AI Coach tab, with a soft `linear-gradient(135deg, var(--card) 0%, var(--card) 55%, rgba(167,139,250,0.05) 90%, rgba(0,229,176,0.05) 100%)` background and **two glow accents** (cyan top-left, violet bottom-right) positioned absolute
- **TranceBot avatar** (72px when collapsed, 56px when expanded) — a custom-drawn SVG of a futuristic helmet with an animated EQ-bar visor that pulses faster when "thinking". This is a signature visual element. Source: `coach.jsx:19-148`.
- Mono "ASK THE COACH" overline + pulsing dot + "online · trained on your analysis"
- Big title: "Ask anything about this mix" (20px, 700) when collapsed; "Coach" (16px) when expanded
- Subtitle paragraph naming the track and listing capabilities; ends with "what can I ask?" link that toggles a capabilities panel showing "Strong here" vs "Falls flat here" example questions in two columns
- 6 suggestion chips (small mono pills) for one-click prompts: "Why am I getting a B+ instead of an A?", "Will this pass Spotify normalization?", etc. Source: `coach.jsx:183-192`.
- Prominent input bar with `Ask →` primary button on the right
- Scope disclaimer at the bottom in tiny dim mono text
- Expands inline to a full chat panel (up to 520px scrollable) with user/assistant bubbles styled differently (user: violet-tinted bubble, right-aligned; assistant: cyan-tinted bubble with TranceBot avatar, left-aligned)

#### Current
Source: `src/features/results/CoachPanel.tsx`, `CoachPanel.module.css`.

- A simple `.panel` card with "AI Coach" overline + coach name + intro paragraph + ordered list of fixes (numbered with cyan circles 1, 2, 3…)
- No avatar, no suggestion chips, no input bar, no chat capability — it's purely a static text panel rendering `coached_fixes` from the analysis pipeline
- The fixes list is what the mockup calls "FeaturedVerdictCard" findings (the headline cards below), not the chat block

#### Gap items
- **[blocker]** This is the single highest-impact addition. The current "CoachPanel" is fundamentally a different feature from the mockup's "CoachChat." Build a `CoachChat.tsx` component that renders the full chat block: gradient background, TranceBot avatar (defer detailed SVG — start with a placeholder colored shape with EQ bars), title, subtitle, suggestion chips, input bar with `Ask →` button, scope disclaimer. Source: `coach.jsx:213-426`.
- **[blocker]** Implement the TranceBot SVG component (`coach.jsx:19-148`). It's a static SVG with an animated EQ-bar visor. Even a simplified version (just the EQ visor without all the armor details) sells the "signature AI character" feel.
- **[high]** Suggestion chips array hardcoded for now (`COACH_SUGGESTIONS` in `coach.jsx:183-192`). Wire actual click → send to the chat input later — first ship the visual.
- **[high]** Chat send/receive wiring: defer the actual LLM call (Anthropic API integration is a separate slice). For now the input + button should be present and visually polished; on submit show a stub "Coach API not wired yet" toast.
- **[medium]** Capabilities expand panel (`coach.jsx:512-565`) — "what can I ask?" toggle shows the two-column "Strong here" vs "Falls flat here" lists. Polish detail.
- **[medium]** Expanded-state chat UI (when the user sends a message) — message bubbles, scrollable container, "New chat" / minimize controls. Can ship as part of the chat-wiring slice; the collapsed state is what matters first.
- **[medium]** **The existing `CoachPanel` (coached_fixes list) does not have a home in the mockup's new structure.** The coached_fixes from the pipeline should be rendered as part of the FeaturedVerdictCard list **OR** dropped entirely and replaced by the verdict-pipeline output. Recommend: keep coached_fixes for backward compat but render them inline only when no verdicts have been generated yet, as a fallback.

### Filter pills (severity / category filters + "Show fixed" toggle)

#### Mockup
Source: `coach.jsx:711-767` (`CoachFilters` + `CategoryChip`).

- Horizontal flex row below the CoachChat, gap 6px, wraps on narrow viewports
- Pills: `[All 6] [LOUDNESS 1] [LOW END 1] [FREQUENCY 1] [ARRANGEMENT 2] [STEREO 1]` — built dynamically from the unique specialist categories in the verdict list
- Each pill: 7-12px padding, 7px radius, colored dot prefix in the persona color, label + count
- Active pill: background `${color}12`, border `${color}50`, white text, dot glows
- Right-aligned: "✓ N fixed" mono indicator (only when count > 0) + a "Show fixed" checkbox label with cyan accent-color

#### Current
- **No filter pills exist.** The `VerdictsPanel` shows all verdicts in a flat stack with no grouping or filtering UI. Severity is communicated via a left-edge color strip on each card.

#### Gap items
- **[blocker]** Build the filter pill row component. Categories come from the unique set of `verdict.specialist`-to-`SPECIALIST_PERSONAS.label` mappings (we have `SPECIALIST_GROUPS` already in `src/features/results/helpers/specialists.ts`). Active state filters the visible verdicts. Source: `coach.jsx:711-751`.
- **[high]** "Show fixed" checkbox on the right — toggles whether verdicts the user has marked Applied/Dismissed remain visible (currently they just dim with `data-dismissed`). Default off (hidden).
- **[high]** "✓ N fixed" status indicator — count of verdicts in `applied` state. Wire from `userState.applied` on verdicts.
- **[medium]** Persona colors per specialist — we need a small lookup table mapping each `specialist` slug to a color (the mockup's `SPECTR_PERSONAS` object). For now map by `SpecialistGroup` (Loudness=orange, Frequency=cyan, Low end=violet, Arrangement=violet, Stereo=blue, Dynamics=yellow, Reference=violet) — refine later.

### Verdict cards (FeaturedVerdictCard)

#### Mockup
Source: `coach.jsx:771-869` (`FeaturedVerdictCard`).

- Full-width card per verdict — these are visually **dominant**, not compact
- Top-left atmospheric `01` numeral rendered absolute, 88px JetBrains Mono in the severity color at 6% opacity — gives each card a "track number" feel
- Header row: PersonaChip (colored MiniBot avatar + uppercase mono label like "LOUDNESS"), "FINDING #01" mono label, SevPill (CRITICAL/WARNING/INFO/FIXED), ImpactTag (`↑↑ HIGH IMPACT`), ConfidenceMeter (mini bar + percentage, right-aligned)
- Big title (22px, 700, -0.01em tracking): "Master is 2.8 LU too loud for streaming targets"
- Body paragraph (14px, line-height 1.6, text-2)
- Metric line: mono pill in severity color: `-11.2 LUFS INTEGRATED · -14 SPOTIFY TARGET · 5.4 LU DYN RANGE`
- **Inline chart** (load-bearing — verdicts are paired with a contextual visualization): bar chart variant for loudness, EQ-curve variant for frequency, sidechain envelope, arrangement strip, etc. Source: `coach.jsx:933-950` (`InlineChart`).
- **FixRecipe** panel with "THE FIX" cyan diamond label, recipe title, "preset · Spotify-safe master" badge top-right, and a numbered list of steps (Plugin / Automation / Target with their parameter values formatted as `X dB → Y dB`)
- Actions footer: primary "✦ Apply preset" button, "✓ Mark fixed", "Snooze" ghost, then right-aligned "helpful?" + 👍/👎/Why-this buttons
- Severity-tinted left border (3px solid)
- Background gradient: `linear-gradient(180deg, ${sevColor}06 0%, var(--card) 70%)`

#### Current
Source: `src/features/results/VerdictCard.tsx`, `VerdictCard.module.css`.

- Card with a 4px severity strip on the **left edge** (matches mockup conceptually)
- Header: severity label (mono, uppercase) + specialist name + priority score
- Headline (17px, 700) + summary + body + metricLine in mono cyan + "Why this matters" label+text
- Fix section: "FIX" label + ordered list of DSP ops formatted as `eq_band freq=200, gain=-2, q=1.2`
- Outcome paragraph (italic)
- Action buttons row: "Mark applied" / "Dismiss" + feedback group (👍 Helpful / 👎 Wrong / ❓ Unclear)

#### Gap items
- **[blocker]** Add the **atmospheric rank numeral** — 88px JetBrains Mono in severity color at 6% opacity, absolute-positioned top-right. Pure visual flourish but instantly gives each card the "track listing" feel. Source: `coach.jsx:793-803`.
- **[high]** Header row needs the **PersonaChip** (avatar + colored label) — currently we just render the specialist slug as text. Build a small `PersonaChip` component with `MiniBot` SVG inside a colored bordered pill. Source: `coach.jsx:873-895`.
- **[high]** **ImpactTag** in the header: `↑↑ HIGH IMPACT` / `↑ MED IMPACT` / `· LOW IMPACT` in colored mono. Derive from `verdict.priorityScore` thresholds. Source: `coach.jsx:908-916`.
- **[high]** **ConfidenceMeter** in the header (right-aligned): `confidence` label + 36×4px progress bar + percentage. The Pydantic model already has a `confidence` field. Source: `coach.jsx:918-929`.
- **[high]** Inline chart slot — placeholder for now; defer the actual chart components (LUFSInline, FrequencyInline, EQCurveInline, etc.) to a follow-up slice. Wire by `verdict.chartType` once that's added to the model. For now show a neutral inline chart placeholder strip.
- **[medium]** Bigger headline font (22px not 17px) and tighter tracking (-0.01em).
- **[medium]** FixRecipe re-skin: cyan diamond `◆` label "THE FIX" + recipe title + preset badge (top-right) + numbered steps with type/automation/target rows formatted as `X → Y` deltas. Current renders as a flat ordered list of DSP ops; mockup's is more visually structured. Source: `coach.jsx:842` (`FixRecipe` is in `coach.jsx` after the visible range).
- **[medium]** Primary "Apply preset" button (cyan, with `◆` glyph) takes precedence over "Mark fixed" — currently they're peers. Source: `coach.jsx:849`.
- **[low]** Severity colors: mockup uses `critical`/`warning`/`info`/`fixed` directly, current uses `--sev-critical/severe/moderate/minor/win`. Align names: `warning` ↔ `severe`, `info` ↔ `minor`, `fixed` ↔ `win`.

### Specialist grid (AllSpecialistsRoster)

#### Mockup
Source: `coach.jsx:569-617` (within `AICoachTab`) and `results.jsx:1348-1424` (`AITab` variant with `SpecialistTileFull`). Visual reference: `uploads/draw-848986ba-…png` (full grid view).

- Collapsible card at the bottom of the AI Coach tab titled "All 25 specialists · 7 RUN · 1 RUNNING"
- Grouped by category: "LOW END", "FREQUENCY", "DYNAMICS", "STEREO & WIDTH", "LOUDNESS", "ARRANGEMENT", "REFERENCE", "PRODUCTION DETAIL", "BIG PICTURE"
- Each category label in mono uppercase letter-spaced 0.16em
- Tile grid: `repeat(auto-fill, minmax(220px, 1fr))` with 8px gap
- **SpecialistTile:** 
  - 28px circular avatar (colored MiniBot SVG) on the left
  - Specialist name (12px, 600) on the right
  - Status state at the bottom: "no issues" (cyan), "running…" (violet with EQ dots), "{N} findings" (orange), or a "Run" button (idle), or `↺` re-run button (cached)
  - Findings count pill in the top-right when > 0
  - Disabled tiles (e.g., "Stem Stereo Width — Upload stems to enable") render at 50% opacity with italic muted hint
- Border colors: cached=cyan, running=violet, idle=neutral, disabled=transparent

#### Current
Source: `src/features/results/SpecialistTile.tsx`, `SpecialistTile.module.css`.

- A grid of buttons grouped by `SpecialistGroup` (uppercase group labels are present)
- Each tile: label, group, status (IDLE/RUNNING/DONE/FAILED), running spinner dot in top-right
- No avatar, no findings count, no per-tile run/rerun controls, no disabled state with "NEEDS STEMS" hint visible (actually current does show "NEEDS STEMS" — partial credit)
- Border-colored variants for status are present (cached=green, failed=red, running=cyan)

#### Gap items
- **[high]** Add the **MiniBot avatar** to each tile — 28px circular colored container with a small bot SVG inside. The bot color matches the specialist's persona color. Even a simple icon (an EQ-bars glyph) works for v1. Source: `coach.jsx:154-176` (`MiniBot`).
- **[high]** Status display inside tile: replace the "IDLE / RUNNING / DONE / FAILED" status text with the mockup's contextual messages: "no issues" (when cached + 0 findings), "{N} findings" (when cached + N>0 findings), "running…" with EQ-dots animation (when running), explicit "Run" button (when idle), disabled-reason italic text. Source: `results.jsx:1411-1421`.
- **[high]** Findings count pill in top-right corner (cyan `.pill` style) when findings > 0. Currently we show severity strip on the verdict cards but no count badge on the tile.
- **[medium]** Group section headers ("LOW END", "FREQUENCY", etc.) need the mono letter-spaced 0.16em uppercase styling. Currently they're 10px regular weight. Source: `coach.jsx:580` (rendering within the collapsible card).
- **[medium]** Wrap the entire roster in a collapsible card with the header "All N specialists · X RUN · Y RUNNING" and a `+/-` collapse button. Default state: expanded. Source: `results.jsx:1351-1369`.
- **[medium]** Minimum tile width: mockup uses 220px (`minmax(220px,1fr)`), current uses 150px. Increase so the avatar + label + status fit comfortably without truncation.
- **[low]** Re-run button `↺` on cached tiles (alignSelf flex-end, ghost style). Source: `results.jsx:1416`.

### Analysis tab

#### Mockup
Source: `results.jsx:746-1083`.

- Two-column layout: `minmax(0,1fr) 360px`
- **Left column:**
  - `AnalysisSummary` card: large `PipelineDial` (76px circular progress ring) + "{done} of {total} phases complete" + "Upload N more files to unlock +K specialists" subtitle + three SummaryStat boxes (Done/Running/Missing)
  - `AnalysisPhaseList` card: vertical timeline of phases with status icons (✓ cyan / partial-dot orange / running-EQ-dots violet / dashed-circle missing) and per-phase detail line, duration, unlock badge, and CTA button
  - `UnlockBlock` card: featured upload zones (Drop stems / Drop reference / Drop .als) with dashed colored borders, benefit chips, and 200MB hint
- **Right column (360px):** sidebar with three stacked cards
  - "Current uploads" — list of uploaded files (primary audio parsed, stems/reference/als missing)
  - "Re-analyze on changes" — explainer text + button
  - "Analysis history" — chronological log

#### Current
Source: `src/features/results/PhaseTimeline.tsx`.

- Single panel "Pipeline" with a vertical list of phase rows
- Each row: phase number badge + name + status text (OK/SKIPPED/FAILED) + optional error message
- No two-column layout, no summary dial, no unlock zones, no side rail

#### Gap items
- **[high]** Implement the two-column layout for the Analysis tab.
- **[high]** Build `AnalysisSummary` card (`results.jsx:765-826`): PipelineDial circular progress, headline "X of Y phases complete", missing-files subtitle, three SummaryStat boxes.
- **[high]** Re-skin `PhaseTimeline` rows to use the mockup's pattern (`results.jsx:846-906`): left-edge vertical accent border colored by status, status icon overlapping the border (22px circle), phase label + duration + unlock badge + RUNNING pill, detail line in mono, progress bar for partial, right-aligned action button. Source: `results.jsx:846-906`.
- **[high]** `UnlockBlock` (`results.jsx:952-1040`): featured upload zones grid `repeat(auto-fit, minmax(240px,1fr))`. Each zone is a labeled dashed-border drop area with benefit chips. Three zones: stems / reference / .als. Wire to existing upload endpoint or stub for now.
- **[medium]** Side rail (`results.jsx:1044-1083`): three vertical cards. "Current uploads" is the most useful; others can stub.
- **[medium]** Status icons: `done=cyan ✓ circle with glow`, `partial=orange dot in dashed orange circle`, `running=violet EQ-dots in pulsing circle`, `missing=dashed-only circle`. Currently we use simple text colors. Source: `results.jsx:908-948`.

### Spectrum tab

#### Mockup
Source: `results.jsx:1127-1201`.

- `BigSpectrumBars`: vertical column for each of 8 bands (SUB/BASS/L.MID/MID/H.MID/PRES/BRIL/AIR) with value % at top, 110px tall bar, frequency Hz label at bottom
- Each bar: filled vertical gradient (cyan if normal, orange if warn) + an overlay showing genre median in semi-transparent white
- Warning bands get an orange `▲` triangle above
- Card title: "Frequency balance · clarity X/100" with a "{label}" violet pill on the right
- Below: "Stem clashes" card listing pairs like `KICK × BASS` with overlap range, percentage, suggested fix, and severity pill

#### Current
Source: `src/features/results/FrequencyBars.tsx`.

- Horizontal Recharts `BarChart` with 7 bands on the Y-axis, dB scale on X-axis (−60 to 0 dB)
- Bars colored cyan if above −45 dB threshold, violet (yes, violet, not orange) if below — flagging spectral *gaps* not *warnings*
- Tooltip on hover
- No genre-median overlay, no warning markers, no Hz labels, no stem-clash list

#### Gap items
- **[high]** Re-orient the spectrum chart from horizontal bars to vertical bars matching the mockup. Each band gets its own vertical column. The horizontal bar chart from Recharts is functional but visually wrong for this UI language. Recommend rebuilding as CSS-only flex columns (no Recharts) so we can lay band-name + Hz + value above/below the bar without fighting the library. Source: `results.jsx:1167-1201`.
- **[high]** Add the **genre median overlay** — semi-transparent white block behind each band showing the genre's median energy. Even with placeholder data (median = current * 0.85) it adds the comparative context the chart is missing.
- **[medium]** Show value % above each bar (mono, colored by warn state).
- **[medium]** Add Hz labels under each band name (mockup: `60Hz`, `200Hz`, `500Hz`, etc.).
- **[medium]** Color logic: change `low energy → violet` to `warn → orange` and use a `.warn` flag per band rather than just a dB threshold. Bands that exceed the genre median ceiling get the warn flag.
- **[medium]** Stem clashes card below the spectrum (`results.jsx:1136-1162`): a list of `kick × bass` style row pairs with overlap range, fix suggestion, severity pill. Stub data is fine for now; this surfaces stems-derived analysis when present.
- **[low]** Replace Recharts entirely for this chart — it's load-bearing for the spectrum tab but the CSS-only version is simpler and more flexible.

### Reference tab

#### Mockup
Source: `results.jsx:1205-1292`.

- Single full-width card titled "Genre profile · {genre}" with the profile source string in mono on the right
- Inset highlight box showing big `ScoreRing` (80px) + percentile + "top X% · N of M metrics out of range"
- Legend strip: `acceptable range (P10–P90)` cyan-bordered band / `genre mean` white tick / `your track` cyan dot
- `GapRow` per metric: name + severity pill + percentile + a horizontal range bar showing the acceptable band, mean tick, and the user's value as a glowing dot, with mono labels below

#### Current
- **Not implemented.** Reference data isn't currently surfaced anywhere.

#### Gap items
- **[high]** Build the Reference tab from scratch. Header card with percentile ring + summary. List of GapRow components for each gap metric. Source: `results.jsx:1205-1292`.
- **[medium]** Until backend exposes genre-profile gap data, stub with three placeholder rows (LUFS gap, Sub energy gap, Stereo width gap) so the visual ships even before data is wired.
- **[low]** Legend component (`results.jsx:1230-1247`).

### Arrangement tab

#### Mockup
Source: `results.jsx:1296-1344`.

- Single card titled "Arrangement" with `Score X/100` mono indicator on the right
- 70px-tall section bar showing the arrangement segments (intro/buildup/drop/breakdown/outro) as colored proportional segments with section labels + bar counts inline
- Sections with issues get a flag dot + orange border
- Below: list of arrangement issues in orange-tinted callout rows with `▲` glyphs

#### Current
- **Not implemented.**

#### Gap items
- **[high]** Build the Arrangement tab. Section bar + issue list. Source: `results.jsx:1296-1344`.
- **[medium]** Stub data: 5 sections (intro 16 bars, buildup 32, drop 32, breakdown 16, outro 16) with one flagged section. Arrangement score: 72. Issues: "Drop ends abruptly at bar 96", "Breakdown lacks a buildup tail". This data will flow from `phase3` or similar later.

---

## Dialogs (NewSong, UploadVersion)

### Mockup
The mockups don't ship dedicated `NewSong` or `UploadVersion` dialogs (the mockup demonstrates a "Publish to Discover" modal but not these two). Inferred shape from existing patterns:
- Centered Radix Dialog with backdrop blur 4px + dark overlay
- `var(--panel-bg)` content with 1px `--panel-border` and `--radius` rounded corners
- Title (18px, 800), description (12px, muted)
- Form inputs styled with `.input` class
- Footer actions right-aligned, cancel ghost + primary submit

### Current
Source: `src/components/NewSongDialog.tsx`, `UploadVersionDialog.tsx`, `forms.module.css`.

- Both dialogs follow the inferred pattern reasonably well
- Inputs use `f.input`, primary buttons use `f.buttonPrimary`
- UploadVersionDialog has a native file input (ugly default browser styling) and a `<progress>` bar during upload

### Gap items
- **[medium]** The native file input in `UploadVersionDialog` is visually broken — it shows the default OS file picker control which is incongruous with the rest of the UI. Replace with a styled drop-zone or a custom button that opens the file picker.
- **[medium]** Add a small mono "WAV · FLAC · MP3 · up to 250 MB" hint below the file input, consistent with the mockup's `UnlockZone` info text style.
- **[low]** Dialog titles should match the mockup's pill-like overline pattern: small mono "NEW SONG" overline above the bigger title text.
- **[low]** During upload, show a percentage in the progress bar's accompanying mono text (already exists in the button label — "Uploading… 47%" — but the `<progress>` bar itself is bare).

---

## Placeholders (Profile, Listen, Discover, Coach, Compare)

These pages aren't shipped past placeholder state. This audit identifies what the final visual shape should look like per the mockups but does not deep-audit gaps.

- **Profile (`src/routes/_app/profile.tsx` → mockup `profile.jsx`):** Final shape is a hero card (gradient banner + avatar + name + handle + plan pill + 5-stat row + usage progress bar) + tabs row (Overview / Library / References / Bookmarks / Activity / Settings) + tab content panel. Visual reference: `uploads/draw-a211fdf8-…png` (Settings tab). **Deferred to a Profile slice.**
- **Listen (`src/routes/_app/listen.$versionId.tsx` → mockup `listen.jsx`):** Big animated visualizer hero + ToolsRail + 2-column activity column. **Deferred to the Listen DSP slice** per CLAUDE.md.
- **Discover (no route exists yet → mockup `discover.jsx`):** Hero with featured 3 fresh tracks + sticky filter bar (search/genre/license/BPM range/sort + mood chips) + track grid `repeat(auto-fill, minmax(280px, 1fr))`. **Deferred to a Discover slice.**
- **Compare (no route exists yet → mockup `compare.jsx`):** Side-by-side track-vs-reference diff view. **Deferred.**
- **Coach standalone page:** Mockup folds Coach into the Results tab; there's no standalone Coach page in the mockup. ✓ Architecturally aligned with current state.

The visual gap for these placeholders is "we ship nothing, mockup ships a full page." Once the design phasing reaches them, treat them as new builds — not redesigns of existing screens.

---

## Severity scale

- **[blocker]** — looks visibly wrong / unprofessional. Must fix before next slice.
- **[high]** — significant structural difference from mockup. Should fix in next slice.
- **[medium]** — visible difference but not structurally broken. Fold in opportunistically.
- **[low]** — minor visual nicety (animation, hover state, micro-spacing). Defer to a polish slice.

Approximate counts (top items only, not every micro-gap): **8 blockers**, **24 highs**, **22 mediums**, **9 lows** — call it **~63 gap items** across all sections.

---

## Top 10 priorities

Ordered list of the 10 most impactful gap items across all pages, blocker → high → medium.

1. **[blocker] Load the Syne + JetBrains Mono webfonts.** Without these, the whole UI renders in system sans and looks generic — this is the single biggest "looks wrong" signal across every page. (Design tokens section)
2. **[blocker] Topnav redesign — full mockup chrome.** Replace the current `Library / Profile / email / Sign out` strip with the mockup's brand-mark + segmented tab control + search + bell + `+ Upload` + avatar cluster. Bottom-of-viewport MiniPlayer ships in the same slice. (App shell section)
3. **[blocker] Library grid view with cover cards + VersionArc.** The current single-column list with no covers and no per-version grade visualisation undersells the iteration story that the mockup makes central. (Library section)
4. **[blocker] Results page tabs + Verdict Hero restructure.** Merge GradeHero + MetadataBar into the mockup's 340/1fr-grid VerdictHero with verdict text, percentile, and 4-metric grid. Add 5-tab strip below. Pick AI Coach as default. (Results section / Hero card + Tabs row)
5. **[blocker] AI Coach chat block (CoachChat + TranceBot avatar).** The signature feature of the Results page — gradient card with TranceBot SVG, suggestion chips, and prominent input bar. Replaces the current static `CoachPanel`. (Results section / AI Coach chat block)
6. **[blocker] Verdict filter pills + "Show fixed" toggle.** The mockup shows a category filter row above the verdict cards. Without it, the verdict list reads as a flat dump with no triage affordance. (Results section / Filter pills)
7. **[blocker] FeaturedVerdictCard restructure.** Atmospheric rank numeral, PersonaChip header, ImpactTag + ConfidenceMeter, larger headline, inline-chart slot, restyled FixRecipe panel. Current VerdictCard has the data but lacks visual hierarchy. (Results section / Verdict cards)
8. **[high] Port animation keyframes + utility classes (.card, .pill, .btn, .label, .dot) into global.css.** The mockup is built on these primitives — without them, every component re-implements its own card/pill/button styling and the visual cohesion is impossible. (Design tokens section)
9. **[high] Song detail page hero + ProgressTimeline.** The mockup's iteration-arc story is what makes the product feel "this is for producers who iterate." Current is a stripped-down versions table. (Song detail section)
10. **[high] SpecialistTile MiniBot avatars + contextual status text.** Tiles currently look like generic admin buttons; the mockup gives each one a colored bot avatar and human-readable status ("no issues", "{N} findings", "running…"). (Results section / Specialist grid)

---

## Recommended phasing

Suggested grouping of related gaps into tractable evening-sized phases.

### Phase A — Foundation (≈2 evenings)
Goal: get the design system primitives in place so subsequent work is fast.

- **A1** Load Syne + JetBrains Mono via `<link>` in `index.html` (or self-host in `public/fonts/`).
- **A2** Port the keyframe animations (`fadeUp`, `fadeIn`, `fillW`, `fillH`, `pulse`, `pulseGlow`) and utility classes (`.card`, `.card-hd`, `.card-body`, `.label`, `.pill` + variants, `.dot`, `.btn` + variants) into `src/styles/global.css`.
- **A3** Build a `GradePill` component (sm/lg) and a `Pill` component with color variants — these get reused everywhere.
- **A4** Build the brand-mark SVG component.

Validation: take a screenshot of any existing page → fonts and a few `.pill` placeholders look like the mockup.

### Phase B — App shell + Library cards (≈3 evenings)
Goal: the chrome and the first content page look like a producer product.

- **B1** Redesign topnav: brand mark + wordmark + segmented nav-tabs + search input + bell + `+ Upload` + avatar. Move Sign-out to an avatar dropdown.
- **B2** Add the persistent MiniPlayer at the bottom of the `_app` layout. Visual only (stub data, disabled controls). Hide on `_public/*`.
- **B3** Build the cover-art `CoverArt` component (hue-driven gradient + waveform overlay + GradePill).
- **B4** Build the `VersionArc` SVG sparkline component.
- **B5** Rebuild Library page as the grid card view with filter pills, sort dropdown, and view toggle. List view can be deferred or stubbed.

Validation: Library looks like the mockup screenshot top half (`uploads/draw-0c414a00-…png` chrome area).

### Phase C — Results page restructure (≈3 evenings)
Goal: the most-viewed page in the product feels like the mockup.

- **C1** Build the `VerdictHero` card (340/1fr grid, verdict text, score+pct, 4-metric grid).
- **C2** Build the `ResultsTabs` strip with all 5 tabs. Wire each to a tab-content component (most can be stubs initially).
- **C3** Build the `CoachChat` component on the AI Coach tab: gradient background, TranceBot SVG (simplified version is fine), suggestion chips, input bar, scope disclaimer. Defer chat-send wiring.
- **C4** Build the `CoachFilters` pill row + "Show fixed" toggle.
- **C5** Restyle `VerdictCard` → `FeaturedVerdictCard` with atmospheric numeral, PersonaChip, ImpactTag, ConfidenceMeter, bigger headline, restructured FixRecipe.
- **C6** Restyle SpecialistTile with MiniBot avatar + contextual status text. Wrap roster in collapsible card.

Validation: matches `uploads/draw-0c414a00-…png` and `uploads/draw-848986ba-…png`.

### Phase D — Remaining Results tabs + Song detail polish (≈2 evenings)
Goal: every tab on the Results page renders the mockup's design, and Song Detail tells the iteration story.

- **D1** Build Analysis tab — two-column layout with AnalysisSummary + PhaseList + UnlockBlock + side rail.
- **D2** Rebuild Spectrum tab — vertical CSS-only bars with genre-median overlay + Hz labels + stem clashes section.
- **D3** Build Reference tab — percentile ring + GapRow list (stub data ok).
- **D4** Build Arrangement tab — section bar + issue list (stub data ok).
- **D5** Song Detail: hero with cover art + ProgressTimeline component + restyled VersionListCard with grade pills + DeltaCard placeholder.

Validation: every Results tab and Song Detail render their mockup equivalents. Placeholder pages (Profile/Listen/Discover/Compare) remain untouched — they pick up in their own dedicated slices later.
