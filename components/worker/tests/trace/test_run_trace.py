"""Phase 6: the run-trace builder reconstructs the full decision flow from a
persisted final_json, with non-empty input + output payloads at every stage."""
from __future__ import annotations

from app.trace.run_trace import build_run_trace, read_trace, trace_runs_enabled
from app.verdict_lib import rule_engine as RE


def _pipeline_final_json():
    """Real pipeline-shape final_json (phases as a list) that fires clipping."""
    return {
        "grade": "F",
        "overall_score": 42,
        "phases": [
            {"phase": 1, "name": "loudness", "data": {
                "clipping_detected": True, "clipped_sample_count": 1234,
                "true_peak_db": -1.5, "mono_compatibility": 0.95, "lufs": -8.0}},
            {"phase": 2, "name": "genre", "data": {"genre": "techno"}},
        ],
    }


def test_build_run_trace_has_all_stages_with_payloads():
    trace = build_run_trace(
        run_id="r1", analysis_id="a1", created_at="2026-06-26T00:00:00+00:00",
        final_json=_pipeline_final_json(),
        analysis_inputs={"file_path": "audio/x.wav"},
    )
    d = trace.to_dict()
    assert d["run_id"] == "r1" and d["analysis_id"] == "a1"
    assert set(d["stages"]) == {"analysis", "flatten", "identify", "solve", "llm_routing", "final"}

    # analysis: input is the run args, output is the full final_json, per-phase outputs split out
    analysis = d["stages"]["analysis"]
    assert analysis["input"] == {"file_path": "audio/x.wav"}
    assert analysis["output"]["overall_score"] == 42
    assert [p["phase"] for p in analysis["phases"]] == [1, 2]
    assert analysis["phases"][0]["output"]["clipped_sample_count"] == 1234

    # flatten: input/output payloads present
    assert d["stages"]["flatten"]["input"]["overall_score"] == 42
    assert d["stages"]["flatten"]["output"]["phase1"]["clipped_sample_count"] == 1234

    # identify: per-rule decisions recorded + a clipping problem in the output
    ident = d["stages"]["identify"]
    assert ident["decisions"]["singles"]  # every single's fire/skip recorded
    assert any(s.get("fired") for s in ident["decisions"]["singles"])
    assert any(str(v["problem_id"]).startswith("clipping") for v in ident["output"])

    # solve: route decisions + chain output present
    solve_stage = d["stages"]["solve"]
    assert isinstance(solve_stage["routes"], list) and solve_stage["routes"]
    assert isinstance(solve_stage["output"], dict)
    assert isinstance(solve_stage["change_log"], list)

    # final + summary
    assert d["stages"]["final"]["verdicts"]
    assert d["summary"]["problems"] >= 1


def test_llm_routing_carried_through():
    calls = [{"request": {"model": "claude-haiku", "system": "sys", "user": "u"},
              "response": "raw", "parsed": {"verdicts": []}}]
    trace = build_run_trace(
        run_id="r", final_json=_pipeline_final_json(), llm_calls=calls,
    )
    assert trace.stages["llm_routing"] == calls
    assert trace.summary["llm_calls"] == 1


def test_evaluate_problems_trace_sink_records_decisions():
    a = {"track_id": "t", "phase1": {"clipping_detected": True, "clipped_sample_count": 1234}}
    sink: dict[str, list] = {"singles": [], "composites": []}
    RE.evaluate_problems(a, trace=sink)  # default (global) registry
    assert sink["singles"]
    assert any(s.get("fired") for s in sink["singles"])


def test_build_run_trace_survives_garbage_final_json():
    # Robustness: a non-dict / empty final_json yields a partial trace, not a crash.
    trace = build_run_trace(run_id="r", final_json=None)
    d = trace.to_dict()
    assert set(d["stages"]) == {"analysis", "flatten", "identify", "solve", "llm_routing", "final"}
    assert d["summary"]["problems"] == 0


def test_round_trip_write_read_gzip(tmp_path):
    trace = build_run_trace(run_id="r1", analysis_id="a1", final_json=_pipeline_final_json())
    path = trace.write(tmp_path, gzip_json=True)
    assert path.suffix == ".gz"
    loaded = read_trace(path)
    assert loaded["analysis_id"] == "a1"
    assert set(loaded["stages"]) == {"analysis", "flatten", "identify", "solve", "llm_routing", "final"}


def test_trace_runs_enabled_env(monkeypatch):
    monkeypatch.delenv("TRACE_RUNS", raising=False)
    assert trace_runs_enabled() is False
    monkeypatch.setenv("TRACE_RUNS", "1")
    assert trace_runs_enabled() is True
    monkeypatch.setenv("TRACE_RUNS", "on")
    assert trace_runs_enabled() is True
    monkeypatch.setenv("TRACE_RUNS", "false")
    assert trace_runs_enabled() is False
