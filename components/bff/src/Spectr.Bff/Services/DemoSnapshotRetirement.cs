using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Spectr.Bff.Auth;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Extracted from AdminEndpoints.DemoSnapshot.cs (final fix wave FW2 — that
// file was already at the ~500-line budget) — the exporter's DEFERRED
// asset-retirement half (fix-round-3 / G7a): a guest already mid-session
// against export A must keep working against A's audio for the rest of
// their guest lifetime, so a superseded export's assets are staged into a
// manifest ("<dir>retired.json") instead of being deleted on the spot, and
// only actually deleted once they're older than guest_ttl_hours + 1h grace.
//
// I4 fix (final fix wave FW2) — that sweep used to delete an expired key
// unconditionally. A registered (or converted) account's demo, seeded from
// an OLDER export, keeps pointing at that export's keys forever (registered
// accounts never expire) — RunAsync now checks
// DemoSnapshotAssetReferences.IsReferencedAsync before deleting and, if
// still referenced, keeps the key in the manifest for the next retire pass
// to re-check instead of deleting it out from under a live account.
public static class DemoSnapshotRetirement
{
    // Reuses AdminEndpoints' relaxed-escaping JSON options: this document is
    // only ever written to storage and re-parsed as JSON, never embedded in
    // HTML — see AdminEndpoints.DemoSnapshot.cs's own comment on the field.
    private static JsonSerializerOptions ManifestJsonOptions => Endpoints.AdminEndpoints.SnapshotDocOptions;

    // One entry of the deferred-retirement manifest: the asset keys ONE
    // export's predecessor owned, plus when that predecessor was superseded.
    internal sealed class RetiredManifestEntry
    {
        [JsonPropertyName("keys")] public List<string> Keys { get; set; } = [];
        [JsonPropertyName("retiredAt")] public DateTimeOffset RetiredAt { get; set; }
    }

    // Fix-round-2 item (a) — every hold must pass before a key read from an
    // untrusted OLD snapshot.json is ever deleted. I4 inventory item: the
    // manifest key itself ("<dir>retired.json") was excluded from nothing —
    // it lives under `dir` like every real asset key, so without this check
    // a tampered/foreign manifest entry naming ITSELF would pass every other
    // guard and delete the manifest mid-sweep.
    internal static bool IsRetireableAssetKey(string key, string dir, string snapshotKey, string exportDir)
    {
        if (!DemoSnapshotStore.IsSharedKey(key)) return false;
        if (!key.StartsWith(dir, StringComparison.Ordinal)) return false;
        if (key == snapshotKey) return false;
        var manifestKey = dir + "retired.json";
        if (key == manifestKey) return false;
        if (key.StartsWith(exportDir, StringComparison.Ordinal)) return false; // never the NEW export's own assets
        return true;
    }

    // Reads the asset keys the CURRENTLY LIVE snapshot.json names, so they
    // can be staged for retirement after a NEW export goes live.
    // Missing/corrupt/unparseable -> empty list: never block or fail an
    // export over the old document.
    public static async Task<List<string>> ReadPreviousAssetKeysAsync(
        IFileStorage storage, string snapshotKey, CancellationToken ct)
    {
        var keys = new List<string>();
        try
        {
            if (!await storage.ExistsAsync(snapshotKey, ct)) return keys;
            await using var stream = await storage.OpenReadAsync(snapshotKey, ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var root = doc.RootElement;
            if (root.TryGetProperty("version", out var v) && v.TryGetProperty("audioKey", out var a)
                && a.ValueKind == JsonValueKind.String && a.GetString() is { Length: > 0 } audioKey)
                keys.Add(audioKey);
            if (root.TryGetProperty("analysis", out var an))
            {
                foreach (var prop in new[] { "spectrogramImageKey", "waveformImageKey", "waveformPeaksKey" })
                    if (an.TryGetProperty(prop, out var el) && el.ValueKind == JsonValueKind.String
                        && el.GetString() is { Length: > 0 } key)
                        keys.Add(key);
            }
        }
        catch
        {
            return []; // corrupt previous snapshot — nothing safe to retire
        }
        return keys;
    }

    // Never blocks or fails the export: every failure mode (corrupt/missing
    // manifest, a flags read failure, a reference-check failure, an
    // individual delete failure, a failure writing the manifest back) is
    // caught and logged here, never propagated. `now` is an optional seam
    // for deterministic direct testing of the cutoff math — production
    // callers omit it (defaults to DateTimeOffset.UtcNow).
    public static async Task RunAsync(
        IFileStorage storage, EntitlementService ents, AppDbContext db, ILogger logger,
        string dir, string snapshotKey, string exportDir, List<string> previousAssetKeys,
        CancellationToken ct, DateTimeOffset? now = null)
    {
        var resolvedNow = now ?? DateTimeOffset.UtcNow;
        var manifestKey = dir + "retired.json";
        try
        {
            var entries = await ReadManifestAsync(storage, logger, manifestKey, ct);

            if (previousAssetKeys.Count > 0)
                entries.Add(new RetiredManifestEntry { Keys = previousAssetKeys, RetiredAt = resolvedNow });

            var ttlHours = 24;
            try
            {
                var flags = await ents.GetFlagsAsync(ct);
                ttlHours = GuestIdentity.Flag(flags, "guest_ttl_hours", 24);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "Could not read guest_ttl_hours flag for demo snapshot retirement — using the 24h default");
            }
            var cutoff = resolvedNow - TimeSpan.FromHours(ttlHours + 1);

            var remaining = new List<RetiredManifestEntry>();
            foreach (var entry in entries)
            {
                if (entry.RetiredAt >= cutoff) { remaining.Add(entry); continue; }

                // Expired — best-effort delete through the ownership guard,
                // PLUS (I4) a live-reference check per key. A key still
                // referenced is skipped AND kept in the manifest (its
                // original RetiredAt preserved) so the NEXT export's retire
                // pass re-checks it, rather than deleting it out from under
                // a registered/converted account's demo.
                var stillHeld = new List<string>();
                foreach (var key in entry.Keys)
                {
                    if (!IsRetireableAssetKey(key, dir, snapshotKey, exportDir))
                    {
                        logger.LogWarning(
                            "Refusing to retire demo snapshot asset outside its own directory: {Key}", key);
                        continue;
                    }

                    bool referenced;
                    try
                    {
                        referenced = await DemoSnapshotAssetReferences.IsReferencedAsync(db, key, ct);
                    }
                    catch (Exception ex)
                    {
                        // Fail toward KEEPING the asset — a failed reference
                        // lookup must never cost a live account its demo.
                        logger.LogWarning(ex,
                            "Could not check references for demo snapshot asset {Key} — keeping it", key);
                        referenced = true;
                    }
                    if (referenced) { stillHeld.Add(key); continue; }

                    try { await storage.DeleteAsync(key, ct); }
                    catch (Exception ex) { logger.LogWarning(ex, "Could not retire old demo snapshot asset {Key}", key); }
                }
                if (stillHeld.Count > 0)
                    remaining.Add(new RetiredManifestEntry { Keys = stillHeld, RetiredAt = entry.RetiredAt });
            }

            var json = JsonSerializer.Serialize(remaining, ManifestJsonOptions);
            await storage.WriteAsync(manifestKey, new MemoryStream(Encoding.UTF8.GetBytes(json)), "application/json", ct);
        }
        catch (Exception ex)
        {
            // Never turn a successful export into an error response.
            logger.LogWarning(ex, "Demo snapshot retirement step failed for {ManifestKey} — skipped this round", manifestKey);
        }
    }

    // Missing/corrupt/unparseable manifest -> empty list, logged: never block
    // or fail an export over a damaged retirement manifest. The next
    // successful export replaces it with a fresh, valid one.
    private static async Task<List<RetiredManifestEntry>> ReadManifestAsync(
        IFileStorage storage, ILogger logger, string manifestKey, CancellationToken ct)
    {
        try
        {
            if (!await storage.ExistsAsync(manifestKey, ct)) return [];
            await using var stream = await storage.OpenReadAsync(manifestKey, ct);
            var entries = await JsonSerializer.DeserializeAsync<List<RetiredManifestEntry>>(stream, cancellationToken: ct);
            return entries ?? [];
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Corrupt demo snapshot retirement manifest at {Key} — treating as empty", manifestKey);
            return [];
        }
    }
}
