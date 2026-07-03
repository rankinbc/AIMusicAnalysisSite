"""Story 3.2 (AR19) — source-file validation at the worker trust boundary.

The presigned upload path (story 3.1) means the BFF never sees file bytes, so
the worker is the FIRST place a spoofed upload can be caught. This runs after
the source resolves (local or fetched from R2) and BEFORE ``run_pipeline`` —
an invalid file must fail fast with a typed error so the BFF's AR16 lazy
reversal (GET /api/jobs/{id} sees ``error_code='invalid_file'``) can refund
the credit spend.

Import-light on purpose: ``soundfile`` gives a cheap header-only duration
probe for wav/flac/aiff/ogg; mp3/m4a fall back to ``librosa.get_duration``
(audioread — slower but still far cheaper than the pipeline's full decode).

Env overrides:
    MIN_AUDIO_DURATION_SECONDS   default 3
    MAX_AUDIO_DURATION_SECONDS   default 1800 (30 min ≈ a 250 MB WAV)
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

REASON_BAD_MAGIC = "bad_magic_bytes"
REASON_UNDECODABLE = "undecodable"
REASON_TOO_SHORT = "too_short"
REASON_TOO_LONG = "too_long"


@dataclass
class InvalidFileError(Exception):
    """Typed validation failure — maps to AnalysisJob.error_code='invalid_file'."""

    reason_code: str
    message: str

    def __str__(self) -> str:  # error_message column gets something readable
        return f"{self.reason_code}: {self.message}"


def _min_duration() -> float:
    return float(os.environ.get("MIN_AUDIO_DURATION_SECONDS", "3"))


def _max_duration() -> float:
    return float(os.environ.get("MAX_AUDIO_DURATION_SECONDS", "1800"))


def _sniff_magic(head: bytes) -> str | None:
    """Return a format tag when the header matches a supported audio type."""
    if len(head) < 12:
        return None
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"fLaC":
        return "flac"
    if head[:3] == b"ID3":
        return "mp3"
    # Raw MPEG frame sync: 0xFF Ex/Fx (covers MPEG-1/2 layer 3 without ID3).
    if head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        return "mp3"
    if head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"):
        return "aiff"
    if head[:4] == b"OggS":
        return "ogg"
    # ISO-BMFF (m4a/mp4): size(4) + 'ftyp'.
    if head[4:8] == b"ftyp":
        return "m4a"
    return None


def _probe_duration(path: Path, fmt: str) -> float:
    """Header-cheap duration in seconds; raises InvalidFileError(undecodable)."""
    if fmt in ("wav", "flac", "aiff", "ogg"):
        try:
            import soundfile as sf

            info = sf.info(str(path))
            if info.samplerate <= 0:
                raise InvalidFileError(REASON_UNDECODABLE, "invalid sample rate in header")
            return float(info.frames) / float(info.samplerate)
        except InvalidFileError:
            raise
        except Exception as exc:
            raise InvalidFileError(
                REASON_UNDECODABLE, f"header declares {fmt} but soundfile can't read it: {exc}"
            ) from exc
    # mp3 / m4a — no cheap header probe in soundfile; audioread via librosa.
    try:
        import librosa

        return float(librosa.get_duration(path=str(path)))
    except Exception as exc:
        raise InvalidFileError(
            REASON_UNDECODABLE, f"header declares {fmt} but the stream won't decode: {exc}"
        ) from exc


def validate_source(path: str | Path) -> float:
    """Magic-byte + duration validation (AR19). Returns the probed duration.

    Raises InvalidFileError with a reason code on any failure. Never raises
    anything else for bad file CONTENT — an OS-level read error (missing file)
    is not a user-invalid file and propagates as-is.
    """
    p = Path(path)
    with p.open("rb") as fh:
        head = fh.read(16)

    fmt = _sniff_magic(head)
    if fmt is None:
        raise InvalidFileError(
            REASON_BAD_MAGIC,
            "file content is not a supported audio format (wav/flac/mp3/aiff/ogg/m4a)",
        )

    duration = _probe_duration(p, fmt)
    if duration < _min_duration():
        raise InvalidFileError(
            REASON_TOO_SHORT, f"duration {duration:.1f}s is below the {_min_duration():.0f}s minimum"
        )
    if duration > _max_duration():
        raise InvalidFileError(
            REASON_TOO_LONG, f"duration {duration:.0f}s exceeds the {_max_duration():.0f}s maximum"
        )
    logger.info("source_validation: ok fmt=%s duration=%.1fs path=%s", fmt, duration, p)
    return duration
