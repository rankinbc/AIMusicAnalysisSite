# Architecture — components/frontend

React 19 + Vite 8 + TypeScript strict mode SPA. Feature-based folder structure under `src/features/`. Authentication via JWT (access token in React state, refresh token in httpOnly cookie).

## Route Tree (App.tsx)

```
/                           → redirect to /upload
/login                      → Login
/register                   → Register
/reports/share/:token       → SharedReportPage (public, no auth)
[ProtectedLayout]
  /upload                   → UploadPage
  /jobs/:id                 → JobProgressPage
  /jobs/:id/report          → ReportPage
  /history                  → HistoryPage
  /tracks                   → TrackHistoryPage
*                           → redirect to /upload
```

**AuthProvider** wraps the entire app. **ProtectedLayout** shows a spinner (not redirect) during silent refresh, then redirects to `/login` if no token.

---

## Authentication (contexts/AuthContext.tsx)

```typescript
interface AuthContextValue {
  accessToken: string | null
  isLoading: boolean
  login: (email, password) => Promise<void>
  logout: () => Promise<void>
  register: (email, password) => Promise<void>
}
```

**Silent refresh on mount:** `AuthProvider` attempts `POST /auth/refresh` on mount to exchange httpOnly cookie for access token. Sets `isLoading=true` until complete — prevents flash-of-redirect on page reload.

**Token storage:** Access token stored ONLY in React state (never localStorage — XSS protection). Refresh token is httpOnly cookie, never touched by JavaScript.

---

## API Client (lib/apiClient.ts)

```typescript
let accessToken: string | null = null
let isRefreshing = false
let refreshQueue: Array<(token: string | null) => void> = []
```

**Request interceptor:**
- Attaches `Authorization: Bearer {accessToken}`
- Sets `withCredentials: true` on every request (sends refresh cookie)

**Response interceptor (401 handling):**
1. First 401 (no `_retry` flag): set `_retry=true`, attempt token refresh
2. If `isRefreshing=true`: queue request, wait for in-flight refresh
3. On refresh success: replay all queued requests + original request
4. On refresh failure: clear token, redirect to `/login`, reject all queued

**Pattern:** Dual-interceptor with `isRefreshing` flag + request queue prevents multiple simultaneous refresh calls on concurrent 401s.

---

## Feature: Upload

### UploadPage.tsx

- Drag-drop zone (visual feedback on drag-over)
- File validation: `.mp3`, `.flac`, `.wav`, max 200 MB
- Optional reference track upload
- Optional track name (text input, for version tracking)
- Progress bar via `useFileUpload` hook
- Navigates to `/jobs/{jobId}` on success

### useFileUpload.ts

```typescript
upload: (file, referenceFile?, trackName?) => Promise<string>  // returns jobId
cancel: () => void
```

- Uses **XMLHttpRequest** (not Axios — Fetch API has no upload progress events)
- Registers `xhr.upload.addEventListener('progress', cb)` BEFORE `xhr.open()`
- FormData: `file`, optional `reference`, optional `track_name`
- Bearer token attached as header

---

## Feature: Analysis Progress

### JobProgressPage.tsx

- 7-phase animated checklist (completed/active/pending states)
- Uses `useJobStream` for SSE updates
- Auto-navigates to `/jobs/:id/report` after 500ms when `done=true`

### useJobStream.ts

```typescript
interface StreamState {
  phase: number; phaseName: string; pct: number
  status: string; done: boolean; error: string | null
}
```

- Opens `EventSource` to `/api/jobs/:jobId/stream?token={accessToken}`
- Token passed as query param — EventSource cannot set custom headers
- Listens for `message` (progress), `complete` (done), `error` events
- **Critical cleanup:** `eventSource.close()` in `useEffect` return to prevent dangling connections

---

## Feature: Report

### ReportPage.tsx

Fetches `GET /jobs/:id/results` → extracts phase data → renders 11 sections:

| Section | Component | Data Source |
|---------|-----------|-------------|
| Score + fixes | MixScore | `overall_score`, `grade`, `top_fixes` |
| Coach tips | CoachPanel | `coach_name`, `coach_intro`, `coached_fixes` |
| Streaming check | StreamingReadiness | Phase 1: `lufs`, `true_peak_db`, `clipping_detected` |
| Frequency | FrequencyChart | Phase 1: `bands` |
| Stereo | StereoGauges | Phase 1: `stereo_correlation`, `stereo_width` |
| Stem clashes | StemClash | Phase 4: `clashes` |
| Reference delta | ReferenceComparison | Phase 5: `deltas` |
| Genre radar | GenreRadar | Phase 6: `gaps`, `percentile` |
| Arrangement | ArrangementAdvisor | Phase 7: `violations`, `fixes` |
| AI experts | ExpertsPanel | Claude triage + specialists |
| Metadata bar | (inline) | Phase 1: `bpm`, `detected_key`, `mono_compatibility` |

**Sharing:** Copy Link button generates `/reports/share/{share_token}` URL (public, no auth).

### Report Sub-Components

**MixScore.tsx** — Large letter grade badge + numeric score + top 3 fixes. Color-coded: A=green, B=lime, C=yellow, D=orange, F=red.

**StreamingReadiness.tsx** — Table: platform | target LUFS | actual LUFS | pass/fail badge. Platforms: Spotify (-14), Apple Music (-16), YouTube (-14), Tidal (-14), Amazon Music (-14), SoundCloud (-8), Beatport (-9). Conditionally renders True Peak row (pass if < -1.0 dBTP) and Clipping row.

**FrequencyChart.tsx** — Recharts `BarChart`, 7 bands, color-coded: orange (>-10 dB hot), gray (<-40 dB quiet), indigo (balanced).

**StemClash.tsx** — Clash table; severity badges: high=red, medium=orange, low=yellow.

**ReferenceComparison.tsx** — Color-coded by severity: ok=green, minor=yellow, moderate=orange, significant=red.

**GenreRadar.tsx** — Recharts `RadarChart`, user_val vs genre_mean per feature; genre badge + percentile rank.

**ArrangementAdvisor.tsx** — Violations with warning icon + numbered fixes. Shows "no issues" if both empty.

**CoachPanel.tsx** — Coach avatar (first letter) + intro quote + numbered fix list.

---

## Feature: Expert Analysis

### ExpertsPanel.tsx → useExpertAnalysis.ts

```typescript
runTriage: () => Promise<void>
runSpecialist: (name: SpecialistName) => void
cancelSpecialist: (name: SpecialistName) => void

// State
triage: TriageResult | null
specialistOutputs: Partial<Record<SpecialistName, string>>
specialistLoading: Partial<Record<SpecialistName, boolean>>
```

**Triage:** `POST /experts/:jobId/triage` → returns markdown text + recommended specialists list.

**Specialist streaming:** `POST /experts/:jobId/specialist/:name` with `Accept: text/event-stream`. Uses **Fetch API** (not Axios — needs `ReadableStream`). Manual SSE line parsing. AbortController per specialist for cancellation.

**UI flow:** Run Triage → TriageView shows recommended specialists as SpecialistCards → each card streams output independently.

---

## Pages

### HistoryPage.tsx (`/history`)

- Fetches `GET /jobs`
- Table: File | Status | Score | Grade | Date | Action
- Status colors: COMPLETE=green, PROCESSING=yellow, PENDING=gray, FAILED=red
- "View report" link only shown for COMPLETE jobs

### TrackHistoryPage.tsx (`/tracks`)

- Fetches `GET /tracks`
- Left panel: track name list (selectable)
- Right panel: Recharts LineChart (score over versions) + version table
- Each version links to `/jobs/:jobId/report`

### SharedReportPage.tsx (`/reports/share/:token`)

- Public, no auth required
- Uses native `fetch` (not Axios — no token needed)
- Renders subset of report: MixScore, CoachPanel, StreamingReadiness, FrequencyChart

---

## TypeScript Types (types/api.ts)

Key interfaces:
```typescript
interface PipelineResult {
  file_path: string; phases: PhaseResult[]
  overall_score: number; grade: MixGrade; top_fixes: string[]
  true_peak_db?: number | null; peak_dbfs?: number | null
  clipping_detected?: boolean | null; clipped_sample_count?: number | null
  detected_key?: string | null; mono_compatibility?: number | null
  coach_name?: string | null; coach_intro?: string | null
  coached_fixes?: string[] | null; danceability_score?: number | null
  share_token?: string | null
}

type SpecialistName =
  | 'LowEnd' | 'FrequencyBalance' | 'Dynamics' | 'StereoPhase' | 'Loudness'
  | 'Sections' | 'TranceArrangement' | 'StemReference' | 'HarmonicAnalysis'
  | 'ClarityAnalysis' | 'SpatialAnalysis' | 'SurroundCompatibility'
  | 'PlaybackOptimization' | 'OverallScore' | 'GainStagingAudit'
  | 'StereoFieldAudit' | 'FrequencyCollisionDetection'
  | 'DynamicsHumanizationReport' | 'SectionContrastAnalysis'
  | 'DensityBusynessReport' | 'ChordHarmonyAnalysis'
  | 'DeviceChainAnalysis' | 'PriorityProblemSummary'
```

---

## Build Configuration

**vite.config.ts:**
```typescript
server: { port: 5173 }
proxy: { '/api': { target: 'http://localhost:8000', rewrite: path => path.replace(/^\/api/, '') } }
resolve: { alias: { '@': './src' } }
```

**Tailwind safelist** (`tailwind.config.ts`): Grade colors (A=green → F=red), pass/fail badge classes, phase animation classes are runtime-computed strings and must be safelisted to prevent Tailwind purging.

---

## Key Security Patterns

| Pattern | Implementation |
|---------|---------------|
| Token storage | React state only; never localStorage |
| Refresh token | httpOnly cookie set by API; never accessed by JS |
| Concurrent 401s | `isRefreshing` flag + request queue (one refresh call max) |
| Upload progress | XHR `xhr.upload.progress` event; Fetch API cannot do this |
| SSE auth | Token in query param `?token=` (EventSource can't set headers) |
| Specialist streaming | Fetch ReadableStream + AbortController |
| SSE cleanup | `eventSource.close()` in useEffect return |
