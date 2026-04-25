<!--
  INITIAL.md — per-feature intake for /generate-prp.

  Use this AFTER your v1 build is done (lifecycle.stage == "built") to add a
  new feature. For the initial v1 build, /new-project wrote the PRP directly
  at PRPs/v1_ai_music_analyzer.md — you don't need INITIAL.md for that.

  EASIER PATH: run `/new-feature` instead of hand-editing this file. It asks
  a few questions, fills this file for you, then chains into /generate-prp
  and /execute-prp. Use the manual instructions below only if you prefer to
  author the spec yourself.

  Manual flow: fill in what you want built below, then run `/generate-prp`.
  Claude will research, write a new PRP at `PRPs/<slug>.md`, and you'll run
  `/execute-prp PRPs/<slug>.md`.
-->

## FEATURE

[One paragraph — what this feature does, the user-visible behavior, where it lives in the project]


## COMPONENTS

<!--
  Optional — only if the feature spans multiple components. Keep the headers
  exactly as shown; /generate-prp parses them.

  For a single-component feature, leave this section empty (or delete it).
-->

### COMPONENT: <component_name>

**Pattern**: <pattern file, e.g., `analysis.md`>

**Purpose**: [What this component does, in 1-2 sentences]

**Inputs**: [Where it reads from — e.g., `data/<source>/` — or "None"]

**Outputs**: [Where it writes to — e.g., `output/<component>/<date>_<run>/` — or "None"]

**Notes**: [Component-specific considerations — edge cases, gotchas, constraints]


## SHARED DOCUMENTATION

<!--
  Links Claude should pull in while researching. Official docs, API references,
  internal files worth reading. Be specific about which section of a doc matters.
-->

[List shared documentation links here]


## OTHER CONSIDERATIONS

<!--
  High-value section. Things AI assistants typically miss:
    - "This touches the auth layer — re-read CLAUDE.md's security section first"
    - "Rate limit is 10 req/sec on this API, not the documented 100"
    - "The previous attempt at this failed because <X>; don't repeat it"
    - Project-wide edge cases, failure modes, domain gotchas
-->

[Project-wide considerations]
