# Listen-V3 doc-drift cleanup (future task)

Captured 2026-06-25 from an adversarial review of the listen-v3 PRP set
(rack presets / game plan / room sessions / version sharing). These are
documentation/spec corrections — no product decision needed except where noted.
Work through them before the parallel UI thread builds further against stale
contracts.

## Verified codebase facts (don't re-litigate — confirmed against the code)
- **Verdict ids are ULID strings, not GUIDs.** `Verdict.cs:9-16` — `[Column("id"), MaxLength(40)] string Id`, comment "ULID string ('vrd_...'), not a Guid". Live DB column is `character varying(40)`. → any `ref_id`/foreign reference to a verdict MUST be a string column, never `uuid`.
- **Verdicts are not a stable, additive set.** `verdict_actor.py` `run_specialist` does `setdefault("verdict_id", new_verdict_id())` + bare `s.add()` — no upsert. Re-running one specialist mints a new ULID for the same finding. → dedup-by-id duplicates on normal re-runs; dedup MUST be by content key.
- **FK constraints with cascade DO exist** in the shared models (`aimusic_shared/models.py:311` — `ForeignKey("verdicts.id", ondelete="CASCADE")`). Adding explicit `ON DELETE CASCADE` to new tables is consistent with the codebase, not novel.
- **BFF `IJobQueue.EnqueueAsync` is immediate-only** (`IJobQueue.cs:47-69`): `options` carries only `redis_message_id`, RPUSH to `dramatiq:<queue>` (never `.DQ`). BUT emitting a delayed message is a ~20-30 line localized change (add `options.eta` epoch-ms + target `dramatiq:<queue>.DQ`); the worker already consumes delayed messages (bare `RedisBroker` ships dramatiq's `DelayedMessageMiddleware` by default). → "delayed finalize" is implementable and small, not blocked.

## Decisions that drive doc edits (apply once confirmed with owner)
- **A — G2 dedup (recommend: yes, v1):** switch from dedup-by-verdict-id to dedup by **content key (`specialist_slug` + `headline`)**, persist that key, and type the ref column as a **string** (not uuid). Consider `(specialist_slug, category)` or a normalized headline for extra stability against prompt-wording drift. Update G2 and every doc that references dedup-by-id or a uuid ref.
- **B — abandoned-session finalize (recommend: b1 + lazy-on-read backstop):** emit a delayed dramatiq finalize (small `IJobQueue` extension) AND keep lazy-on-read so a lost/evicted delayed message can't drop a recap. Pure product call: does a session nobody ever reopens need a guaranteed recap? If no → b2 (clean `/end` + lazy-on-read + Redis TTL) is acceptable. Update PRP-4's FINALIZE section to the chosen path.

## 🔴 Self-contradiction + gap to fix in PRP-4 (no decision)
- **Single flusher:** FINALIZE section says the BFF flushes log→`events_json` and DELs the keys, while Task 8 says the actor does. If the BFF DELs first, the actor reads an empty log. → Make the **actor the sole flusher**; BFF only triggers.
- **Missing base snapshot:** nothing writes the `seq=1` base-chain snapshot (session-create only writes a Postgres row), so "reconstruct chain by folding patches over the base" has no base. → **session-start writes the base atomically.**

## 🟡 Cross-doc drift (pure cleanup)
- **`LISTEN_V3_UI_CONTRACT.md` (highest priority — UI thread builds against it):** remove `RackPresetDto.userId` + `copiedFromId`, `RackDraftDto.userId`, the `/copy` endpoint, `source:'…|reviewer'`, and the old "Suggestion wraps RackPreset(source='reviewer')" model. Sync to the corrected "chain is canonical" model (the doc currently contradicts its own corrected note). **Send a heads-up to the UI thread after syncing.**
- **PRP-1:** Validation Level 2 + Key cases + Task 5 DTO still reference the dropped `copied_from_id` / copy endpoint — remove.
- **PRP-5:** desired-tree still lists `ApplyOutcome.cs`; "mirror the 4 new tables" vs "3 tables" contradict; `GamePlanEndpoints` / frontend-hook / `AccessService` notes still say "outcomes" — reconcile to the current model.

## 🟢 Refinements to fold into the specs (no decision)
- **PRP-1:** export must be an envelope `{name, chain, schemaVersion}` (raw `chain_json` has no name → can't round-trip to a named preset); specify the import validation that's asserted as "manifest-validated" but never defined; `snapshotChainFromGraph` reads a `getMasterBypass()` the handle doesn't expose (master bypass silently lost on save) — add it to the handle or to the snapshot path.
- **PRP-4:** make `INCR`+`RPUSH` atomic (Lua/MULTI) so a crash can't burn a seq; reject writes to an already-ended session (a late grantee-save otherwise snapshots an empty chain).
- **PRP-5:** the "DeltaCard placeholder" is actually a **live wired element** in `songs.$songId.tsx` — correct the premise; add `ON DELETE CASCADE` on the new tables' `song_version_id`.

## Reviewed & dismissed (so triage is on record)
Cross-version "my presets" library (explicitly scoped out), the reserved-source CHECK (accepted trade-off), most PRP-4 live-sync edges (torn-snapshot / counter-loss / Last-Event-ID — sync is best-effort by design), and the "no FK constraints exist" claim (an over-read — see Verified facts; FKs with cascade do exist).
