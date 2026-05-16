import asyncio
import json
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import AsyncSessionLocal, get_session
from ..models import AnalysisResult, JobStatus, UploadJob, User
from ..schemas.jobs import JobStatus as JobStatusSchema, JobSummary
from .auth import get_current_user, get_current_user_sse

router = APIRouter()


@router.get("/", response_model=list[JobSummary])
async def list_jobs(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[JobSummary]:
    """Return the 50 most recent jobs for the current user."""
    jobs_result = await session.execute(
        select(UploadJob)
        .where(UploadJob.user_id == current_user.id)
        .order_by(UploadJob.created_at.desc())
        .limit(50)
    )
    jobs = jobs_result.scalars().all()

    if not jobs:
        return []

    job_ids = [j.id for j in jobs]
    analyses_result = await session.execute(
        select(AnalysisResult).where(AnalysisResult.job_id.in_(job_ids))
    )
    analyses = {str(a.job_id): a for a in analyses_result.scalars().all()}

    summaries: list[JobSummary] = []
    for job in jobs:
        filename = Path(job.file_path).name if job.file_path else "unknown"
        analysis = analyses.get(str(job.id))
        score = grade = None
        if analysis and analysis.final_json:
            score = analysis.final_json.get("overall_score")
            grade = analysis.final_json.get("grade")
        summaries.append(
            JobSummary(
                job_id=str(job.id),
                status=job.status.value,
                filename=filename,
                created_at=job.created_at.isoformat(),
                score=float(score) if score is not None else None,
                grade=str(grade) if grade is not None else None,
            )
        )
    return summaries


@router.get("/{job_id}/status", response_model=JobStatusSchema)
async def get_job_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> JobStatusSchema:
    """Return current job state.  Always scoped to current_user (IDOR prevention)."""
    result = await session.execute(
        select(UploadJob).where(
            UploadJob.id == job_id,
            UploadJob.user_id == current_user.id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    proposed_mapping = None
    als_track_names = None
    if job.status.value == "AWAITING_STEM_MAPPING" and job.stem_paths_raw:
        from pathlib import Path
        from audio_analysis.stems import propose_mapping
        from ..schemas.jobs import StemMappingProposalDTO
        from .uploads import _parse_als_track_names

        als_track_names = (
            _parse_als_track_names(job.als_file_path) if job.als_file_path else None
        ) or []
        proposals = propose_mapping(
            [Path(p) for p in job.stem_paths_raw],
            als_track_names or None,
        )
        proposed_mapping = [
            StemMappingProposalDTO(
                file=p.file.name,
                proposed_role=p.proposed_role.value,
                proposed_als_track=p.proposed_als_track,
                confidence=p.confidence,
            )
            for p in proposals
        ]

    return JobStatusSchema(
        job_id=str(job.id),
        status=job.status.value,
        current_phase=job.current_phase,
        phase_name=job.phase_name,
        phase_pct=job.phase_pct,
        has_als=job.als_file_path is not None,
        proposed_mapping=proposed_mapping,
        als_track_names=als_track_names,
    )


@router.get("/{job_id}/stream")
async def stream_job_progress(
    job_id: str,
    request: Request,
    current_user: User = Depends(get_current_user_sse),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """
    SSE endpoint — streams per-phase progress events until job completes or fails.

    Access-Control-Allow-Origin is set to the first configured origin (explicit, not *),
    and Access-Control-Allow-Credentials is true, matching EventSource with
    withCredentials: true on the frontend.
    """
    # Verify ownership before streaming
    result = await session.execute(
        select(UploadJob).where(
            UploadJob.id == job_id,
            UploadJob.user_id == current_user.id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        while True:
            # Open a fresh session each poll tick — the SSE generator runs outside
            # the request-scoped session lifetime.
            async with AsyncSessionLocal() as poll_session:
                r = await poll_session.execute(
                    select(UploadJob).where(UploadJob.id == job_id)
                )
                current_job = r.scalar_one_or_none()
                if not current_job:
                    yield 'event: error\ndata: {"error": "Job not found"}\n\n'
                    return

                data = json.dumps(
                    {
                        "job_id": str(current_job.id),
                        "status": current_job.status.value,
                        "phase": current_job.current_phase,
                        "phase_name": current_job.phase_name,
                        "pct": current_job.phase_pct,
                        "has_als": current_job.als_file_path is not None,
                    }
                )
                yield f"data: {data}\n\n"

                if current_job.status == JobStatus.COMPLETE:
                    complete_data = json.dumps({"job_id": str(current_job.id)})
                    yield f"event: complete\ndata: {complete_data}\n\n"
                    await asyncio.sleep(0.5)
                    return
                if current_job.status == JobStatus.FAILED:
                    yield 'event: error\ndata: {"error": "Analysis failed"}\n\n'
                    return

            await asyncio.sleep(1)

    # Reflect the actual request origin if it's in the allowed list.
    req_origin = request.headers.get("origin", "")
    origin = (
        req_origin
        if req_origin in settings.CORS_ALLOW_ORIGINS
        else (settings.CORS_ALLOW_ORIGINS[0] if settings.CORS_ALLOW_ORIGINS else "http://localhost:5173")
    )
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        },
    )


@router.get("/{job_id}/results")
async def get_job_results(
    job_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return the completed analysis JSON.  Scoped to current_user (IDOR prevention)."""
    job_result = await session.execute(
        select(UploadJob).where(
            UploadJob.id == job_id,
            UploadJob.user_id == current_user.id,
        )
    )
    job = job_result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    analysis_result = await session.execute(
        select(AnalysisResult).where(AnalysisResult.job_id == job_id)
    )
    analysis = analysis_result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=404, detail="Results not yet available")

    return {
        "job_id": job_id,
        "result": analysis.final_json,
        "share_token": analysis.share_token,
    }


import os
import uuid as _uuid
from sqlalchemy.exc import IntegrityError
from aimusic_shared.models import Song, SongVersion
from ..schemas.jobs import SaveToLibraryResult, SaveAsNewSong, AddToExistingSong


@router.post("/{job_id}/save-to-library", response_model=SaveToLibraryResult)
async def save_to_library(
    job_id: _uuid.UUID,
    body: dict,  # parse manually via discriminator
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SaveToLibraryResult:
    action = body.get("action")
    if action == "new_song":
        parsed = SaveAsNewSong(**body)
    elif action == "add_to_song":
        parsed = AddToExistingSong(**body)
    else:
        raise HTTPException(status_code=422, detail="Unknown action")

    # 1. Load job + IDOR check
    job = (await session.execute(
        select(UploadJob).where(UploadJob.id == job_id, UploadJob.user_id == current_user.id)
    )).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.version_id is not None:
        raise HTTPException(status_code=409, detail={"code": "already_saved", "version_id": str(job.version_id)})

    # 2. Verify the audio file still exists on disk
    if not job.file_path or not os.path.exists(job.file_path):
        raise HTTPException(
            status_code=410,
            detail={"code": "audio_expired", "message": "This recording has expired — please re-upload to save it."},
        )

    # 3. Get-or-create song
    if isinstance(parsed, SaveAsNewSong):
        song = Song(user_id=current_user.id, name=parsed.name.strip(), genre_hint=parsed.genre_hint)
        session.add(song)
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            raise HTTPException(status_code=409, detail={"code": "song_name_in_use"})
        label = parsed.label
        notes = parsed.notes
    else:  # AddToExistingSong
        song = (await session.execute(
            select(Song).where(Song.id == parsed.song_id, Song.user_id == current_user.id, Song.archived_at.is_(None))
        )).scalar_one_or_none()
        if song is None:
            raise HTTPException(status_code=404, detail="Song not found")
        label = parsed.label
        notes = parsed.notes

    # 4. Server-assign next version_number for this song
    max_n = (await session.execute(
        select(SongVersion.version_number)
        .where(SongVersion.song_id == song.id)
        .order_by(SongVersion.version_number.desc())
        .limit(1)
    )).scalar()
    next_n = (max_n or 0) + 1

    # 5. Create SongVersion pointing at the same file_path
    version = SongVersion(
        song_id=song.id,
        version_number=next_n,
        label=label.strip() if label else None,
        notes=notes,
        file_path=job.file_path,
        reference_path=job.reference_path,
        als_file_path=job.als_file_path,
    )
    session.add(version)
    await session.flush()

    # 6. Link the job
    job.version_id = version.id
    await session.commit()

    return SaveToLibraryResult(song_id=str(song.id), version_id=str(version.id))
