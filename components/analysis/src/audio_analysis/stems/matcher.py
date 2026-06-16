"""Auto-match uploaded stem files to roles and (optionally) .als track names."""
import re
from pathlib import Path

import soundfile as sf
from rapidfuzz import fuzz, process

from .role_detector import detect_role
from .types import ConfirmedMapping, StemMappingProposal, StemRole


# RapidFuzz score threshold (0-100). Below this, no .als track is proposed.
ALS_MATCH_THRESHOLD = 60

_LEADING_NUMERIC = re.compile(r"^[\d_\-\s.]+")


def _normalize_for_match(name: str) -> str:
    """Strip leading digits/separators that DAWs add as track prefixes."""
    return _LEADING_NUMERIC.sub("", name).strip()


def _detect_role_with_audio_fallback(f: Path):
    """Filename-first; fall back to audio-content classification when the name is uninformative."""
    rp = detect_role(f)
    if rp.role != StemRole.OTHER and rp.confidence >= 0.8:
        return rp
    try:
        audio, sr = sf.read(f, always_2d=True, dtype="float32")
    except Exception:
        return rp
    return detect_role(f, audio=audio, sr=sr)


def propose_mapping(
    stem_files: list[Path],
    als_track_names: list[str] | None,
) -> list[StemMappingProposal]:
    """Returns one StemMappingProposal per file with role + optional als_track."""
    role_proposals = [_detect_role_with_audio_fallback(f) for f in stem_files]
    proposals: list[StemMappingProposal] = []
    available_tracks = list(als_track_names) if als_track_names else []

    for file, rp in zip(stem_files, role_proposals):
        als_track: str | None = None
        if available_tracks:
            best = process.extractOne(
                _normalize_for_match(file.stem),
                available_tracks,
                scorer=fuzz.token_set_ratio,
                processor=_normalize_for_match,
            )
            if best and best[1] >= ALS_MATCH_THRESHOLD:
                als_track = best[0]
                available_tracks.remove(als_track)
        proposals.append(
            StemMappingProposal(
                file=file,
                proposed_role=rp.role,
                proposed_als_track=als_track,
                confidence=rp.confidence,
            )
        )
    return proposals


def validate_confirmed_mapping(mappings: list[ConfirmedMapping]) -> None:
    """Raise ValueError on an empty set or missing files.

    Duplicate roles are ALLOWED — bulk upload supports many stems per role (they
    are summed into a role bus in grouped mode). The API layer translates these
    errors into 422 responses.
    """
    if not mappings:
        raise ValueError("no_mappings: at least one mapping required")
    for m in mappings:
        if not m.file.exists():
            raise ValueError(f"missing_file: {m.file}")
