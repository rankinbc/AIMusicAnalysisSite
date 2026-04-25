# PRP: GAP-11 — AI Coach Persona Voice for Fixes

**Status:** Draft  
**Effort:** 1–2 hours (template version); additional 2–4 hours for LLM version  
**Phase:** v1.1 (template version) / v1.2 (LLM upgrade)

---

## Goal

Transform the plain `top_fixes` string list in `pipeline.py` into coached, value-referencing explanations written in a consistent instructor persona voice, and render them in the UI as styled coaching cards instead of a bullet list.

## Why

- TrackScore.AI's "Klaus" persona is their most-discussed feature; personality-driven feedback drives screenshots and word-of-mouth
- Plain fix strings ("Reduce bass at 80Hz") are forgettable and do not explain the why; coaching explanations that reference measured values are actionable and memorable
- The template version has zero API cost and can be shipped immediately

## What

### Backend

**New file:** `analysis/coach.py`

```python
"""
Coach persona — transforms raw analysis metrics into coaching-voice explanations.
Template version (v1.1): f-string interpolation on measured values.
LLM version (v1.2): pass analysis summary to Claude API.
"""

COACH_NAME = "Coach"

COACH_INTRO = (
    "Here's what I'd focus on to push this mix forward:"
)

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
    "generic": (
        "{description}"
    ),
}


def generate_coached_fixes(analysis: dict) -> dict:
    """
    Build coaching explanations from the raw analysis dict.
    Returns a dict with 'coach_name', 'coach_intro', and 'coached_fixes' list.
    """
    fixes = []

    # LUFS check
    lufs = analysis.get("integrated_lufs")
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
        "coached_fixes": fixes[:5],  # Cap at 5 fixes
    }
```

**File:** `analysis/pipeline.py`

Import and call `generate_coached_fixes` at the end of the pipeline, adding the result to the output dict:

```python
from analysis.coach import generate_coached_fixes

# At the end of the pipeline result assembly:
coaching = generate_coached_fixes(phase1_data | phase2_data | ...)
result_dict.update(coaching)
```

### Frontend

**New component:** `frontend/src/components/CoachPanel.tsx`

```tsx
interface CoachPanelProps {
  coachName: string;
  coachIntro: string;
  coachedFixes: string[];
}

const CoachPanel = ({ coachName, coachIntro, coachedFixes }: CoachPanelProps) => (
  <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 mt-6">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
        {coachName[0]}
      </div>
      <div>
        <div className="font-semibold text-white">{coachName}</div>
        <div className="text-xs text-gray-400">Your Mix Coach</div>
      </div>
    </div>
    <p className="text-gray-300 mb-4 italic">{coachIntro}</p>
    <ol className="space-y-3">
      {coachedFixes.map((fix, i) => (
        <li key={i} className="flex gap-3">
          <span className="text-blue-400 font-bold mt-0.5">{i + 1}.</span>
          <p className="text-gray-200">{fix}</p>
        </li>
      ))}
    </ol>
  </div>
);

export default CoachPanel;
```

**File:** `ReportPage.tsx` — Replace or supplement the existing `top_fixes` list with `<CoachPanel>`.

## Tasks

### Task 1: Backend — create coach.py
- [ ] Create `analysis/coach.py` with `COACH_TEMPLATES` dict and `generate_coached_fixes()` function
- [ ] Add template entries for LUFS (low + high), clipping, true peak, and mono compatibility
- [ ] Add fallback to raw `top_fixes` for any issues not covered by templates
- [ ] Cap output at 5 coached fixes

### Task 2: Backend — integrate into pipeline
- [ ] Open `analysis/pipeline.py`
- [ ] Import `generate_coached_fixes` from `analysis.coach`
- [ ] Merge all phase output dicts into a single analysis dict
- [ ] Call `generate_coached_fixes(merged_analysis_dict)` at the end of pipeline assembly
- [ ] Add `coach_name`, `coach_intro`, `coached_fixes` to `result_dict` / `final_json`
- [ ] Run the full pipeline on a test file and confirm all three keys appear in the JSON output

### Task 3: Frontend — CoachPanel component
- [ ] Create `frontend/src/components/CoachPanel.tsx`
- [ ] Implement the layout with coach avatar initial, intro text, and numbered fix list
- [ ] Add TypeScript props interface

### Task 4: Frontend — integrate into ReportPage
- [ ] Add `coach_name`, `coach_intro`, `coached_fixes` to the TypeScript result interface
- [ ] Import `CoachPanel` in `ReportPage.tsx`
- [ ] Render `<CoachPanel>` after the score section and before the detailed metrics
- [ ] Keep the existing `top_fixes` list or replace it — whichever looks cleaner

## Validation

- [ ] `coached_fixes` key present in `final_json` with 1–5 string entries
- [ ] Each fix references an actual measured value (not generic advice)
- [ ] `CoachPanel` renders correctly in the report with coach avatar and numbered list
- [ ] At least one fix appears for any track with a loudness, clipping, or compatibility issue
- [ ] Empty `coached_fixes` array (perfect mix) renders gracefully or shows a positive message

## Anti-Patterns

- Do not generate generic fixes like "improve your mix" with no data reference — every fix must cite a measured value
- Do not call an external API in the template version — all logic must be local
- Do not exceed 5 fixes in the coached output — information overload reduces engagement
- Do not remove the raw `top_fixes` from the JSON response immediately — keep it for backward compatibility with any client that reads it
