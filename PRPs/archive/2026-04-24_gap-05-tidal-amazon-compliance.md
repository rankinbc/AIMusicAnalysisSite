# PRP: GAP-05 — Tidal and Amazon Music Streaming Rows

**Status:** Draft  
**Effort:** < 15 minutes  
**Phase:** v1.1 — Quick wins / platform coverage

---

## Goal

Add Tidal and Amazon Music rows to the StreamingReadiness component, expanding platform coverage from the current set to a comprehensive six-platform view with zero backend changes.

## Why

- Mix Check Studio covers more platforms; users comparing tools will notice missing services
- Tidal (audiophile audience) and Amazon Music (top-3 by subscribers) are both significant distribution targets
- Both platforms use −14.0 LUFS — implementation cost is two array entries

## What

### Backend

No changes required. `integrated_lufs` is already present in `AnalysisResult.final_json`.

### Frontend

**File:** `frontend/src/components/StreamingReadiness.tsx`

Add two entries to the `platforms` array:

```tsx
{ name: "Tidal", target: -14.0, icon: "🌊" },
{ name: "Amazon Music", target: -14.0, icon: "📦" },
```

Recommended placement: after Apple Music (also −14.0 LUFS) to keep same-target platforms grouped visually.

## Tasks

### Task 1: Add Tidal and Amazon Music rows
- [ ] Open `frontend/src/components/StreamingReadiness.tsx`
- [ ] Locate the `platforms` array
- [ ] Add `{ name: "Tidal", target: -14.0, icon: "🌊" }` after Apple Music entry
- [ ] Add `{ name: "Amazon Music", target: -14.0, icon: "📦" }` after Tidal entry
- [ ] Save and verify both rows appear in the dev environment

### Task 2: Verify rendering
- [ ] Load a completed analysis in the dev environment
- [ ] Confirm both Tidal and Amazon Music rows render with correct target and measured LUFS values
- [ ] Confirm PASS/FAIL state matches the existing Spotify/Apple Music rows (same target, same behavior)
- [ ] Test on mobile viewport — confirm table layout does not overflow with two additional rows

## Validation

- [ ] Tidal row visible in StreamingReadiness table
- [ ] Amazon Music row visible in StreamingReadiness table
- [ ] Both rows show correct PASS/FAIL based on integrated LUFS vs −14.0 target
- [ ] Existing six rows (or however many currently exist) unaffected
- [ ] No TypeScript errors

## Anti-Patterns

- Do not hardcode special comparison logic for these two platforms — they use the same generic LUFS comparison as existing rows
- Do not set either target to a value other than −14.0; both platforms use the EBU R128 standard
- Do not add backend API changes or database columns; this is a pure frontend addition
