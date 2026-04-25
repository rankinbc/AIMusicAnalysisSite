# PRP: GAP-01 — Beatport Streaming Compliance Row

**Status:** Draft  
**Effort:** < 15 minutes  
**Phase:** v1.1 — Quick wins / parity features

---

## Goal

Add a Beatport row to the StreamingReadiness component so EDM/trance producers can see at a glance whether their master meets Beatport's −9.0 LUFS loudness target.

## Why

- The primary user persona releases on Beatport; this is the most relevant platform check we're missing
- Mix Check Studio and TrackScore.AI already surface this; absence is a visible competitive gap
- LUFS is already computed in `phase1_universal.py` — zero backend work required

## What

### Backend

No changes required. `integrated_lufs` is already present in `AnalysisResult.final_json` as populated by `phase1_universal.py`.

### Frontend

**File:** `frontend/src/components/StreamingReadiness.tsx`

Locate the `platforms` array (or equivalent data structure that drives the table rows). Add the following entry:

```tsx
{ name: "Beatport", target: -9.0, icon: "🎧" },
```

Ensure it is inserted in a logical position in the list — recommended placement is before Spotify (which targets −14.0 LUFS) since Beatport is louder and should appear first in the loudness hierarchy, or group alphabetically if that is the existing convention.

No other changes needed — the existing row rendering, pass/fail comparison, and color logic already handle any entry in the array.

## Tasks

### Task 1: Add Beatport platform row
- [ ] Open `frontend/src/components/StreamingReadiness.tsx`
- [ ] Locate the `platforms` array definition
- [ ] Add `{ name: "Beatport", target: -9.0, icon: "🎧" }` in the appropriate position
- [ ] Save and verify hot-reload shows the new row in the dev environment

### Task 2: Verify rendering
- [ ] Run the frontend dev server (`npm run dev` or `vite`)
- [ ] Load a completed analysis report that has `integrated_lufs` in the result
- [ ] Confirm the Beatport row appears with the correct target, measured value, and pass/fail state
- [ ] Test with a loud track (−9 LUFS) → should PASS
- [ ] Test with a quiet track (−14 LUFS) → should FAIL

## Validation

- [ ] Beatport row visible in StreamingReadiness table for all completed analysis results
- [ ] Pass/fail state matches expectation based on `integrated_lufs` value in the JSON response
- [ ] No console errors introduced; existing rows unaffected
- [ ] Mobile layout renders without overflow or truncation

## Anti-Patterns

- Do not hardcode the pass/fail threshold comparison specifically for Beatport — reuse the existing generic tolerance logic
- Do not add a new API call or modify `AnalysisResult` schema; LUFS is already returned
- Do not change the target to −8.0 or −10.0 — Beatport's documented standard is −9.0 LUFS integrated
