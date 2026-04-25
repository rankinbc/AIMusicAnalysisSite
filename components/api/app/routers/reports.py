from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import AnalysisResult

router = APIRouter()


@router.get("/share/{share_token}")
async def get_shared_report(
    share_token: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Public endpoint — returns analysis result by share token. No auth required."""
    result = await session.execute(
        select(AnalysisResult).where(AnalysisResult.share_token == share_token)
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"result": analysis.final_json}
