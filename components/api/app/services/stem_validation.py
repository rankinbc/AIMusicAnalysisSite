"""Synchronous validation for stem uploads. Translates to 4xx in the router."""
from dataclasses import dataclass
from typing import Protocol


MAX_STEM_FILES = 16
MAX_PER_FILE_BYTES = 100 * 1024 * 1024     # 100 MB
MAX_TOTAL_BYTES = 1024 * 1024 * 1024       # 1 GB


class _UploadLike(Protocol):
    filename: str
    payload: bytes
    size: int


@dataclass
class StemValidationError(Exception):
    code: str
    message: str
    file: str | None = None

    def __str__(self) -> str:
        return f"{self.code}: {self.message}"


def _is_flac(buf: bytes) -> bool:
    return buf[:4] == b"fLaC"


def _is_wav(buf: bytes) -> bool:
    return buf[:4] == b"RIFF" and buf[8:12] == b"WAVE"


def validate_stem_uploads(uploads: list[_UploadLike]) -> None:
    if not uploads or len(uploads) > MAX_STEM_FILES:
        raise StemValidationError(
            "stem_count_out_of_range",
            f"stems must be between 1 and {MAX_STEM_FILES}",
        )
    total = 0
    for u in uploads:
        if u.size > MAX_PER_FILE_BYTES:
            raise StemValidationError(
                "stem_file_too_large",
                f"file exceeds {MAX_PER_FILE_BYTES // (1024 * 1024)} MB",
                file=u.filename,
            )
        total += u.size
        head = u.payload[:16]
        if not (_is_flac(head) or _is_wav(head)):
            raise StemValidationError(
                "unsupported_stem_format",
                "stem must be FLAC or WAV (magic-byte verified)",
                file=u.filename,
            )
    if total > MAX_TOTAL_BYTES:
        raise StemValidationError(
            "total_upload_too_large",
            f"sum of stems exceeds {MAX_TOTAL_BYTES // (1024 * 1024 * 1024)} GB",
        )
