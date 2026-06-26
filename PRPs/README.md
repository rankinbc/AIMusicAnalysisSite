# PRPs — Product Requirements Prompts

Canonical reference for the PRP system in this project.

---

## What is a PRP?

A **Product Requirements Prompt** is a detailed implementation blueprint written *for* an AI coding assistant (Claude). It contains everything needed to implement a deliverable end-to-end without further research:

- Full context (what's being built, why, key constraints)
- Documentation references (APIs, libraries, internal files to read)
- Implementation steps in order
- Validation gates (commands to run — tests, linters — that must pass)
- Error handling patterns
- Success criteria

---

## Two workflows — initial build vs. post-build features

### 1. Initial v1 build (one command)

`/new-project` already wrote your v1 implementation plan:

```
PRPs/v1_ai_music_analyzer.md  →  /execute-prp PRPs/v1_ai_music_analyzer.md
```

No `INITIAL.md` middleman, no `/generate-prp` step. Just run:

```
/execute-prp PRPs/v1_ai_music_analyzer.md
```

Claude fills in the component stubs with real code, runs validation gates, archives the PRP on success, and cleans up scaffolder state. You end up with a clean, working v1.

**Partial build:** build one component at a time:
```
/execute-prp PRPs/v1_ai_music_analyzer.md --component api
/execute-prp PRPs/v1_ai_music_analyzer.md --component analysis
/execute-prp PRPs/v1_ai_music_analyzer.md --component worker
/execute-prp PRPs/v1_ai_music_analyzer.md --component frontend
```

### 2. Post-build feature work

Once v1 is built, use **`/new-feature`** — a guided interview that asks a few questions, fills `PRPs/source/INITIAL.md` for you, and chains into `/generate-prp` and `/execute-prp`:

```
/new-feature  →  PRPs/source/INITIAL.md  →  /generate-prp  →  PRPs/<slug>.md  →  /execute-prp PRPs/<slug>.md
```

Trivial fixes (typos, one-line bug fixes) don't need a PRP. Just ask Claude directly.

---

## File organization

```
PRPs/
├── README.md                      # This file
├── <slug>.md                      # ACTIVE PRPs / living reference docs (loose at root)
├── prd.md, epics.md, architecture.md, ux-design-specification.md, sprint-status.yaml
│                                  # BMAD roadmap — the live planning system (see stories/)
├── stories/
│   └── <epic>-<n>-<slug>.md       # BMAD story specs — kept as the sprint record (not archived)
├── design_handoffs/
│   └── <handoff>/                 # ACTIVE design handoffs only (consumed ones go to archive/)
├── templates/
│   └── prp_base.md                # Structural template (don't edit)
├── archive/
│   └── <YYYY-MM-DD>_<slug>[.md|/] # Completed PRPs + consumed design handoffs/inputs
└── source/
    └── INITIAL.md                 # Per-feature intake template (edit for new features post-build)
```

**Conventions (enforced during the 2026-06-25 cleanup):**
- A PRP whose work has **shipped** moves to `archive/<YYYY-MM-DD>_<slug>.md` (date = when it landed). Design+impl pairs archive together.
- **Duplicates** and **transient scaffolding** (one-shot bundles, launch checklists, drift-cleanup notes) are deleted, not archived — git history keeps them recoverable.
- Loose files at root are **only** active PRPs and living reference docs (the roadmap, the product/vision briefs that are still the north star, and in-flight build PRPs).

---

## Glossary

- **PRP** — Product Requirements Prompt. A generated implementation blueprint for Claude.
- **INITIAL.md** — Blank per-feature intake template. Edit to describe a post-build feature, then run `/generate-prp`.
- **v1 mega-PRP** — The multi-component implementation plan at `PRPs/v1_ai_music_analyzer.md`, written by `/new-project`.
- **`/new-feature`** — Guided interview that fills `PRPs/source/INITIAL.md`. Post-build only.
- **`/generate-prp`** — Reads `PRPs/source/INITIAL.md`, does research, writes a complete PRP. Post-build only.
- **`/execute-prp`** — Reads a PRP and implements it. Used for both initial build and post-build features.
- **`/handoff`** — Saves session state to `HANDOFF.md` for resume-tomorrow continuity.
