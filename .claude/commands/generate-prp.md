# Generate PRP

## INITIAL file: $ARGUMENTS

Generate a complete Product Requirements Prompt (PRP) from an INITIAL.md-style feature spec. The PRP becomes the source of truth for implementation — include ALL context the implementation session will need, because that session may not have this conversation available.

**Resolving `$ARGUMENTS`:**
- If no argument was passed, resolve to `PRPs/source/INITIAL.md` — scaffolded projects ship the intake there, and feature edits happen in place.
- If the user passed an explicit path (e.g., `/generate-prp PRPs/source/INITIAL.md` or `/generate-prp PRPs/source/INITIAL_auth.md`), use that path.
- If the user passed `INITIAL.md` and that file doesn't exist at the project root, check `PRPs/source/INITIAL.md` as a fallback.
- If nothing resolves, stop and ask the user which intake file to read.

Read the resolved INITIAL file first. Understand what's being asked, what components exist, what examples are provided, what constraints matter.

---

## Multi-component INITIAL

If `INITIAL.md` has a `## COMPONENTS` section with one or more `### COMPONENT: <name>` blocks, treat it as a **multi-component project**. Produce **one PRP that covers all components** — not one PRP per component.

**Scope note:** the initial v1 build does NOT use `/generate-prp` — the v1 mega-PRP is written directly at scaffold time to `PRPs/v1_ai_music_analyzer.md`. Use `/generate-prp` only for **adding features to an already-built project**. If `.scaffolding/manifest.json` shows `lifecycle.stage: "plan"`, point the user at `/execute-prp PRPs/v1_ai_music_analyzer.md` instead and stop.

---

## Research Process

### 1. Codebase Analysis (always)

Search for similar features/patterns in `components/`, `src/`, and `PRPs/archive/`. Note existing conventions, test patterns, shared infrastructure.

### 2. External Research

Scale research depth to task complexity. For framework-heavy tasks: read official docs thoroughly, study real-world implementations, catalogue gotchas and security considerations.

Use sub-agents (Explore, general-purpose) when research will generate noise. Keep the main session focused on writing the PRP.

### 3. User clarification (if genuinely needed)

Ask only when the INITIAL leaves critical ambiguity. Prefer making a reasonable default explicit in the PRP over asking.

---

## PRP Generation

Use `PRPs/templates/prp_base.md` as your starting structure. Target ≤ 800 lines — if heading longer, you're duplicating CLAUDE.md content; cite instead of inline.

### What must be in the PRP

- **Context**: URLs with specific sections; internal files with why-to-read; gotchas; patterns
- **Implementation blueprint**: ordered task list per component + inter-component ordering
- **Validation gates** (MUST be executable): per-component + aggregate
- **Error handling patterns**
- **Success criteria** (checklist)

### Output location

Save as `PRPs/<slug>.md`.

---

## Quality

Before finalizing, verify:

- [ ] All necessary context is included (or linked)
- [ ] Validation gates are executable from the command line
- [ ] References existing codebase patterns where applicable
- [ ] Clear, ordered implementation path
- [ ] Every component declared in INITIAL has its own section
- [ ] Error handling and edge cases documented
- [ ] Anti-patterns / what-not-to-do section for the tricky parts

Score the PRP 1-10 (confidence in one-pass implementation success). If under 7, research more or ask clarifying questions before saving.

---

## ULTRATHINK

After research, before writing: pause and plan the PRP structure. Decide what's essential vs. noise. A multi-component PRP that's 3000 lines but mostly filler is worse than 800 lines of dense, relevant context.

The goal: one-pass implementation success through comprehensive, focused context.
