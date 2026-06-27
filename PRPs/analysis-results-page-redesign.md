# Analysis Results Page — Redesign Spec (for Claude Design)

**Status:** design (approved 2026-06-26) — ready for Claude Design
**Scope:** Frontend-first redesign of the Analysis Results page (`components/frontend-spectr-v2/src/features/results/`), with a clearly-marked **Backend asks** section for new data. Plus the cross-page **Coach Mix** contract that the Listen page consumes.
**Source of truth for data shapes:** [`PRPs/analysis-data-contract.md`](analysis-data-contract.md) — every TypeScript shape the page receives. Read it alongside this spec.

---

## 1. Intent

Keep the page's core functionality, but clean it up and make it more useful. The current page leaks internal artifacts (a stale "8 of 12 phases" ring, "upload N more files to unlock +N specialists" upsell, raw worker phase names, genre shown literally as `other`, a redundant "Re-analyze on changes" box, a History panel) — all of that is **cut**. Everything below the phase-status block in the current screenshots is treated as leftover and replaced.

The redesign reorganizes into a clean tabbed page with a persistent frame, a tiny always-on track player, and a single action-oriented vital. It also introduces a **Coach Mix** flow that carries selected fixes from the Actions tab to the Listen page, where the user can audition them.

### Design principles
- **Results-first, no upsell, no gamification.** No grade ring, no "unlock" nudges, no marketing copy in the report view.
- **One concept per tab.** Track Info = the numbers/visuals; Analysis = how SPECTR works; Findings = problems; Actions = fixes; Debug = raw I/O. No overlap.
- **Graceful empty/not-applicable states everywhere.** Per the data contract, phases routinely come back `skipped`/empty/zeroed (short track, no stems, no reference, no `.als`). Never render a raw `other`, a zero, or a blank panel — render an explicit "not applicable / not uploaded yet" state.
- **Reuse existing components.** Most pieces already exist (see §10 component map). This is a reorganization + cleanup + two net-new surfaces (Debug pipeline diagram, Specialist Team modal), not a from-scratch rebuild.

---

## 2. Page frame (persistent across tabs)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ← all versions                                                              │
│ ╭─────────────────────────────────────────────────────────────╮  ┌───────┐ │
│ │ TrackName  v3   [mix][stems][.als][ref]   ▸ ──●───── 1:24    │  │  side  │ │
│ │            (input chips)        (tiny inline player)          │  │  bar   │ │
│ │                                         ⚑ 3 findings · 2 fix  │  │       │ │
│ ╰─────────────────────────────────────────────────────────────╯  │Uploads │ │
│ [ Track Info ][ Analysis ][ Findings ][ Actions ][ AI Coach ][Debug]│Re-anlz│ │
│ ┌─────────────────────────────────────────────────────────────┐  └───────┘ │
│ │                       active tab body                         │            │
│ └─────────────────────────────────────────────────────────────┘            │
└───────────────────────────────────────────────────────────────────────────┘
```

**Header (left → right):**
- `← all versions` back link.
- **Track name** + version label (e.g. `v3`).
- **Input chips** — mix / stems / .als / reference, showing what the analysis ran on (derive from `useVersionFiles` + phase presence, as `ReportView` already does). A chip with a `+` affordance when an input type is absent → opens the Uploads sidebar staging flow.
- **Tiny inline track player** — play/pause + scrub on the original mix. The BFF already streams it Range-enabled at `GET /api/versions/{id}/audio?t=<jwt>`. The player **persists across tab switches** (do not unmount on tab change) so the user can listen while reading Findings. Keep it compact (single row). Position state survives token refresh (see CLAUDE.md audio gotchas — track off `timeupdate`).
- **NO BPM, NO key, NO grade, NO overall score in the header.** (Those live in Track Info.)

**Header top-right vital (single):**
- **Findings count** — `⚑ N findings · M fixable`. `N` = fault-count from verdicts (existing `faultCount`); `M` = count of findings that carry an applyable fix (existing `buildMoves` length). Color-codes by worst severity present (critical=red … win=green). Clicking it → Findings tab. This is the only header vital. *(Optional future add-ons, not built now: Integrated LUFS vs target, True Peak dBTP, Mono compatibility.)*

**Tab bar:** `Track Info · Analysis · Findings · Actions · AI Coach · Project · Debug`
- **Project** appears **only** when an `.als` project map was stored (`results.alsProject`), exactly as the current conditional Project tab works.
- Tab body is owned by the route's URL search param (deep-linkable), as today.

**Persistent right sidebar (desktop) / drawer (narrow):**
- **Uploads** — current mix/stems/.als/reference list with `+` to add each (folds the current `FilesTab` staging flow into the sidebar).
- **Re-analyze** — single button. Preserves the entitlement gate → `UpgradeSheet` on cap-hit (existing `dispatchReanalyze` flow).
- **NO History** — there is exactly one analysis per version, so there is no history list anywhere.

---

## 3. Tab — Track Info

The "here are the numbers + visuals" tab. Stacked cards; each renders a not-applicable state when its data is empty per the contract.

1. **Visuals row** — server-rendered **waveform** (`results.waveformImageUrl`) + **spectrogram** (`results.spectrogramImageUrl`) images, click-to-zoom. If a URL is absent, show a quiet placeholder, not a broken image.
2. **Loudness & dynamics** — Integrated LUFS (`phase1.lufs`), RMS, sample peak (`peak_dbfs`), **True Peak dBTP** (`true_peak_db`), crest / dynamic range (derive from peak − RMS), clipping (`clipping_detected` → "clean ✓" or `clipped_sample_count`). Color-code against sane release thresholds.
3. **Tonal balance** — the 7-band energy bars (`phase1.bands`: sub_bass → air) via the existing `FrequencyBars`. (Note band-key naming differs from phase4's `band_energy` — render from phase1 here.)
4. **Stereo** — width, correlation, mono compatibility (`phase1.stereo_width / stereo_correlation / mono_compatibility`) via the existing `StereoCard`.
5. **Tempo · Key · Duration · Genre** — compact stat row: BPM (`phase1.bpm`/`phase2.bpm`), detected key (`phase1.detected_key`), duration, genre + confidence (`phase2.genre`/`confidence`). Map genre `"other"` → friendly "Uncategorized" (never show the raw token).
6. **Streaming readiness** — **small section toward the bottom** (demoted, not a hero). The existing `StreamingReadiness` matrix (per-platform LUFS targets + True Peak + No-Clipping rows: Spotify, Apple Music, YouTube, Tidal, Amazon Music, SoundCloud, Beatport).

**Backend asks (future, not built now):**
- A **loudness-over-time** chart (momentary/short-term LUFS timeline) — needs `loudness_timeline` / momentary LUFS surfaced into `final_json` (ties into the in-progress `surface-latent-analysis-datapoints` work).
- **Per-section energy** bars (needs structure/section data surfaced).

---

## 4. Tab — Analysis (SPECTR transparency)

An educational / trust view: "how SPECTR analyzed *your* track," not a stats dump (the stats live in Track Info; the raw I/O lives in Debug).

- **Intro line** — "SPECTR runs N analyses on your track" (N from the actual phase list, not a hardcoded 12) + a tiny read-only pipeline strip that links to the Debug diagram.
- **Per-phase explainer cards**, one per phase in `finalJson.phases[]` (1–9; phase 8 only with `.als`). **Default collapsed** (scannable list; expand for detail). Each card:
  - **Friendly name** + one-line *what it measures* (static copy per phase; no worker labels). Suggested names: Universal Mix · Genre Detection · Genre Scoring · Stem Separation & Clash · Reference Comparison · Gap Analysis · Arrangement · Ableton Project · Mix Translation.
  - **Your value inline** — the headline value(s) for that phase (e.g. "Yours: −16.9 LUFS, peak −3.3 dBFS, key D").
  - **"What this means"** — plain-language explainer (static per phase + light conditional phrasing based on the value).
  - **State** — `ok` / `skipped` ("Not applicable — no reference attached" etc.) / `failed` (friendly message + Retry). Gate rich content on the actual fields, not just `status` (a phase can be `ok` with empty `data`).
  - **Re-run / Retry** controls kept where supported: phases 4/5/8 expose **Re-run** (`POST /api/reports/{jobId}/phases/{phase}/rerun`); any **failed** phase exposes **Retry**; phase 1 is full re-analyze only.

---

## 5. Tab — Findings (formerly "Problems")

Same engine and functionality as today's Problems tab (renamed `problems` → `findings` everywhere: tab key, label, badges, header vital). Source = the Problem-engine + AI specialist verdicts (`useVerdicts`).

- **Finding list**, severity-sorted (critical → severe → moderate → minor → win). Each card: severity badge, headline, plain summary, **evidence chips** (click → jump to the relevant Track Info datapoint), "why it matters," metric line.
- **Filter pills** — by severity and by group (Spectrum / Loudness / Dynamics / Stereo / Sections / Stems / Misc) — reuse `CoachFilters` / `specialists.ts` groups.
- **Fixable → Actions bridge** — any finding carrying a clear fix shows "See fix in Actions →" (jump to Actions, scrolled to that move). This is also what feeds the header `M fixable` count.
- **Degraded state** — preserve `DegradationBanner` ("rule-based findings only" when LLM budget/outage).
- **Empty state** — clean "No issues found" (not a blank panel).

---

## 6. Tab — Actions (fixes + Coach Mix producer side)

The "what to do about it" tab — same core as today's `GamePlan`, surfacing the deterministic SOLVE / fix-rack output. **Only findings that carry a concrete fix appear here.**

- **Prioritized move list** — from `buildMoves(verdicts, top_fixes, coached_fixes)`, ordered by impact. Each **move card**:
  - Plain-language instruction.
  - The **finding it resolves** (back-link to Findings) — cause↔fix always traceable.
  - **Fix detail** when present — DSP-chain params / Ableton hint (`VerdictFix.dsp_chain`, `ableton_hint`), expected outcome.
  - A **selection checkbox** (see Coach Mix flow §8).
  - **Mark applied / dismiss** (persists via verdict `userState`).
- **"Sounds Good — Save to Game Plan"** button — persists the selected fixes + compiled rack as a **version-associated preset** (server; see §8 + Backend asks).
- **Fix Rack export** — keep the existing export affordance (`ExportBar`/`ExportModal`): bundle moves into the downloadable rack/preset + Game Plan export.
- **Empty state** — "No one-click fixes for this track — see Findings for the full picture, or ask the Coach."

---

## 7. Tab — AI Coach

Keep `CoachChat` as-is (grounded chat, evidence chips, caps via `CoachCapChip`, streaming) with a visual cleanup pass. **One net-new surface:**

### Specialist Team modal
- A **"Specialist Team"** icon/button in the AI Coach tab header opens a **modal**.
- Modal content: a **square grid** of specialist bots (icon/avatar per specialist, persona color from `specialists.ts`; ~24–26 specialists across 7 groups). The 4 stems-only specialists are gated/hidden when no stems were uploaded.
- **Already-run specialists are greyed out** (status `cached`). Specialists that produced extra findings show a small **count badge**.
- **Running a specialist** (on-demand) uses the existing run plumbing (`POST /api/reports/{jobId}/verdicts/run/{slug}`, routing/`SpecialistTile` status). While running: a dialog/loading state.
- **Result presentation** — when results come in, render a **templated chatbot-style line in the Coach chat** (NOT an actual LLM response):
  > *"I found 3 additional findings for you to review."* (or "I didn't find anything new this time.")
  Those findings then appear in the **Findings** tab and bump the header `N findings` vital.

---

## 8. Coach Mix — cross-page flow + storage contract

Carries selected fixes from the **Actions tab (producer)** to the **Listen page Coach tab (consumer)**, where the user auditions them on the live DSP chain. **Only rack-able fixes** (those that compile to concrete DSP params) participate on the Listen page; non-rackable advice stays on the results page.

### Fix classification (the seam)
For each fix:
- has a **`dsp_chain`** → **rack-able**: shows as a Listen checkbox + is part of the compiled rack.
- has a **`section` timestamp** (`VerdictFix.section.start_seconds/end_seconds`) → **time-anchored**: triggers a Coach announcement at that point during playback (§9, Phase 2).
- has **both** → both behaviors.
- has **neither** → results-page only (Findings/Actions); never shown on Listen.

### Three storage tiers
| Tier | Holds | Lifetime | Key |
|---|---|---|---|
| **`sessionStorage`** | The user's selected individual fixes **+ the compiled final rack** | This browser session (Actions → Listen handoff) | `coachMix:{versionId}` |
| **`localStorage`** | Per-fix 👍/👎 thumbs feedback | Persistent, local (purpose TBD — store now, decide use later) | `coachMixFeedback:{versionId}:{fixId}` → `'up' \| 'down'` |
| **Server (version-associated)** | The saved Game Plan preset (compiled rack state + chosen fixes) | Durable, tied to the Version | new endpoint (Backend asks) |

**Suggested `sessionStorage` shape** (Claude Design may refine; keep it explicit):
```ts
interface CoachMixHandoff {
  versionId: string;
  jobId: string;
  selectedFixes: {
    fixId: string;
    findingId: string;          // back-reference to the verdict/finding
    label: string;              // plain instruction shown on the Listen checkbox
    dspChain: { type: string; params: Record<string, unknown> }[]; // rack-able fixes only
    section?: { startSeconds: number; endSeconds?: number } | null; // time-anchored fixes
  }[];
  compiledRack: ListenRackState;   // the full generated rack (maps to useAudioGraph params)
  savedAt: string;                 // ISO; when the handoff was written
}
```
`ListenRackState` = the existing Listen-page rack/preset shape (8-band EQ, compressor, saturation, M/S width, pitch) used by `features/listen/useAudioGraph.ts`. **Claude Design: align `compiledRack` to that exact shape** so "Coach Mix" can apply it without translation.

### Listen page — Coach tab, bottom section (consumer UI)
- Reads `sessionStorage` `coachMix:{versionId}` and renders **one checkbox per rack-able selected fix** (label = plain instruction).
- Toggling a checkbox applies/removes that fix's `dsp_chain` on the live graph → user can **hear each fix solo, pair combinations**, or **reset to the full generated rack**.
- A fancy **"Coach Mix"** button applies the **full `compiledRack`** (resets the graph to the complete generated rack).
- Each checkbox has **👍/👎** → write `localStorage` `coachMixFeedback:{versionId}:{fixId}`.

---

## 9. Coach announcements (Listen page, Phase 2)

Time-anchored fixes get a playback moment. During Listen playback, when the playhead reaches a fix's `section.start_seconds`, the **Coach avatar appears** and says, e.g.:
> *"Here's where the low-mid build-up starts — consider cutting 200–400 Hz."*

**Visual treatment: reuse the Room announcement banner** (reference image: the "RACK CONTROL — @forge can now control the rack" banner). Left emblem/bot icon, cyan-glow rounded border, monospace announcement text with a trailing cursor. Same component/treatment the Room feature uses for one-shot announcements. The Coach fix moment is one-shot, dismisses on its own, and does not block playback.

---

## 10. Component map (reuse vs new)

| Surface | Existing component(s) to reuse | New work |
|---|---|---|
| Frame / header | `SongHeader`, `ResultsTabs`, `ReportView` | add tiny player; add Findings vital; remove grade/BPM/key; rename `problems`→`findings`; drop Project from tab list logic only if absent |
| Sidebar | `FilesTab` (staging), `dispatchReanalyze`, `UpgradeSheet` | re-home into a persistent sidebar/drawer; **remove History** |
| Track Info | `FrequencyBars`, `StereoCard`, `StreamingReadiness`, waveform/spectrogram URLs | new Track Info container; demote StreamingReadiness |
| Analysis | phase data via `pickPhaseData` | new per-phase explainer cards + static copy; keep re-run/retry |
| Findings | `ProblemsTab`, `VerdictCard`, `EvidenceChips`, `CoachFilters`, `DegradationBanner` | rename + tidy |
| Actions | `GamePlan`, `buildMoves`, `move-model`, `ExportBar`/`ExportModal` | selection checkboxes; sessionStorage write; "Save to Game Plan" |
| AI Coach | `CoachChat`, `CoachCapChip`, `VerdictsPanel`/`SpecialistTile`, `specialists.ts` | **Specialist Team modal**; templated result line |
| Project | `ProjectTab` | keep (conditional) |
| Debug | `RawTab` (copy pattern) | **pipeline diagram** + per-phase I/O JSON panels |
| Coach Mix (Listen) | `features/listen/useAudioGraph.ts`, listen rack/preset | checkboxes, Coach Mix button, thumbs; consume sessionStorage |
| Announcements | Room announcement banner component | reuse for timed Coach moments (Phase 2) |

---

## 11. Tab — Project (.als) & Tab — Debug

**Project** — unchanged from today's conditional `ProjectTab`: appears only when `results.alsProject` exists; shows the `.als` visuals (track list, device/plugin clutter, MIDI health, arrangement sections from phase 8).

**Debug** (power-user, last tab):
- **Pipeline diagram** — nodes = the phases present in `finalJson.phases[]`; edges = the dependency chain from the data contract §1 (P1→P2→P3; P4 independent; P5←ref+P1+genre; P6←genre+P1; P7←structure(P1)+genre; P8←.als; P9 per its inputs). Each node color-coded by `status` (ok/skipped/failed). Click a node → its I/O panel.
- **Per-phase I/O panel** — that phase's **inputs** (which assets + upstream phase data fed it) and **outputs** (`phase.data`) as copyable JSON objects (reuse `RawTab`'s copy affordance).
- **Full raw JSON** — the entire `finalJson` + the verdicts payload, copyable (today's `RawTab`, retained at the bottom).

---

## 12. Cleanup checklist (artifacts to remove)

- ✂️ The **"X of 12 phases" ring + counter** (stale; phase count is dynamic from `finalJson.phases[]`).
- ✂️ **"Upload N more files to unlock +N specialists"** nudge (`DepthBanner`/`DeepenZone` upsell copy) — gone from the report view.
- ✂️ **Raw worker phase names / `other` genre / "50th pct" / "score 47"** leaks → friendly names + "what this means" copy.
- ✂️ The standalone **"RE-ANALYZE ON CHANGES"** card → Re-analyze lives in the sidebar.
- ✂️ **Analysis History** panel → removed entirely (one analysis per version).
- ✂️ Everything below the phase-status block in the current screenshots → replaced by the new tabs.

---

## 13. Build phasing

**Phase 1 (core):** the 7-tab restructure + persistent frame (tiny player, Findings vital, sidebar) · Track Info · Analysis · Findings · Actions (selection + Save-to-Game-Plan) · Debug · the **3-tier storage contract** · the Listen Coach-tab **checkboxes + Coach Mix button + thumbs**.

**Phase 2 (specced, flagged later):** timed **Room-style Coach announcements** on the Listen page · the **Specialist Team modal**.

**Backend asks (tracked separately, not blocking Phase 1 UI shells):**
1. **Save to Game Plan** — endpoint + storage to persist a version-associated rack preset (chosen fixes + compiled rack), and surface it in the Game Plan.
2. **Track Info time-series** — surface `loudness_timeline` / momentary LUFS (+ per-section energy) into `final_json` for the loudness-over-time chart (ties to `surface-latent-analysis-datapoints`).
3. Confirm every Actions fix that should be rack-able carries a structured `dsp_chain` (the SOLVE / fix-rack output) so the Listen checkboxes have real params to apply.

---

## 14. Open items / awaiting

- **Room-announcement image example** received (RACK CONTROL banner) — treatment captured in §9.
- **Thumbs (👍/👎) downstream use** — stored in `localStorage` now; product decision on what to do with the signal deferred.
- Optional header vitals (LUFS / True Peak / Mono) — held as future add-ons; only "N findings · M fixable" ships.
