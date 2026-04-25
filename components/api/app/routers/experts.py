from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..db import get_session
from ..models.upload_job import UploadJob
from ..models.analysis_result import AnalysisResult
from ..models.user import User
from .auth import get_current_user
from ..services.expert_service import (
    run_triage,
    stream_specialist,
    VALID_SPECIALISTS,
)
router = APIRouter(prefix="/experts", tags=["experts"])


async def _get_analysis(
    job_id: str,
    current_user: User,
    session: AsyncSession,
) -> dict:
    job = await session.scalar(
        select(UploadJob).where(
            UploadJob.id == job_id,
            UploadJob.user_id == current_user.id,
        )
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    result = await session.scalar(
        select(AnalysisResult).where(AnalysisResult.job_id == job_id)
    )
    if result is None or not result.final_json:
        raise HTTPException(status_code=404, detail="Analysis not complete yet")

    return result.final_json


@router.post("/{job_id}/triage")
async def triage(
    job_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    analysis = await _get_analysis(job_id, current_user, session)
    return await run_triage(analysis)


@router.post("/{job_id}/specialist/{specialist_name}")
async def specialist_stream(
    job_id: str,
    specialist_name: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if specialist_name not in VALID_SPECIALISTS:
        raise HTTPException(status_code=400, detail=f"Unknown specialist: {specialist_name!r}")

    analysis = await _get_analysis(job_id, current_user, session)

    async def generate():
        async for event in stream_specialist(specialist_name, analysis):
            yield event

    return EventSourceResponse(generate())
