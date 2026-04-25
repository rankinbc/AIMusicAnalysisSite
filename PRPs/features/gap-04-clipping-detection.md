# PRP: GAP-04 — Hard Clipping Detection (Master)

**Status:** Draft  
**Effort:** ~30 minutes  
**Phase:** v1.1 — Audio analysis parity

---

## Goal

Detect and report hard clipping on the master audio in `phase1_universal.py` and surface it as a "No Clipping" pass/fail row in the StreamingReadiness component.

## Why

- Every competitor (Mix Check Studio, LANDR, MixAnalytic) shows a clipping check; its absence undermines trust in the tool
- Clipping is the most common production error on loud masters — detecting it is table-stakes for any analysis tool
- Implementation is ~10 lines of numpy; no new dependencies

## What

### Backend

**File:** `analysis/phase1_universal.py`

After `audio` is loaded (as float32-normalized numpy array via librosa), add:

```python
# Master hard clipping detection
peak_dbfs = float(20 * np.log10(np.max(np.abs(audio)) + 1e-9))
clipping_detected = bool(np.any(np.abs(audio) >= 1.0))
clipped_sample_count = int(np.sum(np.abs(audio) >= 1.0))
```

Add to the return dict:

```python
return {
    # ... existing keys ...
    "peak_dbfs": peak_dbfs,
    "clipping_detected": clipping_detected,
    "clipped_sample_count": clipped_sample_count,
}
```

The `1e-9` epsilon in the log prevents a math domain error when audio is completely silent.

### Frontend

**File:** `frontend/src/components/StreamingReadiness.tsx`

Add a "No Clipping" row to the technical checks section. Unlike LUFS rows, this row passes on a boolean condition, not a numeric comparison:

```tsx
<Row
  label="No Clipping"
  icon="🔴"
  pass={!result.clipping_detected}
  measured={`${result.peak_dbfs?.toFixed(1)} dBFS`}
  detail={
    result.clipping_detected
      ? `${result.clipped_sample_count} clipped samples`
      : "Clean"
  }
/>
```

If the component uses a data-driven `platforms` array rather than JSX rows, add a handler in the render logic for boolean-type rows.

## Tasks

### Task 1: Backend — compute clipping metrics
- [ ] Open `analysis/phase1_universal.py`
- [ ] Identify where `audio` is loaded (the librosa-loaded float32 array)
- [ ] Add the three clipping computation lines after audio load
- [ ] Add `peak_dbfs`, `clipping_detected`, `clipped_sample_count` to the return dict
- [ ] Run the analysis pipeline on a clean test file and confirm all three keys appear in output JSON with correct values (`clipping_detected: false`, `clipped_sample_count: 0`)
- [ ] Run on a known-clipped test file (can synthesize with numpy: `np.ones(44100)`) and confirm `clipping_detected: true`

### Task 2: Frontend — display No Clipping row
- [ ] Open `frontend/src/components/StreamingReadiness.tsx`
- [ ] Determine whether the component uses JSX rows or a data array
- [ ] Add the No Clipping row reading `result.clipping_detected`, `result.peak_dbfs`, `result.clipped_sample_count`
- [ ] Style PASS state green with "Clean" badge
- [ ] Style FAIL state red with clipped sample count displayed

### Task 3: Validate end-to-end
- [ ] Upload a clean master — verify No Clipping row shows PASS with peak level
- [ ] Upload a clipped master (or create a test fixture) — verify FAIL with sample count

## Validation

- [ ] `peak_dbfs`, `clipping_detected`, `clipped_sample_count` present in `final_json` for all analyses
- [ ] `clipping_detected: false` and `clipped_sample_count: 0` for unclipped audio
- [ ] `clipping_detected: true` and `clipped_sample_count > 0` for audio with samples at ±1.0
- [ ] No Clipping row visible in report UI with correct pass/fail state
- [ ] TypeScript: `result.clipping_detected` typed as `boolean` in the result type interface

## Anti-Patterns

- Do not check `audio > 1.0` — use `np.abs(audio) >= 1.0` to catch both positive and negative full-scale values
- Do not omit the `1e-9` epsilon in the log10 call — silent audio (max abs = 0) will raise a math domain error
- Do not skip this check if the audio format is unknown — librosa always returns float32 normalized to [−1, 1], so the ≥ 1.0 threshold is always correct for librosa-loaded audio
- Do not conflate `peak_dbfs` (sample peak) with `true_peak_db` (inter-sample true peak from GAP-03) — keep them as separate fields
