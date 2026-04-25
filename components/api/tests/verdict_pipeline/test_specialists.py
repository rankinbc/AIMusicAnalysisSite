from __future__ import annotations
import json
import pytest
from aimusic_shared.verdicts.models import SpecialistRoutingPlan, Verdict
from app.verdict_pipeline.specialists import run_specialists


@pytest.mark.asyncio
async def test_runner_yields_one_verdict_per_specialist(llm, muddy_hiphop):
    plan = SpecialistRoutingPlan(
        specialists_to_run=[
            {"name": "low_end", "priority": 1, "focus": "kick-bass clash"},
        ],
        skip=[],
        rationale="lowend.",
        estimated_total_tokens=5000,
    )
    canned = json.dumps({
        "specialist": "low_end",
        "verdicts": [{
            "severity": "moderate",
            "category": "low_end",
            "confidence": 0.8,
            "headline": "Bass-kick clash 80Hz",
            "summary": "Kick and bass compete at 80Hz.",
            "evidence": [{
                "metric": "phase3.low_mid_energy",
                "value": 0.31,
                "expected_range": [0.10, 0.20],
                "label": "low-mid +50%",
            }],
            "fix": None,
            "why_it_matters": "Punch lost on club systems.",
        }],
    })
    llm.register("Low End Specialist", muddy_hiphop["track_id"], canned)
    yielded: list[tuple[str, Verdict | Exception]] = []
    async for slug, item in run_specialists(plan, muddy_hiphop, llm=llm):
        yielded.append((slug, item))
    assert len(yielded) == 1
    slug, v = yielded[0]
    assert slug == "low_end"
    assert isinstance(v, Verdict)
    assert v.specialist == "low_end"
    assert v.headline == "Bass-kick clash 80Hz"


@pytest.mark.asyncio
async def test_runner_respects_priority_order(llm, muddy_hiphop):
    plan = SpecialistRoutingPlan(
        specialists_to_run=[
            {"name": "loudness", "priority": 3, "focus": "x"},
            {"name": "low_end", "priority": 1, "focus": "x"},
            {"name": "dynamics", "priority": 2, "focus": "x"},
        ],
        skip=[],
        rationale="x",
        estimated_total_tokens=5000,
    )
    empty = lambda slug: json.dumps({"specialist": slug, "verdicts": []})  # noqa: E731
    llm.register("Low End Specialist", muddy_hiphop["track_id"], empty("low_end"))
    llm.register("Dynamics Specialist", muddy_hiphop["track_id"], empty("dynamics"))
    llm.register("Loudness & Mastering", muddy_hiphop["track_id"], empty("loudness"))

    seen_slugs = []
    async for slug, _ in run_specialists(plan, muddy_hiphop, llm=llm):
        seen_slugs.append(slug)
    # Empty verdict lists yield nothing per-verdict, but the runner emits a
    # sentinel "completion" via `("__done__", slug)` — see implementation.
    # Reorder check is via call ordering on the LLM mock.
    call_order = [c["system_excerpt"] for c in llm.calls]
    # priorities 1, 2, 3 → LowEnd, Dynamics, Loudness
    assert call_order == ["Low End Specialist", "Dynamics Specialist", "Loudness & Mastering"]


@pytest.mark.asyncio
async def test_runner_retries_invalid_json(llm, muddy_hiphop, monkeypatch):
    plan = SpecialistRoutingPlan(
        specialists_to_run=[{"name": "low_end", "priority": 1, "focus": "x"}],
        skip=[], rationale="x", estimated_total_tokens=5000,
    )
    # First response: garbage. Second response: valid empty.
    sequence = iter([
        "Not JSON at all",
        json.dumps({"specialist": "low_end", "verdicts": []}),
    ])

    async def fake_call(*args, **kwargs):
        return next(sequence)

    monkeypatch.setattr(llm, "call", fake_call)
    out = []
    async for item in run_specialists(plan, muddy_hiphop, llm=llm):
        out.append(item)
    # No verdicts produced (empty list), but no exception either — retry
    # succeeded.
    assert out == []


@pytest.mark.asyncio
async def test_runner_skips_after_two_failures(llm, muddy_hiphop, monkeypatch):
    plan = SpecialistRoutingPlan(
        specialists_to_run=[{"name": "low_end", "priority": 1, "focus": "x"}],
        skip=[], rationale="x", estimated_total_tokens=5000,
    )

    async def fake_call(*args, **kwargs):
        return "Still not JSON"

    monkeypatch.setattr(llm, "call", fake_call)
    out = []
    async for slug, item in run_specialists(plan, muddy_hiphop, llm=llm):
        out.append((slug, item))
    # Expect a single error item for the failed specialist.
    assert len(out) == 1
    slug, err = out[0]
    assert slug == "low_end"
    assert isinstance(err, Exception)
