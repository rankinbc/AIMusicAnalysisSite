"""Run-log listing/serving for the worker's per-run log files."""
import fakeredis
import pytest

from workerdash import runlogs
from workerdash.app import create_app


def _run(root, day, name, header, args=(), footer=None):
    d = root / "runs" / day
    d.mkdir(parents=True, exist_ok=True)
    lines = [runlogs.HEADER + " ".join(f"{k}={v}" for k, v in header.items()), *args,
             "2026-10-01 INFO [-] x: hello"]
    if footer:
        lines.append(runlogs.FOOTER + " ".join(f"{k}={v}" for k, v in footer.items()))
    (d / name).write_text("\n".join(lines) + "\n", encoding="utf-8")
    return d / name


@pytest.fixture
def root(tmp_path):
    _run(tmp_path, "2026-09-30", "100000-000_analyze_audio_job_m1.log",
         {"actor": "analyze_audio_job", "pool": "analysis", "started": "1"},
         ["arg[0]: 'job-aaa'"], {"status": "ok", "duration_s": "12.0"})
    _run(tmp_path, "2026-10-01", "090000-000_analyze_audio_job_m2.log",
         {"actor": "analyze_audio_job", "pool": "analysis", "started": "2"},
         ["arg[0]: 'job-bbb'"], {"status": "died"})
    _run(tmp_path, "2026-10-01", "091500-000_coach_reply_m3.log",
         {"actor": "coach_reply", "pool": "coach", "started": "3"}, ["arg[0]: 'conv-1'"])
    return tmp_path


def test_list_newest_first_with_statuses(root):
    rows = runlogs.list_runs(root)
    assert [r["name"][:6] for r in rows] == ["091500", "090000", "100000"]
    assert [r["status"] for r in rows] == [runlogs.NO_FOOTER, "died", "ok"]


def test_filters(root):
    assert [r["actor"] for r in runlogs.list_runs(root, status="died")] == ["analyze_audio_job"]
    assert len(runlogs.list_runs(root, actor="coach_reply")) == 1
    [hit] = runlogs.list_runs(root, search="job-aaa")
    assert hit["day"] == "2026-09-30" and hit["duration_s"] == "12.0"
    assert len(runlogs.list_runs(root, days=1)) == 2  # newest day only


def test_missing_dir_is_empty(tmp_path):
    assert runlogs.list_runs(tmp_path / "nope") == []


def test_resolve_blocks_traversal(root):
    assert runlogs.resolve(root, "2026-10-01", "091500-000_coach_reply_m3.log") is not None
    assert runlogs.resolve(root, "..", "x.log") is None
    assert runlogs.resolve(root, "2026-10-01", "../../secret.log") is None
    assert runlogs.resolve(root, "2026-10-01", "missing.log") is None


def test_endpoints(root, monkeypatch):
    monkeypatch.setenv("WORKER_LOG_DIR", str(root))
    app = create_app(redis_client=fakeredis.FakeRedis(), db_connect=lambda: None)
    c = app.test_client()
    body = c.get("/api/runlogs?status=died").get_json()
    assert body["ok"] and [r["name"] for r in body["rows"]] == ["090000-000_analyze_audio_job_m2.log"]
    res = c.get("/api/runlogs/2026-10-01/090000-000_analyze_audio_job_m2.log")
    assert res.status_code == 200 and b"=== END status=died" in res.data
    assert c.get("/api/runlogs/2026-10-01/nope.log").status_code == 404


def test_log_dir_default_follows_storage_root(monkeypatch, tmp_path):
    monkeypatch.delenv("WORKER_LOG_DIR", raising=False)
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path))
    assert runlogs.log_dir() == tmp_path / "logs" / "worker"
