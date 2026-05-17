# PRP: v2 Slice 2 — Results Page (presentation only)

**Status:** Draft
**Effort:** M (~1 week, evenings)
**Phase:** v2 / Phase 1 / Slice 2
**Confidence (one-pass implementation):** 8/10

---

> **Why this slice?** Slice 1 proved the spine: register → upload → dramatiq → 7-phase pipeline → `analyses.final_json` → BFF results endpoint → frontend render. But the frontend render is a `<pre>` blob — the ugliest screen in the app. This slice turns it into the Report page from the mockups: A–F mix-score header, key/BPM/LUFS metadata bar, streaming-readiness checks, frequency-band bars, stereo-width gauge, coach panel, phase status timeline. **Pure presentation of fields already in `final_json` — zero new pipeline work, zero AI calls.** Verdicts, Apply preset, WaveSurfer, tabs, dimension scores, sub-grades all deferred to later slices.

---

## Goal

After this PRP lands, the route `/songs/$songId/results/$jobId` no longer dumps `final_json` as JSON. Instead it renders a single-column report with:
- A grade hero (A–F, color-coded) + numeric mix score + danceability score.
- A metadata bar: BPM, Key, Genre, Integrated LUFS, True Peak, Mono Compat, Duration.
- A streaming readiness table: pass/fail against Spotify, Apple Music, YouTube, Tidal, Amazon Music, SoundCloud, Beatport LUFS targets + a True Peak ≤ −1.0 dBTP row + No Clipping row.
- A frequency spectrum chart: 7 horizontal bars (sub_bass → air) from `phase1.bands`.
- A stereo card: width 0–1 + correlation gauge + mono compat percent.
- A coach panel: `coach_name`, `coach_intro`, numbered list of `coached_fixes`.
- A phase timeline: 7 (or 8 if ALS present) rows showing each phase's name and status (`ok` / `skipped` / `failed`) with the error message for failures.

CSS Modules carry the styling. Recharts renders only the spectrum bars (everything else is plain markup against design tokens). No tabs, no AI panel, no WaveSurfer, no Listen handoff, no share link copy, no export PDF.

## Why

- Slice 1 closed the loop technically. This slice closes it visually — the moment a user uploads, they should see a real report, not a JSON dump.
- Every UI primitive needed for Slice 2 (CSS Modules workflow, grade-color helpers, design-token wiring, Recharts integration, the 7-band display) is reused by later slices (Listen, Compare, Discover, share-link reviewer). Slice 2 establishes those patterns so subsequent slices skip the bootstrap cost.
- The audit doc (`requirements/page-audits/results.md`) marks ~75% of report fields as already present in `final_json`. This slice ships exactly that 75% and explicitly stubs/cuts the rest.

## What

### User-visible behavior

1. After an upload completes (slice 1 path unchanged), the browser lands at `/songs/$songId/results/$jobId`.
2. While job status is `pending` / `processing`: the page polls every 2 s and shows the current phase name + percentage as a thin progress bar (slice 1 behavior preserved).
3. When status flips to `complete`: the polling stops; the full report renders. Header shows the song name + back-link to `/songs/$songId`.
4. On `failed`: the page shows the error_message and a "Re-upload to retry" CTA that links to `/library` (no inline retry button this slice).
5. Layout is single-column, max-width 1080 px, dark background using existing `tokens.css` design tokens.
6. Refresh continues to work — page is fully driven by `useJob` + `useJobResults` (slice 1 hooks; orval-generated equivalents now exist but the hand-rolled hooks stay in place to avoid breaking slice 1).

### Success Criteria

- [ ] `/songs/$songId/results/$jobId` renders the report on `complete` status with NO raw JSON visible.
- [ ] Grade hero shows the letter from `final_json.grade` with the corresponding color (A=green → F=red); fallback to `—` if absent.
- [ ] Mix score = `final_json.overall_score` (rounded int, "/100" suffix).
- [ ] Danceability = `final_json.danceability_score` (rounded int, "/100" suffix).
- [ ] Metadata bar reads from `phases[0].data` (`bpm`, `detected_key`, `lufs`, `true_peak_db`, `mono_compatibility`, `duration_seconds`) + `phases[1].data.genre`.
- [ ] Streaming readiness rows: each platform LUFS target (constant table) compared against `phase1.lufs`. ±1 LU = pass, ±2 LU = warn, beyond = fail. Plus a True Peak row (≤ −1.0 dBTP = pass) and a Clipping row (`clipping_detected === false` = pass).
- [ ] Frequency spectrum: 7 horizontal Recharts bars in sub_bass → air order, dB values from `phase1.bands`.
- [ ] Stereo card: width (`phase1.stereo_width`), correlation (`phase1.stereo_correlation`), mono compat (`phase1.mono_compatibility`). All shown as 0–1 (or 0–100%) progress bars or numeric pills.
- [ ] Coach panel: `coach_name` as heading, `coach_intro` as subtitle, `coached_fixes[]` as numbered list. If `coached_fixes` empty, falls back to `top_fixes`.
- [ ] Phase timeline: iterate `phases[]`, render one row per phase with name + status badge. Failed phases show the `error` string under the name.
- [ ] All styling via CSS Modules. No inline `style={{}}` in any new component except Recharts customization slots.
- [ ] Grade color helper + status badge color helper are unit-tested.
- [ ] `npm run type-check && npm run lint && npm run build` all clean.
- [ ] Manual: upload a track, watch results page render with the seven panels filled in.

## All Needed Context

### Documentation & References

```yaml
- file: components/frontend-spectr-v2/requirements/page-audits/results.md
  why: Authoritative scope doc. §"Data the page assumes" maps every UI field to its source in final_json. §"Recommended cuts / placeholders for v1" lists what slice 2 deliberately omits. Read first.

- file: components/frontend-spectr-v2/requirements/claude-design-ui-files/results.jsx
  why: Original Claude-design mockup (1474 lines). Treat as visual reference only — its tab system, AI Coach panel, and per-specialist tiles are out of scope. The grade hero, metadata bar, streaming-readiness rows, and frequency bars are the patterns slice 2 ships.

- file: components/frontend-spectr-v2/requirements/claude-design-ui-files/mock-data.jsx
  why: Sample `track` payload shape — useful when wiring TypeScript types. The COACH_FINDINGS shape (locked) is NOT used in this slice.

- file: components/frontend-spectr-v2/requirements/claude-design-ui-files/styles.css
  why: Original design system. Color tokens, severity colors, grade colors. Port into our existing src/styles/tokens.css; do NOT copy the whole file.

- file: components/frontend-spectr-v2/src/styles/tokens.css
  why: Existing design tokens. Slice 2 EXTENDS this — adds grade colors, severity badge colors, panel surfaces. Do not rename existing tokens.

- file: components/frontend-spectr-v2/src/routes/_app/songs.$songId.results.$jobId.tsx
  why: The page slice 2 replaces. The polling + status branching is correct — keep it; only the "complete" branch's render swaps from `<pre>` to the new layout.

- file: components/frontend-spectr-v2/src/api/types.ts
  why: Slice 1 declared `JobResultsDto.finalJson: unknown`. Slice 2 narrows this with a `FinalJson` interface that types the fields the report reads.

- file: components/frontend-spectr-v2/src/api/hooks.ts
  why: useJob + useJobResults stay as-is. They were the slice-1 polling primitives.

- file: components/frontend-spectr-v2/src/components/
  why: Where slice-2 components land. Add a `features/results/` subfolder for the panels (keeps the components/ root clean for shared widgets).

- file: components/shared/aimusic_shared/models.py
  why: Reference only — confirms the Postgres `analyses.final_json` shape. No schema changes in slice 2.

- file: components/analysis/src/audio_analysis/pipeline.py
  why: The function that emits final_json. Look up _score_to_grade if you need to mirror grade thresholds (A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 45, F otherwise — verify before using).

- file: CLAUDE.md (frontend section)
  why: Stack rules: Recharts for charts, Tailwind safelist (we're using CSS Modules instead — safelist not needed). React 19 strict mode. No localStorage. Feature folders under src/features (CLAUDE.md actually says this — we'll follow it; slice 2 introduces the pattern).

- url: https://recharts.org/en-US/api/BarChart
  why: Horizontal BarChart with custom Y-axis labels = the 7-band spectrum.

- url: https://github.com/css-modules/css-modules
  why: TypeScript imports `import s from './foo.module.css'` are typed via the auto-generated declarations Vite emits. No extra config beyond what the scaffold already has.

- url: https://vitejs.dev/guide/features.html#css-modules
  why: Vite handles `*.module.css` natively. Class names are auto-hashed; access via `s.gradeHero` etc.
```

### Current frontend tree (relevant slice)

```
components/frontend-spectr-v2/
├── src/
│   ├── routes/_app/songs.$songId.results.$jobId.tsx   ← page; <pre> dump
│   ├── api/
│   │   ├── types.ts               ← finalJson: unknown
│   │   ├── hooks.ts               ← useJob + useJobResults
│   │   └── generated/             ← orval output (slice 1)
│   ├── components/
│   │   ├── NewSongDialog.tsx      ← inline styles
│   │   └── UploadVersionDialog.tsx
│   └── styles/
│       ├── tokens.css             ← design tokens
│       └── global.css
└── requirements/
    ├── claude-design-ui-files/results.jsx (mockup reference)
    └── page-audits/results.md (scope doc)
```

### Desired frontend tree

```
src/
├── routes/_app/songs.$songId.results.$jobId.tsx   ← imports <ReportView/>
├── api/
│   ├── types.ts                                   ← + FinalJson, Phase1Data, etc.
│   └── hooks.ts                                   ← unchanged
├── features/
│   └── results/
│       ├── ReportView.tsx                         ← orchestrates the panels
│       ├── ReportView.module.css
│       ├── GradeHero.tsx
│       ├── GradeHero.module.css
│       ├── MetadataBar.tsx
│       ├── MetadataBar.module.css
│       ├── StreamingReadiness.tsx
│       ├── StreamingReadiness.module.css
│       ├── FrequencyBars.tsx
│       ├── FrequencyBars.module.css
│       ├── StereoCard.tsx
│       ├── StereoCard.module.css
│       ├── CoachPanel.tsx
│       ├── CoachPanel.module.css
│       ├── PhaseTimeline.tsx
│       ├── PhaseTimeline.module.css
│       ├── helpers/
│       │   ├── grade.ts          ← grade ↔ color/label helpers
│       │   ├── streaming.ts      ← platform target table + pass/fail rule
│       │   └── format.ts         ← number/duration/db formatters
│       └── __tests__/
│           ├── grade.test.ts
│           └── streaming.test.ts
└── styles/
    └── tokens.css                                 ← + grade/severity colors

# Sibling component dirs:
# components/  — NewSongDialog, UploadVersionDialog (slice 1) stay here;
#               slice 2 does NOT migrate them to features/.
# vite-env.d.ts already declares `*.css` modules; no extra typing.
```

### Known Gotchas

```text
# CRITICAL: CSS Modules require the `.module.css` extension. Plain `.css`
# imports stay as global styles. Don't accidentally write `report.css` and
# import its class names — they won't be locally scoped.

# CRITICAL: Vite emits CSS Module class names with content hashes. Never
# hard-code a class name as a string elsewhere (e.g. don't `data-testid="…"`
# the way the mockup does some classes; use a real data attribute). For
# Playwright/test selectors, add explicit `data-testid` attributes instead.

# CRITICAL: vite-env.d.ts declares `declare module '*.css'` (slice 1). That
# covers both global and module CSS, but the typed import `import s from
# './foo.module.css'` will give `s: { [key: string]: string }` (string-keyed)
# — no autocomplete on class names. That's fine. If you want stricter typing,
# add a vite plugin later — out of scope for slice 2.

# CRITICAL: finalJson is `unknown` in slice 1. DO NOT cast `as FinalJson`
# without a runtime check. Use a small validator (hand-rolled or Zod) at
# the page boundary. The pipeline can fail mid-phase so `phases[i].data`
# may be partial. Every accessor must tolerate missing fields.

# CRITICAL: `phases` array order is NOT guaranteed to be sorted by phase
# number. Look up by `name` or use the `.phase` integer for ordering. Phase 8
# (ALS) is `status: "skipped"` for slice-1 uploads; treat skipped phases as
# present-but-empty in the timeline.

# CRITICAL: `phase1.bands` keys differ from typical EQ band naming. The
# pipeline emits: sub_bass, bass, low_mid, mid, upper_mid, presence, air
# (7 bands). The mockup shows 8 bands (SUB/BASS/L.MID/MID/H.MID/PRES/BRIL/AIR);
# we stick with the pipeline's 7 — see audit doc §Recommended cuts.

# CRITICAL: bands values are dB (negative numbers, typically −60 → 0). For the
# bar chart, normalize to a 0..1 visual scale by clamping (e.g. min=-60, max=0),
# but DISPLAY the raw dB value as the label. Don't translate to a 0..100 score —
# that's misleading.

# CRITICAL: `phase1.detected_key` is pitch class only ("A#"), not "A# minor".
# Don't fabricate the mode. Audit doc lists this under Open product questions —
# ship pitch-class-only for v1.

# CRITICAL: `phase1.mono_compatibility` is 0–1 (per CLAUDE.md v1.1 notes). Show
# as a percentage with one decimal. `phase1.stereo_correlation` can range
# [-1, 1] (negative correlation = phase-cancelled). Display the raw signed
# value; format helper handles negative.

# CRITICAL: `final_json.grade` may be lowercase or null when pipeline failed
# (slice-1 test produced "F"). Treat as nullable string in TypeScript and fall
# back to "—" for the hero. NEVER throw on missing grade.

# CRITICAL: Streaming readiness target values from CLAUDE.md §api gotchas:
#   Spotify: -14 LUFS    Apple Music: -16 LUFS    YouTube: -14 LUFS
#   Tidal: -14 LUFS      Amazon Music: -14 LUFS   SoundCloud: -8 to -14
#   Beatport: -8 LUFS
# These are integrated LUFS targets. Margin rule:
#   pass = |yourLufs - target| ≤ 1.0
#   warn = |yourLufs - target| ≤ 2.0
#   fail = otherwise
# SoundCloud has a range; treat midpoint -11 as target for the comparison.
# True Peak row: pass if true_peak_db ≤ -1.0 dBTP. Clipping row: pass if
# clipping_detected === false.

# CRITICAL: Recharts in horizontal layout uses `layout="vertical"` (counter-
# intuitive — that name describes axis orientation, not bar orientation).
# Y-axis becomes the category axis. Set `dataKey="band"` on YAxis,
# `dataKey="db"` on the Bar, `domain={[-60, 0]}` on XAxis.

# CRITICAL: Recharts default colors don't match our design system. Pass
# `fill="var(--cyan)"` (or a per-bar fill function) to the <Bar/>. Severity
# bars (red for failures) come later when verdicts ship.

# CRITICAL: The page polls `/api/jobs/$jobId` while status is pending/
# processing. Don't fetch /results inside that branch — it'll 404 (no
# Analysis row yet). useJobResults is gated `enabled: isComplete` in slice 1
# and that gating stays.

# CRITICAL: When the job's status is `failed`, the polling stops but
# useJobResults is also gated off. Render the error_message from useJob's
# data instead — DO NOT request /results.

# CRITICAL: Slice 1 polling interval is 2000ms (`pollMs: 2000`). For phases
# that take 30+ seconds, this is overly chatty but acceptable in slice 2.
# Don't switch to SSE here — that's a Listen-slice concern.
```

## Implementation Blueprint

### Data models (TypeScript)

Extend `src/api/types.ts` with a typed view of `final_json`. Use a separate `FinalJson` interface (not part of `JobResultsDto.finalJson` which stays `unknown` — narrow once at the page boundary):

```ts
// in src/api/types.ts
export interface Phase1Data {
  bpm?: number;
  lufs?: number;
  peak_dbfs?: number;
  true_peak_db?: number;
  detected_key?: string;
  duration_seconds?: number;
  mono_compatibility?: number;
  stereo_width?: number;
  stereo_correlation?: number;
  clipping_detected?: boolean;
  clipped_sample_count?: number;
  low_energy?: number;
  bands?: {
    sub_bass?: number;
    bass?: number;
    low_mid?: number;
    mid?: number;
    upper_mid?: number;
    presence?: number;
    air?: number;
  };
  structure?: { sections?: unknown[]; beats?: unknown[] };
}

export interface Phase2Data { genre?: string; confidence?: number; bpm?: number }
export interface PhaseResult<TData = unknown> {
  phase: number;
  name: string;
  status: 'ok' | 'skipped' | 'failed' | string;
  error?: string | null;
  data?: TData;
}

export interface FinalJson {
  grade?: string | null;
  overall_score?: number;
  danceability_score?: number;
  coach_name?: string;
  coach_intro?: string;
  coached_fixes?: string[];
  top_fixes?: string[];
  phases?: PhaseResult[];
}
```

A tiny runtime check at the page boundary:

```ts
function isFinalJson(x: unknown): x is FinalJson {
  return typeof x === 'object' && x !== null;
}
```

That's it — no schema-validation runtime. If a field is missing, the component renders `—`.

### Task list (in execution order)

```yaml
Task 1: Extend design tokens.
  MODIFY src/styles/tokens.css:
    - Add grade colors: --grade-a, --grade-b, --grade-c, --grade-d, --grade-f
      (greens → amber → red, matching the mockup; pick from styles.css reference).
    - Add severity tokens: --sev-ok, --sev-warn, --sev-fail.
    - Add panel surface: --panel-bg, --panel-border (slight elevation above --surface).

Task 2: Helpers + types.
  MODIFY src/api/types.ts: add FinalJson, Phase1Data, Phase2Data, PhaseResult.
  CREATE src/features/results/helpers/grade.ts:
    - gradeColor(grade: string | null | undefined): CSS var string
    - gradeLabel(grade: ...): "A" / "B" / "F" / "—"
  CREATE src/features/results/helpers/streaming.ts:
    - PLATFORM_TARGETS constant (Spotify −14, Apple −16, YouTube −14, Tidal −14, Amazon −14, SoundCloud −11, Beatport −8).
    - evaluateLufs(your: number | undefined, target: number): "pass" | "warn" | "fail" | "unknown"
  CREATE src/features/results/helpers/format.ts:
    - fmtDb(n: number | undefined, digits = 1): "−12.4 dB" or "—"
    - fmtPercent(n: number | undefined, digits = 1): "78.5%"
    - fmtDuration(seconds: number | undefined): "9:04"
    - fmtBpm(n: number | undefined): "140" (rounded)

Task 3: Unit tests for helpers.
  CREATE src/features/results/__tests__/grade.test.ts (vitest):
    - undefined → "—" / neutral color
    - "A" → green token
    - "F" → red token
    - lowercase "a" → still "A" / green (defensive)
  CREATE src/features/results/__tests__/streaming.test.ts:
    - within 1 LU → "pass"
    - within 2 LU → "warn"
    - beyond → "fail"
    - undefined → "unknown"

Task 4: GradeHero component.
  CREATE src/features/results/GradeHero.tsx + .module.css.
  Props: { grade: string | null | undefined, score: number | undefined, danceability: number | undefined }.
  Layout: big letter (font-size ~96px) + numeric score + dance score under it.

Task 5: MetadataBar component.
  CREATE src/features/results/MetadataBar.tsx + .module.css.
  Props: { phase1: Phase1Data | undefined, genre: string | undefined }.
  Renders 6 cells (BPM, Key, Genre, LUFS, True Peak, Mono Compat). Each cell:
  <dt> label, <dd> value or "—".

Task 6: StreamingReadiness component.
  CREATE src/features/results/StreamingReadiness.tsx + .module.css.
  Props: { lufs: number | undefined, truePeakDb: number | undefined,
    clippingDetected: boolean | undefined }.
  Renders 7 platform rows + True Peak row + No Clipping row.
  Each row: platform name | target | your value | pass/warn/fail badge.

Task 7: FrequencyBars component (Recharts).
  CREATE src/features/results/FrequencyBars.tsx + .module.css.
  Props: { bands: Phase1Data['bands'] | undefined }.
  Transforms bands into [{ band: 'SUB', db: -19.99 }, …] and feeds Recharts
  <BarChart layout="vertical">. XAxis domain=[-60, 0], YAxis dataKey='band'.
  Tooltip optional.

Task 8: StereoCard component.
  CREATE src/features/results/StereoCard.tsx + .module.css.
  Props: { width, correlation, monoCompat } from phase1.
  Renders three rows: Width (0..1 bar), Correlation (−1..1 centered bar),
  Mono Compat (0..1 bar with %). No Recharts — pure CSS bars.

Task 9: CoachPanel component (slice-2 version).
  CREATE src/features/results/CoachPanel.tsx + .module.css.
  Props: { name: string | undefined, intro: string | undefined, fixes: string[] | undefined }.
  Renders heading + intro + <ol> of fixes. Empty state: "No fixes yet."

Task 10: PhaseTimeline component.
  CREATE src/features/results/PhaseTimeline.tsx + .module.css.
  Props: { phases: PhaseResult[] | undefined }.
  Sorts by .phase, renders one row per result: phase number badge + name +
  status pill. Failed rows show .error in muted text underneath.

Task 11: ReportView orchestrator.
  CREATE src/features/results/ReportView.tsx + .module.css.
  Props: { results: JobResultsDto, songId: string }.
  Narrows finalJson to FinalJson at the top. Extracts phase1 and phase2
  data once. Renders the 7 panels in vertical order:
    1) Header: song name + "← all versions" Link + grade hero.
    2) MetadataBar
    3) StreamingReadiness
    4) Two-column grid on wide screens (FrequencyBars + StereoCard);
       stacks on narrow.
    5) CoachPanel
    6) PhaseTimeline

Task 12: Wire into the results route.
  MODIFY src/routes/_app/songs.$songId.results.$jobId.tsx:
    - Remove the <pre> branch.
    - When isComplete && results.data: render <ReportView results={results.data} songId={songId} />.
    - When status==='failed': render the existing error block + add a
      "Re-upload" Link to /library (no inline retry button).
    - When pending/processing: keep slice-1 progress bar.

Task 13: Vitest config sanity.
  RUN npm test once; if vitest is not configured, add a minimal vitest.config.ts.
  (package.json already has vitest installed; the "test" script exists.)

Task 14: Smoke-render against the existing complete job.
  Open the dev server, navigate to the last results URL. Verify all panels
  show data from the real Analysis row.
```

### Per-task pseudocode

```tsx
// Task 11 — ReportView skeleton
export function ReportView({ results, songId }: { results: JobResultsDto; songId: string }) {
  const fj = (isFinalJson(results.finalJson) ? results.finalJson : {}) as FinalJson;
  const phase1 = fj.phases?.find((p) => p.phase === 1)?.data as Phase1Data | undefined;
  const phase2 = fj.phases?.find((p) => p.phase === 2)?.data as Phase2Data | undefined;

  return (
    <div className={s.report}>
      <header className={s.header}>
        <Link to="/songs/$songId" params={{ songId }} className={s.backLink}>
          ← all versions
        </Link>
        <h1 className={s.title}>{results.songName ?? 'Untitled'}</h1>
        <GradeHero
          grade={fj.grade ?? null}
          score={fj.overall_score}
          danceability={fj.danceability_score}
        />
      </header>

      <MetadataBar phase1={phase1} genre={phase2?.genre} />
      <StreamingReadiness
        lufs={phase1?.lufs}
        truePeakDb={phase1?.true_peak_db}
        clippingDetected={phase1?.clipping_detected}
      />
      <div className={s.twoCol}>
        <FrequencyBars bands={phase1?.bands} />
        <StereoCard
          width={phase1?.stereo_width}
          correlation={phase1?.stereo_correlation}
          monoCompat={phase1?.mono_compatibility}
        />
      </div>
      <CoachPanel
        name={fj.coach_name}
        intro={fj.coach_intro}
        fixes={fj.coached_fixes?.length ? fj.coached_fixes : fj.top_fixes}
      />
      <PhaseTimeline phases={fj.phases} />
    </div>
  );
}
```

```ts
// Task 2 — streaming.ts
export const PLATFORM_TARGETS: { name: string; lufs: number }[] = [
  { name: 'Spotify', lufs: -14 },
  { name: 'Apple Music', lufs: -16 },
  { name: 'YouTube', lufs: -14 },
  { name: 'Tidal', lufs: -14 },
  { name: 'Amazon Music', lufs: -14 },
  { name: 'SoundCloud', lufs: -11 }, // midpoint of -8 to -14
  { name: 'Beatport', lufs: -8 },
];

export type LufsVerdict = 'pass' | 'warn' | 'fail' | 'unknown';

export function evaluateLufs(your: number | undefined, target: number): LufsVerdict {
  if (your === undefined || Number.isNaN(your)) return 'unknown';
  const diff = Math.abs(your - target);
  if (diff <= 1.0) return 'pass';
  if (diff <= 2.0) return 'warn';
  return 'fail';
}
```

```tsx
// Task 7 — FrequencyBars (Recharts)
const BAND_ORDER: Array<keyof NonNullable<Phase1Data['bands']>> = [
  'sub_bass', 'bass', 'low_mid', 'mid', 'upper_mid', 'presence', 'air',
];
const BAND_LABEL: Record<string, string> = {
  sub_bass: 'SUB', bass: 'BASS', low_mid: 'L.MID', mid: 'MID',
  upper_mid: 'U.MID', presence: 'PRES', air: 'AIR',
};

export function FrequencyBars({ bands }: { bands: Phase1Data['bands'] | undefined }) {
  if (!bands) return <p className={s.empty}>No spectrum data.</p>;
  const data = BAND_ORDER.map((k) => ({
    band: BAND_LABEL[k],
    db: bands[k] ?? -60,
  }));
  return (
    <div className={s.chart}>
      <h3>Spectrum</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart layout="vertical" data={data} margin={{ left: 16, right: 24 }}>
          <XAxis type="number" domain={[-60, 0]} stroke="var(--muted)" />
          <YAxis type="category" dataKey="band" stroke="var(--muted)" />
          <Bar dataKey="db" fill="var(--cyan)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

### Integration points

```yaml
NO BFF CHANGES:
  - JobResultsDto already exposes finalJson + songName + songId + shareToken.
  - PhaseProgress branch in the route file stays exactly as-is.

NO MIGRATION:
  - All data read from existing analyses.final_json.

CSS MODULES:
  - Vite auto-handles *.module.css; no plugin config.
  - Class lookup: `import s from './FrequencyBars.module.css'; <div className={s.chart}>`.

RECHARTS:
  - Already in package.json (^2.15.0). No install.

TESTING:
  - Vitest scripts exist (npm test). Helper unit tests live alongside helpers.
  - No component-level tests in slice 2 (UI is presentational and brittle to snapshot).
```

## Validation Loop

### Level 1 — Build + lint

```bash
cd components/frontend-spectr-v2
npm run type-check
npm run lint
npm run build
```

All three must be clean before integration testing.

### Level 2 — Unit tests

```bash
npm test
```

Only the helpers (grade.ts, streaming.ts) have tests in slice 2.

### Level 3 — Manual smoke

```bash
# (Assumes BFF + worker + frontend already running from slice 1 setup.)
# Open http://localhost:5174, log in with existing account.
# Click into Library → existing completed song → View results.
# Verify:
#   - Grade hero shows "F" in red (the existing test job).
#   - Metadata bar shows BPM ~140, Key B, Genre trance, LUFS −11.2, etc.
#   - Streaming readiness: SoundCloud passes, Spotify/Apple/etc. fail/warn.
#   - Frequency bars render 7 bars in left-to-right (or top-to-bottom).
#   - Stereo card shows width ~19.5%, correlation 0.61.
#   - Coach panel lists 3 fixes ("EQ clash…", "EQ clash…", "Optimize…").
#   - Phase timeline shows 8 rows (phases 1–7 ok, phase 8 skipped).
# Refresh page: report still renders (cached job results).
# Upload a fresh track: page polls, flips to report when complete.
```

## Final Validation Checklist

- [ ] `npm run type-check` clean.
- [ ] `npm run lint` clean (max-warnings 0).
- [ ] `npm run build` clean.
- [ ] `npm test` passes (helper unit tests).
- [ ] Manual: existing slice-1 completed job renders the full report.
- [ ] Manual: fresh upload polls → flips to report on complete.
- [ ] Manual: a job in `failed` status shows error_message + Re-upload link, NOT the JSON dump.
- [ ] Visual sanity: no inline `style={{}}` other than Recharts customization slots; all panel styling in `.module.css` files.
- [ ] `grep -r '<pre' src/features/results/` returns nothing (no JSON dumps in the new view).
- [ ] CLAUDE.md project-structure rules respected (everything under `components/frontend-spectr-v2/src/features/results/`).

## Anti-Patterns to Avoid

- **Don't** add the verdicts panel. That's slice 2.5. Even a stub button "Run verdicts" is out of scope — it makes the page partially functional in a confusing way.
- **Don't** add tabs. The original mockup has 5 tabs (Coach/Analysis/Spectrum/Reference/Arrangement); slice 2 ships a single flat layout that absorbs the must-have content from each. Tabs come back when the verdicts panel arrives.
- **Don't** add WaveSurfer / Listen handoff / Apply preset. Those are Listen-slice concerns. The Coach panel is text-only.
- **Don't** add an "Export PDF" or "Copy share link" button. ShareEndpoints are stubs; these belong to the Discover/share slice.
- **Don't** add a global `<Topnav />` or `<MiniPlayer />` shell. The _app layout already has a minimal topnav from slice 1 — that's enough for slice 2. Real app shell lands when Listen ships (it needs a transport bar).
- **Don't** validate `finalJson` with Zod at the page boundary. A nullable-fields TypeScript view is sufficient — the analysis pipeline is deterministic enough that ad-hoc field absence handling is faster than schema validation overhead.
- **Don't** introduce a UI component library (Mantine, MUI, etc.). CSS Modules + Radix primitives (Dialog already in use from slice 1) carry slice 2 without a heavier lift.
- **Don't** reuse the v1 frontend's mock-data ("frontend-spectr" Recharts code). The v2 stack is greenfield; copy patterns mentally, not literally.
- **Don't** chase the missing dimension scores / sub-grades / clarity score / arrangement score — they're explicitly marked 🔨 pipeline in the audit and are post-slice-2 work.
- **Don't** add a sortable phase timeline or expandable phase rows. Static rows with status pills are enough.
- **Don't** memoize aggressively. The page renders once per `complete` job; `useMemo` adds noise without measurable benefit.

## Self-review

- [ ] All 7 panel components live under `src/features/results/`, each with its `.tsx` + `.module.css` sibling.
- [ ] Helper modules are pure (no React imports) and unit-tested.
- [ ] ReportView is the only orchestrator; panel components are dumb props-in / DOM-out.
- [ ] No inline styles other than Recharts customization (verified by `grep`).
- [ ] `tokens.css` grew but no existing tokens were renamed.
- [ ] `_app/songs.$songId.results.$jobId.tsx` is short — only branches on status and delegates.
- [ ] No new dependencies (Recharts + Radix Dialog already in package.json).
- [ ] CLAUDE.md feature-folder convention respected.
- [ ] Cuts called out in audit (`results.md` §Recommended cuts) are honored — no dimensionScores, no sub-grades, no clarity score, no arrangement score, no time-anchored notes, no tabs, no Apply preset, no WaveSurfer.
- [ ] All validation gates pass.
- [ ] Slice 2.5 (verdicts panel) can drop into ReportView without touching any panel component — just append another section between CoachPanel and PhaseTimeline.
