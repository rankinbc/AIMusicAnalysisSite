from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from aimusic_shared.models import Song, SongVersion, UploadJob

from ..db import get_session
from ..models import User
from ..routers.uploads import validate_audio_magic, validate_als_magic, ALS_MAX_BYTES
from ..schemas.versions import VersionDetail, AnalysisInVersionDetail
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
