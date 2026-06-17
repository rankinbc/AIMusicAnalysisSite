from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from aimusic_shared.verdicts.models import SpecialistRoutingPlan, Verdict
from aimusic_shared.verdicts.ulid_helpers import new_fix_id, new_verdict_id

from .input_grounding import build_specialist_user_message
from .json_extraction import extract_json_object
from .llm_protocol import LLMCaller
from .prompt_loader import load_prompt

log = logging.getLogger(__name__)

RETRY_SUFFIX = (
    "\n\n[SYSTEM] Your previous response was not valid JSON. "
    "Respond with ONLY the JSON object — no prose, no code fences."
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
    # `fix_id` is server-controlled; LLMs don't know to invent one. Inject it
    # if the LLM emitted a `fix` without one.
    fix = body.get("fix")
    if isinstance(fix, dict) and not fix.get("fix_id"):
        fix = dict(fix)
        fix["fix_id"] = new_fix_id()
        body["fix"] = fix
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


async def run_one_specialist(
    slug: str,
    focus: str,
    analysis: dict[str, Any],
    *,
    llm: LLMCaller,
    model_name: str = "claude-cli",
    timeout_s: int = 90,
) -> tuple[list[Verdict], list[Exception]]:
    """Run one specialist by slug. Returns (verdicts, errors).

    Verdicts are hydrated (server-controlled fields filled) but NOT yet
    validated — the caller is responsible for invoking validate_verdict.
    Errors include unknown-slug KeyError, JSON-parse failures after retry,
    and per-verdict hydration exceptions.
    """
    track_id = analysis.get("track_id", "unknown-track")
    try:
        version, system_body = load_prompt(slug)
    except KeyError as e:
        log.warning("unknown specialist slug %r: %s", slug, e)
        return [], [e]

    user_msg = build_specialist_user_message(analysis, focus)
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
        return [], [last_err or RuntimeError("specialist failed without exception")]

    verdicts: list[Verdict] = []
    errors: list[Exception] = []
    for raw_v in (parsed.get("verdicts") or []):
        try:
            v = _hydrate_verdict(
                raw_v,
                track_id=track_id,
                specialist_slug=slug,
                prompt_version=f"{slug}@{version}",
                model=model_name,
            )
            verdicts.append(v)
        except Exception as e:
            log.info("specialist %s emitted invalid verdict: %s", slug, e)
            errors.append(e)
    return verdicts, errors


async def run_specialists(
    plan: SpecialistRoutingPlan,
    analysis: dict[str, Any],
    *,
    llm: LLMCaller,
    model_name: str = "claude-cli",
    timeout_s: int = 90,
) -> AsyncIterator[tuple[str, Verdict | Exception]]:
    """Run each routed specialist in priority order.

    Yields (specialist_slug, verdict) per produced verdict, or
    (specialist_slug, exception) if the specialist failed after retry.
    """
    ordered = sorted(plan.specialists_to_run, key=lambda d: d.get("priority", 99))
    for entry in ordered:
        slug = entry["name"]
        focus = entry.get("focus", "")
        verdicts, errors = await run_one_specialist(
            slug, focus, analysis,
            llm=llm, model_name=model_name, timeout_s=timeout_s,
        )
        for v in verdicts:
            yield (slug, v)
        for e in errors:
            yield (slug, e)
