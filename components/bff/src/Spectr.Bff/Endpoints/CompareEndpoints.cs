using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

public static class CompareEndpoints
{
    public static IEndpointRouteBuilder MapCompareEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/compare").WithTags("compare").RequireAuthorization();
        g.MapGet("/", Compare);

        // Per-user × per-version-pair notes (Change C).
        // Pair is normalized (A↔B → same row) so order doesn't matter to callers.
        g.MapGet("/notes", GetNotes);
        g.MapPut("/notes", PutNotes).AllowGuest(); // Task D6 (spec D4)
        g.MapDelete("/notes", DeleteNotes).AllowGuest();

        return app;
    }

    // GET /api/compare?versionA={guid}&versionB={guid}
    //
    // Pulls the latest Analysis row per version and projects its `final_json`
    // into a flat CompareSideDto. Sides A and B must belong to the same song
    // owned by the caller; the frontend computes deltas locally so we can add
    // metrics by extending CompareSideDto without touching delta-render code.
    private static async Task<IResult> Compare(
        [FromQuery] Guid versionA,
        [FromQuery] Guid versionB,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        if (versionA == Guid.Empty || versionB == Guid.Empty)
            return Results.BadRequest(new { error = "versionA and versionB required." });
        if (versionA == versionB)
            return Results.BadRequest(new { error = "versionA and versionB must differ." });

        var userId = currentUser.UserId();

        // Single query: pull both versions + ownership + most-recent analysis.
        // EF can't project final_json (a string) into a Dictionary<string,double>
        // directly, so we hydrate the rows here and call a JSON helper below.
        var rows = await (
            from v in db.SongVersions.AsNoTracking()
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            where (v.Id == versionA || v.Id == versionB) && s.UserId == userId
            select new { v, s.UserId }
        ).ToListAsync(ct);
        if (rows.Count != 2) return Results.NotFound();
        var rowA = rows.First(r => r.v.Id == versionA).v;
        var rowB = rows.First(r => r.v.Id == versionB).v;
        if (rowA.SongId != rowB.SongId)
            return Results.BadRequest(new { error = "Versions must belong to the same song." });

        // Latest analysis per version. Multiple re-analyses pick the newest.
        var analyses = await db.Analyses.AsNoTracking()
            .Where(a => a.UserId == userId
                && (a.VersionId == versionA || a.VersionId == versionB))
            .GroupBy(a => a.VersionId!.Value)
            .Select(g => g.OrderByDescending(a => a.CreatedAt).First())
            .ToListAsync(ct);
        var analysisA = analyses.FirstOrDefault(a => a.VersionId == versionA);
        var analysisB = analyses.FirstOrDefault(a => a.VersionId == versionB);

        var sideA = ToSide(rowA, analysisA);
        var sideB = ToSide(rowB, analysisB);
        return Results.Ok(new CompareResponseDto(rowA.SongId, sideA, sideB, Source: "analysis"));
    }

    private static CompareSideDto ToSide(SongVersion v, Analysis? a)
    {
        if (a is null)
        {
            return new CompareSideDto(
                v.Id, v.VersionNumber, v.Label, v.CreatedAt,
                null, null, null, null, null, null, null,
                null, null, null, null);
        }

        // final_json shape: { grade, overall_score, phases: [{phase, data: {...}}], ... }
        var fj = ParseDocument(a.FinalJson);
        var grade = ReadString(fj, "grade");
        var score = ReadNumber(fj, "overall_score");
        var phase1 = FindPhaseData(fj, 1);
        var phase2 = FindPhaseData(fj, 2);

        return new CompareSideDto(
            VersionId: v.Id,
            VersionNumber: v.VersionNumber,
            Label: v.Label,
            CreatedAt: v.CreatedAt,
            Grade: grade,
            Score: score,
            Lufs: ReadNumber(phase1, "lufs"),
            TruePeakDb: ReadNumber(phase1, "true_peak_db") ?? ReadNumber(phase1, "peak_dbfs"),
            RmsDb: ReadNumber(phase1, "rms"),
            Bpm: ReadNumber(phase1, "bpm") ?? ReadNumber(phase2, "bpm"),
            DetectedKey: ReadString(phase1, "detected_key"),
            StereoWidth: ReadNumber(phase1, "stereo_width"),
            StereoCorrelation: ReadNumber(phase1, "stereo_correlation"),
            MonoCompatibility: ReadNumber(phase1, "mono_compatibility"),
            Bands: ReadBands(phase1));
    }

    // ── Tiny JSON helpers ────────────────────────────────────────────────────
    // Kept inline because compare is the only consumer; if more endpoints
    // need to crack final_json this should move to a shared helper.

    private static JsonElement? ParseDocument(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.Clone();
        }
        catch (JsonException) { return null; }
    }

    private static JsonElement? FindPhaseData(JsonElement? fj, int phaseNumber)
    {
        if (fj is null || fj.Value.ValueKind != JsonValueKind.Object) return null;
        if (!fj.Value.TryGetProperty("phases", out var phases)) return null;
        if (phases.ValueKind != JsonValueKind.Array) return null;
        foreach (var p in phases.EnumerateArray())
        {
            if (p.TryGetProperty("phase", out var ph) && ph.TryGetInt32(out var n) && n == phaseNumber)
            {
                if (p.TryGetProperty("data", out var d)) return d;
                return null;
            }
        }
        return null;
    }

    private static double? ReadNumber(JsonElement? obj, string key)
    {
        if (obj is null || obj.Value.ValueKind != JsonValueKind.Object) return null;
        if (!obj.Value.TryGetProperty(key, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
        return null;
    }

    private static string? ReadString(JsonElement? obj, string key)
    {
        if (obj is null || obj.Value.ValueKind != JsonValueKind.Object) return null;
        if (!obj.Value.TryGetProperty(key, out var v)) return null;
        return v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    }

    private static Dictionary<string, double>? ReadBands(JsonElement? phase1)
    {
        if (phase1 is null) return null;
        if (!phase1.Value.TryGetProperty("bands", out var bands)) return null;
        if (bands.ValueKind != JsonValueKind.Object) return null;
        var dict = new Dictionary<string, double>();
        foreach (var prop in bands.EnumerateObject())
        {
            if (prop.Value.ValueKind == JsonValueKind.Number)
                dict[prop.Name] = prop.Value.GetDouble();
        }
        return dict.Count > 0 ? dict : null;
    }

    // ── Compare notes (Change C) ─────────────────────────────────────────────

    public sealed record CompareNoteBody(string Body);

    // Normalize the pair so A↔B collapse to one row (Guid ordinal sort).
    private static (Guid lo, Guid hi) Norm(Guid a, Guid b) =>
        a.CompareTo(b) <= 0 ? (a, b) : (b, a);

    // GET /api/compare/notes?versionA=&versionB=
    // Returns { body: "" } when no note exists for this user+pair.
    private static async Task<IResult> GetNotes(
        Guid versionA, Guid versionB, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var (lo, hi) = Norm(versionA, versionB);
        var row = await db.VersionCompareNotes.AsNoTracking()
            .FirstOrDefaultAsync(n => n.UserId == userId && n.VersionAId == lo && n.VersionBId == hi, ct);
        return Results.Ok(new CompareNoteBody(row?.Body ?? ""));
    }

    // PUT /api/compare/notes?versionA=&versionB=  body: { "body": "..." }
    // Upserts. Ownership check via the lo-id version's song → caller.
    // Race-hardened: concurrent inserts catch DbUpdateException, re-read, update.
    private static async Task<IResult> PutNotes(
        Guid versionA, Guid versionB, CompareNoteBody input,
        ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var (lo, hi) = Norm(versionA, versionB);

        // Ownership: verify the lo version belongs to the caller.
        var songId = await db.SongVersions.AsNoTracking()
            .Where(v => v.Id == lo && db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId))
            .Select(v => (Guid?)v.SongId).FirstOrDefaultAsync(ct);
        if (songId is null) return Results.NotFound();

        var row = await db.VersionCompareNotes
            .FirstOrDefaultAsync(n => n.UserId == userId && n.VersionAId == lo && n.VersionBId == hi, ct);
        if (row is null)
        {
            db.VersionCompareNotes.Add(new VersionCompareNote
            {
                UserId = userId, SongId = songId.Value, VersionAId = lo, VersionBId = hi, Body = input.Body,
            });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // Concurrent insert won the race; detach, re-read, update.
                db.ChangeTracker.Clear();
                row = await db.VersionCompareNotes
                    .FirstOrDefaultAsync(n => n.UserId == userId && n.VersionAId == lo && n.VersionBId == hi, ct);
                if (row is not null)
                {
                    row.Body = input.Body;
                    row.UpdatedAt = DateTimeOffset.UtcNow;
                    await db.SaveChangesAsync(ct);
                }
            }
        }
        else
        {
            row.Body = input.Body;
            row.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(new CompareNoteBody(input.Body));
    }

    // DELETE /api/compare/notes?versionA=&versionB= → 204 (idempotent)
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
}
