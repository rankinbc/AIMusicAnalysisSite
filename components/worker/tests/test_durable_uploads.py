"""Story 3.3 (AC2/AR20) — durable report + image uploads to object storage."""
from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from app import object_store  # noqa: E402
from app import tasks_dramatiq as td  # noqa: E402


class _FakeClient:
    def __init__(self):
        self.put_objects: list[tuple[str, str, bytes]] = []
        self.uploaded_files: list[tuple[str, str, str]] = []

    def put_object(self, Bucket, Key, Body, ContentType):  # noqa: N803 — boto3 API
        self.put_objects.append((Bucket, Key, Body))

    def upload_file(self, path, bucket, key, ExtraArgs=None):  # noqa: N803
        self.uploaded_files.append((bucket, key, path))


def test_put_json_uploads_report(monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setenv("S3_BUCKET", "spectr-test")
    fake = _FakeClient()
    monkeypatch.setattr(object_store, "_client", lambda: fake)

    object_store.put_json("reports/j1.json", {"overall_score": 80})

    assert len(fake.put_objects) == 1
    bucket, key, body = fake.put_objects[0]
    assert (bucket, key) == ("spectr-test", "reports/j1.json")
    assert b"overall_score" in body


def test_try_upload_durables_uploads_report_and_images(monkeypatch, tmp_path):
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setenv("S3_BUCKET", "spectr-test")
    fake = _FakeClient()
    monkeypatch.setattr(object_store, "_client", lambda: fake)
    monkeypatch.setattr(td, "LOCAL_ROOT", str(tmp_path))

    spec_key = "analysis/images/j1/spectrogram.webp"
    (tmp_path / "analysis/images/j1").mkdir(parents=True)
    (tmp_path / spec_key).write_bytes(b"RIFFWEBP")

    # waveform key exists in DB but not on disk — must be skipped, not raise.
    td._try_upload_durables("j1", {"ok": True}, spec_key, "analysis/images/j1/waveform.webp")

    assert [k for _, k, _ in fake.put_objects] == ["reports/j1.json"]
    assert [(b, k) for b, k, _ in fake.uploaded_files] == [("spectr-test", spec_key)]


def test_try_upload_durables_noop_without_s3(monkeypatch):
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    fake = _FakeClient()
    monkeypatch.setattr(object_store, "_client", lambda: fake)

    td._try_upload_durables("j1", {"ok": True}, None, None)

    assert fake.put_objects == []
    assert fake.uploaded_files == []


def test_try_upload_durables_swallows_upload_failure(monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")

    class _Boom:
        def put_object(self, **_k):
            raise RuntimeError("s3 down")

    monkeypatch.setattr(object_store, "_client", lambda: _Boom())
    # Must not raise — a completed job is never failed over a durable upload.
    td._try_upload_durables("j1", {"ok": True}, None, None)
