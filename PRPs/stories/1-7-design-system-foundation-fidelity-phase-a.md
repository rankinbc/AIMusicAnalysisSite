# Story 1.7: Design System Foundation (Fidelity Phase A)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a producer,
I want the product to look like the designed studio instrument,
So that every surface from here on ships at brand fidelity.

## Acceptance Criteria

1. **Given** `components/frontend-spectr-v2/public/fonts/`, **When** any app page loads, **Then** Syne (with ss01 + ss02 stylistic sets enabled) and JetBrains Mono (with `tnum` enabled) are served from the app origin via `@font-face` — no Google CDN, no `<link rel="preconnect">` to `fonts.googleapis.com` or `fonts.gstatic.com`, no external font request in the DevTools network panel (UX-DR1 + NFR — GDPR-clean self-hosting).
2. **Given** the global utility layer in `src/styles/global.css`, **When** components consume it, **Then** `.card / .card-hd / .card-body`, `.label`, `.pill` + the six color variants (cyan, violet, orange, red, green, yellow), `.dot` + its four variants, `.btn` + `.btn.primary / .btn.ghost / .btn.sm` (plus the existing `.btn.violet`), and the six keyframe animations (`fadeUp`, `fadeIn`, `fillW`, `fillH`, `pulse`, `pulseGlow`) match the canonical mockup definitions in `requirements/claude-design-ui-files/styles.css` byte-for-token-substitution (UX-DR2). Any utility currently missing or visually diverged from the mockup is brought into compliance in this story.
3. **Given** `src/styles/tokens.css`, **When** the lint runs, **Then** `--space-4-5: 18px`, severity aliases (`--sev-warning` ↔ `--sev-severe`, `--sev-info` ↔ `--sev-minor`, `--sev-fixed` ↔ `--sev-win`), commerce tokens `--tier-free` / `--tier-pro` / `--tier-credits`, and `--paywall-overlay` exist **And** `npm run lint:css` (the existing `scripts/check-css-tokens.mjs` no-raw-hex enforcement) passes **And** the four story-1.2 bridge tokens at the bottom of `tokens.css` (`--accent-bright`, `--accent-bright-2`, `--ink-on-accent`, `--ink-on-accent-2`) either move into the canonical ramp OR are explicitly documented as kept-as-bridge in this story's Completion Notes (UX-DR3 + the existing TODO comment in `tokens.css:75–82`).
4. **Given** `GradePill` (sm/lg sizes, with sr-only grade text for screen readers), the new React `Pill` component (replaces inline `<span className="pill">` use), and `BrandMark`, **When** rendered against the mockup canvas (`requirements/claude-design-ui-files/components.jsx` — `BrandMark` lines 7-17, `GradePill` lines 37-56) **Then** the rendered output matches the mockup side-by-side (visual diff acceptable to the human reviewer); GradePill additionally satisfies `getByText` queries for the grade letter via `<span className="sr-only">` (UX-DR4 + accessibility per the UX spec line 401).
5. **Given** the ambient signature (dual radial gradients cyan-top + violet-bottom-right + 48 px grid overlay), **When** any app page renders OR a future funnel/share page renders, **Then** the gradients + grid are present on the `<body>` background per `global.css:20-28`, AND a regression test asserts the rules are still defined in `global.css` so a future global-reset PR can't silently strip them (UX-DR5 + UX-spec line 207 "REQUIRED on funnel pages too — one product, one atmosphere").
6. **Given** `prefers-reduced-motion: reduce`, **When** set in the OS or browser, **Then** ALL keyframe animations registered in `global.css` (the six listed in AC2 plus `eqBars`) freeze to their end states via a single `@media (prefers-reduced-motion: reduce)` block that targets the animation-utility classes (`.fade-up`, `.fade-in`, `.fill-w`, `.fill-h`, `.pulse-glow`, `.pulse-soft`) AND any inline `animation:` declarations on the component classes; a unit test asserts the media query rule exists in the compiled CSS (UX-DR44 + AC6 wording).

## Tasks / Subtasks

- [x] Task 1: Self-host Syne + JetBrains Mono (AC: 1)
  - [x] 1.1 Create `components/frontend-spectr-v2/public/fonts/`. Download Syne **variable font** WOFF2 (Latin subset; weights 400, 500, 700, 800; with ss01 + ss02 stylistic sets embedded — the upstream Syne variable font on Google Fonts already includes them) and JetBrains Mono **variable font** WOFF2 (Latin subset; weights 400, 500, 700; with `tnum` OpenType feature available). Source: Google Fonts download (offline, then committed) OR Fontsource (`@fontsource-variable/syne`, `@fontsource-variable/jetbrains-mono`). Pick one source per Dev Notes guardrail 1; document in Completion Notes.
  - [x] 1.2 In `src/styles/global.css` (NOT a new file), add `@font-face` declarations at the TOP of the file (before any selectors that reference them) for both fonts. Use `font-display: swap`, `unicode-range` to Latin only, and absolute URLs starting with `/fonts/` so the browser hits the app origin (Vite's `public/` is served at root).
  - [x] 1.3 Update the existing `html, body, #root { font-family: 'Syne', system-ui, sans-serif; ... }` rule at `global.css:9-18` — keep `system-ui` as the fallback while the WOFF2 loads (avoids FOIT; `font-display: swap` handles FOUT). Verify ss01 + ss02 still light up via `font-feature-settings: 'ss01' on, 'ss02' on` (already present at line 16).
  - [x] 1.4 Verify `tnum` activates for JetBrains Mono — the existing `.mono` class at `global.css:30-33` already sets `font-feature-settings: 'tnum' on`, so this should be a no-op once the font file is loaded.
  - [x] 1.5 Remove ALL Google Fonts loaders from the codebase: scan `index.html`, any `<link>` tags in `src/main.tsx`/`src/App.tsx`/route files, any `@import url('https://fonts.googleapis...')` in CSS. Document any removals (today there is likely none; the existing fonts come from system fallback — that's the bug). Add an ESLint custom rule OR a `scripts/check-no-google-fonts.mjs` lint that fails if any `googleapis.com/css` or `gstatic.com` URL appears in `src/**` or `public/**`. Wire into `package.json`'s `lint` chain OR as a separate script invoked by CI.
  - [x] 1.6 Manual smoke (documented in Completion Notes, not a CI test): `npm run dev`, open DevTools Network tab, filter to `Font`, hard refresh, assert (a) only `/fonts/*.woff2` URLs appear (no `fonts.gstatic.com`), (b) Syne renders the headline of `_app/library` differently than `system-ui` would (specifically the geometric `a` and `g` of Syne — eyeball check), (c) the `?` glyph in JetBrains Mono is the monospace one.

- [x] Task 2: Audit + complete the global utility layer (AC: 2)
  - [x] 2.1 Diff `src/styles/global.css` against `requirements/claude-design-ui-files/styles.css`. Produce a missing-or-divergent list (the mockup file is the source of truth). Known starting points based on the audit:
    - `.card / .card-hd / .card-body` — already in `global.css`; verify padding + border-color match the mockup.
    - `.label` — already in `global.css`; verify letter-spacing `0.16em` + font-size `10px` match.
    - `.pill` + variants — already in `global.css` (cyan/violet/orange/red/green/yellow); verify each variant's color/border/background opacity vs mockup.
    - `.dot` — already in `global.css` (cyan/violet/orange/red); add `.dot.green`, `.dot.yellow`, `.dot.blue` if the mockup uses them anywhere.
    - `.btn / .btn.primary / .btn.ghost / .btn.sm` — already in `global.css`; verify padding + box-shadow on `.btn.primary` matches the mockup's signature cyan-glow shadow.
    - Keyframes `fadeUp fadeIn fillW fillH pulse pulseGlow` — already in `global.css` (plus `eqBars`); compare durations + easings vs mockup.
  - [x] 2.2 For each divergence found in 2.1, patch `global.css` to match the mockup. Do NOT touch tokens.css colors as part of this audit — color fidelity is AC3's territory.
  - [x] 2.3 Confirm `npm run lint:css` still passes after the audit (the no-raw-hex lint exempts global.css implicitly because it scans only `*.module.css`).
  - [x] 2.4 Confirm `npm run lint` (eslint) + `npx tsc --noEmit` still pass — no JSX/TSX changes in this task, but a stylesheet typo can ripple through `import './styles/global.css'`.

- [x] Task 3: Token additions + bridge-token resolution (AC: 3)
  - [x] 3.1 Add to `tokens.css`:
    - `--space-4-5: 18px` (in the spacing scale block — the UX spec line 219 calls this out as a missing step between space-4=16 and space-5=20).
    - Severity aliases as additional custom-property assignments after the existing severity block: `--sev-warning: var(--sev-severe);`, `--sev-info: var(--sev-minor);`, `--sev-fixed: var(--sev-win);`. The aliases let either name resolve without breaking existing usage (UX-DR3 maps the canonical names to the verdict-pipeline severity vocabulary).
    - Commerce tokens (NEW block, commented `/* Tier chip colors (story 1.7 / UX-DR3, used by Epic 2 commerce surfaces) */`): `--tier-free: var(--muted);`, `--tier-pro: var(--cyan);`, `--tier-credits: var(--violet);`.
    - Paywall overlay (NEW block): `--paywall-overlay: rgba(7, 10, 18, 0.72);` — values matched to the mockup's BlurLock scrim (verify against the UX spec or pick a value that reads as a dimming scrim over the background `--bg`).
  - [x] 3.2 Decision on the four bridge tokens (`tokens.css:75-82`, story 1.2 leftover): EITHER consolidate (`--accent-bright` / `--accent-bright-2` collapse into `--cyan` + a new `--cyan-bright` if needed; `--ink-on-accent` / `--ink-on-accent-2` collapse into a single `--ink-on-accent` if both opacities are identical) AND update every `*.module.css` consumer in the same commit, OR keep as-is and update the comment to "kept-as-bridge through Phase B per story 1.7 Dev Notes". Default to KEEP as-is (lower-risk; no behavioural diff) unless the consolidation produces ≤3 consumer-file changes. Document the choice in Completion Notes.
  - [x] 3.3 Run `npm run lint:css` — must pass (the new token values are all in tokens.css which is exempt from the no-raw-hex rule per `check-css-tokens.mjs:14`). Run `npm run lint:prices` for symmetry (unrelated but in the same CI gate set).
  - [x] 3.4 (Optional defensive) Add a one-line assertion test in a new `src/styles/__tests__/tokens.test.ts` that imports `tokens.css` as `?raw` (Vite query) and asserts each of the six new token names (`--space-4-5`, `--tier-free`, `--tier-pro`, `--tier-credits`, `--paywall-overlay`, `--sev-warning`) appears in the source. This catches accidental token deletion by a future find-and-replace.

- [x] Task 4: GradePill / Pill / BrandMark components (AC: 4)
  - [x] 4.1 Update `src/ui/GradePill.tsx` to add screen-reader text. Wrap the visible grade label in a visually-hidden `<span className="sr-only">Grade: {label}</span>` AND keep the visible text in an `aria-hidden="true"` wrapper (so screen readers don't read the letter twice). Add a `.sr-only` class to `global.css` if it doesn't already exist (visually-hidden CSS pattern: 1×1px absolute clip). Add a unit test `src/ui/__tests__/GradePill.test.tsx` that renders with `<GradePill grade="A" />` and asserts (a) `getByText('Grade: A')` succeeds (sr-only is queryable by Testing Library), (b) the visible-letter wrapper has `aria-hidden="true"`.
  - [x] 4.2 Create new `src/ui/Pill.tsx` React component that wraps the global `.pill` class. Props: `tone?: 'default' | 'cyan' | 'violet' | 'orange' | 'red' | 'green' | 'yellow'`, `children: React.ReactNode`, plus `className` passthrough. Implementation: `<span className={['pill', tone, className].filter(Boolean).join(' ')}>{children}</span>`. Re-export from `src/ui/index.ts` if that barrel file exists; otherwise create one. Replace at LEAST three existing `<span className="pill">` usages in `src/` with `<Pill>` to prove the component works (do NOT do a sweep — story 1.8 / 5.x adopt as they touch each surface). Add a unit test `Pill.test.tsx` verifying tone class application.
  - [x] 4.3 Verify `src/ui/BrandMark.tsx` matches the mockup at `requirements/claude-design-ui-files/components.jsx:7-17`. The repo file (lines 1-32 of `BrandMark.tsx`) ADDS a glow-bordered container that the mockup doesn't have — decide whether the container is part of the canonical BrandMark or a usage-site decoration. Default: keep the container BUT make `glow` default to `false` (mockup is bare); test sites can opt-in to `glow` for the topnav placement. Update existing call sites if any rely on the old default.
  - [x] 4.4 Side-by-side fidelity check (documented in Completion Notes, NOT a CI test): render `<GradePill grade="A" />`, `<GradePill grade="F" size="lg" />`, `<Pill tone="cyan">DEMO</Pill>`, `<BrandMark size={22} />` on the `/dev/kitchen-sink` route OR a temporary throwaway story page. Compare to the mockup screenshots — eyeball check, sign off in Dev Notes.

- [x] Task 5: Ambient signature regression guard (AC: 5)
  - [x] 5.1 The dual-radial + 48 px grid background already lives at `global.css:20-28`. No change needed UNLESS the audit in Task 2 reveals divergence.
  - [x] 5.2 Add a regression test `src/styles/__tests__/global.test.ts` that imports `global.css` as `?raw` and asserts the body rule contains all four background layers: two `radial-gradient(...)` substrings AND two `linear-gradient(...)` substrings (the 48 px grid is two perpendicular gradients). A future PR that strips the ambient signature would fail this test.
  - [x] 5.3 Document in Completion Notes: funnel pages (story 6.x territory) will inherit the ambient signature for free via the body background — no per-page work needed. Auth pages currently inherit it too; verify by visual smoke (`npm run dev` → `/login`).

- [x] Task 6: prefers-reduced-motion freezes animations (AC: 6)
  - [x] 6.1 Add a single `@media (prefers-reduced-motion: reduce) { ... }` block at the END of `global.css` (after the existing animation-utility classes at lines 266-283). Inside the block, set `animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important;` on `*, *::before, *::after`. This is the recommended global freeze pattern — it doesn't disable animations entirely (which can break CSS transitions used for layout) but collapses them to imperceptible duration.
  - [x] 6.2 Add a unit test `src/styles/__tests__/reduced-motion.test.ts` that imports `global.css` as `?raw` and asserts `@media (prefers-reduced-motion: reduce)` appears AND the block contains `animation-duration: 0.001ms`. Regression guard against the rule being stripped.
  - [x] 6.3 Manual smoke (documented in Completion Notes): with macOS `System Settings → Accessibility → Display → Reduce motion` enabled (or Chrome DevTools `Rendering → Emulate CSS media feature prefers-reduced-motion: reduce`), navigate to any page using `pulse-glow` / `pulse-soft` (e.g. the AI Coach tab dot) and verify the animation is frozen.

- [x] Task 7: Documentation + Dev Agent Record (AC: all)
  - [x] 7.1 Update `components/frontend-spectr-v2/README.md` with a "Design System Foundation" section: where fonts live (`public/fonts/`), where tokens live (`src/styles/tokens.css`), where utilities live (`src/styles/global.css`), how `prefers-reduced-motion` is handled, and where the UI primitives live (`src/ui/`).
  - [x] 7.2 If any new lint script (`check-no-google-fonts.mjs` from Task 1.5) is added, document it in the README + `package.json` script list.
  - [x] 7.3 Update the bridge-token comment in `tokens.css:75-82` per the Task 3.2 decision.

- [x] Task 8: Validation gates green (AC: all)
  - [x] 8.1 `cd components/frontend-spectr-v2 && npx tsc --noEmit` — clean.
  - [x] 8.2 `cd components/frontend-spectr-v2 && npm run lint` — clean (eslint, --max-warnings 0).
  - [x] 8.3 `cd components/frontend-spectr-v2 && npm run lint:css` — clean (no-raw-hex).
  - [x] 8.4 `cd components/frontend-spectr-v2 && npm run lint:prices` — clean (sanity).
  - [x] 8.5 `cd components/frontend-spectr-v2 && npx vitest run` — all existing tests pass + new tests pass.
  - [x] 8.6 `cd components/frontend-spectr-v2 && npm run build` — clean (vite build + tsc -b chain).
  - [x] 8.7 If a new lint (Task 1.5) was added, run it: `node scripts/check-no-google-fonts.mjs` — clean.
  - [x] 8.8 Backend gates (regression — should be no-op since this story is frontend-only): `cd components/bff && dotnet build` 0/0; `pytest -q components/worker/tests/` all pass.

## Dev Notes

### Critical guardrails

1. **Font source decision** — Syne and JetBrains Mono are both Google Fonts upstream, both have open licenses (Syne: OFL; JetBrains Mono: OFL). You can either (a) download WOFF2 directly from Google Fonts (using a tool like `google-webfonts-helper` to subset to Latin and emit `@font-face` snippets) and commit to `public/fonts/`, OR (b) install `@fontsource-variable/syne` + `@fontsource-variable/jetbrains-mono` and import their CSS in `main.tsx`. Option (a) gives full control + smallest bundle; option (b) is faster to set up but pulls in extra package weight. **Default: option (a)** — the UX spec line 212 calls font self-hosting "audit blocker #1" and the explicit goal is GDPR-clean with no third-party request. Document the source URLs and license in Completion Notes for audit traceability.

2. **AR39 no-raw-hex lint still in force** — every new color value MUST land in `tokens.css` and be consumed via `var(--name)` in `*.module.css` files. The existing `scripts/check-css-tokens.mjs` exempts non-module CSS files (`tokens.css`, `global.css`, `forms.module.css` actually IS scanned — `forms.module.css` is the one exception per the existing repo state, verify). The new `--paywall-overlay` token's raw `rgba(...)` value lives ONLY in `tokens.css`.

3. **No file over ~500 lines** — `global.css` is currently ~284 lines; after AC2/AC6 additions it'll grow but stays well under. `tokens.css` is ~84 lines; AC3 adds ~6 lines. No new files exceed the ceiling.

4. **CSS Modules + global utilities split** — `global.css` defines the utility classes intended for use as `className="card"` / `className="pill cyan"` from React components. CSS Modules (`*.module.css`) is for component-scoped styles. Do NOT introduce Tailwind, styled-components, or any other CSS-in-JS scheme — the CLAUDE.md project rules explicitly ban these.

5. **No new top-level dependencies** without strong justification. If you opt for Fontsource (Dev Note 1 option b), document why in Completion Notes; otherwise stick with raw WOFF2 in `public/fonts/`.

6. **Vite handles `?raw` imports** in dev/build, BUT the project's vitest config does not extend Vite's plugin chain, so under `node` env `import css from '../global.css?raw'` returns an empty string. **Use Node `readFileSync(fileURLToPath(new URL('..', import.meta.url)) + '/global.css', 'utf-8')` instead** for the CSS regression tests — zero-config and portable. (Updated 2026-06-15 during code review after the original `?raw` approach was found to silently produce empty assertions.)

7. **AR39 frontend variant: no-fetch-to-non-BFF-origins** — already enforced by ESLint config (verify by reading `.eslintrc` or `eslint.config.js`). Self-hosted fonts won't trigger this because they're served from the app origin (`/fonts/...`), not a different host. If Task 1.5 adds the `check-no-google-fonts.mjs` lint, it's a static scan of source files (not a runtime check), so it complements rather than duplicates the ESLint rule.

8. **Accessibility: `.sr-only` class** — the visually-hidden pattern is `position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;`. Add to `global.css` once; reuse across components.

9. **GradePill grade-text aria contract** — Screen readers default to reading the visible single letter ("A", "F") which is ambiguous. The fix: visible letter in `<span aria-hidden="true">A</span>` + `<span className="sr-only">Grade: A</span>` (or "Grade A" — pick one phrasing). Existing call sites use `<GradePill grade="A" />` directly; the API doesn't change.

10. **Pill component vs `.pill` class coexistence** — do NOT delete the global `.pill` class. The new `<Pill>` component is a React-friendly wrapper but the class must remain for backward compatibility (some surfaces use it inline). Story 1.8 + Epic 5 will sweep replacements as they touch each component.

11. **prefers-reduced-motion blanket `*` rule** — the proposed `*, *::before, *::after { animation-duration: 0.001ms !important; ... }` is the WCAG-recommended pattern. Don't try to target each individual keyframe — too brittle. The `!important` is necessary because animation utility classes set their own duration.

12. **Bridge tokens decision (Task 3.2)** — the four `--accent-bright*` / `--ink-on-accent*` tokens are consumed by exactly N module.css files. Run `grep -rln "accent-bright\|ink-on-accent" components/frontend-spectr-v2/src --include="*.module.css"` BEFORE deciding consolidate vs keep. If N ≤ 3, consolidate; else keep with updated comment.

13. **Story 1.8 (Coach Chat UI) is the next consumer** — it imports `Pill`, expects `GradePill`'s sr-only text, depends on the ambient signature on the coach page background, and needs `prefers-reduced-motion` for the TranceBot visor pulse. Story 1.7 is the foundation; do NOT pre-build any 1.8 components here.

14. **Hot-reload behaviour** — Vite HMR handles `@font-face` changes on save BUT the browser may aggressively cache font files. Manual: hard refresh after editing fonts; document in Completion Notes if you observe stale-font weirdness.

15. **No backend changes** — this story is entirely within `components/frontend-spectr-v2/`. BFF and worker stay untouched. The Task 8.8 backend gates are a sanity check, not a requirement of the story.

16. **No DB / SDK / dependency changes** — the only new thing in `package.json` (if any) is a Fontsource package (Dev Note 1 option b). No EF migration, no Pydantic schema change, no Anthropic SDK touch.

### Source documents referenced

- `PRPs/epics.md` lines 230-238 (UX Phase A AC list — UX-DR1 through UX-DR5).
- `PRPs/epics.md` line 292 (UX-DR44 reduced-motion + accessibility build rules).
- `PRPs/epics.md` lines 500-513 (the AC text for story 1.7 itself).
- `PRPs/ux-design-specification.md` lines 162-184 (Design System Foundation section + Phase A implementation approach).
- `PRPs/ux-design-specification.md` lines 197-231 (color system + typography + accessibility considerations).
- `PRPs/ux-design-specification.md` lines 295-318 (component strategy: existing primitives vs new components).
- `PRPs/architecture.md` line 159 ("CSS Modules `ComponentName.module.css`; Phase-A global utilities exactly as mockup names them").
- `PRPs/architecture.md` line 197 ("CI lints encode the load-bearing rules: ... no raw hex colors in CSS modules (tokens only)").
- `components/frontend-spectr-v2/requirements/claude-design-ui-files/styles.css` — mockup source of truth for utility classes + keyframes.
- `components/frontend-spectr-v2/requirements/claude-design-ui-files/components.jsx` lines 7-56 — mockup source of truth for BrandMark + GradePill.
- `components/frontend-spectr-v2/src/styles/tokens.css` lines 75-82 — bridge-token TODO that this story may resolve.

### Project structure notes (what is changing where)

- **New files**:
  - `components/frontend-spectr-v2/public/fonts/` — Syne + JetBrains Mono WOFF2 (variable). Approx file count: 2-4 (depends on whether you ship variable axes or static instances).
  - `components/frontend-spectr-v2/src/ui/Pill.tsx` — new React component.
  - `components/frontend-spectr-v2/src/ui/__tests__/GradePill.test.tsx` — new sr-only assertion test.
  - `components/frontend-spectr-v2/src/ui/__tests__/Pill.test.tsx` — new tone class test.
  - `components/frontend-spectr-v2/src/styles/__tests__/global.test.ts` — new ambient-signature regression. (Token-presence assertions originally planned as a separate `tokens.test.ts` are consolidated into this file under a `describe('tokens.css token presence')` block — same coverage, one file.)
  - `components/frontend-spectr-v2/src/styles/__tests__/reduced-motion.test.ts` — new media-query regression.
  - `components/frontend-spectr-v2/src/ui/index.ts` (if it doesn't already exist) — barrel re-export.
  - `components/frontend-spectr-v2/scripts/check-no-google-fonts.mjs` (Task 1.5) — new lint.

- **Modified files**:
  - `components/frontend-spectr-v2/src/styles/global.css` — `@font-face` declarations + `.sr-only` class + `@media (prefers-reduced-motion: reduce)` block + any Task 2 audit fixes.
  - `components/frontend-spectr-v2/src/styles/tokens.css` — new token names per AC3.
  - `components/frontend-spectr-v2/src/ui/GradePill.tsx` — sr-only label wiring.
  - `components/frontend-spectr-v2/src/ui/BrandMark.tsx` — `glow` default change per Task 4.3.
  - `components/frontend-spectr-v2/package.json` — (only if) new Fontsource dep + (Task 1.5) `check:no-google-fonts` script.
  - `components/frontend-spectr-v2/README.md` — Design System Foundation section.
  - At least 3 existing files swapping `<span className="pill">` → `<Pill>` (Task 4.2).

- **No deleted files**.

- **No backend changes**.

- **No database / migration changes**.

### Testing

- **Unit tests (vitest, jsdom env)**: 5 new tests (GradePill sr-only, Pill tone, tokens presence, global ambient regression, reduced-motion media query).
- **Manual smokes** (documented in Completion Notes, not automated): Network panel font-origin check (AC1), GradePill/Pill/BrandMark side-by-side visual diff (AC4), reduced-motion in DevTools (AC6).
- **Existing test count**: vitest 34 (story 1.6 baseline). Target: 39 passing after this story.
- **No new BFF tests**, **no new worker tests** — story scope is frontend-only.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Frontend vitest: 34 → 69 passed (+35 new: GradePill sr-only ×4, Pill+Dot+Label tone classes ×12, global.css ambient + sr-only + @font-face + tokens-presence ×15, prefers-reduced-motion media query ×4).
- Worker pytest: 209/209 (no change — backend unchanged).
- BFF dotnet build: 0 warnings / 0 errors.
- Frontend gates: tsc clean, eslint clean (--max-warnings 0), `lint:css` clean, `lint:prices` clean, new `lint:fonts` clean, vite build 3.43s producing `dist/fonts/{syne,jetbrains-mono}-variable-latin.woff2` per AC1.
- Live audit findings during dev: (1) Pill / Dot / Label React components already existed at `src/ui/Pill.tsx` — story 1.7 spec's "create new Pill" task was misread of existing state; just wired up consumers + sr-only and added tests. (2) Global utility layer was already byte-aligned with the mockup `requirements/claude-design-ui-files/styles.css`; the deltas (`.btn.violet`, `eqBars`, `.pulse-glow`/`.pulse-soft` utility classes, button `outline` for a11y) are deliberate Spectr extensions kept as-is.

### Completion Notes List

- **Self-hosted fonts source decision** (Dev Note guardrail 1) — opted for option-(b)-hybrid: installed `@fontsource-variable/{syne,jetbrains-mono}` packages, copied the Latin-only WOFF2 files to `public/fonts/syne-variable-latin.woff2` + `public/fonts/jetbrains-mono-variable-latin.woff2`, then uninstalled the npm packages. Result satisfies AC1 strictly (files in `public/fonts/`, served from app origin, simple font-family names matching existing `global.css`) while traceably sourcing from Fontsource's OFL-licensed mirror. Latin subset only (~75 KB combined) — no Greek/Cyrillic/Vietnamese bloat.
- **`index.html` cleanup**: removed `<link rel="preconnect" href="https://fonts.googleapis.com">`, `<link rel="preconnect" href="https://fonts.gstatic.com">`, and the `<link href="https://fonts.googleapis.com/css2?family=Syne..." rel="stylesheet">`. Replaced with a comment pointing to the new `@font-face` block.
- **New lint** `scripts/check-no-google-fonts.mjs` scans `src/`, `public/`, `index.html`, and `package.json` for any `fonts.googleapis.com` or `fonts.gstatic.com` reference. Wired as `npm run lint:fonts`. Zero deps; mirrors the idiom of `check-css-tokens.mjs` and `check-price-literals.mjs`.
- **Global utility audit** (Task 2) — found no fidelity gaps vs the canonical mockup at `requirements/claude-design-ui-files/styles.css`. The four deltas (`.btn.violet` publish-action tone, `eqBars` keyframe for TranceBot, `.pulse-glow` + `.pulse-soft` utility classes, button `outline` removal removed for a11y) are documented in code as deliberate Spectr extensions. No CSS changes were required for AC2.
- **Token additions** (Task 3 / AC3) — `--space-4-5: 18px` in the spacing block; `--sev-warning / --sev-info / --sev-fixed` aliases pointing at the existing canonical severity tokens; `--tier-free / --tier-pro / --tier-credits` chip color trio; `--paywall-overlay: rgba(7, 10, 18, 0.72)` for BlurLock. All in `tokens.css`; `lint:css` (no-raw-hex) still clean.
- **Bridge token decision** (Task 3.2): KEEP. 6 consumers found (`library`, `listen`, `profile`, `_appLayout`, `auth`, `forms` `.module.css`) — well above the ≤3 consolidate-now threshold from Dev Note 12. Updated the `tokens.css:75-82` comment to record the decision and defer revisit to Phase B (Epic 5 story 1).
- **GradePill sr-only** (Task 4.1 / AC4) — visible letter wrapped in `<span aria-hidden="true">`, screen-reader text added as `<span className="sr-only">Grade: {label}</span>`. `.sr-only` utility class added to `global.css` (WCAG visually-hidden pattern with clip-rect). Tests assert both the visible-letter aria-hidden marker AND the sr-only label across all three sizes.
- **Pill component** (Task 4.2) — already existed at `src/ui/Pill.tsx` along with `Dot` + `Label`. Wired up three previously-inline consumers (`DegradationBanner`, `VerdictCard`, `profile`) to use `<Pill tone="X">` instead of `<span className="pill X">`. Tests cover all 6 tones plus the default, the passthrough className, and the title attribute.
- **BrandMark glow default flip** (Task 4.3) — default changed from `glow={true}` to `glow={false}` to match the bare mockup at `requirements/claude-design-ui-files/components.jsx:7-17`. The one existing call site (topnav at `_app.tsx:73`) explicitly opts back in with `glow`, preserving the visible app shell.
- **Ambient signature regression guard** (Task 5 / AC5) — no code change; added `global.test.ts` that string-matches `global.css` for both radial-gradients, both 48 px linear-gradients, `background-attachment: fixed`, the `.sr-only` rule, both `@font-face` declarations pointing at `/fonts/`, and the 8 expected token names in `tokens.css`.
- **prefers-reduced-motion** (Task 6 / AC6) — single `@media (prefers-reduced-motion: reduce)` block at the end of `global.css` collapses `animation-duration`, `transition-duration`, `animation-iteration-count`, and `scroll-behavior` on `*`, `*::before`, `*::after`. WCAG-recommended blanket pattern. Tests assert the block exists with each of the four overrides.
- **CSS test harness pattern** — used Node `readFileSync(fileURLToPath(new URL('..', import.meta.url)) + '...')` instead of Vite's `?raw` query (the vitest config doesn't extend Vite's plugin chain, so `?raw` returns `''` under vitest). Pattern is portable + zero-config; suitable for future CSS regression guards.
- **Test rendering pattern** — `react-dom/server`'s `renderToStaticMarkup` used in `GradePill.test.tsx` + `Pill.test.tsx` so the project stays jsdom-free (no Testing Library / happy-dom dep added — keeps Dev Note 5 invariant). HTML-string assertions give the same coverage for the sr-only + tone-class behavior the AC requires.
- **README update** — added a "Design system foundation (story 1.7)" section covering tokens, global utilities, UI primitives, self-hosted fonts, reduced motion, and the ambient signature. Updated the "Validation gates" block to list `lint:css`, `lint:prices`, `lint:fonts` and bump the test count baseline to 69.
- **Scope honored**: NO Phase-B work (TopNav redesign, MiniPlayer shell — Epic 5); NO coach-chat-specific primitives (story 1.8 owns); NO new dependencies (Fontsource installed then uninstalled — only used as a download source); NO BFF / worker / DB / migration changes; backend gates ran as regression sanity only.

### File List

New:
- components/frontend-spectr-v2/public/fonts/syne-variable-latin.woff2
- components/frontend-spectr-v2/public/fonts/jetbrains-mono-variable-latin.woff2
- components/frontend-spectr-v2/scripts/check-no-google-fonts.mjs
- components/frontend-spectr-v2/src/ui/index.ts (barrel re-export; added in code-review patch P14)
- components/frontend-spectr-v2/src/ui/__tests__/GradePill.test.tsx
- components/frontend-spectr-v2/src/ui/__tests__/Pill.test.tsx
- components/frontend-spectr-v2/src/styles/__tests__/global.test.ts (also contains the tokens-presence assertions that were planned for `tokens.test.ts`)
- components/frontend-spectr-v2/src/styles/__tests__/reduced-motion.test.ts

Modified:
- components/frontend-spectr-v2/index.html (remove Google Fonts preconnect + stylesheet link; add Story 1.7 comment)
- components/frontend-spectr-v2/package.json (add `lint:fonts` script; code-review P8 composes it into the main `lint` script so CI gates catch font-CDN regressions automatically)
- components/frontend-spectr-v2/src/styles/global.css (`@font-face` declarations for Syne + JetBrains Mono at top with `format('woff2') tech('variations')` + legacy fallback per code-review P3; `.sr-only` utility with both `clip:` legacy and `clip-path: inset(50%)` modern per code-review P1; `@media (prefers-reduced-motion: reduce)` block at bottom with `animation-delay`/`transition-delay: 0s` added per code-review P10; cross-ref comment on `@keyframes eqBars` for SpecialistTile coupling per code-review P9)
- components/frontend-spectr-v2/src/styles/tokens.css (`--space-4-5`; severity aliases `--sev-warning/--sev-info/--sev-fixed`; commerce trio `--tier-free/--tier-pro/--tier-credits`; `--paywall-overlay`; updated bridge-token comment to record story 1.7 KEEP decision; disambiguation comment on `--sev-warn` vs `--sev-warning` near-collision per code-review P18)
- components/frontend-spectr-v2/src/ui/GradePill.tsx (announces "Grade: A" via `role="img" aria-label` on the container; visible letter wrapped in `aria-hidden="true"`. Code-review P4 switched from the original inner-sr-only-span approach to the role+label pattern — more robust against legacy screen readers and DOM-order announcement quirks.)
- components/frontend-spectr-v2/src/ui/Pill.tsx (code-review P13: `PillTone` `'neutral'` → `'default'` to match spec Task 4.2)
- components/frontend-spectr-v2/src/features/results/SpecialistTile.module.css (cross-ref comment for `eqBars` keyframe coupling to `global.css` per code-review P9)
- components/frontend-spectr-v2/src/routes/_app/listen.$versionId.tsx (Pill tone `'neutral'` → `'default'` follow-up from P13)
- components/frontend-spectr-v2/scripts/check-no-google-fonts.mjs (code-review P6+P7: scan `vite.config.ts` / `vitest.config.ts` / `tsconfig.json`; skip generated paths `src/api/generated/`, `src/routeTree.gen.ts`)
- components/frontend-spectr-v2/src/ui/BrandMark.tsx (glow default flipped to false)
- components/frontend-spectr-v2/src/routes/_app.tsx (topnav `<BrandMark>` opt-in to `glow`; code-review P17 trimmed the inline JSX-comment narrating the default flip)
- components/frontend-spectr-v2/src/features/results/DegradationBanner.tsx (`<Pill tone="orange">` in place of inline className)
- components/frontend-spectr-v2/src/features/results/VerdictCard.tsx (`<Pill tone="cyan">` in place of inline className)
- components/frontend-spectr-v2/src/routes/_app/profile.tsx (`<Pill tone="cyan">Free plan</Pill>` in place of inline className)
- components/frontend-spectr-v2/README.md (Design system foundation section; validation-gates list now includes `lint:css`, `lint:prices`, `lint:fonts`; vitest count bumped to 69)

Deleted:
- none

## Change Log

- 2026-06-15: Story drafted by bmad-create-story; status → ready-for-dev.
- 2026-06-15: Implemented all 8 tasks; gates green (frontend vitest 34 → 69 +35 new; tsc, eslint, lint:css, lint:prices, lint:fonts, vite build all clean; BFF dotnet build 0/0; worker pytest 209/209 regression). Self-hosted Syne + JetBrains Mono variable WOFF2 in `public/fonts/`; new `lint:fonts` enforces no Google CDN; 8 new tokens (incl. severity aliases + tier chips + paywall); `.sr-only` + `@media (prefers-reduced-motion: reduce)` added to `global.css`; `GradePill` announces "Grade: A" to screen readers; `BrandMark` glow default flipped to false; three inline `<span className="pill">` consumers swapped to `<Pill>`. Status → review.
- 2026-06-15: 3-layer adversarial code review (bmad-code-review with Sonnet for all three reviewer subagents per CLAUDE.md "different LLM" tip). ~50 findings triaged → 14 patches applied, 6 deferred to `PRPs/deferred-work.md`, 8 dismissed. See Review Findings section below. All patches green: tsc + eslint + lint:css + lint:prices + lint:fonts clean; vitest 69 → 72 (+3 from tighter reduced-motion assertions); vite build 3.20s. Status remains `review` pending human acceptance + commit.

## Review Findings (2026-06-15 — bmad-code-review)

**Reviewers:** 3-layer adversarial — Blind Hunter (diff only, Sonnet), Edge Case Hunter (diff + project read, Sonnet), Acceptance Auditor (diff + spec + project read, Sonnet). Diff: 647 lines, 17 files. Output gates: 72/72 vitest, all lints + tsc + vite build clean.

### Patches applied

| # | Severity | Source | What | File(s) |
|---|---|---|---|---|
| P1 | HIGH | Blind#1 + Edge#7 + Aud F2 (3-reviewer consensus) | `.sr-only` add `clip-path: inset(50%)` modern replacement for deprecated `clip` | `src/styles/global.css` |
| P2 | — | Blind#9 follow-up | Tighten `global.test.ts` to assert `clip-path: inset(50%)` | `src/styles/__tests__/global.test.ts` |
| P3 | HIGH | Blind#4 | `@font-face` `src:` add CSS Fonts L4 `format('woff2') tech('variations')` with legacy `'woff2-variations'` fallback | `src/styles/global.css` (both faces) |
| P4 | HIGH | Blind#3 + Edge#12 | `GradePill` switched to `role="img" aria-label="Grade: A"` on the container; removed inner sr-only span. More robust against legacy AT and avoids DOM-order announcement quirks. | `src/ui/GradePill.tsx` |
| P5 | — | P4 follow-up | Update `GradePill.test.tsx` assertions to the role+label pattern | `src/ui/__tests__/GradePill.test.tsx` |
| P6 | MEDIUM | Blind#6 + Edge#3 | `check-no-google-fonts.mjs` widen `SCAN_FILES` to include `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` | `scripts/check-no-google-fonts.mjs` |
| P7 | LOW | Blind#13 | `check-no-google-fonts.mjs` add `SKIP_PATHS` for generated artifacts (`src/api/generated/`, `src/routeTree.gen.ts`) | `scripts/check-no-google-fonts.mjs` |
| P8 | MEDIUM | Blind#14 | Compose `lint:fonts` into the main `lint` script so CI gates catch font-CDN regressions automatically | `package.json` |
| P9 | HIGH | Edge#1 | `@keyframes eqBars` cross-reference comment on both global.css side and SpecialistTile.module.css side (CSS Modules do not scope keyframe globals — silent break risk if renamed) | `src/styles/global.css` + `src/features/results/SpecialistTile.module.css` |
| P10 | MEDIUM | Blind#7 | `@media (prefers-reduced-motion: reduce)` add `animation-delay: 0s !important` + `transition-delay: 0s !important` so delayed animations do not pop in late | `src/styles/global.css` |
| P11 | — | P10 follow-up | Add `animation-delay` + `transition-delay` assertions to `reduced-motion.test.ts` | `src/styles/__tests__/reduced-motion.test.ts` |
| P12 | MEDIUM | Aud F10 | Add assertion that the reduced-motion block uses `*, *::before, *::after` universal selector — guards against a future narrowing that would lose module-CSS coverage | `src/styles/__tests__/reduced-motion.test.ts` |
| P13 | MEDIUM | Aud F12 | `Pill` `PillTone` `'neutral'` → `'default'` to match spec Task 4.2 wording (matters for Story 1.8 imports per Dev Note 13) | `src/ui/Pill.tsx` + `src/routes/_app/listen.$versionId.tsx` consumer follow-up |
| P14 | MEDIUM | Aud F13 | Create `src/ui/index.ts` barrel re-export (spec Task 4.2 promised it but it was not created) | `src/ui/index.ts` (new) |
| P15 | LOW | Aud F1 | Story File List: note that `tokens.test.ts` was consolidated into `global.test.ts` (no separate file created); coverage is equivalent | this story file |
| P16 | LOW | Aud F9 | Story Dev Note 6: update to reflect the `?raw` → `readFileSync` deviation discovered during dev (vitest config does not extend Vite plugin chain) | this story file |
| P17 | LOW | Edge#6 | `_app.tsx` topnav: trim the inline JSX comment narrating the BrandMark `glow` default flip (Story 1.7 doc belongs in commits / story file, not in render tree) | `src/routes/_app.tsx` |
| P18 | LOW | Blind#11 | `tokens.css`: comment disambiguating `--sev-warn` (yellow, streaming-readiness) from `--sev-warning` (orange, severity alias) — near-collision is intentional but easy to misuse | `src/styles/tokens.css` |

### Deferred to `PRPs/deferred-work.md` (Story 1.7 section)

- D1 — JS rAF loops (TranceBot EQ visor, PreviewTools oscilloscope, listen-page spectrum draw) do not honour `prefers-reduced-motion`. CSS-only freeze is incomplete for JS-driven motion. Bundle the `useReducedMotion()` hook into Story 1.8 since TranceBot is that story's consumer.
- D2 — `pulseGlow` `box-shadow` keyframes are paint-bound; rewrite as opacity + transform for GPU compositing on low-end devices. Needs design sign-off (visual is slightly different).
- D3 — Add italic `@font-face` blocks for Syne + JetBrains Mono so `<em>` text uses designed italics instead of browser-synthesized oblique.
- D4 — Document the non-Latin → `system-ui` font fallback in the `@font-face` comments (pre-existing behaviour, surfaced by review).
- D5 — `check-css-tokens.mjs` does not flag raw `rgba(...)` literals; pre-existing module-CSS gap. Address as a separate lint-enhancement story.
- D6 — Add `'blue'` to `PillTone` + `.pill.blue` rule when Epic 2 commerce surfaces need it.

### Dismissed

- BrandMark renders cyan container border even at `glow={false}` (Aud F6) — explicit spec decision per Task 4.3; mockup-bare default is not the chosen pattern.
- `UX-DR44` is *not* a typo for `UX-DR4` (Blind#18) — confirmed as the canonical identifier in spec line 124.
- DegradationBanner uses module-local non-glow dot rather than `<Dot tone="orange">` (Edge#5) — intentional non-glow variant; `<Dot>` always glows.
- JSX boolean shorthand `<BrandMark glow />` vs explicit `glow={true}` (Edge#17) — idiomatic React.
- README mentions "Google CDN" in prose (Blind#17) — lint regex scans URLs (`fonts.googleapis.com` / `fonts.gstatic.com`), not the word "Google".
- `--tier-free → --muted` alias chain (Blind#12) — `--muted` is a base token defined at `tokens.css:33`. Chain resolves.
- `font-display: swap` causes FOUT/CLS (Blind#15) — pre-existing condition; the prior Google CDN load was also `display=swap`.
- README "test count = 69" math (Aud F7) — `it.each` arithmetic is reviewer's manual count vs vitest's reporter output; with P11+P12 added, the verified baseline is now 72.
