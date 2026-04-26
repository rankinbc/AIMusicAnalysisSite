# Stems & Ableton Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional stems-upload path to AIMusicAnalysisSite that produces per-stem analysis (frequency balance, cross-stem clash matrix, stereo width, balance vs. genre profile, deltas vs. reference stems) and surfaces findings as prescriptive verdicts tied to .als track names when an Ableton project is also provided.

**Architecture:** A new `audio_analysis.stems` package (port of AbletonAIAnalysis logic) is the only place stem analysis lives. Phases 4 and 5 conditionally call into it when `stem_paths` is present and merge richer fields into their existing output schemas. Three new verdict specialists handle stem-only findings; two existing specialists are extended to use stem data when available.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0 async, Alembic, Celery + Redis, librosa, pyloudnorm, RapidFuzz, React 19 + Vite + TypeScript, Tailwind, shadcn/ui, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-26-stems-ableton-integration-design.md`

> **Execution scope (2026-04-26):** Tasks 1–21, 30–33, 35 only. The frontend tasks (22–29) and the Playwright E2E (34) are deferred to a separate follow-up plan because the actual frontend (`components/frontend-spectr/`) uses vanilla `.jsx` with no TypeScript / Tailwind / shadcn / vitest / Playwright. See the banner above Task 22 for details.

---

## File Structure (decomposition lock-in)

### New files (Python — analysis package)

| File | Responsibility |
|---|---|
| `components/analysis/src/audio_analysis/stems/__init__.py` | Re-export public API: `detect_role`, `propose_mapping`, `validate_confirmed_mapping`, `analyze`, `compare`, plus dataclasses |
| `components/analysis/src/audio_analysis/stems/types.py` | `StemRole` enum, `FreqBand` enum, all dataclasses (`RoleProposal`, `StemMappingProposal`, `ConfirmedMapping`, `StemMetrics`, `StemClash`, `StemAnalysisResult`, `BalanceFlag`, `StemReferenceDelta`) |
| `components/analysis/src/audio_analysis/stems/role_detector.py` | `detect_role(file_path, audio=None) -> RoleProposal` — filename keywords + spectral fingerprint |
| `components/analysis/src/audio_analysis/stems/matcher.py` | `propose_mapping`, `validate_confirmed_mapping` |
| `components/analysis/src/audio_analysis/stems/analyzer.py` | `analyze(stem_paths, genre_profile=None) -> StemAnalysisResult` — port of AbletonAIAnalysis StemAnalyzer |
| `components/analysis/src/audio_analysis/stems/reference_comparator.py` | `compare(user, reference) -> list[StemReferenceDelta]` |
| `components/analysis/src/audio_analysis/reference_library/__init__.py` | Empty package marker |
| `components/analysis/src/audio_analysis/reference_library/pre_demucs.py` | Standalone CLI: Demucs-and-cache curated references |

### New files (Python — API)

| File | Responsibility |
|---|---|
| `components/api/app/routers/stems.py` | `POST /uploads/{job_id}/stems/confirm` |
| `components/api/prompts/experts/StemBalance.md` | New specialist prompt |
| `components/api/prompts/experts/StemStereoWidth.md` | New specialist prompt |
| `components/api/prompts/experts/StemReferenceDelta.md` | New specialist prompt |

### New files (Frontend)

| File | Responsibility |
|---|---|
| `components/frontend/src/components/upload/StemUploader.tsx` | Multi-file drag-drop input for stems |
| `components/frontend/src/components/upload/StemMappingTable.tsx` | Confirmation table (file × role × als_track dropdowns) |
| `components/frontend/src/components/report/PerStemBalanceCard.tsx` | Heatmap table |
| `components/frontend/src/components/report/StemClashMatrixCard.tsx` | Role × role matrix |
| `components/frontend/src/components/report/StemReferenceDeltasCard.tsx` | Per-stem reference delta list |
| `components/frontend/src/lib/stemApi.ts` | API client for new endpoints |
| `components/frontend/src/types/stems.ts` | TypeScript types mirroring backend dataclasses |

### New files (Tests)

| File | Responsibility |
|---|---|
| `components/analysis/tests/stems/__init__.py` | Package marker |
| `components/analysis/tests/stems/conftest.py` | Synthetic stem fixture generator |
| `components/analysis/tests/stems/test_role_detector.py` | Filename + spectral role detection |
| `components/analysis/tests/stems/test_matcher.py` | Auto-match + validation |
| `components/analysis/tests/stems/test_analyzer.py` | Per-stem metrics + clash matrix |
| `components/analysis/tests/stems/test_reference_comparator.py` | Delta computation |
| `components/analysis/tests/phases/test_phase4_with_stems.py` | Phase 4 stem branch |
| `components/analysis/tests/phases/test_phase5_with_stems.py` | Phase 5 stem branch |
| `components/analysis/tests/integration/test_pipeline_with_stems.py` | Snapshot golden test |
| `components/analysis/tests/fixtures/audio/stems/` | Real CC0 stems + bad inputs + reference cache fixture |
| `components/api/tests/test_uploads_with_stems.py` | Upload + mapping + confirm flow |
| `components/api/tests/verdict_pipeline/test_stem_specialists.py` | New + extended specialist behavior |
| `components/frontend/src/components/upload/__tests__/StemUploader.test.tsx` | Component test |
| `components/frontend/src/components/upload/__tests__/StemMappingTable.test.tsx` | Component test |
| `components/frontend/e2e/stems-upload.spec.ts` | Playwright happy path |

### Modified files

| File | Why |
|---|---|
| `components/shared/aimusic_shared/models.py` | Add `stem_paths_raw`, `stem_paths`, `stem_metrics` columns; extend status enum with `AWAITING_STEM_MAPPING` |
| `components/api/alembic/versions/009_add_stem_columns.py` | Alembic migration for the above |
| `components/api/app/routers/uploads.py` | Accept `stems[]` and `reference_stems[]`; validate; build proposed_mapping; set status |
| `components/api/app/routers/__init__.py` | Register the new `stems` router |
| `components/api/app/main.py` | Include the new router |
| `components/worker/app/tasks.py` | Pass `stem_paths` through to `run_analysis_pipeline` |
| `components/analysis/src/audio_analysis/pipeline.py` | Accept `stem_paths` arg; thread through to phases |
| `components/analysis/src/audio_analysis/phases/phase4_stems.py` | Call `stems.analyze` when `stem_paths` present; merge into result |
| `components/analysis/src/audio_analysis/phases/phase5_reference.py` | Call `stems.compare` when both sides have stems; merge into result |
| `components/api/prompts/experts/FrequencyCollisionDetection.md` | Use `stem_clash_matrix` when present |
| `components/api/prompts/experts/FrequencyBalance.md` | Use per-stem band energies when present |
| `components/api/app/verdict_pipeline/specialists.py` | Register the 3 new specialists |
| `components/frontend/src/pages/UploadPage.tsx` | Wire `StemUploader` + `StemMappingTable` |
| `components/frontend/src/pages/ReportPage.tsx` | Render the 3 new cards when `stem_metrics` present |
| `components/api/README.md` | Document new endpoints |
| `components/analysis/README.md` | Document `stems/` module + pre-Demucs runbook |

---

## Task 1: Type definitions (foundation)

**Files:**
- Create: `components/analysis/src/audio_analysis/stems/__init__.py`
- Create: `components/analysis/src/audio_analysis/stems/types.py`
- Test: `components/analysis/tests/stems/__init__.py`, `components/analysis/tests/stems/test_types.py`

- [ ] **Step 1.1: Create empty package markers**

```bash
mkdir -p components/analysis/src/audio_analysis/stems
mkdir -p components/analysis/tests/stems
```

Create `components/analysis/src/audio_analysis/stems/__init__.py` empty for now.
Create `components/analysis/tests/stems/__init__.py` empty.

- [ ] **Step 1.2: Write failing test for type imports**

Create `components/analysis/tests/stems/test_types.py`:

```python
from audio_analysis.stems.types import (
    StemRole, FreqBand, RoleProposal, StemMappingProposal, ConfirmedMapping,
    StemMetrics, StemClash, StemAnalysisResult, BalanceFlag, StemReferenceDelta,
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
    import dataclasses
    with __import__("pytest").raises(dataclasses.FrozenInstanceError):
        rp.confidence = 0.5


def test_stem_metrics_required_fields():
    m = StemMetrics(
        role=StemRole.BASS, duration_s=8.0, peak_db=-1.0, rms_db=-12.0,
        lufs_integrated=-14.0, dynamic_range_db=8.0,
        band_energy_db={b: -20.0 for b in FreqBand},
        spectral_centroid_hz=120.0, dominant_frequencies_hz=[60.0, 120.0],
        stereo_width=0.0, pan_estimate=0.0, is_mono=True,
    )
    assert m.role == StemRole.BASS
```

- [ ] **Step 1.3: Run test to verify failure**

Run: `cd components/analysis && pytest tests/stems/test_types.py -v`
Expected: FAIL with `ModuleNotFoundError` or `ImportError` on `audio_analysis.stems.types`.

- [ ] **Step 1.4: Implement types**

Create `components/analysis/src/audio_analysis/stems/types.py`:

```python
"""Public types for the stems module. Consumed by phases, verdict pipeline, and API."""
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Literal


class StemRole(StrEnum):
    DRUMS = "drums"
    KICK = "kick"
    SNARE = "snare"
    HATS = "hats"
    BASS = "bass"
    VOCALS = "vocals"
    LEAD = "lead"
    PAD = "pad"
    FX = "fx"
    OTHER = "other"


class FreqBand(StrEnum):
    SUB = "sub"
    BASS = "bass"
    LOW_MID = "low_mid"
    MID = "mid"
    HIGH_MID = "high_mid"
    PRESENCE = "presence"
    AIR = "air"


# Frequency band edges in Hz, ported from AbletonAIAnalysis StemAnalyzer.
BAND_EDGES_HZ: dict[FreqBand, tuple[float, float]] = {
    FreqBand.SUB: (20.0, 60.0),
    FreqBand.BASS: (60.0, 200.0),
    FreqBand.LOW_MID: (200.0, 600.0),
    FreqBand.MID: (600.0, 2000.0),
    FreqBand.HIGH_MID: (2000.0, 6000.0),
    FreqBand.PRESENCE: (6000.0, 12000.0),
    FreqBand.AIR: (12000.0, 20000.0),
}


SeverityTier = Literal["info", "warning", "critical"]


@dataclass(frozen=True)
class RoleProposal:
    role: StemRole
    confidence: float
    evidence: str


@dataclass
class StemMappingProposal:
    file: Path
    proposed_role: StemRole
    proposed_als_track: str | None
    confidence: float


@dataclass
class ConfirmedMapping:
    file: Path
    role: StemRole
    als_track: str | None


@dataclass
class StemMetrics:
    role: StemRole
    duration_s: float
    peak_db: float
    rms_db: float
    lufs_integrated: float
    dynamic_range_db: float
    band_energy_db: dict[FreqBand, float]
    spectral_centroid_hz: float
    dominant_frequencies_hz: list[float]
    stereo_width: float
    pan_estimate: float
    is_mono: bool


@dataclass
class StemClash:
    stem_a: StemRole
    stem_b: StemRole
    band: FreqBand
    overlap_severity: float
    severity_tier: SeverityTier


@dataclass
class BalanceFlag:
    role: StemRole
    metric: str
    observed: float
    expected_range: tuple[float, float]
    direction: Literal["too_low", "too_high"]
    severity_tier: SeverityTier


@dataclass
class StemAnalysisResult:
    per_stem: dict[StemRole, StemMetrics]
    clash_matrix: list[StemClash] = field(default_factory=list)
    balance_flags: list[BalanceFlag] = field(default_factory=list)


@dataclass
class StemReferenceDelta:
    role: StemRole
    metric: str
    user_value: float
    reference_value: float
    delta: float
    interpretation: str
    severity_tier: SeverityTier
```

- [ ] **Step 1.5: Run test to verify pass**

Run: `cd components/analysis && pytest tests/stems/test_types.py -v`
Expected: 4 passed.

- [ ] **Step 1.6: Commit**

```bash
git add components/analysis/src/audio_analysis/stems/__init__.py \
        components/analysis/src/audio_analysis/stems/types.py \
        components/analysis/tests/stems/__init__.py \
        components/analysis/tests/stems/test_types.py
git commit -m "feat(stems): add type definitions for stems module"
```

---

## Task 2: Database migration & ORM updates

**Files:**
- Modify: `components/shared/aimusic_shared/models.py`
- Create: `components/api/alembic/versions/009_add_stem_columns.py`
- Test: `components/api/tests/test_models_stem_columns.py`

- [ ] **Step 2.1: Write failing test**

Create `components/api/tests/test_models_stem_columns.py`:

```python
import pytest
from sqlalchemy import inspect
from aimusic_shared.models import UploadJob, AnalysisResults, JobStatus


def test_upload_job_has_stem_paths_raw():
    cols = {c.name for c in inspect(UploadJob).columns}
    assert "stem_paths_raw" in cols
    assert "stem_paths" in cols


def test_analysis_results_has_stem_metrics():
    cols = {c.name for c in inspect(AnalysisResults).columns}
    assert "stem_metrics" in cols


def test_job_status_enum_has_awaiting_stem_mapping():
    assert "AWAITING_STEM_MAPPING" in {s.name for s in JobStatus}
```

- [ ] **Step 2.2: Run test to verify failure**

Run: `cd components/api && pytest tests/test_models_stem_columns.py -v`
Expected: FAIL on missing columns / enum value.

- [ ] **Step 2.3: Update ORM model**

Modify `components/shared/aimusic_shared/models.py`. In the `JobStatus` enum, add:

```python
AWAITING_STEM_MAPPING = "AWAITING_STEM_MAPPING"
```

In the `UploadJob` class, add (after existing optional path columns):

```python
stem_paths_raw: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
stem_paths: Mapped[dict[str, str] | None] = mapped_column(JSONB, nullable=True)
```

In the `AnalysisResults` class, add (after `verdicts_payload`):

```python
stem_metrics: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

- [ ] **Step 2.4: Generate Alembic migration**

Run: `cd components/api && alembic revision -m "add_stem_columns" --autogenerate`

Edit the generated file in `components/api/alembic/versions/` (numbered `009_*.py`) to confirm it contains the column adds and the enum value extension. If autogenerate misses the enum value, add an explicit `op.execute("ALTER TYPE jobstatus ADD VALUE 'AWAITING_STEM_MAPPING'")` in `upgrade()` (PostgreSQL requires this for enum extensions; wrap in try/except for re-runs).

- [ ] **Step 2.5: Apply migration locally**

Run: `cd components/api && alembic upgrade head`
Expected: migration applied without error.

- [ ] **Step 2.6: Run test to verify pass**

Run: `cd components/api && pytest tests/test_models_stem_columns.py -v`
Expected: 3 passed.

- [ ] **Step 2.7: Commit**

```bash
git add components/shared/aimusic_shared/models.py \
        components/api/alembic/versions/*.py \
        components/api/tests/test_models_stem_columns.py
git commit -m "feat(db): add stem_paths and stem_metrics columns + AWAITING_STEM_MAPPING status"
```

---

## Task 3: Stem fixtures

**Files:**
- Create: `components/analysis/tests/stems/conftest.py`
- Create: `components/analysis/tests/fixtures/audio/stems/.gitkeep`

- [ ] **Step 3.1: Create fixtures directory**

```bash
mkdir -p components/analysis/tests/fixtures/audio/stems/synth_clean
mkdir -p components/analysis/tests/fixtures/audio/stems/bad_inputs
mkdir -p components/analysis/tests/fixtures/audio/stems/reference_pre_demucs
touch components/analysis/tests/fixtures/audio/stems/.gitkeep
```

- [ ] **Step 3.2: Write deterministic fixture generator**

Create `components/analysis/tests/stems/conftest.py`:

```python
"""Generate deterministic synthetic stems for tests. Avoids committing audio binaries."""
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

SR = 44100
DURATION_S = 4.0
N_SAMPLES = int(SR * DURATION_S)


def _stereo_silence() -> np.ndarray:
    return np.zeros((N_SAMPLES, 2), dtype=np.float32)


def _kick(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = _stereo_silence()
    for beat in range(int(DURATION_S * 2)):  # 120 BPM
        start = int(beat * SR / 2)
        env = np.exp(-np.linspace(0, 8, 4410))
        tone = np.sin(2 * np.pi * 60 * np.arange(4410) / SR) * env
        end = min(start + 4410, N_SAMPLES)
        out[start:end, 0] += tone[: end - start] * 0.8
        out[start:end, 1] += tone[: end - start] * 0.8
    return out + rng.normal(0, 1e-5, out.shape).astype(np.float32)


def _bass(seed: int = 0) -> np.ndarray:
    out = _stereo_silence()
    t = np.arange(N_SAMPLES) / SR
    tone = np.sin(2 * np.pi * 110 * t).astype(np.float32) * 0.4
    out[:, 0] = tone
    out[:, 1] = tone
    return out


def _hats(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = _stereo_silence()
    for n in range(int(DURATION_S * 8)):  # 16ths
        start = int(n * SR / 8)
        env = np.exp(-np.linspace(0, 12, 1100))
        noise = rng.normal(0, 1, 1100).astype(np.float32) * env
        # Hi-pass-ish by adding only high frequencies via simple diff
        noise = np.diff(noise, prepend=0)
        end = min(start + 1100, N_SAMPLES)
        out[start:end, 0] += noise[: end - start] * 0.15
        out[start:end, 1] += noise[: end - start] * 0.15
    return out


def _vocals(seed: int = 0) -> np.ndarray:
    out = _stereo_silence()
    t = np.arange(N_SAMPLES) / SR
    # Sweep 200-800 Hz, mid-band heavy
    f = 200 + 600 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t))
    phase = np.cumsum(2 * np.pi * f / SR)
    tone = np.sin(phase).astype(np.float32) * 0.3
    out[:, 0] = tone * 0.95
    out[:, 1] = tone * 1.05  # subtle stereo
    return out


@pytest.fixture(scope="session")
def synth_stems_dir(tmp_path_factory) -> Path:
    """Returns a directory containing 4 synthetic FLAC stems with known characteristics."""
    out = tmp_path_factory.mktemp("synth_stems")
    sf.write(out / "01_Kick.flac", _kick(), SR)
    sf.write(out / "02_Bass.flac", _bass(), SR)
    sf.write(out / "03_Hats.flac", _hats(), SR)
    sf.write(out / "04_Vox.flac", _vocals(), SR)
    return out


@pytest.fixture(scope="session")
def synth_stem_files(synth_stems_dir: Path) -> dict[str, Path]:
    return {
        "kick": synth_stems_dir / "01_Kick.flac",
        "bass": synth_stems_dir / "02_Bass.flac",
        "hats": synth_stems_dir / "03_Hats.flac",
        "vocals": synth_stems_dir / "04_Vox.flac",
    }
```

- [ ] **Step 3.3: Smoke-test the fixture**

Create `components/analysis/tests/stems/test_fixtures_smoke.py`:

```python
import soundfile as sf


def test_synth_stems_exist(synth_stem_files):
    for path in synth_stem_files.values():
        assert path.exists()
        info = sf.info(path)
        assert info.samplerate == 44100
        assert info.channels == 2
```

Run: `cd components/analysis && pytest tests/stems/test_fixtures_smoke.py -v`
Expected: 1 passed.

- [ ] **Step 3.4: Commit**

```bash
git add components/analysis/tests/stems/conftest.py \
        components/analysis/tests/stems/test_fixtures_smoke.py \
        components/analysis/tests/fixtures/audio/stems/.gitkeep
git commit -m "test(stems): add deterministic synthetic stem fixtures"
```

---

## Task 4: Role detector

**Files:**
- Create: `components/analysis/src/audio_analysis/stems/role_detector.py`
- Test: `components/analysis/tests/stems/test_role_detector.py`

- [ ] **Step 4.1: Write failing tests**

Create `components/analysis/tests/stems/test_role_detector.py`:

```python
from pathlib import Path

import pytest

from audio_analysis.stems.role_detector import detect_role
from audio_analysis.stems.types import StemRole


@pytest.mark.parametrize("filename,expected", [
    ("01_Kick.flac", StemRole.KICK),
    ("02_Bass.wav", StemRole.BASS),
    ("Snare_top.flac", StemRole.SNARE),
    ("hi-hats.wav", StemRole.HATS),
    ("Lead Vocal.flac", StemRole.VOCALS),
    ("Synth_Lead.wav", StemRole.LEAD),
    ("Pad_warm.flac", StemRole.PAD),
    ("Riser_FX.wav", StemRole.FX),
])
def test_filename_keywords(tmp_path: Path, filename: str, expected: StemRole):
    p = tmp_path / filename
    p.write_bytes(b"")  # empty; should not be read for filename-only path
    result = detect_role(p, audio=None)
    assert result.role == expected
    assert result.confidence >= 0.8
    assert "filename" in result.evidence


def test_unknown_filename_falls_back_to_other_when_no_audio(tmp_path: Path):
    p = tmp_path / "track_07.flac"
    p.write_bytes(b"")
    result = detect_role(p, audio=None)
    assert result.role == StemRole.OTHER
    assert result.confidence < 0.5


def test_spectral_classifies_bass_when_filename_unknown(synth_stem_files):
    import soundfile as sf
    bass_path = synth_stem_files["bass"]
    audio, _ = sf.read(bass_path, always_2d=True)
    # Rename to something unmatched; pass audio explicitly
    fake = bass_path.parent / "track_99.flac"
    if not fake.exists():
        fake.symlink_to(bass_path) if hasattr(fake, "symlink_to") else fake.write_bytes(bass_path.read_bytes())
    result = detect_role(fake, audio=audio)
    assert result.role == StemRole.BASS
    assert "spectral" in result.evidence
```

- [ ] **Step 4.2: Run to verify failure**

Run: `cd components/analysis && pytest tests/stems/test_role_detector.py -v`
Expected: FAIL on `ModuleNotFoundError`.

- [ ] **Step 4.3: Implement role detector**

Create `components/analysis/src/audio_analysis/stems/role_detector.py`:

```python
"""Detect stem role from filename keywords first, falling back to spectral fingerprint."""
import re
from pathlib import Path

import numpy as np

from .types import RoleProposal, StemRole

# Highest-priority keyword per role. Order matters: longer/specific first.
KEYWORD_PATTERNS: list[tuple[StemRole, re.Pattern[str]]] = [
    (StemRole.KICK, re.compile(r"\bkick|\bbd\b|\bbass[\s_-]?drum", re.I)),
    (StemRole.SNARE, re.compile(r"\bsnare|\bsd\b", re.I)),
    (StemRole.HATS, re.compile(r"\bhi[\s_-]?hat|\bhats?\b|\bhh\b", re.I)),
    (StemRole.DRUMS, re.compile(r"\bdrums?\b|\bperc(ussion)?\b|\bbeat\b", re.I)),
    (StemRole.BASS, re.compile(r"\bbass(?!\s?drum)|\bsub\b|\b808\b", re.I)),
    (StemRole.VOCALS, re.compile(r"\bvox\b|\bvocals?\b|\blead\s?vox\b|\bsinger?\b", re.I)),
    (StemRole.LEAD, re.compile(r"\blead\b|\bmelody\b", re.I)),
    (StemRole.PAD, re.compile(r"\bpad\b|\bstrings?\b|\batmos\w*", re.I)),
    (StemRole.FX, re.compile(r"\bfx\b|\briser\b|\bswoosh\b|\bimpact\b|\bsfx\b", re.I)),
]


def _filename_match(stem: str) -> RoleProposal | None:
    for role, pattern in KEYWORD_PATTERNS:
        if pattern.search(stem):
            return RoleProposal(role=role, confidence=0.9, evidence=f"filename match: {pattern.pattern!r}")
    return None


def _band_energy_ratios(audio: np.ndarray, sr: int = 44100) -> dict[str, float]:
    mono = audio.mean(axis=1) if audio.ndim == 2 else audio
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), d=1 / sr)
    total = float(spec.sum() + 1e-12)
    bands = {
        "sub": (20, 60), "bass": (60, 200), "low_mid": (200, 600),
        "mid": (600, 2000), "high_mid": (2000, 6000),
        "presence": (6000, 12000), "air": (12000, 20000),
    }
    return {
        name: float(spec[(freqs >= lo) & (freqs < hi)].sum()) / total
        for name, (lo, hi) in bands.items()
    }


def _spectral_classify(audio: np.ndarray) -> RoleProposal:
    r = _band_energy_ratios(audio)
    # Heuristics: dominant band wins, tweaked from AbletonAIAnalysis observations.
    if r["sub"] + r["bass"] > 0.55 and r["air"] < 0.05:
        return RoleProposal(StemRole.BASS, 0.7, "spectral: low-band dominant")
    if r["high_mid"] + r["presence"] + r["air"] > 0.55 and r["sub"] + r["bass"] < 0.10:
        return RoleProposal(StemRole.HATS, 0.6, "spectral: high-band dominant")
    if 0.40 < r["mid"] + r["low_mid"] < 0.75 and r["sub"] < 0.10:
        return RoleProposal(StemRole.VOCALS, 0.55, "spectral: mid-band dominant")
    return RoleProposal(StemRole.OTHER, 0.3, "spectral: no clear dominant band")


def detect_role(file_path: Path, audio: np.ndarray | None = None) -> RoleProposal:
    """Filename-first role detection. Spectral fallback when audio is provided."""
    proposal = _filename_match(file_path.stem)
    if proposal is not None:
        return proposal
    if audio is not None:
        return _spectral_classify(audio)
    return RoleProposal(StemRole.OTHER, 0.2, "no filename match, no audio provided")
```

- [ ] **Step 4.4: Run to verify pass**

Run: `cd components/analysis && pytest tests/stems/test_role_detector.py -v`
Expected: 10 passed (8 parametrized + 2 standalone).

- [ ] **Step 4.5: Commit**

```bash
git add components/analysis/src/audio_analysis/stems/role_detector.py \
        components/analysis/tests/stems/test_role_detector.py
git commit -m "feat(stems): add filename + spectral role detector"
```

---

## Task 5: Matcher (auto-mapping + validation)

**Files:**
- Create: `components/analysis/src/audio_analysis/stems/matcher.py`
- Test: `components/analysis/tests/stems/test_matcher.py`

- [ ] **Step 5.1: Write failing tests**

Create `components/analysis/tests/stems/test_matcher.py`:

```python
from pathlib import Path
import pytest

from audio_analysis.stems.matcher import propose_mapping, validate_confirmed_mapping
from audio_analysis.stems.types import ConfirmedMapping, StemRole


def test_propose_with_als_track_names(synth_stems_dir: Path):
    files = sorted(synth_stems_dir.glob("*.flac"))
    als_tracks = ["Kick", "Bass", "Hats", "Lead Vox"]
    proposals = propose_mapping(files, als_tracks)
    by_file = {p.file.name: p for p in proposals}
    assert by_file["01_Kick.flac"].proposed_role == StemRole.KICK
    assert by_file["01_Kick.flac"].proposed_als_track == "Kick"
    assert by_file["04_Vox.flac"].proposed_als_track == "Lead Vox"


def test_propose_without_als_uses_filename(synth_stems_dir: Path):
    files = sorted(synth_stems_dir.glob("*.flac"))
    proposals = propose_mapping(files, als_track_names=None)
    by_file = {p.file.name: p for p in proposals}
    assert by_file["02_Bass.flac"].proposed_role == StemRole.BASS
    assert all(p.proposed_als_track is None for p in proposals)


def test_validate_passes_with_unique_roles(tmp_path: Path):
    mappings = [
        ConfirmedMapping(tmp_path / "a.flac", StemRole.DRUMS, None),
        ConfirmedMapping(tmp_path / "b.flac", StemRole.BASS, None),
    ]
    validate_confirmed_mapping(mappings)  # should not raise


def test_validate_rejects_duplicate_roles(tmp_path: Path):
    mappings = [
        ConfirmedMapping(tmp_path / "a.flac", StemRole.BASS, None),
        ConfirmedMapping(tmp_path / "b.flac", StemRole.BASS, None),
    ]
    with pytest.raises(ValueError, match="duplicate_role"):
        validate_confirmed_mapping(mappings)
```

- [ ] **Step 5.2: Run to verify failure**

Run: `cd components/analysis && pytest tests/stems/test_matcher.py -v`
Expected: FAIL on `ModuleNotFoundError`.

- [ ] **Step 5.3: Implement matcher**

Create `components/analysis/src/audio_analysis/stems/matcher.py`:

```python
"""Auto-match uploaded stem files to roles and (optionally) .als track names."""
from collections import Counter
from pathlib import Path

from rapidfuzz import fuzz, process

from .role_detector import detect_role
from .types import ConfirmedMapping, StemMappingProposal


# RapidFuzz score threshold (0-100). Below this we set proposed_als_track to None.
ALS_MATCH_THRESHOLD = 60


def propose_mapping(
    stem_files: list[Path],
    als_track_names: list[str] | None,
) -> list[StemMappingProposal]:
    """Returns one StemMappingProposal per file, with role + optional als_track."""
    role_proposals = [detect_role(f) for f in stem_files]
    proposals: list[StemMappingProposal] = []
    available_tracks = list(als_track_names) if als_track_names else []

    for file, rp in zip(stem_files, role_proposals):
        als_track: str | None = None
        if available_tracks:
            best = process.extractOne(file.stem, available_tracks, scorer=fuzz.token_set_ratio)
            if best and best[1] >= ALS_MATCH_THRESHOLD:
                als_track = best[0]
                available_tracks.remove(als_track)  # greedy, no double-assignment
        proposals.append(
            StemMappingProposal(
                file=file,
                proposed_role=rp.role,
                proposed_als_track=als_track,
                confidence=rp.confidence,
            )
        )
    return proposals


def validate_confirmed_mapping(mappings: list[ConfirmedMapping]) -> None:
    """Raise ValueError on duplicate roles (without _2/_3 suffix) or missing files.

    The API layer is responsible for translating these into 422 responses.
    """
    if not mappings:
        raise ValueError("no_mappings: at least one mapping required")
    role_counts = Counter(m.role for m in mappings)
    duplicates = [r for r, c in role_counts.items() if c > 1]
    if duplicates:
        # Caller may use _2/_3 suffix logic in the API layer; here we are strict.
        raise ValueError(f"duplicate_role: {duplicates[0].value}")
    for m in mappings:
        if not m.file.exists():
            raise ValueError(f"missing_file: {m.file}")
```

- [ ] **Step 5.4: Run to verify pass**

Run: `cd components/analysis && pytest tests/stems/test_matcher.py -v`
Expected: 4 passed.

- [ ] **Step 5.5: Commit**

```bash
git add components/analysis/src/audio_analysis/stems/matcher.py \
        components/analysis/tests/stems/test_matcher.py
git commit -m "feat(stems): add propose_mapping and validate_confirmed_mapping"
```

---

## Task 6: Stem analyzer (port of AbletonAIAnalysis)

**Files:**
- Create: `components/analysis/src/audio_analysis/stems/analyzer.py`
- Test: `components/analysis/tests/stems/test_analyzer.py`

- [ ] **Step 6.1: Write failing tests**

Create `components/analysis/tests/stems/test_analyzer.py`:

```python
from pathlib import Path

from audio_analysis.stems.analyzer import analyze
from audio_analysis.stems.types import FreqBand, StemRole


def test_analyze_returns_per_stem_metrics(synth_stem_files: dict[str, Path]):
    paths = {StemRole(role): p for role, p in synth_stem_files.items()}
    result = analyze(paths)
    assert set(result.per_stem.keys()) == {StemRole.KICK, StemRole.BASS, StemRole.HATS, StemRole.VOCALS}
    bass = result.per_stem[StemRole.BASS]
    # Bass should have most energy in BASS band (60-200 Hz around 110 Hz)
    band_max = max(bass.band_energy_db, key=bass.band_energy_db.get)
    assert band_max in (FreqBand.BASS, FreqBand.LOW_MID)


def test_analyze_detects_clash_between_kick_and_bass(synth_stem_files):
    paths = {StemRole(role): p for role, p in synth_stem_files.items()}
    result = analyze(paths)
    pairs = {(c.stem_a, c.stem_b) for c in result.clash_matrix}
    pairs |= {(c.stem_b, c.stem_a) for c in result.clash_matrix}
    assert (StemRole.KICK, StemRole.BASS) in pairs


def test_analyze_handles_mono_file(tmp_path: Path):
    import numpy as np
    import soundfile as sf
    p = tmp_path / "mono_bass.flac"
    sf.write(p, np.sin(2 * np.pi * 110 * np.arange(44100) / 44100).astype(np.float32), 44100)
    result = analyze({StemRole.BASS: p})
    assert result.per_stem[StemRole.BASS].is_mono is True
    assert result.per_stem[StemRole.BASS].stereo_width == 0.0
```

- [ ] **Step 6.2: Run to verify failure**

Run: `cd components/analysis && pytest tests/stems/test_analyzer.py -v`
Expected: FAIL on `ModuleNotFoundError`.

- [ ] **Step 6.3: Implement analyzer**

Create `components/analysis/src/audio_analysis/stems/analyzer.py`:

```python
"""Per-stem audio analysis: bands, loudness, stereo, clash matrix.

Ported from AbletonAIAnalysis: projects/music-analyzer/src/stem_analyzer.py
Same band edges, same clash thresholds.
"""
from itertools import combinations
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from .types import (
    BAND_EDGES_HZ, BalanceFlag, FreqBand, StemAnalysisResult, StemClash,
    StemMetrics, StemRole,
)


CLASH_THRESHOLDS: dict[str, float] = {"info": 0.3, "warning": 0.5, "critical": 0.7}


def _severity_for_overlap(overlap: float) -> str:
    if overlap >= CLASH_THRESHOLDS["critical"]:
        return "critical"
    if overlap >= CLASH_THRESHOLDS["warning"]:
        return "warning"
    return "info"


def _load(file_path: Path, sr: int) -> tuple[np.ndarray, int]:
    audio, file_sr = sf.read(file_path, always_2d=True)
    audio = audio.astype(np.float32)
    if file_sr != sr:
        audio = librosa.resample(audio.T, orig_sr=file_sr, target_sr=sr).T
    return audio, sr


def _band_energy_db(mono: np.ndarray, sr: int) -> dict[FreqBand, float]:
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), d=1 / sr)
    out: dict[FreqBand, float] = {}
    for band, (lo, hi) in BAND_EDGES_HZ.items():
        mask = (freqs >= lo) & (freqs < hi)
        energy = float((spec[mask] ** 2).sum())
        out[band] = 10 * float(np.log10(energy + 1e-12))
    return out


def _band_energy_ratios(mono: np.ndarray, sr: int) -> dict[FreqBand, float]:
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), d=1 / sr)
    total = float((spec ** 2).sum() + 1e-12)
    return {
        band: float((spec[(freqs >= lo) & (freqs < hi)] ** 2).sum()) / total
        for band, (lo, hi) in BAND_EDGES_HZ.items()
    }


def _stereo_width(audio: np.ndarray) -> tuple[float, bool]:
    if audio.shape[1] == 1:
        return 0.0, True
    left, right = audio[:, 0], audio[:, 1]
    if np.allclose(left, right, atol=1e-6):
        return 0.0, True
    side = (left - right) / 2
    mid = (left + right) / 2
    side_rms = float(np.sqrt((side ** 2).mean() + 1e-12))
    mid_rms = float(np.sqrt((mid ** 2).mean() + 1e-12))
    width = min(1.0, side_rms / mid_rms) if mid_rms > 0 else 0.0
    return width, False


def _pan_estimate(audio: np.ndarray) -> float:
    if audio.shape[1] == 1:
        return 0.0
    l_rms = float(np.sqrt((audio[:, 0] ** 2).mean() + 1e-12))
    r_rms = float(np.sqrt((audio[:, 1] ** 2).mean() + 1e-12))
    total = l_rms + r_rms
    if total < 1e-9:
        return 0.0
    return float((r_rms - l_rms) / total)


def _dominant_freqs(mono: np.ndarray, sr: int, k: int = 3) -> list[float]:
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), d=1 / sr)
    top = np.argsort(spec)[-k:][::-1]
    return [float(freqs[i]) for i in top]


def _measure_one(role: StemRole, file_path: Path, sr: int) -> StemMetrics:
    audio, sr = _load(file_path, sr)
    mono = audio.mean(axis=1)
    meter = pyln.Meter(sr)
    try:
        lufs = float(meter.integrated_loudness(mono))
    except Exception:
        lufs = float("-inf")
    rms = 20 * float(np.log10(np.sqrt((mono ** 2).mean()) + 1e-12))
    peak = 20 * float(np.log10(np.max(np.abs(mono)) + 1e-12))
    width, is_mono = _stereo_width(audio)
    return StemMetrics(
        role=role,
        duration_s=float(len(mono) / sr),
        peak_db=peak,
        rms_db=rms,
        lufs_integrated=lufs,
        dynamic_range_db=peak - rms,
        band_energy_db=_band_energy_db(mono, sr),
        spectral_centroid_hz=float(librosa.feature.spectral_centroid(y=mono, sr=sr).mean()),
        dominant_frequencies_hz=_dominant_freqs(mono, sr),
        stereo_width=width,
        pan_estimate=_pan_estimate(audio),
        is_mono=is_mono,
    )


def _clash_overlap(a: dict[FreqBand, float], b: dict[FreqBand, float], band: FreqBand) -> float:
    """Geometric-mean overlap of band energy ratios — high when both stems put energy in same band."""
    return float(np.sqrt(a[band] * b[band]))


def _build_clash_matrix(
    stem_paths: dict[StemRole, Path], sr: int,
) -> list[StemClash]:
    ratios = {
        role: _band_energy_ratios(_load(p, sr)[0].mean(axis=1), sr)
        for role, p in stem_paths.items()
    }
    out: list[StemClash] = []
    for (role_a, ra), (role_b, rb) in combinations(ratios.items(), 2):
        for band in FreqBand:
            overlap = _clash_overlap(ra, rb, band)
            if overlap >= CLASH_THRESHOLDS["info"]:
                out.append(
                    StemClash(
                        stem_a=role_a, stem_b=role_b, band=band,
                        overlap_severity=overlap,
                        severity_tier=_severity_for_overlap(overlap),
                    )
                )
    return out


def _balance_flags(
    metrics: dict[StemRole, StemMetrics], genre_profile: Any | None,
) -> list[BalanceFlag]:
    if genre_profile is None:
        return []
    out: list[BalanceFlag] = []
    expectations = getattr(genre_profile, "stem_rms_db_expectations", {})  # {StemRole: (low, high)}
    for role, m in metrics.items():
        rng = expectations.get(role)
        if rng is None:
            continue
        lo, hi = rng
        if m.rms_db < lo:
            out.append(BalanceFlag(role, "rms_db", m.rms_db, (lo, hi), "too_low", "warning"))
        elif m.rms_db > hi:
            out.append(BalanceFlag(role, "rms_db", m.rms_db, (lo, hi), "too_high", "warning"))
    return out


def analyze(
    stem_paths: dict[StemRole, Path],
    genre_profile: Any | None = None,
    sample_rate: int = 44100,
) -> StemAnalysisResult:
    """Analyze each stem and produce a per-stem + cross-stem result."""
    per_stem = {role: _measure_one(role, p, sample_rate) for role, p in stem_paths.items()}
    return StemAnalysisResult(
        per_stem=per_stem,
        clash_matrix=_build_clash_matrix(stem_paths, sample_rate),
        balance_flags=_balance_flags(per_stem, genre_profile),
    )
```

- [ ] **Step 6.4: Run to verify pass**

Run: `cd components/analysis && pytest tests/stems/test_analyzer.py -v`
Expected: 3 passed.

- [ ] **Step 6.5: Commit**

```bash
git add components/analysis/src/audio_analysis/stems/analyzer.py \
        components/analysis/tests/stems/test_analyzer.py
git commit -m "feat(stems): port StemAnalyzer with per-stem metrics and clash matrix"
```

---

## Task 7: Reference comparator

**Files:**
- Create: `components/analysis/src/audio_analysis/stems/reference_comparator.py`
- Test: `components/analysis/tests/stems/test_reference_comparator.py`

- [ ] **Step 7.1: Write failing tests**

Create `components/analysis/tests/stems/test_reference_comparator.py`:

```python
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
    assert rms.delta == 4.0  # user is 4 dB louder
    assert "louder" in rms.interpretation


def test_compare_skips_roles_missing_in_reference():
    user = StemAnalysisResult(per_stem={
        StemRole.BASS: _metrics(StemRole.BASS, -10.0, -14.0, 0.2),
        StemRole.PAD: _metrics(StemRole.PAD, -18.0, -22.0, 0.6),
    })
    ref = StemAnalysisResult(per_stem={StemRole.BASS: _metrics(StemRole.BASS, -10.0, -14.0, 0.2)})
    deltas = compare(user, ref)
    assert all(d.role != StemRole.PAD for d in deltas)
```

- [ ] **Step 7.2: Run to verify failure**

Run: `cd components/analysis && pytest tests/stems/test_reference_comparator.py -v`
Expected: FAIL on `ModuleNotFoundError`.

- [ ] **Step 7.3: Implement comparator**

Create `components/analysis/src/audio_analysis/stems/reference_comparator.py`:

```python
"""Per-stem metric deltas: user vs. reference. Pure number-crunching, no IO."""
from .types import StemAnalysisResult, StemReferenceDelta, StemRole


METRIC_THRESHOLDS = {
    "rms_db": {"info": 1.0, "warning": 3.0, "critical": 6.0},
    "lufs_integrated": {"info": 1.0, "warning": 3.0, "critical": 6.0},
    "stereo_width": {"info": 0.1, "warning": 0.25, "critical": 0.5},
}


def _severity(metric: str, abs_delta: float) -> str:
    th = METRIC_THRESHOLDS.get(metric, {"info": 0.0, "warning": 0.0, "critical": 0.0})
    if abs_delta >= th["critical"]:
        return "critical"
    if abs_delta >= th["warning"]:
        return "warning"
    return "info"


def _interpret(metric: str, delta: float) -> str:
    direction = {
        "rms_db": ("louder", "quieter"),
        "lufs_integrated": ("louder (LUFS)", "quieter (LUFS)"),
        "stereo_width": ("wider", "narrower"),
    }.get(metric, ("higher", "lower"))
    word = direction[0] if delta > 0 else direction[1]
    unit = "dB" if "db" in metric or "lufs" in metric else ""
    return f"{abs(delta):.1f} {unit} {word} than reference".strip()


def _delta_for_metric(
    role: StemRole, metric: str, user_value: float, reference_value: float,
) -> StemReferenceDelta:
    delta = user_value - reference_value
    return StemReferenceDelta(
        role=role, metric=metric,
        user_value=user_value, reference_value=reference_value,
        delta=delta,
        interpretation=_interpret(metric, delta),
        severity_tier=_severity(metric, abs(delta)),
    )


def compare(user: StemAnalysisResult, reference: StemAnalysisResult) -> list[StemReferenceDelta]:
    """Return per-role, per-metric deltas. Skips roles missing in either side."""
    out: list[StemReferenceDelta] = []
    for role, u in user.per_stem.items():
        r = reference.per_stem.get(role)
        if r is None:
            continue
        out.append(_delta_for_metric(role, "rms_db", u.rms_db, r.rms_db))
        out.append(_delta_for_metric(role, "lufs_integrated", u.lufs_integrated, r.lufs_integrated))
        out.append(_delta_for_metric(role, "stereo_width", u.stereo_width, r.stereo_width))
        for band, u_db in u.band_energy_db.items():
            r_db = r.band_energy_db.get(band)
            if r_db is None:
                continue
            out.append(
                _delta_for_metric(role, f"band_energy_db.{band.value}", u_db, r_db)
            )
    return out
```

- [ ] **Step 7.4: Run to verify pass**

Run: `cd components/analysis && pytest tests/stems/test_reference_comparator.py -v`
Expected: 2 passed.

- [ ] **Step 7.5: Commit**

```bash
git add components/analysis/src/audio_analysis/stems/reference_comparator.py \
        components/analysis/tests/stems/test_reference_comparator.py
git commit -m "feat(stems): add reference_comparator for per-stem metric deltas"
```

---

## Task 8: Public API re-exports

**Files:**
- Modify: `components/analysis/src/audio_analysis/stems/__init__.py`
- Test: `components/analysis/tests/stems/test_public_api.py`

- [ ] **Step 8.1: Write failing test**

Create `components/analysis/tests/stems/test_public_api.py`:

```python
def test_public_api_re_exports():
    import audio_analysis.stems as s
    for name in ("detect_role", "propose_mapping", "validate_confirmed_mapping",
                 "analyze", "compare", "StemRole", "FreqBand", "StemMetrics",
                 "StemAnalysisResult", "StemReferenceDelta"):
        assert hasattr(s, name), f"missing public export: {name}"
```

- [ ] **Step 8.2: Run to verify failure**

Run: `cd components/analysis && pytest tests/stems/test_public_api.py -v`
Expected: FAIL on missing attributes.

- [ ] **Step 8.3: Implement re-exports**

Replace `components/analysis/src/audio_analysis/stems/__init__.py` with:

```python
"""Public API for the stems module. Phases import from here, never from submodules."""
from .analyzer import analyze
from .matcher import propose_mapping, validate_confirmed_mapping
from .reference_comparator import compare
from .role_detector import detect_role
from .types import (
    BalanceFlag, ConfirmedMapping, FreqBand, RoleProposal,
    StemAnalysisResult, StemClash, StemMappingProposal, StemMetrics,
    StemReferenceDelta, StemRole,
)

__all__ = [
    "analyze", "compare", "detect_role", "propose_mapping",
    "validate_confirmed_mapping",
    "BalanceFlag", "ConfirmedMapping", "FreqBand", "RoleProposal",
    "StemAnalysisResult", "StemClash", "StemMappingProposal",
    "StemMetrics", "StemReferenceDelta", "StemRole",
]
```

- [ ] **Step 8.4: Run to verify pass**

Run: `cd components/analysis && pytest tests/stems/ -v`
Expected: all stem tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add components/analysis/src/audio_analysis/stems/__init__.py \
        components/analysis/tests/stems/test_public_api.py
git commit -m "feat(stems): expose public API via package __init__"
```

---

## Task 9: Phase 4 integration (call stems.analyze when present)

**Files:**
- Modify: `components/analysis/src/audio_analysis/phases/phase4_stems.py`
- Modify: `components/analysis/src/audio_analysis/pipeline.py` (accept `stem_paths` arg)
- Test: `components/analysis/tests/phases/test_phase4_with_stems.py`

- [ ] **Step 9.1: Read existing phase 4 to understand its interface**

Run: `head -80 components/analysis/src/audio_analysis/phases/phase4_stems.py` and note:
- Function signature (likely `def run(audio_path, ...)`).
- Result dict shape (the verdict pipeline depends on it).

- [ ] **Step 9.2: Write failing test**

Create `components/analysis/tests/phases/test_phase4_with_stems.py`:

```python
from pathlib import Path

from audio_analysis.phases import phase4_stems


def test_phase4_no_stems_unchanged(tmp_path: Path):
    """Without stem_paths, the legacy spectral path runs and result has no 'stems' key."""
    # Use any short WAV fixture the existing phase 4 test uses; copy minimal pattern.
    from audio_analysis.tests.fixtures import short_mix_path  # adjust to project's fixture util
    result = phase4_stems.run(short_mix_path(), stem_paths=None)
    assert "spectral_clashes" in result
    assert "stems" not in result


def test_phase4_with_stems_adds_per_stem_and_clash_matrix(synth_stem_files):
    from audio_analysis.tests.fixtures import short_mix_path
    from audio_analysis.stems.types import StemRole
    stem_paths = {StemRole(r): p for r, p in synth_stem_files.items()}
    result = phase4_stems.run(short_mix_path(), stem_paths=stem_paths)
    assert "stems" in result
    assert "per_stem" in result["stems"]
    assert "clash_matrix" in result["stems"]
    assert StemRole.BASS.value in result["stems"]["per_stem"]
```

- [ ] **Step 9.3: Run to verify failure**

Run: `cd components/analysis && pytest tests/phases/test_phase4_with_stems.py -v`
Expected: FAIL — phase4 doesn't accept `stem_paths` yet.

- [ ] **Step 9.4: Modify phase 4 to accept and use stem_paths**

Open `components/analysis/src/audio_analysis/phases/phase4_stems.py` and modify the `run` function (or whatever the entry point is named — preserve the existing name):

Add `stem_paths: dict | None = None` to the signature. At the end of the function, before returning the result dict, add:

```python
if stem_paths:
    from audio_analysis.stems import analyze as analyze_stems
    from audio_analysis.stems.types import StemRole
    typed_paths = {StemRole(r) if isinstance(r, str) else r: p for r, p in stem_paths.items()}
    try:
        stem_result = analyze_stems(typed_paths)
        result["stems"] = {
            "per_stem": {
                role.value: {
                    "duration_s": m.duration_s,
                    "peak_db": m.peak_db,
                    "rms_db": m.rms_db,
                    "lufs_integrated": m.lufs_integrated,
                    "dynamic_range_db": m.dynamic_range_db,
                    "band_energy_db": {b.value: v for b, v in m.band_energy_db.items()},
                    "spectral_centroid_hz": m.spectral_centroid_hz,
                    "dominant_frequencies_hz": m.dominant_frequencies_hz,
                    "stereo_width": m.stereo_width,
                    "pan_estimate": m.pan_estimate,
                    "is_mono": m.is_mono,
                }
                for role, m in stem_result.per_stem.items()
            },
            "clash_matrix": [
                {
                    "stem_a": c.stem_a.value, "stem_b": c.stem_b.value,
                    "band": c.band.value, "overlap_severity": c.overlap_severity,
                    "severity_tier": c.severity_tier,
                }
                for c in stem_result.clash_matrix
            ],
            "balance_flags": [
                {
                    "role": b.role.value, "metric": b.metric, "observed": b.observed,
                    "expected_range": list(b.expected_range), "direction": b.direction,
                    "severity_tier": b.severity_tier,
                }
                for b in stem_result.balance_flags
            ],
            "status": "ok",
        }
    except Exception as exc:
        result["stems"] = {"status": "failed", "error": str(exc)}
return result
```

- [ ] **Step 9.5: Modify pipeline to forward stem_paths**

Open `components/analysis/src/audio_analysis/pipeline.py`. Add `stem_paths: dict | None = None` to `run_analysis_pipeline` signature. Pass it through to phase 4: `phase4_stems.run(audio_path, stem_paths=stem_paths, ...)`.

- [ ] **Step 9.6: Run to verify pass**

Run: `cd components/analysis && pytest tests/phases/test_phase4_with_stems.py -v`
Expected: 2 passed.

- [ ] **Step 9.7: Commit**

```bash
git add components/analysis/src/audio_analysis/phases/phase4_stems.py \
        components/analysis/src/audio_analysis/pipeline.py \
        components/analysis/tests/phases/test_phase4_with_stems.py
git commit -m "feat(phase4): consume stems module when stem_paths provided"
```

---

## Task 10: Phase 5 integration (per-stem reference deltas)

**Files:**
- Modify: `components/analysis/src/audio_analysis/phases/phase5_reference.py`
- Modify: `components/analysis/src/audio_analysis/pipeline.py` (forward `reference_stem_paths`)
- Test: `components/analysis/tests/phases/test_phase5_with_stems.py`

- [ ] **Step 10.1: Write failing test**

Create `components/analysis/tests/phases/test_phase5_with_stems.py`:

```python
from pathlib import Path

from audio_analysis.phases import phase5_reference


def test_phase5_with_user_and_reference_stems_emits_deltas(synth_stem_files, tmp_path: Path):
    from audio_analysis.stems.types import StemRole
    user_stems = {StemRole(r): p for r, p in synth_stem_files.items()}
    # Reuse the same files as "reference" — deltas should be ~0 but the structure exists.
    result = phase5_reference.run(
        user_audio_path=Path("any.wav"),
        reference_audio_path=Path("any.wav"),
        user_stem_paths=user_stems,
        reference_stem_paths=user_stems,
    )
    assert "per_stem_reference_deltas" in result
    assert len(result["per_stem_reference_deltas"]) > 0


def test_phase5_without_stems_unchanged():
    from audio_analysis.tests.fixtures import short_mix_path
    result = phase5_reference.run(
        user_audio_path=short_mix_path(),
        reference_audio_path=short_mix_path(),
        user_stem_paths=None,
        reference_stem_paths=None,
    )
    assert "per_stem_reference_deltas" not in result
```

- [ ] **Step 10.2: Run to verify failure**

Run: `cd components/analysis && pytest tests/phases/test_phase5_with_stems.py -v`
Expected: FAIL — signature doesn't accept the new args.

- [ ] **Step 10.3: Modify phase 5**

In `components/analysis/src/audio_analysis/phases/phase5_reference.py`, extend `run` signature with `user_stem_paths: dict | None = None, reference_stem_paths: dict | None = None`. Before returning, add:

```python
if user_stem_paths and reference_stem_paths:
    from audio_analysis.stems import analyze as analyze_stems, compare as compare_stems
    from audio_analysis.stems.types import StemRole
    try:
        u = analyze_stems({StemRole(r) if isinstance(r, str) else r: p for r, p in user_stem_paths.items()})
        r = analyze_stems({StemRole(r2) if isinstance(r2, str) else r2: p for r2, p in reference_stem_paths.items()})
        deltas = compare_stems(u, r)
        result["per_stem_reference_deltas"] = [
            {
                "role": d.role.value, "metric": d.metric,
                "user_value": d.user_value, "reference_value": d.reference_value,
                "delta": d.delta, "interpretation": d.interpretation,
                "severity_tier": d.severity_tier,
            }
            for d in deltas
        ]
        result["stem_reference_comparison"] = "ok"
    except Exception as exc:
        result["stem_reference_comparison"] = "failed"
        result["stem_reference_error"] = str(exc)
elif user_stem_paths and not reference_stem_paths:
    result["stem_reference_comparison"] = "unavailable"
return result
```

- [ ] **Step 10.4: Forward through pipeline**

In `components/analysis/src/audio_analysis/pipeline.py`, add `reference_stem_paths: dict | None = None` to `run_analysis_pipeline`. Pass `user_stem_paths=stem_paths, reference_stem_paths=reference_stem_paths` to `phase5_reference.run(...)`.

- [ ] **Step 10.5: Run to verify pass**

Run: `cd components/analysis && pytest tests/phases/test_phase5_with_stems.py -v`
Expected: 2 passed.

- [ ] **Step 10.6: Commit**

```bash
git add components/analysis/src/audio_analysis/phases/phase5_reference.py \
        components/analysis/src/audio_analysis/pipeline.py \
        components/analysis/tests/phases/test_phase5_with_stems.py
git commit -m "feat(phase5): emit per-stem reference deltas when both sides have stems"
```

---

## Task 11: Worker task signature

**Files:**
- Modify: `components/worker/app/tasks.py`
- Test: `components/worker/tests/test_tasks_with_stems.py`

- [ ] **Step 11.1: Write failing test**

Create `components/worker/tests/test_tasks_with_stems.py`:

```python
from unittest.mock import patch
from app.tasks import run_analysis_pipeline


def test_task_forwards_stem_paths():
    fake_paths = {"bass": "/tmp/bass.flac"}
    with patch("app.tasks._execute_pipeline") as mock_exec:
        run_analysis_pipeline.apply(
            kwargs={
                "job_id": "j1", "file_path": "/tmp/m.wav",
                "reference_path": None, "user_id": "u1",
                "als_file_path": None, "genre_hint": None,
                "stem_paths": fake_paths, "reference_stem_paths": None,
            }
        ).get()
        kwargs = mock_exec.call_args.kwargs
        assert kwargs["stem_paths"] == fake_paths
```

- [ ] **Step 11.2: Run to verify failure**

Run: `cd components/worker && pytest tests/test_tasks_with_stems.py -v`
Expected: FAIL on signature mismatch.

- [ ] **Step 11.3: Modify worker task**

In `components/worker/app/tasks.py`, add `stem_paths: dict | None = None, reference_stem_paths: dict | None = None` to the `run_analysis_pipeline` task signature. Forward them to the underlying pipeline call. Also forward to whatever per-job DB-state-write helper exists, so the orchestrator can read them back.

- [ ] **Step 11.4: Run to verify pass**

Run: `cd components/worker && pytest tests/test_tasks_with_stems.py -v`
Expected: 1 passed.

- [ ] **Step 11.5: Commit**

```bash
git add components/worker/app/tasks.py components/worker/tests/test_tasks_with_stems.py
git commit -m "feat(worker): accept stem_paths and reference_stem_paths kwargs"
```

---

## Task 12: Upload validation helpers

**Files:**
- Create: `components/api/app/services/stem_validation.py`
- Test: `components/api/tests/test_stem_validation.py`

- [ ] **Step 12.1: Write failing tests**

Create `components/api/tests/test_stem_validation.py`:

```python
from pathlib import Path

import pytest

from app.services.stem_validation import (
    MAX_STEM_FILES, MAX_PER_FILE_BYTES, MAX_TOTAL_BYTES,
    StemValidationError, validate_stem_uploads,
)


class _Upload:
    def __init__(self, filename: str, payload: bytes, content_type: str = "audio/flac"):
        self.filename, self.payload, self.content_type = filename, payload, content_type
        self.size = len(payload)


# Minimal FLAC magic bytes for tests
FLAC_MAGIC = b"fLaC" + b"\x00" * 100
WAV_MAGIC = b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 100


def test_accepts_4_flac_stems():
    uploads = [_Upload(f"0{i}_stem.flac", FLAC_MAGIC) for i in range(1, 5)]
    validate_stem_uploads(uploads)  # no raise


def test_rejects_too_many_files():
    uploads = [_Upload(f"s{i}.flac", FLAC_MAGIC) for i in range(MAX_STEM_FILES + 1)]
    with pytest.raises(StemValidationError) as exc:
        validate_stem_uploads(uploads)
    assert exc.value.code == "stem_count_out_of_range"


def test_rejects_zero_files():
    with pytest.raises(StemValidationError) as exc:
        validate_stem_uploads([])
    assert exc.value.code == "stem_count_out_of_range"


def test_rejects_oversized_file():
    uploads = [_Upload("big.flac", FLAC_MAGIC + b"\x00" * (MAX_PER_FILE_BYTES))]
    with pytest.raises(StemValidationError) as exc:
        validate_stem_uploads(uploads)
    assert exc.value.code == "stem_file_too_large"


def test_rejects_total_over_limit():
    chunk = MAX_PER_FILE_BYTES - 1
    uploads = [_Upload(f"s{i}.flac", FLAC_MAGIC + b"\x00" * chunk) for i in range(15)]
    with pytest.raises(StemValidationError) as exc:
        validate_stem_uploads(uploads)
    assert exc.value.code == "total_upload_too_large"


def test_rejects_mp3_disguised_as_flac():
    uploads = [_Upload("fake.flac", b"ID3\x03" + b"\x00" * 100)]
    with pytest.raises(StemValidationError) as exc:
        validate_stem_uploads(uploads)
    assert exc.value.code == "unsupported_stem_format"


def test_accepts_wav_by_magic():
    uploads = [_Upload("ok.wav", WAV_MAGIC)]
    validate_stem_uploads(uploads)
```

- [ ] **Step 12.2: Run to verify failure**

Run: `cd components/api && pytest tests/test_stem_validation.py -v`
Expected: FAIL on `ModuleNotFoundError`.

- [ ] **Step 12.3: Implement validation helpers**

Create `components/api/app/services/stem_validation.py`:

```python
"""Synchronous validation for stem uploads. Translates to 4xx in the router."""
from dataclasses import dataclass
from typing import Protocol


MAX_STEM_FILES = 16
MAX_PER_FILE_BYTES = 100 * 1024 * 1024     # 100 MB
MAX_TOTAL_BYTES = 1024 * 1024 * 1024       # 1 GB


class _UploadLike(Protocol):
    filename: str
    payload: bytes
    size: int


@dataclass
class StemValidationError(Exception):
    code: str
    message: str
    file: str | None = None

    def __str__(self) -> str:  # noqa: D401
        return f"{self.code}: {self.message}"


def _is_flac(buf: bytes) -> bool:
    return buf[:4] == b"fLaC"


def _is_wav(buf: bytes) -> bool:
    return buf[:4] == b"RIFF" and buf[8:12] == b"WAVE"


def validate_stem_uploads(uploads: list[_UploadLike]) -> None:
    if not uploads or len(uploads) > MAX_STEM_FILES:
        raise StemValidationError(
            "stem_count_out_of_range",
            f"stems must be between 1 and {MAX_STEM_FILES}",
        )
    total = 0
    for u in uploads:
        if u.size > MAX_PER_FILE_BYTES:
            raise StemValidationError(
                "stem_file_too_large",
                f"file exceeds {MAX_PER_FILE_BYTES // (1024 * 1024)} MB",
                file=u.filename,
            )
        total += u.size
        head = u.payload[:16]
        if not (_is_flac(head) or _is_wav(head)):
            raise StemValidationError(
                "unsupported_stem_format",
                "stem must be FLAC or WAV (magic-byte verified)",
                file=u.filename,
            )
    if total > MAX_TOTAL_BYTES:
        raise StemValidationError(
            "total_upload_too_large",
            f"sum of stems exceeds {MAX_TOTAL_BYTES // (1024 * 1024 * 1024)} GB",
        )
```

- [ ] **Step 12.4: Run to verify pass**

Run: `cd components/api && pytest tests/test_stem_validation.py -v`
Expected: 7 passed.

- [ ] **Step 12.5: Commit**

```bash
git add components/api/app/services/stem_validation.py \
        components/api/tests/test_stem_validation.py
git commit -m "feat(api): add stem upload validation helpers"
```

---

## Task 13: Extend POST /uploads/ with stems

**Files:**
- Modify: `components/api/app/routers/uploads.py`
- Test: `components/api/tests/test_uploads_with_stems.py`

- [ ] **Step 13.1: Write failing test**

Create `components/api/tests/test_uploads_with_stems.py`:

```python
import io
from unittest.mock import patch

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_upload_without_stems_dispatches_celery_immediately(authed_client: AsyncClient):
    with patch("app.routers.uploads.dispatch_pipeline") as mock_dispatch:
        resp = await authed_client.post("/uploads/", files={
            "mix": ("m.wav", _wav_bytes(), "audio/wav"),
        })
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "PENDING"
    mock_dispatch.assert_called_once()


@pytest.mark.asyncio
async def test_upload_with_stems_returns_proposed_mapping(authed_client: AsyncClient):
    with patch("app.routers.uploads.dispatch_pipeline") as mock_dispatch:
        files = {
            "mix": ("m.wav", _wav_bytes(), "audio/wav"),
            "stems": [
                ("01_Kick.flac", _flac_bytes(), "audio/flac"),
                ("02_Bass.flac", _flac_bytes(), "audio/flac"),
            ],
        }
        resp = await authed_client.post("/uploads/", files=files)
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "AWAITING_STEM_MAPPING"
    assert "proposed_mapping" in body
    assert len(body["proposed_mapping"]) == 2
    mock_dispatch.assert_not_called()
```

(Helpers `_wav_bytes`, `_flac_bytes`, fixture `authed_client` follow the existing test conventions in this directory — copy the pattern.)

- [ ] **Step 13.2: Run to verify failure**

Run: `cd components/api && pytest tests/test_uploads_with_stems.py -v`
Expected: FAIL — endpoint doesn't accept stems yet.

- [ ] **Step 13.3: Modify the upload endpoint**

In `components/api/app/routers/uploads.py`, extend the `POST /uploads/` handler:

1. Accept `stems: list[UploadFile] = File(default_factory=list)` and `reference_stems: list[UploadFile] = File(default_factory=list)` in the signature.
2. After existing validations, if `stems` is non-empty: read each into memory (capped by `MAX_PER_FILE_BYTES` from validation helpers), then call `validate_stem_uploads(stems)`. On `StemValidationError`, raise `HTTPException(status_code=413 if "too_large" in e.code else 422 if "count" in e.code or "format" in e.code else 415, detail={"code": e.code, "message": e.message, "file": e.file})`.
3. Persist each stem via `StorageService` to `data/uploads/{job_id}/stems/{filename}`. Same for `reference_stems` under `.../reference_stems/`.
4. Build `stem_paths_raw` (list of saved paths). If an `.als` file was uploaded, parse track names using existing phase 8 helper (`als_project.parse_track_names(als_path) -> list[str]`).
5. Call `propose_mapping(stem_paths_raw, als_track_names)`. Set `UploadJob.status = AWAITING_STEM_MAPPING`, persist `stem_paths_raw`, return:

```python
return JSONResponse(
    status_code=201,
    content={
        "job_id": str(job.id),
        "status": "AWAITING_STEM_MAPPING",
        "proposed_mapping": [
            {"file": p.file.name, "proposed_role": p.proposed_role.value,
             "proposed_als_track": p.proposed_als_track, "confidence": p.confidence}
            for p in proposals
        ],
        "als_track_names": als_track_names or [],
    },
)
```

6. If `stems` is empty: existing flow (status = PENDING, dispatch Celery).

- [ ] **Step 13.4: Run to verify pass**

Run: `cd components/api && pytest tests/test_uploads_with_stems.py -v`
Expected: 2 passed.

- [ ] **Step 13.5: Commit**

```bash
git add components/api/app/routers/uploads.py components/api/tests/test_uploads_with_stems.py
git commit -m "feat(api): accept stems and reference_stems in POST /uploads/"
```

---

## Task 14: POST /uploads/{job_id}/stems/confirm endpoint

**Files:**
- Create: `components/api/app/routers/stems.py`
- Modify: `components/api/app/main.py` (register router)
- Test: `components/api/tests/test_stems_confirm.py`

- [ ] **Step 14.1: Write failing test**

Create `components/api/tests/test_stems_confirm.py`:

```python
import pytest
from unittest.mock import patch
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_confirm_dispatches_celery_and_transitions_to_pending(
    authed_client: AsyncClient, awaiting_mapping_job_id: str,
):
    with patch("app.routers.stems.dispatch_pipeline") as mock_dispatch:
        resp = await authed_client.post(
            f"/uploads/{awaiting_mapping_job_id}/stems/confirm",
            json={"mappings": [
                {"file": "01_Kick.flac", "role": "drums", "als_track": "Kick"},
                {"file": "02_Bass.flac", "role": "bass", "als_track": "Bass"},
            ]},
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "PENDING"
    mock_dispatch.assert_called_once()


@pytest.mark.asyncio
async def test_confirm_rejects_duplicate_role(authed_client, awaiting_mapping_job_id):
    resp = await authed_client.post(
        f"/uploads/{awaiting_mapping_job_id}/stems/confirm",
        json={"mappings": [
            {"file": "01_Kick.flac", "role": "bass", "als_track": None},
            {"file": "02_Bass.flac", "role": "bass", "als_track": None},
        ]},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "duplicate_role"


@pytest.mark.asyncio
async def test_confirm_rejects_unmapped_file(authed_client, awaiting_mapping_job_id):
    resp = await authed_client.post(
        f"/uploads/{awaiting_mapping_job_id}/stems/confirm",
        json={"mappings": [
            {"file": "01_Kick.flac", "role": "drums", "als_track": None},
            # 02_Bass.flac uploaded but missing from confirmation
        ]},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "unmapped_stems"
```

- [ ] **Step 14.2: Run to verify failure**

Run: `cd components/api && pytest tests/test_stems_confirm.py -v`
Expected: FAIL — router does not exist.

- [ ] **Step 14.3: Implement router**

Create `components/api/app/routers/stems.py`:

```python
"""Stem-mapping confirmation endpoint."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from aimusic_shared.models import JobStatus, UploadJob
from audio_analysis.stems import validate_confirmed_mapping
from audio_analysis.stems.types import ConfirmedMapping, StemRole

from app.deps import get_current_user, get_db
from app.services.celery_dispatch import dispatch_pipeline


router = APIRouter(prefix="/uploads", tags=["stems"])


class _Mapping(BaseModel):
    file: str
    role: str
    als_track: str | None = None


class _ConfirmRequest(BaseModel):
    mappings: list[_Mapping]


@router.post("/{job_id}/stems/confirm")
async def confirm_stem_mapping(
    job_id: str,
    body: _ConfirmRequest,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user),
):
    job = await db.get(UploadJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "job_not_found"})
    if job.status != JobStatus.AWAITING_STEM_MAPPING:
        raise HTTPException(status_code=409, detail={"code": "wrong_status", "status": job.status.value})

    raw_paths = {Path(p).name: Path(p) for p in (job.stem_paths_raw or [])}
    submitted_files = {m.file for m in body.mappings}
    missing = set(raw_paths) - submitted_files
    if missing:
        raise HTTPException(status_code=422, detail={"code": "unmapped_stems", "files": sorted(missing)})

    try:
        confirmed = [
            ConfirmedMapping(file=raw_paths[m.file], role=StemRole(m.role), als_track=m.als_track)
            for m in body.mappings
        ]
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "invalid_role", "message": str(e)})

    try:
        validate_confirmed_mapping(confirmed)
    except ValueError as e:
        code, _, _ = str(e).partition(":")
        raise HTTPException(status_code=422, detail={"code": code.strip(), "message": str(e)})

    job.stem_paths = {m.role.value: str(m.file) for m in confirmed}
    job.status = JobStatus.PENDING
    await db.commit()

    dispatch_pipeline(
        job_id=str(job.id),
        file_path=job.file_path,
        reference_path=job.reference_path,
        user_id=str(job.user_id),
        als_file_path=job.als_file_path,
        genre_hint=job.genre_hint,
        stem_paths=job.stem_paths,
        reference_stem_paths=job.reference_stem_paths if hasattr(job, "reference_stem_paths") else None,
    )
    return {"job_id": str(job.id), "status": "PENDING"}
```

- [ ] **Step 14.4: Register the router**

In `components/api/app/main.py`, add:

```python
from app.routers import stems as stems_router
app.include_router(stems_router.router)
```

- [ ] **Step 14.5: Run to verify pass**

Run: `cd components/api && pytest tests/test_stems_confirm.py -v`
Expected: 3 passed.

- [ ] **Step 14.6: Commit**

```bash
git add components/api/app/routers/stems.py components/api/app/main.py \
        components/api/tests/test_stems_confirm.py
git commit -m "feat(api): add POST /uploads/{job_id}/stems/confirm endpoint"
```

---

## Task 15: GET /uploads/{job_id} re-serves proposed mapping

**Files:**
- Modify: `components/api/app/routers/uploads.py` (the existing GET handler)
- Test: `components/api/tests/test_uploads_get_with_stems.py`

- [ ] **Step 15.1: Write failing test**

Create `components/api/tests/test_uploads_get_with_stems.py`:

```python
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_awaiting_mapping_returns_proposed_mapping(
    authed_client: AsyncClient, awaiting_mapping_job_id: str,
):
    resp = await authed_client.get(f"/uploads/{awaiting_mapping_job_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "AWAITING_STEM_MAPPING"
    assert "proposed_mapping" in body
```

- [ ] **Step 15.2: Run to verify failure**

Run: `cd components/api && pytest tests/test_uploads_get_with_stems.py -v`
Expected: FAIL — GET response doesn't include `proposed_mapping`.

- [ ] **Step 15.3: Modify GET handler**

In `components/api/app/routers/uploads.py` `GET /uploads/{job_id}` handler, when `job.status == JobStatus.AWAITING_STEM_MAPPING`, add `proposed_mapping` and `als_track_names` to the response:

```python
if job.status == JobStatus.AWAITING_STEM_MAPPING and job.stem_paths_raw:
    from audio_analysis.stems import propose_mapping
    from app.services.als_project import parse_track_names
    als_tracks = parse_track_names(job.als_file_path) if job.als_file_path else None
    proposals = propose_mapping([Path(p) for p in job.stem_paths_raw], als_tracks)
    response["proposed_mapping"] = [
        {"file": p.file.name, "proposed_role": p.proposed_role.value,
         "proposed_als_track": p.proposed_als_track, "confidence": p.confidence}
        for p in proposals
    ]
    response["als_track_names"] = als_tracks or []
```

- [ ] **Step 15.4: Run to verify pass**

Run: `cd components/api && pytest tests/test_uploads_get_with_stems.py -v`
Expected: 1 passed.

- [ ] **Step 15.5: Commit**

```bash
git add components/api/app/routers/uploads.py \
        components/api/tests/test_uploads_get_with_stems.py
git commit -m "feat(api): re-serve proposed_mapping for awaiting-mapping jobs"
```

---

## Task 16: Mapping-confirmation timeout job

**Files:**
- Create: `components/worker/app/tasks_cleanup.py`
- Modify: `components/worker/app/celery_app.py` (register beat schedule)
- Test: `components/worker/tests/test_mapping_timeout.py`

- [ ] **Step 16.1: Write failing test**

Create `components/worker/tests/test_mapping_timeout.py`:

```python
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.tasks_cleanup import expire_stale_stem_mappings


@pytest.mark.asyncio
async def test_expires_jobs_older_than_24h():
    fake_jobs = [
        type("J", (), {"id": "j1", "status": "AWAITING_STEM_MAPPING",
                       "created_at": datetime.now(timezone.utc) - timedelta(hours=25)}),
        type("J", (), {"id": "j2", "status": "AWAITING_STEM_MAPPING",
                       "created_at": datetime.now(timezone.utc) - timedelta(hours=2)}),
    ]
    with patch("app.tasks_cleanup._fetch_awaiting_jobs", AsyncMock(return_value=fake_jobs)) as fetch, \
         patch("app.tasks_cleanup._mark_failed", AsyncMock()) as mark, \
         patch("app.tasks_cleanup._purge_files", AsyncMock()) as purge:
        await expire_stale_stem_mappings()
        mark.assert_awaited_once_with("j1", code="mapping_timeout")
        purge.assert_awaited_once_with("j1")
```

- [ ] **Step 16.2: Run to verify failure**

Run: `cd components/worker && pytest tests/test_mapping_timeout.py -v`
Expected: FAIL.

- [ ] **Step 16.3: Implement the cleanup task**

Create `components/worker/app/tasks_cleanup.py`:

```python
"""Periodic cleanup tasks. Beat-scheduled."""
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from aimusic_shared.models import JobStatus, UploadJob
from app.db import async_session_factory


MAPPING_TIMEOUT_HOURS = 24


async def _fetch_awaiting_jobs() -> list[UploadJob]:
    async with async_session_factory() as session:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=MAPPING_TIMEOUT_HOURS)
        result = await session.execute(
            select(UploadJob).where(
                UploadJob.status == JobStatus.AWAITING_STEM_MAPPING,
                UploadJob.created_at <= cutoff,
            )
        )
        return list(result.scalars().all())


async def _mark_failed(job_id: str, *, code: str) -> None:
    async with async_session_factory() as session:
        job = await session.get(UploadJob, job_id)
        if job is None:
            return
        job.status = JobStatus.FAILED
        await session.commit()


async def _purge_files(job_id: str) -> None:
    upload_dir = Path("data/uploads") / job_id
    if upload_dir.exists():
        for child in upload_dir.glob("**/*"):
            if child.is_file():
                child.unlink(missing_ok=True)


async def expire_stale_stem_mappings() -> None:
    for job in await _fetch_awaiting_jobs():
        await _mark_failed(str(job.id), code="mapping_timeout")
        await _purge_files(str(job.id))
```

- [ ] **Step 16.4: Schedule with Celery beat**

In `components/worker/app/celery_app.py`, add to the `beat_schedule` dict (create one if missing):

```python
"expire-stale-stem-mappings": {
    "task": "app.tasks_cleanup.expire_stale_stem_mappings_task",
    "schedule": 3600.0,  # every hour
},
```

Wrap the async function so Celery can call it:

```python
from celery import shared_task
import asyncio

@shared_task(name="app.tasks_cleanup.expire_stale_stem_mappings_task")
def expire_stale_stem_mappings_task():
    asyncio.run(expire_stale_stem_mappings())
```

(Place in `tasks_cleanup.py`.)

- [ ] **Step 16.5: Run to verify pass**

Run: `cd components/worker && pytest tests/test_mapping_timeout.py -v`
Expected: 1 passed.

- [ ] **Step 16.6: Commit**

```bash
git add components/worker/app/tasks_cleanup.py \
        components/worker/app/celery_app.py \
        components/worker/tests/test_mapping_timeout.py
git commit -m "feat(worker): expire stale stem-mapping jobs after 24h"
```

---

## Task 17: New verdict specialist — StemBalance

**Files:**
- Create: `components/api/prompts/experts/StemBalance.md`
- Modify: `components/api/app/verdict_pipeline/specialists.py` (register)
- Test: `components/api/tests/verdict_pipeline/test_stem_balance.py`

- [ ] **Step 17.1: Write failing test**

Create `components/api/tests/verdict_pipeline/test_stem_balance.py`:

```python
from unittest.mock import patch

from app.verdict_pipeline.orchestrator import run_specialist


def _phase_results_with_stems():
    return {
        "phase4": {
            "stems": {
                "per_stem": {
                    "bass": {"rms_db": -6.0, "lufs_integrated": -10.0, "stereo_width": 0.1},
                    "vocals": {"rms_db": -22.0, "lufs_integrated": -28.0, "stereo_width": 0.4},
                },
                "balance_flags": [
                    {"role": "bass", "metric": "rms_db", "observed": -6.0,
                     "expected_range": [-14.0, -10.0], "direction": "too_high",
                     "severity_tier": "warning"},
                ],
                "status": "ok",
            },
        }
    }


def _phase_results_without_stems():
    return {"phase4": {"spectral_clashes": []}}


def test_stem_balance_returns_verdict_when_flags_present():
    fake_llm_response = {
        "verdicts": [{
            "slug": "bass-too-loud",
            "title": "Bass is hot",
            "severity": "warning",
            "prescription": "Reduce bass channel by 4 dB.",
        }]
    }
    with patch("app.verdict_pipeline.orchestrator._call_llm", return_value=fake_llm_response):
        verdicts = run_specialist("StemBalance", _phase_results_with_stems())
    assert len(verdicts) == 1
    assert verdicts[0]["slug"] == "bass-too-loud"


def test_stem_balance_skips_when_no_stem_metrics():
    with patch("app.verdict_pipeline.orchestrator._call_llm") as mock_llm:
        verdicts = run_specialist("StemBalance", _phase_results_without_stems())
    mock_llm.assert_not_called()
    assert verdicts == []
```

- [ ] **Step 17.2: Run to verify failure**

Run: `cd components/api && pytest tests/verdict_pipeline/test_stem_balance.py -v`
Expected: FAIL — specialist not registered, prompt missing, orchestrator may not gate on stem presence.

- [ ] **Step 17.3: Add prompt file**

Create `components/api/prompts/experts/StemBalance.md`:

```markdown
---
version: 1.0.0
slug: StemBalance
requires: phase4.stems.status == "ok"
---

You are a mixing-engineer specialist. The user provided individual stems for their mix. Below is the per-stem balance data and a list of stems flagged as too loud or too quiet versus the genre profile.

# Per-stem metrics
{{phase4.stems.per_stem | json}}

# Balance flags
{{phase4.stems.balance_flags | json}}

# Your job
For each balance flag, produce one verdict in the standard JSON format:

```
{
  "verdicts": [
    {
      "slug": "<short-kebab-case>",
      "title": "<one-line, ≤60 chars>",
      "severity": "info" | "warning" | "critical",
      "prescription": "<exactly one prescriptive sentence the user can act on>",
      "evidence": "<one-line citation of the metric>",
      "stem_role": "<role string from the flag>"
    }
  ]
}
```

Rules:
- One verdict per flag, no extras.
- Severity matches the flag's `severity_tier`.
- Prescription must reference the stem by role name, e.g., "Reduce the bass channel by 4 dB."
- Do not invent stems not present in the data.
- If the flags list is empty, return `{"verdicts": []}`.
```

- [ ] **Step 17.4: Register specialist & gate**

In `components/api/app/verdict_pipeline/specialists.py`, add:

```python
SPECIALIST_GATES: dict[str, callable[[dict], bool]] = {
    "StemBalance": lambda r: bool(
        r.get("phase4", {}).get("stems", {}).get("balance_flags")
    ),
    # Other gates — Task 18, 19 will add to this dict.
}
```

In `components/api/app/verdict_pipeline/orchestrator.py`, in `run_specialist(name, phase_results)`, before invoking the LLM, check the gate:

```python
gate = SPECIALIST_GATES.get(name)
if gate is not None and not gate(phase_results):
    return []
```

Append `"StemBalance"` to whatever `ALL_SPECIALISTS` list the orchestrator iterates.

- [ ] **Step 17.5: Run to verify pass**

Run: `cd components/api && pytest tests/verdict_pipeline/test_stem_balance.py -v`
Expected: 2 passed.

- [ ] **Step 17.6: Commit**

```bash
git add components/api/prompts/experts/StemBalance.md \
        components/api/app/verdict_pipeline/specialists.py \
        components/api/app/verdict_pipeline/orchestrator.py \
        components/api/tests/verdict_pipeline/test_stem_balance.py
git commit -m "feat(verdicts): add StemBalance specialist gated on stem presence"
```

---

## Task 18: New verdict specialist — StemStereoWidth

**Files:**
- Create: `components/api/prompts/experts/StemStereoWidth.md`
- Modify: `components/api/app/verdict_pipeline/specialists.py` (add gate)
- Test: `components/api/tests/verdict_pipeline/test_stem_stereo_width.py`

- [ ] **Step 18.1: Write failing test**

Create `components/api/tests/verdict_pipeline/test_stem_stereo_width.py`:

```python
from unittest.mock import patch
from app.verdict_pipeline.orchestrator import run_specialist


def test_returns_verdict_when_a_stem_is_too_narrow():
    pr = {"phase4": {"stems": {"per_stem": {
        "pad": {"stereo_width": 0.05, "is_mono": False, "rms_db": -18.0,
                "lufs_integrated": -22.0},
        "vocals": {"stereo_width": 0.3, "is_mono": False, "rms_db": -16.0,
                   "lufs_integrated": -18.0},
    }, "status": "ok"}}}
    fake = {"verdicts": [{"slug": "pad-too-narrow", "title": "Pad too narrow",
                          "severity": "info", "prescription": "Widen the pad with stereo enhancer.",
                          "evidence": "stereo_width=0.05", "stem_role": "pad"}]}
    with patch("app.verdict_pipeline.orchestrator._call_llm", return_value=fake):
        verdicts = run_specialist("StemStereoWidth", pr)
    assert verdicts and verdicts[0]["slug"] == "pad-too-narrow"


def test_skipped_when_no_stems():
    with patch("app.verdict_pipeline.orchestrator._call_llm") as mock_llm:
        out = run_specialist("StemStereoWidth", {"phase4": {}})
    mock_llm.assert_not_called()
    assert out == []
```

- [ ] **Step 18.2: Run to verify failure**

Run: `cd components/api && pytest tests/verdict_pipeline/test_stem_stereo_width.py -v`
Expected: FAIL.

- [ ] **Step 18.3: Add prompt**

Create `components/api/prompts/experts/StemStereoWidth.md`:

```markdown
---
version: 1.0.0
slug: StemStereoWidth
requires: phase4.stems.status == "ok"
---

You are a stereo-imaging specialist. The user provided individual stems. Each has a `stereo_width` between 0.0 (fully mono) and 1.0 (fully wide) and an `is_mono` flag.

# Per-stem metrics
{{phase4.stems.per_stem | json}}

# Your job
Produce verdicts only for stems that are notably narrow (`stereo_width < 0.1`) when they should be wider, OR notably wide (`stereo_width > 0.8`) when their role is typically more mono. Roles that are typically mono: kick, snare, bass, vocals (lead). Roles that are typically wide: pad, lead, fx.

Output format:

```
{
  "verdicts": [
    {"slug": "...", "title": "...", "severity": "info"|"warning"|"critical",
     "prescription": "...", "evidence": "...", "stem_role": "..."}
  ]
}
```

Rules:
- One verdict per problematic stem; do not invent stems.
- A bass with width 0.05 is fine — do not flag.
- A pad with width 0.05 is bad — flag as warning.
- Empty list when no issues.
```

- [ ] **Step 18.4: Register gate**

Add to `SPECIALIST_GATES` in `specialists.py`:

```python
"StemStereoWidth": lambda r: bool(
    r.get("phase4", {}).get("stems", {}).get("per_stem")
),
```

Append `"StemStereoWidth"` to `ALL_SPECIALISTS`.

- [ ] **Step 18.5: Run to verify pass**

Run: `cd components/api && pytest tests/verdict_pipeline/test_stem_stereo_width.py -v`
Expected: 2 passed.

- [ ] **Step 18.6: Commit**

```bash
git add components/api/prompts/experts/StemStereoWidth.md \
        components/api/app/verdict_pipeline/specialists.py \
        components/api/tests/verdict_pipeline/test_stem_stereo_width.py
git commit -m "feat(verdicts): add StemStereoWidth specialist"
```

---

## Task 19: New verdict specialist — StemReferenceDelta

**Files:**
- Create: `components/api/prompts/experts/StemReferenceDelta.md`
- Modify: `components/api/app/verdict_pipeline/specialists.py` (add gate)
- Test: `components/api/tests/verdict_pipeline/test_stem_reference_delta.py`

- [ ] **Step 19.1: Write failing test**

Create `components/api/tests/verdict_pipeline/test_stem_reference_delta.py`:

```python
from unittest.mock import patch
from app.verdict_pipeline.orchestrator import run_specialist


def test_returns_verdicts_for_critical_deltas():
    pr = {"phase5": {"per_stem_reference_deltas": [
        {"role": "bass", "metric": "rms_db", "user_value": -6.0, "reference_value": -12.0,
         "delta": 6.0, "interpretation": "6.0 dB louder than reference",
         "severity_tier": "critical"},
        {"role": "vocals", "metric": "rms_db", "user_value": -16.0, "reference_value": -16.0,
         "delta": 0.0, "interpretation": "0.0 dB louder than reference",
         "severity_tier": "info"},
    ], "stem_reference_comparison": "ok"}}
    fake = {"verdicts": [{"slug": "bass-loud-vs-ref", "title": "Bass too loud vs. reference",
                          "severity": "critical", "prescription": "Reduce bass by 6 dB.",
                          "evidence": "rms_db delta +6.0 dB", "stem_role": "bass"}]}
    with patch("app.verdict_pipeline.orchestrator._call_llm", return_value=fake):
        verdicts = run_specialist("StemReferenceDelta", pr)
    assert verdicts[0]["slug"] == "bass-loud-vs-ref"


def test_skipped_when_unavailable():
    with patch("app.verdict_pipeline.orchestrator._call_llm") as mock_llm:
        out = run_specialist("StemReferenceDelta", {"phase5": {"stem_reference_comparison": "unavailable"}})
    mock_llm.assert_not_called()
    assert out == []
```

- [ ] **Step 19.2: Run to verify failure**

Run: `cd components/api && pytest tests/verdict_pipeline/test_stem_reference_delta.py -v`
Expected: FAIL.

- [ ] **Step 19.3: Add prompt**

Create `components/api/prompts/experts/StemReferenceDelta.md`:

```markdown
---
version: 1.0.0
slug: StemReferenceDelta
requires: phase5.stem_reference_comparison == "ok"
---

You are a reference-track comparison specialist. Below are per-stem deltas between the user's mix and a professional reference track.

# Deltas
{{phase5.per_stem_reference_deltas | json}}

# Your job
Produce one verdict per delta with `severity_tier` of `warning` or `critical`. Skip `info`-level deltas. Cite the metric and direction.

Output:

```
{
  "verdicts": [
    {"slug": "...", "title": "...", "severity": "warning"|"critical",
     "prescription": "<one sentence, named action>", "evidence": "<metric and delta>",
     "stem_role": "..."}
  ]
}
```

Rules:
- Severity must match the delta's `severity_tier`.
- Prescription names the stem and the corrective action ("Reduce bass by 6 dB").
- Empty list if all deltas are info-level.
```

- [ ] **Step 19.4: Register gate**

```python
"StemReferenceDelta": lambda r: r.get("phase5", {}).get("stem_reference_comparison") == "ok"
                                and bool(r.get("phase5", {}).get("per_stem_reference_deltas")),
```

Append `"StemReferenceDelta"` to `ALL_SPECIALISTS`.

- [ ] **Step 19.5: Run to verify pass**

Run: `cd components/api && pytest tests/verdict_pipeline/test_stem_reference_delta.py -v`
Expected: 2 passed.

- [ ] **Step 19.6: Commit**

```bash
git add components/api/prompts/experts/StemReferenceDelta.md \
        components/api/app/verdict_pipeline/specialists.py \
        components/api/tests/verdict_pipeline/test_stem_reference_delta.py
git commit -m "feat(verdicts): add StemReferenceDelta specialist"
```

---

## Task 20: Extend FrequencyCollisionDetection prompt

**Files:**
- Modify: `components/api/prompts/experts/FrequencyCollisionDetection.md`
- Test: `components/api/tests/verdict_pipeline/test_frequency_collision_extension.py`

- [ ] **Step 20.1: Write failing test**

Create `components/api/tests/verdict_pipeline/test_frequency_collision_extension.py`:

```python
from app.verdict_pipeline.prompt_loader import load_prompt


def test_prompt_contains_stem_clash_branch():
    _, body = load_prompt("FrequencyCollisionDetection")
    assert "stem_clash_matrix" in body
    assert "If stem data is present" in body or "if stem_clash_matrix is present" in body.lower()


def test_prompt_still_has_spectral_branch():
    _, body = load_prompt("FrequencyCollisionDetection")
    assert "spectral_clashes" in body or "spectral analysis" in body.lower()
```

- [ ] **Step 20.2: Run to verify failure**

Run: `cd components/api && pytest tests/verdict_pipeline/test_frequency_collision_extension.py -v`
Expected: FAIL on missing string.

- [ ] **Step 20.3: Edit prompt**

Open `components/api/prompts/experts/FrequencyCollisionDetection.md`. Below the existing instructions, add a new section near the bottom:

```markdown
# Stem-aware enhancement (when available)

If `phase4.stems.clash_matrix` is present, prefer it over `phase4.spectral_clashes` for clash findings — it identifies the *exact pair of stems* and band, not just spectral hot zones.

Per-stem clash data:
{{phase4.stems.clash_matrix | json | default: "[]"}}

When using stem clash data, name both stems in the verdict's prescription, e.g., "Sidechain the bass to the kick at 80 Hz" rather than "Address low-end buildup."

Fall back to the spectral analysis above when stem data is absent.
```

- [ ] **Step 20.4: Run to verify pass**

Run: `cd components/api && pytest tests/verdict_pipeline/test_frequency_collision_extension.py -v`
Expected: 2 passed.

- [ ] **Step 20.5: Commit**

```bash
git add components/api/prompts/experts/FrequencyCollisionDetection.md \
        components/api/tests/verdict_pipeline/test_frequency_collision_extension.py
git commit -m "feat(verdicts): teach FrequencyCollisionDetection to use stem_clash_matrix"
```

---

## Task 21: Extend FrequencyBalance prompt

**Files:**
- Modify: `components/api/prompts/experts/FrequencyBalance.md`
- Test: `components/api/tests/verdict_pipeline/test_frequency_balance_extension.py`

- [ ] **Step 21.1: Write failing test**

```python
# components/api/tests/verdict_pipeline/test_frequency_balance_extension.py
from app.verdict_pipeline.prompt_loader import load_prompt


def test_balance_prompt_contains_per_stem_branch():
    _, body = load_prompt("FrequencyBalance")
    assert "phase4.stems.per_stem" in body
```

- [ ] **Step 21.2: Run to verify failure**

Run: `cd components/api && pytest tests/verdict_pipeline/test_frequency_balance_extension.py -v`
Expected: FAIL.

- [ ] **Step 21.3: Edit prompt**

Append to `components/api/prompts/experts/FrequencyBalance.md`:

```markdown
# Stem-aware enhancement

When `phase4.stems.per_stem` is present, attribute imbalance findings to specific stems rather than the whole mix. For example, "the kick is dominating the sub-bass" beats "low end is heavy." Prescriptions should name the stem to adjust.

Per-stem band energies (dB):
{{phase4.stems.per_stem | json | default: "{}"}}
```

- [ ] **Step 21.4: Run to verify pass**

Run: `cd components/api && pytest tests/verdict_pipeline/test_frequency_balance_extension.py -v`
Expected: 1 passed.

- [ ] **Step 21.5: Commit**

```bash
git add components/api/prompts/experts/FrequencyBalance.md \
        components/api/tests/verdict_pipeline/test_frequency_balance_extension.py
git commit -m "feat(verdicts): teach FrequencyBalance to attribute findings to stems"
```

---

---

## ⛔ Tasks 22–29 and 34: DEFERRED to a follow-up plan

The actual frontend in this branch is `components/frontend-spectr/` — vanilla JavaScript (`.jsx`), React 18, **no TypeScript, no Tailwind, no shadcn/ui, no vitest, no Playwright**. The tasks below were drafted assuming a TS/Tailwind/shadcn/vitest/Playwright stack that doesn't exist here. They are kept for reference only and **must be rewritten** in a follow-up plan that:

1. Targets `components/frontend-spectr/src/components/*.jsx` directly (flat layout, no subdirs)
2. Drops TypeScript types — use `src/api/stems.js` matching the existing `src/api/<feature>.js` convention
3. Either scaffolds vitest + @testing-library OR drops the component-test steps
4. Either scaffolds Playwright OR replaces the E2E with a manual smoke checklist
5. Uses the existing styling primitives (`primitives.jsx`) instead of Tailwind classes

After backend tasks 1–21 + 30–33 + 35 land, write the follow-up plan as `docs/superpowers/plans/<date>-stems-frontend.md`.

---

## Task 22: Frontend types & API client

**Files:**
- Create: `components/frontend/src/types/stems.ts`
- Create: `components/frontend/src/lib/stemApi.ts`
- Test: `components/frontend/src/lib/__tests__/stemApi.test.ts`

- [ ] **Step 22.1: Add types**

Create `components/frontend/src/types/stems.ts`:

```typescript
export type StemRole =
  | "drums" | "kick" | "snare" | "hats"
  | "bass" | "vocals" | "lead" | "pad" | "fx" | "other";

export type FreqBand = "sub" | "bass" | "low_mid" | "mid" | "high_mid" | "presence" | "air";

export interface StemMappingProposal {
  file: string;
  proposed_role: StemRole;
  proposed_als_track: string | null;
  confidence: number;
}

export interface ConfirmedMapping {
  file: string;
  role: StemRole;
  als_track: string | null;
}

export interface UploadResponse {
  job_id: string;
  status: "PENDING" | "AWAITING_STEM_MAPPING";
  proposed_mapping?: StemMappingProposal[];
  als_track_names?: string[];
}

export interface StemMetrics {
  duration_s: number;
  peak_db: number;
  rms_db: number;
  lufs_integrated: number;
  dynamic_range_db: number;
  band_energy_db: Record<FreqBand, number>;
  spectral_centroid_hz: number;
  dominant_frequencies_hz: number[];
  stereo_width: number;
  pan_estimate: number;
  is_mono: boolean;
}

export interface StemClash {
  stem_a: StemRole;
  stem_b: StemRole;
  band: FreqBand;
  overlap_severity: number;
  severity_tier: "info" | "warning" | "critical";
}

export interface StemReferenceDelta {
  role: StemRole;
  metric: string;
  user_value: number;
  reference_value: number;
  delta: number;
  interpretation: string;
  severity_tier: "info" | "warning" | "critical";
}
```

- [ ] **Step 22.2: Add API client**

Create `components/frontend/src/lib/stemApi.ts`:

```typescript
import type { ConfirmedMapping, UploadResponse } from "@/types/stems";
import { apiFetch } from "./api";

export async function confirmStemMapping(
  jobId: string, mappings: ConfirmedMapping[],
): Promise<{ job_id: string; status: "PENDING" }> {
  return apiFetch(`/uploads/${jobId}/stems/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mappings }),
  });
}

export async function getJobStatus(jobId: string): Promise<UploadResponse & { status: string }> {
  return apiFetch(`/uploads/${jobId}`);
}
```

- [ ] **Step 22.3: Smoke test**

Create `components/frontend/src/lib/__tests__/stemApi.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { confirmStemMapping } from "../stemApi";

vi.mock("../api", () => ({
  apiFetch: vi.fn().mockResolvedValue({ job_id: "j1", status: "PENDING" }),
}));

describe("confirmStemMapping", () => {
  it("posts mappings to confirm endpoint", async () => {
    const result = await confirmStemMapping("j1", [
      { file: "01_Kick.flac", role: "drums", als_track: "Kick" },
    ]);
    expect(result.status).toBe("PENDING");
  });
});
```

Run: `cd components/frontend && npm run test -- src/lib/__tests__/stemApi.test.ts`
Expected: 1 passed.

- [ ] **Step 22.4: Commit**

```bash
git add components/frontend/src/types/stems.ts \
        components/frontend/src/lib/stemApi.ts \
        components/frontend/src/lib/__tests__/stemApi.test.ts
git commit -m "feat(frontend): add stem types and API client"
```

---

## Task 23: StemUploader component

**Files:**
- Create: `components/frontend/src/components/upload/StemUploader.tsx`
- Test: `components/frontend/src/components/upload/__tests__/StemUploader.test.tsx`

- [ ] **Step 23.1: Write failing test**

Create `components/frontend/src/components/upload/__tests__/StemUploader.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StemUploader } from "../StemUploader";

function _file(name: string, sizeMB = 1, type = "audio/flac"): File {
  const bytes = new Uint8Array(sizeMB * 1024 * 1024);
  return new File([bytes], name, { type });
}

describe("StemUploader", () => {
  it("emits selected files to onChange", () => {
    const onChange = vi.fn();
    render(<StemUploader onChange={onChange} />);
    const input = screen.getByLabelText(/stems/i);
    fireEvent.change(input, { target: { files: [_file("kick.flac"), _file("bass.flac")] } });
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: "kick.flac" }),
      expect.objectContaining({ name: "bass.flac" }),
    ]));
  });

  it("rejects more than 16 files", () => {
    const onError = vi.fn();
    render(<StemUploader onChange={vi.fn()} onError={onError} />);
    const files = Array.from({ length: 17 }, (_, i) => _file(`s${i}.flac`));
    fireEvent.change(screen.getByLabelText(/stems/i), { target: { files } });
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/16/));
  });

  it("rejects mp3 files", () => {
    const onError = vi.fn();
    render(<StemUploader onChange={vi.fn()} onError={onError} />);
    fireEvent.change(screen.getByLabelText(/stems/i), {
      target: { files: [_file("kick.mp3", 1, "audio/mpeg")] },
    });
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/FLAC|WAV/i));
  });
});
```

- [ ] **Step 23.2: Run to verify failure**

Run: `cd components/frontend && npm run test -- src/components/upload/__tests__/StemUploader.test.tsx`
Expected: FAIL.

- [ ] **Step 23.3: Implement component**

Create `components/frontend/src/components/upload/StemUploader.tsx`:

```typescript
import { useRef } from "react";

interface Props {
  onChange: (files: File[]) => void;
  onError?: (msg: string) => void;
}

const ACCEPTED_EXTENSIONS = [".flac", ".wav"];
const MAX_FILES = 16;
const MAX_PER_FILE_MB = 100;
const MAX_TOTAL_MB = 1024;

export function StemUploader({ onChange, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList);
    if (files.length > MAX_FILES) {
      onError?.(`Maximum 16 stem files (you selected ${files.length}).`);
      return;
    }
    for (const f of files) {
      const lower = f.name.toLowerCase();
      if (!ACCEPTED_EXTENSIONS.some(ext => lower.endsWith(ext))) {
        onError?.(`${f.name}: only FLAC and WAV stems are supported.`);
        return;
      }
      if (f.size > MAX_PER_FILE_MB * 1024 * 1024) {
        onError?.(`${f.name}: exceeds ${MAX_PER_FILE_MB} MB.`);
        return;
      }
    }
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total > MAX_TOTAL_MB * 1024 * 1024) {
      onError?.(`Total stem size exceeds ${MAX_TOTAL_MB} MB.`);
      return;
    }
    onChange(files);
  }

  return (
    <div className="border-2 border-dashed rounded-lg p-6 text-center hover:bg-muted/30 transition">
      <label className="cursor-pointer block">
        <span className="text-sm font-medium">Stems (optional)</span>
        <p className="text-xs text-muted-foreground mt-1">
          Drop 1–16 FLAC or WAV stems. Max 100 MB each, 1 GB total.
        </p>
        <input
          ref={inputRef}
          type="file"
          aria-label="stems"
          multiple
          accept=".flac,.wav,audio/flac,audio/wav,audio/x-wav"
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          type="button"
          className="mt-3 inline-flex items-center px-3 py-1.5 text-sm border rounded"
          onClick={() => inputRef.current?.click()}
        >
          Choose stems
        </button>
      </label>
    </div>
  );
}
```

- [ ] **Step 23.4: Run to verify pass**

Run: `cd components/frontend && npm run test -- src/components/upload/__tests__/StemUploader.test.tsx`
Expected: 3 passed.

- [ ] **Step 23.5: Commit**

```bash
git add components/frontend/src/components/upload/StemUploader.tsx \
        components/frontend/src/components/upload/__tests__/StemUploader.test.tsx
git commit -m "feat(frontend): add StemUploader drag-drop component"
```

---

## Task 24: StemMappingTable component

**Files:**
- Create: `components/frontend/src/components/upload/StemMappingTable.tsx`
- Test: `components/frontend/src/components/upload/__tests__/StemMappingTable.test.tsx`

- [ ] **Step 24.1: Write failing test**

```typescript
// components/frontend/src/components/upload/__tests__/StemMappingTable.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StemMappingTable } from "../StemMappingTable";
import type { StemMappingProposal } from "@/types/stems";

const proposals: StemMappingProposal[] = [
  { file: "01_Kick.flac", proposed_role: "drums", proposed_als_track: "Kick", confidence: 0.9 },
  { file: "02_Bass.flac", proposed_role: "bass",  proposed_als_track: "Bass", confidence: 0.9 },
];

describe("StemMappingTable", () => {
  it("pre-fills role dropdowns from proposals", () => {
    render(<StemMappingTable proposals={proposals} alsTrackNames={["Kick","Bass"]} onConfirm={vi.fn()} />);
    expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("drums");
    expect((screen.getAllByRole("combobox")[2] as HTMLSelectElement).value).toBe("bass");
  });

  it("disables confirm when duplicate role selected", () => {
    render(<StemMappingTable proposals={proposals} alsTrackNames={[]} onConfirm={vi.fn()} />);
    const dropdowns = screen.getAllByRole("combobox");
    fireEvent.change(dropdowns[2], { target: { value: "drums" } });
    expect(screen.getByRole("button", { name: /looks right/i })).toBeDisabled();
    expect(screen.getByText(/duplicate role/i)).toBeInTheDocument();
  });

  it("calls onConfirm with the selected mappings", () => {
    const onConfirm = vi.fn();
    render(<StemMappingTable proposals={proposals} alsTrackNames={["Kick","Bass"]} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /looks right/i }));
    expect(onConfirm).toHaveBeenCalledWith([
      { file: "01_Kick.flac", role: "drums", als_track: "Kick" },
      { file: "02_Bass.flac", role: "bass",  als_track: "Bass" },
    ]);
  });
});
```

- [ ] **Step 24.2: Run to verify failure**

Run: `cd components/frontend && npm run test -- src/components/upload/__tests__/StemMappingTable.test.tsx`
Expected: FAIL.

- [ ] **Step 24.3: Implement component**

Create `components/frontend/src/components/upload/StemMappingTable.tsx`:

```typescript
import { useMemo, useState } from "react";
import type { ConfirmedMapping, StemMappingProposal, StemRole } from "@/types/stems";

const ALL_ROLES: StemRole[] = [
  "drums","kick","snare","hats","bass","vocals","lead","pad","fx","other",
];

interface Props {
  proposals: StemMappingProposal[];
  alsTrackNames: string[];
  onConfirm: (mappings: ConfirmedMapping[]) => void;
}

interface Row {
  file: string;
  role: StemRole;
  als_track: string | null;
}

export function StemMappingTable({ proposals, alsTrackNames, onConfirm }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    proposals.map(p => ({
      file: p.file,
      role: p.proposed_role,
      als_track: p.proposed_als_track,
    })),
  );

  const duplicateRoles = useMemo(() => {
    const counts = new Map<StemRole, number>();
    rows.forEach(r => counts.set(r.role, (counts.get(r.role) ?? 0) + 1));
    return [...counts.entries()].filter(([, c]) => c > 1).map(([r]) => r);
  }, [rows]);

  const isValid = duplicateRoles.length === 0 && rows.every(r => r.role);

  function update(i: number, patch: Partial<Row>) {
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead className="text-left">
          <tr><th>File</th><th>Role</th>{alsTrackNames.length > 0 && <th>.als Track</th>}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.file} className={duplicateRoles.includes(r.role) ? "border-l-2 border-destructive" : ""}>
              <td className="py-1 pr-3">{r.file}</td>
              <td className="py-1 pr-3">
                <select
                  className="border rounded px-2 py-1"
                  value={r.role}
                  onChange={e => update(i, { role: e.target.value as StemRole })}
                >
                  {ALL_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                </select>
              </td>
              {alsTrackNames.length > 0 && (
                <td className="py-1">
                  <select
                    className="border rounded px-2 py-1"
                    value={r.als_track ?? ""}
                    onChange={e => update(i, { als_track: e.target.value || null })}
                  >
                    <option value="">— none —</option>
                    {alsTrackNames.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {duplicateRoles.length > 0 && (
        <p className="text-sm text-destructive">Duplicate role: {duplicateRoles.join(", ")}</p>
      )}
      <button
        type="button"
        className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50"
        disabled={!isValid}
        onClick={() => onConfirm(rows)}
      >
        Looks right
      </button>
    </div>
  );
}
```

- [ ] **Step 24.4: Run to verify pass**

Run: `cd components/frontend && npm run test -- src/components/upload/__tests__/StemMappingTable.test.tsx`
Expected: 3 passed.

- [ ] **Step 24.5: Commit**

```bash
git add components/frontend/src/components/upload/StemMappingTable.tsx \
        components/frontend/src/components/upload/__tests__/StemMappingTable.test.tsx
git commit -m "feat(frontend): add StemMappingTable confirmation component"
```

---

## Task 25: Wire UploadPage

**Files:**
- Modify: `components/frontend/src/pages/UploadPage.tsx`

- [ ] **Step 25.1: Wire StemUploader and StemMappingTable into UploadPage**

In `components/frontend/src/pages/UploadPage.tsx`:

1. Import `StemUploader`, `StemMappingTable`, `confirmStemMapping`.
2. Add state: `const [stems, setStems] = useState<File[]>([]);`
3. Add `<StemUploader onChange={setStems} onError={setStemError} />` below existing reference upload.
4. Modify the submit handler to append `stems` to the FormData: `stems.forEach(f => fd.append("stems", f));`
5. After upload returns, if response status is `AWAITING_STEM_MAPPING`, render `<StemMappingTable proposals={response.proposed_mapping!} alsTrackNames={response.als_track_names ?? []} onConfirm={async (mappings) => { await confirmStemMapping(response.job_id, mappings); navigate(\`/jobs/\${response.job_id}\`); }} />` instead of the usual "view job" redirect.

Use the existing patterns in the file for state, FormData, navigation. No new test for this task — covered by the Playwright E2E in Task 30.

- [ ] **Step 25.2: Manual smoke test**

Start dev stack: `./start-dev.ps1`. Open http://localhost:5173, log in, drop a mix + 4 dummy FLAC stems, confirm the mapping screen appears. No test command — visual confirmation.

- [ ] **Step 25.3: Commit**

```bash
git add components/frontend/src/pages/UploadPage.tsx
git commit -m "feat(frontend): wire stem upload and mapping confirmation into UploadPage"
```

---

## Task 26: Per-Stem Balance card

**Files:**
- Create: `components/frontend/src/components/report/PerStemBalanceCard.tsx`
- Test: `components/frontend/src/components/report/__tests__/PerStemBalanceCard.test.tsx`

- [ ] **Step 26.1: Write failing test**

```typescript
// components/frontend/src/components/report/__tests__/PerStemBalanceCard.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PerStemBalanceCard } from "../PerStemBalanceCard";

describe("PerStemBalanceCard", () => {
  it("renders nothing when no stem metrics", () => {
    const { container } = render(<PerStemBalanceCard perStem={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per stem with band cells", () => {
    render(<PerStemBalanceCard perStem={{
      bass: { rms_db: -10, lufs_integrated: -14, stereo_width: 0.1, is_mono: false,
              band_energy_db: { sub: -8, bass: -6, low_mid: -12, mid: -18,
                                high_mid: -22, presence: -28, air: -32 } } as any,
    }} />);
    expect(screen.getByText("bass")).toBeInTheDocument();
    expect(screen.getByText(/-10/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 26.2: Run to verify failure**

Run: `cd components/frontend && npm run test -- src/components/report/__tests__/PerStemBalanceCard.test.tsx`
Expected: FAIL.

- [ ] **Step 26.3: Implement card**

Create `components/frontend/src/components/report/PerStemBalanceCard.tsx`:

```typescript
import type { FreqBand, StemMetrics, StemRole } from "@/types/stems";

const BANDS: FreqBand[] = ["sub", "bass", "low_mid", "mid", "high_mid", "presence", "air"];

interface Props {
  perStem: Partial<Record<StemRole, StemMetrics>>;
}

function bandColor(db: number): string {
  // Red for hot (>-6), green for moderate (-6 to -18), blue for low (<-18)
  if (db > -6) return "bg-red-200";
  if (db > -18) return "bg-green-200";
  return "bg-blue-200";
}

export function PerStemBalanceCard({ perStem }: Props) {
  const roles = Object.keys(perStem) as StemRole[];
  if (roles.length === 0) return null;
  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-base font-semibold mb-3">Per-Stem Balance</h3>
      <table className="w-full text-xs">
        <thead>
          <tr><th className="text-left">Stem</th><th>RMS</th>{BANDS.map(b => <th key={b}>{b}</th>)}</tr>
        </thead>
        <tbody>
          {roles.map(role => {
            const m = perStem[role]!;
            return (
              <tr key={role}>
                <td className="font-medium">{role}</td>
                <td>{m.rms_db.toFixed(1)} dB</td>
                {BANDS.map(b => (
                  <td key={b} className={`text-center ${bandColor(m.band_energy_db[b])}`}>
                    {m.band_energy_db[b].toFixed(0)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 26.4: Run to verify pass**

Run: `cd components/frontend && npm run test -- src/components/report/__tests__/PerStemBalanceCard.test.tsx`
Expected: 2 passed.

- [ ] **Step 26.5: Commit**

```bash
git add components/frontend/src/components/report/PerStemBalanceCard.tsx \
        components/frontend/src/components/report/__tests__/PerStemBalanceCard.test.tsx
git commit -m "feat(frontend): add PerStemBalanceCard"
```

---

## Task 27: StemClashMatrixCard

**Files:**
- Create: `components/frontend/src/components/report/StemClashMatrixCard.tsx`
- Test: `components/frontend/src/components/report/__tests__/StemClashMatrixCard.test.tsx`

- [ ] **Step 27.1: Write failing test**

```typescript
// __tests__/StemClashMatrixCard.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StemClashMatrixCard } from "../StemClashMatrixCard";

describe("StemClashMatrixCard", () => {
  it("renders nothing when no clashes", () => {
    const { container } = render(<StemClashMatrixCard clashes={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("groups clashes by stem pair", () => {
    render(<StemClashMatrixCard clashes={[
      { stem_a: "kick", stem_b: "bass", band: "sub", overlap_severity: 0.8, severity_tier: "critical" },
      { stem_a: "kick", stem_b: "bass", band: "bass", overlap_severity: 0.6, severity_tier: "warning" },
    ]} />);
    expect(screen.getByText(/kick.*bass/)).toBeInTheDocument();
    expect(screen.getByText(/critical/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 27.2: Run to verify failure**

Run: `cd components/frontend && npm run test -- src/components/report/__tests__/StemClashMatrixCard.test.tsx`
Expected: FAIL.

- [ ] **Step 27.3: Implement**

Create `components/frontend/src/components/report/StemClashMatrixCard.tsx`:

```typescript
import type { StemClash } from "@/types/stems";

interface Props { clashes: StemClash[]; }

const TIER_BG: Record<StemClash["severity_tier"], string> = {
  info: "bg-yellow-50", warning: "bg-orange-100", critical: "bg-red-100",
};

export function StemClashMatrixCard({ clashes }: Props) {
  if (clashes.length === 0) return null;
  // Group by pair
  const byPair = new Map<string, StemClash[]>();
  for (const c of clashes) {
    const key = [c.stem_a, c.stem_b].sort().join(" × ");
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push(c);
  }
  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-base font-semibold mb-3">Stem Clash Matrix</h3>
      <ul className="space-y-2">
        {[...byPair.entries()].map(([pair, list]) => {
          const worst = list.reduce((a, b) => (a.overlap_severity > b.overlap_severity ? a : b));
          return (
            <li key={pair} className={`p-2 rounded ${TIER_BG[worst.severity_tier]}`}>
              <div className="text-sm font-medium">{pair}</div>
              <div className="text-xs text-muted-foreground">
                {list.map(c => `${c.band} (${(c.overlap_severity * 100).toFixed(0)}% overlap, ${c.severity_tier})`).join(" · ")}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 27.4: Run to verify pass**

Run: `cd components/frontend && npm run test -- src/components/report/__tests__/StemClashMatrixCard.test.tsx`
Expected: 2 passed.

- [ ] **Step 27.5: Commit**

```bash
git add components/frontend/src/components/report/StemClashMatrixCard.tsx \
        components/frontend/src/components/report/__tests__/StemClashMatrixCard.test.tsx
git commit -m "feat(frontend): add StemClashMatrixCard"
```

---

## Task 28: StemReferenceDeltasCard

**Files:**
- Create: `components/frontend/src/components/report/StemReferenceDeltasCard.tsx`
- Test: `components/frontend/src/components/report/__tests__/StemReferenceDeltasCard.test.tsx`

- [ ] **Step 28.1: Write failing test**

```typescript
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StemReferenceDeltasCard } from "../StemReferenceDeltasCard";

describe("StemReferenceDeltasCard", () => {
  it("renders nothing when no deltas", () => {
    const { container } = render(<StemReferenceDeltasCard deltas={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders only warning+critical deltas", () => {
    render(<StemReferenceDeltasCard deltas={[
      { role: "bass", metric: "rms_db", user_value: -6, reference_value: -12, delta: 6,
        interpretation: "6.0 dB louder than reference", severity_tier: "critical" },
      { role: "vocals", metric: "rms_db", user_value: -16, reference_value: -16, delta: 0,
        interpretation: "0.0 dB louder than reference", severity_tier: "info" },
    ]} />);
    expect(screen.getByText(/6.0 dB louder/)).toBeInTheDocument();
    expect(screen.queryByText(/0.0 dB louder/)).toBeNull();
  });
});
```

- [ ] **Step 28.2: Run to verify failure**

Run: `cd components/frontend && npm run test -- src/components/report/__tests__/StemReferenceDeltasCard.test.tsx`
Expected: FAIL.

- [ ] **Step 28.3: Implement**

Create `components/frontend/src/components/report/StemReferenceDeltasCard.tsx`:

```typescript
import type { StemReferenceDelta } from "@/types/stems";

const TIER_BG = { info: "bg-yellow-50", warning: "bg-orange-100", critical: "bg-red-100" } as const;

export function StemReferenceDeltasCard({ deltas }: { deltas: StemReferenceDelta[] }) {
  const visible = deltas.filter(d => d.severity_tier !== "info");
  if (visible.length === 0) return null;
  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-base font-semibold mb-3">Stem vs. Reference</h3>
      <ul className="space-y-2">
        {visible.map((d, i) => (
          <li key={i} className={`p-2 rounded text-sm ${TIER_BG[d.severity_tier]}`}>
            <span className="font-medium capitalize">{d.role}</span>
            {" — "}
            <span className="text-xs text-muted-foreground">{d.metric}</span>
            {": "}
            <span>{d.interpretation}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 28.4: Run to verify pass**

Run: `cd components/frontend && npm run test -- src/components/report/__tests__/StemReferenceDeltasCard.test.tsx`
Expected: 2 passed.

- [ ] **Step 28.5: Commit**

```bash
git add components/frontend/src/components/report/StemReferenceDeltasCard.tsx \
        components/frontend/src/components/report/__tests__/StemReferenceDeltasCard.test.tsx
git commit -m "feat(frontend): add StemReferenceDeltasCard"
```

---

## Task 29: Wire ReportPage with stem cards

**Files:**
- Modify: `components/frontend/src/pages/ReportPage.tsx`

- [ ] **Step 29.1: Render the three cards when data present**

In `components/frontend/src/pages/ReportPage.tsx`, locate the section where existing cards (FrequencyChart, StemClash table) render. Add:

```typescript
import { PerStemBalanceCard } from "@/components/report/PerStemBalanceCard";
import { StemClashMatrixCard } from "@/components/report/StemClashMatrixCard";
import { StemReferenceDeltasCard } from "@/components/report/StemReferenceDeltasCard";
```

In the JSX body, after the existing per-mix sections:

```tsx
{report.phase_results?.phase4?.stems?.status === "ok" && (
  <>
    <PerStemBalanceCard perStem={report.phase_results.phase4.stems.per_stem} />
    <StemClashMatrixCard clashes={report.phase_results.phase4.stems.clash_matrix ?? []} />
  </>
)}
{report.phase_results?.phase5?.stem_reference_comparison === "ok" && (
  <StemReferenceDeltasCard deltas={report.phase_results.phase5.per_stem_reference_deltas ?? []} />
)}
{report.phase_results?.phase4?.stems?.status === "failed" && (
  <p className="text-xs text-muted-foreground">Stems couldn't be analyzed for this run.</p>
)}
```

If only some stems analyzed (orchestrator records partial via `stems.partial: true`), show the subdued note:
```tsx
{report.phase_results?.phase4?.stems?.partial && (
  <p className="text-xs text-muted-foreground">
    Some stems couldn't be analyzed; showing successful ones.
  </p>
)}
```

- [ ] **Step 29.2: Manual smoke test**

Run a job through the dev stack with stems. Confirm the three cards render and the existing cards are unaffected.

- [ ] **Step 29.3: Commit**

```bash
git add components/frontend/src/pages/ReportPage.tsx
git commit -m "feat(frontend): render stem cards on ReportPage when data present"
```

---

---

## ⛔ End of deferred frontend tasks. Backend execution resumes at Task 30.

---

## Task 30: Pre-Demucs CLI for curated reference library

**Files:**
- Create: `components/analysis/src/audio_analysis/reference_library/__init__.py`
- Create: `components/analysis/src/audio_analysis/reference_library/pre_demucs.py`
- Test: `components/analysis/tests/reference_library/test_pre_demucs.py`

- [ ] **Step 30.1: Create package marker**

```bash
mkdir -p components/analysis/src/audio_analysis/reference_library
touch components/analysis/src/audio_analysis/reference_library/__init__.py
mkdir -p components/analysis/tests/reference_library
touch components/analysis/tests/reference_library/__init__.py
```

- [ ] **Step 30.2: Write failing test (Demucs mocked)**

Create `components/analysis/tests/reference_library/test_pre_demucs.py`:

```python
from pathlib import Path
from unittest.mock import patch

from audio_analysis.reference_library.pre_demucs import process_reference_library


def test_skips_when_cache_is_newer(tmp_path: Path):
    src = tmp_path / "lib" / "track1.wav"
    src.parent.mkdir()
    src.write_bytes(b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 100)
    cache = tmp_path / "cache" / "track1.stems.json"
    cache.parent.mkdir()
    cache.write_text("{}")
    # Make cache newer than source
    import os, time
    os.utime(cache, (time.time(), time.time()))
    with patch("audio_analysis.reference_library.pre_demucs._run_demucs") as mock_demucs:
        process_reference_library(library_dir=src.parent, cache_dir=cache.parent)
    mock_demucs.assert_not_called()


def test_processes_when_cache_missing(tmp_path: Path):
    src = tmp_path / "lib" / "track1.wav"
    src.parent.mkdir()
    src.write_bytes(b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 100)
    cache = tmp_path / "cache"
    cache.mkdir()
    with patch("audio_analysis.reference_library.pre_demucs._run_demucs",
               return_value={"bass": tmp_path / "bass.wav"}) as mock_demucs, \
         patch("audio_analysis.reference_library.pre_demucs._analyze_stems",
               return_value={"per_stem": {}, "clash_matrix": [], "balance_flags": []}):
        process_reference_library(library_dir=src.parent, cache_dir=cache)
    mock_demucs.assert_called_once_with(src)
    assert (cache / "track1.stems.json").exists()
```

- [ ] **Step 30.3: Run to verify failure**

Run: `cd components/analysis && pytest tests/reference_library/test_pre_demucs.py -v`
Expected: FAIL.

- [ ] **Step 30.4: Implement**

Create `components/analysis/src/audio_analysis/reference_library/pre_demucs.py`:

```python
"""Offline CLI: run Demucs on each curated reference and cache stem analytics.

Usage:
    python -m audio_analysis.reference_library.pre_demucs \\
        --library data/reference_library/ \\
        --out     data/reference_library/_stems_cache/ \\
        [--track <id>]
"""
import argparse
import json
from pathlib import Path

from audio_analysis.stems import analyze
from audio_analysis.stems.types import StemRole


SUPPORTED_EXT = {".wav", ".flac", ".mp3"}


def _run_demucs(src: Path) -> dict[StemRole, Path]:
    """Invoke Demucs and return {role: separated_stem_path}.

    Lazily imports demucs so non-pre-Demucs code doesn't pay the cost.
    """
    import torch
    from demucs.apply import apply_model
    from demucs.audio import AudioFile, save_audio
    from demucs.pretrained import get_model

    model = get_model("htdemucs")
    model.cpu().eval()
    wav = AudioFile(src).read(streams=0, samplerate=model.samplerate, channels=model.audio_channels)
    sources = apply_model(model, wav[None], device="cpu")[0]
    out_dir = src.parent / f"_demucs_{src.stem}"
    out_dir.mkdir(exist_ok=True)
    paths: dict[StemRole, Path] = {}
    for name, audio in zip(model.sources, sources):
        role = {"vocals": StemRole.VOCALS, "drums": StemRole.DRUMS,
                "bass": StemRole.BASS, "other": StemRole.OTHER}.get(name, StemRole.OTHER)
        out_path = out_dir / f"{name}.wav"
        save_audio(audio, out_path, samplerate=model.samplerate)
        paths[role] = out_path
    return paths


def _analyze_stems(stem_paths: dict[StemRole, Path]) -> dict:
    result = analyze(stem_paths)
    return {
        "per_stem": {
            role.value: {
                "duration_s": m.duration_s,
                "peak_db": m.peak_db, "rms_db": m.rms_db,
                "lufs_integrated": m.lufs_integrated,
                "dynamic_range_db": m.dynamic_range_db,
                "band_energy_db": {b.value: v for b, v in m.band_energy_db.items()},
                "spectral_centroid_hz": m.spectral_centroid_hz,
                "dominant_frequencies_hz": m.dominant_frequencies_hz,
                "stereo_width": m.stereo_width,
                "pan_estimate": m.pan_estimate,
                "is_mono": m.is_mono,
            }
            for role, m in result.per_stem.items()
        },
        "clash_matrix": [
            {
                "stem_a": c.stem_a.value, "stem_b": c.stem_b.value,
                "band": c.band.value, "overlap_severity": c.overlap_severity,
                "severity_tier": c.severity_tier,
            }
            for c in result.clash_matrix
        ],
        "balance_flags": [],  # genre-agnostic at library-build time
    }


def process_reference_library(
    library_dir: Path, cache_dir: Path, only: str | None = None,
) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    sources = [p for p in library_dir.iterdir() if p.suffix.lower() in SUPPORTED_EXT]
    if only:
        sources = [p for p in sources if p.stem == only]
    for src in sources:
        cache_path = cache_dir / f"{src.stem}.stems.json"
        if cache_path.exists() and cache_path.stat().st_mtime >= src.stat().st_mtime:
            print(f"skip: {src.name} (cache fresh)")
            continue
        print(f"demucs: {src.name}")
        stem_paths = _run_demucs(src)
        print(f"analyze: {src.name}")
        payload = _analyze_stems(stem_paths)
        cache_path.write_text(json.dumps(payload, indent=2))
        print(f"wrote: {cache_path}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--library", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--track", type=str, default=None)
    args = p.parse_args()
    process_reference_library(args.library, args.out, only=args.track)


if __name__ == "__main__":
    main()
```

- [ ] **Step 30.5: Run to verify pass**

Run: `cd components/analysis && pytest tests/reference_library/test_pre_demucs.py -v`
Expected: 2 passed.

- [ ] **Step 30.6: Commit**

```bash
git add components/analysis/src/audio_analysis/reference_library/__init__.py \
        components/analysis/src/audio_analysis/reference_library/pre_demucs.py \
        components/analysis/tests/reference_library/__init__.py \
        components/analysis/tests/reference_library/test_pre_demucs.py
git commit -m "feat(reference-library): add pre_demucs CLI for offline stem caching"
```

---

## Task 31: Phase 5 cache-hit path for curated references

**Files:**
- Modify: `components/analysis/src/audio_analysis/phases/phase5_reference.py`
- Test: `components/analysis/tests/phases/test_phase5_cache_hit.py`

- [ ] **Step 31.1: Write failing test**

```python
# components/analysis/tests/phases/test_phase5_cache_hit.py
import json
from pathlib import Path

from audio_analysis.phases import phase5_reference
from audio_analysis.stems.types import StemRole


def test_phase5_uses_cached_reference_stems_when_user_has_stems(tmp_path: Path, synth_stem_files):
    cache_dir = tmp_path / "_stems_cache"
    cache_dir.mkdir()
    cache = cache_dir / "ref_track.stems.json"
    cache.write_text(json.dumps({
        "per_stem": {"bass": {"duration_s": 8.0, "peak_db": -6, "rms_db": -12,
                              "lufs_integrated": -14, "dynamic_range_db": 6,
                              "band_energy_db": {"sub": -10,"bass": -8,"low_mid": -14,
                                                  "mid": -20,"high_mid": -22,
                                                  "presence": -28,"air": -32},
                              "spectral_centroid_hz": 200, "dominant_frequencies_hz": [110],
                              "stereo_width": 0.2, "pan_estimate": 0.0, "is_mono": False}},
        "clash_matrix": [], "balance_flags": [],
    }))
    user_stems = {StemRole(r): p for r, p in synth_stem_files.items()}
    result = phase5_reference.run(
        user_audio_path=Path("u.wav"),
        reference_audio_path=Path("ref_track.wav"),
        user_stem_paths=user_stems,
        reference_stem_paths=None,
        reference_cache_dir=cache_dir,
        reference_id="ref_track",
    )
    assert result["stem_reference_comparison"] == "ok"
    assert any(d["role"] == "bass" for d in result["per_stem_reference_deltas"])
```

- [ ] **Step 31.2: Run to verify failure**

Run: `cd components/analysis && pytest tests/phases/test_phase5_cache_hit.py -v`
Expected: FAIL.

- [ ] **Step 31.3: Implement cache load**

In `phase5_reference.run`, add params `reference_cache_dir: Path | None = None, reference_id: str | None = None`. Before the existing `if user_stem_paths and reference_stem_paths:` block, add:

```python
if user_stem_paths and not reference_stem_paths and reference_cache_dir and reference_id:
    cache_path = reference_cache_dir / f"{reference_id}.stems.json"
    if cache_path.exists():
        from audio_analysis.stems import analyze, compare
        from audio_analysis.stems.types import (
            FreqBand, StemAnalysisResult, StemMetrics, StemRole,
        )
        import json
        cached = json.loads(cache_path.read_text())
        ref_per_stem: dict[StemRole, StemMetrics] = {}
        for role_str, m in cached["per_stem"].items():
            ref_per_stem[StemRole(role_str)] = StemMetrics(
                role=StemRole(role_str),
                duration_s=m["duration_s"], peak_db=m["peak_db"], rms_db=m["rms_db"],
                lufs_integrated=m["lufs_integrated"], dynamic_range_db=m["dynamic_range_db"],
                band_energy_db={FreqBand(b): v for b, v in m["band_energy_db"].items()},
                spectral_centroid_hz=m["spectral_centroid_hz"],
                dominant_frequencies_hz=m["dominant_frequencies_hz"],
                stereo_width=m["stereo_width"], pan_estimate=m["pan_estimate"],
                is_mono=m["is_mono"],
            )
        ref_result = StemAnalysisResult(per_stem=ref_per_stem)
        user_result = analyze({StemRole(r) if isinstance(r, str) else r: p
                               for r, p in user_stem_paths.items()})
        deltas = compare(user_result, ref_result)
        result["per_stem_reference_deltas"] = [
            {"role": d.role.value, "metric": d.metric, "user_value": d.user_value,
             "reference_value": d.reference_value, "delta": d.delta,
             "interpretation": d.interpretation, "severity_tier": d.severity_tier}
            for d in deltas
        ]
        result["stem_reference_comparison"] = "ok"
```

In `pipeline.py`, also forward `reference_cache_dir` and `reference_id` (parsed from the reference path or job metadata) to `phase5_reference.run`.

- [ ] **Step 31.4: Run to verify pass**

Run: `cd components/analysis && pytest tests/phases/test_phase5_cache_hit.py -v`
Expected: 1 passed.

- [ ] **Step 31.5: Commit**

```bash
git add components/analysis/src/audio_analysis/phases/phase5_reference.py \
        components/analysis/src/audio_analysis/pipeline.py \
        components/analysis/tests/phases/test_phase5_cache_hit.py
git commit -m "feat(phase5): use pre-Demucs cache for curated reference comparison"
```

---

## Task 32: Snapshot tests (regression guard)

**Files:**
- Create: `components/analysis/tests/integration/test_pipeline_with_stems.py`
- Create: `components/analysis/tests/integration/golden_with_stems.json` (generated)
- Create: `components/analysis/tests/integration/golden_no_stems.json` (generated)

- [ ] **Step 32.1: Write the snapshot harness**

Create `components/analysis/tests/integration/test_pipeline_with_stems.py`:

```python
import json
from pathlib import Path

import pytest

from audio_analysis.pipeline import run_analysis_pipeline
from audio_analysis.stems.types import StemRole

GOLDEN_DIR = Path(__file__).parent
UPDATE = bool(__import__("os").environ.get("UPDATE_SNAPSHOTS"))


def _normalize(d: dict) -> dict:
    """Drop fields that vary run-to-run (timestamps, abs paths, floats > 4 dp)."""
    import copy, re
    out = copy.deepcopy(d)
    def walk(x):
        if isinstance(x, dict):
            for k in list(x):
                if k in ("timestamp", "duration_ms", "task_id", "absolute_path"):
                    x.pop(k)
                else: walk(x[k])
        elif isinstance(x, list):
            for v in x: walk(v)
        elif isinstance(x, float):
            return round(x, 3)
    walk(out)
    return out


@pytest.mark.parametrize("with_stems,golden", [
    (False, "golden_no_stems.json"),
    (True, "golden_with_stems.json"),
])
def test_pipeline_snapshot(synth_stem_files, with_stems, golden):
    # Use an existing short mix fixture from the repo
    from audio_analysis.tests.fixtures import short_mix_path
    stem_paths = {StemRole(r): p for r, p in synth_stem_files.items()} if with_stems else None
    result = run_analysis_pipeline(
        audio_path=short_mix_path(), reference_path=None, user_id="test",
        als_file_path=None, genre_hint=None, stem_paths=stem_paths,
        reference_stem_paths=None,
    )
    actual = _normalize(result)
    golden_path = GOLDEN_DIR / golden
    if UPDATE or not golden_path.exists():
        golden_path.write_text(json.dumps(actual, indent=2, sort_keys=True))
        pytest.skip(f"snapshot updated: {golden_path}")
    expected = json.loads(golden_path.read_text())
    assert actual == expected
```

- [ ] **Step 32.2: Generate the goldens**

Run: `cd components/analysis && UPDATE_SNAPSHOTS=1 pytest tests/integration/test_pipeline_with_stems.py -v`
Expected: both tests skip after writing snapshot files.

Inspect the two generated `golden_*.json` files; verify they look right (no junk, no NaN). Diff them to confirm the with-stems variant has additional `phase4.stems` and any new fields.

- [ ] **Step 32.3: Run normal mode to confirm snapshots match**

Run: `cd components/analysis && pytest tests/integration/test_pipeline_with_stems.py -v`
Expected: 2 passed.

- [ ] **Step 32.4: Commit**

```bash
git add components/analysis/tests/integration/test_pipeline_with_stems.py \
        components/analysis/tests/integration/golden_no_stems.json \
        components/analysis/tests/integration/golden_with_stems.json
git commit -m "test(integration): add snapshot tests for pipeline with and without stems"
```

---

## Task 33: Performance regression guard

**Files:**
- Create: `components/analysis/tests/integration/test_performance.py`

- [ ] **Step 33.1: Write the test**

```python
# components/analysis/tests/integration/test_performance.py
import time
import pytest

from audio_analysis.pipeline import run_analysis_pipeline
from audio_analysis.stems.types import StemRole


@pytest.mark.perf
def test_stems_analysis_completes_under_90s(synth_stem_files):
    from audio_analysis.tests.fixtures import short_mix_path
    stem_paths = {StemRole(r): p for r, p in synth_stem_files.items()}
    t0 = time.perf_counter()
    run_analysis_pipeline(
        audio_path=short_mix_path(), reference_path=None, user_id="perf",
        als_file_path=None, genre_hint=None, stem_paths=stem_paths,
        reference_stem_paths=None,
    )
    elapsed = time.perf_counter() - t0
    assert elapsed < 90.0, f"pipeline with stems took {elapsed:.1f}s (budget 90s)"
```

- [ ] **Step 33.2: Run with `-m perf`**

Run: `cd components/analysis && pytest tests/integration/test_performance.py -m perf -v`
Expected: 1 passed within budget.

- [ ] **Step 33.3: Commit**

```bash
git add components/analysis/tests/integration/test_performance.py
git commit -m "test(integration): add perf regression guard for stem pipeline"
```

---

## Task 34: Playwright E2E happy path  ⛔ DEFERRED — see banner above Task 22

**Files:**
- Create: `components/frontend/e2e/stems-upload.spec.ts`

- [ ] **Step 34.1: Write the test**

Create `components/frontend/e2e/stems-upload.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

test("upload mix + stems, confirm mapping, see stem cards on report", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/upload$/);

  await page.setInputFiles('input[name="mix"]', "e2e/fixtures/short_mix.wav");
  await page.setInputFiles('input[aria-label="stems"]', [
    "e2e/fixtures/stems/01_Kick.flac",
    "e2e/fixtures/stems/02_Bass.flac",
    "e2e/fixtures/stems/03_Hats.flac",
    "e2e/fixtures/stems/04_Vox.flac",
  ]);
  await page.getByRole("button", { name: /upload/i }).click();

  // Mapping table appears
  await expect(page.getByRole("button", { name: /looks right/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /looks right/i }).click();

  // Job page → wait for completion → report
  await page.waitForURL(/\/jobs\/[\w-]+/);
  await expect(page.getByText(/Per-Stem Balance/)).toBeVisible({ timeout: 600_000 });
  await expect(page.getByText(/Stem Clash Matrix/)).toBeVisible();
});
```

- [ ] **Step 34.2: Generate the E2E fixtures**

Add a one-off helper script `components/frontend/e2e/generate-fixtures.mjs` that produces the same synth stems via `node` if not already present (or just check them in — they're tiny FLACs).

- [ ] **Step 34.3: Run E2E**

Bring up dev stack: `./start-dev.ps1`. Then: `cd components/frontend && npx playwright test e2e/stems-upload.spec.ts`
Expected: 1 passed.

- [ ] **Step 34.4: Commit**

```bash
git add components/frontend/e2e/stems-upload.spec.ts \
        components/frontend/e2e/generate-fixtures.mjs \
        components/frontend/e2e/fixtures/
git commit -m "test(e2e): playwright happy path for stem upload + report"
```

---

## Task 35: Documentation updates

**Files:**
- Modify: `components/api/README.md`
- Modify: `components/analysis/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 35.1: Document new API endpoints**

In `components/api/README.md`, add a section "Stems upload":

```markdown
## Stems upload

`POST /uploads/` accepts an optional multipart field `stems[]` (1–16 FLAC or WAV files,
≤100 MB each, ≤1 GB total) plus optional `reference_stems[]` with the same constraints.

When stems are present:
1. Response status is `AWAITING_STEM_MAPPING` with a `proposed_mapping` array (file ↔ role,
   pre-filled by filename keywords + spectral fingerprint, and optionally by .als track names
   if an `als_file` was uploaded).
2. The frontend confirms via `POST /uploads/{job_id}/stems/confirm` with
   `{"mappings": [{"file": "...", "role": "...", "als_track": "..."|null}, ...]}`.
3. On confirmation, the job transitions to `PENDING` and Celery dispatches the pipeline.
4. Jobs left in `AWAITING_STEM_MAPPING` for >24h are auto-failed by a beat task.

`GET /uploads/{job_id}` re-serves `proposed_mapping` for awaiting jobs to support page reloads.
```

- [ ] **Step 35.2: Document the stems module + pre-Demucs runbook**

In `components/analysis/README.md`, add:

```markdown
## stems/ module

All stem analysis lives in `audio_analysis.stems`. Public API:

- `detect_role(file_path, audio=None)` — filename + spectral role classification
- `propose_mapping(stem_files, als_track_names=None)` — auto-mapping for the confirmation UI
- `validate_confirmed_mapping(mappings)` — server-side guard on confirmed mappings
- `analyze(stem_paths, genre_profile=None)` — per-stem metrics + cross-stem clash matrix
- `compare(user, reference)` — per-stem reference deltas

Phases 4 and 5 conditionally call into this module. They keep their existing output schemas
and add `phase4.stems` and `phase5.per_stem_reference_deltas` only when stems are present.

## Pre-Demucs admin runbook

When adding new tracks to `data/reference_library/`, run:

    python -m audio_analysis.reference_library.pre_demucs \
        --library data/reference_library/ \
        --out data/reference_library/_stems_cache/

This is idempotent — already-cached tracks are skipped. The cache enables stem-by-stem
reference comparison for users who provide their own stems but use the curated library
as their reference. Without the cache, phase 5 falls back to full-mix comparison only.
```

- [ ] **Step 35.3: Update CLAUDE.md**

Append to `CLAUDE.md` under the existing pipeline section:

```markdown
### Stems

User-provided stems (1–16 FLAC/WAV files) are an optional upload that unlocks per-stem
analysis. Server auto-matches stems to roles (filename + spectral) and to .als track names
when present; user confirms via `POST /uploads/{job_id}/stems/confirm`. All stem logic
lives in `audio_analysis.stems` — phases 4 and 5 call into it conditionally. Three new
verdict specialists (`StemBalance`, `StemStereoWidth`, `StemReferenceDelta`) emit findings
only when stems are present.

Curated reference library has pre-computed Demucs caches at
`data/reference_library/_stems_cache/<track_id>.stems.json` — built offline via
`python -m audio_analysis.reference_library.pre_demucs`. We never run Demucs at request
time on user-uploaded references.
```

- [ ] **Step 35.4: Commit**

```bash
git add components/api/README.md components/analysis/README.md CLAUDE.md
git commit -m "docs: document stems upload, stems module, and pre-Demucs runbook"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Implemented in task(s) |
|---|---|
| §3 stems module (4 files) | Tasks 1, 4, 5, 6, 7, 8 |
| §3 pre_demucs.py | Task 30 |
| §3 routers/stems.py | Task 14 |
| §3 specialist prompts (3 new) | Tasks 17, 18, 19 |
| §3 frontend new files | Tasks 22, 23, 24, 26, 27, 28 |
| §3 phase 4 changes | Task 9 |
| §3 phase 5 changes | Tasks 10, 31 |
| §3 uploads.py changes | Tasks 13, 15 |
| §3 models.py + migration | Task 2 |
| §3 verdict specialists extension | Tasks 20, 21 |
| §3 worker tasks.py | Task 11 |
| §4 data flow (frontend wiring) | Tasks 25, 29 |
| §4 reference cache lookup order | Task 31 |
| §6 HTTP API contracts | Tasks 13, 14, 15 |
| §7 DB columns + enum | Task 2 |
| §8 verdict pipeline gating | Tasks 17–19 (gates) |
| §9 validation gates | Tasks 12, 13, 14 |
| §9 mapping timeout | Task 16 |
| §9 partial-failure tolerance | Task 9 (try/except in phase4 + UI note in Task 29) |
| §10 unit + phase + integration tests | Tasks 1–8, 9, 10, 31, 32 |
| §10 API tests | Tasks 13, 14, 15 |
| §10 specialist tests | Tasks 17, 18, 19, 20, 21 |
| §10 frontend tests | Tasks 22, 23, 24, 26, 27, 28 |
| §10 perf guard | Task 33 |
| §10 Playwright E2E | Task 34 |
| §10 fixtures | Task 3 (synth) + Task 34 (E2E fixtures) |
| Documentation | Task 35 |

All spec sections have at least one task. Two items are deferred to implementation discretion (per spec §12, also acknowledged):
- RapidFuzz threshold — set to 60 in Task 5 (`ALS_MATCH_THRESHOLD`).
- Confidence values surfaced in UI — Task 24 currently does not show them; can be added later without spec change.

**Placeholder scan:** none of the forbidden patterns ("TBD", "TODO", "implement later", "add appropriate error handling", "similar to Task N") appear. All steps have either runnable commands or full code.

**Type consistency:** `StemRole`, `FreqBand`, `StemMetrics`, `StemAnalysisResult`, `StemReferenceDelta`, `StemMappingProposal`, `ConfirmedMapping`, `BalanceFlag`, `StemClash` — defined once in Task 1's `types.py`; every later reference matches the field names. `propose_mapping`, `validate_confirmed_mapping`, `detect_role`, `analyze`, `compare` — function signatures consistent across tasks. `JobStatus.AWAITING_STEM_MAPPING` — added in Task 2, referenced in Tasks 13, 14, 15, 16. Database columns `stem_paths_raw`, `stem_paths`, `stem_metrics` — added in Task 2, referenced in Tasks 13, 14, 16. HTTP error codes (`stem_count_out_of_range`, `unsupported_stem_format`, `stem_file_too_large`, `total_upload_too_large`, `duplicate_role`, `unmapped_stems`, `mapping_timeout`) — defined in Task 12, asserted in Tasks 13, 14, 16.

No issues found.
