# Analysis Results Page — render states & edge cases

The mock (`analysis-page-mock.json`) shows the **fully-loaded** state. Real reports
arrive in many partial states — every tab must design for them. This is the
consolidated list (the data dictionary scatters them across tabs).

## Report-level (wraps every tab)

| State | Data signal | Render |
|---|---|---|
| **Loading / in-progress** | `JobStatusDto.status` = `pending`｜`processing`; `currentPhase`, `phasePct` | Progress view — phase name + % bar. Page polls until `complete`. |
| **Failed** | `status` = `failed`; `errorMessage` | Error state with the message + a retry affordance. |
| **Malformed result** | `finalJson` not an object (pipeline crash) — `isFinalJson()` guard | Empty shell + "analysis incomplete" — don't crash. |
| **Complete** | `status` = `complete`, `finalJson` valid | Full tabbed report (the mock). |
| **Per-phase failure** | `phases[].status` = `failed`｜`skipped` (per phase) | That tab/section shows "not available", NOT a zero/F. Other tabs unaffected (partial-failure tolerant). |

## Tab 1 — General Stats

| State | Data signal | Render |
|---|---|---|
| **Arrangement pending** | `phase7.arrangement_status = "pending"` (background allin1 running) | "Analyzing arrangement…" skeleton; page polls every 4–8 s until it flips. The rest of the tab is already populated. |
| **Arrangement unavailable** | `phase7.arrangement_status = "unavailable"` (Docker/image off) | "Arrangement not assessed" — neutral, not a failing grade. |
| **Arrangement scored** | `phase7.arrangement_status = "scored"` | Section timeline + scores (mock). |
| **Grade pending/NA** | top-level `grade` = `"…"` or `"N/A"` | Grade pill shows the placeholder, not "F". (Grade comes from `phase3.total_score`.) |
| **Low key confidence** | `phase1.key_detection_confidence < 0.5` | Qualify the key badge ("A# · uncertain") rather than asserting it. |
| **Phase 9 skipped/failed** | `phase9` phase `status` ≠ ok | Hide the translation panel or show "not assessed". |

## Tab 2 — Stems

| State | Data signal | Render |
|---|---|---|
| **No stems uploaded** | `phase4.stems` absent / `status` = `"skipped"`; `phase4.stems.per_stem` empty | Empty state with an "Upload stems to unlock per-stem analysis" CTA, OR hide the tab. (`phase4.band_energy` + `clashes` still exist from the full mix — could show those.) |
| **Stems present** | `phase4.stems.status = "ok"`, `per_stem` populated | Per-stem table + clash matrix + balance flags (mock). |
| **Classifying** | upload flow: `StemProposalsResponse.classified = false` | "Detecting stem roles…" (pre-analysis, separate flow). |

## Tab 3 — .als Project

| State | Data signal | Render |
|---|---|---|
| **No .als uploaded** | `phase8` absent AND `JobResultsDto.alsProject` = null | Empty state / hide tab + "Drop your .als for project analysis". |
| **.als present** | `phase8.status = ok` and/or `alsProject` non-null | Project health + tracks + MIDI issues + plugin list (mock). |

## Tab 4 — Problems

| State | Data signal | Render |
|---|---|---|
| **Generating** | specialists running; `SpecialistStatus.status` = `running`/`idle` | Skeleton cards per pending specialist; rule-engine rows can show immediately. |
| **Degraded (LLM off)** | `VerdictsListResponse.degradation` present (`reason` ∈ tier_budget/global_budget/circuit_breaker) | Amber banner "rule-based findings only"; STILL render the rule-engine verdict cards under it. |
| **All clear / wins only** | verdicts list empty or only `severity:"win"` | Positive "no problems found" state, surface wins. |
| **Per-specialist failed** | `SpecialistStatus.status = "failed"` (or a fail-marker verdict) | Failed tile the user can retry via `/run/{slug}`. |
| **Populated** | verdicts present | Sorted by `priorityScore`; severity-colored cards (mock has severe/moderate/minor/win). |
| **Dismissed/applied** | `userState.{dismissed,applied}` | Collapsed/checked treatment per user. |

> Note: 9 of 11 deterministic rules are live, so even on free tier / degraded the
> Problems tab has real findings (clipping, true-peak, loudness, mono, stereo,
> **dynamics ×2, key-confidence**). It's rarely truly empty.

## Tab 5 — Reference Comparison

| State | Data signal | Render |
|---|---|---|
| **Disabled (now)** | `phase5.status = "skipped"`; no reference wired | "Coming soon" / disabled tab. This is the current default for every report. |
| **(Future) populated** | `phase5.status = "ok"`, `genre_context.checks` + `per_stem_reference_deltas[]` | Per-metric diff vs reference (build later). |

## Actions section

| State | Data signal | Render |
|---|---|---|
| **Actionable** | `verdict.fix` non-null (`dsp_chain[]`, `target`, `expected_outcome`) | Action card with editable DSP params (bounded by the param ranges). |
| **Observation only** | `verdict.fix = null` (wins, key notes) | Problem shows in the Problems list with NO action card. |
| **Applied** | `userState.applied = true` / `user_modified_fix` | Checked/edited treatment. |

## Quick design checklist
- Every tab needs a **loading**, **empty/not-uploaded**, and **failed/skipped** treatment — not just the happy path.
- The **arrangement** block is async (pending→scored); design the in-place fill.
- **Reference** is disabled by default today; **Stems** and **.als** are conditional on upload.
- **Problems** is the tab most affected by tier/budget — design the degraded banner.
- Don't render a failing grade for *missing* data — use neutral "not assessed".
