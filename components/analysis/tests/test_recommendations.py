"""Tests for the deterministic translation-fix recommendation helper."""

from audio_analysis.recommendations import translation_fixes


def test_translation_fixes_empty_for_missing_input():
    assert translation_fixes(None) == []
    assert translation_fixes({}) == []


def test_mono_collapse_is_surfaced_first():
    fixes = translation_fixes(
        {
            "surround": {"mono_compatibility": 30.0, "phase_score": 80.0},
            "playback": {"bass_translation": "weak", "crossfeed_safe": True},
            "spatial": {"width_consistency": 90.0},
        }
    )
    # Mono collapse (priority 0) outranks the weak-bass fix (priority 2).
    assert "collapses in mono" in fixes[0]
    assert any("laptop / phone speakers" in f for f in fixes)


def test_clean_mix_yields_no_fixes():
    fixes = translation_fixes(
        {
            "surround": {"mono_compatibility": 90.0, "phase_score": 95.0},
            "playback": {"bass_translation": "good", "crossfeed_safe": True},
            "spatial": {"width_consistency": 85.0},
        }
    )
    assert fixes == []


def test_headphone_and_width_fixes():
    fixes = translation_fixes(
        {
            "surround": {"mono_compatibility": 85.0, "phase_score": 90.0},
            "playback": {"bass_translation": "good", "crossfeed_safe": False},
            "spatial": {"width_consistency": 50.0},
        }
    )
    assert any("headphones" in f for f in fixes)
    assert any("Stereo image is unstable" in f for f in fixes)
