# Song Page Console — Build Plan 1 of 2: BFF

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-version analysis metrics on the song payload, and add two new
per-user persistence stores (personal scores + compare notes), so the redesigned song
console (Plan 2, frontend) can render real data.

**Architecture:** Extend the existing `/api/songs/{id}` response so every `VersionDto`
carries its own latest analysis result (6 measured metrics), via the per-version
`Analysis.VersionId` join the codebase already uses in `ReportsEndpoints`/`CompareEndpoints`.
Add two small EF entities + migrations (`version_user_ratings`, `version_compare_notes`)
with CRUD endpoints. All metric extraction goes through one shared `final_json` reader to
kill the existing duplication between Song/Compare/Reports endpoints.

**Tech Stack:** ASP.NET Core .NET 10 minimal APIs, EF Core 10 + Npgsql (snake_case),
xUnit + `WebApplicationFactory<Program>` integration tests.

## Global Constraints

- .NET 10; build `dotnet build`, test `dotnet test` (from `components/bff`).
- EF Core 10 + Npgsql; **snake_case columns** via `[Column("...")]` + `[Table("...")]`.
- Migrations: `dotnet ef migrations add <Name> --project src/Spectr.Data --startup-project src/Spectr.Bff`; apply with `dotnet ef database update` (same flags).
- **IDOR rule:** every query on user-owned data filters `WHERE user_id == currentUser.UserId()` — never fetch-then-filter.
- `<NuGetAuditMode>direct</NuGetAuditMode>` already set; don't add packages.
- **No letter grades on this surface** (Change D): do NOT add `grade` to any new per-version DTO. Score is the only quality signal.
- Integration tests are gated on a live Postgres via `PostgresReachable()` (return early when down) — mirror `AuthEndpointsTests`. Pure-logic tests need no gate.
- Windows: stop any running BFF before `dotnet build` (file lock on `Spectr.Bff.exe`).

---

## File map

| File | Create / Modify | Responsibility |
|---|---|---|
| `src/Spectr.Bff/Support/FinalJsonMetrics.cs` | **Create** | Shared `final_json` → metrics reader (the 6 values) |
| `src/Spectr.Bff/DTOs/VersionDtos.cs` | Modify | Add `VersionMetricsDto`; add `LatestResult` + `PersonalScore` to `VersionDto` |
| `src/Spectr.Bff/Endpoints/SongEndpoints.cs` | Modify | `GetById` batch-loads per-version latest analysis + caller's ratings; `ToVersionDto` maps them |
| `src/Spectr.Data/Entities/VersionUserRating.cs` | **Create** | per-user × per-version personal score |
| `src/Spectr.Data/Entities/VersionCompareNote.cs` | **Create** | per-user × per-sorted-pair notes |
| `src/Spectr.Data/AppDbContext.cs` | Modify | register the two DbSets + unique indexes |
| `src/Spectr.Bff/Endpoints/VersionEndpoints.cs` | Modify | `PUT`/`DELETE /api/versions/{id}/rating` |
| `src/Spectr.Bff/Endpoints/CompareEndpoints.cs` | Modify | `GET`/`PUT`/`DELETE /api/compare/notes` |
| `tests/Spectr.Bff.Tests/FinalJsonMetricsTests.cs` | **Create** | pure unit tests for the reader |
| `tests/Spectr.Bff.Tests/SongVersionMetricsTests.cs` | **Create** | endpoint test: versions carry metrics |
| `tests/Spectr.Bff.Tests/PersonalScoreTests.cs` | **Create** | endpoint test: rating upsert/clear |
| `tests/Spectr.Bff.Tests/CompareNotesTests.cs` | **Create** | endpoint test: notes upsert/read/sorted-pair |

---

## Task 1: Shared `final_json` metrics reader

**Files:**
- Create: `src/Spectr.Bff/Support/FinalJsonMetrics.cs`
- Create: `tests/Spectr.Bff.Tests/FinalJsonMetricsTests.cs`
- Modify: `src/Spectr.Bff/DTOs/VersionDtos.cs` (add `VersionMetricsDto`)

**Interfaces:**
- Produces: `record VersionMetricsDto(double? Score, double? Lufs, double? DynamicRangeLu, double? Bass, double? Air, double? StereoWidth)` and `static VersionMetricsDto? FinalJsonMetrics.Read(string? finalJson)` — returns `null` only when `finalJson` is null/empty/unparseable; otherwise a DTO whose individual fields are null when absent.

The `final_json` shape (verified): root has `overall_score` (and legacy `mix_score`); the
six measured values live under the phase-1 object found at `phases[]` where `phase == 1`,
in its `data` object — keys `lufs`, `loudness_range_lu`, `low_energy` (bass), `stereo_width`,
and `bands.air`.

- [ ] **Step 1: Add the `VersionMetricsDto` record** (top of `VersionDtos.cs`, after the namespace)

```csharp
public sealed record VersionMetricsDto(
    double? Score,
    double? Lufs,
    double? DynamicRangeLu,
    double? Bass,
    double? Air,
    double? StereoWidth);
```

- [ ] **Step 2: Write the failing unit test**

Create `tests/Spectr.Bff.Tests/FinalJsonMetricsTests.cs`:

```csharp
using Spectr.Bff.Support;
using Xunit;

namespace Spectr.Bff.Tests;

public class FinalJsonMetricsTests
{
    private const string Sample = """
    {
      "overall_score": 87,
      "grade": "A",
      "phases": [
        { "phase": 1, "data": {
            "lufs": -9.1,
            "loudness_range_lu": 8.4,
            "low_energy": 62,
            "stereo_width": 48,
            "bands": { "bass": 70, "air": 71 }
        } },
        { "phase": 2, "data": { "bpm": 124 } }
      ]
    }
    """;

    [Fact]
    public void Read_extracts_all_six_metrics()
    {
        var m = FinalJsonMetrics.Read(Sample);
        Assert.NotNull(m);
        Assert.Equal(87, m!.Score);
        Assert.Equal(-9.1, m.Lufs);
        Assert.Equal(8.4, m.DynamicRangeLu);
        Assert.Equal(62, m.Bass);
        Assert.Equal(71, m.Air);
        Assert.Equal(48, m.StereoWidth);
    }

    [Fact]
    public void Read_falls_back_to_mix_score_when_overall_absent()
    {
        var m = FinalJsonMetrics.Read("""{ "mix_score": 73, "phases": [] }""");
        Assert.Equal(73, m!.Score);
    }

    [Fact]
    public void Read_returns_nulls_for_missing_metrics_but_nonnull_dto()
    {
        var m = FinalJsonMetrics.Read("""{ "overall_score": 50, "phases": [] }""");
        Assert.NotNull(m);
        Assert.Equal(50, m!.Score);
        Assert.Null(m.Lufs);
        Assert.Null(m.Air);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json")]
    public void Read_returns_null_for_unusable_input(string? input)
    {
        Assert.Null(FinalJsonMetrics.Read(input));
    }
}
```

- [ ] **Step 3: Run it; verify it fails**

Run: `cd components/bff && dotnet test --filter FinalJsonMetricsTests`
Expected: FAIL — `FinalJsonMetrics` does not exist.

- [ ] **Step 4: Implement the reader**

Create `src/Spectr.Bff/Support/FinalJsonMetrics.cs`:

```csharp
using System.Text.Json;
using Spectr.Bff.DTOs;

namespace Spectr.Bff.Support;

/// <summary>
/// Single source of truth for pulling the song-console metrics out of an
/// analysis <c>final_json</c> blob. The shape is: root has <c>overall_score</c>
/// (legacy alias <c>mix_score</c>); the measured values live under the phase-1
/// object in <c>phases[]</c> → <c>data</c>.
/// </summary>
public static class FinalJsonMetrics
{
    public static VersionMetricsDto? Read(string? finalJson)
    {
        if (string.IsNullOrWhiteSpace(finalJson)) return null;
        JsonDocument doc;
        try { doc = JsonDocument.Parse(finalJson); }
        catch (JsonException) { return null; }

        using (doc)
        {
            var root = doc.RootElement;
            var score = Num(root, "overall_score") ?? Num(root, "mix_score");

            var phase1 = FindPhaseData(root, 1);
            double? lufs = null, dr = null, bass = null, air = null, width = null;
            if (phase1 is { } p)
            {
                lufs = Num(p, "lufs");
                dr = Num(p, "loudness_range_lu");
                bass = Num(p, "low_energy");
                width = Num(p, "stereo_width");
                if (p.TryGetProperty("bands", out var bands) &&
                    bands.ValueKind == JsonValueKind.Object)
                {
                    air = Num(bands, "air");
                }
            }
            return new VersionMetricsDto(score, lufs, dr, bass, air, width);
        }
    }

    private static double? Num(JsonElement obj, string key) =>
        obj.ValueKind == JsonValueKind.Object &&
        obj.TryGetProperty(key, out var v) &&
        v.ValueKind == JsonValueKind.Number
            ? v.GetDouble()
            : null;

    private static JsonElement? FindPhaseData(JsonElement root, int phase)
    {
        if (!root.TryGetProperty("phases", out var phases) ||
            phases.ValueKind != JsonValueKind.Array) return null;
        foreach (var ph in phases.EnumerateArray())
        {
            if (ph.TryGetProperty("phase", out var pn) &&
                pn.ValueKind == JsonValueKind.Number && pn.GetInt32() == phase &&
                ph.TryGetProperty("data", out var data) &&
                data.ValueKind == JsonValueKind.Object)
            {
                return data;
            }
        }
        return null;
    }
}
```

- [ ] **Step 5: Run tests; verify pass**

Run: `cd components/bff && dotnet test --filter FinalJsonMetricsTests`
Expected: PASS (7 cases).

- [ ] **Step 6: Commit**

```bash
git add components/bff/src/Spectr.Bff/Support/FinalJsonMetrics.cs \
        components/bff/src/Spectr.Bff/DTOs/VersionDtos.cs \
        components/bff/tests/Spectr.Bff.Tests/FinalJsonMetricsTests.cs
git commit -m "feat(bff): shared final_json metrics reader for song console"
```

---

## Task 2: Surface per-version metrics on the song payload (Change A)

**Files:**
- Modify: `src/Spectr.Bff/DTOs/VersionDtos.cs` (add `LatestResult` + `PersonalScore` to `VersionDto`)
- Modify: `src/Spectr.Bff/Endpoints/SongEndpoints.cs:121-149` (`GetById`) + `ToVersionDto`
- Create: `tests/Spectr.Bff.Tests/SongVersionMetricsTests.cs`

**Interfaces:**
- Consumes: `VersionMetricsDto`, `FinalJsonMetrics.Read` (Task 1).
- Produces: `VersionDto.LatestResult` (`VersionMetricsDto?`) populated from each version's
  newest `Analysis` by `VersionId`. `VersionDto.PersonalScore` (`int?`) is added here but
  stays null until Task 3 wires it (keeps the record stable for the frontend).

- [ ] **Step 1: Extend `VersionDto`** (`VersionDtos.cs`)

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
    int? PersonalScore = null);
```

- [ ] **Step 2: Write the failing endpoint test**

Create `tests/Spectr.Bff.Tests/SongVersionMetricsTests.cs`. It registers a user, seeds a
song+version+analysis directly via `AppDbContext`, then GETs the song and asserts the
version carries metrics. (Helper `SeedAsync` uses the factory's DI scope.)

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

public sealed class SongVersionMetricsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task Song_versions_carry_latest_metrics()
    {
        if (!await TestDb.Reachable(_factory)) return;
        var client = _factory.CreateClient();

        var (userId, token) = await TestAuth.RegisterAsync(client);
        var songId = Guid.NewGuid();
        var versionId = Guid.NewGuid();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Songs.Add(new Song { Id = songId, UserId = userId, Name = "Midnight Drive" });
            db.SongVersions.Add(new SongVersion
            {
                Id = versionId, SongId = songId, VersionNumber = 1,
                Label = "demo", IsCurrent = true, FilePath = "x.wav",
            });
            db.Analyses.Add(new Analysis
            {
                Id = Guid.NewGuid(), JobId = Guid.NewGuid(), UserId = userId,
                SongId = songId, VersionId = versionId,
                FinalJson = """
                { "overall_score": 87, "phases": [ { "phase": 1, "data": {
                  "lufs": -9.1, "loudness_range_lu": 8.4, "low_energy": 62,
                  "stereo_width": 48, "bands": { "air": 71 } } } ] }
                """,
            });
            await db.SaveChangesAsync();
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var song = await client.GetFromJsonAsync<SongDto>($"/api/songs/{songId}");

        Assert.NotNull(song);
        var v = Assert.Single(song!.Versions);
        Assert.NotNull(v.LatestResult);
        Assert.Equal(87, v.LatestResult!.Score);
        Assert.Equal(-9.1, v.LatestResult.Lufs);
        Assert.Equal(8.4, v.LatestResult.DynamicRangeLu);
        Assert.Equal(71, v.LatestResult.Air);
        Assert.Equal(48, v.LatestResult.StereoWidth);
    }
}
```

> Add two tiny shared test helpers if they don't exist yet (create `TestSupport.cs`):
> `TestDb.Reachable(factory)` (the `CanConnectAsync` gate from `AuthEndpointsTests`) and
> `TestAuth.RegisterAsync(client)` → `(Guid userId, string token)` that POSTs
> `/api/auth/register` and reads back the access token + decodes the user id from
> `GET /api/auth/me`. Mirror the existing `AuthEndpointsTests` calls exactly.

- [ ] **Step 3: Run it; verify it fails**

Run: `cd components/bff && dotnet test --filter SongVersionMetricsTests`
Expected: FAIL — `v.LatestResult` is null (endpoint doesn't populate it yet).

- [ ] **Step 4: Batch-load per-version analyses in `GetById`**

In `SongEndpoints.GetById`, after loading `versions`, add a per-version latest-analysis
lookup (newest `CreatedAt` per `VersionId`) and pass it into the version mapping:

```csharp
var versionIds = versions.Select(v => v.Id).ToList();
var perVersionLatest = await db.Analyses.AsNoTracking()
    .Where(a => a.UserId == userId && a.VersionId != null && versionIds.Contains(a.VersionId!.Value))
    .GroupBy(a => a.VersionId!.Value)
    .Select(g => g.OrderByDescending(a => a.CreatedAt).First())
    .ToListAsync(ct);
var metricsByVersion = perVersionLatest.ToDictionary(
    a => a.VersionId!.Value,
    a => FinalJsonMetrics.Read(a.FinalJson));

return Results.Ok(BuildSongDto(
    song,
    versions.Select(v => ToVersionDto(v, metricsByVersion.GetValueOrDefault(v.Id), null)).ToList(),
    latest is null ? null : ToSummaryDto(latest),
    tags.Select(t => new TagDto(t.Id, t.Name, t.IsPublic)).ToList()));
```

- [ ] **Step 5: Update `ToVersionDto` to accept the metrics + (future) personal score**

Replace the existing `ToVersionDto(SongVersion v)` with:

```csharp
internal static VersionDto ToVersionDto(SongVersion v, VersionMetricsDto? metrics, int? personalScore)
    => new(
        v.Id, v.SongId, v.VersionNumber, v.Label, v.IsCurrent, v.FilePath, v.CreatedAt,
        v.AlsFilePath, v.ReferencePath, metrics, personalScore);
```

> Any OTHER caller of `ToVersionDto(v)` (e.g. the songs `List` endpoint) should pass
> `ToVersionDto(v, null, null)` — the list view doesn't need per-version metrics. Grep
> `ToVersionDto(` and fix each call site so the build compiles. Add `using Spectr.Bff.Support;`
> to `SongEndpoints.cs`.

- [ ] **Step 6: Run tests; verify pass**

Run: `cd components/bff && dotnet test --filter SongVersionMetricsTests`
Expected: PASS (skips clean if Postgres is down).

- [ ] **Step 7: Commit**

```bash
git add components/bff/src/Spectr.Bff/DTOs/VersionDtos.cs \
        components/bff/src/Spectr.Bff/Endpoints/SongEndpoints.cs \
        components/bff/tests/Spectr.Bff.Tests/
git commit -m "feat(bff): per-version analysis metrics on the song payload (Change A)"
```

---

## Task 3: Personal score — per-user × per-version (Change B)

**Files:**
- Create: `src/Spectr.Data/Entities/VersionUserRating.cs`
- Modify: `src/Spectr.Data/AppDbContext.cs` (DbSet + unique index)
- Modify: `src/Spectr.Bff/Endpoints/VersionEndpoints.cs` (`PUT`/`DELETE /rating`)
- Modify: `src/Spectr.Bff/Endpoints/SongEndpoints.cs` (fold caller's rating into `GetById`)
- Create: `tests/Spectr.Bff.Tests/PersonalScoreTests.cs`
- Migration: `AddVersionUserRatings`

**Interfaces:**
- Produces: `PUT /api/versions/{id}/rating` body `{ "score": 0..100 }` → 200; `DELETE
  /api/versions/{id}/rating` → 204; the caller's score appears on `VersionDto.PersonalScore`.

- [ ] **Step 1: Create the entity**

`src/Spectr.Data/Entities/VersionUserRating.cs`:

```csharp
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("version_user_ratings")]
public sealed class VersionUserRating
{
    [Column("id")] public Guid Id { get; set; } = Guid.NewGuid();
    [Column("user_id")] public Guid UserId { get; set; }
    [Column("version_id")] public Guid VersionId { get; set; }
    [Column("score")] public int Score { get; set; }            // 0..100
    [Column("updated_at")] public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
```

- [ ] **Step 2: Register DbSet + unique index** (`AppDbContext.cs`)

Add the DbSet near the other library sets:

```csharp
public DbSet<VersionUserRating> VersionUserRatings => Set<VersionUserRating>();
```

In `OnModelCreating` (near the other index declarations):

```csharp
builder.Entity<VersionUserRating>()
    .HasIndex(r => new { r.UserId, r.VersionId }).IsUnique();
```

- [ ] **Step 3: Create the migration**

Run: `cd components/bff && dotnet ef migrations add AddVersionUserRatings --project src/Spectr.Data --startup-project src/Spectr.Bff`
Expected: a new `*_AddVersionUserRatings.cs` creating `version_user_ratings` + the unique index. No manual SQL needed (the unique index is fluently expressible).

- [ ] **Step 4: Write the failing endpoint test**

`tests/Spectr.Bff.Tests/PersonalScoreTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Mvc.Testing;
using Spectr.Bff.DTOs;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class PersonalScoreTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task Rating_upsert_then_clear_roundtrips_on_song_payload()
    {
        if (!await TestDb.Reachable(_factory)) return;
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var (songId, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        var put = await client.PutAsJsonAsync($"/api/versions/{versionId}/rating", new { score = 90 });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var song = await client.GetFromJsonAsync<SongDto>($"/api/songs/{songId}");
        Assert.Equal(90, song!.Versions[0].PersonalScore);

        // upsert (not duplicate)
        await client.PutAsJsonAsync($"/api/versions/{versionId}/rating", new { score = 75 });
        song = await client.GetFromJsonAsync<SongDto>($"/api/songs/{songId}");
        Assert.Equal(75, song!.Versions[0].PersonalScore);

        var del = await client.DeleteAsync($"/api/versions/{versionId}/rating");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        song = await client.GetFromJsonAsync<SongDto>($"/api/songs/{songId}");
        Assert.Null(song!.Versions[0].PersonalScore);
    }

    [Fact]
    public async Task Rating_rejects_out_of_range()
    {
        if (!await TestDb.Reachable(_factory)) return;
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        var bad = await client.PutAsJsonAsync($"/api/versions/{versionId}/rating", new { score = 150 });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }
}
```

> Add `TestSeed.SongWithVersionAsync(factory, userId)` to `TestSupport.cs` (seeds a Song +
> one SongVersion via a DI scope, returns their ids) — extracted from Task 2's inline seed.

- [ ] **Step 5: Run it; verify it fails**

Run: `cd components/bff && dotnet test --filter PersonalScoreTests`
Expected: FAIL — `404` (no rating route yet).

- [ ] **Step 6: Add the endpoints** (`VersionEndpoints.cs`)

Add to the version route group (it already `RequireAuthorization()`s):

```csharp
g.MapPut("/{versionId:guid}/rating", SetRating);
g.MapDelete("/{versionId:guid}/rating", ClearRating);
```

```csharp
public sealed record SetRatingRequest(int Score);

private static async Task<IResult> SetRating(
    Guid versionId, SetRatingRequest body, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
{
    if (body.Score is < 0 or > 100)
        return Results.BadRequest(new { error = "score must be 0..100" });
    var userId = currentUser.UserId();

    // Ownership: the version must belong to the caller (via its song).
    var owns = await db.SongVersions.AsNoTracking()
        .AnyAsync(v => v.Id == versionId && db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId), ct);
    if (!owns) return Results.NotFound();

    var row = await db.VersionUserRatings
        .FirstOrDefaultAsync(r => r.UserId == userId && r.VersionId == versionId, ct);
    if (row is null)
        db.VersionUserRatings.Add(new VersionUserRating { UserId = userId, VersionId = versionId, Score = body.Score });
    else { row.Score = body.Score; row.UpdatedAt = DateTimeOffset.UtcNow; }
    await db.SaveChangesAsync(ct);
    return Results.Ok(new { score = body.Score });
}

private static async Task<IResult> ClearRating(
    Guid versionId, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
{
    var userId = currentUser.UserId();
    var row = await db.VersionUserRatings
        .FirstOrDefaultAsync(r => r.UserId == userId && r.VersionId == versionId, ct);
    if (row is not null) { db.VersionUserRatings.Remove(row); await db.SaveChangesAsync(ct); }
    return Results.NoContent();
}
```

- [ ] **Step 7: Fold the caller's rating into `GetById`**

In `SongEndpoints.GetById`, load the caller's ratings for these versions and pass into the map:

```csharp
var ratingByVersion = await db.VersionUserRatings.AsNoTracking()
    .Where(r => r.UserId == userId && versionIds.Contains(r.VersionId))
    .ToDictionaryAsync(r => r.VersionId, r => (int?)r.Score, ct);
// ...
versions.Select(v => ToVersionDto(
    v, metricsByVersion.GetValueOrDefault(v.Id), ratingByVersion.GetValueOrDefault(v.Id))).ToList(),
```

- [ ] **Step 8: Run tests; verify pass**

Run: `cd components/bff && dotnet test --filter PersonalScoreTests`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add components/bff/src/Spectr.Data components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs \
        components/bff/src/Spectr.Bff/Endpoints/SongEndpoints.cs components/bff/tests/
git commit -m "feat(bff): per-user per-version personal score (Change B)"
```

---

## Task 4: Compare notes — per-user × per-version-pair (Change C)

**Files:**
- Create: `src/Spectr.Data/Entities/VersionCompareNote.cs`
- Modify: `src/Spectr.Data/AppDbContext.cs` (DbSet + unique index)
- Modify: `src/Spectr.Bff/Endpoints/CompareEndpoints.cs` (`GET`/`PUT`/`DELETE /api/compare/notes`)
- Create: `tests/Spectr.Bff.Tests/CompareNotesTests.cs`
- Migration: `AddVersionCompareNotes`

**Interfaces:**
- Produces: `GET /api/compare/notes?versionA=&versionB=` → `{ body: string }` (empty string
  when none); `PUT` same query + body `{ "body": "..." }` → 200; `DELETE` → 204. The stored
  pair is **normalized** (sorted by Guid) so A↔B map to one row.

- [ ] **Step 1: Create the entity**

`src/Spectr.Data/Entities/VersionCompareNote.cs`:

```csharp
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("version_compare_notes")]
public sealed class VersionCompareNote
{
    [Column("id")] public Guid Id { get; set; } = Guid.NewGuid();
    [Column("user_id")] public Guid UserId { get; set; }
    [Column("song_id")] public Guid SongId { get; set; }
    // Normalized: version_a_id < version_b_id (Guid ordinal) so A↔B is one row.
    [Column("version_a_id")] public Guid VersionAId { get; set; }
    [Column("version_b_id")] public Guid VersionBId { get; set; }
    [Column("body")] public string Body { get; set; } = "";
    [Column("updated_at")] public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
```

- [ ] **Step 2: Register DbSet + unique index** (`AppDbContext.cs`)

```csharp
public DbSet<VersionCompareNote> VersionCompareNotes => Set<VersionCompareNote>();
```

```csharp
builder.Entity<VersionCompareNote>()
    .HasIndex(n => new { n.UserId, n.VersionAId, n.VersionBId }).IsUnique();
```

- [ ] **Step 3: Create the migration**

Run: `cd components/bff && dotnet ef migrations add AddVersionCompareNotes --project src/Spectr.Data --startup-project src/Spectr.Bff`

- [ ] **Step 4: Write the failing endpoint test**

`tests/Spectr.Bff.Tests/CompareNotesTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class CompareNotesTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;
    private sealed record NoteDto(string Body);

    [Fact]
    public async Task Notes_upsert_read_and_pair_is_order_independent()
    {
        if (!await TestDb.Reachable(_factory)) return;
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, a, b) = await TestSeed.SongWithTwoVersionsAsync(_factory, userId);

        var put = await client.PutAsJsonAsync($"/api/compare/notes?versionA={a}&versionB={b}",
            new { body = "fuller low end, vox still harsh" });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        // Reading with the pair REVERSED returns the same note (normalized pair).
        var got = await client.GetFromJsonAsync<NoteDto>($"/api/compare/notes?versionA={b}&versionB={a}");
        Assert.Equal("fuller low end, vox still harsh", got!.Body);

        // Upsert reversed → still one row, updated.
        await client.PutAsJsonAsync($"/api/compare/notes?versionA={b}&versionB={a}", new { body = "better" });
        got = await client.GetFromJsonAsync<NoteDto>($"/api/compare/notes?versionA={a}&versionB={b}");
        Assert.Equal("better", got!.Body);

        var del = await client.DeleteAsync($"/api/compare/notes?versionA={a}&versionB={b}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        got = await client.GetFromJsonAsync<NoteDto>($"/api/compare/notes?versionA={a}&versionB={b}");
        Assert.Equal("", got!.Body);
    }
}
```

> Add `TestSeed.SongWithTwoVersionsAsync(factory, userId)` → `(songId, versionAId, versionBId)`
> to `TestSupport.cs` (two versions under one song).

- [ ] **Step 5: Run it; verify it fails**

Run: `cd components/bff && dotnet test --filter CompareNotesTests`
Expected: FAIL — `404`.

- [ ] **Step 6: Add the endpoints** (`CompareEndpoints.cs`)

In the compare route group:

```csharp
g.MapGet("/notes", GetNotes);
g.MapPut("/notes", PutNotes);
g.MapDelete("/notes", DeleteNotes);
```

```csharp
public sealed record CompareNoteBody(string Body);

// Normalize the pair so A↔B collapse to one row; also returns the owning song id.
private static (Guid lo, Guid hi) Norm(Guid a, Guid b) =>
    a.CompareTo(b) <= 0 ? (a, b) : (b, a);

private static async Task<IResult> GetNotes(
    Guid versionA, Guid versionB, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
{
    var userId = currentUser.UserId();
    var (lo, hi) = Norm(versionA, versionB);
    var row = await db.VersionCompareNotes.AsNoTracking()
        .FirstOrDefaultAsync(n => n.UserId == userId && n.VersionAId == lo && n.VersionBId == hi, ct);
    return Results.Ok(new CompareNoteBody(row?.Body ?? ""));
}

private static async Task<IResult> PutNotes(
    Guid versionA, Guid versionB, CompareNoteBody input,
    ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
{
    var userId = currentUser.UserId();
    var (lo, hi) = Norm(versionA, versionB);

    // Ownership + resolve song id from version lo.
    var songId = await db.SongVersions.AsNoTracking()
        .Where(v => v.Id == lo && db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId))
        .Select(v => (Guid?)v.SongId).FirstOrDefaultAsync(ct);
    if (songId is null) return Results.NotFound();

    var row = await db.VersionCompareNotes
        .FirstOrDefaultAsync(n => n.UserId == userId && n.VersionAId == lo && n.VersionBId == hi, ct);
    if (row is null)
        db.VersionCompareNotes.Add(new VersionCompareNote
        {
            UserId = userId, SongId = songId.Value, VersionAId = lo, VersionBId = hi, Body = input.Body,
        });
    else { row.Body = input.Body; row.UpdatedAt = DateTimeOffset.UtcNow; }
    await db.SaveChangesAsync(ct);
    return Results.Ok(new CompareNoteBody(input.Body));
}

private static async Task<IResult> DeleteNotes(
    Guid versionA, Guid versionB, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
{
    var userId = currentUser.UserId();
    var (lo, hi) = Norm(versionA, versionB);
    var row = await db.VersionCompareNotes
        .FirstOrDefaultAsync(n => n.UserId == userId && n.VersionAId == lo && n.VersionBId == hi, ct);
    if (row is not null) { db.VersionCompareNotes.Remove(row); await db.SaveChangesAsync(ct); }
    return Results.NoContent();
}
```

- [ ] **Step 7: Run tests; verify pass**

Run: `cd components/bff && dotnet test --filter CompareNotesTests`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/bff/src/Spectr.Data components/bff/src/Spectr.Bff/Endpoints/CompareEndpoints.cs \
        components/bff/tests/
git commit -m "feat(bff): per-user per-pair compare notes (Change C)"
```

---

## Task 5: Apply migrations + full gate

- [ ] **Step 1: Apply both migrations to the dev DB**

Run: `cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff`
Expected: `version_user_ratings` + `version_compare_notes` tables created.

- [ ] **Step 2: Full build + test**

Run: `cd components/bff && dotnet build && dotnet test`
Expected: build clean (no audit failures); all tests pass (DB-gated ones skip if Postgres down).

- [ ] **Step 3: Commit any migration-designer changes** (if `dotnet ef` regenerated the model snapshot)

```bash
git add components/bff/src/Spectr.Data/Migrations
git commit -m "chore(bff): apply song-console migrations"
```

---

## Out of scope (this plan)

- **Game-plan read path (spec §3.7 / Change E):** NOT a BFF change. The per-version game
  plan is not server-persisted (the proper `game_plans` table is PRP-5, not started); the
  Listen Plan tab writes per-version plans to **localStorage** (`listenFixes:{versionId}`).
  The song page's game-plan marker + view is therefore a **frontend, local-interim**
  feature (Plan 2), to be swapped to a server source when PRP-5 ships. No BFF work here.
- All frontend work (the `features/song/` build) — Plan 2.

## Self-review notes (coverage)

Change A → Tasks 1–2. Change B → Task 3. Change C → Task 4. Change D (no grade on new
DTOs) → honored: `VersionMetricsDto` has no grade field. Change E → explicitly out of scope
(frontend interim, Plan 2). Migrations + gate → Task 5.
