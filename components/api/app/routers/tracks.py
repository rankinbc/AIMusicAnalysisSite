from itertools import groupby
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import AnalysisResult, UploadJob, User
from ..schemas.jobs import TrackGroup, TrackVersionSummary
from .auth import get_current_user

router = APIRouter()


@router.get("/", response_model=list[TrackGroup])
async def list_tracks(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TrackGroup]:
    """Return jobs grouped by track_name for version-history chart."""
    jobs_result = await session.execute(
        select(UploadJob)
        .where(
            UploadJob.user_id == current_user.id,
            UploadJob.track_name.isnot(None),
        )
        .order_by(UploadJob.track_name, UploadJob.created_at.asc())
    )
    jobs = jobs_result.scalars().all()

    if not jobs:
        return []

    job_ids = [j.id for j in jobs]
    analyses_result = await session.execute(
        select(AnalysisResult).where(AnalysisResult.job_id.in_(job_ids))
    )
    analyses = {str(a.job_id): a for a in analyses_result.scalars().all()}

    groups: list[TrackGroup] = []
    for name, version_iter in groupby(jobs, key=lambda j: j.track_name):
        version_list = list(version_iter)
        versions: list[TrackVersionSummary] = []
        for v in version_list:
            a = analyses.get(str(v.id))
            score = grade = None
            if a and a.final_json:
                raw = a.final_json.get("overall_score")
                score = float(raw) if raw is not None else None
                grade = a.final_json.get("grade")
            versions.append(
                TrackVersionSummary(
                    job_id=str(v.id),
                    filename=Path(v.file_path).name,
                    score=score,
                    grade=grade,
                    created_at=v.created_at.isoformat(),
                )
            )

        last_a = analyses.get(str(version_list[-1].id))
        latest_score = latest_grade = None
        if last_a and last_a.final_json:
            raw = last_a.final_json.get("overall_score")
            latest_score = float(raw) if raw is not None else None
            latest_grade = last_a.final_json.get("grade")

        groups.append(
            TrackGroup(
                track_name=str(name),
                version_count=len(version_list),
                latest_score=latest_score,
                latest_grade=latest_grade,
                versions=versions,
            )
        )

    return groups
