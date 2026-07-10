"""Storage-root resolution for the dramatiq worker.

Regression for the Windows local-dev bug: ``STORAGE_LOCAL_ROOT`` was unset, so
``LOCAL_ROOT`` defaulted to the container path ``/data`` and ``Path("/data") /
key).resolve()`` produced ``C:\\data\\audio\\upload\\...`` — missing the file
the BFF actually wrote under the repo's ``data/`` dir, which surfaced as
``[Errno 2] No such file or directory``.
"""
import os
from pathlib import Path

import pytest

# tasks_dramatiq -> db_sync builds a SQLAlchemy engine at import time and raises
# without DATABASE_URL. A dummy URL is enough; no connection is opened.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from app import tasks_dramatiq  # noqa: E402


def test_explicit_env_var_wins(monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", "/custom/root")
    assert tasks_dramatiq._resolve_local_root() == "/custom/root"


def test_default_is_container_path_in_linux(monkeypatch):
    monkeypatch.delenv("STORAGE_LOCAL_ROOT", raising=False)
    monkeypatch.setattr(tasks_dramatiq.os, "name", "posix")
    assert tasks_dramatiq._resolve_local_root() == "/data"


@pytest.mark.skipif(os.name != "nt", reason=(
    "Windows host only: patching os.name to 'nt' makes pathlib.Path dispatch "
    "to WindowsPath, which cannot be instantiated on POSIX"
))
def test_default_is_repo_data_on_windows(monkeypatch):
    monkeypatch.delenv("STORAGE_LOCAL_ROOT", raising=False)
    monkeypatch.setattr(tasks_dramatiq.os, "name", "nt")
    resolved = Path(tasks_dramatiq._resolve_local_root())
    # Must NOT be the bare container path; must point at the repo's data/ dir.
    assert str(resolved) != "/data"
    assert resolved.name == "data"
    assert resolved == Path(tasks_dramatiq.__file__).resolve().parents[3] / "data"


# ── Story 12.3 (AC3) — boot-line fragment + missing-root warning decision ────
# Pure helper so the log content is testable without importing dramatiq_app
# (broker side effects stay out of the suite — 12-2 convention).


def test_storage_boot_summary_existing_root_no_warning(tmp_path):
    frag, warn = tasks_dramatiq.storage_boot_summary(
        str(tmp_path), str(tmp_path / "output" / "analysis_results")
    )
    assert f"storage_root={tmp_path}" in frag
    assert "results_dir=" in frag
    assert warn is None


def test_storage_boot_summary_missing_root_warns(tmp_path):
    missing = tmp_path / "definitely-missing"
    frag, warn = tasks_dramatiq.storage_boot_summary(str(missing), str(missing / "out"))
    assert f"storage_root={missing}" in frag  # the path still appears on the info line
    assert warn is not None
    assert "does not exist" in warn
    assert "STORAGE_LOCAL_ROOT" in warn  # points at the compose-leak root cause


@pytest.mark.skipif(os.name != "nt", reason=(
    "the compose-only /data leak is a Windows-native symptom (resolves to C:\\data)"
))
def test_storage_boot_summary_compose_root_on_native_windows_warns():
    _, warn = tasks_dramatiq.storage_boot_summary("/data", "/data/output/analysis_results")
    assert warn is not None


def test_storage_boot_summary_never_raises_on_invalid_path():
    # 12-2 rule: never crash for a log line — an unparseable path must still
    # produce a summary (and the warning, since it cannot be a directory).
    frag, warn = tasks_dramatiq.storage_boot_summary("\x00bad\x00path", "x")
    assert "storage_root=" in frag
    assert warn is not None
