# PRP Status Index

Living index of every PRP and what state it's in. Companion to `README.md` (which
explains the *system*); this file tracks the *contents*.

**Last reviewed:** 2026-06-27 (rule-engine cluster re-verified against code; teach-mode archived)
**Snapshot:** 68 archived · 18 sprint stories · 34 live root docs

Buckets:
- **REFERENCE** — north-star / contract docs that stay at root permanently
- **IN-PROGRESS** — actively being implemented (or in review)
- **FUTURE** — backlog, briefing, or research; not started
- **ARCHIVE CANDIDATE** — work shipped; should move to `archive/<YYYY-MM-DD>_<slug>.md`

---

## 📦 Already archived — `archive/` (68 files)

The v1 build, all 13 compliance gaps, verdict pipeline, stems/Ableton integration,
song library, the full Listen DSP-rack engine (phases 1–5), Listen-v3
spine/rooms/sharing, the recent rule-engine / schema-gate work, and **teach-mode
coach** (`2026-06-27_teach-mode-coach.md`). Correctly maintained — no action.

---

## ✅ Archive candidates (shipped, still loose at root)

Per the README convention ("a PRP whose work has shipped moves to
`archive/<date>_<slug>.md`"):

| File | Evidence |
|---|---|
| `listen-v3-identity-capabilities.md` | Self-marked "Post-ship reconciliation (2026-06-26): this plan SHIPPED" — code live in `src/features/listen-rack/`. (Keep its `-design.md` partner as REFERENCE.) |
| `problem-engine-reconcile-persist.md` | Code shipped: `Verdict.cs` 8 Problem columns + worker mappers + EF migration all live; plan checkboxes never closed. |
| `solve-deterministic-fix-rack.md` | Phase 1 shipped: `worker/app/solve_lib/` (`rack_schema`, `solvers`, `router`, `preset_compiler`) + `fix_rack_actor.py` + `FixRackEndpoints.cs`. (Archive if Phase 1 was the intended scope; otherwise keep as IN-PROGRESS for later phases.) |
| `schema-contract-prevention-design.md` | Layer-2 lint gate shipped (`final_json.contract.json` + `test_schema_contract_lints.py`); its partner already archived as `2026-06-25_schema-path-lint-gate.md`. |

Borderline — kept as REFERENCE for now, not archived:
- `listen-dsp-rack-capabilities.md` — engine complete, but reads as an ongoing capabilities spec.
- `listen-smoke-script.md` — QA smoke procedure, still useful.

---

## 🔨 In progress — active build front

> Verified against `components/` on 2026-06-26. The plan checkboxes across this
> cluster are unreliable (most are 0-checked even when code shipped) — verdicts
> below are code-truth, not checkbox-truth.

### Genuinely in progress (code partial)
| File | Real status |
|---|---|
| `problem-engine-mixcoach-rules.md` | Engine LIVE on every analysis; **~39 of ~43 IDENTIFY rules implemented** — 30 `@single` (Tier A×18, B×4, S×2, P×4) + 9 `@composite` in `verdict_lib/`, verified 2026-06-27. (Prior "~2 of 43" was stale — checkboxes lied; code shipped.) Remaining: a few datapoint-gated rules + retire the legacy `@rule` path. |
| `reference-profiles-backend.md` | Persistence fields exist (`ReferenceSet.profile_json/fingerprint`, `ReferenceTrack.analysis_status`); aggregation + endpoints incomplete. |
| `listen-v3-bookmark-ui.md` | Backend done (`BookmarkEndpoints.cs`); frontend **not started** — no `BookmarksPanel.tsx` yet. |

### Sprint stories in flight (`stories/`)
| Story | File status | Real status |
|---|---|---|
| `1-7-design-system-foundation-fidelity-phase-a` | review | Implemented + code-reviewed (14 patches), gates green → **done pending commit/acceptance** |
| `2-4-server-side-entitlements-and-metering` | review | Implemented, 118/118 tests, **uncommitted in working tree** → done pending commit |
| `2-5-paid-jobs-never-starve` | ready-for-dev | **SHIPPED** — see Resolved flag #1 below. Story file is stale. |

All other stories are **done**: Epic 1 (1-1→1-6, 1-8, 1-9) · Epic 2 (2-1, 2-2, 2-3, 2-7, 2-8, 2-9, 2-10).

### Reference doc with a stale status header
| File | Note |
|---|---|
| `identify-solve-architecture.md` | Header says "Status: LOCKED — under active implementation" but the architecture is **built** (rule_engine `@single`/`@composite`, `Verdict.cs` 8 Problem columns). Treat as REFERENCE; update the stale header. |
| `problem-engine-build-brief.md` | Autonomous build brief that drove the (now-shipped) engine; keep as reference or archive alongside the engine work. |

---

## 🔮 Future plans — backlog / not started

| File | Note |
|---|---|
| `3-1-r2-presigned-upload-briefing.md` | Epic 3; "BRIEFING / REVIEW ONLY, no code written, Epic 3 still backlog" |
| `surface-latent-analysis-datapoints.md` | NOT-STARTED — datapoints computed internally in `phase1_universal.py` but never surfaced into `final_json` / the contract. |
| `rule-tempo-octave-error.md` | NOT-STARTED — `tempo_octave_error` rule not registered in `rule_engine.py`. |
| `listen-v3-game-plan-comparison.md` | NOT-STARTED (upstream seam shipped) |
| `listen-v3-notifications.md` | NOT-STARTED (upstream seam shipped) |
| `product-brief-spectr-room-2026-06-17.md` | draft; pivot direction, supersedes the 06-12 brief, not committed |
| `validation-test-2026-06-16.md` | Pre-build validation experiment (no product code) |
| `input-strategy-research-2026-06-17.md` (+ `.DECISIONS.md`) | Research deliverable, recommendation only |
| `stem-classification-research-2026-06-17.md` | Research, findings only |

---

## 📌 Living reference (keep at root permanently)

`README.md` · `prd.md` · `epics.md` · `architecture.md` · `ux-design-specification.md` ·
`analysis-data-contract.md` · `spectr-vision-2026-06-16.md` · `spectr-flywheel.md` ·
`async-social-core-design.md` · `detection-engine-spec.md` ·
`detection-prescription-inventory.md` · `deferred-work.md`

---

## ✅ Resolved flags

1. **Story 2.5 drift — RESOLVED (code wins).** Story 2.5 is fully shipped in the
   working tree: worker decorators carry literal `# story 2.5` comments
   (`analysis-free`/`analysis-paid`/`coach`, no `default`); BFF routing wired in
   `VersionEndpoints`/`VerdictEndpoints`/`ReportPhaseEndpoints`/`ReferenceEndpoints`;
   `Procfile` drains all 4 queues; `docker/docker-compose.prod.yml` (W1/W2 split)
   exists; enforcement tests `test_actor_queues.py` + `test_queue_routing.py` exist.
   CLAUDE.md is accurate. **Action: flip the story file header `ready-for-dev` → `done`.**

2. **Problem-engine rule count drift — RESOLVED (code wins).** The 2026-06-26 index
   claimed "~2 of 43" IDENTIFY rules; a 2026-06-27 grep of `verdict_lib/` found
   **30 `@single` + 9 `@composite` = ~39 rules** registered (Tier A/B/S/P + composites).
   The revamp is essentially complete, not barely started. In-progress table corrected.

3. **"Analysis seems broken" — RESOLVED (infra, not code).** 2026-06-27: analysis
   suite 159/159 green, worker rule/SOLVE logic 187 green; the only failures were
   `localhost:5432 connection refused` (Docker stack down). Bringing up
   `docker compose -f docker/docker-compose.yml up -d postgres redis` made the DB
   tests pass. No code regression. `ai-analysis-v2` == `master` == `origin/master`
   (`ef816d9`, byte-identical); every other branch is 0 ahead — all analysis work is
   already on the tip, nothing stranded on a feature branch.

## ⚠️ Open housekeeping flags

1. **Checkbox rot across the detection/SOLVE cluster.** Most plans show 0 checked
   tasks even where the code shipped (verified above). Don't trust `[ ]` state in
   these files — reconcile each plan's status header when touched.
2. **Dated research/validation docs** (`*-2026-06-1*`) clutter the root. Once their
   decisions are absorbed into the PRD/architecture, archive them as consumed research.
3. **Unowned shipped actors.** `structure_actor.py` belongs to archived
   `2026-06-25_deferred-structure-detection.md` (done); `recap_actor.py` is Listen-v3
   Room-session lifecycle (no root PRP needed) — noted so they don't read as orphans.

---

*To refresh this index: re-scan `stories/*` Status lines and root-file headers, then
**verify the detection/SOLVE cluster against `components/`** (checkboxes lie here),
then update the tables above and the snapshot date.*
