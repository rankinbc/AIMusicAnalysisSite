namespace Spectr.Bff.Tests;

// D3 — SYNTHETIC snapshot fixture (repo is public: no real audio/report/email
// ever appears here). Mirrors the spec §6 `spectr-demo-snapshot/v1` shape.
internal static class DemoSnapshotFixture
{
    public const string SourceJob = "11111111-1111-1111-1111-111111111111";
    public const string SourceVerdict = "vrd_01SOURCEAAAAAAAAAAAAAAAAAA";
    // NOTE (D3 deviation): the brief's snippet used a $$ raw-string prefix with
    // {{X}} interpolation holes, but this JSON's nested "modules":{"eq":{...}}
    // closes with two adjacent '}' (…"enabled":true}}…) which collides with the
    // $$ delimiter width (CS9007: ambiguous whether "}}" ends an interpolation
    // or is two literal braces). Bumped to $$$ / {{{X}}} — same content, wider
    // delimiter so the literal "}}" run is unambiguous.
    public static string Json(string audioKey) => $$$"""
    { "format":"spectr-demo-snapshot/v1","exportedAt":"2026-09-20T00:00:00Z",
      "source":{"songId":"22222222-2222-2222-2222-222222222222","versionId":"33333333-3333-3333-3333-333333333333","jobId":"{{{SourceJob}}}","analysisId":"44444444-4444-4444-4444-444444444444"},
      "song":{"title":"Fixture Track","genreHint":"house"},
      "version":{"audioKey":"{{{audioKey}}}"},
      "analysis":{"finalJson":{"grade":"C","overall_score":61,"job_ref":"{{{SourceJob}}}"},"routingPlan":{"specialists":["low_end"]},
                  "pipelineVersion":"t","ruleEngineVersion":"t","validatorVersion":"t","promptSetVersion":"t","phaseDurations":{},
                  "stemMetrics":null,"spectrogramImageKey":null,"waveformImageKey":null,"waveformPeaksKey":null},
      "verdicts":[
        {"id":"{{{SourceVerdict}}}","specialist":"low_end","promptVersion":"low_end@1.0.0","model":"fixture","severity":"moderate","category":"low_end",
         "confidence":0.8,"priorityScore":90,"impact":"med","chartType":null,"headline":"Sub build-up","summary":"s","body":"b","metricLine":null,
         "whyItMatters":"w","presetName":null,"evidence":[],"fix":{"ops":[{"type":"peaking_eq","frequency_hz":45,"gain_db":-3,"q":1.2}]},
         "sources":["llm"],"problemId":null,"kind":"fault","source":"llm_identifier","dataTier":"audio_only","fixable":true,"suspected":false,
         "where":null,"refines":null,"priorityBase":60,"priorityCategoryWeight":1.3,"priorityScopeMultiplier":1.0,"scope":"full_track"},
        {"id":"vrd_01SOURCEBBBBBBBBBBBBBBBBBB","specialist":"rule_engine.true_peak","promptVersion":"rule_engine@1","model":"rule","severity":"minor","category":"loudness",
         "confidence":0.9,"priorityScore":40,"impact":"low","chartType":null,"headline":"True peak high","summary":"s","body":null,"metricLine":null,
         "whyItMatters":null,"presetName":null,"evidence":[],"fix":null,"sources":["rule_engine"],"problemId":"loudness.true_peak.0","kind":"fault",
         "source":"rule_engine","dataTier":"audio_only","fixable":true,"suspected":false,"where":null,"refines":null,
         "priorityBase":20,"priorityCategoryWeight":1.0,"priorityScopeMultiplier":1.0,"scope":"full_track"}],
      "conversation":{"messages":[
        {"role":"user","status":"complete","mode":"qa","content":"What first?","evidence":null,"refusalReason":null},
        {"role":"assistant","status":"complete","mode":"qa","content":"Tame the sub ({{{SourceVerdict}}}).","evidence":[{"label":"45 Hz"}],"refusalReason":null}]},
      "rackPresets":[{"name":"Fix Rack","source":"analysis","chain":{"order":["eq"],"modules":{"eq":{"enabled":true}},"masterBypass":false},"coachMeta":null}] }
    """;
}
