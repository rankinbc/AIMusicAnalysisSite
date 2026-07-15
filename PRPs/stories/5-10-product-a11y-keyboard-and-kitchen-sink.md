# Story 5.10: Product A11y, Keyboard & Kitchen Sink

Status: done

## Story

As a keyboard-first producer,
I want the product fully navigable and verifiable,
so that speed and accessibility are the same feature.

## Acceptance Criteria

1. **Given** product routes, **When** loaded, **Then** ⌘K search, ⌘U upload, and `?` shortcut sheet register (UX-DR43).
2. **Given** the axe-core CI smoke (UX-DR44), **When** run on the report route, **Then** no WCAG 2.1 AA violations report.
3. **Given** <1024 px, **When** the report renders, **Then** rails stack and fold into accordions **And** Listen shows the desktop-only notice card (UX-DR45).
4. **Given** `/dev/kitchen-sink` behind a feature flag (UX-DR46), **When** opened, **Then** the component inventory renders as the visual-regression and a11y audit surface.
5. **Given** focus styling, **When** tabbing anywhere, **Then** the visible cyan ring shows on all interactives **And** the lint forbids `outline: none` without replacement.

Source: `PRPs/epics.md:957-969`. UX: `ux-design-specification.md:291-294` (UX-DR43 keyboard; UX-DR44 AA rules incl. "no `outline: none` without replacement (lint)" + "axe-core CI smoke"; UX-DR45 breakpoints sm640/md768/lg1024/xl1360; UX-DR46 kitchen-sink, "no Storybook").

## Reality Check (2026-07-15 scout — everything is net-new)

- **⌘K was deliberately REMOVED** (`routes/_app.tsx:110-112`: "the global search box + ⌘K badge is GONE — it had no handlers... Rebuild it only when a real command palette + search machinery exist"). No `cmdk` dep. No global keyboard hook of any kind — existing keydown handling is all dialog-local Escape/Enter.
- **UnifiedUploadDialog is page-local in exactly 2 mounts** (library `SongsLibrarySection.tsx:635/829`, song detail `songs.$songId.tsx:30/328`) — a global ⌘U needs a shared mount in `AppLayout` (`_app.tsx`, the authed shell wrapping `<Outlet/>` at `:218`).
- **No axe-core/vitest-axe/jest-axe dep, no a11y CI step.** CI frontend job (`.github/workflows/ci.yml:125-153`): npm ci → vite build → tsc -b → lint → lint:css → lint:prices → vitest run. Playwright is installed (`playwright/` smoke specs) but NOT in CI — so the axe smoke goes through **vitest jsdom**, slotting into the existing `vitest run` step with zero CI-wiring risk.
- **Layout collapse is at 900px, not 1024**: `ReportView.module.css:15-30` + `redesign.css:26-42` (`.rdx .layout`) both collapse the `1fr/280-288px` grid at 900. Listen `listenRack.css:40-53` also 900. **No desktop-only notice** on Listen (`ListenRackPage.tsx` has no matchMedia/copy). No breakpoint tokens in `tokens.css`.
- **Focus ring exists but `button`-only**: `global.css:94-97` `button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }`. **10 `outline: none` occurrences in 10 files** (list below). `lint:css` = custom `scripts/check-css-tokens.mjs` (regex walker over `src/**/*.module.css`, NOT stylelint) — the focus lint follows the same pattern as a new script.
- **No /dev route.** Dev-surface precedent = `import.meta.env.DEV` gates (`DebugTab`, `DevHealthDot`). Route convention: `src/routes/_app/dev.kitchen-sink.tsx` (flat file, dot = path separator; routeTree.gen.ts regenerates on `vite build`).
- **Kitchen-sink inventory candidates**: global utilities (`.card/.card-hd/.card-body`, `.pill` + 6 tones, `.dot` + tones, `.btn` + `.primary/.ghost/.sm/.violet`, `.label`, `.mono` — `global.css:64-249`); `src/ui/` primitives (`BrandMark, Coach, CoverArt, GradePill, Pill, ProgressTimeline, SongVisual, SpecialistBot, VersionArc` — barrel `src/ui/index.ts`); simple shared components (`TierChip`, `UsageMeter`, `VerifyEmailBanner`, `BlurLock`). Skip provider-heavy dialogs.

### The 10 `outline: none` sites (AC5 audit list)

`styles/forms.module.css:18`, `features/anon-analyze/analyze.module.css:210`, `components/SongFields.module.css:122`, `routes/_app/reports.module.css:54`, `routes/_app/profile.module.css:425`, `features/listen/BookmarksRail.module.css:55`, `components/UploadVersionDialog.module.css:23`, `features/results/CoachChat.module.css:188`, `features/billing/CancelDialog.module.css:58`, `features/results/redesign.css:1498`.

## Tasks / Subtasks

- [x] Task 1 — Global keyboard layer: ⌘K palette, ⌘U upload, `?` sheet (AC: 1)
  - [x] 1.1 `src/components/CommandPalette.tsx` + module CSS — NO new dependency (no cmdk; Radix Dialog or a plain positioned overlay + roving listbox). Client-side machinery only: (a) static nav commands (Library, Reports, Usage, Billing, Settings/Profile — mirror the AppLayout nav) navigating via TanStack `useNavigate`; (b) song search over the existing songs query (reuse the hook the library uses — find it in `SongsLibrarySection.tsx`; filter client-side on name) → selecting navigates to `/songs/$songId`. Input gets `role="combobox"` + listbox/option semantics, arrow-key selection, Enter to commit, Esc closes. This satisfies the `_app.tsx:110` removal note: the palette IS the search machinery now — delete/rewrite that comment.
  - [x] 1.2 `src/components/ShortcutSheet.tsx` — static dialog listing the bindings (⌘K palette · ⌘U upload · ? this sheet · Esc close). Note both ⌘ and Ctrl forms (win/mac).
  - [x] 1.3 Global handler in `AppLayout` (`_app.tsx`) — ONE window keydown listener (cleanup in effect return, precedent `_app.tsx:50-59`): `(meta||ctrl)+k` → toggle palette; `(meta||ctrl)+u` → open upload (preventDefault — Ctrl+U is browser view-source); `?` (shift+/) → shortcut sheet. **Suppress all three when the event target is input/textarea/select/contenteditable or a dialog with its own field focus** (check `(e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')`). Product routes only — the listener lives in the authed `_app` shell, so public/anon routes are untouched by construction.
  - [x] 1.4 Global upload host: mount `<UnifiedUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />` (no songId → new-song mode, exactly the library mount shape) in AppLayout. Do NOT refactor the two existing page-local mounts — they keep their contextual props (songId/defaultGenre); the global one is the ⌘U fallback from anywhere.
  - [x] 1.5 Vitest: keydown dispatch tests for the handler logic — extract the decision into a pure helper (`src/lib/shortcuts.ts`: `matchShortcut(e) -> 'palette'|'upload'|'sheet'|null` incl. the editable-target suppression) so tests don't need the full AppLayout; test palette filtering logic similarly (pure filter function).
- [x] Task 2 — Responsive: 1024 stacking + rail accordions + Listen notice (AC: 3)
  - [x] 2.1 Move the report collapse breakpoint 900 → **1024** in BOTH `ReportView.module.css` and `redesign.css` (`.rdx .layout`). Grep for other 900px queries in `features/results/` and align any that are the same layout collapse (do not touch unrelated 560/640 fine-tuning).
  - [x] 2.2 Rail folds to accordions <1024: in `RackSidebar.tsx`, wrap each section in `<details className={...} open>` with a `<summary>` header. Desktop (≥1024): CSS hides the summary marker + disables toggling (`pointer-events: none` on summary) so nothing changes visually. <1024: summaries become tappable accordion headers; sections default CLOSED on mobile is NOT possible with a static `open` attr — set `open` from a `matchMedia('(min-width: 1024px)')` init in the component (one `useState` + resize-less init is fine; no live listener needed for MVP).
  - [x] 2.3 Listen desktop-only notice (UX-DR45): in `ListenRackPage.tsx`, CSS-only swap — a notice `.card` ("The Listen rack is a desktop tool — open this on a screen ≥1024 px wide.") rendered always but `display:none` ≥1024, while the `.lr-grid` gets `display:none` <1024 (add to `listenRack.css`). CSS-only = no hydration/matchMedia races. Keep the audio element OUT of the hidden grid consideration — simplest correct: hide the grid, show the card; do not mount-gate in JS (rack init already requires user gesture, so a hidden rack is inert).
  - [x] 2.4 Vitest: reduced-motion-test precedent (`styles/__tests__/reduced-motion.test.ts` string-asserts CSS) — add `listen-desktop-notice.test.ts` asserting listenRack.css carries the <1024 swap block, and assert both layout files collapse at 1024 (string match) — cheap regression locks.
- [x] Task 3 — Focus ring everywhere + lint (AC: 5)
  - [x] 3.1 Extend `global.css:94` to all interactives: `a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }`. Check dark ring visibility on the few light surfaces (UpgradeSheet?) — cyan on dark theme is the product norm.
  - [x] 3.2 Audit the 10 `outline: none` sites: each either (a) deletes the rule (global focus-visible now covers it), or (b) keeps it for mouse-focus suppression BUT pairs a `:focus-visible` replacement in the same file. Most are input restyles — verify each has a visible focused state after the change (some use border/box-shadow focus already).
  - [x] 3.3 `scripts/check-focus-ring.mjs` (model on `check-css-tokens.mjs`): walk `src/**/*.css` (ALL css — module + redesign.css + global.css, exempting `tokens.css`); fail when a file contains `outline:\s*(none|0)` unless the SAME file also contains a `:focus-visible` block declaring `outline:` (non-none) or `box-shadow`. Wire `"lint:focus": "node scripts/check-focus-ring.mjs"` in package.json + a CI step after `lint:prices` (`ci.yml` frontend job).
- [x] Task 4 — `/dev/kitchen-sink` (AC: 4)
  - [x] 4.1 `src/routes/_app/dev.kitchen-sink.tsx` — component returns `null` (or a 'dev only' stub) when `!import.meta.env.DEV` (the flag, per DebugTab precedent; route file itself is harmless in prod builds since content is DEV-gated and tree-shaken).
  - [x] 4.2 Inventory sections (each a `.card` with `.label` header): (a) utility classes — every `.pill` tone, `.dot` tone, `.btn` variant incl. disabled, `.label`, `.mono`, `.card` anatomy; (b) `src/ui/` primitives with fixture props — `GradePill` (all grades), `Pill`, `ProgressTimeline` (fixture timeline), `VersionArc`, `Coach`, `SpecialistBot`, `BrandMark`, `CoverArt`, `SongVisual`; (c) shared bits — `TierChip` (all tiers), `UsageMeter` (fixture), `VerifyEmailBanner` (static render), `DegradationBanner`-shape banner (static markup or the real one behind a QueryClient — static markup fine, it's a visual surface); (d) a focus-order strip — a row of button/link/input/summary interactives for manual tab-ring verification. Skip provider-heavy dialogs (no Storybook ambitions — UX-DR46).
  - [x] 4.3 Section anchors + a mini TOC so axe/visual audits can deep-link.
- [x] Task 5 — axe-core CI smoke (AC: 2)
  - [x] 5.1 Add devDeps: `axe-core` + `vitest-axe` (in-spec — the AC names axe-core). Wire `vitest-axe/extend-expect` in the test setup (or per-file import; match existing vitest config — there is no global setup file today, so per-file import is the low-touch path).
  - [x] 5.2 `src/features/results/__tests__/report-axe.test.tsx` — **the report route surface** (AC2): render the report's composition with fixture data under `QueryClientProvider` + stubbed `fetch` (DegradationBanner.test pattern). If full `ReportView` proves un-renderable in jsdom (TanStack Router hooks need a router wrapper — try `createRouter`+memory history first; SharePublishDialog/resume-card tests show provider patterns), fall back to axing the report's major sections individually (`SongHeader`, `ResultsTabs`, `FindingsTab`, `TrackInfoTab`, `DegradationBanner`) and NOTE the deviation in the story record — the AC's substance is "the report surface passes AA", not "one monolithic render".
  - [x] 5.3 `src/routes/__tests__/kitchen-sink-axe.test.tsx` — axe the kitchen-sink inventory (it exists to BE the a11y audit surface) + `login` form markup. Known axe/jsdom caveats: color-contrast rule needs real layout — run axe with `rules: { 'color-contrast': { enabled: false } }` (jsdom has no paint; document this in the test header) — remaining AA rules (names/roles/labels/order/aria) all work in jsdom.
  - [x] 5.4 These run inside the existing `npx vitest run` CI step — no workflow edit needed beyond the Task 3.3 lint step.
- [x] Task 6 — Gates + record
  - [x] 6.1 Frontend: `npx vite build` (regenerates routeTree with the new route) → `npx tsc -b` → `npm run lint` (max-warnings 0) → `lint:css` → `lint:prices` → **`lint:focus`** → `npx vitest run`.
  - [x] 6.2 No BFF/worker/analysis changes expected — do NOT touch other components; if something seems to need it, stop and re-scope.
  - [x] 6.3 Update Dev Agent Record + File List; CI step addition (`lint:focus`) verified in `.github/workflows/ci.yml`.

## Dev Notes

- **No new runtime deps.** Palette is hand-rolled (Radix Dialog allowed — already a stack member). axe-core/vitest-axe are devDeps named by the AC.
- **`verbatimModuleSyntax`**: `import type` for all type-only imports. CSS Modules + tokens; the notice card and palette reuse `.card`/`.btn`/`.label` utilities where possible.
- **Don't break the anon funnel**: keyboard layer mounts in `_app` only; `_public` routes (landing, /analyze, login) must not register listeners.
- **routeTree.gen.ts is generated** — never hand-edit; `vite build` FIRST in the gate order (memory: tsc -b needs the generated tree).
- **Windows dev**: all-frontend story; no venv/docker needed. BFF/postgres not required for gates.
- **UX-DR45 dialogs full-sheet <768 is NOT in AC3** — out of scope, don't drift into it.
- **Previous-story intelligence (5-7, same day)**: review layers hammer (a) client-gated behavior that should be server/system-derived, (b) state not keyed to route params on param-only navigation (palette/sheet open state must reset or close on navigate — close on `useNavigate` commit), (c) untested declared scenarios — every checkbox in Task lists must exist in the diff.
- **Keyboard edge cases the reviewer will hunt**: shortcut firing while a dialog is already open (palette over upload dialog — decide: Esc closes topmost only; ⌘K while upload open should no-op or be allowed — pick no-op when any modal is open, simplest); `?` requires shift — check `e.key === '?'` not keyCode; IME composition (`e.isComposing` — skip); repeated keydown (`e.repeat` — skip).

### Key file map

| Area | Files |
|------|-------|
| Shell + listener | `src/routes/_app.tsx` (AppLayout) |
| Palette/sheet | `src/components/CommandPalette.tsx` + `.module.css`, `src/components/ShortcutSheet.tsx` + `.module.css`, `src/lib/shortcuts.ts` |
| Upload host | `src/components/UnifiedUploadDialog.tsx` (unchanged), AppLayout mount |
| Responsive | `features/results/ReportView.module.css`, `features/results/redesign.css`, `features/results/RackSidebar.tsx`, `features/listen-rack/listenRack.css`, `ListenRackPage.tsx` |
| Focus | `src/styles/global.css:94`, the 10 audit files, `scripts/check-focus-ring.mjs`, `package.json`, `.github/workflows/ci.yml` |
| Kitchen sink | `src/routes/_app/dev.kitchen-sink.tsx` (+ module css) |
| Axe | `src/features/results/__tests__/report-axe.test.tsx`, `src/routes/__tests__/kitchen-sink-axe.test.tsx`, `package.json` devDeps |

## Senior Developer Review (AI)

**Date:** 2026-07-15 · **Outcome:** Changes Requested → all action items resolved same session · **Layers:** Blind Hunter + Edge Case Hunter + Acceptance Auditor. Auditor AC verdicts pre-patch: 5/5 MET (AC2 via sanctioned deviation), plus hardening findings.

### Action Items (all resolved)

- [x] [HIGH][blind+edge+auditor] Desktop rail accordion keyboard-collapsible (pointer-events blocks mouse, not Enter/Space) + init-only matchMedia stranded it collapsed after mobile→desktop rotation. → live `matchMedia('(min-width:1024px)')` listener; desktop = forced-open controlled `open` + `tabIndex={-1}` summary + onClick preventDefault; mobile keeps user fold state (starts folded).
- [x] [HIGH][blind+edge] Global shortcuts stacked surfaces over the ~17 page-local Radix dialogs (⌘U over an open upload dialog = two stacked upload flows). → DOM probe `[role="dialog"],[role="alertdialog"]` — no shortcut opens anything while ANY modal is open.
- [x] [HIGH][blind+auditor] Ctrl+Shift+K / Cmd+Shift+U hijacked (Firefox console etc). → `shiftKey` added to the matrix; k/u require no-shift. Also: `e.code` fallback (KeyK/KeyU) for non-Latin layouts; editable-suppression refined (checkbox/radio/range/button inputs no longer swallow chords; `plaintext-only` contenteditable now suppressed).
- [x] [MED][blind+edge] ⌘K couldn't close the palette (focus in its own input → suppressed; toggle dead code). → explicit close special-case before matchShortcut.
- [x] [MED][blind] `[tabindex]:focus-visible` ringed whole Radix dialogs (Content has tabindex=-1). → `:not([tabindex='-1'])`.
- [x] [MED][blind] Always-mounted palette subscribed every route to the songs query. → `useSongs(enabled)` param; palette passes `open`.
- [x] [MED][edge] Palette surfaced archived songs the library hides. → `archivedAt == null` filter in filterCommands (+ test).
- [x] [MED][edge] Right/middle-click committed palette items. → `e.button !== 0` guard.
- [x] [MED][blind+edge] Listen <1024: audio kept playing behind the notice (display:none ≠ pause); live-room bar + TrackHeader stayed operable. → matchMedia pause-all effect (media element + pitch lane + stem deck) on crossing below; header/room controls wrapped in `.lr-desktop-only` hidden with the grid.
- [x] [MED][blind+edge] Lint holes: `outline:none !important` escaped; `:focus-within`/`box-shadow:none` counted as replacements. → regex hardened; file-scope (not selector-paired) limit documented as a KNOWN LIMIT comment.
- [x] [MED][blind+auditor] Responsive test asserted less than its comment claimed. → 900px-absence asserted for all three files.
- [x] [LOW][blind] preventDefault fired on no-op'd shortcuts. → guards decided before preventDefault; blocked chords keep browser behavior.
- [x] [LOW][blind+edge] ArrowDown on empty list → activeIndex -1; songs-load didn't reclamp. → clamp effect on `commands.length`.
- [x] [LOW][blind] Kitchen-sink `role="button"` span with no activation handler. → role removed (plain focusable demo target). Also `aria-autocomplete="list"` added; empty-state moved outside the listbox.

### Accepted / declared (not patched)

- **Login-form axe coverage (auditor F1, task 5.3)**: NOT delivered — `login.tsx` needs a live router (useNavigate at top level), same constraint as ReportView. Declared here honestly instead of a hollow PublicChrome-only claim. UX-DR44 debt: axe for login/share/billing routes when a router-mounting test harness exists.
- Hover/keyboard listbox fight in the palette (blind LOW): classic tradeoff, unmitigated — cosmetic.
- Dev route registered in prod route tree (blind LOW): runtime DEV gate renders a stub only; matches DebugTab precedent. "Tree-shake" wording in the route comment is loose but the surface is inert.
- 901–1023px Listen users get the notice instead of the old stacked rack (blind QUESTION): UX-DR45's explicit mandate ("Listen desktop-only with notice card <1024") — spec decision, not a regression.
- `lint:focus` not folded into `npm run lint` (blind LOW): matches the lint:css/lint:prices pattern (separate scripts, separate CI steps).

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- None significant — all gates green on first full run after the vitest-axe removal.

### Completion Notes List

- **AC1**: hand-rolled `CommandPalette` (Radix Dialog, no cmdk dep) — nav commands + client-side song search over the cached `useSongs` query; combobox/listbox semantics, arrow/Enter/Esc. `ShortcutSheet` static dialog. One window keydown listener in AppLayout; decision matrix extracted to pure `src/lib/shortcuts.ts` (`matchShortcut` handles ⌘/Ctrl, repeat, IME, alt, editable-target suppression). One-modal-at-a-time policy: a shortcut never opens a surface over another open one. Global `UnifiedUploadDialog` mount in AppLayout (new-song mode); the two page-local mounts untouched. The 12.5 "⌘K is GONE" comment replaced — the palette now has real machinery.
- **AC2 — DEVIATION (per task 5.2's sanctioned fallback)**: full `ReportView` needs a live TanStack Router that this repo's jsdom tests never mount; the axe pass runs over the report's composed major sections (SongHeader + ResultsTabs + DegradationBanner in one container; FindingsTab + TrackInfoTab + ProjectUnlock in another) — same DOM the route renders minus router chrome. Also axed: kitchen-sink inventory, landing, pricing (funnel AA routes; router-free by design since 6.1). `color-contrast` rule disabled — needs real paint, jsdom has none (documented in both test headers). Used `axe-core` directly; dropped `vitest-axe` after it proved unnecessary (would have been an unused dep).
- **AC3**: report layout collapse moved 900→1023.98px in both layout files; rail card converted to `<details>`/`<summary>` — inert (marker hidden, pointer-events none) ≥1024, tap-to-fold accordion below; init-open state from a one-shot `matchMedia('(min-width: 1024px)')`. Listen: CSS-only swap — `.lr-grid` hides <1024, `.lr-desktop-notice` card shows (no matchMedia races; the hidden rack is inert since AudioContext needs a user gesture). Listen's 900px query kept ONLY as removed — replaced by the 1024 swap.
- **AC4**: `src/routes/_app/dev.kitchen-sink.tsx` (DEV-gated content, DebugTab precedent; `KitchenSinkPage` exported for the axe test, PricingPage precedent). Sections: utility classes, ui/ primitives with fixtures, meters/chips/banner anatomy (static banner demo — the live one needs providers), focus-order strip with mixed element types. TOC anchors.
- **AC5**: global focus rule extended `button` → `a/button/input/select/textarea/summary/[tabindex]`. Audit of all 10 `outline:none` sites: 6 already had compliant replacements; 4 patched (analyze.module registerInput, reports.module filterInput, BookmarksRail noteInput — had NO focus style at all, redesign.css coach-input). New `scripts/check-focus-ring.mjs` (scans ALL src css except tokens.css, incl. global.css/redesign.css — wider than lint:css's module-only scan, deliberately): `outline:none|0` requires a same-file `:focus/:focus-visible` with box-shadow/border-color/non-none outline. Wired `lint:focus` npm script + CI step. Regex verified in both directions (flags violations, passes compliant files).
- Gates: vite build ✓, tsc -b ✓, eslint 0 warnings ✓, lint:css ✓, lint:prices ✓, **lint:focus ✓ (new)**, vitest **844/844** (+9 shortcuts, +3 responsive locks, +2 report-axe, +3 funnel/kitchen-sink axe). No BFF/worker/python changes.

### File List

- components/frontend-spectr-v2/src/lib/shortcuts.ts (new) + src/lib/__tests__/shortcuts.test.ts (new)
- components/frontend-spectr-v2/src/components/CommandPalette.tsx + .module.css (new)
- components/frontend-spectr-v2/src/components/ShortcutSheet.tsx + .module.css (new)
- components/frontend-spectr-v2/src/routes/_app.tsx (listener + palette/sheet/upload mounts + comment update)
- components/frontend-spectr-v2/src/features/results/ReportView.module.css + redesign.css (1024 collapse; redesign also accordion CSS + coach-input focus ring)
- components/frontend-spectr-v2/src/features/results/RackSidebar.tsx (details/summary accordion)
- components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx + listenRack.css (desktop-only notice swap)
- components/frontend-spectr-v2/src/styles/global.css (focus rule extended) + __tests__/responsive-1024.test.ts (new)
- components/frontend-spectr-v2/src/features/anon-analyze/analyze.module.css, src/routes/_app/reports.module.css, src/features/listen/BookmarksRail.module.css (focus replacements)
- components/frontend-spectr-v2/scripts/check-focus-ring.mjs (new); package.json (lint:focus + axe-core devDep); package-lock.json
- components/frontend-spectr-v2/src/routes/_app/dev.kitchen-sink.tsx + .module.css (new)
- components/frontend-spectr-v2/src/features/results/__tests__/report-axe.test.tsx (new); src/routes/__tests__/kitchen-sink-axe.test.tsx (new)
- .github/workflows/ci.yml (lint:focus step)
- PRPs/stories/5-10-product-a11y-keyboard-and-kitchen-sink.md, PRPs/sprint-status.yaml (tracking)
