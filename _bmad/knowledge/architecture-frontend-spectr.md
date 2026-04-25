# Architecture — components/frontend-spectr

React 18 + Vite 6 SPA (JavaScript, no TypeScript). Alternate frontend. State-machine architecture in a single App.jsx — no React Router. Proxies `/api` to `localhost:8080`. Richer visual design with SVG animations, Web Audio waveform, and sticky audio player.

## Entry Point (main.jsx)

`ReactDOM.createRoot('#root').render(<App />)` — standard React 18 setup.

---

## App.jsx — State Machine

Four pages; transitions driven by App state:

```
'login' ──(login success)──→ 'upload'
'upload' ──(job started)──→ 'processing'
'processing' ──(SSE complete)──→ 'results'
'processing' ──(SSE error/401)──→ 'upload' (or 'login')
'results' ──(back button)──→ 'upload'
```

**State variables:**
| Variable | Type | Purpose |
|----------|------|---------|
| page | string | Current page (login/upload/processing/results) |
| file | File \| null | Selected audio file |
| jobId | string \| null | Celery job ID from upload |
| resultData | object \| null | Adapted result from API |
| streamError | string \| null | Error toast message |

**Initial page:** `getToken() ? 'upload' : 'login'` (localStorage token check)

**Key handlers:**
- `handleLogin()` → page = 'upload'
- `handleLogout()` → clears token + all state, page = 'login'
- `handleJobStarted(id)` → stores jobId, page = 'processing'
- `handleComplete()` → `getJobResults(jobId)` → `adaptResult()` → page = 'results'
- `handleStreamError(err)` → 401? logout; else show error toast, page = 'upload'
- `handleBack()` → clears jobId/resultData, page = 'upload'

**StickyPlayer** renders alongside ResultsPage when `file` is present.

---

## api/client.js — API Integration

**Token storage:** `localStorage['spectr_token']` (no httpOnly cookie — different from main frontend).

**Request wrapper:** Auto-injects Bearer token; throws on 401 (auto-clears token); throws on !ok.

### Authentication
- `login(email, password)` → POST `/auth/login`
- `register(email, password)` → POST `/auth/register`

### File Upload (XHR)
- `uploadTrack(file, refFile, onProgress)` → Promise
- FormData: `file`, optional `reference`, `track_name` (filename without extension)
- XHR progress callback: `xhr.upload.onprogress = e => onProgress(e.loaded/e.total)`
- Returns `job_id` on success

### Results Fetching
- `getJobResults(jobId)` → GET `/jobs/{jobId}/results`

### SSE Streaming
- `streamJob(jobId, onPhase, onComplete, onError)` → cleanup function
- URL: `/jobs/{jobId}/stream?token={token}`
- Listens: `onmessage` → `onPhase(data)`, `complete` event → `onComplete()`, `error` → `onError()`
- Returns `() => es.close()` for cleanup

---

## api/adapter.js — Data Transformation

Transforms raw `AnalysisResult.final_json` into a normalized display schema. Input: raw API result + filename. Output: 11-key object.

| Key | Content |
|-----|---------|
| `track` | `{name, sub}` — track name + "Duration · Key · BPM" subtitle |
| `grade` | Letter grade string |
| `score` | 0–100 numeric score |
| `genre` | `{name, confidence}` — capitalized genre + confidence % |
| `fixes` | Top 3 `{rank, sev, title, body, badge, diff}` recommendations |
| `loudness` | `{integrated, truePeak, dynamicRange, rms}` in LUFS/dBFS/LU/dB |
| `streaming` | 4 platforms × `{p, target, yours}` — Spotify/Apple/YouTube/Tidal |
| `frequency` | `{clarity, label, bands[]}` — 7 normalized bands + clarity score |
| `stereo` | `{width, correlation, monoSafe}` |
| `tranceDNA` | `{overall, parts[]}` — genre DNA sub-scores with colors |
| `clashes` | `[{a, b, range, pct, sev, fix}]` — stem clashes |
| `arrangement` | `{score, sections, issues}` |
| `gap` | `[{n, pct, sev, note}]` — percentile vs genre reference |

**Key transformations:**
- Phase lookup: extracts p1 (phase 1), p2, p3, p4, p6, p7 from phases array
- Frequency normalization: `(v - min) / (max - min)` per band
- Clarity score: `presence * 0.6 + air * 0.4` normalized
- DNA colors: 80+ → green, 60–79 → violet, 40–59 → amber, <40 → orange
- Fallbacks for missing data (LUFS defaults to -14, BPM to 120)

---

## Component Inventory

### LoginPage.jsx

**Props:** `onLogin()`

- Toggle sign-in / create-account mode
- Calls `client.login()` or `client.register()`
- EQLoader animation in header

### UploadPage.jsx

**Props:** `file, setFile, onJobStarted(jobId), onLogout`

**State:** genre, hasRef, refFile, dragging, uploading, uploadPct, error

- Drag-drop zone accepting `.wav, .mp3, .aiff, .flac, .aif`
- `useWaveform(file, 90)` for live waveform preview
- Genre selector: Trance | House | Techno | D&B | Other (pill buttons)
- Optional reference track toggle
- Upload progress bar (cyan, 3px)

### ProcessingPage.jsx

**Props:** `file, jobId, onComplete(), onError(err)`

- Calls `client.streamJob()` for SSE subscription
- Overall progress: `(completedPhases + phasePct/100) / totalPhases * 100`
- Phase checklist: ✓ completed, spinner active, dot pending
- EQLoader animation (12 bars, 56px)
- Cleanup: unsubscribes SSE on unmount

**PHASE_NAMES array:** 7 standard phase names matching backend.

### ResultsPage.jsx

**Props:** `data` (adapted), `onBack()`

Renders all 8 ResultsSections in cascading fade-up animations (0.1s stagger):
ScoreRing + FixCards → LoudnessStats → StreamingTable → FrequencyBars → StereoCard → TranceDNA → StemClashes → ArrangementSection → GapAnalysis

### ScoreRing.jsx

**Props:** `score, grade`

- 180×180px SVG animated circle
- Stroke-dashoffset animation (0 → score) with 1.3s cubic-bezier easing
- Drop-shadow glow matching grade color (A=green, B=cyan, C=yellow, D=orange)

### StickyPlayer.jsx

**Props:** `file`

- `URL.createObjectURL(file)` → audio src (revoked on unmount)
- `useWaveform(file, 220)` for 220-bar interactive waveform scrubber
- Click to seek; cyan highlighted bars show progress
- Volume slider + time display
- Fixed bottom, frosted glass (blur + 97% opacity)

### ResultsSections.jsx (9 exported components)

All receive `data` object (adapted result). Stateless presentation:

| Component | Renders |
|-----------|---------|
| FixCard | Severity badge, colored border, title + body + badges |
| LoudnessStats | 4-column: LUFS, True Peak, Dyn Range, RMS |
| StreamingTable | 4 platforms, target vs actual LUFS, pass/fail bar |
| FrequencyBars | 7 bars, normalized height, warning markers |
| StereoCard | Width %, correlation, mono-safe indicator |
| TranceDNA | Genre DNA sub-scores as horizontal bars with color coding |
| StemClashes | Clash cards with severity + overlap % + fix |
| ArrangementSection | Section timeline (if available) + violations list |
| GapAnalysis | Percentile bars per feature vs genre reference |

### primitives.jsx

Utility exports used across components:
- `card(extra)` → card style object
- `sevColor(s)` → hex (critical=red, warning=orange, ok=cyan)
- `sevBg(s)` → background color
- `gradeColor(g)` → hex (A=green, B=cyan, C=yellow, D=orange)
- `Label` component — monospace uppercase labels
- `WaveformSVG` — static 36-bar SVG placeholder
- `EQLoader` — animated EQ bars (staggered timing)

---

## hooks/useWaveform.js

```javascript
useWaveform(file: File | null, numBars: number = 200)
  → { waveform: number[] | null, loading: boolean }
```

1. FileReader reads file as ArrayBuffer
2. `AudioContext().decodeAudioData()` → get channel 0 data
3. Divide into `numBars` blocks; find peak amplitude per block
4. Normalize peaks to [0, 1]
5. Fallback on decode error: synthetic sine waveform

---

## Build Configuration

**vite.config.js:**
```javascript
server: { port: 5174 }
proxy: { '/api': { target: 'http://localhost:8080', rewrite: remove_api_prefix } }
```

**Note:** Proxy target is `8080`, not `8000`. If the main API is on 8000, this frontend needs to either update the proxy target or the API must run on 8080.

---

## Key Differences from Main Frontend

| Aspect | frontend (React 19) | frontend-spectr (React 18) |
|--------|--------------------|-----------------------------|
| Routing | React Router 7 | Single-file state machine |
| TypeScript | Yes (strict) | No (JavaScript) |
| Auth storage | React state only | localStorage |
| Token refresh | Auto via Axios interceptor | Manual (no silent refresh) |
| API client | Axios + interceptors | Raw fetch/XHR wrapper |
| Proxy port | localhost:8000 | localhost:8080 |
| Dev port | 5173 | 5174 |
| Waveform player | None | StickyPlayer (Web Audio API) |
| Animation | Tailwind + Recharts | Inline SVG + custom CSS |
| Genre DNA | Not visualized | TranceDNA component |
