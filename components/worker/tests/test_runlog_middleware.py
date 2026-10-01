"""RunLogMiddleware end-to-end on a StubBroker: run files, statuses, give-up
hooks on final failure / timeout, and the poison guard."""
from __future__ import annotations

import faulthandler
import logging

import dramatiq
import pytest
from dramatiq.brokers.stub import StubBroker
from dramatiq.middleware import TimeLimitExceeded

from app.runlog import give_up, runfiles
from app.runlog.middleware import RunLogMiddleware, describe_args, install


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(give_up, "_HOOKS", {})
    broker = StubBroker()
    broker.emit_after("process_boot")
    mw = RunLogMiddleware(tmp_path, "test", git_sha="sha1", crash_max_attempts=2)
    install(broker, mw)
    root = logging.getLogger()
    before = list(root.handlers)
    level = root.level
    root.setLevel(logging.INFO)  # prod: obs.configure_logging sets INFO
    worker = dramatiq.Worker(broker, worker_threads=1, worker_timeout=50)
    worker.start()
    yield broker, mw, tmp_path, worker
    worker.stop()
    for h in list(root.handlers):
        if h not in before:
            root.removeHandler(h)
            h.close()
    if mw._crash_file is not None:
        mw._crash_file.close()
    root.setLevel(level)
    faulthandler.disable()


def _runs(log_dir):
    return runfiles.iter_runs(log_dir)


def _drain(broker, worker):
    broker.join("default", fail_fast=False)
    worker.join()


def test_middleware_is_first(env):
    broker, mw, *_ = env
    assert broker.middleware[0] is mw


def test_ok_run_has_header_logs_and_footer(env):
    broker, _mw, log_dir, worker = env

    @dramatiq.actor(broker=broker, max_retries=0)
    def hello(name):
        logging.getLogger("t").info("inside hello %s", name)

    hello.send("world")
    _drain(broker, worker)

    [run] = _runs(log_dir)
    assert run.header["actor"] == "hello"
    assert run.header["pool"] == "test"
    assert run.header["sha"] == "sha1"
    assert run.status == "ok"
    text = run.path.read_text(encoding="utf-8")
    assert "arg[0]: 'world'" in text
    assert "inside hello world" in text


def test_final_failure_writes_traceback_and_runs_hook(env):
    broker, _mw, log_dir, worker = env
    calls = []
    give_up.on_give_up("boom")(lambda a, k, r, e: calls.append((a, r, type(e).__name__)))

    @dramatiq.actor(broker=broker, max_retries=0)
    def boom(job_id):
        raise ValueError("kaboom")

    boom.send("J1")
    _drain(broker, worker)

    [run] = _runs(log_dir)
    assert run.status == "failed"
    assert run.footer["retry"] == "final"
    assert "ValueError: kaboom" in run.path.read_text(encoding="utf-8")
    assert calls == [(("J1",), give_up.REASON_RETRIES_EXHAUSTED, "ValueError")]


def test_retryable_failure_does_not_run_hook(env):
    broker, _mw, log_dir, worker = env
    calls = []
    give_up.on_give_up("flaky")(lambda *a: calls.append(a))
    attempts = []

    @dramatiq.actor(broker=broker, max_retries=1, min_backoff=1, max_backoff=1)
    def flaky():
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("first try fails")

    flaky.send()
    _drain(broker, worker)

    statuses = sorted((r.status, (r.footer or {}).get("retry")) for r in _runs(log_dir))
    assert statuses == [("failed", "will_retry"), ("ok", None)]
    assert calls == []


def test_timeout_is_its_own_status_and_reason(env):
    """TimeLimitExceeded is a BaseException — the reason actors' own
    `except Exception` arms miss it and these hooks exist."""
    broker, _mw, log_dir, worker = env
    calls = []
    give_up.on_give_up("slow")(lambda a, k, r, e: calls.append(r))

    @dramatiq.actor(broker=broker, max_retries=0)
    def slow():
        raise TimeLimitExceeded()

    slow.send()
    _drain(broker, worker)

    [run] = _runs(log_dir)
    assert run.status == runfiles.STATUS_TIMED_OUT
    assert calls == [give_up.REASON_TIMED_OUT]


def test_poison_guard_skips_after_repeated_crashes(env):
    broker, _mw, log_dir, worker = env
    calls = []
    give_up.on_give_up("crashy")(lambda a, k, r, e: calls.append((a, r)))
    ran = []

    @dramatiq.actor(broker=broker, max_retries=0)
    def crashy(job_id):
        ran.append(job_id)

    msg = crashy.message("J9")
    # Two earlier attempts of THIS message that never unwound.
    from datetime import datetime
    for hour in (1, 2):
        p = runfiles.run_path(log_dir, datetime(2026, 10, 1, hour), "crashy", msg.message_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(runfiles.format_kv(runfiles.HEADER_PREFIX, {"pool": "test"}) + "\n",
                     encoding="utf-8")

    broker.enqueue(msg)
    _drain(broker, worker)

    assert ran == []
    assert calls == [(("J9",), give_up.REASON_WORKER_CRASHED)]
    newest = max(runfiles.runs_for_message(log_dir, msg.message_id), key=lambda r: r.path.name)
    assert newest.status == runfiles.STATUS_SKIPPED
    assert newest.footer["reason"] == give_up.REASON_WORKER_CRASHED
    assert broker.dead_letters_by_queue["default"]  # parked, not lost


def test_one_crash_still_gets_a_retry(env):
    broker, _mw, log_dir, worker = env
    ran = []

    @dramatiq.actor(broker=broker, max_retries=0)
    def once(job_id):
        ran.append(job_id)

    msg = once.message("J2")
    from datetime import datetime
    p = runfiles.run_path(log_dir, datetime(2026, 10, 1, 1), "once", msg.message_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(runfiles.format_kv(runfiles.HEADER_PREFIX, {"pool": "test"}) + "\n",
                 encoding="utf-8")

    broker.enqueue(msg)
    _drain(broker, worker)
    assert ran == ["J2"]


def test_hook_failure_never_breaks_the_worker(env):
    broker, _mw, log_dir, worker = env

    def bad_hook(*_a):
        raise RuntimeError("hook blew up")

    give_up.on_give_up("dies")(bad_hook)

    @dramatiq.actor(broker=broker, max_retries=0)
    def dies():
        raise ValueError("x")

    dies.send()
    _drain(broker, worker)
    [run] = _runs(log_dir)
    assert run.status == "failed"


def test_unwritable_log_dir_never_fails_the_job(tmp_path, monkeypatch):
    blocker = tmp_path / "file-not-dir"
    blocker.write_text("x")
    broker = StubBroker()
    install(broker, RunLogMiddleware(blocker / "sub", "test"))
    worker = dramatiq.Worker(broker, worker_threads=1, worker_timeout=50)
    worker.start()
    ran = []

    @dramatiq.actor(broker=broker, max_retries=0)
    def fine():
        ran.append(1)

    try:
        fine.send()
        broker.join("default", fail_fast=True)
        worker.join()
    finally:
        worker.stop()
    assert ran == [1]


def test_send_email_args_are_redacted():
    lines = describe_args("send_email", ("a@b.c", "subj", "<html>"), {})
    assert lines == ["args: <redacted, 3 values>"]
    assert describe_args("x", ("y" * 500,), {})[0].endswith("(502 chars)")


def test_process_boot_sweeps_dead_runs_and_opens_pool_and_crash_logs(tmp_path):
    from datetime import datetime
    p = runfiles.run_path(tmp_path, datetime(2026, 10, 1, 1), "analyze_audio_job", "dead-1")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(runfiles.format_kv(runfiles.HEADER_PREFIX, {
        "actor": "analyze_audio_job", "message_id": "dead-1", "pool": "analysis",
        "started": "1000.0"}) + "\n", encoding="utf-8")

    mw = RunLogMiddleware(tmp_path, "analysis", git_sha="s")
    root = logging.getLogger()
    before = list(root.handlers)
    try:
        mw.after_process_boot(StubBroker())
        assert runfiles.read_run(p).status == runfiles.STATUS_DIED
        assert (tmp_path / "pool-analysis.log").exists()
        assert "process boot" in (tmp_path / "crash-analysis.log").read_text(encoding="utf-8")
    finally:
        for h in list(root.handlers):
            if h not in before:
                root.removeHandler(h)
                h.close()
        faulthandler.disable()
        mw._crash_file.close()
