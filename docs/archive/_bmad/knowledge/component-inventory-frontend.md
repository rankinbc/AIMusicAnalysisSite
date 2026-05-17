# Component Inventory — components/frontend

React 19 + TypeScript strict mode. All components under `src/features/` (feature-based) and `src/pages/`.

## Entry Points

| File | Purpose |
|------|---------|
| `src/main.tsx` | ReactDOM.createRoot; wraps App in AuthProvider |
| `src/App.tsx` | Route tree; public routes + ProtectedLayout-wrapped protected routes |

---

## Authentication Feature (`src/features/auth/`)

### AuthContext.tsx

**Context:** `AuthContext` providing `AuthContextValue`

**State:** `accessToken: string | null`, `isLoading: boolean`

**On mount:** `POST /auth/refresh` → sets `accessToken` if cookie valid; sets `isLoading=false` when done.

**Exports:**
- `AuthProvider` — wrap at app root
- `useAuth()` — access context value

---

### ProtectedLayout.tsx

**Props:** None (uses `useAuth`, `useLocation`)

**Behavior:**
- `isLoading=true` → render `<Spinner />`
- `!accessToken` → `<Navigate to="/login" state={{ from: location }} replace />`
- else → `<Outlet />`

---

### Login.tsx

**Props:** None (uses `useAuth`, `useNavigate`, `useLocation`)

**State:** `email, password, error, loading`

**Behavior:** Calls `login(email, password)`. On success navigates to `from.pathname` (default `/upload`). Errors: 401 → "Invalid email or password."; other → "Login failed."

---

### Register.tsx

**Props:** None

**State:** `email, password, confirm, error, loading`

**Validations:** `password.length >= 8`, passwords match.

**Behavior:** Calls `register(email, password)`. On success navigates to `/upload`.

---

### useAuth.ts

Re-exports `useAuth` from `AuthContext` for feature-level imports.

---

## Upload Feature (`src/features/upload/`)

### UploadPage.tsx

**Props:** None (uses `useFileUpload`, `useAuth`, `useNavigate`)

**State:** `mainFile, refFile, trackName, dragOver, fileError`

**Refs:** `fileInputRef, refInputRef`

**Accepted formats:** `.mp3, .flac, .wav`, max 200 MB

**Behavior:**
- Drag events update `dragOver` state
- File selected → stored in `mainFile`
- On submit: `upload(mainFile, refFile, trackName)` → navigates to `/jobs/{jobId}`

---

### useFileUpload.ts

**Returns:**
```typescript
{
  progress: number          // 0–100
  status: 'idle' | 'uploading' | 'success' | 'error'
  jobId: string | null
  error: string | null
  upload: (file, refFile?, trackName?) => Promise<string>
  cancel: () => void
}
```

**Implementation details:**
- `XMLHttpRequest` — Fetch API has no upload progress
- Progress registered BEFORE `xhr.open()`
- FormData keys: `file`, `reference` (optional), `track_name` (optional)
- Bearer token in `Authorization` header
- POST to `/api/uploads/`

---

## Analysis Feature (`src/features/analysis/`)

### JobProgressPage.tsx

**Props:** None (uses `useParams`, `useNavigate`)

**Route param:** `id` → jobId

**Behavior:** Uses `useJobStream`. When `done=true`, waits 500ms then navigates to `/jobs/:id/report`.

**Phase names displayed:** Universal Mix Analysis, Genre Detection, Genre-Specific Scoring, Stem Separation & Clash, Reference Comparison, Gap Analysis, Arrangement Advice

---

### useJobStream.ts

**Arguments:** `jobId: string`

**Returns:**
```typescript
{
  phase: number; phaseName: string; pct: number
  status: string; done: boolean; error: string | null
}
```

**Implementation:**
- Opens `EventSource('/api/jobs/:id/stream?token={accessToken}')`
- `onmessage`: parses `{phase, phase_name, pct, status}` JSON
- Named `complete` event: sets `done=true`
- Named `error` event: sets `error`
- **Cleanup:** `eventSource.close()` in `useEffect` return

---

## Report Feature (`src/features/report/`)

### ReportPage.tsx

**Props:** None (uses `useParams`)

**Data fetch:** `GET /api/jobs/:id/results` → `JobResultResponse`

**Phase data extraction by index:** phases[0]=p1, etc. Uses `find(p => p.phase === N)`.

**Sections rendered:** (see architecture-frontend.md for full table)

---

### MixScore.tsx

**Props:** `grade: string, score: number, topFixes: string[]`

Grade color map: A → green-500, B → lime-400, C → yellow-400, D → orange-400, F → red-500

---

### StreamingReadiness.tsx

**Props:** `lufs: number, truePeakDb?: number | null, clippingDetected?: boolean | null`

**Platform targets (LUFS):**
| Platform | Target |
|----------|--------|
| Spotify | -14 |
| Apple Music | -16 |
| YouTube | -14 |
| Tidal | -14 |
| Amazon Music | -14 |
| SoundCloud | -8 |
| Beatport | -9 |

Pass = actual LUFS within ±2 of target, or lower than target.

True Peak row: pass if `truePeakDb < -1.0`.
Clipping row: pass if `!clippingDetected`.

---

### FrequencyChart.tsx

**Props:** `bands: Record<string, number>`

Recharts `BarChart`. Band order: sub_bass, bass, low_mid, mid, upper_mid, presence, air.

Color logic: `value > -10` → orange (hot), `value < -40` → gray (quiet), else indigo.

---

### StereoGauges.tsx

**Props:** `correlation: number, width: number`

Two gauges: stereo correlation [-1,1] and stereo width [0,∞].

---

### StemClash.tsx

**Props:** `clashes: ClashEntry[]`

Each entry: `{stems: string[], frequency_range: string, severity: "high"|"moderate"|"low", eq_suggestion?: string}`

---

### ReferenceComparison.tsx

**Props:** `deltas: Record<string, unknown>`

Filters to entries with `value` and `severity` fields. Color by severity.

---

### GenreRadar.tsx

**Props:** `gaps: Record<string, unknown>`

Recharts `RadarChart`. Plots up to 6 features: user_val vs genre_mean.

---

### ArrangementAdvisor.tsx

**Props:** `fixes: string[], violations: string[]`

---

### CoachPanel.tsx

**Props:** `coachName: string, coachIntro: string, coachedFixes: string[]`

Coach avatar = first letter of `coachName` in colored circle.

---

## Expert Feature (`src/features/experts/`)

### ExpertsPanel.tsx

**Props:** `jobId: string`

Entry point. Renders "Run Triage" button → TriageView after completion.

---

### useExpertAnalysis.ts

**Arguments:** `jobId: string`

**State managed:**
```typescript
triage: TriageResult | null
triageLoading: boolean; triageError: string | null
specialistOutputs: Partial<Record<SpecialistName, string>>
specialistLoading: Partial<Record<SpecialistName, boolean>>
specialistErrors: Partial<Record<SpecialistName, string>>
```

**Methods:**
- `runTriage()` — `POST /experts/:jobId/triage`
- `runSpecialist(name)` — `POST /experts/:jobId/specialist/:name` with `Accept: text/event-stream`; Fetch ReadableStream; AbortController per specialist
- `cancelSpecialist(name)` — calls abort on controller

**SSE parsing:** Splits response text by `\n`, finds lines starting with `data:`, parses JSON, extracts `text`.

---

### TriageView.tsx

**Props:** `triage, state, showAll, onShowAll`

Default: shows only `recommended_specialists`. Toggle to show all 23.

---

### SpecialistCard.tsx

**Props:** `name, recommended?, output, loading, error, onRun, onCancel`

Auto-expands output on Run. Shows blinking cursor while streaming.

---

### ExpertOutput.tsx

**Props:** `text: string, loading: boolean, error?: string`

Renders text as markdown via `react-markdown`. Loading + text → blinking cursor appended.

---

## Pages (`src/pages/`)

### HistoryPage.tsx (`/history`)

**State:** `jobs: JobSummary[], loading, error`

**Fetch:** `GET /api/jobs` on mount.

**Table columns:** File | Status | Score | Grade | Created | Action (View report)

---

### TrackHistoryPage.tsx (`/tracks`)

**State:** `tracks: TrackGroup[], selected: string | null, loading, error`

**Fetch:** `GET /api/tracks` on mount.

**Left panel:** Track name list (selectable).

**Right panel:** Recharts `LineChart` (score vs filename) + version table.

---

### SharedReportPage.tsx (`/reports/share/:token`)

**No auth required.** Uses native `fetch` (no Axios).

**Fetch:** `GET /api/reports/share/:token`

**Renders:** MixScore, CoachPanel, StreamingReadiness, FrequencyChart (subset — no ExpertsPanel).

---

## Lib (`src/lib/`)

### apiClient.ts

Single Axios instance. Base URL: `/api`. See architecture-frontend.md for interceptor details.

**Exports:**
- `apiClient` — the Axios instance
- `setAccessToken(token)` — updates module-level token
- `getAccessToken()` — reads module-level token

---

## Types (`src/types/api.ts`)

All TypeScript interfaces for API responses. Key types: `PipelineResult`, `PhaseResult`, `JobResultResponse`, `JobSummary`, `TrackGroup`, `TrackVersionSummary`, `TriageResult`, `SpecialistName`.

---

## State Management Summary

| Component/Hook | State Type | Source |
|----------------|-----------|--------|
| Auth state | React Context | AuthContext |
| Upload progress | Custom hook | useFileUpload |
| Job stream | Custom hook | useJobStream |
| Expert analysis | Custom hook | useExpertAnalysis |
| Report data | Local useState | ReportPage |
| History | Local useState | HistoryPage |
| Track history | Local useState | TrackHistoryPage |

No external state management library (Redux, Zustand, etc.). All state in React hooks.
