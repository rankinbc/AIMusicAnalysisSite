# Frontend v2 Component Inventory — `components/frontend-spectr-v2`

Companion to `docs/architecture-frontend-v2.md`. All paths relative to
`components/frontend-spectr-v2/src/`. Test files (`__tests__/`, `*.test.*`) and CSS modules are
excluded. "Reusable" = designed for use across features; unmarked entries are feature-specific.

## Route pages (`routes/`) — 26 files (3 layouts + 23 pages)

| Component | File | Purpose |
| --- | --- | --- |
| RootComponent | `routes/__root.tsx` | Root outlet; router context (queryClient + auth) |
| AppLayout | `routes/_app.tsx` | Authed shell: topnav, banners, global shortcuts (⌘K/⌘U/?), account menu, auth guard |
| PublicLayout | `routes/_public.tsx` | Narrow anonymous column with wordmark |
| LandingPage route | `routes/index.tsx` | `/` public landing; authed users redirect to /library |
| AnalyzePage route | `routes/analyze.tsx` | `/analyze` anonymous instant-analysis funnel |
| PricingPage | `routes/pricing.tsx` | `/pricing` — plans from `/api/billing/plans`, Stripe checkout redirect |
| Trust hub + pledges | `routes/trust.index.tsx`, `trust.no-training.tsx`, `trust.privacy.tsx`, `trust.results-forever.tsx` | `/trust/*` versioned trust/pledge pages |
| LibraryPage | `routes/_app/library.tsx` | `/library` — Songs / References segmented sections |
| SongDetailPage | `routes/_app/songs.$songId.tsx` | Song hero, version list, compare/edit dialogs; `<Outlet/>` when results child active |
| ResultsPage | `routes/_app/songs.$songId.results.$jobId.tsx` | Job poll → progress storyline / fail+retry / ReportView (`?tab=` deep link) |
| ListenRackVersionRoute | `routes/_app/listen-rack.$versionId.tsx` | Canonical Listen page (owner-only); builds track model from analysis; `?fixPreset=` carry-over |
| ReportsPage | `routes/_app/reports.tsx` | All-reports filterable table |
| ProfilePage | `routes/_app/profile.tsx` | Own profile + settings tabs incl. DangerZone |
| UsagePage | `routes/_app/usage.tsx` | Credits balance, ledger, BuyCreditsCard, UsageSummary |
| BillingPage | `routes/_app/billing.tsx` | Self-service billing (free / pro / cancel-pending states) |
| BillingSuccessPage | `routes/_app/billing.success.tsx` | Post-checkout; polls `/auth/me` 5 s × 60 s for tier flip |
| KitchenSinkPage | `routes/_app/dev.kitchen-sink.tsx` | DEV-only component inventory (a11y/visual audit surface) |
| LoginPage / RegisterPage | `routes/_public/login.tsx`, `register.tsx` | Auth forms (`?next=` support) |
| ForgotPassword / ResetPassword / VerifyEmail | `routes/_public/forgot-password.tsx`, `reset-password.tsx`, `verify-email.tsx` | Account-flow containers over AuthFlowViews |
| BillingCancelledPage | `routes/_public/billing.cancelled.tsx` | Stripe checkout-cancelled landing |

## Feature components (`features/`)

### results (32 components; hooks/helpers: `useFixRackGeneration`, `move-model`, `results-tabs-model`, `progress-phases`, `coach-stream-frames`, `fix-rack-helpers`, `helpers/*`)

| Component | File | Purpose |
| --- | --- | --- |
| ReportView | `features/results/ReportView.tsx` | Report orchestrator: header, tabs, dialogs, fix-rack + coach-mix state |
| ResultsTabs | `features/results/ResultsTabs.tsx` | Tab strip (Coach/Findings/Project/Reference/Track Info/Debug) with badges |
| SongHeader | `features/results/SongHeader.tsx` | Persistent header card: identity, analyzed-input roster, inline player |
| ProgressStoryline(+View) | `features/results/ProgressStoryline.tsx` | Per-phase progress, elapsed clock, slow/offline hints (reused by anon funnel) |
| GradeHero | `features/results/GradeHero.tsx` | Grade letter + mix score + dance chip (reused by landing + anon report) |
| StreamingCard | `features/results/StreamingCard.tsx` | Streaming-readiness rows (reused by anon report + Track Info) |
| CoachTab | `features/results/CoachTab.tsx` | Coach tab: chat + specialist auto-run + move list + fix-rack trigger |
| CoachChat | `features/results/CoachChat.tsx` | SSE chat: token stream, caps, refusals, offline state, aria-live |
| CoachCapChip | `features/results/CoachCapChip.tsx` | `{used} of {limit} follow-ups` caps chip |
| CoachGateInline | `features/results/CoachGateInline.tsx` | Cap-reached input replacement (upgrade paths) |
| SpecialistTeamModal | `features/results/SpecialistTeamModal.tsx` | Specialist roster: run/running/found per slug, credits |
| AnalysisCompleteModal | `features/results/AnalysisCompleteModal.tsx` | Post-analysis teaser/conversion modal (running + complete states) |
| DegradationBanner | `features/results/DegradationBanner.tsx` | Degraded-run (rule-engine-only) notice |
| DepthBanner | `features/results/DepthBanner.tsx` | "Add stems/.als for depth" banner on shallow analyses |
| FindingsTab | `features/results/FindingsTab.tsx` | Full problems/findings list |
| ProjectTab | `features/results/ProjectTab.tsx` | `.als` project-health panel |
| ProjectUnlock | `features/results/ProjectUnlock.tsx` | No-.als CTA state for the Project tab |
| ReferenceTab | `features/results/ReferenceTab.tsx` | Reference-delta panel |
| TrackInfoTab | `features/results/TrackInfoTab.tsx` | Measurements: metadata, frequency, stereo, streaming |
| FilesTab | `features/results/FilesTab.tsx` | Version files list + authorized downloads |
| DebugTab | `features/results/DebugTab.tsx` | DEV-only raw pipeline I/O per phase |
| ResultsPlayer | `features/results/ResultsPlayer.tsx` | Bar-waveform scrubber transport for the report |
| TrackChip | `features/results/TrackChip.tsx` | `.als` track-name chip (with highlight wiring) |
| EvidenceChips | `features/results/EvidenceChips.tsx` | Verdict evidence value chips |
| ExportModal | `features/results/ExportModal.tsx` | Game-plan checklist export preview |
| TranceBot / MiniBot | `features/results/TranceBot.tsx` | Back-compat aliases for `ui/Coach` mascot |

### listen — DSP engine (1 component; hooks; `audio/` subsystem)

Room/share/reviewer primitives (`BookmarksRail`, `AnonReviewerSurface`, `ProducerCta`,
`SuggestionCard`, and the `useRoomSession`/`useRoomStream`/`useRoomActions`/`useComments`/
`useBookmarks`/`useBookmarkSignal`/`useSuggestions`/`useInvites`/`useVersionAccess`/
`useVersionShare`/`useAnonFeedback` hooks) were removed on the solo fork — see
`PRPs/solo-fork-strip-social.md`.

| Component | File | Purpose |
| --- | --- | --- |
| StemDeck | `features/listen/StemDeck.tsx` | Per-stem playback deck (mute/solo/gain) |

Hooks/engine (not components): `useAudioGraph` (Web Audio DSP graph — the engine),
`useStemEngine`; `audio/` = composer, EffectUnit, state, worklets, 13 effect modules
(`audio/effects/`), pure DSP math (`audio/dsp/`), 3 AudioWorklet processors.

### listen-rack — the Listen page

Live-room orchestration (`useRoomOrchestration`, `useMockRoomOrchestration`, `roomStateReducer`,
`roomUiState`, `transportSync`), fork-to-suggest (`SuggestModeChip`, `suggest-draft`), and the
role/capability seam (`access`, `capabilities`, `identity`) were removed on the solo fork — the
rack has no read-only/guest mode any more, it is always owner-editable. `rail.tsx` (the old
Coach/Plan/People/Chat/Stats/Notes right rail) was replaced by `NotesSidebar.tsx` (notes only).
See `PRPs/solo-fork-strip-social.md`.

| Component | File | Purpose |
| --- | --- | --- |
| ListenRackPage | `features/listen-rack/ListenRackPage.tsx` | Page orchestrator: engine binding, transport, presets, fixes |
| rackCore renderers | `features/listen-rack/rackCore.tsx` | Manifest-driven rack module renderers |
| rackLayouts | `features/listen-rack/rackLayouts.tsx` | Rack layout arrangements |
| ui (control primitives) | `features/listen-rack/ui.tsx` | Draggable knobs/faders/toggles/meters (neon language) |
| viz (VizStage + stages) | `features/listen-rack/viz.tsx` | Visualizer stages + AUTO director (one rAF) |

### billing (7 components; hooks: `useBillingPortal`, `useUpgradeCheckout`; helpers: `format-price`, `stripe-url`)

| Component | File | Purpose |
| --- | --- | --- |
| BuyCreditsCard | `features/billing/BuyCreditsCard.tsx` | Credit-pack purchase card |
| CreditLedgerTable | `features/billing/CreditLedgerTable.tsx` | Mono credit ledger |
| UsageSummary | `features/billing/UsageSummary.tsx` | Analyses + coach-pool usage summary |
| HonestMathBanner | `features/billing/HonestMathBanner.tsx` | Dismissible credits-vs-Pro comparison |
| DunningBanner | `features/billing/DunningBanner.tsx` | Past-due fix-payment banner (billing page) |
| AppDunningNotice | `features/billing/AppDunningNotice.tsx` | App-wide past-due notice (authed shell) |
| CancelDialog | `features/billing/CancelDialog.tsx` | Subscription cancel confirm flow |

### anon-analyze (3 components; hooks/vm: `useAnonAnalysis`, `anon-report-vm`, `resume-dismissed`)

| Component | File | Purpose |
| --- | --- | --- |
| AnalyzePage (+DropZoneView, ExplainerLine, AnonReportView, InlineRegisterCard) | `features/anon-analyze/AnalyzePage.tsx` | Funnel state machine idle→uploading→processing→report + claim |
| LandingResumeSlot | `features/anon-analyze/LandingResumeSlot.tsx` | Landing mount owning the resume fetch |
| ResumeCard | `features/anon-analyze/ResumeCard.tsx` | Returning-device resume doorway (status-aware) |

### Other feature folders

| Component | File | Purpose |
| --- | --- | --- |
| LandingPage | `features/landing/LandingPage.tsx` | Public landing (hero, sample report, funnel CTAs) |
| SampleReportEmbed | `features/landing/SampleReportEmbed.tsx` | Live sample report from real trimmed pipeline output |
| SongsLibrarySection | `features/library/SongsLibrarySection.tsx` | Song grid: cards, filter pills, VersionArc, new-song entry |
| ReferenceLibrarySection | `features/references/ReferenceLibrarySection.tsx` | Reference library grid + upload |
| ReferenceCard | `features/references/ReferenceCard.tsx` | One reference tile |
| ReferenceEditDialog | `features/references/ReferenceEditDialog.tsx` | Edit reference metadata |
| ReanalyzeWithReferenceDialog | `features/references/ReanalyzeWithReferenceDialog.tsx` | Re-run analysis against a chosen reference |
| ReferenceProfileSelect | `features/references/ReferenceProfileSelect.tsx` | Reference/profile picker control |
| WorkerHealthBanner | `features/health/WorkerHealthBanner.tsx` | Worker-offline banner body (+ queue depth) |
| AppWorkerHealthNotice | `features/health/AppWorkerHealthNotice.tsx` | Shell mount; renders only on definitive offline |
| DevHealthDot | `features/health/DevHealthDot.tsx` | DEV-only aggregated-health dot (polls `/health/full`) |
| DangerZone | `features/account/DangerZone.tsx` | Export + delete-account (password + typed DELETE) |
| AuthFlowViews | `features/auth/AuthFlowViews.tsx` | Pure verify/forgot/reset view states |
| TrustPage | `features/trust/TrustPage.tsx` | Trust hub content |
| AlsPreviewPanel | `features/upload/AlsPreviewPanel.tsx` | Client-side `.als` parse preview (tracks) in upload dialogs; helpers `alsPreview`, `stemMatch`, presigned upload helpers |

## Shared components (`components/`) — 19 (all reusable across features)

| Component | File | Purpose |
| --- | --- | --- |
| UnifiedUploadDialog | `components/UnifiedUploadDialog.tsx` | THE new-upload entry: mix + stems + .als + reference, single dispatch |
| UploadVersionDialog | `components/UploadVersionDialog.tsx` | Add a plain new version to an existing song |
| StemsUploadDialog | `components/StemsUploadDialog.tsx` | Add stems to an analyzed version (stage/classify/review/confirm) |
| AlsUploadDialog | `components/AlsUploadDialog.tsx` | Attach `.als` to an existing version (re-analysis) |
| ReferenceUploadDialog | `components/ReferenceUploadDialog.tsx` | Upload a reference track |
| NewSongDialog | `components/NewSongDialog.tsx` | Create song metadata |
| SongEditDialog | `components/SongEditDialog.tsx` | Edit song metadata/visual |
| SongFields | `components/SongFields.tsx` | Shared song form fields (+`song-fields-helpers`) |
| CompareDialog | `components/CompareDialog.tsx` | Version-vs-version delta compare |
| ConfirmDialog | `components/ConfirmDialog.tsx` | Generic confirm modal (reusable primitive) |
| BlurLock | `components/BlurLock.tsx` | Universal gating surface: blur + inert + single CTA (reusable primitive) |
| UpgradeSheet | `components/UpgradeSheet.tsx` | Cap-hit upgrade modal (PRO vs CREDITS) |
| PlanCard | `components/PlanCard.tsx` | One plan card inside UpgradeSheet (price node composed by parent) |
| TierChip | `components/TierChip.tsx` | Tier badge (free/pro/credits) |
| UsageMeter | `components/UsageMeter.tsx` | Used/limit meter (nav + page variants) |
| VerifyEmailBanner | `components/VerifyEmailBanner.tsx` | Unverified-email notice + resend (free tier) |
| CommandPalette | `components/CommandPalette.tsx` | ⌘K palette: nav commands + client-side song search |
| ShortcutSheet | `components/ShortcutSheet.tsx` | `?` keyboard-shortcut reference sheet |
| PublicChrome | `components/PublicChrome.tsx` | Slim sticky chrome for funnel pages (brand/pricing/sign-in/CTA) |

## UI primitives (`ui/`) — 10 components (all reusable; helpers: `hueFromId`, `relativeTime`, `songVisualModel`, `index` barrel)

| Component | File | Purpose |
| --- | --- | --- |
| Pill | `ui/Pill.tsx` | Toned status pill |
| GradePill | `ui/GradePill.tsx` | Grade letter pill (A–F colors, sizes) |
| BrandMark | `ui/BrandMark.tsx` | SPECTR logo mark (glow variant) |
| Coach / CoachMini | `ui/Coach.tsx` | Canonical animated robot mascot (+ compact bust) |
| SpecialistBot | `ui/SpecialistBot.tsx` | Alternate specialist robot mascot |
| CoverArt | `ui/CoverArt.tsx` | Song cover renderer (legacy aurora recipe) |
| SongVisual | `ui/SongVisual.tsx` | Template-switched generative cover scenes |
| SongVisualPicker | `ui/SongVisualPicker.tsx` | Cover template + color picker |
| ProgressTimeline | `ui/ProgressTimeline.tsx` | Song-detail version/score timeline |
| VersionArc | `ui/VersionArc.tsx` | Per-song version-history arc (library cards) |

## Shared hooks (`hooks/`) — 4

| Hook | File | Purpose |
| --- | --- | --- |
| useFileUpload | `hooks/useFileUpload.ts` | Generic XHR upload with progress (reusable) |
| useMixUpload | `hooks/useMixUpload.ts` | Presigned-first mix upload with proxy fallback |
| useStemStaging | `hooks/useStemStaging.ts` | Bulk-stem multipart staging with progress |
| useReducedMotion | `hooks/useReducedMotion.ts` | prefers-reduced-motion media query (reusable) |

## Dev-only surfaces

| Surface | File | Notes |
| --- | --- | --- |
| Debug results tab | `features/results/DebugTab.tsx` | In `buildResultsTabs` only when `import.meta.env.DEV` |
| DevHealthDot | `features/health/DevHealthDot.tsx` | Conditionally mounted in `_app.tsx` shell (DEV) so `/health/full` never polls in prod |
| Kitchen sink | `routes/_app/dev.kitchen-sink.tsx` | Component inventory; axe target (`routes/__tests__/kitchen-sink-axe.test.tsx`) |
| devLogin | `auth/AuthContext.tsx` | One-click dev sign-in against `/auth/dev-login` |
| Router devtools | `@tanstack/router-devtools` | devDependency only |

## Counts summary

| Category | Count |
| --- | --- |
| Route files (`routes/`) | 26 (3 layouts, 23 pages incl. 1 dev-only) |
| Feature folders (`features/`) | 14: account, anon-analyze, auth, billing, health, landing, library, listen, listen-rack, references, results, song, trust, upload. `feed`, `mentions`, `notifications`, `profiles` were removed on the solo fork (`PRPs/solo-fork-strip-social.md`); `song` is new since this table was generated. |
| Shared components (`components/`) | 19 |
| UI primitives (`ui/`) | 10 |
| Shell/entry (`main.tsx`, `auth/AuthContext.tsx`) | 2 |
| Dev-only surfaces | 4 (+ router devtools) |

> Per-folder and total `.tsx`/`.ts` component counts above (feature-component total, supporting-module total) are **not re-verified in this pass** — this table has drifted beyond the social strip alone (e.g. a new `features/song/` folder and additional `listen-rack` components exist that are not itemized above, per the "do not add new rows" scoping of this edit) and needs a full non-social inventory refresh to be trustworthy again.
