# Handoff: Listen Rack (results-density redesign)

## Overview
Redesign of SPECTR's **Listen page rack** — the live insert-chain editor you use while a track plays. It replaces the old viz-dominant layout with the Analysis-Results design language at much higher density: slim header, calibrated spectrum stage, a card grid that IS the insert chain (drag to reorder), a hardware-style device editor for the selected module, a Visuals light-show control panel, a Coach tab, and a session sidebar (Notes/Chat/Room). Plus a page-wide "light show" atmosphere layer.

## About the Design Files
Files in this bundle are **design references created in HTML** (React 18 + Babel, no build step) — prototypes showing intended look and behavior, **not production code to copy directly**. The task is to recreate these designs in `frontend-spectr-v2`'s existing React + TypeScript environment using its established patterns (routes, feature folders, CSS modules, existing DnD/session utils). `redesign/data.jsx` is a verbatim port of `features/listen/rackManifest.ts` + `audio/state.ts` shapes — use the real modules in the codebase, not the copy.

## Fidelity
**High-fidelity.** Colors, type, spacing, and interactions are final intent. Recreate pixel-perfectly with the codebase's tokens where they already exist (ar.css mirrors them).

## Scaffold vs deliverable
Do **not** port: `TopBar`, `ToastHost` positioning demo, the Tweaks panel (`lr-tweaks-panel.jsx`, `LRTweaks`). Everything inside `.wrap` is the deliverable.

## Screens / Views

### 1. Header row (`lr-app.jsx` → `Header`)
- 38px cover art (9px radius) · track title 15.5px/600 · one mono stat line 10px (`JetBrains Mono`): LIVE dot + LISTENING/PAUSED, BPM, key, duration, format, live LUFS/dBTP, grade, modules-on count. Lower-priority stats hide at <1320px (`.lo`) and <1080px (`.md`).
- Right: `Invite` (ghost btn) + `View report` (primary btn). Both currently dead.

### 2. Stage card (`lr-stage.jsx`)
- Canvas spectrum, height 210px (tweakable 120–400). Backdrop: navy gradient `#070b16→#081521` + 3 drifting aurora radial blobs (hues 168/265/195, screen blend, beat-reactive alpha ~.07–.09).
- Calibration grid: dB rows 0/−12/−24/−36 (labels left gutter x<26, rgba(178,192,210,.65) 8.5px mono), log-spaced Hz columns 60→10k labeled along bottom. Bars render between x=26 and W−8, above y=H−20; labels paint after bars.
- Overlay chips (top): Section (violet), LUFS-S, True peak, Corr, GR (orange `warn` state past thresholds), chain count. `rgba(4,6,12,.66)` bg, blur(8px), 1px border.
- Transport row: play/pause, mono time `m:ss / m:ss`, 128-bar waveform scrub (30px, accent fill to playhead), note pins (7px squares, violet, accent when pinned, click = seek), BPM · key readout.

### 3. Rack tab (`lr-rack.jsx`, `lr-devices.jsx`)
- **Toolbar**: `N/13 modules on` (mono), divider, Presets select, Save (ghost), right group: BYPASS label + switch (orange when on). Sticky under topbar (top:96px) via tweak.
- **Module grid = the chain.** `repeat(auto-fill,minmax(146px,1fr))`, 7px gap (dense density locked). Card: `#182031` bg, 9px radius, 1px `--border`; contains chain index (mono 8.5px, accent when on), glyph badge (25px, module accent bg at 13%, border 30%, text-shadow glow), name 12px/600, live param summary (mono 9px, `neutral` in dim slate when at defaults), GR microbar for metered modules, on/off switch.
  - States: `.on` accent border/bg tint; `.sel` 1.5px accent ring; hover lighten; drag source at 40% opacity; drop target dashed accent border.
  - **Drag reorder**: HTML5 DnD; drop on a card inserts before it; drop on grid whitespace sends to end. `rack.order` is the single authoritative order everywhere.
  - **Pitch card**: dashed violet border, index `LN`, subtitle "buffer lane · not an insert", never draggable, not in `order`.
- **Device bay** (selected module only, below grid): rack-hardware panel — grey gradient `#1c2231→#121722`, side-rail texture (pseudo elements), header with glyph, name, `#NN in chain · sub`, optional `wk` worklet chip (violet), bind string (violet dashed chip, tweak-gated), reset, on/off, close. Body: 44px rotary knobs (SVG, 270° sweep, accent arc + glow, drag-vertical, step-quantized), vertical faders for EQ 8-band (±24 dB, double-click to zero, per-band enable switch), segmented/select/toggle params from manifest `control:` kinds, wide sliders for mix-type params, segmented LED GR meter (orange→red gradient).
- Whole-chain bypass dims all cards + stage tint goes slate.

### 4. Visuals tab (`lr-visuals.jsx`)
Masonry control panel (`columns:4 236px`, 8px gaps). Each panel: 9px radius, grey gradient, faint scanline overlay (repeating-linear-gradient, overlay blend), header strip with breathing LED (5px, glow), mono uppercase 8.5px title, accent-tinted header gradient (teal or violet).
Panels: **Primary actions** (Sync-all glowing button; 3-swatch theme + Sync), **Stage select** (glyph tiles, multi-select, ≥1 enforced), **Auto program** (8 director tiles + active blurb; selecting non-Manual dims Auto-react with orange warning), **Auto-react** (master toggle + sensitivity slider), **Laser rig** (SYNC tag + 2 switches, effect/pattern selects [sweep/strobe/flash/beat · fan/parallel/scan/random], intensity %, beams 1–12, sweep speed 0.25–4×, Roam/Flashes/Mono toggles, mono hue bar 0–360), **Primary color** (SYNC gate → 10 swatches + hue bar), **Background** (SYNC + CYCLE gates, swatches, hue, flash toggle + 1–12 Hz + 5 flash colors), **FX · Moments** (fireworks-on-drops toggle). Disabled controls at 35–45% opacity, pointer-events off.

### 5. Coach tab (`lr-panels.jsx`)
Intro line, then 50/50 grid (stacks <1000px): left **Coach moves** (persona label colored, title, move summary [hidden <1240px], Apply → Applied button), right **Fixes from analysis** (tag chip in item color at 12% bg, title + fix line, + → ✓, done rows at 50%). Both call `applyFix(payload)` which patches module state directly, then toast.

### 6. Sidebar (`lr-panels.jsx` → `SessionCard`)
286px sticky column. One card, three underline tabs with counts: **Notes** (timestamp mono accent + text rows, click = seek, active ring, pinned dot), **Chat** (avatar circles oklch hue, @handle mono 8.5px, 11.5px text, input + send), **Room** (listener chips w/ avatar + status emoji, reaction rows: sign glyph + emoji buttons, selecting sets your status). 

### 7. Atmosphere (`lr-stage.jsx` → `LightShow`)
Fixed full-viewport canvas at z-0 (`.wrap` z-1): 4 laser beams (hues 168/275/330/200, oscillating sweeps, 128 BPM beat pulse), scrolling perspective floor grid, 70 drifting dust motes, slow hue-cycling haze. Dims to 35% when paused. Glass mode: panels at ~52–68% opacity + `backdrop-filter:blur(7–9px)`.

## Interactions & Behavior
- Card click = select (toggles); selection opens/closes device bay. Switches stopPropagation.
- Drag: `dragstart` sets source, `dragenter` marks target, `drop` reorders (insert-before semantics; container drop = append). Keyboard a11y not implemented — use the app's DnD util.
- Knob/fader: pointer-drag vertical, `range` px = full sweep, step-quantized; EQ band double-click zeroes gain.
- Toast (2.6s) on any coach/fix apply.
- Playhead: rAF loop, wraps/pauses at duration; scrub + note-click seek.
- All transitions 120–180ms; LED breathe 1.6–1.8s ease-in-out.

## State Management
- `rack`: `{ mod: {id → params}, order: string[], bypass }` + reducers `patch/toggle/reset/move/reorder/setBand/applyFix` — shapes mirror `audio/state.ts`; bind strings per module name the real setters (e.g. `setEffectParams('eq', { enabled, bands })`, `enterPitchMode()`).
- `sel` (selected module id), `tab`, `playing/position`, `stages[]`, `director`, `vz` (visuals panel model — currently drives nothing; wire to StageDisplay/laser rig), session state (notes seek, chat msgs, room status).
- Mocked: audio/meters (simulated), presets persistence, realtime chat/room, Invite/View report.

## Design Tokens (ar.css)
- bg `#070a12` · surface `#0d1525` / `#11192a` · card `#0f1828` (rack cards use grey `#182031`, bay `#1c2231→#121722`)
- border `rgba(148,163,184,.14/.2/.28)` · text `#f1f5f9` / `#cbd5e1` · muted `#94a3b8` · dim `#1e293b`
- accent `#00e5b0` · violet `#a78bfa` · orange `#fb923c` · red `#f43f5e` · per-module accents in manifest
- Type: Syne (UI) + JetBrains Mono (data/labels); radius 9–12px; mono microlabels 7.5–9px, letter-spacing .1–.14em, uppercase.

## Assets
None external — fonts from Google Fonts (Syne, JetBrains Mono); all glyphs are text/SVG.

## Files
- `Listen Rack.html` — entry (open directly in a browser)
- `ar.css` (shared tokens/chrome) + `lr.css` (page layer)
- `lr-app.jsx` shell · `lr-stage.jsx` stage/transport/atmosphere · `lr-ui.jsx` rack state + controls · `lr-rack.jsx` grid/toolbar/DnD · `lr-devices.jsx` device bay · `lr-panels.jsx` sidebar + coach · `lr-visuals.jsx` visuals panel
- `redesign/data.jsx` — manifest/data (verbatim from `rackManifest.ts` + `audio/state.ts`)
- Scaffold only: `lr-tweaks-panel.jsx`
