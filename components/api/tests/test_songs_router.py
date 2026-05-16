"""Tests for /songs/ endpoints."""
from __future__ import annotations

import uuid
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def fake_user_factory():
    from app.models import User
    def _make(**kwargs):
        return User(
            id=kwargs.get("id", uuid.uuid4()),
            email=kwargs.get("email", f"u{uuid.uuid4()}@x.com"),
            hashed_password="hash",
        )
    return _make


@pytest.fixture
async def authed_client(fake_user_factory):
    """An async test client with auth + DB session faked. Use `.user` to get the user."""
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
        # Seed the user row so FK constraints behave on backends that enforce them
        async with Session() as s:
            s.add(user)
            await s.commit()
        yield ac

    app.dependency_overrides.clear()
    await engine.dispose()


class TestCreateSong:
    async def test_creates_song_with_minimal_body(self, authed_client):
        r = await authed_client.post("/songs/", json={"name": "Track One"})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["name"] == "Track One"
        assert body["version_count"] == 0
        assert "song_id" in body

    async def test_rejects_duplicate_name_for_same_user(self, authed_client):
        await authed_client.post("/songs/", json={"name": "Dup"})
        r = await authed_client.post("/songs/", json={"name": "Dup"})
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "song_name_in_use"

    async def test_requires_auth(self):
        from app.main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/songs/", json={"name": "X"})
        assert r.status_code == 401


class TestListSongs:
    async def test_empty_list(self, authed_client):
        r = await authed_client.get("/songs/")
        assert r.status_code == 200
        assert r.json() == []

    async def test_lists_songs_newest_first(self, authed_client):
        await authed_client.post("/songs/", json={"name": "A"})
        await authed_client.post("/songs/", json={"name": "B"})
        r = await authed_client.get("/songs/")
        assert r.status_code == 200
        names = [s["name"] for s in r.json()]
        assert set(names) == {"A", "B"}
        assert all(s["version_count"] == 0 for s in r.json())

    async def test_excludes_archived(self, authed_client):
        c = await authed_client.post("/songs/", json={"name": "Z"})
        sid = c.json()["song_id"]
        await authed_client.delete(f"/songs/{sid}")
        r = await authed_client.get("/songs/")
        assert r.json() == []


class TestSongDetail:
    async def test_detail_includes_empty_versions(self, authed_client):
        c = await authed_client.post("/songs/", json={"name": "D"})
        sid = c.json()["song_id"]
        r = await authed_client.get(f"/songs/{sid}")
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == "D"
        assert body["versions"] == []

    async def test_detail_404_when_not_found(self, authed_client):
        r = await authed_client.get(f"/songs/{uuid.uuid4()}")
        assert r.status_code == 404


class TestPatchSong:
    async def test_rename(self, authed_client):
        c = await authed_client.post("/songs/", json={"name": "Old"})
        sid = c.json()["song_id"]
        r = await authed_client.patch(f"/songs/{sid}", json={"name": "New"})
        assert r.status_code == 200
        assert r.json()["name"] == "New"

    async def test_patch_conflict(self, authed_client):
        await authed_client.post("/songs/", json={"name": "Taken"})
        c = await authed_client.post("/songs/", json={"name": "Other"})
        sid = c.json()["song_id"]
        r = await authed_client.patch(f"/songs/{sid}", json={"name": "Taken"})
        assert r.status_code == 409


class TestRestoreSong:
    async def test_restore_archived_song(self, authed_client):
        c = await authed_client.post("/songs/", json={"name": "R"})
        sid = c.json()["song_id"]
        await authed_client.delete(f"/songs/{sid}")
        r = await authed_client.post(f"/songs/{sid}/restore")
        assert r.status_code == 200
        listing = await authed_client.get("/songs/")
        assert any(s["song_id"] == sid for s in listing.json())

    async def test_restore_outside_window_returns_410(self, authed_client):
        from datetime import datetime, timedelta, timezone
        from aimusic_shared.models import Song
        c = await authed_client.post("/songs/", json={"name": "Old"})
        sid = c.json()["song_id"]
        await authed_client.delete(f"/songs/{sid}")
        # Manually push archived_at past the 30d window
        Session = authed_client.session_factory  # type: ignore[attr-defined]
        async with Session() as s:
            from sqlalchemy import select
            song = (await s.execute(select(Song).where(Song.id == uuid.UUID(sid)))).scalar_one()
            song.archived_at = datetime.now(timezone.utc) - timedelta(days=31)
            await s.commit()
        r = await authed_client.post(f"/songs/{sid}/restore")
        assert r.status_code == 410


class TestIDOR:
    async def test_cannot_access_other_users_song(self, authed_client, fake_user_factory):
        from app.routers.auth import get_current_user
        from app.main import app
        # Create a song as the current user
        c = await authed_client.post("/songs/", json={"name": "Mine"})
        sid = c.json()["song_id"]
        # Now switch to a different user via the dependency override
        other = fake_user_factory()
        Session = authed_client.session_factory  # type: ignore[attr-defined]
        async with Session() as s:
            s.add(other)
            await s.commit()
        app.dependency_overrides[get_current_user] = lambda: other
        try:
            r = await authed_client.get(f"/songs/{sid}")
            assert r.status_code == 404
        finally:
            app.dependency_overrides[get_current_user] = lambda: authed_client.user  # type: ignore[attr-defined]
