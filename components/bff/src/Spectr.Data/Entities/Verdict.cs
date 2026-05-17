using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Promoted from a JSONB array on analyses to a first-class table.
// One row per LLM specialist finding. Indexed for cross-track queries.
//
// ID is a ULID string ("vrd_..."), not a Guid, to preserve compatibility with
// the Python verdict-pipeline ulid helpers (aimusic_shared/verdicts/ulid_helpers).

[Table("verdicts")]
public sealed class Verdict
{
    [Column("id"), MaxLength(40)]
    public required string Id { get; set; }

    [Column("analysis_id")]
    public Guid AnalysisId { get; set; }

    // Specialist that produced this verdict (slug from prompt_loader.SLUG_TO_FILENAME)
    [Column("specialist"), MaxLength(64)]
    public required string Specialist { get; set; }

    [Column("prompt_version"), MaxLength(120)]
    public required string PromptVersion { get; set; }    // "<slug>@<semver>"

    [Column("model"), MaxLength(60)]
    public required string Model { get; set; }            // claude-cli, claude-api, etc.

    [Column("severity"), MaxLength(20)]
    public required string Severity { get; set; }         // critical|severe|moderate|minor|win

    [Column("category"), MaxLength(40)]
    public required string Category { get; set; }         // low_end|frequency|dynamics|stereo|loudness|arrangement|...

    [Column("confidence")]
    public double Confidence { get; set; }                // 0.0–1.0 (LLM self-report, clamped to [0.5, 0.95])

    [Column("priority_score")]
    public int PriorityScore { get; set; }                // server-computed via scoring formula

    [Column("impact"), MaxLength(8)]
    public string Impact { get; set; } = "med";           // high|med|low (mapped from severity+score)

    [Column("chart_type"), MaxLength(20)]
    public string? ChartType { get; set; }                // lufs|frequency|eq-curve|sidechain|arrangement|stems

    [Column("headline"), MaxLength(120)]
    public required string Headline { get; set; }

    [Column("summary"), MaxLength(400)]
    public string? Summary { get; set; }                  // short form (~1 sentence)

    [Column("body")]
    public string? Body { get; set; }                     // long form (2–3 sentences)

    [Column("metric_line"), MaxLength(240)]
    public string? MetricLine { get; set; }               // "-11.2 LUFS · -14 SPOTIFY · 5.4 LU DYN"

    [Column("why_it_matters"), MaxLength(280)]
    public string? WhyItMatters { get; set; }

    [Column("preset_name"), MaxLength(120)]
    public string? PresetName { get; set; }               // optional, e.g. "Spotify-safe master"

    // ── Structured data ───────────────────────────────────────────────────
    [Column("evidence", TypeName = "jsonb")]
    public string Evidence { get; set; } = "[]";          // [{metric, value, expected_range, label}, ...]

    // Full fix object including fix.steps[] — the Apply Preset wire format.
    // Shape: { fix_id, target: {type, name}, section, dsp_chain, steps: [{kind, where, what, from, to}],
    //          sidechain, expected_outcome, ableton_hint }
    [Column("fix", TypeName = "jsonb")]
    public string? Fix { get; set; }

    [Column("sources", TypeName = "jsonb")]
    public string Sources { get; set; } = "[]";

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
