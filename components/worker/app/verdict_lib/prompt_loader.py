"""Specialist prompt loader.

Ported from the legacy v1 api loader with one change: ``PROMPTS_DIR`` now
resolves to ``components/worker/prompts/experts`` by default, and is
overridable via ``$VERDICT_PROMPTS_DIR``.

The slug → filename map MUST stay in sync with
``components/bff/src/Spectr.Bff/Services/SpecialistCatalog.cs``.

Prompt-version pinning (FR48): a row in the ``prompt_versions`` table pinning
a version different from the live file's frontmatter makes ``load_prompt``
serve ``versions/{PascalName}@{version}.md`` instead. Lookups are TTL-cached
(``PIN_TTL_S``) so an operator row flip takes effect without restart, and
every failure path (no DB configured, DB down, archive file missing) fails
open to the live file — the pipeline never fails a job because of the pin
mechanism.
"""
from __future__ import annotations

import logging
import os
import re
import time
from pathlib import Path

logger = logging.getLogger(__name__)

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


# ── prompt-version pinning (FR48) ──────────────────────────────────────────

PIN_TTL_S: float = 60.0

# slug → (fetched_at_monotonic, pinned_version_or_None)
_pin_cache: dict[str, tuple[float, str | None]] = {}


def _now_monotonic() -> float:
    return time.monotonic()


def clear_pin_cache() -> None:
    _pin_cache.clear()


def _fetch_pin_from_db(slug: str) -> str | None:
    """Read ``prompt_versions.pinned_version`` for one slug.

    Imports lazily so the loader works with no DB configured (pure-unit
    tests, ad-hoc scripts): ``app.db_sync`` raises at import when
    ``DATABASE_URL`` is unset, and the caller treats any exception as
    "unpinned".
    """
    from app.db_sync import SessionFactory  # noqa: PLC0415 — deliberate lazy import
    from aimusic_shared.models import PromptVersion

    with SessionFactory() as session:
        row = session.get(PromptVersion, slug)
        return row.pinned_version if row is not None else None


def _resolve_pin(slug: str) -> str | None:
    """TTL-cached pinned version for a slug; fail-open (None) on any error."""
    now = _now_monotonic()
    hit = _pin_cache.get(slug)
    if hit is not None and now - hit[0] < PIN_TTL_S:
        return hit[1]
    try:
        pinned = _fetch_pin_from_db(slug)
    except Exception as exc:
        logger.warning("prompt pin lookup failed for %r (fail-open): %s", slug, exc)
        pinned = None
    _pin_cache[slug] = (now, pinned)
    return pinned


def load_prompt(slug: str) -> tuple[str, str]:
    """Returns ``(version, body)`` for a specialist prompt by slug.

    Honors a ``prompt_versions`` pin: when the pinned version differs from
    the live file's frontmatter, the archived copy at
    ``versions/{PascalName}@{pinned}.md`` is served instead (fail-open to the
    live file if the archive is missing).
    """
    if slug not in SLUG_TO_FILENAME:
        raise KeyError(f"unknown specialist slug: {slug!r}")
    name = SLUG_TO_FILENAME[slug]
    path = PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"prompt file not found: {path}")
    version, body = parse_version_frontmatter(path.read_text(encoding="utf-8"))

    pinned = _resolve_pin(slug)
    if pinned and pinned != version:
        archived = PROMPTS_DIR / "versions" / f"{name}@{pinned}.md"
        if archived.exists():
            return parse_version_frontmatter(archived.read_text(encoding="utf-8"))
        logger.warning(
            "pinned prompt version %s for %r has no archive file at %s "
            "— serving live version %s",
            pinned, slug, archived, version,
        )
    return version, body


def load_triage() -> tuple[str, str]:
    """Returns ``(version, body)`` for the Triage prompt."""
    path = PROMPTS_DIR / f"{TRIAGE_FILENAME}.md"
    if not path.exists():
        raise FileNotFoundError(f"triage prompt file not found: {path}")
    return parse_version_frontmatter(path.read_text(encoding="utf-8"))
