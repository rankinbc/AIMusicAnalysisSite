from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from aimusic_shared.models import Song, SongVersion, UploadJob

from ..db import get_session
from ..models import User
from ..schemas.songs import (
    SongCreate, SongDetail, SongPatch, SongSummary, VersionInSongDetail,
)
from .auth import get_current_user

log = logging.getLogger(__name__)
router = APIRouter(prefix="/songs", tags=["songs"])


@router.post("/", status_code=201, response_model=SongSummary)
async def create_song(
    body: SongCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> SongSummary:
    song = Song(user_id=user.id, name=body.name.strip(), genre_hint=body.genre_hint)
    db.add(song)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "song_name_in_use", "message": "You already have a song with that name."},
        )
    await db.refresh(song)
    return SongSummary(
        song_id=str(song.id), name=song.name, genre_hint=song.genre_hint,
        version_count=0, latest_version_id=None, latest_job_id=None,
        latest_score=None, latest_grade=None, last_analyzed=None,
        created_at=song.created_at.isoformat(),
    )


def _build_song_summary(song: Song, versions: list[SongVersion], jobs_by_version: dict, analyses: dict) -> SongSummary:
    latest_version = versions[0] if versions else None  # versions ordered newest first
    latest_job = None
    latest_score = latest_grade = last_analyzed = None
    if latest_version:
        v_jobs = jobs_by_version.get(latest_version.id, [])
        completed = [j for j in v_jobs if j.status.value == "COMPLETE"]
        latest_job = completed[0] if completed else None
        if latest_job:
            a = analyses.get(latest_job.id)
            last_analyzed = latest_job.created_at.isoformat()
            if a and a.final_json:
                raw = a.final_json.get("overall_score")
                latest_score = float(raw) if raw is not None else None
                latest_grade = a.final_json.get("grade")
    return SongSummary(
        song_id=str(song.id),
        name=song.name,
        genre_hint=song.genre_hint,
        version_count=len(versions),
        latest_version_id=str(latest_version.id) if latest_version else None,
        latest_job_id=str(latest_job.id) if latest_job else None,
        latest_score=latest_score,
        latest_grade=latest_grade,
        last_analyzed=last_analyzed,
        created_at=song.created_at.isoformat(),
    )


async def _load_song_or_404(db: AsyncSession, song_id: uuid.UUID, user_id: uuid.UUID) -> Song:
    song = (await db.execute(
        select(Song).where(Song.id == song_id, Song.user_id == user_id, Song.archived_at.is_(None))
    )).scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


@router.get("/", response_model=list[SongSummary])
async def list_songs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> list[SongSummary]:
    songs = (await db.execute(
        select(Song)
        .where(Song.user_id == user.id, Song.archived_at.is_(None))
        .order_by(Song.updated_at.desc())
    )).scalars().all()
    if not songs:
        return []

    song_ids = [s.id for s in songs]
    versions = (await db.execute(
        select(SongVersion).where(SongVersion.song_id.in_(song_ids)).order_by(SongVersion.created_at.desc())
    )).scalars().all()
    versions_by_song: dict[uuid.UUID, list[SongVersion]] = {}
    for v in versions:
        versions_by_song.setdefault(v.song_id, []).append(v)

    version_ids = [v.id for v in versions]
    jobs: list[UploadJob] = []
    if version_ids:
        jobs = (await db.execute(
            select(UploadJob).where(UploadJob.version_id.in_(version_ids))
            .order_by(UploadJob.created_at.desc())
        )).scalars().all()
    jobs_by_version: dict[uuid.UUID, list[UploadJob]] = {}
    for j in jobs:
        if j.version_id is not None:
            jobs_by_version.setdefault(j.version_id, []).append(j)

    job_ids = [j.id for j in jobs]
    from aimusic_shared.models import AnalysisResult
    analyses = {}
    if job_ids:
        rows = (await db.execute(
            select(AnalysisResult).where(AnalysisResult.job_id.in_(job_ids))
        )).scalars().all()
        analyses = {a.job_id: a for a in rows}

    return [
        _build_song_summary(s, versions_by_song.get(s.id, []), jobs_by_version, analyses)
        for s in songs
    ]


@router.get("/{song_id}", response_model=SongDetail)
async def get_song(
    song_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> SongDetail:
    song = await _load_song_or_404(db, song_id, user.id)
    versions = (await db.execute(
        select(SongVersion).where(SongVersion.song_id == song.id)
        .order_by(SongVersion.created_at.desc())
    )).scalars().all()

    version_ids = [v.id for v in versions]
    jobs: list[UploadJob] = []
    if version_ids:
        jobs = (await db.execute(
            select(UploadJob).where(UploadJob.version_id.in_(version_ids))
            .order_by(UploadJob.created_at.desc())
        )).scalars().all()
    jobs_by_version: dict[uuid.UUID, list[UploadJob]] = {}
    for j in jobs:
        if j.version_id is not None:
            jobs_by_version.setdefault(j.version_id, []).append(j)

    from aimusic_shared.models import AnalysisResult
    job_ids = [j.id for j in jobs]
    analyses = {}
    if job_ids:
        rows = (await db.execute(
            select(AnalysisResult).where(AnalysisResult.job_id.in_(job_ids))
        )).scalars().all()
        analyses = {a.job_id: a for a in rows}

    summary = _build_song_summary(song, versions, jobs_by_version, analyses)
    version_dtos: list[VersionInSongDetail] = []
    for v in versions:
        v_jobs = jobs_by_version.get(v.id, [])
        completed = [j for j in v_jobs if j.status.value == "COMPLETE"]
        latest_job = completed[0] if completed else None
        score = grade = None
        if latest_job:
            a = analyses.get(latest_job.id)
            if a and a.final_json:
                raw = a.final_json.get("overall_score")
                score = float(raw) if raw is not None else None
                grade = a.final_json.get("grade")
        version_dtos.append(VersionInSongDetail(
            version_id=str(v.id),
            version_number=v.version_number,
            label=v.label,
            notes=v.notes,
            created_at=v.created_at.isoformat(),
            latest_job_id=str(latest_job.id) if latest_job else None,
            latest_score=score,
            latest_grade=grade,
            analysis_count=len(v_jobs),
        ))

    return SongDetail(
        song_id=summary.song_id,
        name=summary.name,
        genre_hint=summary.genre_hint,
        version_count=summary.version_count,
        latest_version_id=summary.latest_version_id,
        latest_job_id=summary.latest_job_id,
        latest_score=summary.latest_score,
        latest_grade=summary.latest_grade,
        last_analyzed=summary.last_analyzed,
        created_at=summary.created_at,
        versions=version_dtos,
        archived_at=song.archived_at.isoformat() if song.archived_at else None,
    )


@router.patch("/{song_id}", response_model=SongSummary)
async def patch_song(
    song_id: uuid.UUID,
    body: SongPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> SongSummary:
    song = await _load_song_or_404(db, song_id, user.id)
    if body.name is not None:
        song.name = body.name.strip()
    if body.genre_hint is not None:
        song.genre_hint = body.genre_hint
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "song_name_in_use", "message": "You already have a song with that name."},
        )
    await db.refresh(song)
    return _build_song_summary(song, [], {}, {})


@router.delete("/{song_id}", status_code=204)
async def delete_song(
    song_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    from datetime import datetime, timezone
    song = await _load_song_or_404(db, song_id, user.id)
    song.archived_at = datetime.now(timezone.utc)
    await db.commit()
    return None
