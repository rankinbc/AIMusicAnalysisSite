# Discover Page Audit

## Overview
A community surface where producers browse public tracks published by other SPECTR users, then drop into a full-featured Public Listen view that mirrors the private Listen page: real Web Audio DSP (ToolsRail), a timestamped public comments thread, and a ☆/★ bookmark control. Authors publish via a modal that now supports anonymous releases (handle hidden, comments still public). With ToolsRail + comments + bookmarks layered on, Discover has moved from a passive feed into a structured feedback surface — every published track is implicitly a feedback request, and listeners can both react with words (timestamped comments) and react with sound (audition a Coach-suggested fix on someone else's master in their browser).

## Subpages / variants
1. **Feed (`DiscoverPage`)** — hero with "Fresh this week" 3-tile row, sticky filter bar (search, genre, license, BPM range, sort, mood chips), responsive grid of `DiscoverCard`s.
2. **Public Listen View (`PublicListenView`)** — full listening surface for someone else's track: cover + metadata pills + waveform/transport + description, **ToolsRail** (EQ / Compressor / Width / Loop / Phase Scope / Loudness — same DSP chain as private Listen), **public comments thread** with timestamped jump-to-position pins, **☆/★ Bookmark** toggle, conditional Download CTA.
3. **Public Profile (`PublicProfilePage`)** — colored banner (hue-tinted gradient), avatar, display name, handle, bio, optional link, joined-months, public-tracks grid. Owner (`isYou`) sees an "Edit public profile" CTA.
4. **Publish-to-Discover Modal (`PublishToDiscoverModal`)** — opt a `SongVersion` into Discover: pick version, display title, artist display name (or **Anonymous** when toggle is on), genre, moods, description, license, allow-download toggle, **publish-anonymously toggle**, show-analysis-publicly toggle.
5. **Edit Public Profile Modal (`EditPublicProfileModal`)** — display name, bio (140 chars), link, banner-hue picker (8 fixed hues).

## Data the page assumes
| Field | Status | Source today | Effort if not ✅ | Notes |
|---|---|---|---|---|
| `user.handle` (public username) | 🆕 schema | `users` has only `email` | S | Add `handle` (unique, indexed slug) to `users` |
| `user.displayName` | 🆕 schema | not in `users` | S | Add `display_name` column |
| `user.bio` (≤140 chars) | 🆕 schema | not in `users` | S | Nullable text column |
| `user.link` (single external URL) | 🆕 schema | not in `users` | S | Nullable text column |
| `user.avatarHue` / `bannerHue` (oklch hue, 0–360) | 🆕 schema | not in `users` | S | Two `Integer` columns; default at signup |
| `user.joinedMonths` | ⚠️ derivable | `users.created_at` | — | Compute server-side |
| `user.isYou` | ⚠️ derivable | compare authed `user.id` to profile owner | — | Boolean in response shape |
| `user.accent` (color name) | 🆕 schema | not present | S | Either store or derive from `avatarHue` |
| `track.id` (public track id) | 🆕 schema | only `upload_jobs.id` / `song_versions.id` | S | New `published_tracks` table keyed by `song_version_id` |
| `track.title` (override of song name) | 🆕 schema | `songs.name` is private | S | `published_tracks.title` |
| `track.artist` (handle of publisher, **nullable when anonymous**) | 🆕 schema | join to `users.handle` | S | FK `published_tracks.user_id`; surface as `null` when `anonymous=true` |
| `track.anonymous` (bool) | 🆕 schema | **new column** | S | New `published_tracks.anonymous` bool (default false) — gates whether `user_id` is exposed in API response |
| `track.genre` | ⚠️ derivable | `songs.genre_hint` or `final_json.phase2.genre` | S | Snapshot into `published_tracks.genre` at publish time |
| `track.bpm` | ⚠️ derivable | `final_json.phase1.bpm` | — | Read from latest `AnalysisResult.final_json` of source version |
| `track.key` (e.g. "F# min") | ⚠️ derivable | `final_json.phase1.detected_key` | — | Format on read |
| `track.durationSec` | ⚠️ derivable | `final_json.phase1.duration_seconds` | — | Pipeline produces this |
| `track.lufs` (integrated) | ⚠️ derivable | `final_json.phase1.integrated_lufs` | — | Pipeline produces this |
| `track.moods` (string[]) | 🆕 schema | NOT in pipeline output | S | User-tagged at publish; `text[]` on `published_tracks` |
| `track.license` (4-enum) | 🆕 schema | not present | S | Enum col |
| `track.allowDownload` (bool) | 🆕 schema | not present | S | Bool col |
| `track.showAnalysis` (bool) | 🆕 schema | not present | S | Bool col — gates extended share-report payload |
| `track.description` (free text) | 🆕 schema | not present | S | Nullable text |
| `track.plays` (int) | 🆕 schema | not present | M | `track_plays` event table; counter cached on `published_tracks` |
| `track.savesCount` (int) | 🆕 schema | not present | M | Cached counter; see `bookmarks` table below |
| `track.publishedDays` | ⚠️ derivable | `published_tracks.published_at` | — | Compute on read |
| `track.hue` (cover-art hue) | 🆕 schema | not present | S | Stored at publish or derived from `avatarHue` |
| `track.audio_url` (streamable, **public**) | 🔨 pipeline | `song_versions.file_path` is auth-gated local disk | M | Public streaming endpoint with Range requests + tokenized URL; CORS must allow Web Audio `crossOrigin='anonymous'` reads (see ToolsRail note) |
| **Raw audio bytes accessible to Web Audio API** | 🔨 pipeline | not present | M | ToolsRail uses `AudioContext.decodeAudioData(arrayBuffer)` — needs `Access-Control-Allow-Origin` on the streaming endpoint and `audio.crossOrigin='anonymous'` on the client. Range requests + correct CORS preflight are the design implication — see below |
| Waveform peaks (200 bars in design) | 🔨 pipeline | not produced today | S | Pre-computed downsampled peak array at upload time; reused across Library, Listen, Discover, Public Listen, and SharedReport |
| **Bookmark state per (user, published_track)** | 🆕 schema | not present | S | New `bookmarks` table — `user_id`, `published_track_id`, `created_at`. Drives the ★ Bookmark toggle and the listener's bookmark library (separate from the producer's library of their own tracks) |
| **Public comments** (`{id, user, handle, t, text, avatarHue, postedAgo}[]`) | 🆕 schema | not present | M | New `track_comments` table — `id`, `published_track_id`, `author_user_id` (nullable for anonymous publish on author's own track? — see open questions), `timestamp_seconds`, `text`, `created_at`. Avatar hue + handle joined from `users`. Posting requires auth (no anonymous listeners). |
| `comment.t` (timestamp in seconds, jump-to-position) | 🆕 schema | not present | — | Client computes `Math.floor(currentPos)` on post; server stores integer seconds |
| `comment.postedAgo` (relative time string) | ⚠️ derivable | `created_at` | — | Format on read or client-side |
| `comment.user` initial (avatar fallback) | ⚠️ derivable | `users.display_name[0]` | — | |
| `genres` list (8 fixed) | ⚠️ derivable | hardcoded in mock | — | Static enum on backend, or derive from union of `published_tracks.genre` |
| `moods` list (21 fixed) | 🆕 schema | hardcoded | S | Static enum or curated taxonomy table |
| `licenses` list (4 fixed) | 🆕 schema | hardcoded | S | Static enum |
| `YOUR_PUBLIC_TRACK_IDS` (which of my songs are public) | ⚠️ derivable | filter `published_tracks WHERE user_id = me` | — | Cross-page concern with Library "Published" badge |
| `song.versions[]` (passed into Publish modal) | ✅ exists | `song_versions` table | — | Used to pick which version to publish |
| `version.grade` / `version.score` (chip in modal) | ⚠️ derivable | `analysis_results.final_json` per version | — | Already surfaced on Library page |
| **`fix.steps[]` applied to ToolsRail** (Coach → public Listen) | ⚠️ derivable | existing `Verdict.fix.dsp_chain` is the closest match | M | New `fix.steps[]` shape (`kind`, `where`, `what`, `from`, `to`) is the wire-format contract between Coach and ToolsRail; needs prompt rewrite or post-processor to populate. See open questions about which Listen the preset applies to (private or public) |

## Interactions
| Trigger | Action | Backend route | DB changes |
|---|---|---|---|
| Page load (feed) | Fetch first page of public tracks + users + filter options | `GET /api/discover/tracks?genre=&mood=&license=&bpm_min=&bpm_max=&sort=&search=&cursor=` (new) | none |
| Click track card | Open `PublicListenView` | `GET /api/discover/tracks/{id}` (new) | debounced play count via stream endpoint |
| Click play (listen view) | Begin audio stream **with CORS + Range** for Web Audio decode | `GET /api/discover/tracks/{id}/stream` (new, public, Range-capable, `Access-Control-Allow-Origin` set) | log play event after threshold → `track_plays` insert |
| **Drag a ToolsRail knob** (e.g. EQ band gain) | Re-route `AudioContext` graph node param | none — client-side only | none |
| **"Apply preset" from a public-track Coach finding** | Navigate to Public Listen view with `?preset=<verdict_id>` query OR push `fix.steps[]` into ToolsRail state | `GET /api/discover/tracks/{id}/verdicts/{verdict_id}` (only if showAnalysis publicly) | none |
| **Click ☆/★ Bookmark** | Toggle bookmark on this published track | `POST /api/discover/tracks/{id}/bookmark` (new, idempotent toggle) | insert/delete `bookmarks(user_id, published_track_id)`; bump `published_tracks.bookmark_count` |
| **Submit a timestamped comment** | Post comment at current playhead | `POST /api/discover/tracks/{id}/comments` body `{timestamp_seconds, text}` (new) | insert into `track_comments` |
| **Click `@<comment-handle>`** | Navigate to commenter's public profile | `GET /api/discover/users/{handle}` | none |
| **Click `@<comment-timestamp>` pin** | Seek audio to comment's timestamp | client-only (`setPos(c.t)`) | none |
| Fetch comments on track load | List comments for a published track | `GET /api/discover/tracks/{id}/comments?limit=50&cursor=` (new) | none |
| Click "⇣ Download" (if allowed) | Download original audio | `GET /api/discover/tracks/{id}/download` (new, gated by `allow_download`) | optional download event log |
| Click `@handle` on card | Navigate to public profile | `GET /api/discover/users/{handle}` (new) | none |
| Public profile load | Fetch profile + user's public tracks (excludes anonymous publishes) | `GET /api/discover/users/{handle}` + `GET /api/discover/users/{handle}/tracks` (new) | none |
| Filter change (genre/mood/license/bpm/sort/search) | Re-query feed | same `GET /api/discover/tracks` with params | none |
| Click "+ Publish a track" (hero) | Open `PublishToDiscoverModal` (needs Song selection first) | none | none |
| Submit Publish modal | Create published-track row | `POST /api/discover/publish` body `{song_version_id, title, artist_display, genre, moods, description, license, allow_download, show_analysis, anonymous}` (new) | insert `published_tracks` with `anonymous=true|false` |
| Click "✎ Edit public profile" | Open `EditPublicProfileModal` | none | none |
| Submit `EditPublicProfileModal` | Update profile | `PATCH /api/discover/me/profile` (new) | update `users.display_name/bio/link/banner_hue` |
| "Unpublish" | Remove from feed | `DELETE /api/discover/publish/{id}` (new) | soft- or hard-delete `published_tracks`; cascade-soft `track_comments` and `bookmarks`? — see open questions |

## Real-time / streaming behavior
- **Public audio streaming** — listener must download raw audio bytes (`decodeAudioData`) to run ToolsRail DSP client-side. Needs:
  - `GET /api/discover/tracks/{id}/stream` returning `audio/*` with `Accept-Ranges: bytes` and 206 responses
  - `Access-Control-Allow-Origin: <frontend origin>` (not `*` for credentialed flows)
  - `Cache-Control: public, max-age=…` so re-listens don't re-download
  - Tokenized public URL or signed S3/R2 URL once cloud storage lands; until then, FastAPI's `StreamingResponse` doesn't support seek and will need a custom Range-aware handler (or wait for the C# rewrite)
- **Comment list refresh** — polling on load + revalidation after post is sufficient for v1. SSE for live comments is overkill; defer unless we observe genuine multi-listener-on-same-track sessions. Tradeoff: live comments make Public Listen feel like Twitch chat (good for events / livestream-style mix feedback), but the cost is a long-lived SSE per active listener — defer.
- **Bookmark count** — optimistic UI; refresh on next page load. No cross-user live updates.
- **Plays counter** — same as before; debounced server-side after a "real listen" threshold (~10s).
- **ToolsRail audio graph** — entirely client-side once audio bytes are decoded. Zero server load beyond the initial stream. This is the design's biggest leverage point.

## Open product questions
- **Anonymous publish semantics**: does the author's profile show the anonymous track in their own "isYou" public-tracks grid (private view), or is it truly hidden everywhere except the feed? Current `PublicProfilePage` filters `tracks.filter(t => t.artist === user.handle)` — anonymous tracks won't match, so they're hidden by default, but the author may want a "my anonymous publishes" admin view.
- **Anonymous publish + comments**: can a logged-in author reply to comments on their own anonymous track? Doing so via their visible handle blows the anonymity cover. Reasonable v1 stance: anonymous tracks accept comments but the author cannot reply at all in v1.
- **Anonymous publish + verdicts**: if `show_analysis=true` AND `anonymous=true`, does the share-report extension still include AI Coach findings? Probably yes — findings are about the track, not the author.
- **Comment moderation**: report / hide / soft-delete primitives. v1 cap: poster can delete their own comment, track owner can hide any comment. Global moderation queue → Phase 2.
- **Comment cap per track**: Twitter-style infinite vs. SoundCloud-style hidden-below-N. Lean: infinite, paginated 50/page, newest first OR timestamp order? Design shows timestamp order (`tc1 @ 42s`, `tc2 @ 128s`, `tc3 @ 196s`) which is more useful — sort by `timestamp_seconds ASC`.
- **Comment authorship**: can listeners comment anonymously? Strong no — comments must be tied to a `user_id` for accountability.
- **Bookmarks privacy**: is a user's bookmark library public on their profile, or private? Default: private. Bookmarks are the listener's personal radar, not a public endorsement.
- **Bookmarks vs. "saves"**: design uses `★ savesCount` on cards but a `☆ Bookmark` button on the listen view. Treat them as the same thing — `savesCount = bookmark_count`. The UI labels are inconsistent in the mock; standardize on "Bookmark" everywhere.
- **Downloadable public audio for client-side DSP**: ToolsRail needs raw decoded audio (`AudioBuffer`) regardless of whether `allow_download=true`. The download toggle is about giving listeners a *file* to keep, not about whether bytes pass through their browser. Decision: streaming endpoint always serves bytes; download endpoint is a separate route that just sets `Content-Disposition: attachment`.
- **Apply Coach preset to a public track** — when a listener clicks "Apply preset" on a public-track Coach finding, the preset applies to the Public Listen ToolsRail (so the listener auditions the fix on the author's master). When the author clicks it on their own private Listen, it applies to their own audio. Both paths should use the same `fix.steps[]` wire format.
- **`fix.steps[]` faithfulness to ToolsRail capabilities**: the new `kind` enum includes `plugin`, `fx`, `target`, `automation`, `check`, `arrangement`, `production`. ToolsRail can only honor `plugin` (EQ band, compressor, width) and possibly `fx` (loop region). `automation`, `arrangement`, `production`, and `check` are DAW-only and should render as read-only annotations in the ToolsRail preset preview, not actuated knob changes.
- **"Show the full analysis report publicly"** — does this reuse the existing `share_token` URL or create a new public route under `/api/discover/tracks/{id}/report`? Lean: new route, since the track is already public and a separate `share_token` is redundant.
- **Filmmaker-framed licensing copy** — "Sync-cleared" / "license for film/video" is still in the design but the audience (amateur/intermediate producers) doesn't think in those terms. Re-copy as "Free to use with credit" / "Don't redistribute" before launch.
- **Handle uniqueness + assignment**: globally unique, lowercase, user-chosen at signup or auto-generated from email prefix with a uniqueness suffix? When can they change them?
- **Discover route default for unauthenticated visitors**: today's auth model is JWT-gated everywhere. Public Listen URL `/discover/t/{slug}` should be accessible without login (encourages share-out), but commenting and bookmarking require auth (login wall on action).

## Build verdict

**🟠 DEFER — but with a materially narrower scope than the previous audit.**

The new design adds three high-leverage primitives (ToolsRail-on-public-tracks, timestamped comments, bookmarks) that *do* push Discover closer to v1 viability because each one is independently valuable and reuses Listen-page DSP code we'll already have. However, the foundation — public profiles, handles, the feed itself, public audio streaming with Range + CORS, the moods/license taxonomy, the bookmarks/comments/plays infrastructure — is still ~6 new DB tables, ~12 new API routes, and a public-streaming + storage decision that the current backend cannot serve. The right v1 move remains the tokenized share-link primitive (`share_token` already in schema), but the audit should be revised to **carve out one Phase-2 sub-feature that ships early**: the Public Listen view + comments thread + bookmark, **bolted onto the existing share-link URL** (no feed, no profiles, no handles). That gives reviewers a real feedback surface without standing up the full social graph.

**Previously deferred but now needs reconsidering:** the *comments thread* is the v1.5 unlock. The existing `share_token` URL today shows a read-only report; extending that page with comments + bookmark would let producers solicit timestamped feedback from anyone they share the link with, which is exactly what the producer audience asks for. This is a much smaller delta than the full feed: one new table (`track_comments`) keyed on `share_token` instead of `published_track_id`, no handles needed (commenter still has an account, target track does not need to be "published"), no streaming endpoint changes (private audio is already auth-gated for the owner, and the share-link page can use the existing serving path with a token check).

## Recommended cuts / placeholders for v1
- **CUT v1**: feed page (`DiscoverPage`), `DiscoverHero`, `DiscoverCard` grid, all filter chips, sort, search, mood/genre/license chips.
- **CUT v1**: `PublicProfilePage`, `EditPublicProfileModal`, banner/avatar hue, bio, link, handle.
- **CUT v1**: plays counter, mood taxonomy, license enum (all four), `allowDownload`, anonymous publish.
- **CUT v1**: the public-track verdicts overlay (`showAnalysis=true` exposure of full Coach findings to anonymous listeners).
- **CUT v1**: ToolsRail-on-public-tracks. ToolsRail itself ships on private Listen — but standing up Range-capable + CORS-correct public streaming for client-side Web Audio decode is too much foundation work for v1.
- **CONSIDER v1.5 (post-launch, before full Discover)**: bolt **timestamped public comments + bookmark** onto the existing `/reports/share/{token}` page. New table `track_comments(share_token, author_user_id, timestamp_seconds, text)`. New table `bookmarks(user_id, share_token)`. Two new endpoints: `POST /reports/share/{token}/comments`, `POST /reports/share/{token}/bookmark`. No streaming/profile/handle work needed. Gives the producer audience the "share my mix for timestamped feedback" loop that's their primary ask.
- **KEEP as share-link skin v1**: rename `PublishToDiscoverModal` → `ShareSongModal`. Drop all fields except: which version, optional display title, optional description, "Show the full analysis report publicly" toggle. Submitting copies the tokenized URL `/reports/share/{share_token}` to clipboard.
- **PLACEHOLDER for /discover route**: a "Coming soon — share your mix with a tokenized link in the meantime" screen pointing at the share-link primitive.
- Defer audio peaks (waveform bars) pipeline work in the public flow — share-link recipients use the same private-report waveform that already exists in `SharedReportPage`.

## Notes
- The share-link primitive is already in the schema (`analysis_results.share_token`, migration 002) and route (`GET /reports/share/{token}`). The frontend `SharedReportPage` already exists. **The new design's most valuable additions — comments + bookmarks — graft onto this primitive without needing the rest of Discover**.
- **Relationship to the original share-link feedback design**: the new ToolsRail + comments + bookmarks design does NOT replace share-link feedback — it *generalizes* it. Comments and bookmarks are the same primitive whether they live on a share-link URL or on a published-Discover URL; what differs is the indexed surface (private link vs. public feed). v1 should ship comments/bookmarks against share-link URLs, v2 should reuse the exact same tables/routes when published tracks come online (key the tables on a polymorphic `target_id` or have two foreign keys: `share_token` for share-link target, `published_track_id` for Discover target — both nullable, CHECK exactly one is set).
- **ToolsRail-on-public-tracks** is the single most expensive design element on this page because it requires public, Range-capable, CORS-permissive audio bytes flowing to the listener's browser. Until R2 / signed-URL streaming lands, this is not feasible. **However**: once it lands, ToolsRail on public tracks is genuinely differentiating — no other production-feedback tool lets you EQ-tweak someone else's master in your browser before commenting. This belongs in the v2 roadmap as the headline Discover feature.
- The Public Listen waveform is the same 200-bar `hue`-derived pattern as private Listen and Library cards. Pre-computed peaks at upload time fix all four surfaces at once.
- The `fix.steps[]` wire format is now load-bearing across Coach → private Listen → public Listen. Pin its schema in `aimusic_shared/verdicts/models.py` before Coach prompts get rewritten to emit it, otherwise we'll be patching three frontends.
- The Publish modal's `artist` field still defaults to `'Mae Karlsson'` literal in the design — when anonymous toggle is OFF, this should lock to the publisher's `displayName` from `users.display_name`, not be free-text editable. When anonymous toggle is ON, the entire input becomes a non-editable "Anonymous" pill (design already does this — see lines 712–725).
- If/when Discover ships, anonymous publishing implies a `published_tracks.anonymous` flag and an API contract that strips `user_id`/`artist` from the wire response when `anonymous=true`. Comment-author handles remain visible regardless — only the track author is anonymized.
- Comment storage keyed on `published_track_id` (Discover) OR `share_token` (private share) is the right shape — both routes converge on the same primitive. Plan the table for both from day one.
- The `users` table still needs `handle` + `display_name` even if Discover defers, because comments-on-share-links surface commenter handles. Add these two columns in v1 regardless.
