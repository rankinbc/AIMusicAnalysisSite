using Microsoft.EntityFrameworkCore;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Fix wave FW2 (final review I4) — registered and converted accounts never
// expire, and DemoSeeder copies the live export's asset keys straight into
// their rows. Retiring an old export must therefore skip every key a row
// still points at, or those accounts' demo song breaks for good.
//
// Columns checked = every column DemoSeeder writes a snapshot key into:
//   song_versions.file_path                       (the audio)
//   analyses.spectrogram_image_path / waveform_image_path / waveform_peaks_path
// None of them is indexed. That is acceptable here: this runs once per admin
// export, as ONE batched query per table over the handful of expired keys,
// never on a request path.
public static class DemoSnapshotAssetRefs
{
    public static async Task<HashSet<string>> ReferencedAsync(
        AppDbContext db, IReadOnlyCollection<string> keys, CancellationToken ct)
    {
        var referenced = new HashSet<string>(StringComparer.Ordinal);
        if (keys.Count == 0) return referenced;
        var list = keys.Distinct().ToList();

        referenced.UnionWith(await db.SongVersions.AsNoTracking()
            .Where(v => list.Contains(v.FilePath))
            .Select(v => v.FilePath)
            .ToListAsync(ct));

        var images = await db.Analyses.AsNoTracking()
            .Where(a => (a.SpectrogramImagePath != null && list.Contains(a.SpectrogramImagePath))
                || (a.WaveformImagePath != null && list.Contains(a.WaveformImagePath))
                || (a.WaveformPeaksPath != null && list.Contains(a.WaveformPeaksPath)))
            .Select(a => new { a.SpectrogramImagePath, a.WaveformImagePath, a.WaveformPeaksPath })
            .ToListAsync(ct);
        foreach (var a in images)
            foreach (var k in new[] { a.SpectrogramImagePath, a.WaveformImagePath, a.WaveformPeaksPath })
                if (k is not null && list.Contains(k)) referenced.Add(k);

        return referenced;
    }
}
