"""Adapter from Phase 1's structure dict to a typed StructureResult.

Phase 1 runs allin1 (in Docker) and produces a dict shaped like::

    {
        "available": True,
        "bpm": 128.0,
        "segments": [
            {"label": "intro", "start": 0.0, "end": 7.5},
            ...
        ],
        "beats": [...],
        "downbeats": [...],
    }

``start``/``end`` are in **seconds** (allin1's native output). This adapter
converts that into the dataclass form expected by ``ArrangementScorer``.
Stdlib only.

Back-compat: a few historical/empty dicts use ``{"sections": [], "beats": []}``
with no ``segments`` key. Those resolve to an unsuccessful (but *available*)
result. A dict with ``available: False`` resolves to an *unavailable* result so
the scorer can say "not assessed" rather than "failed".
"""
from __future__ import annotations

import math

from audio_analysis.structure.models import Section, SectionType, StructureResult

_DETECTION_METHOD = "allin1-docker"

# allin1 uses pop-music segment labels; map to trance/EDM section types.
_LABEL_MAP = {
    'intro': SectionType.INTRO,
    'buildup': SectionType.BUILDUP,
    'drop': SectionType.DROP,
    'breakdown': SectionType.BREAKDOWN,
    'outro': SectionType.OUTRO,
    'verse': SectionType.BREAKDOWN,
    'chorus': SectionType.DROP,
    'bridge': SectionType.BREAKDOWN,
    'inst': SectionType.DROP,
    'solo': SectionType.BREAKDOWN,
    'break': SectionType.BREAKDOWN,
    'start': SectionType.INTRO,
    'end': SectionType.OUTRO,
}


def _empty(
    *, available: bool, bpm: float, duration_seconds: float, error_message: str,
    deferred: bool = False,
) -> StructureResult:
    return StructureResult(
        success=False,
        detection_method=_DETECTION_METHOD,
        confidence=0.0,
        tempo_bpm=bpm,
        beats=[],
        downbeats=[],
        sections=[],
        section_count=0,
        duration_seconds=duration_seconds,
        total_bars=0,
        available=available,
        deferred=deferred,
        error_message=error_message,
    )


def adapt(structure_dict: dict, bpm: float, duration_seconds: float) -> StructureResult:
    """Convert Phase 1 structure dict to ``StructureResult`` for ArrangementScorer.

    Args:
        structure_dict:    Phase 1 ``structure`` sub-dict (allin1 output).
        bpm:               Tempo from Phase 1, used to derive bar counts.
        duration_seconds:  Track duration from Phase 1.
    """
    if structure_dict.get("available") is False:
        return _empty(
            available=False,
            deferred=bool(structure_dict.get("deferred")),
            bpm=bpm,
            duration_seconds=duration_seconds,
            error_message=structure_dict.get("reason", "Structure detection unavailable"),
        )

    raw_segments = structure_dict.get("segments", [])
    if not raw_segments or not math.isfinite(bpm) or bpm <= 0:
        return _empty(
            available=True,
            bpm=bpm,
            duration_seconds=duration_seconds,
            error_message="No segments detected or BPM unavailable",
        )

    # 4/4 assumed: 4 beats per bar, beats/sec = bpm/60.
    bars_per_second = (bpm / 60.0) / 4.0

    sections: list[Section] = []
    for seg in raw_segments:
        label = str(seg.get("label", "unknown")).lower()
        start_time = float(seg.get("start", 0.0))
        end_time = float(seg.get("end", start_time))
        duration_secs = max(0.0, end_time - start_time)
        duration_bars = max(1, round(duration_secs * bars_per_second))
        # allin1 doesn't emit a per-segment energy; use a neutral confidence.
        confidence = float(seg.get("energy", 0.7))
        confidence = min(1.0, max(0.0, confidence))

        sections.append(Section(
            section_type=_LABEL_MAP.get(label, SectionType.UNKNOWN),
            start_time=start_time,
            end_time=end_time,
            duration_seconds=duration_secs,
            duration_bars=duration_bars,
            confidence=confidence,
            original_label=label,
        ))

    last_end = max((float(s.get("end", 0.0)) for s in raw_segments), default=0.0)
    total_bars = max(1, round(last_end * bars_per_second))

    return StructureResult(
        success=True,
        detection_method=_DETECTION_METHOD,
        confidence=0.7,
        tempo_bpm=bpm,
        beats=[float(b) for b in structure_dict.get("beats", [])],
        downbeats=[float(d) for d in structure_dict.get("downbeats", [])],
        sections=sections,
        section_count=len(sections),
        duration_seconds=duration_seconds,
        total_bars=total_bars,
        available=True,
    )
