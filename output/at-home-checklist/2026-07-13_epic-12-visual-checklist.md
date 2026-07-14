# At-Home Visual Checklist — Epic 12 (compiled 2026-07-13)

Everything below shipped and passed headless gates + the Playwright smoke; these are
the visual/audible confirmations that need human eyes and ears. Boot the stack with
`scripts/start-spectr.ps1` (12-3 fixed the launcher preflight).

## Carryover (12-2, 12-3)

- [ ] 12-2: Full windowed stack boot via launcher — all services come up, boot summary readable.
- [ ] 12-2: ProgressStoryline live render during a real analysis — phases tick, current phase highlighted, elapsed clock runs.
- [ ] 12-2: DevHealthDot in the header — green with stack up; kill the worker and confirm it flips + the storyline shows the offline hint.
- [ ] 12-3: MinIO-down E2E — stop MinIO, upload: expect the 503 storage_unreachable toast + proxy fallback path, not a silent hang.

## 12-4 — Fix Rack → Listen carry-over

- [ ] From a report's Fix Rack panel, click "Open in Listen rack": carried chain applies once the graph is ready, audibly changes playback.
- [ ] "Fixes applied: N — reset" chip appears in ALL rack modes (not just work-mode PLAN tab); reset clears it and restores the manual rack.
- [ ] Manual knob tweaks made before carry-over survive it; pitch mode is not reset.
- [ ] Unmapped ops (multiband compressor, sidechain) show as disabled "not applicable" rows.
- [ ] Refresh and browser-back on the Listen rack URL: carried state survives.

## 12-5 — Dead-UI sweep

- [ ] Overall "nothing looks dead" pass: no global search box, no disabled Listen nav tab, no ⌘K ghost.
- [ ] Coach unlock chips route somewhere real (pricing page / upload dialogs), no stale "coming with Epic 2" toasts.
- [ ] ReferenceTab with no reference attached: honest empty state, no fabricated percentile.
- [ ] Debug tab absent in a prod-mode build (dev-only).
- [ ] ProjectUnlock shows a real .als upload CTA.

## 12-6 — Fix Rack relabel

- [ ] Every former "Coach Mix" surface (results tab, modal, rack sidebar) reads "Fix Rack"; no leftover "Why these settings — soon" placeholder.
- [ ] A refused coach turn (e.g. off-topic) does not consume a message from the cap chip.

## 12-8 — First-run experience

- [ ] Register a fresh account: "Demo: Sample Report" card is in the library immediately, description clearly says it's sample data.
- [ ] Open the demo report: full report renders (grade F showcase), audio plays (it's a plain tone — expected), Listen page scrubbing works.
- [ ] Account menu → "Report a problem": mail client opens with prefilled subject/body (page URL, job id when on a results page, app/mode + time lines, proper line breaks).
- [ ] On a running analysis: "How analysis works" expandable under the progress storyline lists the 7 phases + the .als 8th-phase note.
- [ ] Subjective: does the first session feel trustworthy before your own first analysis lands?

## CI (check from any browser)

- [ ] All lanes green on master `d1f41e0`+ — including the deploy lane (BFF image on azurelinux, web image on caddy:2.11).

## 11-12 — Fork-to-suggest & suggestion audition (added 2026-07-14)

Needs TWO browser sessions (or one + an incognito reviewer) on a shared/View-able version.

- [ ] View mode, non-owner: rack shows "READ-ONLY · FORK TO SUGGEST" badge button; comments tab shows the "Fork the rack & suggest a chain" button.
- [ ] Click fork: rack knobs become live and AUDIBLE while playing; suggest chip appears with Submit/Discard/A-B; paused shows "press play to hear your draft".
- [ ] A/B toggle: flip to ORIGINAL — audibly reverts, rack blocked with "ORIGINAL (A)" badge; flip back — draft returns exactly.
- [ ] Switch bottom view to VISUALS/STEMS while forked: chip stays visible.
- [ ] Submit: success toast, rack restores to pre-fork sound, suggestion card appears under "Suggested fixes".
- [ ] Discard: pre-fork sound restored exactly (incl. any modules you disabled during the draft).
- [ ] As OWNER: suggestion card shows "show moves (n)" expander — readable moves match what the reviewer did; Audition plays the suggested chain, Revert restores yours; Accept → preset "From @handle" appears in preset list.
- [ ] Owner audition then mode-switch away: your rack is back to normal (audition auto-reverted), and your saved draft was NOT overwritten.
- [ ] Anon share page /v/{token}: no "suggestions open" pill anywhere.

## 6-1 — Landing & pricing pages (added 2026-07-14)

- [ ] Anonymous visit to /: landing renders — hero, "Analyze my track free" CTA, sample report (F grade, framed as "rough mix on purpose"), honesty strip. Feel check: does the F-grade framing land right or scare?
- [ ] Logged in, visit /: bounces to /library (brief landing flash acceptable).
- [ ] Logged in, open /pricing via a coach upgrade chip: chrome shows "Open library", NOT Sign in/Analyze free.
- [ ] Lighthouse on / (incognito): LCP < 2.5 s.
- [ ] Pricing page: tax note visible, terms under the buttons, no asterisks anywhere.
- [ ] Post-deploy: curl -A discordbot https://<domain>/ and /pricing → meta shell (og:image present); plain curl → SPA. robots.txt parses.

## 6-2 — Trust pages (added 2026-07-14)

- [ ] BLOCKING before public launch: read all three trust pages (/trust/no-training, /trust/results-forever, /trust/privacy) as the founder — approve or edit the copy, then remove the DRAFT markers AND update the matching BFF shell strings (PublicSiteEndpoints.cs). Cross-ref launch checklist "Security & privacy".
- [ ] Visual pass: three pages render clean, cross-links + chrome work, register form shows the trust line, landing/pricing footers link them.
- [ ] /trust (no page) redirects to the pledge.

## 6-3 — Anonymous instant analysis (added 2026-07-14)

- [ ] Incognito, /analyze: drop a real track — the whole funnel FEELS instant and honest (drop zone → phase dots + rotating explainers → graded report).
- [ ] Report: grade hero + #1 finding + streaming readiness readable; the blur makes you WANT the account without feeling hostage-y.
- [ ] Claim moment: inline register over the visible report; after claim the banner reads right ("verification gates your NEXT analysis").
- [ ] Refresh mid-analysis and mid-report: state restores from the device cookie.
- [ ] Second upload while one is running: honest "one at a time" message.
- [ ] Landing + chrome "Analyze free" CTAs now land on /analyze.
