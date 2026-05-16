from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from aimusic_shared.models import JobStatus, Song, SongVersion, UploadJob

from ..db import get_session
from ..models import User
from ..routers.uploads import validate_audio_magic, validate_als_magic, ALS_MAX_BYTES
from ..schemas.versions import VersionDetail, AnalysisInVersionDetail, VersionPatch
from ..services.celery_client import dispatch_analysis_job
from ..services.storage import get_storage
from .auth import get_current_user

log = logging.getLogger(__name__)
router = APIRouter(tags=["versions"])


async def _load_song(db: AsyncSession, song_id: uuid.UUID, user_id: uuid.UUID) -> Song:
    song = (await db.execute(
        select(Song).where(Song.id == song_id, Song.user_id == user_id, Song.archived_at.is_(None))
    )).scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


async def _load_version_through_song(db: AsyncSession, version_id: uuid.UUID, user_id: uuid.UUID) -> tuple[SongVersion, Song]:
    """IDOR-safe loader — joins through songs.user_id."""
    row = (await db.execute(
        select(SongVersion, Song)
        .join(Song, SongVersion.song_id == Song.id)
        .where(SongVersion.id == version_id, Song.user_id == user_id)
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return row[0], row[1]


@router.post("/songs/{song_id}/versions", status_code=201, response_model=VersionDetail)
async def create_version(
    song_id: uuid.UUID,
    file: UploadFile = File(...),
    reference: UploadFile | None = File(None),
    als: UploadFile | None = File(None),
    label: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> VersionDetail:
    song = await _load_song(db, song_id, user.id)

    header = await file.read(12)
    if not validate_audio_magic(header):
        raise HTTPException(status_code=415, detail="Invalid audio format. Supported: MP3, FLAC, WAV")
    await file.seek(0)

    storage = get_storage()
    file_key = await storage.save(file)
    file_path = str(storage.get_path(file_key))

    reference_path: str | None = None
    if reference and reference.filename:
        ref_header = await reference.read(12)
        if not validate_audio_magic(ref_header):
            raise HTTPException(status_code=415, detail="Invalid reference audio format.")
        await reference.seek(0)
        ref_key = await storage.save(reference, prefix="ref_")
        reference_path = str(storage.get_path(ref_key))

    als_path: str | None = None
    if als and als.filename:
        if als.size and als.size > ALS_MAX_BYTES:
            raise HTTPException(status_code=413, detail="ALS file too large (max 50 MB)")
        als_header = await als.read(4)
        if not validate_als_magic(als_header):
            raise HTTPException(status_code=415, detail="Invalid ALS file")
        await als.seek(0)
        als_key = await storage.save(als, prefix="als_")
        als_path = str(storage.get_path(als_key))

    # Compute next version_number for this song
    max_n = (await db.execute(
        select(SongVersion.version_number)
        .where(SongVersion.song_id == song.id)
        .order_by(SongVersion.version_number.desc())
        .limit(1)
    )).scalar()
    next_n = (max_n or 0) + 1

    version = SongVersion(
        song_id=song.id, version_number=next_n,
        label=(label.strip() if label else None),
        notes=(notes.strip() if notes else None),
        file_path=file_path, reference_path=reference_path, als_file_path=als_path,
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)
    log.info("versions: created song=%s version=%s v_no=%s", song.id, version.id, next_n)

    return VersionDetail(
        version_id=str(version.id), song_id=str(song.id),
        version_number=version.version_number,
        label=version.label, notes=version.notes,
        file_path=version.file_path,
        has_reference=version.reference_path is not None,
        has_als=version.als_file_path is not None,
        has_stems=False,
        created_at=version.created_at.isoformat(),
        analyses=[],
    )


@router.get("/versions/{version_id}", response_model=VersionDetail)
async def get_version(
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> VersionDetail:
    version, _ = await _load_version_through_song(db, version_id, user.id)
    jobs = (await db.execute(
        select(UploadJob).where(UploadJob.version_id == version.id)
        .order_by(UploadJob.created_at.desc())
    )).scalars().all()

    from aimusic_shared.models import AnalysisResult
    job_ids = [j.id for j in jobs]
    analyses = {}
    if job_ids:
        rows = (await db.execute(
            select(AnalysisResult).where(AnalysisResult.job_id.in_(job_ids))
        )).scalars().all()
        analyses = {a.job_id: a for a in rows}

    analysis_dtos: list[AnalysisInVersionDetail] = []
    for j in jobs:
        a = analyses.get(j.id)
        score = grade = None
        if a and a.final_json:
            raw = a.final_json.get("overall_score")
            score = float(raw) if raw is not None else None
            grade = a.final_json.get("grade")
        analysis_dtos.append(AnalysisInVersionDetail(
            job_id=str(j.id), status=j.status.value,
            score=score, grade=grade,
            created_at=j.created_at.isoformat(),
            completed_at=j.completed_at.isoformat() if j.completed_at else None,
        ))

    return VersionDetail(
        version_id=str(version.id), song_id=str(version.song_id),
        version_number=version.version_number,
        label=version.label, notes=version.notes,
        file_path=version.file_path,
        has_reference=version.reference_path is not None,
        has_als=version.als_file_path is not None,
        has_stems=bool(version.stem_paths),
        created_at=version.created_at.isoformat(),
        analyses=analysis_dtos,
    )


@router.patch("/versions/{version_id}", response_model=VersionDetail)
async def patch_version(
    version_id: uuid.UUID,
    body: VersionPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> VersionDetail:
    from sqlalchemy.exc import IntegrityError
    version, _ = await _load_version_through_song(db, version_id, user.id)
    # Capture song_id before commit — after a rollback, ORM attribute access
    # can hit MissingGreenlet because the instance is expired.
    song_id_for_version = version.song_id
    if body.version_number is not None:
        version.version_number = body.version_number
    if body.label is not None:
        version.label = body.label.strip()
    if body.notes is not None:
        version.notes = body.notes
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # Find the next free version_number for this song
        max_n = (await db.execute(
            select(SongVersion.version_number)
            .where(SongVersion.song_id == song_id_for_version)
            .order_by(SongVersion.version_number.desc())
            .limit(1)
        )).scalar()
        proposed = (max_n or 0) + 1
        raise HTTPException(
            status_code=409,
            detail={"code": "version_number_in_use", "proposed": proposed},
        )
    await db.refresh(version)
    return await get_version(version_id, user, db)


@router.delete("/versions/{version_id}", status_code=204)
async def delete_version(
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    import os
    version, _ = await _load_version_through_song(db, version_id, user.id)
    # Best-effort disk cleanup
    for path in [version.file_path, version.reference_path, version.als_file_path]:
        if path:
            try:
                os.unlink(path)
            except OSError:
                log.warning("delete_version: could not unlink %s", path)
    await db.delete(version)
    await db.commit()
    return None


@router.post("/versions/{version_id}/analyze", status_code=202)
async def analyze_version(
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> dict:
    version, song = await _load_version_through_song(db, version_id, user.id)
    # Guard against concurrent analyses on the same version
    in_flight = (await db.execute(
        select(UploadJob).where(
            UploadJob.version_id == version.id,
            UploadJob.status.in_([JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.AWAITING_STEM_MAPPING]),
        ).limit(1)
    )).scalar_one_or_none()
    if in_flight is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "analysis_in_progress", "job_id": str(in_flight.id)},
        )

    initial_status = JobStatus.AWAITING_STEM_MAPPING if version.stem_paths_raw else JobStatus.PENDING
    stem_paths_arg = version.stem_paths if version.stem_paths else None

    job = UploadJob(
        user_id=user.id,
        version_id=version.id,
        file_path=version.file_path,
        reference_path=version.reference_path,
        als_file_path=version.als_file_path,
        genre_hint=song.genre_hint,
        status=initial_status,
        stem_paths_raw=version.stem_paths_raw,
        stem_paths=version.stem_paths,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # If no stems, dispatch Celery immediately.  Stems flow is handled via /versions/{id}/stems/confirm (Task 14).
    if initial_status == JobStatus.PENDING:
        try:
            task_id = dispatch_analysis_job(
                str(job.id), version.file_path, version.reference_path, str(user.id),
                als_file_path=version.als_file_path, genre_hint=song.genre_hint,
                stem_paths=stem_paths_arg,
            )
            job.task_id = task_id
            await db.commit()
        except Exception:
            log.exception("analyze_version: dispatch failed for job=%s", job.id)
            raise

    return {"job_id": str(job.id), "status": initial_status.value}
