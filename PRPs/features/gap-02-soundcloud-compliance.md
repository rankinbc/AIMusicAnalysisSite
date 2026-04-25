# PRP: GAP-02 — SoundCloud Streaming Compliance Row

**Status:** Draft  
**Effort:** < 15 minutes  
**Phase:** v1.1 — Quick wins / parity features

---

## Goal

Add a SoundCloud row to the StreamingReadiness component so producers uploading to SoundCloud can verify their master meets the −14.0 LUFS normalization target.

## Why

- SoundCloud is the primary promo/demo platform for independent EDM producers; it is conspicuously absent from the current platform list
- Mix Check Studio includes this check; we need parity
- Zero backend cost — `integrated_lufs` already exists in the analysis result

## What

### Backend

No changes required. `integrated_lufs` is already present in `AnalysisResult.final_json`.

### Frontend

**File:** `frontend/src/components/StreamingReadiness.tsx`

Add the following entry to the `platforms` array:

```tsx
{ name: "SoundCloud", target: -14.0, icon: "☁️" },
```

Recommended placement: group with other −14.0 LUFS platforms (Spotify, Apple Music) or insert alphabetically. The existing row-rendering and pass/fail logic handles this automatically.

## Tasks

### Task 1: Add SoundCloud platform row
- [ ] Open `frontend/src/components/StreamingReadiness.tsx`
- [ ] Locate the `platforms` array
- [ ] Add `{ name: "SoundCloud", target: -14.0, icon: "☁️" }` in the appropriate position
- [ ] Save and verify the row appears in the dev environment

### Task 2: Verify rendering and logic
- [ ] Load a completed analysis result in the dev environment
- [ ] Confirm the SoundCloud row renders with target −14.0 LUFS and the measured value
- [ ] Confirm a track at −14.0 LUFS shows PASS
- [ ] Confirm a track at −8.0 LUFS shows FAIL (too loud for SoundCloud normalization)
- [ ] Verify no regressions on adjacent rows (Spotify, Apple Music)

## Validation

- [ ] SoundCloud row visible on all completed analysis reports
- [ ] Pass/fail state accurately reflects integrated LUFS vs −14.0 target
- [ ] Layout intact on both desktop and mobile
- [ ] No TypeScript type errors introduced

## Anti-Patterns

- Do not duplicate the comparison logic — reuse whatever generic threshold function already drives the other platform rows
- Do not set the target to −16.0; SoundCloud's normalization reference is −14.0 LUFS integrated
- Do not add a backend route or database field; this is purely a frontend addition
