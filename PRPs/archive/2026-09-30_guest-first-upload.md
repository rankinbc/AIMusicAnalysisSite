# Guest-first upload — design spec

_Status: binding design authority for `PRPs/archive/2026-09-30_guest-first-upload-plan.md`. Extends
(and in four places supersedes) `PRPs/archive/2026-09-30_guest-demo-sandbox.md`._
_Written 2026-09-21 against `solo` @ `8586956`. Every claim about existing code
was re-verified in the working tree (`BFF` = `components/bff/src/Spectr.Bff`,
`FE` = `components/frontend-spectr-v2/src`, `WK` = `components/worker/app`).
Where the code contradicted the controller's design message, the owner's intent
was kept, the mechanism adapted, and the difference recorded as a ruling (§5)._

---

## 1. The ask

The owner uploaded a track on the public `/analyze` page and rejected what came
back. Verbatim (2026-09-21):

> "I dont want this shit bait page. I want to show off the product. Do the full
> analysis and have The coach analyze the findings, fixes, and top 3 important
> suggestions for improving the mix. Then have him say "Create an account and
> let's save our progress so we can make this mix awesome" (or something like
> that). Allow them to click around the report page so they can the findings and
> suggested fixes. In fact I'd like them to have all the fetures... Are there any
> we really should disable for them? We can delete their stuf after 24 hrs if
> they dont create an account"

and about the progress list shown while a track analyzes:

> "Make this page more accurage. If stems aren't loaded, dont act like its going
> to do stem analysis - have it greyed or crossed out and a note explaining the
> benefits of if they were to upload stems. Same with als track and refernce
> (all the optional analyses)"

Owner-level decisions carried by this spec:

| # | Decision |
|---|---|
| O1 | **No teaser.** An upload on `/analyze` gets the full product: full analysis, the real report page, the live coach, Listen. |
| O2 | **The coach opens the conversation** with what it found, the fixes and the top 3 priorities, and closes by inviting the visitor to create an account. |
| O3 | **Features on, under caps.** Guests get the features; only what has no meaning for an identity-less account, or what can hurt the single VM / the AI budget, is limited. |
| O4 | **24 hours.** A guest's data is deleted 24 h after the session starts unless they create an account, and creating one KEEPS everything ("save our progress"). |
| O5 | The progress list is honest about optional inputs (Task G0 — already briefed at `.superpowers/sdd/guest-first-upload-plan/task-G0-brief.md`). |

---

## 2. What exists today (verified)

- The public flow cannot host a full report. `POST /api/anon/analyses` creates a
  song-less, version-less `AnalysisJob { DeviceId, FilePath, Tier="free" }`
  (`BFF/Endpoints/AnonAnalysisEndpoints.cs:117-126`); the worker skips LLM
  identifiers and the structure follow-up for device-owned jobs
  (`WK/tasks_dramatiq.py:463,499-502`); triage, specialists and the coach all
  sit behind `RequireAuthorization()`; and the device claim at registration
  re-parents jobs/analyses/conversations but creates no `Song`/`SongVersion`
  (`BFF/Endpoints/AuthEndpoints.cs:220-278`), so a claimed job never reaches the
  library or the report route.
- The teaser is `AnonReportView` + `BlurLock` + `InlineRegisterCard` in
  `FE/features/anon-analyze/AnalyzePage.tsx:95-154,338-396`, fed by the
  deliberately-withholding `AnonReportProjection` (`BFF/Endpoints/AnonReportProjection.cs:5-12`).
  Its `StreamingCard` renders unstyled because the only stylesheet defining
  `.stream-card` is scoped under `.rdx` and imported by `ReportView.tsx` /
  `ListenRackPage.tsx` only.
- The guest machinery (tasks D1–D7) is built and reviewed: real `users` row with
  `is_guest`, fail-closed `POST /api/auth/demo`, default-deny `GuestGuard`
  (`BFF/Auth/GuestGuard.cs:23-49`), `GuestLimits`, a separate guest LLM lane in
  the worker (`WK/llm/lane.py`), nightly purge. The frontend half (D9 `/demo` +
  `startDemo()`, D10 guest shell) is planned, not built.
- `useMixUpload().upload(file, fields): Promise<UploadResponse>`
  (`FE/hooks/useMixUpload.ts:41,134`) is the reusable signed-in mix uploader;
  `UploadResponse = { songId, versionId, jobId: string | null }` (`FE/api/types.ts:324-330`).
- The coach has no opening move: `GetOrCreateConversationAsync`
  (`BFF/Endpoints/CoachConversationEndpoints.cs:310-328`) inserts an empty
  conversation; `coach_reply(conversation_id, user_message_id, assistant_message_id)`
  (`WK/coach_actor.py:311-319`) REQUIRES a `role='user'` row and reads the turn's
  `mode` off it (`:381-392`). `coach_messages.mode` has a CHECK constraint
  `IN ('qa','teach','concise')` (`components/bff/src/Spectr.Data/AppDbContext.cs:135-136`).
- The guest coach cap counts `usage_events` of type `coach_message`
  (`BFF/Services/CoachCapService.cs:50-54`), so a message that writes no usage
  event is free against `coach_guest_messages`.
- The guest ANALYSIS quota reuses the UPLOAD flag: `CheckAnalysisAsync` reads
  `guest_uploads_max` (`BFF/Services/GuestLimits.cs:119`).
- `POST /api/reports/{jobId}/phases/{phase}/rerun` enqueues `rerun_phase`
  directly (`BFF/Endpoints/ReportPhaseEndpoints.cs:89`) — it does not pass
  through `DispatchAnalysisAsync`, and no UI exposes it. `POST /api/jobs/{id}/retry`
  does pass through it (`BFF/Endpoints/JobEndpoints.cs:121`).
- Guest status is stamped first from the JWT's EMAIL claim
  (`BFF/Program.cs:165`), then from the cached `tver:` snapshot (`:181-191`).
- `PurgeOneGuestAsync` reloads the row by id only
  (`BFF/Services/RetentionSweepScheduler.cs:215`) — it does not re-check
  `IsGuest` or the expiry before tearing the account down.
- **Latent data-loss bug, independent of guests:** `VersionEndpoints.Delete`
  (`BFF/Endpoints/VersionEndpoints.cs:400-405`) and `SongEndpoints.HardDelete`
  (`BFF/Endpoints/SongEndpoints.cs:307-312`) delete storage keys with no
  shared-key check. Every registration is seeded with the demo song
  (`AuthEndpoints.cs:290`), whose version points at the SHARED snapshot audio
  (`audio/demo/snapshot/<export>/source.*`). Once a snapshot is installed, any
  real user who deletes their demo song deletes the demo audio for everyone.
- `validate_source` enforces 3 s – 1800 s for every upload
  (`WK/source_validation.py:44-49,150-158`), called at `WK/tasks_dramatiq.py:271`
  where `job.user_id` is in scope (`:209`).
- The allin1 container is started with no memory limit
  (`components/analysis/src/audio_analysis/structure/docker_allin1.py:200-209`).
  It took the Docker VM down three times on 2026-09-20 on a 9-minute track
  (`docs/STARTUP.md` #2d). A non-zero exit becomes `RuntimeError` (`:218-222`),
  which `detect_structure_job` turns into `arrangement_status="failed"` on the
  report without failing the analysis (`WK/structure_actor.py:152-185`). Anon
  jobs skip this follow-up today; guest uploads will NOT — they are user-owned.
- The snapshot exporter throws a raw 500 when the version's audio is missing
  (`AdminEndpoints.DemoSnapshot.cs:128`), and retires the previous export's
  assets immediately after go-live (`:185-210`) although live guests' versions
  still point at them.

---

## 3. Decisions

### G-D1 — An upload on `/analyze` is a guest upload
Dropping a file on `/analyze` (a) starts a guest session when nobody is signed
in, via `AuthContext.startDemo()` from task D9, (b) uploads the mix through
`useMixUpload` as the guest's own song, (c) navigates to
`/songs/$songId/results/$jobId` — the real progress screen, then the real report.
A visitor who is already signed in (guest or real) uploads as themselves.
The teaser UI and its client code are deleted. The BFF `/api/anon/*` endpoints
and the device-claim path are left in place, unused (ruling R1).
A returning guest is signed back in by the ordinary boot refresh (the guest
refresh cookie lives until `guest_expires_at`), so the landing "resume" slot
switches from polling `/api/anon/jobs/current` to `useAuth()`: a guest sees one
card linking to `/library`. This also removes the red 404 that a logged-out
landing logs today.

### G-D2 — The demo song stays; "use our sample" is cut
The guest's library holds their track AND the seeded demo. The progress screen
offers "Explore a finished report while yours is analyzing" → the demo report.
Task D8 of the sandbox plan is CUT; `/analyze` carries a plain "No track handy?
Explore the demo" link to `/demo`.

### G-D3 — The coach opens with a brief
When triage and every routed specialist have finished, the report page asks for
the brief once: `POST /api/coach/{analysisId}/brief` (`.AllowGuest()`).
- One brief per conversation, enforced by a partial unique index — a second
  request returns the existing one. It writes NO `usage_events` row, so it does
  not count against `coach_guest_messages`; it DOES spend from the caller's LLM
  lane (the gateway resolves the guest lane by user id).
- Mechanism (ruling R2): the brief is an ordinary `coach_reply` turn in a new
  mode `brief`, answering a server-authored user row that is never shown and
  never billed. The actor gains one prompt branch (`CoachGrounded.md` + a new
  `CoachOpeningBrief.md` style block, slug `coach_brief`) and, for this mode
  only, replaces its two refusal exits (degraded analysis, budget exhausted /
  LLM error) with a deterministic template brief built from the stored
  findings. A brief never renders as an error bubble.
- The guest closing line is server-owned, exact copy:
  **"Create a free account and let's save our progress — so we can make this mix awesome."**
  It is delivered as `CoachMessageDto.ClosingLine`, set at read time when the
  message is the brief AND the caller is a guest (ruling R3); the frontend renders
  it as the last paragraph of that bubble with a "Create free account" button.
  After conversion the line is gone without touching stored data. Signed-in
  users get the brief without it.
- Never for demo-seeded analyses (version under `audio/demo/`): the seeded demo
  must stay free (sandbox spec §6.1). The demo gets its brief by being exported
  with one (ruling R9).

### G-D4 — Creating an account keeps everything (in-place conversion)
`POST /api/auth/guest/convert { email, password }` — authenticated, guest-only
(ruling R4). One atomic `UPDATE users … WHERE id = @id AND is_guest AND
guest_expires_at > now()` sets email, password hash, display name,
`is_guest=false`, clears `guest_expires_at` + `guest_device_id`, and bumps
`token_version`. Then: delete the guest's refresh rows, issue a normal-lifetime
refresh cookie + a new access token (the old one carries the guest email claim
and is now version-stale), evict `tver:{id}`, write an audit row
(`guest_converted`), clear the `spectr_device` cookie, send the verification
email best-effort. Same validation and rate limits as registration; `409
email_taken` leaves the guest untouched; a non-guest caller gets `403
not_a_guest`; zero rows updated → `410 guest_expired`.
The purge and the conversion are disjoint in time by construction (purge selects
`expires < now`, conversion requires `expires > now`); as defence in depth
`PurgeOneGuestAsync` re-checks `IsGuest && expired` on the row it reloads.

### G-D5 — Caps, not locks
Newly open to guests: stems (stage, stage-keys, classify, confirm), `.als`
(upload, key registration), one reference track (upload, complete-key, analyze,
delete), attachment presign, archive + restore own song, delete own version, job
retry. Re-analyze was already open.
Still closed: billing, email/password change, data export, account deletion,
permanent song delete, phase re-run (ruling R6), everything unmarked.

| Flag | Value | Meaning |
|---|---|---|
| `guest_ttl_hours` | 72 → **24** | session + data lifetime |
| `guest_uploads_max` | 1 → **2** | mixes per guest |
| `guest_analyses_max` | **6** (new, ruling R5) | analysis dispatches per guest — upload, stems confirm, `.als`, re-analyze and retry each count |
| `guest_stems_max_files` / `guest_stems_max_mb` | **12** / **300** (new) | per version (so at most `guest_uploads_max` × that per guest) |
| `guest_references_max` | **1** (new, ruling R8) | reference tracks per guest |
| `guest_track_max_seconds` | **720** (new) | longest guest mix |
| `llm_budget_guest_usd` | 5 → **30** | monthly AI budget for ALL guests; exhausted → rule-based findings + template brief |

The `UPDATE`s are guarded (`WHERE value = '<seeded value>'`) so an operator's
live tuning is never overwritten. The frozen marker inventory
(`GuestGuardInventoryTests.cs:41-71`) is edited in the same task — it is the
review surface.

### G-D6 — Protect the single VM
- The allin1 `docker run` gets `--memory` and `--memory-swap` (same value, so no
  swap), from `ALLIN1_MEMORY_LIMIT` (default `6g`). Exit 137 / an OOM-kill is
  reported as `Allin1OutOfMemory(RuntimeError)`; the existing failure path marks
  arrangement as not assessed and the analysis stays complete (ruling R14).
- The worker rejects a guest-owned source longer than `guest_track_max_seconds`
  with the existing typed `invalid_file / too_long`, in copy that offers a free
  account. Real users keep the 30-minute limit.
- G4 lands BEFORE G5: the public upload must not reach a box without the cap.

### G-D7 — Retention
Guest TTL 24 h. A snapshot re-export no longer deletes the previous export's
assets at once: it records them in `audio/demo/snapshot/retired.json` with a
timestamp and deletes only entries older than `guest_ttl_hours` + 1 h (ruling
R10). A version whose audio is missing → `409 snapshot_not_ready`.

### G-D8 — Shared demo audio cannot be deleted by any account (CRITICAL)
Every BFF code path that deletes a storage key on behalf of a user skips keys
under `audio/demo/` (`DemoSnapshotStore.IsSharedKey`): `VersionEndpoints.Delete`,
`SongEndpoints.HardDelete`, and the version-upload rollback. This is the first
step of G1 and is correct independent of everything else in this spec.

---

## 4. Safety

- **Auth.** Conversion is the only new auth surface. It is guest-only,
  rate-limited like registration, atomic, rotates every credential the guest
  held, and cannot resurrect an expired guest. Reviewed on the most capable tier.
- **Money.** Worst case per month = the global LLM ceiling + `llm_budget_guest_usd`.
  One brief per conversation; the brief is refused for demo-seeded analyses; a
  guest's analyses are capped per guest, per IP and globally (fail closed).
- **The VM.** Memory-capped structure detection, a 12-minute guest track limit,
  capped stems and references, one worker thread as before.
- **Deletion.** Shared keys are undeletable from every user path (G-D8); the
  worker side was already protected (`is_shared_key`).
- **Copy.** Never "public", "shared", "people", "community"; never describes
  load; no "jobs queued / waiting"; no "invite". The closing line is exact.
- **Guards.** `NoSocialSurfaceTests.cs` untouched. The frontend allowlist gains
  nothing in this plan (`/analyze` and `/demo` are already allowed/approved).

## 5. Rulings (what — why — cost if wrong)

- R1 BFF `/api/anon/*` + device claim stay, unused — removal touches guards, migrations and the claim path; cost: dead endpoints for a while.
- R2 The brief rides `coach_reply` in a new `brief` mode with a hidden server-authored user row — reuses the 370-line stream/parse/validate/persist path untouched; cost: one hidden row filtered in two read paths and one CHECK-constraint migration.
- R3 The guest closing line is a read-time DTO field, not stored text — exact copy, cannot be mangled by the model, disappears on conversion; cost: one extra DTO field.
- R4 Conversion is its own endpoint, not an overload of `/auth/register` — that file is 781 lines and anonymous; cost: the frontend `register()` chooses the route.
- R5 New flag `guest_analyses_max=6` — the analysis quota reused `guest_uploads_max`, which would let a guest with two uploads never confirm stems; cost: one more knob.
- R6 Phase re-run stays denied — no UI exposes it and it bypasses the analysis quota; cost: none.
- R7 The upload cap's enforcement is the atomic limiter; the DB count is a backstop that a delete can lower — every analysis is separately capped by append-only usage events; cost: with rate limits disabled (never in prod) a guest can upload more files than `guest_uploads_max`.
- R8 New flag `guest_references_max=1` — a reference is a 250 MB upload and needs a bound; cost: one more knob.
- R9 No brief for demo-seeded analyses — keeps "the seeded demo never spends"; cost: the demo shows a brief only after a re-export that contains one.
- R10 Deferred retire through a manifest — `IFileStorage` has no listing API; cost: one small JSON object under the snapshot prefix.
- R11 The server's readiness check for a brief is "a routing plan exists"; the frontend decides the moment (all routed specialists ran) — cost: an early request yields a thinner brief, once.
- R12 The teaser's client code is deleted, not orphaned — the owner rejected the page and dead code rots; cost: recoverable from git.
- R13 A signed-in visitor on `/analyze` uploads as themselves — cost: none.
- R14 An OOM-killed structure run reuses the existing `arrangement_status="failed"` path — no new state; cost: none.

## 6. Out of scope

Removing the anon endpoints; a server-side "all specialists finished" signal;
email-first conversion ("magic link"); migrating an existing 72-hour guest to 24
hours (rows keep the expiry they were minted with); GPU structure detection.

## 7. Supersedes in `PRPs/archive/2026-09-30_guest-demo-sandbox.md`

O4 / D5 ("ONE track, mix only") → G-D5. D10 ("after the one upload is used…",
mix-only upload dialog for guests) → G-D5 + plan §"Amendments". D11 ("use ours"
on `/analyze`) → cut (G-D2). "v1 create account = plain `/register?from=demo`,
in-place conversion deferred" → G-D4.
