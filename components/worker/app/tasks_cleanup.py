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
