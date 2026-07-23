# UX Friction Report — SPECTR

**Audit:** 2026-07-22 · Sally (UX) · live walkthrough (Playwright, dev stack, real library data) + code tracing
**Ground truth:** [user-journeys.md](./user-journeys.md) (8 journeys, 10 pre-observed candidates — all verified below) · [component-inventory-frontend-v2.md](./component-inventory-frontend-v2.md)
**Evidence:** screenshots in `output/ux-audit/2026-07-22_friction-audit/` (referenced as `S01`–`S12`), file:line refs into the codebase, live jobs `d9636607` (song "fl" v6, 7:37 Trance) and `c8f5a8d4` (fresh mix-only 8-second upload, created and deleted during the audit).

**Method:** each journey audited for click depth to core value, cognitive load, waiting-state honesty, dead ends, inconsistent affordances, and trust breaks. Anon funnel and the upload → report → listen loop weighted heaviest per brief. Findings ranked by **user impact × frequency**.

---

## The headline

The skeleton is genuinely good — the anon funnel is a model of restraint, waiting states are honest and resumable, and the claim flow is one of the better ones I've seen. The friction is concentrated in one place: **the product contradicts itself about its own analysis.** The same physical fact (a clipped master, a mono collapse, a genre, a score) is shown with different values, severities, and names depending on which surface you're looking at. For a product whose entire promise is "honest grades," internal disagreement is the most expensive kind of friction there is: it doesn't slow the user down, it makes them stop believing the report.

Picture the producer this app is for. They bounce a mix at 1 a.m., upload it, and get told their clipping is *critical* in the completion modal, *Minor* in the fix list, and *Severe*-but-actually-the-true-peak in the chat. They add a fix to their plan, come back tomorrow, and the plan says it's empty while the card says "✓ Added." They click "Open in Listen — try the fixes" and hear… nothing different. Each moment is small. Together they teach the one lesson a coaching product cannot afford: *don't trust what it says.*

---

## Findings (ranked by impact × frequency)

### F1 — The report contradicts itself: duplicate findings, three severity vocabularies, crossed severities 🔴 Critical
**Journey:** 5 (results — the core deliverable) · verifies candidate #3, expands it
**Evidence:** S03, S04, S05, S08 · job `d9636607` and fresh job `c8f5a8d4`

Observed live on both a real track and a pristine upload:

- **Duplicates:** 3 of 11 fixes on "fl" are duplicate pairs from two rule voices — true peak appears as "+0.13 dBTP / Severe" *and* "0.1 dBTP / Minor"; clipping as a structured "Hard clipping (6 samples) / Minor" *and* a first-person coach paragraph; width as "Stereo width wanders (25/100) / Severe" *and* a coach-voice "Minor." On the fresh track, mono compatibility appears as **44% in one card and 19% in the adjacent card**.
- **Three severity vocabularies:** fix list = Severe/Minor · Findings tab = Severe/**Moderate**/Minor (the same key-ambiguity and width items are Severe in one, Moderate in the other) · completion modal = critical/minor/win.
- **Crossed severities:** the modal calls clipping *critical* and true peak *minor*; the fix list calls true peak *Severe* and clipping *Minor* — exact inversion, same screen stack.
- **Count soup:** header chip "3 findings · 11 suggestions" · Findings tab badge "3" · the tab's own filter pills "All 6" · modal "5 initial findings."

**Why it matters:** this list is the product. The producer decides what to fix tonight based on these severities, and the surfaces disagree about which problem is the emergency.

**Direction:** one severity scale and one deduped findings source — suppression should absorb the coach-voice twins the way composites already absorb child singles, and every surface (modal, tabs, fix list, chat) should render from the same ranked set.

---

### F2 — Genre machinery: every profile is `modern_trance`, and users see three genre identities at once 🔴 Critical
**Journey:** 5, 6 · verifies candidate #4, root cause found
**Evidence:** S03, S08 · `components/worker/app/verdict_lib/config/rule-bindings.json:12-17`

The genre map currently routes **everything** to one profile: `"trance" → modern_trance, "house" → modern_trance, "dnb" → modern_trance, "other" → modern_trance, "default" → modern_trance`. Downstream, one screen shows three genre identities: song chip **Trance**, modal/phase-2 **"other" (50% confidence)**, fix text **modern_trance**. The BPM-octave artifact ("BPM 72 outside modern_trance 136–142" on a 144-BPM trance track) and the fresh-track absurdity ("**BPM 0** outside modern_trance range" when tempo detection returned nothing on an 8-second file — right next to a phase chip honestly showing "— BPM") both ship straight to the user as fix cards. The Listen page shows "other" for a song the user labeled Trance (S06).

**Why it matters:** a producer who uploads house and gets scolded against trance tempo rules concludes the analysis doesn't understand their music — and they're right.

**Direction:** honor the user's genre label as the binding hint; suppress genre-relative rules when detection confidence is low, tempo is octave-ambiguous, or the measured value is absent (BPM 0 is missing data, not a tempo); don't emit "vs {profile}" language while only one profile exists.

---

### F3 — "Added" fixes live in four stores that visibly diverge (and one write 500s silently) 🔴 Critical
**Journey:** 5→6 (the retention loop) · new finding
**Evidence:** S05 · `ReportView.tsx:112-123, 193-196` · `listen-rack/listenFixes.ts:58-74` · console: `POST /api/verdicts/vrd_01KY…/applied → 500`

A fix's "in my plan" state is held in four places: the server `applied` marker, the in-memory `committedIds` set (one-shot seeded at `ReportView.tsx:117-123`, racing the async verdicts fetch), the card's `move.status`, and a per-version **localStorage** copy for the Listen page. Watched live: clicking "+ Add" fired a **500** on the `/applied` persist with **no toast** while the rail optimistically updated; after reload, the card showed **"✓ Added"** while the rail showed **"Fixes for Listen 0"** and "Open in Listen" was disabled again. The chat's grounding footer also drifted between loads of the same immutable report ("6 verdicts" → "5 verdicts" — the flash-of-zero shape already noted in `PRPs/deferred-work.md`).

**Why it matters:** the plan is the bridge from *reading* the report to *acting* on it. A plan that forgets, half-remembers, or disagrees with its own cards kills the loop the product is built around.

**Direction:** one derived source of truth for "in plan" (server applied state), hydrating card, rail, and Listen; error toast + rollback when the persist fails.

---

### F4 — "Open in Listen — *try the fixes*" delivers a page where the fix is neither visible nor applied 🔴 Critical
**Journey:** 5→6 · verifies + extends candidate #6
**Evidence:** S06 · live check: rack "1 on" → checking the Plan checkbox → "2 on"

The button promises audible fixes. What actually happens: you land on the Listen rack with the right rail on the **Coach** tab; the carried fix sits **unchecked** inside the not-yet-opened **Plan** tab ("Check a fix to apply it to the rack"); nothing sounds different — verified by the rack module count only incrementing when I manually checked the box. The handoff also survives only in navigation state (no `?fixPreset=` in the URL), so a refresh on arrival loses it. Compounding candidate #6: the report rail's copy says "**Check** fixes in the plan" while the report affordance is "**+ Add**" — the checking happens later, on a different page, in a tab you haven't found.

**Why it matters:** this is the single most magical moment the product owns — *hear your mix with the fix applied*. Right now the reveal fizzles into a scavenger hunt.

**Direction:** arriving via "try the fixes" should open the Plan tab with carried fixes **pre-checked** (A/B bypass is already there for honest comparison) — or the button should stop promising "try."

---

### F5 — "Analysis complete" modal replays over old reports in every new session 🟠 High
**Journey:** 3, 5 · verifies candidate #2, root cause found
**Evidence:** S03 · `ReportView.tsx:198-206`

The once-per-job marker is stored in **sessionStorage** (`analysisModalSeen:{jobId}`), so "once per job" is really "once per job *per browser session*." Deep-linking any report — including 3-week-old ones — in a fresh session replays the completion ceremony, complete with "AI Analysis — runs when you open the full report" copy shown *on top of the open full report*. Same-tab reload correctly stays dismissed (observed both ways).

**Direction:** persist the seen-marker per job (localStorage or server), or only auto-open on a live progress→complete transition within the session.

---

### F6 — Scores are absent or contradictory everywhere outside the report itself 🟠 High
**Journey:** 4 + Reports · verifies candidate #1, root cause found
**Evidence:** S02, S07 · `routes/_app/songs.$songId.tsx:76-85` · `ui/ProgressTimeline.tsx:32-34, 164`

One song page shows three disagreeing renderings: header pill **"grade F"**, timeline **"No scored versions yet"** (on an axis A…D that can't even display an F), and **"—"** in every version row. Cause: only the latest version is given `latestResult.grade`; per-version scores were never plumbed (the code comments say so), and even the latest `score` arrives null — grade without score. The Reports page magnifies it: **146 rows for ~43 versions**, most versions appearing **twice for the same date** (one graded, one "—" twin), Score column "—" on every row, six pages deep. Library cards carry no outcome signal at all.

**Why it matters:** "is my mix getting better?" is the product's second promise (ProgressTimeline, CompareDialog, VersionArc all exist for it) — and the data to answer it is visibly missing or self-contradictory.

**Direction:** plumb per-version score+grade into the versions and reports DTOs; collapse rerun/partial twins into one row per version; put the grade on the library card.

---

### F7 — Older versions' reports are unreachable from the song page 🟠 High
**Journey:** 4 · verifies candidate #5
**Evidence:** S02 (v5–v1 rows: 6 actions each, no report link)

Only the *current* version row has "Report ↗." The other versions — all analyzed — offer Listen / Make current / Edit label / Reanalyze / Reference / Delete, but no path to the report that exists for them. The only fallback is the 146-row Reports table (F6). "How did v3 score before I changed the drop?" — the question the version system exists to answer — takes a filter expedition.

**Direction:** every analyzed version row links to its latest report (each version knows its jobId — the Reports page proves the data exists).

---

### F8 — Login can bounce a successful sign-in back to the login form 🟠 High
**Journey:** 2 · verifies candidate #8; the real login shares the shape
**Evidence:** reproduced first-try (dev sign-in → `/login?next=%2Flibrary`, no self-recovery after 3s; second click succeeds) · `routes/_public/login.tsx:33-35, 47-49`

`await login(...)` → `navigate('/library')` races the auth-guard's read of auth state; when the guard wins, the user is bounced to `/login?next=…` with empty fields and **no error** — a successful login that looks exactly like a failed one. The dev button and the real submit handler share the identical navigate-after-await shape, so this is not dev-only in principle.

**Why it matters:** it's the front door. A user who "fails" to log in with correct credentials re-types them, doubts their password, or leaves.

**Direction:** navigate only after the auth state is committed to router context (invalidate + await), or let the guard treat an in-flight login like the silent-refresh boot (it already short-circuits during `isLoading`).

---

### F9 — Report header claims inputs that were never uploaded ("✓ Stems ✓ Ableton project ✓ Reference") 🟠 High
**Journey:** 5 · new finding
**Evidence:** S08, S09 (fresh mix-only upload showing all four ✓) · `ReportView.tsx:100-110`

The chip logic falls back to phase-output truthiness: `stems: … || Boolean(phase4?.stems)`, `als: … || Boolean(phase8)`, `reference: … || Boolean(phase6?.gaps)`. The pipeline always emits those objects (even as "skipped"), so **every analysis shows all four ✓** — directly contradicting the modal's correct "Song · 1/4 sources" and the coach's "no stems and no reference were uploaded." Two knock-ons: the "+ Add stems/.als/reference" upsell chips (story 12.5's entry points) can never render, and phase 4's "Stem clash — 2 clashes found" on a stem-less upload deepens the "what did it actually analyze?" confusion.

**Direction:** derive presence from version files/DTO only; a phase's output object is not evidence of an input. Label the mix-only clash analysis for what it is (spectral clash on the master).

---

### F10 — Pro users see the monthly coach pool labeled "· this analysis" 🟡 Medium
**Journey:** 5, 8 · verifies candidate #10, upgraded from grammar nit to wrong data
**Evidence:** S08 (fresh analysis, zero questions asked, chip reads "2 of 300 follow-ups · this analysis") · `CoachCapChip.tsx:3-9, 32` · `CoachChat.tsx:188-190, 610`

The account is Pro → caps are pooled **monthly** (the "2" is account-level usage this month). The chip hardcodes the story-1.9 free-tier grammar — its own comment says "Story 2.6 will widen this," and `CoachCapsDto.Scope` (analysis/month/unlimited) already exists server-side but is never read. On a pristine analysis the user is told they've used 2 follow-ups *on this analysis*.

**Direction:** render the scope-aware FR15 grammar from `Scope` + `ResetsAt` — "2 of 300 this month · resets Aug 1."

---

### F11 — Claimed anon reports don't land in the library 🟡 Medium
**Journey:** 1 (conversion) · verifies candidate #7 (documented seam, `PRPs/deferred-work.md`)
**Evidence:** journeys doc + deferred-work record; anon jobs are song-less by design (`AnalysisJob { DeviceId, FilePath }`)

The claim moment is the whole point of the funnel: "create an account to **keep this report**." The account is created, the device is claimed server-side… and the report is absent from the library grid (song-less), reachable only via the `/analyze` resume card or the raw job URL. The first thing a fresh convert sees is an empty-ish library that appears to have lost the thing they signed up to keep.

**Direction:** materialize a song shell at claim time (name from the uploaded filename, "claimed" badge) so the artifact lands where the user will look for it.

---

### F12 — Anon funnel papercuts (the funnel itself is excellent) 🟡 Medium
**Journey:** 1 · new findings
**Evidence:** S10, S11, S12

The core funnel is the best surface in the product: landing → `/analyze` → file → report is 2 clicks + a picker; the inline "Keep this report" card (email+password+Not now, trust links, no redirect) is exactly right. Three papercuts on the money path:

1. **"Get yours free →" goes to `/register`** — a signup wall directly beneath "no account needed for the first one," while the sibling hero CTA goes to `/analyze`. Point both at `/analyze`.
2. **Pricing's Free card shows "Current plan" (disabled) to signed-out visitors** — the free tier has *no actionable CTA* for the audience the page most needs to convert. Anon state should read "Start free → /analyze."
3. **The first thing every anon user sees is a big F** (58/100 here; the landing sample is also an F at 42/100) with no scale, no banding legend, no "here's what F→A takes." Honest grading is the brand — but honesty without orientation reads as abuse. Show the banding (the timeline's A–D bands exist; note they omit F entirely) and frame the path upward.

---

### F13 — New-song entry: two dialogs, the genre question asked twice in two vocabularies 🟡 Medium
**Journey:** 3 · new finding
**Evidence:** walkthrough of "+ New song" → NewSongDialog → auto-opened UnifiedUploadDialog; the two `v0 · no versions yet` shells in the live library

- "+ New song" opens a **metadata** dialog first — including a 9-template × 28-color cosmetic picker rendered *above* the name field, for a song that has no audio yet — then a second (upload) dialog. The library already contains two abandoned v0 shells ("444444", "44444"): real evidence of drop-off between dialog 1 and dialog 2.
- **Genre is asked twice with two different vocabularies**: free text + suggestion chips ("Trance", "Techno"…) in NewSongDialog, then a 23-option fixed select in the upload dialog. This split is where the "trance"/"Trance"/"other" label drift (F2's user-visible face) is born.
- The shell's **"+ Upload" button links to `/library`** — on the library it does nothing visible. A button labeled Upload should open the upload dialog.

**Direction:** one dialog — name + mix drop on the first screen, cosmetics collapsed/deferred, genre asked once with one vocabulary; wire "+ Upload" to the UnifiedUploadDialog.

---

### F14 — Interaction density: whole-card buttons wrapping 8 targets; 6 actions per version row 🟡 Medium
**Journey:** 4 · verifies candidate #9
**Evidence:** S01, S02 · library card a11y tree (a `button` containing play, title link, ⋮ menu, version rows, "Analysis Results" — nested interactive elements)

Every library card is one big button *containing* ~8 other interactive targets (an a11y violation and a misclick machine); every version row exposes 6 always-visible actions (36 controls in a 6-version list) where one action is 95% of the traffic (Listen/Report) and one is destructive (Delete) sitting on the same row.

**Direction:** card = one primary action + ⋮ overflow; version row = Listen + Report visible, the rest in the row menu (Delete behind it — the delete *confirm* dialog itself is already excellent).

---

### F15 — Copy & micro-trust sweep 🟢 Low (cheap, worth batching)
**Journeys:** all · new findings, individually small, collectively "the product isn't quite finished"

- The fix pipeline carries **six names** across its journey: "Recommended fixes" → "See fix in **Actions** →" (a section that exists under no such name) → "Fixes for Listen" → Listen "**Plan**" tab → "**Game Plan**" export → "**Fix Rack**"/"Coach Mix." Pick one noun for the plan and one for the export.
- Pluralization/grammar: "Your plan · **1 fixes**," "all **1 version**," "Specialist Team **0 run**," suggestion chips with raw slugs ("What did you find about **harmonic**?").
- Duration disagrees across surfaces: report header **7:37** vs Listen transport **7:36** (rounding vs floor).
- "You're above the pack — you land in the **50th percentile**" — identical canned text on both audited tracks, and the 50th percentile *is* the pack. Percentile praise must be computed and phrased honestly.
- Coach intro overclaims: "I've seen … every specialist verdict, and how it compares to your genre's reference profile" on runs with zero specialists and no reference.
- Listen rail chip "**KNOWS THIS TRACK · 14/26 RUN**" — internal counters leaking into UI with no explanation.
- Notifications: "1 person bookmarked your track today" — twice, 8 minutes apart, with **no track name** and per-day aggregation grammar that isn't aggregating.
- Completion modal shows "Grade …" (a literal ellipsis) for the still-computing arrangement phase; say "computing" or hide the row.
- Dev-console health: every upload logs a guaranteed `POST /api/uploads/init → 501` (presigned path in local mode) and the Listen page logs a TanStack "Query data cannot be undefined" on `[versions,…,rack,draft]` — not user-visible, but they mask real errors like F3's 500.

---

## What's working — protect these

- **The anon funnel** (J1): landing promise → one-button `/analyze` → report → blur + inline claim card is a model conversion path. "Already computed, yours to keep" is honest persuasion. Don't add a single field to it.
- **Waiting states** (J3/J5): live phase list with elapsed clock, a stable resumable URL, worker-health banner, stale-job reaper, deferred-arrangement backfill — the "can I leave and come back?" story is genuinely solid. (The one hole: what fills in later can contradict what was shown — see F1/F6.)
- **Progressive disclosure in the unified upload**: mix required, .als "Recommended" with a real value pitch, stems tucked behind "Advanced."
- **Destructive-action hygiene**: the delete confirm names the object, states the blast radius, and offers Archive as the softer path.
- **Claim-moment trust links** (no-training / results-forever) placed exactly where the skeptical user hesitates.

---

## Fix these first (top 5)

| # | Fix | Why first | Anchor |
|---|-----|-----------|--------|
| 1 | **One severity scale, one deduped findings source** rendered by every surface (modal, tabs, fix list, chat) | The core deliverable currently argues with itself; every user sees it on every report | F1 |
| 2 | **Stop genre-rule nonsense at the source**: honor the user's genre label, suppress genre-relative rules on low-confidence/absent measurements (BPM 0!), stop shipping a genre map where everything is `modern_trance` | Produces the most visibly absurd cards in the product | F2 |
| 3 | **Make the report→Listen handoff real**: single source of truth for "in plan" (server state), surfaced errors, and "Open in Listen" arriving with fixes pre-checked on the Plan tab | This is the retention loop and the product's magic moment | F3 + F4 |
| 4 | **Plumb per-version score/grade** into song page, timeline, library card, and a deduped Reports table; give every version row its "Report ↗" | Restores the "am I improving?" promise and unblocks navigation to history | F6 + F7 |
| 5 | **Persist the completion-modal seen-marker per job** (not per session) | Cheapest fix on the list; currently every returning session replays a false ceremony over old reports | F5 |

Close behind: the login bounce (F8) — small fix, front-door trust; and the false "✓" input chips (F9) — one `useMemo` rewrite that also un-hides the add-input upsell.

---

## Appendix A — Screenshot index

| Ref | File | Shows |
|---|---|---|
| S01 | `01-library-grid.png` | Library grid, card density, mixed-case genre chips |
| S02 | `02-song-detail-grade-contradiction.png` | grade F header vs "No scored versions yet" vs "—" rows; report link only on current |
| S03 | `03-analysis-complete-modal-on-deeplink.png` | Completion modal replayed over an existing report; "other" genre; crossed severities |
| S04 | `04-report-coach-tab-fixlist.png` | Full fix list with duplicate true-peak/clipping/width pairs |
| S05 | `05-added-fix-vs-empty-rail-after-reload.png` | "✓ Added" card vs "Fixes for Listen 0" after reload |
| S06 | `06-listen-rack-plan-checked.png` | Listen rack; Plan tab; fix only applies when manually checked |
| S07 | `07-reports-duplicate-rows-empty-scores.png` | 146 reports, twin rows per version, Score column all "—" |
| S08 | `08-fresh-complete-modal-8s-track.png` | Fresh mix-only run: 1/4 sources vs ✓×4, BPM 0 rule, 44% vs 19% mono |
| S09 | `09-fresh-report-false-input-chips.png` | "Analyzed from ✓ Stems ✓ Ableton project ✓ Reference" on a mix-only upload |
| S10 | `10-anon-landing.png` | Landing; "Get yours free →" → /register inconsistency |
| S11 | `11-anon-report-blur-claim.png` | Anon report: F hero, blur, claim CTA |
| S12 | `12-anon-claim-inline-register.png` | Inline "Keep this report" register card |

## Appendix B — Candidate verification matrix

| Journeys-doc candidate | Verdict |
|---|---|
| 1. Score display inconsistency on song detail | **Confirmed**, root cause found (F6) |
| 2. Complete-modal over old reports on deep-link | **Confirmed**, sessionStorage root cause (F5) |
| 3. Duplicate/conflicting findings | **Confirmed + worse**: crossed severities, 3 vocabularies (F1) |
| 4. Genre seams (Trance vs "other", BPM octave) | **Confirmed + root cause**: all-profiles→modern_trance (F2) |
| 5. Report link only on current version | **Confirmed** (F7) |
| 6. "Open in Listen" gating / round-trip | **Confirmed + worse**: fixes arrive unapplied (F4) |
| 7. Anon claim outside library | **Verified as documented** (F11, per PRPs/deferred-work.md) |
| 8. Dev sign-in auth race | **Reproduced**; real login shares the shape (F8) |
| 9. Card/action density | **Confirmed**, incl. nested-interactive a11y issue (F14) |
| 10. Follow-up meter cap grammar | **Upgraded**: wrong scope label for Pro pooled cap (F10) |

New findings this audit: F3 (four-store plan state + silent 500), F9 (false input chips), F12 (funnel papercuts), F13 (two-dialog entry + double genre question), F15 (copy sweep).
