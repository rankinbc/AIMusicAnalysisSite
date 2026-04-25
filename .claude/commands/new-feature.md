# /new-feature

Guided interview that fills `PRPs/source/INITIAL.md` for a new feature, then chains into `/generate-prp` (which produces a PRP) and optionally `/execute-prp` (which builds it). The friendly entry point for post-build feature work — mirrors `/new-project`'s role at scaffold time.

## When this runs

- User runs `/new-feature` (optionally with a one-sentence feature description as `$ARGUMENTS`)
- User says things like "I want to add a feature", "let me start a new feature", "help me spec a new thing", "lets create a new feature"

## Your role

Conversational orchestrator. You:
- Verify the project is past v1 build (otherwise redirect the user)
- Check the current state of `PRPs/source/INITIAL.md` and confirm before overwriting
- Run a short adaptive interview
- Draft the filled INITIAL.md content
- Show it to the user for approval
- Write it to disk
- Offer to chain `/generate-prp` (and then `/execute-prp`)

Do **NOT** research libraries, read external docs, or write the PRP itself. That's `/generate-prp`'s job. Keep this command lean.

---

## Preconditions — check before starting

### 1. Lifecycle stage

If `.scaffolding/manifest.json` exists, parse it and check `lifecycle.stage`:

- `"plan"` — the v1 build hasn't run yet. Redirect:

  > Your v1 build hasn't run yet — adding features before v1 is built means the components don't yet exist for the feature to attach to.
  >
  > Run `/execute-prp PRPs/v1_ai_music_analyzer.md` first. That builds the initial project; then `/new-feature` is the right path for new work.

  Stop. Do not proceed.

- `"built"` (rare mid-partial-build state) — continue with a note: "Heads-up: your project is in a partial-build state (some components built, others still stubs). The new feature can still be spec'd, but `/execute-prp` on the resulting PRP may surface missing pieces. Continue?"

If `.scaffolding/` is missing entirely, the project is fully built (the common case). Continue.

### 2. Existing INITIAL.md content

Read `PRPs/source/INITIAL.md`. Two cases:

- **Blank shipped template** — the `## FEATURE` section still contains the placeholder `[One paragraph — what this feature does, ...]`. Safe to fill from scratch; skip the next prompt.

- **Non-blank** — show the user what's there and ask how to proceed:

  > Your `PRPs/source/INITIAL.md` already has content:
  >
  > ```markdown
  > <first ~15 lines of the file>
  > ```
  >
  > Options:
  > 1. **Use this as-is** — I'll run `/generate-prp` now, no interview
  > 2. **Build on it** — interview adds to the existing description (append, don't replace)
  > 3. **Start fresh** — overwrite with a new feature
  >
  > Which? [1 / 2 / 3]

  Branch on the answer. Option 1 jumps straight to step 5. Options 2 and 3 run the full interview.

---

## The flow

### Step 1/4 — Greeting + preamble

Print:

> Welcome! I'll help you set up a new feature.
>
> Here's what we'll do:
>
> &nbsp;&nbsp;**Step 1** → Short interview (~3-5 questions)
> &nbsp;&nbsp;**Step 2** → I draft the feature spec; you approve or edit
> &nbsp;&nbsp;**Step 3** → I save it to `PRPs/source/INITIAL.md`
> &nbsp;&nbsp;**Step 4** → I offer to run `/generate-prp` (which researches + writes the PRP) and then `/execute-prp` (which builds it)
>
> Usually 2-4 minutes for this conversation. `/generate-prp` adds ~1-2 min of research. `/execute-prp` is the actual build.
>
> **What do you want to build?** A rough sentence is fine.

If `$ARGUMENTS` was non-empty, use it as the user's initial answer and proceed directly to step 2 without re-asking.

### Step 2/4 — Adaptive interview

Ask **one question at a time**. Let answers drive follow-ups. Ask no more than 5-6 questions total unless the feature is genuinely complex.

Always establish:
- **What it does** — user-visible behavior, trigger conditions, output
- **Where it lives** — new component, or added to an existing one? (Name it.) If new, what shape (dashboard / api / analysis / etc.)?
- **Key interactions** — which existing files or modules does it touch? What data does it read/write?
- **External dependencies** — any libraries, APIs, or docs Claude should pull in during research?
- **Known gotchas** — prior-attempt failures, rate limits, constraints, security considerations, anything an AI typically misses

Skip anything the user already answered. Ground follow-ups in what they just said. Don't interrogate — if the user says "small thing, just adds a CSV export button to the dashboard," three questions should be enough.

### Step 3/4 — Classify: single vs. multi-component

Based on answers, decide silently (don't announce the table):

- **Single-component feature** (fits inside one existing component, no new component needed) → fill `## FEATURE`, `## SHARED DOCUMENTATION`, `## OTHER CONSIDERATIONS`. Leave `## COMPONENTS` empty or delete it.

- **Multi-component feature** (spans existing components OR adds a new component) → fill `## FEATURE` + one `### COMPONENT:` subsection per component.

### Step 3.5 — Draft + confirm

Show the drafted INITIAL.md content back verbatim in a code block and ask for approval. Iterate until the user says "go".

### Step 4/4 — Write + offer the chain

Write the content to `PRPs/source/INITIAL.md`, then offer to run `/generate-prp`.

---

## Guidelines

- **Natural conversation, not a form.** Skip questions the user already answered.
- **Short feature → 3-question interview.** Complex feature → 5-6 questions max.
- **Pick patterns silently.** Don't make the user read the mapping table.
- **The interview fills INITIAL.md — it does not write the PRP.**
- **Capture gotchas in `## OTHER CONSIDERATIONS`.**
