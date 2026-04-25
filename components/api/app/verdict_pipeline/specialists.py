from __future__ import annotations
import json
import logging
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from aimusic_shared.verdicts.models import SpecialistRoutingPlan, Verdict
from aimusic_shared.verdicts.ulid_helpers import new_verdict_id
from app.llm.client import LLMClient
from app.verdict_pipeline.json_extraction import extract_json_object
from app.verdict_pipeline.prompt_loader import load_prompt

log = logging.getLogger(__name__)

RETRY_SUFFIX = (
    "\n\n[SYSTEM] Your previous response was not valid JSON. "
    "Respond with ONLY the JSON object — no prose, no code fences."
)


def _build_user_message(analysis: dict[str, Any], focus: str) -> str:
    return (
        f"Analyze this mix. Triage focus: {focus}\n\n"
        f"```json\n{json.dumps(analysis, indent=2, default=str)}\n```\n\n"
        "Return only the verdicts JSON object as specified in your instructions."
    )


def _hydrate_verdict(
    raw: dict[str, Any],
    *,
    track_id: str,
    specialist_slug: str,
    prompt_version: str,
    model: str,
) -> Verdict:
    """Take a raw verdict dict from the LLM, fill in server-controlled fields,
    and return a fully-validated Verdict (Pydantic raises if invalid).

    Note: the validator stage will overwrite priority_score and may downgrade
    severity. Here we set sensible defaults so the Pydantic model can construct.
    """
    body = dict(raw)
    body.setdefault("verdict_id", new_verdict_id())
    body["track_id"] = track_id
    body["specialist"] = specialist_slug
    body["prompt_version"] = prompt_version
    body["model"] = model
    body.setdefault("priority_score", 0)  # validator will recompute
    body.setdefault("sources", [specialist_slug])
    body.setdefault("related_verdict_ids", [])
    body.setdefault("user_state", {})
    body.setdefault("created_at", datetime.now(tz=timezone.utc).isoformat())
    return Verdict(**body)


async def run_specialists(
    plan: SpecialistRoutingPlan,
    analysis: dict[str, Any],
    *,
    llm: LLMClient,
    model_name: str = "claude-cli",
    timeout_s: int = 90,
) -> AsyncIterator[tuple[str, Verdict | Exception]]:
    """Run each routed specialist in priority order.

    Yields (specialist_slug, verdict) per produced verdict, or
    (specialist_slug, exception) if the specialist failed after retry.
    """
    track_id = analysis.get("track_id", "unknown-track")
    ordered = sorted(plan.specialists_to_run, key=lambda d: d.get("priority", 99))
    for entry in ordered:
        slug = entry["name"]
        focus = entry.get("focus", "")
        try:
            version, system_body = load_prompt(slug)
        except KeyError as e:
            log.warning("unknown specialist slug %r: %s", slug, e)
            yield (slug, e)
            continue

        user_msg = _build_user_message(analysis, focus)
        raw_text = ""
        parsed: dict[str, Any] | None = None
        last_err: Exception | None = None

        for attempt in (1, 2):
            user = user_msg if attempt == 1 else user_msg + RETRY_SUFFIX
            try:
                raw_text = await llm.call(
                    system=system_body, user=user, timeout_s=timeout_s
                )
                parsed = extract_json_object(raw_text)
                break
            except Exception as e:
                last_err = e
                log.info("specialist %s attempt %d failed: %s", slug, attempt, e)
                continue

        if parsed is None:
            yield (slug, last_err or RuntimeError("specialist failed without exception"))
            continue

        verdicts_raw = parsed.get("verdicts") or []
        for raw_v in verdicts_raw:
            try:
                v = _hydrate_verdict(
                    raw_v,
                    track_id=track_id,
                    specialist_slug=slug,
                    prompt_version=f"{slug}@{version}",
                    model=model_name,
                )
            except Exception as e:
                log.info("specialist %s emitted invalid verdict: %s", slug, e)
                yield (slug, e)
                continue
            yield (slug, v)
