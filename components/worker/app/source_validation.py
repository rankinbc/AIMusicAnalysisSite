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

from . import feature_flags
from .llm.lane import GUEST_TIER, resolve_lane

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
    # Raw MPEG frame sync (no ID3): 11 sync bits + version/layer bits must not
    # be their reserved values, or any 0xFF-prefixed junk would pass as mp3.
    if (
        head[0] == 0xFF
        and (head[1] & 0xE0) == 0xE0
        and (head[1] & 0x18) != 0x08  # version 01 = reserved
        and (head[1] & 0x06) != 0x00  # layer 00 = reserved
    ):
        return "mp3"
    if head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"):
        return "aiff"
    if head[:4] == b"OggS":
        return "ogg"
    # ISO-BMFF (m4a/mp4): size(4) + 'ftyp'.
    if head[4:8] == b"ftyp":
        return "m4a"
    return None


def _is_environment_error(exc: Exception) -> bool:
    """Errors of the WORKER, not the file — must NOT become invalid_file.

    A misconfigured image (missing libsndfile/ffmpeg backend), disk-full temp,
    or truncated read has nothing to do with the user's bytes; classifying it
    as invalid_file would permanently fail + refund every upload on that box.
    These propagate to the generic (retrying) failure arm instead.
    """
    if isinstance(exc, (ImportError, MemoryError)):
        return True
    # audioread.exceptions.NoBackendError = no mp3 decoder installed (env).
    if type(exc).__name__ == "NoBackendError":
        return True
    # Plain OS I/O errors (disk, permissions) — but libsndfile wraps content
    # errors in its own exception type, which is NOT a bare OSError.
    if type(exc) in (OSError, IOError, PermissionError):
        return True
    return False


def _probe_duration(path: Path, fmt: str) -> float:
    """Header-cheap duration in seconds; raises InvalidFileError(undecodable)."""
    if fmt in ("wav", "flac", "aiff", "ogg"):
        import soundfile as sf  # ImportError = env problem, propagates

        try:
            info = sf.info(str(path))
            if info.samplerate <= 0:
                raise InvalidFileError(REASON_UNDECODABLE, "invalid sample rate in header")
            return float(info.frames) / float(info.samplerate)
        except InvalidFileError:
            raise
        except Exception as exc:
            if _is_environment_error(exc):
                raise
            raise InvalidFileError(
                REASON_UNDECODABLE, f"header declares {fmt} but soundfile can't read it: {exc}"
            ) from exc
    # mp3 / m4a — no cheap header probe in soundfile; audioread via librosa.
    import librosa  # ImportError = env problem, propagates

    try:
        return float(librosa.get_duration(path=str(path)))
    except Exception as exc:
        if _is_environment_error(exc):
            raise
        raise InvalidFileError(
            REASON_UNDECODABLE, f"header declares {fmt} but the stream won't decode: {exc}"
        ) from exc


def guest_max_seconds_for(user_id: object) -> float | None:
    """G4 fix1 — the ONE place that decides a job's guest track-length ceiling.

    Previously this branch (guest-vs-real-user, flag lookup, lane lookup) lived
    inline in ``tasks_dramatiq.analyze_audio_job`` with no test coverage of its
    own. Returns the guest cap in seconds when ``user_id`` belongs to a guest
    account, else ``None`` (no caller-specific limit — ``validate_source``'s
    plain ``MAX_AUDIO_DURATION_SECONDS`` ceiling still applies).

    Fails toward the SAFER outcome in both directions:
      * ``user_id is None`` (an anonymous, device-owned job — anon jobs skip
        structure detection and never reach here in practice, but this stays
        correct regardless) -> ``None``, with NO lane lookup attempted: there
        is no user row to look up.
      * the guest lane lookup raises -> ``None`` (fail OPEN toward "no cap").
        A DB blip must never narrow — or effectively refuse — a real user's
        upload; the container's own memory cap (G4) is what protects the box
        either way. ``resolve_lane`` already fails open internally, but this
        guards the contract even if that ever changes.
      * the flag read raises -> the code default ``720``, NEVER "no limit".
        An unreadable flag store must not silently hand every guest an
        unlimited upload.
    """
    if user_id is None:
        return None
    try:
        is_guest = resolve_lane(user_id, None) == GUEST_TIER
    except Exception:
        logger.warning(
            "guest_max_seconds_for: lane lookup raised for user_id=%s — "
            "treating as non-guest (no cap)", user_id, exc_info=True,
        )
        return None
    if not is_guest:
        return None
    try:
        return float(feature_flags.get_flag_int("guest_track_max_seconds", 720))
    except Exception:
        logger.warning(
            "guest_max_seconds_for: flag read raised for user_id=%s — "
            "falling back to the default cap (720s)", user_id, exc_info=True,
        )
        return 720.0


def validate_source(path: str | Path, *, max_seconds: float | None = None) -> float:
    """Magic-byte + duration validation (AR19). Returns the probed duration.

    ``max_seconds`` (G4) is the caller-supplied binding length limit — e.g. the
    guest track-length cap. ``None`` (the default) means "no caller-specific
    limit": the ``MAX_AUDIO_DURATION_SECONDS`` env default (1800) still applies.
    When ``max_seconds`` IS the binding limit, the rejection message is the
    guest-facing copy (offers a free account) instead of the generic one.

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
    effective_max = max_seconds if max_seconds is not None else _max_duration()
    if duration > effective_max:
        if max_seconds is not None:
            raise InvalidFileError(
                REASON_TOO_LONG,
                f"this track is {duration / 60:.0f} minutes long — guest uploads go up to "
                f"{max_seconds / 60:.0f} minutes; create a free account for longer tracks",
            )
        raise InvalidFileError(
            REASON_TOO_LONG, f"duration {duration:.0f}s exceeds the {_max_duration():.0f}s maximum"
        )
    logger.info("source_validation: ok fmt=%s duration=%.1fs path=%s", fmt, duration, p)
    return duration
