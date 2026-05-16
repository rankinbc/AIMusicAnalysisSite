"""Periodic cleanup tasks. Beat-scheduled."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from celery import shared_task
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from aimusic_shared.models import JobStatus, UploadJob

log = logging.getLogger(__name__)

MAPPING_TIMEOUT_HOURS = 24


def _async_session_factory():
    """Lazy import so Celery doesn't load the DB layer until the task runs."""
    from .db import async_session_factory  # type: ignore[attr-defined]
    return async_session_factory()


async def _fetch_awaiting_jobs() -> list[UploadJob]:
    async with _async_session_factory() as session:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=MAPPING_TIMEOUT_HOURS)
        result = await session.execute(
            select(UploadJob).where(
                UploadJob.status == JobStatus.AWAITING_STEM_MAPPING,
                UploadJob.created_at <= cutoff,
            )
        )
        return list(result.scalars().all())


async def _mark_failed(job_id: str, *, code: str) -> None:
    async with _async_session_factory() as session:
        job = await session.get(UploadJob, job_id)
        if job is None:
            return
        job.status = JobStatus.FAILED
        await session.commit()
        log.info("mapping_timeout: marked job=%s FAILED (%s)", job_id, code)


async def _purge_files(job_id: str) -> None:
    upload_dir = Path("data/uploads") / job_id
    if upload_dir.exists():
        for child in upload_dir.glob("**/*"):
            if child.is_file():
                try:
                    child.unlink(missing_ok=True)
                except OSError as exc:
                    log.warning("mapping_timeout: could not unlink %s: %s", child, exc)


async def expire_stale_stem_mappings() -> None:
    for job in await _fetch_awaiting_jobs():
        await _mark_failed(str(job.id), code="mapping_timeout")
        await _purge_files(str(job.id))


@shared_task(name="app.tasks_cleanup.expire_stale_stem_mappings_task")
def expire_stale_stem_mappings_task() -> None:
    asyncio.run(expire_stale_stem_mappings())


ORPHAN_TTL_DAYS = 30


async def cleanup_orphan_uploads() -> None:
    """Purge files + delete standalone UploadJobs older than ORPHAN_TTL_DAYS.

    Standalone = version_id IS NULL. Linked jobs are protected.
    We delete the row outright because UploadJob.file_path is NOT NULL —
    nullifying isn't an option without a schema change.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=ORPHAN_TTL_DAYS)
    async with _async_session_factory() as session:
        result = await session.execute(
            select(UploadJob).where(
                UploadJob.version_id.is_(None),
                UploadJob.created_at < cutoff,
            )
        )
        jobs = list(result.scalars().all())

        for job in jobs:
            for path_attr in ("file_path", "reference_path", "als_file_path"):
                p = getattr(job, path_attr)
                if p:
                    try:
                        Path(p).unlink(missing_ok=True)
                    except OSError as exc:
                        log.warning("cleanup_orphan_uploads: could not unlink %s: %s", p, exc)
            await session.delete(job)
            log.info("cleanup_orphan_uploads: purged job=%s", job.id)
        await session.commit()


@shared_task(name="app.tasks_cleanup.cleanup_orphan_uploads_task")
def cleanup_orphan_uploads_task() -> None:
    asyncio.run(cleanup_orphan_uploads())


ARCHIVE_TTL_DAYS = 30


async def purge_archived_songs() -> None:
    """Hard-delete songs whose archived_at is older than ARCHIVE_TTL_DAYS.

    Cascades through SongVersion -> UploadJob -> AnalysisResult via DB constraints.
    Also unlinks audio files on disk.
    """
    from aimusic_shared.models import Song, SongVersion

    cutoff = datetime.now(timezone.utc) - timedelta(days=ARCHIVE_TTL_DAYS)
    async with _async_session_factory() as session:
        songs = list((await session.execute(
            select(Song).where(
                Song.archived_at.isnot(None),
                Song.archived_at < cutoff,
            )
        )).scalars().all())

        for song in songs:
            versions = list((await session.execute(
                select(SongVersion).where(SongVersion.song_id == song.id)
            )).scalars().all())
            for v in versions:
                for p in (v.file_path, v.reference_path, v.als_file_path):
                    if p:
                        try:
                            Path(p).unlink(missing_ok=True)
                        except OSError as exc:
                            log.warning("purge_archived_songs: unlink %s failed: %s", p, exc)
            await session.delete(song)
            log.info("purge_archived_songs: hard-deleted song=%s", song.id)
        await session.commit()


@shared_task(name="app.tasks_cleanup.purge_archived_songs_task")
def purge_archived_songs_task() -> None:
    asyncio.run(purge_archived_songs())
