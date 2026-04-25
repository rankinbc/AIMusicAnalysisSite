# PRP: GAP-08 — Prominent 0–100 Score Display

**Status:** Draft  
**Effort:** < 15 minutes  
**Phase:** v1.1 — UI/UX quick wins

---

## Goal

Display `overall_score` as a large, bold 0–100 integer prominently in `MixScore.tsx` so producers immediately see their numeric grade when the report loads.

## Why

- TrackScore.AI built their brand around a prominent score; producers expect and respond to a single number
- `overall_score` is already computed — this is two lines of JSX with no logic changes
- A large number drives screenshots and social sharing, which drives word-of-mouth growth

## What

### Backend

No changes required. `overall_score` (float 0.0–1.0) is already present in the pipeline result and returned in the analysis JSON.

### Frontend

**File:** `frontend/src/components/MixScore.tsx`

Add a large score display to the component. Two options depending on the current RadialBar layout:

**Option A — Number centered inside the RadialBar arc:**

```tsx
<div className="relative">
  <RadialBarChart /* existing props */ >
    {/* existing RadialBar */}
  </RadialBarChart>
  {/* Centered overlay */}
  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
    <div className="text-6xl font-bold" style={{ color: scoreColor(result.overall_score) }}>
      {Math.round(result.overall_score * 100)}
    </div>
    <div className="text-xl text-gray-400">/ 100</div>
  </div>
</div>
```

**Option B — Number displayed above or below the RadialBar:**

```tsx
<div className="flex flex-col items-center gap-4">
  <div className="text-6xl font-bold" style={{ color: scoreColor(result.overall_score) }}>
    {Math.round(result.overall_score * 100)}
  </div>
  <div className="text-2xl text-gray-400">/ 100</div>
  {/* existing RadialBar */}
</div>
```

**Color helper function** (add near the top of the file or in a shared utils file):

```tsx
const scoreColor = (score: number): string => {
  const s = score * 100;
  if (s >= 80) return '#22c55e';  // green-500
  if (s >= 60) return '#eab308';  // yellow-500
  if (s >= 40) return '#f97316';  // orange-500
  return '#ef4444';               // red-500
};
```

## Tasks

### Task 1: Add large score number to MixScore.tsx
- [ ] Open `frontend/src/components/MixScore.tsx`
- [ ] Inspect the current RadialBar layout to determine whether Option A (overlay) or Option B (stacked) is more appropriate
- [ ] Add the score number JSX using `Math.round(result.overall_score * 100)`
- [ ] Add the "/ 100" label as secondary text
- [ ] Add the `scoreColor` helper function
- [ ] Apply `scoreColor(result.overall_score)` to the score number's text color
- [ ] Save and verify in the dev environment

### Task 2: Verify rendering
- [ ] Load a completed analysis report in the dev environment
- [ ] Confirm the large number is visible and prominent
- [ ] Confirm the color matches the expected tier (green for 80+, yellow for 60–79, etc.)
- [ ] Test on mobile viewport — confirm the number is readable without horizontal scroll
- [ ] Confirm the existing RadialBar chart still renders correctly

## Validation

- [ ] Score displays as an integer 0–100 (not a decimal, not 0.0–1.0)
- [ ] Score matches `Math.round(result.overall_score * 100)` exactly
- [ ] Color coding: green (≥80), yellow (60–79), orange (40–59), red (<40)
- [ ] RadialBar chart unaffected
- [ ] Mobile layout renders without overflow

## Anti-Patterns

- Do not display `overall_score` raw (0.0–1.0) — always multiply by 100 and round
- Do not remove the RadialBar chart — the number augments it, does not replace it
- Do not use `toFixed(0)` instead of `Math.round()` — `Math.round` is cleaner for this use case
- Do not hardcode the score value — always read from `result.overall_score`
