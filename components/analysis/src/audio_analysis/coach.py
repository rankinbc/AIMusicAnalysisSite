"""
Coach persona — transforms raw analysis metrics into coaching-voice explanations.
Template version (v1.1): f-string interpolation on measured values.
"""

COACH_NAME = "Coach"

COACH_INTRO = "Here's what I'd focus on to push this mix forward:"

# Each key matches a condition checked in generate_coached_fixes()
COACH_TEMPLATES = {
    "lufs_low": (
        "Your integrated loudness ({measured:.1f} LUFS) is sitting below the sweet spot for {platform} "
        "({target:.1f} LUFS). You have headroom to work with — nudge your master limiter ceiling up slightly "
        "and re-check. Small gain is better than a big push."
    ),
    "lufs_high": (
        "At {measured:.1f} LUFS you're pushing above {platform}'s target ({target:.1f} LUFS). "
        "The platform will turn you down automatically, but you may be sacrificing dynamic feel. "
        "Pull the limiter back slightly."
    ),
    "clipping": (
        "I found {count} hard-clipped samples at the master output. Pull the limiter ceiling back 1–2 dB — "
        "clipping at master is an immediate red flag for any distributor."
    ),
    "true_peak_over": (
        "True peak is hitting {measured:.1f} dBTP. Streaming platforms reject above 0 dBTP; "
        "keep it below −1.0 dBTP for safety. Back off the ceiling."
    ),
    "mono_compatibility_low": (
        "Mono compatibility is at {measured:.0f}% — you'll lose noticeable energy when this plays "
        "on Bluetooth speakers or club PAs in mono. Check for phase issues on widened elements, "
        "especially in the sub and low-mid range."
    ),
    "mono_collapse": (
        "Your mix is close to collapsing in mono ({measured:.0f}% compatibility). Before this "
        "touches a club PA or a phone speaker, pull back any stereo widening below ~300 Hz and "
        "check for an inverted channel — this is the first thing a mastering engineer would flag."
    ),
    "bass_translation_weak": (
        "The low end won't read on laptop or phone speakers. Add some 100–300 Hz harmonics to your "
        "sub/bass (a touch of saturation works) so the groove still lands on small systems."
    ),
    "headphone_fatigue": (
        "Your stereo image is wide enough to feel disorienting on headphones. Narrow the extreme "
        "sides or add a little crossfeed so it stays comfortable on cans."
    ),
    "generic": "{description}",
}


def generate_coached_fixes(analysis: dict) -> dict:
    """
    Build coaching explanations from the raw analysis dict.
    Returns a dict with 'coach_name', 'coach_intro', and 'coached_fixes' list.
    """
    fixes = []

    # LUFS check — use 'lufs' key (our phase1 field name) with 'integrated_lufs' alias fallback
    lufs = analysis.get("lufs") if analysis.get("lufs") is not None else analysis.get("integrated_lufs")
    if lufs is not None:
        if lufs < -16.0:
            fixes.append(COACH_TEMPLATES["lufs_low"].format(
                measured=lufs, platform="Spotify", target=-14.0
            ))
        elif lufs > -8.0:
            fixes.append(COACH_TEMPLATES["lufs_high"].format(
                measured=lufs, platform="Beatport", target=-9.0
            ))

    # Clipping check
    if analysis.get("clipping_detected"):
        count = analysis.get("clipped_sample_count", 0)
        fixes.append(COACH_TEMPLATES["clipping"].format(count=count))

    # True peak check
    tp = analysis.get("true_peak_db")
    if tp is not None and tp >= -1.0:
        fixes.append(COACH_TEMPLATES["true_peak_over"].format(measured=tp))

    # Mono compatibility check
    mono = analysis.get("mono_compatibility")
    if mono is not None and mono < 0.70:
        fixes.append(COACH_TEMPLATES["mono_compatibility_low"].format(
            measured=mono * 100
        ))

    # Phase 9 (Mix Translation) headline issues — translation sub-dict is folded
    # in by finalize_result. Scores here are 0–100 (analyzer scale), not 0–1.
    translation = analysis.get("translation") or {}
    surround = translation.get("surround") or {}
    playback = translation.get("playback") or {}

    surround_mono = surround.get("mono_compatibility")
    if isinstance(surround_mono, (int, float)) and surround_mono < 40:
        fixes.append(COACH_TEMPLATES["mono_collapse"].format(measured=surround_mono))

    if playback.get("bass_translation") == "weak":
        fixes.append(COACH_TEMPLATES["bass_translation_weak"])

    if playback.get("crossfeed_safe") is False:
        fixes.append(COACH_TEMPLATES["headphone_fatigue"])

    # Fall back to raw top_fixes if nothing matched
    if not fixes:
        for raw_fix in analysis.get("top_fixes", []):
            fixes.append(COACH_TEMPLATES["generic"].format(description=raw_fix))

    return {
        "coach_name": COACH_NAME,
        "coach_intro": COACH_INTRO,
        "coached_fixes": fixes[:5],
    }
