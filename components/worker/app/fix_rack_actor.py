"""Dramatiq actor: generate a Coach Mix fix-rack preset from a completed analysis.

On-demand — the BFF dispatches this from the "Generate fix rack" action. It re-runs
the deterministic Problem engine, then ``coach_mix.synthesize`` (arbiter + optional
LLM judgment calls, fail-open) and persists the compiled rack chain plus its
``coach_meta`` rationale as a system-generated ``RackPreset(source='analysis')``,
version-scoped. Idempotent: it replaces any prior analysis preset for the version.

Re-running the engine (rather than reconstructing pydantic Verdicts from the
persisted rows) keeps the actor self-contained — synthesis needs the analysis dict
for fix validation anyway, and ``evaluate_problems`` is deterministic.
"""
from __future__ import annotations

import logging
import uuid

import dramatiq
from sqlalchemy import select

from aimusic_shared.models import Analysis, RackPreset

from .coach_mix.synthesize import synthesize
from .db_sync import SessionFactory
from .verdict_lib.flatten_analysis import flatten
from .verdict_lib.rule_engine import evaluate_problems

logger = logging.getLogger(__name__)


@dramatiq.actor(
    actor_name="generate_fix_rack",
    queue_name="analysis-paid",  # story 2.5: secondary op → W1
    max_retries=1,
)
def generate_fix_rack(analysis_id: str, user_id: str | None = None,
                      tier: str = "free") -> None:
    # user_id/tier default (rather than required, as the BFF always sends them)
    # so an in-flight 1-arg message from a pre-port BFF degrades to a free-tier
    # run instead of TypeError -> retry -> dead-letter.
    aid = uuid.UUID(analysis_id)

    # Phase 1 — load (short tx).
    with SessionFactory.begin() as s:
        analysis = s.get(Analysis, aid)
        if analysis is None:
            logger.warning("fix rack: analysis %s not found", aid)
            return
        final_json = analysis.final_json
        version_id = analysis.version_id
        song_name = analysis.song_name or "track"
    if version_id is None:
        logger.warning("fix rack: analysis %s has no version_id; skipping", aid)
        return

    # Phase 2 — compute (no DB; deterministic). Guarded: a malformed final_json
    # or a solver bug must not crash the actor or half-write a preset.
    try:
        flattened = flatten(final_json if isinstance(final_json, dict) else {})
        flattened.setdefault("track_id", str(aid))
        genre = (flattened.get("phase2") or {}).get("genre")
        result = synthesize(evaluate_problems(flattened), flattened,
                            genre=genre, tier=tier, user_id=user_id, correlation_id=str(aid))
        chain = result["chain"]
    except Exception:
        logger.exception("fix rack: compute failed for analysis %s; skipping", aid)
        return

    # Phase 3 — persist (idempotent: one analysis preset per version).
    with SessionFactory.begin() as s:
        prior = s.execute(
            select(RackPreset).where(
                RackPreset.song_version_id == version_id,
                RackPreset.source == "analysis",
            )
        ).scalars().all()
        for row in prior:
            s.delete(row)
        s.add(RackPreset(
            song_version_id=version_id,
            name=f"Fix rack — {song_name}"[:120],
            source="analysis",
            chain_json=chain,
            coach_meta={
                "change_log": result["change_log"],
                "arbiter_notes": result["arbiter_notes"],
                "degraded": result["degraded"],
                "leftover_advice": result["leftover_advice"],
            },
        ))

    enabled = sum(1 for m in chain["modules"].values() if m.get("enabled"))
    logger.info("fix rack: wrote analysis preset for version %s (%d modules, "
                "%d leftover)", version_id, enabled, len(result["leftover_advice"]))
