"""The `.als → track/device-specific advice` moat.

Three acceptance angles:
- WITH an `.als` map: a device_chain verdict yields a fix that names a REAL project
  track + device, and the validator rejects a hallucinated track name.
- WITHOUT an `.als`: the specialist user message is byte-identical to the role-level
  path, the triage gate strips `device_chain`, and the validator's als branch is inert.
"""
from __future__ import annotations

import json

import pytest

from aimusic_shared.verdicts.models import SpecialistRoutingPlan
from app.verdict_lib.input_grounding import (
    als_grounding_block,
    als_project_map,
    als_state,
    build_specialist_user_message,
    grounding_preamble,
)
from app.verdict_lib.specialists import run_one_specialist
from app.verdict_lib.triage import gate_als_specialists
from app.verdict_lib.validator import validate_verdict

# A flattened analysis (phase-result `data` only, the shape `flatten()` produces)
# carrying a real .als project map.
ALS_ANALYSIS: dict = {
    "track_id": "trk_als_test",
    "phase1": {"duration_seconds": 300.0},
    "phase8": {
        "health_score": 80,
        "total_devices": 3,
        "tracks": [
            {
                "name": "TRITON Pad",
                "type": "midi",
                "device_count": 2,
                "devices": ["Auto Filter", "Reverb"],
            },
            {
                "name": "Kick",
                "type": "audio",
                "device_count": 1,
                "devices": ["EQ Eight"],
            },
        ],
    },
}

NO_ALS_ANALYSIS: dict = {
    "track_id": "trk_no_als",
    "phase1": {"duration_seconds": 300.0},
    "phase3": {"low_mid_energy": 0.31},
}


# ── map extraction / state ────────────────────────────────────────────────────

def test_als_state_present_and_absent():
    assert als_state(ALS_ANALYSIS) == "ok"
    assert als_state(NO_ALS_ANALYSIS) == "absent"
    assert als_state({}) == "absent"
    # Explicit non-ok status (raw phase-result shape) → absent.
    assert als_state({"phase8": {"status": "failed", "tracks": [{"name": "x"}]}}) == "absent"
    # Present-but-empty track list → absent (nothing to ground on).
    assert als_state({"phase8": {"tracks": []}}) == "absent"


def test_als_project_map_extraction():
    m = als_project_map(ALS_ANALYSIS)
    assert m == {"TRITON Pad": ["Auto Filter", "Reverb"], "Kick": ["EQ Eight"]}
    assert als_project_map(NO_ALS_ANALYSIS) == {}


def test_grounding_block_present_lists_real_names():
    block = als_grounding_block(ALS_ANALYSIS)
    assert "ABLETON PROJECT MAP" in block
    assert "TRITON Pad" in block and "Auto Filter" in block
    assert "Kick" in block and "EQ Eight" in block


# ── AC (c): no .als → byte-identical user message + inert gates ────────────────

def test_no_als_grounding_block_is_empty():
    assert als_grounding_block(NO_ALS_ANALYSIS) == ""


def test_no_als_user_message_byte_identical():
    """The als block is the only addition; with no .als it is "", so the message
    must equal the exact role-level formula."""
    focus = "kick-bass clash"
    expected = (
        f"Analyze this mix. Triage focus: {focus}\n\n"
        f"{grounding_preamble(NO_ALS_ANALYSIS)}\n"
        f"```json\n{json.dumps(NO_ALS_ANALYSIS, indent=2, default=str)}\n```\n\n"
        "Return only the verdicts JSON object as specified in your instructions."
    )
    assert build_specialist_user_message(NO_ALS_ANALYSIS, focus) == expected
    assert "ABLETON PROJECT MAP" not in build_specialist_user_message(NO_ALS_ANALYSIS, focus)


def test_with_als_user_message_carries_map():
    msg = build_specialist_user_message(ALS_ANALYSIS, "device chains")
    assert "ABLETON PROJECT MAP" in msg
    assert "TRITON Pad" in msg


def _plan_with_device_chain() -> SpecialistRoutingPlan:
    return SpecialistRoutingPlan(
        specialists_to_run=[
            {"name": "low_end", "priority": 1, "focus": "x"},
            {"name": "device_chain", "priority": 2, "focus": "track devices"},
        ],
        skip=[],
        rationale="x",
        estimated_total_tokens=1000,
    )


def test_triage_gate_strips_device_chain_when_no_als():
    gated = gate_als_specialists(_plan_with_device_chain(), NO_ALS_ANALYSIS)
    names = [s["name"] for s in gated.specialists_to_run]
    assert "device_chain" not in names
    assert "low_end" in names
    assert "device_chain" in gated.skip


def test_triage_gate_keeps_device_chain_when_als_present():
    gated = gate_als_specialists(_plan_with_device_chain(), ALS_ANALYSIS)
    names = [s["name"] for s in gated.specialists_to_run]
    assert "device_chain" in names
    assert gated.skip == []


# ── AC (b): a device_chain verdict grounded to a REAL track + device ───────────

def _device_chain_response(track_name: str, device: str) -> str:
    return json.dumps({
        "specialist": "device_chain",
        "verdicts": [{
            "severity": "moderate",
            "category": "device_chain",
            "confidence": 0.8,
            "headline": f"{track_name} {device} resonance too high",
            "summary": (
                f"The {device} on {track_name} has excessive resonance near 250 Hz, "
                "smearing the low-mids."
            ),
            "evidence": [{
                "metric": "phase8.tracks[0].device_count",
                "value": None,
                "label": f"{track_name} has 2 devices",
            }],
            "fix": {
                "target": {"type": "track", "name": track_name},
                "section": None,
                "dsp_chain": [{
                    "type": "peaking_eq",
                    "params": {"frequency_hz": 250, "gain_db": -3.0, "q": 1.2},
                }],
                "sidechain": None,
                "expected_outcome": "Pad stops masking the low-mids.",
                "ableton_hint": {"device": device, "band": 1},
            },
            "why_it_matters": "Resonant filter buildup muddies the mix.",
        }],
    })


@pytest.mark.asyncio
async def test_device_chain_verdict_names_real_track_and_device(llm):
    """AC (b): the produced fix targets a real project track and references a device
    that actually exists on it; it passes validation."""
    llm.register(
        "Device Chain Analysis", ALS_ANALYSIS["track_id"],
        _device_chain_response("TRITON Pad", "Auto Filter"),
    )
    verdicts, errors = await run_one_specialist(
        "device_chain", focus="track devices", analysis=ALS_ANALYSIS, llm=llm,
    )
    assert errors == []
    assert len(verdicts) == 1
    v = verdicts[0]

    # Track + device are grounded to the authoritative phase-8 map.
    track_map = als_project_map(ALS_ANALYSIS)
    assert v.fix is not None
    assert v.fix.target == {"type": "track", "name": "TRITON Pad"}
    assert v.fix.target["name"] in track_map
    cited_device = v.fix.ableton_hint["device"]
    assert cited_device in track_map[v.fix.target["name"]]

    # And it survives validation against the same analysis.
    result = validate_verdict(v, ALS_ANALYSIS)
    assert result.ok, result.failure


@pytest.mark.asyncio
async def test_validator_rejects_hallucinated_track_name(llm):
    """A track-targeted fix naming a track NOT in the .als map is rejected — the
    "no hallucinated names" guard."""
    llm.register(
        "Device Chain Analysis", ALS_ANALYSIS["track_id"],
        _device_chain_response("Imaginary Lead", "Auto Filter"),
    )
    verdicts, errors = await run_one_specialist(
        "device_chain", focus="track devices", analysis=ALS_ANALYSIS, llm=llm,
    )
    assert len(verdicts) == 1  # hydration succeeds; grounding is a validation gate
    result = validate_verdict(verdicts[0], ALS_ANALYSIS)
    assert result.ok is False
    assert result.failure is not None
    assert "not a track in the .als project map" in result.failure.reason


def test_validator_track_target_inert_without_als():
    """AC (c): with no .als map, a track-typed target is NOT rejected on track-name
    grounds (the als branch is skipped) — role-level validation is unchanged."""
    llm_resp = json.loads(_device_chain_response("Anything", "Auto Filter"))
    from aimusic_shared.verdicts.models import Verdict
    from aimusic_shared.verdicts.ulid_helpers import new_fix_id, new_verdict_id
    from datetime import datetime, timezone

    raw = llm_resp["verdicts"][0]
    raw["fix"]["fix_id"] = new_fix_id()
    v = Verdict(
        verdict_id=new_verdict_id(),
        track_id="trk_no_als",
        specialist="device_chain",
        prompt_version="device_chain@1.1.0",
        model="test",
        priority_score=0,
        sources=["device_chain"],
        created_at=datetime.now(tz=timezone.utc),
        **raw,
    )
    # Evidence path must resolve in NO_ALS analysis; swap it to a resolvable one.
    result = validate_verdict(
        v.model_copy(update={
            "evidence": [e.model_copy(update={"metric": "phase3.low_mid_energy", "value": None})
                         for e in v.evidence]
        }),
        NO_ALS_ANALYSIS,
    )
    assert result.ok, result.failure
