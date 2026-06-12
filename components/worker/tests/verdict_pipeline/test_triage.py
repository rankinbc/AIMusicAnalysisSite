from __future__ import annotations
import json
import pytest
from aimusic_shared.verdicts.models import SpecialistRoutingPlan
from app.verdict_lib.triage import run_triage


@pytest.mark.asyncio
async def test_triage_returns_valid_plan(llm, muddy_hiphop):
    canned = json.dumps({
        "specialists_to_run": [
            {"name": "low_end", "priority": 1, "focus": "kick-bass clash"},
            {"name": "frequency_balance", "priority": 2, "focus": "low-mid mud"},
        ],
        "skip": ["surround", "spatial"],
        "rationale": "Low end dominates the issues.",
        "estimated_total_tokens": 14000,
    })
    llm.register("Triage", muddy_hiphop["track_id"], canned)
    plan = await run_triage(muddy_hiphop, rule_verdicts=[], llm=llm)
    assert isinstance(plan, SpecialistRoutingPlan)
    assert plan.specialists_to_run[0]["name"] == "low_end"


@pytest.mark.asyncio
async def test_triage_retries_on_invalid_json(llm, muddy_hiphop):
    """First call returns garbage; we don't retry inside triage (caller's job).
    Triage simply raises ValueError, and the orchestrator handles fallback."""
    llm.register("Triage", muddy_hiphop["track_id"], "Definitely not JSON.")
    with pytest.raises(ValueError):
        await run_triage(muddy_hiphop, rule_verdicts=[], llm=llm)


@pytest.mark.asyncio
async def test_triage_includes_rule_verdicts_in_user_message(llm, clipped_pop, monkeypatch):
    canned = json.dumps({
        "specialists_to_run": [{"name": "loudness", "priority": 1,
                                "focus": "true peak"}],
        "skip": [],
        "rationale": "Clipping already flagged by rules.",
        "estimated_total_tokens": 5000,
    })
    llm.register("Triage", clipped_pop["track_id"], canned)

    captured = {}
    orig_call = llm.call

    async def spy(system, user, **kwargs):
        captured["user"] = user
        return await orig_call(system, user, **kwargs)

    monkeypatch.setattr(llm, "call", spy)

    from app.verdict_lib.rule_engine import evaluate_rules
    rule_verdicts = evaluate_rules(clipped_pop)

    await run_triage(clipped_pop, rule_verdicts=rule_verdicts, llm=llm)
    assert "rule_engine" in captured["user"]
    assert "clipping" in captured["user"]
