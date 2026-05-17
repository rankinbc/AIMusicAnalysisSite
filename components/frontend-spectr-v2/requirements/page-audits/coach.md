# Coach Page Audit

## Overview
The AI Mix Coach is the centerpiece producer-facing surface on the Results page. It is **both a panel and a sub-tab**: at the top sits a `CoachChat` panel (collapsible streaming chatbot with a TranceBot avatar), followed by a `CoachHero` summary banner, a filter strip, and a vertically stacked list of `FeaturedVerdictCard` items (rich verdicts with persona chip, inline contextual chart, step-by-step Fix Recipe, and Apply/Mark-fixed/Snooze actions). At the bottom is an `AllSpecialistsRoster` accordion exposing the full 26-specialist catalog. The primary outcome is: producer reads ranked issues, optionally chats to get clarification, and works through fixes.

## Subpages / variants
- **Chat — collapsed** (default): header + 6 suggested-prompt chips + input bar + "what can I ask?" capabilities expander.
- **Chat — expanded**: scrollable message thread, TranceBot thinking state with animated visor EQ bars, compact suggested-prompt strip (hidden after 4+ messages), input bar pinned at the bottom.
- **Featured verdict card — default / fixed / snoozed**: snoozed cards dim to 0.45 opacity; fixed cards swap left border to green, disable Apply preset, and replace "Mark fixed" with "Re-open".
- **All Specialists roster — collapsed / expanded** accordion grouped into 9 categories (Low End, Frequency, Dynamics, Stereo, Loudness, Arrangement, Reference, Production Detail, Big Picture).
- **Chart variants inside each card**: `lufs`, `frequency`, `eq-curve`, `sidechain`, `arrangement`, `stems` — each is a different SVG visualization.

## Data the page assumes
| Field | Status | Source today | Effort if not | Notes |
|---|---|---|---|---|
| `track.name`, `genre.name`, `genre.confidence`, `bpm`, `key`, `grade`, `score`, `percentile` | ✅ exists | `final_json` (phase1/phase6/danceability) + computed score | — | Already on the report page. |
| `track.loudness.{integrated,truePeak,dynamicRange,rms}` | ✅ exists | `final_json.phase1.{loudness_lufs, true_peak_db, dynamic_range_lu, rms_dbfs}` | — | All present per CLAUDE.md v1.1 additions. |
| `track.frequency.bands[]` + `genreMedianBands[]` | ✅ exists | `final_json.phase2` + genre reference profiles | — | Currently rendered in StreamingReadiness/FrequencyChart. |
| `track.stereo.{width,correlation,monoCompat}` | ✅ exists | `final_json.phase3` + `phase1.mono_compatibility` | — | |
| `track.streaming[]` (per-platform LUFS targets/delta) | ✅ exists | Computed client-side from `loudness.integrated` vs hard-coded targets | — | TikTok target is new; others exist. |
| `track.arrangement.{score, sections[], issues[]}` | ✅ exists | `final_json.phase5` (allin1 structure detection) | — | Issues array derives from existing `coached_fixes`. |
| `track.gap[]` (genre percentile gaps per metric) | ⚠️ derivable | Genre median profiles already exist; per-metric percentile + acceptable range need formal computation | S (hours) | Currently surfaced piecemeal; needs a single `gap_analysis` block. |
| `track.coach[]` (COACH_FINDINGS) — **the big one** | 🔨 pipeline + 🆕 schema | Verdict pipeline produces `Verdict` objects with `title/summary/fix/priority_score/specialist/severity/confidence` | M (days) | **Major diff vs current verdicts**: see "Verdict shape diff" below. |
| `coach[].rank` | ⚠️ derivable | Sort verdicts by `priority_score` desc, assign 1..N | S | Trivial. |
| `coach[].impact` (`high`/`med`/`low`) | 🔨 pipeline | Not currently produced; current verdicts only have `severity` | S | Map from severity + priority_score band, or have the specialist emit it. |
| `coach[].confidence` (0..1 float) | 🔨 pipeline | Not in current `Verdict` schema | S | Add to specialist JSON contract; LLMs already estimate this. |
| `coach[].body` (plain-language paragraph) | ⚠️ derivable | Current `Verdict.summary` exists but is shorter (~1 sentence) | S | Prompt tweak to ask for 2-3 sentence body. |
| `coach[].metricLine` (e.g. `"-11.2 LUFS · -14 SPOTIFY · 5.4 LU DYN"`) | 🔨 pipeline | Current `Verdict.evidence` is a list of chips, not a single tagline | S | Concatenate evidence chips client-side OR add a `metric_line` field. |
| `coach[].chartType` (lufs / frequency / eq-curve / sidechain / arrangement / stems) | 🔨 pipeline | Not in current schema | S | Add enum to verdict; map per specialist category. |
| `coach[].fix.title`, `fix.why` | ⚠️ derivable | Current `Fix.summary` exists | S | Split or add fields. |
| `coach[].fix.steps[]` — `{kind, where, what, from, to}` structured plugin params | 🔨 pipeline | Current `Fix` only has free-text `summary` + `actions` list | M | **Biggest backend lift.** Specialist prompts need to emit a structured step list. See v1 plan below. |
| `coach[].presetName` (e.g. `"Spotify-safe master"`) | 🔨 pipeline | Not in current schema | S | New optional string field on Verdict; nice-to-have. |
| `coach[].specialist` (slug like `loudness`, `low_end`, `sections`) | ✅ exists | Verdict.specialist (already a slug) | — | UI maps slug → persona via `SPECIALIST_PERSONAS` dict. |
| `coachSummary.{total, critical, warning, info, specialistsRun, specialistsTotal}` | ⚠️ derivable | Aggregate from verdicts_payload counts | S | `specialistsTotal=26` is the catalog size from `SPECIALIST_SLUGS`. |
| `SPECIALIST_PERSONAS` (color, label, glyph per slug) | 🆕 schema (client-only) | Frontend-static dict; no backend equivalent | S | Ship as a TS constant. No DB needed. |
| `SPECIALIST_GROUPS` (9 categorical groupings) | 🆕 schema (client-only) | Not on backend; mirrors `SLUG_TO_FILENAME` | S | Ship as a TS constant. |
| Per-specialist run status (`idle`/`running`/`cached`/`disabled`) for roster | ⚠️ derivable | Inferable from verdicts_payload + Triage routing plan + stems/reference presence | S | Disabled reasons (`"Upload stems to enable"`) need explicit logic per slug. |
| **Chat messages history** | 🆕 schema | No persistence today | M | See Interactions; v1 can be ephemeral client-side. |
| **Chat completion (LLM streaming reply)** | ❌ blocked | `window.claude.complete` is the Anthropic harness window; **no backend chat endpoint exists** | M (days) | New BFF route + LLM client. |

**Verdict shape diff (critical):** the mock `COACH_FINDINGS` schema is materially richer than what specialists.py + Verdict Pydantic model produce today. Mock adds: `rank`, `impact`, `confidence`, `body` (long form), `metricLine` (single string), `chartType` (enum), `fix.title`+`fix.why`+`fix.steps[]` (structured), `presetName`. Today's `Verdict` has: `severity`, `priority_score`, `summary`, `evidence`, `fix.summary`, `fix.actions[]`. The v2 design assumes a specialist prompt contract revision.

## Interactions
| Trigger | Action | Backend route | DB changes |
|---|---|---|---|
| Page load | Fetch verdicts + analysis | `GET /api/reports/{job_id}/verdicts` exists; **new BFF wrapper** `GET /api/coach/{job_id}` returning combined `{analysis, verdicts, coachSummary}` recommended | None |
| Click "Run N remaining" in CoachHero | Kick off remaining specialists | `POST /api/reports/{job_id}/verdicts/generate` exists | None |
| User types in chat + presses Enter / clicks "Ask →" | Stream a reply with track analysis in context | **NEW: `POST /api/coach/{job_id}/chat`** (streaming SSE) | optional: new `coach_messages` table for history |
| Click a suggested-prompt chip | Same as send | Same | Same |
| "↺ New chat" button | Clear messages client-side | None | None (v1) / `DELETE /api/coach/{conversation_id}` (later) |
| "Mark fixed" / "Re-open" on verdict card | Toggle user state | `POST /api/verdicts/{id}/dismiss` exists; new `applied=true` flag needed on `VerdictUserState` (column already present, no route) | Reuse `verdict_user_state.applied` |
| "Snooze" on verdict card | Local-only hide | None (v1) | Optionally add `snoozed_until` column |
| 👍 / 👎 feedback buttons | Send feedback | `POST /api/verdicts/{id}/feedback` exists | `verdict_user_state.feedback` |
| "Apply preset" button | (Aspirational) export a plugin preset file | New, large; **stub/disable for v1** | None |
| "Why this?" link | Show reasoning trace | None today | Could surface `evidence[]` already on verdict |
| Roster: click an `idle` specialist | Run that one specialist on demand | **NEW: `POST /api/reports/{job_id}/specialists/{slug}/run`** | Verdict appended to `verdicts_payload` |
| Roster: click a `disabled` specialist | Show tooltip with `disabledReason` | None | None |
| "Export fix list as PDF" | Generate PDF | **NEW: `GET /api/reports/{job_id}/fixes.pdf`** | None — defer to v1.x |

## Real-time / streaming behavior
- **Verdict generation stream**: `GET /api/reports/{job_id}/verdicts/stream` (SSE) already exists; the design's "specialist running" indicator on `AllSpecialistsRoster` should subscribe to this.
- **Chat streaming** (NEW): Vercel AI SDK's `useChat` hook expects an SSE-flavored stream (specifically the AI SDK Data Stream protocol: newline-delimited tokens prefixed with `0:` for text deltas, `2:` for data, `e:`/`d:` for finish). The .NET 10 BFF can either:
  1. Proxy to Anthropic Messages API streaming and re-serialize to the AI SDK format, OR
  2. Use the AI SDK's `.NET`-style equivalent — but easier path is hand-rolling the SSE format from `Anthropic.SDK` streaming chunks.
- **Token-by-token rendering**: the design's `thinking` state replaces the bubble with an animated bot; per-token streaming should append to the in-flight assistant bubble. The current mock uses `window.claude.complete` which is a one-shot await — actual implementation needs to swap to streaming.
- **No websockets needed**: SSE is sufficient for both verdict stream and chat stream.

## Open product questions
- **Tool use / on-demand specialist runs from chat**: should "What did the Loudness specialist find?" auto-run that specialist if not cached, or only reference existing verdicts? Tool-use would be a Claude-side `run_specialist(slug)` tool. Recommendation: defer to v1.x; chat reads what's already cached.
- **Chat history persistence**: the mock keeps history in React state and offers "New chat" reset. Persist per-job? Per-user? Cross-session? Recommendation: v1 = ephemeral (sessionStorage), v1.x = per-job conversation row.
- **Context window size**: full `final_json` + `verdicts_payload` + 2-3 prior versions could easily blow 30KB. Need explicit context truncation/summary strategy.
- **"Apply preset"**: is this aspirational? It implies a DAW-format file (Ableton .adv, FabFilter preset). Recommend stub-as-"Coming soon" for v1.
- **"Snooze" duration**: forever (until "Show fixed" toggle) or time-based (e.g. 7 days)? Mock implies forever-until-toggled.
- **Confidence field source**: LLM self-reported or computed from priority_score? Self-reported is noisy; computed is opaque.
- **Cross-version chat**: design notes mention chat context will include last 2-3 prior versions — how are version diffs surfaced? "Did my mix improve from v2 to v3?" suggestion implies this works.
- **`coached_fixes` legacy field**: pipeline already produces `coached_fixes: list[str]` per CLAUDE.md v1.1. Is this deprecated by verdicts? Mock doesn't reference it.
- **Persona system as DB-driven vs hardcoded**: `SPECIALIST_PERSONAS` (colors, glyphs, labels) is a frontend constant in the mock. Fine for v1, but adding a new specialist requires both prompt + frontend edit.
- **Severity downgrade behavior** (existing gotcha): validator may downgrade severity post-LLM. Make sure the displayed severity is the validator-final one, not the raw specialist output.

## Build verdict

**🟠 DEFER (chat) + 🟡 IMPLEMENT WITH PLACEHOLDERS (verdict list)**

The verdict-list portion of the page (CoachHero, CoachFilters, FeaturedVerdictCard, AllSpecialistsRoster) is largely buildable on top of the existing 26-specialist pipeline with a moderate prompt-contract revision to add `body`, `metricLine`, `chartType`, `impact`, `confidence`, and structured `fix.steps[]`. That's a single coordinated prompt + Pydantic schema bump (estimated M). The `CoachChat` panel needs net-new backend (streaming chat endpoint, LLM client wiring, context-builder) and shouldn't block v1 of the redesign — ship the verdict experience first, ship chat second.

## Recommended cuts / placeholders for v1
- **Ship the chat panel as v1.x.** Render the collapsed `CoachChat` shell with the suggestions and capabilities panel, but show a "Coming soon — early access" overlay on the input when clicked. Frees us from needing a chat endpoint on day one.
- **Skip "Apply preset" button** entirely or render it disabled with a tooltip "Plugin presets coming soon" — no DAW preset generator exists.
- **Skip "Export fix list as PDF"** — render as `<a>` to a print stylesheet view if absolutely needed; full PDF generation is a separate phase.
- **Fix Recipe steps**: for v1, generate the structured steps **directly from the LLM specialist** (extend the prompt contract; ask for `[{kind, where, what, from, to}]`). Do **not** post-process or template — passing through what the LLM emits is the simplest path. The `kind` enum is small (`plugin`, `automation`, `arrangement`, `fx`, `target`, `check`, `production`) and LLMs handle this well with examples in the prompt.
- **`presetName`**: optional field, omit chip if empty. Don't gate ship on this.
- **`chartType`**: have the specialist emit it; default to no inline chart if absent (just show the metric line + fix recipe).
- **`AllSpecialistsRoster`**: ship collapsed by default with `cached` counts only; the on-demand run-one-specialist button can be a v1.x add.
- **`confidence` meter**: ship as optional. If absent, hide the meter.
- **"Snooze"**: client-side only (sessionStorage), no DB column.
- **"Why this?" / reasoning trace link**: link to scrolling-anchor on the underlying phase data in the report; no new backend needed.

## Notes
- **Relationship to existing VerdictsPanel (v1.2)**: this design effectively **replaces** `features/verdicts/VerdictsPanel.tsx` and its child components. The mock comments call this "the featured experience. Replaces 'Overview' as the default Results tab." Plan migration: feature-flag the new `AICoachTab`; keep `VerdictsPanel` available as a fallback during rollout.
- **Persona system is a frontend constant** (`SPECIALIST_PERSONAS` in mock-data, exposed via `window.SPECTR_PERSONAS`). Move into the React frontend as `src/features/coach/personas.ts`. The persona color/glyph/label is purely presentational — don't push into the DB or Verdict schema.
- **TranceBot SVG avatar (~130 lines)**: load-bearing component for the coach identity. Self-contained SVG with animated visor EQ bars driven by RAF. Should port cleanly to a React component; consider memoizing the random `uid` for SSR stability.
- **CLAUDE.md gotcha confirmed**: "validator overwrites priority_score and may downgrade severity" — the `rank` derived from `priority_score` must use the **validated** (post-downgrade) score, not the raw LLM-supplied value.
- **Vercel AI SDK note**: the SDK has a `useChat` React hook that expects a route returning a `Response` with the AI Data Stream protocol. The .NET BFF will need to either implement this protocol or use a community .NET helper. The protocol is straightforward (`0:"token"\n` lines for text deltas) — hand-rolling is reasonable.
- **Context-builder logic** (`buildTrackContext` in coach.jsx lines 194-211) is the spec for what the BFF should serialize into the chat system prompt. Adapt that to .NET; current truncation is implicit (no max).
- **No conversational endpoint exists today** — confirmed via `grep` across `components/api/app`: zero matches for chat / conversation. Greenfield build.
- **Mock uses `window.claude.complete`** which is the Anthropic-internal browser harness; do **not** assume this exists in production. Replace with a real LLM client call to the BFF chat route.
