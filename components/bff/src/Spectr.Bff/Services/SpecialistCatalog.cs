namespace Spectr.Bff.Services;

// Canonical list of specialist slugs. MUST stay in sync with the Python
// worker's `verdict_lib.prompt_loader.SLUG_TO_FILENAME` keys (1:1).
//
// Adding a new specialist:
//   1. Add the .md prompt file under components/worker/prompts/experts/.
//   2. Add the slug → filename map entry in verdict_lib/prompt_loader.py.
//   3. Add the slug to this list.
public static class SpecialistCatalog
{
    public static readonly IReadOnlyList<string> Slugs = new[]
    {
        "low_end",
        "frequency_balance",
        "dynamics",
        "stereo_phase",
        "loudness",
        "sections",
        "trance_arrangement",
        "stem_reference",
        "harmonic",
        "clarity",
        "spatial",
        "surround",
        "playback",
        "overall",
        "gain_staging",
        "stereo_field",
        "frequency_collision",
        "humanization",
        "section_contrast",
        "density",
        "chord_harmony",
        "device_chain",
        "priority_summary",
        "stem_balance",
        "stem_stereo_width",
        "stem_reference_delta",
    };

    public static readonly HashSet<string> SlugSet = new(Slugs, StringComparer.Ordinal);
}
