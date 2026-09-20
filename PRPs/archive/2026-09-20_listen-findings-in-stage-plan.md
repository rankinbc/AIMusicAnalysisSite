# Findings & Actions in the Listen Stage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the playing version's Findings/Actions board inside the Listen page's stage box, with the visualizer playing full-screen behind the page by default, and make every listed fix applyable to the live rack for instant A/B.

**Architecture:** Bottom-up, one seam per task. The BFF learns to tell a version its own newest analysis; `ListenRackPage` sheds two self-contained blocks so it fits under the line limit; pure helpers and localStorage prefs land next; the existing results board components gain a `surface` variant instead of being forked; a single state hook owns the one-and-only fix overlay; a container composes them; the stage card learns a second content mode; the page wires it together; a live pass proves it on the running stack. Every task leaves all gates green.

**Tech Stack:** ASP.NET Core .NET 10 + EF Core 10 + xUnit (`components/bff`); React 19 + Vite 6 + TypeScript strict + TanStack Router/Query + vitest + Testing Library (`components/frontend-spectr-v2`); Playwright MCP browser tools for the live pass.

**Spec:** `PRPs/listen-findings-in-stage.md` — read it first, in full. This plan argues from it; where they disagree the spec wins and the plan gets fixed. Spec decisions are cited inline as **D1**…**D12**.

## Global Constraints

- **Worktree:** all work happens in `C:/Users/badmin/projects/spectr-solo` on branch `solo`. **NEVER touch `C:/Users/badmin/projects/AIMusicAnalysisSite`.**
- **Never stage these two files** — they are another session's uncommitted work: `components/frontend-spectr-v2/src/features/results/AnalysisCompleteModal.tsx` and `AnalysisCompleteModal.module.css`. Always `git add` **by explicit path**, never `git add -A` / `git add .`.
- **Never edit the solo guards:** `components/frontend-spectr-v2/src/routes/__tests__/no-social-surface.test.ts`, `components/bff/tests/Spectr.Bff.Tests/NoSocialSurfaceTests.cs`. They must stay green. Note its banned pattern `/jobs? queued/i` — never write "jobs queued" in source.
- **TypeScript:** strict, `verbatimModuleSyntax` (so `import type` for every type-only import), and **`exactOptionalPropertyTypes: true`** — declare optional props as `name?: T | undefined`, and pass conditional props with the `{...(x ? { x } : {})}` idiom used throughout the codebase.
- **No new dependencies.** No Tailwind, no styled-components, no UI kit.
- **Styling:** CSS Modules + tokens for component styles; `findings-stage.css` is a deliberate plain global sheet (**D10**, spec §12) and still uses `var(--token)` colors only. Raw hex is banned in `*.module.css` (`scripts/check-css-tokens.mjs`). Never write `outline: none` without a `:focus`/`:focus-visible` replacement in the same file (`scripts/check-focus-ring.mjs`). No inline styles unless the value is dynamic — the single exemption is `StagePlacementButton` (spec §4.2), which must render inside a `document.body` portal, outside `.rdx`.
- **No file over ~500 lines.** `ListenRackPage.tsx` starts at 635; Task 2 brings it to ≈490 before anything is added (**D10**).
- **Tests:** every new module gets expected-use, edge-case and failure-case coverage. Tests under `src/features/listen-rack/**` get jsdom automatically (`vitest.config.ts` `environmentMatchGlobs`); anything elsewhere needs `// @vitest-environment jsdom` as its **first** line.
- **Frontend gates** (from `components/frontend-spectr-v2`): `npx tsc -b` (never `--noEmit`), `npm run lint`, `npm run build`, `npx vitest run`. Baseline ≈ 930 tests, 0 failing.
- **BFF gates** (from `components/bff`) — foreground only, **never two `dotnet` processes at once**, and only for tasks that touch `components/bff`. See the env block in Task 1 Step 4.
- **Commits:** one per task, staged by explicit path, message ending with the trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  ```
  Never `--no-verify`. **Never push** — the human pushes.
- **Line numbers** in this plan were read on `solo` @ `df23e65` on 2026-09-19. Symbols are authoritative; line numbers are hints — re-grep before editing.

---

## Pre-flight: what each task hands the next

| Producer | Artifact (exact) | Consumer |
| --- | --- | --- |
| Task 1 | `VersionDto.latestJobId?: string \| null` (`src/api/types.ts`) | Task 8 (route passes it), Task 5 (hook consumes it) |
| Task 1 | `VersionDto.LatestJobId` (`DTOs/VersionDtos.cs`), set in `VersionEndpoints.GetById` | Task 9 (live: the older version shows its own findings) |
| Task 2 | `useFixCarryOver({versionId, fixPreset, realAudio, rsRef, currentChain}) → { fixesApplied, carryPhase, onResetCarriedFixes }` + `export type CarryPhase` | Task 3 (`applyGate(carryPhase)`), Task 6 (`FindingsStage` props), Task 8 (page wiring) |
| Task 2 | `useRackPresetActions(...) → { items, onSave, onRecall, onExport, onImport, importRef, onImportFile }` | Task 8 (page keeps rendering the hidden input) |
| Task 2 | `ListenRackPage.tsx` at ≈490 lines | Task 8 (budget for ~20 new lines) |
| Task 3 | `timeRangeOf(v, durationSeconds) → SeekTarget \| null`, `applyGate(carryPhase) → ApplyGate`, `boardListenFixes(moves) → ListenFix[]` | Task 5 (`boardListenFixes`), Task 6 (`timeRangeOf`, `applyGate`) |
| Task 3 | `useStagePrefs() → { content, bgViz, setContent, setBgViz }`, `readStagePrefs`, `writeStagePrefs`, `STAGE_PREFS_KEY`, `type StageContent` | Task 7 (`StageContent` on `StageCardV2`), Task 8 (page state) |
| Task 4 | `export type FixBoardSurface = 'report' \| 'listen'`, `export interface SeekAffordance { label; go }` (`features/results/fix-board-helpers.ts`) | Task 6 (`FindingsStage` builds both), Task 7 (`StageCardV2` types only indirectly) |
| Task 4 | `FixBoard` props `surface?`, `seek?`; `onAskCoach`/`onIgnore`/`onMarkApplied`/`onRate` now optional | Task 6 (container renders `FixBoard surface="listen"`) |
| Task 5 | `useListenFindings({versionId, latestJobId, rs}) → ListenFindings`, `export interface FixOverlayHandle { isApplied; toggle }` | Task 6 (`FindingsStage` consumes `ListenFindings`), Task 8 (page calls it, passes `overlay` to `CoachTabV2`) |
| Task 6 | `<FindingsStage findings songId durationSeconds onSeek carryPhase onClearPreset />` | Task 7 (passed in as the `findings` node), Task 8 (page constructs it) |
| Task 6 | `findings-stage.css` incl. `.lr-findings-stage`, `.lr-stage-seg`, `.rdx .lr-glass .lr-stagecard[data-stage='findings']`, `.fbd-seek` | Task 7 (`StageCardV2` emits those class names / `data-stage`), Task 8 (page imports the sheet) |
| Task 7 | `StagePlacementButton`; `VizStage` props `bgMode`, `onBgModeChange`, `slot?`; `StageCardV2` props `stageContent`, `onStageContentChange`, `bgViz`, `onBgVizChange`, `findings?` | Task 8 (page supplies all five) |
| Task 8 | `CoachTabV2` prop `fixOverlay: FixOverlayHandle \| null`; `ListenRackPageProps.songId?`, `.latestJobId?` | Task 9 (live pass) |

---

## File structure

**New (frontend, all under `components/frontend-spectr-v2/src/`):**

| path | responsibility | task |
| --- | --- | --- |
| `features/listen-rack/useFixCarryOver.ts` | `?fixPreset=` carry-over + the draft restore it sequences | 2 |
| `features/listen-rack/useRackPresetActions.ts` | server-preset list + save/recall/export/import handlers | 2 |
| `features/listen-rack/__tests__/useFixCarryOver.test.tsx` | 3 cases | 2 |
| `features/listen-rack/__tests__/useRackPresetActions.test.tsx` | 2 cases | 2 |
| `features/listen-rack/findings/findings-helpers.ts` | `timeRangeOf`, `applyGate`, `boardListenFixes` | 3 |
| `features/listen-rack/findings/stage-prefs.ts` | `useStagePrefs` + storage | 3 |
| `features/listen-rack/findings/__tests__/findings-helpers.test.ts` | pure-helper cases | 3 |
| `features/listen-rack/findings/__tests__/stage-prefs.test.ts` | storage cases | 3 |
| `features/results/__tests__/FixBoard.surface.test.tsx` | the `surface` variant contract | 4 |
| `features/listen-rack/findings/useListenFindings.ts` | the single data + overlay seam | 5 |
| `features/listen-rack/findings/__tests__/useListenFindings.test.tsx` | 4 cases | 5 |
| `features/listen-rack/findings/FindingsStage.tsx` | the container | 6 |
| `features/listen-rack/findings/findings-stage.css` | stage + board overrides | 6 |
| `features/listen-rack/findings/__tests__/FindingsStage.test.tsx` | 4 cases | 6 |
| `features/listen-rack/findings/StagePlacementButton.tsx` | ⛶/⤡, portal-safe | 7 |
| `features/listen-rack/__tests__/StageCardV2.content.test.tsx` | 3 cases | 7 |
| `features/listen-rack/findings/__tests__/listen-stage-wiring.test.tsx` | page-level wiring | 8 |

**New (BFF):** `components/bff/tests/Spectr.Bff.Tests/VersionLatestJobIdTests.cs` (Task 1).

**Modified:** `DTOs/VersionDtos.cs`, `Endpoints/VersionEndpoints.cs`, `src/api/types.ts`, `features/results/{fix-board-helpers.ts,FixBoard.tsx,FindingDetail.tsx,ActionDetail.tsx}`, `features/listen-rack/{viz.tsx,StageCardV2.tsx,CoachTabV2.tsx,ListenRackPage.tsx}`, `routes/_app/listen-rack.$versionId.tsx`.

---

### Task 1: The version knows its own newest analysis

**Files:**
- Modify: `components/bff/src/Spectr.Bff/DTOs/VersionDtos.cs:11-22`
- Modify: `components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs:353-371` (`GetById`)
- Test: `components/bff/tests/Spectr.Bff.Tests/VersionLatestJobIdTests.cs` (new)
- Modify: `components/frontend-spectr-v2/src/api/types.ts:155-167`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - C#: `VersionDto(..., int? PersonalScore = null, Guid? LatestJobId = null)`.
  - Wire/TS: `VersionDto.latestJobId?: string | null` — the `job_id` of the newest `analyses` row for **this** version, `null` when the version has never completed an analysis.

- [ ] **Step 1: Write the failing BFF test**

Create `components/bff/tests/Spectr.Bff.Tests/VersionLatestJobIdTests.cs`:

```csharp
using System.Net.Http.Json;
using System.Net.Http.Headers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Mvc.Testing;
using Spectr.Data;
using Spectr.Data.Entities;
using Spectr.Bff.DTOs;
using Xunit;

namespace Spectr.Bff.Tests;

// Spec D3: the Listen page resolves the PLAYING version's report through
// GET /api/versions/{id}. A song-level "latest analysis" is the wrong answer
// for any song with more than one analyzed version, so this endpoint must
// answer per-version and must never leak a sibling's job id.
public sealed class VersionLatestJobIdTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private static Analysis Row(Guid userId, Guid songId, Guid versionId, Guid jobId, int hoursAgo) =>
        new()
        {
            Id = Guid.NewGuid(),
            JobId = jobId,
            UserId = userId,
            SongId = songId,
            VersionId = versionId,
            FinalJson = "{}",
            CreatedAt = DateTimeOffset.UtcNow.AddHours(-hoursAgo),
        };

    [SkippableFact]
    public async Task Each_version_reports_its_own_latest_job_never_a_siblings()
    {
        await TestDb.RequireAsync(_factory);
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        var (songId, versionAId, versionBId) =
            await TestSeed.SongWithTwoVersionsAsync(_factory, userId);

        var jobA = Guid.NewGuid();
        var jobB = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Analyses.Add(Row(userId, songId, versionAId, jobA, hoursAgo: 4));
            db.Analyses.Add(Row(userId, songId, versionBId, jobB, hoursAgo: 0));
            await db.SaveChangesAsync();
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var a = await client.GetFromJsonAsync<VersionDto>($"/api/versions/{versionAId}");
        var b = await client.GetFromJsonAsync<VersionDto>($"/api/versions/{versionBId}");

        Assert.NotNull(a);
        Assert.NotNull(b);
        // jobB is the song's newest analysis — version A must still say jobA.
        Assert.Equal(jobA, a!.LatestJobId);
        Assert.Equal(jobB, b!.LatestJobId);
    }

    [SkippableFact]
    public async Task Newest_analysis_for_the_version_wins()
    {
        await TestDb.RequireAsync(_factory);
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        var (songId, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        var older = Guid.NewGuid();
        var newer = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Analyses.Add(Row(userId, songId, versionId, older, hoursAgo: 9));
            db.Analyses.Add(Row(userId, songId, versionId, newer, hoursAgo: 1));
            await db.SaveChangesAsync();
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var v = await client.GetFromJsonAsync<VersionDto>($"/api/versions/{versionId}");

        Assert.NotNull(v);
        Assert.Equal(newer, v!.LatestJobId);
    }

    [SkippableFact]
    public async Task Version_with_no_analysis_reports_null()
    {
        await TestDb.RequireAsync(_factory);
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var v = await client.GetFromJsonAsync<VersionDto>($"/api/versions/{versionId}");

        Assert.NotNull(v);
        Assert.Null(v!.LatestJobId);
    }
}
```

- [ ] **Step 2: Read the Postgres password into the shell without printing it**

Every later BFF command in this plan reuses `$PGPW`. Run this **in the same Bash call** as the command that needs it (shell state does not persist between calls):

```bash
PGPW=$(python -c "import json;print(json.load(open(r'C:/Users/badmin/projects/spectr-solo/components/bff/src/Spectr.Bff/appsettings.json'))['ConnectionStrings']['Postgres'].split('Password=')[1].split(';')[0])")
```
Expected: no output. Never `echo $PGPW`.

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/bff && \
PGPW=$(python -c "import json;print(json.load(open(r'src/Spectr.Bff/appsettings.json'))['ConnectionStrings']['Postgres'].split('Password=')[1].split(';')[0])") \
ASPNETCORE_ENVIRONMENT=Development \
Storage__LocalRoot=C:/Users/badmin/projects/AIMusicAnalysisSite/data \
Redis__ConnectionString=127.0.0.1:6379 \
ConnectionStrings__Postgres="Host=127.0.0.1;Port=5432;Database=spectr;Username=spectr;Password=$PGPW" \
dotnet test --artifacts-path C:/Users/badmin/AppData/Local/Temp/spectr-bff-artifacts \
  --filter FullyQualifiedName~VersionLatestJobIdTests 2>&1 | tail -20
```
Expected: the build fails with `CS1061: 'VersionDto' does not contain a definition for 'LatestJobId'`.

If instead you get a file-lock error on `Spectr.Bff.exe`, the BFF is running — the `--artifacts-path` flag already redirects output away from the locked `bin/`; if it still fails, stop the BFF process and re-run.

- [ ] **Step 4: Add the DTO field**

In `components/bff/src/Spectr.Bff/DTOs/VersionDtos.cs`, replace the `VersionDto` record with:

```csharp
public sealed record VersionDto(
    Guid Id,
    Guid SongId,
    int VersionNumber,
    string? Label,
    bool IsCurrent,
    string FilePath,
    DateTimeOffset CreatedAt,
    string? AlsFilePath = null,
    string? ReferencePath = null,
    VersionMetricsDto? LatestResult = null,
    int? PersonalScore = null,
    // The newest COMPLETED analysis for THIS version. An `analyses` row is 1:1
    // with a successful job (Entities/Analysis.cs), so a row means "completed"
    // and no status join is needed. Populated by GET /api/versions/{id} ONLY —
    // the Listen page resolves the playing version's findings through it and
    // must never fall back to the SONG's latest analysis, which can belong to
    // a different version.
    Guid? LatestJobId = null);
```

- [ ] **Step 5: Populate it in `GetById`**

In `components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs`, replace the tail of `GetById` (the `if (row is null) …; return Results.Ok(new VersionDto(…));` block) with:

```csharp
        if (row is null) return Results.NotFound();

        var latestJobId = await db.Analyses.AsNoTracking()
            .Where(a => a.UserId == userId && a.VersionId == versionId)
            .OrderByDescending(a => a.CreatedAt)
            .Select(a => (Guid?)a.JobId)
            .FirstOrDefaultAsync(ct);

        return Results.Ok(new VersionDto(
            row.Id, row.SongId, row.VersionNumber, row.Label, row.IsCurrent, row.FilePath, row.CreatedAt,
            row.AlsFilePath, row.ReferencePath, LatestJobId: latestJobId));
```

- [ ] **Step 6: Run the test to verify it passes**

Re-run the Step 3 command.
Expected: `Passed!  - Failed:     0, Passed:     3` (or `Skipped: 3` if Postgres is down — if skipped, start the stack per `docs/STARTUP.md` and re-run; do not accept skips as a pass for this task).

- [ ] **Step 7: Run the whole BFF suite**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/bff && \
PGPW=$(python -c "import json;print(json.load(open(r'src/Spectr.Bff/appsettings.json'))['ConnectionStrings']['Postgres'].split('Password=')[1].split(';')[0])") \
ASPNETCORE_ENVIRONMENT=Development \
Storage__LocalRoot=C:/Users/badmin/projects/AIMusicAnalysisSite/data \
Redis__ConnectionString=127.0.0.1:6379 \
ConnectionStrings__Postgres="Host=127.0.0.1;Port=5432;Database=spectr;Username=spectr;Password=$PGPW" \
dotnet test --artifacts-path C:/Users/badmin/AppData/Local/Temp/spectr-bff-artifacts 2>&1 | tail -8
```
Expected: `Failed:     0`, `Passed:` 368 or more. Known flake: `CoachStreamEndpointTests.Client_Disconnect_Sets_Cancel_Key_In_Redis` — re-run once before treating it as real.

- [ ] **Step 8: Mirror the field on the wire type**

In `components/frontend-spectr-v2/src/api/types.ts`, inside `interface VersionDto`, after `personalScore?: number | null;` add:

```ts
  /** Spec D3 — the newest COMPLETED analysis for THIS version (an `analyses`
   *  row is 1:1 with a successful job). Populated by GET /api/versions/{id};
   *  absent/null from every other VersionDto source. The Listen page resolves
   *  the playing version's findings through this and NEVER through
   *  `SongDto.latestResult`, which is the song's latest and may belong to a
   *  different version. */
  latestJobId?: string | null;
```

- [ ] **Step 9: Frontend gates**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx tsc -b && npm run lint && npx vitest run 2>&1 | tail -5
```
Expected: `tsc` silent, lint prints `css/fonts` clean, vitest `Tests  <baseline> passed`.

- [ ] **Step 10: Commit**

```bash
cd C:/Users/badmin/projects/spectr-solo && git add \
  components/bff/src/Spectr.Bff/DTOs/VersionDtos.cs \
  components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs \
  components/bff/tests/Spectr.Bff.Tests/VersionLatestJobIdTests.cs \
  components/frontend-spectr-v2/src/api/types.ts && \
git commit -m "feat(bff): a version reports its own newest analysis job id

The Listen page needs the report for the version that is PLAYING. The song's
latest analysis is the wrong answer whenever a song has more than one analyzed
version, and GET /api/jobs cannot be filtered by version. Spec D3.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Make room in `ListenRackPage` (pure extraction, no behaviour change)

`ListenRackPage.tsx` is 635 lines — already past the ~500 limit, before this feature adds anything. Two self-contained blocks come out (**D10**). Nothing about what the page *does* may change.

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen-rack/useFixCarryOver.ts`
- Create: `components/frontend-spectr-v2/src/features/listen-rack/useRackPresetActions.ts`
- Test: `components/frontend-spectr-v2/src/features/listen-rack/__tests__/useFixCarryOver.test.tsx`
- Test: `components/frontend-spectr-v2/src/features/listen-rack/__tests__/useRackPresetActions.test.tsx`
- Modify: `components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx:184-339` (delete), `:15-49` (imports), `:628` (the hidden input)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type CarryPhase = 'none' | 'pending' | 'applied' | 'failed'`
  - `export function useFixCarryOver(args: { versionId: string | undefined; fixPreset: string | undefined; realAudio: boolean; rsRef: { current: RackState }; currentChain: Chain }): { fixesApplied: number | null; carryPhase: CarryPhase; onResetCarriedFixes: () => void }`
  - `export function useRackPresetActions(args: { versionId: string | undefined; realAudio: boolean; rs: RackState; currentChain: Chain }): { items: RackPreset[]; onSave: () => void; onRecall: (id: string) => void; onExport: (() => void) | undefined; onImport: (() => void) | undefined; importRef: RefObject<HTMLInputElement | null>; onImportFile: (e: ChangeEvent<HTMLInputElement>) => void }`

- [ ] **Step 1: Write the failing test for `useFixCarryOver`**

Create `components/frontend-spectr-v2/src/features/listen-rack/__tests__/useFixCarryOver.test.tsx`:

```tsx
/* Story 12.4 carry-over + the draft restore it sequences, extracted out of
 * ListenRackPage (spec D10). These three cases pin the behaviour that was in
 * the page: a carried preset overlays the rack once and flips the phase to
 * 'applied'; a failed carry NEVER touches the rack; with no carry the saved
 * draft is restored instead. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const navigateSpy = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateSpy }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { ApiError, fetcher } from '../../../api/fetcher';
import type { Chain } from '../chain';
import type { RackState } from '../rackState';
import { useFixCarryOver } from '../useFixCarryOver';

const fetcherMock = vi.mocked(fetcher);

const CHAIN: Chain = { order: ['eq'], modules: {}, masterBypass: false };

function fakeRackRef() {
  const rs = {
    mod: {},
    applyRackMod: vi.fn(),
    setMasterBypass: vi.fn(),
    recallPreset: vi.fn(),
    reset: vi.fn(),
    // Only these five are reached by the hook; the cast keeps the fixture honest
    // about that instead of stubbing all 20 RackState members.
  } as unknown as RackState;
  return { ref: { current: rs }, rs };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useFixCarryOver', () => {
  beforeEach(() => {
    fetcherMock.mockReset();
    navigateSpy.mockReset();
  });

  it('applies a carried preset once and reports the module count', async () => {
    fetcherMock.mockImplementation(async ({ url }: { url: string }) => {
      if (url.includes('/rack/presets/')) {
        return {
          id: 'p1',
          name: 'Coach Mix',
          source: 'analysis',
          chain: {
            order: ['eq', 'limiter'],
            modules: { limiter: { enabled: true, ceilingDb: -0.8 }, eq: { enabled: false } },
            masterBypass: false,
          },
        };
      }
      return null; // no saved draft
    });
    const { ref, rs } = fakeRackRef();

    const { result } = renderHook(
      () => useFixCarryOver({
        versionId: 'v1', fixPreset: 'p1', realAudio: true, rsRef: ref, currentChain: CHAIN,
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.carryPhase).toBe('applied'));
    expect(result.current.fixesApplied).toBe(1); // only the ENABLED module counts
    expect(rs.applyRackMod).toHaveBeenCalledTimes(1);
  });

  it('a failed carry leaves the rack untouched and reports failed', async () => {
    fetcherMock.mockImplementation(async ({ url }: { url: string }) => {
      if (url.includes('/rack/presets/')) throw new ApiError(404, undefined);
      return null;
    });
    const { ref, rs } = fakeRackRef();

    const { result } = renderHook(
      () => useFixCarryOver({
        versionId: 'v1', fixPreset: 'gone', realAudio: true, rsRef: ref, currentChain: CHAIN,
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.carryPhase).toBe('failed'));
    expect(rs.applyRackMod).not.toHaveBeenCalled();
    expect(result.current.fixesApplied).toBeNull();
  });

  it('with no carry, the saved draft is restored', async () => {
    fetcherMock.mockImplementation(async () => ({
      chain: { order: ['eq'], modules: { eq: { enabled: true } }, masterBypass: true },
    }));
    const { ref, rs } = fakeRackRef();

    const { result } = renderHook(
      () => useFixCarryOver({
        versionId: 'v1', fixPreset: undefined, realAudio: true, rsRef: ref, currentChain: CHAIN,
      }),
      { wrapper },
    );

    await waitFor(() => expect(rs.recallPreset).toHaveBeenCalled());
    expect(rs.setMasterBypass).toHaveBeenCalledWith(true);
    expect(result.current.carryPhase).toBe('none');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/__tests__/useFixCarryOver.test.tsx 2>&1 | tail -15
```
Expected: `Failed to resolve import "../useFixCarryOver"`.

- [ ] **Step 3: Create `useFixCarryOver.ts` by moving the code verbatim**

Create `components/frontend-spectr-v2/src/features/listen-rack/useFixCarryOver.ts`:

```ts
/* Listen Rack v2 — story 12.4 fix-rack carry-over (?fixPreset=) plus the
 * server draft restore/autosave that it sequences.
 *
 * These two are ONE concern: resolveDraftRestore takes carryPhase as an input
 * (a pending carry parks the restore; an applied carry arms autosave WITHOUT
 * restoring), so splitting them re-introduces the ordering bug E6.6 fixed.
 * Moved verbatim out of ListenRackPage on 2026-09-19 to get that file back
 * under the line limit (spec D10) — no behaviour change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import type { Chain } from './chain';
import type { ModuleState } from './data';
import { overlayChain } from './fixToRackPatch';
import { clearFixOverlay } from './listenFixes';
import type { RackState } from './rackState';
import {
  asChain, resolveDraftRestore, useRackDraft, useRackDraftAutosave, useRackPreset,
} from './useRackPresets';

export type CarryPhase = 'none' | 'pending' | 'applied' | 'failed';

export interface FixCarryOver {
  /** Story 12.4: the carried-fix chip count. null = no carry. */
  fixesApplied: number | null;
  carryPhase: CarryPhase;
  onResetCarriedFixes: () => void;
}

export function useFixCarryOver({ versionId, fixPreset, realAudio, rsRef, currentChain }: {
  versionId: string | undefined;
  fixPreset: string | undefined;
  realAudio: boolean;
  /** The page's live rack-state ref — read only, never reassigned here. */
  rsRef: { current: RackState };
  currentChain: Chain;
}): FixCarryOver {
  const carryAllowedNow = Boolean(fixPreset && realAudio);
  const carryArmedRef = useRef<boolean | null>(null);
  if (carryArmedRef.current === null) carryArmedRef.current = carryAllowedNow;
  const carryArmed = Boolean(fixPreset) && carryArmedRef.current === true;
  const carriedPresetQuery = useRackPreset(
    realAudio ? (versionId ?? '') : '', carryArmed ? fixPreset : undefined);
  const [fixesApplied, setFixesApplied] = useState<number | null>(null);
  const [carryPhase, setCarryPhase] = useState<CarryPhase>(carryArmed ? 'pending' : 'none');
  const appliedPresetRef = useRef<string | null>(null); // one-shot per preset id
  const navigate = useNavigate();

  useEffect(() => {
    if (!fixPreset || appliedPresetRef.current === fixPreset) return;
    carryArmedRef.current = carryAllowedNow;
    if (carryArmedRef.current) setCarryPhase('pending');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm keys on the param only
  }, [fixPreset]);

  // Autosaved draft: restore once when it resolves, then debounced autosave.
  const draftQuery = useRackDraft(realAudio ? (versionId ?? '') : '');
  const {
    isError: draftIsError, isFetched: draftIsFetched, data: draftData,
    refetch: refetchDraft,
  } = draftQuery;
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    const decision = resolveDraftRestore({
      draftRestored, realAudio, carryPhase,
      isError: draftIsError, isFetched: draftIsFetched,
    });
    if (decision === 'wait') return;
    if (decision === 'pause') {
      toast.error("Couldn't load your saved rack draft — autosave is paused.", {
        id: 'rack-draft-load',
        action: { label: 'Retry', onClick: () => { void refetchDraft(); } },
      });
      return;
    }
    if (decision === 'restore') {
      const chain = draftData ? asChain(draftData.chain) : null;
      if (chain) {
        rsRef.current.recallPreset({
          id: 'draft', name: 'draft', by: 'you', order: chain.order,
          mod: chain.modules as Record<string, ModuleState>, n: 0,
        });
        rsRef.current.setMasterBypass(chain.masterBypass);
      }
    }
    setDraftRestored(true);
  }, [draftRestored, realAudio, carryPhase, draftIsError, draftIsFetched, draftData,
      refetchDraft, rsRef]);
  useRackDraftAutosave(versionId ?? '', currentChain, realAudio && draftRestored);

  // Apply the carried chain ONCE per preset id when it resolves.
  useEffect(() => {
    if (!carryArmed || !fixPreset || appliedPresetRef.current === fixPreset) return;
    if (carriedPresetQuery.isError) {
      appliedPresetRef.current = fixPreset;
      setCarryPhase('failed');
      toast.error('Could not load the carried fix rack — your saved draft is untouched.');
      return;
    }
    const dto = carriedPresetQuery.data;
    if (!dto) return; // still loading
    const chain = asChain(dto.chain);
    const applied = chain
      ? Object.entries(chain.modules).filter(([id, m]) => id !== 'pitch' && m?.enabled).length
      : 0;
    appliedPresetRef.current = fixPreset;
    if (!chain || applied === 0) {
      setCarryPhase('failed');
      toast.error('The carried fix rack could not be applied.');
      return;
    }
    rsRef.current.applyRackMod(overlayChain(rsRef.current.mod, chain.modules));
    rsRef.current.setMasterBypass(chain.masterBypass);
    setFixesApplied(applied);
    setCarryPhase('applied');
  }, [carryArmed, fixPreset, carriedPresetQuery.isError, carriedPresetQuery.data, rsRef]);

  const onResetCarriedFixes = useCallback(() => {
    rsRef.current.reset();
    if (versionId) clearFixOverlay(versionId);
    setFixesApplied(null);
    setCarryPhase('none');
    void navigate({
      to: '/listen-rack/$versionId',
      params: { versionId: versionId ?? '' },
      search: (prev: Record<string, unknown>) => {
        const rest = { ...prev };
        delete rest['fixPreset'];
        return rest;
      },
      replace: true,
    });
  }, [versionId, navigate, rsRef]);

  return { fixesApplied, carryPhase, onResetCarriedFixes };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/__tests__/useFixCarryOver.test.tsx 2>&1 | tail -8
```
Expected: `Tests  3 passed`.

- [ ] **Step 5: Write the failing test for `useRackPresetActions`**

Create `components/frontend-spectr-v2/src/features/listen-rack/__tests__/useRackPresetActions.test.tsx`:

```tsx
/* Preset plumbing extracted out of ListenRackPage (spec D10). Pins the DTO →
 * RackPreset projection (drift-shaped chains are DROPPED, not rendered half)
 * and the import error path. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { toast } from 'sonner';

import { fetcher } from '../../../api/fetcher';
import type { Chain } from '../chain';
import type { RackState } from '../rackState';
import { useRackPresetActions } from '../useRackPresetActions';

const fetcherMock = vi.mocked(fetcher);
const errorSpy = vi.mocked(toast.error);
const CHAIN: Chain = { order: ['eq'], modules: {}, masterBypass: false };

function fakeRs() {
  return {
    mod: {}, order: ['eq'], masterBypass: false, presets: [],
    applyRackMod: vi.fn(), setMasterBypass: vi.fn(),
    recallPreset: vi.fn(), savePreset: vi.fn(),
  } as unknown as RackState;
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useRackPresetActions', () => {
  beforeEach(() => {
    fetcherMock.mockReset();
    errorSpy.mockClear();
  });

  it('projects server preset DTOs and drops ones whose chain is unreadable', async () => {
    fetcherMock.mockResolvedValue([
      { id: 'p1', name: 'Coach Mix', source: 'analysis',
        chain: { order: ['eq'], modules: { eq: { enabled: true } }, masterBypass: false } },
      { id: 'p2', name: 'Broken', source: 'user', chain: { nope: true } },
    ]);
    const { result } = renderHook(
      () => useRackPresetActions({
        versionId: 'v1', realAudio: true, rs: fakeRs(), currentChain: CHAIN,
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]).toMatchObject({ id: 'p1', name: 'Coach Mix', n: 1 });
  });

  it('a malformed import file surfaces the parser message and saves nothing', async () => {
    fetcherMock.mockResolvedValue([]);
    const { result } = renderHook(
      () => useRackPresetActions({
        versionId: 'v1', realAudio: true, rs: fakeRs(), currentChain: CHAIN,
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.items).toEqual([]));
    fetcherMock.mockClear();

    const file = new File(['not json at all'], 'preset.json', { type: 'application/json' });
    const target = { files: [file], value: 'preset.json' } as unknown as HTMLInputElement;
    await act(async () => {
      await result.current.onImportFile({ target } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(errorSpy).toHaveBeenCalledWith('Not valid JSON.');
    expect(fetcherMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/__tests__/useRackPresetActions.test.tsx 2>&1 | tail -10
```
Expected: `Failed to resolve import "../useRackPresetActions"`.

- [ ] **Step 7: Create `useRackPresetActions.ts`**

```ts
/* Listen Rack v2 — server-backed preset list + the save/recall/export/import
 * handlers. Moved verbatim out of ListenRackPage on 2026-09-19 to get that
 * file back under the line limit (spec D10) — no behaviour change.
 *
 * The hidden <input type="file"> stays in the page; this hook owns its ref and
 * its change handler so the page keeps one line instead of twenty.
 */
import { useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import type { ChangeEvent, RefObject } from 'react';

import type { Chain } from './chain';
import type { ModuleState } from './data';
import type { RackPreset, RackState } from './rackState';
import {
  asChain, buildExportEnvelope, parseImportEnvelope, useRackPresets, useSaveRackPreset,
} from './useRackPresets';

export interface RackPresetActions {
  items: RackPreset[];
  onSave: () => void;
  onRecall: (id: string) => void;
  /** undefined on the mock demo route — the toolbar hides the button. */
  onExport: (() => void) | undefined;
  onImport: (() => void) | undefined;
  importRef: RefObject<HTMLInputElement | null>;
  onImportFile: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export function useRackPresetActions({ versionId, realAudio, rs, currentChain }: {
  versionId: string | undefined;
  realAudio: boolean;
  rs: RackState;
  currentChain: Chain;
}): RackPresetActions {
  const { data: rackPresetDtos } = useRackPresets(realAudio ? (versionId ?? '') : '');
  const saveRackPresetMut = useSaveRackPreset(versionId ?? '');
  const serverRackPresets = useMemo<RackPreset[]>(() => (rackPresetDtos ?? []).flatMap((d) => {
    const chain = asChain(d.chain);
    if (!chain) return [];
    return [{
      id: d.id, name: d.name, by: d.source, order: chain.order,
      mod: chain.modules as Record<string, ModuleState>,
      n: Object.values(chain.modules).filter((s) => s?.enabled).length,
    }];
  }), [rackPresetDtos]);

  // Unified preset handlers — server on the real route, in-memory on mock.
  const onSave = useCallback(() => {
    if (realAudio) {
      saveRackPresetMut.mutate({ name: `Preset ${serverRackPresets.length + 1}`, chain: currentChain });
    } else {
      rs.savePreset('you');
    }
  }, [realAudio, saveRackPresetMut, serverRackPresets.length, currentChain, rs]);

  const onRecall = useCallback((id: string) => {
    if (realAudio) {
      const dto = rackPresetDtos?.find((x) => x.id === id);
      const chain = dto ? asChain(dto.chain) : null;
      if (!dto || !chain) return;
      rs.recallPreset({
        id: dto.id, name: dto.name, by: dto.source, order: chain.order,
        mod: chain.modules as Record<string, ModuleState>, n: 0,
      });
      rs.setMasterBypass(chain.masterBypass);
    } else {
      const p = rs.presets.find((x) => x.id === id);
      if (p) rs.recallPreset(p);
    }
  }, [realAudio, rackPresetDtos, rs]);

  const items = realAudio ? serverRackPresets : rs.presets;

  // JSON export/import — the portability path (real route only).
  const importRef = useRef<HTMLInputElement | null>(null);
  const onExport = useCallback(() => {
    const envelope = buildExportEnvelope(`Preset ${items.length + 1}`, currentChain);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'rack-preset.json'; a.click();
    URL.revokeObjectURL(url);
  }, [items.length, currentChain]);

  const onImportFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { name, chain } = parseImportEnvelope(await file.text());
      saveRackPresetMut.mutate({ name, chain }, { onSuccess: () => toast.success(`Imported "${name}".`) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.');
    }
  }, [saveRackPresetMut]);

  const openImport = useCallback(() => importRef.current?.click(), []);

  return {
    items,
    onSave,
    onRecall,
    onExport: realAudio ? onExport : undefined,
    onImport: realAudio ? openImport : undefined,
    importRef,
    onImportFile,
  };
}
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/__tests__/useRackPresetActions.test.tsx 2>&1 | tail -8
```
Expected: `Tests  2 passed`.

- [ ] **Step 9: Delete the moved code from `ListenRackPage.tsx` and call the hooks**

Delete these ranges (identify them by their leading comments, not by line number):
- from `const { data: rackPresetDtos } = useRackPresets(...)` through `}), [rackPresetDtos]);` (the `serverRackPresets` memo, ~`:184-194`)
- from `// ── Story 12.4: fix-rack carry-over (?fixPreset=) ──` through the end of `onResetCarriedFixes` (~`:196-292`)
- from `// Unified preset handlers` through the end of `onImportFile` (~`:294-339`)

In their place, immediately after the `currentChain` memo, insert:

```tsx
  const { fixesApplied, carryPhase, onResetCarriedFixes } = useFixCarryOver({
    versionId, fixPreset, realAudio, rsRef, currentChain,
  });
  const presetActions = useRackPresetActions({ versionId, realAudio, rs, currentChain });
```

Then fix the four consumers:
- `presets={rackPresetItems}` → `presets={presetActions.items}`
- `onRecallPreset={onRecallRackPreset}` → `onRecallPreset={presetActions.onRecall}`
- `onSavePreset={onSaveRackPreset}` → `onSavePreset={presetActions.onSave}`
- `onExport={realAudio ? onExportPreset : undefined}` → `onExport={presetActions.onExport}`
- `onImport={realAudio ? () => importInputRef.current?.click() : undefined}` → `onImport={presetActions.onImport}`
- the hidden input near the bottom →
  ```tsx
  <input ref={presetActions.importRef} type="file" accept="application/json,.json" onChange={(e) => { void presetActions.onImportFile(e); }} style={{ display: 'none' }} />
  ```

Add the two imports:
```tsx
import { useFixCarryOver } from './useFixCarryOver';
import { useRackPresetActions } from './useRackPresetActions';
```

Remove every import that is now unused. After the edit, these must be gone from `ListenRackPage.tsx`: `useNavigate`, `overlayChain`, `clearFixOverlay`, `asChain`, `buildExportEnvelope`, `parseImportEnvelope`, `resolveDraftRestore`, `useRackDraft`, `useRackDraftAutosave`, `useRackPreset`, `useRackPresets`, `useSaveRackPreset`, `type RackPreset`, `type Chain` (keep `Chain` only if `currentChain` is still annotated — it is: `useMemo<Chain>`, so KEEP `import type { Chain } from './chain';`). `toast` stays (used by `togglePlay`). `ModuleState` stays only if still referenced — after the deletions it is not, so drop it from the `./data` import list.

- [ ] **Step 10: Verify the page shrank and everything still passes**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && \
wc -l src/features/listen-rack/ListenRackPage.tsx && \
npx tsc -b && npm run lint && npx vitest run 2>&1 | tail -6
```
Expected: `ListenRackPage.tsx` is between 470 and 500 lines; `tsc` silent; lint clean; vitest `Tests  <baseline + 5> passed`, 0 failed. `carryOver.test.tsx`, `rack-draft-none.test.tsx` and `rack-draft-feedback.test.tsx` must all still pass — they are the regression net for this extraction.

- [ ] **Step 11: Commit**

```bash
cd C:/Users/badmin/projects/spectr-solo && git add \
  components/frontend-spectr-v2/src/features/listen-rack/useFixCarryOver.ts \
  components/frontend-spectr-v2/src/features/listen-rack/useRackPresetActions.ts \
  components/frontend-spectr-v2/src/features/listen-rack/__tests__/useFixCarryOver.test.tsx \
  components/frontend-spectr-v2/src/features/listen-rack/__tests__/useRackPresetActions.test.tsx \
  components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx && \
git commit -m "refactor(listen): lift carry-over and preset plumbing out of the page

ListenRackPage was 635 lines. The 12.4 carry-over (with the draft restore it
sequences) and the preset save/recall/export/import handlers are two
self-contained concerns; both move out with no behaviour change and gain the
hook tests they never had. Spec D10.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Pure helpers and the stage prefs

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen-rack/findings/findings-helpers.ts`
- Create: `components/frontend-spectr-v2/src/features/listen-rack/findings/stage-prefs.ts`
- Test: `components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/findings-helpers.test.ts`
- Test: `components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/stage-prefs.test.ts`

**Interfaces:**
- Consumes: `CarryPhase` from Task 2.
- Produces:
  - `export interface SeekTarget { start: number; end: number | null; label: string }`
  - `export function timeRangeOf(v: VerdictDto, durationSeconds: number): SeekTarget | null`
  - `export interface ApplyGate { enabled: boolean; reason: string | null; showClearPreset: boolean }`
  - `export function applyGate(carryPhase: CarryPhase): ApplyGate`
  - `export function boardListenFixes(moves: Move[]): ListenFix[]`
  - `export type StageContent = 'findings' | 'visualizer'`
  - `export interface StagePrefs { content: StageContent; bgViz: boolean }`
  - `export const STAGE_PREFS_KEY = 'listenStagePrefs'`
  - `export function defaultStagePrefs(): StagePrefs`, `readStagePrefs(): StagePrefs`, `writeStagePrefs(p: StagePrefs): void`
  - `export interface StagePrefsHandle extends StagePrefs { setContent(c: StageContent): void; setBgViz(v: boolean): void }`
  - `export function useStagePrefs(): StagePrefsHandle`

- [ ] **Step 1: Write the failing helper test**

Create `components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/findings-helpers.test.ts`:

```ts
/* Spec D4 + D8: the seek affordance only exists where the data does, and a
 * carried preset locks per-fix applying until it is cleared. */
import { describe, expect, it } from 'vitest';

import type { VerdictDto } from '../../../../api/types';
import type { Move } from '../../../results/move-model';
import { applyGate, boardListenFixes, timeRangeOf } from '../findings-helpers';

function verdict(patch: Partial<VerdictDto> = {}): VerdictDto {
  return {
    id: 'v1', analysisId: 'a1', specialist: 'low_end', promptVersion: '1', model: 'test',
    severity: 'critical', category: 'low_end', confidence: 0.8, priorityScore: 120,
    impact: null, chartType: null, headline: 'Sub is masking the kick',
    summary: 'Too much 40 Hz under the kick.', body: null, metricLine: null,
    whyItMatters: null, presetName: null, evidence: null, fix: null, sources: null,
    problemId: 'p1', kind: 'fault', source: 'rule_engine', dataTier: 'audio_only',
    fixable: true, suspected: false, where: null, refines: null,
    priorityBase: null, priorityCategoryWeight: null, priorityScopeMultiplier: null,
    scope: null, createdAt: '2026-09-19T00:00:00Z',
    userState: { dismissed: false, applied: false, feedback: null },
    ...patch,
  };
}

describe('timeRangeOf', () => {
  it('reads a start+end from `where` and labels it in the transport clock', () => {
    const t = timeRangeOf(verdict({ where: { start_seconds: 83, end_seconds: 101 } }), 240);
    expect(t).toEqual({ start: 83, end: 101, label: '1:23–1:41' });
  });

  it('falls back to fix.section when `where` has no seconds', () => {
    const t = timeRangeOf(
      verdict({ where: { section_type: 'drop' }, fix: { section: { start_seconds: 30 } } }),
      240,
    );
    expect(t).toEqual({ start: 30, end: null, label: '0:30' });
  });

  it('drops an end that is not after the start, keeping the start', () => {
    const t = timeRangeOf(verdict({ where: { start_seconds: 50, end_seconds: 50 } }), 240);
    expect(t).toEqual({ start: 50, end: null, label: '0:50' });
  });

  it('returns null when there is no range at all', () => {
    expect(timeRangeOf(verdict(), 240)).toBeNull();
    expect(timeRangeOf(verdict({ where: { section_type: 'drop' } }), 240)).toBeNull();
  });

  it('refuses a start past the end of the track or a non-finite one', () => {
    expect(timeRangeOf(verdict({ where: { start_seconds: 9999 } }), 240)).toBeNull();
    expect(timeRangeOf(verdict({ where: { start_seconds: -3 } }), 240)).toBeNull();
    expect(timeRangeOf(verdict({ where: { start_seconds: Number.NaN } }), 240)).toBeNull();
  });

  it('accepts any start when the duration is not known yet', () => {
    expect(timeRangeOf(verdict({ where: { start_seconds: 9999 } }), 0)?.start).toBe(9999);
  });
});

describe('applyGate', () => {
  it('is open with no carry and after a failed carry', () => {
    expect(applyGate('none')).toEqual({ enabled: true, reason: null, showClearPreset: false });
    expect(applyGate('failed').enabled).toBe(true);
  });

  it('is shut while a carried preset is loading, with no clear button yet', () => {
    expect(applyGate('pending')).toEqual({
      enabled: false, reason: 'Loading the carried fix rack…', showClearPreset: false,
    });
  });

  it('is shut with a clear button once a preset is on the rack', () => {
    expect(applyGate('applied')).toEqual({
      enabled: false,
      reason: 'A fix preset is loaded — clear it to A/B single fixes.',
      showClearPreset: true,
    });
  });
});

describe('boardListenFixes', () => {
  function move(patch: Partial<Move> = {}): Move {
    return {
      id: 'm1', title: 'Cut 45 Hz', group: 'quick', sev: 'crit', scope: 'Master bus',
      directive: 'Cut 3 dB at 45 Hz.', directional: 'Tame the sub.', steps: [],
      hasParams: true, why: '', evidence: { type: 'none', metric: '', chartType: null },
      confidence: 0.8, impact: 90, source: 'Low End', isRule: false, specialist: 'low_end',
      status: 'suggested', verdictId: 'v1',
      ops: [{ type: 'eq', params: { freq: 45, gain_db: -3, q: 1 } }],
      ...patch,
    };
  }

  it('keeps every AI move with ops, regardless of what the report queued', () => {
    const fixes = boardListenFixes([move(), move({ id: 'm2', verdictId: 'v2' })]);
    expect(fixes.map((f) => f.fixId)).toEqual(['m1', 'm2']);
    expect(fixes[0].notApplicable).toBe(false);
  });

  it('drops rule-engine prose moves, which have no verdict and no ops', () => {
    expect(boardListenFixes([move({ id: 'r1', verdictId: null, ops: [] })])).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the failing prefs test**

Create `components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/stage-prefs.test.ts`:

```ts
/* Spec D6: the stage remembers what it was showing, per viewer — and the page
 * must work when it cannot remember anything at all. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultStagePrefs, readStagePrefs, STAGE_PREFS_KEY, writeStagePrefs,
} from '../stage-prefs';

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
}

describe('stage prefs', () => {
  beforeEach(() => {
    localStorage.clear();
    mockReducedMotion(false);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('first visit = findings in the box, visuals behind the page', () => {
    expect(readStagePrefs()).toEqual({ content: 'findings', bgViz: true });
  });

  it('first visit under prefers-reduced-motion leaves the background still', () => {
    mockReducedMotion(true);
    expect(defaultStagePrefs()).toEqual({ content: 'findings', bgViz: false });
  });

  it('an explicit choice beats the reduced-motion default', () => {
    mockReducedMotion(true);
    writeStagePrefs({ content: 'visualizer', bgViz: true });
    expect(readStagePrefs()).toEqual({ content: 'visualizer', bgViz: true });
  });

  it('round-trips a stored choice', () => {
    writeStagePrefs({ content: 'visualizer', bgViz: false });
    expect(readStagePrefs()).toEqual({ content: 'visualizer', bgViz: false });
  });

  it('falls back on garbage, on a wrong-shaped payload, and on a wrong content value', () => {
    localStorage.setItem(STAGE_PREFS_KEY, 'not json');
    expect(readStagePrefs()).toEqual({ content: 'findings', bgViz: true });
    localStorage.setItem(STAGE_PREFS_KEY, '"a string"');
    expect(readStagePrefs()).toEqual({ content: 'findings', bgViz: true });
    localStorage.setItem(STAGE_PREFS_KEY, JSON.stringify({ content: 'moon', bgViz: 'yes' }));
    expect(readStagePrefs()).toEqual({ content: 'findings', bgViz: true });
  });

  it('survives storage that throws on read and on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(readStagePrefs()).toEqual({ content: 'findings', bgViz: true });
    expect(() => writeStagePrefs({ content: 'visualizer', bgViz: false })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run both and watch them fail**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/findings 2>&1 | tail -10
```
Expected: `Failed to resolve import "../findings-helpers"` and `"../stage-prefs"`.

- [ ] **Step 4: Write `findings-helpers.ts`**

```ts
/* Listen findings board — pure helpers. No React, no I/O, no DOM. */
import type { VerdictDto } from '../../../api/types';
import type { Move } from '../../results/move-model';
import { buildListenFixes, type ListenFix } from '../listenFixes';
import { lrTime } from '../lrUtil';
import type { CarryPhase } from '../useFixCarryOver';

export interface SeekTarget {
  start: number;
  end: number | null;
  /** "1:23" or "1:23–1:41", in the transport's own clock. */
  label: string;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Spec D4 — the playable moment a finding points at, or null when it carries
 * none we can trust. `where` (the rule engine's localisation) wins over
 * `fix.section`. A start past the end of the track is not a start: the worker
 * has written placeholder seconds before, and a dead "jump" button is worse
 * than no button. `durationSeconds <= 0` means "not known yet" and skips the
 * bound rather than rejecting everything while the audio loads.
 */
export function timeRangeOf(v: VerdictDto, durationSeconds: number): SeekTarget | null {
  const sources: Array<{ start: unknown; end: unknown }> = [
    { start: v.where?.start_seconds, end: v.where?.end_seconds },
    { start: v.fix?.section?.start_seconds, end: v.fix?.section?.end_seconds },
  ];
  for (const s of sources) {
    const start = finiteOrNull(s.start);
    if (start === null || start < 0) continue;
    if (durationSeconds > 0 && start >= durationSeconds) continue;
    const rawEnd = finiteOrNull(s.end);
    const end =
      rawEnd !== null && rawEnd > start && (durationSeconds <= 0 || rawEnd <= durationSeconds)
        ? rawEnd
        : null;
    return {
      start,
      end,
      label: end === null ? lrTime(start) : `${lrTime(start)}–${lrTime(end)}`,
    };
  }
  return null;
}

export interface ApplyGate {
  enabled: boolean;
  /** Why applying is off right now; rendered verbatim. null when enabled. */
  reason: string | null;
  /** True when a Clear-preset button belongs next to the reason. */
  showClearPreset: boolean;
}

/**
 * Spec D8 — a carried ?fixPreset= chain is auditioned AS ONE. Per-fix toggling
 * stays off until it is cleared, because `combineFixes` is a weighted merge and
 * a merged chain cannot be decomposed back into the fixes that built it. A
 * carry that FAILED never reached the rack, so toggling is live.
 */
export function applyGate(carryPhase: CarryPhase): ApplyGate {
  if (carryPhase === 'pending') {
    return { enabled: false, reason: 'Loading the carried fix rack…', showClearPreset: false };
  }
  if (carryPhase === 'applied') {
    return {
      enabled: false,
      reason: 'A fix preset is loaded — clear it to A/B single fixes.',
      showClearPreset: true,
    };
  }
  return { enabled: true, reason: null, showClearPreset: false };
}

/**
 * Every applyable AI move as a ListenFix row. The Listen board can apply ANY
 * of them, not just the subset the report queued, so the filter is
 * always-true. `Move` satisfies `FixSource` structurally, so this is the
 * existing builder rather than a parallel adapter. Rule-engine prose moves
 * (no verdict, no ops) are dropped — they have nothing to put on a rack.
 */
export function boardListenFixes(moves: Move[]): ListenFix[] {
  return buildListenFixes(
    moves.filter((m) => m.verdictId != null && m.ops.length > 0),
    () => true,
  );
}
```

- [ ] **Step 5: Write `stage-prefs.ts`**

```ts
/* Listen stage placement prefs. These are about the VIEWER, not the track, so
 * they live under one localStorage key rather than per version. Every access is
 * try/catch'd: the page must work in a private window, with site data blocked,
 * and in a test environment that has no storage at all. */
import { useCallback, useState } from 'react';

export type StageContent = 'findings' | 'visualizer';

export interface StagePrefs {
  content: StageContent;
  /** The visualizer is playing full-screen BEHIND the page. */
  bgViz: boolean;
}

export const STAGE_PREFS_KEY = 'listenStagePrefs';

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/**
 * Spec D6 — first visit is findings in the box with the visuals behind the
 * page, except under prefers-reduced-motion, where nothing moves until the
 * viewer asks for it. This is only the DEFAULT: a stored choice always wins,
 * because someone who switched the background on meant it.
 */
export function defaultStagePrefs(): StagePrefs {
  return { content: 'findings', bgViz: !prefersReducedMotion() };
}

export function readStagePrefs(): StagePrefs {
  const fallback = defaultStagePrefs();
  try {
    const raw = localStorage.getItem(STAGE_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const obj = parsed as Record<string, unknown>;
    return {
      content: obj['content'] === 'visualizer' ? 'visualizer' : 'findings',
      bgViz: typeof obj['bgViz'] === 'boolean' ? obj['bgViz'] : fallback.bgViz,
    };
  } catch {
    return fallback;
  }
}

export function writeStagePrefs(prefs: StagePrefs): void {
  try {
    localStorage.setItem(STAGE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / unavailable — the page works without it */
  }
}

export interface StagePrefsHandle extends StagePrefs {
  setContent: (content: StageContent) => void;
  setBgViz: (bgViz: boolean) => void;
}

export function useStagePrefs(): StagePrefsHandle {
  const [prefs, setPrefs] = useState<StagePrefs>(readStagePrefs);
  const update = useCallback((patch: Partial<StagePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writeStagePrefs(next);
      return next;
    });
  }, []);
  const setContent = useCallback((content: StageContent) => update({ content }), [update]);
  const setBgViz = useCallback((bgViz: boolean) => update({ bgViz }), [update]);
  return { ...prefs, setContent, setBgViz };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/findings 2>&1 | tail -8
```
Expected: `Tests  19 passed` (13 helper + 6 prefs).

- [ ] **Step 7: Gates**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx tsc -b && npm run lint && npx vitest run 2>&1 | tail -5
```
Expected: all green, 0 failed.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/badmin/projects/spectr-solo && git add \
  components/frontend-spectr-v2/src/features/listen-rack/findings/findings-helpers.ts \
  components/frontend-spectr-v2/src/features/listen-rack/findings/stage-prefs.ts \
  components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/findings-helpers.test.ts \
  components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/stage-prefs.test.ts && \
git commit -m "feat(listen): seek targets, the apply gate, and stage prefs

Pure pieces for the findings-in-stage board: a time range only exists when the
payload can back it (D4), a carried preset is auditioned as one chain rather
than mixed with single fixes (D8), and the stage remembers what it was showing
without ever depending on storage being there (D6).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The board learns a `listen` surface

The report board is reused as-is. It gains one variant prop and an optional seek affordance — no fork, no copy (**D9**, **D4**).

**Files:**
- Modify: `components/frontend-spectr-v2/src/features/results/fix-board-helpers.ts` (append two exports)
- Modify: `components/frontend-spectr-v2/src/features/results/FixBoard.tsx`
- Modify: `components/frontend-spectr-v2/src/features/results/FindingDetail.tsx`
- Modify: `components/frontend-spectr-v2/src/features/results/ActionDetail.tsx`
- Test: `components/frontend-spectr-v2/src/features/results/__tests__/FixBoard.surface.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (all from `features/results/fix-board-helpers.ts` unless noted):
  - `export type FixBoardSurface = 'report' | 'listen'`
  - `export interface SeekAffordance { label: (v: VerdictDto) => string | null; go: (v: VerdictDto) => void }`
  - `FixBoard` props: `surface?: FixBoardSurface | undefined`, `seek?: SeekAffordance | undefined`; `onAskCoach`, `onIgnore`, `onMarkApplied`, `onRate` are now `?: ... | undefined`.
  - Same two props on `FindingDetail` and `ActionDetail`.

- [ ] **Step 1: Write the failing test**

Create `components/frontend-spectr-v2/src/features/results/__tests__/FixBoard.surface.test.tsx`:

```tsx
// @vitest-environment jsdom
/* Spec D2/D9: the same board, mounted on Listen, must offer no way to write
 * server state and must not tell the reader to go to the page they are on.
 * The report surface stays exactly as it was. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerdictDto } from '../../../api/types';
import { FixBoard } from '../FixBoard';
import { buildMoves, type Move } from '../move-model';

afterEach(cleanup);

const VERDICT: VerdictDto = {
  id: 'v1', analysisId: 'a1', specialist: 'low_end', promptVersion: '1', model: 'test',
  severity: 'critical', category: 'low_end', confidence: 0.8, priorityScore: 120,
  impact: null, chartType: null, headline: 'Sub is masking the kick',
  summary: 'Too much 40 Hz under the kick.', body: null, metricLine: null,
  whyItMatters: null, presetName: null, evidence: null,
  fix: {
    target: { name: 'Master bus' },
    expected_outcome: 'The kick reads again.',
    dsp_chain: [{ type: 'eq', params: { freq: 45, gain_db: -3, q: 1 } }],
  },
  sources: null, problemId: 'p1', kind: 'fault', source: 'rule_engine',
  dataTier: 'audio_only', fixable: true, suspected: false,
  where: { start_seconds: 83, end_seconds: 101 }, refines: null,
  priorityBase: null, priorityCategoryWeight: null, priorityScopeMultiplier: null,
  scope: null, createdAt: '2026-09-19T00:00:00Z',
  userState: { dismissed: false, applied: false, feedback: null },
};

const MOVES: Move[] = buildMoves({ verdicts: [VERDICT] });

function renderBoard(extra: Partial<React.ComponentProps<typeof FixBoard>> = {}) {
  return render(
    <FixBoard
      mode="actions"
      verdicts={[VERDICT]}
      moves={MOVES}
      committedIds={new Set<string>()}
      onToggleCommit={vi.fn()}
      checkedNoteIds={new Set<string>()}
      onToggleNote={vi.fn()}
      focusId={null}
      onConsumeFocus={vi.fn()}
      onShowFix={vi.fn()}
      onShowFinding={vi.fn()}
      {...extra}
    />,
  );
}

describe('FixBoard surface="report" (unchanged)', () => {
  it('keeps the server-write actions and the send-to-Listen copy', () => {
    renderBoard({
      onAskCoach: vi.fn(), onIgnore: vi.fn(), onMarkApplied: vi.fn(), onRate: vi.fn(),
    });
    expect(screen.getByText('Mark applied')).toBeTruthy();
    expect(screen.getByText('Rate this Suggestion')).toBeTruthy();
    expect(screen.getByText('Add to fix rack')).toBeTruthy();
    expect(screen.getByText('Add to apply live on the Listen page')).toBeTruthy();
  });
});

describe('FixBoard surface="listen"', () => {
  it('offers no server-state write at all', () => {
    renderBoard({ surface: 'listen' });
    expect(screen.queryByText('Mark applied')).toBeNull();
    expect(screen.queryByText('Rate this Suggestion')).toBeNull();
    expect(screen.queryByText(/Ask the coach about this/i)).toBeNull();
  });

  it('applies to the rack instead of queueing for a page you are already on', () => {
    renderBoard({ surface: 'listen' });
    expect(screen.getByText('Apply live')).toBeTruthy();
    expect(screen.getByText('Apply it to hear it on the rack now')).toBeTruthy();
    expect(screen.queryByText(/Listen page/)).toBeNull();
  });

  it('shows the jump affordance only when the finding carries a range', () => {
    const go = vi.fn();
    renderBoard({
      surface: 'listen',
      seek: { label: (v) => (v.where?.start_seconds != null ? '1:23–1:41' : null), go },
    });
    const chip = screen.getByTitle('Jump to this moment in the track');
    expect(chip.textContent).toContain('1:23–1:41');
    chip.click();
    expect(go).toHaveBeenCalledWith(VERDICT);
  });

  it('renders nothing at all when the finding has no range', () => {
    renderBoard({ surface: 'listen', seek: { label: () => null, go: vi.fn() } });
    expect(screen.queryByTitle('Jump to this moment in the track')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/results/__tests__/FixBoard.surface.test.tsx 2>&1 | tail -20
```
Expected: TypeScript/runtime failures — `surface` and `seek` are not props, and the four handlers are required.

- [ ] **Step 3: Add the shared types**

Append to `components/frontend-spectr-v2/src/features/results/fix-board-helpers.ts`:

```ts
/** Which page the board is mounted on. `listen` is READ-ONLY toward the server
 *  (spec D2): no dismiss, no mark-applied, no feedback — and "apply" means the
 *  live rack, not a queue. */
export type FixBoardSurface = 'report' | 'listen';

/** Spec D4 — the "jump to it" affordance. `label` returns null when the finding
 *  carries no usable time range, and then NOTHING renders: no disabled button,
 *  no tooltip, no placeholder. */
export interface SeekAffordance {
  label: (v: VerdictDto) => string | null;
  go: (v: VerdictDto) => void;
}
```

- [ ] **Step 4: Thread the props through `FixBoard.tsx`**

In `FixBoardProps`, change the four handlers to optional and add the two new props:

```ts
  onAskCoach?: ((v: VerdictDto) => void) | undefined;
  /** Server dismiss. Never supplied on the Listen surface (spec D2). */
  onIgnore?: ((v: VerdictDto) => void) | undefined;
  onMarkApplied?: ((v: VerdictDto) => void) | undefined;
  onRate?: ((v: VerdictDto, rating: number, notes: string) => void) | undefined;
  onShowSpectrum?: ((range: [number, number]) => void) | undefined;
  /** Which page this board is on. Default 'report' — everything below that is
   *  conditional on it is a server write or report-only geography (spec D9). */
  surface?: FixBoardSurface | undefined;
  seek?: SeekAffordance | undefined;
```

Add `FixBoardSurface` and `SeekAffordance` to the existing `./fix-board-helpers` type import. Destructure `surface = 'report'` and `seek` in the component signature, and pass them on:

- every `<BoardRow … />` (both of them) gains `surface={surface}`
- `<FindingDetail … surface={surface} seek={seek} />`
- `<ActionDetail … surface={surface} seek={seek} />`

In `BoardRow`'s props add `surface: FixBoardSurface;` and make `onAskCoach`/`onIgnore` optional with the same `| undefined` style. Replace the findings-mode `.fr-acts` block with:

```tsx
        <span className="fr-acts" onClick={(e) => e.stopPropagation()}>
          {move ? (
            <span
              className={`fr-ckbox gloss${committed ? ' on' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onToggleCommit(move)}
              onKeyDown={(e) => e.key === 'Enter' && onToggleCommit(move)}
            >
              <Icon name={committed ? 'check' : 'plus'} size={11} />
              <span className="gtip">
                {surface === 'listen'
                  ? 'A suggested fix is available — check to hear it'
                  : 'A suggested fix is available — check to queue it'}
              </span>
            </span>
          ) : surface === 'report' ? (
            <span
              className={`fr-ckbox off gloss${noted ? ' on' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onToggleNote(v.id)}
              onKeyDown={(e) => e.key === 'Enter' && onToggleNote(v.id)}
            >
              {noted && <Icon name="check" size={11} />}
              <span className="gtip">No one-click fix — check to add as a note to Actions</span>
            </span>
          ) : null}
          {surface === 'report' && onAskCoach && (
            <span
              className="fr-ic gloss"
              role="button"
              tabIndex={0}
              onClick={() => onAskCoach(v)}
              onKeyDown={(e) => e.key === 'Enter' && onAskCoach(v)}
            >
              <CoachStatic size={15} />
              <span className="gtip">Ask the Coach about this</span>
            </span>
          )}
          {surface === 'report' && !dismissed && onIgnore && (
            <span
              className="fr-ic gloss"
              role="button"
              tabIndex={0}
              onClick={() => onIgnore(v)}
              onKeyDown={(e) => e.key === 'Enter' && onIgnore(v)}
            >
              <Icon name="eyeoff" size={13} />
              <span className="gtip">Ignore this finding — hides its action too</span>
            </span>
          )}
        </span>
```

And change the actions-mode add button's `title` to:

```tsx
          title={
            committed
              ? surface === 'listen' ? 'Remove from the rack' : 'Remove from Listen queue'
              : surface === 'listen' ? 'Apply to the rack' : 'Queue this fix'
          }
```

- [ ] **Step 5: Update `FindingDetail.tsx`**

Add to `FindingDetailProps`:

```ts
  onAskCoach?: ((v: VerdictDto) => void) | undefined;
  surface?: FixBoardSurface | undefined;
  seek?: SeekAffordance | undefined;
```

Import the two types from `./fix-board-helpers` (the file already imports `defaultWhy, groupForVerdict, sevTitle, specName` from there). Destructure `surface = 'report'` and `seek`. After `const dimmed = f.userState.dismissed;` add:

```tsx
  const seekLabel = seek ? seek.label(f) : null;
  const showAsk = surface === 'report' && onAskCoach != null;
```

Insert the chip directly after `<MetaChips v={f} />`:

```tsx
        {seek && seekLabel && (
          <button
            type="button"
            className="fbd-seek"
            title="Jump to this moment in the track"
            onClick={() => seek.go(f)}
          >
            <Icon name="play" size={11} />
            {seekLabel}
          </button>
        )}
```

Replace the footer CTA block with:

```tsx
        {(showAsk || move) && (
          <div className="fbd-cta divided">
            {showAsk && (
              <button type="button" className="fbd-ask" onClick={() => onAskCoach?.(f)}>
                <span className="coach-ic">
                  <CoachStatic size={17} />
                </span>
                Ask the coach about this
              </button>
            )}
            {move && (
              <button
                type="button"
                className="fbd-ask green"
                onClick={() => onShowFix(f.id)}
                title={`${move.title} — open on the Actions tab`}
              >
                Show Suggested Fix
                <Icon name="arrow" size={13} />
              </button>
            )}
          </div>
        )}
```

- [ ] **Step 6: Update `ActionDetail.tsx`**

Add to `ActionDetailProps` (and import `FixBoardSurface`, `SeekAffordance` from `./fix-board-helpers`, which is already imported for `GROUP_TIP` etc.):

```ts
  onAskCoach?: ((v: VerdictDto) => void) | undefined;
  onMarkApplied?: ((v: VerdictDto) => void) | undefined;
  onRate?: ((v: VerdictDto, rating: number, notes: string) => void) | undefined;
  surface?: FixBoardSurface | undefined;
  seek?: SeekAffordance | undefined;
```

Destructure `surface = 'report'` and `seek`. After `const expectedOutcome = …` add:

```tsx
  // Spec D2/D9 — the Listen surface never writes server state, and must not
  // tell the reader to go to the page they are already standing on.
  const listen = surface === 'listen';
  const seekLabel = seek ? seek.label(f) : null;
```

Then make exactly these edits:

1. After the `<SourceTag …/>` line that closes `.fbd-meta`, insert the same chip as in `FindingDetail`:
```tsx
        {seek && seekLabel && (
          <button
            type="button"
            className="fbd-seek"
            title="Jump to this moment in the track"
            onClick={() => seek.go(f)}
          >
            <Icon name="play" size={11} />
            {seekLabel}
          </button>
        )}
```
2. Master scope chip tip → `{listen ? 'Applies to the whole master bus — the rack reproduces it exactly.' : 'Applies to the whole master bus — the Listen rack reproduces it exactly.'}`
3. Device scope chip tip → replace the sentence with:
```tsx
                            This fix targets {move.scope}.{' '}
                            {listen
                              ? 'Listen plays the bounced mix, so applying it auditions a master-bus approximation'
                              : 'Listen plays the bounced mix, so adding it auditions a master-bus approximation'}
                            {' '}— the exact per-device move is in your DAW Plan.
```
4. The `.fbd-footnote` block →
```tsx
                      <span className="fbd-footnote">
                        {added ? (
                          <>
                            <span className="dot on" />
                            {listen ? 'Applied to the rack' : 'Queued for Listen'}
                            {!isMaster && ' · approximation'}
                          </>
                        ) : listen ? (
                          isMaster
                            ? 'Apply it to hear it on the rack now'
                            : 'Apply it to preview an approximation'
                        ) : isMaster ? (
                          'Add to apply live on the Listen page'
                        ) : (
                          'Add to preview an approximation on Listen'
                        )}
                      </span>
```
5. The toggle button label →
```tsx
                        <Icon name={added ? 'check' : 'plus'} size={12} />
                        {listen
                          ? added ? 'Applied' : 'Apply live'
                          : added ? 'Added' : 'Add to fix rack'}
```
6. Wrap the whole `<div className="fbd-fb">…</div>` block **and** the `{rateOpen && <RatingModal …/>}` that follows it in `{!listen && ( … )}`, and change the two handler calls inside to `onMarkApplied?.(f)` and `onRate?.(f, rating, notes)`.
7. In the note branch, the DAW sub-line →
```tsx
              <p className="sub mono">
                {listen
                  ? 'This is a DAW move — apply it in your project; there is nothing to put on the rack.'
                  : 'This is a DAW move — apply it in your project; nothing gets queued to Listen.'}
              </p>
```
8. In the note branch's `.fbd-cta`, wrap the ask-coach button in `{surface === 'report' && onAskCoach && ( … )}` and call `onAskCoach(f)` inside.

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/results/__tests__/FixBoard.surface.test.tsx 2>&1 | tail -10
```
Expected: `Tests  5 passed`.

Note: the `.fbd-seek` rule does not exist yet (Task 6 adds it). The chip is unstyled in this test and in the app until then — that is fine; the test asserts behaviour, not appearance.

- [ ] **Step 8: Gates**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx tsc -b && npm run lint && npx vitest run 2>&1 | tail -5
```
Expected: 0 failed. `ReportView.tsx` needs no change — it already passes all four handlers, and `surface` defaults to `'report'`.

- [ ] **Step 9: Commit**

```bash
cd C:/Users/badmin/projects/spectr-solo && git add \
  components/frontend-spectr-v2/src/features/results/fix-board-helpers.ts \
  components/frontend-spectr-v2/src/features/results/FixBoard.tsx \
  components/frontend-spectr-v2/src/features/results/FindingDetail.tsx \
  components/frontend-spectr-v2/src/features/results/ActionDetail.tsx \
  components/frontend-spectr-v2/src/features/results/__tests__/FixBoard.surface.test.tsx && \
git commit -m "feat(results): give the findings board a read-only listen surface

One variant prop, not a fork. On Listen the board writes nothing to the server
and stops pointing at the page it is already on, and a finding can offer to
jump to itself when — and only when — it carries a time range.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `useListenFindings` — one query, one overlay

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen-rack/findings/useListenFindings.ts`
- Test: `components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/useListenFindings.test.tsx`

**Interfaces:**
- Consumes: `boardListenFixes` (Task 3); `VersionDto.latestJobId` is supplied by the caller as a plain string (Task 1/8).
- Produces:
  - `export interface FixOverlayHandle { isApplied: (fixId: string) => boolean; toggle: (fixId: string) => void }`
  - `export type ListenFindingsStatus = 'no-analysis' | 'loading' | 'error' | 'ready'`
  - `export interface ListenFindings { status: ListenFindingsStatus; jobId: string | null; verdicts: VerdictDto[]; moves: Move[]; appliedIds: ReadonlySet<string>; overlay: FixOverlayHandle; retry: () => void }`
  - `export function useListenFindings(args: { versionId: string; latestJobId: string | null; rs: RackState }): ListenFindings`

- [ ] **Step 1: Write the failing test**

Create `components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/useListenFindings.test.tsx`:

```tsx
/* Spec D3/D11/D12: findings come from the PLAYING version's own job, the board
 * needs nothing but the verdicts, and there is exactly ONE fix overlay on the
 * page — a toggle must produce exactly one rack write. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('../../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { ApiError, fetcher } from '../../../../api/fetcher';
import type { VerdictDto } from '../../../../api/types';
import type { RackState } from '../../rackState';
import { useListenFindings } from '../useListenFindings';

const fetcherMock = vi.mocked(fetcher);

const VERDICT: VerdictDto = {
  id: 'v1', analysisId: 'a1', specialist: 'low_end', promptVersion: '1', model: 'test',
  severity: 'critical', category: 'low_end', confidence: 0.8, priorityScore: 120,
  impact: null, chartType: null, headline: 'Sub is masking the kick',
  summary: null, body: null, metricLine: null, whyItMatters: null, presetName: null,
  evidence: null,
  fix: { dsp_chain: [{ type: 'eq', params: { freq: 45, gain_db: -3, q: 1 } }] },
  sources: null, problemId: 'p1', kind: 'fault', source: 'rule_engine',
  dataTier: 'audio_only', fixable: true, suspected: false, where: null, refines: null,
  priorityBase: null, priorityCategoryWeight: null, priorityScopeMultiplier: null,
  scope: null, createdAt: '2026-09-19T00:00:00Z',
  userState: { dismissed: false, applied: false, feedback: null },
};

function fakeRs() {
  return { mod: {}, applyRackMod: vi.fn() } as unknown as RackState;
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useListenFindings', () => {
  beforeEach(() => {
    fetcherMock.mockReset();
    localStorage.clear();
  });

  it('reports no-analysis and asks the server for nothing when the version has no job', () => {
    const { result } = renderHook(
      () => useListenFindings({ versionId: 'ver-1', latestJobId: null, rs: fakeRs() }),
      { wrapper },
    );
    expect(result.current.status).toBe('no-analysis');
    expect(result.current.jobId).toBeNull();
    expect(fetcherMock).not.toHaveBeenCalled();
  });

  it('loads the PLAYING version job and builds moves from its verdicts', async () => {
    fetcherMock.mockResolvedValue({ verdicts: [VERDICT], specialists: [] });
    const { result } = renderHook(
      () => useListenFindings({ versionId: 'ver-1', latestJobId: 'job-a', rs: fakeRs() }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetcherMock.mock.calls[0][0].url).toBe('/reports/job-a/verdicts/');
    expect(result.current.moves.map((m) => m.id)).toEqual(['v1']);
  });

  it('one toggle writes the rack exactly once and flips isApplied', async () => {
    fetcherMock.mockResolvedValue({ verdicts: [VERDICT], specialists: [] });
    const rs = fakeRs();
    const { result } = renderHook(
      () => useListenFindings({ versionId: 'ver-1', latestJobId: 'job-a', rs }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.overlay.toggle('v1'));
    expect(rs.applyRackMod).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.overlay.isApplied('v1')).toBe(true));
    expect(result.current.appliedIds.has('v1')).toBe(true);

    act(() => result.current.overlay.toggle('v1'));
    expect(rs.applyRackMod).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.overlay.isApplied('v1')).toBe(false));
  });

  it('surfaces a failed load and can retry it', async () => {
    fetcherMock.mockRejectedValueOnce(new ApiError(500, undefined));
    const { result } = renderHook(
      () => useListenFindings({ versionId: 'ver-1', latestJobId: 'job-a', rs: fakeRs() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe('error'));

    fetcherMock.mockResolvedValue({ verdicts: [VERDICT], specialists: [] });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/findings/__tests__/useListenFindings.test.tsx 2>&1 | tail -10
```
Expected: `Failed to resolve import "../useListenFindings"`.

- [ ] **Step 3: Write the hook**

```ts
/* The Listen page's findings seam.
 *
 * Called ONCE per page. It owns the page's only useFixOverlay instance (spec
 * D11): the stage board and the Coach tab's fixes column both drive this one
 * handle. Two instances would each hold their own fix-free baseline and each
 * rebuild the whole rack from it, so a toggle in one silently discarded the
 * other's contribution.
 *
 * It fetches verdicts and nothing else (spec D12): FixBoard derives every row
 * from `verdicts` and reaches `moves` only through `move.verdictId`, so the
 * rule-engine prose moves that `final_json` would add are invisible to it by
 * construction.
 */
import { useCallback, useMemo, useRef } from 'react';

import { useVerdicts } from '../../../api/hooks';
import type { VerdictDto } from '../../../api/types';
import { buildMoves, type Move } from '../../results/move-model';
import type { RackState } from '../rackState';
import { useFixOverlay } from '../useFixOverlay';
import { boardListenFixes } from './findings-helpers';

export interface FixOverlayHandle {
  isApplied: (fixId: string) => boolean;
  toggle: (fixId: string) => void;
}

export type ListenFindingsStatus = 'no-analysis' | 'loading' | 'error' | 'ready';

export interface ListenFindings {
  status: ListenFindingsStatus;
  jobId: string | null;
  verdicts: VerdictDto[];
  moves: Move[];
  /** Fix ids currently ON the live rack (spec D2 — never the server's flag). */
  appliedIds: ReadonlySet<string>;
  overlay: FixOverlayHandle;
  retry: () => void;
}

export function useListenFindings({ versionId, latestJobId, rs }: {
  versionId: string;
  /** Spec D3 — the newest analysis FOR THE PLAYING VERSION. Never the song's. */
  latestJobId: string | null;
  rs: RackState;
}): ListenFindings {
  const jobId = latestJobId ?? null;
  // The board never kicks off a specialist, so nothing is ever optimistically
  // running; a ref keeps the identity stable so useVerdicts doesn't re-poll.
  const emptySetRef = useRef<ReadonlySet<string>>(new Set<string>());
  const query = useVerdicts(jobId ?? '', {
    enabled: Boolean(jobId),
    optimisticRunning: emptySetRef.current,
  });

  const verdicts = useMemo<VerdictDto[]>(() => query.data?.verdicts ?? [], [query.data]);
  const moves = useMemo(() => buildMoves({ verdicts }), [verdicts]);
  const fixes = useMemo(() => boardListenFixes(moves), [moves]);

  // The live module map, read through a ref so the overlay's baseline capture
  // never re-arms just because a knob moved.
  const modRef = useRef(rs.mod);
  modRef.current = rs.mod;
  const getLiveMod = useCallback(() => modRef.current, []);

  const { appliedIds, isApplied, toggle } = useFixOverlay({
    versionId, fixes, applyRackMod: rs.applyRackMod, getLiveMod,
  });

  const appliedSet = useMemo<ReadonlySet<string>>(() => new Set(appliedIds), [appliedIds]);
  const overlay = useMemo<FixOverlayHandle>(() => ({ isApplied, toggle }), [isApplied, toggle]);

  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;
  const retry = useCallback(() => { void refetchRef.current(); }, []);

  const status: ListenFindingsStatus = !jobId
    ? 'no-analysis'
    : query.isError
      ? 'error'
      : query.data == null
        ? 'loading'
        : 'ready';

  return { status, jobId, verdicts, moves, appliedIds: appliedSet, overlay, retry };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/findings/__tests__/useListenFindings.test.tsx 2>&1 | tail -8
```
Expected: `Tests  4 passed`.

- [ ] **Step 5: Gates**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx tsc -b && npm run lint && npx vitest run 2>&1 | tail -5
```
Expected: 0 failed.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/badmin/projects/spectr-solo && git add \
  components/frontend-spectr-v2/src/features/listen-rack/findings/useListenFindings.ts \
  components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/useListenFindings.test.tsx && \
git commit -m "feat(listen): one hook for the playing version's findings

Verdicts for THIS version's job, moves built from them, and the page's single
fix overlay — the one the stage board and the Coach tab's fixes column will
both drive, so a toggle in one can never discard the other's work.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The `FindingsStage` container and its stylesheet

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen-rack/findings/FindingsStage.tsx`
- Create: `components/frontend-spectr-v2/src/features/listen-rack/findings/findings-stage.css`
- Test: `components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/FindingsStage.test.tsx`

**Interfaces:**
- Consumes: `ListenFindings`, `FixOverlayHandle` (Task 5); `timeRangeOf`, `applyGate` (Task 3); `FixBoard`, `FixBoardSurface`, `SeekAffordance`, `FixBoardMode` (Task 4); `CarryPhase` (Task 2).
- Produces:
  - `export function FindingsStage(props: { findings: ListenFindings; songId: string | undefined; durationSeconds: number; onSeek: (seconds: number) => void; carryPhase: CarryPhase; onClearPreset: () => void }): JSX.Element`
  - class names that Task 7 must emit: `lr-findings-stage`, `lr-stage-seg`, `data-stage="findings" | "visualizer"` on `.lr-stagecard`.

- [ ] **Step 1: Write the failing test**

Create `components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/FindingsStage.test.tsx`:

```tsx
/* The stage's board container: honest empty/error states, the D8 preset gate,
 * and applying straight onto the rack. */
import {
  createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerdictDto } from '../../../../api/types';
import { buildMoves } from '../../../results/move-model';
import { FindingsStage } from '../FindingsStage';
import type { ListenFindings } from '../useListenFindings';

afterEach(cleanup);

const VERDICT: VerdictDto = {
  id: 'v1', analysisId: 'a1', specialist: 'low_end', promptVersion: '1', model: 'test',
  severity: 'critical', category: 'low_end', confidence: 0.8, priorityScore: 120,
  impact: null, chartType: null, headline: 'Sub is masking the kick',
  summary: null, body: null, metricLine: null, whyItMatters: null, presetName: null,
  evidence: null,
  fix: {
    target: { name: 'Master bus' },
    dsp_chain: [{ type: 'eq', params: { freq: 45, gain_db: -3, q: 1 } }],
  },
  sources: null, problemId: 'p1', kind: 'fault', source: 'rule_engine',
  dataTier: 'audio_only', fixable: true, suspected: false,
  where: { start_seconds: 83, end_seconds: 101 }, refines: null,
  priorityBase: null, priorityCategoryWeight: null, priorityScopeMultiplier: null,
  scope: null, createdAt: '2026-09-19T00:00:00Z',
  userState: { dismissed: false, applied: false, feedback: null },
};

function findings(patch: Partial<ListenFindings> = {}): ListenFindings {
  return {
    status: 'ready',
    jobId: 'job-a',
    verdicts: [VERDICT],
    moves: buildMoves({ verdicts: [VERDICT] }),
    appliedIds: new Set<string>(),
    overlay: { isApplied: () => false, toggle: vi.fn() },
    retry: vi.fn(),
    ...patch,
  };
}

// The empty state links to the song page, so the container renders inside a
// minimal memory router (same shape as listen-rack-version-gate.test.tsx).
function renderStage(props: Partial<React.ComponentProps<typeof FindingsStage>> = {}) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <FindingsStage
        findings={findings()}
        songId="song-1"
        durationSeconds={240}
        onSeek={vi.fn()}
        carryPhase="none"
        onClearPreset={vi.fn()}
        {...props}
      />
    ),
  });
  const songRoute = createRoute({
    getParentRoute: () => rootRoute, path: '/songs/$songId', component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, songRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-local tree
  return render(<RouterProvider router={router as any} />);
}

describe('FindingsStage', () => {
  it('lists the playing version findings and applies one onto the rack', async () => {
    const toggle = vi.fn();
    renderStage({ findings: findings({ overlay: { isApplied: () => false, toggle } }) });

    expect(await screen.findByText('Sub is masking the kick')).toBeTruthy();
    fireEvent.click(screen.getByText('Apply live'));
    expect(toggle).toHaveBeenCalledWith('v1');
  });

  it('with no analysis, points at the song instead of pretending', async () => {
    renderStage({ findings: findings({ status: 'no-analysis', jobId: null, verdicts: [], moves: [] }) });

    expect(await screen.findByText(/hasn.t been analyzed yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open this song/i }).getAttribute('href'))
      .toBe('/songs/song-1');
  });

  it('a failed load offers a retry', async () => {
    const retry = vi.fn();
    renderStage({ findings: findings({ status: 'error', verdicts: [], moves: [], retry }) });

    fireEvent.click(await screen.findByText('Retry'));
    expect(retry).toHaveBeenCalled();
  });

  it('a loaded preset locks single-fix applying until it is cleared (D8)', async () => {
    const toggle = vi.fn();
    const onClearPreset = vi.fn();
    renderStage({
      carryPhase: 'applied',
      onClearPreset,
      findings: findings({ overlay: { isApplied: () => false, toggle } }),
    });

    expect(await screen.findByText(/A fix preset is loaded/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Apply live'));
    expect(toggle).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Clear preset'));
    expect(onClearPreset).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/findings/__tests__/FindingsStage.test.tsx 2>&1 | tail -10
```
Expected: `Failed to resolve import "../FindingsStage"`.

- [ ] **Step 3: Write `FindingsStage.tsx`**

```tsx
/* The Listen stage's analysis board.
 *
 * Spec D1/D2: the report's own FixBoard, mounted on the `listen` surface —
 * read-only toward the server, and "apply" means the LIVE RACK. Everything it
 * needs arrives as props; the data and the single fix overlay live in
 * useListenFindings, one level up.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';

import { Icon } from '../../results/Icon';
import { FixBoard, type FixBoardMode } from '../../results/FixBoard';
import type { SeekAffordance } from '../../results/fix-board-helpers';
import type { Move } from '../../results/move-model';
import type { CarryPhase } from '../useFixCarryOver';
import { applyGate, timeRangeOf } from './findings-helpers';
import type { ListenFindings } from './useListenFindings';

const NO_NOTES: ReadonlySet<string> = new Set<string>();

export function FindingsStage({
  findings, songId, durationSeconds, onSeek, carryPhase, onClearPreset,
}: {
  findings: ListenFindings;
  /** For the no-analysis link. Undefined only on the mock demo route. */
  songId: string | undefined;
  durationSeconds: number;
  onSeek: (seconds: number) => void;
  carryPhase: CarryPhase;
  onClearPreset: () => void;
}) {
  // Actions first: the Listen page's verb is "apply".
  const [mode, setMode] = useState<FixBoardMode>('actions');
  const [focusId, setFocusId] = useState<string | null>(null);
  const gate = applyGate(carryPhase);

  const seek = useMemo<SeekAffordance>(() => ({
    label: (v) => timeRangeOf(v, durationSeconds)?.label ?? null,
    go: (v) => {
      const t = timeRangeOf(v, durationSeconds);
      if (t) onSeek(t.start);
    },
  }), [durationSeconds, onSeek]);

  const { overlay, appliedIds } = findings;
  const onToggleCommit = useCallback((move: Move) => {
    if (!gate.enabled) return;
    overlay.toggle(move.id);
  }, [gate.enabled, overlay]);

  const onShowFix = useCallback((verdictId: string) => {
    setFocusId(verdictId);
    setMode('actions');
  }, []);
  const onShowFinding = useCallback((verdictId: string) => {
    setFocusId(verdictId);
    setMode('findings');
  }, []);
  const onConsumeFocus = useCallback(() => setFocusId(null), []);
  // Fix-less "notes" are a report concept (they live on the report's Actions
  // tab). The listen surface hides the control, so this is never called.
  const onToggleNote = useCallback(() => {}, []);

  if (findings.status === 'no-analysis') {
    return (
      <div className="lr-stage-msg" data-testid="listen-findings-empty">
        <Icon name="info" size={16} />
        <span>
          This version hasn&rsquo;t been analyzed yet — there are no findings to show.
        </span>
        {songId && (
          <Link to="/songs/$songId" params={{ songId }} className="btn sm primary">
            Open this song to analyze it
          </Link>
        )}
      </div>
    );
  }

  if (findings.status === 'loading') {
    return (
      <div className="lr-stage-msg mono" data-testid="listen-findings-loading">
        Loading findings…
      </div>
    );
  }

  if (findings.status === 'error') {
    return (
      <div className="lr-stage-msg" data-testid="listen-findings-error">
        <Icon name="info" size={16} />
        <span>Couldn&rsquo;t load the findings for this version.</span>
        <button type="button" className="btn sm" onClick={findings.retry}>Retry</button>
      </div>
    );
  }

  return (
    <div className="lr-stage-board">
      <div className="lr-seg lr-stage-modes">
        <button
          type="button"
          className={mode === 'actions' ? 'on' : ''}
          onClick={() => setMode('actions')}
        >
          Actions
        </button>
        <button
          type="button"
          className={mode === 'findings' ? 'on' : ''}
          onClick={() => setMode('findings')}
        >
          Findings
        </button>
        {gate.reason && (
          <span className="lr-stage-gate">
            <Icon name="info" size={12} />
            {gate.reason}
            {gate.showClearPreset && (
              <button type="button" className="btn sm" onClick={onClearPreset}>
                Clear preset
              </button>
            )}
          </span>
        )}
      </div>
      <FixBoard
        mode={mode}
        surface="listen"
        seek={seek}
        verdicts={findings.verdicts}
        moves={findings.moves}
        committedIds={appliedIds}
        onToggleCommit={onToggleCommit}
        checkedNoteIds={NO_NOTES}
        onToggleNote={onToggleNote}
        focusId={focusId}
        onConsumeFocus={onConsumeFocus}
        onShowFix={onShowFix}
        onShowFinding={onShowFinding}
      />
    </div>
  );
}
```

- [ ] **Step 4: Write `findings-stage.css`**

```css
/* Listen stage — the findings board.
 *
 * A plain GLOBAL sheet on purpose (spec D10 / §12): every rule here overrides a
 * .rdx-scoped global class that features/results/redesign-v3-tabs.css owns, and
 * a CSS module cannot win those ties with deterministic specificity. Tokens
 * only — no raw colors. Imported once, from ListenRackPage, after
 * redesign-v3-tabs.css and listen-rack-v2.css.
 */

/* The stage's overlay band is pointer-events:none so the visualizer stays
   interactive underneath; the content switch has to opt back in. */
.rdx .lr-stage-seg { pointer-events: auto; }
.rdx .lr-stage-seg button { background: color-mix(in srgb, var(--bg-2) 62%, transparent); }

/* Spec D5 — two-step stage. The visualizer keeps its compact 210px; the board
   gets room to be a master-detail surface, clamped so the transport and the
   rack tabs stay on screen on a 900px-tall window. The top padding is the band
   the Section / Chain chips float in, so nothing is ever covered. */
.rdx .lr-findings-stage {
  position: relative;
  height: clamp(210px, calc(100vh - 470px), 420px);
  padding: 34px 10px 10px;
  display: flex;
  min-height: 0;
}

/* Spec D7 — never blur a repainting full-screen canvas behind a scrolling
   list. `.rdx .lr-glass .card` (0,3,0) puts a blur(9px) on this card because
   its className is `card lr-stagecard`; this selector is (0,4,0) and wins
   whatever the import order turns out to be. */
.rdx .lr-glass .lr-stagecard[data-stage='findings'] {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  background: color-mix(in srgb, var(--surface-2) 88%, transparent);
}

/* The board's own height rules assume a full page column — re-base them on the
   stage box (spec D5's table). */
.rdx .lr-stage-board {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-height: 0;
}
.rdx .lr-stage-board .fixboard {
  margin: 0;
  width: 100%;
  flex: 1;
  min-height: 0;
  align-items: stretch;
}
.rdx .lr-stage-board .fb-list { min-height: 0; }
.rdx .lr-stage-board .fb-scroll { max-height: none; flex: 1; min-height: 0; }
.rdx .lr-stage-board .fb-detail { position: static; max-height: none; min-height: 0; }
.rdx .lr-stage-board .fb-detail.empty { min-height: 0; padding: 20px; }
.rdx .lr-stage-board .fbd-scroll { flex: 1; min-height: 0; }

.rdx .lr-stage-modes { align-items: center; }
.rdx .lr-stage-gate {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: 6px;
  padding: 3px 9px;
  border-radius: 7px;
  border: 1px solid var(--border-2);
  background: color-mix(in srgb, var(--violet) 10%, transparent);
  color: var(--text-2);
  font-size: 10.5px;
}
.rdx .lr-stage-msg {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px;
  color: var(--muted);
  font-size: 12px;
}

/* Spec D4 — "jump to it". Only the Listen board passes a `seek` affordance,
   so this only ever renders here. */
.rdx .fbd-seek {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 8px 0 0;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-2);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  cursor: pointer;
}
.rdx .fbd-seek:hover { border-color: var(--accent); }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/findings/__tests__/FindingsStage.test.tsx 2>&1 | tail -10
```
Expected: `Tests  4 passed`.

- [ ] **Step 6: Gates**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx tsc -b && npm run lint && npm run lint:css && npm run lint:focus && npx vitest run 2>&1 | tail -5
```
Expected: `css tokens lint: clean`, `focus ring lint: clean`, 0 failed.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/badmin/projects/spectr-solo && git add \
  components/frontend-spectr-v2/src/features/listen-rack/findings/FindingsStage.tsx \
  components/frontend-spectr-v2/src/features/listen-rack/findings/findings-stage.css \
  components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/FindingsStage.test.tsx && \
git commit -m "feat(listen): the findings board that lives in the stage

Reuses the report's board on its listen surface, sizes it to the stage box,
kills the backdrop blur that would otherwise sit over a repainting canvas, and
is honest when the playing version has no analysis of its own.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The stage box gets a second content mode

**Files:**
- Create: `components/frontend-spectr-v2/src/features/listen-rack/findings/StagePlacementButton.tsx`
- Modify: `components/frontend-spectr-v2/src/features/listen-rack/viz.tsx:10, 356-390, 497-589`
- Modify: `components/frontend-spectr-v2/src/features/listen-rack/StageCardV2.tsx:60-120`
- Test: `components/frontend-spectr-v2/src/features/listen-rack/__tests__/StageCardV2.content.test.tsx`

**Interfaces:**
- Consumes: `StageContent` (Task 3); the `findings` node is whatever Task 6/8 hands in (typed `React.ReactNode`).
- Produces:
  - `export function StagePlacementButton(props: { bgMode: boolean; onChange: (v: boolean) => void; context?: 'visualizer' | 'findings' }): JSX.Element`
  - `VizStage` new props: `bgMode: boolean` (required), `onBgModeChange: (v: boolean) => void` (required), `slot?: 'ghost' | 'none'` (default `'ghost'`).
  - `StageCardV2` new props: `stageContent: StageContent`, `onStageContentChange: (c: StageContent) => void`, `bgViz: boolean`, `onBgVizChange: (v: boolean) => void`, `findings?: React.ReactNode | undefined`.

- [ ] **Step 1: Write the failing test**

Create `components/frontend-spectr-v2/src/features/listen-rack/__tests__/StageCardV2.content.test.tsx`:

```tsx
/* Spec D6 — the stage box shows ONE of two things, and the visualizer's ghost
 * placeholder only belongs in the box when the box is the visualizer's. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_VIZ, TRACK } from '../data';
import { StageCardV2 } from '../StageCardV2';
import type { LiveMeters } from '../useLiveMeters';

afterEach(cleanup);

const METERS: LiveMeters = { lufs: -9.2, tp: -0.8, corr: 0.7, gr: 0, out: -12, clip: false };

function renderStage(props: Partial<React.ComponentProps<typeof StageCardV2>> = {}) {
  return render(
    <StageCardV2
      playing={false}
      onPlay={vi.fn()}
      position={0}
      duration={240}
      onSeek={vi.fn()}
      mod={{}}
      order={[]}
      bypass={false}
      meters={METERS}
      stageHeight={210}
      showMeters={false}
      notes={TRACK.notes}
      activeNote={null}
      onNote={vi.fn()}
      showNotes={false}
      section={null}
      bpm={128}
      keyLabel="A#"
      getFrame={null}
      viz={DEFAULT_VIZ}
      stages={['eq']}
      setStages={vi.fn()}
      director={undefined}
      activeModules={[]}
      trackName="Neon Skyline"
      trackSub="Listen session"
      stageContent="findings"
      onStageContentChange={vi.fn()}
      bgViz={false}
      onBgVizChange={vi.fn()}
      findings={<div data-testid="board">the board</div>}
      {...props}
    />,
  );
}

describe('StageCardV2 stage content', () => {
  it('shows the board and marks the card, with no ghost placeholder', () => {
    const { container } = renderStage();
    expect(screen.getByTestId('board')).toBeTruthy();
    expect(container.querySelector('.lr-stagecard')?.getAttribute('data-stage')).toBe('findings');
    expect(container.querySelector('.lr-vizbg-ghost')).toBeNull();
  });

  it('switching to the visualizer swaps the box back', () => {
    const onStageContentChange = vi.fn();
    renderStage({ onStageContentChange });
    fireEvent.click(screen.getByRole('tab', { name: 'Visualizer' }));
    expect(onStageContentChange).toHaveBeenCalledWith('visualizer');
  });

  it('the ghost placeholder belongs to the visualizer view only', () => {
    const { container } = renderStage({ stageContent: 'visualizer', bgViz: true });
    expect(container.querySelector('.lr-vizbg-ghost')).not.toBeNull();
    expect(container.querySelector('.lr-stagecard')?.getAttribute('data-stage'))
      .toBe('visualizer');
    expect(screen.queryByTestId('board')).toBeNull();
  });

  it('without a findings node the content switch never appears (demo route)', () => {
    renderStage({ findings: undefined, stageContent: 'visualizer' });
    expect(screen.queryByRole('tab', { name: 'Findings' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/__tests__/StageCardV2.content.test.tsx 2>&1 | tail -15
```
Expected: type/runtime failures — `stageContent` and friends are not props.

- [ ] **Step 3: Extract the placement button**

Create `components/frontend-spectr-v2/src/features/listen-rack/findings/StagePlacementButton.tsx`:

```tsx
/* The stage's placement control (⛶ / ⤡) — "play the visualizer full-screen
 * behind the page".
 *
 * Moved out of viz.tsx so the stage card can render it when the findings board
 * owns the box and the visualizer is not mounted in-box. Same glyph, same
 * corner, same size, so the control never appears to move.
 *
 * Its styles stay INLINE on purpose: in background mode the whole stage is
 * portaled to document.body, OUTSIDE the page's `.rdx` scope, so a scoped
 * class could not reach it. That is CLAUDE.md's dynamic-value exemption.
 */
export function StagePlacementButton({ bgMode, onChange, context = 'visualizer' }: {
  bgMode: boolean;
  onChange: (v: boolean) => void;
  /** Which stage content the button is sitting on. Changes only the wording. */
  context?: 'visualizer' | 'findings';
}) {
  const title =
    context === 'findings'
      ? bgMode
        ? 'Stop the background visualizer'
        : 'Play the visualizer full-screen behind the page'
      : bgMode
        ? 'Exit background mode'
        : 'Play full-screen in the background';
  return (
    <button
      type="button"
      onClick={() => onChange(!bgMode)}
      title={title}
      aria-label={title}
      className="mono"
      style={{
        position: 'absolute', top: 12, right: 12, zIndex: 6,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 34, height: 34, fontSize: 15, lineHeight: 1, cursor: 'pointer',
        color: '#fff', background: 'rgba(8,18,22,0.55)', backdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8,
      }}
    >
      {bgMode ? '⤡' : '⛶'}
    </button>
  );
}
```

- [ ] **Step 4: Make `VizStage`'s background mode controlled**

In `components/frontend-spectr-v2/src/features/listen-rack/viz.tsx`:

1. Line 10 — drop `useState` from the react import (it has exactly one use, which this step removes; leaving it fails `npm run lint`):
   ```ts
   import { forwardRef, Fragment, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
   ```
2. Add `import { StagePlacementButton } from './findings/StagePlacementButton';` next to the other local imports.
3. In the `VizStage` signature add `bgMode, onBgModeChange, slot = 'ghost',` to the destructuring and to the props type:
   ```ts
   /** Story "findings in the stage": background mode is owned by the page now,
    *  so the placement pref can persist and the stage card can put the board in
    *  the box while the visualizer keeps playing behind the page. */
   bgMode: boolean;
   onBgModeChange: (v: boolean) => void;
   /** What occupies the CARD SLOT while bgMode is on. 'ghost' is the frosted
    *  "visualizer is playing in the background" placeholder (the visualizer
    *  view); 'none' means someone else owns the box, so only the portal
    *  renders. */
   slot?: 'ghost' | 'none';
   ```
4. Delete `const [bgMode, setBgMode] = useState(false);` and change the Escape effect to:
   ```ts
   useEffect(() => {
     if (!bgMode) return undefined;
     const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBgModeChange(false); };
     window.addEventListener('keydown', onKey);
     return () => window.removeEventListener('keydown', onKey);
   }, [bgMode, onBgModeChange]);
   ```
5. Delete the whole `const fsBtn = ( … );` block and replace `{fsBtn}` inside `stage` with:
   ```tsx
      {slot !== 'none' && <StagePlacementButton bgMode={bgMode} onChange={onBgModeChange} />}
   ```
   (With `slot="none"` the stage card renders the one and only button; two would put the same control in two different corners.)
6. In the `if (bgMode)` branch, before the ghost return, add:
   ```tsx
   if (slot === 'none') {
     // Someone else owns the card slot (the findings board) — just paint the
     // full-window backdrop behind the page.
     return createPortal(stage, document.body);
   }
   ```
7. In the ghost's "Bring it back" button, replace `onClick={() => setBgMode(false)}` with `onClick={() => onBgModeChange(false)}`.

- [ ] **Step 5: Teach `StageCardV2` the two content modes**

Replace the body of `components/frontend-spectr-v2/src/features/listen-rack/StageCardV2.tsx` from `export function StageCardV2(` to the end of the file with:

```tsx
export function StageCardV2({ playing, onPlay, position, duration, onSeek, mod, order, bypass, meters, stageHeight, showMeters, notes, activeNote, onNote, showNotes, section, bpm, keyLabel, getFrame, viz, stages, setStages, director, activeModules, trackName, trackSub, stageContent, onStageContentChange, bgViz, onBgVizChange, findings }: {
  playing: boolean; onPlay: () => void; position: number; duration: number;
  onSeek: (t: number) => void;
  mod: Record<string, ModuleState>; order: string[]; bypass: boolean;
  meters: LiveMeters; stageHeight: number; showMeters: boolean;
  notes: TrackNote[]; activeNote: string | null; onNote: (n: TrackNote) => void;
  showNotes: boolean; section: string | null; bpm: number; keyLabel: string;
  getFrame: (() => AudioFrame) | null;
  viz: VizState;
  stages: string[];
  setStages: (v: string[]) => void;
  director: Director | undefined;
  activeModules: ModuleManifest[];
  trackName: string;
  trackSub: string;
  /** Spec D6 — what the stage box is showing. */
  stageContent: StageContent;
  onStageContentChange: (content: StageContent) => void;
  /** The visualizer is playing full-screen BEHIND the page. */
  bgViz: boolean;
  onBgVizChange: (v: boolean) => void;
  /** The findings board. Omit it (mock demo route) and the stage is the
   *  visualizer, exactly as before. */
  findings?: React.ReactNode | undefined;
}) {
  const active = order.filter((id) => mod[id]?.enabled).length;
  const showBoard = findings != null && stageContent === 'findings';
  return (
    <div className="card lr-stagecard" data-stage={showBoard ? 'findings' : 'visualizer'}>
      {showBoard ? (
        <>
          <div className="lr-findings-stage">{findings}</div>
          {/* The visualizer keeps playing behind the whole page; the card slot
              belongs to the board, so no ghost placeholder. */}
          {bgViz && (
            <VizStage
              playing={playing}
              stages={stages}
              setStages={setStages}
              viz={viz}
              director={director}
              height={stageHeight}
              compact
              activeModules={activeModules}
              trackName={trackName}
              trackSub={trackSub}
              bgMode
              onBgModeChange={onBgVizChange}
              slot="none"
              {...(getFrame ? { getFrame } : {})}
            />
          )}
          <StagePlacementButton bgMode={bgViz} onChange={onBgVizChange} context="findings" />
        </>
      ) : (
        <VizStage
          playing={playing}
          stages={stages}
          setStages={setStages}
          viz={viz}
          director={director}
          height={stageHeight}
          compact
          activeModules={activeModules}
          trackName={trackName}
          trackSub={trackSub}
          bgMode={bgViz}
          onBgModeChange={onBgVizChange}
          {...(getFrame ? { getFrame } : {})}
        />
      )}
      <div className="lr-ovl" style={{ right: 54 }}>
        {findings != null && (
          <span className="lr-seg lr-stage-seg" role="tablist" aria-label="Stage content">
            <button
              type="button"
              role="tab"
              aria-selected={showBoard}
              className={showBoard ? 'on' : ''}
              onClick={() => onStageContentChange('findings')}
            >
              Findings
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!showBoard}
              className={!showBoard ? 'on' : ''}
              onClick={() => onStageContentChange('visualizer')}
            >
              Visualizer
            </button>
          </span>
        )}
        {section && <span className="lr-mchip sec">Section <b>{section}</b></span>}
        {showMeters && (
          <>
            <span className={'lr-mchip ' + (meters.lufs > -10.5 ? 'warn' : 'ok')}>LUFS-S <b>{meters.lufs.toFixed(1)}</b></span>
            <span className={'lr-mchip ' + (meters.tp > -0.3 ? 'warn' : 'ok')}>True peak <b>{meters.tp.toFixed(1)}</b></span>
            <span className="lr-mchip">Corr <b>{meters.corr.toFixed(2)}</b></span>
            <span className={'lr-mchip ' + (meters.gr > 2.5 ? 'warn' : '')}>GR <b>−{meters.gr.toFixed(1)}</b></span>
          </>
        )}
        <span className="sp" />
        <span className="lr-mchip">Chain <b>{bypass ? 'bypassed' : active + ' on'}</b></span>
      </div>
      <TransportV2
        playing={playing}
        onPlay={onPlay}
        position={position}
        duration={duration}
        onSeek={onSeek}
        notes={notes}
        activeNote={activeNote}
        onNote={onNote}
        showNotes={showNotes}
        bpm={bpm}
        keyLabel={keyLabel}
      />
    </div>
  );
}
```

Add the two imports at the top of the file:

```tsx
import { StagePlacementButton } from './findings/StagePlacementButton';
import type { StageContent } from './findings/stage-prefs';
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/__tests__/StageCardV2.content.test.tsx 2>&1 | tail -10
```
Expected: `Tests  4 passed`.

- [ ] **Step 7: Gates**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx tsc -b && npm run lint && npx vitest run 2>&1 | tail -6
```
Expected: `tsc` reports errors in `ListenRackPage.tsx` only if you forgot — `StageCardV2`'s new props are required, so the page **must** be updated. If that is the only error, it is expected here; fix it in Task 8 Step 2 and do not commit this task until Step 8 below is green.

Actually make it green now: this task's commit must build. Add the five props to the existing `<StageCardV2 … />` call in `ListenRackPage.tsx` with temporary literals so nothing is half-wired:

```tsx
            stageContent="visualizer"
            onStageContentChange={() => {}}
            bgViz={false}
            onBgVizChange={() => {}}
```
(no `findings` prop yet — the demo path). Re-run the gates; expected: all green, 0 failed, and the Listen page behaves exactly as before except that the background toggle no longer persists across a remount. Task 8 replaces these four lines.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/badmin/projects/spectr-solo && git add \
  components/frontend-spectr-v2/src/features/listen-rack/findings/StagePlacementButton.tsx \
  components/frontend-spectr-v2/src/features/listen-rack/viz.tsx \
  components/frontend-spectr-v2/src/features/listen-rack/StageCardV2.tsx \
  components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx \
  components/frontend-spectr-v2/src/features/listen-rack/__tests__/StageCardV2.content.test.tsx && \
git commit -m "feat(listen): the stage box can show something other than the visualizer

Background mode is owned by the page now, so it can be remembered, and the
frosted placeholder only takes the card slot when the visualizer actually wants
it. The placement button moves to its own component so it reads the same in
both modes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Wire it into the page

**Files:**
- Modify: `components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx`
- Modify: `components/frontend-spectr-v2/src/features/listen-rack/CoachTabV2.tsx:36-83, 85-131`
- Modify: `components/frontend-spectr-v2/src/routes/_app/listen-rack.$versionId.tsx:102-107`
- Test: `components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/listen-stage-wiring.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces:
  - `CoachTabV2` prop `fixOverlay: FixOverlayHandle | null` (required).
  - `ListenRackPageProps` gains `songId?: string | undefined` and `latestJobId?: string | null | undefined`.

- [ ] **Step 1: Write the failing test**

Create `components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/listen-stage-wiring.test.tsx`:

```tsx
/* Page-level wiring: the stage opens on the findings board by default, the
 * switch is remembered (spec D6), and the page resolves findings from the
 * PLAYING version's job id only (spec D3). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

// The page mounts the whole Listen shell, so the router is stubbed rather than
// built: `to`/`params` must NOT reach the <a> or React warns about unknown DOM
// attributes on every render.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, params, ...rest }: {
    children: ReactNode; to?: string; params?: Record<string, string>;
  }) => {
    const href = to && params
      ? Object.entries(params).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to)
      : (to ?? '#');
    return <a href={href} {...rest}>{children}</a>;
  },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn(), getAccessToken: () => 'tok' };
});

import { fetcher } from '../../../../api/fetcher';
import { ListenRackPage } from '../../ListenRackPage';
import { STAGE_PREFS_KEY } from '../stage-prefs';

const fetcherMock = vi.mocked(fetcher);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderPage() {
  return render(
    <ListenRackPage versionId="ver-1" songId="song-1" latestJobId="job-a" />,
    { wrapper },
  );
}

describe('Listen stage wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    fetcherMock.mockReset();
    fetcherMock.mockImplementation(async ({ url }: { url: string }) => {
      if (url.startsWith('/reports/')) {
        return { verdicts: [], specialists: [] };
      }
      if (url.includes('/rack/presets')) return [];
      return null;
    });
  });
  afterEach(cleanup);

  it('opens on the findings board and asks the PLAYING version job for verdicts', async () => {
    const { container } = renderPage();
    await waitFor(() =>
      expect(container.querySelector('.lr-stagecard')?.getAttribute('data-stage'))
        .toBe('findings'),
    );
    expect(fetcherMock.mock.calls.some(([arg]) => arg.url === '/reports/job-a/verdicts/'))
      .toBe(true);
  });

  it('remembers the switch to the visualizer', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Visualizer' })).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Visualizer' }));

    await waitFor(() =>
      expect(container.querySelector('.lr-stagecard')?.getAttribute('data-stage'))
        .toBe('visualizer'),
    );
    expect(JSON.parse(localStorage.getItem(STAGE_PREFS_KEY) ?? '{}').content)
      .toBe('visualizer');
  });

  it('a version with no analysis of its own says so instead of borrowing one', async () => {
    render(<ListenRackPage versionId="ver-1" songId="song-1" latestJobId={null} />, { wrapper });
    expect(await screen.findByTestId('listen-findings-empty')).toBeTruthy();
    expect(fetcherMock.mock.calls.some(([arg]) => String(arg.url).startsWith('/reports/')))
      .toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/findings/__tests__/listen-stage-wiring.test.tsx 2>&1 | tail -15
```
Expected: `data-stage` is `visualizer` (Task 7's temporary literal) and no `/reports/` call was made.

- [ ] **Step 3: Share the one fix overlay with the Coach tab**

In `components/frontend-spectr-v2/src/features/listen-rack/CoachTabV2.tsx`:

1. Replace the `useFixOverlay` import with `import type { FixOverlayHandle } from './findings/useListenFindings';` and delete the now-unused `RackState` import **only if** nothing else uses it (the mock branch still does — keep it).
2. Change `RealFixes` to take the shared handle:
   ```tsx
   /** Real-route fixes column: each Added fix is a toggle applying that one fix
    *  to the live rack (uncheck to compare). The overlay instance is the PAGE's
    *  (spec D11) — a second one here would hold its own fix-free baseline and
    *  silently discard whatever the stage board had applied. */
   function RealFixes({ versionId, overlay }: { versionId: string; overlay: FixOverlayHandle }) {
     const fixes: ListenFix[] = useMemo(() => readListenFixes(versionId), [versionId]);
     const { isApplied, toggle } = overlay;
     if (fixes.length === 0) {
   ```
   (the rest of the component body is unchanged).
3. Add `fixOverlay` to `CoachTabV2`'s props:
   ```tsx
   export function CoachTabV2({ rs, real, versionId, reportRef, fixOverlay }: {
     rs: RackState;
     /** Real-audio route ⇒ honest coach hand-off + real Added fixes. */
     real: boolean;
     versionId: string | null;
     reportRef: ReportRef | null;
     /** The page's single fix overlay (spec D11); null on the mock demo route. */
     fixOverlay: FixOverlayHandle | null;
   }) {
   ```
4. Change the render site to `{versionId && fixOverlay && <RealFixes versionId={versionId} overlay={fixOverlay} />}`.

- [ ] **Step 4: Wire the page**

In `components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx`:

1. Imports — add after the existing `'./listen-rack-v2-extras.css'` line:
   ```tsx
   import '../results/redesign-v3-tabs.css';
   import './findings/findings-stage.css';
   import { FindingsStage } from './findings/FindingsStage';
   import { useListenFindings } from './findings/useListenFindings';
   import { useStagePrefs } from './findings/stage-prefs';
   ```
   Put the `redesign-v3-tabs.css` import **immediately after** `import '../results/redesign-v3.css';` so the sheet order matches `ReportView.tsx:62-63` and `listen-rack-v2.css` still loads last.
2. `ListenRackPageProps` — add:
   ```tsx
     /** The playing version's song, for the "not analyzed yet" link. */
     songId?: string | undefined;
     /** Spec D3 — the newest analysis FOR THIS VERSION (VersionDto.latestJobId).
      *  Never the song's latest. */
     latestJobId?: string | null | undefined;
   ```
   and destructure `songId, latestJobId = null` in the component signature.
3. After the `presetActions` line from Task 2, add:
   ```tsx
   const stagePrefs = useStagePrefs();
   const findings = useListenFindings({ versionId: versionId ?? '', latestJobId, rs });
   ```
4. Replace Task 7's four temporary props on `<StageCardV2 … />` with:
   ```tsx
            stageContent={stagePrefs.content}
            onStageContentChange={stagePrefs.setContent}
            bgViz={stagePrefs.bgViz}
            onBgVizChange={stagePrefs.setBgViz}
            {...(realAudio ? {
              findings: (
                <FindingsStage
                  findings={findings}
                  songId={songId}
                  durationSeconds={duration}
                  onSeek={seek}
                  carryPhase={carryPhase}
                  onClearPreset={onResetCarriedFixes}
                />
              ),
            } : {})}
   ```
5. Add the overlay to the Coach tab: `<CoachTabV2 rs={rs} real={realAudio} versionId={versionId ?? null} reportRef={reportRef} fixOverlay={realAudio ? findings.overlay : null} />`.

- [ ] **Step 5: Pass the job id and song id from the route**

In `components/frontend-spectr-v2/src/routes/_app/listen-rack.$versionId.tsx`, replace the render with:

```tsx
  return (
    <ListenRackPage versionId={versionId}
      reportRef={reportRef} statsSource={statsSource}
      {...(version?.songId ? { songId: version.songId } : {})}
      {...(version?.latestJobId ? { latestJobId: version.latestJobId } : {})}
      {...(fixPreset ? { fixPreset } : {})}
      {...(track ? { track } : {})} />
  );
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && npx vitest run src/features/listen-rack/findings/__tests__/listen-stage-wiring.test.tsx 2>&1 | tail -10
```
Expected: `Tests  3 passed`.

Expected console noise, not failures: jsdom prints
`Not implemented: HTMLCanvasElement.prototype.getContext` for `LightShow` and
`StageCanvas`. Both guard on a null context (`LightShow.tsx:18-19`,
`viz.tsx:38-39`) and bail, so nothing throws. `useAudioGraph` builds no
`AudioContext` until `ensureContext()` (first play), and `setPitchShift` /
`setPitchShiftEnabled` optional-chain on `nodesRef.current`
(`useAudioGraph.ts:736-738`), so mounting the page is safe.

- [ ] **Step 7: Check the page is still within budget, then run every gate**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && \
wc -l src/features/listen-rack/ListenRackPage.tsx && \
npx tsc -b && npm run lint && npm run lint:css && npm run lint:focus && npm run build && npx vitest run 2>&1 | tail -6
```
Expected: `ListenRackPage.tsx` ≤ 515 lines; every gate green; vitest 0 failed. If the page is over 515, report it rather than inventing a new extraction — the plan's budget was ~505 and a large overshoot means something was wired in the wrong place.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/badmin/projects/spectr-solo && git add \
  components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx \
  components/frontend-spectr-v2/src/features/listen-rack/CoachTabV2.tsx \
  components/frontend-spectr-v2/src/routes/_app/listen-rack.\$versionId.tsx \
  components/frontend-spectr-v2/src/features/listen-rack/findings/__tests__/listen-stage-wiring.test.tsx && \
git commit -m "feat(listen): findings in the stage box, visuals behind the page

The Listen page now opens on the playing version's own findings, with the
visualizer full-screen behind the page, and every listed fix goes straight onto
the live rack. The Coach tab's fixes column shares the page's one overlay
instead of running a rival copy.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Live verification on the running stack

Nothing ships on unit tests alone. This task proves the four things unit tests cannot: that the right version's findings show, that the stage fits a real window, that no blur sits over the canvas, and that the visualizer view is unchanged.

**Files:**
- Create: `output/frontend-spectr-v2/<YYYY-MM-DD>_listen-findings/*.png` (screenshots; `output/` is the declared artifact root in CLAUDE.md)
- Modify (only if Step 5 fails): `components/frontend-spectr-v2/src/features/listen-rack/findings/findings-stage.css`

**Interfaces:**
- Consumes: the whole feature.
- Produces: the shipped value of the D5 height cap, recorded in the task report.

- [ ] **Step 1: Bring the stack up**

```bash
cd C:/Users/badmin/projects/spectr-solo && powershell -File ./scripts/start-spectr.ps1
```
Follow `docs/STARTUP.md` §5 to verify before continuing; if anything fails, §6 first. Then:
```bash
curl -f http://localhost:5174 >/dev/null && echo "Frontend OK"
curl -f http://localhost:5000/healthz && echo "BFF OK"
```
Expected: both `OK`.

- [ ] **Step 2: Capture the BEFORE screenshot of the visualizer view**

Using the Playwright browser tools: navigate to `http://localhost:5174`, log in as `showcase@spectr.test` / `SpectrDemo!2026-shots`, open song `515b2443-25ea-414e-b254-b69782546de3`, and open the **newer** analyzed version in the Listen rack. Switch the stage to **Visualizer**, then:
`browser_take_screenshot` → save as `output/frontend-spectr-v2/<today>_listen-findings/visualizer-view.png`.

Compare it against the pre-feature look by eye: the 210 px spectrum strip, the Section/Chain chips top-left (now preceded by the Findings|Visualizer switch), the ⛶ button top-right, the transport underneath. Anything else that moved is a regression — report it.

- [ ] **Step 3: Verify the board shows the PLAYING version's findings (D3)**

Open the **older** analyzed version of the same song in the Listen rack and screenshot the board:
`output/frontend-spectr-v2/<today>_listen-findings/findings-older-version.png`.

In a second tab open that older version's own report (`/songs/$songId/results/$jobId`) and compare the Actions list. The headlines and their order must match. If the Listen board shows the NEWER version's findings, D3 is broken — stop and report.

- [ ] **Step 4: Verify the URL the board actually fetched**

```
browser_network_requests
```
Expected: exactly one `GET /api/reports/<jobId>/verdicts/`, where `<jobId>` is the **older** version's job id — not the song's latest.

- [ ] **Step 5: Verify the stage fits a 1440 × 900 window (D5)**

`browser_resize` to 1440 × 900, then `browser_evaluate`:

```js
() => {
  const inView = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return `MISSING ${sel}`;
    const r = el.getBoundingClientRect();
    return { sel, top: Math.round(r.top), bottom: Math.round(r.bottom), fits: r.bottom <= window.innerHeight };
  };
  return {
    viewport: window.innerHeight,
    stage: inView('.lr-findings-stage'),
    transport: inView('.lr-tp .pl-btn'),
    tabs: inView('.rtabs'),
  };
}
```
Expected: `transport.fits === true` and `tabs.fits === true`.

**If either is false:** in `findings-stage.css`, change `.rdx .lr-findings-stage`'s `height: clamp(210px, calc(100vh - 470px), 420px)` to `height: clamp(210px, calc(100vh - 470px), 360px)`, reload, and re-run this step. Record which value shipped in the task report.

- [ ] **Step 6: Verify the perf contract (D7)**

`browser_evaluate` with the background visualizer ON and the board showing:

```js
() => {
  const bf = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return `MISSING ${sel}`;
    const s = getComputedStyle(el);
    return s.backdropFilter || s.webkitBackdropFilter || 'none';
  };
  const canvases = [...document.querySelectorAll('body > div[style*="fixed"] canvas')];
  return {
    card: bf('.lr-stagecard[data-stage="findings"]'),
    list: bf('.lr-findings-stage .fb-list'),
    scroll: bf('.lr-findings-stage .fb-scroll'),
    detail: bf('.lr-findings-stage .fb-detail'),
    canvasCount: canvases.length,
    overBudget: canvases
      .filter((c) => c.width > innerWidth * 2 || c.height > innerHeight * 2)
      .map((c) => `${c.width}x${c.height}`),
  };
}
```
Expected: `card`, `list`, `scroll`, `detail` are all `'none'`; `canvasCount >= 1`; `overBudget` is `[]`.

- [ ] **Step 7: Verify applying a fix reaches the rack**

Pick an action whose scope reads `Master bus`, click **Apply live**, and watch the header stat line's `N modules on` count change. Click it again and watch it return. Screenshot the applied state as `output/frontend-spectr-v2/<today>_listen-findings/fix-applied.png`.

Then open the **Coach** tab (bottom tab strip) with the board still showing and confirm the Coach tab's "Fixes from analysis" column reflects the same applied state — that is D11's single overlay proving itself.

- [ ] **Step 8: Verify the preset gate (D8)**

From the older version's report, use **Send to Listen → Listen** on a Coach Mix preset row (generate one from the coach header if none exists) so the page opens with `?fixPreset=<uuid>`. Expected on the board: "A fix preset is loaded — clear it to A/B single fixes.", the **Apply live** buttons do nothing when clicked, and **Clear preset** removes the note, resets the rack and strips `fixPreset` from the URL — after which **Apply live** works. Screenshot as `preset-gate.png`.

- [ ] **Step 9: Verify the prefs survive a reload (D6)**

Switch the stage to **Visualizer**, reload the page, and confirm it comes back on Visualizer. Switch back to **Findings**, turn the background visualizer off with the ⤡/⛶ button, reload, and confirm it comes back with the background off. Then clear `localStorage.removeItem('listenStagePrefs')`, reload, and confirm the first-visit default: Findings in the box, visuals in the background.

- [ ] **Step 10: Run all four frontend gates plus the two extra lints and the full BFF suite**

```bash
cd C:/Users/badmin/projects/spectr-solo/components/frontend-spectr-v2 && \
npm run build && npx tsc -b && npm run lint && npm run lint:css && npm run lint:focus && npx vitest run 2>&1 | tail -6
```
Expected: `Tests  <baseline + 41> passed`, 0 failed. (`npm run build` runs `vite build && tsc -b`, which regenerates `src/routeTree.gen.ts` — run it first.)

```bash
cd C:/Users/badmin/projects/spectr-solo/components/bff && \
PGPW=$(python -c "import json;print(json.load(open(r'src/Spectr.Bff/appsettings.json'))['ConnectionStrings']['Postgres'].split('Password=')[1].split(';')[0])") \
ASPNETCORE_ENVIRONMENT=Development \
Storage__LocalRoot=C:/Users/badmin/projects/AIMusicAnalysisSite/data \
Redis__ConnectionString=127.0.0.1:6379 \
ConnectionStrings__Postgres="Host=127.0.0.1;Port=5432;Database=spectr;Username=spectr;Password=$PGPW" \
dotnet test --artifacts-path C:/Users/badmin/AppData/Local/Temp/spectr-bff-artifacts 2>&1 | tail -6
```
Expected: `Failed:     0`.

- [ ] **Step 11: Commit the screenshots and any height fix**

```bash
cd C:/Users/badmin/projects/spectr-solo && git add \
  output/frontend-spectr-v2 \
  components/frontend-spectr-v2/src/features/listen-rack/findings/findings-stage.css && \
git commit -m "test(listen): live verification of findings in the stage

Screenshots + the checks that unit tests cannot make: the older version shows
its OWN findings, the stage fits a 900px window, nothing blurs over the
background canvas, and the visualizer view is unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(If `findings-stage.css` was not touched in Step 5, drop it from the `git add`.)

- [ ] **Step 12: Report**

Write the task report with: the shipped D5 cap value, the vitest and dotnet counts, the screenshot paths, and anything that looked wrong but was out of scope (spec §10 lists what is knowingly left).

---

## Self-review notes

- **Spec coverage.** D1 → Tasks 6–8. D2 → Task 4 (affordances) + Task 6 (no write handlers passed). D3 → Tasks 1, 5, 8, 9 Step 3–4. D4 → Tasks 3, 4, 6. D5 → Task 6 CSS + Task 9 Step 5. D6 → Tasks 3, 7, 8 + Task 9 Step 9. D7 → Task 6 CSS + Task 7 (`slot`) + Task 9 Step 6. D8 → Tasks 3, 6 + Task 9 Step 8. D9 → Task 4. D10 → Task 2 + Task 8 Step 7. D11 → Tasks 5, 8 + Task 9 Step 7. D12 → Task 5.
- **Spec §9 acceptance items** map: 1→T1, 2→T3, 3→T3, 4→T4, 5→T5, 6→T6, 7→T7, 8→T8, 9–14→T9.
- **Naming consistency:** `latestJobId` (TS) / `LatestJobId` (C#); `bgViz` on `StageCardV2` and in prefs, `bgMode` inside `VizStage` and `StagePlacementButton` (the component-local name for the same flag, kept so `viz.tsx` reads as before); `FixOverlayHandle` is defined once, in `useListenFindings.ts`, and imported by `CoachTabV2`; `CarryPhase` is defined once, in `useFixCarryOver.ts`.
