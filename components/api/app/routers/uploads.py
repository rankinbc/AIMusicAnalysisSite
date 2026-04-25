from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..models import UploadJob, User
from ..schemas.uploads import UploadResponse
from ..services.celery_client import dispatch_analysis_job
from ..services.storage import get_storage
from .auth import get_current_user

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


def validate_audio_magic(header: bytes) -> bool:
    """Return True if the header starts with a known audio magic byte sequence."""
    for magic in _MAGIC:
        if header[: len(magic)] == magic:
            return True
    return False


@router.post("/", response_model=UploadResponse)
async def upload_audio(
    file: UploadFile = File(...),
    reference: UploadFile | None = File(None),
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

    storage = get_storage()
    file_key = await storage.save(file)
    file_path = str(storage.get_path(file_key))

    # --- Optional reference track ---
    reference_path: str | None = None
    if reference and reference.filename:
        ref_header = await reference.read(12)
        if not validate_audio_magic(ref_header):
            raise HTTPException(
                status_code=415,
                detail="Invalid reference audio format. Supported: MP3, FLAC, WAV",
            )
        await reference.seek(0)
        ref_key = await storage.save(reference, prefix="ref_")
        reference_path = str(storage.get_path(ref_key))

    # --- Create job record (state in PostgreSQL, NOT Celery) ---
    job = UploadJob(
        user_id=current_user.id,
        file_path=file_path,
        reference_path=reference_path,
    )
    session.add(job)
    await session.commit()

    # --- Dispatch Celery task ---
    task_id = dispatch_analysis_job(
        str(job.id), file_path, reference_path, str(current_user.id)
    )
    job.task_id = task_id
    await session.commit()

    return UploadResponse(job_id=str(job.id))
