# App Shell Audit

## Overview

`app.jsx` is the root component for the SPECTR design mock. It owns the active tab, sub-view selection (which song / which public artist / which public track / which compare reference / which song is being published), the user's editable public profile, and the user's bookmarks list. It also mounts the persistent `Topnav`, `MiniPlayer`, two modals (`PublishToDiscoverModal`, `EditPublicProfileModal`), and the design-only `TweaksPanel`.

In the real React 19 + TanStack Router rewrite, almost none of this state belongs in a single root component. The `tab` enum and every sub-view state variable should become URL-addressable routes (so deep links, browser back, and shareable URLs all work). The bookmarks list and active player track should live in server cache (TanStack Query) plus a tiny Zustand store for transient UI state. The tweaks panel is design-time tooling and is not ported.

This audit defines the route tree, navigation flows, where global UI surfaces live, and what the BFF must add to support cross-page deep linking — most notably `song_id` + `song_name` on the job-results response so the Results header can render an "← Back to song" link.

## Proposed route tree

File-based TanStack Router under `src/app/routes/`. All routes under `_app/` require an authenticated user (silent-refresh on mount; gate at the layout); routes under `_public/` are anonymous-accessible.

```
src/app/routes/
├── __root.tsx                     ← <RouterProvider>; <Toaster>; global QueryClient
├── _app.tsx                       ← AUTH GUARD layout: Topnav + <Outlet/> + MiniPlayer
│
├── _app/                          ← authenticated zone
│   ├── index.tsx                  ← / → redirect to /library
│   │
│   ├── library/                   ← LIBRARY tab
│   │   ├── index.tsx              ← /library — grid/list of songs
│   │   └── $songId.tsx            ← /library/$songId — SongDetailPage
│   │
│   ├── songs/$songId/
│   │   ├── results.$jobId.tsx     ← /songs/$songId/results/$jobId — Results
│   │   ├── listen.$versionId.tsx  ← /songs/$songId/listen/$versionId — NowPlaying
│   │   └── compare.tsx            ← /songs/$songId/compare?ref=$referenceId&versionA=&versionB=
│   │
│   ├── results/$jobId.tsx         ← /results/$jobId — Results without a song parent (legacy / orphan jobs)
│   ├── listen.tsx                 ← /listen?versionId=&trackId= — generic NowPlaying
│   │
│   ├── discover/                  ← DISCOVER tab
│   │   ├── index.tsx              ← /discover — feed + filters (genre/mood/license/sort via search params)
│   │   ├── tracks.$trackId.tsx    ← /discover/tracks/$trackId — PublicListenView
│   │   └── u.$handle.tsx          ← /discover/u/$handle — PublicProfilePage
│   │
│   ├── profile/                   ← PROFILE (own account)
│   │   ├── index.tsx              ← /profile — overview (tab=overview default)
│   │   ├── library.tsx            ← /profile?tab=library (or sub-route)
│   │   ├── references.tsx         ← /profile/references
│   │   ├── activity.tsx           ← /profile/activity
│   │   └── settings.tsx           ← /profile/settings
│   │
│   └── publish.$songId.tsx        ← /publish/$songId — modal-as-route (see "Modals")
│
└── _public/                       ← unauthenticated zone (no Topnav, slim layout)
    ├── login.tsx                  ← /login
    ├── register.tsx               ← /register
    └── r/$shareToken.tsx          ← /r/$shareToken — public shared report
```

Key choices:

- The "discover sub-view" (track vs. profile) becomes two real routes (`/discover/tracks/$trackId`, `/discover/u/$handle`) instead of two `useState` flags. The mock's `usersLookup = { ...PUBLIC_USERS, [publicProfile.handle]: publicProfile }` collapses to a single route resolver that fetches the user by handle — your own profile loads from the same endpoint when `handle === me.handle`.
- Results is parented under `/songs/$songId/results/$jobId` so the back-link target is encoded in the URL — no need for the mock's `songContext` prop. A fallback `/results/$jobId` exists for jobs that aren't bound to a song yet (anonymous upload then save-to-library later).
- Filters on Discover are search params (`?genre=&mood=&license=&sort=`) so the filter state survives reload and is sharable.

## Cross-page navigation flows

| From | Action | To route | State/params carried | Notes |
|---|---|---|---|---|
| Library grid | Click song card | `/library/$songId` | `songId` (path) | Standard `<Link>`. |
| Library / SongDetail | Click "Open analysis" on a version | `/songs/$songId/results/$jobId` | `songId`, `jobId` (path) | Results header derives back-link from `songId`. |
| SongDetail | Click "Publish to Discover" | `/publish/$songId` | `songId` (path) | Modal-as-route; closes via navigate-back. |
| SongDetail | Click version row → Listen | `/songs/$songId/listen/$versionId` | `songId`, `versionId` (path) | NowPlaying knows the parent song. |
| Library | Select two versions → "Compare" | `/songs/$songId/compare?versionA=&versionB=` | `songId` (path), `versionA`, `versionB` (search) | All comparable state in URL → shareable. |
| Profile (own) | Click a recent song | `/library/$songId` | `songId` (path) | Same as Library → SongDetail. |
| Profile (own) | Click reference → "Compare against current mix" | `/songs/$songId/compare?ref=$referenceId` | `songId`, `ref` (search) | Mock has no "current song" notion; URL must encode which song the compare targets. Decision: require user to pick a song first if none is "active". |
| Profile (own) | Click "View your public profile" | `/discover/u/$handle` | `handle` (path) — `handle = me.handle` | Same route as viewing anyone else's profile; the route shows an "Edit" CTA only when `handle === me.handle`. |
| Profile (own) | Click a public track tile under "Your published tracks" | `/discover/tracks/$trackId` | `trackId` (path) | Standard cross-link into Discover. |
| Discover feed | Click a track | `/discover/tracks/$trackId` | `trackId` (path) | |
| Discover feed | Click an artist handle | `/discover/u/$handle` | `handle` (path) | |
| PublicListenView | Click artist handle | `/discover/u/$handle` | `handle` (path) | |
| PublicProfilePage | Click a published track | `/discover/tracks/$trackId` | `trackId` (path) | |
| PublicProfilePage (own) | Click "Edit public profile" | `/profile/settings?edit=public-profile` | search param flag | Reuses settings page; modal-as-route alternative is fine. |
| Results header | Click "← Back to song" | `/library/$songId` | `songId` from route param | Replaces the mock's `onBackToSong` callback. No prop drilling needed. |
| NowPlaying | Click "Open analysis" | `/songs/$songId/results/$jobId` | `songId`, `jobId` (latest job for that version) | |
| MiniPlayer | Click expand `↗` | `/listen?trackId=$active.trackId` or `/songs/$songId/listen/$versionId` if it's a song version | depends on what's loaded | Player state determines target route. |
| Coach (Results) | Click "Listen with preset applied" | `/songs/$songId/listen/$versionId?preset=$presetId` | `preset` (search) | Listen page reads the preset from URL and applies it to WaveSurfer + EQ chain on mount. Zustand transient store is the fallback if the preset payload is too big for a URL (>2k chars). |
| Library | Click "Save to Discover bookmark" on a public track inside a player | optimistic mutation; stays on current route | — | Bookmark mutation invalidates `['bookmarks']` query. No nav. |

## Global UI surfaces

**Topnav** — lives in the `_app.tsx` layout (above `<Outlet/>`). Reads active tab from `useMatchRoute()` (highlights based on path prefix, not local state). Avatar button navigates to `/profile`. Upload button opens an upload modal-as-route at `/upload` (out of scope of this audit; tracked under upload-flow page). Search box is a future feature; render disabled in v1.

**MiniPlayer** — also in `_app.tsx` layout, below `<Outlet/>`. Reads the currently-loaded track from a small Zustand `playerStore` (track, isPlaying, position, durationSec). The store is populated by Listen, NowPlaying, and PublicListenView pages on mount via `playerStore.setTrack(...)`. Persists across navigation; hidden on `_public/*` routes (login, share). Expand button navigates to whatever route best matches the loaded track (see flow table).

**PublishToDiscoverModal** — modal-as-route at `/publish/$songId`. Renders as a `<Dialog>` (Radix) layered over whatever route is underneath via TanStack Router's path-based mounting. Closing navigates back. This pattern is preferred over context-modal because the action is shareable/deep-linkable and survives reload.

**EditPublicProfileModal** — `/profile/settings?edit=public-profile` OR a dedicated `/profile/settings/edit-public` route. Decision: search-param flag on settings page is simpler; the actual edit form is rendered inline as a Radix Dialog when the flag is set.

**Auth gate** — `_app.tsx` `beforeLoad`: if no access token (memory) and silent-refresh fails, redirect to `/login`. While refresh is in flight, render a full-page loader (not a redirect-flash). This is the silent-refresh pattern locked in REQUIREMENTS_ARCHITECTURE.md auth section.

**TweaksPanel** — **NOT PORTED.** Design-only tool used during the mock phase to toggle density/visualizer/viewMode. Tweaks that survive (e.g. density preference) become user settings on the Profile/Settings page, persisted to `users` table.

## State management decisions

| Concern | Mechanism | Why |
|---|---|---|
| Active "tab" | Route URL | Source of truth lives in the path; back/forward and reload work for free. No `useState('results')` anywhere. |
| `selectedSongId`, `publicTrack`, `publicProfileHandle`, `compareRef`, `publishingSongId`, `editingPublicProfile` | Route URL (path or search params) | Every sub-view is its own route — no parent component juggling 6 setters. Deep links into Discover from Profile work without any custom state plumbing. |
| `bookmarks[]` | **TanStack Query (`['bookmarks', userId]`)** | Bookmarks are server data — they persist across devices and sessions. Render via `useQuery`; mutate via `useMutation` with optimistic update + invalidate. No Zustand. The mock seeds an example client-side; production reads from `GET /api/me/bookmarks`. |
| `publicProfile` (own editable profile) | TanStack Query `['me', 'public-profile']` + mutation | Same as bookmarks — server state. The mock keeps it in `useState` because there's no backend; the rewrite fetches it once and mutates via `PATCH /api/me/public-profile`. |
| MiniPlayer state (current track, isPlaying, position) | **Zustand `playerStore`** | Transient, cross-page, never persisted to server. Lives in memory only. SessionStorage backup optional so a tab refresh keeps the loaded track. |
| Coach-preset-to-apply (Coach → Listen) | URL search param when small; Zustand fallback for large blobs | Preset is typically a small ID + 3–5 EQ band settings — fits in URL. Listen reads on mount, applies, and clears the search param via `navigate({ search: { preset: undefined } })`. |
| Filter state on Discover, Library, References | URL search params | Survives reload; share-friendly. `?genre=Techno&mood=driving&sort=plays` is exactly the kind of URL we want indexable later. |
| Tweaks (density, visualizer, viewMode) | User settings table + `useUserSettings()` hook | Density becomes a real preference; visualizer and viewMode are deferred (not ported in v1 — visualizer style is fixed to mirrored, view mode to producer). |

Rule of thumb: **route URL first, TanStack Query for server state, Zustand only for cross-page transient UI**. No global Redux/MobX/Jotai.

## Backend implications

1. **`GET /api/jobs/{jobId}/results` must include `song_id` and `song_name`.** Today it does not (per CLAUDE.md v1.1 routes). Without this, the Results page route `/songs/$songId/results/$jobId` cannot validate that `$songId` matches the job's parent, and the "← Back to song" link cannot render a song name. Add both fields; `song_id` is nullable for orphan jobs.

2. **`GET /api/songs?include=versions,latest_result` (already proposed in Library audit) must return enough fields to drive `SongDetailPage` and Library cards without N+1.** Specifically: `[{ id, name, genre, bpm, key, hue, grade, score, scoreDelta, versionCount, versions: [{ id, v, label, grade, score, date, current, latest_job_id }] }]`. Drive the entire Library tab + Profile recent-songs + Discover's "your tracks" preview from this one response.

3. **`GET /api/me/public-profile` and `PATCH /api/me/public-profile`.** Fields: `handle`, `display_name`, `bio`, `avatar_hue`, `banner_hue`, `accent`, `public_link`. Schema additions already locked in REQUIREMENTS_ARCHITECTURE.md "Identity / username" section. Validation: handle uniqueness, accent enum, hue 0–359.

4. **`GET /api/users/$handle` (public).** Resolves a handle to public-profile fields + list of their published track IDs. Used by `/discover/u/$handle`. Must be cheap — index `users.handle` (already unique). Include `is_you` boolean computed server-side from auth cookie.

5. **`GET /api/discover/tracks`** with search params for genre, mood, license, sort. Pagination via cursor. Each item must include `artist_handle` so the frontend can render handle chips without a second lookup per row (avoids N+1 — solved by the BFF doing a JOIN against `users` once).

6. **`GET /api/me/bookmarks`** + `POST /api/me/bookmarks/$trackId` + `DELETE /api/me/bookmarks/$trackId`. New `discover_bookmarks` table (`user_id`, `track_id`, `created_at`). Returns hydrated track rows (same shape as `/api/discover/tracks` items) so the Profile → Bookmarks tab can render directly.

N+1 risks: the Profile overview tab loads recent songs (4), bookmarks preview (4), references preview (4), and activity (5) — that's four separate queries minimum. Consider a single `GET /api/me/dashboard` aggregate endpoint, or accept four parallel TanStack Query fetches with `Promise.all`-style staggering. Recommend four parallel queries — simpler, cacheable per-section, no aggregate endpoint to maintain.

## Open questions

1. **Modal-as-route vs context modal for Publish + Edit Public Profile.** Recommend modal-as-route for shareability and reload-survives. Confirmed in this audit; flag only if product wants different UX.
2. **Compare page with no active song.** Mock implies Compare always has a `compareRef` and an implicit current song. Real routing forces an explicit `songId` on the URL. Decision: clicking "Compare" from Profile's reference card when no song is selected routes to `/profile?action=pick-song-to-compare&ref=$refId` and shows a song picker. (Out of scope of this audit; flagged for Profile audit revisit.)
3. **Listen route without a song parent.** `/listen?trackId=` for tracks not yet bound to a Song row (e.g. anonymous upload preview). Decision: keep this fallback; it's the same component as `/songs/$id/listen/$v`, just without breadcrumb.
4. **Where does the upload action live?** Topnav "+ Upload" button. Modal-as-route at `/upload`, drag-drop also accepted globally. Out of scope here.

## Build verdict

**IMPLEMENT AS-IS** with one small BFF additive change.

The mock's six `useState` flags collapse into routes — that's a clean rewrite, not a capability gap. The only backend change required is adding `song_id` + `song_name` to the `/jobs/{id}/results` response so the Results header can render a back-link without prop-drilling `songContext`. Bookmarks need a new table + three endpoints, but these are mechanical and already implied by the Discover audit. Everything else (Topnav, MiniPlayer, modals, auth gate) is straight implementation.

## Notes

- **TanStack Router file-based routes.** Use the Vite plugin (`@tanstack/router-plugin/vite`) so route trees are auto-generated; type safety on `Link` and `useNavigate` falls out for free. No code-based router definitions.
- **Layout component pattern.** `_app.tsx` and `_public.tsx` are TanStack Router "layout routes" (leading underscore = pathless). They render shared chrome (Topnav, MiniPlayer for `_app`; slim chrome for `_public`) and an `<Outlet/>`.
- **MiniPlayer hiding on certain routes.** Use `useMatch({ from: '_app', shouldThrow: false })` or a route-context flag like `staticData: { hideMiniPlayer: true }` on routes that should suppress it (e.g. Results page while a different track is loaded — debatable; default is to keep MiniPlayer always visible inside `_app`).
- **Tweaks panel removal.** Strip `TWEAK_DEFAULTS`, `useTweaks`, and `TweaksPanel` entirely. Density preference becomes a single `density: 'compact' | 'regular'` field on `users.settings` JSONB column; read via `useUserSettings()` and apply via a `data-density` attribute on `<html>` so CSS modules can branch on it.
- **`changeTab` cleanup logic is unnecessary.** The mock manually resets sub-view state when changing tabs (`if (next !== 'library') setSelectedSongId(null)`). With routes, leaving `/library/$songId` to go to `/discover` automatically unmounts SongDetailPage — no cleanup logic needed.
- **`screenLabel` (`01 Results`, `06 Discover`, etc.)** is a design-time visual indicator (rendered via `[data-screen-label]` attribute). Not ported; if useful for dev debugging, expose only in `import.meta.env.DEV`.
- **`isYou` field on PUBLIC_USERS.** Mock sets `isYou: true` statically on `maek`. Real implementation: BFF computes per-request from the authenticated user's handle; never trust a client-supplied `isYou`.
