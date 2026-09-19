# Solo Fork — Strip All User-to-User Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `solo` branch into a single-user tool: delete every feature, endpoint, table, string and leak through which a visitor could see, or infer anything about, another user or overall site load.

**Architecture:** Outside-in deletion by layer — frontend consumers first, then BFF endpoints/services, then worker + Python model mirror, then one EF migration (`RemoveSocial`) once nothing references the tables, then infra/CI/docs. Guard tests are written (skipped) at the start of each layer, observed failing, and un-skipped as that layer's exit gate. Every commit leaves every gate green.

**Tech Stack:** ASP.NET Core .NET 10 + EF Core 10 + xUnit (`components/bff`); React 19 + Vite 6 + TS strict + TanStack Router + vitest (`components/frontend-spectr-v2`); Python 3.11 dramatiq worker + SQLAlchemy mirror (`components/worker`, `components/shared`); Caddy + GitHub Actions (`infra/`, `.github/`).

**Spec:** `PRPs/solo-fork-strip-social.md` — read it first. This plan argues from it; where they disagree the spec wins and the plan gets fixed.

## Global Constraints

- **Worktree:** all work happens in `C:/Users/badmin/projects/spectr-solo` on branch `solo`. NEVER touch `C:/Users/badmin/projects/AIMusicAnalysisSite` (it holds another session's uncommitted README work) and never commit to `master` except Task 17 Step 1, which needs Brian's explicit go-ahead.
- **The test for every judgment call:** _could a visitor learn anything about another account, or about how busy the site is, from this surface?_ If yes, it goes.
- **Delete, don't disable.** No feature flags, no `if (false)`, no always-true capability objects, no commented-out code, no `// removed` markers. In mixed files remove the social branch and simplify what is left.
- **Do not change audio/DSP behaviour.** `features/listen/useAudioGraph.ts`, `audio/**`, rack state, presets/drafts, pitch, stems, meters are out of scope.
- **Keep:** anon `/analyze` funnel (`DeviceService`, `Anon:SigningKey` config key), billing, `/api/admin/*`, `DemoSeeder`, coach, specialists, stems, .als, references, rack presets/drafts, session notes, compare, game plan, `IRateLimiter`, `IPresetGenerator`, the `notifications` TABLE (it is the lifecycle-email send ledger).
- **Frontend rules (CLAUDE.md):** TS strict + `verbatimModuleSyntax` (`import type`), CSS Modules + tokens, no inline styles unless dynamic, no new deps.
- **Frontend gates (all four, from `components/frontend-spectr-v2`):** `npm run build` (= `vite build && tsc -b`; the vite step regenerates `src/routeTree.gen.ts`, so run it FIRST after deleting route files), `npm run lint`, `npx vitest run`. `npx tsc -b` — never `--noEmit`.
- **BFF gates (from `components/bff`):** `dotnet build && dotnet test`. Stop any running BFF first (Windows locks `Spectr.Bff.exe`).
- **Python gates (from repo root):** `pytest -q components/worker/tests/ components/shared/tests/ components/analysis/tests/`, `ruff check components/analysis/src/ components/worker/ components/shared/`, `mypy components/worker/app/ --ignore-missing-imports`.
- **Stack start/stop:** only via `docs/STARTUP.md` (`./scripts/start-spectr.ps1`, `-StopOnly`). Bare `docker` is shadowed by a 0-byte file on this machine — resolve `docker.exe` explicitly (STARTUP.md §6).
- **Commits:** one per task (or per step where stated), message `refactor(solo): <what>` / `test(solo): …` / `docs(solo): …`, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never `--no-verify`. **Do not push** until Task 17.
- **Line numbers in this plan** were read on `solo` @ `2e62ca4` on 2026-09-19. Re-grep before editing; symbols are authoritative, line numbers are hints.

---

## File structure (what exists after the plan)

New files:
- `components/frontend-spectr-v2/src/routes/__tests__/no-social-surface.test.ts` — route allowlist + banned-phrase scan.
- `components/frontend-spectr-v2/src/features/listen-rack/types.ts` — `ReportRef`, `StatsSource` (moved out of the deleted `rail.tsx`).
- `components/frontend-spectr-v2/src/features/listen-rack/NotesSidebar.tsx` — replaces `SessionSidebarV2.tsx` (notes only).
- `components/bff/tests/Spectr.Bff.Tests/NoSocialSurfaceTests.cs` — endpoint-prefix ban + anonymous allowlist + DTO leak checks.
- `components/bff/src/Spectr.Data/Migrations/<timestamp>_RemoveSocial.cs` (+ `.Designer.cs`, snapshot update).
- `PRPs/archive/2026-09-19_social-epic/` — archived social vision/epic/story docs.

Everything else is deletion or in-place surgery, listed per task.

---

### Task 0: Workspace + baseline

**Files:** nothing is committed in this task — it only prepares the environment (git-ignored `.env` files, Python installs, `node_modules`).

**Interfaces:**
- Produces: a worktree where all gates run, Python imports resolve to `spectr-solo`, and a recorded baseline of test counts.

- [ ] **Step 1: Confirm location and branch**

```bash
cd C:/Users/badmin/projects/spectr-solo && git branch --show-current && git log --oneline -2
```
Expected: `solo`; top commits are the two `docs(prp): solo fork …` commits on top of `2e62ca4`.

- [ ] **Step 2: Copy untracked local config from the main checkout (read-only copy, never edit the source)**

```bash
cp C:/Users/badmin/projects/AIMusicAnalysisSite/.env C:/Users/badmin/projects/spectr-solo/.env
cp C:/Users/badmin/projects/AIMusicAnalysisSite/components/worker/.env C:/Users/badmin/projects/spectr-solo/components/worker/.env
git -C C:/Users/badmin/projects/spectr-solo status --short   # expect: nothing (both are git-ignored)
```

- [ ] **Step 3: Point storage at the existing audio library**

The BFF resolves `Storage:LocalRoot` relative to its csproj (`../../../../data` → `spectr-solo/data`, which is empty). Append to `spectr-solo/.env` and `spectr-solo/components/worker/.env` (both git-ignored):

```
STORAGE_LOCAL_ROOT=C:/Users/badmin/projects/AIMusicAnalysisSite/data
Storage__LocalRoot=C:/Users/badmin/projects/AIMusicAnalysisSite/data
```
If `docs/STARTUP.md` §6 "storage-root misconfig" names a different variable, use that one and note it in the task report.

- [ ] **Step 4: Re-point the editable Python installs at this worktree**

They currently resolve to the main checkout, which would make the solo worker import the OLD models (and crash on dropped columns after Task 14).

```bash
cd C:/Users/badmin/projects/spectr-solo
pip install -e components/shared && pip install -e components/analysis
python -c "import aimusic_shared, audio_analysis; print(aimusic_shared.__file__); print(audio_analysis.__file__)"
```
Expected: both paths start with `C:\Users\badmin\projects\spectr-solo\`. (Reversible: re-run the same two installs from another checkout.)

- [ ] **Step 5: Install frontend deps**

```bash
cd components/frontend-spectr-v2 && npm ci
```

- [ ] **Step 6: Record the baseline (all must be green before any deletion)**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npm run build && npm run lint && npx vitest run 2>&1 | tail -5
cd C:/Users/badmin/projects/spectr-solo/components/bff && dotnet build 2>&1 | tail -3 && dotnet test 2>&1 | tail -5
cd C:/Users/badmin/projects/spectr-solo && pytest -q components/worker/tests/ components/shared/tests/ 2>&1 | tail -3
```
Write the pass/skip counts into the task report. Known flake: `CoachStreamEndpointTests.Client_Disconnect_Sets_Cancel_Key_In_Redis` (timing) — re-run once before treating it as real. If anything else is red at baseline, STOP and report; do not start deleting on a red tree.

---

## Phase 1 — Frontend

All paths in this phase are relative to `components/frontend-spectr-v2/src/`.

### Task 1: Frontend guard tests (written, observed red, committed skipped)

**Files:**
- Create: `routes/__tests__/no-social-surface.test.ts`

**Interfaces:**
- Produces: two `describe.skip` suites that Task 6 un-skips. Later tasks may run them with `npx vitest run src/routes/__tests__/no-social-surface.test.ts` after temporarily changing `describe.skip` → `describe` locally (do not commit that change before Task 6).

- [ ] **Step 1: Write the test**

```ts
/* Solo fork guard — SPECTR ships as a single-user tool. These tests fail if a
 * route or phrase that reveals other users (or site load) comes back.
 * Rule: when one fails, fix the SOURCE. Only edit the lists below for a hit
 * that is provably not about other users, and say why in the commit. */
import { describe, expect, it } from 'vitest';

const ROUTE_FILES = Object.keys(import.meta.glob('../**/*.tsx'))
  .filter((p) => !p.includes('__tests__'))
  .map((p) => p.replace(/^\.\.\//, ''))
  .sort();

const ALLOWED_ROUTE_FILES = [
  '__root.tsx',
  '_app.tsx',
  '_app/billing.success.tsx',
  '_app/billing.tsx',
  '_app/dev.kitchen-sink.tsx',
  '_app/library.tsx',
  '_app/listen-rack.$versionId.tsx',
  '_app/profile.tsx',
  '_app/reports.tsx',
  '_app/songs.$songId.results.$jobId.tsx',
  '_app/songs.$songId.tsx',
  '_app/usage.tsx',
  '_public.tsx',
  '_public/billing.cancelled.tsx',
  '_public/forgot-password.tsx',
  '_public/login.tsx',
  '_public/register.tsx',
  '_public/reset-password.tsx',
  '_public/verify-email.tsx',
  'analyze.tsx',
  'index.tsx',
  'pricing.tsx',
  'trust.index.tsx',
  'trust.no-training.tsx',
  'trust.privacy.tsx',
  'trust.results-forever.tsx',
].sort();

describe.skip('solo guard — route surface', () => {
  it('has exactly the single-user route files', () => {
    expect(ROUTE_FILES).toEqual(ALLOWED_ROUTE_FILES);
  });
});

const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const BANNED: Array<[label: string, re: RegExp]> = [
  ['follower counts', /\bfollowers\b/i],
  ['follow CTA', /Follow @|useFollow\b/],
  ['bookmark digest copy', /people bookmarked|person bookmarked/i],
  ['live room copy', /LIVE ROOM|Open in Room|Start live room|FOLLOWING HOST/],
  ['room plumbing', /\buseRoom[A-Z]\w*|ROOM_LISTENERS|RoomLiveSeam|roomStateReducer/],
  ['fake listener identities', /@vela\b|@forge\b|anon-river|Mae Karlsson/],
  ['publish/share UI', /★ Publish|SharePublishDialog|VersionShareDialog/],
  ['share tokens', /shareToken|share_token|sharePublish/],
  ['discovery', /Profiles to discover|Needs ears/i],
  ['global queue depth', /queueDepth|jobs? waiting|jobs? queued/i],
  ['shared-IP rate-limit copy', /from this network/i],
  ['feed route', /['"`]\/feed['"`/?]/],
  ['public profile route', /['"`]\/u\//],
  ['share routes', /['"`]\/(r|v|invite)\/\$/],
  ['visibility model', /SongVisibility|VIS_META|Listed \+ discoverable/],
  ['handle UI', /normalizeHandleInput|Handle is already taken/],
];

describe.skip('solo guard — banned phrases in shipped source', () => {
  const files = Object.entries(SOURCES).filter(
    ([path]) => !path.includes('__tests__') && !/\.test\.tsx?$/.test(path)
      && !path.endsWith('routeTree.gen.ts'),
  );

  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it.each(BANNED)('no %s', (_label, re) => {
    const hits = files.filter(([, text]) => re.test(text)).map(([path]) => path);
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Prove both suites can fail**

Temporarily change both `describe.skip` to `describe`, then:

```bash
cd components/frontend-spectr-v2 && npx vitest run src/routes/__tests__/no-social-surface.test.ts 2>&1 | tail -60
```
Expected: FAIL. The route test lists `_app/feed.tsx`, `_app/invite.$token.tsx`, `_public/r.$token.tsx`, `_public/u.$handle.tsx`, `_public/v.$token.tsx` as unexpected. Most banned-phrase cases fail and print offending paths — **paste that path list into the task report**; it is the authoritative to-do list for Tasks 2–5. If a case PASSES now, its regex is wrong (nothing to catch) — fix the regex until it fails, except `shared-IP rate-limit copy` (BFF-only string; expected to pass).

- [ ] **Step 3: Restore `describe.skip`, run gates, commit**

```bash
cd components/frontend-spectr-v2 && npx tsc -b && npm run lint && npx vitest run src/routes/__tests__/no-social-surface.test.ts
git add src/routes/__tests__/no-social-surface.test.ts
git commit -m "test(solo): frontend no-social-surface guard (skipped until the strip lands)"
```

---

### Task 2: Delete social routes, feed / profiles / mentions / notifications, and their nav entries

**Files:**
- Delete: `routes/_app/feed.tsx`, `routes/_app/invite.$token.tsx`, `routes/_public/r.$token.tsx`, `routes/_public/r.module.css`, `routes/_public/v.$token.tsx`, `routes/_public/u.$handle.tsx`
- Delete (whole folders, incl. `__tests__`): `features/feed/`, `features/profiles/`, `features/mentions/`, `features/notifications/`
- Delete: `features/listen/AnonReviewerSurface.tsx`, `features/listen/ProducerCta.tsx`, `features/listen/useAnonFeedback.ts`, `features/listen/__tests__/anon-reviewer-surface.test.tsx`, `features/listen/__tests__/producer-cta.test.tsx` (only the deleted public pages used them)
- Modify: `routes/_app.tsx` (Feed tab + `<NotificationBell>`), `lib/shortcuts.ts` (`nav-feed`), `routes/_public.tsx` (comment mentioning `/r/$token`), any test asserting the Feed nav entry or bell
- Regenerated: `routeTree.gen.ts`

- [ ] **Step 1: Delete files**

```bash
cd components/frontend-spectr-v2/src
git rm -r -q routes/_app/feed.tsx "routes/_app/invite.\$token.tsx" "routes/_public/r.\$token.tsx" routes/_public/r.module.css "routes/_public/v.\$token.tsx" "routes/_public/u.\$handle.tsx" features/feed features/profiles features/mentions features/notifications
git rm -q features/listen/AnonReviewerSurface.tsx features/listen/ProducerCta.tsx features/listen/useAnonFeedback.ts features/listen/__tests__/anon-reviewer-surface.test.tsx features/listen/__tests__/producer-cta.test.tsx
```

- [ ] **Step 2: Remove nav entries**

In `routes/_app.tsx`: delete the `NotificationBell` import and its JSX mount; delete the topnav `Feed` `<Link>` (comment "Story 11.10 — followed-users activity feed"). Leave Report / Library and the account menu untouched.
In `lib/shortcuts.ts`: delete the `{ id: 'nav-feed', label: 'Feed', to: '/feed' }` entry from `NAV_COMMANDS`.
In `routes/_public.tsx`: reword the header comment so it no longer mentions share-link reviewer pages.

- [ ] **Step 3: Find and fix every dangling reference**

```bash
cd components/frontend-spectr-v2 && npm run build 2>&1 | grep -E "error TS|Cannot find" | head -40
grep -rn -E "features/(feed|profiles|mentions|notifications)|NotificationBell|nav-feed|to=\"/feed\"|'/feed'|/u/\\$|AnonReviewerSurface|ProducerCta|useAnonFeedback" src | grep -v routeTree.gen.ts
```
Fix each hit by removing the import/usage (tests for `lib/shortcuts` and the app shell may assert the Feed command/bell — delete those assertions, keep the rest of the test).

- [ ] **Step 4: Gates + commit**

```bash
cd components/frontend-spectr-v2 && npm run build && npm run lint && npx vitest run 2>&1 | tail -5
git add -A . && git commit -m "refactor(solo): remove feed, public profiles, mentions, notification bell and share/invite routes"
```
Expected: build regenerates `routeTree.gen.ts` without the five routes; all gates green.

---

### Task 3: Remove publishing, sharing and visibility from the library and song console

**Files:**
- Delete: `components/SharePublishDialog.tsx`, `components/__tests__/SharePublishDialog.test.tsx`
- Modify: `features/song/SongConsole.tsx` (import L23, `publishOpen` state L58, `onPublish` L284-290, dialog mount L339-341), `features/song/SongHeader.tsx` (`onPublish` prop L11/L24, "★ Publish" button L52), `features/song/VersionRowMenu.tsx` ("◬ Open in Room" item L38 + its handler/prop), `features/song/__tests__/song-console.test.tsx`
- Modify: `features/library/library-helpers.ts` (`VIS_META`, `VIS_ORDER`, shared/public entries in `FILTERS`), `features/library/SongsLibrarySection.tsx` (visibility badge, PATCH menu + submenu, filter pills), `components/SongEditDialog.tsx` (visibility select), `routes/_app/library.module.css` (visibility pill + submenu rules), `styles/tokens.css` (the "Per-song visibility state colors" block), `features/library/__tests__/library-helpers.test.ts`, `features/library/__tests__/SongsLibrarySection.test.tsx`
- Modify: `lib/attribution.ts` + `lib/__tests__/attribution.test.ts` + `routes/_public/register.tsx` (drop the `share_{token}` attribution source; keep the anon-funnel source)
- Modify: `api/hooks.ts` (delete `useCreateShare`, `usePatchShare`, `useRevokeShare`, `useRegenerateShare`, `useSharedAnalysis`, `useShareComments`, `usePostShareComment`), `api/types.ts` (delete `CreateShareResponse`, `PatchShareRequest`, `SharedAnalysisDto`, `ShareCommentDto`, `PostShareCommentRequest`, `SongVisibility`, `SongDto.visibility`, `PatchSongRequest.visibility`, `JobResultsDto.shareToken`)

**Interfaces:**
- Produces: `SongHeaderProps` without `onPublish`; `VersionRowMenu` without any room prop; `SongDto` without `visibility`.

- [ ] **Step 1: Delete the dialog and unwire the song console**

```bash
cd components/frontend-spectr-v2/src && git rm -q components/SharePublishDialog.tsx components/__tests__/SharePublishDialog.test.tsx
```
In `SongConsole.tsx` remove the import, the `publishOpen` state, the `onPublish={…}` prop passed to `<SongHeader>`, and the `<SharePublishDialog …/>` mount (including the "Analyze a version first — there's nothing to share yet." toast). In `SongHeader.tsx` remove `onPublish` from the props type + destructuring and delete the `<button className="btn violet sm" …>★ Publish</button>`. In `VersionRowMenu.tsx` delete the "◬ Open in Room" menu item and whatever prop/handler fed it; then remove that prop at every call site (`VersionRow.tsx`, `VersionList.tsx`, `SongConsole.tsx`).

- [ ] **Step 2: Remove visibility**

Delete `VIS_META`, `VIS_ORDER` and the visibility-based `FILTERS` entries from `library-helpers.ts`; delete the badge, the visibility menu/submenu and its PATCH mutation call, and the shared/public filter pills from `SongsLibrarySection.tsx`; delete the visibility `<select>`/field and its form state from `SongEditDialog.tsx`; delete the now-unused CSS rules and the visibility color tokens. Update the two library tests: remove visibility assertions, keep everything else.

- [ ] **Step 3: Trim attribution, hooks and types** as listed under **Files**.

- [ ] **Step 4: Sweep**

```bash
cd components/frontend-spectr-v2 && grep -rn -i -E "visibility|SharePublish|onPublish|shareToken|Open in Room|useCreateShare|useSharedAnalysis|share_" src --include=*.ts --include=*.tsx | grep -v -E "routeTree.gen|no-social-surface|visibility: ?(hidden|visible)|visibilitychange|document\.visibility"
```
Expected: no output. (CSS `visibility:` and the Page Visibility API are fine.)

- [ ] **Step 5: Gates + commit**

```bash
cd components/frontend-spectr-v2 && npm run build && npm run lint && npx vitest run 2>&1 | tail -5
git add -A . && git commit -m "refactor(solo): remove publish/share dialog, song visibility and Open-in-Room"
```

---

### Task 4: Strip the live room, access modes and guest path from the Listen rack

This is the riskiest task. Do not touch audio/rack/preset logic. `features/listen-rack/__tests__/carryOver.test.tsx`, `rack-draft-feedback.test.tsx` and `routes/__tests__/listen-rack-version-gate.test.tsx` are the safety net — adapt their props, never delete them.

**Files:**
- Create: `features/listen-rack/types.ts`, `features/listen-rack/NotesSidebar.tsx`
- Delete (`features/listen-rack/`): `useRoomOrchestration.ts`, `useMockRoomOrchestration.ts`, `roomStateReducer.ts`, `roomUiState.ts`, `transportSync.ts`, `sessionEvents.ts`, `suggest-draft.ts`, `SuggestModeChip.tsx`, `access.ts`, `capabilities.ts`, `identity.ts`, `rail.tsx`, `SessionSidebarV2.tsx`, and tests `roomStateReducer.test.ts`, `roomUiState.test.ts`, `transportSync.test.ts`, `rail.room.test.tsx`, `rail.plan.test.tsx`, `access.test.ts`, `identity.test.ts`, `capabilities.test.ts`, `__tests__/CommentsPanel.test.tsx`, `__tests__/SuggestModeChip.test.tsx`, `__tests__/suggest-draft.test.ts`, `__tests__/rail-honesty.test.tsx`
- Delete (`features/listen/`): `useRoomStream.ts`, `useRoomStream.test.ts`, `useRoomActions.ts`, `useRoomSession.ts`, `VersionShareDialog.tsx`, `__tests__/VersionShareDialog.test.tsx`, `useVersionShare.ts`, `useInvites.ts`, `useVersionAccess.ts`, `useSuggestions.ts`, `__tests__/useSuggestions.test.tsx`, `SuggestionCard.tsx`, `SuggestionCard.module.css`, `__tests__/SuggestionCard.test.tsx`, `suggestion-helpers.ts`, `__tests__/suggestion-helpers.test.ts`, `useBookmarks.ts`, `useBookmarks.test.ts`, `bookmarks-helpers.ts`, `__tests__/bookmarks-helpers.test.ts`, `BookmarksRail.tsx`, `BookmarksRail.module.css`, `__tests__/BookmarksRail.test.tsx`
  (NOT yet: `useComments.ts`, `comment-tree.ts`, `useBookmarkSignal.ts` — `NotesTab` still imports them; Task 5 removes them.)
- Modify: `routes/_app/listen-rack.$versionId.tsx`, `features/listen-rack/ListenRackPage.tsx`, `StageCardV2.tsx`, `viz.tsx`, `VisualsTabV2.tsx`, `data.ts`, `CoachTabV2.tsx` (type import), `listenRack.css`, `listen-rack-v2.css`, `listen-rack-v2-extras.css`, the three safety-net tests, `features/listen/__tests__/mutation-error-meta.test.tsx`, `api/mutation-error-toast.ts` (comment), `features/listen/README.md`, `features/listen-rack/PORTING_NOTES.md`

**Interfaces:**
- Produces:
  ```ts
  // features/listen-rack/types.ts
  export interface ReportRef { songId: string; jobId: string }
  export interface StatsSource { mismatch: boolean; versionNumber: number | null }

  // features/listen-rack/NotesSidebar.tsx
  export function NotesSidebar(props: {
    notes: TrackNote[]; activeNote: string | null; onNote: (n: TrackNote) => void;
  }): JSX.Element

  // features/listen-rack/ListenRackPage.tsx
  export interface ListenRackPageProps {
    versionId?: string; track?: Track; fixPreset?: string;
    reportRef?: ReportRef | null; statsSource?: StatsSource | null;
  }
  // TrackHeader props lose: mode, modes, identity, onModeChange, onShare
  ```

- [ ] **Step 1: Move the two live types out of `rail.tsx`**

Copy the exact `ReportRef` and `StatsSource` declarations from `rail.tsx` into the new `types.ts` (verify the field lists against `rail.tsx` — the block above is what the route constructs). Repoint the three importers: `routes/_app/listen-rack.$versionId.tsx`, `ListenRackPage.tsx`, `CoachTabV2.tsx` → `from './types'` / `'../../features/listen-rack/types'`.

- [ ] **Step 2: Create `NotesSidebar.tsx`**

Open `SessionSidebarV2.tsx`, take ONLY the markup of the `t === 'notes'` tab body and the card chrome around it, and build a component with the three props above. No tab strip (one tab is not a tab strip) — a card with a "Notes" label and count. Reuse the existing `lr-*` class names the notes list already uses. No `ROOM_LISTENERS`, `REACTION_GROUPS`, chat state, roster, `Pav`, `hueFor`, `LR_CHAT_SEED`.

- [ ] **Step 3: Simplify the route**

In `routes/_app/listen-rack.$versionId.tsx` delete: both orchestration imports + `ROOM_LIVE_SSE`, the `real`/`mock` hook calls and the `mode…onGrant` destructure, the `useAuthedVersionView` import + `guestViewQ`/`guestView`, the guest branch inside `useMemo` (`if (guestView) …` and the `guestView` dep). The loading/error gates become:

```tsx
  if (versionQ.isLoading) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
        <p className="mono" style={{ color: 'var(--muted)' }}>Loading version…</p>
      </div>
    );
  }
  if (versionQ.isError) {
    return <VersionErrorShell error={versionQ.error} onRetry={() => void versionQ.refetch()} />;
  }

  return (
    <ListenRackPage versionId={versionId}
      reportRef={reportRef} statsSource={statsSource}
      {...(fixPreset ? { fixPreset } : {})}
      {...(track ? { track } : {})} />
  );
```
`useNotes(version ? versionId : '')` stays as is. Rewrite the doc comment above the component (drop the "Mode / identity / room-control stay mocked" sentence).

- [ ] **Step 4: Surgery in `ListenRackPage.tsx`** (symbol map on `solo`, hints only)

Remove, in this order, re-running `npx tsc -b` between groups:
1. Imports: `VersionShareDialog` (L21), `./access` (L27), `resolveCapabilities` (L28), `REACTION_EMOJI`/`ROOM_LISTENERS`/`PresencePopItem`/`ReactionFeedItem` from `./data` (L31-33), `./identity` (L36), `actorKey` (L44), `roomHeaderState` (L45), `SessionSidebarV2` (L46), `./transportSync` (L49), `RoomLiveSeam` (L51); `noopHandler` (L60).
2. `TrackHeader`: drop props `mode`, `modes`, `identity`, `onModeChange`, `onShare`; delete `showSwitcher`, `surface`, the mode-button group and the Invite button. Update its header comment ("Invite + View report" → "View report").
3. Delete the whole `Pop` component.
4. `ListenRackPageProps` → the interface in **Interfaces**. Destructure only `{ versionId, track: trackProp, fixPreset, reportRef = null }`.
5. State: delete `pops`, `feed`, `myStatus`, `shareOpen`.
6. L264: the carry-over condition becomes `fixPreset && realAudio`. Delete `const cap`, `rackReadOnly`, `transportLocked` (L617-619) and replace every `rackReadOnly` use with its editable branch (then delete the dead read-only branch); if `RackTabV2`/`VisualsTabV2`/`CoachTabV2` take a `readOnly`-style prop that is now always false, remove that prop and its dead branch there too.
7. L367: `rs.savePreset(roomControl.rackHolder?.handle || 'you')` → `rs.savePreset('you')`; drop `roomControl.rackHolder` from the deps array.
8. Delete `roomLiveRef`, `isHostRef`, `meActorKey` (L435-437) and the host transport emitter (`emitTransport` + its calls at the end of play/pause/seek, e.g. `emitTransport('seek', t)` L614). `seek`/`togglePlay` keep their local behaviour; remove `emitTransport` from dep arrays.
9. Delete: the "Room mode: kick the auto program" effect (L540-543), `handleDrop`, `spawnPresence`, `spawnPresenceRef`, `spawnReaction`, the ambient mock-reactions effect (L546-577), `modeRef` if now unused, the listener-follow effect + `transportEvent` + `needsGesture` state + `joinPlayback` (L621-665), `grantControl`, `feedShown`, `reactHandler` (L667-694).
10. `onNote` (L737): `if (!transportLocked) seek(n.t);` → `seek(n.t);` and drop the dep.
11. JSX: remove the `onShare` spread on `<TrackHeader>` (L760) and its `mode/modes/identity/onModeChange` props; delete the entire `{mode === 'room' && (roomLive || onStartRoom) && (…)}` header block (L764-816); `onPlay={togglePlay}` / `onSeek={seek}` (L820-823); on `<StageCardV2>` remove `myStatus` and `onDrop` and the two children (pops overlay, tap-to-join) → self-closing; replace `<SessionSidebarV2 …/>` with `<NotesSidebar notes={track.notes} activeNote={activeNote} onNote={onNote} />`; delete the `<VersionShareDialog>` mount (L935-938).
12. Rewrite the file header comment: "Rack / Visuals / Coach tabs, notes sidebar"; drop "live room SSE" and the fork-to-suggest sentence.

- [ ] **Step 5: Remove the room bits from the stage/visuals layer**

`StageCardV2.tsx`: drop `myStatus`, `onDrop`, `children` props and their pass-through (L60-111). `viz.tsx`: delete `ListenersStage`, its `ROOM_LISTENERS` import, its case in the stage switch, and the `myStatus`/`onDrop` params that only fed it (follow the compiler). `VisualsTabV2.tsx`: the stage grid must no longer offer `room`/"Listeners". `data.ts`: delete `ROOM_LISTENERS`, `ROOM_REACTIONS`, `REACTION_GROUPS`, `REACTION_EMOJI`, the `{ id: 'room', label: 'Listeners' }` STAGES entry, `ReactionFeedItem`, `PresencePopItem`, the "Live collaboration shapes" section. CSS: delete `@keyframes presencePop`/`ringPulse` and the `.lr-people`, `.lr-pchip`, `.lr-react`, `.lr-msg`, `.lr-cin`, `.lr-pav` rules plus the "notes · chat · room" comment.

- [ ] **Step 6: Delete the files listed under Files**, then fix the three safety-net tests to the new prop shapes (remove `mode`/`identity`/… from their renders; delete assertions about mode switching or the Invite button; keep every rack/carry-over/version-gate assertion). In `listen-rack-version-gate.test.tsx` delete the guest-fallback cases and keep the 404/err-shell cases.

- [ ] **Step 7: Sweep**

```bash
cd components/frontend-spectr-v2 && grep -rn -E "roomLive|RoomLive|useRoom|ROOM_|ModeId|AccessDto|resolveCapabilities|Identity\b|RoomControl|SessionSidebarV2|VersionShareDialog|useInvites|useSuggestions|useBookmarks\b|BookmarksRail|transportLocked|presencePop|from '\./rail'" src | grep -v no-social-surface
```
Expected: no output.

- [ ] **Step 8: Rewrite the two docs** — `features/listen/README.md` title → "Shared Audio Engine" (delete the Social Hooks sections); `PORTING_NOTES.md` → delete the room-seam sections.

- [ ] **Step 9: Gates + commit**

```bash
cd components/frontend-spectr-v2 && npm run build && npm run lint && npx vitest run 2>&1 | tail -5
git add -A . && git commit -m "refactor(solo): listen rack is a private workbench — remove rooms, access modes, guest path, suggestions, bookmarks"
```

---

### Task 5: Notes tab, profile handle, trust copy, queue-depth copy, remaining DTOs

**Files:**
- Modify: `features/results/NotesTab.tsx`, `features/results/feedback-timeline-model.ts`, `features/results/__tests__/feedback-timeline-model.test.ts`, `features/results/ReportView.tsx` (tab badge ~L129)
- Delete: `features/listen/useComments.ts`, `features/listen/comment-tree.ts`, `features/listen/__tests__/comment-tree.test.ts`, `features/listen/useBookmarkSignal.ts`
- Modify: `routes/_app/profile.tsx` (+ `profile.module.css` `.handle` rule), `routes/trust.privacy.tsx`, `features/trust/__tests__/trust.test.tsx`
- Modify: `features/health/WorkerHealthBanner.tsx`, `features/health/AppWorkerHealthNotice.tsx`, `features/results/ProgressStoryline.tsx` (+ their tests)
- Modify: `api/hooks.ts` (delete `useBookmarks`/`useCreateBookmark`/`useDeleteBookmark`), `api/types.ts`, `routes/__tests__/kitchen-sink-axe.test.tsx` and `routes/_app/dev.kitchen-sink.tsx` if they render any deleted component

- [ ] **Step 1: Notes tab → notes only**

In `NotesTab.tsx` delete the `useComments`, `useBookmarks`, `useBookmarkSignal`, `useSessionHistory` calls and imports; delete the "Listener comments" section, the bookmark-signal meta line, and the Comments / Bookmarks / Reactions lanes of the timeline. Keep "Your notes" and the Notes lane. The timeline empty-state copy becomes: `Timestamped notes will land on this strip.` In `feedback-timeline-model.ts` delete `commentMarkers`, `bookmarkMarkers`, `recapEmojiEvents`, `threadComments`, `actorLabel` and their tests; keep the notes marker builder. In `ReportView.tsx` the Notes tab badge counts notes only (remove the comments query). If the tab is labelled "Notes/Feedback" anywhere, rename to "Notes". Then `git rm` the four `features/listen/` files.

- [ ] **Step 2: Profile**

In `profile.tsx` remove: the `handle` const + `handle` prop on `<Header>` and the `{handle && <span …>}` chip; the `handle` prop on `<SettingsTab>`; the Handle `<EditableField>` (L363-368); `normalizeHandleInput`; narrow `save`'s field type to `'displayName'`. Delete the `.handle` CSS rule.

- [ ] **Step 3: Trust/privacy copy**

In `trust.privacy.tsx` replace the share-link paragraphs (the "Nothing is public unless you explicitly share it" / "kills it immediately for everyone who has it" / "Comments and bookmarks that reviewers leave…" passages and the meta description) with:

> **Private by design.** Nothing you upload is visible to anyone else. SPECTR has no public pages, no profiles and no share links — your tracks, reports and notes are reachable only from your signed-in account.

Meta description: `Your uploads are private: no public pages, no profiles, no share links.` Update `trust.test.tsx` to assert the new heading text.

- [ ] **Step 4: Queue-depth copy**

`WorkerHealthBanner.tsx`: message becomes `Analysis worker offline — new analyses are paused. Retrying…` (delete the `N jobs waiting` fragment and the `queueDepth` prop). `AppWorkerHealthNotice.tsx`: stop passing it. `ProgressStoryline.tsx`: delete the `N jobs queued` fragment and the prop/variable feeding it. `features/health/DevHealthDot.tsx` (dev-only): stop reading/rendering queue depth too. `api/types.ts`: delete `queueDepth` from the worker-health type. Fix their tests. (The BFF stops sending the field in Task 11; the frontend must already not depend on it.)

- [ ] **Step 5: `api/types.ts` cleanup** — delete: `ShareSettingsDto`, `UpdateShareSettingsRequest`, `RotateTokenResponse`, `GatesDto`, `AccessDto`, `InviteDto`, `CreateInviteRequest`, `VersionViewDto`, `ActorRefDto`, `CommentDto`, `PostCommentRequest`, `PatchCommentStatusRequest`, `SuggestionDto`, `CreateSuggestionRequest`, `BookmarkDto`, `CreateBookmarkRequest`, `AnonBookmarkRequest`, `BookmarkSignalDto`, the entire room block (`SessionStatus` … `RecapPublishRequest`); remove `handle` from `AuthedUser`; remove `handle`, `bio`, `avatarHue`, `bannerHue`, `accent`, `publicLink` from `MeProfileDto` and `PatchMeProfileRequest`; remove `createdInSessionId`, `viaGrantId` (and `fromSuggestionId` if present) from `RackPresetDto`. Follow the compiler.

- [ ] **Step 6: Gates + commit**

```bash
cd components/frontend-spectr-v2 && npm run build && npm run lint && npx vitest run 2>&1 | tail -5
git add -A . && git commit -m "refactor(solo): notes-only feedback tab, no handle, private-by-design copy, no queue-depth copy"
```

---

### Task 6: Enable the frontend guard

**Files:** Modify `routes/__tests__/no-social-surface.test.ts`

- [ ] **Step 1:** change both `describe.skip` → `describe`.
- [ ] **Step 2:** `cd components/frontend-spectr-v2 && npx vitest run src/routes/__tests__/no-social-surface.test.ts`
  Expected: PASS. For every failure, fix the source file it names (rule in the test header). Legit residue you may meet: a code COMMENT mentioning rooms/sharing — delete or rewrite the comment.
- [ ] **Step 3:** full gates, then
```bash
git add -A . && git commit -m "test(solo): enable frontend no-social-surface guard"
```

---

## Phase 2 — BFF

Paths relative to `components/bff/`. Source root `src/Spectr.Bff/`, tests `tests/Spectr.Bff.Tests/`.

### Task 7: BFF guard test (written, observed red, committed skipped)

**Files:** Create `tests/Spectr.Bff.Tests/NoSocialSurfaceTests.cs`

- [ ] **Step 1: Write the test**

```csharp
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Spectr.Bff.Tests;

// Solo fork guard — SPECTR ships as a single-user tool. These fail if an
// endpoint that exposes, or implies, other users comes back. When one fails,
// remove the endpoint. Only extend an allowlist for a route that is provably
// single-user, and say why in the commit.
public sealed class NoSocialSurfaceTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const string SkipReason = "enabled in the final BFF task of the solo strip";

    private static string Norm(RouteEndpoint e)
    {
        var raw = e.RoutePattern.RawText ?? "";
        var s = (raw.StartsWith('/') ? raw : "/" + raw).TrimEnd('/').ToLowerInvariant();
        return s.Length == 0 ? "/" : s;
    }

    private List<RouteEndpoint> Routes() =>
        factory.Services.GetRequiredService<EndpointDataSource>()
            .Endpoints.OfType<RouteEndpoint>().ToList();

    // Substring matches on the normalized (lower-cased) pattern. NOTE "/api/u"
    // is matched EXACTLY below — as a fragment it would also hit /api/uploads
    // and /api/usage.
    private static readonly string[] BannedFragments =
    [
        "/api/u/", "/api/sessions", "/api/share", "/api/v/", "/r/{",
        "/api/me/feed", "/api/me/notifications", "/api/me/bookmarks",
        "/share", "/invites", "/access", "/view", "/sessions", "/comments",
        "/suggestions", "/bookmarks", "/follow",
    ];

    [SkippableFact(Skip = SkipReason)]
    public async Task No_Route_Matches_A_Removed_Social_Prefix()
    {
        await TestDb.RequireAsync(factory);
        var offenders = Routes().Select(Norm).Distinct()
            .Where(p => p == "/api/u"
                || BannedFragments.Any(f => p.Contains(f, StringComparison.Ordinal)))
            .OrderBy(p => p).ToList();
        Assert.True(offenders.Count == 0, "Social routes still mapped:\n" + string.Join("\n", offenders));
    }

    // Exact paths, or prefixes ending in '/'. Everything anonymous must be here.
    private static readonly string[] AnonymousAllowlist =
    [
        "/", "/pricing", "/analyze", "/trust/",
        "/healthz", "/metrics", "/openapi/",
        "/api/auth/", "/api/anon/",
        "/api/billing/plans", "/api/billing/stripe/webhook", "/api/email/webhook",
        "/api/health/", "/api/admin/", "/api/dev/",
    ];

    [SkippableFact(Skip = SkipReason)]
    public async Task Every_Anonymous_Endpoint_Is_On_The_Allowlist()
    {
        await TestDb.RequireAsync(factory);
        // Program.cs sets NO FallbackPolicy, so an endpoint is reachable
        // anonymously if it opts in (IAllowAnonymous) OR simply never asked
        // for authorization (no IAuthorizeData). Both count.
        var offenders = Routes()
            .Where(e => e.Metadata.GetMetadata<IAllowAnonymous>() is not null
                || e.Metadata.GetMetadata<IAuthorizeData>() is null)
            .Select(Norm).Distinct()
            .Where(p => !AnonymousAllowlist.Any(a =>
                a.EndsWith('/') && a.Length > 1 ? p.StartsWith(a, StringComparison.Ordinal) || p == a.TrimEnd('/') : p == a))
            .OrderBy(p => p).ToList();
        Assert.True(offenders.Count == 0, "Unexpected anonymous endpoints:\n" + string.Join("\n", offenders));
    }

    [SkippableFact(Skip = SkipReason)]
    public async Task Worker_Health_Does_Not_Expose_Global_Queue_Depth()
    {
        await TestDb.RequireAsync(factory);
        var body = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/health/worker");
        Assert.False(body.TryGetProperty("queueDepth", out _), "queueDepth leaks site-wide load to anonymous callers");
        Assert.True(body.TryGetProperty("healthy", out _));
    }

    [SkippableFact(Skip = SkipReason)]
    public async Task Registered_User_Payload_And_Token_Carry_No_Handle()
    {
        await TestDb.RequireAsync(factory);
        TestDb.Require(TestDb.RedisUp(factory), "Redis");
        var client = factory.CreateClient();
        var email = $"solo-guard-{Guid.NewGuid():N}@spectr.test";
        var resp = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "SoloGuard!2026-pw" });
        resp.EnsureSuccessStatusCode();
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();

        Assert.DoesNotContain("handle", json.GetRawText(), StringComparison.OrdinalIgnoreCase);

        var token = json.GetProperty("accessToken").GetString()!;
        var payload = token.Split('.')[1].Replace('-', '+').Replace('_', '/');
        payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
        var claims = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(payload));
        Assert.DoesNotContain("\"handle\"", claims, StringComparison.OrdinalIgnoreCase);
    }
}
```
Verified on `solo`: `RegisterRequest(string Email, string Password)` and `AuthResponse(string AccessToken, AuthedUser User)` — the payload and `accessToken` property above match `TestSupport.cs` L164-168. If the password fails the project's password policy, reuse the literal that `TestSupport`'s register helper uses.

- [ ] **Step 2: Prove it fails** — temporarily remove `Skip = SkipReason` from all four attributes:

```bash
cd components/bff && dotnet test --filter "FullyQualifiedName~NoSocialSurfaceTests" 2>&1 | tail -60
```
Expected: all four FAIL (stack must be up — Postgres + Redis — or they report SKIPPED, which proves nothing). **Paste the two offender lists into the task report**: they are the authoritative inventory for Tasks 8–11. Triage each offender now:
- A social route → leave it; Tasks 8–10 delete it.
- A legitimate single-user route tripping a **banned fragment** (e.g. a billing `…/portal/sessions`) → make the fragment more specific (`/versions/{versionid}/sessions`), never add an exception list.
- A legitimate single-user **anonymous** route missing from the allowlist → add it and say why in the commit. An authenticated-only route showing up here means it forgot `RequireAuthorization()` — that is a real bug: fix the endpoint, not the list.

- [ ] **Step 3: Restore the `Skip`, build, commit**

```bash
cd components/bff && dotnet build 2>&1 | tail -3
git add tests/Spectr.Bff.Tests/NoSocialSurfaceTests.cs && git commit -m "test(solo): BFF no-social-surface guard (skipped until the strip lands)"
```

---

### Task 8: Delete rooms, feedback (comments/suggestions), bookmarks, notification inbox

Order matters: these all depend on `AccessService`/`ActorRef`, which Task 9/10 delete — so they go first.

**Files:**
- Delete (`src/Spectr.Bff/`): `Endpoints/RoomEndpoints.cs`, `Endpoints/FeedbackEndpoints.cs`, `Endpoints/BookmarkEndpoints.cs`, `Endpoints/NotificationEndpoints.cs`, `Services/RoomBus.cs`, `Services/SessionTokenResolver.cs`, `Services/INotificationSink.cs`, `Services/TableNotificationSink.cs`, `Services/IGamePlanSink.cs`, `Services/MentionParser.cs`, `DTOs/RoomDtos.cs`, `DTOs/FeedbackDtos.cs`, `DTOs/BookmarkDtos.cs`
  (`FeedbackDtos.cs` holds `ActorRefDto`; if a file that survives this task still needs it, leave `ActorRefDto` in place and delete it in Task 9/10 when the compiler allows.)
- Delete (tests): `RoomEndpointsTests.cs`, `FeedbackEndpointsTests.cs`, `BookmarkVersionEndpointsTests.cs`, `NotificationEndpointsTests.cs`
- Modify: `Program.cs` — remove `AddScoped<INotificationSink, TableNotificationSink>()`, `AddScoped<IGamePlanSink, NoOpGamePlanSink>()`, `AddSingleton<RoomBus>()`, `AddScoped<ITokenResolver, SessionTokenResolver>()`, and `api.MapBookmarkEndpoints()`, `api.MapNotificationEndpoints()`, `api.MapFeedbackEndpoints()`, `api.MapRoomEndpoints()`
- Modify: `Services/DramatiqTasks.cs` — delete `SynthesizeRecap`
- Modify: `Endpoints/AccountEndpoints.cs` — delete the `control_grants` PII scrub (keep `invites` until Task 9)
- Modify: `SpinePrimitivesTests.cs`, `RackPresetEndpointsTests.cs` — delete cases that exercise sessions/grants/suggestions

- [ ] **Step 1:** `git rm` the files above.
- [ ] **Step 2:** edit `Program.cs`, `DramatiqTasks.cs`, `AccountEndpoints.cs`.
- [ ] **Step 3:** `cd components/bff && dotnet build 2>&1 | grep -E "error CS" | sort -u | head -40` — resolve each error by deleting the dead reference (never by stubbing). Typical: rack-preset code reading `CreatedInSessionId`/`ViaGrantId`/`FromSuggestionId` — leave entity properties alone for now (Task 14 drops them) but delete any endpoint logic that *sets* them from a session/suggestion.
- [ ] **Step 4:** `dotnet test 2>&1 | tail -5` → green.
- [ ] **Step 5:** `git add -A . && git commit -m "refactor(solo): remove rooms, reviewer feedback, bookmarks and the notification inbox from the BFF"`

---

### Task 9: Delete sharing, access resolution and the guest-token seam; audio becomes owner-only

**Files:**
- Delete: `Endpoints/ShareEndpoints.cs`, `Endpoints/OgShareEndpoints.cs`, `Endpoints/VersionShareEndpoints.cs`, `Endpoints/VersionViewEndpoints.cs`, `Services/AccessService.cs`, `Services/ShareTokenResolver.cs`, `Services/ResourceTokenAuth.cs` (and `ITokenResolver` if it lives there or in its own file), `Services/AnonIdentity.cs`, `Options/AnonOptions.cs`, `Services/ShareReportProjection.cs`, `DTOs/ShareDtos.cs`, `DTOs/VersionShareDtos.cs`
- Delete (tests): `VersionShareEndpointsTests.cs`, `OgShareShellTests.cs`, `ShareReportProjectionTests.cs`
- Modify: `Program.cs` — remove `AddOptions<AnonOptions>()…` block, `AddScoped<AnonIdentity>()`, `AddScoped<ResourceTokenAuth>()`, `AddScoped<AccessService>()`, `AddScoped<ITokenResolver, ShareTokenResolver>()`, `app.UseAnonIdentity()`, `app.MapOgShareEndpoints()`, `api.MapShareEndpoints()`, `api.MapVersionShareEndpoints()`, `api.MapVersionViewEndpoints()`
- Modify: `Endpoints/VersionEndpoints.cs` (audio handler, ~L256-280), `Endpoints/AccountEndpoints.cs` (`invites` scrub), `Services/DeviceService.cs` (two stale comments naming `AnonIdentity`), `SpinePrimitivesTests.cs` (anon-cookie / `ResourceTokenAuth` / `ActorKey` cases — keep the two rate-limiter tests), `AbuseContainmentTests.cs` (only cases that hit deleted endpoints)

**Interfaces:**
- Consumes: nothing from Task 8 except its deletions.
- Produces: `GET /api/versions/{id}/audio` authorizes with the same owner-scoped lookup the rest of `VersionEndpoints` uses (`song.UserId == currentUser.UserId()`); 404 for anyone else. JWT via header or `?t=` unchanged.

- [ ] **Step 1: Pin owner-only audio with a test first.** In the existing version/audio test class add:

```csharp
[SkippableFact]
public async Task Audio_Is_NotFound_For_A_Different_User()
{
    await TestDb.RequireAsync(_factory);
    // Arrange with the class's existing helpers: user A uploads a version,
    // user B registers. Act: B requests A's audio with B's bearer token.
    // Assert: 404 (never 200, never 403 — existence must not leak).
}
```
Fill the body using the helper methods already used by neighbouring tests in that class (register + upload). Run it: expected PASS already if no share/invite exists — it is a regression pin for the rewrite below.

- [ ] **Step 2:** `git rm` the files; edit `Program.cs`.
- [ ] **Step 3:** rewrite the audio handler's authorization to the plain owner-scoped query (delete the `AccessService.CanView` branch and its injected parameter). Verify `DeviceService` still reads `Anon:SigningKey` without `AnonOptions` — if it binds through `AnonOptions`, keep a minimal options class holding only `SigningKey` (rename the file/class to `DeviceOptions`) rather than deleting.
- [ ] **Step 4:** `dotnet build` → fix errors by deletion; `dotnet test 2>&1 | tail -5` → green. The anon-funnel tests (`AnonAnalysis*`, device-claim) MUST pass — they prove the signing key still binds.
- [ ] **Step 5:** `git add -A . && git commit -m "refactor(solo): remove share systems, invites, AccessService and guest tokens; audio is owner-only"`

---

### Task 10: Delete profiles, follows, feed; remove the handle from auth

**Files:**
- Delete: `Endpoints/ProfileEndpoints.cs`, `Endpoints/FollowEndpoints.cs`, `Endpoints/FeedEndpoints.cs`, `Auth/HandleSeeder.cs`, `Services/ActorRef.cs`, `Services/ActorProjection.cs` (+ `ActorRefDto` if still present); tests `ProfileEndpointsTests.cs`, `FollowEndpointsTests.cs`, `FeedEndpointsTests.cs`
- Modify: `Program.cs` (`AddScoped<HandleSeeder>()` L215, `MapProfileEndpoints`, `MapFollowEndpoints`, `MapFeedEndpoints`), `Endpoints/AuthEndpoints.cs`, `Auth/JwtTokenService.cs`, `DTOs/AuthDtos.cs`, `Endpoints/MeEndpoints.cs`, `DTOs/MeDtos.cs`, `Endpoints/AccountEndpoints.cs` (export L65), all auth/me tests that construct or assert `Handle`

**Interfaces:**
- Produces:
  ```csharp
  public sealed record AuthedUser(Guid Id, string Email, string? DisplayName, /* …remaining existing fields, Handle removed… */);
  public sealed record PatchMeRequest(string? DisplayName);
  ```
  `MeProfileDto` / its PATCH request lose `Handle, Bio, AvatarHue, BannerHue, Accent, PublicLink`.

- [ ] **Step 1:** `git rm` the files; edit `Program.cs`.
- [ ] **Step 2: Auth.** `AuthEndpoints.cs`: remove the `HandleSeeder seeder` parameter + the `Handle = handle` assignment in register (L135, L184) — the entity property stays until Task 14, so set nothing; **if `users.handle` is NOT NULL, registration must still satisfy it until the column is dropped: assign `Handle = "u" + Guid.NewGuid().ToString("N")[..20]` with the comment `// solo: column dropped by RemoveSocial; placeholder keeps NOT NULL/UNIQUE happy until then` and delete that line in Task 14.** Remove `user.Handle` from every `new AuthedUser(…)` (L289, L334, L386, L431, L471-480, L787); delete the handle branch of PATCH `/me` (L761-778) and `NormalizeHandle` (L791+). `JwtTokenService.cs`: delete the `handle` claim (L35-36). `MeEndpoints.cs`/`MeDtos.cs`: remove the six fields and their validation (incl. the "Handle taken." conflict). `AccountEndpoints.cs` export: drop `Handle`, `Bio`, `PublicLink`.
- [ ] **Step 3:** `dotnet build` → delete dead references; update tests (remove `Handle` args/asserts; delete handle-uniqueness tests).
- [ ] **Step 4:** `dotnet test 2>&1 | tail -5` → green.
- [ ] **Step 5:** `git add -A . && git commit -m "refactor(solo): remove public profiles, follows, feed and user handles"`

---

### Task 11: Close the non-social leaks

**Files:** Modify `Endpoints/HealthEndpoints.cs`, `HealthEndpointsTests.cs`, `Program.cs` (L513), `Endpoints/VersionEndpoints.cs` (~L1230), `Endpoints/AnonAnalysisEndpoints.cs` (~L100), `Endpoints/SongEndpoints.cs` (visibility ~L184-190) + song DTOs, rack-preset DTOs/endpoints (provenance fields)

**Interfaces:**
- Produces: `public sealed record WorkerHealthDto(bool Healthy, double? LastHeartbeatAgeSeconds);` — keep the existing property types; only `QueueDepth` goes, from BOTH `/api/health/worker` and the Development-only `/api/health/full` (queue depth stays available to operators via `/metrics` and workerdash; YAGNI on a second copy).

- [ ] **Step 1: Failing test first.** In `HealthEndpointsTests.cs` delete the `worker.GetProperty("queueDepth")` assertion from the `/api/health/full` test and add:

```csharp
[SkippableFact]
public async Task Worker_Health_Has_No_Queue_Depth()
{
    await TestDb.RequireAsync(_factory);
    var body = await _factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/health/worker");
    Assert.False(body.TryGetProperty("queueDepth", out _));
    Assert.True(body.TryGetProperty("healthy", out _));
}
```
Run → FAIL. Implement the DTO change: drop the `QueueDepth` parameter + its XML doc, and delete the `heartbeat.AnalysisQueueDepthAsync(...)` calls in both `GetWorkerHealth` (~L137-141) and `GetFullHealth` (~L82-114). Leave `AnalysisQueueDepthAsync` itself alone — `/metrics` and `StaleJobReaper` use it. Run → PASS. `/metrics` keeps `spectr_queue_depth` (internal scrape; Caddy never routes it).

- [ ] **Step 2: OpenAPI dev-only.** `Program.cs`: `if (app.Environment.IsDevelopment()) app.MapOpenApi();` and delete the "Lock down before public exposure." comment.
- [ ] **Step 3: Copy.** `"Too many analyses from this network — slow down or upgrade."` → `"Too many analyses — slow down or upgrade."`; `"Too many analyses from this network — create an account for more."` → `"Too many analyses — create an account for more."`. Update any test asserting the old strings.
- [ ] **Step 4: DTO fields.** Remove `Visibility` from song DTOs + the PATCH validation; remove `CreatedInSessionId`/`ViaGrantId`/`FromSuggestionId` from rack-preset DTOs and mapping. Entity properties stay until Task 14.
- [ ] **Step 5:** `dotnet build && dotnet test 2>&1 | tail -5` → green; commit `refactor(solo): no global queue depth, OpenAPI dev-only, neutral rate-limit copy, no visibility/provenance in DTOs`.

---

### Task 12: Enable the BFF guard

- [ ] **Step 1:** delete `Skip = SkipReason` from the four attributes and the `SkipReason` constant in `NoSocialSurfaceTests.cs`.
- [ ] **Step 2:** `cd components/bff && dotnet test --filter "FullyQualifiedName~NoSocialSurfaceTests" 2>&1 | tail -30` (stack up). Expected: 4 PASS. A failure names the leftover route — delete it.
- [ ] **Step 3:** `dotnet test 2>&1 | tail -5`; commit `test(solo): enable BFF no-social-surface guard`.

---

## Phase 3 — Worker, mirror, database

### Task 13: Worker + shared-model mirror

**Files:**
- Delete: `components/worker/app/recap_actor.py`, `components/worker/tests/test_recap_actor.py`
- Modify: `components/worker/app/dramatiq_app.py` (L63 `from . import recap_actor`), `components/worker/tests/test_actor_queues.py` (L21 import, L38 + L55 roster entries), `components/worker/app/account_deletion_actor.py` (~L84-116), `components/shared/aimusic_shared/models.py`, `components/shared/tests/*` touching removed models, `docs/architecture-worker.md` is handled in Task 16

- [ ] **Step 1: Failing test first** — in `test_actor_queues.py` add, next to the existing roster test:

```python
def test_no_room_recap_actor_is_registered():
    import dramatiq
    from app import dramatiq_app  # noqa: F401  (imports register every actor)

    assert "synthesize_recap" not in dramatiq.get_broker().actors
```
Run `pytest -q components/worker/tests/test_actor_queues.py` → FAIL.

- [ ] **Step 2:** delete the two files, the `dramatiq_app.py` import, and the three `synthesize_recap` lines in the roster test → PASS.
- [ ] **Step 3: `account_deletion_actor.py`** — delete every SQL statement and comment naming `share_settings`, `invites`, `suggestions`, `track_comments`, `track_bookmarks`, `listening_sessions`, `control_grants`, `follow_relations`. Keep all other purge steps byte-identical.
- [ ] **Step 4: `models.py`** — delete classes `ShareSetting`, `Invite`, `ListeningSession`, `ControlGrant`, `TrackComment`, `ReviewerSuggestion`, `TrackBookmark`, `FollowRelation`; keep `Notification`, adding above it: `# Lifecycle-email send ledger (digest_key = "<event>:<id>"). Not an in-app inbox.`; remove columns `User.handle/bio/avatar_hue/banner_hue/accent/public_link`, `Song.visibility` (+ its CheckConstraint), `Analysis.share_token/share_show_verdicts/share_enabled_at` (+ the `UniqueConstraint("share_token")`), `RackPreset.created_in_session_id/via_grant_id/from_suggestion_id`; trim `__all__`.
- [ ] **Step 5: Hard gate — nothing in Python may name a dropped table/column**

```bash
cd C:/Users/badmin/projects/spectr-solo && grep -rn -E "share_settings|\binvites\b|listening_sessions|control_grants|track_comments|track_bookmarks|follow_relations|\bsuggestions\b|share_token|share_enabled_at|share_show_verdicts|created_in_session_id|via_grant_id|from_suggestion_id|\.handle\b|\"handle\"|public_link|banner_hue|avatar_hue" components/worker components/shared components/workerdash --include=*.py
```
Expected: no output (the word "suggestions" in coach/solve code that means *AI suggestions* is fine — confirm each hit by reading it).

- [ ] **Step 6:** Python gates (Global Constraints) → green; commit `refactor(solo): remove room recap actor and social models from worker + shared mirror`.

---

### Task 14: EF entities + `RemoveSocial` migration

**Files:**
- Delete (`src/Spectr.Data/Entities/`): `ListeningSession.cs`, `ControlGrant.cs`, `Invite.cs`, `ShareSetting.cs`, `FollowRelation.cs`, `ReviewerSuggestion.cs`, `TrackComment.cs` (it also declares `TrackBookmark`)
- Modify: `Entities/User.cs`, `Song.cs`, `Analysis.cs`, `RackPreset.cs`, `Notification.cs` (comment), `AppDbContext.cs` (DbSets + config blocks: suggestions ~L192-213, follow ~L240-254, share_settings/invites ~L401-448, sessions/grants + provenance FKs ~L450-507, track_comments ~L167-188, analysis share index ~L130, user handle index), `Endpoints/AuthEndpoints.cs` (delete the Task 10 placeholder `Handle = …` line)
- Create: `Migrations/<ts>_RemoveSocial.cs` (+ Designer), updated `AppDbContextModelSnapshot.cs`

- [ ] **Step 1:** delete entities, properties, DbSets, config. `dotnet build` → fix by deletion until green.
- [ ] **Step 2: Hard gate (C# side)**

```bash
cd components/bff && grep -rn -E "ListeningSession|ControlGrant|\bInvite\b|ShareSetting|FollowRelation|ReviewerSuggestion|TrackComment|TrackBookmark|ShareToken|\.Handle\b|\.Visibility\b" src --include=*.cs | grep -v "/Migrations/"
```
Expected: no output.

- [ ] **Step 3: Scaffold**

```bash
cd components/bff && dotnet ef migrations add RemoveSocial --project src/Spectr.Data --startup-project src/Spectr.Bff
```
- [ ] **Step 4: Hand-review `Up()`.** It must: `DropTable` ×8 (`control_grants` and `suggestions` before `listening_sessions`; FKs from `rack_presets` dropped before their targets); `DropColumn` for the 3 `analyses` share columns (+ `DropIndex` on share_token), `songs.visibility` (+ its CHECK), the 3 `rack_presets` provenance columns (+ FKs/indexes), the 6 `users` columns (+ the citext unique index on `handle`). Append at the end of `Up()`:

```csharp
            migrationBuilder.Sql(
                "DELETE FROM feature_flags WHERE name IN ('room_hosting_enabled','room_host_min_tier');");
```
and at the start of `Down()`:

```csharp
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value) VALUES
                  ('room_hosting_enabled','false'), ('room_host_min_tier','pro')
                ON CONFLICT (name) DO NOTHING;
                """);
```
Leave the scaffolded `Down()` otherwise as generated. Do NOT touch any earlier migration.

- [ ] **Step 5: Back up the dev DB** (resolve docker.exe per STARTUP.md §6; container = the compose `postgres` service, db/user `spectr`):

```bash
mkdir -p C:/Users/badmin/projects/spectr-solo/output/db-backups/2026-09-19_pre-solo-strip
"$DOCKER_EXE" compose -f docker/docker-compose.yml exec -T postgres pg_dump -U spectr -Fc spectr > output/db-backups/2026-09-19_pre-solo-strip/spectr.dump
ls -la output/db-backups/2026-09-19_pre-solo-strip/   # expect a non-trivial file size
```
- [ ] **Step 6: Rehearse on a copy, then on an empty DB**

```bash
"$DOCKER_EXE" compose -f docker/docker-compose.yml exec -T postgres psql -U spectr -d postgres -c "DROP DATABASE IF EXISTS spectr_solo_rehearsal;" -c "CREATE DATABASE spectr_solo_rehearsal TEMPLATE spectr;"
```
(`TEMPLATE` needs no open connections to `spectr` — stop the stack first: `./scripts/start-spectr.ps1 -StopOnly`.) Then run `dotnet ef database update` with the connection string overridden to `spectr_solo_rehearsal` (env `ConnectionStrings__Default` — confirm the key name in `appsettings.Development.json`). Expected: applies cleanly. Repeat against a fresh empty database `spectr_solo_empty` to prove the full chain + `RemoveSocial` applies from zero. Drop both rehearsal DBs.

- [ ] **Step 7: Apply to the dev DB**

```bash
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
```
- [ ] **Step 8:** `dotnet test 2>&1 | tail -5` → green (incl. `NoSocialSurfaceTests`); Python gates → green; commit `feat(solo): RemoveSocial migration — drop social tables, share/visibility/provenance/profile columns`.

---

## Phase 4 — Infra, CI, docs

### Task 15: Infra + CI

**Files:** `infra/Caddyfile`, `.github/workflows/ci.yml`, `PRPs/azure-deploy-spectr.md`, `docs/azure-deploy-remaining-work.md`, `docs/launch-checklist.md`

- [ ] **Step 1:** `infra/Caddyfile` — delete the `@share_bots { path /r/* … }` matcher and its `handle @share_bots { … }` block (L18-24) and any comment referring to it (the 6.1/6.2 comment says "unlike @share_bots" — reword).
- [ ] **Step 2:** `ci.yml` deploy job: `if: github.ref == 'refs/heads/solo' && github.event_name == 'push'`; update the "master-only" comments above it to say `solo`.
- [ ] **Step 3:** Azure plan + status doc + launch checklist: deploy branch is `solo`; delete the "share links must all work on the live site" constraint, the `curl -A discordbot https://<domain>/r/<token>` check, and "→ share link" from the Task 10 walkthrough; add one line: "Public surface is single-user — see `PRPs/solo-fork-strip-social.md`."
- [ ] **Step 4:** validate Caddy syntax if docker is available: `"$DOCKER_EXE" run --rm -v "$PWD/infra/Caddyfile:/etc/caddy/Caddyfile" caddy:2 caddy validate --config /etc/caddy/Caddyfile` (needs `SPECTR_DOMAIN`-style env the file expects — pass `-e` as the file header documents). Commit `chore(solo): deploy from solo; remove share crawler route`.

### Task 16: Docs

**Files:** `CLAUDE.md`, `README.md`, `docs/project-overview.md`, `docs/architecture-frontend-v2.md`, `docs/architecture-worker.md`, `docs/data-models.md`, `docs/api-contracts-bff.md`, `docs/index.md`, `PRPs/` (archive moves)

- [ ] **Step 1: `CLAUDE.md`** — first paragraph: add "Single-user tool: there is no sharing, no profiles, no rooms — see `PRPs/solo-fork-strip-social.md`. `solo` is the main development + deploy branch; `master` is the frozen archive of the social build." Remove from the BFF key-routes list anything deleted; fix the frontend purpose line (no "share"); worker actor roster loses `synthesize_recap`; remove the `room_hosting_enabled` mentions.
- [ ] **Step 2: `README.md` + `docs/*`** — delete every rooms/sharing/feed/profile statement (`README.md` ~L212 "share links"; `project-overview.md` L15; `architecture-frontend-v2.md` L15/L154/L223; `architecture-worker.md` L13; `data-models.md` L55 + the dropped tables/columns; `api-contracts-bff.md` L249 room SSE + all removed endpoints). Do not add marketing copy.
- [ ] **Step 3: Archive** —

```bash
cd C:/Users/badmin/projects/spectr-solo && mkdir -p PRPs/archive/2026-09-19_social-epic
git mv PRPs/product-brief-spectr-room-2026-06-17.md PRPs/spectr-flywheel.md PRPs/async-social-core-design.md PRPs/listen-v3-notifications.md PRPs/listen-v3-bookmark-ui.md PRPs/archive/2026-09-19_social-epic/
git mv PRPs/stories/7-1* PRPs/stories/7-2* PRPs/stories/7-3* PRPs/stories/7-4* PRPs/stories/11-* PRPs/archive/2026-09-19_social-epic/
```
(`ls` first; move only what exists.) In `PRPs/epics.md` add under the Epic 11 and Epic 7 headings: `> ARCHIVED 2026-09-19 — removed on the solo fork (PRPs/solo-fork-strip-social.md).` Trim the room/reviewer drains from `PRPs/listen-v3-game-plan-comparison.md` with the same one-line note. Update `docs/index.md`.
- [ ] **Step 4:** commit `docs(solo): describe the single-user product; archive the social epic`.

---

## Phase 5 — Verification and ship

### Task 17: Live verification, then ship

- [ ] **Step 1: Full gates** — every command in Global Constraints, from a clean tree. All green.
- [ ] **Step 2: Start the stack from the solo worktree** — `./scripts/start-spectr.ps1` (run inside `spectr-solo`), then STARTUP.md §5 verification (a fresh heartbeat does NOT prove the worker is consuming).
- [ ] **Step 3: Walk the product** (use the `run` skill / Playwright): anon `/analyze` upload → register → library shows the demo song → upload a new song → full analysis completes → results: every tab renders, Notes tab shows only "Your notes" → coach chat replies → run one specialist → Listen rack: play, tweak EQ, save + recall a preset, add a note, no mode switcher / Invite / Chat / Room anywhere → compare two versions → profile: no handle anywhere → account export downloads and contains no `handle`/`bio`. Browser console: zero errors, zero 404s.
- [ ] **Step 4: Negative matrix**

```bash
for p in /feed /u/someone /r/abc /v/abc /invite/abc; do printf "%s -> " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5174$p"; done   # SPA 200s; open one in the browser: must render the not-found page
for p in /api/u/someone "/api/u/?q=a" /api/me/feed /api/me/notifications /api/me/bookmarks /api/share/abc /api/v/abc /api/sessions/00000000-0000-0000-0000-000000000000 /r/abc; do printf "%s -> " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5000$p"; done   # all 404 (401 is NOT acceptable — it proves the route exists)
curl -s http://localhost:5000/api/health/worker   # no queueDepth key
```
- [ ] **Step 5: Final hand review**

```bash
cd C:/Users/badmin/projects/spectr-solo && git grep -n -i -E "follow|roster|listening_session|share_token|visibility|invite|\bhandle\b" -- components/bff/src components/frontend-spectr-v2/src components/worker/app components/shared/aimusic_shared | grep -v -E "/Migrations/|routeTree.gen|visibility: ?(hidden|visible)|visibilitychange|handle(r|d|s|Click|Change|Submit|Sign|Drop|Key|[A-Z])|onHandle|ErrorHandl|Handler"
```
Read every remaining hit; each must be unrelated to other users. Record the verdict in the task report.
- [ ] **Step 6: STOP — ask Brian before each of these (outward-facing, not pre-approved):**
  1. One commit on `master` disabling its deploy job (`if: false` on the `deploy` job + a comment pointing at `solo`), and pushing it.
  2. `git push -u origin solo`.
  3. Switching the GitHub default branch to `solo` (`gh repo edit --default-branch solo`).
- [ ] **Step 7:** update `docs/STARTUP.md` if any boot step changed (storage-root env for a worktree, editable-install re-pointing); move this plan + the spec to `PRPs/archive/` per the PRP lifecycle; update the `solo-fork-2026-09` memory with what shipped.

---

## Self-review notes (done while writing)

- **Spec coverage:** §4 frontend → Tasks 2-6; §5 BFF → Tasks 7-12; §6 worker/mirror → Task 13; §7 DB → Task 14; §8 infra/CI/docs → Tasks 15-16 (+ the master commit and default-branch switch gated in Task 17); §9 guards → Tasks 1, 6, 7, 12, 13; §10 DoD → Task 17.
- **Ordering hazards handled:** Feedback/Room/Bookmark endpoints (users of `AccessService`/`ActorRef`) are deleted before those services; `NotesTab` consumers are rewritten (Task 5) before `useComments`/`useBookmarkSignal` are deleted; the `users.handle` NOT NULL/UNIQUE column is fed a placeholder between Task 10 and Task 14; Python editable installs are re-pointed in Task 0 so the worker never loads stale models against a migrated DB.
- **Known soft spots the executor must resolve by reading code, not guessing:** whether `DeviceService` binds `AnonOptions` (Task 9 Step 3); the connection-string key for the rehearsal DB (Task 14 Step 6); the storage-root env var names for a worktree (Task 0 Step 3); the body of the owner-only audio regression test, which must reuse that test class's own register/upload helpers (Task 9 Step 1).
