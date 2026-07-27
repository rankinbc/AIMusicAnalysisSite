import os
from pathlib import Path

import pytest

from workerdash import files


def test_local_root_uses_env_override(monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", "/custom/root")
    assert files.local_root() == "/custom/root"


def test_local_root_defaults_to_repo_data_dir(monkeypatch):
    monkeypatch.delenv("STORAGE_LOCAL_ROOT", raising=False)
    root = Path(files.local_root())
    assert root.name == "data"


def test_s3_enabled_reflects_env(monkeypatch):
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    assert files.s3_enabled() is False
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    assert files.s3_enabled() is True


def test_resolve_local_root_hit(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path))
    (tmp_path / "song.wav").write_bytes(b"data")
    path, temp = files.resolve("song.wav")
    assert path == (tmp_path / "song.wav").resolve()
    assert temp is None


def test_resolve_absolute_path_hit(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path / "nonexistent"))
    abs_file = tmp_path / "elsewhere.wav"
    abs_file.write_bytes(b"data")
    path, temp = files.resolve(str(abs_file))
    assert path == abs_file
    assert temp is None


def test_resolve_rejects_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path))
    path, temp = files.resolve("../../etc/passwd")
    assert path is None and temp is None


def test_resolve_missing_file_no_s3_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path))
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    path, temp = files.resolve("missing.wav")
    assert path is None and temp is None


def test_resolve_falls_back_to_s3(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path))
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")

    class FakeClient:
        def download_file(self, bucket, key, target):
            Path(target).write_bytes(b"fetched")

    monkeypatch.setattr(files, "_s3_client", lambda: FakeClient())
    path, temp = files.resolve("song.wav")
    assert path is not None and path.read_bytes() == b"fetched"
    assert temp == path
    files.cleanup(temp)
    assert not path.exists()


def test_resolve_s3_download_failure_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path))
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")

    class FailingClient:
        def download_file(self, bucket, key, target):
            raise RuntimeError("s3 down")

    monkeypatch.setattr(files, "_s3_client", lambda: FailingClient())
    path, temp = files.resolve("song.wav")
    assert path is None and temp is None


def test_cleanup_none_is_noop():
    files.cleanup(None)  # must not raise


@pytest.mark.parametrize("name,expected", [
    ("song.wav", "audio/wav"), ("mix.mp3", "audio/mpeg"),
    ("stem.flac", "audio/flac"), ("wave.webp", "image/webp"),
    ("peaks.json", "application/json"), ("proj.als", "application/octet-stream"),
    ("unknown.xyz", "application/octet-stream"),
])
def test_content_type_for(name, expected):
    assert files.content_type_for(Path(name)) == expected
