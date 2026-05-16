"""Tests for beat-task cleanups."""
from __future__ import annotations

import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select


@pytest.fixture
async def db():
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from aimusic_shared.models import Base
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    yield Session
    await engine.dispose()


class TestOrphanCleanup:
    async def test_purges_old_standalone_jobs(self, db, monkeypatch):
        from aimusic_shared.models import User, UploadJob, JobStatus
        from app.tasks_cleanup import cleanup_orphan_uploads, ORPHAN_TTL_DAYS  # noqa: F401

        f = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        f.write(b"x"); f.close()
        path = f.name

        async with db() as s:
            u = User(id=uuid.uuid4(), email="u@x.com", hashed_password="h")
            s.add(u); await s.commit(); await s.refresh(u)
            old = UploadJob(
                user_id=u.id, file_path=path, status=JobStatus.COMPLETE,
                version_id=None,
            )
            s.add(old); await s.commit(); await s.refresh(old)
            # Force created_at to be old
            old.created_at = datetime.now(timezone.utc) - timedelta(days=31)
            await s.commit()
            old_id = old.id

        import app.tasks_cleanup as tc
        monkeypatch.setattr(tc, "_async_session_factory", lambda: db())

        await cleanup_orphan_uploads()
        assert not os.path.exists(path)

        async with db() as s:
            j = (await s.execute(select(UploadJob).where(UploadJob.id == old_id))).scalar_one_or_none()
            assert j is None  # row deleted along with file

    async def test_keeps_recent_jobs(self, db, monkeypatch):
        from aimusic_shared.models import User, UploadJob, JobStatus
        from app.tasks_cleanup import cleanup_orphan_uploads

        f = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        f.write(b"x"); f.close()
        path = f.name

        async with db() as s:
            u = User(id=uuid.uuid4(), email="u2@x.com", hashed_password="h")
            s.add(u); await s.commit(); await s.refresh(u)
            recent = UploadJob(user_id=u.id, file_path=path, status=JobStatus.COMPLETE, version_id=None)
            s.add(recent); await s.commit()

        import app.tasks_cleanup as tc
        monkeypatch.setattr(tc, "_async_session_factory", lambda: db())
        await cleanup_orphan_uploads()
        assert os.path.exists(path)
        os.unlink(path)

    async def test_keeps_jobs_linked_to_versions(self, db, monkeypatch):
        from aimusic_shared.models import User, Song, SongVersion, UploadJob, JobStatus
        from app.tasks_cleanup import cleanup_orphan_uploads

        f = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        f.write(b"x"); f.close()
        path = f.name

        async with db() as s:
            u = User(id=uuid.uuid4(), email="u3@x.com", hashed_password="h")
            s.add(u); await s.commit(); await s.refresh(u)
            song = Song(user_id=u.id, name="N"); s.add(song); await s.commit(); await s.refresh(song)
            v = SongVersion(song_id=song.id, version_number=1, file_path=path); s.add(v); await s.commit(); await s.refresh(v)
            old_linked = UploadJob(
                user_id=u.id, file_path=path, status=JobStatus.COMPLETE, version_id=v.id,
            )
            s.add(old_linked); await s.commit(); await s.refresh(old_linked)
            old_linked.created_at = datetime.now(timezone.utc) - timedelta(days=60)
            await s.commit()

        import app.tasks_cleanup as tc
        monkeypatch.setattr(tc, "_async_session_factory", lambda: db())
        await cleanup_orphan_uploads()
        assert os.path.exists(path)  # protected by version link
        os.unlink(path)


class TestPurgeArchivedSongs:
    async def test_purges_song_after_window(self, db, monkeypatch):
        from aimusic_shared.models import User, Song, SongVersion
        from app.tasks_cleanup import purge_archived_songs, ARCHIVE_TTL_DAYS  # noqa

        f = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        f.write(b"x"); f.close()
        path = f.name

        async with db() as s:
            u = User(id=uuid.uuid4(), email="a1@x.com", hashed_password="h")
            s.add(u); await s.commit(); await s.refresh(u)
            song = Song(
                user_id=u.id, name="Old",
                archived_at=datetime.now(timezone.utc) - timedelta(days=31),
            )
            s.add(song); await s.commit(); await s.refresh(song)
            v = SongVersion(song_id=song.id, version_number=1, file_path=path)
            s.add(v); await s.commit()
            song_id = song.id

        import app.tasks_cleanup as tc
        monkeypatch.setattr(tc, "_async_session_factory", lambda: db())
        await purge_archived_songs()

        async with db() as s:
            from aimusic_shared.models import Song as S2
            row = (await s.execute(select(S2).where(S2.id == song_id))).scalar_one_or_none()
            assert row is None
        assert not os.path.exists(path)

    async def test_keeps_recently_archived(self, db, monkeypatch):
        from aimusic_shared.models import User, Song
        from app.tasks_cleanup import purge_archived_songs

        async with db() as s:
            u = User(id=uuid.uuid4(), email="a2@x.com", hashed_password="h")
            s.add(u); await s.commit(); await s.refresh(u)
            song = Song(user_id=u.id, name="Recent",
                        archived_at=datetime.now(timezone.utc) - timedelta(days=5))
            s.add(song); await s.commit()
            song_id = song.id

        import app.tasks_cleanup as tc
        monkeypatch.setattr(tc, "_async_session_factory", lambda: db())
        await purge_archived_songs()

        async with db() as s:
            from aimusic_shared.models import Song as S2
            row = (await s.execute(select(S2).where(S2.id == song_id))).scalar_one_or_none()
            assert row is not None  # still archived, not yet purged
