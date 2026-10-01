"""Give-up hooks: idempotent terminal writes that never clobber a better one."""
from __future__ import annotations

import uuid

import pytest

from aimusic_shared.models import JOB_STATUS_COMPLETE, JOB_STATUS_FAILED, JOB_STATUS_PROCESSING
from app.runlog import give_up, hooks


class _Job:
    def __init__(self, status, error_code=None, error_message=None):
        self.status = status
        self.error_code = error_code
        self.error_message = error_message
        self.failed_at = None
        self.current_phase = "phase 4"


class _Session:
    def __init__(self, obj):
        self.obj = obj

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def get(self, _model, _id):
        return self.obj


@pytest.fixture
def wire(monkeypatch):
    def _wire(obj):
        monkeypatch.setattr(hooks.SessionFactory, "begin", lambda: _Session(obj))
        return obj
    return _wire


def test_processing_job_is_failed_with_reason_code(wire):
    job = wire(_Job(JOB_STATUS_PROCESSING))
    give_up.run_hook("analyze_audio_job", (str(uuid.uuid4()),), {},
                     give_up.REASON_TIMED_OUT, None)
    assert job.status == JOB_STATUS_FAILED
    assert job.error_code == "timed_out"
    assert "time limit" in job.error_message
    assert job.current_phase == "failed" and job.failed_at is not None


def test_existing_failure_details_are_kept(wire):
    job = wire(_Job(JOB_STATUS_FAILED, error_code="worker_unavailable", error_message="reaped"))
    hooks.fail_job_row(uuid.uuid4(), give_up.REASON_WORKER_CRASHED, None)
    assert (job.error_code, job.error_message) == ("worker_unavailable", "reaped")


def test_actor_failure_arm_message_kept_code_filled(wire):
    job = wire(_Job(JOB_STATUS_FAILED, error_message="decode boom"))
    hooks.fail_job_row(uuid.uuid4(), give_up.REASON_RETRIES_EXHAUSTED, ValueError("x"))
    assert job.error_message == "decode boom"
    assert job.error_code == "retries_exhausted"


def test_complete_job_untouched(wire):
    job = wire(_Job(JOB_STATUS_COMPLETE))
    hooks.fail_job_row(uuid.uuid4(), give_up.REASON_TIMED_OUT, None)
    assert job.status == JOB_STATUS_COMPLETE and job.error_code is None


def test_missing_job_is_noop(wire):
    wire(None)
    hooks.fail_job_row(uuid.uuid4(), give_up.REASON_TIMED_OUT, None)  # no raise
    hooks.fail_job_row(None, give_up.REASON_TIMED_OUT, None)


def test_rerun_hook_reads_kwarg(wire):
    job = wire(_Job(JOB_STATUS_PROCESSING))
    give_up.run_hook("rerun_phase", (), {"rerun_job_id": str(uuid.uuid4())},
                     give_up.REASON_WORKER_CRASHED, None)
    assert job.error_code == "worker_crashed"


class _Version:
    def __init__(self, entries):
        self.stem_paths_raw = entries


def test_classify_hook_degrades_only_unclassified_entries(wire):
    v = wire(_Version([{"path": "a", "detected_role": "kick"}, {"path": "b"}]))
    give_up.run_hook("classify_stems", (str(uuid.uuid4()),), {},
                     give_up.REASON_TIMED_OUT, None)
    assert v.stem_paths_raw[0]["detected_role"] == "kick"
    assert v.stem_paths_raw[1]["detected_role"] == "other"
    assert v.stem_paths_raw[1]["confidence"] == 0.0


def test_coach_hook_marks_pending_reply_error(monkeypatch):
    seen = {}
    monkeypatch.setattr(hooks.coach_actor, "_mark_error",
                        lambda mid, **kw: seen.update(mid=mid, **kw))
    c, u, a = (str(uuid.uuid4()) for _ in range(3))
    give_up.run_hook("coach_reply", (c, u, a), {}, give_up.REASON_TIMED_OUT, None)
    assert seen == {"mid": uuid.UUID(a), "user_message_id": uuid.UUID(u)}


def test_unknown_actor_has_no_hook():
    assert give_up.run_hook("nope", (), {}, give_up.REASON_TIMED_OUT, None) is False
