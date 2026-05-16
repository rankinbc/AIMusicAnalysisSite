"""Tests for /songs/{id}/versions and /versions/{id} endpoints."""
from __future__ import annotations

import io
import uuid
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def fake_user_factory():
    from app.models import User
    def _make(**kwargs):
        return User(
            id=kwargs.get("id", uuid.uuid4()),
            email=kwargs.get("email", f"v{uuid.uuid4()}@x.com"),
            hashed_password="hash",
        )
    return _make


@pytest.fixture
async def authed_client(fake_user_factory):
    """Mirror of the conftest used in test_songs_router."""
    from app.db import get_session
    from app.main import app
    from app.routers.auth import get_current_user
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from aimusic_shared.models import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    user = fake_user_factory()

    async def _override_session():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = lambda: user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        ac.user = user  # type: ignore[attr-defined]
        ac.session_factory = Session  # type: ignore[attr-defined]
        async with Session() as s:
            s.add(user)
            await s.commit()
        yield ac

    app.dependency_overrides.clear()
    await engine.dispose()


WAV_HEADER = b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 100


@pytest.fixture
async def song_id(authed_client):
    r = await authed_client.post("/songs/", json={"name": "Track"})
    return r.json()["song_id"]


class TestCreateVersion:
    async def test_no_stems_creates_version_without_job(self, authed_client, song_id):
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        r = await authed_client.post(f"/songs/{song_id}/versions", files=files, data={"label": "rough"})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["version_number"] == 1
        assert body["label"] == "rough"
        # Ensure no UploadJob was created
        from aimusic_shared.models import UploadJob
        from sqlalchemy import select
        Session = authed_client.session_factory  # type: ignore[attr-defined]
        async with Session() as s:
            jobs = (await s.execute(select(UploadJob))).scalars().all()
            assert jobs == []

    async def test_version_number_increments(self, authed_client, song_id):
        files1 = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        await authed_client.post(f"/songs/{song_id}/versions", files=files1)
        files2 = {"file": ("b.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        r = await authed_client.post(f"/songs/{song_id}/versions", files=files2)
        assert r.json()["version_number"] == 2

    async def test_rejects_invalid_magic(self, authed_client, song_id):
        files = {"file": ("bad.wav", io.BytesIO(b"\x00\x00\x00\x00not audio"), "audio/wav")}
        r = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        assert r.status_code == 415

    async def test_404_on_unknown_song(self, authed_client):
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        r = await authed_client.post(f"/songs/{uuid.uuid4()}/versions", files=files)
        assert r.status_code == 404


class TestGetVersion:
    async def test_returns_detail(self, authed_client, song_id):
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        r = await authed_client.get(f"/versions/{vid}")
        assert r.status_code == 200
        body = r.json()
        assert body["version_id"] == vid
        assert body["analyses"] == []

    async def test_404_other_user(self, authed_client, song_id, fake_user_factory):
        from app.routers.auth import get_current_user
        from app.main import app
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        other = fake_user_factory()
        Session = authed_client.session_factory
        async with Session() as s:
            s.add(other); await s.commit()
        app.dependency_overrides[get_current_user] = lambda: other
        try:
            r = await authed_client.get(f"/versions/{vid}")
            assert r.status_code == 404
        finally:
            app.dependency_overrides[get_current_user] = lambda: authed_client.user


class TestPatchVersion:
    async def test_edit_label_notes(self, authed_client, song_id):
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        r = await authed_client.patch(f"/versions/{vid}", json={"label": "mastered", "notes": "boosted 2k"})
        assert r.status_code == 200
        assert r.json()["label"] == "mastered"

    async def test_version_number_conflict_returns_409(self, authed_client, song_id):
        # Create v1 and v2; try to rename v2 to v1.
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        await authed_client.post(f"/songs/{song_id}/versions", files=files)
        files2 = {"file": ("b.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c2 = await authed_client.post(f"/songs/{song_id}/versions", files=files2)
        v2_id = c2.json()["version_id"]
        r = await authed_client.patch(f"/versions/{v2_id}", json={"version_number": 1})
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "version_number_in_use"
        assert r.json()["detail"]["proposed"] == 3


class TestDeleteVersion:
    async def test_delete_removes_version(self, authed_client, song_id):
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        r = await authed_client.delete(f"/versions/{vid}")
        assert r.status_code == 204
        r2 = await authed_client.get(f"/versions/{vid}")
        assert r2.status_code == 404


class TestAnalyzeVersion:
    async def test_analyze_dispatches_celery(self, authed_client, song_id, monkeypatch):
        sent = {}
        def fake_dispatch(job_id, file_path, reference_path, user_id, **kw):
            sent["called"] = True
            sent["job_id"] = job_id
            sent["file_path"] = file_path
            return "task-123"
        from app.routers import versions as v_mod
        monkeypatch.setattr(v_mod, "dispatch_analysis_job", fake_dispatch)

        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        r = await authed_client.post(f"/versions/{vid}/analyze")
        assert r.status_code == 202
        assert r.json()["job_id"]
        assert sent["called"]

    async def test_analyze_blocks_when_in_flight(self, authed_client, song_id, monkeypatch):
        from app.routers import versions as v_mod
        monkeypatch.setattr(v_mod, "dispatch_analysis_job", lambda *a, **kw: "tid")

        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        await authed_client.post(f"/versions/{vid}/analyze")
        r = await authed_client.post(f"/versions/{vid}/analyze")
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "analysis_in_progress"
