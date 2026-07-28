# Prompt for Claude Design — Finding details page + Fix details page

You are designing two detail surfaces for SPECTR's results page (React 19 + Vite, CSS Modules +
global utilities `.card`/`.pill[.tone]`/`.dot[.tone]`/`.btn`/`.label`/`.mono`, Recharts, no Tailwind):

1. a **Finding details page** — everything about one detected issue
2. a **Fix details page** — everything about the concrete fix attached to a finding

Findings arrive as `VerdictDto` rows from `GET /api/reports/{jobId}/verdicts`, pre-sorted by
`priorityScore` descending. A fix is the optional `fix` object embedded in a finding
(`fix = null` → the finding is an observation with no fix page). Below is the complete inventory
of what the backend provides — design with all of it in mind; you may tier information
(primary / expandable), but don't invent fields that aren't listed.

---

## FINDING — available fields

**Identity & provenance**
- `headline` — ≤80 chars, the title (e.g. "Master clips on true-peak (+0.4 dBTP)")
- `summary` — ≤300 chars, one-paragraph explanation
- `body` — optional longer prose (nullable)
- `whyItMatters` — ≤200 chars, the "so what" (its own display slot, not part of summary)
- `specialist` — which analyzer produced it (e.g. `low_end`, `stereo_field`, `rule_engine.<slug>`)
- `source` — `"rule_engine"` (deterministic measurement) vs LLM specialist. Worth a subtle
  "measured" vs "AI-assessed" provenance marker.
- `model` + `promptVersion` — LLM provenance (debug-tier info, maybe a tooltip)
- `createdAt`

**Importance (the ranking block)**
- `severity` — 5 tiers: `critical / severe / moderate / minor / win` (`win` = something done RIGHT —
  positive finding, needs a distinct visual treatment, not a red-tinted one)
- `priorityScore` — integer, **range ~20–300, NOT 0–100** (formula: severity base 20–200 ×
  category weight 1.0–1.5 × scope multiplier 0.6–1.0). The details page should *explain* the
  ranking: show score plus its ingredients — severity tier, category weight when ≠1.0
  (clipping ×1.5, loudness ×1.4, mono_compatibility ×1.4, low_end ×1.3), and scope
  (full track ×1.0 / multi-section ×0.9 / single section ×0.7 / single stem ×0.6)
- `confidence` — 0–1 double

**Classification**
- `category` — e.g. clipping, loudness, low_end, mono_compatibility, spectrum, stereo…
- `kind` — `"fault"` (a problem) / `"observation"` (informational, unchecked style) / `"integrity"`
- `fixable` — boolean; false → no fix affordance at all
- `suspected` — boolean; true = threshold is provisional/heuristic — deserves a "provisional"
  qualifier so users don't over-trust it
- `dataTier` — `audio_only` / `stems` / `project_midi` — what data the detection used
- `problemId` — stable id `<category>.<slug>.<index>` (useful for permalinks)
- `refines` — parent problem id when this finding is a refinement of a broader composite one
  (opportunity: "part of: <parent headline>" breadcrumb)

**Evidence (list — the measurement proof)**
Each evidence item: `metric`, `value`, `expected_range` (tuple), `delta_pct`, `label`
(display string), `frequency_range_hz` (tuple — chartable), `stems` (list of stem roles involved).
Great fit for measured-vs-expected mini visualizations. Also on the finding itself:
- `metricLine` — pre-formatted one-line metric summary string
- `chartType` — optional hint for which chart to render
- `impact` — optional short impact string

**Location**
- `where` — `{section_type, start_seconds, end_seconds}` (nullable) — which part of the song.
  Opportunity: timeline chip / jump-to-timestamp on the player.

**User state & actions**
- `userState`: `dismissed`, `applied`, `feedback`
- Actions that exist: dismiss (`POST /api/verdicts/{id}/dismiss`), mark applied
  (`POST /api/verdicts/{id}/applied`), feedback `helpful | wrong | unclear`
  (`POST /api/verdicts/{id}/feedback`)
- `sources` — list of underlying data references (debug-tier)

---

## FIX — available fields (`finding.fix`, nullable)

- `fix_id`
- `target` — `{type: "stem"|"master"|"bus", name}` — WHAT to apply it to ("bass stem", "master bus")
- `section` — optional `{...}` — WHEN in the song (fix scoped to a section vs whole track)
- `dsp_chain` — ordered list of DSP operations; **this is the heart of the fix page**. Each op:
  `{type, params}` where type ∈ `peaking_eq, low_shelf, high_shelf, high_pass, low_pass,
  compressor, multiband_compressor, limiter, gain, stereo_width, sidechain` and params are
  typed/validated per type (e.g. peaking_eq: `frequency_hz`, `gain_db`, `q`; compressor:
  `threshold_db`, `ratio`, `attack_ms`, `release_ms`, `knee_db`, `makeup_gain_db`; stereo_width:
  `width_pct`, `mono_below_hz`; limiter: `ceiling_db`…). Design a per-op card: device icon +
  type name + param readouts; an EQ op could render a response-curve mini-chart.
- `sidechain` — optional routing info (source stem, depth, timing)
- `expected_outcome` — prose: what should improve after applying
- `ableton_hint` — optional `{...}` with Ableton-specific guidance (device names/steps) — only
  when the user uploaded an .als project; show conditionally
- From the parent finding, the fix page should also carry: `headline`, severity, the evidence it
  addresses, and `presetName` (nullable — the name under which this fix chain maps to a Listen
  rack preset)

**Fix actions that already exist in the product**
- "Send to Listen" — a fix's dsp_chain maps onto the Listen rack (EQ/comp/width) so users can
  audition it (SendToListenCard / PresetChainModal already exist on the results page — reuse,
  don't redesign from scratch)
- Mark applied / dismiss / feedback (same endpoints as the finding)
- `userState.user_modified_fix` — users can tweak fix params; the page must distinguish
  original vs user-modified values

---

## States to design

1. Observation finding (`kind="observation"` / `fixable=false` / `fix=null`) → no fix section;
   quieter visual treatment.
2. `win` severity → positive framing.
3. `suspected=true` → provisional-threshold qualifier.
4. Degraded report (`degradation` non-null on the list response) → findings are rule-engine-only;
   a banner exists at page level; details pages should not promise AI features that are offline.
5. Fail-marker finding (headline "Specialist failed") → error treatment.
6. Dismissed / applied states (both list row and details page).
7. Fix with 1 op vs 5+ ops; fix targeting a stem the user can audition vs the master bus.

## Constraints

- Severity tiers map to the existing pill/dot tone system; keep the 5-tier scale consistent
  everywhere.
- `priorityScore` is 20–300 raw — if you show a normalized number, use `round(score/3)`, never
  clamp at 100.
- All fields above exist today; no new backend work. Fields marked nullable can be absent —
  every slot needs a graceful-absence behavior.
