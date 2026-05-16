"""Tests for POST /jobs/{job_id}/save-to-library."""
from __future__ import annotations

import os
import tempfile
import uuid
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def fake_user_factory():
    from app.models import User
    def _make(**kw):
        return User(
            id=kw.get("id", uuid.uuid4()),
            email=f"s{uuid.uuid4()}@x.com",
            hashed_password="h",
        )
    return _make


@pytest.fixture
async def authed_client(fake_user_factory):
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
        ac.user = user; ac.session_factory = Session
        async with Session() as s:
            s.add(user); await s.commit()
        yield ac
    app.dependency_overrides.clear(); await engine.dispose()


async def _make_standalone_job(authed_client, *, file_exists=True):
    from aimusic_shared.models import UploadJob, JobStatus
    Session = authed_client.session_factory
    # Create a real file so save-to-library can succeed
    if file_exists:
        f = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        f.write(b"RIFF\x00\x00\x00\x00WAVE")
        f.close()
        path = f.name
    else:
        path = "/tmp/nonexistent.wav"
    async with Session() as s:
        job = UploadJob(user_id=authed_client.user.id, file_path=path, status=JobStatus.COMPLETE)
        s.add(job); await s.commit(); await s.refresh(job)
        return str(job.id), path


class TestSaveAsNewSong:
    async def test_creates_song_and_version(self, authed_client):
        job_id, _path = await _make_standalone_job(authed_client)
        r = await authed_client.post(
            f"/jobs/{job_id}/save-to-library",
            json={"action": "new_song", "name": "Brand New"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["song_id"] and body["version_id"]

        # Verify job is now linked to the new version
        from aimusic_shared.models import UploadJob
        from sqlalchemy import select
        async with authed_client.session_factory() as s:
            job = (await s.execute(select(UploadJob).where(UploadJob.id == uuid.UUID(job_id)))).scalar_one()
            assert str(job.version_id) == body["version_id"]

    async def test_410_when_file_missing(self, authed_client):
        job_id, _ = await _make_standalone_job(authed_client, file_exists=False)
        r = await authed_client.post(
            f"/jobs/{job_id}/save-to-library",
            json={"action": "new_song", "name": "Should Fail"},
        )
        assert r.status_code == 410
        assert r.json()["detail"]["code"] == "audio_expired"


class TestAddToExisting:
    async def test_creates_next_version(self, authed_client):
        from aimusic_shared.models import Song
        Session = authed_client.session_factory
        # Pre-create a song with no versions yet
        async with Session() as s:
            song = Song(user_id=authed_client.user.id, name="Existing")
            s.add(song); await s.commit(); await s.refresh(song)
            song_id = song.id

        job_id, _ = await _make_standalone_job(authed_client)
        r = await authed_client.post(
            f"/jobs/{job_id}/save-to-library",
            json={"action": "add_to_song", "song_id": str(song_id), "label": "v2 take"},
        )
        assert r.status_code == 200
        # No prior versions, so server-assigned version_number is 1
        from aimusic_shared.models import SongVersion
        from sqlalchemy import select
        async with Session() as s:
            v = (await s.execute(select(SongVersion).where(SongVersion.id == uuid.UUID(r.json()["version_id"])))).scalar_one()
            assert v.version_number == 1
            assert v.label == "v2 take"
