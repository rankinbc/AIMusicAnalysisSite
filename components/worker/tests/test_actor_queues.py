"""Story 2.5 (AC1, AC5) — actor queue-assignment lock + the `default`-queue guard.

AC5 is the single highest-risk item: the AR23 prod topology has NO `default`
queue, so any actor still declaring `default` would have no consumer in prod and
its feature would die silently. This test pins every actor's `queue_name` and
asserts NO registered actor rides `default`. Verify the split with THIS lint,
not by eyeballing.
"""
from __future__ import annotations

import os

# db_sync.py reads DATABASE_URL at import time (mirrors test_classify_stems.py).
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

# Importing the entrypoint registers every actor module on one broker.
import app.dramatiq_app  # noqa: E402,F401
from app.coach_actor import coach_reply  # noqa: E402
from app.reference_analyzer_actor import run_reference_analyzer  # noqa: E402
from app.rerun_phase_actor import rerun_phase  # noqa: E402
from app.recap_actor import synthesize_recap  # noqa: E402
from app.structure_actor import detect_structure_job  # noqa: E402
from app.tasks_dramatiq import analyze_audio_job, classify_stems  # noqa: E402
from app.triage_actor import run_triage  # noqa: E402
from app.verdict_actor import run_specialist  # noqa: E402

EXPECTED_QUEUES = {
    "analyze_audio_job": "analysis-free",
    "classify_stems": "analysis-paid",
    "run_specialist": "analysis-paid",
    "run_triage": "analysis-paid",
    "run_reference_analyzer": "analysis-paid",
    "rerun_phase": "analysis-paid",
    "detect_structure_job": "analysis-paid",
    "synthesize_recap": "analysis-paid",
    "coach_reply": "coach",
}


def test_actor_queue_assignments():
    actual = {
        "analyze_audio_job": analyze_audio_job.queue_name,
        "classify_stems": classify_stems.queue_name,
        "run_specialist": run_specialist.queue_name,
        "run_triage": run_triage.queue_name,
        "run_reference_analyzer": run_reference_analyzer.queue_name,
        "rerun_phase": rerun_phase.queue_name,
        "detect_structure_job": detect_structure_job.queue_name,
        "synthesize_recap": synthesize_recap.queue_name,
        "coach_reply": coach_reply.queue_name,
    }
    assert actual == EXPECTED_QUEUES


def test_analyze_audio_job_is_sole_declarer_of_analysis_free():
    """`analyze_audio_job` MUST declare `analysis-free` — it is the sole declarer,
    and a Dramatiq consumer only attaches to a declared queue. If it declared
    `analysis-paid` instead, W2's `{analysis-free, maintenance}` whitelist would
    match nothing and every free job would be orphaned (Task 4.1)."""
    assert analyze_audio_job.queue_name == "analysis-free"


def test_no_actor_rides_default_queue():
    """AC5 guard: nothing may ride `default` — prod has no `default` consumer."""
    # All app actors register on the same broker; read it off any actor.
    broker = coach_reply.broker
    offenders = [
        name for name, actor in broker.actors.items()
        if actor.queue_name == "default"
    ]
    assert not offenders, (
        "actors still on the `default` queue (no prod consumer → silent break): "
        + ", ".join(sorted(offenders))
    )
