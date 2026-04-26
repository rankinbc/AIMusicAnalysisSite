from audio_analysis.stems.reference_comparator import compare
from audio_analysis.stems.types import (
    FreqBand, StemAnalysisResult, StemMetrics, StemRole,
)


def _metrics(role: StemRole, rms_db: float, lufs: float, width: float) -> StemMetrics:
    return StemMetrics(
        role=role, duration_s=8.0, peak_db=rms_db + 6, rms_db=rms_db,
        lufs_integrated=lufs, dynamic_range_db=6.0,
        band_energy_db={b: 0.0 for b in FreqBand},
        spectral_centroid_hz=500.0, dominant_frequencies_hz=[100.0],
        stereo_width=width, pan_estimate=0.0, is_mono=False,
    )


def test_compare_emits_rms_delta():
    user = StemAnalysisResult(per_stem={StemRole.BASS: _metrics(StemRole.BASS, -8.0, -14.0, 0.2)})
    ref = StemAnalysisResult(per_stem={StemRole.BASS: _metrics(StemRole.BASS, -12.0, -16.0, 0.3)})
    deltas = compare(user, ref)
    rms = next(d for d in deltas if d.metric == "rms_db" and d.role == StemRole.BASS)
    assert rms.delta == 4.0
    assert "louder" in rms.interpretation


def test_compare_skips_roles_missing_in_reference():
    user = StemAnalysisResult(per_stem={
        StemRole.BASS: _metrics(StemRole.BASS, -10.0, -14.0, 0.2),
        StemRole.PAD: _metrics(StemRole.PAD, -18.0, -22.0, 0.6),
    })
    ref = StemAnalysisResult(per_stem={StemRole.BASS: _metrics(StemRole.BASS, -10.0, -14.0, 0.2)})
    deltas = compare(user, ref)
    assert all(d.role != StemRole.PAD for d in deltas)
