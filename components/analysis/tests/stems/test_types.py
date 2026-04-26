import dataclasses

import pytest

from audio_analysis.stems.types import (
    BalanceFlag, ConfirmedMapping, FreqBand, RoleProposal,
    StemAnalysisResult, StemClash, StemMappingProposal, StemMetrics,
    StemReferenceDelta, StemRole,
)


def test_stem_role_values():
    assert StemRole.DRUMS.value == "drums"
    assert StemRole.KICK.value == "kick"
    assert StemRole.SNARE.value == "snare"
    assert StemRole.HATS.value == "hats"
    assert StemRole.BASS.value == "bass"
    assert StemRole.VOCALS.value == "vocals"
    assert StemRole.LEAD.value == "lead"
    assert StemRole.PAD.value == "pad"
    assert StemRole.FX.value == "fx"
    assert StemRole.OTHER.value == "other"


def test_freq_band_values():
    expected = ["sub", "bass", "low_mid", "mid", "high_mid", "presence", "air"]
    assert [b.value for b in FreqBand] == expected


def test_role_proposal_is_frozen():
    rp = RoleProposal(role=StemRole.KICK, confidence=0.9, evidence="fname")
    with pytest.raises(dataclasses.FrozenInstanceError):
        rp.confidence = 0.5  # type: ignore[misc]


def test_stem_metrics_required_fields():
    m = StemMetrics(
        role=StemRole.BASS, duration_s=8.0, peak_db=-1.0, rms_db=-12.0,
        lufs_integrated=-14.0, dynamic_range_db=8.0,
        band_energy_db={b: -20.0 for b in FreqBand},
        spectral_centroid_hz=120.0, dominant_frequencies_hz=[60.0, 120.0],
        stereo_width=0.0, pan_estimate=0.0, is_mono=True,
    )
    assert m.role == StemRole.BASS


def test_all_dataclasses_importable():
    # Smoke: every name in the spec is importable.
    for cls in (BalanceFlag, ConfirmedMapping, StemAnalysisResult, StemClash,
                StemMappingProposal, StemReferenceDelta):
        assert cls is not None
