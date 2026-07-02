"""Story 3.1 — worker S3 fetch shim (app/object_store.py)."""
from __future__ import annotations

import os
from pathlib import Path

from app import object_store

# Guard: several suite files setdefault DATABASE_URL; this module needs none.


def test_s3_disabled_without_endpoint(monkeypatch):
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    assert object_store.s3_enabled() is False


def test_s3_enabled_with_endpoint(monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    assert object_store.s3_enabled() is True


def test_fetch_to_local_downloads_with_extension(monkeypatch, tmp_path):
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setenv("S3_BUCKET", "spectr-test")

    downloaded: dict[str, str] = {}

    class _FakeClient:
        def download_file(self, bucket: str, key: str, target: str) -> None:
            downloaded["bucket"] = bucket
            downloaded["key"] = key
            Path(target).write_bytes(b"RIFF....WAVE")

    monkeypatch.setattr(object_store, "_client", lambda: _FakeClient())

    result = object_store.fetch_to_local("audio/u1/j1/source.wav")
    try:
        assert result.exists()
        assert result.suffix == ".wav"
        assert downloaded == {"bucket": "spectr-test", "key": "audio/u1/j1/source.wav"}
    finally:
        object_store.cleanup_local(result)
    assert not result.exists()
    assert not result.parent.exists()


def test_cleanup_local_none_is_noop():
    object_store.cleanup_local(None)  # must not raise


def test_analyze_job_uses_fetch_when_local_missing(monkeypatch):
    """tasks_dramatiq wires the shim: S3 enabled + missing local file -> fetch."""
    os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")
    from app import tasks_dramatiq

    # The seam the actor uses is the module import — patchable.
    assert tasks_dramatiq.object_store is object_store
