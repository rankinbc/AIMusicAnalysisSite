# Analysis data contract — for the Analysis React component redo

Everything the analysis/report UI receives: inputs, the 8 analyses, intermediate per-phase
data, final rollups, AI specialist verdicts, and live progress. Shapes are the **frontend
TypeScript types** (what the component actually gets), verbatim from `src/api/types.ts`.

---

## 0. The three API surfaces the component consumes

| Purpose | Endpoint | Returns |
|---|---|---|
| Live progress (while running) | `GET /api/jobs/{jobId}` (poll) or `GET /api/jobs/{jobId}/stream` (SSE) | `JobStatusDto` |
| The report (when complete) | `GET /api/jobs/{jobId}/results` | `JobResultsDto` → `finalJson` |
| AI specialist verdicts (on-demand) | `GET /api/reports/{jobId}/verdicts/` | `VerdictsListResponse` |
| Re-run one phase in place | `POST /api/reports/{jobId}/phases/{phase}/rerun` | `{ jobId }` (poll like a job) |

```ts
interface JobResultsDto {
  jobId: string; analysisId: string; versionId: string | null;
  songId: string | null; songName: string | null;
  finalJson: unknown;        // ← the report blob, shape = FinalJson below
  shareToken: string | null;
}

interface FinalJson {        // analyses.final_json — every field optional (phases can fail/skip)
  grade?: string | null;             // A–F (overall)
  overall_score?: number;            // 0–100
  danceability_score?: number;       // 0–100
  coach_name?: string;               // coaching persona name
  coach_intro?: string;              // one-line intro
  coached_fixes?: string[];          // ≤5 coach-voice fix strings
  top_fixes?: string[];              // 3 prioritized raw fixes
  phases?: PhaseResult[];            // the 8 analyses (intermediate data) — see §3
}

interface PhaseResult<TData = unknown> {
  phase: number;             // 1–8
  name: string;              // worker phase name, e.g. "Universal Mix Analysis"
  status: 'ok' | 'skipped' | 'failed' | string;
  error?: string | null;     // set when status==='failed'
  data?: TData;              // Phase1Data … Phase8Data (see §2)
}
```

---

## 1. Inputs

**User-provided (per song version):**
- **Mix / master** — required. The track analyzed by phases 1–7.
- **Stems** — optional, 1–100 files, auto-classified to roles (kick/bass/hats/drums/snare/vocals/lead/pad/fx/other). Unlock per-stem analysis in phase 4/5 + stem specialists.
- **`.als`** (Ableton project) — optional. Drives phase 8.
- **Reference track** — optional; currently **library-only** (Compare page), NOT wired into this version's phase-5 analysis.

**Per-phase inputs (dependency chain — matters for re-run):**
- Phase 1: audio only.
- Phase 2: audio + phase-1 data.
- Phase 3: audio + genre (phase 2) + phase-1 data.
- Phase 4: audio (+ stems if provided). Independent of phase 1.
- Phase 5: audio + reference + phase-1 data + genre.
- Phase 6: audio + genre + phase-1 data.
- Phase 7: structure (from phase 1) + genre.
- Phase 8: `.als` only. Independent.

---

## 2. The 8 analyses — purpose + output shape (verbatim)

### Phase 1 — "Universal Mix Analysis" (Mix analysis)
Loudness, peaks, tempo, key, tone balance, stereo health, clipping.
```ts
interface Phase1Bands {  // per-band energy (relative dB)
  sub_bass?: number; bass?: number; low_mid?: number; mid?: number;
  upper_mid?: number; presence?: number; air?: number;
}
interface Phase1Data {
  bpm?: number;
  lufs?: number;                 // integrated LUFS (negative)
  rms?: number;
  peak_dbfs?: number;            // sample peak dBFS
  true_peak_db?: number;         // dBTP (4× oversampled)
  detected_key?: string;         // e.g. "A#"
  duration_seconds?: number;
  mono_compatibility?: number;   // 0.0–1.0
  stereo_width?: number;
  stereo_correlation?: number;   // -1..1
  clipping_detected?: boolean;
  clipped_sample_count?: number;
  low_energy?: number;           // 20–200 Hz RMS
  bands?: Phase1Bands;
  structure?: { sections?: unknown[]; beats?: unknown[] };
}
```

### Phase 2 — "Genre Detection"
```ts
interface Phase2Data { bpm?: number; genre?: string; confidence?: number; }  // confidence 0..1
```

### Phase 3 — "Genre-Specific Scoring" (Genre scoring)
```ts
interface Phase3Data {
  genre?: string;
  total_score?: number;              // 0–100 → drives overall_score
  sub_scores?: Record<string, number>;  // component scores; keys vary per genre
  notes?: string[];
}
```

### Phase 4 — "Stem Separation & Clash" (Stem clash)
Spectral band-energy + frequency-clash detection. `stems`/`per_stem`/`clash_matrix` appear only when stems were uploaded (or Demucs on).
```ts
interface Phase4Clash {
  stems?: string;                 // e.g. "kick vs bass"
  frequency_range?: string;       // e.g. "60–120 Hz"
  severity?: 'high' | 'moderate' | 'low' | string;
}
interface Phase4Data {
  stems?: Record<string, unknown>;        // present ⇔ user stems analyzed
  band_energy?: Record<string, number>;   // 7-band dB
  clashes?: Phase4Clash[];
  per_stem?: Record<string, unknown>;
  clash_matrix?: unknown[];
  balance_flags?: unknown[];
  error?: string;
}
```

### Phase 5 — "Reference Comparison"
Genre-preset checks (+ reference deltas if a reference is attached).
```ts
interface Phase5Check { status: 'ok' | 'warn' | 'fail' | string; message: string; value?: number; }
interface Phase5Data { genre?: string; preset_name?: string; checks?: Record<string, Phase5Check>; }
```

### Phase 6 — "Gap Analysis"
Position vs a statistical profile of many pro tracks in the genre.
```ts
interface Phase6Gap {
  user_val: number; genre_mean: number; genre_std: number;
  acceptable_range: [number, number]; delta: number;
  percentile: number;            // 0–100
  description: string; in_range: boolean;
}
interface Phase6Data {
  genre?: string; percentile?: number; profile_source?: string;  // e.g. "house_profile (347 tracks)"
  gaps?: Record<string, Phase6Gap>;  // keyed by feature (lufs, bass, air, …)
}
```

### Phase 7 — "Arrangement Advice"
Section structure, grade, fixes.
```ts
interface Phase7SectionScore {
  section_type: string; start_time: number; end_time: number; duration: number;
  bars: number; score: number; time_range: string; eight_bar_compliant: boolean;
  checks?: { name: string; passed: boolean }[]; issues?: string[];
}
interface Phase7Issue { severity: string; message: string; section: string | null; fix_suggestion?: string; }
interface Phase7Metadata {
  total_bars?: number; section_count?: number; detected_tempo?: number | null;
  has_intro?: boolean; has_buildup?: boolean; has_drop?: boolean;
  has_breakdown?: boolean; has_outro?: boolean; energy_contrast_db?: number | null;
}
interface Phase7Data {
  overall_score?: number; grade?: string; total_duration?: number;
  component_scores?: Record<string, number>;
  structure_score?: number; length_score?: number; eight_bar_score?: number;
  energy_contrast_score?: number; flow_score?: number;
  section_scores?: Phase7SectionScore[];
  issues?: Phase7Issue[]; suggestions?: string[];
  fixes?: string[]; violations?: string[];   // legacy aliases
  section_count?: number; metadata?: Phase7Metadata;
}
```

### Phase 8 — "ALS Analysis" (Ableton project) — only when `.als` uploaded
```ts
interface Phase8Track { name: string; type: string; device_count: number; disabled_count: number; muted: boolean; }
interface Phase8MidiIssue { track: string; clip: string | null; type: string; severity: string; description: string; fix?: string; }
interface Phase8Data {
  health_score?: number;       // 0–100
  grade?: string; tempo?: number; ableton_version?: string; time_signature?: string;
  total_devices?: number; disabled_devices?: number; clutter_pct?: number;
  plugin_list?: string[];
  has_humanized_midi?: boolean; quantization_issues_count?: number;
  total_chord_count?: number; midi_note_count?: number; audio_clip_count?: number;
  total_duration_seconds?: number;
  tracks?: Phase8Track[];
  midi?: { total_clips: number; total_notes: number; empty_clips: number; short_clips: number;
           duplicate_clips: number; tracks_without_content: number; issues: Phase8MidiIssue[]; };
  arrangement?: { has_markers: boolean; total_sections: number; pattern: string | null;
                  sections: { name: string; start_beat: number; end_beat: number; duration_bars: number }[]; };
}
```

---

## 3. Intermediate data

The per-phase data above lives in **`finalJson.phases[]`** — an array of `PhaseResult`, one per phase
(1–7 always, 8 only with `.als`). Read it as:
```ts
const phase1 = finalJson.phases?.find(p => p.phase === 1)?.data as Phase1Data | undefined;
// status === 'ok' | 'failed' | 'skipped'; on 'failed', `error` holds the reason and `data` is empty.
```
Each phase is independent — one can be `failed` while the rest are `ok`. The component should render
per-phase status (done / failed / skipped) rather than assume all-or-nothing.

---

## 4. Final / rollup data

Top-level `finalJson` fields (computed after all phases): `grade` (A–F), `overall_score` (0–100,
from phase 3's `total_score`), `top_fixes` (3 prioritized strings from phase 7 then phase 4),
`danceability_score` (0–100, from BPM/onset-density/low-energy/genre), and the coach trio
(`coach_name`, `coach_intro`, `coached_fixes` ≤5). These are re-derived on every (re-)run.

---

## 5. AI specialist verdicts (the "AI Coach" tab) — separate, on-demand

Not part of `analyze_audio_job`; fetched from `GET /api/reports/{jobId}/verdicts/` and generated
on demand (Triage routing → per-specialist runs). ~24 specialists across 7 groups; 4 are stems-only.
```ts
type Severity = 'critical' | 'severe' | 'moderate' | 'minor' | 'win';

interface VerdictsListResponse {
  verdicts: VerdictDto[];
  specialists: SpecialistStatus[];        // { slug, status: 'idle'|'cached'|'failed' } — UI overlays 'running'
  routing_plan?: RoutingPlanDto;          // present after a batch generation
  degradation?: DegradationNoticeDto;     // present iff LLM budget/outage → "rule-based findings only" banner
}

interface VerdictDto {
  id: string; analysisId: string; specialist: string;
  promptVersion: string; model: string;
  severity: Severity | string; category: string;
  confidence: number; priorityScore: number;
  impact: string | null; chartType: string | null;
  headline: string; summary: string | null; body: string | null;
  metricLine: string | null; whyItMatters: string | null; presetName: string | null;
  evidence: unknown; fix: VerdictFix | null; sources: unknown;
  createdAt: string;
  userState: { dismissed: boolean; applied: boolean; feedback: 'helpful'|'wrong'|'unclear'|null };
}

interface VerdictFix {
  fix_id?: string; target?: { type?: string; name?: string };
  section?: { start_seconds?: number; end_seconds?: number } | null;
  dsp_chain?: { type: string; params: Record<string, unknown> }[];
  sidechain?: unknown; expected_outcome?: string; ableton_hint?: unknown;
}

interface RoutingPlanDto { specialists_to_run: { name: string; priority: number; focus: string }[];
                           skip: string[]; rationale: string; estimated_total_tokens: number; }
interface DegradationNoticeDto { reason: 'tier_budget'|'global_budget'|'circuit_breaker'; detail: string | null; occurredAt: string; }
```
Specialist catalog (slug → label, group) lives in `src/features/results/helpers/specialists.ts`
(groups: Spectrum, Loudness, Dynamics, Stereo, Sections, Stems, Misc; `needsStems` flag for the 4
stem specialists). A "fail-marker" verdict has `headline === "Specialist failed"`.

---

## 6. Live progress (while the job runs)

```ts
type JobStatus = 'pending' | 'processing' | 'complete' | 'failed' | 'awaiting_stem_mapping';
interface JobStatusDto {
  id: string; status: JobStatus;
  currentPhase: string;   // real phase name during the run (e.g. "Genre Detection"); "complete"/"failed" at end
  phasePct: number;       // OVERALL progress 0..1 across all phases
  versionId: string | null; songId: string | null; errorMessage: string | null;
  dispatchedAt: string; startedAt: string | null; completedAt: string | null; failedAt: string | null;
}
```
Poll `GET /api/jobs/{id}` (stop at complete/failed) or use the SSE stream. A typical audio-only run is
~5–15s. On `complete`, fetch `/results`; on `failed`, show `errorMessage`.

---

## 7. Per-phase re-run (in place)

`POST /api/reports/{jobId}/phases/{phase}/rerun` → `{ jobId }` (a lightweight re-run job to poll like
any job). The worker re-runs just that phase, merges it into the existing `finalJson.phases[]`, and
re-derives the rollups — same report refreshes. UI exposes Re-run on phases 4/5/8 and Retry on any
failed phase; phase 1 is full re-analyze only. After the re-run job completes, refetch `/results`.
```ts
interface RerunPhaseResponse { jobId: string; }
```
```

> All shapes mirror `components/frontend-spectr-v2/src/api/types.ts` (the hand-maintained BFF contract).
> Units called out inline; `Record<string, …>` keys are dynamic (genre-dependent for sub_scores/gaps).

---

## 8. Full specialist catalog (26 specialists, 7 groups)

`slug` is the wire id; `label` is display; `needsStems` specialists only run when stems were uploaded.
Source: `src/features/results/helpers/specialists.ts` (kept in sync with the BFF `SpecialistCatalog.cs`
and the worker `prompt_loader.py`).

| Group | slug → label |
|---|---|
| **Spectrum** | `low_end`→Low End · `frequency_balance`→Frequency Balance · `frequency_collision`→Frequency Collisions · `clarity`→Clarity · `harmonic`→Harmonic Content |
| **Loudness** | `loudness`→Loudness · `gain_staging`→Gain Staging · `playback`→Playback Targets |
| **Dynamics** | `dynamics`→Dynamics · `humanization`→Humanization · `density`→Density / Busyness |
| **Stereo** | `stereo_phase`→Stereo Phase · `stereo_field`→Stereo Field · `spatial`→Spatial · `surround`→Mono Compatibility |
| **Sections** | `sections`→Sections · `section_contrast`→Section Contrast · `trance_arrangement`→Trance Arrangement · `chord_harmony`→Chord / Harmony · `device_chain`→Device Chain |
| **Stems** *(needsStems)* | `stem_reference`→Stem Reference · `stem_balance`→Stem Balance · `stem_stereo_width`→Stem Stereo Width · `stem_reference_delta`→Stem Reference Δ |
| **Misc** | `overall`→Overall Score · `priority_summary`→Priority Summary |

Each group has a persona color (see `specialists.ts`) used for avatars, filter pills, and card accents.

---

## 9. Real example payload (live capture)

A real `finalJson` from analyzing a short (~9s) MP3 — **no stems, no `.als`, genre auto-detected as
"other"**. Use it to mock against; the gaps below are explained.

```jsonc
{
  "grade": "F",
  "overall_score": 42.611,
  "danceability_score": 20,
  "coach_name": "Coach",
  "coach_intro": "Here's what I'd focus on to push this mix forward:",
  "coached_fixes": [
    "Your integrated loudness (-16.9 LUFS) is sitting below the sweet spot for Spotify (-14.0 LUFS). You have headroom to work with — nudge your master limiter ceiling up slightly and re-check. Small gain is better than a big push."
  ],
  "top_fixes": [
    "EQ clash between low-end buildup: reduce sub-bass / bass (20–200 Hz)",
    "EQ clash between low-mid congestion: reduce low-mid (200–500 Hz)",
    "Optimize mix levels for streaming targets"
  ],
  "phases": [
    { "phase": 1, "name": "Universal Mix Analysis", "status": "ok", "error": null, "data": {
        "bpm": 184.57, "rms": 0.0800, "lufs": -16.885, "peak_dbfs": -3.343, "true_peak_db": -7.834,
        "detected_key": "D", "duration_seconds": 9.221, "low_energy": 8.282,
        "stereo_width": 0.107, "stereo_correlation": 0.118, "mono_compatibility": 0.7435,
        "clipping_detected": false, "clipped_sample_count": 0,
        "bands": { "sub_bass": -37.44, "bass": -32.77, "low_mid": -34.84, "mid": -35.16,
                   "upper_mid": -48.39, "presence": -65.98, "air": -79.44 },
        "structure": { "beats": [], "sections": [] } } },           // empty: track too short for structure

    { "phase": 2, "name": "Genre Detection", "status": "ok", "error": null, "data": {
        "bpm": 184.57, "genre": "other", "confidence": 0.5 } },

    { "phase": 3, "name": "Genre-Specific Scoring", "status": "ok", "error": null, "data": {
        "genre": "other", "total_score": 42.611, "notes": [],
        "sub_scores": { "frequency_balance": 76.663, "stereo_width": 8.559 } } },  // keys vary by genre

    { "phase": 4, "name": "Stem Separation & Clash", "status": "ok", "error": null, "data": {
        "stems": {},                                                 // empty: no stems uploaded
        "band_energy": { "sub_bass": 7.03, "bass": 22.72, "low_mid": 14.44, "mid": 16.41,
                         "high_mid": 6.80, "presence": -14.62, "air": -38.39 },
        "clashes": [
          { "stems": "low-end buildup",   "severity": "high", "frequency_range": "sub-bass / bass (20–200 Hz)" },
          { "stems": "low-mid congestion", "severity": "high", "frequency_range": "low-mid (200–500 Hz)" } ] } },

    { "phase": 5, "name": "Reference Comparison", "status": "ok", "error": null, "data": {
        "status": "skipped", "deltas": {},                          // skipped: no reference attached
        "genre_context": { "genre": "other", "preset_name": "other", "checks": {} } } },

    { "phase": 6, "name": "Gap Analysis", "status": "ok", "error": null, "data": {
        "genre": "other", "percentile": 50.0, "gaps": {} } },        // gaps empty without a genre profile

    { "phase": 7, "name": "Arrangement Advice", "status": "ok", "error": null, "data": {
        "grade": "F", "overall_score": 0, "total_duration": 0.0, "section_count": 0,
        "structure_score": 0, "length_score": 0, "eight_bar_score": 0, "energy_contrast_score": 0,
        "flow_score": 0, "section_scores": [], "component_scores": {}, "suggestions": [],
        "fixes": [], "violations": ["Structure detection failed or no sections found"],
        "issues": [ { "severity": "CRITICAL", "section": null,
                      "message": "Structure detection failed or no sections found",
                      "fix_suggestion": "Ensure audio file is valid and long enough for structure detection" } ],
        "metadata": { "total_bars": 0, "section_count": 0, "detected_tempo": null,
                      "has_intro": false, "has_buildup": false, "has_drop": false,
                      "has_breakdown": false, "has_outro": false, "energy_contrast_db": null } } },

    { "phase": 8, "name": "ALS Analysis", "status": "skipped", "error": null, "data": {} }  // no .als
  ]
}
```

### ⚠️ Shape notes the designer must handle
- **Phase 5 real shape ≠ the `Phase5Data` TS type.** Live output is
  `{ status, deltas, genre_context: { genre, preset_name, checks } }` — the checks/preset are nested
  under `genre_context`, and there's a top-level `status` ("ok"/"skipped"). The `Phase5Data` type in
  `types.ts` (`{ genre, preset_name, checks }`) is stale; **render from the real shape above.**
- **Band-key naming differs between phases:** phase 1 `bands` uses `upper_mid`; phase 4 `band_energy`
  uses `high_mid`. Don't assume one key set across phases.
- **Phase 4 `clashes[].stems`** on the spectral path is a *descriptive label* ("low-end buildup"),
  not "kick vs bass". Treat it as free text.
- **Empty/zeroed phases are normal**, not errors: short tracks → empty `structure`/phase-7;
  no stems → `stems:{}`; no reference → phase 5 `status:"skipped"`; no genre profile → `gaps:{}`;
  no `.als` → phase 8 `status:"skipped"`. Design "no data yet / not applicable" states per phase.
- **`status:"ok"` with empty `data`** happens (e.g. phase 7 above is "ok" but all-zero because
  structure detection found nothing). Gate rich UI on the actual fields, not just `status`.
