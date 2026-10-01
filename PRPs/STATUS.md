# PRP Status Index

Living index of every PRP and what state it's in. Companion to `README.md` (which
explains the *system*); this file tracks the *contents*.

**Last reviewed:** 2026-10-01 (archive pass: 26 shipped/superseded entries moved — see "Changes this review (2026-10-01)"). Previous: 2026-06-27 (housekeeping executed: 5 shipped PRPs archived, 3 story
headers + identify-solve header reconciled to code-truth; **2nd pass same day: 7-doc
results-redesign cluster archived after the redesign landed + verified**; **3rd pass:
Epic 5 close-out sprint + story 5.6 shipped; Epic 11 Social sprint planned**)
**Snapshot:** 118 archive entries · 53 sprint stories · 22 root `.md` (incl README/STATUS)

Buckets:
- **REFERENCE** — north-star / contract docs that stay at root permanently
- **IN-PROGRESS** — actively being implemented (or in review)
- **FUTURE** — backlog, briefing, or research; not started
- **ARCHIVE CANDIDATE** — work shipped; should move to `archive/<YYYY-MM-DD>_<slug>.md`

---

## Changes this review (2026-10-01)

Verified against `components/` and git history on `develop` (11542c7). Moved to `archive/`:

- `3-1-r2-presigned-upload-briefing.md` → `2026-07-02_*` (story 3.1 shipped, 927557e)
- `reference-profiles-backend.md` → `2026-06-26_*` (3966f0a; batch/bulk-analyze/aggregate + phase-6 `reference_profile`)
- `problem-engine-mixcoach-rules.md` + `problem-engine-build-brief.md` → `2026-07-23_*` (Slice 1 live; named follow-ons are separate plans)
- `results-page-v3-port.md` → `2026-07-28_*` (merged 5138c47)
- `song-page-console-redesign.md` + `-build-1-bff.md` + `-build-2-frontend.md` → `2026-09-14_*` (merged 2e62ca4)
- `solo-fork-strip-social.md` → `2026-09-19_*` (pairs with the already-archived plan)
- `guest-demo-sandbox.md` + `-plan.md`, `guest-first-upload.md` + `-plan.md`, `public-surfaces-polish.md` + `-plan.md`, `handoff-ledgers/` → `2026-09-30_*` (first-impression work, merged to release 2964684)
- `azure-deploy-spectr.md` → `2026-09-30_*` (spectrmix.com live; CI deploy 8d270bb)
- `credit-economy.md` + `credit-economy-plan.md` → `2026-10-01_*` (merged 438cd7a)
- `listen-findings-in-stage.md` → `2026-10-01_*` (spec; plan archived 2026-09-20; D6 amendment shipped d5336d7)
- `worker-run-logs-and-crash-forensics.md` → `2026-10-01_*` (merged 5c5dd27)

---

## 🆕 Changes this review (2026-06-27)

All verified against `components/` before acting — checkboxes in these plans are
unreliable; verdicts are code-truth.

**Archived (shipped → `archive/2026-06-27_*`):**
- `listen-v3-identity-capabilities.md` + its `-design.md` pair — code live in
  `src/features/listen-rack/{identity,capabilities}.ts`.
- `problem-engine-reconcile-persist.md` — `Verdict.cs` 8 Problem columns + worker
  mappers + EF migration all live.
- `solve-deterministic-fix-rack.md` — **both phases shipped**: `worker/app/solve_lib/`
  + `fix_rack_actor.py` + `FixRackEndpoints.cs` + `RackPreset.cs` + `FixRackPanel.tsx`.
- `schema-contract-prevention-design.md` — lint gate shipped
  (`test_schema_contract_lints.py`); impl partner already archived
  (`2026-06-25_schema-path-lint-gate.md`).

**Archived 2nd pass (results-redesign cluster shipped → `archive/2026-06-27_*`):**
The redesign landed + verified against `components/frontend-spectr-v2/src/features/results/`
(7-tab structure live: `TrackInfoTab`/`AnalysisTab`/`FindingsTab`/`ProjectTab`/`CoachTab`/
`DebugTab` + `SongHeader` + `ResultsPlayer` + `redesign.css`; Plan-tab apply shipped in
commits `ef816d9`/`21f0903`). Archived together:
- `analysis-results-page-redesign.md` + `-build.md`
- `results-redesign-backend-spec.md` + `results-redesign-integration-plan.md`
- `reference-tab-design.md`
- `listen-plan-apply-fixes-spec.md` + `-plan.md`

**Status headers reconciled to code-truth:**
- Stories `2-4`, `2-5`, `1-7`: `review`/`ready-for-dev` → **`done`** (all committed; working
  tree clean). The machine-readable `sprint-status.yaml` block already had these as `done`
  since the 2026-06-23 git reconciliation — only the per-file headers lagged.
- `identify-solve-architecture.md`: `LOCKED — under active implementation` → **`BUILT —
  reference architecture`** (IDENTIFY + SOLVE tiers both shipped).

---

## 📦 Already archived — `archive/` (73 files)

The v1 build, all 13 compliance gaps, verdict pipeline, stems/Ableton integration,
song library, the full Listen DSP-rack engine (phases 1–5), Listen-v3
spine/rooms/sharing/identity-capabilities, the rule-engine / schema-gate /
SOLVE-fix-rack / problem-engine-persist work, and teach-mode coach. Correctly
maintained — no action.

---

## 🔨 In progress — active build front

> Verified against `components/` on 2026-06-27. Plan checkboxes across this cluster
> are unreliable (most are 0-checked even when code shipped) — verdicts are code-truth.

| File | Real status |
|---|---|
| `listen-v3-bookmark-ui.md` | Backend done (`BookmarkEndpoints.cs`); frontend **partial** — hooks shipped (`features/listen/useBookmarks.ts`, `useBookmarkSignal.ts`) but the **`BookmarksPanel.tsx` rail + timeline markers are unbuilt** (verified 2026-06-27). |

### Epic 11 — SPECTR Social (sprint planned 2026-06-27)
New epic in `epics.md` (alongside 1–10) + `sprint-status.yaml` (`epic-11: in-progress`).
**Key finding:** the social *backend* is ~90% already built via the Listen-V3 PRP-0..6 slice
(`ShareSetting`/`VersionShareEndpoints`, `RoomEndpoints`/`ListeningSession`/`ControlGrant`/
`recap_actor.py`, `TrackComment`/`ReviewerSuggestion`/`FeedbackEndpoints`, `TrackBookmark`/
`BookmarkEndpoints`, anon `ActorRef`). The gaps are **frontend wiring** (comments/suggestions/
bookmarks hooks exist with no components; room page on mocks), **notifications** (`INotificationSink`
no-op only), and **profiles/follow/discovery** (greenfield). 11 stories; first sprint =
`11-1`/`11-3`/`11-5` (ready-for-dev) + `11-2` stretch — story files written. Plan:
`~/.claude/plans/fluttering-stirring-abelson.md`. Lineage: PRP-3/4/6/7. Note: this supersedes
`listen-v3-bookmark-ui.md` (row above) — its work is now story **11.3**.

### Results-redesign cluster — SHIPPED + ARCHIVED (2026-06-27)
Redesign landed and verified against code; all 7 docs moved to `archive/2026-06-27_*`
(see "Changes this review"). No longer a build front.

### Reference doc kept at root
| File | Note |
|---|---|

---

## 🔮 Future plans — backlog / not started

| File | Note |
|---|---|
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
`detection-prescription-inventory.md` · `identify-solve-architecture.md` (now BUILT, kept
as the two-tier reference) · `deferred-work.md` · `sprint-status.yaml` ·
`listen-dsp-rack-capabilities.md` · `listen-smoke-script.md`

Subdirs kept as-is: `identifiers/` (SOLVE sub-specs) · `ui-decision-layer-surfacing/`
(UI surfacing specs) · `design_handoffs/` (active handoffs) · `stories/` (sprint record) ·
`templates/` · `source/`.

---

## ⚠️ Open housekeeping flags

1. **Checkbox rot across the detection/SOLVE cluster.** Most plans show 0 checked tasks even
   where code shipped. Don't trust `[ ]` state in these files — reconcile the status header
   when touched (the SOLVE/identify cluster is now reconciled; results-redesign cluster is next).
2. **Dated research/validation docs** (`*-2026-06-1*`) clutter the root. Once their decisions
   are absorbed into the PRD/architecture, archive them as consumed research.
3. **Unowned shipped actors.** `structure_actor.py` belongs to archived
   `2026-06-25_deferred-structure-detection.md` (done); `recap_actor.py` is Listen-v3
   Room-session lifecycle (no root PRP needed) — noted so they don't read as orphans.

---

## ✅ Resolved flags (historical)

1. **Story 2.5 drift — RESOLVED.** Fully shipped; story header flipped to `done` this review.
2. **Problem-engine rule count drift — RESOLVED (code wins).** ~39 rules (30 `@single` +
   9 `@composite`) registered in `verdict_lib/`, not "~2 of 43". Engine is essentially complete.
3. **"Analysis seems broken" — RESOLVED (infra, not code).** 2026-06-27: analysis suite
   159/159, worker rule/SOLVE 187 green; only failures were `localhost:5432 connection
   refused` (Docker stack down). No code regression.
4. **SOLVE / identify-capabilities / problem-persist archive candidates — RESOLVED.** All
   verified shipped and archived this review (see "Changes this review").
5. **Epic-5 status drift — RESOLVED (code verification, 2026-06-27).** Verified all 10
   Epic-5 stories against `components/`: 5-2/5-3/5-5/5-8/5-9 shipped → `done`; 5-1/5-4/5-6/5-7
   partial, 5-10 not-started → the active "close out Epic 5" sprint. `sprint-status.yaml`
   reconciled (epic-5 → in-progress, per-story gap notes inline).

---

*To refresh this index: re-scan `stories/*` Status lines and root-file headers, then
**verify the detection/SOLVE + results-redesign clusters against `components/`** (checkboxes
lie here), then update the tables above and the snapshot date.*
