name: "Teach Mode (coach) — curated teaching units + toggle on the existing grounded coach"
description: |
  Add a "Teach me" toggle to the existing coach. In teach mode, a question is
  answered as a *lesson*: the coach explains production craft (from a curated
  knowledge base built from `docs/research/teach/`) and anchors it to the
  user's measured track values. Reuses the whole coach pipeline; adds
  teaching-unit files + loader + selector, a TeachCoach prompt, a per-message
  `mode` flag, and a split grounding rule (general craft numbers free, track
  claims must cite).

---

## Goal

Ship the **machinery + a first vertical slice of units** for teach mode:
- A user toggles "Teach me" in `CoachChat`, asks a conceptual question
  ("why is my low end muddy?", "what is sidechain ducking?"), and gets an
  accurate, plain-voice lesson that uses *their* track's numbers as the
  concrete example.
- Lessons stay grounded: any claim about *this track's* values resolves to a
  real measured path (existing evidence machinery); general craft numbers
  (e.g. "−1 dBTP", "200–500 Hz") are allowed without a chip.
- No new infrastructure (no embeddings/vector store/second actor).

Slice = the domains mapping to the most common findings: **EQ / low-end,
dynamics, loudness**. Remaining domains (saturation, sidechain, reverb/delay,
stereo) are a fast follow once the loop is proven.

## Why

- Differentiated education feature: turns the coach from "answer my question"
  into "teach me, using my own track as the example."
- Reuses everything the coach already has (actor, streaming, evidence, caps,
  degraded short-circuit) — small, additive surface area.
- The seven research artifacts are already the *curriculum* behind the
  solvers and the coach; this gives them a user-facing home.

## What

Toggle on the existing coach. Per-message mode. Teach-mode answers use a
sibling prompt on the **same two-section output contract** so the stream
splitter, evidence resolution, and payload validation are unchanged.

### Success Criteria

- [ ] `coach_messages.mode` column exists (`qa`|`teach`, default `qa`,
      back-compatible); EF entity + `aimusic_shared` mirror + migration.
- [ ] BFF `CreateCoachMessageRequest` accepts optional `mode`; stamped on the
      **user** row in the same `SaveChanges`. Caps unchanged (a teach turn
      meters identically).
- [ ] Worker: `coach_reply` reads `user_row.mode`; teach branch loads
      `TeachCoach.md`, selects ≤3 teaching units, injects them + a catalog
      into the user-turn, and **skips the numeric-without-evidence gate**.
- [ ] `coach_lib/teach/`: `loader.py` (validates frontmatter +
      `reference_paths`), `selector.py` (keyword + finding-category scoring,
      cap, fail-soft), `units/*.md` (≈12–14 seed units across EQ/low-end,
      dynamics, loudness).
- [ ] `prompts/coach/TeachCoach.md` — two-section contract; teaches the craft
      plainly; general numbers free, track claims must cite a resolvable path.
- [ ] Frontend: "Teach me" toggle in `CoachChat`; sends `mode`; teach answers
      badged. Evidence chips render unchanged.
- [ ] All validation gates pass (worker pytest, BFF build+test+migration,
      frontend tsc/lint/build/vitest).

## All Needed Context

### Documentation & References

```yaml
# Design source of truth
- file: docs/superpowers/specs/2026-06-26-teach-mode-coach-design.md
  why: Approved design. Decisions: toggle (not separate surface), "faithful
       but plain" sourcing, Approach A (curated units). Read FIRST.

# The curriculum (knowledge to convert into units)
- dir: docs/research/teach/reasearch/
  why: Seven craft references (EQ, compression, limiting, saturation,
       sidechain, reverb/delay, stereo). For THIS slice author from the EQ,
       compression/gating, and limiting/loudness artifacts only. Each doc has
       TL;DR / Key Findings / Details / Recommendations / Caveats + genre
       deltas + "when wrong tool" — distill into units, drop source names and
       formal flag labels, keep standard-vs-taste as plain prose.

# Coach pipeline (the integration substrate — reuse, do not duplicate)
- file: components/worker/app/coach_actor.py
  why: The coach_reply actor. Phase A loads user_row (add mode read here),
       Phase B builds bundle, Phase C _build_user_turn, Phase E calls the
       numeric gate. This is the ONE file with behavioral edits in the worker.
- file: components/worker/app/coach_lib/context.py
  why: build_context_bundle (verdicts carry `category` — selector input) and
       resolve_evidence + _resolve_path (the path grammar units must obey).
- file: components/worker/app/coach_lib/payload.py
  why: CoachReplyPayload + answer_makes_numeric_claim_without_evidence (the
       gate to skip in teach mode). Reused unchanged.
- file: components/worker/app/verdict_lib/prompt_loader.py
  why: load_coach_grounded / load_coach_grounded_model + COACH_PROMPTS_DIR.
       Add load_coach_teach / load_coach_teach_model mirroring these.
- file: components/worker/prompts/coach/CoachGrounded.md
  why: The two-section streamable contract (sentinel `<<<EVIDENCE>>>`).
       TeachCoach.md MUST mirror this output format exactly.
- file: components/worker/app/coach_lib/stream_parser.py
  why: StreamSplitter — confirms the sentinel contract TeachCoach.md must keep.

# Worker test patterns
- file: components/worker/tests/test_coach_actor.py
  why: How the actor is tested (SessionFactory stubbing, gateway stubbing).
       Mirror for the teach-branch test.
- file: components/worker/tests/test_coach_payload.py
  why: Numeric-gate test pattern.

# Shared model mirror
- file: components/shared/aimusic_shared/models.py
  why: class CoachMessage (~line 418). Add `mode` column + CHECK constraint
       mirroring the EF declaration (role/status pattern already there).

# BFF surfaces (exact code in Implementation Blueprint below)
- file: components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs
- file: components/bff/src/Spectr.Bff/DTOs/CoachConversationDtos.cs
- file: components/bff/src/Spectr.Data/Entities/CoachMessage.cs
- file: components/bff/src/Spectr.Data/AppDbContext.cs
- file: components/bff/src/Spectr.Data/Migrations/20260626030953_AddVerdictProblemFields.cs
  why: AddColumn Up()/Down() pattern to mirror for the mode migration.

# Frontend surfaces
- file: components/frontend-spectr-v2/src/features/results/CoachChat.tsx
  why: composer + POST (inline fetch ~line 300) + turn rendering (~600).
- file: components/frontend-spectr-v2/src/features/results/coach-chat-helpers.ts
  why: ChatTurn interface (add `mode?`).
- file: components/frontend-spectr-v2/src/api/types.ts
  why: CreateCoachMessageRequest / CoachMessageDto (~lines 1350–1409).
- file: components/frontend-spectr-v2/src/features/results/EvidenceChips.tsx
  why: renders unchanged in teach mode (no edit).
```

### Known Gotchas

```text
# CRITICAL: schema drift. Unit `reference_paths` MUST resolve against the REAL
#   flattened analysis (memory: final-json-schema-drift). The research docs
#   cite FICTIONAL paths (phase2.bands.*, loudness.*). Validate every path
#   against a real flatten() output / fixture before finalizing a unit.
# CRITICAL: two-section contract. TeachCoach.md must emit prose, then the
#   single sentinel line `<<<EVIDENCE>>>`, then ONE JSON object — identical to
#   CoachGrounded.md. Any deviation breaks StreamSplitter + CoachReplyPayload.
# CRITICAL: numeric gate. answer_makes_numeric_claim_without_evidence fires on
#   number+unit tokens with no chips. Teaching states general numbers ("−1
#   dBTP"), so the actor must SKIP this gate when mode=="teach". Do NOT weaken
#   the regex (qa mode still needs it).
# CRITICAL: EF AsNoTracking — irrelevant here (no write-path join change), but
#   the mode write rides the EXISTING PostMessage SaveChanges; don't add a
#   second SaveChanges.
# GOTCHA: dramatiq wire format unchanged — still 3 string args
#   (conversationId, userMessageId, assistantMessageId). mode travels via the
#   DB row, NOT a 4th queue arg.
# GOTCHA: aimusic_shared model is the worker's read path. The actor reads
#   user_row.mode via the SQLAlchemy model — the column MUST be added to BOTH
#   the EF entity (canonical) and the aimusic_shared mirror, or the read fails.
# GOTCHA: selector + loader must NEVER raise into the actor (fail-soft like
#   resolve_evidence) EXCEPT the loader at unit-parse time (authoring error).
```

### Desired files (added/changed)

```text
components/worker/app/coach_lib/teach/
  __init__.py                 # exports select_units, load_units, TeachingUnit
  models.py                   # @dataclass TeachingUnit
  loader.py                   # parse + validate units/*.md, validate reference_paths syntax
  selector.py                 # select_units(question, verdicts, units) -> (units, catalog)
  units/                      # ~12–14 seed unit .md files (slice)
    low_mid_mud.md  harshness_2_5k.md  missing_air.md  thin_or_boomy_low_end.md
    subsonic_highpass.md  kick_bass_masking_eq.md  highpass_non_bass.md
    over_compression.md  attack_and_punch.md  glue_compression.md
    crest_factor_health.md  true_peak_ceiling.md  streaming_vs_club_loudness.md
    limiter_overdriven.md
components/worker/prompts/coach/TeachCoach.md          # NEW sibling prompt
components/worker/app/verdict_lib/prompt_loader.py     # +load_coach_teach[_model]
components/worker/app/coach_actor.py                   # mode branch
components/worker/tests/test_coach_teach_selector.py   # NEW
components/worker/tests/test_coach_teach_loader.py     # NEW
components/worker/tests/test_coach_actor.py            # +teach-branch test

components/shared/aimusic_shared/models.py             # +CoachMessage.mode

components/bff/src/Spectr.Bff/DTOs/CoachConversationDtos.cs   # +Mode field
components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs  # stamp mode
components/bff/src/Spectr.Data/Entities/CoachMessage.cs       # +Mode prop
components/bff/src/Spectr.Data/AppDbContext.cs               # +CHECK + default
components/bff/src/Spectr.Data/Migrations/<ts>_AddCoachMessageMode.cs  # generated

components/frontend-spectr-v2/src/api/types.ts               # +mode field
components/frontend-spectr-v2/src/features/results/coach-chat-helpers.ts  # ChatTurn.mode
components/frontend-spectr-v2/src/features/results/CoachChat.tsx          # toggle+send+badge
```

## Implementation Blueprint

### Data models

```python
# coach_lib/teach/models.py
@dataclass(frozen=True)
class TeachingUnit:
    slug: str
    category: str            # rule-engine vocabulary (frequency_balance, low_end, ...)
    aliases: tuple[str, ...] # lowercased trigger terms
    reference_paths: tuple[str, ...]  # analysis.* bundle paths (validated syntactically)
    body: str                # the plain-voice lesson markdown (## Explain / ## Anchor / ...)
    title: str               # human title for the catalog (derive from slug or a frontmatter key)
```

```text
# CoachMessage.mode (3 places, keep in lockstep)
EF entity:   [Column("mode"), MaxLength(20)] public string Mode { get; set; } = "qa";
AppDbContext: HasCheckConstraint("ck_coach_messages_mode", "\"mode\" IN ('qa','teach')")
aimusic_shared: mode: Mapped[str] = mapped_column("mode", String(20), default="qa", server_default="qa")
                + CheckConstraint("mode IN ('qa','teach')", name="ck_coach_messages_mode")
```

### Tasks (in order)

```yaml
# ─────────────── WORKER: knowledge base (no DB, fully unit-testable) ──────────
Task 1 — CREATE coach_lib/teach/models.py + loader.py:
  - TeachingUnit dataclass (above).
  - load_units(dir=units/) -> list[TeachingUnit]: parse frontmatter
    (reuse the _FRONTMATTER_RE pattern style from prompt_loader.py; do NOT
    import a heavy YAML lib if the existing regex approach suffices — match
    repo convention). Required keys: slug, category, aliases, reference_paths.
    Body = content after frontmatter.
  - VALIDATE on load (hard error — authoring time):
      * non-empty slug/category/body
      * category in the known rule-engine category set
      * each reference_path matches the resolver path grammar
        (reuse / mirror context._PATH_SEGMENT_RE per segment; a bad path is a
        bug to catch now, not a silent runtime drop)
  - Loader is module-cached (load once); expose a reset for tests.

Task 2 — CREATE coach_lib/teach/selector.py:
  - select_units(question: str, verdicts: list[dict], units: list[TeachingUnit],
                 cap: int = 3) -> tuple[list[TeachingUnit], list[str]]
  - score = (alias/keyword hits in question.lower()) + CATEGORY_BOOST if the
    unit.category is among the track's top finding categories
    (verdicts[*]["category"]). Tie-break stable by slug.
  - return (top<=cap by score>0, catalog) where catalog = [u.title for u in units]
    (ALWAYS the full catalog so the prompt can say "no lesson on that").
  - NEVER raises. No score>0 and no finding match -> empty unit list (the
    prompt then teaches general craft with a softer anchor).
  - Pure function (no DB, no bundle-structure coupling beyond verdicts dicts).

Task 3 — CREATE units/*.md (the slice, ~12–14):
  - Author from the EQ, compression/gating, and limiting/loudness research docs.
  - Frontmatter: slug, category, aliases[], reference_paths[]. Body sections:
    ## Explain / ## Anchor to your track / ## Genre notes / ## When it's the wrong tool.
  - Plain voice; NO "per Bob Katz"/flag labels; keep standard-vs-taste as prose.
  - VALIDATE reference_paths against a real flattened analysis: run
    flatten() on an existing fixture (see verdict_lib tests / coach context
    tests for a fixture) and assert each path resolves, OR list the confirmed
    real paths first and author against those. Categories to cover:
    frequency_balance, low_end, clarity, dynamics, loudness, clipping.

# ─────────────── WORKER: prompt + actor wiring ───────────────────────────────
Task 4 — CREATE prompts/coach/TeachCoach.md:
  - MIRROR CoachGrounded.md frontmatter (version: 1.0.0, model: same pin) and
    its EXACT two-section output contract (prose, `<<<EVIDENCE>>>`, one JSON line).
  - Behavior: you are in TEACH mode. Teach the relevant craft from the
    "## Teaching units" provided, in plain voice, then ANCHOR to the user's
    measured values. Split rule:
      * General craft numbers (from the units) — state freely, no chip needed.
      * Any claim about THIS track's values — cite a resolvable path in Section 2
        evidence (same chip rules as CoachGrounded).
    - Use only units provided; if no unit fits, say what you can/can't teach
      (catalog) and teach at a high level without inventing track numbers.
    - Keep refusal vocabulary + injection handling identical to CoachGrounded.

Task 5 — MODIFY verdict_lib/prompt_loader.py:
  - ADD COACH_TEACH_FILENAME = "TeachCoach" and load_coach_teach() /
    load_coach_teach_model() — copy load_coach_grounded[_model] verbatim,
    swapping the filename. Same COACH_PROMPTS_DIR, same FileNotFoundError.

Task 6 — MODIFY coach_actor.py (the only behavioral worker edit):
  - Phase A: inside the session block where user_question is read, also read
    `mode = (user_row.mode or "qa")`. Carry it out of the block (like user_question).
  - Phase B/C teach branch:
      if mode == "teach":
        from .coach_lib.teach import load_units, select_units
        units, catalog = select_units(user_question, verdicts_for_bundle, load_units())
        version, system_body = load_coach_teach()      # FileNotFoundError -> existing error path
        model_pin = load_coach_teach_model()
        user_turn = _build_user_turn(bundle, user_question, units=units, catalog=catalog)
        prompt_slug = "coach_teach"
      else: (unchanged grounded path; prompt_slug="coach_grounded")
  - EXTEND _build_user_turn with optional units/catalog params; when present,
    inject a "## Teaching units" block (unit bodies) + "## Lesson catalog"
    (titles) ABOVE the existing "## Context" bundle block. qa mode passes
    neither -> byte-identical to today.
  - Phase E: gate the numeric check on mode:
      if mode != "teach" and answer_makes_numeric_claim_without_evidence(payload): reject
    (teach mode skips it — general craft numbers are expected). Evidence
    resolution (Phase F) is UNCHANGED — track chips still drop if unresolvable.
  - Use prompt_slug in the gateway call's prompt_slug arg.

# ─────────────── SHARED MODEL ────────────────────────────────────────────────
Task 7 — MODIFY components/shared/aimusic_shared/models.py:
  - Add CoachMessage.mode (String(20), default "qa", server_default "qa") +
    CheckConstraint("mode IN ('qa','teach')", name="ck_coach_messages_mode")
    in __table_args__ (mirror the role/status CHECKs already present).

# ─────────────── BFF ─────────────────────────────────────────────────────────
Task 8 — MODIFY DTOs/CoachConversationDtos.cs:
  - public sealed record CreateCoachMessageRequest(string Content, string? Mode = null);

Task 9 — MODIFY Entities/CoachMessage.cs + AppDbContext.cs:
  - Entity: [Column("mode"), MaxLength(20)] public string Mode { get; set; } = "qa";
  - AppDbContext OnModelCreating: HasCheckConstraint
    ck_coach_messages_mode "\"mode\" IN ('qa','teach')" (beside the existing
    role/status CHECKs).

Task 10 — MODIFY Endpoints/CoachConversationEndpoints.cs (PostMessage):
  - On the userRow init add: Mode = NormalizeMode(body.Mode)  // "teach" if =="teach" else "qa"
  - Leave assistantRow.Mode = "qa" (or copy userRow.Mode — pick userRow.Mode so
    a future "render teach answers" read works server-side). Recommend copy.
  - NO change to the usage_event write or the EnqueueAsync 3-arg call.
  - NO change to CoachCapService (a teach turn meters identically — verified).

Task 11 — GENERATE migration:
  - dotnet ef migrations add AddCoachMessageMode --project src/Spectr.Data \
      --startup-project src/Spectr.Bff
  - Verify Up(): AddColumn<string>(name:"mode", table:"coach_messages",
      type:"character varying(20)", maxLength:20, nullable:false,
      defaultValue:"qa") + the CHECK (EF emits it from HasCheckConstraint).
    Down(): DropColumn mode (+ drop CHECK). Existing rows backfill to 'qa'.

# ─────────────── FRONTEND ────────────────────────────────────────────────────
Task 12 — MODIFY api/types.ts:
  - CreateCoachMessageRequest { content: string; mode?: 'qa' | 'teach' }
  - ChatTurn (coach-chat-helpers.ts): add `mode?: 'qa' | 'teach'`.

Task 13 — MODIFY features/results/CoachChat.tsx:
  - const [teachMode, setTeachMode] = useState(false)
  - Toggle control in the input row: reuse the existing lightweight button
    pattern (the `capabilitiesLink` "what can I ask?" button) OR Radix Switch
    (@radix-ui/react-switch is installed, unused). Keep it CSS-module styled;
    no inline styles unless dynamic.
  - POST body: JSON.stringify({ content: msg, mode: teachMode ? 'teach' : 'qa' })
  - Optimistically set `mode: 'teach'` on the user + assistant ChatTurn when
    sending in teach mode (the poll/stream doesn't echo mode; badge client-side).
  - Render a small "Teach" Pill on assistant turns where turn.mode === 'teach'
    (beside the "Coach" label). EvidenceChips unchanged.
```

### Integration Points

```yaml
DATABASE:
  - migration: AddCoachMessageMode (coach_messages.mode varchar(20) not null
    default 'qa' + CHECK mode IN ('qa','teach'))
PROMPTS:
  - new file components/worker/prompts/coach/TeachCoach.md (COACH_PROMPTS_DIR)
QUEUE:
  - UNCHANGED — coach_reply still takes 3 string args; mode rides the DB row.
CAPS:
  - UNCHANGED — CoachCapService meters a teach turn identically.
```

## Validation Loop

### Level 1 — Syntax & style
```bash
ruff check components/worker/ --fix
mypy components/worker/app/ --ignore-missing-imports
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint
```

### Level 2 — Unit tests
```bash
# Worker (new + edited)
pytest -q components/worker/tests/test_coach_teach_loader.py
pytest -q components/worker/tests/test_coach_teach_selector.py
pytest -q components/worker/tests/test_coach_actor.py
pytest -q components/worker/tests/      # full worker suite (no regressions)
pytest -q components/shared/tests/      # shared model still imports/validates

# Frontend
cd components/frontend-spectr-v2 && npx vitest run
```
Required test cases:
- loader: valid unit parses; missing required key -> raises; bad reference_path
  syntax -> raises; unknown category -> raises.
- selector: keyword hit selects unit; finding-category boost reorders; cap=3
  enforced; no match -> ([], full catalog); never raises on junk input.
- actor teach branch: mode="teach" loads TeachCoach + injects units; a body
  with a general number ("−1 dBTP") and NO chips is NOT rejected in teach mode
  but IS rejected in qa mode; an unresolvable track chip still drops.
- payload: existing numeric-gate tests still pass (qa unaffected).

### Level 3 — BFF build + migration + integration
```bash
cd components/bff && dotnet build && dotnet test
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
cd components/frontend-spectr-v2 && npm run build
# Manual smoke (stack up per CLAUDE.md "Integration" gate):
#   POST /api/coach/{analysisId}/messages {"content":"why is my low end muddy?","mode":"teach"}
#   -> assistant row completes; answer teaches mud + cites a real low-end path;
#      general numbers appear without being rejected; UI badges the turn "Teach".
```

## Anti-Patterns to Avoid
- ❌ Adding a 4th dramatiq arg or a new actor/queue. Mode rides the DB row.
- ❌ Weakening `answer_makes_numeric_claim_without_evidence` for qa mode — only
  *skip* it when mode=="teach".
- ❌ Authoring units against the research docs' fictional metric paths. Validate
  every `reference_path` against a real flattened analysis (schema-drift trap).
- ❌ A second `SaveChanges` in PostMessage — stamp `mode` on the existing insert.
- ❌ Forgetting the `aimusic_shared` mirror — the worker read fails without it.
- ❌ Changing the two-section sentinel contract in TeachCoach.md.
- ❌ Inline styles / new global state in the frontend (feature-local only).
- ❌ Source citations or formal STANDARD/CONVENTION labels in unit bodies
  (decision: "faithful but plain").

## Success Checklist
- [ ] Worker: loader + selector + units + TeachCoach.md + actor branch + tests
- [ ] Shared: CoachMessage.mode mirror
- [ ] BFF: DTO + entity + AppDbContext CHECK + PostMessage stamp + migration
- [ ] Frontend: toggle + send mode + teach badge
- [ ] All gates green; manual teach turn grounded + plain + badged
- [ ] qa mode byte-identical to today (no regression)

---

## Confidence: 8/10

High: the coach pipeline is well-understood and reused wholesale; the change is
additive and the surfaces are pinned to exact files/lines. The two genuine
risks are (1) authoring `reference_paths` that actually resolve against the real
`final_json` schema — mitigated by an explicit validate-against-fixture task —
and (2) prompt-craft quality of the units/TeachCoach voice, which is iterative
and gated by the golden actor test rather than one-pass-perfect.
