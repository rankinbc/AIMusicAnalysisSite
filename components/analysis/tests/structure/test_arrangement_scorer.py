"""Tests for arrangement scorer, structure models, and phase1 adapter."""
from __future__ import annotations

import pytest

from audio_analysis.structure.models import StructureResult, Section, SectionType
from audio_analysis.structure.arrangement_scorer import ArrangementScorer, IssueSeverity
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
    # Real allin1 output: `segments` with start/end in SECONDS and pop labels.
    # At 128 BPM a bar is 1.875 s, so 60 s == 32 bars.
    structure_dict = {
        "available": True,
        "bpm": 128.0,
        "segments": [
            {"label": "intro", "start": 0.0, "end": 60.0},
            {"label": "chorus", "start": 60.0, "end": 120.0},
            {"label": "outro", "start": 120.0, "end": 180.0},
        ],
        "beats": [],
    }
    result = adapt(structure_dict, bpm=128.0, duration_seconds=180.0)
    assert result.available is True
    assert result.success is True
    assert len(result.sections) == 3
    assert result.sections[0].section_type == SectionType.INTRO
    assert result.sections[1].section_type == SectionType.DROP   # chorus -> drop
    assert result.sections[2].section_type == SectionType.OUTRO
    assert result.sections[0].duration_bars == 32                # 60 s @ 128 BPM


def test_phase1_adapter_unavailable_is_not_a_failure():
    # Docker / image not set up: the dict carries available=False + a reason.
    structure_dict = {
        "available": False,
        "reason": "Docker image 'allin1:latest' not found",
        "segments": [],
        "beats": [],
    }
    result = adapt(structure_dict, bpm=128.0, duration_seconds=180.0)
    assert result.available is False
    assert result.success is False
    assert result.sections == []
    assert "not found" in (result.error_message or "")


def test_score_unavailable_structure_not_assessed():
    structure = adapt(
        {"available": False, "reason": "Docker not running", "segments": [], "beats": []},
        bpm=128.0,
        duration_seconds=180.0,
    )
    result = ArrangementScorer().score(structure)
    # Not the track's fault: N/A grade, informational only — never CRITICAL "F".
    assert result.grade == "N/A"
    assert all(i.severity != IssueSeverity.CRITICAL for i in result.issues)


def test_phase7_returns_arrangement_score_shape():
    from audio_analysis.phases.phase7_arrangement import advise
    structure_dict = {
        "available": True,
        "bpm": 128.0,
        "segments": [
            {"label": "intro", "start": 0.0, "end": 60.0},
            {"label": "drop", "start": 60.0, "end": 120.0},
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
