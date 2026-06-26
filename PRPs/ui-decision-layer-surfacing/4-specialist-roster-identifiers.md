name: "Specialist roster — distinguish always-on AI identifiers from on-demand specialists"
description: |
  The 3 always-on LLM identifiers (trance_arrangement, section_contrast, chord_harmony)
  are mixed into the on-demand specialist roster, so their tiles show a misleading
  "Run · N credits" button. They run automatically server-side (Phase C3, pro tier),
  with no /run/{slug} path. Give them a distinct, passive "AI judgment" treatment.

## Goal

The specialist roster (`VerdictsPanel` full-catalog section + `SpecialistTile`) renders
all 26 specialists with a "Run · N credits" button when idle. But `trance_arrangement`,
`section_contrast`, `chord_harmony` are **always-on identifiers** — they run server-side
during analysis (pro tier) and persist `source='llm_identifier'` verdicts. They have NO
on-demand `/run/{slug}` path. Clicking "Run" on them does nothing useful. Distinguish the
two specialist *kinds* in the roster.

## Why

- A "Run · 2 credits" button that can't run (no endpoint) is broken UX + implies a charge.
- Users should understand these are automatic AI judgment calls, not opt-in priced specialists.
- Pro-gating: identifiers only run on the pro tier — free users never get them, so the tile
  should read "Pro" rather than "Run".

## What

Split roster tiles into two kinds:
- **On-demand specialist** (today's behavior): idle → "Run · N credits"; cached → findings +
  re-run; gating (needs stems / .als); priced.
- **Always-on AI identifier** (new): no Run button, no credits. Reads "AI judgment · runs
  automatically"; shows the cached findings count once Phase C3 produced verdicts; carries the
  `suspected`/"unverified" note. For a free-tier user, shows a "Pro" lock instead of findings.

### Success Criteria
- [ ] The 3 identifier tiles show no "Run"/credits button and no clickable run action.
- [ ] They read as automatic AI judgment with a findings count (cached verdicts) when present.
- [ ] Free-tier users see a "Pro" treatment on the identifier tiles (they don't run on free).
- [ ] On-demand specialist tiles are unchanged.
- [ ] All four frontend gates pass.

## All Needed Context

```yaml
- file: components/frontend-spectr-v2/src/features/results/helpers/specialists.ts
  why: SPECIALIST_CATALOG (~:22-62). The 3 identifiers are entries here (~:49-50,
       group "Sections"). Add a kind/autoRun marker for the identifier slugs:
       trance_arrangement, section_contrast, chord_harmony.
- file: components/frontend-spectr-v2/src/features/results/SpecialistTile.tsx
  why: Tile UI (~:26-141) — idle→Run button, cached→findings+re-run, failed→retry,
       disabled→needs-stems. Branch on the new kind: identifier tiles render the passive
       treatment (no Run).
- file: components/frontend-spectr-v2/src/features/results/VerdictsPanel.tsx
  why: Renders the full roster (~:137-214) + findingsBySlug count. Source of the tile data.
- file: components/frontend-spectr-v2/src/features/results/DeepenZone.tsx
  why: Triage "deepen" list from routing_plan.specialists_to_run (~:1-79). Identifiers are
       NOT in routing_plan (always-on), so they correctly never appear here — no change, just
       confirm.
- file: components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs
  why: SpecialistStatus { Slug, Status } (~:51) — status idle|cached|failed. The frontend
       overlays "running". Identifiers will read "cached" once verdicts exist; "idle" before.
       The always-on distinction is a FRONTEND catalog concern (no DTO change required), though
       a backend `kind` on the catalog/SpecialistCatalog.cs would be the durable home.
```

### Data points to display (identifier tile)
- label + group (e.g. "Trance Arrangement", "Sections")
- "AI judgment · runs automatically" sub-label
- findings count (count of non-dismissed `source='llm_identifier'` verdicts for the slug)
- `suspected`/"unverified" note (these findings are judgment calls)
- pro-gate: "Pro" lock for free-tier users (identifiers don't run on free)

### Actions / buttons
- **None** for identifiers (no Run, no credits). Optional: a passive "re-runs on re-analyze" hint.
- On-demand specialists keep Run / credits / re-run / needs-stems gating unchanged.

### Known Gotchas
```text
# The 3 identifier slugs are the single source of truth — keep them in ONE place
#   (a SPECIALIST_KIND map keyed by slug, or a `kind: 'identifier'` field on the catalog entry).
# Identifiers are pro-tier only (worker identifiers_enabled). The roster should reflect that the
#   findings only exist for pro analyses — don't imply a free user can produce them.
# Don't remove the identifiers from the catalog — they still need to display (filtering + tiles);
#   just change their tile behavior.
```

## Implementation Blueprint

```yaml
Task 1 — mark the identifier slugs
MODIFY helpers/specialists.ts:
  - add `kind: 'identifier'` (or an IDENTIFIER_SLUGS set) for trance_arrangement,
    section_contrast, chord_harmony

Task 2 — passive tile treatment
MODIFY SpecialistTile.tsx:
  - when kind==='identifier': render the "AI judgment · runs automatically" tile with the
    findings count + suspected note + (free tier) Pro lock; NO Run/credits button

Task 3 — pro-gate read
  - surface the user tier (existing entitlement/me context) so identifier tiles can show the
    Pro lock for free users
```

## Validation Loop
```bash
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint && npm run build && npx vitest run
```

## Anti-Patterns to Avoid
- Don't show a Run/credits button for an always-on identifier.
- Don't hardcode the 3 slugs in multiple components — one source of truth.
- Don't remove identifiers from the catalog (they still display + filter).
