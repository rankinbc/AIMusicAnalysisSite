# Guest Demo Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click (or `/demo`) drops an anonymous visitor into the real app as an isolated, purgeable guest account with a seeded analyzed song, a live coach, one upload, and hard cost/abuse limits.

**Architecture:** A guest is a real `users` row (`is_guest`), minted by a fail-closed `POST /api/auth/demo`, fenced by a default-deny endpoint filter on the `/api` group, seeded from a track-agnostic storage snapshot by the existing `DemoSeeder`, metered on its own LLM lane in the worker, and torn down by the nightly retention sweep. The SPA adds `/demo`, a guest banner and an upgrade dialog.

**Tech Stack:** ASP.NET Core .NET 10 minimal API + EF Core 10/Npgsql + xUnit (`components/bff`); Python dramatiq worker + pytest (`components/worker`); SQLAlchemy mirror (`components/shared`); React 19 + TanStack Router/Query + vitest (`components/frontend-spectr-v2`).

**Spec:** `PRPs/guest-demo-sandbox.md` (binding; D1–D11, §4 flags, §5 contracts, §6 snapshot format).

## Global Constraints

- Work ONLY in `C:/Users/badmin/projects/spectr-solo` (branch `solo`). Never touch `C:/Users/badmin/projects/AIMusicAnalysisSite` or `master`.
- Never stage `features/results/AnalysisCompleteModal.tsx`/`.module.css` (another session's uncommitted work).
- Never edit `components/bff/tests/Spectr.Bff.Tests/NoSocialSurfaceTests.cs`. The ONLY permitted edit to `src/routes/__tests__/no-social-surface.test.ts` is adding the single line for `demo.tsx` to `ALLOWED_ROUTE_FILES` (owner-approved 2026-09-20).
- Banned identifiers/phrases in shipped source: `isPublic`, `queueDepth|jobs? waiting|jobs? queued`, `shareToken`; BFF shell copy may not match `revocable|opt-in share|share links are|publish your|public profile|follower|live room|listening room|invite` (note the bare substring `invite`). UI copy never says "public", "shared", "people", "community", and never describes load ("busy", "too many visitors").
- The repo is PUBLIC: no real audio, snapshot fixture built from real audio, email, or secret in git. Tests use a synthetic snapshot fixture.
- Gates — run ALL of them after ANY edit, foreground only: BFF `dotnet build && dotnet test --artifacts-path <scratch>` with `ConnectionStrings__Postgres` (Host=127.0.0.1), `Redis__ConnectionString=127.0.0.1:6379` (a wedged wslrelay black-holes `localhost`); worker `pytest -q components/worker/tests/` (5 accepted env failures); frontend `npx tsc -b`, `npm run lint`, `npm run lint:css`, `npm run lint:focus`, `npm run build`, `npx vitest run`.
- Schema: EF migration + mirror column in `components/shared/aimusic_shared/models.py`. Flags: idempotent `INSERT … ON CONFLICT (name) DO NOTHING` migration. Errors: `Endpoints/ErrorEnvelope.cs`.
- No file over ~500 lines. `AuthEndpoints.cs` (781), `VersionEndpoints.cs` (1455), `Program.cs` (645), `UnifiedUploadDialog.tsx` (1249), `ListenRackPage.tsx` (512) are already over — new code goes in new files; edits there are the few lines stated.
- Frontend tests outside `features/listen-rack/**` and `features/song/**` need the first-line docblock `// @vitest-environment jsdom`. `beforeEach(() => { mock.mockReset(); })` — braces mandatory (vitest calls a returned function as teardown).
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; stage by path; never `--no-verify`; never push; you never dispatch subagents.

---

### Task D1: Schema + flags

**Files:** Modify `components/bff/src/Spectr.Data/Entities/User.cs`, `components/shared/aimusic_shared/models.py`. Create migrations `AddGuestUsers`, `SeedDemoFlags`. Test: `components/bff/tests/Spectr.Bff.Tests/GuestSchemaTests.cs`, `components/shared/tests/test_guest_user_mirror.py`.

**Interfaces — Produces:** `User.IsGuest: bool` (`is_guest`), `User.GuestExpiresAt: DateTimeOffset?` (`guest_expires_at`), `User.GuestDeviceId: string?` (`guest_device_id`, max 26); Python `User.is_guest / guest_expires_at / guest_device_id`; the nine flags of spec §4.

- [ ] **1. Failing tests**

```csharp
// GuestSchemaTests.cs
using Microsoft.AspNetCore.Mvc.Testing; using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection; using Spectr.Data; using Xunit;
namespace Spectr.Bff.Tests;
public sealed class GuestSchemaTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [SkippableFact]
    public async Task A_Registered_User_Is_Not_A_Guest()
    {
        await TestDb.RequireAsync(factory);
        var (userId, _) = await TestAuth.RegisterAsync(factory.CreateClient());
        using var scope = factory.Services.CreateScope();
        var u = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().SingleAsync(x => x.Id == userId);
        Assert.False(u.IsGuest); Assert.Null(u.GuestExpiresAt); Assert.Null(u.GuestDeviceId);
    }
    [SkippableTheory]
    [InlineData("demo_enabled")] [InlineData("guest_ttl_hours")] [InlineData("demo_guests_per_ip_hourly")]
    [InlineData("demo_guests_daily_cap")] [InlineData("guest_uploads_max")] [InlineData("guest_analyses_per_hour")]
    [InlineData("coach_guest_messages")] [InlineData("llm_budget_guest_usd")] [InlineData("anon_sample_per_hour_global")]
    public async Task Demo_Flag_Is_Seeded(string name)
    {
        await TestDb.RequireAsync(factory);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.True(await db.FeatureFlags.AsNoTracking().AnyAsync(f => f.Name == name), $"flag {name} missing");
    }
}
```

```python
# components/shared/tests/test_guest_user_mirror.py
from aimusic_shared.models import User
def test_user_mirror_carries_the_guest_columns():
    cols = User.__table__.c
    assert cols["is_guest"].nullable is False
    assert cols["guest_expires_at"].nullable is True
    assert cols["guest_device_id"].type.length == 26
```

- [ ] **2. Run** `dotnet test --filter GuestSchemaTests` and `pytest -q components/shared/tests/test_guest_user_mirror.py` → RED (compile error / KeyError).
- [ ] **3. Implement.** `User.cs`: three properties with `[Column("is_guest")]`, `[Column("guest_expires_at")]`, `[Column("guest_device_id"), MaxLength(26)]`. `cd components/bff && dotnet ef migrations add AddGuestUsers --project src/Spectr.Data --startup-project src/Spectr.Bff`, then append to `Up()`:
  `migrationBuilder.Sql("CREATE INDEX ix_users_guest_expires ON users (guest_expires_at) WHERE is_guest; CREATE INDEX ix_users_guest_device ON users (guest_device_id) WHERE is_guest;");` and the matching `DROP INDEX IF EXISTS` pair at the top of `Down()`. Then `dotnet ef migrations add SeedDemoFlags …` and fill `Up()` with one `INSERT INTO feature_flags (name, value, updated_at) VALUES (…, now()) ON CONFLICT (name) DO NOTHING;` per flag — values: `demo_enabled=false`, `guest_ttl_hours=72`, `demo_guests_per_ip_hourly=5`, `demo_guests_daily_cap=300`, `guest_uploads_max=1`, `guest_analyses_per_hour=10`, `coach_guest_messages=20`, `llm_budget_guest_usd=5`, `anon_sample_per_hour_global=20`; `Down()` deletes those nine names (pattern: `20260723180200_AddCreditsEnabledFlag.cs`). Mirror in `models.py` after `banned_at` (`:77`): `is_guest: Mapped[bool] = mapped_column("is_guest", Boolean, nullable=False, default=False)`, `guest_expires_at: Mapped[Optional[datetime]] = mapped_column("guest_expires_at", DateTime(timezone=True), nullable=True)`, `guest_device_id: Mapped[Optional[str]] = mapped_column("guest_device_id", String(26), nullable=True)`. Apply: `dotnet ef database update …`.
- [ ] **4. Run** both → GREEN. **5. All gates. 6. Commit** `feat(bff): guest user columns + demo feature flags`.

---

### Task D2: Worker — shared demo keys + guest LLM lane

**Files:** Modify `components/worker/app/retention_actor.py` (`:94,:121`), `account_deletion_actor.py` (`:44,:80`), `llm/budget.py`, `llm/settings.py`, `llm/gateway.py:289`, `llm/streaming.py:150`, `tests/llm/conftest.py`. Create `app/llm/lane.py`, `tests/test_shared_keys.py`, `tests/llm/test_lane.py`; append to `tests/llm/test_budget.py`.

**Interfaces — Produces:** `retention_actor.is_shared_key(key: str | None) -> bool`; `lane.GUEST_TIER = "guest"`, `lane.resolve_lane(user_id, default: str | None) -> str | None`, `lane.reset_lane_cache()`, `lane._lookup_is_guest(user_id) -> bool`; `LlmSettings.llm_budget_guest_usd: Decimal`. **Consumes:** `users.is_guest` (D1).

- [ ] **1. Failing tests**

```python
# tests/test_shared_keys.py
from types import SimpleNamespace
from app.account_deletion_actor import _collect_storage_keys
from app.retention_actor import _version_keys, is_shared_key
def _v(path): return SimpleNamespace(file_path=path, reference_path=None, als_file_path=None, stem_paths=None, stem_paths_raw=None)
def test_everything_under_audio_demo_is_shared():
    assert is_shared_key("audio/demo/source.wav")
    assert is_shared_key("audio/demo/snapshot/source.flac")
    assert is_shared_key("audio/demo/snapshot/spectrogram.webp")
def test_user_objects_and_lookalikes_are_not_shared():
    assert not is_shared_key("audio/upload/j1/source.wav")
    assert not is_shared_key("audio/demolition/x.wav")   # prefix must end at the slash
    assert not is_shared_key(None) and not is_shared_key("")
def test_version_keys_never_returns_snapshot_audio():
    assert _version_keys(_v("audio/demo/snapshot/source.flac")) == []
    assert _version_keys(_v("audio/upload/j1/source.wav")) == ["audio/upload/j1/source.wav"]
class _Result:
    def __init__(self, rows): self._rows = rows
    def all(self): return self._rows
class _Session:
    def __init__(self, batches): self._batches = list(batches)
    def execute(self, *_a, **_k): return _Result(self._batches.pop(0))
def test_account_deletion_never_collects_demo_audio_or_images():
    analysis = SimpleNamespace(job_id="j1", spectrogram_image_path="audio/demo/snapshot/spectrogram.webp",
                               waveform_image_path=None, waveform_peaks_path="audio/demo/snapshot/peaks.json")
    s = _Session([[_v("audio/demo/snapshot/source.flac"), _v("audio/upload/j1/source.wav")], [analysis], []])
    assert _collect_storage_keys(s, "uid") == ["audio/upload/j1/source.wav", "reports/j1.json"]
```

```python
# tests/llm/test_lane.py
import pytest
from app.llm import lane
def test_no_user_keeps_the_default(): assert lane.resolve_lane(None, "free") == "free"
def test_guest_user_rides_the_guest_lane(monkeypatch):
    monkeypatch.setattr(lane, "_lookup_is_guest", lambda uid: True)
    assert lane.resolve_lane("u1", "pro") == lane.GUEST_TIER
def test_real_user_keeps_the_default(monkeypatch):
    monkeypatch.setattr(lane, "_lookup_is_guest", lambda uid: False)
    assert lane.resolve_lane("u1", "pro") == "pro"
def test_lookup_failure_fails_open_to_the_default(monkeypatch):
    def boom(uid): raise RuntimeError("db down")
    monkeypatch.setattr(lane, "_lookup_is_guest", boom)
    assert lane.resolve_lane("u1", "free") == "free"
def test_lookup_is_cached_per_user(monkeypatch):
    calls = []
    monkeypatch.setattr(lane, "_lookup_is_guest", lambda uid: calls.append(uid) or True)
    lane.resolve_lane("u1", "free"); lane.resolve_lane("u1", "free")
    assert calls == ["u1"]
```

```python
# append to tests/llm/test_budget.py
def _spend(by_tier, total): return lambda tier, *, include_all_tiers=False: total if include_all_tiers else by_tier.get(tier, Decimal("0"))
def test_guest_lane_trips_on_its_own_ceiling(configure, monkeypatch):
    configure(llm_budget_guest_usd=Decimal("5.00"), llm_budget_global_usd=Decimal("1000.00"))
    monkeypatch.setattr(budget, "_aggregate_tier_spend", _spend({"guest": Decimal("5.00")}, Decimal("5.00")))
    with pytest.raises(LlmBudgetExceeded) as exc:
        budget.check_budget(tier="guest", purpose="coach", user_id="u")
    assert exc.value.reason == DEGRADATION_REASON_TIER_BUDGET
def test_guest_lane_is_not_checked_against_the_global_cap(configure, monkeypatch):
    configure(llm_budget_guest_usd=Decimal("5.00"), llm_budget_global_usd=Decimal("10.00"))
    monkeypatch.setattr(budget, "_aggregate_tier_spend", _spend({"guest": Decimal("1.00")}, Decimal("999.00")))
    budget.check_budget(tier="guest", purpose="coach", user_id="u")  # no raise
def test_guest_spend_never_counts_against_real_users(configure, monkeypatch):
    configure(llm_budget_pro_usd=Decimal("100.00"), llm_budget_global_usd=Decimal("10.00"))
    monkeypatch.setattr(budget, "_aggregate_tier_spend",
                        _spend({"guest": Decimal("4.00"), "pro": Decimal("1.00")}, Decimal("12.00")))
    budget.check_budget(tier="pro", purpose="coach", user_id="u")  # 12 - 4 = 8 < 10 → no raise
def test_real_spend_still_trips_the_global_cap(configure, monkeypatch):
    configure(llm_budget_pro_usd=Decimal("100.00"), llm_budget_global_usd=Decimal("10.00"))
    monkeypatch.setattr(budget, "_aggregate_tier_spend",
                        _spend({"guest": Decimal("4.00"), "pro": Decimal("1.00")}, Decimal("14.00")))
    with pytest.raises(LlmBudgetExceeded) as exc:
        budget.check_budget(tier="pro", purpose="coach", user_id="u")
    assert exc.value.reason == DEGRADATION_REASON_GLOBAL_BUDGET
def test_guest_ceiling_honours_the_flag_override(configure, monkeypatch):
    configure(llm_budget_guest_usd=Decimal("5.00"))
    monkeypatch.setattr(budget, "_ceiling_override",
                        lambda name: Decimal("0") if name == "llm_budget_guest_usd" else None)
    with pytest.raises(LlmBudgetExceeded):
        budget.check_budget(tier="guest", purpose="coach", user_id="u")
```

- [ ] **2. Run** the three files → RED (ImportError / AttributeError).
- [ ] **3. Implement**

```python
# retention_actor.py — replace the SHARED_STORAGE_KEYS block (:91-94)
SHARED_STORAGE_KEYS = frozenset({"audio/demo/source.wav"})
# Everything under audio/demo/ is shared (the 12.8 tone AND the demo snapshot's
# audio + images): a guest purge must never delete what every account plays.
SHARED_STORAGE_PREFIXES = ("audio/demo/",)
def is_shared_key(key: str | None) -> bool: return bool(key) and (key in SHARED_STORAGE_KEYS or key.startswith(SHARED_STORAGE_PREFIXES))
```
`_version_keys` (`:121`) and `account_deletion_actor._collect_storage_keys` (`:44` import, `:80` filter): replace `k not in SHARED_STORAGE_KEYS` with `not is_shared_key(k)`.

```python
# app/llm/lane.py
"""Which LLM budget lane a call rides. Guests (users.is_guest) get their own lane so
demo traffic can never exhaust the budget real users depend on. Fail-open: any lookup
problem keeps the caller's default tier — exactly the pre-lane behaviour."""
from __future__ import annotations
import logging, time
from typing import Any
logger = logging.getLogger(__name__)
GUEST_TIER = "guest"
_TTL_S = 60.0
_MAX = 2048
_cache: dict[str, tuple[float, bool]] = {}
def reset_lane_cache() -> None: _cache.clear()
def _lookup_is_guest(user_id: Any) -> bool:
    from sqlalchemy import text  # noqa: PLC0415 — lazy: keeps the gateway import DB-free
    from app.db_sync import SessionFactory  # noqa: PLC0415
    with SessionFactory() as s:
        return bool(s.execute(text("SELECT is_guest FROM users WHERE id = :id"), {"id": str(user_id)}).scalar())
def resolve_lane(user_id: Any | None, default: str | None) -> str | None:
    if user_id is None:
        return default
    key, now = str(user_id), time.monotonic()
    hit = _cache.get(key)
    if hit is None or now - hit[0] > _TTL_S:
        try:
            hit = (now, _lookup_is_guest(user_id))
        except Exception:
            logger.exception("lane lookup failed for %s — keeping tier=%s", key, default)
            return default
        if len(_cache) >= _MAX:
            _cache.clear()
        _cache[key] = hit
    return GUEST_TIER if hit[1] else default
```
`gateway.py:289` and `streaming.py:150`: `from . import lane as _lane` (lazy, next to the budget import) and `effective_tier = _lane.resolve_lane(user_id, tier or settings.llm_default_tier)`.
`settings.py`: `llm_budget_guest_usd: Decimal = Decimal("5.00")` beside `:54-57`, and a `"guest"` branch in `tier_ceiling` (`:76-81`).
`budget.py`: in `_tier_ceiling` add before the fallthrough
`if tier == "guest": override = _ceiling_override("llm_budget_guest_usd"); return override if override is not None else settings.llm_budget_guest_usd`; replace step 3 of `check_budget` (`:228-239`) with:
```python
    # 3. Global operator hard cap — REAL users only. The guest lane is additive: it has
    #    its own ceiling above, is excluded from this sum, and is not checked against it.
    if effective_tier == "guest":
        return
    global_spent = max(Decimal("0"),
                       _aggregate_tier_spend(effective_tier, include_all_tiers=True) - _aggregate_tier_spend("guest"))
```
(the rest of the block unchanged). `tests/llm/conftest.py` autouse fixture (`:50-57`): add `from app.llm import lane`, `lane.reset_lane_cache()` and `monkeypatch.setattr(lane, "_lookup_is_guest", lambda _uid: False)` so no LLM unit test opens a DB connection.
- [ ] **4. Run** → GREEN, plus the whole `tests/llm` + `test_budget_*` + `test_account_deletion.py` + `test_retention_sweep.py`. **5. All gates. 6. Commit** `feat(worker): shared demo storage prefix + guest LLM budget lane`.

---

### Task D3: Snapshot store + seeder

**Files:** Create `components/bff/src/Spectr.Bff/Services/DemoSnapshot.cs`. Modify `Services/DemoSeeder.cs`, `Program.cs:215` (register `DemoSnapshotStore` scoped), `tests/Spectr.Bff.Tests/TestSupport.cs:30-32`. Test: `tests/Spectr.Bff.Tests/DemoSnapshotSeedTests.cs`, `DemoSnapshotFixture.cs`.

**Interfaces — Produces:**
```csharp
public sealed record DemoSeedResult(Guid SongId, Guid VersionId, Guid JobId, bool FromSnapshot);
// DemoSeeder
public const string DemoSongPrefix = "Demo: ";
public Task<DemoSeedResult?> SeedAsync(Guid userId, CancellationToken ct = default);   // was Task
public Task<DemoSeedResult?> FindAsync(Guid userId, CancellationToken ct = default);
// DemoSnapshot.cs
public static class DemoSnapshotFormat { public const string Id = "spectr-demo-snapshot/v1"; public const string Prefix = "audio/demo/snapshot/"; public const string DefaultKey = Prefix + "snapshot.json"; }
public sealed class DemoSnapshotStore(IFileStorage storage, IMemoryCache cache, IConfiguration config, ILogger<DemoSnapshotStore> logger)
{ public Task<DemoSnapshotTemplate?> GetAsync(CancellationToken ct); public void Invalidate(); }
public sealed class DemoSnapshotTemplate { public string Title { get; } public DemoSnapshotDoc Materialize(); }
```
`DemoSnapshotDoc` = records mirroring spec §6 (`Song`, `Version`, `Analysis`, `Verdicts`, `Conversation`, `RackPresets`), JSON sub-documents typed `JsonElement`.

- [ ] **1. Failing tests**

```csharp
// DemoSnapshotFixture.cs — SYNTHETIC data only (repo is public)
namespace Spectr.Bff.Tests;
internal static class DemoSnapshotFixture
{
    public const string SourceJob = "11111111-1111-1111-1111-111111111111";
    public const string SourceVerdict = "vrd_01SOURCEAAAAAAAAAAAAAAAAAA";
    public static string Json(string audioKey) => $$"""
    { "format":"spectr-demo-snapshot/v1","exportedAt":"2026-09-20T00:00:00Z",
      "source":{"songId":"22222222-2222-2222-2222-222222222222","versionId":"33333333-3333-3333-3333-333333333333","jobId":"{{SourceJob}}","analysisId":"44444444-4444-4444-4444-444444444444"},
      "song":{"title":"Fixture Track","genreHint":"house"},
      "version":{"audioKey":"{{audioKey}}"},
      "analysis":{"finalJson":{"grade":"C","overall_score":61,"job_ref":"{{SourceJob}}"},"routingPlan":{"specialists":["low_end"]},
                  "pipelineVersion":"t","ruleEngineVersion":"t","validatorVersion":"t","promptSetVersion":"t","phaseDurations":{},
                  "stemMetrics":null,"spectrogramImageKey":null,"waveformImageKey":null,"waveformPeaksKey":null},
      "verdicts":[
        {"id":"{{SourceVerdict}}","specialist":"low_end","promptVersion":"low_end@1.0.0","model":"fixture","severity":"moderate","category":"low_end",
         "confidence":0.8,"priorityScore":90,"impact":"med","chartType":null,"headline":"Sub build-up","summary":"s","body":"b","metricLine":null,
         "whyItMatters":"w","presetName":null,"evidence":[],"fix":{"ops":[{"type":"peaking_eq","frequency_hz":45,"gain_db":-3,"q":1.2}]},
         "sources":["llm"],"problemId":null,"kind":"fault","source":"llm_identifier","dataTier":"audio_only","fixable":true,"suspected":false,
         "where":null,"refines":null,"priorityBase":60,"priorityCategoryWeight":1.3,"priorityScopeMultiplier":1.0,"scope":"full_track"},
        {"id":"vrd_01SOURCEBBBBBBBBBBBBBBBBBB","specialist":"rule_engine.true_peak","promptVersion":"rule_engine@1","model":"rule","severity":"minor","category":"loudness",
         "confidence":0.9,"priorityScore":40,"impact":"low","chartType":null,"headline":"True peak high","summary":"s","body":null,"metricLine":null,
         "whyItMatters":null,"presetName":null,"evidence":[],"fix":null,"sources":["rule_engine"],"problemId":"loudness.true_peak.0","kind":"fault",
         "source":"rule_engine","dataTier":"audio_only","fixable":true,"suspected":false,"where":null,"refines":null,
         "priorityBase":20,"priorityCategoryWeight":1.0,"priorityScopeMultiplier":1.0,"scope":"full_track"}],
      "conversation":{"messages":[
        {"role":"user","status":"complete","mode":"qa","content":"What first?","evidence":null,"refusalReason":null},
        {"role":"assistant","status":"complete","mode":"qa","content":"Tame the sub ({{SourceVerdict}}).","evidence":[{"label":"45 Hz"}],"refusalReason":null}]},
      "rackPresets":[{"name":"Fix Rack","source":"analysis","chain":{"order":["eq"],"modules":{"eq":{"enabled":true}},"masterBypass":false},"coachMeta":null}] }
    """;
}
```

```csharp
// DemoSnapshotSeedTests.cs
using System.Net.Http.Headers; using System.Text;
using Microsoft.AspNetCore.Mvc.Testing; using Microsoft.AspNetCore.TestHost; using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection; using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Services; using Spectr.Data; using Xunit;
namespace Spectr.Bff.Tests;
public sealed class DemoSnapshotSeedTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    internal sealed class RecordingQueue : IJobQueue
    {
        public readonly List<string> Tasks = [];
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default) { Tasks.Add(t); return Task.CompletedTask; }
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default) { Tasks.Add(t); return Task.CompletedTask; }
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default) { Tasks.Add(t); return Task.CompletedTask; }
    }
    private (WebApplicationFactory<Program> F, RecordingQueue Q) Build(string snapshotKey)
    {
        var q = new RecordingQueue();
        var f = factory.WithWebHostBuilder(b => { b.UseSetting("Demo:SnapshotKey", snapshotKey);
            b.ConfigureTestServices(s => { s.RemoveAll(typeof(IJobQueue)); s.AddSingleton<IJobQueue>(q); }); });
        return (f, q);
    }
    [SkippableFact]
    public async Task Registration_Seeds_From_The_Snapshot_With_Fresh_Ids_And_No_Triage()
    {
        await TestDb.RequireAsync(factory);
        var dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        var (f, q) = Build(dir + "snapshot.json");
        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.WriteAsync(dir + "source.wav", new MemoryStream(DemoSeeder.GenerateToneWav()), "audio/wav");
            await storage.WriteAsync(dir + "snapshot.json",
                new MemoryStream(Encoding.UTF8.GetBytes(DemoSnapshotFixture.Json(dir + "source.wav"))), "application/json");
        }
        try
        {
            var client = f.CreateClient();
            var (userId, token) = await TestAuth.RegisterAsync(client);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var song = await db.Songs.AsNoTracking().SingleAsync(s => s.UserId == userId);
            Assert.Equal("Demo: Fixture Track", song.Name);
            var analysis = await db.Analyses.AsNoTracking().SingleAsync(a => a.UserId == userId);
            Assert.NotEqual(Guid.Parse(DemoSnapshotFixture.SourceJob), analysis.JobId);
            Assert.Contains(analysis.JobId.ToString(), analysis.FinalJson);          // embedded id was remapped
            Assert.DoesNotContain(DemoSnapshotFixture.SourceJob, analysis.FinalJson);
            Assert.NotNull(analysis.RoutingPlan);
            var verdicts = await db.Verdicts.AsNoTracking().Where(v => v.AnalysisId == analysis.Id).ToListAsync();
            Assert.Equal(2, verdicts.Count);
            Assert.All(verdicts, v => { Assert.StartsWith("vrd_", v.Id); Assert.DoesNotContain("SOURCE", v.Id); });
            Assert.Contains(verdicts, v => v.Fix is not null && v.Fix.Contains("peaking_eq"));
            var convo = await db.Conversations.AsNoTracking().SingleAsync(c => c.UserId == userId);
            var msgs = await db.CoachMessages.AsNoTracking().Where(m => m.ConversationId == convo.Id).OrderBy(m => m.CreatedAt).ToListAsync();
            Assert.Equal(new[] { "user", "assistant" }, msgs.Select(m => m.Role));
            Assert.Contains(verdicts.Single(v => v.Specialist == "low_end").Id, msgs[1].Content); // verdict id remapped inside prose too
            Assert.Null(msgs[1].LlmCallId);
            Assert.Single(await db.RackPresets.AsNoTracking().Where(p => p.SongVersionId == analysis.VersionId).ToListAsync());
            Assert.False(await db.UsageEvents.AsNoTracking().AnyAsync(e => e.UserId == userId)); // seeded rows never meter
            var resp = await client.GetAsync($"/api/reports/{analysis.JobId}/verdicts/");
            resp.EnsureSuccessStatusCode();
            Assert.DoesNotContain(DramatiqTasks.RunTriage, q.Tasks);
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.DeleteAsync(dir + "snapshot.json"); await storage.DeleteAsync(dir + "source.wav");
        }
    }
    [SkippableFact]
    public async Task Fallback_Seed_Carries_A_Routing_Plan_So_Opening_It_Never_Pays_For_Triage()
    {
        await TestDb.RequireAsync(factory);
        var (f, q) = Build("");                                   // snapshot disabled → sine-tone fallback
        var client = f.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var scope = f.Services.CreateScope();
        var analysis = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Analyses.AsNoTracking().SingleAsync(a => a.UserId == userId);
        Assert.NotNull(analysis.RoutingPlan);
        (await client.GetAsync($"/api/reports/{analysis.JobId}/verdicts/")).EnsureSuccessStatusCode();
        Assert.DoesNotContain(DramatiqTasks.RunTriage, q.Tasks);
    }
    [SkippableFact]
    public async Task A_Corrupt_Snapshot_Falls_Back_Instead_Of_Failing_Registration()
    {
        await TestDb.RequireAsync(factory);
        var key = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/snapshot.json";
        var (f, _) = Build(key);
        using (var scope = f.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().WriteAsync(key, new MemoryStream("{not json"u8.ToArray()), "application/json");
        var (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());
        using var s2 = f.Services.CreateScope();
        var song = await s2.ServiceProvider.GetRequiredService<AppDbContext>().Songs.AsNoTracking().SingleAsync(s => s.UserId == userId);
        Assert.Equal(DemoSeeder.DemoSongName, song.Name);
        await s2.ServiceProvider.GetRequiredService<IFileStorage>().DeleteAsync(key);
    }
}
```

- [ ] **2. Run** `dotnet test --filter DemoSnapshotSeedTests` → RED.
- [ ] **3. Implement.** `TestSupport.cs`: second module initializer line `Environment.SetEnvironmentVariable("Demo__SnapshotKey", "");` (an installed dev snapshot must not change existing tests; `UseSetting` still overrides per factory).

```csharp
// DemoSnapshot.cs — the id remapping (the non-obvious part)
public sealed class DemoSnapshotTemplate
{
    private readonly string _tokenized; private readonly int _verdictCount;
    public string Title { get; }
    internal DemoSnapshotTemplate(string rawJson)
    {
        using var doc = JsonDocument.Parse(rawJson);
        var root = doc.RootElement;
        if (root.GetProperty("format").GetString() != DemoSnapshotFormat.Id) throw new JsonException("unknown snapshot format");
        Title = root.GetProperty("song").GetProperty("title").GetString() ?? "Sample";
        var text = rawJson; var src = root.GetProperty("source");
        foreach (var (prop, token) in new[] { ("songId", "§song§"), ("versionId", "§version§"), ("jobId", "§job§"), ("analysisId", "§analysis§") })
        {
            var id = src.GetProperty(prop).GetGuid();
            text = text.Replace(id.ToString("D"), token, StringComparison.OrdinalIgnoreCase)
                       .Replace(id.ToString("N"), token, StringComparison.OrdinalIgnoreCase);
        }
        var i = 0;
        foreach (var v in root.GetProperty("verdicts").EnumerateArray())
            text = text.Replace(v.GetProperty("id").GetString()!, $"§v{i++}§", StringComparison.Ordinal);
        _tokenized = text; _verdictCount = i;
    }
    /// <summary>One fresh, internally consistent copy: every id — including ids embedded in
    /// finalJson, coach prose or coachMeta — is replaced in a single pass.</summary>
    public DemoSnapshotDoc Materialize()
    {
        var sb = new StringBuilder(_tokenized)
            .Replace("§song§", Guid.NewGuid().ToString()).Replace("§version§", Guid.NewGuid().ToString())
            .Replace("§job§", Guid.NewGuid().ToString()).Replace("§analysis§", Guid.NewGuid().ToString());
        for (var i = 0; i < _verdictCount; i++) sb.Replace($"§v{i}§", "vrd_" + UlidGen.NewUlid());
        return JsonSerializer.Deserialize<DemoSnapshotDoc>(sb.ToString(), DemoSnapshotDoc.JsonOptions)
               ?? throw new JsonException("empty snapshot");
    }
}
```
`DemoSnapshotDoc` adds `Source` (the four remapped Guids) so the seeder reads the NEW ids from `doc.Source`. `DemoSnapshotStore.GetAsync`: key = `config["Demo:SnapshotKey"] ?? DemoSnapshotFormat.DefaultKey`; empty ⇒ `null`; `cache.GetOrCreateAsync("demo-snapshot:" + key, 60 s)`; missing object, missing `version.audioKey` object, or parse failure ⇒ log warning + `null` (negative result cached too). `DemoSeeder`: inject `DemoSnapshotStore`; idempotency check becomes `s.Name.StartsWith(DemoSongPrefix)`; when a template exists, `Materialize()` and add Song (`Name = DemoSongPrefix + doc.Song.Title`, existing `DemoDescription`), SongVersion (`FilePath = doc.Version.AudioKey`, `Label = "demo"`, `IsCurrent = true`), AnalysisJob (complete), Analysis (all §6 fields; image keys verbatim), Verdict rows, one Conversation + CoachMessages (`LlmCallId = null`, `CreatedAt = now + i seconds`, `CompletedAt = CreatedAt`), RackPresets — ONE `SaveChangesAsync`; return `new DemoSeedResult(…, true)`. Fallback path unchanged except `RoutingPlan = "{\"specialists\":[]}"` and returning `new DemoSeedResult(song.Id, version.Id, job.Id, false)`; the catch block returns `null`. `FindAsync`: newest song with the prefix → its current version → newest job for that version. The register call site (`AuthEndpoints.cs:286`) discards the result — no edit.
- [ ] **4. Run** → GREEN, plus `--filter DemoSeederTests`. **5. All gates. 6. Commit** `feat(bff): snapshot-driven demo seeding; fallback seed no longer fires paid triage`.

---

### Task D4: Snapshot exporter

**Files:** Create `Endpoints/AdminEndpoints.DemoSnapshot.cs` (class is already `partial`, `AdminEndpoints.cs:18`); one route line in `MapAdminEndpoints` (`AdminEndpoints.cs:47-53`): `admin.MapPost("/demo/snapshot", PostDemoSnapshot);`. DTOs in `DTOs/DemoDtos.cs`. Test: `tests/Spectr.Bff.Tests/DemoSnapshotExportTests.cs`.

**Interfaces — Consumes:** `DemoSnapshotFormat`, `DemoSnapshotStore.Invalidate()` (D3). **Produces:** `DemoSnapshotExportRequest(Guid VersionId, string? Reason)`, `DemoSnapshotExportResponse(string SnapshotKey, int Verdicts, int Messages, int RackPresets, long AudioBytes)`.

- [ ] **1. Failing tests** (factory: `UseSetting("Admin:ApiKey", Key)` where `Key` is 40 chars, `UseSetting("Demo:SnapshotKey", dir + "snapshot.json")`; helper `SeedAnalyzedAsync` registers a user and returns that user's seeded demo `versionId` + `analysisId` — the fallback seed already has a routing plan after D3):

```csharp
[SkippableFact] public async Task Export_Requires_The_Admin_Key()
{ await TestDb.RequireAsync(factory); var f = Build();
  var r = await f.CreateClient().PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId = Guid.NewGuid() });
  Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode); }
[SkippableFact] public async Task Export_Refuses_An_Untriaged_Analysis()
{ await TestDb.RequireAsync(factory); var f = Build(); var (versionId, analysisId, _) = await SeedAnalyzedAsync(f);
  await SetAsync(f, analysisId, a => a.RoutingPlan = null);
  var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
  Assert.Equal(HttpStatusCode.Conflict, r.StatusCode); Assert.Equal("snapshot_not_ready", await Code(r)); }
[SkippableFact] public async Task Export_Refuses_A_Degraded_Analysis()
{ await TestDb.RequireAsync(factory); var f = Build(); var (versionId, analysisId, _) = await SeedAnalyzedAsync(f);
  await SetAsync(f, analysisId, a => a.DegradationNotice = "{\"reason\":\"tier_budget\"}");
  var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
  Assert.Equal(HttpStatusCode.Conflict, r.StatusCode); Assert.Equal("snapshot_not_ready", await Code(r)); }
[SkippableFact] public async Task Export_Aborts_When_The_Owner_Would_Leak()
{ await TestDb.RequireAsync(factory); var f = Build(); var (versionId, analysisId, email) = await SeedAnalyzedAsync(f);
  await SetAsync(f, analysisId, a => a.FinalJson = "{\"note\":\"" + email + "\"}");
  var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
  Assert.Equal(HttpStatusCode.Conflict, r.StatusCode); Assert.Equal("snapshot_leak", await Code(r)); }
[SkippableFact] public async Task Export_Round_Trips_Through_The_Seeder()
{ await TestDb.RequireAsync(factory); var f = Build(); var (versionId, _, _) = await SeedAnalyzedAsync(f);
  var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
  r.EnsureSuccessStatusCode();
  var body = await r.Content.ReadFromJsonAsync<DemoSnapshotExportResponse>();
  Assert.StartsWith("audio/demo/", body!.SnapshotKey); Assert.True(body.AudioBytes > 0);
  var (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());          // a NEW account now seeds from the export
  using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
  var v = await db.SongVersions.AsNoTracking().SingleAsync(x => db.Songs.Any(s => s.Id == x.SongId && s.UserId == userId));
  Assert.StartsWith(Path.GetDirectoryName(body.SnapshotKey)!.Replace('\\', '/'), v.FilePath); }
```
`Code(r)` parses `error.code`; `Admin(f)` sets `X-Admin-Key`; the class deletes its snapshot directory objects in `Dispose`.
- [ ] **2. Run** → RED. **3. Implement.** Handler: 400 `invalid_request` on empty `VersionId`; load version → song → owner → newest Analysis for the version (404 `version_not_found`); 409 `snapshot_not_ready` when `RoutingPlan is null || DegradationNotice is not null`; target dir = directory of the configured snapshot key; copy audio (`storage.OpenReadAsync(version.FilePath)` → `WriteAsync(dir + "source" + ext)`) and the three image/peaks keys when present; build the §6 document from Analysis, its Verdict rows, the OWNER's Conversation + messages for that analysis (drop `LlmCallId`), RackPresets of the version; serialize (camelCase, `JsonElement` for JSON columns); **leak check:** if the text contains the owner's id (`D` or `N`) or email (case-insensitive) ⇒ delete the copied objects, 409 `snapshot_leak`; write `snapshot.json` LAST; `store.Invalidate()`; audit row (`Action = "demo_snapshot_export"`, `Target = versionId`, `Reason`). **4. GREEN. 5. All gates. 6. Commit** `feat(bff): admin demo-snapshot exporter`.

---

### Task D5: `POST /api/auth/demo`

**Files:** Create `Auth/GuestIdentity.cs`, `Auth/AuthSnapshot.cs`, `Endpoints/DemoAuthEndpoints.cs`, `DTOs/DemoDtos.cs` (add `DemoTarget`, `DemoStartResponse`). Modify `DTOs/AuthDtos.cs:11-15` (`bool IsGuest = false`), `Auth/RefreshTokenService.cs`, `Auth/ClaimsPrincipalExtensions.cs`, `Program.cs` (`:158-204` token check, `:537` map), `Endpoints/AuthEndpoints.cs` (four small edits), `appsettings.Development.json` (`"Demo": { "Enabled": "true" }`). Test: `tests/Spectr.Bff.Tests/DemoAuthEndpointsTests.cs`.

**Interfaces — Produces:**
```csharp
public static class GuestIdentity { public const string EmailDomain = "guest.spectr.invalid"; public const string ClaimType = "spectr_guest";
  public static string EmailFor(Guid id); public static bool IsGuestEmail(string? email); public static void Mark(ClaimsPrincipal p);
  public static string SharedPasswordHash(PasswordHasher hasher); public static bool DemoEnabled(IConfiguration cfg, Dictionary<string,string> flags); }
internal readonly record struct AuthSnapshot(int Version, bool Banned, bool IsGuest, DateTimeOffset? GuestExpiresAt);
public static bool IsGuest(this ClaimsPrincipal p);                                   // ClaimsPrincipalExtensions
public Task<(string Raw, RefreshToken Row)> IssueAsync(Guid userId, DateTimeOffset expiresAt, CancellationToken ct = default);
public Task<(string Raw, RefreshToken Row)> RotateAsync(RefreshToken current, DateTimeOffset? expiresAtCap, CancellationToken ct = default);
public CookieOptions CookieOptions(DateTimeOffset expires);
```
**Consumes:** `DemoSeeder.SeedAsync/FindAsync` (D3), `DeviceService.ReadDeviceId/GetOrCreateAsync` (`DeviceService.cs:31,41`), `VersionEndpoints.NormalizeIpForLimiting` (`:1100`).

- [ ] **1. Failing tests** — factory helper `Build(Action<IWebHostBuilder>? extra = null)` applies `UseSetting("Demo:Enabled","true")`, `UseSetting("Demo:SnapshotKey","")`, a no-op `IJobQueue`; `ThrowingLimiter : IRateLimiter` throws `InvalidOperationException`; `Code(resp)` parses `error.code`; `DeviceCookie(resp)` returns the `spectr_device=…` pair from `Set-Cookie`.

```csharp
[SkippableFact] public async Task Start_Creates_An_Isolated_Guest_With_A_Seeded_Demo()
{ await TestDb.RequireAsync(factory); var client = Build().CreateClient();
  var resp = await client.PostAsync("/api/auth/demo", null); resp.EnsureSuccessStatusCode();
  var body = await resp.Content.ReadFromJsonAsync<DemoStartResponse>();
  Assert.True(body!.User.IsGuest); Assert.False(body.Resumed); Assert.EndsWith("@guest.spectr.invalid", body.User.Email);
  client.DefaultRequestHeaders.Authorization = new("Bearer", body.AccessToken);
  Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/jobs/{body.Demo.JobId}/results")).StatusCode);
  var audio = await client.GetAsync($"/api/versions/{body.Demo.VersionId}/audio");
  Assert.True(audio.StatusCode is HttpStatusCode.OK or HttpStatusCode.PartialContent);
  Assert.Contains(resp.Headers.GetValues("Set-Cookie"), c => c.StartsWith("spectr_refresh=")); }
[SkippableFact] public async Task The_Same_Device_Resumes_The_Same_Sandbox()
{ await TestDb.RequireAsync(factory); var client = Build().CreateClient();
  var first = await client.PostAsync("/api/auth/demo", null);
  var a = await first.Content.ReadFromJsonAsync<DemoStartResponse>();
  var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/demo"); req.Headers.Add("Cookie", DeviceCookie(first));
  var b = await (await client.SendAsync(req)).Content.ReadFromJsonAsync<DemoStartResponse>();
  Assert.Equal(a!.User.Id, b!.User.Id); Assert.True(b.Resumed); Assert.Equal(a.Demo, b.Demo); }
[SkippableFact] public async Task An_Expired_Guest_Gets_A_New_Sandbox()
{ await TestDb.RequireAsync(factory); var f = Build(); var client = f.CreateClient();
  var first = await client.PostAsync("/api/auth/demo", null); var a = await first.Content.ReadFromJsonAsync<DemoStartResponse>();
  using (var scope = f.Services.CreateScope())
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.Id == a!.User.Id)
      .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
  var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/demo"); req.Headers.Add("Cookie", DeviceCookie(first));
  var b = await (await client.SendAsync(req)).Content.ReadFromJsonAsync<DemoStartResponse>();
  Assert.NotEqual(a!.User.Id, b!.User.Id); Assert.False(b.Resumed); }
[SkippableFact] public async Task An_Expired_Guest_Token_Stops_Working()
{ await TestDb.RequireAsync(factory); var f = Build(); var client = f.CreateClient();
  var g = await (await client.PostAsync("/api/auth/demo", null)).Content.ReadFromJsonAsync<DemoStartResponse>();
  client.DefaultRequestHeaders.Authorization = new("Bearer", g!.AccessToken);
  Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/songs/")).StatusCode);
  using (var scope = f.Services.CreateScope())
  { await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.Id == g.User.Id)
      .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
    scope.ServiceProvider.GetRequiredService<IMemoryCache>().Remove($"tver:{g.User.Id:N}"); }
  Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/songs/")).StatusCode); }
[SkippableFact] public async Task Disabled_Demo_Returns_503_Unavailable()
{ await TestDb.RequireAsync(factory); var r = await Build(b => b.UseSetting("Demo:Enabled", "false")).CreateClient().PostAsync("/api/auth/demo", null);
  Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode); Assert.Equal("demo_unavailable", await Code(r)); }
[SkippableFact] public async Task A_Limiter_Failure_Fails_CLOSED()
{ await TestDb.RequireAsync(factory);
  var f = Build(b => { b.UseSetting("RateLimits:Enabled", "true");
      b.ConfigureTestServices(s => { s.RemoveAll(typeof(IRateLimiter)); s.AddSingleton<IRateLimiter>(new ThrowingLimiter()); }); });
  var r = await f.CreateClient().PostAsync("/api/auth/demo", null);
  Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode); Assert.Equal("demo_unavailable", await Code(r)); }
[SkippableFact] public async Task The_Daily_Cap_Returns_503_Capacity()
{ await TestDb.RequireAsync(factory); var r = await Build(b => b.UseSetting("Demo:DailyCap", "0")).CreateClient().PostAsync("/api/auth/demo", null);
  Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode); Assert.Equal("demo_capacity", await Code(r)); }
[SkippableFact] public async Task A_Guest_Cannot_Log_In_And_The_Domain_Cannot_Be_Registered()
{ await TestDb.RequireAsync(factory); var client = Build().CreateClient();
  var g = await (await client.PostAsync("/api/auth/demo", null)).Content.ReadFromJsonAsync<DemoStartResponse>();
  var login = await client.PostAsJsonAsync("/api/auth/login", new { email = g!.User.Email, password = "anything-at-all" });
  Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
  var reg = await client.PostAsJsonAsync("/api/auth/register", new { email = "x@guest.spectr.invalid", password = TestAuth.Password });
  Assert.Equal(HttpStatusCode.BadRequest, reg.StatusCode); }
[SkippableFact] public async Task Guests_Cannot_See_Each_Other()
{ await TestDb.RequireAsync(factory); var f = Build();
  var a = await (await f.CreateClient().PostAsync("/api/auth/demo", null)).Content.ReadFromJsonAsync<DemoStartResponse>();
  var bClient = f.CreateClient(); var b = await (await bClient.PostAsync("/api/auth/demo", null)).Content.ReadFromJsonAsync<DemoStartResponse>();
  bClient.DefaultRequestHeaders.Authorization = new("Bearer", b!.AccessToken);
  foreach (var url in new[] { $"/api/jobs/{a!.Demo.JobId}/results", $"/api/versions/{a.Demo.VersionId}/audio", $"/api/reports/{a.Demo.JobId}/verdicts/" })
    Assert.Equal(HttpStatusCode.NotFound, (await bClient.GetAsync(url)).StatusCode); }
[SkippableFact] public async Task Refresh_Keeps_The_Guest_Flag_And_Caps_The_Cookie()
{ await TestDb.RequireAsync(factory); var f = Build(); var client = f.CreateClient();
  var start = await client.PostAsync("/api/auth/demo", null); var g = await start.Content.ReadFromJsonAsync<DemoStartResponse>();
  var cookie = start.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("spectr_refresh=")).Split(';')[0];
  var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh"); req.Headers.Add("Cookie", cookie);
  var resp = await client.SendAsync(req); resp.EnsureSuccessStatusCode();
  Assert.True((await resp.Content.ReadFromJsonAsync<AuthResponse>())!.User.IsGuest);
  using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
  var expires = await db.Users.Where(u => u.Id == g!.User.Id).Select(u => u.GuestExpiresAt).SingleAsync();
  Assert.All(await db.RefreshTokens.AsNoTracking().Where(t => t.UserId == g!.User.Id).ToListAsync(), t => Assert.True(t.ExpiresAt <= expires)); }
```
- [ ] **2. Run** → RED. **3. Implement**

```csharp
// Endpoints/DemoAuthEndpoints.cs — the fail-closed order is the contract (spec D2)
private static async Task<IResult> Start(HttpContext http, AppDbContext db, DeviceService devices, DemoSeeder seeder,
    JwtTokenService jwt, RefreshTokenService refresh, PasswordHasher hasher, EntitlementService ents,
    IRateLimiter limiter, IConfiguration cfg, ILoggerFactory lf, CancellationToken ct)
{
    var log = lf.CreateLogger("Demo");
    Dictionary<string, string> flags;
    try { flags = await ents.GetFlagsAsync(ct); }
    catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "flags unavailable — demo fails closed"); return Unavailable(); }
    if (!GuestIdentity.DemoEnabled(cfg, flags)) return Unavailable();                                    // 1
    var now = DateTimeOffset.UtcNow;
    var deviceId = devices.ReadDeviceId(http.Request);
    if (deviceId is not null)                                                                            // 2 resume — consumes no limit
    {
        var existing = await db.Users.FirstOrDefaultAsync(u => u.IsGuest && u.GuestDeviceId == deviceId
            && u.GuestExpiresAt > now && u.BannedAt == null && u.IsActive, ct);
        if (existing is not null)
        {
            var found = await seeder.FindAsync(existing.Id, ct) ?? await seeder.SeedAsync(existing.Id, CancellationToken.None);
            if (found is not null) return await SignInAsync(existing, found, resumed: true);
        }
    }
    if (!string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))         // 3 fail CLOSED
    {
        try
        {
            var ip = VersionEndpoints.NormalizeIpForLimiting(http.Connection.RemoteIpAddress) ?? "unknown";
            var actor = deviceId is null ? $"ip:{ip}" : $"device:{deviceId}";   // never one shared "none" bucket
            var verdict = await limiter.CheckAsync(actor, ip, "demo_create",
                GuestIdentity.Flag(flags, "demo_guests_per_ip_hourly", 5), TimeSpan.FromHours(1), ct);
            if (!verdict.Allowed) return ErrorEnvelope.Build(429, "rate_limited", "You've started the demo a few times already — try again in a bit.");
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex) { log.LogError(ex, "demo limiter unavailable — failing CLOSED"); return Unavailable(); }
    }
    var cap = int.TryParse(cfg["Demo:DailyCap"], out var c) ? c : GuestIdentity.Flag(flags, "demo_guests_daily_cap", 300);
    if (await db.Users.CountAsync(u => u.IsGuest && u.CreatedAt > now.AddHours(-24), ct) >= cap) return Capacity();  // 4
    var device = await devices.GetOrCreateAsync(http, ct);                                                // 5
    var id = Guid.NewGuid();
    var user = new User { Id = id, Email = GuestIdentity.EmailFor(id), HashedPassword = GuestIdentity.SharedPasswordHash(hasher),
        EmailVerifiedAt = now, NotifyAnalysisComplete = false, DisplayName = "Guest", IsGuest = true,
        GuestExpiresAt = now.AddHours(GuestIdentity.Flag(flags, "guest_ttl_hours", 72)), GuestDeviceId = device.Id };
    db.Users.Add(user); await db.SaveChangesAsync(ct);
    var seeded = await seeder.SeedAsync(id, CancellationToken.None);
    if (seeded is null)   // nothing to show — never hand out an empty sandbox (SeedAsync cleared the tracker on failure)
    { await db.Users.Where(u => u.Id == id).ExecuteDeleteAsync(CancellationToken.None); return Unavailable(); }
    return await SignInAsync(user, seeded, resumed: false);
    async Task<IResult> SignInAsync(User u, DemoSeedResult demo, bool resumed)
    {
        var expires = u.GuestExpiresAt!.Value;
        var (raw, _) = await refresh.IssueAsync(u.Id, expires, ct);
        http.Response.Cookies.Append(RefreshTokenService.CookieName, raw, refresh.CookieOptions(expires));
        return Results.Ok(new DemoStartResponse(jwt.Issue(u), new AuthedUser(u.Id, u.Email, u.DisplayName, "free", true),
            new DemoTarget(demo.SongId, demo.VersionId, demo.JobId), resumed));
    }
}
private static IResult Unavailable() => ErrorEnvelope.Build(503, "demo_unavailable", "The demo is taking a break — analyze your own track instead.");
private static IResult Capacity()    => ErrorEnvelope.Build(503, "demo_capacity",    "The demo is taking a break — analyze your own track instead.");
```
`GuestIdentity.Flag` is `internal static int Flag(Dictionary<string,string> f, string k, int d) => f.TryGetValue(k, out var r) && int.TryParse(r, out var v) && v >= 0 ? v : d;` — the single flag-parsing helper for this workstream (`GuestLimits.Flag` in D6 just delegates to it).

```csharp
// Program.cs OnTokenValidated — the tver: cache extension (spec D3)
var email = ctx.Principal?.Email();
if (GuestIdentity.IsGuestEmail(email)) GuestIdentity.Mark(ctx.Principal!);      // signed claim — survives the fail-open path below
// … existing tverClaim/sub parsing unchanged …
AuthSnapshot? current;
try
{
    current = await cache.GetOrCreateAsync($"tver:{uid:N}", async e =>
    {
        e.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(60);
        var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var row = await db.Users.AsNoTracking().Where(u => u.Id == uid)
            .Select(u => new { u.TokenVersion, u.BannedAt, u.IsGuest, u.GuestExpiresAt }).FirstOrDefaultAsync();
        return row is null ? (AuthSnapshot?)null : new AuthSnapshot(row.TokenVersion, row.BannedAt != null, row.IsGuest, row.GuestExpiresAt);
    });
}
catch (Exception ex) { /* unchanged fail-open */ return; }
if (current is null || tverClaim != current.Value.Version.ToString()) ctx.Fail("stale token version");
else if (current.Value.Banned) ctx.Fail("account banned");
else if (current.Value.IsGuest)
{
    if (current.Value.GuestExpiresAt is { } exp && exp <= DateTimeOffset.UtcNow) ctx.Fail("guest expired");
    else GuestIdentity.Mark(ctx.Principal!);
}
```
`GuestIdentity.Mark` adds `new Claim(ClaimType, "1")` to the first `ClaimsIdentity` when absent; `IsGuest()` = `p.HasClaim(GuestIdentity.ClaimType, "1")`; `DemoEnabled` = `cfg["Demo:Enabled"]` when non-empty, else flag `demo_enabled`; true ONLY for an explicit `"true"`. `SharedPasswordHash` = `Lazy<string>` of `hasher.Hash(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)))`. `RefreshTokenService`: the three overloads (rotation uses `min(now + _days, expiresAtCap)`). `AuthEndpoints.cs` edits: Refresh (`:431-449`) — 401 when `user.IsGuest && user.GuestExpiresAt <= now`, rotate with `user.IsGuest ? user.GuestExpiresAt : null`, cookie via the capped overload, pass `user.IsGuest` to `AuthedUser`; Me (`:469-497`) — project and pass `IsGuest`; Register — `if (GuestIdentity.IsGuestEmail(email)) return ErrorEnvelope.Build(400, "invalid_email", "That email address can't be used.");` before the uniqueness check; ForgotPassword (`:582`) — return the normal silent 200 early when the matched user `IsGuest`. `Program.cs:537`: `api.MapDemoAuthEndpoints();`.
- [ ] **4. Run** → GREEN + `--filter "AuthEndpoints|NoSocialSurface"`. **5. All gates. 6. Commit** `feat(bff): POST /api/auth/demo — fail-closed guest sandboxes with device resume`.

---

### Task D6: Guest guard, quotas, coach cap

**Files:** Create `Auth/GuestGuard.cs`, `Services/GuestLimits.cs`, `Endpoints/GuestEndpoints.cs` (`GET /me/guest`); add `GuestStateDto` to `DTOs/DemoDtos.cs`. Modify `Program.cs:535` (`api.AddEndpointFilter(GuestGuard.Filter);`, register `GuestLimits` scoped, `api.MapGuestEndpoints();`), `Services/CoachCapService.cs:38-46`, `Endpoints/VersionEndpoints.cs` (`DispatchAnalysisAsync` head `:1124` + queue switch `:1351`, route markers), and route markers in `UploadEndpoints.cs`, `SongEndpoints.cs`, `VerdictEndpoints.cs`, `FixRackEndpoints.cs`, `RackPresetEndpoints.cs`, `CoachConversationEndpoints.cs:49`, `CompareEndpoints.cs:22-23`, `AccountEndpoints.cs:29`. Test: `tests/Spectr.Bff.Tests/GuestGuardTests.cs`.

**Interfaces — Produces:**
```csharp
public enum GuestQuota { None, Upload }
public sealed record GuestAllowed(GuestQuota Quota);
public sealed class GuestDenied { public static readonly GuestDenied Instance = new(); }
public static class GuestGuard {  // + Filter, Restricted(string reason, string? message = null)
  public static TBuilder AllowGuest<TBuilder>(this TBuilder b) where TBuilder : IEndpointConventionBuilder;
  public static TBuilder AllowGuestUpload<TBuilder>(this TBuilder b) where TBuilder : IEndpointConventionBuilder;
  public static TBuilder DenyGuest<TBuilder>(this TBuilder b) where TBuilder : IEndpointConventionBuilder; }
public sealed class GuestLimits(AppDbContext db, EntitlementService ents, IRateLimiter limiter, IConfiguration cfg, ILogger<GuestLimits> log) {
  public static int Flag(Dictionary<string,string> flags, string name, int fallback);   // delegates to GuestIdentity.Flag
  public Task<IResult?> CheckUploadAsync(Guid userId, CancellationToken ct);
  public Task<IResult?> CheckAnalysisAsync(Guid userId, HttpContext http, CancellationToken ct);
  public Task<GuestStateDto> GetStateAsync(User guest, CancellationToken ct); }
```

- [ ] **1. Failing tests** (`StartGuestAsync(f)` posts `/api/auth/demo`, sets the bearer, returns `(client, DemoStartResponse)`; `Reason(resp)` parses `error.details.reason`):

```csharp
public static TheoryData<string, string> Denied => new() {
  { "DELETE", "/api/songs/{song}" }, { "DELETE", "/api/songs/{song}/permanent" }, { "POST", "/api/songs/{song}/restore" },
  { "POST", "/api/songs/" }, { "DELETE", "/api/versions/{version}" }, { "POST", "/api/versions/{version}/stems/classify" },
  { "POST", "/api/versions/{version}/als-key" }, { "POST", "/api/uploads/attachments/init" }, { "POST", "/api/me/delete" },
  { "PATCH", "/api/auth/me" }, { "PATCH", "/api/me/profile" }, { "POST", "/api/auth/resend-verification" },
  { "POST", "/api/billing/portal" }, { "POST", "/api/reports/{job}/phases/3/rerun" }, { "POST", "/api/jobs/{job}/retry" },
  { "GET", "/api/me/export" } };
[SkippableTheory, MemberData(nameof(Denied))]
public async Task A_Guest_Is_Refused_With_The_Typed_Envelope(string method, string template)
{ await TestDb.RequireAsync(factory); var (client, g) = await StartGuestAsync(Build());
  var url = template.Replace("{song}", g.Demo.SongId.ToString()).Replace("{version}", g.Demo.VersionId.ToString()).Replace("{job}", g.Demo.JobId.ToString());
  var resp = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), url) { Content = JsonContent.Create(new { }) });
  Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode); Assert.Equal("guest_restricted", await Code(resp)); }
public static TheoryData<string, string> Allowed => new() {
  { "PUT", "/api/versions/{version}/rack/draft" }, { "POST", "/api/versions/{version}/notes" }, { "PUT", "/api/versions/{version}/rating" },
  { "PATCH", "/api/songs/{song}" }, { "POST", "/api/reports/{job}/fix-rack/" }, { "PUT", "/api/compare/notes" }, { "POST", "/api/uploads/abort" } };
[SkippableTheory, MemberData(nameof(Allowed))]
public async Task Sandbox_Actions_Are_Never_Guest_Restricted(string method, string template)
{ await TestDb.RequireAsync(factory); var (client, g) = await StartGuestAsync(Build());
  var url = template.Replace("{song}", g.Demo.SongId.ToString()).Replace("{version}", g.Demo.VersionId.ToString()).Replace("{job}", g.Demo.JobId.ToString());
  var body = JsonContent.Create(new { chain = new { order = Array.Empty<string>(), modules = new { }, masterBypass = false } });
  var resp = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), url) { Content = body });
  Assert.NotEqual(HttpStatusCode.Forbidden, resp.StatusCode); }   // a 400 from body validation is fine — a 403 is the bug
[SkippableFact] public async Task Anonymous_Endpoints_Still_Work_With_A_Guest_Bearer()
{ var (client, _) = await StartGuestAsync(Build()); Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/logout", null)).StatusCode); }
[SkippableFact] public async Task A_Real_User_Is_Untouched_By_The_Guard()
{ await TestDb.RequireAsync(factory); var client = Build().CreateClient(); var (_, token) = await TestAuth.RegisterAsync(client);
  client.DefaultRequestHeaders.Authorization = new("Bearer", token);
  var resp = await client.PatchAsJsonAsync("/api/me/profile", new { displayName = "Still Me" });
  Assert.NotEqual(HttpStatusCode.Forbidden, resp.StatusCode); }
[SkippableFact] public async Task One_Upload_Then_The_Quota_Closes()
{ await TestDb.RequireAsync(factory); var (client, _) = await StartGuestAsync(Build());
  Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/versions/", Wav("mine.wav", analyze: false))).StatusCode);
  var second = await client.PostAsync("/api/versions/", Wav("again.wav", analyze: false));
  Assert.Equal(HttpStatusCode.Forbidden, second.StatusCode); Assert.Equal("upload_limit", await Reason(second));
  var state = await client.GetFromJsonAsync<GuestStateDto>("/api/me/guest");
  Assert.Equal((1, 1), (state!.UploadsUsed, state.UploadsMax)); }
[SkippableFact] public async Task One_Analysis_On_The_Free_Lane_Then_The_Quota_Closes()
{ var q = new RecordingQueue(); var (client, _) = await StartGuestAsync(Build(queue: q));
  var up = await (await client.PostAsync("/api/versions/", Wav("mine.wav", analyze: false))).Content.ReadFromJsonAsync<UploadResponse>();
  Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/api/versions/{up!.VersionId}/analyze", null)).StatusCode);
  Assert.Contains((DramatiqTasks.AnalyzeAudioJob, DramatiqQueues.AnalysisFree), q.Sent);
  var again = await client.PostAsync($"/api/versions/{up.VersionId}/analyze", null);
  Assert.Equal(HttpStatusCode.Forbidden, again.StatusCode); Assert.Equal("analysis_limit", await Reason(again)); }
[SkippableFact] public async Task The_Global_Analysis_Arm_Fails_CLOSED()
{ var (_, g) = await StartGuestAsync(Build());                       // limits off → guest exists
  var strict = Build(b => { b.UseSetting("RateLimits:Enabled", "true");
      b.ConfigureTestServices(s => { s.RemoveAll(typeof(IRateLimiter)); s.AddSingleton<IRateLimiter>(new ThrowingLimiter()); }); }).CreateClient();
  strict.DefaultRequestHeaders.Authorization = new("Bearer", g.AccessToken);
  var r = await strict.PostAsync($"/api/versions/{g.Demo.VersionId}/analyze", null);
  Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode); Assert.Equal("demo_capacity", await Code(r)); }
[SkippableTheory, InlineData("true"), InlineData("false")]
public async Task The_Coach_Cap_Trips_For_Guests_Whatever_The_Credit_Switch_Says(string creditsEnabled)
{ var f = Build(b => b.UseSetting("Credits:Enabled", creditsEnabled)); var (client, g) = await StartGuestAsync(f);
  using (var scope = f.Services.CreateScope())
  { var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    for (var i = 0; i < 20; i++) db.UsageEvents.Add(new UsageEvent { UserId = g.User.Id, EventType = "coach_message", BillingPeriod = "2026-09", Reference = Guid.NewGuid().ToString() });
    await db.SaveChangesAsync(); }
  var analysisId = await AnalysisIdAsync(f, g.Demo.JobId);
  var convo = await client.GetFromJsonAsync<CoachConversationDto>($"/api/coach/{analysisId}/conversation");
  Assert.Equal((20, true, "analysis"), (convo!.Caps.Limit, convo.Caps.CapReached, convo.Caps.Scope)); }
[SkippableFact] public async Task Guest_State_Is_404_For_Real_Users()
{ await TestDb.RequireAsync(factory); var client = Build().CreateClient(); var (_, token) = await TestAuth.RegisterAsync(client);
  client.DefaultRequestHeaders.Authorization = new("Bearer", token);
  Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/me/guest")).StatusCode); }
```
`Wav(name, analyze)` = multipart with `DemoSeeder.GenerateToneWav()` as `file` and the `analyze` field; `RecordingQueue.Sent` is `List<(string Task, string Queue)>`.
- [ ] **2. Run** → RED. **3. Implement**

```csharp
// Auth/GuestGuard.cs — default-deny (spec D4)
public static async ValueTask<object?> Filter(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
{
    var http = ctx.HttpContext;
    if (!http.User.IsGuest()) return await next(ctx);                       // real users: one branch, no cost
    var meta = http.GetEndpoint()?.Metadata;
    if (meta?.GetMetadata<IAllowAnonymous>() is not null) return await next(ctx);   // logout/refresh/anon funnel carry the bearer too
    if (meta?.GetMetadata<GuestDenied>() is not null) return Restricted("not_allowed");
    var allowed = meta?.GetMetadata<GuestAllowed>();
    var method = http.Request.Method;
    var safe = HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);
    if (allowed is null && !safe) return Restricted("not_allowed");         // an endpoint added later is closed by default
    if (allowed?.Quota == GuestQuota.Upload)
    {
        var limits = http.RequestServices.GetRequiredService<GuestLimits>();
        if (await limits.CheckUploadAsync(http.User.UserId(), http.RequestAborted) is { } denied) return denied;
    }
    return await next(ctx);
}
internal static IResult Restricted(string reason, string? message = null) => ErrorEnvelope.Build(403, "guest_restricted",
    message ?? "That's not part of the demo sandbox — create a free account to do this.", new { reason });
public static TBuilder AllowGuest<TBuilder>(this TBuilder b) where TBuilder : IEndpointConventionBuilder => b.WithMetadata(new GuestAllowed(GuestQuota.None));
public static TBuilder AllowGuestUpload<TBuilder>(this TBuilder b) where TBuilder : IEndpointConventionBuilder => b.WithMetadata(new GuestAllowed(GuestQuota.Upload));
public static TBuilder DenyGuest<TBuilder>(this TBuilder b) where TBuilder : IEndpointConventionBuilder => b.WithMetadata(GuestDenied.Instance);
```
`GuestLimits.CheckUploadAsync`: `used = db.SongVersions.CountAsync(v => !v.FilePath.StartsWith("audio/demo/") && db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId))`; `used >= Flag(flags,"guest_uploads_max",1)` ⇒ `Restricted("upload_limit", "The demo sandbox includes one upload — create a free account to analyze more.")`. `CheckAnalysisAsync`: usage events `EventType == "analysis"` for the user `>= guest_uploads_max` ⇒ `Restricted("analysis_limit", …)`; then, unless `RateLimits:Enabled == "false"`: `try { limiter.CheckAsync("guest-lane", "global", "guest_analysis", Flag(flags,"guest_analyses_per_hour",10), 1 h) ; !Allowed ⇒ 503 demo_capacity } catch (non-cancel) ⇒ log + 503 demo_capacity` with message "The demo sandbox can't start new analyses right now — create a free account to analyze your track." `DispatchAnalysisAsync`, first statements: `var isGuest = httpCtx.User.IsGuest(); if (isGuest && !freeRetry) { var g = await httpCtx.RequestServices.GetRequiredService<GuestLimits>().CheckAnalysisAsync(userId, httpCtx, ct); if (g is not null) return (Guid.Empty, g); }`; queue switch (`:1351`): `var queueName = isGuest ? DramatiqQueues.AnalysisFree : ent.Tier switch { … };`. `CoachCapService.ResolveAsync`, before the `CreditsEnabled` check: `if (await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.IsGuest).FirstOrDefaultAsync(ct)) { var limit = GetFlag(flags, "coach_guest_messages", 20); var used = await db.UsageEvents.AsNoTracking().CountAsync(e => e.UserId == userId && e.EventType == "coach_message", ct); return new CoachCapState(used, limit, used >= limit, ScopeAnalysis, null); }`. Markers exactly per spec D4 (`.AllowGuest()` list, `.AllowGuestUpload()` on `POST /versions/`, `/uploads/init`, `/uploads/complete`; `.DenyGuest()` on `GET /me/export`). `GET /me/guest`: 404 unless `currentUser.IsGuest()`, else `GetStateAsync`.
- [ ] **4. Run** → GREEN + `--filter "NoSocialSurface|CoachProMonthlyCap|DispatchQueueRouting|DispatchEntitlementGate"`. **5. All gates. 6. Commit** `feat(bff): default-deny guest guard, one-upload quota, guest coach cap`.

---

### Task D7: Purge expired guests

**Files:** Create `Services/AccountTeardown.cs`. Modify `Endpoints/AccountEndpoints.cs:299-335` (call the service), `Services/RetentionSweepScheduler.cs:78-101`, `Program.cs` (register scoped). Test: `tests/Spectr.Bff.Tests/GuestPurgeTests.cs`.

**Interfaces — Produces:** `public sealed class AccountTeardown(AppDbContext db, RefreshTokenService refresh, IMemoryCache cache) { public Task TearDownAsync(User user, string auditAction, string auditReason, CancellationToken ct); }` — the transaction of `AccountEndpoints.cs:302-330` + the `tver:` eviction of `:335`, verbatim. `RetentionSweepScheduler.PurgeExpiredGuestsAsync(IServiceProvider sp, CancellationToken ct) : Task<int>` (internal).

- [ ] **1. Failing tests**

```csharp
[SkippableFact] public async Task The_Sweep_Purges_Expired_Guests_And_Keeps_Live_Ones()
{ await TestDb.RequireAsync(factory); var q = new RecordingQueue(); var f = Build(queue: q);
  var (_, dead) = await StartGuestAsync(f); var (_, live) = await StartGuestAsync(f);
  using (var scope = f.Services.CreateScope())
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.Id == dead.User.Id)
      .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddHours(-1)));
  var sweeper = f.Services.GetServices<IHostedService>().OfType<RetentionSweepScheduler>().Single();
  await sweeper.RunOnceAsync(CancellationToken.None);
  using var s2 = f.Services.CreateScope(); var db = s2.ServiceProvider.GetRequiredService<AppDbContext>();
  Assert.False(await db.Users.AnyAsync(u => u.Id == dead.User.Id)); Assert.True(await db.Users.AnyAsync(u => u.Id == live.User.Id));
  Assert.Contains(q.SentWithArgs, m => m.Task == DramatiqTasks.DeleteAccountData && (string)m.Args[0] == dead.User.Id.ToString());
  Assert.DoesNotContain(q.SentWithArgs, m => m.Task == DramatiqTasks.DeleteAccountData && (string)m.Args[0] == live.User.Id.ToString());
  Assert.True(await db.AuditLogs.AnyAsync(a => a.Action == "guest_purge" && a.Target == dead.User.Id.ToString())); }
[SkippableFact] public async Task A_Purged_Guests_Token_Stops_Working_Immediately()
{ await TestDb.RequireAsync(factory); var f = Build(); var (client, g) = await StartGuestAsync(f);
  using (var scope = f.Services.CreateScope())
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.Id == g.User.Id)
      .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddHours(-1)));
  await f.Services.GetServices<IHostedService>().OfType<RetentionSweepScheduler>().Single().RunOnceAsync(CancellationToken.None);
  Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/songs/")).StatusCode); }   // teardown evicted the tver cache
[SkippableFact] public async Task Real_Users_Are_Never_Touched_By_The_Guest_Pass()
{ await TestDb.RequireAsync(factory); var q = new RecordingQueue(); var f = Build(queue: q);
  var (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());
  await f.Services.GetServices<IHostedService>().OfType<RetentionSweepScheduler>().Single().RunOnceAsync(CancellationToken.None);
  using var scope = f.Services.CreateScope();
  Assert.True(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AnyAsync(u => u.Id == userId));
  Assert.DoesNotContain(q.SentWithArgs, m => m.Task == DramatiqTasks.DeleteAccountData && (string)m.Args[0] == userId.ToString()); }
// The extraction itself is pinned by the EXISTING AccountGdprTests (step 4) — they must pass unmodified.
```
- [ ] **2. RED. 3. Implement:** extract; `AccountEndpoints` calls `teardown.TearDownAsync(user, "account_delete", "user-initiated (FR27)", ct)`; guest pass in `RunOnceAsync` after the sweep enqueue: load guests with `GuestExpiresAt < now` (batch 200), for each `TearDownAsync(u, "guest_purge", "guest sandbox expired")` then `queue.EnqueueAsync(DramatiqTasks.DeleteAccountData, [u.Id.ToString()], DramatiqQueues.Maintenance, ct)` inside a per-guest try/catch (one bad row never stops the pass; the worker's orphan detector re-enqueues a lost message). **4. GREEN** + `--filter "AccountGdpr|RetentionSweepScheduler"`. **5. All gates. 6. Commit** `feat(bff): nightly purge of expired guest sandboxes`.

---

### Task D8: "Use our sample" on `/analyze`

**Files:** Modify `Endpoints/AnonAnalysisEndpoints.cs:33-135`, `FE/features/anon-analyze/useAnonAnalysis.ts`, `AnalyzePage.tsx` (`DropZoneView`), `FE/api/types.ts`, `FE/lib/analytics.ts`. Add `AnonSampleDto` to `DTOs/DemoDtos.cs`. Tests: `tests/Spectr.Bff.Tests/AnonSampleTests.cs`, `FE/features/anon-analyze/__tests__/anon-sample.test.tsx`.

**Interfaces — Produces:** `GET /api/anon/sample → AnonSampleDto(bool Available, string? Title)`; form field `sample`; FE `useAnonSample(): UseQueryResult<AnonSampleDto>` (key `['anon','sample']`, `staleTime: 300_000`), `useAnonUpload().startSample(): Promise<{ jobId: string }>`.

- [ ] **1. Failing tests.** BFF (factory writes the D3 synthetic snapshot + tone to a throwaway dir, `Demo:SnapshotKey` set, recording queue):
```csharp
[SkippableFact] public async Task Sample_Is_Unavailable_Without_A_Snapshot()
{ var dto = await Build("").CreateClient().GetFromJsonAsync<AnonSampleDto>("/api/anon/sample"); Assert.False(dto!.Available); Assert.Null(dto.Title);
  var r = await Build("").CreateClient().PostAsync("/api/anon/analyses", Form(("sample", "true"))); Assert.Equal(HttpStatusCode.NotFound, r.StatusCode); }
[SkippableFact] public async Task Sample_Copies_The_Audio_To_An_Anon_Key_And_Dispatches()
{ var (f, q) = BuildWithSnapshot(); var r = await f.CreateClient().PostAsync("/api/anon/analyses", Form(("sample", "true"))); r.EnsureSuccessStatusCode();
  var jobId = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("jobId").GetGuid();
  using var scope = f.Services.CreateScope(); var job = await scope.ServiceProvider.GetRequiredService<AppDbContext>().AnalysisJobs.AsNoTracking().SingleAsync(j => j.Id == jobId);
  Assert.StartsWith("audio/anon/", job.FilePath);                                  // a COPY — the 72 h purge deletes anon keys
  Assert.True(await scope.ServiceProvider.GetRequiredService<IFileStorage>().ExistsAsync(job.FilePath!));
  Assert.Contains((DramatiqTasks.AnalyzeAudioJob, DramatiqQueues.AnalysisFree), q.Sent); }
[SkippableFact] public async Task Sample_Respects_One_Active_Analysis_Per_Device()
{ var (f, _) = BuildWithSnapshot(); var client = f.CreateClient();
  var first = await client.PostAsync("/api/anon/analyses", Form(("sample", "true"))); first.EnsureSuccessStatusCode();
  var req = new HttpRequestMessage(HttpMethod.Post, "/api/anon/analyses") { Content = Form(("sample", "true")) };
  req.Headers.Add("Cookie", DeviceCookie(first));
  var second = await client.SendAsync(req);
  Assert.Equal(HttpStatusCode.Conflict, second.StatusCode); Assert.Equal("anon_active_analysis", await Code(second)); }
[SkippableFact] public async Task A_Real_File_Upload_Is_Unchanged()
{ var (f, q) = BuildWithSnapshot(); var form = new MultipartFormDataContent();
  var wav = new ByteArrayContent(DemoSeeder.GenerateToneWav()); wav.Headers.ContentType = new("audio/wav"); form.Add(wav, "file", "mine.wav");
  (await f.CreateClient().PostAsync("/api/anon/analyses", form)).EnsureSuccessStatusCode();
  Assert.Contains((DramatiqTasks.AnalyzeAudioJob, DramatiqQueues.AnalysisFree), q.Sent); }
```
Frontend:
```tsx
// @vitest-environment jsdom
// anon-sample.test.tsx — FakeXhr + makeWrapper as in anon-current-job-cache.test.tsx
it('startSample posts sample=true with no file and seeds the current-job cache', async () => {
  const wrapper = makeWrapper();
  const up = renderHook(() => useAnonUpload(), { wrapper });
  let done: Promise<{ jobId: string }> | undefined;
  act(() => { done = up.result.current.startSample(); });
  expect(FakeXhr.last?.body.get('sample')).toBe('true');
  expect(FakeXhr.last?.body.has('file')).toBe(false);
  await act(async () => { FakeXhr.last?.respond(200, '{"jobId":"j9"}'); await done; });
  up.unmount();
  const current = renderHook(() => useAnonCurrentJob(true), { wrapper });
  expect(current.result.current.data?.jobId).toBe('j9');
});
it('DropZoneView shows "Use ours" only when a sample is installed', () => {
  expect(renderToStaticMarkup(<DropZoneView {...base} sample={{ available: true, title: 'Fixture Track' }} onUseSample={() => {}} />)).toContain('No track handy?');
  expect(renderToStaticMarkup(<DropZoneView {...base} sample={{ available: false, title: null }} onUseSample={() => {}} />)).not.toContain('No track handy?');
});
it('a rejected sample surfaces the server message and leaves the cache alone', async () => {
  const wrapper = makeWrapper();                                   // the fetch stub answers 404 → "no current job"
  const first = renderHook(() => useAnonCurrentJob(true), { wrapper });
  await waitFor(() => expect(first.result.current.isSuccess).toBe(true)); first.unmount();
  const up = renderHook(() => useAnonUpload(), { wrapper });
  let done: Promise<unknown> | undefined;
  act(() => { done = up.result.current.startSample().catch(() => 'rejected'); });
  await act(async () => { FakeXhr.last?.respond(409, '{"error":{"code":"anon_active_analysis","message":"One analysis at a time."}}'); await done; });
  expect(up.result.current.error).toBe('One analysis at a time.');
  up.unmount();
  expect(renderHook(() => useAnonCurrentJob(true), { wrapper }).result.current.data).toBeNull();
});
```
(`FakeXhr.send(body)` records the `FormData` as `body`.)
- [ ] **2. RED. 3. Implement.** BFF: `[FromForm] IFormFile? file, [FromForm(Name = "sample")] bool? sample`; when `sample == true`: resolve `DemoSnapshotStore.GetAsync` (null ⇒ 404 `sample_unavailable`), skip size/extension/magic checks, run the SAME device/409/limiter block, plus — unless limits are off — a global arm `limiter.CheckAsync("anon-sample", "global", "anon_sample", Flag(flags, "anon_sample_per_hour_global", 20), 1 h)` (deny ⇒ 429 `rate_limited` "The sample is resting — drop your own track instead."; this arm stays fail-OPEN like the rest of the funnel), then copy `OpenReadAsync(snapshot audio key)` → `WriteAsync(audio/anon/{device}/{job}/source{ext})`. Refactor the shared tail (job row + enqueue) into one local function so both paths use it. FE: `startSample` reuses the XHR code path with `form.append('sample', 'true')` and the SAME `setQueryData` + `invalidateQueries` on success; `DropZoneView` gains `sample` + `onUseSample` props and a text button "No track handy? Use ours — {title}"; `capture('analyze_sample_started')`; add the event name to the union. **4. GREEN** + `--filter "AnonAnalysis|NoSocialSurface"` + `npx vitest run src/features/anon-analyze`. **5. All gates. 6. Commit** `feat(analyze): "use our sample" runs the real pipeline on the demo track`.

---

### Task D9: Frontend demo flow

**Files:** Create `FE/features/demo/{demoDestination.ts,DemoLauncher.tsx,demo.module.css}`, `FE/routes/demo.tsx`, tests `FE/features/demo/__tests__/{demoDestination.test.ts,DemoLauncher.test.tsx}`, `FE/auth/__tests__/AuthContext.demo.test.tsx`. Modify `FE/auth/AuthContext.tsx`, `FE/api/fetcher.ts:176`, `FE/api/types.ts`, `FE/lib/analytics.ts:28-42`, `FE/routes/__tests__/no-social-surface.test.ts` (the ONE approved line: `'demo.tsx',` after `'analyze.tsx',`); commit the regenerated `FE/routeTree.gen.ts`.

**Interfaces — Produces:**
```ts
export interface DemoTarget { songId: string; versionId: string; jobId: string }
export interface DemoStartResponse { accessToken: string; user: AuthedUser; demo: DemoTarget; resumed: boolean }
// AuthedUser gains: isGuest?: boolean
startDemo: () => Promise<DemoStartResponse>;                                   // AuthContextValue
export const LISTEN_MIN_WIDTH = 1024;
export type DemoDestination = { to: '/listen-rack/$versionId'; params: { versionId: string } }
                            | { to: '/songs/$songId/results/$jobId'; params: { songId: string; jobId: string } };
export function demoDestination(target: DemoTarget, viewportWidth: number): DemoDestination;
```

- [ ] **1. Failing tests**

```ts
// demoDestination.test.ts
import { describe, expect, it } from 'vitest';
import { demoDestination, LISTEN_MIN_WIDTH } from '../demoDestination';
const t = { songId: 's', versionId: 'v', jobId: 'j' };
describe('demoDestination', () => {
  it('sends a desktop visitor straight to Listen', () =>
    expect(demoDestination(t, LISTEN_MIN_WIDTH)).toEqual({ to: '/listen-rack/$versionId', params: { versionId: 'v' } }));
  it('sends a phone to the report — Listen is desktop-gated below 1024px', () =>
    expect(demoDestination(t, LISTEN_MIN_WIDTH - 1)).toEqual({ to: '/songs/$songId/results/$jobId', params: { songId: 's', jobId: 'j' } }));
  it('treats an unknown width as a phone', () => expect(demoDestination(t, 0).to).toBe('/songs/$songId/results/$jobId'));
});
```
```tsx
// @vitest-environment jsdom
// AuthContext.demo.test.tsx — the boot-refresh race
vi.mock('../../api/fetcher', async (orig) => ({ ...(await orig<typeof import('../../api/fetcher')>()), fetcher: vi.fn(), refreshSession: vi.fn(), setAccessToken: vi.fn() }));
const GUEST = { accessToken: 'tok', user: { id: 'g1', email: 'guest-g1@guest.spectr.invalid', displayName: 'Guest', tier: 'free', isGuest: true },
                demo: { songId: 's', versionId: 'v', jobId: 'j' }, resumed: false };
const mount = (qc = new QueryClient()) => ({ qc, ...renderHook(() => useAuth(), {
  wrapper: ({ children }) => <QueryClientProvider client={qc}><AuthProvider>{children}</AuthProvider></QueryClientProvider> }) });
beforeEach(() => { vi.mocked(fetcher).mockReset(); vi.mocked(refreshSession).mockReset(); });
it('a boot refresh that resolves null AFTER startDemo cannot wipe the guest session', async () => {
  let settleBoot: (v: null) => void = () => {};
  vi.mocked(refreshSession).mockReturnValue(new Promise((r) => { settleBoot = r; }));
  vi.mocked(fetcher).mockResolvedValue(GUEST);
  const { result } = mount();
  await act(async () => { await result.current.startDemo(); });
  await act(async () => { settleBoot(null); await Promise.resolve(); });
  expect(result.current.user?.isGuest).toBe(true);
  expect(result.current.isLoading).toBe(false);
});
it('switching user clears cached queries from the previous session', async () => {
  vi.mocked(refreshSession).mockResolvedValue(null);
  vi.mocked(fetcher).mockImplementation(async ({ url }: { url: string }) => (url === '/auth/demo' ? GUEST : undefined));
  const { result, qc } = mount();
  await act(async () => { await result.current.startDemo(); });
  qc.setQueryData(['songs'], [1]);
  await act(async () => { await result.current.logout(); });
  expect(qc.getQueryData(['songs'])).toBeUndefined();
});
it('startDemo rejects with the server error and leaves the session untouched', async () => {
  vi.mocked(refreshSession).mockResolvedValue(null);
  vi.mocked(fetcher).mockRejectedValue(new ApiError(503, { error: { code: 'demo_unavailable' } }));
  const { result } = mount();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => { await expect(result.current.startDemo()).rejects.toBeInstanceOf(ApiError); });
  expect(result.current.user).toBeNull();
});
```
```tsx
// @vitest-environment jsdom
// DemoLauncher.test.tsx — mocks: useAuth, @tanstack/react-router (useNavigate → navigateSpy, useRouter → { invalidate }), capture
it('waits for the boot refresh before starting', () => { auth = { isLoading: true, user: null, startDemo }; render(<DemoLauncher />); expect(startDemo).not.toHaveBeenCalled(); });
it('starts the demo once, invalidates the router, then navigates', async () => {
  auth = { isLoading: false, user: null, startDemo: vi.fn().mockResolvedValue(GUEST) }; setWidth(1440); render(<DemoLauncher />);
  await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: '/listen-rack/$versionId', params: { versionId: 'v' }, replace: true })));
  expect(invalidate).toHaveBeenCalledBefore(navigateSpy); expect(auth.startDemo).toHaveBeenCalledTimes(1);      // StrictMode-safe
  expect(capture).toHaveBeenCalledWith('demo_started', { resumed: false, surface: 'listen' });
});
it('a signed-in real user goes to the library instead', async () => { auth = { isLoading: false, user: { id: 'u', isGuest: false }, startDemo }; render(<DemoLauncher />);
  await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: '/library' }))); expect(startDemo).not.toHaveBeenCalled(); });
it('a failed start shows the fallback card and never says why the demo is off', async () => {
  auth = { isLoading: false, user: null, startDemo: vi.fn().mockRejectedValue(new ApiError(503, { error: { code: 'demo_capacity' } })) };
  render(<DemoLauncher />); expect(await screen.findByText(/taking a break/i)).toBeTruthy();
  expect(screen.getByRole('link', { name: /analyze your own track/i }).getAttribute('href')).toBe('/analyze');
  expect(screen.queryByText(/busy|too many/i)).toBeNull();
  expect(capture).toHaveBeenCalledWith('demo_start_failed', { code: 'demo_capacity' });
});
```
- [ ] **2. RED. 3. Implement**

```tsx
// AuthContext.tsx
const startDemo = useCallback(async () => {
  // A boot refresh may still be in flight on a cold /demo load. Bumping the epoch makes
  // its late result a no-op (see refresh()) instead of overwriting — or, when it resolves
  // null, wiping — the guest session applied below.
  sessionEpoch++;
  const res = await fetcher<DemoStartResponse>({ url: '/auth/demo', method: 'POST' });
  applyAuth({ accessToken: res.accessToken, user: res.user });
  return res;
}, [applyAuth]);
// cache isolation: a different user must never see the previous user's cached queries
const queryClient = useQueryClient();
const prevUserId = useRef<string | null>(null);
useEffect(() => {
  const id = state.user?.id ?? null;
  if (prevUserId.current !== null && prevUserId.current !== id) queryClient.clear();
  prevUserId.current = id;
}, [state.user?.id, queryClient]);
```
Add `startDemo` to the context value + memo deps. `fetcher.ts:176`: append `'/auth/demo'`. `DemoLauncher`: `startedRef` guard; on success `await router.invalidate(); await navigate({ ...demoDestination(res.demo, window.innerWidth), replace: true })`; `surface` = `'listen' | 'report'`; error code via `extractApiError(err.body).code ?? 'unknown'`; card copy "The demo is taking a break." + links `/analyze` ("Analyze your own track") and `/` ; markup uses existing globals (`card`, `btn primary`, `label`) + a small module (tokens only). `routes/demo.tsx`: `createFileRoute('/demo')({ component: DemoLauncher })` (≤10 lines). Analytics union: `demo_cta_clicked`, `demo_started`, `demo_start_failed`, `demo_signup_clicked`, `demo_guest_restricted`. Run `npm run build` to regenerate `routeTree.gen.ts`.
  **If the owner withdraws the allowlist approval:** delete `routes/demo.tsx`; add `validateSearch: (s) => (s['demo'] === '1' || s['demo'] === 1 ? { demo: 1 as const } : {})` to `routes/index.tsx`, skip its authed redirect when `demo` is set, and render `<DemoLauncher />` from `LandingPage` when `Route.useSearch().demo` — the deep link becomes `/?demo=1`.
- [ ] **4. GREEN. 5. All gates** (incl. the guard suite — it must pass with exactly one added line). **6. Commit** `feat(demo): /demo drops a visitor into a guest sandbox`.

---

### Task D10: Guest shell

**Files:** Create `FE/features/demo/{useGuestState.ts,guest-upgrade-bus.ts,GuestBanner.tsx,GuestUpgradeDialog.tsx}` (+ styles in `demo.module.css`), tests `FE/features/demo/__tests__/{guest-shell.test.tsx,guest-upgrade-bus.test.ts}`. Modify `FE/routes/_app.tsx` (`:71-107` ⌘U, `:170-172` button, `:271` banner slot, `:283` dialog), `FE/api/mutation-error-toast.ts:39-43`, `FE/components/UnifiedUploadDialog.tsx` (guest branch + three `{!guest.isGuest && …}` wrappers around the Ableton `:921`, reference `:982` and stems `:1092` blocks; invalidate `['me','guest']` beside the three `['songs']` invalidations `:531,:599,:661`), `FE/features/results/CoachGateInline.tsx` (guest copy), `FE/api/types.ts`.

**Interfaces — Produces:**
```ts
export interface GuestStateDto { expiresAt: string; uploadsUsed: number; uploadsMax: number; analysesUsed: number; analysesMax: number }
export function useGuestState(): { isGuest: boolean; canUpload: boolean; state: GuestStateDto | undefined };  // query key ['me','guest'], enabled only for guests, default staleTime
export type GuestUpgradeReason = 'not_allowed' | 'upload_limit' | 'analysis_limit' | 'coach_limit';
export function openGuestUpgrade(reason: GuestUpgradeReason): void;
export function onGuestUpgrade(cb: (reason: GuestUpgradeReason) => void): () => void;
```
**Consumes:** `AuthedUser.isGuest` (D9), `GET /api/me/guest` (D6), error `guest_restricted` + `details.reason` (D6).

- [ ] **1. Failing tests**

```ts
// guest-upgrade-bus.test.ts
it('delivers to subscribers and stops after unsubscribe', () => {
  const seen: string[] = []; const off = onGuestUpgrade((r) => seen.push(r));
  openGuestUpgrade('upload_limit'); off(); openGuestUpgrade('not_allowed');
  expect(seen).toEqual(['upload_limit']);
});
```
```tsx
// @vitest-environment jsdom
// guest-shell.test.tsx — mocks: useAuth, fetcher, capture; QueryClient built with createMutationCache()
it('renders nothing for a real user', () => { auth = { user: { id: 'u', isGuest: false } }; const { container } = render(<GuestBanner />, { wrapper }); expect(container.innerHTML).toBe(''); });
it('tells a guest where they are and links to registration', () => {
  auth = { user: { id: 'g', isGuest: true } }; render(<GuestBanner />, { wrapper });
  expect(screen.getByText(/demo sandbox/i)).toBeTruthy();
  expect(screen.getByRole('link', { name: /create a free account/i }).getAttribute('href')).toBe('/register?from=demo');
  expect(document.body.textContent).not.toMatch(/public|shared|people|community/i);
});
it('canUpload follows the server state', async () => {
  auth = { user: { id: 'g', isGuest: true } }; vi.mocked(fetcher).mockResolvedValue({ expiresAt: 'x', uploadsUsed: 1, uploadsMax: 1, analysesUsed: 1, analysesMax: 1 });
  const { result } = renderHook(() => useGuestState(), { wrapper });
  await waitFor(() => expect(result.current.state).toBeDefined()); expect(result.current.canUpload).toBe(false);
});
it('never fetches guest state for a real user', () => { auth = { user: { id: 'u', isGuest: false } }; renderHook(() => useGuestState(), { wrapper }); expect(fetcher).not.toHaveBeenCalled(); });
it('a guest_restricted mutation opens the upgrade dialog with the reason', async () => {
  const seen: string[] = []; const off = onGuestUpgrade((r) => seen.push(r));
  const { result } = renderHook(() => useMutation({ mutationFn: () => Promise.reject(new ApiError(403, { error: { code: 'guest_restricted', message: 'm', details: { reason: 'analysis_limit' } } })) }), { wrapper });
  await act(async () => { await result.current.mutateAsync().catch(() => {}); }); off();
  expect(seen).toEqual(['analysis_limit']); expect(capture).toHaveBeenCalledWith('demo_guest_restricted', { reason: 'analysis_limit' });
});
it('any other 403 does not open it', async () => {
  const seen: string[] = []; const off = onGuestUpgrade((r) => seen.push(r));
  const { result } = renderHook(() => useMutation({ mutationFn: () => Promise.reject(new ApiError(403, { error: { code: 'forbidden', message: 'no' } })) }), { wrapper });
  await act(async () => { await result.current.mutateAsync().catch(() => {}); }); off();
  expect(seen).toEqual([]);
});
it('the dialog explains the limit and offers registration', () => {
  render(<GuestUpgradeDialog open reason="upload_limit" onOpenChange={() => {}} />, { wrapper });
  expect(screen.getByText(/one upload/i)).toBeTruthy();
  expect(screen.getByRole('link', { name: /create a free account/i }).getAttribute('href')).toBe('/register?from=demo');
});
```
- [ ] **2. RED. 3. Implement.** `guest-upgrade-bus.ts`: a module-level `Set` of listeners (the mutation cache is created outside React). `createMutationCache().onError`: before `mutationErrorToast`, `if (error instanceof ApiError && extractApiError(error.body).code === 'guest_restricted') { const reason = (…details?.reason ?? 'not_allowed') as GuestUpgradeReason; capture('demo_guest_restricted', { reason }); openGuestUpgrade(reason); return; }`. `_app.tsx`: mount `<GuestBanner />` above `AppWorkerHealthNotice`; one `GuestUpgradeDialog` driven by `onGuestUpgrade`; `+ Upload` renders `<Link to="/register" search={{ from: 'demo' }}>Create free account</Link>` when `guest.isGuest && !guest.canUpload`; the ⌘U handler and the global `UnifiedUploadDialog` are skipped for a guest with no upload left. `UnifiedUploadDialog`: `const guest = useGuestState();` — when `guest.isGuest && !guest.canUpload` return `<GuestUpgradeDialog open={open} onOpenChange={onOpenChange} reason="upload_limit" />`; wrap the three optional blocks; subtitle (`:729`) for guests reads "The demo sandbox includes one upload — your mix." `CoachGateInline`: for a guest the CTA is the register link, never pricing. Copy rules of Global Constraints apply. `register.tsx` needs no change (`from` is ignored by its `validateSearch`; add `from?: string` passthrough only if `tsc` demands it).
- [ ] **4. GREEN** + `npx vitest run src/components src/features/results src/routes`. **5. All gates. 6. Live check** (stack running, `Demo:Enabled=true` in dev): private window → `/demo` → banner visible; upload one tone wav → "+ Upload" becomes "Create free account"; stems block absent; `DELETE` a song from the library menu → upgrade dialog. Screenshots under `output/frontend-spectr-v2/<date>_guest-demo/`. **7. Commit** `feat(demo): guest banner, upload-once shell, upgrade dialog`.

---

### Task D11: Playwright smoke + deploy docs

**Files:** Create `FE/playwright/smoke-demo.spec.ts`. Modify `docs/azure-deploy-remaining-work.md` (Task 8), `docs/STARTUP.md` (one paragraph: `Demo:Enabled`, where a dev snapshot lives, how to export one), `components/bff/README.md` (guest demo section), `CLAUDE.md` (BFF key routes + the guest/lane gotchas, ≤12 lines).

- [ ] **1. Write the spec** (runs with the stack up, `LLM_FAKE=1`, `Demo:Enabled=true`):
```ts
import { expect, test } from '@playwright/test';
test('a visitor lands inside a working guest sandbox', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/demo');
  await expect(page).toHaveURL(/\/listen-rack\//, { timeout: 20_000 });
  await expect(page.getByText(/demo sandbox/i)).toBeVisible();
  const audio = await page.waitForResponse((r) => /\/api\/versions\/.+\/audio/.test(r.url()), { timeout: 20_000 });
  expect([200, 206, 302]).toContain(audio.status());
  await page.reload();                                   // same device → same sandbox, still signed in
  await expect(page).toHaveURL(/\/listen-rack\//);
  await expect(page.getByText(/demo sandbox/i)).toBeVisible();
});
test('a phone lands on the report, not the desktop-only page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await expect(page).toHaveURL(/\/songs\/.+\/results\//, { timeout: 20_000 });
});
test('the guest coach answers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/demo');
  await page.waitForURL(/\/listen-rack\//); await page.goto(page.url().replace(/\/listen-rack\/.*/, '/library'));
  await page.getByText(/^Demo: /).first().click(); await page.getByRole('link', { name: /report|results/i }).first().click();
  await page.getByPlaceholder(/ask/i).fill('What should I fix first?'); await page.keyboard.press('Enter');
  await expect(page.locator('.cmsg.bot .bub').last()).not.toBeEmpty({ timeout: 30_000 });
});
```
- [ ] **2. Run** `npx playwright test smoke-demo` against the local stack (foreground); fix selectors against the real DOM — never weaken an assertion to pass. **3. Docs** per spec §10 (analyze the chosen track in prod → open its report once → `curl … /api/admin/demo/snapshot` → verify `/demo` in a private window → flip `demo_enabled`). **4. All gates. 5. Commit** `test(demo): guest sandbox smoke; docs: snapshot install + demo flags`.

---

## Self-review

**Spec decision → task**

| Spec | Task(s) |
|---|---|
| D1 guest is a real user row | D1 (columns), D5 (creation, email/hash, login/forgot/register rules) |
| D2 fail-closed `POST /api/auth/demo` + resume | D5 |
| D3 server-side guest recognition (`AuthSnapshot`, claim, expiry) | D5 |
| D4 default-deny guard + allow/deny table | D6 |
| D5 one upload / one analysis / global arm / free lane / `GET /me/guest` | D6 (server), D10 (UI) |
| D6 snapshot seeding + fallback routing plan + exporter | D3, D4 |
| D7 guest coach cap + guest LLM lane | D6 (cap), D2 (lane + budget) |
| D8 purge + shared-key prefix | D7, D2 |
| D9 `/demo`, `startDemo`, epoch bump, cache clear, destination | D9 |
| D10 banner, upload-once, upgrade dialog, coach gate copy | D10 |
| D11 "use ours" | D8 |
| §4 migrations + nine flags | D1 |
| §7 security (register domain, forgot-password, token lifetime, isolation) | D5 (+ D6 isolation of writes) |
| §9 tests / §10 deploy step | every task / D11 |

**Type-consistency check** (every cross-task name, one spelling):
`User.IsGuest/GuestExpiresAt/GuestDeviceId` (D1→D5,D6,D7) · `is_shared_key` (D2) · `GUEST_TIER`, `resolve_lane`, `reset_lane_cache`, `_lookup_is_guest` (D2) · `llm_budget_guest_usd` (flag D1 = settings field D2) · `DemoSeedResult(SongId, VersionId, JobId, FromSnapshot)`, `DemoSeeder.SeedAsync/FindAsync`, `DemoSongPrefix` (D3→D5) · `DemoSnapshotFormat.Id/Prefix/DefaultKey`, `DemoSnapshotStore.GetAsync/Invalidate`, `DemoSnapshotTemplate.Materialize/Title` (D3→D4,D8) · config keys `Demo:SnapshotKey` (D3,D4,D8), `Demo:Enabled`, `Demo:DailyCap` (D5) · `GuestIdentity.EmailDomain/ClaimType/EmailFor/IsGuestEmail/Mark/SharedPasswordHash/DemoEnabled/Flag` (D5→D6) · `AuthSnapshot` (D5) · `ClaimsPrincipalExtensions.IsGuest()` (D5→D6) · `RefreshTokenService.IssueAsync(Guid, DateTimeOffset, ct)`, `RotateAsync(RefreshToken, DateTimeOffset?, ct)`, `CookieOptions(DateTimeOffset)` (D5) · `AuthedUser(…, bool IsGuest = false)` ↔ TS `isGuest?: boolean` (D5↔D9) · `DemoTarget`, `DemoStartResponse` C# ↔ TS (D5↔D9) · `GuestQuota`, `GuestAllowed`, `GuestDenied`, `GuestGuard.Filter/Restricted/AllowGuest/AllowGuestUpload/DenyGuest` (D6) · `GuestLimits.Flag/CheckUploadAsync/CheckAnalysisAsync/GetStateAsync` (D6; D5 uses `GuestIdentity.Flag`, which `GuestLimits.Flag` delegates to) · `GuestStateDto` C# ↔ TS (D6↔D10) · error codes `guest_restricted` + reasons `not_allowed|upload_limit|analysis_limit` (D6↔D10; `coach_limit` is UI-only), `demo_unavailable`, `demo_capacity` (D5,D6↔D9), `snapshot_not_ready`, `snapshot_leak`, `version_not_found` (D4), `sample_unavailable` (D8) · `AccountTeardown.TearDownAsync(User, string, string, ct)`, audit actions `account_delete|guest_purge|demo_snapshot_export` (D7,D4) · `AnonSampleDto` C# ↔ TS, `startSample`, `useAnonSample`, `CURRENT_JOB_KEY` (D8) · `LISTEN_MIN_WIDTH`, `DemoDestination`, `demoDestination`, `startDemo` (D9) · `useGuestState`, `GuestUpgradeReason`, `openGuestUpgrade`, `onGuestUpgrade`, query key `['me','guest']` (D10) · analytics `demo_cta_clicked|demo_started|demo_start_failed|demo_signup_clicked|demo_guest_restricted` (D9, used D10) and `analyze_sample_started` (D8).

**Shared test helpers:** (`Build`, `StartGuestAsync`, `Code`, `Reason`, `DeviceCookie`, `Wav`, `Form`, `RecordingQueue`, `ThrowingLimiter`, `AnalysisIdAsync`) are named with their one-line contract in the task that first uses them and live in a shared `GuestTestSupport.cs` created in D5.
