# Results UI Plan — design-ready spec

> Source: brainstorming session 2026-06-16 (see `PRPs/brainstorming/brainstorming-session-2026-06-16.md`).
> Purpose: a concrete plan to hand to Claude design for the analysis-results experience.

## North star

**Density for credibility, hierarchy for action.** The producer should land on *what to do*, not a wall of numbers. The product is **Analysis → AI prescription**; the dense analysis is primarily AI feedstock + credibility, rarely the user's action surface.

Mental model: **Finding (diagnosis) → Move (prescription) → Game Plan (committed Moves the producer takes to Ableton).**

## Tab structure — organize by the user's JOB, not by data source

Replaces current source-based tabs (Mix / Reference / Arrangement / Raw / Files).

| Tab | Job it serves | Default? |
|---|---|---|
| **🎯 Plan** | "What do I do?" — the AI Game Plan (hero) | ✅ lands here |
| **📊 Analysis** | "Prove it" — dense measured dashboard (credibility/evidence) | secondary |
| **📁 Files** | "My stuff" — inputs (.als/stems/reference), re-analyze, exports, version list | utility |

- **Specialists are NOT a tab.** Running a specialist is a *verb inside Plan* ("get a deeper read · N credits"); results drop in as new Moves. The full 26-roster lives in an "Advanced" drawer for power users.
- **Coach** = a persistent "Ask about this mix" dock/launcher anchored on Plan (grounded chat), not its own tab.
- Reference/Arrangement findings → become Moves on Plan; their raw visuals → Analysis tab.

---

## The Plan screen (top → bottom)

1. **Header strip** *(compact)* — song · version · genre · grade pill · score /100. Binds: `finalJson.grade`, `overall_score`, phase2 `genre`.
2. **The Verdict** — one plain-English sentence: the single most important thing. *"Your low end is fighting itself — that's costing you the most right now."* Binds: synthesizer top-line (or `top_fixes[0]`).
3. **Depth-unlock banner** *(conditional)* — only when inputs are shallow. Mix-only → *"You gave us a mix. Add your stems or .als to unlock device-specific fixes."* Drives quality + the credit/depth flywheel. Hidden once deep.
4. **The Game Plan — ranked Moves**, grouped:
   - **⚡ Quick Wins** (high impact / low effort) — lead here; a beginner does these, re-runs, feels progress.
   - **🛠 Deeper Work** (higher effort or lower confidence).
5. **Deepen-your-plan zone** — triage's *recommended* specialists as inline prompts (NOT 26): *"Your low end looks busy — deeper read · 2 cr."* No auto-spend; every spend is a priced click. Binds: `SpecialistRoutingPlan`.
6. **Coach dock** — "Ask about this mix" launcher (grounded on measurements + verdicts).
7. **Export bar** — **`Export Game Plan (.md)`** (non-negotiable v1) + (later) HTML-with-visuals.

### Free vs. paid
The free analysis must already yield a useful Plan from **rule_engine + measured findings** alone. Specialist Moves are an *upgrade*, not a paywall to basics.

---

## The Move card (the atom — design this carefully)

```
┌──────────────────────────────────────────────────────────┐
│ ●sev  Tame the low-end buildup around 120 Hz      [⚡ Quick]│  title = imperative action
│ conf 0.8 · effort low · impact 18 · from: rule_engine     │  meta chips
│ "This muddies everything below your vocals."              │  one-line why
│ → On the Bass bus: HPF sub @30Hz, then −2dB @120Hz wide Q │  directive (confidence-gated:
│   [scope: Bass bus]                                        │   precise OR directional)
│ ▸ See the data   (collapsible inline chart = evidence)    │  links to the measurement
│ [▶ Audition in Listen]   [Add to plan ▾ Trying · Dismiss] │  actions + triage
└──────────────────────────────────────────────────────────┘
```

**Confidence-gated directive:** show exact numbers/`param`/`target_value` only when the data backs them (usually .als/stems/reference present); otherwise directional prose ("carve where the boom is, A/B it on the Listen page"). Never fabricate values.

**Triage states:** `suggested → trying → committed → dismissed`. Only `committed` Moves go into the MD export. The Listen page is the **test-bench** where a Move is auditioned before committing.

**`Move` struct (one schema, three renderers: web card / MD export / next-version auto-verify):**
```
Move { id, finding_id, title, scope{target,device?,param?},
       action{directive,target_value?,unit?,confidence},
       rationale, evidence_ref, source, effort, impact, status }
```

---

## Analysis tab (credibility / evidence — demoted, not deleted)

The dense, pro-looking material — keep it, just don't make it the landing: frequency-balance bars, clash table, loudness/true-peak/LRA meters, stereo/phase, genre scoring, structure. Each chart can show *"→ used in Move #3."* This is where "serious instrument" density lives without hijacking the flow.

## Files tab

Mix / stems / .als / reference management; **re-analyze**; "add assets to deepen analysis"; version list; export history.

---

## States to design

- **Running** — per-phase progress (8 phases; 7 without .als).
- **Empty/clean** — no issues: *"Clean mix. Here's polish."* (don't invent problems).
- **Shallow inputs** — Moves are directional + the depth-unlock banner is prominent.
- **Failed phase** — graceful; the Plan still renders from what succeeded.
- **Pre-/post-spend** — recommended specialist (locked) vs. its resulting Moves (unlocked).

## MD export shape (v1 non-negotiable)

```
# Game Plan — "Midnight Lattice" v3   (Grade B, 78/100)
## ⚡ Quick wins
- [ ] Tame low-end buildup ~120 Hz — Bass bus: HPF 30Hz, −2dB @120Hz wide Q
      why: muddies everything below the vocal
- [ ] ...
## 🛠 Deeper work
- [ ] ...
```
Serialized from `committed` Moves; checkboxes so they tick off in their notes app.

---

## Brief for Claude design (copy-paste)

> Design the **analysis-results page** for a web app that gives bedroom music producers an AI-generated, prescriptive "game plan" to improve their mix in Ableton. Three tabs organized by user intent — **Plan** (default/hero), **Analysis** (dense charts, secondary), **Files**. The Plan screen, top to bottom: compact header (song/version/grade/score), a one-sentence plain-English verdict, a conditional "add stems/.als to unlock deeper fixes" banner, then the **Game Plan**: Move cards grouped into "Quick Wins" and "Deeper Work." A **Move card** shows an imperative title, meta chips (severity, confidence, effort, impact, source), a one-line "why," a specific directive (with a target curve when available), a collapsible inline evidence chart, and actions `[Audition in Listen]` + a triage control (Add to plan / Trying / Dismiss). Below the plan: an inline "deepen your plan — run recommended specialist (N credits)" zone (not a big roster), a persistent "Ask the coach" dock, and an "Export Game Plan (.md)" button. Visual tone: a **serious, dark, data-dense pro audio instrument** — credible enough to pay for — but with a clear hierarchy that funnels the eye to the actions, not the numbers. Think mastering-suite meets a focused to-do app.

## Deferred (not v1)
- Version delta / progress comparison (de-prioritized by Brian — keep as a later retention nicety).
- HTML-with-EQ-visuals export.
- Social surfaces (publish-for-feedback, live DJ room) — but keep notes/findings carrying `author` + `visibility` so they snap in later.
