from pathlib import Path

import numpy as np
import soundfile as sf

from audio_analysis.stems.analyzer import (
    _band_energy_db,
    _dominant_from_spec,
    _shared_spectrum,
    analyze,
    analyze_grouped,
)
from audio_analysis.stems.types import BAND_EDGES_HZ, FreqBand, StemRole


def test_analyze_returns_per_stem_metrics(synth_stem_files: dict[str, Path]):
    paths = {StemRole(role): p for role, p in synth_stem_files.items()}
    result = analyze(paths)
    assert set(result.per_stem.keys()) == {StemRole.KICK, StemRole.BASS, StemRole.HATS, StemRole.VOCALS}
    bass = result.per_stem[StemRole.BASS]
    band_max = max(bass.band_energy_db, key=bass.band_energy_db.get)
    assert band_max in (FreqBand.BASS, FreqBand.LOW_MID)


def test_analyze_detects_clash_between_kick_and_bass(synth_stem_files):
    paths = {StemRole(role): p for role, p in synth_stem_files.items()}
    result = analyze(paths)
    pairs = {(c.stem_a, c.stem_b) for c in result.clash_matrix}
    pairs |= {(c.stem_b, c.stem_a) for c in result.clash_matrix}
    assert (StemRole.KICK, StemRole.BASS) in pairs


def test_analyze_handles_mono_file(tmp_path: Path):
    p = tmp_path / "mono_bass.flac"
    sf.write(p, np.sin(2 * np.pi * 110 * np.arange(44100) / 44100).astype(np.float32), 44100)
    result = analyze({StemRole.BASS: p})
    assert result.per_stem[StemRole.BASS].is_mono is True
    assert result.per_stem[StemRole.BASS].stereo_width == 0.0


# ── shared-spectrum equivalence guards (perf refactor, 2026-07) ────────────────


def _two_tone(sr: int, n: int) -> np.ndarray:
    """110 Hz (bass band, loud) + 5 kHz (high_mid band, quieter)."""
    t = np.arange(n) / sr
    sig = 0.6 * np.sin(2 * np.pi * 110 * t) + 0.15 * np.sin(2 * np.pi * 5000 * t)
    return sig.astype(np.float32)


def test_dominant_freqs_hit_the_tones():
    sr = 44100
    mono = _two_tone(sr, 2 * sr)
    freqs, spec = _shared_spectrum(mono, sr)
    dom = _dominant_from_spec(freqs, spec)
    assert abs(dom[0] - 110.0) < 2.0  # strongest tone first
    assert dom == sorted(dom, key=lambda f: -spec[np.argmin(np.abs(freqs - f))])


def test_argpartition_topk_matches_full_argsort():
    rng = np.random.default_rng(42)
    spec = rng.random(200_003).astype(np.float32)  # awkward length on purpose
    freqs = np.linspace(0, 22050, len(spec))
    expected_idx = np.argsort(spec)[-3:][::-1]
    expected = [float(freqs[i]) for i in expected_idx]
    assert _dominant_from_spec(freqs, spec, k=3) == expected


def test_band_energy_matches_bruteforce_reference():
    """New shared-spectrum band energies vs the pre-refactor float64 formula.

    n is FFT-smooth (2*44100) so next_fast_len(n) == n. Bands carrying real
    energy must match to well under 0.01 dB. Bands that are effectively EMPTY
    (>60 dB below the loudest band) sit on the FFT noise floor, where float32
    and float64 legitimately differ — for those we only require that both
    implementations agree the band is empty.
    """
    sr = 44100
    mono = _two_tone(sr, 2 * sr)
    got = _band_energy_db(mono, sr)

    spec = np.abs(np.fft.rfft(mono.astype(np.float64) * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), d=1 / sr)
    want = {}
    for band, (lo, hi) in BAND_EDGES_HZ.items():
        energy = float((spec[(freqs >= lo) & (freqs < hi)] ** 2).sum())
        want[band] = 10 * float(np.log10(energy + 1e-12))

    floor = max(want.values()) - 60.0
    for band in BAND_EDGES_HZ:
        if want[band] > floor:
            assert abs(got[band] - want[band]) < 0.01, band
        else:
            assert got[band] < floor and want[band] < floor, band


def test_awkward_length_padding_keeps_tones_and_ratio_order():
    """Non-smooth sample counts get zero-padded to a fast FFT length; the padded
    bin grid must still resolve the tones and preserve band-energy ordering."""
    sr = 44100
    mono = _two_tone(sr, 2 * sr + 7919)  # deliberately non-smooth length
    freqs, spec = _shared_spectrum(mono, sr)
    assert abs(_dominant_from_spec(freqs, spec)[0] - 110.0) < 2.0
    bands = _band_energy_db(mono, sr)
    assert max(bands, key=bands.get) == FreqBand.BASS


def test_analyze_grouped_reports_progress(synth_stem_files):
    groups = {StemRole(r): [p] for r, p in synth_stem_files.items()}
    seen: list[tuple[int, int]] = []
    analyze_grouped(groups, on_progress=lambda done, total: seen.append((done, total)))
    assert seen == [(i + 1, len(groups)) for i in range(len(groups))]
