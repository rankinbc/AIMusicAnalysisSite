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
