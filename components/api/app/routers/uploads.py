import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession


from aimusic_shared.models import JobStatus

from ..config import settings
from ..db import get_session
from ..models import UploadJob, User
from ..schemas.uploads import StemMappingProposalDTO, UploadResponse
from ..services.celery_client import dispatch_analysis_job
from ..services.stem_validation import (
    StemValidationError, validate_stem_uploads,
)
from ..services.storage import get_storage
from .auth import get_current_user

log = logging.getLogger(__name__)
router = APIRouter()

# Magic bytes for supported audio formats.
# Key = magic prefix bytes, checked against the first 12 bytes of the upload.
# Content-Type header is NOT used — it can be spoofed.
_MAGIC: list[bytes] = [
    b"\xff\xfb",  # MP3 (MPEG layer 3, no CBR/VBR flag)
    b"\xff\xf3",  # MP3
    b"\xff\xf2",  # MP3
    b"ID3",       # MP3 with ID3 tag
    b"fLaC",      # FLAC
    b"RIFF",      # WAV (RIFF container — 4-byte check; full WAV has 'WAVE' at offset 8)
]

_ALS_MAGIC = b"\x1f\x8b"  # gzip magic bytes (.als files are gzip-compressed XML)
ALS_MAX_BYTES = 50 * 1024 * 1024  # 50 MB


def validate_audio_magic(header: bytes) -> bool:
    """Return True if the header starts with a known audio magic byte sequence."""
    for magic in _MAGIC:
        if header[: len(magic)] == magic:
            return True
    return False


def validate_als_magic(header: bytes) -> bool:
    return header[:2] == _ALS_MAGIC


_VALID_GENRES = {"trance", "house", "techno", "dnb", "progressive"}


class _StemBuf:
    """Adapter so validate_stem_uploads can read filename, payload, size."""
    def __init__(self, filename: str, payload: bytes):
        self.filename = filename
        self.payload = payload
        self.size = len(payload)


def _validation_error_status(code: str) -> int:
    if "too_large" in code:
        return 413
    if "format" in code:
        return 415
    return 422


@router.post("/", response_model=UploadResponse)
async def upload_audio(
    file: UploadFile = File(...),
    reference: UploadFile | None = File(None),
    als: UploadFile | None = File(None),
    genre_hint: str | None = Form(None),
    stems: list[UploadFile] | None = File(None),
    reference_stems: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UploadResponse:
    # --- Size guard (when Content-Length is present) ---
    if file.size and file.size > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 200 MB)")

    # --- Magic byte validation for primary file ---
    header = await file.read(12)
    if not validate_audio_magic(header):
        raise HTTPException(
            status_code=415,
            detail="Invalid audio format. Supported: MP3, FLAC, WAV",
        )
    await file.seek(0)

    log.info("upload: user=%s file=%s size=%s", current_user.id, file.filename, file.size)

    storage = get_storage()
    file_key = await storage.save(file)
    file_path = str(storage.get_path(file_key))
    log.info("upload: saved audio → %s", file_path)

    # --- Optional reference track ---
    reference_path: str | None = None
    if reference and reference.filename:
        ref_header = await reference.read(12)
        if not validate_audio_magic(ref_header):
            log.warning("upload: reference rejected — bad magic bytes (file=%s)", reference.filename)
            raise HTTPException(
                status_code=415,
                detail="Invalid reference audio format. Supported: MP3, FLAC, WAV",
            )
        await reference.seek(0)
        ref_key = await storage.save(reference, prefix="ref_")
        reference_path = str(storage.get_path(ref_key))
        log.info("upload: saved reference → %s", reference_path)

    # --- Optional ALS project file ---
    als_file_path: str | None = None
    if als and als.filename:
        if als.size and als.size > ALS_MAX_BYTES:
            log.warning("upload: ALS rejected — too large (%s bytes, file=%s)", als.size, als.filename)
            raise HTTPException(status_code=413, detail="ALS file too large (max 50 MB)")
        als_header = await als.read(4)
        if not validate_als_magic(als_header):
            log.warning("upload: ALS rejected — bad magic bytes (file=%s)", als.filename)
            raise HTTPException(
                status_code=415,
                detail="Invalid ALS file — must be a gzip-compressed Ableton Live Set",
            )
        await als.seek(0)
        als_key = await storage.save(als, prefix="als_")
        als_file_path = str(storage.get_path(als_key))
        log.info("upload: saved ALS → %s", als_file_path)

    # --- Optional stems & reference stems ---
    stem_paths_raw: list[str] = []
    reference_stem_paths_raw: list[str] = []

    async def _save_stem_group(uploads: list[UploadFile] | None, prefix: str) -> list[str]:
        if not uploads:
            return []
        # Skip the implicit empty-list case FastAPI may send
        real = [u for u in uploads if u.filename]
        if not real:
            return []
        bufs: list[_StemBuf] = []
        for u in real:
            payload = await u.read()
            await u.seek(0)
            bufs.append(_StemBuf(u.filename, payload))
        try:
            validate_stem_uploads(bufs)
        except StemValidationError as e:
            raise HTTPException(
                status_code=_validation_error_status(e.code),
                detail={"code": e.code, "message": e.message, "file": e.file},
            )
        saved: list[str] = []
        for u in real:
            key = await storage.save(u, prefix=prefix)
            saved.append(str(storage.get_path(key)))
        return saved

    stem_paths_raw = await _save_stem_group(stems, "stem_")
    reference_stem_paths_raw = await _save_stem_group(reference_stems, "refstem_")

    # Normalise and validate genre hint
    normalised_genre: str | None = None
    if genre_hint:
        normalised_genre = genre_hint.lower().strip()
        if normalised_genre not in _VALID_GENRES:
            log.warning("upload: unknown genre_hint %r ignored", genre_hint)
            normalised_genre = None

    # --- Create job record (state in PostgreSQL, NOT Celery) ---
    initial_status = (
        JobStatus.AWAITING_STEM_MAPPING if stem_paths_raw else JobStatus.PENDING
    )
    job = UploadJob(
        user_id=current_user.id,
        file_path=file_path,
        reference_path=reference_path,
        als_file_path=als_file_path,
        genre_hint=normalised_genre,
        status=initial_status,
        stem_paths_raw=(stem_paths_raw + reference_stem_paths_raw) or None,
    )
    session.add(job)
    await session.commit()
    log.info(
        "upload: job created job_id=%s status=%s stems=%d ref_stems=%d",
        job.id, initial_status.value, len(stem_paths_raw), len(reference_stem_paths_raw),
    )

    # --- Stems present: defer Celery dispatch until mapping is confirmed ---
    if stem_paths_raw:
        from audio_analysis.stems import propose_mapping

        als_track_names = _parse_als_track_names(als_file_path) if als_file_path else None
        proposals = propose_mapping(
            [Path(p) for p in stem_paths_raw], als_track_names,
        )
        return UploadResponse(
            job_id=str(job.id),
            status=JobStatus.AWAITING_STEM_MAPPING.value,
            proposed_mapping=[
                StemMappingProposalDTO(
                    file=p.file.name,
                    proposed_role=p.proposed_role.value,
                    proposed_als_track=p.proposed_als_track,
                    confidence=p.confidence,
                )
                for p in proposals
            ],
            als_track_names=als_track_names or [],
        )

    # --- No stems: existing flow, dispatch immediately ---
    try:
        task_id = dispatch_analysis_job(
            str(job.id), file_path, reference_path, str(current_user.id),
            als_file_path=als_file_path, genre_hint=normalised_genre,
        )
        job.task_id = task_id
        await session.commit()
        log.info("upload: dispatched task_id=%s for job_id=%s", task_id, job.id)
    except Exception:
        log.exception("upload: Celery dispatch failed for job_id=%s", job.id)
        raise

    return UploadResponse(job_id=str(job.id), status=JobStatus.PENDING.value)


def _parse_als_track_names(als_file_path: str) -> list[str] | None:
    """Best-effort parse of .als track names. Returns None on failure."""
    try:
        from audio_analysis.als.als_parser import parse as parse_als
        parsed = parse_als(als_file_path)
        tracks = parsed.get("tracks") if isinstance(parsed, dict) else None
        if not tracks:
            return None
        return [t.get("name") for t in tracks if isinstance(t, dict) and t.get("name")]
    except Exception:
        log.exception("als track-name parse failed for %s", als_file_path)
        return None
