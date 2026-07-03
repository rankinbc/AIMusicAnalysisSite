"""Story 3.2 — object_store.resolve_local: local-first, S3 fetch fallback."""
from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from app import object_store  # noqa: E402


def test_local_file_wins_and_nothing_is_fetched(tmp_path, monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    rel = "audio/u/j/source.wav"
    target = tmp_path / rel
    target.parent.mkdir(parents=True)
    target.write_bytes(b"RIFF....WAVE")

    local, fetched = object_store.resolve_local(rel, str(tmp_path))
    assert Path(local) == target.resolve()
    assert fetched is None


def test_missing_local_without_s3_returns_join_unchanged(tmp_path, monkeypatch):
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    local, fetched = object_store.resolve_local("stems/j/x.wav", str(tmp_path))
    assert fetched is None
    assert Path(local) == (tmp_path / "stems/j/x.wav").resolve()


def test_missing_local_with_s3_fetches(tmp_path, monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setenv("S3_BUCKET", "spectr-test")

    class _FakeClient:
        def download_file(self, bucket, key, target):
            Path(target).write_bytes(b"fLaC" + b"\x00" * 8)

    monkeypatch.setattr(object_store, "_client", lambda: _FakeClient())

    local, fetched = object_store.resolve_local("stems/j/x.flac", str(tmp_path))
    try:
        assert fetched is not None
        assert Path(local).exists()
        assert Path(local).suffix == ".flac"
    finally:
        object_store.cleanup_all([fetched])
    assert not Path(local).exists()


def test_traversal_in_stored_path_is_rejected(tmp_path, monkeypatch):
    import pytest

    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    with pytest.raises(ValueError):
        object_store.resolve_local("stems/j/../../audio/victim/source.wav", str(tmp_path))


def test_absolute_existing_path_passes_through(tmp_path, monkeypatch):
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    f = tmp_path / "abs.wav"
    f.write_bytes(b"RIFF....WAVE")
    local, fetched = object_store.resolve_local(str(f), str(tmp_path / "elsewhere"))
    assert fetched is None
    assert Path(local) == f
