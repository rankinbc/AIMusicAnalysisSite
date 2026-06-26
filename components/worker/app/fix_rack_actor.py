"""Dramatiq actor: generate a deterministic fix-rack preset from a completed analysis.

On-demand — the BFF dispatches this from the "Generate fix rack" action. It re-runs
the deterministic Problem engine + SOLVE tier (cheap, no LLM) and persists the
compiled rack chain as a system-generated ``RackPreset(source='analysis')``,
version-scoped. Idempotent: it replaces any prior analysis preset for the version.

Re-running the engine (rather than reconstructing pydantic Verdicts from the
persisted rows) keeps the actor self-contained — ``solve`` needs the analysis dict
for fix validation anyway, and ``evaluate_problems`` is deterministic.
"""
from __future__ import annotations

import logging
import uuid

import dramatiq
from sqlalchemy import select

from aimusic_shared.models import Analysis, RackPreset

from .db_sync import SessionFactory
from .solve_lib import solve
from .verdict_lib.flatten_analysis import flatten
from .verdict_lib.rule_engine import evaluate_problems

logger = logging.getLogger(__name__)


@dramatiq.actor(
    actor_name="generate_fix_rack",
    queue_name="analysis-paid",  # story 2.5: secondary op → W1
    max_retries=1,
)
def generate_fix_rack(analysis_id: str) -> None:
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
        result = solve(evaluate_problems(flattened), flattened)
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
        ))

    enabled = sum(1 for m in chain["modules"].values() if m.get("enabled"))
    logger.info("fix rack: wrote analysis preset for version %s (%d modules, "
                "%d leftover)", version_id, enabled, len(result["leftover_advice"]))
