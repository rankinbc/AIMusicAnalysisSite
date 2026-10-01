# Song Page Console — Build Plan 2 of 2: Frontend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/_app/songs/$songId` as the version-management console from the delivered
design (`PRPs/design_handoffs/song-page-console/SongPageConsole.dc.html`) — A/B quick-player,
inline compare with personal scores + notes, a grade-free score-trend chart, de-cluttered
version rows, and a local game-plan view — decomposing the 535-line route monolith into
`src/features/song/`.

**Architecture:** A thin route shell composes feature components. Real data comes from the
extended `/api/songs/{id}` payload (Plan 1) via TanStack Query; mutations use the new rating /
compare-notes endpoints (Plan 1) and existing version hooks. The A/B player uses two native
`<audio>` elements + the design's bar-waveform visual (driven by real `currentTime`) — **no
WaveSurfer** (not in the app; the design's waveform is decorative). The compare math, status
derivation, and verdict logic are ported into a pure `song-helpers.ts` (the heavily-tested
unit). The game-plan view reads the existing per-version `localStorage` (`listenFixes:{id}`).

**Tech Stack:** React 19 + TS strict (`verbatimModuleSyntax`), TanStack Router + Query, CSS
Modules + `tokens.css` global utility classes, Sonner toasts, Vitest (Node env).

## Global Constraints

- TS strict + `verbatimModuleSyntax`: **`import type` for type-only imports**.
- **CSS Modules + global utility classes** (`.card`/`.card-hd`/`.card-body`, `.pill`+tone,
  `.dot`, `.btn`+`.primary/.ghost/.sm/.violet`, `.label`, `.mono`) + `var(--*)` tokens. **No
  Tailwind.** Inline styles ONLY for dynamic values (color-from-state); static styling →
  `*.module.css`. The `.dc.html` uses inline styles because it's a prototype — port static
  ones to modules.
- HTTP via `fetcher` from `src/api/fetcher.ts` (no axios). Access token auto-attached;
  `getAccessToken()` for the audio URL.
- TanStack Query keys: song is `['songs', songId]`; mutations invalidate `['songs']` (broad)
  + `['versions', versionId]` (surgical) — mirror existing hooks in `src/api/hooks.ts`.
- **Audio URL memo dep is `[versionId]` only** — never include the token, or a silent refresh
  swaps `src` and resets `currentTime` (CLAUDE.md gotcha).
- Routes: Listen = `/listen-rack/$versionId`; Report = `/songs/$songId/results/$jobId`.
- Tests run in **Node** (not jsdom): use `renderToStaticMarkup` for component smoke tests and
  plain unit tests for `song-helpers.ts`. Mock `sonner` + `@tanstack/react-router` like the
  existing `__tests__`.
- Four gates must pass: `npx tsc --noEmit`, `npm run lint` (--max-warnings 0), `npm run build`,
  `npx vitest run` (from `components/frontend-spectr-v2`).
- Source of truth for markup/styling/exact values: `SongPageConsole.dc.html`. Source of truth
  for behavior/logic: its `<script>` view-model. This plan ports both; line refs point into it.

---

## File map (all under `components/frontend-spectr-v2/`)

| File | Create / Modify | From `.dc.html` |
|---|---|---|
| `src/api/types.ts` | Modify | add `VersionMetricsDto`, extend `VersionDto` |
| `src/api/hooks.ts` | Modify | add rating + compare-notes hooks |
| `src/features/song/song-helpers.ts` | Create | view-model logic (lines 405–528, 603–646) |
| `src/features/song/song-helpers.test.ts` | Create | unit tests |
| `src/features/song/useQuickPlayer.ts` | Create | player state (lines 436–450, 561–600) |
| `src/features/song/SongConsole.tsx` | Create | route body + screen states (lines 44–356) |
| `src/features/song/SongHeader.tsx` | Create | lines 98–143 |
| `src/features/song/QuickPlayer.tsx` | Create | lines 145–230 |
| `src/features/song/ComparePanel.tsx` | Create | lines 202–228 + `compareVM` |
| `src/features/song/ScoreTrendCard.tsx` | Create | lines 232–249 + 603–646 |
| `src/features/song/VersionList.tsx` | Create | lines 251–337 |
| `src/features/song/VersionRow.tsx` | Create | lines 259–334 |
| `src/features/song/VersionRowMenu.tsx` | Create | lines 317–331 (+ "View game plan") |
| `src/features/song/GamePlanViewModal.tsx` | Create | NEW (not in design) |
| `src/features/song/SongConsole.module.css` | Create | ported static styles |
| `src/routes/_app/songs.$songId.tsx` | Modify | thin shell → `<SongConsole>` |

---

## Task 1: Types + API hooks

**Files:**
- Modify: `src/api/types.ts` (after `AnalysisSummaryDto`, ~line 175; and `VersionDto` ~142)
- Modify: `src/api/hooks.ts` (append near the version hooks)

**Interfaces:**
- Produces: `VersionMetricsDto`; `VersionDto.latestResult?: VersionMetricsDto | null` +
  `VersionDto.personalScore?: number | null`. Hooks: `useSetPersonalScore(versionId)`
  (mutate `(score:number)`), `useClearPersonalScore(versionId)` (mutate `()`),
  `useCompareNotes(songId,a,b)` (query → `{body:string}`), `useSaveCompareNotes(songId)`
  (mutate `({a,b,body})`), `useDeleteCompareNotes(songId)` (mutate `({a,b})`).

- [ ] **Step 1: Add types** (`src/api/types.ts`)

```typescript
export interface VersionMetricsDto {
  score: number | null;
  lufs: number | null;
  dynamicRangeLu: number | null;
  bass: number | null;
  air: number | null;
  stereoWidth: number | null;
}
```

Extend `VersionDto` (add two optional fields so old payloads still type-check):

```typescript
export interface VersionDto {
  id: string;
  songId: string;
  versionNumber: number;
  label: string | null;
  isCurrent: boolean;
  filePath: string;
  createdAt: string;
  alsFilePath: string | null;
  referencePath: string | null;
  latestResult?: VersionMetricsDto | null;
  personalScore?: number | null;
}
```

- [ ] **Step 2: Add the hooks** (`src/api/hooks.ts`) — mirror `usePatchVersion`'s style

```typescript
export function useSetPersonalScore(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (score: number) =>
      fetcher<{ score: number }>({
        url: `/versions/${versionId}/rating`, method: 'PUT', data: { score },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['songs'] }),
  });
}

export function useClearPersonalScore(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetcher<void>({ url: `/versions/${versionId}/rating`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['songs'] }),
  });
}

export function useCompareNotes(songId: string, a: string | null, b: string | null) {
  return useQuery({
    queryKey: ['compare-notes', songId, ...[a, b].filter(Boolean).sort()],
    queryFn: () =>
      fetcher<{ body: string }>({
        url: `/compare/notes`, method: 'GET',
        params: { versionA: a as string, versionB: b as string },
      }),
    enabled: Boolean(a && b),
  });
}

export function useSaveCompareNotes(songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { a: string; b: string; body: string }) =>
      fetcher<{ body: string }>({
        url: `/compare/notes`, method: 'PUT',
        params: { versionA: v.a, versionB: v.b }, data: { body: v.body },
      }),
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ['compare-notes', songId, ...[v.a, v.b].sort()] }),
  });
}

export function useDeleteCompareNotes(songId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { a: string; b: string }) =>
      fetcher<void>({ url: `/compare/notes`, method: 'DELETE', params: { versionA: v.a, versionB: v.b } }),
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ['compare-notes', songId, ...[v.a, v.b].sort()] }),
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd components/frontend-spectr-v2 && npx tsc --noEmit`
Expected: PASS (no usages yet; types compile).

- [ ] **Step 4: Commit**

```bash
git add components/frontend-spectr-v2/src/api/types.ts components/frontend-spectr-v2/src/api/hooks.ts
git commit -m "feat(song): types + rating/compare-notes query hooks"
```

---

## Task 2: `song-helpers.ts` — the pure view-model (HEAVY TDD)

This is the most-tested unit. Port the logic from the `.dc.html` `<script>`: `METRICS`
(lines 490–497), `compareVM` delta math (498–528), `noteKey` (480), the trend builder
(603–646), and row status derivation (651–687).

**Files:**
- Create: `src/features/song/song-helpers.ts`
- Create: `src/features/song/song-helpers.test.ts`

**Interfaces:**
- Produces:
  - `type Dir = 'high' | 'target' | 'neutral'`
  - `const METRICS: { key: keyof VersionMetricsDto; label: string; unit: string; dec: number; dir: Dir; target?: number }[]`
  - `metricDelta(a: number|null, b: number|null, m): { aStr; bStr; deltaStr; tone: 'good'|'bad'|'neutral' }`
  - `personalVerdict(aP: number|null, bP: number|null): { deltaStr; tone; label }`
  - `noteKey(aId: string, bId: string): string` (sorted, `-` joined)
  - `versionStatus(v): 'analyzed'|'analyzing'|'failed'|'unscored'` (input shape below)
  - `sortVersionsDesc(versions): VersionDto[]`
  - `defaultSlots(versions): { a: string|null; b: string|null }` (a=current||first, b=previous)
  - `trendPoints(versions): { n; score; x; y }[]` + `trendStr(...)` (kept simple; the SVG math
    can stay in `ScoreTrendCard`, but expose `scoredAsc(versions)` + `trendSummary`).

- [ ] **Step 1: Write the failing tests** (`song-helpers.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import {
  METRICS, metricDelta, personalVerdict, noteKey, versionStatus,
  sortVersionsDesc, defaultSlots, scoredAsc, trendSummary,
} from './song-helpers';
import type { VersionDto } from '../../api/types';

const v = (over: Partial<VersionDto>): VersionDto => ({
  id: 'x', songId: 's', versionNumber: 1, label: null, isCurrent: false,
  filePath: 'f', createdAt: '2026-05-01', alsFilePath: null, referencePath: null,
  ...over,
});

describe('metricDelta', () => {
  const score = METRICS.find(m => m.key === 'score')!;
  const lufs = METRICS.find(m => m.key === 'lufs')!;
  it('higher-is-better: A above B is good', () => {
    expect(metricDelta(87, 80, score)).toMatchObject({ deltaStr: '+7', tone: 'good' });
  });
  it('higher-is-better: A below B is bad', () => {
    expect(metricDelta(70, 80, score).tone).toBe('bad');
  });
  it('target metric (LUFS ~ -9): closeness wins, not magnitude', () => {
    // A=-9 is closer to -9 than B=-6 → good
    expect(metricDelta(-9, -6, lufs).tone).toBe('good');
  });
  it('near-equal within epsilon → neutral ±0', () => {
    expect(metricDelta(80.01, 80, score)).toMatchObject({ deltaStr: '±0', tone: 'neutral' });
  });
  it('missing side → em dash, neutral', () => {
    expect(metricDelta(null, 80, score)).toMatchObject({ aStr: '—', tone: 'neutral' });
  });
});

describe('personalVerdict', () => {
  it('A higher', () => expect(personalVerdict(90, 78)).toMatchObject({ deltaStr: '+12', tone: 'good' }));
  it('B higher', () => expect(personalVerdict(70, 80)).toMatchObject({ deltaStr: '-10', tone: 'bad' }));
  it('level', () => expect(personalVerdict(80, 80)).toMatchObject({ tone: 'neutral' }));
  it('unset → prompt', () => expect(personalVerdict(null, 80).label).toMatch(/score/i));
});

describe('noteKey', () => {
  it('is order-independent (sorted)', () => {
    expect(noteKey('b', 'a')).toBe(noteKey('a', 'b'));
    expect(noteKey('a', 'b')).toBe('a-b');
  });
});

describe('versionStatus', () => {
  it('analyzed when scored result present', () =>
    expect(versionStatus(v({ latestResult: { score: 87, lufs: null, dynamicRangeLu: null, bass: null, air: null, stereoWidth: null } }))).toBe('analyzed'));
  it('unscored when no result', () => expect(versionStatus(v({}))).toBe('unscored'));
});

describe('sortVersionsDesc / defaultSlots', () => {
  const vs = [v({ id: '1', versionNumber: 1, createdAt: '2026-05-01' }),
              v({ id: '3', versionNumber: 3, isCurrent: true }),
              v({ id: '2', versionNumber: 2 })];
  it('sorts newest first', () => expect(sortVersionsDesc(vs).map(x => x.versionNumber)).toEqual([3, 2, 1]));
  it('defaultSlots: A=current, B=previous', () =>
    expect(defaultSlots(vs)).toEqual({ a: '3', b: '2' }));
});

describe('trend', () => {
  const vs = [v({ id: '1', versionNumber: 1, latestResult: { score: 62, lufs: null, dynamicRangeLu: null, bass: null, air: null, stereoWidth: null } }),
              v({ id: '2', versionNumber: 2, latestResult: { score: 87, lufs: null, dynamicRangeLu: null, bass: null, air: null, stereoWidth: null } })];
  it('scoredAsc filters + sorts ascending', () => expect(scoredAsc(vs).map(x => x.versionNumber)).toEqual([1, 2]));
  it('trendSummary reports delta', () => expect(trendSummary(vs)).toMatch(/\+25/));
});
```

- [ ] **Step 2: Run; verify fail**

Run: `cd components/frontend-spectr-v2 && npx vitest run src/features/song/song-helpers.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** (`song-helpers.ts`) — port the `.dc.html` logic

```typescript
import type { VersionDto, VersionMetricsDto } from '../../api/types';

export type Dir = 'high' | 'target' | 'neutral';
export type Tone = 'good' | 'bad' | 'neutral';

export const METRICS: {
  key: keyof VersionMetricsDto; label: string; unit: string; dec: number; dir: Dir; target?: number;
}[] = [
  { key: 'score', label: 'Mix score', unit: '', dec: 0, dir: 'high' },
  { key: 'lufs', label: 'Loudness', unit: ' LUFS', dec: 1, dir: 'target', target: -9 },
  { key: 'dynamicRangeLu', label: 'Dynamics', unit: ' LU', dec: 1, dir: 'high' },
  { key: 'bass', label: 'Bass energy', unit: '', dec: 0, dir: 'neutral' },
  { key: 'air', label: 'Air / highs', unit: '', dec: 0, dir: 'high' },
  { key: 'stereoWidth', label: 'Stereo width', unit: '', dec: 0, dir: 'neutral' },
];

type MetricDef = (typeof METRICS)[number];

export function metricDelta(a: number | null, b: number | null, m: MetricDef) {
  const fmt = (x: number | null) => (x == null ? '—' : x.toFixed(m.dec) + m.unit);
  if (a == null || b == null) return { aStr: fmt(a), bStr: fmt(b), deltaStr: '—', tone: 'neutral' as Tone };
  const diff = a - b;
  const eps = m.dec ? 0.05 : 0.5;
  if (Math.abs(diff) < eps) return { aStr: fmt(a), bStr: fmt(b), deltaStr: '±0', tone: 'neutral' as Tone };
  const deltaStr = (diff > 0 ? '+' : '') + diff.toFixed(m.dec);
  let better: boolean | null = null;
  if (m.dir === 'high') better = diff > 0;
  else if (m.dir === 'target' && m.target != null) better = Math.abs(a - m.target) < Math.abs(b - m.target);
  const tone: Tone = better === true ? 'good' : better === false ? 'bad' : 'neutral';
  return { aStr: fmt(a), bStr: fmt(b), deltaStr, tone };
}

export function personalVerdict(aP: number | null, bP: number | null) {
  if (aP == null || bP == null)
    return { deltaStr: '—', tone: 'neutral' as Tone, label: 'Score A & B to weigh in' };
  const d = aP - bP;
  if (d > 0) return { deltaStr: '+' + d, tone: 'good' as Tone, label: '▲ you rate A higher' };
  if (d < 0) return { deltaStr: String(d), tone: 'bad' as Tone, label: '▼ you rate B higher' };
  return { deltaStr: '±0', tone: 'neutral' as Tone, label: '= you rate them level' };
}

export function noteKey(aId: string, bId: string): string {
  return [aId, bId].slice().sort().join('-');
}

export type VStatus = 'analyzed' | 'analyzing' | 'failed' | 'unscored';
export function versionStatus(v: VersionDto): VStatus {
  if (v.latestResult && v.latestResult.score != null) return 'analyzed';
  // analyzing/failed come from job state when wired; default unscored.
  return 'unscored';
}

export function sortVersionsDesc(versions: VersionDto[]): VersionDto[] {
  return versions.slice().sort((a, b) => b.versionNumber - a.versionNumber);
}

export function defaultSlots(versions: VersionDto[]): { a: string | null; b: string | null } {
  const desc = sortVersionsDesc(versions);
  const current = versions.find(v => v.isCurrent) ?? desc[0] ?? null;
  const prev = desc.find(v => v.id !== current?.id) ?? null;
  return { a: current?.id ?? null, b: prev?.id ?? null };
}

export function scoredAsc(versions: VersionDto[]): VersionDto[] {
  return versions
    .filter(v => v.latestResult?.score != null)
    .sort((a, b) => a.versionNumber - b.versionNumber);
}

export function trendSummary(versions: VersionDto[]): string {
  const sc = scoredAsc(versions);
  if (sc.length < 2) return '';
  const first = sc[0].latestResult!.score!;
  const last = sc[sc.length - 1].latestResult!.score!;
  const d = last - first;
  return `${d >= 0 ? '+' : ''}${d} pts · v${sc[0].versionNumber}→v${sc[sc.length - 1].versionNumber}`;
}
```

- [ ] **Step 4: Run; verify pass**

Run: `cd components/frontend-spectr-v2 && npx vitest run src/features/song/song-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/frontend-spectr-v2/src/features/song/song-helpers.ts \
        components/frontend-spectr-v2/src/features/song/song-helpers.test.ts
git commit -m "feat(song): pure view-model helpers (metric deltas, verdict, status, trend)"
```

---

## Task 3: `useQuickPlayer.ts` — two-deck A/B audio state

Port the player logic from `.dc.html` lines 436–450 (play/seek/pick/loadIntoA) + 561–600
(deck derivation), but back it with two real `<audio>` elements.

**Files:**
- Create: `src/features/song/useQuickPlayer.ts`

**Interfaces:**
- Produces: `useQuickPlayer(versions, initial)` →
  `{ slotA, slotB, audible, playing, posA, posB, audioARef, audioBRef, audioUrl(id),
     setSlot(key,id), play(key), seek(key,fraction), loadIntoA(id), highlight }`.
  `audioUrl(id)` builds `/api/versions/${id}/audio?t=${token}` with token read once
  (not a memo dep). Position comes from each `<audio>`'s `timeupdate`.

- [ ] **Step 1: Implement** (`useQuickPlayer.ts`)

```typescript
import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { getAccessToken } from '../../api/fetcher';
import type { VersionDto } from '../../api/types';
import { defaultSlots } from './song-helpers';

type Key = 'A' | 'B';

export function useQuickPlayer(versions: VersionDto[]) {
  const init = defaultSlots(versions);
  const [slotA, setSlotA] = useState<string | null>(init.a);
  const [slotB, setSlotB] = useState<string | null>(init.b);
  const [audible, setAudible] = useState<Key>('A');
  const [playing, setPlaying] = useState(false);
  const [posA, setPosA] = useState(0);
  const [posB, setPosB] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);

  const refOf = (k: Key) => (k === 'A' ? audioARef : audioBRef);

  const audioUrl = useCallback((id: string | null) => {
    if (!id) return undefined;
    const t = getAccessToken();
    return t ? `/api/versions/${id}/audio?t=${encodeURIComponent(t)}` : undefined;
  }, []);

  const pause = (k: Key) => { refOf(k).current?.pause(); };
  const start = (k: Key) => { void refOf(k).current?.play().catch(() => {}); };

  const play = useCallback((k: Key) => {
    setAudible(prev => {
      if (prev !== k) { pause(prev); start(k); setPlaying(true); return k; }
      // toggle on the live deck
      const el = refOf(k).current;
      if (el?.paused) { start(k); setPlaying(true); } else { pause(k); setPlaying(false); }
      return prev;
    });
  }, []);

  const seek = useCallback((k: Key, fraction: number) => {
    const el = refOf(k).current;
    if (el && el.duration) el.currentTime = Math.max(0, Math.min(1, fraction)) * el.duration;
    setAudible(prev => { if (prev !== k) { pause(prev); } return k; });
    start(k); setPlaying(true);
  }, []);

  const setSlot = useCallback((k: Key, id: string) => {
    (k === 'A' ? setSlotA : setSlotB)(id);
  }, []);

  const loadIntoA = useCallback((id: string) => {
    setSlotA(id); setAudible('A'); setHighlight(id); start('A'); setPlaying(true);
  }, []);

  // timeupdate handlers (wire onTimeUpdate on each <audio>)
  const onTime = useCallback((k: Key) => {
    const el = refOf(k).current;
    if (!el || !el.duration) return;
    (k === 'A' ? setPosA : setPosB)(el.currentTime / el.duration);
  }, []);

  return {
    slotA, slotB, audible, playing, posA, posB, highlight,
    audioARef: audioARef as RefObject<HTMLAudioElement>,
    audioBRef: audioBRef as RefObject<HTMLAudioElement>,
    audioUrl, play, seek, setSlot, loadIntoA, onTime,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd components/frontend-spectr-v2 && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/frontend-spectr-v2/src/features/song/useQuickPlayer.ts
git commit -m "feat(song): two-deck A/B quick-player audio hook"
```

---

## Task 4: Presentational components (port markup → CSS modules)

Each component ports a section of `SongPageConsole.dc.html` to JSX: convert `{{ binding }}`
to props, the `<sc-if>`/`<sc-for>` to JSX conditionals/`.map`, and **static inline styles to
classes in `SongConsole.module.css`**; keep only dynamic styles inline (live-deck color, tone
colors, bar heights, accent border). Use the global utility classes (`.card`, `.pill`, `.btn`,
`.mono`, `.label`) verbatim — they already exist.

**Files (create each):**
- `src/features/song/SongHeader.tsx` ← `.dc.html` 98–143
- `src/features/song/QuickPlayer.tsx` ← 145–200 (decks) + renders `<ComparePanel>` for 202–228
- `src/features/song/ComparePanel.tsx` ← 202–228 + `compareVM` math via `song-helpers`
- `src/features/song/ScoreTrendCard.tsx` ← 232–249 + SVG builder 603–646
- `src/features/song/VersionRow.tsx` ← 259–334
- `src/features/song/VersionRowMenu.tsx` ← 317–331 (+ the new "View game plan" item)
- `src/features/song/VersionList.tsx` ← 251–337 (maps rows)
- `src/features/song/SongConsole.module.css` ← all ported static styles

**Interfaces (props):**
- `SongHeader({ song, onEdit, onPublish, onAddVersion, onArchive })`
- `QuickPlayer({ song, player })` where `player = useQuickPlayer(...)`; renders two decks +
  `<ComparePanel song player />`
- `ComparePanel({ song, slotA, slotB })` — uses `metricDelta`/`personalVerdict`, the rating
  hooks (`useSetPersonalScore`), and `useCompareNotes`/`useSaveCompareNotes`
- `ScoreTrendCard({ versions, onPointClick })`
- `VersionRow({ song, version, slotA, slotB, highlight, onPlay, onReport, onRetry, menu })`
- `VersionRowMenu({ version, hasGamePlan, onMakeCurrent, onEditLabel, onReanalyze, onReanalyzeRef, onOpenListen, onViewGamePlan, onDelete })`

- [ ] **Step 1: Build the components** porting the referenced `.dc.html` lines. For each, map
  `{{ }}` bindings to the props above and the view-model fields (e.g. `row.scoreStr` →
  `version.latestResult?.score`, `row.hasPersonal` → `version.personalScore != null`,
  `slot.live` → `player.audible === key`). The deck waveform: render the 52-bar visual exactly
  as `.dc.html` `renderVals().slot()` (lines 571–584) — keep `waveFor(id)` (the deterministic
  bar array) in a small local util; the playhead `left` = `pos*100%`. Wire each deck to its
  `<audio ref={...} src={player.audioUrl(id)} onTimeUpdate={() => player.onTime(key)} crossOrigin="anonymous" />`.

- [ ] **Step 2: Add smoke tests** (Node env → `renderToStaticMarkup`). Create
  `src/features/song/__tests__/song-console.test.tsx`:

```typescript
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { VersionRowMenu } from '../VersionRowMenu';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

describe('VersionRowMenu', () => {
  it('shows "View game plan" only when a plan exists', () => {
    const props = {
      version: { id: 'v', versionNumber: 1 } as never,
      onMakeCurrent: vi.fn(), onEditLabel: vi.fn(), onReanalyze: vi.fn(),
      onReanalyzeRef: vi.fn(), onOpenListen: vi.fn(), onViewGamePlan: vi.fn(), onDelete: vi.fn(),
    };
    const withPlan = renderToStaticMarkup(<VersionRowMenu {...props} hasGamePlan />);
    const without = renderToStaticMarkup(<VersionRowMenu {...props} hasGamePlan={false} />);
    expect(withPlan).toContain('game plan');
    expect(without).not.toContain('game plan');
  });
});
```

> Keep `VersionRowMenu` always-rendered (no portal) so static markup contains the items; if it
> uses an open/close state, default it open in the test via a prop, or assert on the item list
> the component returns. Adjust the assertion to the real label casing.

- [ ] **Step 3: Run typecheck + tests**

Run: `cd components/frontend-spectr-v2 && npx tsc --noEmit && npx vitest run src/features/song`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/frontend-spectr-v2/src/features/song/
git commit -m "feat(song): header, quick-player, compare, trend, version rows"
```

---

## Task 5: Game-plan view (local-interim)

Reads the existing per-version `localStorage` plan written by the Listen Plan tab.

**Files:**
- Create: `src/features/song/GamePlanViewModal.tsx`
- Modify: `VersionRowMenu.tsx` already has the conditional item (Task 4).

**Interfaces:**
- Consumes: `readListenFixes(versionId)` from `../listen-rack/listenFixes` →
  `ListenFix[]` (`{ fixId, title, scope, sev, ... }`).
- Produces: `hasGamePlan(versionId): boolean` (`readListenFixes(...).length > 0`),
  `GamePlanViewModal({ versionId, open, onOpenChange, onApplyInListen })`.

- [ ] **Step 1: Implement** — `GamePlanViewModal` lists each `ListenFix` (title + scope + a
  severity `.pill` tone) read-only, with an "Apply in Listen ↗" button that calls
  `onApplyInListen` (navigates to `/listen-rack/$versionId`) and a "Back to Report" link.
  Add a `hasGamePlan(versionId)` helper in `song-helpers.ts` (re-exports the `readListenFixes`
  length check) so rows can show the `◷ plan` marker.

```typescript
// add to song-helpers.ts
import { readListenFixes } from '../listen-rack/listenFixes';
export function hasGamePlan(versionId: string): boolean {
  return readListenFixes(versionId).length > 0;
}
```

- [ ] **Step 2: Wire into `VersionRow`** — show a `◷ plan` `.pill` when `hasGamePlan(version.id)`,
  and pass `hasGamePlan` + `onViewGamePlan` into `VersionRowMenu`; opening the modal sets the
  active version id in `SongConsole`.

- [ ] **Step 3: Typecheck + test**

Run: `cd components/frontend-spectr-v2 && npx tsc --noEmit && npx vitest run src/features/song`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/frontend-spectr-v2/src/features/song/
git commit -m "feat(song): local-interim game-plan view from listenFixes localStorage"
```

---

## Task 6: Assemble `SongConsole` + swap the route

**Files:**
- Create: `src/features/song/SongConsole.tsx`
- Modify: `src/routes/_app/songs.$songId.tsx`

**Interfaces:**
- `SongConsole({ songId })` owns: `useSong(songId)`, the `useQuickPlayer`, dialog open-state,
  the active game-plan version, toast routing, and renders the four screen states (loading /
  empty / error / populated) per `.dc.html` 44–356.
- The route file keeps the `useChildMatches()` → `<Outlet/>` early return, then renders
  `<SongConsole songId={songId} />`.

- [ ] **Step 1: Build `SongConsole.tsx`** composing Tasks 2–5. Map states:
  `isLoading` → loading skeletons (`.dc.html` 44–72); `error || !song` → error card (84–92);
  `song.versions.length === 0` → empty card (74–82); else the populated stack (94–340):
  `<SongHeader>`, `<QuickPlayer>` (which renders `<ComparePanel>`), `<ScoreTrendCard>`,
  `<VersionList>`. Reuse existing dialogs (`UnifiedUploadDialog`, `SongEditDialog`,
  `SharePublishDialog`, `ConfirmDialog`, `ReanalyzeWithReferenceDialog`) with their existing
  props; reuse existing hooks (`useArchiveSong`, `useSetCurrentVersion`, `usePatchVersion`,
  `useReanalyzeVersion`, `useDeleteVersion`) — wire their toasts/navigation exactly as the
  current `songs.$songId.tsx` does (preserve behavior). Navigation: Listen =
  `navigate({ to: '/listen-rack/$versionId', params: { versionId } })`; Report =
  `navigate({ to: '/songs/$songId/results/$jobId', params: { songId, jobId } })`.

- [ ] **Step 2: Replace the route body** (`songs.$songId.tsx`)

```typescript
import { createFileRoute, Outlet, useChildMatches } from '@tanstack/react-router';
import { SongConsole } from '../../features/song/SongConsole';

export const Route = createFileRoute('/_app/songs/$songId')({
  component: SongDetailPage,
});

function SongDetailPage() {
  const { songId } = Route.useParams();
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <SongConsole songId={songId} />;
}
```

> Delete the now-orphaned inline `MakeCurrentButton`/`ReanalyzeButton`/`EditVersionLabelButton`/
> `DeleteVersionDialog` from the route file (moved into `features/song/`). Keep
> `songDetail.module.css` only if still referenced; otherwise migrate needed rules into
> `SongConsole.module.css`.

- [ ] **Step 3: Manual + automated verification**

Run all four gates:
```bash
cd components/frontend-spectr-v2
npx tsc --noEmit
npm run lint
npm run build
npx vitest run
```
Expected: all PASS. Then `npm run dev` and click a song from the library: header, A/B decks
(play one, then the other — audio switches), compare tiles + personal score + notes, trend
chart (click a point loads deck A), version rows with menu, game-plan marker if a plan exists.

- [ ] **Step 4: Commit**

```bash
git add components/frontend-spectr-v2/src/features/song/SongConsole.tsx \
        components/frontend-spectr-v2/src/routes/_app/songs.\$songId.tsx
git commit -m "feat(song): assemble console + swap route to features/song"
```

---

## Out of scope / notes

- **WaveSurfer:** intentionally NOT used — the design's waveform is a decorative bar visual;
  native `<audio>` drives playback + the playhead. (Deviates from spec §3.2's WaveSurfer
  mention; revisit if real peaks are wanted — `Analysis.waveform_peaks_path` exists.)
- **Analyzing/failed row status** beyond `unscored/analyzed`: the payload doesn't carry live
  job state per version yet; `versionStatus` returns `analyzed`/`unscored`. Wire
  `analyzing`/`failed` when/if per-version job status is added (the design renders them).
- **Game plan** is localStorage-only (this browser); swap to the `game_plans` endpoint when
  PRP-5 ships (spec §3.7).
- Depends on **Plan 1 (BFF)** being merged for real metrics + rating/notes endpoints; the
  frontend degrades gracefully (no metrics → compare tiles show `—`; rating PUT 404s are
  caught and toasted) if run before the BFF lands.

## Self-review (spec coverage)

§3.1 header → SongHeader (Task 4). §3.2 A/B player → useQuickPlayer + QuickPlayer (Tasks 3–4).
§3.3 score trend → ScoreTrendCard (Task 4). §3.4 rows + menu → VersionRow/VersionRowMenu
(Task 4). §3.5 inline compare + personal score + notes → ComparePanel + hooks (Tasks 1, 2, 4).
§3.7 game plan → Task 5. §5 decomposition → all tasks; route shell → Task 6. States → Task 6.
Tests → Tasks 2 (heavy), 4–5 (smoke). Gates → Task 6.
