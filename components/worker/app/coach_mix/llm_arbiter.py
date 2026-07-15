"""Holistic mastering-engineer escalation: rule on the arbiter's judgment calls.

Consulted only when judgment_calls is non-empty. Fail-open: any LLM problem
keeps the deterministic chain and returns degraded=True. Every param the LLM
returns is re-run through arbiter._guard before it can affect the chain."""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from aimusic_shared.verdicts.models import DspOp, Evidence, Fix, Verdict

from app.coach_mix import arbiter
from app.coach_mix.decision_schema import ArbiterResponse
from app.coach_mix.types import ArbiterResult
from app.llm import gateway
from app.verdict_lib.json_extraction import extract_json_object
from app.verdict_lib.prompt_loader import load_arbiter_prompt, load_arbiter_prompt_model
from app.verdict_lib.rule_engine import _problem

logger = logging.getLogger(__name__)
SLUG = "mastering_engineer"


def _build_user_message(result: ArbiterResult, analysis: dict[str, Any], genre: str | None) -> str:
    calls = [{"index": i, **c} for i, c in enumerate(result.judgment_calls)]
    payload = {
        "genre": genre,
        "metrics": analysis.get("phase1") or {},
        "candidate_chain": [v.fix.dsp_chain[0].model_dump() for v in result.verdicts if v.fix],
        "judgment_calls": calls,
    }
    return json.dumps(payload)


def _glue_verdict(params: dict[str, Any]) -> Verdict:
    op = DspOp(type="compressor", params=params)  # DspOp validates ranges
    # Ephemeral verdict (never persisted as a row) built via _problem so all
    # required fields are set; only the fix's dsp_chain reaches compile_preset.
    v = _problem(
        track_id="master", slug="glue", severity="minor", category="dynamics",
        headline="Bus glue", summary="gentle bus compression", why_it_matters="cohesion",
        data_tier="audio_only", fixable=True,
        evidence=[Evidence(metric="phase1.lufs", value=0.0, label="glue")])
    return v.model_copy(update={"fix": Fix(
        fix_id="fix.coach_mix.glue", target={"type": "master", "name": "master"},
        dsp_chain=[op], expected_outcome="gentle bus glue")})


def apply_decisions(result: ArbiterResult, resp: ArbiterResponse) -> ArbiterResult:
    verdicts = list(result.verdicts)
    for d in resp.decisions:
        if d.call_index < 0 or d.call_index >= len(result.judgment_calls):
            continue
        call = result.judgment_calls[d.call_index]
        if call["kind"] == "glue_offer" and d.action == "add_glue" and d.params:
            try:
                verdicts.append(_glue_verdict(d.params))
            except Exception:               # invalid params -> skip the glue  # noqa: BLE001
                logger.info("glue params rejected by DspOp validator: %s", d.params)
        # eq_conflict and other non-glue calls are NOT applied here — the deterministic
        # resolution from arbiter._combine stands; the LLM's ruling is advisory and
        # recorded in arbiter_notes only. (Wiring adjust/drop to re-slot EQ is a
        # deliberate follow-up.)
    guarded, _ = arbiter._guard(verdicts, result.change_log)
    return ArbiterResult(verdicts=guarded, judgment_calls=result.judgment_calls,
                         change_log=result.change_log)


def consult(result: ArbiterResult, analysis: dict[str, Any], genre: str | None, *,
            tier: str, user_id: str | None, correlation_id: str) -> tuple[ArbiterResult, str | None, bool]:
    if not result.judgment_calls:
        return result, None, False
    try:
        prompt_version, prompt_body = load_arbiter_prompt(SLUG)
        out = gateway.complete_sync(
            system=prompt_body, user=_build_user_message(result, analysis, genre),
            purpose="coach_mix", prompt_slug=SLUG, prompt_version=prompt_version,
            model=load_arbiter_prompt_model(SLUG), user_id=_as_uuid(user_id),
            tier=tier, correlation_id=correlation_id, timeout_s=120)
        parsed = extract_json_object(out.text)
        resp = ArbiterResponse.model_validate(parsed)
        updated = apply_decisions(result, resp)
        notes = json.dumps([d.model_dump() for d in resp.decisions])
        return updated, notes, False
    except Exception as exc:  # noqa: BLE001  — fail-open: keep deterministic chain
        logger.warning("coach_mix LLM degraded: %s", exc)
        return result, None, True


def _as_uuid(user_id: str | None) -> Any:
    try:
        return uuid.UUID(user_id)
    except (ValueError, TypeError, AttributeError):
        return None
