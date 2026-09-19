# User Journeys — SPECTR

Grounded map of the user-facing flows: what the user does, what they wait on,
and where the seams are. Sources: live walkthrough of the running app
(Playwright, 2026-07-22, dev build, real library data) plus code tracing.
Written as the primary input for a UX-friction audit.

## Journey 1 — Anonymous first analysis (the funnel)

Path: Landing `/` → "Analyze free" → `/analyze` → file pick → analysis → report → register to keep it.

1. **Landing** (`/`): hero + live sample report (grade F demo), three trust
   cards, links to Pricing / Sign in / Analyze free. Anon CTA is prominent;
   copy promises "no account needed for the first one".
2. **`/analyze`**: a single "Choose a file" button (WAV/FLAC/MP3, ≤250 MB, "no
   forms, ever"). Genuinely minimal entry.
3. Upload → `POST /api/anon/analyses` (multipart proxy) mints a `spectr_device`
   cookie and a song-less job. **One active analysis per device** (409
   `anon_active_analysis` if a second is attempted).
4. **Waiting**: the funnel polls `GET /api/anon/jobs/current`; a resume card
   lets the user come back to an in-flight/finished analysis. Free-lane queue
   (`analysis-free`) — waiting time depends on worker load; typical full
   pipeline ~75 s plus queue time.
5. **Report** (anon variant) → registration claims the device server-side and
   re-parents jobs/analyses/conversations. Anon storage is purged after 72 h.
6. Known seam (recorded in `PRPs/deferred-work.md`): claimed anon reports are
   reachable via the `/analyze` resume card + direct job URL but **absent from
   the library grid** (song-less), so the artifact can feel "lost" post-signup.

## Journey 2 — Sign in / registration

- `/login`: email+password, links to register and password reset. Dev builds
  add a one-click "Dev sign-in".
- Registration auto-verifies in dev (`Auth:DevAutoVerify`); in staging/prod the
  second analysis is gated on email verification (403
  `email_verification_required` + banner/resend UX).
- Observed (dev walkthrough): clicking Dev sign-in navigated to `/library`
  before auth state landed and bounced back to `/login?next=%2Flibrary`; a
  second navigation succeeded. Dev-only path, but the shape of the race (guard
  reads auth before the login mutation settles) is worth a look at the real
  login too.

## Journey 3 — Upload a new song/version (registered)

Entry points: library "+ New song", song detail "+ Add version", shell "+ Upload"
(links to `/library`).

- **UnifiedUploadDialog** is the single entry: mix required; stems (≤100
  files), .als project, and reference track optional; "Review stem roles before
  analyzing" checkbox (default off).
- Plumbing: mix + .als upload with `analyze=false`, then ONE analysis dispatch
  via stems `/confirm` (after audio-content classification by the worker) or
  `/versions/{id}/analyze`. Reference uploads run their own analyzer and never
  touch the track's analysis.
- **Waiting**: job progress is polled (`useJob`); the version appears with a
  pending/processing state. If the worker is down, jobs sit "pending 0%" —
  the shell shows a worker-health notice (`AppWorkerHealthNotice`), and the
  BFF `StaleJobReaper` fails abandoned jobs after ~30 min so the UI shows a
  re-runnable error instead of an infinite spinner.
- Post-analysis: an **"Analysis complete" modal** (AnalysisCompleteModal)
  presents grade, coach headline, inputs-analyzed chip ("Song · 1/4 sources"),
  and Re-analyze / View full report actions.
- Observed: the modal also **auto-opened over a 3-week-old report** when
  deep-linking to `/songs/{id}/results/{jobId}` — worth verifying the
  only-once-per-completion intent.

## Journey 4 — Library → song → versions

- **Library** (`/library`): Songs/References tabs; header "Your library — 24
  songs · 43 versions"; sort (recent/name/versions), grid/list toggle, filter
  pills (All/Archived), "+ New song". Every song is private to its owner —
  there is no visibility/sharing state (solo fork, `PRPs/solo-fork-strip-social.md`).
- Song cards are dense: current version, inline play button, song link, genre
  chip, per-version mini-list, "Analysis Results" button.
- **Song detail** (`/songs/{id}`): header (genre, grade, current version) +
  Edit/Archive/Add-version; ProgressTimeline (grade-over-versions
  chart); version list where each row has up to 6 actions (Listen, Report or
  Make current, Edit label, Reanalyze, Reference, Delete); Compare rail
  ("v1 → current", "Last two", "Pick two…").
- Observed inconsistencies on a real song (6 versions, all analyzed 3w ago):
  header shows **grade F** while the timeline shows **"No scored versions
  yet"** and every version row's score cell shows **"—"**; only the CURRENT
  version row has a "Report ↗" link (older versions' reports are reachable
  only via Reports page or job URLs).

## Journey 5 — Results page (the core deliverable)

`/songs/{songId}/results/{jobId}` — SongHeader (title, findings/suggestions
counts, inline player with duration) + tabs: **AI Coach** (default) /
**Findings** (count badge) / **Track Info** / (**Project**, **Reference** when
those inputs exist) / **Debug** (dev builds).

- **AI Coach tab**: coach panel + chat ("2 of 300 follow-ups · this analysis"
  meter, grounding note), then "Recommended fixes" list (11 on the walked
  track): severity chips (Severe/Minor), measured-value chips, expandable
  why/data/suggested-fix, "+ Add" per fix.
- **Fix rail** (right): "Fixes for Listen 0" queue — "Open in Listen" stays
  disabled until a fix is added; "Game Plan" compiles checked fixes to a DAW
  checklist download.
- Fix Rack generation: adding fixes and generating queues a worker job
  (POST 202 → GET 204 until ready); the panel has generating/error/timeout
  states (timeout after ~2.5 min) with Retry.
- Observed content seams on a real report: **duplicate findings** from
  different rule sources (true peak appears as both "+0.13 dBTP / Severe" and
  "0.1 dBTP / Minor"; clipping appears as both a structured "Hard clipping (6
  samples)" and a coach-voice paragraph); **genre confusion** — song chip says
  Trance, report modal says "other", and a fix flags "BPM 72 outside
  modern_trance 136-142" (BPM octave halving); severity mixes Severe and Minor
  for the same underlying issue.
- Arrangement/structure results land later (deferred allin1 job, ~6-7 min CPU):
  the arrangement area shows "analyzing…" and fills in via 4 s polling.

## Journey 6 — Listen rack

`/listen-rack/{versionId}` (canonical; per-version "▶ Listen" everywhere).

- Layout: NOW PLAYING header (title, genre chip, "Private workbench" note),
  "View Report →" back-link; center stage (waveform/visuals, full-screen
  toggle); tool tabs **RACK / VISUALS / STEMS**; right rail **Coach / Plan /
  Stats / Notes** + "Ask about your mix…" box. The rack is always editable —
  there is no read-only/room-guest mode (solo fork removed live listening
  rooms and the WORK/VIEW/ROOM mode switch, `PRPs/solo-fork-strip-social.md`).
- The Plan tab receives fixes queued on the results page ("Fixes applied: N —
  reset" chip); rack modules apply the DSP chain live (Web Audio graph).
- Desktop-first: below 1024 px the page shows a "Desktop tool" notice and
  pauses playback.
- Observed: genre chip here also reads "other" for a song labeled Trance
  (same genre-resolution seam as Journey 5).

## Journey 7 — Account, plan & caps

- `/billing`: current plan card (walkthrough account: Pro Annual, active) with
  Switch cadence / Manage payment / Cancel. Cadence toggle POSTs directly —
  the confirm dialog is a known deferred item (DF1). "Switch to monthly" was
  disabled in the dev walkthrough (Stripe not configured locally).
- `/pricing` (public): Free/Pro cards + credits pack advertised "Coming soon"
  (deliberate for now) even though the billing buy-credits flow exists.
- `/usage`: usage meters. `/profile`: profile + danger zone (export/delete).
- Caps the user feels: free tier = per-analysis coach follow-ups + free
  analysis lane; pro = pooled monthly coach cap (meter chip in CoachChat);
  LLM spend ceilings can flip coach to a degraded/offline notice.

## Cross-journey waiting states (the friction inventory)

| Wait | Where | Typical duration | UI while waiting |
|---|---|---|---|
| Upload transfer | UnifiedUploadDialog | size-dependent | XHR progress bar |
| Stem classification | upload review step | seconds | proposals poll |
| Analysis pipeline | song/results | ~75 s + queue | job progress poll; complete-modal on finish |
| Structure/arrangement | results | ~6-7 min (background) | "analyzing…" + 4 s poll |
| Specialist verdict | coach tab | per-run LLM latency | tile spinner |
| Fix Rack generation | results rail/modal | seconds-minutes | spinner → error/timeout+Retry after 2.5 min |
| Coach reply | coach chat | LLM latency | SSE token stream |
| Worker down | any job | until restart | worker-health notice; stale jobs failed at ~30 min |

## Friction candidates observed live (for the audit)

1. Score display inconsistency on song detail (grade F header vs "No scored
   versions yet" timeline vs "—" per version).
2. "Analysis complete" modal over old reports on deep-link.
3. Duplicate/conflicting findings (same issue, two severities/voices).
4. Genre pipeline seams surfacing to users (Trance vs "other", BPM-octave
   genre mismatch fix on a mislabeled genre).
5. Only the current version exposes a "Report ↗" from the song page.
6. Report ↔ Listen round-trip requires queueing fixes first ("Open in Listen"
   disabled at 0 fixes) — the empty-queue path to Listen is the per-version
   Listen link, a different affordance.
7. Anon→registered claim leaves reports outside the library grid.
8. Dev sign-in auth race (check the real login for the same shape).
9. Card/action density (library card ≈ 8 interactive targets; version row ≈ 6).
10. Follow-up meter copy "2 of 300 · this analysis" (cap-grammar clarity).
