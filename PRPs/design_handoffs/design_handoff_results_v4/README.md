# Handoff: Analysis Results page (v4) — delta over v3

> **Rev 4.** Findings/Actions split into two purpose-built tabs, a priority model, Stems + Notes/Feedback tabs, and the DAW Plan grew into an **Improvement Plan** tab (Listen in Studio + Create DAW Plan). Read `design_handoff_results_v3/README.md` first for the base page; this doc covers **what changed since v3**. Everything there still holds unless contradicted here.

## Purpose
Feature comparison reference, not an implementation spec. Compare against `features/results/` in `frontend-spectr-v2` and identify gaps on each side. Do not port the HTML/JSX directly.

**Scaffold (ignore):** SPECTR top bar, toast host, Tweaks panel — prototype chrome only.

## Tab bar (changed)
Left: **Track Analysis** · **Project** (present but *disabled* with a tooltip when no .als) · **Stems** (present but *disabled* when no stems) · **Reference** (only when applicable) · **Notes / Feedback** (badge = comment count) · **Debug**.
Right-aligned, visually "hot" (stand-out styling + tooltips): **Findings** (badge = fault count, alert tint) · **Actions** (badge = actionable count) · **Improvement Plan** (badge = plan-log count).
→ Codebase: `results-tabs-model.ts` / `ResultsTabs.tsx`. Disabled-with-tooltip tabs are new; today's code hides absent tabs entirely.

## Priority model (new, cross-cutting)
Each finding may carry `pr: { score, base, catW, scopeM }` — raw scale ~20–300 (`score = base × categoryWeight × scopeMultiplier`). Surfaces as:
- meta chips in the finding detail (breakdown on hover),
- a **priority slider** in the Findings filter (hides low-priority findings),
- orange **P-chips** in the DAW Plan; "by move" view sorts highest-first.
Also new per finding: `conf` (0–1), `tier` (`audio_only | stems | project_midi`), `where` (location string), `suspected` flag, `ev2` evidence rows (`metric · yours · expected · delta`), and `spec` (producing specialist / subsystem).
→ Codebase: extend the finding model (`problems-helpers.ts` / `severity.ts`); nothing equivalent exists yet.

## Findings tab (diagnosis-first; was "Coach" position)
Master-detail board (`FixBoard mode="findings"`, `ar-actions.jsx`):
- **Wider list**, grouped by severity. Per-row icon set: **ignore** (also ignores the associated action), **ask-the-coach** (coach icon), and a checkbox whose tooltip is "A suggested fix is available". **Every finding is checkable, even without a fix** — no-fix ones surface on Actions as *notes*.
- **Filters** (dropdown, checkbox sections + priority slider): Fixable only · **group** (Loudness, Spectrum, Stereo, Stems, Sections…) · **device/scope** (Master, Pad bus, Bass stem…) · min-priority slider. The menu is fixed-positioned and viewport-capped (never clipped by short windows).
- **Detail panel:** severity + color-coded group chip (`AR_GROUP_COLOR`) + right-aligned **Source tag** — "Source: Measured" (measurement icon) or "Source: AI · <specialist>" (robot icon), tooltip explains provenance. "Why it matters" is richer copy and always relevant (`arDefaultWhy` fallback). **"The data"** (ev2 rows) renders auto-expanded with a plain-language explanation of what it shows. Glossary tooltips (`Glossify` + `AR_GLOSSARY`) on jargon: True-Peak, Measured, LUFS, etc.
- Footer, divided from content: green **"Applicable Fix Available"** text, **"Ask the Coach about this"** (static coach icon), and a green **"Show Suggested Fix →"** button (hover tooltip = the fix title) that deep-links to the Actions tab.

## Actions tab (fix-first; new)
Same board in `mode="actions"`, but the **list is fix titles**, not findings. Detail per fix:
- Chip row: severity · group · **"Addresses Finding: <headline>"** (clickable, jumps back to Findings) · source tag.
- "Suggested fix" line with **confidence %** on its own row.
- **Sub-tab control:** **Applicable Fix** (device rack via shared `RackModule` renderer, add-to-rack toggle) | **Quick DAW Instructions** — a dark card holding **"In your Project"** steps (device names highlighted in violet) plus **"What to listen for"** when auditioning the change (`move.ableton`, `move.listen`).
- **Expected outcome** sits at the bottom, above the action row.
- Action row: **Mark applied** → becomes a **✓ View** button; **Rate this Suggestion** (thumbs up / down) opens a feedback modal — 1–10 rating + notes, the finding and fix ride along with the submission.
- Checked findings **without** a fix appear as notes: ask-the-coach link + a general do-it-in-your-DAW tip.
- **Actions bar** (top): **Try Fixes** (toggle each queued fix live while listening) · **Create Preset** (combine queued fixes into a rack preset) · **Coach Mix** (coach picks from the queue and compiles a preset) — each with a tooltip, and every action **logs to the DAW Plan** (`planLog`).
→ Codebase: `MoveCard.tsx` / `move-model.ts` / `FixRackPanel.tsx` are the closest pieces; the findings/actions split, sub-tabs, rating loop, and plan log don't exist.

## Stems tab (new)
Disabled without stems. Findings-style sidebar: select a stem → detail (role, level/width/spectral stats, play button); detected issues link to the matching finding on the Findings tab. Includes an **EQ-overlap collision visualization** (kick × bass etc., overlap dB).
→ Codebase: no stems tab exists; data would come from stem analysis phases (`phase5.per_stem_reference_deltas`, `phase4.clashes`).

## Notes / Feedback tab (new)
Three parts: the user's own **notes** on this version; **listener comments** (name, timestamp-in-track, text); **emoji reactions** — totals plus a **feedback timeline**: a 0:00→end strip with a smoothed reaction-density curve, each emoji plotted at its track position, comment markers on a lane below (hover = who/when/what). Data shape: `feedback.comments[{name, at, text}]`, `emojiEvents[{e, at}]`, `track.durationSec`. Collected when the version is shared for listening; stored against the version to reinforce analysis later.
→ Codebase: nothing equivalent; nearest neighbors are feed/mentions features.

## Improvement Plan tab (replaces "Create DAW Plan"; id `dawplan`)
Two sections:
1. **Listen in Studio** — two checkable columns: **Active fixes** (queued fixes pre-checked, priority + scope chips) and **Presets** (user presets + Coach Mix when generated). Green **Listen in Studio** button (pick count; disabled at 0) opens the Listen Rack page with the picks available and pre-selected. *Prototype caveat: the link doesn't yet carry the picks — define a query-param or store contract when implementing.*
2. **Create DAW Plan** (`DawPlanBody`, embedded) — status/takeaway counts (specialists run/suggested, findings, fixes selected/suggested); **By move** view sorted by priority with P-chips; **Per device** view — Master section first, then each named device with the exact actions to take, each row scoped "**Master**" or "**Device: <name>**" and annotated with its originating fix + priority; **timestamped moments** (section-anchored findings with track times); **genre targets** object under Streaming Targets; non-fixable selections as a small footnote of manual notes; export config includes an **actions-per-device** section toggle.
   Product decision recorded: **device-specific presets are NOT applied to the Listen rack** (Listen is master-chain only); device-scoped moves go to the DAW plan instead.
→ Codebase: `TriagePlanPanel` / `PlanCard` / `SendToListenCard` are partial ancestors.

## Assets
`prototype/ar-assets/coach.svg` — static coach icon extracted for reuse anywhere the animated coach doesn't fit (buttons, links). Animated version stays where it already lives (coach chat header).
→ Codebase: `ui/Coach.tsx` is the animated one; add a static export.

## Files
- `prototype/Results Page.html` — entry point
- `prototype/ar-app.jsx` — shell, tab model (disabled tabs, right-side hot tabs), state, preset/plan log
- `prototype/ar-actions.jsx` — Findings + Actions board (both modes), source tags, glossary, feedback modal, filter dropdown
- `prototype/ar-dawplan.jsx` — actions bar + DAW plan (`DawPlanTab` wrapper / `DawPlanBody` embeddable)
- `prototype/ar-improve.jsx` — Improvement Plan tab (Listen in Studio + embedded plan)
- `prototype/ar-stems.jsx` — Stems tab
- `prototype/ar-notes.jsx` — Notes / Listener Feedback tab + feedback timeline
- `prototype/ar-frame.jsx`, `ar-coach.jsx`, `ar-trackinfo.jsx`, `ar-analysis.jsx`, `ar-reference.jsx`, `ar-project.jsx`, `ar-findings.jsx`, `ar-debug.jsx`, `ar-ui.jsx`, `ar-data.jsx` — carried from v3 (data file now includes `pr`/`conf`/`tier`/`ev2`, `emojiEvents`, stems detail)
- `prototype/ar.css`, `prototype/ar-tabs.css` — styles
