import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import AsyncSessionLocal, get_session
from ..models import AnalysisResult, JobStatus, UploadJob, User
from ..schemas.jobs import JobStatus as JobStatusSchema
from .auth import get_current_user

router = APIRouter()


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

    return JobStatusSchema(
        job_id=str(job.id),
        status=job.status.value,
        current_phase=job.current_phase,
        phase_name=job.phase_name,
        phase_pct=job.phase_pct,
    )


@router.get("/{job_id}/stream")
async def stream_job_progress(
    job_id: str,
    current_user: User = Depends(get_current_user),
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
                    }
                )
                yield f"data: {data}\n\n"

                if current_job.status == JobStatus.COMPLETE:
                    complete_data = json.dumps({"job_id": str(current_job.id)})
                    yield f"event: complete\ndata: {complete_data}\n\n"
                    return
                if current_job.status == JobStatus.FAILED:
                    yield 'event: error\ndata: {"error": "Analysis failed"}\n\n'
                    return

            await asyncio.sleep(1)

    # SSE requires an explicit origin — never wildcard when credentials are involved.
    origin = (
        settings.CORS_ALLOW_ORIGINS[0]
        if settings.CORS_ALLOW_ORIGINS
        else "http://localhost:5173"
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

    return {"job_id": job_id, "result": analysis.final_json}
