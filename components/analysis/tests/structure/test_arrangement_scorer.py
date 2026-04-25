"""Tests for arrangement scorer, structure models, and phase1 adapter."""
from __future__ import annotations

import pytest

from audio_analysis.structure.models import StructureResult, Section, SectionType
from audio_analysis.structure.arrangement_scorer import ArrangementScorer
from audio_analysis.structure.phase1_adapter import adapt


def _make_structure(labels_and_bars: list[tuple[str, int]], bpm: float = 128.0) -> StructureResult:
    """Build a StructureResult from (section_type_str, bars) pairs."""
    sections = []
    seconds_per_bar = (60.0 / bpm) * 4
    t = 0.0
    for label, bars in labels_and_bars:
        dur = bars * seconds_per_bar
        sections.append(Section(
            section_type=SectionType[label.upper()],
            start_time=t,
            end_time=t + dur,
            duration_seconds=dur,
            duration_bars=bars,
            confidence=0.8,
            original_label=label,
        ))
        t += dur
    return StructureResult(
        success=bool(sections),
        detection_method="test",
        confidence=0.8,
        tempo_bpm=bpm,
        beats=[],
        downbeats=[],
        sections=sections,
        section_count=len(sections),
        duration_seconds=t,
        total_bars=round(t / seconds_per_bar),
    )


def test_score_empty_structure_returns_result():
    structure = _make_structure([])
    scorer = ArrangementScorer()
    result = scorer.score(structure)
    assert result.overall_score == 0
    assert result.grade == "F"
    assert len(result.issues) > 0


def test_score_with_sections_returns_grade():
    structure = _make_structure([
        ("intro", 32), ("buildup", 16), ("drop", 32),
        ("breakdown", 32), ("outro", 32),
    ])
    scorer = ArrangementScorer()
    result = scorer.score(structure)
    assert result.overall_score >= 70   # well-structured track with all required sections
    assert result.has_intro is True
    assert result.has_drop is True
    assert result.has_buildup is True


def test_phase1_adapter_maps_labels():
    structure_dict = {
        "sections": [
            {"label": "intro", "start_beat": 0, "end_beat": 128, "energy": 0.5},
            {"label": "drop", "start_beat": 128, "end_beat": 256, "energy": 0.9},
            {"label": "outro", "start_beat": 256, "end_beat": 384, "energy": 0.4},
        ],
        "beats": [],
    }
    result = adapt(structure_dict, bpm=128.0, duration_seconds=180.0)
    assert result.success is True
    assert len(result.sections) == 3
    assert result.sections[0].section_type == SectionType.INTRO
    assert result.sections[1].section_type == SectionType.DROP
    assert result.sections[2].section_type == SectionType.OUTRO


def test_phase7_returns_arrangement_score_shape():
    from audio_analysis.phases.phase7_arrangement import advise
    structure_dict = {
        "sections": [
            {"label": "intro", "start_beat": 0, "end_beat": 128},
            {"label": "drop", "start_beat": 128, "end_beat": 256},
        ],
        "beats": [],
    }
    result = advise(structure_dict, "trance", bpm=128.0, duration_seconds=120.0)
    assert "overall_score" in result
    assert "grade" in result
    assert "issues" in result
    assert "suggestions" in result
    # backward-compat keys still present
    assert "fixes" in result
    assert "violations" in result
