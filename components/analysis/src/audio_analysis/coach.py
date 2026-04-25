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

    # Fall back to raw top_fixes if nothing matched
    if not fixes:
        for raw_fix in analysis.get("top_fixes", []):
            fixes.append(COACH_TEMPLATES["generic"].format(description=raw_fix))

    return {
        "coach_name": COACH_NAME,
        "coach_intro": COACH_INTRO,
        "coached_fixes": fixes[:5],
    }
