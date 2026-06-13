using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Per-call LLM metering (story 1.3, AR7). One row per gateway call — every
// outcome (ok / error). WRITTEN BY THE WORKER via SQLAlchemy; the BFF maps it
// read-only for the Epic-10 operator spend/quality dashboards. The Python
// gateway (components/worker/app/llm/gateway.py) is the sole writer.

[Table("llm_calls")]
public sealed class LlmCall
{
    // ULID string ("llm_..."), matching the verdict id convention.
    [Key]
    [Column("id"), MaxLength(40)]
    public required string Id { get; set; }

    // Nullable until Epic 2 stamps tier; triage carries the analysis owner.
    [Column("user_id")]
    public Guid? UserId { get; set; }

    [Column("tier"), MaxLength(20)]
    public string? Tier { get; set; }

    [Column("purpose"), MaxLength(20)]
    public required string Purpose { get; set; }   // triage | specialist | coach

    [Column("prompt_slug"), MaxLength(64)]
    public string? PromptSlug { get; set; }

    [Column("prompt_version"), MaxLength(120)]
    public string? PromptVersion { get; set; }

    [Column("model"), MaxLength(60)]
    public required string Model { get; set; }

    [Column("input_tokens")]
    public int InputTokens { get; set; }

    [Column("output_tokens")]
    public int OutputTokens { get; set; }

    [Column("cost_usd", TypeName = "numeric(12,6)")]
    public decimal CostUsd { get; set; }

    [Column("price_table_version"), MaxLength(20)]
    public string? PriceTableVersion { get; set; }

    [Column("latency_ms")]
    public int LatencyMs { get; set; }

    [Column("outcome"), MaxLength(20)]
    public required string Outcome { get; set; }   // ok | validation_rejected | error | refused

    [Column("correlation_id"), MaxLength(64)]
    public string? CorrelationId { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
