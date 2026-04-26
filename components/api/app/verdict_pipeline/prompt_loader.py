from __future__ import annotations
import re
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts" / "experts"

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

_FRONTMATTER_RE = re.compile(
    r"\A---\s*\n(?P<body>.*?)\n---\s*\n", re.DOTALL
)
_VERSION_RE = re.compile(r"^version:\s*(?P<v>\S+)\s*$", re.MULTILINE)


def parse_version_frontmatter(content: str) -> tuple[str, str]:
    """Extract `version:` from a leading YAML-ish frontmatter block.
    Returns (version, content_with_frontmatter_stripped).
    Defaults to '0.0.0' if no frontmatter or no version key."""
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return "0.0.0", content
    fm = m.group("body")
    vm = _VERSION_RE.search(fm)
    version = vm.group("v") if vm else "0.0.0"
    return version, content[m.end():]


def _load(filename: str) -> tuple[str, str]:
    path = PROMPTS_DIR / f"{filename}.md"
    if not path.exists():
        raise KeyError(f"prompt file not found: {path}")
    return parse_version_frontmatter(path.read_text(encoding="utf-8"))


def load_prompt(slug: str) -> tuple[str, str]:
    """Returns (version, body) for a specialist prompt by slug."""
    if slug not in SLUG_TO_FILENAME:
        raise KeyError(f"unknown specialist slug: {slug!r}")
    return _load(SLUG_TO_FILENAME[slug])


def load_triage() -> tuple[str, str]:
    return _load(TRIAGE_FILENAME)
