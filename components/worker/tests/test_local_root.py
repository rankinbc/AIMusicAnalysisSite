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
