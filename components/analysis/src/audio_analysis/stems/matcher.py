"""Auto-match uploaded stem files to roles and (optionally) .als track names."""
import re
from collections import Counter
from pathlib import Path

from rapidfuzz import fuzz, process

from .role_detector import detect_role
from .types import ConfirmedMapping, StemMappingProposal


# RapidFuzz score threshold (0-100). Below this, no .als track is proposed.
ALS_MATCH_THRESHOLD = 60

_LEADING_NUMERIC = re.compile(r"^[\d_\-\s.]+")


def _normalize_for_match(name: str) -> str:
    """Strip leading digits/separators that DAWs add as track prefixes."""
    return _LEADING_NUMERIC.sub("", name).strip()


def propose_mapping(
    stem_files: list[Path],
    als_track_names: list[str] | None,
) -> list[StemMappingProposal]:
    """Returns one StemMappingProposal per file with role + optional als_track."""
    role_proposals = [detect_role(f) for f in stem_files]
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
    """Raise ValueError on duplicate roles or missing files.

    The API layer is responsible for translating these into 422 responses.
    """
    if not mappings:
        raise ValueError("no_mappings: at least one mapping required")
    role_counts = Counter(m.role for m in mappings)
    duplicates = [r for r, c in role_counts.items() if c > 1]
    if duplicates:
        raise ValueError(f"duplicate_role: {duplicates[0].value}")
    for m in mappings:
        if not m.file.exists():
            raise ValueError(f"missing_file: {m.file}")
