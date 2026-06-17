"""Deterministic, producer-facing fixes derived from analysis phase output.

This is intentionally NOT a scoring engine. SPECTR's authoritative priority /
severity scoring lives in ``aimusic_shared.verdicts.scoring`` (the LLM verdict
pipeline). This module only maps already-computed metrics to short, actionable
fix strings that feed the two deterministic surfaces: ``pipeline._extract_fixes``
(→ ``top_fixes``) and ``coach.generate_coached_fixes`` (→ ``coached_fixes``).
"""

from __future__ import annotations


def translation_fixes(phase9: dict | None) -> list[str]:
    """Map Phase 9 (Mix Translation) findings to ordered, most-severe-first fixes.

    Args:
        phase9: The Phase 9 ``data`` dict (``spatial`` / ``surround`` / ``playback``
                sub-dicts). Tolerant of ``None`` / missing keys — returns ``[]``.

    Returns:
        List of producer-facing fix strings, ordered most → least severe.
    """
    if not phase9:
        return []

    surround = phase9.get("surround") or {}
    playback = phase9.get("playback") or {}
    spatial = phase9.get("spatial") or {}

    # (priority, message) — lower priority value = more severe / surfaced first.
    candidates: list[tuple[int, str]] = []

    mono_compat = surround.get("mono_compatibility")
    if isinstance(mono_compat, (int, float)):
        if mono_compat < 40:
            candidates.append((
                0,
                "Mix collapses in mono — check phase on widened low-mids before "
                "anything plays on a club PA or Bluetooth speaker.",
            ))
        elif mono_compat < 70:
            candidates.append((
                3,
                "Moderate mono compatibility — some elements thin out when summed; "
                "tighten stereo widening below ~300 Hz.",
            ))

    phase_score = surround.get("phase_score")
    if isinstance(phase_score, (int, float)) and phase_score < 30:
        candidates.append((
            1,
            "Phase cancellation detected — check for an inverted channel or "
            "over-aggressive stereo widener.",
        ))

    bass_translation = playback.get("bass_translation")
    if bass_translation == "weak":
        candidates.append((
            2,
            "Bass won't read on laptop / phone speakers — add 100–300 Hz "
            "harmonics so the low end survives small playback systems.",
        ))
    elif bass_translation == "excessive":
        candidates.append((
            4,
            "Excessive sub energy may overwhelm small speakers — high-pass or "
            "tame everything below ~40 Hz.",
        ))

    if playback.get("crossfeed_safe") is False:
        candidates.append((
            5,
            "Extreme stereo will fatigue on headphones — narrow the sides or "
            "add a touch of crossfeed/mono-bass.",
        ))

    width_consistency = spatial.get("width_consistency")
    if isinstance(width_consistency, (int, float)) and width_consistency < 70:
        candidates.append((
            6,
            "Stereo image is unstable across the track — automate width changes "
            "deliberately rather than letting it drift.",
        ))

    candidates.sort(key=lambda c: c[0])
    return [msg for _, msg in candidates]
