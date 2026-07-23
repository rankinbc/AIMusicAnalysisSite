from __future__ import annotations
import json
import pytest
from app.verdict_lib.orchestrator import (
    PipelineEvent,
    run_pipeline,
)


@pytest.mark.asyncio
async def test_pipeline_emits_rule_verdicts_first(llm, clipped_pop):
    # Triage canned response routes only loudness
    llm.register("Triage", clipped_pop["track_id"], json.dumps({
        "specialists_to_run": [{"name": "loudness", "priority": 1, "focus": "tp"}],
        "skip": [],
        "rationale": "x",
        "estimated_total_tokens": 1000,
    }))
    llm.register("Loudness & Mastering", clipped_pop["track_id"], json.dumps({
        "specialist": "loudness",
        "verdicts": [],
    }))

    events: list[PipelineEvent] = []
    async for ev in run_pipeline(clipped_pop, llm=llm):
        events.append(ev)

    types = [e.kind for e in events]
    # Rule verdicts emitted before routing-plan
    assert types.index("rule-verdict") < types.index("routing-plan")
    # Pipeline ends with complete
    assert types[-1] == "complete"


@pytest.mark.asyncio
async def test_pipeline_dedupes_overlapping(llm, clipped_pop):
    # Specialist emits a verdict with the same (category, primary metric) as a
    # rule-engine Problem (true_peak_overshoot: clipping/phase1.true_peak_db)
    # — should merge into one verdict carrying both sources.
    llm.register("Triage", clipped_pop["track_id"], json.dumps({
        "specialists_to_run": [{"name": "loudness", "priority": 1, "focus": "x"}],
        "skip": [],
        "rationale": "x",
        "estimated_total_tokens": 1000,
    }))
    llm.register("Loudness & Mastering", clipped_pop["track_id"], json.dumps({
        "specialist": "loudness",
        "verdicts": [{
            "severity": "severe",
            "category": "clipping",
            "confidence": 0.85,
            "headline": "Specialist headline that is longer than rule",
            "summary": "Specialist summary string is also longer than the rule.",
            "evidence": [{
                "metric": "phase1.true_peak_db",
                "value": 0.4,
                "expected_range": [-6.0, -1.0],
                "label": "+0.4 dBTP",
            }],
            "fix": None,
            "why_it_matters": "Specialist context.",
        }],
    }))

    events: list[PipelineEvent] = []
    async for ev in run_pipeline(clipped_pop, llm=llm):
        events.append(ev)

    complete = events[-1]
    assert complete.kind == "complete"
    final = complete.payload["verdicts"]
    tp_verdicts = [
        v for v in final
        if v["evidence"] and v["evidence"][0]["metric"] == "phase1.true_peak_db"
    ]
    assert len(tp_verdicts) == 1
    assert tp_verdicts[0]["category"] == "clipping"
    sources = set(tp_verdicts[0]["sources"])
    assert {"rule_engine", "loudness"} <= sources


@pytest.mark.asyncio
async def test_pipeline_validation_failures_recorded(llm, clean_trance):
    llm.register("Triage", clean_trance["track_id"], json.dumps({
        "specialists_to_run": [{"name": "low_end", "priority": 1, "focus": "x"}],
        "skip": [],
        "rationale": "x",
        "estimated_total_tokens": 1000,
    }))
    # Fabricated metric path → validator rejects
    llm.register("Low End Specialist", clean_trance["track_id"], json.dumps({
        "specialist": "low_end",
        "verdicts": [{
            "severity": "moderate",
            "category": "low_end",
            "confidence": 0.7,
            "headline": "Fake low-end issue",
            "summary": "Fabricated metric.",
            "evidence": [{
                "metric": "phase99.totally_imaginary",
                "value": 1.0,
                "label": "fake",
            }],
            "fix": None,
            "why_it_matters": "x",
        }],
    }))

    events: list[PipelineEvent] = []
    async for ev in run_pipeline(clean_trance, llm=llm):
        events.append(ev)
    failures = [e for e in events if e.kind == "validation-failure"]
    assert len(failures) >= 1
    final_verdicts = events[-1].payload["verdicts"]
    # Fake verdict was rejected, so no low_end specialist verdict in output.
    assert all(
        v["specialist"] != "low_end" or "rule_engine" in v["sources"]
        for v in final_verdicts
    )
