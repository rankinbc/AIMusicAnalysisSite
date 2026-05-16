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
