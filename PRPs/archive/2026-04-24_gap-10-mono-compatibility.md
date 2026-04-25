# PRP: GAP-10 — Mono Compatibility Check

**Status:** Draft  
**Effort:** ~1 hour  
**Phase:** v1.1 — Audio quality metrics

---

## Goal

Compute a mono compatibility score (0.0–1.0) in `phase1_universal.py` by comparing the RMS energy of the stereo-summed mono signal to the original stereo RMS, and display it as a percentage gauge in the report.

## Why

- Club PAs, Bluetooth speakers, and mobile devices often play in mono — phase cancellation in a stereo mix causes audible level and tonal loss
- MixAnalytic surfaces this check; producers mastering for club/electronic distribution expect it
- Pure numpy computation on already-loaded audio — no new dependencies

## What

### Backend

**File:** `analysis/phase1_universal.py`

This check requires stereo audio. Determine how the pipeline currently loads audio:

- If `librosa.load(..., mono=False)` is used, `audio` has shape `(channels, samples)` — use it directly.
- If `librosa.load(..., mono=True)` (default), the stereo information is already lost. In this case, load a second time with `mono=False` at the top of the phase function specifically for stereo-dependent checks (mono compat, stereo width).

```python
# Mono compatibility computation (requires stereo audio)
# audio shape: (2, N) for stereo, or (N,) for mono
if audio.ndim > 1 and audio.shape[0] >= 2:
    mono_sum = audio.mean(axis=0)  # average the two channels
    stereo_rms = float(np.sqrt(np.mean(audio ** 2)))
    mono_rms = float(np.sqrt(np.mean(mono_sum ** 2)))
    mono_compatibility = float(np.clip(mono_rms / (stereo_rms + 1e-9), 0.0, 1.0))
else:
    # Already mono — perfect compatibility by definition
    mono_compatibility = 1.0
```

Add to the return dict:

```python
return {
    # ... existing keys ...
    "mono_compatibility": mono_compatibility,
}
```

**Important note on librosa axis convention:** librosa's `load(..., mono=False)` returns shape `(channels, samples)`. `audio.mean(axis=0)` sums across channels (axis 0), leaving shape `(samples,)` — which is the mono sum. This is correct.

### Frontend

**File:** The component that renders stereo width or loudness gauges (likely `MixScore.tsx` or a dedicated `StereoSection` component).

Add a mono compatibility gauge using whatever gauge component already exists:

```tsx
<div className="flex flex-col items-center">
  <div
    className="text-3xl font-bold"
    style={{
      color: result.mono_compatibility >= 0.7
        ? '#22c55e'
        : result.mono_compatibility >= 0.5
        ? '#eab308'
        : '#ef4444'
    }}
  >
    {Math.round((result.mono_compatibility ?? 1.0) * 100)}%
  </div>
  <div className="text-sm text-gray-400 mt-1">Mono Compat</div>
  <div className="text-xs text-gray-500">
    {result.mono_compatibility >= 0.85 ? 'Excellent' :
     result.mono_compatibility >= 0.70 ? 'Good' :
     result.mono_compatibility >= 0.50 ? 'Check phase' : 'Phase issues'}
  </div>
</div>
```

## Tasks

### Task 1: Backend — determine audio loading strategy
- [ ] Open `analysis/phase1_universal.py`
- [ ] Check whether `librosa.load()` is called with `mono=False` or with default `mono=True`
- [ ] If `mono=True` (default): add a second load call at the top of the function specifically for stereo checks:
  ```python
  audio_stereo, _ = librosa.load(file_path, sr=sr, mono=False)
  ```
- [ ] If `mono=False` already: use the existing `audio` variable directly

### Task 2: Backend — add mono compatibility computation
- [ ] Add the mono compatibility block using the stereo audio array
- [ ] Confirm `audio.ndim > 1` guard handles already-mono inputs gracefully
- [ ] Add `"mono_compatibility"` to the return dict
- [ ] Test on a known stereo track — expect value > 0.7
- [ ] Test on a mono track or mono-summed test file — expect value = 1.0
- [ ] Test on a heavily out-of-phase test signal (e.g., `audio[1] = -audio[0]`) — expect value near 0.0

### Task 3: Frontend — display mono compatibility gauge
- [ ] Add `mono_compatibility: number | null` to the TypeScript result type
- [ ] Add the gauge display to the appropriate section of the report
- [ ] Implement color coding: green ≥ 70%, yellow 50–69%, red < 50%
- [ ] Add text label: "Excellent" / "Good" / "Check phase" / "Phase issues"
- [ ] Handle `null` fallback (for old analyses before this feature)

## Validation

- [ ] `mono_compatibility` key present in `final_json` for all newly analyzed tracks
- [ ] Value range is [0.0, 1.0] — no values outside this range
- [ ] Mono audio file → `mono_compatibility = 1.0`
- [ ] Heavily phase-cancelled test signal → `mono_compatibility` near 0.0
- [ ] Score displayed correctly in the report UI with color coding
- [ ] `null` values from pre-feature analyses render gracefully

## Anti-Patterns

- Do not use `audio.mean(axis=1)` — `axis=0` is the channel axis for librosa's `(channels, samples)` format; `axis=1` would average across time, which is wrong
- Do not skip the `audio.ndim > 1` guard — if audio is already mono-loaded, the check should return 1.0, not crash
- Do not omit the `1e-9` epsilon in the division — silence or near-silence will produce division by zero
- Do not run this computation on the mono-downmixed `audio_mono` variable — mono compat requires the original stereo signal
