from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import AnalysisResult, JobStatus, Song, UploadJob, User
from ..schemas.songs import AnalysisSummary, SongDetail, SongSummary
from ..services.celery_client import dispatch_analysis_job
from .auth import get_current_user

log = logging.getLogger(__name__)
router = APIRouter(prefix="/songs", tags=["songs"])


def _job_to_analysis_summary(job: UploadJob, analysis: AnalysisResult | None) -> AnalysisSummary:
    score = grade = None
    if analysis and analysis.final_json:
        raw = analysis.final_json.get("overall_score")
        score = float(raw) if raw is not None else None
        grade = str(analysis.final_json.get("grade")) if analysis.final_json.get("grade") else None
    return AnalysisSummary(
        job_id=str(job.id),
        score=score,
        grade=grade,
        created_at=job.created_at.isoformat(),
        status=job.status.value,
    )


@router.get("/", response_model=list[SongSummary])
async def list_songs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> list[SongSummary]:
    songs_result = await db.execute(
        select(Song)
        .where(Song.user_id == user.id)
        .order_by(Song.updated_at.desc())
    )
    songs = songs_result.scalars().all()
    if not songs:
        return []

    song_ids = [s.id for s in songs]

    # All completed jobs for these songs, newest first per song
    jobs_result = await db.execute(
        select(UploadJob)
        .where(UploadJob.song_id.in_(song_ids))
        .order_by(UploadJob.created_at.desc())
    )
    jobs_by_song: dict[str, list[UploadJob]] = {}
    for job in jobs_result.scalars().all():
        sid = str(job.song_id)
        jobs_by_song.setdefault(sid, []).append(job)

    # Fetch analysis results for latest completed job per song
    latest_job_ids = []
    for sid, jobs in jobs_by_song.items():
        completed = [j for j in jobs if j.status == JobStatus.COMPLETE]
        if completed:
            latest_job_ids.append(completed[0].id)

    analyses: dict[str, AnalysisResult] = {}
    if latest_job_ids:
        ar_result = await db.execute(
            select(AnalysisResult).where(AnalysisResult.job_id.in_(latest_job_ids))
        )
        analyses = {str(a.job_id): a for a in ar_result.scalars().all()}

    summaries: list[SongSummary] = []
    for song in songs:
        sid = str(song.id)
        jobs = jobs_by_song.get(sid, [])
        completed = [j for j in jobs if j.status == JobStatus.COMPLETE]
        latest = completed[0] if completed else (jobs[0] if jobs else None)
        analysis = analyses.get(str(latest.id)) if latest else None

        score = grade = last_analyzed = latest_job_id = None
        if latest:
            latest_job_id = str(latest.id)
            last_analyzed = latest.created_at.isoformat()
        if analysis and analysis.final_json:
            raw = analysis.final_json.get("overall_score")
            score = float(raw) if raw is not None else None
            grade = str(analysis.final_json.get("grade")) if analysis.final_json.get("grade") else None

        summaries.append(SongSummary(
            song_id=sid,
            name=song.name,
            genre_hint=song.genre_hint,
            latest_job_id=latest_job_id,
            latest_score=score,
            latest_grade=grade,
            analysis_count=len(jobs),
            last_analyzed=last_analyzed,
        ))

    return summaries


@router.get("/{song_id}", response_model=SongDetail)
async def get_song(
    song_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> SongDetail:
    song = (await db.execute(
        select(Song).where(Song.id == song_id, Song.user_id == user.id)
    )).scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")

    jobs_result = await db.execute(
        select(UploadJob)
        .where(UploadJob.song_id == song_id)
        .order_by(UploadJob.created_at.desc())
    )
    jobs = jobs_result.scalars().all()

    job_ids = [j.id for j in jobs]
    analyses: dict[str, AnalysisResult] = {}
    if job_ids:
        ar = await db.execute(select(AnalysisResult).where(AnalysisResult.job_id.in_(job_ids)))
        analyses = {str(a.job_id): a for a in ar.scalars().all()}

    analysis_summaries = [
        _job_to_analysis_summary(j, analyses.get(str(j.id))) for j in jobs
    ]

    completed = [j for j in jobs if j.status == JobStatus.COMPLETE]
    latest = completed[0] if completed else (jobs[0] if jobs else None)
    analysis = analyses.get(str(latest.id)) if latest else None

    score = grade = last_analyzed = latest_job_id = None
    if latest:
        latest_job_id = str(latest.id)
        last_analyzed = latest.created_at.isoformat()
    if analysis and analysis.final_json:
        raw = analysis.final_json.get("overall_score")
        score = float(raw) if raw is not None else None
        grade = str(analysis.final_json.get("grade")) if analysis.final_json.get("grade") else None

    return SongDetail(
        song_id=str(song.id),
        name=song.name,
        genre_hint=song.genre_hint,
        latest_job_id=latest_job_id,
        latest_score=score,
        latest_grade=grade,
        analysis_count=len(jobs),
        last_analyzed=last_analyzed,
        analyses=analysis_summaries,
    )


@router.post("/{song_id}/analyze")
async def reanalyze_song(
    song_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Kick off a fresh analysis using the song's stored file — no re-upload needed."""
    song = (await db.execute(
        select(Song).where(Song.id == song_id, Song.user_id == user.id)
    )).scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")

    if not Path(song.file_path).exists():
        raise HTTPException(status_code=409, detail="Stored audio file is missing from server")

    job = UploadJob(
        user_id=user.id,
        song_id=song.id,
        file_path=song.file_path,
        reference_path=song.reference_path,
        als_file_path=song.als_file_path,
        genre_hint=song.genre_hint,
        track_name=song.name,
    )
    db.add(job)
    await db.commit()
    log.info("songs: re-analyze song=%s job=%s", song_id, job.id)

    try:
        task_id = dispatch_analysis_job(
            str(job.id), song.file_path, song.reference_path, str(user.id),
            als_file_path=song.als_file_path, genre_hint=song.genre_hint,
        )
        job.task_id = task_id
        await db.commit()
    except Exception:
        log.exception("songs: Celery dispatch failed for re-analyze job=%s", job.id)
        raise

    return {"job_id": str(job.id)}
