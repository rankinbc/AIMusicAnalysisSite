from app.coach_mix import synthesize as S
from app.verdict_lib.rule_engine import evaluate_problems
from app.verdict_lib.flatten_analysis import flatten


def _clipping_final():
    return {"phase1": {"clipping_detected": True, "clipped_sample_count": 1234,
                       "true_peak_db": -0.2, "lufs": -7.0}, "phase2": {"genre": "techno"}}


def test_synthesize_problem_mix_emits_chain_with_limiter(monkeypatch):
    # No LLM in this path (judgment calls may exist -> stub consult to passthrough).
    monkeypatch.setattr(S.llm_arbiter, "consult",
                        lambda res, a, g, **k: (res, None, False))
    flat = flatten(_clipping_final()); flat["track_id"] = "t"
    out = S.synthesize(evaluate_problems(flat), flat, genre="techno",
                       tier="free", user_id="u", correlation_id="c")
    assert "limiter" in out["chain"]["modules"]
    assert isinstance(out["change_log"], list)
    assert out["degraded"] is False


def test_synthesize_clean_mix_minimal_chain(monkeypatch):
    monkeypatch.setattr(S.llm_arbiter, "consult", lambda res, a, g, **k: (res, None, False))
    flat = {"phase1": {"lufs": -14.0}, "phase2": {"genre": "techno"}, "track_id": "t"}
    out = S.synthesize([], flat, genre="techno", tier="free", user_id="u", correlation_id="c")
    # release-ready always finishes a ceiling; nothing else on a clean, on-target mix
    assert set(out["chain"]["modules"]).issubset({"limiter"})
