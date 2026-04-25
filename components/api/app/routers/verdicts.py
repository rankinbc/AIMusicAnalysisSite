from __future__ import annotations
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from aimusic_shared.models import AnalysisResult, UploadJob, User, VerdictUserState
from app.config import settings
from app.db import AsyncSessionLocal, get_session
from app.llm.client import CliClient, LLMClient
from app.routers.auth import get_current_user, get_current_user_sse
from app.verdict_pipeline import run_pipeline

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["verdicts"])

# Per-process semaphore — limits concurrent pipeline runs
_GEN_SEMA = asyncio.Semaphore(settings.verdict_max_concurrent_generations)


class FeedbackBody(BaseModel):
    feedback: Literal["helpful", "wrong", "unclear"]


def _get_llm_client() -> LLMClient:
    return CliClient()


async def _load_job_for_user(
    db: AsyncSession, *, job_id: uuid.UUID, user_id: uuid.UUID,
) -> tuple[UploadJob, AnalysisResult]:
    """Authorization-at-query-level: returns (job, result) only if owned."""
    row = (await db.execute(
        select(UploadJob, AnalysisResult)
        .join(AnalysisResult, AnalysisResult.job_id == UploadJob.id)
        .where(UploadJob.id == job_id)
        .where(UploadJob.user_id == user_id)
    )).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="job not found")
    return row.UploadJob, row.AnalysisResult


def _expected_prompt_version_set() -> str:
    """Comma-separated `<specialist>@<version>` of every prompt currently on disk.
    Used for cache invalidation: if any prompt version changed, regenerate."""
    from app.verdict_pipeline.prompt_loader import (
        SLUG_TO_FILENAME, load_prompt, load_triage,
    )
    versions: list[str] = []
    triage_v, _ = load_triage()
    versions.append(f"triage@{triage_v}")
    for slug in sorted(SLUG_TO_FILENAME):
        v, _ = load_prompt(slug)
        versions.append(f"{slug}@{v}")
    return ",".join(versions)


@router.post("/reports/{job_id}/verdicts/generate")
async def generate_verdicts(
    job_id: uuid.UUID,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    if not settings.verdict_pipeline_enabled:
        raise HTTPException(status_code=503, detail="verdict pipeline disabled")

    _, result = await _load_job_for_user(db, job_id=job_id, user_id=user.id)
    expected = _expected_prompt_version_set()

    # Cache hit
    if (result.verdicts_payload
            and result.verdicts_prompt_version_set == expected):
        return result.verdicts_payload

    # Cache miss → kick off generation in BackgroundTasks
    generation_id = str(uuid.uuid4())
    background.add_task(
        _run_and_persist,
        job_id=job_id, user_id=user.id,
        analysis=result.final_json,
        expected_version_set=expected,
    )
    return Response(
        content=f'{{"generation_id":"{generation_id}"}}',
        media_type="application/json",
        status_code=202,
    )


async def _run_and_persist(
    *, job_id: uuid.UUID, user_id: uuid.UUID,
    analysis: dict, expected_version_set: str,
) -> None:
    """Run the pipeline (gated by semaphore) and persist final verdicts payload."""
    async with _GEN_SEMA:
        verdicts_final: list[dict] = []
        try:
            llm = _get_llm_client()
            async for ev in run_pipeline(analysis, llm=llm,
                                         timeout_s=settings.verdict_cli_timeout_s):
                if ev.kind == "complete":
                    verdicts_final = ev.payload["verdicts"]
        except Exception:
            log.exception("verdict pipeline crashed for job %s", job_id)
            return

        async with AsyncSessionLocal() as db:
            row = (await db.execute(
                select(AnalysisResult).where(AnalysisResult.job_id == job_id)
            )).scalar_one_or_none()
            if row is None:
                return
            row.verdicts_payload = {"verdicts": verdicts_final}
            row.verdicts_generated_at = datetime.now(tz=timezone.utc)
            row.verdicts_prompt_version_set = expected_version_set
            row.verdicts_model = "claude-cli"
            await db.commit()


@router.get("/reports/{job_id}/verdicts")
async def get_verdicts(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    _, result = await _load_job_for_user(db, job_id=job_id, user_id=user.id)
    if not result.verdicts_payload:
        raise HTTPException(status_code=404,
                            detail="verdicts not yet generated")
    payload = dict(result.verdicts_payload)

    # Overlay user state
    state_rows = (await db.execute(
        select(VerdictUserState)
        .where(VerdictUserState.user_id == user.id)
        .where(VerdictUserState.job_id == job_id)
    )).scalars().all()
    states = {s.verdict_id: s for s in state_rows}
    for v in payload.get("verdicts", []):
        s = states.get(v["verdict_id"])
        if s is not None:
            v["user_state"] = {
                "dismissed": s.dismissed,
                "applied": s.applied,
                "user_modified_fix": s.user_modified_fix,
                "feedback": s.feedback,
            }
    return payload


@router.post("/verdicts/{verdict_id}/dismiss", status_code=204)
async def dismiss(
    verdict_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    job_id = await _job_id_for_verdict(db, verdict_id=verdict_id, user_id=user.id)
    stmt = pg_insert(VerdictUserState).values(
        verdict_id=verdict_id, user_id=user.id, job_id=job_id, dismissed=True,
    ).on_conflict_do_update(
        index_elements=["verdict_id", "user_id"],
        set_=dict(dismissed=True, updated_at=datetime.now(tz=timezone.utc)),
    )
    await db.execute(stmt)
    await db.commit()


@router.post("/verdicts/{verdict_id}/feedback", status_code=204)
async def feedback(
    verdict_id: str,
    body: FeedbackBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    job_id = await _job_id_for_verdict(db, verdict_id=verdict_id, user_id=user.id)
    stmt = pg_insert(VerdictUserState).values(
        verdict_id=verdict_id, user_id=user.id, job_id=job_id,
        feedback=body.feedback,
    ).on_conflict_do_update(
        index_elements=["verdict_id", "user_id"],
        set_=dict(feedback=body.feedback,
                  updated_at=datetime.now(tz=timezone.utc)),
    )
    await db.execute(stmt)
    await db.commit()


@router.get("/reports/{job_id}/verdicts/stream")
async def stream_verdicts(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user_sse),
    db: AsyncSession = Depends(get_session),
):
    _, result = await _load_job_for_user(db, job_id=job_id, user_id=user.id)
    analysis = result.final_json

    async def event_generator():
        import json as _json
        llm = _get_llm_client()
        try:
            async for ev in run_pipeline(
                analysis, llm=llm, timeout_s=settings.verdict_cli_timeout_s,
            ):
                yield (
                    f"event: {ev.kind}\n"
                    f"data: {_json.dumps(ev.payload)}\n\n"
                )
                if ev.kind == "complete":
                    # Persist final payload synchronously so subsequent
                    # GET /verdicts hits cache.
                    expected = _expected_prompt_version_set()
                    result.verdicts_payload = {"verdicts": ev.payload["verdicts"]}
                    result.verdicts_generated_at = datetime.now(tz=timezone.utc)
                    result.verdicts_prompt_version_set = expected
                    result.verdicts_model = "claude-cli"
                    await db.commit()
        except Exception as e:
            log.exception("SSE stream failed")
            yield f"event: error\ndata: {_json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "Connection": "keep-alive",
                                      "X-Accel-Buffering": "no"})


async def _job_id_for_verdict(
    db: AsyncSession, *, verdict_id: str, user_id: uuid.UUID,
) -> uuid.UUID:
    """Find the job a verdict belongs to (by walking the user's analysis_results
    JSONB payloads). 404 if not found among user's verdicts (auth check)."""
    rows = (await db.execute(
        select(AnalysisResult, UploadJob.id)
        .join(UploadJob, UploadJob.id == AnalysisResult.job_id)
        .where(UploadJob.user_id == user_id)
        .where(AnalysisResult.verdicts_payload.is_not(None))
    )).all()
    for r, job_id in rows:
        for v in (r.verdicts_payload or {}).get("verdicts", []):
            if v.get("verdict_id") == verdict_id:
                return job_id
    raise HTTPException(status_code=404, detail="verdict not found")
