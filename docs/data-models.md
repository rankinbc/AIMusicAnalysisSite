# Data Models — Shared Postgres Schema

One document for the whole shared database (deviation from per-part naming is intentional: both the BFF and the worker read/write the same Postgres 16 instance).

**Canonical source**: the EF Core 10 entities in `components/bff/src/Spectr.Data/Entities/*.cs` + `components/bff/src/Spectr.Data/AppDbContext.cs`. The Python worker uses a hand-maintained SQLAlchemy mirror (`components/shared/aimusic_shared/models.py`) covering the 30 tables the worker touches; cross-language drift is caught by fixture-roundtrip tests. Never define ORM models in the worker directly — extend the EF entity first, migrate, then mirror.

Snake_case table/column names throughout. 41 tables total.

## Entity Catalog

### Identity & auth

| Table | Entity file | Purpose / key columns |
|---|---|---|
| `users` | `User.cs` | Account + public profile. `email` (citext, unique), `hashed_password`, `email_verified_at`, `token_version` (JWT invalidation on reset/ban/delete), `banned_at`/`ban_reason`, profile (`handle` citext unique, `display_name`, `bio`, hues, `ui_prefs` jsonb), `stripe_customer_id` (partial-unique), `notify_analysis_complete` |
| `refresh_tokens` | `RefreshToken.cs` | Server-side refresh-token records backing the httpOnly cookie flow |
| `auth_tokens` | `AuthToken.cs` | Single-use email-verification / password-reset tokens; `token_hash` unique, `(user_id, purpose)` index |
| `devices` | `Device.cs` | Anonymous browser identity (AR24). ULID PK (26 chars), `ip_hash`/`ua_hash` (SHA-256 peppered), `claimed_by_user_id`/`claimed_at`. Unclaimed devices + their rows purge after 72 h |
| `audit_log` | `AuditLog.cs` | Append-only operator/user action trail (`actor_user_id` deliberately not FK'd, `action`, `target`, `reason`) |

### Library

| Table | Entity file | Purpose / key columns |
|---|---|---|
| `songs` | `Song.cs` | A track container per user. `user_id`, `name` (unique per user), `genre_hint`, visual card fields (`visual_template`, oklch colors), reference profile pointer (`reference_profile_kind`/`_id`), `visibility` (private/shared/public, default private), `archived_at` |
| `song_versions` | `SongVersion.cs` | One uploaded mix iteration. `song_id`, `version_number` (unique per song), `file_path` (storage key), `reference_path`, `als_file_path`, `als_project_json` (jsonb, client-parsed project map), `stem_paths_raw` (jsonb staging list), `stem_paths` (jsonb `{role: [keys]}`), `stem_analysis_mode` (grouped/per_stem), `is_current` (partial unique index: one current per song — raw SQL), `raw_audio_purged_at` (retention marker) |
| `song_tags` | `SongTag.cs` | User-defined tags; unique `(song_id, user_id, name)`, cascade with song |

### Analysis chain

| Table | Entity file | Purpose / key columns |
|---|---|---|
| `analysis_jobs` | `AnalysisJob.cs` | Transient job state the UI polls. `user_id` XOR `device_id` (DB CHECK `ck_analysis_jobs_owner_xor`), `version_id` (nullable), `file_path` (anon song-less jobs only), `status` (pending/processing/complete/failed/awaiting_stem_mapping), `current_phase` + `phase_pct` (live progress), `reference_id`, `error_message`, `error_code` (typed, e.g. `invalid_file`, `worker_unavailable`), `tier` (stamped at dispatch), `retry_of_job_id` (partial-unique — one free retry per origin, story 5.7), dispatch/start/complete/fail timestamps |
| `analyses` | `Analysis.cs` | One row per completed analysis (unique `job_id`). Denormalized `user_id` XOR `device_id`, `version_id`, `song_id`, `song_name`; `final_json` (jsonb — the whole report), `phase_durations` (jsonb), image keys (`spectrogram_image_path`, `waveform_image_path`, `waveform_peaks_path`), `stem_metrics` (jsonb), `routing_plan` (jsonb), `degradation_notice` (jsonb), sharing (`share_token` unique, `share_show_verdicts`, `share_enabled_at`) |
| `verdicts` | `Verdict.cs` | One finding per row (LLM specialist OR rule engine). ULID string PK (`vrd_...`). `analysis_id` (indexed, + `(analysis_id, specialist)`), `specialist`, `prompt_version` (`slug@semver`), `model`, `severity` (critical/severe/moderate/minor/win), `category`, `confidence`, `priority_score` (server-computed), `impact`, `headline`/`summary`/`body`/`metric_line`/`why_it_matters`, `evidence` (jsonb), `fix` (jsonb — Apply Preset wire format), `sources` (jsonb). **8 IDENTIFY Problem columns**: `problem_id`, `kind` (fault/observation/integrity), `source` (rule_engine/llm_identifier), `data_tier` (audio_only/stems/project_midi), `fixable`, `suspected`, `where` (jsonb section span; SQL reserved word, quoted), `refines` (parent composite problem_id) |
| `verdict_user_state` | `VerdictUserState.cs` | Per-user dismiss/applied/feedback overlay; composite PK `(verdict_id, user_id)` |
| `prompt_versions` | `PromptVersion.cs` | Operator prompt-version pinning registry |
| `llm_calls` | `LlmCall.cs` | Per-call LLM metering (ULID PK `llm_...`). Written ONLY by the worker gateway; BFF reads for spend dashboards. `user_id`, `tier`, `purpose` (triage/specialist/coach), `prompt_slug`/`prompt_version`, `model`, token counts, `cost_usd numeric(12,6)`, `price_table_version`, `latency_ms`, `outcome`, `correlation_id`. Indexes on `created_at` and `(user_id, created_at)` |

### Coach

| Table | Entity file | Purpose / key columns |
|---|---|---|
| `conversations` | `Conversation.cs` | One per `(analysis_id, user_id)` (unique) — or `device_id` for anon (XOR CHECK). Get-or-created on first coach POST |
| `coach_messages` | `CoachMessage.cs` | One row per turn. `conversation_id` (+`created_at` index), `role` (user/assistant CHECK), `status` (pending/complete/refused/error CHECK), `mode` (qa/teach, default qa), `content`, `evidence` (jsonb citation chips), `refusal_reason` (e.g. `coach_offline`), `llm_call_id` (ULID link to metering row), `completed_at` |

### Listen / rack / rooms

| Table | Entity file | Purpose / key columns |
|---|---|---|
| `rack_presets` | `RackPreset.cs` | Named full-chain DSP rack snapshot, VERSION-scoped (no user_id — owner derives via version->song->user). `source` CHECK (user/coach/analysis), `chain_json` (jsonb), `coach_meta` (jsonb — fix-rack rationale from `generate_fix_rack`), provenance FKs `created_in_session_id`, `via_grant_id`, `from_suggestion_id` (all SetNull) |
| `rack_drafts` | `RackDraft.cs` | One autosaved draft per version (unique `song_version_id`) |
| `viz_presets` | `VizPreset.cs` | User-scoped visualizer presets |
| `session_notes` | `SessionNote.cs` | Timestamped listening notes per `(version_id, user_id)` |
| `listening_sessions` | `ListeningSession.cs` | A live Room. `song_version_id`, `host_id`, `status` (live/ended CHECK), `events_json` (jsonb — Redis WAL flushed once at finalize), `recap_json` (jsonb — derived projection), `recap_published_at` (feed publish signal; partial index with host) |
| `control_grants` | `ControlGrant.cs` | Rack/visuals control handoff provenance. `session_id`, `scope` CHECK (rack/visuals), `grantee_user_id`, `granted_by`; one ACTIVE holder per `(session, scope)` via raw-SQL partial unique index |

### Sharing & feedback

| Table | Entity file | Purpose / key columns |
|---|---|---|
| `share_settings` | `ShareSetting.cs` | 1:1 with a version (PK `song_version_id`). `visibility` (private/unlisted/public), `share_token` (plain unique — NULLs distinct), `comments_policy`, `session_host_policy`, `session_join_policy` (all CHECKed) |
| `invites` | `Invite.cs` | Tokened invites. `scope` (version/session), `role` (reviewer/listener/host), `status` (pending/accepted/revoked), `token` unique, `invited_user_id` SetNull |
| `track_comments` | `TrackComment.cs` | Polymorphic comments: exactly one of `target_share_token` / `target_published_track` / `target_version_id` (3-way CHECK). Threaded via `parent_id` (NoAction self-FK; soft-delete `deleted_at`), `suggestion_id` link, `status` CHECK (open/resolved/pinned/hidden) |
| `track_bookmarks` | `TrackBookmark.cs` (in TrackComment.cs) | Same 3-way polymorphic target CHECK; per-user bookmarks |
| `suggestions` | `ReviewerSuggestion.cs` | Reviewer rack suggestions (PRP-3). `song_version_id`, `from_user_id`, `status` CHECK (proposed/auditioned/accepted/rejected), circular nullable FK pair with `track_comments` (`comment_id` <-> `suggestion_id`, both SetNull), `created_in_session_id` |

### Social & notifications

| Table | Entity file | Purpose / key columns |
|---|---|---|
| `notifications` | `Notification.cs` | Inbox. Two row shapes: EVENT rows (`digest_key` NULL, one per occurrence) and DIGEST rows (rolling per `(recipient, digestType, version, day)`, `count` increments; partial unique on `digest_key` via raw SQL). `recipient_user_id` (+`updated_at` index), `payload` jsonb, `read_at` |
| `follow_relations` | `FollowRelation.cs` | Follow graph. Unique `(follower_id, followee_id)`, followee index for fan-in, CHECK no self-follow |

### References & compare

| Table | Entity file | Purpose / key columns |
|---|---|---|
| `reference_tracks` | `ReferenceTrack.cs` | Saved commercial reference mixes. `user_id`, `title`/`artist`, `file_path`, inline metrics filled by `run_reference_analyzer` (`bpm`, `detected_key`, `lufs`, `true_peak_db`, `dynamic_range_lu`, `stereo_width`/`_correlation`, `band_levels` jsonb), `analysis_status` (pending/analyzed/failed) + legacy `analyzed` bool, `used_count` |
| `reference_sets` / `reference_set_members` | `ReferenceSet.cs` | Named reference groupings; member composite PK `(set_id, reference_id)` |
| `compare_cache` | `CompareCache.cs` | Cached version-vs-reference deltas; unique `(track_version_id, reference_id)` |
| `version_user_ratings` | `VersionUserRating.cs` | Personal score: unique `(user_id, version_id)` |
| `version_compare_notes` | `VersionCompareNote.cs` | Note per `(user_id, version_a_id, version_b_id)` — pair stored normalized (A < B by Guid ordinal) |

### Billing & ops

| Table | Entity file | Purpose / key columns |
|---|---|---|
| `subscriptions` | `Subscription.cs` | Stripe mirror, PK = `user_id` (1:1). `stripe_customer_id`/`stripe_subscription_id` (both unique), `stripe_item_id`, `status` (Stripe lifecycle strings), `price_id`, `current_period_end`, `cancel_at`, `next_payment_attempt` (dunning banner). Mutated ONLY by the webhook processor |
| `webhook_events` | `WebhookEvent.cs` | Stripe event dedupe. PK = Stripe event id (string); duplicate-skip must be conditional on `processed_at IS NOT NULL` |
| `credit_ledger` | `CreditLedgerEntry.cs` | Append-only signed ledger; balance = SUM(amount). `reason` CHECK (purchase/spend/reversal/adjustment), `amount` CHECK nonzero, `reference` (payment_intent or job id), `idempotency_key` (partial unique — e.g. `reversal:<jobId>`). Never UPDATE; corrections are compensating rows |
| `usage_events` | `UsageEvent.cs` | Append-only usage meter. `event_type` CHECK (analysis/coach_message), `billing_period` (yyyy-MM, `(user_id, billing_period)` index), `reference` |
| `feature_flags` | `FeatureFlag.cs` | Live no-redeploy knob store: `name` PK, `value` string. Read by BFF (`EntitlementService`, 60 s IMemoryCache) AND worker (`app/feature_flags.py`, 60 s TTL, fail-open, raw SQL) |
| `email_suppressions` | `EmailSuppression.cs` | Bounce/complaint suppression list; rechecked at send time by the worker |

## Relationship Overview

Core product chain (all Guid FKs unless noted):

```
users 1--n songs 1--n song_versions 1--n analysis_jobs --1 analyses 1--n verdicts (ULID PK)
                                                              |          \-- n verdict_user_state (per user)
                                                              |-- 1..n conversations (unique per analysis+user) 1--n coach_messages
                                                              |-- routing_plan / degradation_notice (embedded jsonb, no table)
song_versions 1--n rack_presets / rack_drafts(1) / share_settings(1) / invites / suggestions / listening_sessions / session_notes / compare_cache
listening_sessions 1--n control_grants ; rack_presets --> (created_in_session_id, via_grant_id, from_suggestion_id) provenance
reference_tracks n--n reference_sets (via reference_set_members) ; analysis_jobs.reference_id -> reference_tracks
```

**Anon -> claim path (AR24/AR25)**: `analysis_jobs`, `analyses`, `conversations` each carry `user_id` XOR `device_id` (raw-SQL CHECK constraints `ck_*_owner_xor`, migration `20260703202525_AddDevicesAndDeviceOwnership.cs`). An anonymous flow mints a `devices` row (ULID, signed `spectr_device` cookie); registration claims the device server-side — stamps `claimed_by_user_id`/`claimed_at` and re-parents jobs/analyses/conversations to the user. The worker re-reads ownership at analysis-persist time so a mid-pipeline claim is honored. Unclaimed device rows + `audio/anon/{deviceId}/...` storage purge after 72 h.

Denormalization: `analyses` carries `user_id`/`song_id`/`song_name` so list pages avoid 3-table joins (IDOR-safe single-table WHERE).

## JSONB Payloads (shape notes)

- **`analyses.final_json`** — the entire pipeline report. Production shape is `{"phases": [...] , ...rollups}`; consumers call `verdict_lib/flatten_analysis.flatten()` to pivot into `{"phase1": {...}, ..., "phase8": {...}}` before rule/prompt use. Phase 1 = universal mix metrics (LUFS, true peak, BPM, key, stereo, band energies), phase 2 genre, phase 4 stems, phase 6 reference delta, phase 7 arrangement/sections (filled in later by deferred structure detection — merged into the SAME row), phase 8 .als project analysis. Also duplicated best-effort to `output/analysis_results/*.json` and R2 `reports/{jobId}.json`; Postgres stays canonical.
- **`analyses.routing_plan`** — `{specialists_to_run: [{name, priority, focus}], skip: [], rationale, estimated_total_tokens}` (pydantic `SpecialistRoutingPlan`). Written once by `run_triage` (NULL-guarded); also embedded in `verdicts_payload` in the legacy v1 schema.
- **`analyses.degradation_notice`** — `{reason: "tier_budget"|"global_budget"|"circuit_breaker", detail, occurred_at}`. First failure wins; drives the frontend degradation banner + coach-offline refusals.
- **`verdicts.evidence`** — `[{metric, value, expected_range, label}, ...]`; `verdicts.fix` — `{fix_id, target, section, dsp_chain, steps[], sidechain, expected_outcome, ableton_hint}`; `verdicts.where` — `{section_type, start_seconds, end_seconds}`.
- **`song_versions.stem_paths_raw`** — staged list `[{path, original_filename, detected_role?, confidence?, evidence?}, ...]` (classifier writes the last three). **`stem_paths`** — confirmed `{role: [keys]}` (legacy `{role: "key"}` still accepted by the pipeline coercion).
- **`rack_presets.chain_json`** — full rack chain (module order + params + masterBypass), superset of `fix.dsp_chain`; **`coach_meta`** — `{change_log, arbiter_notes, degraded, leftover_advice}`.
- **`listening_sessions.events_json`** — the flushed Redis WAL (`room:{id}:log`, Guid "N" key format) — durable event archive; **`recap_json`** — `{hottest_moments, histogram, peak_concurrency, attendance}` derived by `synthesize_recap`.
- Others: `users.ui_prefs`, `song_versions.als_project_json`, `analyses.phase_durations`/`stem_metrics`, `reference_tracks.band_levels`/`tags`, `notifications.payload`.

## Migration Strategy

- **EF Core migrations are canonical** — `components/bff/src/Spectr.Data/Migrations/` (45 migrations from `20260517074718_Initial` through `20260715140356_AddRackPresetCoachMeta`). Apply with `dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff`.
- **Manual raw-SQL steps are a standing pattern**: EF Core cannot fluently express Postgres partial indexes / some CHECKs, so migrations append `migrationBuilder.Sql(...)` in `Up()`/`Down()` after scaffolding. Instances: the `song_versions.is_current` partial unique index (the original gotcha — without it a song can have two current versions), `users.stripe_customer_id` unique-where-non-null, `credit_ledger.idempotency_key` partial unique, `notifications.digest_key` partial unique, `control_grants` one-active-holder per (session, scope), the `ck_*_owner_xor` device CHECKs, and `analysis_jobs.retry_of_job_id` (this one EF can express via `.HasFilter`). See `bff/README.md`.
- **Cross-language insert safety**: `AppDbContext.OnModelCreating` sets DB-side defaults (`now()` on `*_at`, token-count/cost defaults on `llm_calls`, `visibility`, IDENTIFY-column defaults on `verdicts`) precisely because the C#-side `= DateTimeOffset.UtcNow` initializers do not fire when the Python worker inserts via SQLAlchemy. The worker still sets `created_at` explicitly where it matters. Postgres extensions: `pgcrypto`, `citext`.
- **Boot-time migrations in prod** — `Spectr.Bff/Program.cs`: when `Migrations:ApplyAtBoot=true` (set by the prod compose), `BootMigrator.ApplyAsync` runs migrations under a Postgres advisory lock at container start; a failure crashes the container by design (serving against a half-migrated schema is worse than a restart loop). Dev keeps the CLI/launcher flow.
- **Legacy Alembic is frozen** — the frozen v1 FastAPI tables keep their historical Alembic revisions under `components/api/alembic/versions/`; no new Alembic revisions. The worker never migrates anything.
- **Mirror discipline** — add columns to the EF entity first, scaffold + hand-finish the migration, then update `aimusic_shared/models.py` (and both worker mappers `degraded._to_row` / `verdict_actor._persist_verdict` plus DTOs when the column is verdict-facing — the 8 IDENTIFY columns are the worked example). Tables the worker needs only read-only/raw access to (billing, `feature_flags`, `email_suppressions`) are intentionally NOT mirrored; the worker queries them via SQLAlchemy Core `text()`.
