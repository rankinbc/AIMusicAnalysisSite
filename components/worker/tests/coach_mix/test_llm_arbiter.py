import json
from app.coach_mix import llm_arbiter
from app.coach_mix.types import ArbiterResult, JudgmentCall
from app.llm.gateway import LlmBudgetExceeded


class _Result:
    def __init__(self, text): self.text, self.model = text, "claude-test"


def _res_with_glue_call():
    return ArbiterResult(verdicts=[], judgment_calls=[JudgmentCall(
        kind="glue_offer", where="bus comp", competing_fix_ids=[], context={"lufs": -14.0},
        question="glue?")], change_log=[])


def test_consult_skips_llm_when_no_judgment_calls(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(llm_arbiter.gateway, "complete_sync", lambda **k: called.__setitem__("n", 1))
    out, notes, degraded = llm_arbiter.consult(
        ArbiterResult(verdicts=[], judgment_calls=[], change_log=[]), {}, "techno",
        tier="free", user_id="u", correlation_id="c")
    assert called["n"] == 0 and notes is None and degraded is False


def test_consult_applies_decision_and_returns_notes(monkeypatch):
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt", lambda slug: ("1.0.0", "sys"))
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt_model", lambda slug: None)
    payload = {"decisions": [{"call_index": 0, "action": "drop", "params": None, "rationale": "clean"}]}
    monkeypatch.setattr(llm_arbiter.gateway, "complete_sync", lambda **k: _Result(json.dumps(payload)))
    out, notes, degraded = llm_arbiter.consult(_res_with_glue_call(), {}, "techno",
                                               tier="free", user_id="u", correlation_id="c")
    assert degraded is False
    assert notes is not None and "clean" in notes


def test_consult_degrades_on_budget_exceeded(monkeypatch):
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt", lambda slug: ("1.0.0", "sys"))
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt_model", lambda slug: None)
    def _boom(**k): raise LlmBudgetExceeded("tier_budget", "over")
    monkeypatch.setattr(llm_arbiter.gateway, "complete_sync", _boom)
    res = _res_with_glue_call()
    out, notes, degraded = llm_arbiter.consult(res, {}, "techno", tier="free", user_id="u", correlation_id="c")
    assert degraded is True
    assert out.verdicts == res.verdicts        # deterministic chain preserved


def test_consult_degrades_on_malformed_json(monkeypatch):
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt", lambda slug: ("1.0.0", "sys"))
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt_model", lambda slug: None)
    monkeypatch.setattr(llm_arbiter.gateway, "complete_sync", lambda **k: _Result("not json"))
    res = _res_with_glue_call()
    out, notes, degraded = llm_arbiter.consult(res, {}, "techno", tier="free", user_id="u", correlation_id="c")
    assert degraded is True
    assert out is res            # original deterministic result returned unchanged


def test_consult_degrades_on_schema_mismatch(monkeypatch):
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt", lambda slug: ("1.0.0", "sys"))
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt_model", lambda slug: None)
    monkeypatch.setattr(llm_arbiter.gateway, "complete_sync",
                        lambda **k: _Result(json.dumps({"decisions": "not_a_list"})))
    res = _res_with_glue_call()
    out, notes, degraded = llm_arbiter.consult(res, {}, "techno", tier="free", user_id="u", correlation_id="c")
    assert degraded is True and out is res


def test_consult_skips_glue_with_invalid_params(monkeypatch):
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt", lambda slug: ("1.0.0", "sys"))
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt_model", lambda slug: None)
    # ratio=99999.0 exceeds DspOp compressor max of 20.0 → DspOp validation raises → glue skipped
    payload = {"decisions": [{"call_index": 0, "action": "add_glue",
               "params": {"ratio": 99999.0}, "rationale": "bad"}]}
    monkeypatch.setattr(llm_arbiter.gateway, "complete_sync", lambda **k: _Result(json.dumps(payload)))
    out, notes, degraded = llm_arbiter.consult(_res_with_glue_call(), {}, "techno",
                                               tier="free", user_id="u", correlation_id="c")
    assert degraded is False     # LLM succeeded; only the invalid glue op was dropped
    assert all(v.fix.dsp_chain[0].type != "compressor" for v in out.verdicts if v.fix)


def test_consult_forwards_tier_to_gateway(monkeypatch):
    """tier must reach gateway.complete_sync so budget is checked against the caller's tier."""
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt", lambda slug: ("1.0.0", "sys"))
    monkeypatch.setattr(llm_arbiter, "load_arbiter_prompt_model", lambda slug: None)
    captured: dict = {}
    payload = {"decisions": []}

    def _stub(**k):
        captured.update(k)
        return _Result(json.dumps(payload))

    monkeypatch.setattr(llm_arbiter.gateway, "complete_sync", _stub)
    llm_arbiter.consult(_res_with_glue_call(), {}, "techno",
                        tier="pro", user_id="u", correlation_id="c")
    assert captured.get("tier") == "pro"
