# Session Handoff

Summarize the current session and write it to `HANDOFF.md` at the project root so the next session (or the next day) can resume immediately with full context.

Use this when:
- The session has run long and context usage is heavy
- You're pausing work and coming back later
- Switching to a different task and want to preserve thread
- Work is blocked and needs to wait on something (user input, external factor)

---

## Process

1. **Summarize this session from memory** (don't scan the full conversation — just what you remember as important):
   - What was the user actually trying to accomplish? (the goal, not the tasks)
   - What did we complete? What's still pending?
   - What key decisions were made — and what alternatives were explicitly ruled out?
   - What dead ends did we hit? What approaches should future sessions avoid?
   - What's the single most useful next action?
   - Are there open questions that need the user's input before work can continue?

2. **Gather relevant project state** (only what matters for resume):
   - If this is a git repo: current branch name, count of uncommitted files, last 2-3 commit subjects. Skip if not a git project.
   - Files created or modified this session (just a list — don't paste contents)
   - Long-running processes the user should know about

3. **Write `HANDOFF.md`** at the project root using this shape:

```markdown
# Handoff — {ISO date}

## What we were working on
<one short paragraph about the user's actual goal>

## Completed this session
- <specific thing>

## Still pending
- <specific thing>

## Key decisions
- <decision> — <why>

## Dead ends to avoid
- Tried <approach>, didn't work because <reason>

## Project state
- Branch: `<branch-name>` (if git)
- Uncommitted: <n> files (if git)
- Files modified this session: <list>

## Recommended next action
<single, specific, concrete next step>

## Open questions for the user
- <question needing their input>
```

4. **Report to the user** in one line: "Handoff written to `HANDOFF.md`. Next session should start by reading it."

---

## Guidelines

- **Summarize, don't transcribe.** `HANDOFF.md` should be under ~100 lines.
- **Prioritize the "why" over the "what".**
- **One recommended next action, not a list.**
- **Overwrite existing `HANDOFF.md`.**
- **Skip git state cleanly** if `git` commands fail or the project isn't a git repo.
