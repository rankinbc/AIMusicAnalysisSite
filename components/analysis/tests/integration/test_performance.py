"""Performance regression guard for the stems analysis path.

Mark `perf` so it can be opted in/out of normal runs:
    pytest -m perf  →  runs
    pytest          →  skipped (default deselect, see pyproject if configured)
"""
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from audio_analysis.phases import phase4_stems, phase5_reference
from audio_analysis.stems.types import StemRole

# Budget: 90s for analyzing 4 stems through phase 4 + phase 5.
# This is generous; on a normal dev machine it usually completes in <10s.
STEM_PIPELINE_BUDGET_S = 90.0


# Realistic-length guard (2026-07 perf refactor): the 4 s synthetic corpus above
# is ~75x shorter than a real track and never surfaced the full-track FFT
# pathologies (triple rfft per role, argsort of millions of bins, Bluestein
# fallback on non-smooth lengths). This one uses 150 s stems at a deliberately
# NON-SMOOTH sample count. Budget is ~2x the measured post-refactor time on a
# dev machine; the pre-refactor implementation exceeds it several-fold.
REALISTIC_STEMS_BUDGET_S = 30.0


@pytest.mark.perf
def test_realistic_length_stems_phase4_budget(tmp_path: Path):
    sr = 44100
    n = int(150.0 * sr) + 7919  # non-smooth on purpose
    t = np.arange(n) / sr
    stems: dict[StemRole, Path] = {}
    for role, freq, amp in (
        (StemRole.KICK, 60.0, 0.6),
        (StemRole.BASS, 110.0, 0.4),
        (StemRole.VOCALS, 440.0, 0.3),
    ):
        p = tmp_path / f"{role.value}.wav"
        sig = (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)
        sf.write(p, np.column_stack([sig, sig]), sr)
        stems[role] = p

    mix = tmp_path / "mix.wav"
    sf.write(mix, (0.3 * np.sin(2 * np.pi * 200 * np.arange(2 * sr) / sr)).astype(np.float32), sr)

    t0 = time.perf_counter()
    result = phase4_stems.analyze(mix, stem_paths=stems)
    elapsed = time.perf_counter() - t0
    assert result["stems"]["status"] == "ok"
    assert elapsed < REALISTIC_STEMS_BUDGET_S, (
        f"phase 4 with 3x150s stems took {elapsed:.1f}s "
        f"(budget {REALISTIC_STEMS_BUDGET_S}s)"
    )


@pytest.mark.perf
def test_stem_phases_complete_within_budget(tmp_path: Path, synth_stem_files):
    sr = 44100
    mix = tmp_path / "mix.wav"
    sf.write(mix, (0.3 * np.sin(2 * np.pi * 200 * np.arange(2 * sr) / sr)).astype(np.float32), sr)

    stem_paths = {StemRole(r): p for r, p in synth_stem_files.items()}
    t0 = time.perf_counter()
    phase4_stems.analyze(mix, stem_paths=stem_paths)
    phase5_reference.compare(
        mix,
        reference_path=str(mix),
        phase1_result={},
        user_stem_paths=stem_paths,
        reference_stem_paths=stem_paths,
    )
    elapsed = time.perf_counter() - t0
    assert elapsed < STEM_PIPELINE_BUDGET_S, (
        f"stem analysis took {elapsed:.1f}s (budget {STEM_PIPELINE_BUDGET_S}s)"
    )
