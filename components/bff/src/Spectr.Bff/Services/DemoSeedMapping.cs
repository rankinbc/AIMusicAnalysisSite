using System.Text.Json.Nodes;

namespace Spectr.Bff.Services;

// Pure, side-effect-free helpers for turning a snapshot's exported routing
// plan / metadata into something safe to seed. Kept separate from
// DemoSeeder so the id-remapping/DB-write orchestration file stays under
// ~500 lines.
internal static class DemoSeedMapping
{
    // Safe default when a plan can't be trusted at all (missing/malformed) —
    // an empty roster: nothing auto-runs, nothing 500s, still parses via
    // VerdictEndpoints.ParseRoutingPlan.
    public const string EmptyRoutingPlanJson =
        "{\"specialists_to_run\":[],\"skip\":[],\"rationale\":\"\",\"estimated_total_tokens\":0}";

    /// <summary>
    /// Fix-round-1 item 2 — controller ruling (deviates from spec §6's
    /// "export routingPlan verbatim"; money argument is one-sided):
    /// `CoachTab.tsx` (~lines 127-141) auto-runs every
    /// `plan.specialistsToRun` entry on first view via
    /// `POST …/verdicts/run/{slug}`, UNLESS a verdict for that slug already
    /// exists — `already` there is the set of `data.specialists` slugs whose
    /// `status !== 'idle'` (VerdictEndpoints.SpecialistStatus: 'cached' when
    /// any Verdict row has that specialist, 'failed' on the
    /// headline == "Specialist failed" sentinel — either way, "a verdict
    /// exists"), OR short-circuits entirely if any verdict has
    /// `source === 'llm_identifier'`. A routed specialist that never
    /// produced a verdict in the SOURCE analysis would otherwise fire a
    /// fresh paid LLM call for every single guest on page load — this is
    /// the LAST line of defence server-side (the exporter's own refusal is
    /// a later task). Rewrite `specialists_to_run` to keep only entries
    /// whose `name` is already covered by a seeded verdict (mirroring the
    /// same "does a verdict exist for this slug" rule), so nothing
    /// auto-runs; a guest can still start any specialist manually under the
    /// D7 cap. `skip` / `rationale` / `estimated_total_tokens` are kept
    /// verbatim — only the roster that would actually fire is trimmed.
    /// </summary>
    public static string RewriteRoutingPlanForSeed(string routingPlanJson, IReadOnlySet<string> coveredSpecialistSlugs)
    {
        try
        {
            if (JsonNode.Parse(routingPlanJson) is not JsonObject plan)
                return EmptyRoutingPlanJson;

            if (plan.ContainsKey("specialists_to_run"))
            {
                // Fix-round-2 item 1: `kept` starts empty and stays empty
                // unless the value is actually a JsonArray — a malformed
                // operator-supplied snapshot with specialists_to_run as a
                // string/number/object/null must never leave that
                // non-list value in place. VerdictEndpoints'
                // RoutingPlanDto expects a list; a non-list value there
                // would 500 every guest's GET …/verdicts, not just skip
                // seeding one specialist.
                var kept = new JsonArray();
                if (plan["specialists_to_run"] is JsonArray entries)
                {
                    foreach (var entry in entries)
                    {
                        if (entry is not JsonObject entryObj) continue;
                        if (entryObj["name"] is not JsonValue nameValue) continue;
                        if (!nameValue.TryGetValue<string>(out var slug)) continue;
                        if (coveredSpecialistSlugs.Contains(slug))
                            kept.Add(entry.DeepClone());
                    }
                }
                plan["specialists_to_run"] = kept;
            }

            return plan.ToJsonString();
        }
        catch (System.Text.Json.JsonException)
        {
            // Never let a malformed plan block registration.
            return EmptyRoutingPlanJson;
        }
    }

    /// <summary>
    /// Task D12 — a seeded demo's copied `final_json` can carry phase 7's
    /// `arrangement_status: "pending"` from the SOURCE analysis (background
    /// structure detection deferred at export time — phase7_arrangement.py).
    /// Nothing ever runs structure detection on a SEEDED copy —
    /// structure_actor.py only resolves `pending` on the ORIGINAL analysis
    /// id, which a seed never shares — so a seeded demo would show
    /// "Arrangement analysis running…" forever. Rewrite `pending` to
    /// `unavailable` (the status the UI already renders as "Not assessed for
    /// this track", commit dbe569d) at seed time. Everything else — other
    /// phases, other phase-7 keys, a `"scored"`, `"unavailable"`, or
    /// `"failed"` status — is left as-is. Malformed/empty JSON is returned
    /// unchanged; this must never throw at seed time.
    /// </summary>
    public static string NormalizeFinalJsonForSeed(string finalJson)
    {
        try
        {
            if (JsonNode.Parse(finalJson) is not JsonObject root)
                return finalJson;

            if (root["phases"] is not JsonArray phases)
                return finalJson;

            foreach (var phaseNode in phases)
            {
                if (phaseNode is not JsonObject phaseObj) continue;
                if (phaseObj["phase"] is not JsonValue phaseValue) continue;
                if (!phaseValue.TryGetValue<int>(out var phaseNumber) || phaseNumber != 7) continue;
                if (phaseObj["data"] is not JsonObject data) continue;
                if (data["arrangement_status"] is not JsonValue statusValue) continue;
                if (!statusValue.TryGetValue<string>(out var status) || status != "pending") continue;

                data["arrangement_status"] = "unavailable";
            }

            return root.ToJsonString();
        }
        catch (System.Text.Json.JsonException)
        {
            // Never let a malformed/empty final_json block seeding.
            return finalJson;
        }
    }

    /// <summary>
    /// Fix-round-1 item 9a — `songs.name` is varchar(200) (Song.cs
    /// `[MaxLength(200)]`). A title longer than that would 22001 the whole
    /// INSERT — and with it, in the SAME SaveChanges, every other seeded row
    /// (verdicts, conversation, rack presets) — degrading a real snapshot
    /// seed all the way down to "seeding failed" for a purely cosmetic
    /// reason. Truncate instead.
    /// </summary>
    public static string TruncateSongName(string name, int maxLength = 200)
        => name.Length <= maxLength ? name : name[..maxLength];
}
