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

    // ── IDENTIFY-tier Problem fields (deterministic rule engine) ────────────
    // Stable "<category>.<slug>.<index>" id; null for legacy/LLM verdicts.
    [Column("problem_id"), MaxLength(80)]
    public string? ProblemId { get; set; }

    [Column("kind"), MaxLength(20)]
    public string Kind { get; set; } = "fault";          // fault|observation|integrity

    [Column("source"), MaxLength(20)]
    public string Source { get; set; } = "rule_engine";  // rule_engine|llm_identifier

    [Column("data_tier"), MaxLength(20)]
    public string DataTier { get; set; } = "audio_only"; // audio_only|stems|project_midi

    [Column("fixable")]
    public bool Fixable { get; set; } = true;

    [Column("suspected")]
    public bool Suspected { get; set; }                  // placeholder-threshold flag

    // SQL reserved word — Npgsql quotes it. jsonb-as-string, same pattern as Fix.
    [Column("where", TypeName = "jsonb")]
    public string? Where { get; set; }                   // {section_type, start_seconds, end_seconds}

    [Column("refines"), MaxLength(80)]
    public string? Refines { get; set; }                 // parent composite problem_id

    // ── Priority-score breakdown (results v4) ───────────────────────────────
    // Nullable — legacy rows are not backfilled; the UI degrades to score-only.
    // Invariant on new rows: priority_score ≡ round(base × catW × scopeM).
    [Column("priority_base")]
    public int? PriorityBase { get; set; }               // severity base (20–200)

    [Column("priority_category_weight")]
    public double? PriorityCategoryWeight { get; set; }  // 1.0–1.5

    [Column("priority_scope_multiplier")]
    public double? PriorityScopeMultiplier { get; set; } // 0.6–1.0

    [Column("scope"), MaxLength(20)]
    public string? Scope { get; set; }                   // full_track|multi_section|single_section|single_stem
}
