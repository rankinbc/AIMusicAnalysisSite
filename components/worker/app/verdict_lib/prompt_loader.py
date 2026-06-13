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
_MODEL_RE = re.compile(r"^model:\s*(?P<m>\S+)\s*$", re.MULTILINE)


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


def parse_model_frontmatter(content: str) -> str | None:
    """Extract an optional ``model:`` pin from frontmatter (NFR24).

    Returns the model id, or ``None`` when unset (caller falls back to the
    gateway's configured default).
    """
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return None
    mm = _MODEL_RE.search(m.group("body"))
    return mm.group("m") if mm else None


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


# Pinned versions must be plain version-ish tokens — they are interpolated
# into a filesystem path, and this table becomes remotely writable when the
# Epic 10 admin endpoints land.
_SAFE_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,31}$")


def _resolve_pin(slug: str) -> str | None:
    """TTL-cached pinned version for a slug; fail-open (None) on any error."""
    hit = _pin_cache.get(slug)
    if hit is not None and _now_monotonic() - hit[0] < PIN_TTL_S:
        return hit[1]
    try:
        pinned = _fetch_pin_from_db(slug)
    except Exception as exc:
        logger.warning("prompt pin lookup failed for %r (fail-open): %s", slug, exc)
        pinned = None
    if pinned is not None and not _SAFE_VERSION_RE.match(pinned):
        logger.warning(
            "pinned version %r for %r is not a safe version token — ignoring pin",
            pinned, slug,
        )
        pinned = None
    _pin_cache[slug] = (_now_monotonic(), pinned)
    return pinned


def _load_pinned_archive_content(name: str, slug: str, pinned: str) -> str | None:
    """Raw content of ``versions/{name}@{pinned}.md``; None on any failure
    (fail-open)."""
    archived = PROMPTS_DIR / "versions" / f"{name}@{pinned}.md"
    try:
        content = archived.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning(
            "pinned prompt version %s for %r has no archive file at %s "
            "— serving live version",
            pinned, slug, archived,
        )
        return None
    except (OSError, UnicodeDecodeError) as exc:
        # The pin mechanism must never fail a job — unreadable archive
        # (permissions, TOCTOU delete, bad encoding) falls back to live.
        logger.warning(
            "pinned archive %s unreadable (%s) — serving live version",
            archived, exc,
        )
        return None
    version, _ = parse_version_frontmatter(content)
    if version != pinned:
        logger.warning(
            "archive %s frontmatter says version %s but the pin is %s — "
            "serving the archive; fix the file's frontmatter or its name",
            archived, version, pinned,
        )
    return content


def _served_prompt_content(slug: str) -> str:
    """Raw content of the prompt file that should serve for ``slug``,
    pin-aware. The pin is consulted before the live file so a valid pinned
    archive can still serve when the live file is absent (fail-open to live
    when the archive is missing/unreadable)."""
    if slug not in SLUG_TO_FILENAME:
        raise KeyError(f"unknown specialist slug: {slug!r}")
    name = SLUG_TO_FILENAME[slug]
    path = PROMPTS_DIR / f"{name}.md"

    pinned = _resolve_pin(slug)
    if pinned:
        if path.exists():
            live_content = path.read_text(encoding="utf-8")
            live_version, _ = parse_version_frontmatter(live_content)
            if pinned == live_version:
                return live_content
        archived = _load_pinned_archive_content(name, slug, pinned)
        if archived is not None:
            return archived
        # fall through to the live file (fail-open)

    if not path.exists():
        raise FileNotFoundError(f"prompt file not found: {path}")
    return path.read_text(encoding="utf-8")


def load_prompt(slug: str) -> tuple[str, str]:
    """Returns ``(version, body)`` for a specialist prompt by slug (pin-aware)."""
    return parse_version_frontmatter(_served_prompt_content(slug))


def load_prompt_model(slug: str) -> str | None:
    """Optional model pin from a specialist prompt's frontmatter (NFR24),
    pin-aware. ``None`` → caller uses the gateway's configured default."""
    return parse_model_frontmatter(_served_prompt_content(slug))


def load_triage() -> tuple[str, str]:
    """Returns ``(version, body)`` for the Triage prompt."""
    path = PROMPTS_DIR / f"{TRIAGE_FILENAME}.md"
    if not path.exists():
        raise FileNotFoundError(f"triage prompt file not found: {path}")
    return parse_version_frontmatter(path.read_text(encoding="utf-8"))


def load_triage_model() -> str | None:
    """Optional model pin from the Triage prompt's frontmatter (NFR24).
    ``None`` → caller uses the gateway's configured default."""
    path = PROMPTS_DIR / f"{TRIAGE_FILENAME}.md"
    if not path.exists():
        return None
    return parse_model_frontmatter(path.read_text(encoding="utf-8"))
