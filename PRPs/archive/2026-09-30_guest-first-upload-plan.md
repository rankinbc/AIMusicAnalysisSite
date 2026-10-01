# Guest-First Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An upload on the public `/analyze` page gets the full product — full analysis, the real report, a coach that opens with a brief and invites the visitor to create an account that KEEPS their work — as a capped, 24-hour guest account. No teaser.

**Architecture:** Reuse the guest sandbox (tasks D1–D10 of `PRPs/archive/2026-09-30_guest-demo-sandbox-plan.md`): `/analyze` calls `startDemo()` then the ordinary mix upload. The BFF opens more routes to guests under caps, adds a guest→account conversion that updates the same `users` row atomically, and adds a once-per-conversation coach brief that rides the existing `coach_reply` actor in a new `brief` mode. The worker caps structure-detection memory and guest track length.

**Tech Stack:** ASP.NET Core .NET 10 minimal API + EF Core 10/Npgsql + xUnit (`components/bff`); Python dramatiq worker + pytest (`components/worker`, `components/analysis`); SQLAlchemy mirror (`components/shared`); React 19 + TanStack Router/Query + vitest + Playwright (`components/frontend-spectr-v2`).

**Spec:** `PRPs/archive/2026-09-30_guest-first-upload.md` (binding; G-D1…G-D8, rulings R1–R14). It extends `PRPs/archive/2026-09-30_guest-demo-sandbox.md`.

Path shorthands: `BFF` = `components/bff/src/Spectr.Bff`, `BT` = `components/bff/tests/Spectr.Bff.Tests`, `FE` = `components/frontend-spectr-v2/src`, `WK` = `components/worker/app`, `WT` = `components/worker/tests`.

## Global Constraints

- Work ONLY in `C:/Users/badmin/projects/spectr-solo` (branch `solo`). Never touch `C:/Users/badmin/projects/AIMusicAnalysisSite` (except that the running stack's storage root is its git-ignored `data/` folder) or `master`.
- Never edit or stage `FE/features/results/AnalysisCompleteModal.tsx` / `.module.css` (another session's uncommitted work).
- Never edit `BT/NoSocialSurfaceTests.cs`. `FE/routes/__tests__/no-social-surface.test.ts` gains NOTHING in this plan.
- Banned in shipped source: `isPublic`, `queueDepth|jobs? waiting|jobs? queued`, `shareToken`; BFF shell copy may not match `revocable|opt-in share|share links are|publish your|public profile|follower|live room|listening room|invite`. UI copy never says "public", "shared", "people", "community", never describes load, never invents a number.
- Exact copy — guest closing line: `Create a free account and let's save our progress — so we can make this mix awesome.`
- The repo is PUBLIC: no real audio, snapshot built from real audio, email or secret in git. Tests use synthetic fixtures.
- Gates — ALL of them after ANY edit, foreground only, output filtered: BFF `dotnet build && dotnet test --artifacts-path <scratch>/<task>-artifacts` with env `ConnectionStrings__Postgres` (Host=127.0.0.1), `Redis__ConnectionString=127.0.0.1:6379`, `ASPNETCORE_ENVIRONMENT=Development` (a wedged wslrelay black-holes `localhost`); a run full of skips is NOT a pass → check `wsl -l -v`, report BLOCKED. Worker `pytest -q components/worker/tests/` (5 accepted env failures), `pytest -q components/analysis/tests/`, `ruff check`. Frontend `npx tsc -b`, `npm run lint`, `npm run lint:css`, `npm run lint:focus`, `npm run build`, `npx vitest run`.
- BFF tests use the recording `IJobQueue` in EVERY factory (a real queue reaches the live dev worker). Guest limiters FAIL CLOSED (503 friendly copy) on limiter/flag/DB failure. Errors go through `BFF/Endpoints/ErrorEnvelope.cs`.
- Flags: idempotent migration (`INSERT … ON CONFLICT (name) DO NOTHING`; value changes as guarded `UPDATE … WHERE value = '<seeded>'`), columns `(name, value, updated_at)`. Schema: EF migration + mirror in `components/shared/aimusic_shared/models.py`; scaffold with env `ArtifactsPath=<scratch>` (the running BFF locks its exe).
- No file over ~500 lines. Already over — new code goes in NEW files, edits there are the few lines stated: `AuthEndpoints.cs` (781), `VersionEndpoints.cs` (1455), `CoachConversationEndpoints.cs` (708), `coach_actor.py` (726), `Program.cs`, `UnifiedUploadDialog.tsx` (1249).
- REAL RED first: write the test, run it against the current code, record the failure, then implement. Reading discipline: Grep, then Read slices ≤ 60 lines; commit after each item; the CONTEXT WARNING hook is advisory.
- Frontend tests need the first-line docblock `// @vitest-environment jsdom`; `beforeEach(() => { mock.mockReset(); })` — braces mandatory.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; stage by path; never `--no-verify`; never push; you never dispatch subagents.

## Order and amendments to the sandbox plan

D6/D7 scoped re-reviews → D9 → D10 → **G1 → G2 → G3 → G4 → G5 → G6 → G7**. G0 runs independently (frontend, already briefed). G4 MUST land before G5.

- **D8 is CUT** (spec G-D2).
- **D10 is amended** — carry this in its dispatch: (a) the guest upload dialog is NOT mix-only: drop the three `{!guest.isGuest && …}` wrappers around the Ableton/reference/stems blocks; (b) "upload-once" becomes `canUpload = uploadsUsed < uploadsMax` with `uploadsMax` from the server (now 2); (c) the banner must read correctly for a visitor who uploaded their own track — copy: `You're using SPECTR as a guest — your work is kept for 24 hours.` + link `Create a free account` → `/register?from=guest`; the D10 test regex `/demo sandbox/i` becomes `/as a guest/i`; (d) `GuestStateDto` gains the fields G1 adds.
- **D11** keeps its Playwright demo smoke; the upload smoke is G7.

---

### Task G0: Honest progress list

Specified in `.superpowers/sdd/guest-first-upload-plan/task-G0-brief.md` (in progress). Produces `buildProgressPlan(inputs)` and the `inputs` prop on `ProgressStorylineView` that G5 relies on (`/analyze` passes all-false).

---

### Task G1: BFF — shared audio is undeletable, guest allowances, caps, flags

**Review tier:** most capable (deletion + access control).

**Files:** Modify `BFF/Endpoints/VersionEndpoints.cs` (`:29` marker, `:41-61` markers, `:339`, `:400-405`, the stems/als handlers' first lines), `BFF/Endpoints/SongEndpoints.cs` (`:24,:26` markers, `:307-312`), `BFF/Endpoints/UploadEndpoints.cs` (`:34-36`), `BFF/Endpoints/ReferenceEndpoints.cs` (`:21,:28,:32,:33` markers + cap), `BFF/Endpoints/JobEndpoints.cs:24`, `BFF/Services/GuestLimits.cs`, `BFF/DTOs` (the `GuestStateDto` record), `BFF/Endpoints/DemoAuthEndpoints.cs:146` (fallback 72→24), `BT/GuestGuardInventoryTests.cs:41-71`. Create migration `SeedGuestFirstUploadFlags`, `BFF/Services/SharedStorage.cs`, tests `BT/SharedDemoAudioDeleteTests.cs`, `BT/GuestAllowancesTests.cs`.

**Interfaces — Produces:**
```csharp
// BFF/Services/SharedStorage.cs
internal static class SharedStorage
{
    // True when the key was deleted; false when it was skipped because it is shared (audio/demo/).
    internal static async Task<bool> DeleteUnlessSharedAsync(IFileStorage storage, string? key, CancellationToken ct);
}
// BFF/Services/GuestLimits.cs
public async Task<IResult?> CheckStemsAsync(int existingFiles, long existingBytes, int addFiles, long addBytes, CancellationToken ct); // per VERSION
public async Task<IResult?> CheckReferenceAsync(Guid userId, CancellationToken ct);
// GuestStateDto gains (trailing, defaulted): int StemsMaxFiles, int StemsMaxMb, int ReferencesUsed, int ReferencesMax
// GuestGuard.Restricted reasons added: "stems_limit", "reference_limit"
```
`CheckAnalysisAsync` now reads `guest_analyses_max` (fallback 6) instead of `guest_uploads_max` (`GuestLimits.cs:119`). Every `guest_ttl_hours` fallback literal becomes 24 (Grep the name). Limit copy stops hard-coding "one": build it from the flag, e.g. `$"A guest session includes {max} uploads — create a free account to analyze more."`; update the existing tests that assert the old sentence.

- [ ] **1. Failing tests — shared audio**

```csharp
// BT/SharedDemoAudioDeleteTests.cs
[Collection("DemoAuth")]
public sealed class SharedDemoAudioDeleteTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class RecordingStorage : IFileStorage
    {
        public readonly List<string> Deleted = [];
        public Task<Stream> OpenReadAsync(string k, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<string> WriteAsync(string k, Stream c, string t, CancellationToken ct = default) => Task.FromResult(k);
        public Task<bool> DeleteAsync(string k, CancellationToken ct = default) { Deleted.Add(k); return Task.FromResult(true); }
        public Task<Uri> GetPresignedReadUrlAsync(string k, TimeSpan e) => Task.FromResult(new Uri("http://x/" + k));
        public Task<bool> ExistsAsync(string k, CancellationToken ct = default) => Task.FromResult(false);
        public Task<long?> GetFileSizeAsync(string k, CancellationToken ct = default) => Task.FromResult<long?>(null);
    }
    private sealed class NullQueue : IJobQueue
    {
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default) => Task.CompletedTask;
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default) => Task.CompletedTask;
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default) => Task.CompletedTask;
    }
    private const string Shared = "audio/demo/snapshot/abc123/source.mp3";

    private (WebApplicationFactory<Program> F, RecordingStorage S) Build()
    {
        var storage = new RecordingStorage();
        var f = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll(typeof(IJobQueue)); s.AddSingleton<IJobQueue>(new NullQueue());
            s.RemoveAll(typeof(IFileStorage)); s.AddSingleton<IFileStorage>(storage);
        }));
        return (f, storage);
    }

    private static async Task<(HttpClient C, Guid UserId)> RegisterAsync(WebApplicationFactory<Program> f)
    {
        var c = f.CreateClient();
        var reg = await c.PostAsJsonAsync("/api/auth/register",
            new { email = $"shared+{Guid.NewGuid():N}@spectr.test", password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = (await reg.Content.ReadFromJsonAsync<AuthResponse>())!;
        c.DefaultRequestHeaders.Authorization = new("Bearer", auth.AccessToken);
        return (c, auth.User.Id);
    }

    private static async Task<(Guid SongId, Guid VersionId)> SeedSongAsync(
        WebApplicationFactory<Program> f, Guid userId, string filePath)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var song = new Song { Id = Guid.NewGuid(), UserId = userId, Name = $"shared-del {Guid.NewGuid():N}" };
        var v = new SongVersion { Id = Guid.NewGuid(), SongId = song.Id, FilePath = filePath, VersionNumber = 1 };
        db.Songs.Add(song); db.SongVersions.Add(v);
        await db.SaveChangesAsync();
        return (song.Id, v.Id);
    }

    [SkippableFact]
    public async Task Deleting_A_Demo_Version_Never_Deletes_The_Shared_Audio()
    {
        await TestDb.RequireAsync(factory);
        var (f, storage) = Build();
        using var _ = f;
        var (client, userId) = await RegisterAsync(f);
        var (_, demoVersion) = await SeedSongAsync(f, userId, Shared);
        var (_, ownVersion) = await SeedSongAsync(f, userId, "audio/upload/own/source.wav");

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/versions/{demoVersion}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/versions/{ownVersion}")).StatusCode);

        Assert.DoesNotContain(storage.Deleted, k => k.StartsWith("audio/demo/"));
        Assert.Contains("audio/upload/own/source.wav", storage.Deleted); // own files are still cleaned up
    }

    [SkippableFact]
    public async Task Hard_Deleting_A_Demo_Song_Never_Deletes_The_Shared_Audio()
    {
        await TestDb.RequireAsync(factory);
        var (f, storage) = Build();
        using var _ = f;
        var (client, userId) = await RegisterAsync(f);
        var (songId, _) = await SeedSongAsync(f, userId, Shared);
        (await client.DeleteAsync($"/api/songs/{songId}")).EnsureSuccessStatusCode();           // archive first
        (await client.DeleteAsync($"/api/songs/{songId}/permanent")).EnsureSuccessStatusCode();
        Assert.DoesNotContain(storage.Deleted, k => k.StartsWith("audio/demo/"));
    }
}
```
Run: `dotnet test --filter SharedDemoAudioDeleteTests` → both FAIL today (`audio/demo/…` is in `Deleted`). If `HardDelete` has a precondition other than "archived", read `SongEndpoints.cs` ~270-295 and satisfy it in the test — do not weaken the assertion.

- [ ] **2. Implement `SharedStorage.DeleteUnlessSharedAsync`** (uses `DemoSnapshotStore.IsSharedKey`, `BFF/Services/DemoSnapshot.cs:251`; null/empty key → false) and call it at `VersionEndpoints.cs:339`, `:404` and `SongEndpoints.cs:310` in place of `storage.DeleteAsync`. Also Grep `storage.DeleteAsync` in `ReferenceEndpoints.cs:251` and route it through the helper. WHY comment at each site: every account is seeded with a version that points at shared snapshot audio. Commit: `fix(bff): no user delete path can remove the shared demo audio`.

- [ ] **3. Failing tests — allowances, caps, flags**

```csharp
// BT/GuestAllowancesTests.cs — reuse Build/StartGuestAsync/SeedAnalysisAsync idioms from GuestCapsTests.cs:89-150
public static TheoryData<string, string> NowOpen => new()
{
    { "DELETE", "/api/versions/{id}" }, { "POST", "/api/versions/{id}/stems/stage" },
    { "POST", "/api/versions/{id}/stems/stage-keys" }, { "POST", "/api/versions/{id}/stems/classify" },
    { "POST", "/api/versions/{id}/stems/confirm" }, { "POST", "/api/versions/{id}/als" },
    { "POST", "/api/versions/{id}/als-key" }, { "POST", "/api/uploads/attachments/init" },
    { "POST", "/api/references/" }, { "POST", "/api/references/complete-key" },
    { "POST", "/api/references/{id}/analyze" }, { "DELETE", "/api/references/{id}" },
    { "DELETE", "/api/songs/{id}" }, { "POST", "/api/songs/{id}/restore" }, { "POST", "/api/jobs/{id}/retry" },
};
public static TheoryData<string, string> StillClosed => new()
{
    { "DELETE", "/api/songs/{id}/permanent" }, { "POST", "/api/songs/" },
    { "POST", "/api/reports/{id}/phases/4/rerun" }, { "POST", "/api/versions/{id}/stems" },
    { "POST", "/api/me/delete" }, { "GET", "/api/me/export" },
};

private static async Task<(int Status, string? Code)> SendAsync(HttpClient c, string method, string path)
{
    var req = new HttpRequestMessage(new HttpMethod(method), path.Replace("{id}", Guid.NewGuid().ToString()));
    if (method != "GET" && method != "DELETE") req.Content = JsonContent.Create(new { });
    var resp = await c.SendAsync(req);
    string? code = null;
    try { code = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetProperty("code").GetString(); } catch { }
    return ((int)resp.StatusCode, code);
}

[SkippableTheory, MemberData(nameof(NowOpen))]
public async Task A_Guest_Reaches_The_Handler(string method, string path)
{
    await TestDb.RequireAsync(factory);
    using var f = Build(); var (client, _) = await StartGuestAsync(f);
    var (_, code) = await SendAsync(client, method, path);
    Assert.NotEqual("guest_restricted", code); // 400/404/415 from the handler are all fine — the GUARD let it through
}

[SkippableTheory, MemberData(nameof(StillClosed))]
public async Task A_Guest_Is_Still_Refused(string method, string path)
{
    await TestDb.RequireAsync(factory);
    using var f = Build(); var (client, _) = await StartGuestAsync(f);
    var (status, code) = await SendAsync(client, method, path);
    Assert.Equal(403, status); Assert.Equal("guest_restricted", code);
}

[SkippableFact]
public async Task The_Analysis_Cap_Counts_Analyses_Not_Uploads()
{
    await TestDb.RequireAsync(factory);
    using var f = Build(); var (client, demo) = await StartGuestAsync(f);
    using (var scope = f.Services.CreateScope())
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        for (var i = 0; i < 6; i++)
            db.UsageEvents.Add(new UsageEvent { UserId = demo.User.Id, EventType = "analysis",
                BillingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM"), Reference = Guid.NewGuid().ToString() });
        await db.SaveChangesAsync();
    }
    var resp = await client.PostAsync($"/api/versions/{demo.Demo.VersionId}/analyze", null);
    var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
    Assert.Equal(403, (int)resp.StatusCode);
    Assert.Equal("analysis_limit", body.GetProperty("error").GetProperty("details").GetProperty("reason").GetString());
}

[SkippableFact]
public async Task Stems_Are_Capped_By_Count_And_By_Size()
{
    await TestDb.RequireAsync(factory);
    using var f = Build(); using var scope = f.Services.CreateScope();
    var limits = scope.ServiceProvider.GetRequiredService<GuestLimits>();
    const long MB = 1024 * 1024;
    Assert.Null(await limits.CheckStemsAsync(0, 0, addFiles: 12, addBytes: 300 * MB, default));
    Assert.NotNull(await limits.CheckStemsAsync(10, 0, addFiles: 3, addBytes: MB, default));        // 13 files
    Assert.NotNull(await limits.CheckStemsAsync(0, 299 * MB, addFiles: 1, addBytes: 2 * MB, default)); // 301 MB
}

[Theory]
[InlineData("guest_analyses_max", "6")] [InlineData("guest_stems_max_files", "12")]
[InlineData("guest_stems_max_mb", "300")] [InlineData("guest_references_max", "1")]
[InlineData("guest_track_max_seconds", "720")]
public void The_Migration_Seeds_The_New_Flags(string name, string value)
{
    var sql = string.Join(" ", new Spectr.Data.Migrations.SeedGuestFirstUploadFlags().UpOperations
        .OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.SqlOperation>().Select(o => o.Sql));
    Assert.Matches($@"'{name}'\s*,\s*'{value}'", sql);
}

[Theory]
[InlineData("guest_ttl_hours", "24", "72")] [InlineData("guest_uploads_max", "2", "1")]
[InlineData("llm_budget_guest_usd", "30", "5")]
public void Value_Changes_Never_Overwrite_An_Operators_Tuning(string name, string to, string from)
{
    var sql = string.Join(" ", new Spectr.Data.Migrations.SeedGuestFirstUploadFlags().UpOperations
        .OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.SqlOperation>().Select(o => o.Sql));
    Assert.Matches($@"UPDATE feature_flags SET value\s*=\s*'{to}'[^;]*WHERE name\s*=\s*'{name}'\s+AND value\s*=\s*'{from}'", sql);
}
```
If a `StillClosed` route does not exist under that exact pattern (Grep the `Map…` line first), correct the PATH, never the expectation. Add a reference-cap test in the same style as the analysis cap (seed one `ReferenceTrack` row for the guest → the second `POST /api/references/` is `403 guest_restricted` / `reference_limit`; read the entity's required fields first).

- [ ] **4. Migration** `SeedGuestFirstUploadFlags` — Up:
```sql
INSERT INTO feature_flags (name, value, updated_at) VALUES
    ('guest_analyses_max', '6', now()), ('guest_stems_max_files', '12', now()),
    ('guest_stems_max_mb', '300', now()), ('guest_references_max', '1', now()),
    ('guest_track_max_seconds', '720', now())
ON CONFLICT (name) DO NOTHING;
UPDATE feature_flags SET value = '24', updated_at = now() WHERE name = 'guest_ttl_hours' AND value = '72';
UPDATE feature_flags SET value = '2',  updated_at = now() WHERE name = 'guest_uploads_max' AND value = '1';
UPDATE feature_flags SET value = '30', updated_at = now() WHERE name = 'llm_budget_guest_usd' AND value = '5';
```
Down reverses the three updates with the mirrored guard and deletes exactly the five new names. The model snapshot must not change. Apply it and verify the eight rows with a read-only SQL check.

- [ ] **5. Markers + caps.** `.AllowGuest()` on every `NowOpen` route (exact `Map…` lines listed under Files). Upload-quota semantics stay on the three existing routes. Caps are enforced INSIDE handlers, first line after ownership is established, only when `user.IsGuest()`:
  - `StageStems` (`VersionEndpoints.cs:744`), `StageStemKeys` (`:797`), and `UploadEndpoints.AttachmentInit` when the attachment kind is a stem: `existing` = the entries of `ReadRaw(version.StemPathsRaw)` (count; bytes = sum of `IFileStorage.GetFileSizeAsync` over their paths, missing → 0), `add` = the incoming files (count + declared/`Length` bytes).
  - `ReferenceEndpoints.Upload` + `CompleteKey`: `CheckReferenceAsync` (count of the guest's reference rows ≥ `guest_references_max`). The reference analyzer enqueue uses `GuestLimits.QueueFor(user, <current queue>)` so guest work rides the free lane.
  - Both new checks read flags through `ents.GetFlagsAsync`, and a flag/DB failure FAILS CLOSED (503 via the existing `DemoCapacity()`).
  - `POST /api/jobs/{id}/retry` needs no new code: it already goes through `DispatchAnalysisAsync` (`JobEndpoints.cs:121`) → `CheckAnalysisAsync`.
  - WHY comment on the version-delete marker (ruling R7): a delete can lower the upload DB count; the atomic `guest_upload:{userId}` limiter and the append-only analysis count are the real bounds.
- [ ] **6. Inventory.** Add exactly these to `FrozenMarkers`, alphabetical by pattern as the file does, all `"None"`: the 15 `NowOpen` rows (with the file's exact route-pattern spelling, e.g. `{versionId:guid}`), nothing else. `GET /api/me/export` stays `"Denied"`.
- [ ] **7. Gates, then commit:** `feat(bff): guests get stems, .als, a reference, delete and retry under caps; guest data lives 24 hours`.

---

### Task G2: In-place conversion — a guest who registers keeps everything

**Review tier:** most capable (auth).

**Files:** Create `BFF/Endpoints/GuestConvertEndpoints.cs`, `BFF/Auth/GuestConversion.cs`, `BT/GuestConvertTests.cs`. Modify `BFF/Program.cs` (one line after `:581`: `api.MapGuestConvertEndpoints();`), `BFF/Endpoints/AuthEndpoints.cs` (visibility only: `ClientIp :39`, `IsLoopbackRequest :45`, `DeriveDisplayNameFromEmail :59`, `RateLimitAsync :72`, `SendVerificationEmailAsync :102`, `ResolveTierAsync :764` → `internal`), `BFF/Services/RetentionSweepScheduler.cs:206-216`, `BT/GuestGuardInventoryTests.cs` (one row: `("POST", "/api/auth/guest/convert", "None")`).

**Interfaces — Produces:**
```csharp
// POST /api/auth/guest/convert   body: RegisterRequest { Email, Password }   → 200 AuthResponse (User.IsGuest == false, same Id)
//   400 validation / invalid_email · 403 not_a_guest · 409 email_taken · 410 guest_expired · 429 rate_limited
internal static class GuestConversion
{
    // ONE statement. Returns the number of rows updated: 1 = converted, 0 = not a live guest.
    internal static Task<int> TryConvertAsync(AppDbContext db, Guid userId, string email, string passwordHash,
        string? displayName, bool autoVerify, DateTimeOffset now, CancellationToken ct);
}
internal Task<bool> PurgeOneGuestAsync(Guid userId, DateTimeOffset now, CancellationToken ct); // was private; re-checks the predicate
```
**Consumes:** `GuestIdentity.IsGuestEmail`, `RefreshTokenService.IssueAsync(userId, ct)` + `CookieOptions()` (normal lifetime), `JwtTokenService.Issue(user)`, `DeviceService.ClearCookie(resp)`, `AuditLog { ActorUserId, Action, Target, Reason }` (`AccountTeardown.cs:37-43`), cache key `tver:{id:N}`.

- [ ] **1. Failing tests** (`[Collection("DemoAuth")]`, `Build`/`StartGuestAsync`/`RegisterRealUserAsync` idioms from `GuestCapsTests.cs`, recording queue in every factory)

```csharp
private static object Body(string? email = null) =>
    new { email = email ?? $"convert+{Guid.NewGuid():N}@spectr.test", password = "correct-horse-battery" };

[SkippableFact]
public async Task A_Guest_Becomes_A_Real_Account_On_The_Same_Row_And_Keeps_Their_Songs()
{
    await TestDb.RequireAsync(factory);
    using var f = Build(); var (client, demo) = await StartGuestAsync(f);
    var email = $"convert+{Guid.NewGuid():N}@spectr.test";
    var oldToken = client.DefaultRequestHeaders.Authorization!.Parameter!;

    var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body(email));
    Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    var auth = (await resp.Content.ReadFromJsonAsync<AuthResponse>())!;
    Assert.Equal(demo.User.Id, auth.User.Id);          // SAME row
    Assert.False(auth.User.IsGuest);
    Assert.Equal(email, auth.User.Email);

    using (var scope = f.Services.CreateScope())
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var u = await db.Users.AsNoTracking().SingleAsync(x => x.Id == demo.User.Id);
        Assert.False(u.IsGuest); Assert.Null(u.GuestExpiresAt); Assert.Null(u.GuestDeviceId);
        Assert.True(await db.Songs.AnyAsync(s => s.UserId == u.Id && s.Id == demo.Demo.SongId)); // work kept
        Assert.Equal(1, await db.AuditLogs.CountAsync(a => a.Target == u.Id.ToString() && a.Action == "guest_converted"));
        Assert.Equal(1, await db.RefreshTokens.CountAsync(t => t.UserId == u.Id));               // old guest row gone
    }

    // The guest token is dead (version bumped); the new one is a full account.
    var stale = f.CreateClient(); stale.DefaultRequestHeaders.Authorization = new("Bearer", oldToken);
    Assert.Equal(HttpStatusCode.Unauthorized, (await stale.GetAsync("/api/auth/me")).StatusCode);
    var fresh = f.CreateClient(); fresh.DefaultRequestHeaders.Authorization = new("Bearer", auth.AccessToken);
    var export = await fresh.GetAsync("/api/me/export");
    Assert.NotEqual(HttpStatusCode.Forbidden, export.StatusCode);   // no longer fenced

    // Normal refresh lifetime: the literal Set-Cookie Expires is far beyond the guest's 24 h.
    var setCookie = resp.Headers.GetValues("Set-Cookie").Single(h => h.StartsWith(RefreshTokenService.CookieName + "="));
    var expires = DateTimeOffset.Parse(setCookie.Split(';').Select(p => p.Trim())
        .Single(p => p.StartsWith("expires=", StringComparison.OrdinalIgnoreCase))["expires=".Length..]);
    Assert.True(expires > DateTimeOffset.UtcNow.AddDays(2));
}

[SkippableFact]
public async Task An_Email_That_Exists_Leaves_The_Guest_Untouched()
{
    await TestDb.RequireAsync(factory);
    using var f = Build();
    var taken = $"taken+{Guid.NewGuid():N}@spectr.test";
    (await f.CreateClient().PostAsJsonAsync("/api/auth/register", Body(taken))).EnsureSuccessStatusCode();
    var (client, demo) = await StartGuestAsync(f);
    var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body(taken));
    Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    using var scope = f.Services.CreateScope();
    var u = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().SingleAsync(x => x.Id == demo.User.Id);
    Assert.True(u.IsGuest); Assert.NotNull(u.GuestExpiresAt);
    Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me/guest")).StatusCode); // session still works
}

[SkippableFact]
public async Task A_Real_User_Cannot_Call_It()
{
    await TestDb.RequireAsync(factory);
    using var f = Build(); var (client, _) = await RegisterRealUserAsync(f);
    var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body());
    Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    Assert.Equal("not_a_guest", (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetProperty("code").GetString());
}

[SkippableFact]
public async Task The_Reserved_Guest_Domain_Is_Refused()
{
    await TestDb.RequireAsync(factory);
    using var f = Build(); var (client, _) = await StartGuestAsync(f);
    var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body("me@guest.spectr.invalid"));
    Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
}

[SkippableFact]
public async Task An_Expired_Guest_Cannot_Be_Resurrected()
{
    await TestDb.RequireAsync(factory);
    using var f = Build(); var (_, demo) = await StartGuestAsync(f);
    using var scope = f.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Users.Where(u => u.Id == demo.User.Id)
        .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
    var rows = await GuestConversion.TryConvertAsync(db, demo.User.Id, $"late+{Guid.NewGuid():N}@spectr.test",
        "hash", "late", autoVerify: false, DateTimeOffset.UtcNow, default);
    Assert.Equal(0, rows);
    Assert.True((await db.Users.AsNoTracking().SingleAsync(u => u.Id == demo.User.Id)).IsGuest);
}

[SkippableFact]
public async Task The_Purge_Never_Tears_Down_A_Converted_Account()
{
    await TestDb.RequireAsync(factory);
    using var f = Build(); var (client, demo) = await StartGuestAsync(f);
    (await client.PostAsJsonAsync("/api/auth/guest/convert", Body())).EnsureSuccessStatusCode();
    var sweeper = f.Services.GetServices<IHostedService>().OfType<RetentionSweepScheduler>().Single();
    // Simulates the race: the id was selected as an expired guest, then the owner converted.
    Assert.False(await sweeper.PurgeOneGuestAsync(demo.User.Id, DateTimeOffset.UtcNow.AddDays(30), default));
    using var scope = f.Services.CreateScope();
    Assert.True(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AnyAsync(u => u.Id == demo.User.Id));
}
```
Read how `GuestPurgeTests.cs` obtains the scheduler instance and use the SAME way (do not invent a resolution path). Run → all FAIL (404 route / missing members).

- [ ] **2. `GuestConversion.TryConvertAsync`** — a single `ExecuteUpdateAsync` over `db.Users.Where(u => u.Id == userId && u.IsGuest && u.GuestExpiresAt != null && u.GuestExpiresAt > now)` setting `Email`, `HashedPassword`, `DisplayName`, `IsGuest=false`, `GuestExpiresAt=null`, `GuestDeviceId=null`, `TokenVersion = u.TokenVersion + 1`, and `EmailVerifiedAt = now` only when `autoVerify`. A unique-violation on the email index (`Npgsql.PostgresException { SqlState: "23505" }`, also via `DbViolations.IsUniqueViolation`) is caught by the CALLER and mapped to `409 email_taken`.
- [ ] **3. The endpoint** — `app.MapGroup("/auth").MapPost("/guest/convert", Convert).RequireAuthorization().AllowGuest();`. Order inside `Convert`: `!user.IsGuest()` → `403 not_a_guest` · the `auth_register` per-IP limiter (5/min) + the disposable-domain arm exactly as `AuthEndpoints.cs:162-180` · email/password validation identical to `:166-186` · `IsGuestEmail` → `400 invalid_email` · `AnyAsync(email)` → `409 email_taken` · `TryConvertAsync` (0 → `410 guest_expired`, "This guest session has ended — create a new account to start again.") · `cache.Remove($"tver:{id:N}")` · delete the user's refresh rows, `IssueAsync(id, ct)` + `CookieOptions()` · audit row `Action="guest_converted"`, `Reason="guest created an account"` · `DeviceService.ClearCookie(resp)` · verification email best-effort in `try/catch` (never fails the conversion) · reload the row, return `AuthResponse(jwt.Issue(user), new AuthedUser(id, email, displayName, await ResolveTierAsync(...)))`. Dev auto-verify follows `:213-215`. NO `DemoSeeder` call (they already have the demo) and NO device claim.
- [ ] **4. Purge re-check** — `PurgeOneGuestAsync` takes `now` and loads `SingleOrDefaultAsync(u => u.Id == userId && u.IsGuest && (u.GuestExpiresAt == null || u.GuestExpiresAt < now))`; null → `false`. Pass `now` from the batch loop. Existing purge tests must still pass unchanged.
- [ ] **5. Gates, commit:** `feat(bff): a guest who creates an account keeps the same account and everything in it`.

---

### Task G3: The coach opens with a brief (BFF + worker)

**Files:** Create migration `AddCoachBriefMode`, `BFF/Endpoints/CoachBriefEndpoints.cs`, `BT/CoachBriefTests.cs`, `components/worker/prompts/coach/CoachOpeningBrief.md`, `WK/coach_lib/brief_template.py`, `WT/test_coach_brief_template.py`, `WT/test_coach_brief_mode.py`. Modify `components/bff/src/Spectr.Data/AppDbContext.cs:135-136`, `components/shared/aimusic_shared/models.py:525`, `BFF/DTOs/CoachConversationDtos.cs:10-17`, `BFF/Endpoints/CoachConversationEndpoints.cs` (`:286` projection, `:310` visibility → `internal`), `BFF/Services/CoachCapService.cs:105-107`, `BFF/Program.cs` (one line after `:596`), `WK/coach_actor.py` (`:444-450`, `:501-535`, `:564-586`), `BT/GuestGuardInventoryTests.cs` (one row: `("POST", "/api/coach/{analysisId:guid}/brief", "None")`), `BFF/Services/DemoSnapshot.cs` / seeder only if `Mode` is not already carried (it is: `DemoSnapshotMessage.Mode`, `:81`).

**Interfaces — Produces:**
```csharp
// POST /api/coach/{analysisId:guid}/brief → 202 { status: "created", messageId } | 200 { status: "exists", messageId } | 200 { status: "skipped", messageId: null }
//   404 analysis not the caller's · 409 brief_not_ready (no routing plan yet)
public sealed record CoachBriefResponse(string Status, Guid? MessageId);
public static class CoachBrief
{
    public const string Mode = "brief";
    public const string Instruction = "Give me your opening brief for this mix.";
    public const string GuestClosingLine = "Create a free account and let's save our progress — so we can make this mix awesome.";
}
// CoachMessageDto gains (trailing, defaulted): bool IsBrief = false, string? ClosingLine = null
```
```python
# WK/coach_lib/brief_template.py
def build_template_brief(verdicts: list[dict]) -> str: ...   # pure; never invents a number; never empty
```
Frontend type (consumed by G6): `CoachMessageDto` gains `isBrief: boolean; closingLine: string | null`.

- [ ] **1. Failing worker test — the template**

```python
# WT/test_coach_brief_template.py
from app.coach_lib.brief_template import build_template_brief

V = [
    {"specialist": "stereo_phase", "severity": "moderate", "category": "stereo", "headline": "Correlation 0.12: mix is on the edge of collapsing in mono",
     "summary": "Left and right are nearly unrelated. Check the mix in mono.", "metric_line": "L/R correlation 0.12", "priority_score": 91, "suspected": False},
    {"specialist": "loudness", "severity": "moderate", "category": "loudness", "headline": "Integrated loudness -16.9 LUFS",
     "summary": "2.9 dB under the streaming target.", "metric_line": "LUFS -16.9", "priority_score": 80, "suspected": False},
    {"specialist": "low_end", "severity": "minor", "category": "spectrum", "headline": "Low-mid mud", "summary": "Bass and low-mids sit too close.",
     "metric_line": None, "priority_score": 70, "suspected": False},
    {"specialist": "dynamics", "severity": "minor", "category": "dynamics", "headline": "Weak transient attack", "summary": "Soft.",
     "metric_line": None, "priority_score": 60, "suspected": False},
    {"specialist": "rule_engine.x", "severity": "moderate", "category": "spectrum", "headline": "Maybe dull", "summary": "?",
     "metric_line": None, "priority_score": 99, "suspected": True},
    {"specialist": "clarity", "severity": "moderate", "category": "spectrum", "headline": "Specialist failed", "summary": "boom",
     "metric_line": None, "priority_score": 98, "suspected": False},
]

def test_lists_the_three_highest_priorities_in_order():
    text = build_template_brief(V)
    a, b, c = (text.index("Correlation 0.12"), text.index("Integrated loudness"), text.index("Low-mid mud"))
    assert a < b < c
    assert "Weak transient attack" not in text          # only three

def test_never_leads_with_a_suspected_or_failed_finding():
    text = build_template_brief(V)
    assert "Maybe dull" not in text and "Specialist failed" not in text

def test_only_repeats_numbers_that_are_stored():
    import re
    stored = " ".join(f"{v['headline']} {v['summary']} {v['metric_line'] or ''}" for v in V)
    for n in re.findall(r"\d+(?:\.\d+)?", build_template_brief(V)):
        assert n in stored or n in {"1", "2", "3"}       # list markers are the only free digits

def test_an_analysis_with_no_findings_still_says_something_useful():
    text = build_template_brief([])
    assert len(text) > 40 and "error" not in text.lower()
```
Before pinning the actionable-severity set, Grep the vocabulary (`aimusic_shared/verdicts/`, `severity`) — wins/observations must not be listed as problems.

- [ ] **2. Failing BFF tests** (`BT/CoachBriefTests.cs`, recording queue): (a) first call for a real user's triaged analysis → 202 `created`, the queue recorded ONE `coach_reply` on `coach` with three ids, the conversation now holds a hidden user row (`Mode="brief"`, `Content == CoachBrief.Instruction`) and a pending assistant row (`Mode="brief"`), and NO `usage_events` row of type `coach_message` was written; (b) second call → 200 `exists`, same `messageId`, nothing enqueued; (c) two PARALLEL calls → exactly one assistant brief row (`Task.WhenAll`, assert the count) — this is the partial-unique-index test; (d) `routing_plan == null` → 409 `brief_not_ready`; (e) a version whose `FilePath` starts with `audio/demo/` → 200 `skipped`, nothing enqueued, nothing inserted; (f) `GET /api/coach/{analysisId}/conversation` never returns the hidden user row, returns the brief with `IsBrief == true`, and `ClosingLine == CoachBrief.GuestClosingLine` for a guest caller but `null` for a real user; (g) a guest with `coach_guest_messages` already spent can still get a brief, and a brief does not move the guest's `coachMessagesUsed` in `GET /api/me/guest`; (h) another user's analysis → 404. Seed analyses with the `SeedAnalysisAsync` idiom (`GuestCapsTests.cs:128-150`), setting `RoutingPlan` to `DemoSeedMapping.EmptyRoutingPlanJson` for the triaged cases.
- [ ] **3. Migration `AddCoachBriefMode`** — scaffold after changing `AppDbContext.cs:135-136` to `"\"mode\" IN ('qa','teach','concise','brief')"`; then APPEND by hand (EF cannot express a partial index — see `components/bff/README.md`): Up `CREATE UNIQUE INDEX ux_coach_messages_brief ON coach_messages (conversation_id) WHERE mode = 'brief' AND role = 'assistant';` Down `DROP INDEX IF EXISTS ux_coach_messages_brief;`. Mirror the CHECK text in `models.py:525` (the shared-model test suite pins it — run `pytest -q components/shared/tests/`).
- [ ] **4. `CoachBriefEndpoints`** — `MapGroup("/coach/{analysisId:guid}")`, `RequireAuthorization()`, `MapPost("/brief", Post).AllowGuest()`. Ownership exactly as `PostMessage` establishes it (read `CoachConversationEndpoints.cs:65-110`; reuse `GetOrCreateConversationAsync`). Demo check: join the analysis' version and test `FilePath.StartsWith("audio/demo/")` (null version → not demo). Insert both rows in ONE `SaveChanges` (user row `CreatedAt = now`, assistant `now + 1 ms`, as `:147-176`); on a unique violation re-read the existing brief → `exists`. Enqueue `DramatiqTasks.CoachReply` on `DramatiqQueues.Coach` with the three ids; on enqueue failure mark the assistant row `error` exactly as `:220-234` and return 503 `coach_queue_unavailable`. NO usage event, NO cap check.
- [ ] **5. Read paths** — conversation projection (`:286`): filter out `Role == "user" && Mode == "brief"`; set `IsBrief`, and `ClosingLine` only when `IsBrief && Role == "assistant" && Status == "complete" && user.IsGuest()`. `CoachCapService.cs:105-107`: add `&& m.Mode != "brief"` so the free per-analysis cap ignores the hidden row.
- [ ] **6. Worker** — `prompts/coach/CoachOpeningBrief.md`: copy `ConciseStyle.md`'s frontmatter shape (its own `version`); body instructs: open in one sentence on the overall state; then "What I found" (2–3 sentences grounded in the bundle); then "Top 3 priorities" as a numbered list, each with the finding, why it matters, and the fix already suggested in the verdicts; then one sentence pointing at the findings list. Same evidence rules as `CoachGrounded.md`; no sign-off, no mention of accounts (the BFF owns the closing line). In `coach_actor.py`: add `elif mode == "brief":` mirroring the `concise` branch (`:501-525`) with `prompt_slug = "coach_brief"`; at the degraded exit (`:444-450`) and in BOTH `except LlmBudgetExceeded` / `except LlmError` exits (`:564-586`), when `mode == "brief"`: build `CoachReplyPayload(kind="answer", body=build_template_brief(_load_verdicts_for_bundle(analysis_id=analysis_id)), evidence=[])`, `publisher.token(body)`, `publisher.done(evidence=[])`, `_mark_complete(mid, payload=…, llm_call_id=getattr(exc, "llm_call_id", None), user_message_id=uid_msg)` and return. `mode` must therefore be read before the degraded exit — move nothing else. Keep the file's growth to these three small blocks.
  `WT/test_coach_brief_mode.py`: follow the existing coach-actor tests' fixtures (Grep `coach_reply` under `WT/`): (i) brief mode with `LLM_FAKE` completes and used slug `coach_brief`; (ii) brief mode on a degraded analysis ends `complete` with the template body, NOT `refused`; (iii) brief mode when the gateway raises `LlmBudgetExceeded` ends `complete` with the template body; (iv) `qa` mode on the same two conditions is unchanged (`refused` / `error`).
- [ ] **7. Gates (BFF + worker + shared), commit:** `feat(coach): the coach opens each report with a brief — findings, fixes, top three priorities`.

---

### Task G4: Protect the VM — memory-capped structure detection, guest track length

**Files:** Modify `components/analysis/src/audio_analysis/structure/docker_allin1.py` (`:123-131`, `:200-222`), `WK/source_validation.py` (`:48-49`, `:132-158`), `WK/tasks_dramatiq.py:271`, `docs/STARTUP.md` (#2d: the cap now exists; how to raise it), `infra` compose env only if `ALLIN1_*` vars are listed there (Grep). Tests: `components/analysis/tests/structure/test_docker_memory_cap.py`, `WT/test_guest_track_length.py`.

**Interfaces — Produces:**
```python
class Allin1OutOfMemory(RuntimeError): ...        # docker_allin1.py
DEFAULT_MEMORY_LIMIT = "6g"                       # env ALLIN1_MEMORY_LIMIT; "" / "0" disables the flags
def validate_source(path, *, max_seconds: float | None = None) -> float   # None → env default (1800)
```

- [ ] **1. Failing tests**
```python
# components/analysis/tests/structure/test_docker_memory_cap.py
import subprocess
import pytest
from audio_analysis.structure import docker_allin1 as mod

def _runner(monkeypatch, tmp_path, returncode=0, stdout='{"bpm": 120, "segments": []}', stderr=""):
    audio = tmp_path / "a.wav"; audio.write_bytes(b"RIFF")
    seen = {}
    d = mod.DockerAllin1()
    monkeypatch.setattr(d, "ensure_available", lambda: None)
    def fake_run(cmd, *, timeout):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, returncode, stdout, stderr)
    monkeypatch.setattr(d, "_run", staticmethod(fake_run))
    return d, audio, seen

def test_the_container_is_memory_capped_with_no_swap(monkeypatch, tmp_path):
    monkeypatch.delenv("ALLIN1_MEMORY_LIMIT", raising=False)
    d, audio, seen = _runner(monkeypatch, tmp_path)
    try: d.analyze(audio)
    except Exception: pass                                    # result parsing is not under test
    cmd = seen["cmd"]
    assert cmd[cmd.index("--memory") + 1] == "6g"
    assert cmd[cmd.index("--memory-swap") + 1] == "6g"        # equal → the container cannot swap the VM to death
    assert cmd.index("--memory") < cmd.index(d.image_name)    # flags precede the image

def test_the_cap_is_env_tunable(monkeypatch, tmp_path):
    monkeypatch.setenv("ALLIN1_MEMORY_LIMIT", "3g")
    d, audio, seen = _runner(monkeypatch, tmp_path)
    try: d.analyze(audio)
    except Exception: pass
    assert seen["cmd"][seen["cmd"].index("--memory") + 1] == "3g"

def test_an_oom_kill_is_reported_as_such(monkeypatch, tmp_path):
    d, audio, _ = _runner(monkeypatch, tmp_path, returncode=137, stdout="", stderr="Killed")
    with pytest.raises(mod.Allin1OutOfMemory):
        d.analyze(audio)
```
```python
# WT/test_guest_track_length.py
import pytest
from app import source_validation as sv

def test_a_guest_limit_is_enforced(monkeypatch, tmp_path):
    p = tmp_path / "a.wav"; p.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")
    monkeypatch.setattr(sv, "_probe_duration", lambda path, fmt: 721.0)
    with pytest.raises(sv.InvalidFileError) as e:
        sv.validate_source(p, max_seconds=720)
    assert e.value.reason_code == sv.REASON_TOO_LONG
    assert "free account" in e.value.message

def test_without_a_limit_the_default_applies(monkeypatch, tmp_path):
    p = tmp_path / "a.wav"; p.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")
    monkeypatch.setattr(sv, "_probe_duration", lambda path, fmt: 721.0)
    assert sv.validate_source(p) == 721.0
```
If `_run` is not patchable as written, adapt the PATCHING, not the assertions.
- [ ] **2. Implement.** `docker_allin1.py`: after `--rm`, when the limit is non-empty and not `"0"`: `cmd += ["--memory", limit, "--memory-swap", limit]`; map `returncode == 137` (or stderr containing `Killed`/`OOM`) to `Allin1OutOfMemory("structure detection ran out of memory (limit …)")` BEFORE the generic `RuntimeError`. It subclasses `RuntimeError`, so `detect_structure_job`'s existing handler (`WK/structure_actor.py:152-185`) already marks arrangement as not assessed and the analysis stays complete — add a test in `WT/` only if no existing test covers that handler (Grep `arrangement_status`). `source_validation.py`: `max_seconds` parameter; when it is the binding limit the message is `f"this track is {duration/60:.0f} minutes long — guest uploads go up to {max_seconds/60:.0f} minutes; create a free account for longer tracks"`. `tasks_dramatiq.py:271`: `max_seconds = feature_flags.get_flag_int("guest_track_max_seconds", 720) if resolve_lane(user_id, None) == GUEST_TIER else None` (imports from `app.llm.lane`; lookup failure → `None`, never blocks a real user).
- [ ] **3. Docs** — `docs/STARTUP.md` #2d: replace "Until the container gets a memory cap…" with the cap, its env var, and "if long tracks now report arrangement as not assessed, raise `ALLIN1_MEMORY_LIMIT` and give WSL more RAM in `.wslconfig`".
- [ ] **4. Gates (analysis + worker), commit:** `fix(worker): structure detection is memory-capped and guest tracks are length-capped, so one upload cannot take the box down`.

---

### Task G5: `/analyze` uploads as a guest; the teaser is gone

**Depends on:** D9 (`startDemo`), D10 (`openGuestUpgrade`), G0, G1, G2, **G4**.

**Files:** Rewrite `FE/features/anon-analyze/AnalyzePage.tsx` (keep `DropZoneView` `:32-84`; delete `AnonReportView` `:95-154`, `InlineRegisterCard` `:338-396`, the polling/claim logic `:160-336`). Delete `FE/features/anon-analyze/{anon-report-vm.ts,useAnonAnalysis.ts,resume-dismissed.ts}` and their tests (incl. `__tests__/anon-current-job-cache.test.tsx`) once nothing imports them. Modify `FE/features/anon-analyze/LandingResumeSlot.tsx` + `ResumeCard.tsx` (auth-driven), `FE/auth/AuthContext.tsx:144-154` (`register`), `FE/lib/analytics.ts:54-68`, `FE/features/anon-analyze/analyze.module.css` (drop dead rules). Tests: `FE/features/anon-analyze/__tests__/analyze-guest-upload.test.tsx`, `FE/auth/__tests__/AuthContext.convert.test.tsx`, update `FE/features/landing/**` tests that mention the resume slot.

**Consumes:** `startDemo: () => Promise<DemoStartResponse>` and `AuthedUser.isGuest` (D9 Produces, `PRPs/archive/2026-09-30_guest-demo-sandbox-plan.md:914-924`); `useMixUpload().upload(file, fields): Promise<UploadResponse>` (`FE/hooks/useMixUpload.ts:134`); `openGuestUpgrade(reason)` (D10); `buildProgressPlan` (G0); `POST /api/auth/guest/convert` (G2).
**Produces:** `export async function startGuestUpload(deps: { user: AuthedUser | null; startDemo: () => Promise<unknown>; upload: (f: File) => Promise<UploadResponse> }, file: File): Promise<UploadResponse>` in `FE/features/anon-analyze/startGuestUpload.ts`; analytics events `guest_upload_started` (props `{ job_id }`) and `guest_converted`.

- [ ] **1. Failing tests**
```tsx
// @vitest-environment jsdom
// analyze-guest-upload.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { startGuestUpload } from '../startGuestUpload';
const file = new File(['x'], 'mix.wav', { type: 'audio/wav' });
const RES = { songId: 's', versionId: 'v', jobId: 'j' };

describe('startGuestUpload', () => {
  it('starts a guest session first when nobody is signed in', async () => {
    const order: string[] = [];
    const res = await startGuestUpload({
      user: null,
      startDemo: vi.fn(async () => { order.push('demo'); }),
      upload: vi.fn(async () => { order.push('upload'); return RES; }),
    }, file);
    expect(order).toEqual(['demo', 'upload']);
    expect(res).toEqual(RES);
  });
  it('never starts a second session for someone already signed in', async () => {
    const startDemo = vi.fn();
    await startGuestUpload({ user: { id: 'u', email: 'a@b.c', displayName: null, tier: 'free' }, startDemo, upload: async () => RES }, file);
    expect(startDemo).not.toHaveBeenCalled();
  });
  it('does not upload when the guest session cannot start', async () => {
    const upload = vi.fn();
    await expect(startGuestUpload({ user: null, startDemo: async () => { throw new Error('demo_unavailable'); }, upload }, file)).rejects.toThrow('demo_unavailable');
    expect(upload).not.toHaveBeenCalled();
  });
});
```
Page test (same file, mocks: `useAuth`, `useMixUpload`, `@tanstack/react-router`'s `useNavigate`, `capture`): dropping a file navigates to `{ to: '/songs/$songId/results/$jobId', params: { songId: 's', jobId: 'j' } }`; the page never renders the strings `Create a free account to keep this report` or `#1 finding`; a rejected upload whose error `code === 'guest_restricted'` calls `openGuestUpgrade` with the error's `details.reason`; the page shows a link with text `Explore the demo` → `/demo`; `document.body.textContent` never matches `/public|shared|people|community/i`.
`AuthContext.convert.test.tsx` (mount helper from the D9 test, `PRPs/archive/2026-09-30_guest-demo-sandbox-plan.md:944-949`): when `state.user.isGuest`, `register(email, pw)` POSTs `/auth/guest/convert` (not `/auth/register`) and the session's user id is unchanged afterwards; when nobody is signed in it still POSTs `/auth/register`; a conversion does NOT clear the query cache (`qc.setQueryData(['songs'], [1])` survives — same user id), while D9's "different user" rule still clears it.
- [ ] **2. Implement.** `UploadResponse.jobId` can be `null` only when `analyze=false`; this page never sends that — if it is null, navigate to `/songs/$songId` instead of guessing. While uploading show the existing progress bar; on the results route the G0 progress list takes over (the `/analyze` page no longer renders `ProgressStorylineView` itself). `register`: `const url = stateRef.current.user?.isGuest ? '/auth/guest/convert' : '/auth/register'` (read how D9 made the current user available inside callbacks; do not add a second state source) + `capture('guest_converted')`. `LandingResumeSlot`: no network call; `useAuth().user?.isGuest` → one `ResumeCard` "Your analysis is saved for 24 hours" → `/library`; otherwise render nothing. Remove the now-unused `analyze_completed` / `report_claimed` / `resume_*` captures only where their code is deleted — keep the union members (history).
- [ ] **3. Live check (controller does the browser pass; implementer states what to look at):** logged-out `/analyze` → drop a short WAV → progress on the real results route → full report; the landing logs no red 404.
- [ ] **4. Gates, commit:** `feat(frontend): an upload on /analyze opens the full product as a guest — the teaser page is gone`.

---

### Task G6: The brief in the chat, the account invitation, guest caps in the upload dialog

**Files:** Create `FE/features/results/useCoachBrief.ts`, `FE/features/results/CoachBriefCta.tsx` (+ rules in the coach chat's existing CSS module), tests `FE/features/results/__tests__/{useCoachBrief.test.tsx,coach-brief-cta.test.tsx}`. Modify `FE/api/types.ts:1314-1330` (`isBrief`, `closingLine`), the coach message bubble component (Grep where `CoachMessageDto.content` is rendered under `FE/features/results/`), `FE/features/results/CoachChat.tsx` (mount the hook; it already receives `specialistsRan`/`specialistsSuggested`, `:25-42`), the job-progress screen on `FE/routes/_app/songs.$songId.results.$jobId.tsx` (the "explore a finished report" link), `FE/components/UnifiedUploadDialog.tsx` (few lines: caps copy for guests), `FE/features/demo/useGuestState.ts` (new DTO fields), `FE/lib/analytics.ts`.

**Produces:**
```ts
export function shouldRequestBrief(a: { triageDone: boolean; specialistsSuggested: number; specialistsRan: number;
  conversationLoaded: boolean; hasBrief: boolean; alreadyRequested: boolean }): boolean;
export function useCoachBrief(args: { analysisId: string | null } & Omit<Parameters<typeof shouldRequestBrief>[0], 'alreadyRequested'>): void;
```
- [ ] **1. Failing tests** — `shouldRequestBrief`: false until `triageDone && conversationLoaded`; false while `specialistsRan < specialistsSuggested`; true when all ran (and when `specialistsSuggested === 0`); false when `hasBrief` or `alreadyRequested`. Hook: fires `POST /coach/{analysisId}/brief` exactly ONCE across re-renders and StrictMode double-mount (a `useRef` latch keyed by `analysisId`), then invalidates the conversation query; a 409 `brief_not_ready` re-arms the latch after 5 s (fake timers), a `skipped` response never retries; never fires with `analysisId === null`. CTA: a brief message with `closingLine` renders that exact sentence as the LAST paragraph of the bubble and a link-button `Create free account` → `/register?from=guest`; with `closingLine === null` neither appears; clicking captures `guest_signup_clicked`. The streamed brief uses the existing per-message stream — assert the hook does not open a second stream.
- [ ] **2. Implement**, plus: progress screen — when `useAuth().user?.isGuest` and the guest's library contains a song whose name starts with `Demo: `, show `Explore a finished report while yours is analyzing` linking to that song's report (use the existing songs query; render nothing while it loads or when absent). Upload dialog for guests: under the stems zone `Guests can add up to {stemsMaxFiles} stems ({stemsMaxMb} MB) per track`; a second reference is prevented client-side with the same wording the server uses; all numbers come from `GET /api/me/guest`, never literals.
- [ ] **3. Live check (controller):** brief appears once, streams, ends with the closing line + button for a guest; after creating the account the same chat shows the brief WITHOUT the line; the same songs are in the library.
- [ ] **4. Gates, commit:** `feat(frontend): the coach opens with its brief and invites a guest to keep their work`.

---

### Task G7: Snapshot retention, upload smoke, docs

**Files:** Modify `BFF/Endpoints/AdminEndpoints.DemoSnapshot.cs` (`:128` pre-check, `:185-210` deferred retire), `BT` exporter tests (Grep `snapshot_not_ready`), `components/frontend-spectr-v2/e2e/smoke-guest-upload.spec.ts` (new; mirror D11's `smoke-demo.spec.ts` config, `LLM_FAKE=1`), `docs/azure-deploy-remaining-work.md`, `README.md`, `PRPs/deferred-work.md` (anon endpoints removal; server-side "specialists finished" signal).

- [ ] **1. Failing BFF tests** — (a) exporting a version whose audio key does not exist → `409 snapshot_not_ready`, nothing written; (b) export A, then export B immediately → A's audio key STILL exists and `audio/demo/snapshot/retired.json` lists A's keys with a timestamp; (c) with the manifest entry's timestamp rewritten to `now − (guest_ttl_hours + 2 h)`, the next export deletes A's keys and drops the entry; (d) a manifest entry outside `audio/demo/snapshot/` is never deleted (reuse `IsRetireableAssetKey`); (e) a corrupt manifest → logged, treated as empty, the export still succeeds.
- [ ] **2. Implement** — `storage.ExistsAsync(version.FilePath)` before any write. Retire step: read manifest → append `{ keys: <previous export's asset keys>, retiredAt: now }` → delete entries where `retiredAt < now − (guest_ttl_hours + 1 h)` through the existing guard → write the manifest back. Still runs only after `wentLive` and never blocks or fails the export.
- [ ] **3. Playwright** — logged-out `/analyze` → upload the repo's synthetic test WAV → report renders → the coach brief ends with the closing line → `Create free account` → register → library still lists the uploaded song. Desktop Chrome only.
- [ ] **4. Docs** — deploy notes: new flags + the 24-hour TTL, `ALLIN1_MEMORY_LIMIT`, "re-export keeps the previous audio for one guest lifetime", "re-do the source conversation and generate a brief before the prod export". README: the public flow in two sentences.
- [ ] **5. Gates, commit:** `feat(demo): re-exports never break live guests; guest-upload smoke; deploy notes`.
