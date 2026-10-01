"""Auto-written Analysis Notes (session_notes rows) for analysis milestones.

Two milestones get a note on the analysed version, owned by the analysis
owner, at t=0 (not tied to a timestamp):

  - initial analysis done (written when Triage settles — the first moment the
    first-pass finding count AND the recommended specialists both exist)
  - each on-demand specialist done ("N additional findings")

Best-effort by design: a note is a convenience, so a failure here is logged
and never undoes or fails the work it describes. Song-less analyses (the
anonymous funnel) have no version to hang a note on and are skipped.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.orm import Session

from aimusic_shared.models import Analysis, SessionNote

logger = logging.getLogger(__name__)

# slug → (display label, group). Mirrors the frontend catalog
# (frontend-spectr-v2/src/features/results/helpers/specialists.ts);
# tests/test_auto_notes.py asserts it covers every specialist slug.
SPECIALIST_LABELS: dict[str, tuple[str, str]] = {
    "low_end": ("Low End", "Spectrum"),
    "frequency_balance": ("Frequency Balance", "Spectrum"),
    "frequency_collision": ("Frequency Collisions", "Spectrum"),
    "clarity": ("Clarity", "Spectrum"),
    "harmonic": ("Harmonic Content", "Spectrum"),
    "loudness": ("Loudness", "Loudness"),
    "gain_staging": ("Gain Staging", "Loudness"),
    "playback": ("Playback Targets", "Loudness"),
    "dynamics": ("Dynamics", "Dynamics"),
    "humanization": ("Humanization", "Dynamics"),
    "density": ("Density / Busyness", "Dynamics"),
    "stereo_phase": ("Stereo Phase", "Stereo"),
    "stereo_field": ("Stereo Field", "Stereo"),
    "spatial": ("Spatial", "Stereo"),
    "surround": ("Mono Compatibility", "Stereo"),
    "sections": ("Sections", "Sections"),
    "section_contrast": ("Section Contrast", "Sections"),
    "trance_arrangement": ("Trance Arrangement", "Sections"),
    "chord_harmony": ("Chord / Harmony", "Sections"),
    "device_chain": ("Device Chain", "Sections"),
    "stem_reference": ("Stem Reference", "Stems"),
    "stem_balance": ("Stem Balance", "Stems"),
    "stem_stereo_width": ("Stem Stereo Width", "Stems"),
    "stem_reference_delta": ("Stem Reference Δ", "Stems"),
    "overall": ("Overall Score", "Misc"),
    "priority_summary": ("Priority Summary", "Misc"),
}


def specialist_label(slug: str) -> str:
    """'Spatial (Stereo)' — the label, with its group when that adds anything."""
    label, group = SPECIALIST_LABELS.get(slug, (slug.replace("_", " ").title(), ""))
    if not group or group == "Misc" or group.lower() in label.lower():
        return label
    return f"{label} ({group})"


def _findings(n: int, adjective: str = "") -> str:
    word = "finding" if n == 1 else "findings"
    return f"{n} {adjective} {word}" if adjective else f"{n} {word}"


def analysis_note_text(findings: int, recommended: list[str] | None) -> str:
    """``recommended`` None = Triage didn't produce a plan (degraded)."""
    head = f"Analysis complete: {_findings(findings, 'initial')}."
    if recommended is None:
        return head
    if not recommended:
        return f"{head} No additional specialists recommended."
    names = ", ".join(specialist_label(s) for s in recommended)
    return f"{head} Recommended specialists: {names}."


def recommended_slugs(specialists_to_run: list[dict[str, Any]]) -> list[str]:
    """Plan entries → slugs in priority order (1 = first); a non-numeric
    priority sorts last rather than failing the note."""
    def key(item: dict[str, Any]) -> float:
        p = item.get("priority")
        return float(p) if isinstance(p, int | float) else float("inf")
    return [str(i["name"]) for i in sorted(specialists_to_run, key=key) if i.get("name")]


def specialist_note_text(slug: str, findings: int) -> str:
    return f"{specialist_label(slug)} specialist completed: {_findings(findings, 'additional')}."


def add_note(s: Session, analysis: Analysis, text: str) -> bool:
    """Stage a note in ``s`` (caller's transaction). False when the analysis
    has no version/owner to attach it to."""
    if analysis.version_id is None or analysis.user_id is None:
        return False
    s.add(SessionNote(
        version_id=analysis.version_id,
        user_id=analysis.user_id,
        t_seconds=0.0,
        text=text,
        pinned=False,
    ))
    return True


def write_note(analysis_id: uuid.UUID, text: str) -> None:
    """Own-transaction, best-effort variant of :func:`add_note`."""
    try:
        from .db_sync import SessionFactory  # noqa: PLC0415 — lazy: DB env

        with SessionFactory.begin() as s:
            analysis = s.get(Analysis, analysis_id)
            if analysis is not None:
                add_note(s, analysis, text)
    except Exception:  # noqa: BLE001 — a note must never fail its caller
        logger.exception("auto note failed for analysis=%s", analysis_id)
