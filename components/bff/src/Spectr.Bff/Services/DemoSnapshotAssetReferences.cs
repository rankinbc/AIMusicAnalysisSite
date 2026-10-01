using Microsoft.EntityFrameworkCore;
using Spectr.Data;

namespace Spectr.Bff.Services;

// I4 (final fix wave FW2) — before the exporter's deferred-retirement sweep
// (DemoSnapshotRetirement) deletes a previous export's asset key, confirm no
// row still references it. Registration seeds a registered (or later
// converted) account's OWN copy of the snapshot's keys
// (DemoSeeder.SeedFromSnapshotAsync: song_versions.file_path = the audio
// key; analyses.spectrogram_image_path / waveform_image_path /
// waveform_peaks_path = the image keys) and those accounts never expire —
// only a purged, never-converted GUEST's row goes away, at which point the
// key legitimately has no more referrers left. RetireOldAssetsAsync used to
// delete a key the moment it aged past guest_ttl_hours + 1h with no such
// check, permanently 404-ing every account still seeded from that export.
//
// Columns checked (none indexed today — a full scan per key, acceptable at
// export time: rare, admin-triggered, at most a handful of keys per retire
// pass; a candidate for an index if export volume/account count grows a
// lot):
//   song_versions.file_path            (SongVersion has no index on FilePath)
//   analyses.spectrogram_image_path    (Analysis has no index on this column)
//   analyses.waveform_image_path       (Analysis has no index on this column)
//   analyses.waveform_peaks_path       (Analysis has no index on this column)
// These are the only two tables the exporter/seeder write a snapshot key
// into (AdminEndpoints.DemoSnapshot.cs's BuildSnapshotDocument writes
// exactly audioKey/spectrogramKey/waveformKey/peaksKey; RackPreset.ChainJson
// carries DSP parameters, never a storage key).
public static class DemoSnapshotAssetReferences
{
    public static async Task<bool> IsReferencedAsync(AppDbContext db, string key, CancellationToken ct)
    {
        if (await db.SongVersions.AsNoTracking().AnyAsync(v => v.FilePath == key, ct))
            return true;
        return await db.Analyses.AsNoTracking().AnyAsync(a =>
            a.SpectrogramImagePath == key || a.WaveformImagePath == key || a.WaveformPeaksPath == key, ct);
    }
}
