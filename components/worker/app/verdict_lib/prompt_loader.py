"""Specialist prompt loader.

Ported from ``components/api/app/verdict_pipeline/prompt_loader.py`` with one
change: ``PROMPTS_DIR`` now resolves to ``components/worker/prompts/experts``
by default, and is overridable via ``$VERDICT_PROMPTS_DIR``.

The slug → filename map MUST stay in sync with
``components/bff/src/Spectr.Bff/Services/SpecialistCatalog.cs``.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

# Default: components/worker/prompts/experts/ — sibling of components/worker/app/.
_DEFAULT_DIR = Path(__file__).resolve().parents[2] / "prompts" / "experts"

PROMPTS_DIR = Path(os.environ.get("VERDICT_PROMPTS_DIR") or _DEFAULT_DIR)


SLUG_TO_FILENAME: dict[str, str] = {
    "low_end": "LowEnd",
    "frequency_balance": "FrequencyBalance",
    "dynamics": "Dynamics",
    "stereo_phase": "StereoPhase",
    "loudness": "Loudness",
    "sections": "Sections",
    "trance_arrangement": "TranceArrangement",
    "stem_reference": "StemReference",
    "harmonic": "HarmonicAnalysis",
    "clarity": "ClarityAnalysis",
    "spatial": "SpatialAnalysis",
    "surround": "SurroundCompatibility",
    "playback": "PlaybackOptimization",
    "overall": "OverallScore",
    "gain_staging": "GainStagingAudit",
    "stereo_field": "StereoFieldAudit",
    "frequency_collision": "FrequencyCollisionDetection",
    "humanization": "DynamicsHumanizationReport",
    "section_contrast": "SectionContrastAnalysis",
    "density": "DensityBusynessReport",
    "chord_harmony": "ChordHarmonyAnalysis",
    "device_chain": "DeviceChainAnalysis",
    "priority_summary": "PriorityProblemSummary",
    "stem_balance": "StemBalance",
    "stem_stereo_width": "StemStereoWidth",
    "stem_reference_delta": "StemReferenceDelta",
}

SPECIALIST_SLUGS: tuple[str, ...] = tuple(SLUG_TO_FILENAME.keys())

TRIAGE_FILENAME = "Triage"

_FRONTMATTER_RE = re.compile(r"\A---\s*\n(?P<body>.*?)\n---\s*\n", re.DOTALL)
_VERSION_RE = re.compile(r"^version:\s*(?P<v>\S+)\s*$", re.MULTILINE)


def parse_version_frontmatter(content: str) -> tuple[str, str]:
    """Extract ``version:`` from a leading YAML-ish frontmatter block.

    Returns ``(version, content_with_frontmatter_stripped)``. Defaults to
    ``'0.0.0'`` if no frontmatter or no version key.
    """
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return "0.0.0", content
    fm = m.group("body")
    vm = _VERSION_RE.search(fm)
    version = vm.group("v") if vm else "0.0.0"
    return version, content[m.end():]


def load_prompt(slug: str) -> tuple[str, str]:
    """Returns ``(version, body)`` for a specialist prompt by slug."""
    if slug not in SLUG_TO_FILENAME:
        raise KeyError(f"unknown specialist slug: {slug!r}")
    path = PROMPTS_DIR / f"{SLUG_TO_FILENAME[slug]}.md"
    if not path.exists():
        raise FileNotFoundError(f"prompt file not found: {path}")
    return parse_version_frontmatter(path.read_text(encoding="utf-8"))


def load_triage() -> tuple[str, str]:
    """Returns ``(version, body)`` for the Triage prompt."""
    path = PROMPTS_DIR / f"{TRIAGE_FILENAME}.md"
    if not path.exists():
        raise FileNotFoundError(f"triage prompt file not found: {path}")
    return parse_version_frontmatter(path.read_text(encoding="utf-8"))
