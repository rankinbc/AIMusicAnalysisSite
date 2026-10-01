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
from app.fix_rack_actor import generate_fix_rack  # noqa: E402
from app.reference_analyzer_actor import run_reference_analyzer  # noqa: E402
from app.rerun_phase_actor import rerun_phase  # noqa: E402
from app.account_deletion_actor import delete_account_data  # noqa: E402
from app.retention_actor import sweep_retention  # noqa: E402
from app.send_email_actor import send_email  # noqa: E402
from app.structure_actor import detect_structure_job  # noqa: E402
from app.tasks_dramatiq import analyze_audio_job, classify_stems  # noqa: E402
from app.triage_actor import run_triage  # noqa: E402
from app.verdict_actor import run_specialist  # noqa: E402

EXPECTED_QUEUES = {
    "analyze_audio_job": "analysis-free",
    "classify_stems": "analysis-paid",
    "run_specialist": "ai",
    "run_triage": "ai",
    "generate_fix_rack": "ai",
    "run_reference_analyzer": "analysis-paid",
    "rerun_phase": "analysis-paid",
    "detect_structure_job": "analysis-paid",
    "coach_reply": "coach",
    "sweep_retention": "maintenance",  # story 3.4 (AR22)
    "send_email": "maintenance",       # story 4.2 (AR27)
    "delete_account_data": "maintenance",  # story 4.6 (FR27)
}


def test_actor_queue_assignments():
    actual = {
        "analyze_audio_job": analyze_audio_job.queue_name,
        "classify_stems": classify_stems.queue_name,
        "run_specialist": run_specialist.queue_name,
        "run_triage": run_triage.queue_name,
        "generate_fix_rack": generate_fix_rack.queue_name,
        "run_reference_analyzer": run_reference_analyzer.queue_name,
        "rerun_phase": rerun_phase.queue_name,
        "detect_structure_job": detect_structure_job.queue_name,
        "coach_reply": coach_reply.queue_name,
        "sweep_retention": sweep_retention.queue_name,
        "send_email": send_email.queue_name,
        "delete_account_data": delete_account_data.queue_name,
    }
    assert actual == EXPECTED_QUEUES


def test_interactive_llm_actors_ride_the_ai_lane():
    """Interactive AI lane: Triage, on-demand specialists and Coach Mix are
    I/O-bound LLM work the user is waiting on. On `analysis-paid` they queued
    behind a multi-minute analyze_audio_job / allin1 structure run on the
    one-thread batch worker (no recommended specialists after an analysis).
    They MUST declare `ai`, which the multi-thread interactive pool consumes
    alongside `coach`."""
    assert run_triage.queue_name == "ai"
    assert run_specialist.queue_name == "ai"
    assert generate_fix_rack.queue_name == "ai"


def test_batch_dsp_actors_stay_off_the_ai_lane():
    """The interactive pool runs several threads; batch DSP (Demucs/librosa
    memory profile, the allin1 container) must never land on it."""
    batch = (analyze_audio_job, detect_structure_job, rerun_phase,
             run_reference_analyzer, classify_stems)
    assert not [a.actor_name for a in batch if a.queue_name in ("ai", "coach")]


def test_ai_and_legacy_paid_queues_are_declared():
    """`ai` must be declared or the interactive pool's `--queues coach ai`
    whitelist attaches no consumer. `analysis-paid` must STAY declared: triage
    / specialist / fix-rack messages enqueued there before the move dispatch
    by actor_name and are drained by the batch pool's analysis-paid consumer."""
    declared = coach_reply.broker.get_declared_queues()
    assert "ai" in declared
    assert "ai-guest" in declared
    assert "analysis-paid" in declared


def test_no_room_recap_actor_is_registered():
    import dramatiq
    from app import dramatiq_app  # noqa: F401  (imports register every actor)

    assert "synthesize_recap" not in dramatiq.get_broker().actors


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
