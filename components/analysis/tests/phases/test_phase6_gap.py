"""Phase 6 — injected reference-profile path (reference-profiles Task 4).

Covers: a user profile bypasses the disk load and derives acceptable_range from
mean±2·std; UI labels are surfaced; a genre override forces + labels a genre; and
the plain (reference_profile=None) path stays unlabeled — byte-identical guard.
"""
from __future__ import annotations

from pathlib import Path

from audio_analysis.phases import phase6_gap

# wav_path is unused on the profile path (no decode), so a dummy is fine.
_WAV = Path("unused.wav")

# A user profile in the aggregate shape the BFF emits (mean/std only, no anchors).
_USER_PROFILE = {
    "kind": "user",
    "name": "Festival Trance",
    "hue": 280,
    "track_count": 3,
    "feature_statistics": {
        "tempo": {"mean": 138.0, "std": 2.0},
        "phase_correlation": {"mean": 0.40, "std": 0.05},
        "stereo_width": {"mean": 0.60, "std": 0.05},
    },
}


def test_user_profile_derives_acceptable_range_and_labels():
    phase1 = {"bpm": 138.0, "stereo_correlation": 0.40}
    out = phase6_gap.analyze(_WAV, "other", phase1, reference_profile=_USER_PROFILE)

    # acceptable_range = mean ± 2·std → [134, 142]; user_val 138 is in range.
    bpm_gap = out["gaps"]["bpm"]
    assert bpm_gap["acceptable_range"] == [134.0, 142.0]
    assert bpm_gap["in_range"] is True

    # UI labels surfaced for the injected profile.
    assert out["profile_kind"] == "user"
    assert out["profile_name"] == "Festival Trance"
    assert out["profile_hue"] == 280


def test_user_profile_out_of_range_flag():
    # bpm 150 is outside [134, 142].
    phase1 = {"bpm": 150.0, "stereo_correlation": 0.40}
    out = phase6_gap.analyze(_WAV, "other", phase1, reference_profile=_USER_PROFILE)
    assert out["gaps"]["bpm"]["in_range"] is False


def test_genre_override_labels_without_user_stats():
    # A genre override for a genre with no disk profile → empty gaps but labeled.
    out = phase6_gap.analyze(
        _WAV, "other", {"bpm": 128.0},
        reference_profile={"kind": "genre", "genre": "nonexistent_genre_xyz"},
    )
    assert out["profile_kind"] == "genre"
    assert out["profile_name"] == "nonexistent_genre_xyz"
    assert out["profile_hue"] is None


def test_none_path_is_unlabeled_byte_identical_guard():
    # No override + unknown genre → the existing degenerate result, NO profile_* keys.
    out = phase6_gap.analyze(_WAV, "nonexistent_genre_xyz", {"bpm": 128.0})
    assert out == {"genre": "nonexistent_genre_xyz", "percentile": 50.0, "gaps": {}}
    assert "profile_kind" not in out
