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
