---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
inputDocuments:
  - 'PRPs/prd.md'
  - 'PRPs/product-brief-spectr-2026-06-12.md'
  - 'PRPs/research/market-spectr-ai-music-analyzer-2026-06-12.md'
  - 'components/frontend-spectr-v2/src/styles/tokens.css (restructure branch)'
  - 'components/frontend-spectr-v2/requirements/UI_FIDELITY_GAP.md (restructure branch — 63-item audit vs mockups)'
  - 'components/frontend-spectr-v2/requirements/claude-design-ui-files/* (canonical mockups: app/library/results/coach/profile/listen/discover/compare)'
---

# UX Design Specification — Spectr

**Author:** Brian Rankin
**Date:** 2026-06-12

---

<!-- UX design content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

### Project Vision

Spectr is an AI mixing coach for electronic music producers: upload a track (plus optional stems/reference/.als), get an explained, genre-native diagnosis with validated verdicts, an interrogable coach, and version-over-version progress tracking. UX mission for this revamp: **make a working analysis engine feel like a product worth $12.99/mo** — which means (a) finishing the already-designed product surfaces to mockup fidelity, (b) designing the commerce/funnel surfaces that don't exist yet, and (c) making trust visible at every money-adjacent moment.

Critical UX context: this is NOT a blank-canvas design project. The repo ships a complete, distinctive design language (canonical mockups in `components/frontend-spectr-v2/requirements/claude-design-ui-files/` — app shell, library, results with 5-tab structure, coach with TranceBot avatar, profile, listen, discover, compare) plus a 63-item severity-rated fidelity audit (`UI_FIDELITY_GAP.md`) with phasing A–D. This specification adopts those mockups as canonical, resolves the audit's open decisions, and extends the system to the surfaces the mockups never covered: landing/pricing/trust funnel, anonymous free-analyzer flow, cap-hit/upgrade moments, usage & billing, public share page, and affiliate dashboard.

### Target Users

- **Dario — ambitious bedroom producer (primary):** desktop, sits next to Ableton, 18–34, fluent in producer vocabulary (LUFS, sidechain, mud) but not engineering theory. Arrives skeptical of "AI slop"; converts on specificity ("YOUR 65 Hz, YOUR 'SUB-DEEP' track"). Uses the product in evening sessions; wants triage, not homework.
- **Maya — DJ-producer (primary, episodic):** outcome-driven; club translation checks before gigs; buys credits; allergic to subscription dark patterns; mobile-opens share links, desktop-runs analyses.
- **Share-link recipients (secondary):** zero context, often mobile, Discord-referred; the share page must explain itself in 5 seconds and sell quietly.
- **Marco — educator/affiliate (secondary):** needs screenshot-friendly, presenter-readable screens; his videos are the de facto ad campaign.
- **Brian — operator (internal):** composite dashboards acceptable; clarity over polish.

### Key Design Challenges

1. **Depth without overwhelm:** 8 analysis phases × 27 specialists × charts = data dump risk. The mockup's answer — Verdict Hero + AI-Coach-first tabs — prioritizes "what do I do" over "here's everything we measured." Preserve that hierarchy in every new surface.
2. **Anonymous-to-paid funnel grafting:** free analyzer must deliver the full aha (real report, real verdict) while gating depth honestly — paywalls that feel like invitations, not tricks (billing distrust is the category wound).
3. **Caps that don't feel punitive:** analysis caps, coach message caps, credit balances — all must be visible-before-hit, explained, and never lose user work.
4. **Grounded-AI trust theater:** validator/grounding is a backend fact; UX must make it *legible* (evidence chips citing measured values, "grounded in your analysis" affordances, graceful refusals) without jargon.
5. **Two-audience report:** the same report serves the owner (full depth) and share recipients (curated subset) — one design, two permission states.

### Design Opportunities

1. **The iteration story as identity:** VersionArc sparklines, ProgressTimeline, grade-colored dots — no competitor visualizes producer growth. Lean in everywhere (library cards, song hero, even the upgrade screen can show "your climb so far").
2. **TranceBot as brand:** signature AI character with animated EQ visor — memorable, screenshot-bait for affiliate videos, and a vehicle for honest microcopy ("I don't have stem data for this one").
3. **Trust as visible design:** pricing page with no asterisks, cancel-in-two-clicks, "your reports stay yours forever" stated at the paywall itself — convert the category's wound into conversion fuel.
4. **Atmospheric data aesthetics:** the established language (dark studio, cyan/violet glows, mono numerals, grid overlay, 88px ghost numerals) makes dense data feel like studio gear, not admin panels — extend it to funnel pages so marketing and product feel like one object.

## Core User Experience

### Defining Experience

**Upload → "it heard MY track" in under 3 minutes.** The defining loop: drop a bounce, watch the pipeline run (animated phase dots — anticipation builds), land on a Verdict Hero that names the grade, the verdict ("Almost there"), and a #1 finding that cites the user's own numbers and (with .als) their own track names. Then the second-order defining experience: ask the coach a follow-up and get an answer grounded in the same data. Everything else (library, versions, share) orbits this loop.

### Platform Strategy

Desktop-first web app (producers sit at DAW machines); responsive funnel/report/share for mobile share-link traffic; Listen DSP desktop-only with polite mobile notice. No native apps. Web Audio API load-bearing on Listen + report playback (Safari unlock-on-gesture handled). SPA (existing TanStack stack) for product; prerendered static funnel pages + server-rendered share OG cards for SEO/unfurls.

### Effortless Interactions

- Drag-drop anywhere on upload surfaces; paste-file support; one primary CTA per screen.
- Free analyzer: zero fields before first analysis (no email, no card) — file in, progress on, report out.
- Coach: one-tap suggestion chips before free-typing; Enter to send.
- Cap awareness: passive meters (2 of 3 left) in nav/usage — never a surprise modal.
- Share: one click copies link; revoke equally visible.
- Re-analyze new version: from any report or song page, one CTA, pre-filled song association.

### Critical Success Moments

1. **First verdict readable in <3 min** — failure here kills the funnel (PRD: TTFI p90 <3 min).
2. **First .als-attributed verdict** — "names MY track" = conversion trigger; design must spotlight the track-name chip.
3. **Cap-hit → upgrade screen** — the money moment; must show value recap (your reports, your climb) + honest terms + price, nothing else.
4. **First coach refusal** — "I don't have stem data for this analysis" rendered as competence, not failure (explains how to unlock).
5. **Version 2 beats version 1** — delta callout (+6 pts) celebrated (subtle glow, not confetti) — retention moment.
6. **Share link opened by stranger** — 5-second comprehension: what this is, how good the track is, how to get one.

### Experience Principles

1. **Coach, never robot:** every output explains why and what next; tone = knowledgeable studio friend, brutal-honest about issues, never about the person.
2. **Evidence before opinion:** numbers user can verify (their LUFS, their Hz) precede every judgment; UI surfaces the citation (metric chips), not just the conclusion.
3. **Triage over inventory:** default views show ranked top issues; full data one tab away, never the landing state.
4. **Honesty is a UI pattern:** caps visible before hit, prices tax-inclusive where required, cancel path ≤2 clicks, refusals > hallucinations, "results forever" stated where money changes hands.
5. **The studio aesthetic is load-bearing:** dark, atmospheric, mono-numeric, glowing accents — every new surface (even pricing) uses the same tokens so the product feels like one instrument.
6. **Respect the session:** producers visit mid-flow; never trap them (no forced tours, dismissible everything, state preserved on navigation).

## Desired Emotional Response

### Primary Emotional Goals

- **Heard** ("it actually listened to MY mix") — specificity is the mechanism.
- **Competent-by-proxy** ("now I know what to do") — every issue paired with an executable fix.
- **Momentum** ("I'm getting better") — version deltas, climbing arcs, percentile movement.
- **Safe** ("no one's laughing, nothing's being stolen, billing won't burn me") — privacy defaults, no-training pledge, honest commerce.

### Emotional Journey Mapping

- Landing: skeptical curiosity → intrigued ("show me on MY track" CTA, real sample report).
- Upload/progress: anticipation (animated pipeline dots; phase names readable, not spinner-void).
- First report: surprise → trust (own numbers cited) → focus (one #1 finding spotlighted).
- Cap hit: mild friction → respected (value recap + honest terms; never mid-action loss — finish rendering the report THEN gate the next one).
- Payment: confidence (terms restated at button: "$12.99/mo · cancel anytime · reports stay yours").
- Failure states: reassurance (partial report + free retry framed as "we kept everything that worked").
- Version improvement: quiet pride (delta glow, arc extends upward).

### Micro-Emotions

- Pipeline dots pulsing = "it's working hard for me" (vs dead progress bar dread).
- TranceBot visor animating while "thinking" = presence without anthropomorphic cringe.
- Verdict severity colors warm (orange/red) but never alarm-red full-screen — issues are fixable, not fatal.
- Mono tabular numerals everywhere = precision signal (producers respect meters).
- Ghost 88px finding numerals = "track listing" familiarity, gravitas.
- Hover glows (cyan-dim) = responsive instrument feel.

### Design Implications

Specificity-first layouts (metric chips before prose); celebratory-but-subtle delta states (no gamification noise); refusal microcopy pre-written for every coach gap (stems missing, reference failed, budget exhausted); paywall screens carry trust copy inline; error surfaces always pair "what failed" with "what survived + free retry."

### Emotional Design Principles

1. Precision earns warmth: numbers first, encouragement second.
2. Friction only at honest gates, never inside the aha loop.
3. Failure is partial, recovery is free, tone is calm.
4. Progress is the producer's, the tool just reveals it (coach voice: "your low end tightened" not "we fixed it").

## UX Pattern Analysis & Inspiration

### Inspiring Products Analysis

- **Linear:** keyboard-fast, dense-but-calm dark UI, opinionated defaults — model for triage-over-inventory and quality bar for dark themes.
- **Splice:** producer-native commerce (credits, rent-to-own, keep-what-you-paid) — model for honest entitlement UX and the usage page's "credits vs Pro math."
- **Ableton Live itself:** flat, functional, mono-labeled, zero skeuomorph kitsch — users' home turf; our pills/labels/mono pattern already rhymes with it.
- **GitHub Copilot/Cursor chat:** grounded-AI affordances (citations, context chips) — model for coach evidence chips and scope disclaimers.
- **Strava:** progress visualization as retention (arcs, PRs, deltas) — model for VersionArc/ProgressTimeline emotional framing.
- **Stripe Checkout:** the trust gold standard at payment moments — adopt its restraint (single column, terms at button, no upsell noise).

### Transferable UX Patterns

- Tabbed report with badge counts (Results mockup already does this) ← Linear issue views.
- Suggestion chips above chat input ← every good AI chat; ours are analysis-derived, not generic.
- Sticky compare rail (DeltaCard) ← e-commerce compare drawers.
- Usage meter in account menu ← API dashboards (Vercel/OpenAI) — passive consumption awareness.
- "Continue where you left off" report deep links in email ← Figma/Notion notification patterns.
- Inline upgrade prompts at feature-touch (locked stem tab shows blurred preview + unlock copy) ← Figma's view-only → edit upsell.

### Anti-Patterns to Avoid

- **Black-box score with no why** (the LANDR complaint) — never show a number without an inspectable basis.
- **Surprise paywalls mid-action** (the eMastered rage) — gates only between actions, never during; work never lost.
- **Annual-disguised-as-monthly pricing** — price shown = price charged, billing period explicit at the button.
- **Confetti gamification** — producers are pros-in-training; celebrate with glow + delta, not badges/streaks.
- **Chatbot-as-homepage** — coach is anchored to the report context, never a floating generic assistant bubble.
- **Admin-panel flatness** (the fidelity audit's core critique of current build) — tokens without the atmospheric layer read as generic; ship the glows/grid/fonts.
- **Dark-pattern cancellation** — cancel lives in Billing, two clicks, no retention interrogation beyond one optional reason field.

### Design Inspiration Strategy

Adopt the in-repo mockups as the design north star (they already encode the right inspirations); borrow commerce honesty from Splice/Stripe for the new surfaces; borrow grounded-AI affordances from code-assistant chat UIs for coach evidence; borrow progress-emotion from Strava for version surfaces. No new visual exploration needed — the brand exists; the work is fidelity + extension.

## Design System Foundation

**Decision: custom in-repo design system ("SPECTR DS") — tokens + global utility primitives + CSS Modules — already established. No third-party component library adoption.**

### Rationale for Selection

- System exists and is good: `tokens.css` palette/radii/spacing/severity/grade tokens match canonical mockups bit-for-bit (fidelity audit: "colors and radii are bit-for-bit"). Replacing with MUI/shadcn would destroy the distinctive studio identity and waste built equity.
- Radix primitives already in deps for behavior-heavy components (dialog, dropdown, tabs, tooltip, slider) — keep: unstyled a11y behavior + SPECTR skin = best of both.
- CSS Modules + a small global utility layer (`.card .pill .btn .label .dot` + keyframes) is the mockup's own architecture; audit flags porting these eight utilities as the missing keystone.

### Implementation Approach

1. Execute fidelity-audit Phase A verbatim (load Syne + JetBrains Mono — self-host in `public/fonts/` for GDPR-clean, no Google CDN; port keyframes `fadeUp fadeIn fillW fillH pulse pulseGlow`; port the 8 utility classes; build `GradePill`, `Pill`, brand-mark components).
2. All NEW surfaces (funnel, billing, share, affiliate) consume the same tokens + utilities from day one — no parallel styling system.
3. Add the missing spacing step `--space-4-5: 18px` (audit medium) + alias verdict severity names (`warning↔severe`, `info↔minor`, `fixed↔win`) in tokens.
4. Component inventory lives in code (no Storybook for MVP — solo dev; a `/dev/kitchen-sink` route behind flag is sufficient visual regression aid).

### Customization Strategy

- Tokens are the single theming source; light mode explicitly deferred (tokens.css comment confirms) — do not half-build it.
- New token groups needed for commerce surfaces: `--tier-free / --tier-pro (cyan) / --tier-credits (violet)` chip colors; `--paywall-overlay` (blurred card scrim); reuse existing severity tokens for dunning states (warn=yellow, fail=red).
- Email templates: HTML email cannot use the app's fonts/effects — design a reduced "SPECTR mono-light" email kit (dark header band, mono accents, system fonts) consistent in spirit, not in tokens.

## Defining Experience Deep-Dive: the Coach Loop

The product's defining interaction — specified end-to-end:

1. **Entry:** Report opens on AI Coach tab (default, pulsing cyan dot). CoachChat card top: TranceBot avatar (72px, EQ visor idle-pulsing), overline `ASK THE COACH · online · trained on your analysis`, headline "Ask anything about this mix," 6 suggestion chips derived from this report's verdict categories (not generic), input bar with `Ask →`.
2. **Grounding visible:** beneath input, dim mono scope line: "Answers grounded in analysis #{shortid} · {n} measurements · {m} verdicts". Each coach answer renders **evidence chips** (e.g. `LUFS −11.2`, `SUB-DEEP 65 Hz`) — tappable, scrolls to the relevant report panel.
3. **Caps:** chip in card header: `3 follow-ups left` (free) / `42 this month` (Pro). At 1 remaining, chip turns amber. At 0: input swaps to inline gate — "Follow-ups used for this analysis · Pro = pooled monthly coach access" + secondary "or buy credits"; conversation history stays readable.
4. **Refusal pattern:** when asked beyond data: TranceBot answer style unchanged, content = "I don't have stem-level data for this analysis — upload stems and re-analyze to unlock per-track answers." + one-tap `Add stems` action. Refusal = competence + unlock path.
5. **Streaming:** token-streamed responses; visor animates faster while streaming; stop button present.
6. **Verdict handoff:** every FeaturedVerdictCard has `Ask the coach about this` ghost action — prefills input with verdict context; chat scrolls into view. This is the verdict→chat bridge that makes the report feel alive.
7. **Failure:** provider outage → card shows rule-verdicts-only notice: "Coach is offline — your measured analysis and rule-based findings are unaffected." Never a dead chat with no explanation.

## Visual Design Foundation

### Color System

Canonical = `tokens.css` (verified in repo, matches mockups):

- Surfaces: `--bg #070a12`, `--bg-2 #0a0f1c`, `--surface #0d1525`, `--card #0f1828`, `--card-2 #11192a`, `--card-hover #141f34`; borders white-alpha 0.07/0.12; panel `#0e1727`.
- Accents: cyan `#00e5b0` (primary/actions/AI), violet `#a78bfa` (secondary/running/publish), orange `#fb923c` (warnings/impact), red `#f43f5e` (critical/fail), green `#34d399`, yellow `#fbbf24`, blue `#60a5fa`.
- Text: `--text #e2e8f4`, `--text-2 #c0cad8`, `--muted #64748b`.
- Semantic scales: severity (critical→win), streaming readiness (ok/warn/fail/unknown), grades (A `#34d399` → F `#f43f5e`).
- Ambient signature: dual radial gradients (cyan top / violet bottom-right) + 48px grid overlay on body — REQUIRED on funnel pages too (one product, one atmosphere).
- New (commerce): tier chips — Free `--muted`, Pro `--cyan`, Credits `--violet`; keep success/payment confirmations green, dunning warnings yellow→red ramp.

### Typography System

- Display/UI: **Syne** (700/800 for headlines; stylistic sets ss01/ss02 on) — MUST be self-hosted + loaded (audit blocker #1).
- Data/labels: **JetBrains Mono** with `tnum` — all numbers, pills, overlines, timecodes, metric values.
- Pattern law: mono uppercase letter-spaced (0.16em) overline → Syne bold headline → text-2 body. Every card follows it (mockups are consistent; new surfaces comply).
- Scale (from mockups): page titles 24px/800, song hero 36px, verdict headline 22px, card titles 16–18px/700, body 14px/1.6, labels 10–11px mono, hero grade in GradePill-lg (~80px), ghost numerals 88px mono @6% opacity.

### Spacing & Layout Foundation

- Spacing tokens `--space-1..6` (4/8/12/16/20/24) + add `--space-4-5: 18px`.
- Radii 12/8/16 (`--radius/sm/lg`).
- App content max-width 1360px (audit: upgrade from 1080); funnel pages 1120px center column; share page 880px single column.
- Grids: library cards `repeat(auto-fill, minmax(300px,1fr))` gap-16; specialist tiles `minmax(220px,1fr)` gap-8; report two-col patterns `minmax(0,1fr) 360–380px` with sticky right rail.
- Chrome: 56px topnav (blur 14px) + persistent MiniPlayer bottom bar (product routes only; hidden on funnel/share/auth).

### Accessibility Considerations

- Contrast: `--text` on `--card` passes AA; `--muted` (#64748b) reserved for non-essential text ≥11px mono — audit any muted-on-card body text; severity conveyed by icon/label + color (never color-only — pills carry text).
- Focus: visible cyan focus ring (`box-shadow: 0 0 0 3px var(--cyan-dim)` + border) on all interactives; keyboard path through tabs/chat/dialogs (Radix gives the behavior; keep it).
- Motion: all signature animations (pulse, visor, fillH) respect `prefers-reduced-motion` (freeze to static states).
- Charts: every chart panel pairs with text equivalent (verdict text/metric tables already carry meaning — make it a rule).
- Targets: ≥40px interactive height on touch-reachable surfaces (share page, funnel).

## Design Direction Decision

### Design Directions Explored

1. **"Studio Instrument" (the in-repo mockup language):** atmospheric dark, glowing accents, mono data, TranceBot character, tabbed verdict-first report.
2. **"Clean SaaS":** light/neutral, Stripe-like restraint everywhere, no character mascot — safer, forgettable, indistinguishable from LANDR-adjacent tools.
3. **"Maximal producer-culture":** louder gradients, waveform-everything, social-first — fun, but undermines the trust/precision positioning and ages fast.

### Chosen Direction

**Direction 1 — Studio Instrument — confirmed.** Not a contest: it exists, it's distinctive, the fidelity audit already measures the build against it, and it photographs perfectly for affiliate video (a stated channel requirement). Directions 2/3 documented only to mark the deliberate rejection.

### Design Rationale

- Differentiation: every competitor screenshot in research is either consumer-bland (LANDR/eMastered) or plugin-utilitarian (iZotope). Studio Instrument reads as neither — it reads as gear.
- Audience fit: producers live in dark DAWs; light "Clean SaaS" feels like accounting software at 1 a.m.
- Trust fit: precision aesthetics (mono numerals, meters, evidence chips) visually argue the "validated, grounded" claim.
- Asset leverage: ~63-item gap list + mockups + tokens = the fastest path to a premium look is finishing what exists.

### Implementation Approach

Execute fidelity-audit phases as the visual workstream: **Phase A (foundation: fonts/keyframes/utilities/GradePill/brand-mark) → Phase B (app shell + library grid + MiniPlayer shell) → Phase C (results restructure: VerdictHero, 5 tabs, CoachChat+TranceBot, filters, FeaturedVerdictCard, specialist roster) → Phase D (remaining tabs + song-detail hero/timeline)** — then **Phase E (new in this spec): funnel + commerce surfaces** (landing, pricing, trust pages, free-analyzer flow, cap/upgrade screens, usage & billing, share page v2, affiliate dash, email kit). Phase-E components consume Phase-A primitives; build order strictly A→E.

## User Journey Flows

### Flow 1 — Anonymous free analysis → claim (PRD J1/J4, FR7/FR28)

`Landing → [Analyze my track free] → /analyze (drop zone full-bleed, mono hints "WAV · FLAC · MP3 · ≤250 MB", no form fields) → upload progress (chunked %) → pipeline screen (phase dots animate, phase names + ETA, educational one-liners rotate: "Measuring true peak — why it matters for Spotify…") → REPORT (anonymous state): VerdictHero + #1 verdict full + streaming readiness; deeper tabs visible but blurred-locked with copy "Create a free account to keep this report + see all {n} findings" → [Save my report] → email+password inline card (no redirect; report stays visible behind) → verify-email banner (report usable immediately; verify gates next analysis, not this one)`.
Edge: leave before claim → device token preserves report 72h; return visit shows "Your report from Tuesday" resume card. Refresh-safe at every stage.

### Flow 2 — Cap-hit → upgrade (J1, FR29/FR31)

Trigger only BETWEEN analyses (4th upload attempt in month), never mid-pipeline. `Upload click → UpgradeSheet (modal over upload page): header "3 of 3 free analyses used this month" · value recap strip (user's own grade chips from this month's reports — their climb) · two cards side-by-side: PRO $12.99/mo or $99/yr (toggle, savings shown, "unlimited analyses · all verdicts · stems + .als · coach pool · version history") vs CREDITS 5-pack (price, "no subscription, never expire") · trust line under buttons: "Cancel anytime in two clicks · Your reports stay yours forever · No AI training on your audio" · ghost link "wait for next month" (honest exit)`. → Stripe Checkout (hosted) → return → success toast + upload resumes automatically with the file they originally chose (work never lost).

### Flow 3 — Pro user analysis w/ .als (J1, FR2/FR12)

`Topnav [+ Upload] → UploadDialog: primary file zone + three labeled optional zones (Stems multi-select / Reference / .als) each with benefit chip ("unlocks per-track verdicts") + song association (existing song dropdown or new name) + genre hint select → progress → report (AI Coach tab default) → verdict with track-name chip `SUB-DEEP` highlighted cyan → [Ask the coach about this] → chat → fix in DAW → [+ New version] from report header → re-upload pre-associated → report v4 shows delta badge "+6 vs v3" in VerdictHero`.

### Flow 4 — Maya credits pre-gig check (J3, FR29/FR32)

`Report → Usage page (avatar menu): credits balance 3, mono ledger of spends, passive banner only when relevant: "You've spent $39.90 on credits in 90 days — Pro would've been $38.97" (honest math, dismissible, never modal) → [Buy credits] → pack selector (5/10) → Stripe → balance updates inline`. Club-readiness emphasis: report's Streaming/Stereo panels pin "CLUB CHECK" sub-card when genre ∈ DJ-genres: mono-compat %, TP, low-end mono fold — Maya's 5-second read.

### Flow 5 — Share recipient (J4, FR21–24)

`Discord unfurl (OG card: grade pill + track name + "Spectr mix report") → /r/{token}: single column — brand mark → VerdictHero (read-only) → top 3 verdicts (evidence chips, no chat) → frequency chart vs genre → footer CTA "Analyze your own track free →" sticky on mobile → owner-controls absent; .als panel + stems absent by design`. 5-second test: grade + verdict text above the fold on a phone.

### Flow 6 — Billing self-service & dunning (J2, FR30/FR33)

`Avatar → Billing: current plan card (next charge date, amount, period toggle) · payment method (Stripe portal link) · invoices list · [Cancel] → one confirm dialog (single optional reason select) → canceled state shows: end date, "everything you made stays accessible forever," resubscribe button`. Dunning: email + in-app amber banner "Payment failed — retrying Thursday · update card" → after grace, quiet downgrade: Pro features lock with same blurred-invite pattern, all existing reports fully readable (results-forever is visible behavior, not just policy).

### Flow 7 — Affiliate (J5, FR42)

`/partners (public explainer, terms incl. FTC disclosure requirement) → apply (name, channel URL, payout email) → instant code + dashboard: link card with copy button, mono stats row (clicks / signups / conversions / owed), monthly payout table. One page, no tabs — deliberately minimal.`

### Journey Patterns

- **Gate-between-never-during:** all monetization gates sit between completed actions; in-flight work always completes and persists.
- **Blurred-invite locks:** locked depth shows real (blurred) content + one-line unlock copy + single CTA — consistent across anonymous depth, free-tier stems tab, lapsed-Pro features.
- **Resume cards:** any interrupted flow (unclaimed report, half-upload, unfinished checkout) surfaces as a dismissible resume card on next visit.
- **Evidence chips:** measured-value citations are a global pattern (verdicts, coach, share) — tap = scroll/highlight source panel.
- **Climb motif:** grade/score deltas + arcs appear at every retention/conversion moment (library, song hero, upgrade sheet, version compare).

### Flow Optimization Principles

One primary CTA per screen; mono microcopy for constraints (formats, caps, prices) at point of need; optimistic UI on safe ops (rename, notes), confirmed UI on money/destructive; skeletons over spinners on report loads (cards appear in reading order: hero → tabs → verdicts); deep links for everything (report tabs, verdicts via anchor, billing) so emails/Discord land precisely.

## Component Strategy

### Design System Components

Foundation primitives (Phase A — port from mockup styles): `.card/.card-hd/.card-body`, `.label` (mono overline), `.pill` (+ cyan/violet/orange/red/green/yellow variants), `.dot`, `.btn/.btn.primary/.btn.ghost/.btn.sm`, keyframes (`fadeUp fadeIn fillW fillH pulse pulseGlow`), custom scrollbar (exists). Radix-skinned behaviors: Dialog, DropdownMenu (avatar), Tabs (results), Tooltip, Select, Slider (Listen), Switch.

### Custom Components

**Exists in mockups — build to spec (fidelity phases B–D):** BrandMark, TopNav cluster (search ⌘K, bell, +Upload, Avatar), MiniPlayer shell, GradePill (sm/lg), CoverArt (hue-gradient + waveform overlay), VersionArc sparkline, ProgressTimeline (grade-banded), LibraryCard (grid) + LibraryRow (list), VerdictHero (340/1fr + verdict text + 4 HeroMetrics), ResultsTabs (badged, coach-dot), CoachChat + TranceBot + MiniBot avatars, CoachFilters (category pills + show-fixed), FeaturedVerdictCard (ghost numeral, PersonaChip, ImpactTag, ConfidenceMeter, InlineChart slot, FixRecipe), SpecialistTile + roster collapsible, AnalysisSummary (PipelineDial) + PhaseList + UnlockBlock + side rail, BigSpectrumBars (CSS columns + genre-median overlay) + StemClashList, Reference GapRow + ScoreRing, ArrangementBar + issue list, DeltaCard.

**New in this spec (Phase E):**
- `UpgradeSheet` — the cap-hit modal (value recap strip + plan cards + trust line).
- `PlanCard` / `TierChip` / `UsageMeter` (nav + usage page variants).
- `CreditLedger` (mono table) + `HonestMathBanner`.
- `BlurLock` wrapper (blurred content + unlock copy + CTA) — one component, all gating surfaces.
- `EvidenceChip` (tap-to-source) — shared by verdicts/coach/share.
- `CoachCapChip` + `CoachGateInline` (input-replacement state).
- `ClubCheckCard` (mono-compat/TP/low-fold trio).
- `ShareReportPage` layout + `ShareCTA` (sticky mobile).
- `LandingHero` (live sample report embed — real VerdictHero with demo data, not a screenshot), `PricingTable` (two tiers + credits, tax-inclusive note), `TrustPledgePage` blocks.
- `ResumeCard`, `DunningBanner`, `PartnerDashboard` stat row.
- Email kit: `EmailShell` + verification/reset/complete/dunning templates (system-font, dark-band header).

### Component Implementation Strategy

Primitives-first (Phase A) → every subsequent component consumes tokens/utilities only (no one-off hexes — lint for raw color literals in modules); Radix for behavior, SPECTR skin for look; charts: CSS-first where mockups are CSS (spectrum bars, arcs, dials), Recharts only where already proven (history LineChart); all signature SVGs (TranceBot, MiniBot, BrandMark, ScoreRing) as standalone components with `reduced-motion` static variants; InlineChart ships as placeholder slot first (audit guidance) with per-type variants as fast-follow.

### Implementation Roadmap

A (foundation, ≈2 ev) → B (shell + library, ≈3 ev) → C (results restructure, ≈3 ev) → D (remaining tabs + song detail, ≈2 ev) → **E1** funnel set (landing/pricing/trust/analyze flow, ≈3 ev) → **E2** commerce set (UpgradeSheet, usage/billing, dunning, ≈3 ev) → **E3** share v2 + affiliate + email kit (≈2 ev). Validation per phase = side-by-side with mockup screenshots (A–D) or this spec's flow definitions (E).

## UX Consistency Patterns

### Button Hierarchy

- `.btn.primary` (cyan, glow shadow): ONE per view — the money/main action (Ask →, + Upload, Subscribe, Save my report).
- `.btn` ghost (border, transparent): secondary (Re-analyze, Export, Compare, Cancel-dialog).
- `.btn.sm` ghost: in-card tertiary (Open, Run, ↺).
- Violet variant reserved: publish/community semantics only.
- Destructive: red text ghost + confirm dialog; never primary-red.
- Text links: cyan, underline on hover only; mono for meta-links.

### Feedback Patterns

- Toasts (sonner, bottom-right, dark card): confirmations + recoverable errors; 5s; never for in-flow validation.
- Inline field errors: red-400 text under field + border tint; on blur not on keystroke.
- Banners (top of content card): amber = dunning/cap-near; red = action-required; dismiss-state remembered.
- Progress: determinate bars for upload (%, mono), phase dots + per-phase % for pipeline, skeleton cards for data loads, streaming text for coach/verdicts.
- Empty states: every list ships designed empty state previewing its filled shape (audit's library empty-card pattern generalized) + single CTA.
- Celebration: delta badge glow (cyan pulse 1×) on improved version — no confetti, no sound.

### Form Patterns

- Labels: mono overline above field; hints: dim mono below; required = absence of "(optional)".
- Inputs: dark surface, 1px border, cyan focus ring (`0 0 0 3px var(--cyan-dim)`); mono for numeric/code fields.
- File inputs: ALWAYS custom drop-zones (audit flags native input as broken) — dashed border, hover glow, format/size mono hint inside.
- Validation: submit-gated for forms; inline for email/password strength; server errors map to fields, generic failures to form-top banner.
- Auth forms: 380px card, brand mark above, single column, no multi-step wizards.
- Money forms: Stripe-hosted only; our UI shows summary + terms, never card fields.

### Navigation Patterns

- TopNav (56px, blur): brand → segmented tabs `Report / Listen / Library` (+ `Discover` post-MVP) → search ⌘K → bell → `+ Upload` primary → avatar menu (Profile, Usage, Billing, Partners, Sign out).
- Public chrome (funnel/share): slim variant — brand + `Pricing` + `Sign in` + primary `Analyze free`; no product tabs.
- Breadcrumb-lite: back-links as ghost `← Library` pattern (exists) — single level, never deep trails.
- Tabs-in-page (Results): underline-free segmented style w/ badges; state in URL (`?tab=coach`) for deep links.
- MiniPlayer: persistent bottom on product routes; collapses on share/funnel; never overlaps toasts (toast offset above it).
- Keyboard: ⌘K search, ⌘U upload, `?` shortcut sheet — registered globally on product routes.

### Additional Patterns

- **Numbers:** always JetBrains Mono + `tnum`; units in dim suffix (`-11.2 LUFS`); deltas signed + colored (▲ cyan good, ▼ orange bad — by semantics not sign).
- **Time:** relative (<7 days: "2 days ago") then absolute mono date; tooltips show exact timestamp.
- **Severity/grade language:** identical color+label mapping across pills, borders, charts (single source: tokens).
- **Privacy affordance:** every share/visibility control pairs a lock/globe glyph + one-line scope text; private-by-default visible (lock shown, not assumed).
- **AI-content marking:** AI verdicts/coach answers carry the persona chip; rule-engine findings carry a `RULE` mono chip — provenance always visible.
- **Caps display grammar:** `{used} of {limit} {unit} · resets {date}` everywhere caps appear (chip, usage page, gate copy) — one phrasing, no synonyms.

## Responsive Design & Accessibility

### Responsive Strategy

Desktop-first product (producers at DAWs), mobile-respectful funnel/share. Product pages: fluid 1024→1360+; two-col report rails stack under 1024 (rail content folds into accordions below main column). Funnel/share: fully responsive 360→1120. Listen: desktop-only; <1024 shows notice card + link back to report (no broken half-experience). MiniPlayer: hidden <768 (report playback stays in-page).

### Breakpoint Strategy

- `sm 640` — share/funnel single-column tightening; sticky ShareCTA activates.
- `md 768` — MiniPlayer appears; dialog → full-sheet below.
- `lg 1024` — report rails side-by-side; topnav search expands from icon to field; library grid ≥3 cols.
- `xl 1360` — content max; ghost numerals/atmospherics at full scale.
Container queries acceptable for card-level adaptation (library card, verdict card) — modern-browser-only stance already taken.

### Accessibility Strategy

WCAG 2.1 AA target on funnel, auth, report, share, billing (PRD NFR): semantic landmarks per page; tab order = visual order; Radix handles focus traps/menus; `aria-live="polite"` for pipeline phase changes + coach streaming (throttled announcements: phase completions, not every token); charts get `role="img"` + label plus adjacent data table/text (verdict text suffices where it restates the chart); severity icons+text never color-only; visible focus everywhere (cyan ring spec); `prefers-reduced-motion` freezes pulse/visor/fill animations to end-state; form errors associated via `aria-describedby`. Listen page: best-effort (documented AA exemption per PRD), all controls still keyboard-operable.

### Testing Strategy

Per-phase: axe-core pass on funnel/auth/report/share/billing routes (CI smoke); keyboard-only walkthrough of Flows 1, 2, 5, 6 (the money + public paths); screen-reader spot-check (NVDA) on report + coach streaming; contrast audit re-run after any token change; reduced-motion visual check on report + pipeline; 360px-width pass on share + funnel before launch.

### Implementation Guidelines

- A11y is component-level: BlurLock announces lock reason; EvidenceChip is a button with descriptive label ("show source: LUFS measurement"); GradePill includes sr-only grade text; UpgradeSheet focus-trapped with labelled price buttons.
- No `outline: none` without replacement ring — lint rule.
- All new Phase-E surfaces ship AA-checked at build time, not retrofitted (cheaper for solo dev).
- Document per-component a11y notes inline in code (the kitchen-sink route doubles as audit surface).
