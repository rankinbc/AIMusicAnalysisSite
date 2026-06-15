using System.Text.Json;

namespace Spectr.Bff.DTOs;

// Wire-format DTOs for the verdicts panel. The Python worker owns verdict IDs
// (ULID strings prefixed `vrd_`); the BFF never generates one.

public sealed record VerdictUserStateDto(
    bool Dismissed,
    bool Applied,
    string? Feedback);

public sealed record VerdictDto(
    string Id,
    Guid AnalysisId,
    string Specialist,
    string PromptVersion,
    string Model,
    string Severity,
    string Category,
    double Confidence,
    int PriorityScore,
    string? Impact,
    string? ChartType,
    string Headline,
    string? Summary,
    string? Body,
    string? MetricLine,
    string? WhyItMatters,
    string? PresetName,
    JsonElement Evidence,
    JsonElement? Fix,
    JsonElement Sources,
    DateTimeOffset CreatedAt,
    VerdictUserStateDto UserState);

// "idle"    = no verdict yet for (analysisId, slug).
// "cached"  = a verdict row exists.
// "failed"  = a fail-marker verdict exists (specialist run blew up).
// "running" is NEVER returned by the BFF — the frontend tracks it locally
//  between click and the next successful poll.
public sealed record SpecialistStatus(string Slug, string Status);

// Triage-step output: which specialists the LLM thinks are worth running
// against this mix, in priority order. Populated by the Python `run_triage`
// dramatiq actor and persisted on `analyses.routing_plan` (jsonb).
public sealed record RoutingPlanEntry(
    string Name,
    int Priority,
    string Focus);

public sealed record RoutingPlanDto(
    IReadOnlyList<RoutingPlanEntry> SpecialistsToRun,
    IReadOnlyList<string> Skip,
    string Rationale,
    int EstimatedTotalTokens);

// Story 1.4 / FR16: machine-readable notice the worker stamps on the
// analysis when LLM verdict generation is unavailable (per-tier or global
// monthly budget exhausted, or provider-outage circuit breaker tripped).
// Frontend renders the "rule-based findings only" banner + the coach
// offline state copy off this.
public sealed record DegradationNoticeDto(
    string Reason,             // "tier_budget" | "global_budget" | "circuit_breaker"
    string? Detail,            // operator-readable string from the gateway exception
    DateTimeOffset OccurredAt);

public sealed record VerdictsListResponse(
    IReadOnlyList<VerdictDto> Verdicts,
    IReadOnlyList<SpecialistStatus> Specialists,
    // Null until Triage has run for this analysis. The frontend treats
    // absence as "Triage hasn't fired yet" — UI shows a loading state.
    RoutingPlanDto? RoutingPlan,
    // Null on a healthy report. Non-null → render the degradation banner
    // + offline-coach copy; verdicts list contains rule-engine fallback rows.
    DegradationNoticeDto? Degradation);

public sealed record RunSpecialistResponse(string Status);  // "queued" | "exists"

public sealed record FeedbackRequest(string Feedback);  // "helpful" | "wrong" | "unclear"
