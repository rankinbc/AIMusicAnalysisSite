# Component Inventory — components/frontend-spectr

React 18 + Vite 6, JavaScript (no TypeScript). Alternate frontend with richer visual design, Web Audio waveform, sticky audio player, and state-machine routing.

## Entry & Core

| File | Purpose |
|------|---------|
| `src/main.jsx` | ReactDOM.createRoot('#root') renders App |
| `src/App.jsx` | State machine; 4 pages; all inter-page logic |
| `src/api/client.js` | Token mgmt, XHR upload, SSE streaming, fetch wrapper |
| `src/api/adapter.js` | Transforms raw API result → display schema |

---

## Pages / Top-Level Components

### LoginPage.jsx

**Props:** `onLogin()`

**State:** `mode ('login'|'register'), email, password, loading, error`

**Behavior:**
- Toggle between sign-in and create-account modes
- Calls `client.login()` or `client.register()`
- On success: calls `onLogin()` (App transitions to 'upload')
- Error display: `response.detail` or generic message

**Visual:** EQLoader animation in header; cyan themed card form.

---

### UploadPage.jsx

**Props:** `file, setFile(f), onJobStarted(jobId), onLogout()`

**State:** `genre, hasRef, refFile, dragging, uploading, uploadPct, error`

**Hooks:** `useWaveform(file, 90)` → waveform for file preview

**Accepted formats:** `.wav, .mp3, .aiff, .flac, .aif`

**Behavior:**
- Drag-drop zone with drag-over visual feedback (cyan dashed border)
- File selected → `setFile(f)` + live waveform preview
- Genre selector: Trance, House, Techno, D&B, Other (pill buttons)
- Optional reference track (toggle)
- On submit: `client.uploadTrack(file, refFile, onProgress)` → `onJobStarted(job_id)`
- Progress bar: 3px cyan, percentage text

---

### ProcessingPage.jsx

**Props:** `file, jobId, onComplete(), onError(err)`

**State:** `phases (completed array), currentPhase (1–7), currentName, phasePct`

**Behavior:**
- Subscribes to `client.streamJob(jobId, onPhase, onComplete, onError)` on mount
- Cleanup: calls returned cleanup function on unmount
- `onPhase(data)`: updates currentPhase, currentName, phasePct; pushes to phases when phase changes
- `onComplete()`: calls `onComplete()` prop (App fetches results, transitions to 'results')

**Progress calculation:** `(completedPhases.length + phasePct/100) / 7 * 100`

**Visual:**
- EQLoader animation (12 bars, 56px tall)
- Phase list: ✓ (completed), spinner (active), dot (pending)
- Pending phases at reduced opacity

---

### ResultsPage.jsx

**Props:** `data` (adapted result object), `onBack()`

**Structure:**
- Sticky nav: back button + genre badge + track metadata (duration, key, BPM)
- Hero: track name title + subtitle
- ScoreRing + top 3 FixCards
- 8 ResultsSections with cascading fade-up animations (0.1s stagger)

---

## Visual Components

### ScoreRing.jsx

**Props:** `score: number (0–100), grade: string`

**State:** `active` (triggered after mount for animation)

**SVG specs:** 180×180px, `r=76`, `circumference = 2*π*76 ≈ 477.5`

**Animation:**
- `stroke-dashoffset`: start at circumference (empty), animate to `circumference * (1 - score/100)`
- Duration: 1.3s, `cubic-bezier(0.23, 1, 0.32, 1)` easing
- Glow: `drop-shadow(0 0 12px {gradeColor(grade)})` filter

**Grade colors:** A → `#22c55e`, B → `#06b6d4`, C → `#eab308`, D → `#f97316`

---

### StickyPlayer.jsx

**Props:** `file: File`

**State:** `playing, currentTime, duration, volume, audioUrl`

**Hooks:** `useWaveform(file, 220)` → 220-bar waveform for scrubber

**Behavior:**
- Creates blob URL from File on mount; revokes on unmount
- `<audio>` element listens to: `timeupdate`, `loadedmetadata`, `ended`
- Click on waveform bar → seek to `(barIndex / 220) * duration`
- Bars highlighted up to current position (cyan vs white)

**Layout:** Fixed bottom, full viewport width, dark frosted glass (backdrop-filter blur + 97% opacity).

---

## ResultsSections.jsx — 9 Exported Components

All stateless, receive `data` object (adapted result).

### FixCard

**Props:** `fix: {rank, sev, title, body, badge, diff}, i: number`

- Left border + background tint colored by `sevColor(sev)` / `sevBg(sev)`
- Severity badge: CRITICAL (red), WARNING (orange), OK (cyan)
- Optional "+8 pts" and "Medium" difficulty badges
- Fade-up animation with `i * 0.1s` delay

---

### LoudnessStats

Displays 4 stats in a row:
| Stat | Source | Color |
|------|--------|-------|
| Integrated LUFS | `data.loudness.integrated` | Red (warning) |
| True Peak dBFS | `data.loudness.truePeak` | Cyan |
| Dynamic Range LU | `data.loudness.dynamicRange` | Cyan |
| RMS dB | `data.loudness.rms` | Cyan |

Monospace 26px font for values.

---

### StreamingTable

4 platforms (Spotify -14, Apple Music -16, YouTube -14, Tidal -14):
- Visual horizontal bar: green if LUFS ≤ target, red if over
- Shows target and actual LUFS values
- PASS/FAIL indicator

---

### FrequencyBars

**Data:** `data.frequency.bands` (7 items, normalized 0–1 height)

- Bar colors: cyan normally, orange if `warn=true` (>0.9 normalized = potential boost)
- ▲ marker on warned bands
- Labels: name + Hz range (Sub 20–60Hz, Bass 60–250Hz, etc.)
- Gradient fill, fade-in-up animations with stagger

---

### StereoCard

3-column layout:
- Stereo Width: `(data.stereo.width).toFixed(0)%`
- Correlation: `(data.stereo.correlation).toFixed(2)` + "healthy phase" / "phase issues" note
- Mono Safe: ✓ / ✗ based on `data.stereo.monoSafe`

---

### TranceDNA

**Header:** "{genre.name} DNA" + overall score

**Parts:** Each DNA sub-component (e.g., "Melodic Richness"):
- Horizontal bar, width = score%
- Colors: 80+ → green, 60–79 → violet, 40–59 → amber, <40 → orange

---

### StemClashes

If `data.clashes.length === 0`: "No significant stem clashes detected"

Per clash card:
- Stem A vs Stem B header + frequency range badge
- Severity indicator: "SEVERE" (red) or "MODERATE" (orange)
- `{pct}% overlap` bar (width = pct%)
- Fix recommendation in cyan box

---

### ArrangementSection

**Score:** `100 - (data.arrangement.issues.length * 15)`, 0–100

**Timeline** (if `data.arrangement.sections.length > 0`):
- Horizontal stacked bars proportional to section length
- Colors: intro → slate, buildup → cyan, drop → orange, breakdown → violet, outro → gray
- Orange dot flag on sections with issues

**Issues list:** Each violation with ▲ marker.

**Empty state:** "No arrangement issues detected" (green check).

---

### GapAnalysis

**Header:** "Genre Profile Ranking" subtitle

Per gap row:
- Feature name + percentile bar (0–100% width)
- Bar color: pct < 30 → red, 30–55 → orange, > 55 → cyan
- Label: "top 30%", "mid range", "bottom half", "bottom 30%"
- Severity badge

---

## primitives.jsx — Style Utilities

```javascript
card(extra = {})           // Base card style object
sevColor(s) → hex          // critical/warning/ok → color
sevBg(s) → hex             // critical/warning/ok → background
gradeColor(g) → hex        // A/B/C/D → color
<Label>                    // Monospace uppercase label component
<WaveformSVG>              // Static 36-bar SVG placeholder
<EQLoader>                 // Animated EQ bars (login/processing)
```

---

## hooks/useWaveform.js

```javascript
useWaveform(file, numBars = 200) → { waveform: number[] | null, loading: boolean }
```

1. FileReader → ArrayBuffer
2. `AudioContext().decodeAudioData()` → channel 0
3. Blockwise peak normalization to [0, 1] across `numBars` blocks
4. Fallback: synthetic sine waveform if decode fails

Used in UploadPage (90 bars preview) and StickyPlayer (220 bars scrubber).

---

## Data Flow Summary

```
App (state machine)
  ↓ props
LoginPage → client.login/register → setToken(localStorage)
  ↓
UploadPage → client.uploadTrack (XHR + progress) → jobId
  ↓
ProcessingPage → client.streamJob (SSE) → onPhase/onComplete
  ↓ App calls
client.getJobResults(jobId) → adapter.adaptResult() → resultData
  ↓
ResultsPage (adapter output) + StickyPlayer (file)
```

---

## Configuration

**package.json:**
- React 18.3.1 + ReactDOM
- Vite 6.0 + @vitejs/plugin-react 4.3.4
- No Axios, no TypeScript, no router libraries

**vite.config.js:**
```javascript
server: { port: 5174 }
proxy: { '/api': { target: 'http://localhost:8080' } }
```

Note: proxy targets `8080`, not `8000`. Update if API runs on 8000.
