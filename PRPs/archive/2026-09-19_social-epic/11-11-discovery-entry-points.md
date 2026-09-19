# Story 11.11: Discovery Entry-Points

Status: done

## Story

As a user,
I want the social surfaces connected into a loop,
So that comments, rooms, profiles, and follows reinforce each other.

## Acceptance Criteria

1. **Given** I type `@` in a comment composer, **Then** a handle autocomplete suggests users (resolving against the index used by `MentionParser`).
2. **Given** a comment or room-participant avatar, **When** clicked, **Then** it links to `/u/{handle}`.
3. **Given** an anon viewer on `/v/{token}` who registers, **Then** a "follow this producer" CTA is offered post-claim.
4. **Given** these entry-points, **Then** static-render tests cover the mention autocomplete and avatar links.

## Tasks / Subtasks

- [x] Task 1 — Handle-search endpoint (AC: 1)
  - [ ] `ProfileEndpoints.cs`: add `GET /api/u/?q=<prefix>` on the existing `/u` group (`MapGet("/", SearchHandles)` coexists with `MapGet("/{handle}")`) — AllowAnonymous (anon composers on `/v/{token}` can mention too; `MentionParser` resolves anon-authored mentions), ip-rate-limited 60/min (`public_profile` pattern, `ProfileEndpoints.cs:39-44`, action `"handle_search"`)
  - [ ] Query: `db.Users.AsNoTracking().Where(u => u.Handle != null && u.IsActive && EF.Functions.ILike(u.Handle, escapedPrefix + "%")).OrderBy(u => u.Handle).Take(8).Select(→ HandleSearchItemDto(Handle, DisplayName, AvatarHue))`. citext + ILike = case-insensitive. ESCAPE `%`/`_`/`\` in the prefix before interpolating. Validate `q`: trim, reject empty or >30 chars, reject chars outside the mention charset `[A-Za-z0-9._-]` (mirror `MentionParser.cs:16` regex) → empty list, not 400
  - [ ] Note divergence deliberately: MentionParser itself does NOT filter `IsActive` (`MentionParser.cs:30-40`), but suggestions follow the `/u/{handle}`+follow convention (`IsActive`) — suggesting a user whose profile 404s is a trap. Record in Dev Notes, don't "fix" MentionParser
  - [ ] Response `HandleSearchDto(IReadOnlyList<HandleSearchItemDto> Items)`; records in ProfileEndpoints.cs
- [x] Task 2 — Owner identity on /v/{token} (AC: 3 prerequisite)
  - [ ] `VersionViewEndpoints.GetVersionView` (`VersionViewEndpoints.cs:90-118`): extend the `SongVersions → Songs` join (L98-102) with `s.UserId` → join `Users` for `Handle`/`DisplayName`; add `OwnerHandle` (string?) + `OwnerDisplayName` (string?) to `VersionViewDto` (`VersionShareDtos.cs:61-69`). Null when the owner has no handle or is inactive. Public data only (same exposure as `/u/{handle}`)
  - [ ] Frontend mirror in `types.ts` `VersionViewDto` (L451-460): `ownerHandle: string | null; ownerDisplayName: string | null`
- [x] Task 3 — Mention autocomplete frontend (AC: 1, 4)
  - [ ] `src/features/mentions/mention-helpers.ts` — PURE functions: `activeMentionQuery(text, caret): {query, start} | null` (detect `@token` at caret using the MentionParser charset + `(?<![\w@])` boundary rule) and `applyMention(text, caret, handle): {text, caret}` (replace the active token with `@handle` + trailing space)
  - [ ] `src/features/mentions/useHandleSearch.ts` — `useQuery(['u','search',q], GET /u/?q=, {enabled: q.length > 0})` + 200ms debounce of the input query (module-level `useDebouncedValue` or inline timer state)
  - [ ] `src/features/mentions/MentionSuggestList.tsx` — PURE dropdown list (static-testable): items (handle, displayName, hue), `activeIndex`, `onPick`; hand-rolled panel per `NotificationBell` precedent (`NotificationCenter.tsx:76-135`), NOT Radix
  - [ ] Wire into BOTH composers: `CommentsPanel` input (`rail.tsx:699-708` — keep the existing `isComposing` Enter guard; Enter picks the highlighted suggestion when the dropdown is open, ArrowUp/Down navigate, Escape closes) and the `/v/{token}` textarea (`v.$token.tsx:124-154`). Extract a small `useMentionState(text, setText, inputRef)` hook so the two wirings stay thin
  - [ ] Anon surface uses the same anon-allowed endpoint — no auth gating in the hook
- [x] Task 4 — Avatar → /u/{handle} links (AC: 2, 4)
  - [ ] `CommentsPanel.renderComment` (`rail.tsx:632-666`): when `c.author.type === 'user' && c.author.handle`, wrap the `<Avatar>` + `@handle` label in `<a href={'/u/'+handle}>` (raw anchor to the public route — PublicProfileView precedent); anon authors stay unlinked
  - [ ] `AnonCommentList` (`AnonReviewerSurface.tsx:28-74`): the author `<span>` (L59) becomes a link on the same condition
  - [ ] `PeoplePanel` roster (`rail.tsx:347-406`): non-anon listeners' `<Avatar>`+label link to `/u/{handle}` (mock `ROOM_LISTENERS` handles will 404 until 11.5's live-roster follow-on — acceptable, the wiring is the AC; note in Dev Record)
- [x] Task 5 — Post-claim follow CTA on /v/{token} (AC: 3, 4)
  - [ ] Register CTA for anon viewers on `v.$token.tsx` (7.4 pattern lifted from `r.$token.tsx:267-285`): `href={'/register?via=share_'+token+'&next=/v/'+token}` + `localStorage.setItem('spectr_attribution', 'share_'+token)`. The `next` param (already supported + origin-guarded by `register.tsx:19-28` `safeNext`) brings the new user BACK to `/v/{token}` — that return trip is the "post-claim" moment
  - [ ] `FollowProducerCta` (pure, in `src/features/share/` or `src/features/listen/`): shown when viewer is authed (`useMe`) AND `ownerHandle` present AND not self → "Follow @{owner}" button wired via existing `useFollowState`/`useFollow` (`useFollow.ts`); hides once following ("Following ✓" state fine)
  - [ ] Container wiring in `v.$token.tsx`: `useMe(authed)` gating per `u.$handle.tsx` precedent
- [x] Task 6 — Tests (AC: 4) + gates
  - [ ] BFF `ProfileEndpointsTests` (or new `HandleSearchTests`): prefix match case-insensitive, inactive excluded, `%`/`_` escaped (literal-treated), charset-invalid q → empty 200, limit 8, `VersionViewDto` carries ownerHandle (extend existing version-view test if present, else add)
  - [ ] Frontend: `mention-helpers.test.ts` (unit: token detection at caret incl. email non-trigger + mid-word non-trigger, applyMention replacement); `MentionSuggestList` static render (items, active highlight, empty); avatar-link assertions extended in `CommentsPanel.test.tsx` + `anon-reviewer-surface.test.tsx` (href present for user authors, absent for anon); `FollowProducerCta` static render (authed+handle renders, self/anon hidden)
  - [ ] Gates: BFF build+test; frontend vite build → tsc -b → lint + lint:css → vitest; ruff + shared pytest untouched (no python change — no schema change this story)

## Dev Notes

### Architecture constraints (from recon 2026-07-03)

- **No handle-search endpoint exists.** All handle lookups are exact (`ProfileEndpoints`, `FollowEndpoints`, invite binding). `users.handle` is `citext`, unique btree `IX_users_handle` — equality-only index; a prefix `ILike 'x%'` will seq-scan. Beta-scale fine; do NOT add a trigram index this story (defer).
- **MentionParser contract** (`Services/MentionParser.cs`): regex `(?<![\w@])@([A-Za-z0-9][\w.\-]{0,29})`, dedupe OrdinalIgnoreCase, resolve via `Handle != null && handles.Contains(u.Handle)` on citext. The autocomplete must suggest only handles that this parser would subsequently match — hence charset validation on `q`.
- **`EF.Functions.ILike` precedent**: `ReportsEndpoints.cs:56-84`. Escape user input: `q.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")`.
- **ActorRefDto carries handle everywhere** (`DTOs/FeedbackDtos.cs:8-13`, projected in `FeedbackEndpoints.ActorOf:72-75` and `ActorProjection.ToDtoAsync:25-36`): comment authors, room roster, grants. Anon actors: `Handle = null`. So AC2 needs zero backend work.
- **`/v/{token}` endpoint** = `VersionViewEndpoints.GetVersionView` (ResourceTokenAuth "share" — NOT JWT `?t=`). Currently selects only `v.VersionNumber`, `s.Name`. The legacy `/r/{token}` (`SharedAnalysisDto`) already exposes `ProducerHandle` — parallel system, do not touch it.
- **Registration**: `POST /api/auth/register` takes email+password only; handle auto-seeded (`HandleSeeder`). No server-side claim mechanics; 7.4 attribution is a write-only `localStorage['spectr_attribution']` stash consumed by nothing until 6.5. Keep it that way — this story only ADDS the same stash+CTA to `/v/{token}` and rides the existing `next` redirect.

### Frontend conventions

- Composers: `CommentsPanel` uses `<input>` with `!e.nativeEvent.isComposing && e.key === 'Enter'` guard (11.1/11.3 review patches — PRESERVE; dropdown-open Enter must pick, not submit). `/v/{token}` uses a `<textarea>` in a form (Enter = newline; mention pick via click/Enter-on-dropdown only).
- No combobox primitive exists (Radix popover available but NotificationBell's hand-rolled dropdown is the codebase pattern — outside-click close via `mousedown` listener + wrapRef).
- Pure/container split is the testability contract (vitest env = node, `renderToStaticMarkup`, `expect(html).toContain`). CommentsPanel test seeds TanStack cache (`CommentsPanel.test.tsx:26-35`) — extend, don't rewrite.
- `useFollowState/useFollow` from `src/features/profiles/useFollow.ts` — reuse for the CTA; they already invalidate `['me','feed']` (11.10 review patch).
- Raw `<a href>` for `_public` routes (`/u/`, `/v/`) is the established pattern (PublicProfileView).

### Scope guards

- Do NOT build server-side attribution/claim records (6.5 owns funnel events; 4.5 owns device claim).
- Do NOT touch the legacy `/r/{token}` surface.
- Do NOT wire live room roster (mock `ROOM_LISTENERS` stays; links only).
- No schema change ⇒ no migration, no python mirror, worker/shared suites unaffected.

### Previous story intelligence (11.10 + review)

- Review patterns that will be checked again here: unbounded input (cap/validate `q`), rate limiting on anon endpoints, stale query cache after mutations, deterministic ordering, test assertions that actually prove the claim (name tests honestly).
- Branch: continue on `social/11-10-activity-feed` (PR #4) — batching precedent from PR #3.
- Known flaky BFF test: CoachStream parallel-run — rerun isolated before diagnosing.
- `SubscriptionMirrorService` race was fixed in the 11.10 review commit; unrelated to this story.

### References

- [Source: PRPs/epics.md#Story 11.11 (L1418-1429)]
- [Source: components/bff/src/Spectr.Bff/Services/MentionParser.cs]
- [Source: components/bff/src/Spectr.Bff/Endpoints/{ProfileEndpoints,VersionViewEndpoints,FeedbackEndpoints}.cs]
- [Source: components/frontend-spectr-v2/src/features/listen-rack/rail.tsx (CommentsPanel, PeoplePanel)]
- [Source: components/frontend-spectr-v2/src/routes/_public/{v.$token,register,r.$token}.tsx]
- [Source: PRPs/stories/11-10-activity-feed.md#Senior Developer Review]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

### Completion Notes List

- **Handle search** — `GET /api/u/?q=` on the existing `/u` group (`ProfileEndpoints.SearchHandles`): anon-allowed, ip-rate-limited 60/min (`handle_search`), q validated against the MentionParser token grammar (junk → empty 200, not 400), `_` escaped for ILike, `IsActive`-filtered (deliberate divergence from MentionParser's lenient resolution — suggesting a 404-profile is a trap; noted in code), ≤8 items ordered by handle.
- **Owner identity on /v/{token}** — `VersionViewDto` + `GetVersionView` grew `OwnerHandle`/`OwnerDisplayName` (null when owner inactive/handle-less; registration seeds handles so normally present). Frontend `types.ts` mirrored.
- **Mentions frontend** — new `features/mentions/`: `mention-helpers.ts` (pure `activeMentionQuery` caret-token detection mirroring the parser grammar incl. email/`@@`/mid-word non-triggers; `applyMention` with no-double-space insert), `useMentionAutocomplete` (200ms debounce, `['u','search',q]` query, ArrowUp/Down/Enter/Tab/Escape handling that returns consumed=true so composers keep their own Enter semantics), pure `MentionSuggestList` (mousedown-pick so input blur doesn't eat the click). Wired into BOTH composers: `CommentsPanel` input (11.1 `isComposing` Enter-guard preserved; dropdown consumes keys first) and the `/v/{token}` textarea.
- **Avatar links** — comment authors in `CommentsPanel.renderComment` + `AnonCommentList` and non-anon `PeoplePanel` listeners now deep-link to `/u/{handle}`; anon actors stay unlinked. Mock `ROOM_LISTENERS` handles will 404 until the live-roster follow-on (noted in story) — the wiring is the AC.
- **Discovery loop on /v/{token}** — anon: `RegisterCta` (7.4 attribution stash + `via=share_{token}` + origin-guarded `next=/v/{token}` so the fresh registrant returns authed = the post-claim moment); authed non-owner: `FollowProducerCta` via `useFollowState/useFollow/useUnfollow` (which already invalidate the 11.10 feed).
- **Tests** — BFF 3 new (prefix/case-insensitive/inactive-excluded/limit, junk-as-empty matrix, owner-identity incl. deactivation → null); frontend 17 new assertions across `mention-helpers.test.ts` (8), `mention-suggest.test.tsx` (3), `producer-cta.test.tsx` (4), avatar-link cases added to `CommentsPanel.test.tsx` + `anon-reviewer-surface.test.tsx`.

### File List

- `components/bff/src/Spectr.Bff/Endpoints/ProfileEndpoints.cs` (SearchHandles + DTOs)
- `components/bff/src/Spectr.Bff/Endpoints/VersionViewEndpoints.cs` (owner join)
- `components/bff/src/Spectr.Bff/DTOs/VersionShareDtos.cs` (VersionViewDto owner fields)
- `components/bff/tests/Spectr.Bff.Tests/{ProfileEndpointsTests,VersionShareEndpointsTests}.cs` (extended)
- `components/frontend-spectr-v2/src/features/mentions/{mention-helpers.ts,useMentionAutocomplete.ts,MentionSuggestList.tsx,mentions.module.css}` (new)
- `components/frontend-spectr-v2/src/features/mentions/__tests__/{mention-helpers.test.ts,mention-suggest.test.tsx}` (new)
- `components/frontend-spectr-v2/src/features/listen/ProducerCta.tsx` (new) + `__tests__/producer-cta.test.tsx` (new)
- `components/frontend-spectr-v2/src/features/listen/AnonReviewerSurface.tsx` (author links)
- `components/frontend-spectr-v2/src/features/listen-rack/rail.tsx` (composer mention wiring, author + roster links)
- `components/frontend-spectr-v2/src/features/listen-rack/__tests__/CommentsPanel.test.tsx` (extended)
- `components/frontend-spectr-v2/src/features/listen/__tests__/anon-reviewer-surface.test.tsx` (extended)
- `components/frontend-spectr-v2/src/routes/_public/v.$token.tsx` (mention wiring + CTAs)
- `components/frontend-spectr-v2/src/api/types.ts` (VersionViewDto owner fields)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Outcome: **Approve with patches**; all 4 ACs met. 12 patches applied same day, 3 defers, rest rejected with evidence:

- [x] [High] Raw share token interpolated into the register URL (param-smuggling `x&next=//evil` — safeNext would still reject the redirect, but encode anyway) → `encodeURIComponent` on `via` + `next`
- [x] [Med] Mid-token pick left tail garbage (`hey @aurora ur ok`) → `applyMention` scans to the token end
- [x] [Med] Returned caret was discarded — cursor jumped to end after a pick → composers pass their input ref; hook restores selection via rAF
- [x] [Med] Dropdown hijacked IME candidate keys → `isComposing` bail at the top of `handleKeyDown`
- [x] [Med] `authed` was a one-shot `getAccessToken()` read — the freshly-claimed registrant (THE AC3 moment) could keep seeing RegisterCta → reactive `useMe(true)`; CTAs render only after `/auth/me` settles
- [x] [Med] Owner briefly saw "+ Follow @themself" (handle compare vs unloaded `me`) → gate on server `followState.isSelf`
- [x] [Low] `activeIndex` unclamped when results shrink → effect clamp
- [x] [Low] Dropdown flickered closed between keystrokes → `placeholderData: keepPreviousData`
- [x] [Low] Stale dropdown after submit cleared the text externally → `mention.close()` in both submit onSuccess handlers
- [x] [Low] Unicode boundary divergence (`é@aur` triggered in JS but .NET `\w` is unicode → dead mention) → `WORD = /[\p{L}\p{N}_]/u`
- [x] [Low] Query-key collision: `['u','search',q]` collides with `followKey('search')` for a user handled 'search' → `['handle-search', q]`; also `retry: false` so 429s aren't amplified
- [x] [Low] Vacuous limit-8 assertion + untested `_` escaping + misleading test comment → seed-9 cap test, literal-underscore vs decoy test, comment fixed
- Deferred: reverse-proxy ForwardedHeaders for ip rate-limit keying (Epic 10.1 owns deploy topology); trigram/text_pattern_ops index for prefix ILike (beta scale, noted in Dev Notes); attribution stash lost on middle-click (6.5 owns funnel instrumentation).
- Rejected (verified): Users inner-join orphan risk (FK cascade makes orphaned owners impossible); owner-identity "leak" (response only reachable via valid share token — intended exposure); raw `<a href>` for public routes (project precedent); mock roster 404 links (story-documented); follow-toggle stale window + Escape-reopen + maxLength-bypass (negligible/server-validated).

### Change Log

- 2026-07-03: implemented on `social/11-10-activity-feed` (PR #4, batched with 11.10). Gates: BFF build 0-warn + 260/260; frontend vite build + tsc -b + lint + lint:css + vitest 659/659; no python change (no schema). Status → review.
- 2026-07-03 (review): 12 code-review patches applied (see Senior Developer Review). Gates after patches: BFF 262/262, vitest 661/661, build/tsc/lint/lint:css clean.
