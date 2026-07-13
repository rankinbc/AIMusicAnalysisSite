# frontend-spectr-v2 — React 19 + TypeScript SPA

Single-page app. Talks only to the C# BFF at `/api/*`. Vite dev server runs
at `http://localhost:5174` and proxies `/api/*` to the BFF at
`http://localhost:5000`.

## Stack

- **Build:** Vite 6
- **Language:** TypeScript strict + `verbatimModuleSyntax`
- **Routing:** TanStack Router (file-based, code-split, typed)
- **Server state:** TanStack Query
- **Validation:** Zod (route search params + hand-mirrored API types in `src/api/types.ts`)
- **UI primitives:** Radix UI (à la carte)
- **Audio:** real Web Audio graph (see Listen page below) + WaveSurfer.js v7 for the upload preview
- **Charts:** Recharts (Spectrum tab uses CSS-only vertical bars instead — Recharts struggles with vertical-grouped layouts at our band density)
- **Toasts:** Sonner
- **Styling:** CSS Modules + `src/styles/{tokens.css,global.css}` + global utility classes (`.card`, `.pill[.tone]`, `.dot[.tone]`, `.btn[.primary/.ghost/.sm]`, `.label`, `.mono`)
- **Test:** Vitest (unit), Playwright (E2E smoke via the MCP)

No Tailwind. No styled-components. No MUI/Chakra/Mantine. Custom audio-tool
aesthetic — full token + utility-class set lives in `src/styles/`.

## Local dev

```bash
npm install
npm run dev
```

The BFF must be running on port 5000 for `/api/*` to resolve.

## Routing structure

```
/                              → redirect to /library
/_public/login                 anon
/_public/register              anon
/_public/pricing               anon — pricing page (story 2.1)
/_public/r/$token              anon — public share-link reviewer
/_app/library                  authed — grid card view + filter pills
/_app/songs/$songId            authed — Song detail (hero + ProgressTimeline + VersionList)
/_app/songs/$songId/results/$jobId   authed — Results page (5-tab strip + AI Coach + verdicts + DSP-side tabs)
/_app/listen-rack/$versionId   authed — Listen rack page (rack + visuals; /listen/$versionId redirects here)
/_app/billing                  authed — manage subscription self-service (story 2.2)
/_app/billing/success          authed — post-checkout poll for tier flip (story 2.1)
/_public/billing/cancelled     anon  — Stripe Checkout cancellation landing (story 2.1)
/_app/profile                  authed
```

Child-route gotcha: `songs.$songId.tsx` checks `useChildMatches().length > 0` and returns `<Outlet />` early when a deeper route is active. Without that, the parent's song-detail UI would render *behind* the child route.

## Auth flow

- Access token kept in module state (`api/fetcher.ts`), NEVER localStorage.
- Refresh token in httpOnly cookie set server-side. Cookie domain matches the dev origin.
- `fetcher.ts` owns 401-retry-with-silent-refresh — single in-flight refresh Promise so concurrent 401s collapse to one `/auth/refresh` call.
- `AuthProvider` runs `/auth/me` on mount (silent refresh first). `_app` route's `beforeLoad` short-circuits during `isLoading=true` so there's no flash-of-redirect.

## Results page architecture

- `SongHeader` — track identity + "Analyzed from" input chips; missing inputs render as live "+ Add …" buttons that open the matching upload dialog (stems/.als/reference; a new mix routes to the song page)
- `ResultsTabs` — AI Coach (default) / Findings / Project (or `ProjectUnlock` with a real "Upload .als" CTA) / Reference / Track Info / Debug (dev builds only). Each tab swaps the body
- `CoachChat` — featured chat block on AI Coach tab. TranceBot avatar (72 px, EQ visor idle-pulse, faster while streaming, **static under `prefers-reduced-motion: reduce`** via the `useReducedMotion` hook). Wired to the v2 BFF coach API (`POST /api/coach/{analysisId}/messages` + SSE relay at `/messages/{id}/stream` + abort-the-fetch cancel). Streams `{token|done|refusal|error}` events per AR44 with `: heartbeat` comments every 15 s. Stop button replaces "Ask →" while streaming; aborting the SSE fetch flips the BFF cancel path which SETs the Redis cancel key for the worker. Suggestion chips are derived from THIS report's verdict categories (generic fallback when verdicts are empty). Below the input: grounding scope line `Answers grounded in analysis #{shortid} · {n} measurements · {m} verdicts`. Refused turns render the worker's body text + a violet unlock pill (e.g. `Add stems`); TranceBot styling is unchanged per UX-DR17. `EvidenceChips` (`<Pill tone="cyan">` from story 1.7) render below each finalized assistant turn, scroll the matching panel into view + transient-highlight on click. AR38 error codes (`coach_offline` / `coach_unavailable` / `circuit_open` / `llm_provider_down` / `coach_queue_unavailable` / `coach_stream_idle`) flip the chat into an offline state with the canonical copy "Coach is offline — your measured analysis and rule-based findings are unaffected." plus a Retry button. Aria-live announcements are throttled to ≤1 update per 500 ms so screen readers don't stutter every token. Per-analysis cap state (story 1.9) is server-driven via the `caps` field on the conversation DTO + POST response; the `CoachCapChip` (UX-DR16 grammar, amber at 1 remaining) renders in the card header and the `CoachGateInline` (Pro upgrade + buy-credits CTAs) replaces the input row when `capReached`. Cap source-of-truth lives BFF-side (`COUNT(*)` user messages per conversation against `IOptions<CoachCapsOptions>.FreeFollowups`); the frontend never recomputes.
- `FindingsTab` — Problem/fault list from the rule engine + specialists
- `ReferenceTab` — genre-profile comparison: real `phase6.percentile` ring (honest empty state when absent — never fabricated) + GapRow list
- `TrackInfoTab` — measured phase data (stereo, translation, spectrogram/waveform images)
- `DebugTab` — raw pipeline I/O inspector, dev builds only (story 12.5)

## Listen page architecture

`/listen-rack/$versionId` is the live Listen page (rack + visuals + rail); the legacy `/listen/$versionId` redirects to it. The Web Audio DSP engine below still lives in `features/listen/`.

### Audio graph (`features/listen/useAudioGraph.ts`)

```
<audio> → MediaElementAudioSourceNode → 8× BiquadFilter (EQ)
        → DynamicsCompressorNode → makeup GainNode
        → WaveShaper-parallel (Saturation dry + wet)
        → ChannelSplitter → 4 gain nodes (M/S matrix) → ChannelMerger
        → master bypass lane (dry passthrough vs processed)
        → AnalyserNode (FFT)
        → ChannelSplitter → 2× AnalyserNode (L/R time-domain, for Scope)
        → destination
```

Tool toggles change **parameters**, not graph topology. Disabling EQ zeros all band gains; disabling the compressor sets threshold=0 / ratio=1; disabling saturation sets curve linear + mix=0; disabling M/S Width sets the matrix to identity. Master bypass crossfades between a dry passthrough and the processed lane via a gain pair. No disconnect/reconnect mid-stream → no audio glitches.

### Pitch tool: parallel BufferSource lane

Web Audio's `MediaElementAudioSourceNode` doesn't support `detune`, so the pitch tool runs a parallel `AudioBufferSourceNode` lane:

1. On first Pitch enable: hook fetches the audio URL, decodes to `AudioBuffer` (cached for subsequent toggles).
2. Disconnects `MediaElementSource` from the chain; pauses the `<audio>` tag.
3. Creates an `AudioBufferSourceNode` with `detune.value = semitones*100 + cents` and connects it to the same chain entry.
4. On Pitch disable: stops the BufferSource, reconnects `MediaElementSource`, restores `<audio>.currentTime` to the BufferSource's last position.

**Caveat:** Web Audio's `detune` scales `playbackRate`, so **pitch + tempo move together**. True tempo-safe pitch shift requires an AudioWorklet phase vocoder (or shipping a WASM lib like SoundTouch) — deferred to a follow-up slice. UI labels this honestly.

### Visualization

Per-page rAF loop reads `AnalyserNode.getByteFrequencyData` + 2× `getFloatTimeDomainData` and updates:
- Hero spectrum bars (56 log-spaced bands)
- Live meter rail — short LUFS (RMS − 0.691 dB, K-weighting approximation), true peak, L/R Pearson correlation, M/S width
- Scope tool's goniometer canvas (Lissajous from L/R buffers, rotated 45° so mono = vertical line)
- Frequency tilt mini-spectrum on the side rail

### Hook stability

`useAudioGraph` returns a **memoized handle** (`useMemo(() => ({...}), [])`) — without this, a fresh object every render would re-fire any consumer effect with `[graph]` in its deps, kicking off duplicate decode/swap operations mid-flight. All handle methods close over refs only (never React state), so freezing identity at first render is safe.

### Entry points

- Library card play button → `/listen-rack/{currentVersion.id}`
- Song detail row "▶ Listen" link → `/listen/{version.id}`
- Topnav Listen tab is disabled until we have a "currently-loaded" track context (future).

## Audio URL auth

The BFF streams audio at `GET /api/versions/{id}/audio` (Range-enabled). HTMLMediaElement can't attach `Authorization` headers, so the audio URL embeds the JWT as `?t=<token>`. The BFF's `JwtBearerEvents.OnMessageReceived` reads the query param for paths matching `/audio` only. **Token in URL leaks into server logs** — pre-public exposure, swap to a short-lived HMAC-signed audio URL.

## Generated artifacts

- `src/routeTree.gen.ts` — generated by the TanStack Router vite plugin from `src/routes/**`. Don't edit by hand.
- `src/api/generated/**` — orval-generated; regen with `npm run gen-types` after BFF schema changes. Note: pydantic2ts CLI currently fails on Windows for verdict types — hand-mirror those in `src/api/types.ts` for now.

## Design system foundation (story 1.7)

The design system is custom in-repo — no MUI/shadcn/Tailwind. Composition is:

- **Tokens** at `src/styles/tokens.css` — single source for color, spacing,
  radius, severity, tier, and paywall values. Story 1.7 added `--space-4-5`,
  the `--sev-warning/info/fixed` aliases, the `--tier-free/pro/credits`
  trio, and `--paywall-overlay`. Bridge tokens from story 1.2
  (`--accent-bright*`, `--ink-on-accent*`) stay byte-identical pending an
  Epic 5 / Phase B sweep.
- **Global utilities** at `src/styles/global.css` — `.card / .card-hd /
  .card-body`, `.label`, `.pill` + 6 tones, `.dot` + 4 tones, `.btn` +
  primary/ghost/sm/violet, the six animation keyframes
  (`fadeUp fadeIn fillW fillH pulse pulseGlow`) plus utility classes
  (`.fade-up`, `.pulse-glow`, `.pulse-soft`), plus the `.sr-only`
  visually-hidden helper. Mirrors the canonical mockup at
  `requirements/claude-design-ui-files/styles.css`.
- **UI primitives** at `src/ui/` — `BrandMark`, `GradePill`,
  `Pill`/`Dot`/`Label` (typed React wrappers around the global classes).
  `GradePill` announces "Grade: A" to screen readers via `.sr-only`.
- **Self-hosted fonts** at `public/fonts/` — Syne (variable, Latin subset,
  with ss01 + ss02 stylistic sets) + JetBrains Mono (variable, Latin
  subset, with `tnum`). No Google CDN. Enforced by
  `scripts/check-no-google-fonts.mjs` (`npm run lint:fonts`).
- **Reduced motion** — `global.css` ends with a
  `@media (prefers-reduced-motion: reduce)` block that collapses every
  animation + transition to 0.001ms. Test guards live in
  `src/styles/__tests__/reduced-motion.test.ts`.
- **Ambient signature** — dual radial gradients + 48 px grid overlay on
  `body`; survives any reset via `src/styles/__tests__/global.test.ts`.

## Validation gates (before commit)

```bash
npx tsc --noEmit                   # no errors
npm run lint                       # --max-warnings 0
npm run lint:css                   # no raw hex in *.module.css
npm run lint:prices                # no price literals outside config
npm run lint:fonts                 # no Google Fonts references (story 1.7)
npm run build                      # production bundle
npx vitest run                     # current baseline: 353 tests
```
