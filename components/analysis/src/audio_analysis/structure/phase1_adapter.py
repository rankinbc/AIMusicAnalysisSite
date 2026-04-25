"""Adapter from Phase 1's structure dict to a typed StructureResult.

Phase 1 already runs ``all_in_one_fix`` and produces a dict shaped like::

    {
        "sections": [
            {"label": "intro", "start_beat": 0, "end_beat": 128, "energy": 0.5},
            ...
        ],
        "beats": [...],
    }

This adapter converts that into the dataclass form expected by
``ArrangementScorer``.  Stdlib only.
"""
from __future__ import annotations

from audio_analysis.structure.models import StructureResult, Section, SectionType


# all_in_one_fix uses pop terminology; map to trance/EDM section types.
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
}


def adapt(structure_dict: dict, bpm: float, duration_seconds: float) -> StructureResult:
    """Convert Phase 1 structure dict to ``StructureResult`` for ArrangementScorer.

    Args:
        structure_dict:    Phase 1 ``structure`` sub-dict (keys: sections, beats).
        bpm:               Tempo from Phase 1, used to derive time and bar counts.
        duration_seconds:  Track duration from Phase 1.
    """
    raw_sections = structure_dict.get("sections", [])
    if not raw_sections or bpm <= 0:
        return StructureResult(
            success=False,
            detection_method="all_in_one_fix",
            confidence=0.0,
            tempo_bpm=bpm,
            beats=[],
            downbeats=[],
            sections=[],
            section_count=0,
            duration_seconds=duration_seconds,
            total_bars=0,
            error_message="No sections detected or BPM unavailable",
        )

    beats_per_second = bpm / 60.0

    sections: list[Section] = []
    for s in raw_sections:
        label = str(s.get("label", "unknown")).lower()
        start_beat = float(s.get("start_beat", 0))
        end_beat = float(s.get("end_beat", start_beat))
        start_time = start_beat / beats_per_second
        end_time = end_beat / beats_per_second
        duration_secs = end_time - start_time
        # Assume 4/4 time — 4 beats per bar.
        duration_bars = max(1, round((end_beat - start_beat) / 4))
        # Use 'energy' as a confidence proxy when present; default to 0.7.
        if s.get("energy") is not None:
            confidence = float(s.get("energy", 0.7))
        else:
            confidence = 0.7
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

    last_beat = max((float(s.get("end_beat", 0)) for s in raw_sections), default=0.0)
    total_bars = max(1, round(last_beat / 4))

    return StructureResult(
        success=True,
        detection_method="all_in_one_fix",
        confidence=0.7,
        tempo_bpm=bpm,
        beats=[],
        downbeats=[],
        sections=sections,
        section_count=len(sections),
        duration_seconds=duration_seconds,
        total_bars=total_bars,
    )
