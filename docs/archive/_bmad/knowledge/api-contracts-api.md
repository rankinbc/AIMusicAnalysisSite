# API Contracts — components/api

Base URL (dev): `http://localhost:8000` (proxied via frontend at `/api`)

## Authentication

All protected endpoints require: `Authorization: Bearer <access_token>`

SSE endpoints use: `?token=<access_token>` (EventSource cannot set headers)

Refresh token is an httpOnly cookie (`refresh_token`) set by login/register.

---

## Auth Routes (`/auth`)

### POST /auth/register
Create a new user account.

**Request Body:**
```json
{ "email": "user@example.com", "password": "secret123" }
```

**Response 200:**
```json
{ "access_token": "eyJ...", "token_type": "bearer" }
```
Sets `refresh_token` httpOnly cookie.

**Errors:** `400` duplicate email

---

### POST /auth/login
Authenticate existing user.

**Request Body:**
```json
{ "email": "user@example.com", "password": "secret123" }
```

**Response 200:**
```json
{ "access_token": "eyJ...", "token_type": "bearer" }
```
Sets `refresh_token` httpOnly cookie.

**Errors:** `401` invalid credentials

---

### POST /auth/refresh
Exchange refresh cookie for a new access token.

**Auth:** httpOnly cookie (sent automatically)

**Response 200:**
```json
{ "access_token": "eyJ...", "token_type": "bearer" }
```

**Errors:** `401` invalid/expired cookie

---

### POST /auth/logout
Clear the refresh token cookie.

**Response 200:**
```json
{ "detail": "Logged out" }
```

---

## Upload Routes (`/uploads`)

### POST /uploads/
Upload an audio file for analysis.

**Auth:** Bearer JWT

**Request:** `multipart/form-data`
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `file` | UploadFile | Yes | MP3/FLAC/WAV, max 200 MB |
| `reference` | UploadFile | No | Optional reference track |
| `track_name` | str | No | For version tracking (max 200 chars) |

**Validation:**
- Magic bytes checked (MP3: `FF FB`/`ID3`, FLAC: `fLaC`, WAV: `RIFF`)
- Max size: 200 MB

**Response 200:**
```json
{ "job_id": "550e8400-e29b-41d4-a716-446655440000" }
```

**Errors:** `413` too large, `415` invalid format, `401` unauthenticated

---

## Job Routes (`/jobs`)

### GET /jobs/
List the 50 most recent jobs for the authenticated user.

**Auth:** Bearer JWT

**Response 200:**
```json
[
  {
    "job_id": "550e8400-...",
    "status": "COMPLETE",
    "filename": "my_track.flac",
    "created_at": "2026-04-25T10:00:00",
    "score": 73.5,
    "grade": "C"
  }
]
```

---

### GET /jobs/{job_id}/status
Get current job status and phase progress.

**Auth:** Bearer JWT

**Response 200:**
```json
{
  "job_id": "550e8400-...",
  "status": "PROCESSING",
  "current_phase": 2,
  "phase_name": "Genre Detection",
  "phase_pct": 0.5
}
```

**Status values:** `PENDING` | `PROCESSING` | `COMPLETE` | `FAILED`

**Errors:** `404` job not found or not owned by user

---

### GET /jobs/{job_id}/stream
Stream job progress as Server-Sent Events.

**Auth:** `?token=<access_token>` (query param)

**Response:** `text/event-stream`

**Events:**
```
data: {"job_id":"...","status":"PROCESSING","phase":1,"phase_name":"Universal Mix Analysis","pct":0.3}

event: complete
data: {"job_id":"..."}

event: error
data: {"error":"Analysis failed"}
```

Poll interval: 1 second. Stream closes on COMPLETE or FAILED.

---

### GET /jobs/{job_id}/results
Retrieve the completed analysis result.

**Auth:** Bearer JWT

**Response 200:**
```json
{
  "job_id": "550e8400-...",
  "result": {
    "file_path": "...",
    "phases": [...],
    "overall_score": 73.5,
    "grade": "C",
    "top_fixes": ["Fix 1", "Fix 2", "Fix 3"],
    "danceability_score": 68,
    "coach_name": "Coach",
    "coach_intro": "Here's what I'd focus on...",
    "coached_fixes": ["..."],
    "true_peak_db": -1.2,
    "peak_dbfs": -0.8,
    "clipping_detected": false,
    "detected_key": "C#",
    "mono_compatibility": 0.85
  },
  "share_token": "uuid-string"
}
```

**Errors:** `404` results not yet available or job not owned by user

---

## Report Routes (`/reports`)

### GET /reports/share/{share_token}
Public endpoint — retrieve analysis by share token. No authentication required.

**Response 200:**
```json
{ "result": { ...full PipelineResult... } }
```

**Errors:** `404` token not found

---

## Track Routes (`/tracks`)

### GET /tracks/
List jobs grouped by `track_name` for version history.

**Auth:** Bearer JWT

Only includes jobs where `track_name` is not null.

**Response 200:**
```json
[
  {
    "track_name": "My Banger",
    "version_count": 3,
    "latest_score": 81.0,
    "latest_grade": "B",
    "versions": [
      {
        "job_id": "...",
        "filename": "banger_v1.flac",
        "score": 65.0,
        "grade": "D",
        "created_at": "2026-04-20T10:00:00"
      }
    ]
  }
]
```

---

## Expert Routes (`/experts`)

### POST /experts/{job_id}/triage
Run Claude triage analysis on a completed job.

**Auth:** Bearer JWT

**Response 200:**
```json
{
  "text": "## Triage Report\n\n...",
  "recommended_specialists": ["LowEnd", "Dynamics", "Loudness"]
}
```

**Errors:** `404` analysis file not found, `500` Claude API error

---

### POST /experts/{job_id}/specialist/{specialist_name}
Stream a specialist deep-dive analysis.

**Auth:** Bearer JWT

**Valid specialist names (23):**
`LowEnd`, `FrequencyBalance`, `Dynamics`, `StereoPhase`, `Loudness`, `Sections`, `TranceArrangement`, `StemReference`, `HarmonicAnalysis`, `ClarityAnalysis`, `SpatialAnalysis`, `SurroundCompatibility`, `PlaybackOptimization`, `OverallScore`, `GainStagingAudit`, `StereoFieldAudit`, `FrequencyCollisionDetection`, `DynamicsHumanizationReport`, `SectionContrastAnalysis`, `DensityBusynessReport`, `ChordHarmonyAnalysis`, `DeviceChainAnalysis`, `PriorityProblemSummary`

**Response:** `text/event-stream`
```
event: chunk
data: {"text":"...streaming text..."}

event: done
data: {}
```

**Errors:** `400` invalid specialist name, `404` analysis file not found

---

## PipelineResult Schema (full)

```typescript
interface PipelineResult {
  file_path: string
  phases: Array<{
    phase: number          // 1–7
    name: string
    status: 'ok' | 'failed' | 'skipped'
    data: Record<string, unknown>
    error: string | null
  }>
  overall_score: number    // 0–100
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  top_fixes: string[]      // always 3 items
  danceability_score: number  // 0–100
  coach_name: string
  coach_intro: string
  coached_fixes: string[]  // up to 5
  // Phase 1 fields promoted to top-level
  true_peak_db: number | null
  peak_dbfs: number | null
  clipping_detected: boolean | null
  clipped_sample_count: number | null
  detected_key: string | null    // e.g. "C#"
  mono_compatibility: number | null  // 0.0–1.0
  // Share
  share_token: string | null
}
```

## Phase 1 Data Shape

```typescript
{
  lufs: number              // integrated loudness (LUFS)
  rms: number               // RMS amplitude [0, 1]
  bpm: number               // detected tempo
  duration_seconds: number
  bands: {
    sub_bass: number        // dB
    bass: number
    low_mid: number
    mid: number
    upper_mid: number
    presence: number
    air: number
  }
  stereo_correlation: number   // [-1, 1]
  stereo_width: number         // >= 0
  mono_compatibility: number   // [0, 1]
  true_peak_db: number         // dBTP
  peak_dbfs: number            // dBFS
  clipping_detected: boolean
  clipped_sample_count: number
  detected_key: string         // C, C#, D, D#, E, F, F#, G, G#, A, A#, B
  low_energy: number           // RMS of 20-200 Hz band
  structure: {
    sections: Array<{label, start_beat, end_beat, energy}>
    beats: []
  }
}
```
