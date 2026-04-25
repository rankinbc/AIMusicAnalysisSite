# PRP: GAP-03 — True Peak (TP) Measurement

**Status:** Draft  
**Effort:** ~30 minutes  
**Phase:** v1.1 — Audio analysis parity

---

## Goal

Compute true peak (inter-sample peak) in `phase1_universal.py` using the already-imported `pyloudnorm` meter and expose it in the StreamingReadiness table as a pass/fail check against the −1.0 dBTP streaming limit.

## Why

- All three main competitors (Mix Check Studio, LANDR, MixAnalytic) report true peak; its absence is an immediate credibility gap for professional users
- Streaming distributors (DistroKid, TuneCore, CD Baby) reject files exceeding 0 dBTP; this is a hard production requirement
- `pyloudnorm` already provides the method — implementation is one line of Python

## What

### Backend

**File:** `analysis/phase1_universal.py`

After the existing `meter.integrated_loudness(audio_float)` call, add:

```python
# Inter-sample true peak — streaming platforms enforce < -1.0 dBTP
true_peak_db = float(meter.true_peak(audio_float))
```

Add `true_peak_db` to the function's return dict:

```python
return {
    # ... existing keys ...
    "true_peak_db": true_peak_db,
}
```

No new imports, no new dependencies. `pyloudnorm` is already imported and `meter` is already instantiated.

Verify `audio_float` is a float32/float64 numpy array normalized to [−1.0, 1.0]. If loaded via `librosa.load()` with default settings, this is already the case.

### Frontend

**File:** `frontend/src/components/StreamingReadiness.tsx`

The "True Peak" check is a technical limit rather than a platform target, so it may warrant its own section or a clearly labeled subsection. Two options:

**Option A** — Add as a platform row with inverted comparison logic:
```tsx
{ name: "True Peak", target: -1.0, unit: "dBTP", icon: "📊", passWhen: "below" }
```

**Option B** — Add a separate "Technical Limits" row group below the platform loudness rows, rendered with the same pass/fail badge but labeled differently.

If the `platforms` array currently only supports LUFS rows with a "pass when louder than target" assumption, implement Option B to avoid complicating the existing comparison logic.

The value to display comes from `result.true_peak_db` in the analysis JSON.

## Tasks

### Task 1: Backend — compute and return true peak
- [ ] Open `analysis/phase1_universal.py`
- [ ] Locate the `meter.integrated_loudness()` call
- [ ] Add `true_peak_db = float(meter.true_peak(audio_float))` immediately after
- [ ] Add `"true_peak_db": true_peak_db` to the return dict
- [ ] Confirm `audio_float` is float-normalized (check how `librosa.load()` is called; default returns float32 in [−1, 1])
- [ ] Run the analysis pipeline on a test file and confirm `true_peak_db` appears in the output JSON

### Task 2: Frontend — display True Peak row
- [ ] Open `frontend/src/components/StreamingReadiness.tsx`
- [ ] Determine whether the existing pass/fail logic supports `passWhen: "below"` or only compares LUFS targets
- [ ] If not supported, add a conditional branch or separate rendering block for true peak
- [ ] Add the True Peak row reading `result.true_peak_db`
- [ ] Display the value as `${result.true_peak_db.toFixed(1)} dBTP`
- [ ] PASS condition: `true_peak_db < -1.0`; FAIL condition: `true_peak_db >= -1.0`

### Task 3: Validate end-to-end
- [ ] Upload a known-loud file (master clipping near 0 dBFS) and verify FAIL is shown
- [ ] Upload a properly mastered file (true peak around −1.5 dBTP) and verify PASS

## Validation

- [ ] `true_peak_db` key present in `final_json` for all newly analyzed tracks
- [ ] True Peak row visible in report UI
- [ ] Pass/fail state correct: < −1.0 dBTP = PASS, ≥ −1.0 dBTP = FAIL
- [ ] Value displayed with unit "dBTP"
- [ ] Existing platform rows (Spotify, Apple Music, etc.) unaffected

## Anti-Patterns

- Do not confuse `meter.peak()` (sample peak) with `meter.true_peak()` (inter-sample peak) — they are different methods returning different values
- Do not set the pass threshold to 0.0 dBTP — the industry standard recommendation is −1.0 dBTP to provide headroom for format conversion
- Do not modify `AnalysisResult` SQLAlchemy model unless `final_json` is a JSONB/JSON column that stores the dict freely; if it is a flat column schema, add a migration for `true_peak_db: Float` column
- Do not run true peak on non-float audio without normalizing first — integer PCM will produce incorrect results
