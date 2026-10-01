"""runlog.runfiles + runlog.config — pure filesystem/env logic."""
from __future__ import annotations

import os
import time
from datetime import date, datetime

from app.runlog import config, runfiles


def _write_run(log_dir, *, actor="analyze_audio_job", mid="m-1", pool="analysis",
               started=None, footer=None, when=None):
    when = when or datetime(2026, 10, 1, 12, 0, 0)
    path = runfiles.run_path(log_dir, when, actor, mid)
    path.parent.mkdir(parents=True, exist_ok=True)
    header = runfiles.format_kv(runfiles.HEADER_PREFIX, {
        "actor": actor, "message_id": mid, "pool": pool,
        "started": f"{started if started is not None else when.timestamp():.3f}"})
    path.write_text(header + "\nsome log line\n", encoding="utf-8")
    if footer:
        runfiles.append_footer(path, footer)
    return path


def test_header_footer_roundtrip(tmp_path):
    p = _write_run(tmp_path, footer={"status": "failed", "exc": "ValueError"})
    run = runfiles.read_run(p)
    assert run.header["actor"] == "analyze_audio_job"
    assert run.header["pool"] == "analysis"
    assert run.status == "failed"
    assert run.footer["exc"] == "ValueError"


def test_values_with_spaces_stay_parseable(tmp_path):
    line = runfiles.format_kv(runfiles.HEADER_PREFIX, {"a": "has space=and eq", "b": 1})
    assert runfiles.parse_kv(line, runfiles.HEADER_PREFIX) == {"a": "has_space_and_eq", "b": "1"}


def test_run_without_footer_is_running(tmp_path):
    assert runfiles.read_run(_write_run(tmp_path)).status == "running"


def test_footer_found_after_large_body(tmp_path):
    p = _write_run(tmp_path)
    runfiles.append_footer(p, {"status": "ok"}, body="x" * 50_000)
    assert runfiles.read_run(p).status == "ok"


def test_sweep_marks_only_own_pool_runs_started_before_boot(tmp_path):
    boot = time.time()
    dead = _write_run(tmp_path, mid="dead", started=boot - 100)
    other_pool = _write_run(tmp_path, mid="coachrun", pool="coach", started=boot - 100)
    finished = _write_run(tmp_path, mid="done", started=boot - 100, footer={"status": "ok"})
    after_boot = _write_run(tmp_path, mid="new", started=boot + 5)

    swept = runfiles.sweep_dead_runs(tmp_path, "analysis", boot)

    assert [r.path for r in swept] == [dead]
    assert runfiles.read_run(dead).status == runfiles.STATUS_DIED
    assert runfiles.read_run(other_pool).status == "running"
    assert runfiles.read_run(finished).status == "ok"
    assert runfiles.read_run(after_boot).status == "running"


def test_sweep_is_idempotent(tmp_path):
    boot = time.time()
    _write_run(tmp_path, started=boot - 10)
    assert len(runfiles.sweep_dead_runs(tmp_path, "analysis", boot)) == 1
    assert runfiles.sweep_dead_runs(tmp_path, "analysis", boot) == []


def test_crashed_attempts_counts_unfinished_and_died_only(tmp_path):
    _write_run(tmp_path, mid="M", when=datetime(2026, 10, 1, 1, 0, 0))  # no footer
    _write_run(tmp_path, mid="M", when=datetime(2026, 10, 1, 2, 0, 0), footer={"status": "died"})
    _write_run(tmp_path, mid="M", when=datetime(2026, 10, 1, 3, 0, 0), footer={"status": "failed"})
    _write_run(tmp_path, mid="other", when=datetime(2026, 10, 1, 4, 0, 0))
    assert runfiles.count_crashed_attempts(tmp_path, "M") == 2
    assert runfiles.count_crashed_attempts(tmp_path, "nope") == 0


def test_prune_removes_only_old_day_dirs(tmp_path):
    old = _write_run(tmp_path, when=datetime(2026, 9, 1, 1, 0, 0))
    recent = _write_run(tmp_path, when=datetime(2026, 9, 28, 1, 0, 0))
    removed = runfiles.prune_old_days(tmp_path, 14, today=date(2026, 10, 1))
    assert removed == [old.parent]
    assert not old.exists() and recent.exists()


def test_no_runs_dir_is_fine(tmp_path):
    assert runfiles.iter_runs(tmp_path / "missing") == []
    assert runfiles.prune_old_days(tmp_path / "missing", 14) == []


def test_log_dir_default_and_override(tmp_path):
    assert config.log_dir("/data", {}) == config.Path("/data") / "logs" / "worker"
    assert config.log_dir("/data", {"WORKER_LOG_DIR": str(tmp_path)}) == tmp_path


def test_pool_name_precedence():
    assert config.pool_name({"WORKER_POOL": "coach"}, ["--queues", "x"]) == "coach"
    assert config.pool_name({"WORKER_QUEUES": "analysis-paid analysis-free"}, []) == \
        "analysis-paid+analysis-free"
    argv = ["dramatiq", "app.dramatiq_app", "--queues", "coach", "--threads", "1"]
    assert config.pool_name({}, argv) == "coach"
    assert config.pool_name({}, ["dramatiq"]) == "all"


def test_int_env_falls_back_on_garbage():
    assert config.int_env("X", 2, {"X": "abc"}) == 2
    assert config.int_env("X", 2, {"X": "5"}) == 5
    assert config.int_env("X", 2, {}) == 2


def test_git_sha_prefers_env():
    assert config.git_sha({"GIT_SHA": "abc123"}) == "abc123"
    assert config.git_sha({"IMAGE_TAG": "sha-9f"}) == "sha-9f"
    assert isinstance(config.git_sha({}), str) and os.sep  # never raises
