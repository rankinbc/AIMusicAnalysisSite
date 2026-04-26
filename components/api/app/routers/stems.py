"""Stem-mapping confirmation endpoint."""
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from aimusic_shared.models import JobStatus

from ..db import get_session
from ..models import UploadJob, User
from ..services.celery_client import dispatch_analysis_job
from .auth import get_current_user

log = logging.getLogger(__name__)
router = APIRouter(prefix="/uploads", tags=["stems"])


class _Mapping(BaseModel):
    file: str
    role: str
    als_track: str | None = None


class _ConfirmRequest(BaseModel):
    mappings: list[_Mapping]


@router.post("/{job_id}/stems/confirm")
async def confirm_stem_mapping(
    job_id: str,
    body: _ConfirmRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    job = await session.get(UploadJob, job_id)
    if job is None or job.user_id != current_user.id:
        raise HTTPException(status_code=404, detail={"code": "job_not_found"})
    if job.status != JobStatus.AWAITING_STEM_MAPPING:
        raise HTTPException(
            status_code=409,
            detail={"code": "wrong_status", "status": job.status.value},
        )

    raw_paths = {Path(p).name: Path(p) for p in (job.stem_paths_raw or [])}
    submitted_files = {m.file for m in body.mappings}
    missing = set(raw_paths) - submitted_files
    if missing:
        raise HTTPException(
            status_code=422,
            detail={"code": "unmapped_stems", "files": sorted(missing)},
        )

    from audio_analysis.stems import validate_confirmed_mapping
    from audio_analysis.stems.types import ConfirmedMapping, StemRole

    try:
        confirmed = [
            ConfirmedMapping(
                file=raw_paths[m.file], role=StemRole(m.role), als_track=m.als_track,
            )
            for m in body.mappings
        ]
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_role", "message": str(e)},
        )

    try:
        validate_confirmed_mapping(confirmed)
    except ValueError as e:
        code, _, _ = str(e).partition(":")
        raise HTTPException(
            status_code=422,
            detail={"code": code.strip(), "message": str(e)},
        )

    job.stem_paths = {m.role.value: str(m.file) for m in confirmed}
    job.status = JobStatus.PENDING
    await session.commit()
    log.info("stems.confirmed: job=%s roles=%s", job.id, list(job.stem_paths))

    try:
        task_id = dispatch_analysis_job(
            str(job.id),
            job.file_path,
            job.reference_path,
            str(job.user_id),
            als_file_path=job.als_file_path,
            genre_hint=job.genre_hint,
            stem_paths=job.stem_paths,
            reference_stem_paths=None,
        )
        job.task_id = task_id
        await session.commit()
        log.info("stems.confirmed: dispatched task=%s for job=%s", task_id, job.id)
    except Exception:
        log.exception("stems.confirmed: dispatch failed for job=%s", job.id)
        raise

    return {"job_id": str(job.id), "status": JobStatus.PENDING.value}
