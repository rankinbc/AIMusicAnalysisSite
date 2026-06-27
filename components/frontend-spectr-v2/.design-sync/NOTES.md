# design-sync notes — spectr-frontend-v2

This repo is an **application** (`private: true`), not a published component
library. There is no `dist/` library entry, no `exports`/`module` barrel, and
no Storybook. We sync the reusable primitives in `src/ui/*` only, in the
converter's **synth-entry** package shape (entry synthesized from source).

## Setup gotchas (re-sync MUST honor these)

- **`node_modules/spectr-frontend-v2` junction is required.** The converter
  resolves `PKG_DIR = node_modules/<pkg>`, but this package isn't self-installed.
  Create a junction `node_modules/spectr-frontend-v2` → repo root so all
  package-relative cfg paths (`cssEntry`, `tokensGlob`, `extraFonts`, `tsconfig`)
  and synth-entry discovery resolve against the real source. It is **gitignored**
  and **gets reaped between runs** (self-referential target — repo contains the
  junction), so RE-CREATE IT before every `package-build.mjs` / capture run:
  PowerShell: `New-Item -ItemType Junction -Path node_modules\spectr-frontend-v2 -Target <repo>`
  (only if `node_modules\spectr-frontend-v2\package.json` is missing).
  `package-validate.mjs` operates on `ds-bundle/` only — no junction needed.
- **`srcDir: "src/ui"` is load-bearing.** It scopes synth-entry discovery to the
  10 primitive files. Left at `src/`, the converter would scan the whole app
  (routes, features → hundreds of PascalCase exports). 13 components result
  (Pill.tsx → Pill+Dot+Label; Coach.tsx → Coach+CoachMini).
- **Tokens ship via `tokensPkg` = the package itself.** `tokensGlob` alone is
  inert (only consulted when `tokensPkg` is set). `tokensPkg: "spectr-frontend-v2"`
  + `tokensGlob: "src/styles/tokens.css"` copies tokens.css into the bundle's
  `tokens/` and into the `styles.css` import closure. Without it: [TOKENS_MISSING]
  (every render loses its colors).
- **Fonts: `global.css` declares `@font-face` with Vite `public/`-root urls
  (`/fonts/*.woff2`) the converter can't resolve** (absolute path → filesystem
  root). Fix = `.design-sync/spectr-fonts.css` (committed) re-declaring Syne +
  JetBrains Mono with `../public/fonts/*.woff2` urls, wired via
  `extraFonts: ".design-sync/spectr-fonts.css"`. The converter copies the woff2
  and rewrites to `./<file>`. The broken `/fonts/` faces from global.css still
  appear in `fonts/fonts.css` but are declared FIRST, so the working `./` faces
  (declared last) shadow them per CSS @font-face cascade. [FONT_DANGLING] clears.

## Dark-theme DS — previews stage on var(--bg)

SPECTR is a **dark-theme** system (`--text` is near-white, `--bg` near-black).
The converter's preview card chrome hardcodes `body{background:#fff}` in
`lib/emit.mjs` (NOT forkable — it's part of the app self-check contract), so
light-on-dark components (e.g. Label's values) wash out on the white card.
Fix: every authored preview wraps its content in a local `Stage` component —
`<div style={{background:'var(--bg)',padding:24,borderRadius:12,color:'var(--text)'}}>`.
This is inlined per file (no shared import — relative imports in previews get
rewritten to the bundle global). **Do NOT use `cfg.provider` for this**: provider
injects a misleading "components read theme/i18n from this context" note into
every `.prompt.md` + the README, which is false for SPECTR (components just need
the dark page background — documented in conventions.md instead).

## Component-specific preview notes

- **SongVisualPicker**: `cfg.overrides` → `cardMode: single` + `viewport: "460x760"`
  so the tall controlled widget (card preview + 9 template grid + 2 swatch rows)
  renders fully instead of cropping.
- **Pill**: `cardMode: column` — the TrackMeta row is wider than a grid cell.
- **SongVisual `robot` / `booth` templates** reference `/coach.png` (a Vite
  `public/` runtime asset) that the bundle does NOT ship — those scenes render
  without the mascot. Authored previews favor the CSS-only templates (aurora,
  eq, vinyl, skyline, cassette, boombox). The SongVisualPicker preview shows all
  9 template thumbnails, so Robot/Booth minis render glow-only (acceptable).

## Re-sync risks

- The `spectr-fonts.css` shim duplicates the family declarations in
  `src/styles/global.css`. If the app changes its font families or filenames,
  update `.design-sync/spectr-fonts.css` to match (it won't auto-track).
- The junction must exist before any build — see Setup gotchas.
- Component set is `src/ui/*` only; new primitives added there appear
  automatically, but `src/components/*` and `src/features/*` are intentionally
  excluded (router/API coupled, not isolation-renderable).
