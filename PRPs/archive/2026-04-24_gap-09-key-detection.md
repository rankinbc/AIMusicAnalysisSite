# PRP: GAP-09 — Musical Key Detection

**Status:** Draft  
**Effort:** ~1 hour  
**Phase:** v1.1 — DJ and producer metadata

---

## Goal

Detect the musical key of the uploaded track using `librosa.feature.chroma_cqt` in `phase1_universal.py` and display it in the report header alongside BPM.

## Why

- MixAnalytic reports musical key; its absence is a gap for DJ-oriented users who rely on harmonic mixing
- librosa is already a dependency — no new packages required
- Key + BPM together form a "track metadata" header that makes reports immediately useful

## What

### Backend

**File:** `analysis/phase1_universal.py`

Ensure `audio_mono` (mono float32 array) is available. If not already computed, derive it:

```python
if audio.ndim > 1:
    audio_mono = librosa.to_mono(audio)
else:
    audio_mono = audio
```

Add the key detection block after BPM detection (reuse the same `sr` variable from `librosa.load()`):

```python
# Musical key detection via constant-Q chromagram
chroma = librosa.feature.chroma_cqt(y=audio_mono, sr=sr)
chroma_mean = chroma.mean(axis=1)          # shape: (12,) — one value per pitch class
key_idx = int(np.argmax(chroma_mean))
key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
detected_key = key_names[key_idx]
```

Add to the return dict:

```python
return {
    # ... existing keys ...
    "detected_key": detected_key,
}
```

### Frontend

**File:** Wherever BPM is displayed in the report header (likely `ReportPage.tsx` or a `TrackMetadata` component).

Add the key display adjacent to BPM:

```tsx
<div className="flex gap-6 items-center">
  {/* Existing BPM display */}
  <div>
    <span className="text-3xl font-bold">{result.bpm?.toFixed(1)}</span>
    <span className="text-gray-400 ml-1 text-sm">BPM</span>
  </div>
  {/* New key display */}
  <div>
    <span className="text-3xl font-bold">{result.detected_key ?? '—'}</span>
    <span className="text-gray-400 ml-1 text-sm">Key</span>
  </div>
</div>
```

Update the TypeScript result type to include `detected_key: string | null`.

## Tasks

### Task 1: Backend — compute key from chromagram
- [ ] Open `analysis/phase1_universal.py`
- [ ] Verify that `audio_mono` (mono float32) and `sr` (sample rate integer) are available in scope
- [ ] If `audio` is stereo (shape `(2, N)` or `(N, 2)`), add `audio_mono = librosa.to_mono(audio)` — note librosa's convention is `(channels, samples)` shape
- [ ] Add the `chroma_cqt` computation block
- [ ] Add `detected_key` to the return dict
- [ ] Run the pipeline on a test file and confirm `detected_key` appears in the output JSON as a string like "A" or "F#"

### Task 2: Frontend — display key in report header
- [ ] Identify the component that currently displays BPM in the report header
- [ ] Add `detected_key: string | null` to the TypeScript result interface
- [ ] Add the key display element adjacent to BPM using the code above
- [ ] Handle `null` case with "—" fallback (for analyses run before this feature was added)
- [ ] Verify the layout looks balanced with both BPM and Key displayed

### Task 3: Verify accuracy on known tracks
- [ ] Run the analysis on 3–5 tracks with known keys
- [ ] Compare detected key against known key — expect roughly correct results for tonal tracks
- [ ] Note that the pitch class detection has no major/minor distinction in this implementation

## Validation

- [ ] `detected_key` key present in `final_json` for all newly analyzed tracks
- [ ] Value is one of the 12 chromatic pitch class names
- [ ] Key displayed in report header alongside BPM
- [ ] `null` handled gracefully in the frontend (shows "—")
- [ ] Pipeline runtime increase is acceptable (< 3 seconds for a 5-minute track at 44100 Hz)

## Anti-Patterns

- Do not use `chroma_stft` — `chroma_cqt` is more pitch-accurate for tonal music
- Do not hardcode `sr=44100` — use the actual sample rate returned by `librosa.load()`
- Do not pass stereo audio to `chroma_cqt` — it requires mono; use `librosa.to_mono()` first
- Do not attempt major/minor mode detection in this PR — pitch class detection is sufficient for v1.1; Krumhansl-Schmuckler mode detection can be added in v1.2
- Do not add `detected_key` as a dedicated DB column if `final_json` is already a JSONB column — store it in the JSON dict
